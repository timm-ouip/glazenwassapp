-- De assistent mag zelf doorvoeren, en alles wat hij aanpast komt in een rapport.
--
-- Tot nu toe stelde de assistent voor en klikte een mens op doorvoeren. Voor
-- "sla deze keer maar over" is dat een klik die niets toevoegt: de assistent
-- leest het goed, en het adres hoort gewoon van de planning af. Dus mag hij
-- het zelf, per bedrijf aan te zetten, en alleen als hij het zeker weet.
--
-- Zelf doen zonder dat iemand meekijkt vraagt wel om een spoor. Elke
-- aanpassing — automatisch of met de hand — komt in `mail_wijzigingen`, met
-- wat er vóór stond en wat erna. Daarmee is hij ook precies terug te draaien.

-- 1. Per bedrijf: mag hij zelf doorvoeren, en hoe klinken de antwoorden.
alter table public.companies
  -- Standaard uit: een nieuw bedrijf kiest dit zelf.
  add column if not exists mail_auto_doorvoeren boolean not null default false,
  -- Hoe het klaargezette antwoord moet klinken, in je eigen woorden: "u-vorm,
  -- kort, afsluiten met Groet, Timmie". Leeg is: gewone vriendelijke je-vorm.
  add column if not exists mail_schrijfstijl text not null default '';

-- 2. Op het bericht: was het doorvoeren automatisch?
alter table public.mail_antwoorden
  add column if not exists doorgevoerd_automatisch boolean not null default false;

-- 3. Het rapport.
create table public.mail_wijzigingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Op grond van welk bericht. On delete set null: het rapport blijft, ook als
  -- het bericht later wordt weggegooid.
  antwoord_id uuid references public.mail_antwoorden(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  -- Adres en klant als tekst, zoals ze op het moment van aanpassen heetten:
  -- een rapport hoort te blijven kloppen als de straat later hernoemd wordt.
  adres text not null default '',
  klant text not null default '',
  -- Voorlopig kan de assistent maar één ding aanpassen. De check houdt dat zo
  -- tot er bewust iets bij komt.
  soort text not null default 'overslaan' check (soort in ('overslaan')),
  maanden text[] not null default '{}',
  -- Wat er vóór en na stond. Overslaan kan de startmaand van een nieuw adres
  -- opschuiven, dus die hoort erbij.
  voor_overslaan text[] not null default '{}',
  voor_start_maand text not null default '',
  na_overslaan text[] not null default '{}',
  na_start_maand text not null default '',
  automatisch boolean not null default false,
  zekerheid numeric(3, 2),
  -- Wie het deed. Leeg bij automatisch.
  door uuid references public.employees(id) on delete set null,
  teruggedraaid_op timestamptz,
  teruggedraaid_door uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index mail_wijzigingen_company_idx
  on public.mail_wijzigingen (company_id, created_at desc);

create index mail_wijzigingen_antwoord_idx
  on public.mail_wijzigingen (antwoord_id)
  where antwoord_id is not null;

create trigger mail_wijzigingen_set_company_id before insert on public.mail_wijzigingen
  for each row execute function public.set_company_id();

alter table public.mail_wijzigingen enable row level security;
create policy "Bedrijf beheert eigen mailwijzigingen" on public.mail_wijzigingen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
