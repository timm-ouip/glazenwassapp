-- Betalingen, fase 4: de overzichten voor de eigenaar.
--
-- Het avondoverzicht (wie wat ophaalde), de pof-lijst (wie er nog moet
-- betalen), de kaartweergave (per straat een jaar, zoals de papieren kaart)
-- en het geld in het dossier. Alleen lezen, voor wie prijzen mag zien.

-- ---------------------------------------------------------------------
-- 1. Welke betaling een post afmaakte
--
-- Zelfde rekensom als geld_posten, maar per post ook de betaling (of korting)
-- die hem als laatste dekte: daaraan ziet de kaart in welke maand een
-- wasbeurt betaald werd, en door wie.
-- ---------------------------------------------------------------------
create or replace function public.geld_posten_betaald(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  ref uuid,
  gedekt numeric,
  betaald_met uuid,
  betaald_soort text,
  betaald_op timestamptz,
  betaald_door text
)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select x.*,
      sum(x.bedrag) over w - x.bedrag as ervoor,
      sum(x.bedrag) over w as tot
    from public.geld_schuld(bedrijf, adressen) x
    window w as (partition by x.customer_id order by x.datum, x.volg, x.ref
                 rows between unbounded preceding and current row)
  ),
  k as (
    select y.*,
      sum(y.bedrag) over w - y.bedrag as k_van,
      sum(y.bedrag) over w as k_tot
    from public.geld_krediet(bedrijf, adressen) y
    window w as (partition by y.customer_id order by y.op, y.id
                 rows between unbounded preceding and current row)
  ),
  totaal as (
    select k.customer_id, max(k.k_tot) as som from k group by k.customer_id
  )
  select s.customer_id, s.soort, s.datum, s.bedrag, s.aantal, s.omschrijving, s.ref,
    greatest(0, least(s.bedrag, coalesce(t.som, 0) - s.ervoor)),
    b.id, b.soort, b.op, b.door_naam
  from s
  left join totaal t on t.customer_id = s.customer_id
  left join lateral (
    select k.id, k.soort, k.op, k.door_naam from k
    where k.customer_id = s.customer_id and k.k_van < s.tot and k.k_tot >= s.tot - 0.005
    order by k.k_tot limit 1
  ) b on true
$$;
revoke execute on function public.geld_posten_betaald(uuid, uuid[]) from public, anon, authenticated;

-- Eén gebeurtenis als jsonb, met wie hem terugdraaide.
create or replace function public.geld_gebeurtenis_json(g public.betaal_gebeurtenissen)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', g.id, 'customer_id', g.customer_id, 'adres', g.adres, 'soort', g.soort,
    'bedrag', g.bedrag, 'reden', g.reden, 'aantal', g.aantal,
    'maanden', coalesce(to_jsonb(g.maanden), '[]'::jsonb),
    'bron', g.bron, 'door', g.door, 'door_naam', g.door_naam, 'op', g.op, 'vrijgave_id', g.vrijgave_id,
    'botsing_met', g.botsing_met,
    -- Kwam hij pas veel later binnen dan hij getikt werd (geen bereik)?
    'later_binnen', g.ontvangen_op > g.op + interval '10 minutes',
    'ongedaan', (select jsonb_build_object('id', o.id, 'door_naam', o.door_naam, 'op', o.op)
                 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  )
$$;
revoke execute on function public.geld_gebeurtenis_json(public.betaal_gebeurtenissen) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Het avondoverzicht
-- ---------------------------------------------------------------------
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
    from public.customers c join public.streets s on s.id = c.street_id
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

-- ---------------------------------------------------------------------
-- 3. De pof-lijst
-- ---------------------------------------------------------------------
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
    from public.customers c join public.streets s on s.id = c.street_id
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

-- ---------------------------------------------------------------------
-- 4. De kaart: per straat een jaar
-- ---------------------------------------------------------------------
create or replace function public.geld_kaart(straat uuid, jaar int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  adressen uuid[];
  tot timestamptz := (make_date(jaar + 1, 1, 1)::timestamp) at time zone 'Europe/Amsterdam';
  wijk record;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  select d.id, d.name, d.geld_peildatum, d.betaalmethode into wijk
    from public.streets s join public.districts d on d.id = s.district_id
    where s.id = straat and s.company_id = bedrijf;
  if not found then
    raise exception 'Die straat bestaat niet.';
  end if;
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c where c.street_id = straat and c.company_id = bedrijf and c.deleted_at is null;

  return jsonb_build_object(
    'wijk', jsonb_build_object('id', wijk.id, 'naam', wijk.name, 'peildatum', wijk.geld_peildatum,
                               'betaalmethode', wijk.betaalmethode),
    'adressen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'posten', coalesce((
          select jsonb_agg(jsonb_build_object(
            'soort', p.soort, 'datum', p.datum, 'bedrag', p.bedrag, 'aantal', p.aantal,
            'omschrijving', p.omschrijving, 'gedekt', p.gedekt,
            'betaald_soort', p.betaald_soort, 'betaald_op', p.betaald_op, 'betaald_door', p.betaald_door
          ) order by p.datum)
          from public.geld_posten_betaald(bedrijf, array[c.id]) p
        ), '[]'::jsonb),
        'gebeurtenissen', coalesce((
          select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op)
          from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.soort <> 'ongedaan' and g.op < tot
        ), '[]'::jsonb)
      ) order by c.sort_order, c.house_number)
      from public.customers c where c.id = any (adressen)
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------
-- 5. Het geld van één adres (dossier)
-- ---------------------------------------------------------------------
create or replace function public.geld_adres(adres uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  st record;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres]);
  return jsonb_build_object(
    'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
    'gebeurtenissen', coalesce((
      select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op desc)
      from public.betaal_gebeurtenissen g
      where g.customer_id = adres and g.company_id = bedrijf and g.soort <> 'ongedaan'
    ), '[]'::jsonb),
    'vaste_kortingen', coalesce((
      select jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag,
                                          'door_naam', vk.gemaakt_naam, 'op', vk.gemaakt_op)
                       order by vk.gemaakt_op)
      from public.vaste_kortingen vk where vk.customer_id = adres and vk.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.geld_avond(date) from public, anon;
grant execute on function public.geld_avond(date) to authenticated;
revoke execute on function public.geld_pof(uuid[]) from public, anon;
grant execute on function public.geld_pof(uuid[]) to authenticated;
revoke execute on function public.geld_kaart(uuid, int) from public, anon;
grant execute on function public.geld_kaart(uuid, int) to authenticated;
revoke execute on function public.geld_adres(uuid) from public, anon;
grant execute on function public.geld_adres(uuid) to authenticated;
