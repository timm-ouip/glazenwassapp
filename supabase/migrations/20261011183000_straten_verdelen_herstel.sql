-- Drie reparaties op de twee vorige migraties.
--
-- 1. `geldloop_lopers_naam` keek niet naar het bedrijf. Wie een medewerker-id
--    van een ander bedrijf kende, kreeg daar de naam van terug.
-- 2. Een beurt die als "niet gewassen" is gemeld telde mee als "wacht nog op
--    een wasbeurt". Daardoor verdween het adres uit de looplijst op het
--    moment dat de geldloper die knop indrukte: hij kon oude pof niet meer
--    ophalen terwijl hij er stond, en zijn eigen tik niet meer terugdraaien.
--    Alleen een beurt die nog gedaan moet worden laat een adres wachten.
-- 3. De markering bleef op de regel plakken als je hem verplaatste. De beurt
--    stond dan volgende week nog rood en het geld bleef vervallen. Bij een
--    andere dag hoort de markering eraf: dat is een nieuwe kans.

-- ---------------------------------------------------------------------
-- 1. Namen alleen binnen het eigen bedrijf
-- ---------------------------------------------------------------------
create or replace function public.geldloop_lopers_naam(lopers uuid[])
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(string_agg(coalesce(nullif(e.naam, ''), e.email), ', ' order by e.naam), '')
  from public.employees e
  where e.id = any (coalesce(lopers, '{}'))
    and e.company_id = public.current_company_id()
$$;
revoke execute on function public.geldloop_lopers_naam(uuid[]) from public, anon;
grant execute on function public.geldloop_lopers_naam(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Een gemelde "niet gewassen" laat het adres niet wachten
-- ---------------------------------------------------------------------
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
        st.open, st.open_wassen, st.delen,
        (select coalesce(array_agg(sl.employee_id order by sl.employee_id), '{}')
           from public.geldloop_straat_lopers sl
          where sl.vrijgave_id = v.id and sl.street_id = s.id) as lopers,
        -- Staat er deze maand nog een beurt te doen? Dan is dit adres nog niet
        -- aan de beurt om op te halen. Een beurt die als niet gewassen is
        -- gemeld telt hier niet mee: die is afgehandeld, en de geldloper moet
        -- er wél kunnen blijven staan voor de pof van eerder.
        exists (select 1 from public.wasdag_regels wr
                 where wr.customer_id = c.id and wr.company_id = bedrijf
                   and date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                   and wr.gedaan_op is null
                   and wr.niet_gewassen_op is null) as wacht,
        (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                   'door', g.door, 'door_naam', g.door_naam)
           from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.vrijgave_id = v.id
            and g.soort in ('betaald', 'niet_thuis', 'geen_geld')
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
                      'totaal', coalesce(sum(g.bedrag), 0))
                    from public.betaal_gebeurtenissen g
                    where g.vrijgave_id = v.id and g.soort = 'betaald'
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

-- ---------------------------------------------------------------------
-- 3. Naar een andere dag = een nieuwe kans
-- ---------------------------------------------------------------------
create or replace function public.wasdag_niet_gewassen_wissen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.datum is distinct from old.datum then
    new.niet_gewassen_op := null;
    new.niet_gewassen_door := null;
    new.niet_gewassen_naam := null;
  end if;
  return new;
end
$$;

create trigger wasdag_regels_niet_gewassen_wissen
  before update on public.wasdag_regels
  for each row execute function public.wasdag_niet_gewassen_wissen();

-- ---------------------------------------------------------------------
-- 4. Dezelfde bewaker op company_id als op de andere tabellen
-- ---------------------------------------------------------------------
create trigger geldloop_straat_lopers_set_company_id
  before insert on public.geldloop_straat_lopers
  for each row execute function public.set_company_id();

create trigger geldloop_straat_wijzigingen_set_company_id
  before insert on public.geldloop_straat_wijzigingen
  for each row execute function public.set_company_id();
