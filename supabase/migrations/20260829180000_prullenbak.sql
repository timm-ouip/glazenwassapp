-- Prullenbak: verwijderen wordt "wegleggen" in plaats van weggooien.
--
-- Een rij met deleted_at gevuld verdwijnt uit de app, maar blijft in de
-- database staan zodat hij terug te halen is. De app filtert overal op
-- deleted_at is null; de prullenbakpagina doet precies het omgekeerde.
--
-- Kinderen krijgen GEEN eigen stempel: een straat in de prullenbak neemt
-- zijn klanten mee doordat de straat zelf verborgen is. Zo weet je bij het
-- terugzetten precies wat er hoorde bij wat, zonder losse klanten die
-- blijven rondzweven.

alter table public.districts add column if not exists deleted_at timestamptz;
alter table public.streets add column if not exists deleted_at timestamptz;
alter table public.customers add column if not exists deleted_at timestamptz;

-- De app haalt vrijwel altijd "alles van dit bedrijf dat niet weggelegd is"
-- op; deze gedeeltelijke index bedient precies die vraag.
create index if not exists districts_company_actief_idx
  on public.districts (company_id) where deleted_at is null;
create index if not exists streets_company_actief_idx
  on public.streets (company_id) where deleted_at is null;
create index if not exists customers_company_actief_idx
  on public.customers (company_id) where deleted_at is null;

-- En het omgekeerde, voor de prullenbakpagina.
create index if not exists districts_prullenbak_idx
  on public.districts (company_id, deleted_at desc) where deleted_at is not null;
create index if not exists streets_prullenbak_idx
  on public.streets (company_id, deleted_at desc) where deleted_at is not null;
create index if not exists customers_prullenbak_idx
  on public.customers (company_id, deleted_at desc) where deleted_at is not null;
