-- Klanten: de mensen achter de adressen.
--
-- De wijkenpagina werkt met customers-rijen: dat zijn adres-regels
-- (straat + huisnummer + prijs + frequentie), geen personen. Deze tabel
-- houdt de persoon bij — naam, e-mail, telefoon, postadres — zodat we ze
-- later een bericht kunnen sturen dat we komen wassen.
--
-- Eén klant kan meerdere panden hebben; een adres-regel hoort bij hooguit
-- één klant. Daarom een simpele verwijzing op customers, geen koppeltabel.

create table public.klanten (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  naam text not null,
  email text not null default '',
  telefoon text not null default '',
  straat text not null default '',
  -- Tekst, want een huisnummer is niet altijd een getal: "12a", "61 bis".
  huisnummer text not null default '',
  postcode text not null default '',
  plaats text not null default '',
  notitie text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index klanten_company_id_idx on public.klanten(company_id);

-- on delete set null: een weggegooide klant mag de wijklijst nooit
-- meenemen — het adres blijft gewoon gewassen worden.
alter table public.customers
  add column if not exists klant_id uuid references public.klanten(id) on delete set null;
create index if not exists customers_klant_idx
  on public.customers (klant_id) where klant_id is not null;

create trigger klanten_set_company_id before insert on public.klanten
  for each row execute function public.set_company_id();

create trigger update_klanten_updated_at
  before update on public.klanten
  for each row execute function public.update_updated_at_column();

alter table public.klanten enable row level security;

create policy "Bedrijf beheert eigen klantgegevens" on public.klanten
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Zelfde twee gedeeltelijke indexen als de andere tabellen: de app vraagt
-- om alles wat niet weggelegd is, de prullenbak om precies het omgekeerde.
create index if not exists klanten_company_actief_idx
  on public.klanten (company_id) where deleted_at is null;
create index if not exists klanten_prullenbak_idx
  on public.klanten (company_id, deleted_at desc) where deleted_at is not null;
