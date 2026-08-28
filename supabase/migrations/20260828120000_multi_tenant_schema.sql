-- Multi-tenant schema: bedrijven met eigen medewerkers en volledig
-- gescheiden klantgegevens (via Row Level Security).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Bedrijven en medewerkers
-- ---------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  naam text not null default '',
  email text not null,
  rol text not null default 'medewerker' check (rol in ('eigenaar', 'medewerker')),
  created_at timestamptz not null default now()
);
create index employees_company_id_idx on public.employees(company_id);

-- Bepaalt het bedrijf van de ingelogde gebruiker; hergebruikt in policies
-- en de trigger hieronder.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.employees where id = auth.uid()
$$;

-- Vult company_id automatisch in bij een insert als de client 'm niet
-- meestuurt, zodat bestaande insert-aanroepen in de app niet allemaal
-- aangepast hoeven te worden.
create or replace function public.set_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end;
$$;

alter table public.companies enable row level security;
create policy "Zie eigen bedrijf" on public.companies
  for select to authenticated
  using (id = public.current_company_id());
create policy "Eigenaar wijzigt bedrijf" on public.companies
  for update to authenticated
  using (
    id = public.current_company_id()
    and exists (select 1 from public.employees e where e.id = auth.uid() and e.rol = 'eigenaar')
  );

alter table public.employees enable row level security;
create policy "Zie collega's" on public.employees
  for select to authenticated
  using (company_id = public.current_company_id());
create policy "Eigenaar verwijdert medewerkers" on public.employees
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and exists (select 1 from public.employees e where e.id = auth.uid() and e.rol = 'eigenaar')
  );

-- ---------------------------------------------------------------------
-- Wijken, straten, klanten, snelkeuzes
-- ---------------------------------------------------------------------

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index districts_company_id_idx on public.districts(company_id);

create table public.streets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  district_id uuid not null references public.districts(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  sort_desc boolean not null default false,
  print_col integer,
  print_row integer,
  created_at timestamptz not null default now()
);
create index streets_company_id_idx on public.streets(company_id);
create index streets_district_id_idx on public.streets(district_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  street_id uuid not null references public.streets(id) on delete cascade,
  house_number integer not null,
  addition text not null default '',
  note text not null default '',
  price numeric(10, 2) not null default 0,
  frequency text not null default 'elke' check (frequency in ('elke', 'even', 'oneven')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index customers_company_id_idx on public.customers(company_id);
create index customers_street_id_idx on public.customers(street_id);

create table public.quick_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, label)
);
create index quick_notes_company_id_idx on public.quick_notes(company_id);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_districts_updated_at
  before update on public.districts
  for each row execute function public.update_updated_at_column();

create trigger districts_set_company_id before insert on public.districts
  for each row execute function public.set_company_id();
create trigger streets_set_company_id before insert on public.streets
  for each row execute function public.set_company_id();
create trigger customers_set_company_id before insert on public.customers
  for each row execute function public.set_company_id();
create trigger quick_notes_set_company_id before insert on public.quick_notes
  for each row execute function public.set_company_id();

alter table public.districts enable row level security;
alter table public.streets enable row level security;
alter table public.customers enable row level security;
alter table public.quick_notes enable row level security;

create policy "Bedrijf beheert eigen wijken" on public.districts
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "Bedrijf beheert eigen straten" on public.streets
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "Bedrijf beheert eigen klanten" on public.customers
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "Bedrijf beheert eigen snelkeuzes" on public.quick_notes
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
