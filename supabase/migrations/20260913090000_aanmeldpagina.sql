-- De aanmeldpagina: klanten vullen zelf hun naam en nummer in.
--
-- De klantenlijst komt grotendeels uit de Excel-import: honderden adresregels
-- met een straat, een huisnummer en een prijs, maar zonder naam, telefoon of
-- e-mail. Die gegevens ophalen betekende aanbellen, opschrijven en intypen.
--
-- Met een QR-code op de bus of op een flyer vult de klant dat zelf in: hij
-- typt zijn postcode en huisnummer, wij zoeken straat en plaats erbij, en zijn
-- gegevens komen bij de adresregel die er al staat. Wie niet op de lijst staat
-- mag zijn gegevens achterlaten, maar dat wordt géén klant: daar hoort eerst
-- een wijk en een prijs bij, en die bepaalt de glazenwasser zelf.

-- 1. Het bedrijf krijgt één eigen aanmeldlink.
--
-- Een token en niet het bedrijfs-id in de URL: een id staat in de database en
-- lekt via een foutmelding of een gedeelde link makkelijk uit, en je kunt het
-- nooit intrekken. Een token gooi je weg en maak je opnieuw. Standaard uit,
-- want een link die openstaat terwijl je hem niet gebruikt is alleen maar een
-- openstaande deur.
alter table public.companies
  add column if not exists aanmeld_token text,
  add column if not exists aanmeld_aan boolean not null default false;

-- Twaalf tekens uit een uuid: kort genoeg voor een leesbare link, lang genoeg
-- om niet te raden te zijn (16^12, oftewel ruim 280 biljoen mogelijkheden).
create or replace function public.nieuw_aanmeld_token()
returns text
language sql
volatile
as $$
  select substr(md5(gen_random_uuid()::text), 1, 12)
$$;

update public.companies
  set aanmeld_token = public.nieuw_aanmeld_token()
  where aanmeld_token is null;

alter table public.companies
  alter column aanmeld_token set default public.nieuw_aanmeld_token(),
  alter column aanmeld_token set not null;

-- Unique, want de token is de enige sleutel waarmee de publieke pagina een
-- bedrijf opzoekt: twee bedrijven met dezelfde token zou betekenen dat de
-- gegevens van de een bij de ander landen.
create unique index if not exists companies_aanmeld_token_idx
  on public.companies (aanmeld_token);

-- 2. Het stempel op een adres dat zichzelf heeft aangevuld.
--
-- Een datum en geen vlag, in tegenstelling tot `geimporteerd`: hier is wanneer
-- het gebeurde juist het nieuws ("gisteren kwamen er drie binnen"), en het
-- stempel gaat weer weg zodra de glazenwasser het gezien heeft. Leeg is dus
-- het gewone geval, en daarom geen default.
alter table public.customers
  add column if not exists aangemeld_op timestamptz;

create index if not exists customers_aangemeld_idx
  on public.customers (company_id, aangemeld_op desc)
  where aangemeld_op is not null;

-- 3. Het postvak: alles wat er via de pagina binnenkomt.
--
-- Ook wat automatisch is verwerkt blijft hier staan. Dat is het enige plekje
-- waar te zien is wat de klant zélf heeft getypt — handig bij een rare regel,
-- en het is de teller waarmee de rem tegen misbruik werkt.
create table public.aanmeldingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Waar het terechtkwam. Beide on delete set null: een weggegooid adres of
  -- een weggegooide klant mag de logregel niet meenemen.
  customer_id uuid references public.customers(id) on delete set null,
  klant_id uuid references public.klanten(id) on delete set null,
  -- Precies wat er is ingevuld, letterlijk, ook als het nergens op paste.
  naam text not null default '',
  email text not null default '',
  telefoon text not null default '',
  postcode text not null default '',
  straat text not null default '',
  -- Tekst zoals op klanten: "12a" en "61 bis" zijn geen getal. Het gesplitste
  -- huisnummer staat op de customers-rij waar dit naartoe ging.
  huisnummer text not null default '',
  toevoeging text not null default '',
  plaats text not null default '',
  -- Wat de server ervan maakte:
  --   gekoppeld  = adres gevonden en nog leeg, gegevens staan er nu bij
  --   wijziging  = adres gevonden maar er stonden al gegevens, niks aangeraakt
  --   onbekend   = geen of meerdere passende adressen, niks aangemaakt
  soort text not null check (soort in ('gekoppeld', 'wijziging', 'onbekend')),
  -- 'gekoppeld' is meteen klaar; de andere twee wachten op een mens.
  status text not null default 'open' check (status in ('open', 'klaar', 'geweigerd')),
  -- Voor de rem: hoeveel kwamen er van dit adres in de laatste minuten. Geen
  -- persoonsgegeven dat we willen tonen, alleen om te tellen.
  ip text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index aanmeldingen_company_idx
  on public.aanmeldingen (company_id, created_at desc);

-- Het telletje in de zijbalk vraagt precies deze rijen op, en niks anders.
create index aanmeldingen_open_idx
  on public.aanmeldingen (company_id)
  where status = 'open' and deleted_at is null;

-- Voor de rem tegen misbruik: tellen per bedrijf binnen een tijdvak.
create index aanmeldingen_rem_idx
  on public.aanmeldingen (company_id, created_at desc, ip);

create trigger aanmeldingen_set_company_id before insert on public.aanmeldingen
  for each row execute function public.set_company_id();

alter table public.aanmeldingen enable row level security;

-- Alleen het eigen bedrijf komt erbij. De publieke pagina schrijft hier niet
-- zelf: die gaat langs een server-functie met de service-role-sleutel, want
-- een bezoeker is niet ingelogd en heeft dus geen enkel recht op deze tabel.
create policy "Bedrijf beheert eigen aanmeldingen" on public.aanmeldingen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
