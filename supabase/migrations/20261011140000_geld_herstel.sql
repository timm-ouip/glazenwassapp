-- Betalingen: herstelpunten uit de review van de overzichten.
--
-- * Een Ongedaan maken van de geldloper telt op het moment van tikken, niet
--   van binnenkomen: wie om 22:59 in een portiek terugdraait en om 23:03
--   weer bereik heeft, wordt niet geweigerd.
-- * Weggegooide straten en wijken tellen niet mee in de pof-lijst en het
--   avondoverzicht.

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
  if bron not in ('geldloop', 'kantoor', 'dag') then
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
  elsif bron = 'dag' then
    -- Een wasser die overdag geld krijgt: alleen bij een contant adres dat
    -- vandaag op de route staat, en alleen vandaag.
    if soort not in ('betaald', 'ongedaan') then
      raise exception 'Overdag kun je alleen een betaling intikken.';
    end if;
    if not public.dag_geld_toegang(adres_id)
       or (moment at time zone 'Europe/Amsterdam')::date <> (now() at time zone 'Europe/Amsterdam')::date then
      raise exception 'Dit adres staat vandaag niet op je route, of betaalt niet contant.';
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
      and (
        (oud.vrijgave_id is not null
         and moment < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id))
        or (oud.bron = 'dag'
            and (oud.op at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date)
      )
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

create or replace function public.geld_pof(wijken uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  adressen uuid[];
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  -- Alleen adressen die ooit contant betaalden (of een beginstand hebben).
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c
    join public.streets s on s.id = c.street_id and s.deleted_at is null
    join public.districts d on d.id = s.district_id and d.deleted_at is null
    where c.company_id = bedrijf and c.deleted_at is null
      and (wijken is null or s.district_id = any (wijken))
      and (exists (select 1 from public.contant_periodes p where p.customer_id = c.id)
           or exists (select 1 from public.betaal_gebeurtenissen g where g.customer_id = c.id));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'wijk_id', d.id, 'wijk', d.name, 'straat_id', s.id, 'straat', s.name,
      'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
      'naam', coalesce(k.naam, ''), 'methode', coalesce(c.betaalmethode, d.betaalmethode),
      'gestopt', c.inactief_op is not null,
      'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
      'laatst_betaald', (select max(g.op) from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort = 'betaald'
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
      'laatste_poging', (select jsonb_build_object('soort', g.soort, 'op', g.op, 'door_naam', g.door_naam)
                         from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('niet_thuis', 'geen_geld')
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                         order by g.op desc limit 1)
    ) order by st.open desc)
    from public.geld_stand(bedrijf, adressen) st
    join public.customers c on c.id = st.customer_id
    join public.streets s on s.id = c.street_id
    join public.districts d on d.id = s.district_id
    left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
    where abs(st.open) > 0.005
  ), '[]'::jsonb);
end
$$;

create or replace function public.geld_avond(datum date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vrij uuid[];
  wijken uuid[];
  adressen uuid[];
  begin_dag timestamptz := (datum::timestamp) at time zone 'Europe/Amsterdam';
  pof numeric;
  pof_aantal int;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  select coalesce(array_agg(v.id), '{}') into vrij
    from public.geldloop_vrijgaven v where v.company_id = bedrijf and v.datum = geld_avond.datum;
  select coalesce(array_agg(distinct w.district_id), '{}') into wijken
    from public.geldloop_vrijgave_wijken w where w.vrijgave_id = any (vrij);
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c join public.streets s on s.id = c.street_id and s.deleted_at is null
    where c.company_id = bedrijf and s.district_id = any (wijken) and c.deleted_at is null;
  select coalesce(sum(st.open) filter (where st.open > 0), 0), count(*) filter (where st.open > 0.005)
    into pof, pof_aantal
    from public.geld_stand(bedrijf, adressen) st;

  return jsonb_build_object(
    'vrijgaven', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'begin_op', v.begin_op, 'eind_op', v.eind_op, 'ingetrokken_op', v.ingetrokken_op,
        'wijken', (select coalesce(jsonb_agg(d.name order by d.sort_order), '[]')
                   from public.geldloop_vrijgave_wijken w join public.districts d on d.id = w.district_id
                   where w.vrijgave_id = v.id),
        'lopers', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                   from public.geldloop_vrijgave_lopers l join public.employees e on e.id = l.employee_id
                   where l.vrijgave_id = v.id)
      ) order by v.begin_op)
      from public.geldloop_vrijgaven v where v.id = any (vrij)
    ), '[]'::jsonb),
    -- Alles wat die avond is ingetikt (en overdag door de wassers).
    'gebeurtenissen', coalesce((
      select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op)
      from public.betaal_gebeurtenissen g
      where g.company_id = bedrijf and g.soort <> 'ongedaan'
        and (g.vrijgave_id = any (vrij)
             or (g.bron = 'dag' and g.op >= begin_dag and g.op < begin_dag + interval '1 day'))
    ), '[]'::jsonb),
    'klachten', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'omschrijving', k.omschrijving, 'customer_id', k.customer_id, 'klant_id', k.klant_id,
        'adres', public.geld_adres_tekst(k.customer_id),
        'door_naam', (select coalesce(nullif(e.naam, ''), e.email) from public.employees e where e.id = k.gemaakt_door),
        'op', k.ontvangen_op, 'status', k.status
      ) order by k.ontvangen_op)
      from public.klachten k
      where k.company_id = bedrijf and k.bron = 'deur' and k.deleted_at is null
        and k.ontvangen_op >= begin_dag and k.ontvangen_op < begin_dag + interval '1 day'
    ), '[]'::jsonb),
    'vaste_kortingen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag, 'customer_id', vk.customer_id,
        'adres', public.geld_adres_tekst(vk.customer_id), 'door_naam', vk.gemaakt_naam,
        'op', vk.gemaakt_op, 'weg', vk.deleted_at is not null
      ) order by vk.gemaakt_op)
      from public.vaste_kortingen vk
      where vk.company_id = bedrijf
        and vk.gemaakt_op >= begin_dag and vk.gemaakt_op < begin_dag + interval '1 day'
    ), '[]'::jsonb),
    -- Wat er in die wijken nu nog open staat.
    'pof', pof,
    'pof_adressen', pof_aantal
  );
end
$$;
