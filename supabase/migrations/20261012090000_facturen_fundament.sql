-- Tweede betalingssysteem, fase 1a: het fundament onder de facturen.
--
-- De app kon tot nu toe één soort geld: contant ophalen aan de deur. Klanten
-- die overmaken stonden er wel in (customers.betaalmethode = 'overmaken'),
-- maar er gebeurde niets mee. Hier komt de andere helft te staan.
--
-- Drie dingen die de rest van dit bestand verklaren:
--
--   1. Een prijs in deze app is wat de klant betaalt. Bij een particulier is
--      dat inclusief btw, bij een bedrijf of VvE exclusief -- want aan een
--      consument moet je prijzen inclusief btw communiceren en een bedrijf
--      wil ze juist exclusief zien. Wat er opgeslagen staat verandert niet;
--      alleen de manier waarop de factuur het uit elkaar trekt.
--   2. Een factuur krijgt zijn nummer pas bij het versturen. Een concept
--      heeft er geen. Zo kan er nooit een gat in de reeks vallen doordat
--      iemand een concept weggooit.
--   3. Een verstuurde factuur staat vast: niet te wijzigen, niet weg te
--      leggen, en met de klantgegevens erin bevroren zoals ze op dat moment
--      waren. De klant heeft dat papier al; wat hier staat moet daarmee
--      blijven kloppen.

-- ---------------------------------------------------------------------
-- 1. Het nieuwe recht
-- ---------------------------------------------------------------------
-- Los van "prijzen_zien": een bedrag mogen zien is iets anders dan namens
-- het bedrijf post naar een klant sturen, met de KvK en het btw-nummer erop.
alter table public.rollen drop constraint rollen_rechten_check;
alter table public.rollen add constraint rollen_rechten_check check (
  rechten <@ array[
    'mail_lezen', 'mail_versturen', 'klanten_bekijken', 'klanten_bewerken',
    'prijzen_zien', 'planning', 'instellingen_team', 'geldlopen', 'facturen'
  ]::text[]
);

-- ---------------------------------------------------------------------
-- 2. Wat een klant is
-- ---------------------------------------------------------------------
-- Het klanttype zit op `klanten` (de persoon of organisatie), niet op
-- `customers` (het pand): een VvE kan twintig panden hebben en krijgt één
-- factuur.
alter table public.klanten
  add column klanttype text not null default 'particulier'
    check (klanttype in ('particulier', 'bedrijf', 'vve')),
  add column bedrijfsnaam text not null default '',
  add column kvk text not null default '',
  add column btw_nummer text not null default '',
  add column website text not null default '',
  -- De factuur gaat naar de beheerder of naar facturen@, niet naar de
  -- bewoner die je normaal mailt. Leeg = gewoon het gewone e-mailadres.
  add column factuur_email text not null default '',
  add column factuur_straat text not null default '',
  add column factuur_huisnummer text not null default '',
  add column factuur_postcode text not null default '',
  add column factuur_plaats text not null default '',
  -- Leeg = volgt het bedrijf.
  add column betalingstermijn_dagen smallint check (betalingstermijn_dagen between 1 and 120),
  -- Leeg = volgt het klanttype (particulier inclusief, bedrijf/VvE exclusief).
  add column btw_inclusief boolean,
  -- Leeg = volgt het bedrijf.
  add column btw_procent numeric(5, 2) check (btw_procent >= 0 and btw_procent <= 100),
  -- Vaste regel op elke factuur van deze klant, bv. "Glasbewassing conform
  -- overeenkomst". Leeg = de gewone omschrijving per beurt.
  add column factuur_omschrijving text not null default '',
  add column factuur_per text not null default 'beurt'
    check (factuur_per in ('beurt', 'maand'));

alter table public.companies
  add column btw_procent numeric(5, 2) not null default 21
    check (btw_procent >= 0 and btw_procent <= 100),
  add column factuur_termijn_dagen smallint not null default 14
    check (factuur_termijn_dagen between 1 and 120),
  -- Vanaf welke dag er te factureren regels ontstaan. Leeg = nog niet aan.
  -- Zo rolt er niets uit over werk van voor de invoering.
  add column factuur_start_op date;

-- ---------------------------------------------------------------------
-- 3. De betaalmethode bevriezen op de dagregel
-- ---------------------------------------------------------------------
-- Zonder dit verschuift oude omzet: zet je een klant in november op
-- overmaken, dan zou juni's werk met terugwerkende kracht van de contante
-- kolom naar de overmaakkolom springen. Bij het afmelden zetten we vast wat
-- het die dag was. Leeg = nog niet afgemeld, of van voor de invoering.
alter table public.wasdag_regels
  add column betaalmethode text check (betaalmethode in ('contant', 'overmaken')),
  -- De dagnotitie is bedoeld als "waarom was het dit bedrag", maar er staat
  -- in de praktijk ook "hond blafte" in. Alleen met dit vinkje gaat hij mee
  -- naar de klant.
  add column notitie_op_factuur boolean not null default false;

-- ---------------------------------------------------------------------
-- 4. Te factureren regels
-- ---------------------------------------------------------------------
-- Ontstaan bij het afmelden van een dag. Nog geen factuur: geen nummer, en
-- er gaat niets naar buiten. Zolang factuur_id leeg is, wacht de regel.
create table public.factuurregels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  klant_id uuid not null references public.klanten(id) on delete cascade,
  customer_id uuid,
  soort text not null check (soort in ('wasbeurt', 'klus')),
  wasdag_regel_id uuid,
  klus_id uuid,
  datum date not null,
  omschrijving text not null default '',
  -- Alleen gevuld als de notitie mee mocht.
  notitie text not null default '',
  -- Wat er in het prijsveld stond, ongemoeid bewaard.
  -- Mag negatief: een creditregel boekt tegen.
  bedrag numeric(10, 2) not null,
  btw_inclusief boolean not null,
  btw_procent numeric(5, 2) not null check (btw_procent >= 0 and btw_procent <= 100),
  -- De rekensom van dat moment, zodat een latere tariefwijziging een oude
  -- regel niet verandert.
  bedrag_excl numeric(10, 2) not null,
  btw_bedrag numeric(10, 2) generated always as (round(bedrag_excl * btw_procent / 100, 2)) stored,
  bedrag_incl numeric(10, 2) generated always as (bedrag_excl + round(bedrag_excl * btw_procent / 100, 2)) stored,
  factuur_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, company_id),
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade
);
-- Eén wasbeurt of klus kan maar één keer op een factuur belanden.
create unique index factuurregels_wasbeurt_uniek on public.factuurregels (wasdag_regel_id)
  where wasdag_regel_id is not null and deleted_at is null;
create unique index factuurregels_klus_uniek on public.factuurregels (klus_id)
  where klus_id is not null and deleted_at is null;
create index factuurregels_open on public.factuurregels (company_id, klant_id, datum)
  where factuur_id is null and deleted_at is null;
create index factuurregels_factuur on public.factuurregels (factuur_id);

-- ---------------------------------------------------------------------
-- 5. De facturen zelf
-- ---------------------------------------------------------------------
-- Let op wat hier niet staat: bedragen. Die zijn de som van de regels, en
-- de regels van een verstuurde factuur kunnen niet meer veranderen. Eén
-- plek waar het bedrag vandaan komt, dus nooit twee getallen die uit elkaar
-- kunnen lopen.
create table public.facturen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  klant_id uuid not null references public.klanten(id) on delete cascade,
  soort text not null default 'factuur' check (soort in ('factuur', 'credit')),
  -- Bij een creditfactuur: welke factuur hij tegenboekt.
  crediteert_id uuid references public.facturen(id),
  -- Leeg zolang het een concept is. Daarna "2026-0001".
  nummer text,
  jaar smallint,
  volgnummer integer,
  -- De dag van de laatste beurt die erop staat, niet de dag van versturen:
  -- dan valt de omzet in de maand van het werk en is hij naast de contante
  -- kant te leggen.
  factuurdatum date,
  vervaldatum date,
  status text not null default 'concept'
    check (status in ('concept', 'verstuurd', 'betaald', 'gecrediteerd')),
  betaald_bedrag numeric(10, 2) not null default 0 check (betaald_bedrag >= 0),
  betaald_op date,
  mollie_id text,
  mollie_link text,
  verstuurd_op timestamptz,
  verstuurd_via text check (verstuurd_via in ('mail', 'whatsapp', 'print')),
  verstuurd_naar text not null default '',
  -- Welke herinneringstrap er al uit is (0 = nog geen).
  herinnering_trap smallint not null default 0,
  met_rust_tot date,
  pdf_pad text,
  -- Bevroren bij het versturen: naam, adres, KvK, btw-nummer, termijn. De
  -- klant kan later verhuizen of van naam veranderen; de factuur niet.
  klantgegevens jsonb,
  gemaakt_door uuid default auth.uid(),
  created_at timestamptz not null default now(),
  -- Alleen een concept kan weg. Zie de policy onderaan.
  deleted_at timestamptz,
  unique (id, company_id),
  unique (company_id, nummer),
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade,
  -- Een verstuurde factuur heeft altijd een nummer en een datum.
  check (status = 'concept' or (nummer is not null and factuurdatum is not null))
);
create index facturen_status on public.facturen (company_id, status, factuurdatum);
create index facturen_klant on public.facturen (company_id, klant_id);

-- Enkelvoudig, met opzet: bij "on delete set null" maakt Postgres élke kolom
-- van de sleutel leeg, en company_id mag niet leeg zijn. Een concept
-- weggooien laat de regels dus gewoon los, klaar voor een volgende factuur.
alter table public.factuurregels
  add constraint factuurregels_factuur_fk
  foreign key (factuur_id) references public.facturen (id) on delete set null;

-- ---------------------------------------------------------------------
-- 6. De nummerteller
-- ---------------------------------------------------------------------
-- Eén rij per bedrijf per jaar. De volgende trekken gaat met één insert,
-- zodat tweehonderd tegelijk verstuurde facturen nooit hetzelfde nummer
-- kunnen krijgen: wie tweede is, wacht op de rij-vergrendeling.
create table public.factuur_tellers (
  company_id uuid not null references public.companies(id) on delete cascade,
  jaar smallint not null,
  laatste integer not null default 0,
  primary key (company_id, jaar)
);

create or replace function public.factuur_nummer_trekken(bedrijf uuid, voor_jaar int)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.factuur_tellers (company_id, jaar, laatste)
  values (bedrijf, voor_jaar, 1)
  on conflict (company_id, jaar)
    do update set laatste = factuur_tellers.laatste + 1
  returning laatste
$$;
revoke execute on function public.factuur_nummer_trekken(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Wat geldt er voor deze klant
-- ---------------------------------------------------------------------
-- Drie keer hetzelfde patroon: staat het bij de klant, dan die; anders het
-- bedrijf; anders de standaard. Hier op één plek, zodat de app en de
-- database nooit iets anders uitrekenen.
create or replace function public.factuur_btw_procent(k public.klanten)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(k.btw_procent, (select c.btw_procent from public.companies c where c.id = k.company_id), 21)
$$;

create or replace function public.factuur_btw_inclusief(k public.klanten)
returns boolean
language sql
immutable
as $$
  select coalesce(k.btw_inclusief, k.klanttype = 'particulier')
$$;

create or replace function public.factuur_termijn(k public.klanten)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(k.betalingstermijn_dagen,
                  (select c.factuur_termijn_dagen from public.companies c where c.id = k.company_id),
                  14)::int
$$;

-- ---------------------------------------------------------------------
-- 8. Wie mag wat zien
-- ---------------------------------------------------------------------
create trigger factuurregels_set_company_id before insert on public.factuurregels
  for each row execute function public.set_company_id();
create trigger facturen_set_company_id before insert on public.facturen
  for each row execute function public.set_company_id();

alter table public.factuurregels enable row level security;
alter table public.facturen enable row level security;
alter table public.factuur_tellers enable row level security;
revoke all on public.factuurregels, public.facturen, public.factuur_tellers from anon;

create policy "Factuurregels lezen" on public.factuurregels for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));
create policy "Facturen lezen" on public.facturen for select to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen')));

-- De teller is van de database, niemand hoeft erin te kijken: geen policy,
-- dus alleen de service role en de functies hierboven komen erbij.

-- Maken en wijzigen gaat via de functies in de volgende migratie; wat een
-- mens rechtstreeks mag is alleen dit: een concept bijwerken of weggooien.
-- Zodra er een nummer op staat, kan er niets meer af of bij.
create policy "Concept bijwerken" on public.facturen for update to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen'))
    and status = 'concept' and nummer is null)
  with check (company_id = (select public.current_company_id())
    and status = 'concept' and nummer is null);

create policy "Regel van een concept bijwerken" on public.factuurregels for update to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen'))
    and (factuur_id is null
         or exists (select 1 from public.facturen f
                    where f.id = factuurregels.factuur_id and f.nummer is null)))
  with check (company_id = (select public.current_company_id()));

create policy "Concept weggooien" on public.facturen for delete to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen'))
    and nummer is null);
