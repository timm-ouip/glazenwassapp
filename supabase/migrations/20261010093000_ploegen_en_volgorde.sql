-- Ploegen per dag, en de volgorde van het werk op een dag.
--
-- Ploegen: per dag kies je wie er werken en verdeel je ze over Ploeg 1, 2, …
-- De samenstelling mag elke dag anders zijn, dus staat ze per datum. Wie er
-- in een ploeg kan: een teamlid. Dat is meestal een medewerker met een
-- account, maar het mag ook iemand zonder account zijn (een hulpkracht);
-- die kun je later uitnodigen, en dan wordt het dezelfde persoon.
--
-- Volgorde: er komt geen tabel met blokken. Een blok (een straat, of een
-- groot pand apart) leidt de app af uit de regels van die dag. Per regel
-- staat bij welke ploeg hij hoort, waar hij in de rij staat, of hij de rest
-- van een straat is, en of hij op een vaste tijd is vastgezet. Zo blijven
-- alle bestaande manieren om werk op een dag te zetten gewoon werken.
--
-- Verhuist werk naar een andere dag (verplaatsen, opschuiven), dan laat de
-- app ploeg, volgorde en vaste tijd los: die ploeg bestaat op de nieuwe dag
-- misschien niet eens. Het werk komt daar binnen als "nog niet ingedeeld".

-- ---------------------------------------------------------------------
-- 1. Teamleden
-- ---------------------------------------------------------------------
create table public.teamleden (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  naam text not null check (length(btrim(naam)) between 1 and 100),
  -- Het account, als hij dat heeft. Leeg = teamlid zonder account.
  employee_id uuid unique references public.employees(id) on delete set null,
  -- Staat er een uitnodiging open, dan hangt die aan dit account-in-wording;
  -- de trigger hieronder koppelt hem zodra hij accepteert.
  uitgenodigd_user_id uuid unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index teamleden_company_idx on public.teamleden (company_id) where deleted_at is null;

alter table public.teamleden enable row level security;
-- Lezen mag iedereen van het bedrijf: de dagpagina laat zien wie er in jouw
-- ploeg zitten. Beheren hoort bij het team, dus bij hetzelfde recht als de
-- teampagina.
create policy "Zie teamleden van je bedrijf" on public.teamleden
  for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy "Beheer teamleden" on public.teamleden
  for all to authenticated
  using (company_id = (select public.current_company_id()) and public.heeft_recht('instellingen_team'))
  with check (company_id = (select public.current_company_id()) and public.heeft_recht('instellingen_team'));
create trigger teamleden_set_company_id before insert on public.teamleden
  for each row execute function public.set_company_id();

-- De koppeling met een account zet alleen de server. Zonder dit slot kon een
-- beheerder zijn eigen teamlid aan het account van een ander hangen.
create or replace function public.teamlid_koppeling_slot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- De server (service-rol) en de koppelfunctie hieronder mogen het wel.
  if current_setting('role', true) = 'service_role'
     or coalesce(current_setting('wooshy.koppelt_teamlid', true), '') = 'ja'
     or auth.uid() is null then
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.uitgenodigd_user_id is distinct from old.uitgenodigd_user_id then
    raise exception 'De koppeling met een account gaat via uitnodigen.';
  end if;
  return new;
end
$$;
create trigger teamleden_koppeling_slot before update on public.teamleden
  for each row execute function public.teamlid_koppeling_slot();

-- Wordt een medewerker aangemaakt (bedrijf starten of uitnodiging
-- accepteren), dan koppelen we het teamlid waarvoor de uitnodiging liep, of
-- maken we er een.
create or replace function public.teamlid_bij_medewerker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gekoppeld uuid;
begin
  perform set_config('wooshy.koppelt_teamlid', 'ja', true);

  update public.teamleden
     set employee_id = new.id,
         uitgenodigd_user_id = null,
         deleted_at = null,
         naam = case when btrim(new.naam) <> '' then new.naam else naam end
   where company_id = new.company_id
     and uitgenodigd_user_id = new.id
     and employee_id is null
  returning id into gekoppeld;

  if gekoppeld is null then
    insert into public.teamleden (company_id, naam, employee_id)
    values (new.company_id, coalesce(nullif(btrim(new.naam), ''), new.email), new.id)
    on conflict (employee_id) do nothing;
  end if;
  perform set_config('wooshy.koppelt_teamlid', '', true);
  return null;
end
$$;
create trigger employees_teamlid_maken after insert on public.employees
  for each row execute function public.teamlid_bij_medewerker();

-- Een naamswijziging gaat mee, zodat de ploegen niet een oude naam tonen.
create or replace function public.teamlid_naam_bij()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if btrim(new.naam) <> '' and new.naam is distinct from old.naam then
    update public.teamleden set naam = new.naam where employee_id = new.id;
  end if;
  return null;
end
$$;
create trigger employees_teamlid_naam after update of naam on public.employees
  for each row execute function public.teamlid_naam_bij();

-- Wie er al is, krijgt een teamlid.
insert into public.teamleden (company_id, naam, employee_id)
select e.company_id, coalesce(nullif(btrim(e.naam), ''), e.email), e.id
from public.employees e
on conflict (employee_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Ploegen per dag
-- ---------------------------------------------------------------------
create table public.dag_ploegen (
  company_id uuid not null references public.companies(id) on delete cascade,
  datum date not null,
  nr smallint not null check (nr between 1 and 9),
  -- Leeg = de standaard van het bedrijf (companies.plan_*).
  begin_tijd time,
  eind_tijd time,
  pauze_van time,
  pauze_min smallint check (pauze_min is null or pauze_min between 0 and 240),
  created_at timestamptz not null default now(),
  primary key (company_id, datum, nr)
);

create table public.dag_ploeg_leden (
  company_id uuid not null references public.companies(id) on delete cascade,
  datum date not null,
  nr smallint not null,
  teamlid_id uuid not null references public.teamleden(id) on delete cascade,
  -- Eén mens staat op een dag in hooguit één ploeg.
  primary key (company_id, datum, teamlid_id),
  foreign key (company_id, datum, nr) references public.dag_ploegen (company_id, datum, nr)
    on delete cascade on update cascade
);

alter table public.dag_ploegen enable row level security;
alter table public.dag_ploeg_leden enable row level security;
-- Lezen mag iedereen van het bedrijf (de dagpagina toont je eigen ploeg),
-- indelen hoort bij de planning.
create policy "Zie ploegen" on public.dag_ploegen
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "Beheer ploegen" on public.dag_ploegen
  for all to authenticated
  using (company_id = (select public.current_company_id()) and public.heeft_recht('planning'))
  with check (company_id = (select public.current_company_id()) and public.heeft_recht('planning'));
create policy "Zie ploegleden" on public.dag_ploeg_leden
  for select to authenticated using (company_id = (select public.current_company_id()));
create policy "Beheer ploegleden" on public.dag_ploeg_leden
  for all to authenticated
  using (company_id = (select public.current_company_id()) and public.heeft_recht('planning'))
  with check (company_id = (select public.current_company_id()) and public.heeft_recht('planning'));
create trigger dag_ploegen_set_company_id before insert on public.dag_ploegen
  for each row execute function public.set_company_id();
create trigger dag_ploeg_leden_set_company_id before insert on public.dag_ploeg_leden
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 3. Ploeg en volgorde op het werk zelf
-- ---------------------------------------------------------------------
alter table public.wasdag_regels
  add column ploeg_nr    smallint check (ploeg_nr is null or ploeg_nr between 1 and 9),
  -- Alle regels van hetzelfde blok delen dezelfde volgorde. Leeg = achteraan,
  -- in de gewone volgorde (wijk, straat, huisnummer).
  add column volgorde    integer,
  -- Dit is de rest van een straat die op een andere dag begon.
  add column rest        boolean not null default false,
  -- Vastgezet op een tijd; anders rekent de app de tijd uit.
  add column vaste_start time;

alter table public.klussen
  add column ploeg_nr    smallint check (ploeg_nr is null or ploeg_nr between 1 and 9),
  add column volgorde    integer,
  add column vaste_start time;

-- ---------------------------------------------------------------------
-- 4. Indelen en volgorde zetten
-- ---------------------------------------------------------------------
/**
 * Vervangt de ploegen van één dag in één keer.
 * `ploegen`: [{"nr":1,"begin":"08:00","eind":"16:30","pauze_van":"12:00",
 *              "pauze_min":30,"leden":["<teamlid-id>", …]}, …]
 * Een ploeg die verdwijnt, laat het werk los (ploeg_nr wordt leeg).
 */
create or replace function public.dag_ploegen_zetten(dag date, ploegen jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  aantal integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if jsonb_typeof(ploegen) <> 'array' then
    raise exception 'Onleesbare ploegen.';
  end if;

  delete from public.dag_ploegen where company_id = bedrijf and datum = dag;

  insert into public.dag_ploegen (company_id, datum, nr, begin_tijd, eind_tijd, pauze_van, pauze_min)
  select bedrijf, dag,
         (p ->> 'nr')::smallint,
         nullif(p ->> 'begin', '')::time,
         nullif(p ->> 'eind', '')::time,
         nullif(p ->> 'pauze_van', '')::time,
         nullif(p ->> 'pauze_min', '')::smallint
  from jsonb_array_elements(ploegen) as t(p)
  where (p ->> 'nr') is not null;
  get diagnostics aantal = row_count;

  insert into public.dag_ploeg_leden (company_id, datum, nr, teamlid_id)
  select distinct on (lid) bedrijf, dag, (p ->> 'nr')::smallint, lid::uuid
  from jsonb_array_elements(ploegen) as t(p),
       jsonb_array_elements_text(coalesce(p -> 'leden', '[]'::jsonb)) as l(lid)
  where (p ->> 'nr') is not null
    and exists (
      select 1 from public.teamleden tl
      where tl.id = lid::uuid and tl.company_id = bedrijf and tl.deleted_at is null
    );

  -- Werk dat bij een verdwenen ploeg hoorde, komt bij "nog niet ingedeeld".
  update public.wasdag_regels r
     set ploeg_nr = null
   where r.company_id = bedrijf and r.datum = dag and r.ploeg_nr is not null
     and not exists (
       select 1 from public.dag_ploegen p
       where p.company_id = bedrijf and p.datum = dag and p.nr = r.ploeg_nr
     );
  update public.klussen k
     set ploeg_nr = null
   where k.company_id = bedrijf and k.gepland_op = dag and k.ploeg_nr is not null
     and not exists (
       select 1 from public.dag_ploegen p
       where p.company_id = bedrijf and p.datum = dag and p.nr = k.ploeg_nr
     );

  return aantal;
end
$$;

/**
 * Zet de volgorde van de blokken op een dag, per ploeg.
 * `blokken`: [{"ploeg_nr":1,"vaste_start":"10:00",
 *              "adressen":["<customer-id>", …],"klussen":["<klus-id>", …]}, …]
 * De plek in de lijst is de volgorde; alle regels van een blok krijgen
 * dezelfde waarde, zodat ze bij elkaar blijven.
 */
create or replace function public.dag_volgorde_zetten(dag date, blokken jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  aantal integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if jsonb_typeof(blokken) <> 'array' then
    raise exception 'Onleesbare blokken.';
  end if;

  with blok as (
    select (b ->> 'ploeg_nr')::smallint as ploeg_nr,
           nullif(b ->> 'vaste_start', '')::time as vaste_start,
           (nr * 10)::integer as volgorde,
           b -> 'adressen' as adressen,
           b -> 'klussen' as klussen
    from jsonb_array_elements(blokken) with ordinality as t(b, nr)
  ),
  adres as (
    select blok.ploeg_nr, blok.vaste_start, blok.volgorde, a::uuid as customer_id
    from blok, jsonb_array_elements_text(coalesce(blok.adressen, '[]'::jsonb)) as x(a)
  ),
  bij as (
    update public.wasdag_regels r
       set ploeg_nr = adres.ploeg_nr,
           volgorde = adres.volgorde,
           vaste_start = adres.vaste_start
      from adres
     where r.company_id = bedrijf and r.datum = dag and r.customer_id = adres.customer_id
    returning 1
  )
  select count(*) into aantal from bij;

  update public.klussen k
     set ploeg_nr = b.ploeg_nr,
         volgorde = b.volgorde,
         vaste_start = b.vaste_start
    from (
      select (b ->> 'ploeg_nr')::smallint as ploeg_nr,
             nullif(b ->> 'vaste_start', '')::time as vaste_start,
             (nr * 10)::integer as volgorde,
             k2::uuid as klus_id
      from jsonb_array_elements(blokken) with ordinality as t(b, nr),
           jsonb_array_elements_text(coalesce(b -> 'klussen', '[]'::jsonb)) as x(k2)
    ) b
   where k.company_id = bedrijf and k.gepland_op = dag and k.id = b.klus_id;

  return aantal;
end
$$;

revoke all on function public.dag_ploegen_zetten(date, jsonb) from public, anon;
grant execute on function public.dag_ploegen_zetten(date, jsonb) to authenticated;
revoke all on function public.dag_volgorde_zetten(date, jsonb) from public, anon;
grant execute on function public.dag_volgorde_zetten(date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Weghalen en terugzetten nemen de indeling mee
-- ---------------------------------------------------------------------
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
    'ploeg_nr', r.ploeg_nr, 'volgorde', r.volgorde, 'rest', r.rest, 'vaste_start', r.vaste_start
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

  -- Eerst terugzetten, mét de indeling van die dag. De prijsregel maakt een
  -- trigger aan zodra deze opdracht klaar is; pas daarna kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie, ploeg_nr, volgorde, rest, vaste_start)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time
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
