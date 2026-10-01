-- vooruit_vast ook in de looplijst en bij de wasser overdag.
--
-- vooruit_over telt ook de beurten die niet meer opgemaakt worden (van een
-- vorige bewoner, of van een gestopt adres). Zonder vooruit_vast erbij kon
-- de telefoon dat verschil niet zien: bij een nieuwe bewoner stond er dan
-- "nog 3 vooruit" aan de deur, en de vaste-kortingknoppen verdwenen. Verder
-- gelijk aan de versies uit 20261016090000_vooruit_betalen.sql.

-- (was: 20261016090000_vooruit_betalen.sql)
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

  select array_agg(c.id) into ids
    from public.customers c
    join public.streets s on s.id = c.street_id
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null;

  return (
    with basis as (
      select
        c.id, c.house_number, c.addition, c.sort_order, c.hoek_kant, c.note,
        c.interval_maanden, c.ritme, c.inactief_op, c.betaalmethode, c.klant_id,
        s.id as straat_id, s.name as straat, s.sort_order as straat_sort,
        s.sort_desc, s.doorlopend,
        d.id as wijk_id, d.name as wijk, d.sort_order as wijk_sort, d.betaalmethode as wijk_methode,
        k.naam as klantnaam,
        st.open, st.open_wassen, st.delen, st.vooruit_over, st.vooruit_waarde, st.vooruit_vast,
        public.vooruit_prijs(c.id) as vooruit_p,
        (select coalesce(array_agg(sl.employee_id order by sl.employee_id), '{}')
           from public.geldloop_straat_lopers sl
          where sl.vrijgave_id = v.id and sl.street_id = s.id) as lopers,
        -- Staat er deze maand nog een beurt te doen? Dan is dit adres nog niet
        -- aan de beurt om op te halen. Een beurt die als niet gewassen is
        -- gemeld telt hier niet mee: die is afgehandeld, en de geldloper moet
        -- er wél kunnen blijven staan voor de pof van eerder.
        exists (select 1 from public.wasdag_regels wr
                 where wr.customer_id = c.id and wr.company_id = bedrijf
                   and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
                   and wr.gedaan_op is null
                   and wr.niet_gewassen_op is null) as wacht,
        (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                   'door', g.door, 'door_naam', g.door_naam, 'aantal', g.aantal)
           from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.vrijgave_id = v.id
            and g.soort in ('betaald', 'vooruit', 'niet_thuis', 'geen_geld')
            and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
          order by g.op desc limit 1) as vanavond
      from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
      join public.customers c on c.id = st.customer_id
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
      where c.inactief_op is null or st.open <> 0
    ),
    geteld as (
      select
        (b.vanavond is not null) as gedaan,
        (b.open > 0.005 and b.vanavond is null and not b.wacht) as nog_open,
        (coalesce(cardinality(b.lopers), 0) = 0 or auth.uid() = any (b.lopers)) as van_mij,
        b.straat_id
      from basis b
    )
    select jsonb_build_object(
      'vrijgave', jsonb_build_object('id', v.id, 'datum', v.datum, 'begin_op', v.begin_op,
                                     'eind_op', v.eind_op, 'ingetrokken', v.ingetrokken_op is not null),
      'adressen', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'wijk_id', b.wijk_id, 'wijk', b.wijk, 'wijk_sort', b.wijk_sort,
          'straat_id', b.straat_id, 'straat', b.straat, 'straat_sort', b.straat_sort,
          'sort_desc', b.sort_desc, 'doorlopend', b.doorlopend,
          'house_number', b.house_number, 'addition', coalesce(b.addition, ''),
          'sort_order', b.sort_order, 'hoek_kant', coalesce(b.hoek_kant, ''),
          'naam', coalesce(b.klantnaam, ''),
          'note', coalesce(b.note, ''),
          'interval_maanden', b.interval_maanden, 'ritme', b.ritme,
          'methode', coalesce(b.betaalmethode, b.wijk_methode),
          'gestopt', b.inactief_op is not null,
          'wacht_op_wasbeurt', b.wacht,
          'open', b.open, 'open_wassen', b.open_wassen, 'delen', b.delen,
          'vooruit_over', b.vooruit_over, 'vooruit_waarde', b.vooruit_waarde, 'vooruit_vast', b.vooruit_vast,
          'vooruit_p', b.vooruit_p,
          'straat_lopers', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                            from public.employees e where e.id = any (b.lopers)),
          'klachten', (select coalesce(jsonb_agg(kl.omschrijving order by kl.ontvangen_op desc), '[]')
                       from public.klachten kl
                       where kl.deleted_at is null and kl.status = 'open'
                         and ((kl.customer_id = b.id and kl.klant_id is not distinct from b.klant_id)
                              or (kl.customer_id is null and kl.klant_id = b.klant_id))),
          'vaste_kortingen', (select coalesce(jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag)
                                                        order by vk.gemaakt_op), '[]')
                              from public.vaste_kortingen vk where vk.customer_id = b.id and vk.deleted_at is null),
          'kortingen_vanavond', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id', g.id, 'bedrag', g.bedrag, 'reden', g.reden,
                                     'door', g.door, 'door_naam', g.door_naam, 'op', g.op) order by g.op), '[]')
                                 from public.betaal_gebeurtenissen g
                                 where g.customer_id = b.id and g.vrijgave_id = v.id and g.soort = 'korting'
                                   and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
          'vanavond', b.vanavond
        ))
        from basis b
      ), '[]'::jsonb),
      'opgehaald', (select jsonb_build_object(
                      'mij', coalesce(sum(g.bedrag) filter (where g.door = auth.uid()), 0),
                      'mij_aantal', count(*) filter (where g.door = auth.uid()),
                      -- Wat het team samen ophaalde is voor de eigenaar; een
                      -- loper ziet alleen zijn eigen tas. Het weglaten aan deze
                      -- kant scheelt dat het meereist naar een telefoon die het
                      -- niet hoort te weten.
                      'totaal', case when public.is_eigenaar()
                                     then coalesce(sum(g.bedrag), 0) else 0 end)
                    from public.betaal_gebeurtenissen g
                    where g.vrijgave_id = v.id and g.soort in ('betaald', 'vooruit')
                      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id))
                   || (select jsonb_build_object(
                        'mijn_open', count(*) filter (where t.nog_open and t.van_mij),
                        'mijn_gedaan', count(*) filter (where t.gedaan and t.van_mij),
                        'mijn_straten_open', count(distinct t.straat_id) filter (where t.nog_open and t.van_mij),
                        'samen_open', count(*) filter (where t.nog_open),
                        'samen_gedaan', count(*) filter (where t.gedaan),
                        'samen_straten_open', count(distinct t.straat_id) filter (where t.nog_open))
                      from geteld t)
    )
  );
end
$$;

revoke execute on function public.geldloop_lijst(uuid) from public, anon;
grant execute on function public.geldloop_lijst(uuid) to authenticated;

-- (was: 20261016090000_vooruit_betalen.sql)
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
  vandaag_normaal numeric;
  gedekt boolean;
  erbij numeric;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.dag_geld_toegang(adres_id) then
    return null;
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres_id]);
  select wp.prijs, coalesce(nullif(wp.normaal, 0), wp.prijs) into vandaag_prijs, vandaag_normaal
    from public.wasdag_regels r join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.customer_id = adres_id and r.datum = vandaag and r.gedaan_op is null
      -- Alleen als hij straks ook echt meetelt (na de start van de wijk).
      and exists (select 1 from public.contant_periodes p
                  where p.customer_id = adres_id and vandaag >= p.vanaf and (p.tot is null or vandaag <= p.tot));
  gedekt := coalesce(vandaag_prijs, 0) > 0 and st.vooruit_over - st.vooruit_vast > 0;
  erbij := case when gedekt then greatest(0, vandaag_prijs - vandaag_normaal) else coalesce(vandaag_prijs, 0) end;
  return jsonb_build_object(
    'open', st.open + erbij,
    'open_wassen', st.open_wassen + case when coalesce(vandaag_prijs, 0) > 0 and not gedekt then 1 else 0 end,
    'delen', st.delen || case when erbij > 0
                              then jsonb_build_array(jsonb_build_object(
                                'soort', 'wassen', 'datum', vandaag, 'bedrag', vandaag_prijs,
                                'rest', erbij, 'aantal', 1, 'omschrijving', '',
                                'vooruit', vandaag_prijs - erbij))
                              else '[]'::jsonb end,
    'vooruit_over', st.vooruit_over,
    'vooruit_vast', st.vooruit_vast,
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
