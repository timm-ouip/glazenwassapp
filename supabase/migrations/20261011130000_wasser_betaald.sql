-- Betalingen, fase 7: de wasser tikt overdag "Betaald".
--
-- Krijgt een wasser geld aan de deur, dan tikt hij op de dagplanning bij dat
-- adres "Betaald". Dat kan alleen bij een contant adres dat vandaag op de
-- route staat, en alleen vandaag. Hij ziet dan het bedrag van alleen dat
-- adres (ook zonder "prijzen zien"): wat er open staat plus de wasbeurt van
-- vandaag, die meestal nog niet is afgemeld.

-- Staat dit adres vandaag op de route, betaalt het contant, en mag ik plannen?
create or replace function public.dag_geld_toegang(adres_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.heeft_recht('planning')
    and exists (
      select 1 from public.wasdag_regels r
      where r.customer_id = adres_id and r.company_id = public.current_company_id()
        and r.datum = (now() at time zone 'Europe/Amsterdam')::date
    )
    and exists (
      select 1 from public.customers c
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      where c.id = adres_id and coalesce(c.betaalmethode, d.betaalmethode) = 'contant'
        and d.geld_peildatum is not null
    )
$$;
revoke execute on function public.dag_geld_toegang(uuid) from public, anon, authenticated;

-- Wat de wasser bij dit adres ziet: de open posten, met de wasbeurt van
-- vandaag erbij als die nog niet is afgemeld (hij staat er nu, dus hij is
-- gedaan). Null als het adres hier niet voor in aanmerking komt.
create or replace function public.dag_geld_stand(adres_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  st record;
  vandaag_prijs numeric;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.dag_geld_toegang(adres_id) then
    return null;
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres_id]);
  select wp.prijs into vandaag_prijs
    from public.wasdag_regels r join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.customer_id = adres_id and r.datum = vandaag and r.gedaan_op is null;
  return jsonb_build_object(
    'open', st.open + coalesce(vandaag_prijs, 0),
    'open_wassen', st.open_wassen + case when coalesce(vandaag_prijs, 0) > 0 then 1 else 0 end,
    'delen', st.delen || case when coalesce(vandaag_prijs, 0) > 0
                              then jsonb_build_array(jsonb_build_object(
                                'soort', 'wassen', 'datum', vandaag, 'bedrag', vandaag_prijs,
                                'rest', vandaag_prijs, 'aantal', 1, 'omschrijving', ''))
                              else '[]'::jsonb end,
    'vandaag', (select jsonb_build_object('id', g.id, 'bedrag', g.bedrag, 'door', g.door,
                                          'door_naam', g.door_naam, 'op', g.op)
                from public.betaal_gebeurtenissen g
                where g.customer_id = adres_id and g.bron = 'dag' and g.soort = 'betaald'
                  and (g.op at time zone 'Europe/Amsterdam')::date = vandaag
                  and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                order by g.op desc limit 1)
  );
end
$$;
revoke execute on function public.dag_geld_stand(uuid) from public, anon;
grant execute on function public.dag_geld_stand(uuid) to authenticated;

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
         and now() < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id))
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
