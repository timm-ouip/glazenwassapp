-- Fase 5, stap A: rollen met rechten.
--
-- Alleen toevoegen: de eigenaar heeft altijd alle rechten, dus voor hem
-- verandert er niets. Een medewerker krijgt een rol (bijvoorbeeld "Wasser" met
-- alleen planning); zonder rol heeft hij geen rechten. Het afdwingen in de
-- policies van de andere tabellen gebeurt in een latere stap.

create table public.rollen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  naam text not null check (length(btrim(naam)) between 1 and 60),
  rechten text[] not null default '{}' check (
    rechten <@ array[
      'mail_lezen', 'mail_versturen', 'klanten_bekijken', 'klanten_bewerken',
      'prijzen_zien', 'planning', 'instellingen_team'
    ]::text[]
  ),
  created_at timestamptz not null default now(),
  unique (id, company_id)
);
create unique index rollen_naam_uniek on public.rollen (company_id, lower(btrim(naam)));

create trigger rollen_set_company_id before insert on public.rollen
  for each row execute function public.set_company_id();

alter table public.rollen enable row level security;

-- Iedereen van het bedrijf mag de rollen zien (de app toont je eigen rol).
create policy "Zie rollen van eigen bedrijf" on public.rollen
  for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Rollen maken en wijzigen blijft bij de eigenaar, ook voor wie het recht
-- "instellingen_team" heeft: anders kan iemand zichzelf alle rechten geven.
create policy "Eigenaar maakt rollen" on public.rollen
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));
create policy "Eigenaar wijzigt rollen" on public.rollen
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()))
  with check (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));
create policy "Eigenaar verwijdert rollen" on public.rollen
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- De rol van een medewerker. Samen met company_id, zodat een rol van een ander
-- bedrijf nooit te koppelen is. Wordt een rol verwijderd, dan houdt de
-- medewerker geen rechten over (alleen rol_id wordt leeg, company_id blijft).
alter table public.employees add column rol_id uuid;
alter table public.employees
  add constraint employees_rol_fkey foreign key (rol_id, company_id)
  references public.rollen (id, company_id) on delete set null (rol_id);
create index employees_rol_id_idx on public.employees (rol_id);

-- Heeft de ingelogde gebruiker dit recht? De eigenaar altijd.
-- In policies gebruiken als (select public.heeft_recht('planning')).
create or replace function public.heeft_recht(recht text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    left join public.rollen r on r.id = e.rol_id and r.company_id = e.company_id
    where e.id = auth.uid()
      and (e.rol = 'eigenaar' or recht = any (coalesce(r.rechten, '{}')))
  )
$$;
revoke execute on function public.heeft_recht(text) from public, anon;
grant execute on function public.heeft_recht(text) to authenticated, service_role;
