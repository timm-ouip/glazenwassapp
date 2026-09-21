-- Betalingen, fase 3: herstelpunten uit de review.
--
-- * De nieuwe tabellen krijgen het bedrijf vanzelf (set_company_id).
-- * Een geldloper ziet in het logboek alleen de tikken van de avond waarop hij
--   nu loopt: niet de hele geschiedenis van een adres, en na de avond niets
--   meer (ook zijn eigen tikken niet).
-- * Twee keer Betaald vlak na elkaar valt ook op als het van dezelfde loper is.
-- * Een tik mag tot een dag na de avond binnenkomen (voor als er geen bereik
--   was); later niet.
-- * Een eindtijd na middernacht hoort bij de nacht erna.
-- * De klachten in de lijst volgen dezelfde regel als de planning, en een
--   klacht aan de deur bij een adres zonder klant gaat mee als er later een
--   klant aan het adres komt.
-- * De lijst geeft de kortingen van vanavond mee, om ze te kunnen herstellen.

create trigger geldloop_vrijgaven_set_company_id before insert on public.geldloop_vrijgaven
  for each row execute function public.set_company_id();
create trigger geldloop_vrijgave_wijken_set_company_id before insert on public.geldloop_vrijgave_wijken
  for each row execute function public.set_company_id();
create trigger geldloop_vrijgave_lopers_set_company_id before insert on public.geldloop_vrijgave_lopers
  for each row execute function public.set_company_id();
create trigger vaste_kortingen_set_company_id before insert on public.vaste_kortingen
  for each row execute function public.set_company_id();

-- Loopt deze avond nu, en loop ik mee?
create or replace function public.geldloop_loopt_voor_mij(vrijgave uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.geldloop_vrijgaven v
    join public.geldloop_vrijgave_lopers l on l.vrijgave_id = v.id and l.employee_id = auth.uid()
    where v.id = vrijgave and v.company_id = public.current_company_id()
      and v.ingetrokken_op is null and now() >= v.begin_op and now() < v.eind_op
  )
$$;
revoke execute on function public.geldloop_loopt_voor_mij(uuid) from public, anon;
grant execute on function public.geldloop_loopt_voor_mij(uuid) to authenticated;

drop policy "Betalingen lezen" on public.betaal_gebeurtenissen;
create policy "Betalingen lezen" on public.betaal_gebeurtenissen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or (vrijgave_id is not null and public.geldloop_loopt_voor_mij(vrijgave_id))
    )
  );

-- Komt er een klant aan een adres, dan gaan de klachten die alleen aan het
-- adres hingen naar die klant.
create or replace function public.klachten_klant_erbij()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.klachten set klant_id = new.klant_id
    where customer_id = new.id and klant_id is null;
  return null;
end
$$;
create trigger customers_klachten_klant_erbij after update of klant_id on public.customers
  for each row when (old.klant_id is null and new.klant_id is not null)
  execute function public.klachten_klant_erbij();

create or replace function public.geld_boeken(
  id uuid,
  adres_id uuid,
  soort text,
  bedrag numeric default 0,
  reden text default '',
  vaste_korting uuid default null,
  herroept uuid default null,
  op timestamptz default null,
  getoond_open numeric default null,
  bron text default 'geldloop'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eigenaar boolean := public.is_eigenaar();
  moment timestamptz := coalesce(op, now());
  vrij uuid;
  vrij_eind timestamptz;
  bestaand public.betaal_gebeurtenissen;
  oud public.betaal_gebeurtenissen;
  schoon numeric := round(coalesce(bedrag, 0), 2);
  tekst text := btrim(coalesce(reden, ''));
  botsing uuid;
  vk public.vaste_kortingen;
begin
  if bedrijf is null then
    raise exception 'Je bent niet ingelogd.';
  end if;

  select * into bestaand from public.betaal_gebeurtenissen g where g.id = geld_boeken.id;
  if found then
    if bestaand.company_id = bedrijf and bestaand.customer_id = adres_id and bestaand.soort = soort then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', bestaand.botsing_met is not null);
    end if;
    raise exception 'Deze tik bestaat al voor iets anders.';
  end if;

  if soort not in ('betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan') then
    raise exception 'Onbekende soort.';
  end if;
  if bron not in ('geldloop', 'kantoor') then
    raise exception 'Onbekende bron.';
  end if;
  if moment > now() + interval '2 minutes' then
    raise exception 'De klok van je telefoon loopt voor. Zet hem goed en probeer het opnieuw.';
  end if;
  moment := least(moment, now());

  if not exists (select 1 from public.customers c where c.id = adres_id and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;

  -- Wie mag dit?
  if bron = 'kantoor' then
    if not eigenaar then
      raise exception 'Alleen de eigenaar kan op kantoor betalingen boeken.';
    end if;
  else
    vrij := public.geldloop_vrijgave_voor(adres_id, moment);
    if vrij is null and not eigenaar then
      raise exception 'Deze wijk is niet (meer) voor je vrijgegeven.';
    end if;
    if vrij is null and eigenaar then
      -- De eigenaar loopt zelf mee: hang de tik aan de avond van die wijk.
      select v.id into vrij
        from public.customers c
        join public.streets s on s.id = c.street_id
        join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id
        join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
        where c.id = adres_id and v.ingetrokken_op is null
          and moment >= v.begin_op and moment < v.eind_op
        order by v.eind_op desc limit 1;
    end if;
    if vrij is not null then
      select eind_op into vrij_eind from public.geldloop_vrijgaven where geldloop_vrijgaven.id = vrij;
      if now() > vrij_eind + interval '24 hours' then
        raise exception 'Deze tik komt te laat binnen (meer dan een dag na de avond).';
      end if;
    end if;
  end if;

  -- Wat er bij deze soort hoort.
  if soort in ('betaald', 'korting') then
    if schoon <= 0 or schoon > 10000 then
      raise exception 'Vul een bedrag in.';
    end if;
  else
    schoon := 0;
  end if;
  if length(tekst) > 200 then
    raise exception 'De reden is te lang.';
  end if;
  if soort = 'korting' and vaste_korting is not null then
    select * into vk from public.vaste_kortingen k
      where k.id = vaste_korting and k.customer_id = adres_id and k.deleted_at is null;
    if not found then
      raise exception 'Die vaste korting bestaat niet meer.';
    end if;
    if tekst = '' then
      tekst := vk.naam;
    end if;
  elsif soort = 'korting' and tekst = '' then
    raise exception 'Zet erbij waarom je korting geeft.';
  end if;

  if soort = 'ongedaan' then
    select * into oud from public.betaal_gebeurtenissen g
      where g.id = herroept and g.customer_id = adres_id and g.company_id = bedrijf;
    if not found or oud.soort in ('ongedaan', 'beginstand') then
      raise exception 'Dat kan niet ongedaan gemaakt worden.';
    end if;
    if exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = oud.id) then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', false);
    end if;
    if not eigenaar and not (
      oud.door = auth.uid()
      and oud.vrijgave_id is not null
      and now() < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id)
    ) then
      raise exception 'Na de eindtijd kan alleen de eigenaar dit nog herstellen.';
    end if;
    vrij := coalesce(vrij, oud.vrijgave_id);
  end if;

  -- Een andere betaling op hetzelfde adres, vlak ervoor: van een collega, of
  -- twee keer op de knop gedrukt.
  if soort = 'betaald' then
    select g.id into botsing from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.soort = 'betaald' and g.id <> geld_boeken.id
        and g.op > moment - interval '30 minutes' and g.op <= moment + interval '1 minute'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc limit 1;
  end if;

  insert into public.betaal_gebeurtenissen
    (id, company_id, customer_id, adres, soort, bedrag, reden, vaste_korting_id, herroept_id,
     vrijgave_id, bron, door, door_naam, op, getoond_open, botsing_met)
  values
    (geld_boeken.id, bedrijf, adres_id, public.geld_adres_tekst(adres_id), soort, schoon, tekst,
     case when soort = 'korting' then vaste_korting end,
     case when soort = 'ongedaan' then herroept end,
     vrij, bron, auth.uid(), public.geld_mijn_naam(), moment,
     round(getoond_open, 2), botsing)
  on conflict do nothing;

  return jsonb_build_object('status', 'nieuw', 'botsing', botsing is not null);
end
$$;

create or replace function public.geldloop_vrijgeven(
  datum date,
  wijken uuid[],
  lopers uuid[],
  eind time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eindtijd time;
  begin_tijd timestamptz;
  eind_tijd timestamptz;
  niet_klaar text;
  fout_loper text;
  nieuw uuid;
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan een wijk vrijgeven.';
  end if;
  if coalesce(cardinality(wijken), 0) = 0 then
    raise exception 'Kies een wijk.';
  end if;
  if coalesce(cardinality(lopers), 0) = 0 then
    raise exception 'Kies wie er gaan lopen.';
  end if;
  if (select count(*) from public.districts d
      where d.id = any (wijken) and d.company_id = bedrijf and d.deleted_at is null)
     <> cardinality(wijken) then
    raise exception 'Die wijk bestaat niet.';
  end if;
  select string_agg(d.name, ', ') into niet_klaar
    from public.districts d where d.id = any (wijken) and d.geld_klaar_op is null;
  if niet_klaar is not null then
    raise exception 'De beginstand van % is nog niet klaar.', niet_klaar;
  end if;
  -- Alleen mensen van dit bedrijf, en alleen wie mag geldlopen.
  select string_agg(coalesce(nullif(e.naam, ''), e.email), ', ') into fout_loper
    from public.employees e
    left join public.rollen r on r.id = e.rol_id and r.company_id = e.company_id
    where e.id = any (lopers) and e.company_id = bedrijf
      and not (e.rol = 'eigenaar' or 'geldlopen' = any (coalesce(r.rechten, '{}')));
  if fout_loper is not null then
    raise exception '% mag niet geldlopen. Geef in Instellingen → Team een rol met "Geld lopen".', fout_loper;
  end if;
  if (select count(*) from public.employees e where e.id = any (lopers) and e.company_id = bedrijf)
     <> cardinality(lopers) then
    raise exception 'Die medewerker bestaat niet.';
  end if;

  select coalesce(eind, c.geldloop_eindtijd) into eindtijd from public.companies c where c.id = bedrijf;
  begin_tijd := greatest(now(), (datum::timestamp) at time zone 'Europe/Amsterdam');
  eind_tijd := (datum + eindtijd) at time zone 'Europe/Amsterdam';
  -- Een eindtijd na middernacht (00:30) hoort bij de nacht erna.
  if eindtijd < time '06:00' then
    eind_tijd := eind_tijd + interval '1 day';
  end if;
  if eind_tijd <= now() then
    raise exception 'Die avond is al voorbij (de eindtijd was %).', to_char(eindtijd, 'HH24:MI');
  end if;

  insert into public.geldloop_vrijgaven (company_id, datum, begin_op, eind_op, vrijgegeven_door, vrijgegeven_naam)
    values (bedrijf, datum, begin_tijd, eind_tijd, auth.uid(), public.geld_mijn_naam())
    returning id into nieuw;
  insert into public.geldloop_vrijgave_wijken (vrijgave_id, district_id, company_id)
    select nieuw, w, bedrijf from unnest(wijken) w group by w;
  insert into public.geldloop_vrijgave_lopers (vrijgave_id, employee_id, company_id)
    select nieuw, l, bedrijf from unnest(lopers) l group by l;

  return jsonb_build_object('id', nieuw, 'niet_afgemeld', public.geld_niet_afgemeld(bedrijf, wijken));
end
$$;

create or replace function public.geldloop_eind_wijzigen(vrijgave uuid, eind time)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.geldloop_vrijgaven;
  nieuw_eind timestamptz;
begin
  if not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.';
  end if;
  select * into v from public.geldloop_vrijgaven
    where id = vrijgave and company_id = public.current_company_id();
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  nieuw_eind := (v.datum + eind) at time zone 'Europe/Amsterdam';
  if eind < time '06:00' then
    nieuw_eind := nieuw_eind + interval '1 day';
  end if;
  if nieuw_eind <= v.begin_op then
    raise exception 'De eindtijd moet na het begin liggen.';
  end if;
  update public.geldloop_vrijgaven set eind_op = nieuw_eind where id = vrijgave;
end
$$;

create or replace function public.geldloop_lijst(vrijgave uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  ids uuid[];
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not (
    v.ingetrokken_op is null and now() >= v.begin_op and now() < v.eind_op
    and exists (select 1 from public.geldloop_vrijgave_lopers l
                where l.vrijgave_id = v.id and l.employee_id = auth.uid())
  ) then
    raise exception 'Deze wijk is nu niet voor je vrijgegeven.';
  end if;

  -- Actieve adressen, en gestopte waar nog iets open staat (die komen er
  -- hieronder uit als ze op 0 staan).
  select array_agg(c.id) into ids
    from public.customers c
    join public.streets s on s.id = c.street_id
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null;

  return jsonb_build_object(
    'vrijgave', jsonb_build_object('id', v.id, 'datum', v.datum, 'begin_op', v.begin_op, 'eind_op', v.eind_op,
                                   'ingetrokken', v.ingetrokken_op is not null),
    'adressen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'wijk_id', d.id, 'wijk', d.name, 'wijk_sort', d.sort_order,
        'straat_id', s.id, 'straat', s.name, 'straat_sort', s.sort_order,
        'sort_desc', s.sort_desc, 'doorlopend', s.doorlopend,
        'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
        'sort_order', c.sort_order, 'hoek_kant', coalesce(c.hoek_kant, ''),
        'naam', coalesce(k.naam, ''),
        'note', coalesce(c.note, ''),
        'interval_maanden', c.interval_maanden, 'ritme', c.ritme,
        'methode', coalesce(c.betaalmethode, d.betaalmethode),
        'gestopt', c.inactief_op is not null,
        'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
        'klachten', (select coalesce(jsonb_agg(kl.omschrijving order by kl.ontvangen_op desc), '[]')
                     from public.klachten kl
                     where kl.deleted_at is null and kl.status = 'open'
                       -- Zoals op de planning: een klacht bij dit adres alleen als hij van
                       -- de huidige bewoner is, en een klacht van de klant zonder adres.
                       and ((kl.customer_id = c.id and kl.klant_id is not distinct from c.klant_id)
                            or (kl.customer_id is null and kl.klant_id = c.klant_id))),
        'vaste_kortingen', (select coalesce(jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag)
                                                      order by vk.gemaakt_op), '[]')
                            from public.vaste_kortingen vk where vk.customer_id = c.id and vk.deleted_at is null),
        'kortingen_vanavond', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'id', g.id, 'bedrag', g.bedrag, 'reden', g.reden,
                                   'door', g.door, 'door_naam', g.door_naam, 'op', g.op) order by g.op), '[]')
                               from public.betaal_gebeurtenissen g
                               where g.customer_id = c.id and g.vrijgave_id = v.id and g.soort = 'korting'
                                 and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
        'vanavond', (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                               'door', g.door, 'door_naam', g.door_naam)
                     from public.betaal_gebeurtenissen g
                     where g.customer_id = c.id and g.vrijgave_id = v.id
                       and g.soort in ('betaald', 'niet_thuis', 'geen_geld')
                       and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                     order by g.op desc limit 1)
      ))
      from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
      join public.customers c on c.id = st.customer_id
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
      where c.inactief_op is null or st.open <> 0
    ), '[]'::jsonb),
    'opgehaald', (select jsonb_build_object(
                    'mij', coalesce(sum(g.bedrag) filter (where g.door = auth.uid()), 0),
                    'mij_aantal', count(*) filter (where g.door = auth.uid()),
                    'totaal', coalesce(sum(g.bedrag), 0))
                  from public.betaal_gebeurtenissen g
                  where g.vrijgave_id = v.id and g.soort = 'betaald'
                    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id))
  );
end
$$;
