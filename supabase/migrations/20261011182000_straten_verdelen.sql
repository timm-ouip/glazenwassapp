-- Straten verdelen per geldloper.
--
-- Bij het vrijgeven kan de eigenaar zeggen wie welke straat loopt, en tijdens
-- de avond mogen de lopers het onderling omgooien: loopt de een achter, dan
-- neemt de ander een straat over. Staat een straat bij niemand, dan is hij van
-- iedereen die die avond loopt — precies zoals het vóór deze migratie ging.
--
-- Meerdere lopers op één straat mag: samen een straat doen is normaal. Dubbel
-- afrekenen kan niet, want een tik verschijnt live bij de ander in de lijst.

-- ---------------------------------------------------------------------
-- 1. Wie welke straat loopt
-- ---------------------------------------------------------------------
create table public.geldloop_straat_lopers (
  vrijgave_id uuid not null,
  street_id uuid not null references public.streets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (vrijgave_id, street_id, employee_id),
  foreign key (vrijgave_id, company_id) references public.geldloop_vrijgaven (id, company_id) on delete cascade
);
create index geldloop_straat_lopers_loper on public.geldloop_straat_lopers (employee_id);

alter table public.geldloop_straat_lopers enable row level security;
revoke all on public.geldloop_straat_lopers from anon;
-- Lezen mag iedereen van het bedrijf die de avond ziet; schrijven kan alleen
-- via geldloop_straat_verdelen, dat zelf controleert of je erbij hoort.
create policy "Straatverdeling lezen" on public.geldloop_straat_lopers
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or public.geldloop_loopt_voor_mij(vrijgave_id)
    )
  );

-- Het logboek van de verdeling: wie zette welke straat bij wie, en wat stond
-- er daarvoor. De eigenaar ziet het terug in het avondoverzicht en kan het met
-- één knop terugzetten.
create table public.geldloop_straat_wijzigingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vrijgave_id uuid not null,
  street_id uuid not null references public.streets(id) on delete cascade,
  straat text not null default '',
  voor uuid[] not null default '{}',
  na uuid[] not null default '{}',
  voor_naam text not null default '',
  na_naam text not null default '',
  door uuid default auth.uid(),
  door_naam text not null default '',
  op timestamptz not null default now(),
  teruggedraaid_op timestamptz,
  teruggedraaid_door uuid,
  teruggedraaid_naam text,
  foreign key (vrijgave_id, company_id) references public.geldloop_vrijgaven (id, company_id) on delete cascade
);
create index geldloop_straat_wijzigingen_bedrijf on public.geldloop_straat_wijzigingen (company_id, op);

alter table public.geldloop_straat_wijzigingen enable row level security;
revoke all on public.geldloop_straat_wijzigingen from anon;
create policy "Straatwijzigingen lezen" on public.geldloop_straat_wijzigingen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('prijzen_zien'))
      or public.geldloop_loopt_voor_mij(vrijgave_id)
    )
  );

-- ---------------------------------------------------------------------
-- 2. De namen van een stel lopers, op een rij
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
$$;
revoke execute on function public.geldloop_lopers_naam(uuid[]) from public, anon;
grant execute on function public.geldloop_lopers_naam(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Een straat bij iemand neerleggen
-- ---------------------------------------------------------------------
-- Een lege lijst lopers zet de straat terug op "van iedereen".
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
  -- De eigenaar mag altijd; een loper zolang zijn avond loopt.
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

  -- Dubbele namen eruit, en alleen wie die avond echt loopt.
  select array_agg(distinct l) into wordt from unnest(coalesce(lopers, '{}')) l;
  wordt := coalesce(wordt, '{}');
  select string_agg(coalesce(nullif(e.naam, ''), e.email), ', ') into fout
    from public.employees e
    where e.id = any (wordt)
      and not exists (select 1 from public.geldloop_vrijgave_lopers gl
                      where gl.vrijgave_id = v.id and gl.employee_id = e.id);
  if fout is not null then
    raise exception '% loopt deze avond niet mee.', fout;
  end if;
  if (select count(*) from public.employees e where e.id = any (wordt) and e.company_id = bedrijf)
     <> coalesce(cardinality(wordt), 0) then
    raise exception 'Die medewerker bestaat niet.';
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into was
    from public.geldloop_straat_lopers
    where vrijgave_id = v.id and street_id = straat;

  delete from public.geldloop_straat_lopers where vrijgave_id = v.id and street_id = straat;
  insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
    select v.id, straat, l, bedrijf from unnest(wordt) l;

  -- Niets veranderd: geen regel in het logboek, anders staat het overzicht zo
  -- vol met "Kerkstraat → Sanne" dat je de echte wijzigingen niet meer ziet.
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
-- 4. Eerlijk verdelen: elke loper ongeveer evenveel adressen
-- ---------------------------------------------------------------------
-- De grootste straat gaat naar wie tot nu toe het minst heeft. Zo blijven
-- straten heel (je loopt niet een halve straat) en eindigt iedereen met
-- ongeveer evenveel deuren.
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
  last_uit uuid;
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
    select m into last_uit from unnest(mensen) m
      order by (tellers ->> m::text)::integer, m limit 1;
    perform public.geldloop_straat_verdelen(v.id, r.id, array[last_uit]);
    tellers := jsonb_set(tellers, array[last_uit::text],
                         to_jsonb((tellers ->> last_uit::text)::integer + r.adressen::integer));
    verdeeld := verdeeld + 1;
  end loop;

  return jsonb_build_object('straten', verdeeld, 'lopers', coalesce(cardinality(mensen), 0));
end
$$;
revoke execute on function public.geldloop_straten_eerlijk(uuid) from public, anon;
grant execute on function public.geldloop_straten_eerlijk(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Een verdeling terugdraaien
-- ---------------------------------------------------------------------
create or replace function public.geldloop_straat_wijziging_terugdraaien(wijziging uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  w public.geldloop_straat_wijzigingen;
  nu uuid[];
begin
  select * into w from public.geldloop_straat_wijzigingen
    where id = wijziging and company_id = bedrijf for update;
  if not found then
    raise exception 'Die wijziging bestaat niet.';
  end if;
  if w.teruggedraaid_op is not null then
    raise exception 'Deze wijziging is al teruggedraaid.';
  end if;
  if not public.is_eigenaar() and not (w.door = auth.uid() and public.geldloop_loopt_voor_mij(w.vrijgave_id)) then
    raise exception 'Na de eindtijd kan alleen de eigenaar dit nog terugdraaien.';
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into nu
    from public.geldloop_straat_lopers
    where vrijgave_id = w.vrijgave_id and street_id = w.street_id;
  if nu is distinct from (select coalesce(array_agg(l order by l), '{}') from unnest(w.na) l) then
    raise exception 'Deze straat is intussen opnieuw verdeeld; zet hem met de hand goed.';
  end if;

  delete from public.geldloop_straat_lopers
    where vrijgave_id = w.vrijgave_id and street_id = w.street_id;
  insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
    select w.vrijgave_id, w.street_id, l, bedrijf from unnest(w.voor) l;

  update public.geldloop_straat_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(),
        teruggedraaid_naam = public.geld_mijn_naam()
    where id = w.id;
end
$$;
revoke execute on function public.geldloop_straat_wijziging_terugdraaien(uuid) from public, anon;
grant execute on function public.geldloop_straat_wijziging_terugdraaien(uuid) to authenticated;

-- Wat er op een dag aan de verdeling veranderde, voor het avondoverzicht.
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
  if bedrijf is null then
    return '[]'::jsonb;
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
-- 6. De lijst van een avond, nu met de verdeling en de aantallen erbij
-- ---------------------------------------------------------------------
-- Nieuw ten opzichte van geldlopen_herstel:
--   * per adres `straat_lopers`: wie die straat loopt (leeg = iedereen);
--   * per adres `wacht_op_wasbeurt`: er staat deze maand nog een wasbeurt
--     open die nog niet gedaan is (of die als niet gewassen is teruggemeld).
--     Daar hoef je nog niet aan te bellen — je haalt geld op nadat er
--     gewassen is — dus die adressen laat het loopscherm weg;
--   * in `opgehaald` de aantallen waar het startscherm van de geldloper op
--     draait. "Gedaan" is elk adres waar vanavond iets is ingetikt — ook niet
--     thuis of geen geld; "open" is een adres waar nog geld staat en nog
--     niets is ingetikt. Adressen zonder openstaand bedrag tellen niet mee,
--     want daar hoef je niet aan te bellen.
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
        -- Staat er deze maand nog een beurt te wachten? Dan is dit adres nog
        -- niet aan de beurt om op te halen.
        exists (select 1 from public.wasdag_regels wr
                 where wr.customer_id = c.id and wr.company_id = bedrijf
                   and date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                   and (wr.gedaan_op is null or wr.niet_gewassen_op is not null)) as wacht,
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
      -- Per adres: telt hij mee, en is hij al gedaan? "Van mij" is een straat
      -- waar ik bij sta, plus elke straat die van niemand is.
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
