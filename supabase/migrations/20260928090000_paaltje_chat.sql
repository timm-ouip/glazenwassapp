-- Paaltje als assistent in heel Wooshy.
--
-- Iedereen van het bedrijf kan met Paaltje praten. Hij zoekt klantgegevens op
-- en zet wijzigingen klaar als voorstel; hij voert zelf nooit iets door. Wie
-- het recht heeft, drukt op Doorvoeren. Wie dat niet heeft, stuurt het als
-- aanvraag naar iemand die het wél mag; die mag het voorstel nog aanpassen.
--
-- Alles wat Paaltje schrijft gaat via de Edge Function `paaltje-chat` met de
-- service role, die zelf de rechten van de vrager controleert. Vanuit de app
-- is hier daarom alleen lezen toegestaan.

-- 1. Wat een snelkeuze betekent (H = helemaal, VH = voorkant helemaal, …).
--    Paaltje leest dit om te snappen welke code hij moet omwisselen.
alter table public.quick_notes
  add column if not exists omschrijving text not null default ''
  check (length(omschrijving) <= 300);

-- 2. Hoeveel berichten Paaltje per dag voor een bedrijf beantwoordt.
alter table public.companies
  add column if not exists paaltje_daglimiet integer not null default 200
  check (paaltje_daglimiet between 0 and 5000);

-- 3. Het gesprek, per medewerker. Een paar dagen bewaard (de functie kijkt
--    niet verder terug en ruimt ouder dan 7 dagen op).
create table public.paaltje_berichten (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  rol text not null check (rol in ('gebruiker', 'paaltje')),
  tekst text not null default '' check (length(tekst) <= 8000),
  voorstel_id uuid,
  created_at timestamptz not null default now()
);
create index paaltje_berichten_gesprek_idx
  on public.paaltje_berichten (employee_id, created_at desc);
create index paaltje_berichten_bedrijf_dag_idx
  on public.paaltje_berichten (company_id, created_at)
  where rol = 'gebruiker';

alter table public.paaltje_berichten enable row level security;

create policy "Eigen gesprek met Paaltje lezen" on public.paaltje_berichten
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and employee_id = (select auth.uid())
  );

-- 4. Voorstellen en aanvragen. Dit is ook het logboek: wie vroeg wat, wat er
--    gevraagd en wat er doorgevoerd is, en de oude waarden voor Ongedaan maken.
--
--    status:
--      open          Paaltje zette het klaar, de vrager moet nog kiezen
--      te_keuren     de vrager mocht het niet zelf; wacht op iemand met rechten
--      doorgevoerd   staat in de database
--      afgewezen     door de keurder (met reden)
--      geannuleerd   door de vrager zelf
--      teruggedraaid na doorvoeren weer ongedaan gemaakt
--
--    gevraagd / doorgevoerd: lijst regels, zie `_gedeeld/paaltje-chat.ts`
--    (`Regel`). doorgevoerd is null tot het doorgevoerd is.
create table public.paaltje_voorstellen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  aangevraagd_door uuid references public.employees(id) on delete set null,
  status text not null default 'open' check (
    status in ('open', 'te_keuren', 'doorgevoerd', 'afgewezen', 'geannuleerd', 'teruggedraaid')
  ),
  samenvatting text not null default '' check (length(samenvatting) <= 500),
  gevraagd jsonb not null default '[]',
  doorgevoerd jsonb,
  aangepast_door_keurder boolean not null default false,
  afgehandeld_door uuid references public.employees(id) on delete set null,
  afgehandeld_op timestamptz,
  reden text not null default '' check (length(reden) <= 500),
  teruggedraaid_door uuid references public.employees(id) on delete set null,
  teruggedraaid_op timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
create index paaltje_voorstellen_te_keuren_idx
  on public.paaltje_voorstellen (company_id, created_at desc)
  where status = 'te_keuren';
create index paaltje_voorstellen_vrager_idx
  on public.paaltje_voorstellen (aangevraagd_door, created_at desc);

create trigger update_paaltje_voorstellen_updated_at
  before update on public.paaltje_voorstellen
  for each row execute function public.update_updated_at_column();

alter table public.paaltje_berichten
  add constraint paaltje_berichten_voorstel_fkey
  foreign key (voorstel_id) references public.paaltje_voorstellen(id) on delete set null;

alter table public.paaltje_voorstellen enable row level security;

-- Je eigen voorstellen zie je altijd; wie klanten mag bewerken ziet alles van
-- het bedrijf (de lijst "Te keuren" en het logboek).
create policy "Voorstellen van Paaltje lezen" on public.paaltje_voorstellen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      aangevraagd_door = (select auth.uid())
      or (select public.heeft_recht('klanten_bewerken'))
    )
  );

-- 5. Verbruik per dag, voor de daglimiet en om te laten zien in Instellingen.
create table public.paaltje_verbruik (
  company_id uuid not null references public.companies(id) on delete cascade,
  dag date not null,
  berichten integer not null default 0,
  invoer_tokens bigint not null default 0,
  uitvoer_tokens bigint not null default 0,
  primary key (company_id, dag)
);

alter table public.paaltje_verbruik enable row level security;

create policy "Eigenaar ziet verbruik van Paaltje" on public.paaltje_verbruik
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- Tellen in één stap, zodat twee gelijktijdige berichten elkaar niet
-- overschrijven. Alleen voor de server.
create or replace function public.paaltje_verbruik_tellen(
  bedrijf uuid, invoer bigint, uitvoer bigint, extra_bericht integer default 1
)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.paaltje_verbruik (company_id, dag, berichten, invoer_tokens, uitvoer_tokens)
  values (bedrijf, (now() at time zone 'Europe/Amsterdam')::date, extra_bericht, invoer, uitvoer)
  on conflict (company_id, dag) do update
    set berichten = paaltje_verbruik.berichten + excluded.berichten,
        invoer_tokens = paaltje_verbruik.invoer_tokens + excluded.invoer_tokens,
        uitvoer_tokens = paaltje_verbruik.uitvoer_tokens + excluded.uitvoer_tokens
  returning berichten;
$$;
revoke all on function public.paaltje_verbruik_tellen(uuid, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.paaltje_verbruik_tellen(uuid, bigint, bigint, integer) to service_role;
