-- Aankondigingsmail: "morgen komen we ramen wassen".
--
-- Een wasdag is een selectie adressen bij een datum. Die adressen hangen aan
-- klanten, en een klant heeft een e-mailadres. Daarmee is de ontvangerslijst
-- van een aankondiging niets anders dan: de dag, langs de adressen, naar de
-- mensen. Nergens een aparte mailinglijst die na een maand niet meer klopt.
--
-- Het versturen zelf gaat langs Brevo, in een Edge Function. Hier staat wat
-- eromheen hoort: wie de afzender is, wat er verstuurd is, naar wie, en wat
-- er terugkwam.

-- ---------------------------------------------------------------------
-- 1. De afzender en het antwoordadres van het bedrijf
-- ---------------------------------------------------------------------

-- Afzendernaam en -adres per bedrijf, want dit is een app voor meer dan één
-- glazenwasser. Leeg is: er is nog niks ingesteld, en dan weigert de Edge
-- Function te versturen — liever een melding dan een mail van "noreply".
alter table public.companies
  add column if not exists mail_afzender_naam text not null default '',
  add column if not exists mail_afzender_email text not null default '';

-- De sleutel in het antwoordadres: antwoord+<token>@<inbox-domein>. Een
-- binnenkomende mail draagt zo zelf bij welk bedrijf hij hoort — de inbox-
-- functie staat open op internet en mag niet op afzender alleen vertrouwen.
-- Zelfde afweging als bij aanmeld_token: een token trek je in, een id niet.
alter table public.companies
  add column if not exists mail_token text;

update public.companies
  set mail_token = public.nieuw_aanmeld_token()
  where mail_token is null;

alter table public.companies
  alter column mail_token set default public.nieuw_aanmeld_token(),
  alter column mail_token set not null;

create unique index if not exists companies_mail_token_idx
  on public.companies (mail_token);

-- ---------------------------------------------------------------------
-- 2. Wat er verstuurd is
-- ---------------------------------------------------------------------

create table public.mailingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- De wasdag waar de selectie vandaan kwam. Geen foreign key: een wasdag is
  -- geen rij maar een datum met regels eraan. Blijft staan als die dag later
  -- leeggemaakt wordt — de mail is dan nog steeds de deur uit gegaan.
  datum date,
  onderwerp text not null,
  tekst text not null,
  -- Een proef gaat alleen naar jezelf. Staat in dezelfde tabel en niet apart,
  -- want je wilt in het overzicht zien dát je getest hebt.
  test boolean not null default false,
  aantal integer not null default 0,
  mislukt integer not null default 0,
  verzonden_door uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index mailingen_company_idx
  on public.mailingen (company_id, created_at desc);

create trigger mailingen_set_company_id before insert on public.mailingen
  for each row execute function public.set_company_id();

-- Naar wie het ging, en of het aankwam. Eén regel per adres: dezelfde klant
-- met twee panden op één dag krijgt één mail, maar beide adressen staan erin.
create table public.mail_ontvangers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailing_id uuid not null references public.mailingen(id) on delete cascade,
  -- Allebei on delete set null: een weggegooid adres of een weggegooide klant
  -- mag de verzendgeschiedenis niet meenemen.
  klant_id uuid references public.klanten(id) on delete set null,
  email text not null,
  naam text not null default '',
  -- De adressen zoals ze in de mail stonden, als tekst. Bewust geplat: je wilt
  -- later kunnen zien wat er stond, ook als de straat intussen hernoemd is.
  adressen text not null default '',
  status text not null default 'verzonden' check (status in ('verzonden', 'mislukt')),
  fout text not null default '',
  created_at timestamptz not null default now()
);

create index mail_ontvangers_mailing_idx
  on public.mail_ontvangers (mailing_id);

-- Het antwoordadres opzoeken als er een reactie binnenkomt: van wie kwam die,
-- en op welke aankondiging sloeg hij.
create index mail_ontvangers_email_idx
  on public.mail_ontvangers (company_id, email, created_at desc);

create trigger mail_ontvangers_set_company_id before insert on public.mail_ontvangers
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 3. Wat er terugkwam
-- ---------------------------------------------------------------------

-- Antwoorden van klanten, met wat de assistent ervan gemaakt heeft. De
-- assistent stelt voor, hij doet niet: `voorstel_maanden` is pas echt zodra
-- iemand op doorvoeren klikt, en `doorgevoerd_op` legt vast wanneer dat was.
create table public.mail_antwoorden (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailing_id uuid references public.mailingen(id) on delete set null,
  klant_id uuid references public.klanten(id) on delete set null,

  -- Letterlijk wat er binnenkwam. Dit is het enige plekje waar staat wat de
  -- klant zelf schreef; alles daaronder is uitleg van de assistent.
  van_naam text not null default '',
  van_email text not null default '',
  onderwerp text not null default '',
  tekst text not null default '',
  ontvangen_op timestamptz not null default now(),
  -- De id die Brevo eraan gaf. Unique per bedrijf, want een webhook mag twee
  -- keer afgaan en dan hoort er niet twee keer hetzelfde in het postvak.
  bericht_id text not null default '',

  -- Wat de assistent ervan maakte:
  --   overslaan  = deze keer niet, wel gewoon klant blijven
  --   afmelden   = helemaal stoppen
  --   verzetten  = liever een andere dag
  --   vraag      = wil iets weten
  --   akkoord    = prima, tot dan
  --   anders     = hier moet een mens naar kijken
  categorie text not null default 'anders'
    check (categorie in ('overslaan', 'afmelden', 'verzetten', 'vraag', 'akkoord', 'anders')),
  samenvatting text not null default '',
  -- De maanden ('jjjj-mm') waar het over gaat, zoals de assistent ze leest.
  -- Precies de vorm van customers.overslaan, zodat doorvoeren niets meer is
  -- dan die maanden erbij zetten.
  voorstel_maanden text[] not null default '{}',
  -- De adressen waar het voorstel over gaat. Vastgelegd op het moment van
  -- lezen, zodat doorvoeren later niet ineens iets anders raakt.
  voorstel_adressen uuid[] not null default '{}',
  -- Het klaargezette antwoord. Gaat pas weg als iemand op versturen klikt.
  concept text not null default '',
  -- Hoe zeker de assistent is (0-1). Onder de streep zetten we geen voorstel
  -- klaar; het bericht komt dan gewoon als 'anders' in het postvak.
  zekerheid numeric(3, 2) not null default 0,
  -- Leeg als het lezen lukte. Staat er iets, dan is het bericht wél bewaard
  -- maar niet gelezen — een mens moet er dan zelf naar kijken.
  ai_fout text not null default '',

  status text not null default 'nieuw' check (status in ('nieuw', 'klaar', 'genegeerd')),
  doorgevoerd_op timestamptz,
  beantwoord_op timestamptz,
  deleted_at timestamptz
);

create index mail_antwoorden_company_idx
  on public.mail_antwoorden (company_id, ontvangen_op desc)
  where deleted_at is null;

-- Het telletje "er wacht post op je" vraagt precies deze rijen op.
create index mail_antwoorden_open_idx
  on public.mail_antwoorden (company_id)
  where status = 'nieuw' and deleted_at is null;

create unique index mail_antwoorden_bericht_idx
  on public.mail_antwoorden (company_id, bericht_id)
  where bericht_id <> '';

create trigger mail_antwoorden_set_company_id before insert on public.mail_antwoorden
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 4. Slot op de deur
-- ---------------------------------------------------------------------

-- Dezelfde vorm als de rest van de app: wie bij het bedrijf hoort mag alles
-- van zijn eigen bedrijf, en verder niets. De Edge Functions schrijven hier
-- met de service-role-sleutel — die gaat langs RLS heen en bepaalt zelf, uit
-- de token of uit de ingelogde gebruiker, om welk bedrijf het gaat.

alter table public.mailingen enable row level security;
create policy "Bedrijf beheert eigen mailingen" on public.mailingen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

alter table public.mail_ontvangers enable row level security;
create policy "Bedrijf beheert eigen ontvangers" on public.mail_ontvangers
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

alter table public.mail_antwoorden enable row level security;
create policy "Bedrijf beheert eigen mailantwoorden" on public.mail_antwoorden
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
