-- Subgroepen van straten binnen een wijk.
--
-- Een wijk kan zo groot zijn dat je hem in stukken rijdt: "Noordkant",
-- "Achter het park". Zo'n stuk krijgt een naam, is in te klappen, en gaat in
-- één handeling op een wasdag. Zie docs/subgroepen-van-straten.md.
--
-- Een groep hoort bij precies één wijk, ook als er nog geen straat in zit —
-- vandaar district_id op de groep zelf en niet alleen op de straat. Anders
-- bestaat een lege groep nergens en valt hij niet te vullen.
--
-- GEEN deleted_at, anders dan bij districts, streets en customers. Een groep
-- is niets om terug te kunnen halen: er zit geen werk in dat verloren gaat.
-- Verwijder je hem, dan blijven de straten en al hun adressen staan en vallen
-- ze alleen terug op "geen groep"; opnieuw aanmaken is een paar klikken.
-- Dezelfde afweging als bij wasdag_regels.

create table public.straat_groepen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  district_id uuid not null references public.districts(id) on delete cascade,
  naam text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- De vraag die de app stelt is altijd "de groepen van deze wijk, op volgorde".
create index straat_groepen_wijk_idx
  on public.straat_groepen (company_id, district_id, sort_order);

create trigger straat_groepen_set_company_id before insert on public.straat_groepen
  for each row execute function public.set_company_id();

alter table public.straat_groepen enable row level security;

-- Eén policy voor alles, zoals bij wasdag_regels: wie bij het bedrijf hoort
-- mag de groepen van dat bedrijf zien en wijzigen, en niets anders.
--
-- current_company_id() staat in een subquery. In een policy is een
-- functieaanroep voor Postgres iets dat per rij herhaald wordt; in een
-- subquery ziet de planner dat er niets in staat wat per rij verandert en
-- rekent hij hem één keer per query uit. In current_company_id() zit
-- auth.uid(), dus zonder die haakjes betaal je die kosten voor elke rij. Zie
-- 20260908120000_rls_auth_uid_eenmalig.sql.
create policy "Bedrijf beheert eigen straatgroepen" on public.straat_groepen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- De verwijzing vanaf de straat. Leeg = deze straat zit in geen enkele groep;
-- die straten staan gewoon los onder de groepen op de wijkpagina.
--
-- on delete set null is wat het verwijderen van een groep ongevaarlijk maakt:
-- de groeprij verdwijnt, de straten blijven staan met een leeg groep_id. Een
-- straat mag nooit met een groep meeverdwijnen.
alter table public.streets
  add column if not exists groep_id uuid
  references public.straat_groepen(id) on delete set null;

-- Voor "welke straten zitten in deze groep". Gedeeltelijk, net als de andere
-- straten-indexen: wat weggelegd is vraag je hier nooit op.
create index streets_groep_idx
  on public.streets (groep_id) where deleted_at is null;
