-- Een beurt hoort bij een ronde, niet per se bij de maand van zijn datum.
--
-- Loopt de septemberronde uit tot 1 oktober, dan is wat je op 1 oktober doet
-- nog de septemberbeurt: met de prijs en het extra werk van september, in het
-- septembervakje van de geldkaart, en in oktober weer gewoon aan de beurt.
-- Standaard is de ronde de maand van de datum; de wijkpagina zet hem anders
-- als je met de maandknop op de vorige (of volgende) maand plant.
--
-- Wat NIET verandert: omzet en btw tellen op de echte datum, en een factuur
-- ook. Die zegt er dan wel bij dat het de septemberbeurt was.

-- ---------------------------------------------------------------------
-- 1. De kolom, gevuld voor alles wat er al staat
-- ---------------------------------------------------------------------
alter table public.wasdag_regels add column if not exists ronde text;
update public.wasdag_regels set ronde = to_char(datum, 'YYYY-MM') where ronde is null;
alter table public.wasdag_regels alter column ronde set not null;
alter table public.wasdag_regels drop constraint if exists wasdag_regels_ronde_vorm;
alter table public.wasdag_regels
  add constraint wasdag_regels_ronde_vorm check (ronde ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
create index if not exists wasdag_regels_ronde_idx on public.wasdag_regels (company_id, ronde);

-- Niets meegegeven: de maand van de datum. Zo hoeft geen enkele bestaande
-- plek die een regel maakt iets te weten van rondes. Verzetten naar een
-- andere dag laat de ronde staan: het blijft dezelfde beurt.
create or replace function public.wasdag_ronde_invullen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ronde is null then
    new.ronde := to_char(new.datum, 'YYYY-MM');
  end if;
  return new;
end
$$;
drop trigger if exists wasdag_regels_ronde on public.wasdag_regels;
create trigger wasdag_regels_ronde before insert on public.wasdag_regels
  for each row execute function public.wasdag_ronde_invullen();

-- "september", voor op de factuur.
create or replace function public.ronde_naam(ronde text)
returns text
language sql
immutable
set search_path = public
as $$
  select (array['januari','februari','maart','april','mei','juni','juli','augustus',
                'september','oktober','november','december'])[substr(ronde, 6, 2)::int]
$$;


-- 2. Prijs bij het aanmaken: het extra werk van de ronde (was: 20261009090000_eenmalig_maandwerk.sql)
create or replace function public.wasdag_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrag numeric := 0;
begin
  if new.customer_id is not null then
    select coalesce(ap.prijs, 0) + coalesce((
      select sum((ap.maandwerk_extra ->> (w ->> 'id'))::numeric)
      from public.customers c, jsonb_array_elements(
        case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
      ) as t(w)
      where c.id = new.customer_id
        and w -> 'maanden' ? substr(new.ronde, 6, 2)
        and coalesce(w ->> 'jaar', substr(new.ronde, 1, 4)) = substr(new.ronde, 1, 4)
        and jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')) = 'number'
    ), 0)
    into bedrag
    from public.adres_prijzen ap
    where ap.customer_id = new.customer_id and ap.company_id = new.company_id;
  end if;
  insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  values (new.id, new.company_id, coalesce(bedrag, 0))
  on conflict (regel_id) do nothing;
  return null;
end
$$;

-- 3. Weghalen en terugzetten: de ronde gaat mee (was: 20261011093000_dag_klaar.sql)
create or replace function public.wasdag_weghalen(dag date, adressen uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  weg jsonb;
  kenmerk uuid;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald where company_id = bedrijf and created_at < now() - interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'prijs', wp.prijs,
    'ploeg_nr', r.ploeg_nr, 'volgorde', r.volgorde, 'rest', r.rest, 'vaste_start', r.vaste_start,
    'gedaan_op', r.gedaan_op, 'gedaan_door', r.gedaan_door, 'gedaan_bewaard', r.gedaan_bewaard,
    'ronde', r.ronde
  )), '[]'::jsonb)
  into weg
  from public.wasdag_regels r
  left join public.wasdag_prijzen wp on wp.regel_id = r.id
  where r.company_id = bedrijf
    and r.datum = dag
    and (adressen is null or r.customer_id = any(adressen));

  if jsonb_array_length(weg) = 0 then
    return null;
  end if;

  delete from public.wasdag_regels
  where company_id = bedrijf
    and datum = dag
    and (adressen is null or customer_id = any(adressen));

  insert into public.wasdag_weggehaald (company_id, regels) values (bedrijf, weg)
  returning id into kenmerk;
  return kenmerk;
end
$$;

create or replace function public.wasdag_terugzetten(kenmerk uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  bewaard jsonb;
  nieuw uuid[] := '{}';
  aantal integer := 0;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald
  where id = kenmerk and company_id = bedrijf
  returning regels into bewaard;
  if bewaard is null then
    raise exception 'Dit is al teruggezet of te lang geleden.';
  end if;
  perform set_config('wooshy.gedaan', '1', true);

  -- Eerst terugzetten, mét de indeling van die dag en of het gedaan was. De
  -- prijsregel maakt een trigger aan zodra deze opdracht klaar is; pas daarna
  -- kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels
      (company_id, datum, customer_id, notitie, ploeg_nr, volgorde, rest, vaste_start,
       gedaan_op, gedaan_door, gedaan_bewaard, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time,
           nullif(r ->> 'gedaan_op', '')::timestamptz,
           nullif(r ->> 'gedaan_door', '')::uuid,
           case when jsonb_typeof(r -> 'gedaan_bewaard') = 'object' then r -> 'gedaan_bewaard' end,
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(bewaard) as t(r)
    where r ->> 'customer_id' is not null
      and exists (
        select 1 from public.customers c
        where c.id = (r ->> 'customer_id')::uuid
          and c.company_id = bedrijf
          -- Gedaan werk komt altijd terug; de planning alleen voor wie nog
          -- klant is.
          and (
            (r ->> 'datum')::date <= vandaag
            or (c.deleted_at is null and c.inactief_op is null)
          )
      )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;
  aantal := cardinality(nieuw);

  update public.wasdag_prijzen wp
  set prijs = (r ->> 'prijs')::numeric
  from public.wasdag_regels w, jsonb_array_elements(bewaard) as t(r)
  where wp.regel_id = w.id
    and w.id = any(nieuw)
    and w.customer_id = (r ->> 'customer_id')::uuid
    and w.datum = (r ->> 'datum')::date
    and jsonb_typeof(r -> 'prijs') = 'number';

  return aantal;
end
$$;

-- Stoppen en terugdraaien (was: 20260922090000_prijskolommen_weg.sql)
create or replace function public.zet_adressen_inactief(
  adressen uuid[],
  reden text,
  planning_weg boolean,
  voor_bedrijf uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- De server mag altijd; een gebruiker alleen met het recht.
  prijzen_zichtbaar boolean := auth.role() = 'service_role' or public.heeft_recht('prijzen_zien');
  nu timestamptz := now();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  gezet uuid[] := '{}';
  klanten_weg uuid[] := '{}';
  planning jsonb := '[]'::jsonb;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if reden is null or reden not in ('verhuisd', 'gestopt') then
    raise exception 'Onbekende reden.';
  end if;

  with u as (
    update public.customers
    set inactief_op = nu, inactief_reden = reden
    where company_id = bedrijf
      and id = any(adressen)
      and deleted_at is null
      and inactief_op is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into gezet from u;

  if planning_weg and cardinality(gezet) > 0 then
    -- Eerst vastleggen wat er weggaat (met de prijs, als je die mag zien):
    -- de prijsregel verdwijnt mee met de dagregel.
    select coalesce(jsonb_agg(
      jsonb_build_object('datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'ronde', r.ronde)
      || case when prijzen_zichtbaar then jsonb_build_object('prijs', coalesce(wp.prijs, 0)) else '{}'::jsonb end
    ), '[]'::jsonb)
    into planning
    from public.wasdag_regels r
    left join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.company_id = bedrijf
      and r.customer_id = any(gezet)
      -- Vandaag blijft staan: dat werk kan vanochtend al gedaan zijn.
      and r.datum > vandaag;

    delete from public.wasdag_regels
    where company_id = bedrijf
      and customer_id = any(gezet)
      and datum > vandaag;
  end if;

  -- Bij een verhuizing gaan de klantgegevens weg, maar alleen als de klant
  -- geen ander adres heeft dat actief is of op "gestopt" staat.
  if reden = 'verhuisd' and cardinality(gezet) > 0 then
    with k as (
      update public.klanten kl
      set deleted_at = nu
      where kl.company_id = bedrijf
        and kl.deleted_at is null
        and kl.id in (
          select c.klant_id from public.customers c
          where c.id = any(gezet) and c.klant_id is not null
        )
        and not exists (
          select 1 from public.customers c
          where c.klant_id = kl.id
            and c.deleted_at is null
            and (c.inactief_op is null or c.inactief_reden = 'gestopt')
        )
      returning kl.id
    )
    select coalesce(array_agg(id), '{}') into klanten_weg from k;
  end if;

  return jsonb_build_object(
    'adressen', to_jsonb(gezet),
    'klanten', to_jsonb(klanten_weg),
    'planning', planning,
    'inactief_op', nu
  );
end
$$;

create or replace function public.stoppen_terugdraaien(uitkomst jsonb, voor_bedrijf uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- Het oude bedrag terugzetten mag wie een dagprijs mag wijzigen: prijzen
  -- zien én planning (zoals de regels op wasdag_prijzen). Anders blijft de
  -- momentopname die de database zelf uitrekent.
  prijzen_zichtbaar boolean := auth.role() = 'service_role'
    or (public.heeft_recht('prijzen_zien') and public.heeft_recht('planning'));
  moment timestamptz := (uitkomst ->> 'inactief_op')::timestamptz;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  terug uuid[] := '{}';
  nieuw uuid[] := '{}';
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if moment is null then
    raise exception 'Onbekende stopzetting.';
  end if;

  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and deleted_at is null
      and inactief_op = moment
      and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'adressen', '[]'::jsonb)))::uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into terug from u;

  update public.klanten
  set deleted_at = null
  where company_id = bedrijf
    and deleted_at = moment
    and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'klanten', '[]'::jsonb)))::uuid);

  -- De planning terug. De prijs rekent de database zelf opnieuw uit (trigger
  -- op wasdag_regels); alleen wie prijzen mag zien, zet het oude bedrag terug.
  -- Alleen de regels die hier echt terugkomen krijgen straks hun oude prijs:
  -- een dag die intussen opnieuw is ingepland houdt zijn eigen bedrag.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where (r ->> 'datum')::date >= vandaag
      and (r ->> 'customer_id')::uuid = any(terug)
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;

  if prijzen_zichtbaar then
    update public.wasdag_prijzen wp
    set prijs = (r ->> 'prijs')::numeric
    from public.wasdag_regels w,
      jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where wp.regel_id = w.id
      and w.id = any(nieuw)
      and w.company_id = bedrijf
      and w.customer_id = (r ->> 'customer_id')::uuid
      and w.datum = (r ->> 'datum')::date
      and w.customer_id = any(terug)
      and w.datum >= vandaag
      and jsonb_typeof(r -> 'prijs') = 'number';
  end if;

  return cardinality(terug);
end
$$;

-- 4. Geld: het extra werk van de ronde, en de kaart per ronde (was: 20261011181000_niet_gewassen_blijft_staan.sql)
create or replace function public.geld_schuld(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag, greatest(coalesce(g.aantal, 1), 1)::int,
         coalesce(array_to_string(g.maanden, ','), ''), 0, g.id
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort = 'beginstand' and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  -- Wasbeurten: met de dagnotitie en het extra werk van die ronde erbij.
  select r.customer_id, 'wassen', r.datum, wp.prijs, 1,
         concat_ws(' · ',
           (select string_agg(btrim(m ->> 'notitie'), ', ')
              from jsonb_array_elements(
                     case when jsonb_typeof(cu.maandwerk) = 'array' then cu.maandwerk else '[]'::jsonb end
                   ) m
              where coalesce(m -> 'maanden', '[]'::jsonb) ? substr(r.ronde, 6, 2)
                and coalesce(m ->> 'jaar', '') in ('', substr(r.ronde, 1, 4))
                and btrim(coalesce(m ->> 'notitie', '')) <> ''),
           nullif(btrim(r.notitie), '')),
         1, r.id
  from public.wasdag_regels r
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  join public.customers cu on cu.id = r.customer_id
  where r.company_id = bedrijf and r.customer_id = any (adressen)
    and r.gedaan_op is not null and wp.prijs > 0
    and r.niet_gewassen_op is null
    and r.datum <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = r.customer_id and r.datum >= p.vanaf and (p.tot is null or r.datum <= p.tot)
    )
  union all
  -- Uitgevoerde klussen, met wat het was.
  select k.customer_id, 'klus', k.gedaan_op, kp.prijs, 1, k.omschrijving, 2, k.id
  from public.klussen k
  join public.klus_prijzen kp on kp.klus_id = k.id
  where k.company_id = bedrijf and k.customer_id = any (adressen)
    and k.gedaan_op is not null and k.deleted_at is null and kp.prijs > 0
    and k.gedaan_op <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = k.customer_id and k.gedaan_op >= p.vanaf and (p.tot is null or k.gedaan_op <= p.tot)
    )
$$;

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
            -- Bij een wasbeurt: in welk maandvakje hij hoort.
            'ronde', case when p.soort = 'wassen' then
              (select w.ronde from public.wasdag_regels w where w.id = p.ref) end,
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

-- 5. Straat in: een open beurt van dezelfde ronde telt ook als wachten (was: 20261011185000_verdelen_randjes.sql)
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
                   and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
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

-- 5. Straat in: een open beurt van dezelfde ronde telt ook als wachten (was: 20261011187000_eerlijk_verdelen_route.sql)
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
  hoeveel integer;
  route jsonb;
  totaal numeric := 0;
  doel numeric;
  gelopen numeric := 0;
  beurt integer := 1;
  r record;
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
  hoeveel := coalesce(cardinality(mensen), 0);
  if hoeveel < 2 then
    raise exception 'Er loopt maar één iemand: er valt niets te verdelen.';
  end if;

  -- De straten van deze avond op een rij, in de volgorde van de wijkkaart,
  -- met per straat zijn gewicht. Straten zonder stuk staan achter de stukken
  -- van hun eigen wijk, net als op de wijkenpagina.
  with alle_adressen as (
    select array_agg(c.id) as ids
      from public.customers c
      join public.streets s on s.id = c.street_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
     where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null
  ),
  stand as (
    select * from public.geld_stand(bedrijf, coalesce((select ids from alle_adressen), '{}'))
  ),
  per_adres as (
    select
      c.street_id,
      (c.inactief_op is null) as actief,
      (
        st.open > 0.005
        and not exists (
          select 1 from public.betaal_gebeurtenissen g
           where g.customer_id = c.id and g.vrijgave_id = v.id
             and g.soort in ('betaald', 'niet_thuis', 'geen_geld')
             and not exists (select 1 from public.betaal_gebeurtenissen o
                              where o.herroept_id = g.id)
        )
        and not exists (
          select 1 from public.wasdag_regels wr
           where wr.customer_id = c.id and wr.company_id = bedrijf
             and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
             and wr.gedaan_op is null
             and wr.niet_gewassen_op is null
        )
      ) as telt
      from stand st
      join public.customers c on c.id = st.customer_id
  ),
  per_straat as (
    select
      s.id,
      d.sort_order as wijk_sort,
      coalesce(g.sort_order, 1000000) as stuk_sort,
      s.sort_order as straat_sort,
      s.name as naam,
      count(*) filter (where a.telt) * 1000 + count(*) filter (where a.actief) as gewicht
      from public.streets s
      join public.districts d on d.id = s.district_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
      left join public.straat_groepen g on g.id = s.groep_id
      left join per_adres a on a.street_id = s.id
     where s.company_id = bedrijf and s.deleted_at is null
     group by s.id, d.sort_order, g.sort_order, s.sort_order, s.name
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', p.id, 'gewicht', p.gewicht)
                     order by p.wijk_sort, p.stuk_sort, p.straat_sort, p.naam),
           '[]'::jsonb)
    into route
    from per_straat p;

  select coalesce(sum((e ->> 'gewicht')::numeric), 0) into totaal
    from jsonb_array_elements(route) e;
  doel := case when totaal > 0 then totaal / hoeveel else 0 end;

  -- In één keer schoon, en daarna rechtstreeks wegschrijven: zo staat deze
  -- klik niet als dertig regels in het logboek van de avond.
  delete from public.geldloop_straat_lopers sl
    using public.streets s, public.geldloop_vrijgave_wijken w
    where sl.vrijgave_id = v.id and s.id = sl.street_id
      and w.vrijgave_id = v.id and w.district_id = s.district_id;

  for r in
    select (e ->> 'id')::uuid as id, (e ->> 'gewicht')::numeric as gewicht
      from jsonb_array_elements(route) e
  loop
    insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
      values (v.id, r.id, mensen[beurt], bedrijf);
    verdeeld := verdeeld + 1;
    gelopen := gelopen + r.gewicht;
    -- Zodra dit stuk zijn deel heeft, gaat de volgende loper verder waar
    -- deze ophoudt. Eén knip per loper: een enkele grote straat schuift dus
    -- niemand over.
    if beurt < hoeveel and doel > 0 and gelopen >= doel * beurt then
      beurt := beurt + 1;
    end if;
  end loop;

  return jsonb_build_object('straten', verdeeld, 'lopers', hoeveel);
end
$$;

-- 6. Factuur: op de datum, met de ronde erbij als die anders is (was: 20261012103000_regel_vervangen.sql)
create or replace function public.factuurregels_maken(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  start_op date;
  gemaakt integer := 0;
begin
  if bedrijf is null then
    return 0;
  end if;

  select c.factuur_start_op into start_op from public.companies c where c.id = bedrijf;
  if start_op is null or dag < start_op then
    return 0;
  end if;

  if exists (
    select 1 from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.customer_id is not null and r.gedaan_op is null
  ) then
    return 0;
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, wasdag_regel_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    bedrijf, k.id, cu.id, 'wasbeurt', r.id, r.datum,
    coalesce(nullif(btrim(k.factuur_omschrijving), ''),
             'Glazenwassen ' || public.factuur_adres_tekst(cu.id))
      -- Een beurt van een andere ronde dan de maand van de datum: erbij
      -- zeggen welke, zodat de klant niet denkt dat hij er twee kreeg.
      || case when r.ronde <> to_char(r.datum, 'YYYY-MM') then
           ' (' || public.ronde_naam(r.ronde) || 'beurt'
           || case when substr(r.ronde, 1, 4) <> to_char(r.datum, 'YYYY')
                   then ' ' || substr(r.ronde, 1, 4) else '' end || ')'
         else '' end,
    case when r.notitie_op_factuur then coalesce(r.notitie, '') else '' end,
    wp.prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(wp.prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  from public.wasdag_regels r
  join public.customers cu on cu.id = r.customer_id
  join public.klanten k on k.id = cu.klant_id and k.company_id = r.company_id
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  left join public.streets s on s.id = cu.street_id
  left join public.districts d on d.id = s.district_id
  where r.company_id = bedrijf and r.datum = dag
    and r.gedaan_op is not null
    and r.niet_gewassen_op is null
    and wp.prijs > 0
    and cu.deleted_at is null and k.deleted_at is null
    and coalesce(r.betaalmethode, cu.betaalmethode, d.betaalmethode, 'contant') = 'overmaken'
    and not exists (
      select 1 from public.factuurregels fr
      where fr.wasdag_regel_id = r.id and fr.deleted_at is null and fr.vervangen_op is null
    );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
