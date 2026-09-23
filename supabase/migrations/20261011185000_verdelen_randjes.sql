-- Nog vijf scherpe randjes van het verdelen.
--
-- 1. Een melding "niet gewassen" bleef in de rode strook staan nadat je de
--    beurt had verplaatst. De markering was er dan al af, dus "Toch gewassen"
--    gaf een foutmelding. De strook kijkt nu of de markering er nog echt op
--    staat.
-- 2. Bij het verdelen werd wel gecontroleerd of iemand die avond meeloopt,
--    maar niet of hij van dit bedrijf is. Een onbekend id leverde de naam van
--    een medewerker van een ander bedrijf op in de foutmelding.
-- 3. Het teamtotaal ging naar iedereen die de lijst ophaalde, ook al liet het
--    scherm het alleen aan de eigenaar zien.
-- 4. "Eerlijk verdelen" schreef per straat een regel in het logboek. Bij
--    dertig straten verdronken de echte wijzigingen van de lopers daarin. Het
--    is een knop van de eigenaar in zijn eigen venster; die hoeft niet in het
--    logboek. Dat blijft voor wat er 's avonds verandert.
-- 5. Het lijstje met straatwijzigingen keek alleen naar het bedrijf, niet
--    naar rechten: ook een wasser kon opvragen wie welke straat liep.

-- ---------------------------------------------------------------------
-- 1. De strook op de dag volgt de markering
-- ---------------------------------------------------------------------
create or replace function public.geldloop_vergeten(vanaf date, tot date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not (
    public.heeft_recht('planning') or public.heeft_recht('prijzen_zien')
    or public.heeft_recht('klanten_bekijken')
  ) then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'customer_id', w.customer_id, 'adres', w.adres,
      'datum', w.voor ->> 'datum', 'door_naam', w.door_naam, 'op', w.op
    ) order by w.voor ->> 'datum', w.adres)
    from public.geldloop_wijzigingen w
    where w.company_id = bedrijf
      and w.soort = 'niet_gewassen'
      and w.teruggedraaid_op is null
      and (w.voor ->> 'datum')::date between vanaf and tot
      -- Staat de markering er niet meer op — verplaatst naar een andere dag,
      -- of met de hand weggehaald — dan is er niets meer te melden. Oude
      -- meldingen, van toen de beurt nog helemaal werd weggehaald, blijven
      -- staan: daar is de wasbeurt zelf verdwenen.
      and (
        not coalesce((w.voor ->> 'gemarkeerd')::boolean, false)
        or exists (select 1 from public.wasdag_regels r
                    where r.id = (w.voor ->> 'id')::uuid and r.niet_gewassen_op is not null)
      )
  ), '[]'::jsonb);
end
$fn$;
revoke execute on function public.geldloop_vergeten(date, date) from public, anon;
grant execute on function public.geldloop_vergeten(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Alleen medewerkers van dit bedrijf
-- ---------------------------------------------------------------------
create or replace function public.geldloop_straat_verdelen(vrijgave uuid, straat uuid, lopers uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  straatnaam text;
  was uuid[];
  wordt uuid[];
  fout text;
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not public.geldloop_loopt_voor_mij(vrijgave) then
    raise exception 'Je loopt deze avond niet, dus je kunt de straten niet verdelen.';
  end if;

  select s.name into straatnaam
    from public.streets s
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where s.id = straat and s.company_id = bedrijf and s.deleted_at is null;
  if straatnaam is null then
    raise exception 'Die straat hoort niet bij deze avond.';
  end if;

  select array_agg(distinct l) into wordt from unnest(coalesce(lopers, '{}')) l;
  wordt := coalesce(wordt, '{}');
  -- Eerst of ze bestaan en van dit bedrijf zijn; pas daarna of ze meelopen,
  -- anders lekt een onbekend id de naam van een vreemde medewerker.
  if (select count(*) from public.employees e where e.id = any (wordt) and e.company_id = bedrijf)
     <> coalesce(cardinality(wordt), 0) then
    raise exception 'Die medewerker bestaat niet.';
  end if;
  select string_agg(coalesce(nullif(e.naam, ''), e.email), ', ') into fout
    from public.employees e
    where e.id = any (wordt) and e.company_id = bedrijf
      and not exists (select 1 from public.geldloop_vrijgave_lopers gl
                      where gl.vrijgave_id = v.id and gl.employee_id = e.id);
  if fout is not null then
    raise exception '% loopt deze avond niet mee.', fout;
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into was
    from public.geldloop_straat_lopers
    where vrijgave_id = v.id and street_id = straat;

  delete from public.geldloop_straat_lopers where vrijgave_id = v.id and street_id = straat;
  insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
    select v.id, straat, l, bedrijf from unnest(wordt) l;

  if was is distinct from (select coalesce(array_agg(l order by l), '{}') from unnest(wordt) l) then
    insert into public.geldloop_straat_wijzigingen
      (company_id, vrijgave_id, street_id, straat, voor, na, voor_naam, na_naam, door, door_naam)
      values (bedrijf, v.id, straat, straatnaam, was, wordt,
              public.geldloop_lopers_naam(was), public.geldloop_lopers_naam(wordt),
              auth.uid(), public.geld_mijn_naam());
  end if;

  return jsonb_build_object('straat', straat, 'lopers', wordt);
end
$$;
revoke execute on function public.geldloop_straat_verdelen(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.geldloop_straat_verdelen(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Eerlijk verdelen schrijft zelf, en niet in het logboek
-- ---------------------------------------------------------------------
create or replace function public.geldloop_straten_eerlijk(vrijgave uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  mensen uuid[];
  minste uuid;
  r record;
  tellers jsonb := '{}'::jsonb;
  verdeeld integer := 0;
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not public.geldloop_loopt_voor_mij(vrijgave) then
    raise exception 'Je loopt deze avond niet, dus je kunt de straten niet verdelen.';
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into mensen
    from public.geldloop_vrijgave_lopers where vrijgave_id = v.id;
  if coalesce(cardinality(mensen), 0) < 2 then
    raise exception 'Er loopt maar één iemand: er valt niets te verdelen.';
  end if;
  select jsonb_object_agg(m, 0) into tellers from unnest(mensen) m;

  -- In één keer schoon: alles opnieuw verdelen, zonder dertig regels in het
  -- logboek. Dat logboek is voor wat er 's avonds verandert.
  delete from public.geldloop_straat_lopers sl
    using public.streets s, public.geldloop_vrijgave_wijken w
    where sl.vrijgave_id = v.id and s.id = sl.street_id
      and w.vrijgave_id = v.id and w.district_id = s.district_id;

  for r in
    select s.id, count(c.id) as adressen
      from public.streets s
      join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
      left join public.customers c on c.street_id = s.id and c.company_id = bedrijf
        and c.deleted_at is null and c.inactief_op is null
      where s.company_id = bedrijf and s.deleted_at is null
      group by s.id
      order by count(c.id) desc, s.sort_order, s.name
  loop
    -- De grootste straat naar wie tot nu toe het minst heeft.
    select m into minste from unnest(mensen) m
      order by (tellers ->> m::text)::integer, m limit 1;
    insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
      values (v.id, r.id, minste, bedrijf);
    tellers := jsonb_set(tellers, array[minste::text],
                         to_jsonb((tellers ->> minste::text)::integer + r.adressen::integer));
    verdeeld := verdeeld + 1;
  end loop;

  return jsonb_build_object('straten', verdeeld, 'lopers', coalesce(cardinality(mensen), 0));
end
$$;
revoke execute on function public.geldloop_straten_eerlijk(uuid) from public, anon;
grant execute on function public.geldloop_straten_eerlijk(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Het lijstje met straatwijzigingen vraagt om rechten
-- ---------------------------------------------------------------------
create or replace function public.geldloop_straat_wijzigingen_van(datum date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not (
    public.heeft_recht('prijzen_zien') or public.heeft_recht('geldlopen')
  ) then
    raise exception 'Je mag dit niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'straat', w.straat,
      'voor_naam', w.voor_naam, 'na_naam', w.na_naam,
      'door', w.door, 'door_naam', w.door_naam, 'op', w.op,
      'teruggedraaid_op', w.teruggedraaid_op, 'teruggedraaid_naam', w.teruggedraaid_naam
    ) order by w.op)
    from public.geldloop_straat_wijzigingen w
    join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
    where w.company_id = bedrijf and v.datum = datum
  ), '[]'::jsonb);
end
$$;
revoke execute on function public.geldloop_straat_wijzigingen_van(date) from public, anon;
grant execute on function public.geldloop_straat_wijzigingen_van(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Het teamtotaal blijft bij de eigenaar
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
                      -- Wat het team samen ophaalde is voor de eigenaar; een
                      -- loper ziet alleen zijn eigen tas. Het weglaten aan deze
                      -- kant scheelt dat het meereist naar een telefoon die het
                      -- niet hoort te weten.
                      'totaal', case when public.is_eigenaar()
                                     then coalesce(sum(g.bedrag), 0) else 0 end)
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
