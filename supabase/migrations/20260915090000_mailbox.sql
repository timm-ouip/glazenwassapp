-- De complete mailbox in Wooshy.
--
-- Tot nu toe kwam alleen binnen wat klanten terugschreven op een aankondiging,
-- via een apart antwoordadres bij Brevo. Gewone post aan het eigen adres bleef
-- buiten beeld. Vanaf hier kijkt Wooshy zelf in de mailbox bij de provider
-- (IMAP), elke paar minuten, en houdt hier een spiegel bij: welke mappen er
-- zijn en welke mails erin staan.
--
-- De mailbox bij de provider blijft de baas. Wat daar verdwijnt, verdwijnt
-- hier ook uit beeld; wat Wooshy zelf toevoegt (straks: categorie, concept van
-- Paaltje) hangt aan de mail en reist mee als hij van map wisselt.
--
-- Mail van een bedrijf is privé — bank, leveranciers, soms iets persoonlijks.
-- Voorlopig ziet alleen de eigenaar hem, en dat staat hier in de database vast,
-- niet alleen in een verborgen knop.

-- ---------------------------------------------------------------------
-- 1. Wie is eigenaar
-- ---------------------------------------------------------------------

-- Zelfde vorm als current_company_id(): security definer, zodat de policy niet
-- zelf op employees hoeft te lezen. Straks komen er rechten per rol bij; dan
-- wordt dit een van de rechten in plaats van de enige toets.
create or replace function public.is_eigenaar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees where id = auth.uid() and rol = 'eigenaar'
  )
$$;

-- ---------------------------------------------------------------------
-- 2. De mailbox en zijn wachtwoord
-- ---------------------------------------------------------------------

create table public.mailboxen (
  id uuid primary key default gen_random_uuid(),
  -- Eén mailbox per bedrijf. Wie er later twee wil, maakt dit uniek-slot los.
  company_id uuid not null unique references public.companies(id) on delete cascade,
  adres text not null,
  imap_host text not null default 'mail.mijndomein.nl',
  imap_poort integer not null default 993,
  smtp_host text not null default 'mail.mijndomein.nl',
  smtp_poort integer not null default 465,
  --   actief = ophalen gaat door; een storing bij de provider staat in `fout`
  --            en gaat vanzelf over
  --   fout   = inloggen werd geweigerd. Dan stopt het automatisch ophalen:
  --            elke twee minuten een fout wachtwoord proberen zet het account
  --            bij de provider op slot. Opnieuw koppelen zet hem weer aan.
  --   uit    = ontkoppeld; wachtwoord is weg, de opgehaalde mail blijft staan
  status text not null default 'actief' check (status in ('actief', 'fout', 'uit')),
  fout text not null default '',
  laatste_sync timestamptz,
  -- Slot tegen twee ophaalrondes tegelijk: wie begint zet hier een tijd in de
  -- toekomst, en een ronde die vastloopt geeft het slot vanzelf weer vrij.
  bezig_tot timestamptz,
  -- Hoe ver terug de eerste keer opgehaald wordt, en vanaf wanneer Paaltje
  -- mails indeelt. Vastgelegd bij het koppelen, zodat het niet elke dag een
  -- dag opschuift.
  import_vanaf timestamptz not null default (now() - interval '12 months'),
  paaltje_vanaf timestamptz not null default (now() - interval '30 days'),
  gekoppeld_door uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create trigger mailboxen_set_company_id before insert on public.mailboxen
  for each row execute function public.set_company_id();

-- Het wachtwoord, versleuteld met een sleutel die alleen de Edge Functions
-- kennen (MAIL_SLEUTEL). Aparte tabel met RLS aan en géén policy: vanuit de app
-- kan niemand erbij, ook de eigenaar niet. Alleen de service role leest hier.
create table public.mailbox_geheimen (
  mailbox_id uuid primary key references public.mailboxen(id) on delete cascade,
  versleuteld text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.mailbox_geheimen enable row level security;
revoke all on public.mailbox_geheimen from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Mappen
-- ---------------------------------------------------------------------

create table public.mail_mappen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxen(id) on delete cascade,
  -- Zoals de server hem noemt ("INBOX", "Sent"). De naam op het scherm maakt
  -- de app ervan, uit de rol.
  pad text not null,
  rol text not null default 'overig'
    check (rol in ('postvak', 'verzonden', 'concepten', 'prullenbak', 'spam', 'overig')),
  -- Verandert dit getal, dan heeft de server de nummering van de map opnieuw
  -- uitgedeeld en klopt geen enkel oud nummer meer.
  uidvalidity bigint,
  aantal integer not null default 0,
  ongelezen integer not null default 0,
  bijgewerkt_op timestamptz,
  unique (mailbox_id, pad)
);

-- ---------------------------------------------------------------------
-- 4. Berichten
-- ---------------------------------------------------------------------

create table public.berichten (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxen(id) on delete cascade,
  map_id uuid not null references public.mail_mappen(id) on delete cascade,
  -- Waar hij op de server staat. Samen met de map is dit het adres van de mail.
  uidvalidity bigint not null,
  uid bigint not null,

  -- Om gesprekken aan elkaar te rijgen, en om een mail terug te vinden als hij
  -- op de telefoon naar een andere map is verplaatst.
  message_id text not null default '',
  in_reply_to text not null default '',
  referenties text[] not null default '{}',

  richting text not null default 'in' check (richting in ('in', 'uit')),
  van_naam text not null default '',
  van_email text not null default '',
  -- [{naam, email}]
  aan jsonb not null default '[]',
  cc jsonb not null default '[]',
  antwoord_naar text not null default '',
  onderwerp text not null default '',
  -- Het begin van de tekst, voor de lijst. Dan hoeft die niet de hele mail op
  -- te halen om één regel te tonen.
  fragment text not null default '',
  tekst text not null default '',
  html text not null default '',
  -- [{naam, type, grootte}] — alleen wat erbij zat, niet de bestanden zelf.
  bijlagen jsonb not null default '[]',
  grootte integer not null default 0,
  -- Te grote mails halen we maar voor een deel op; dan staat dit aan.
  afgekapt boolean not null default false,
  ontvangen_op timestamptz not null,

  gelezen boolean not null default false,
  gemarkeerd boolean not null default false,

  klant_id uuid references public.klanten(id) on delete set null,

  -- Voor Paaltje (komt later): 'wacht' = moet nog gelezen worden,
  -- 'overslaan' = hoort hij niet te lezen (oud, verzonden, spam).
  paaltje_status text not null default 'overslaan'
    check (paaltje_status in ('overslaan', 'wacht', 'klaar', 'fout')),

  -- Niet meer op de server gevonden. Kan betekenen: verplaatst (dan duikt hij
  -- in een andere map op en koppelen we hem daar weer aan) of echt weg.
  op_server boolean not null default true,
  weg_sinds timestamptz,

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (map_id, uidvalidity, uid)
);

create index berichten_lijst_idx
  on public.berichten (map_id, ontvangen_op desc)
  where deleted_at is null and op_server;

create index berichten_message_id_idx
  on public.berichten (mailbox_id, message_id)
  where message_id <> '';

create index berichten_paaltje_idx
  on public.berichten (company_id)
  where paaltje_status = 'wacht';

create trigger berichten_set_company_id before insert on public.berichten
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 5. Slot op de deur: alleen de eigenaar
-- ---------------------------------------------------------------------

-- Lezen mag de eigenaar. Schrijven doen de Edge Functions (service role): die
-- houden de spiegel gelijk met de server, en een wijziging vanuit de app moet
-- ook naar de server — dat kan de database niet zelf.

alter table public.mailboxen enable row level security;
create policy "Eigenaar ziet eigen mailbox" on public.mailboxen
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

alter table public.mail_mappen enable row level security;
create policy "Eigenaar ziet eigen mappen" on public.mail_mappen
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

alter table public.berichten enable row level security;
create policy "Eigenaar ziet eigen berichten" on public.berichten
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- ---------------------------------------------------------------------
-- 6. Elke twee minuten ophalen
-- ---------------------------------------------------------------------

-- pg_cron klopt aan bij de Edge Function `mail-ophalen`. Het adres van het
-- project en de sleutel die de functie verwacht staan in Vault, niet hier: dit
-- bestand staat in git. Ontbreken ze, dan mislukt de aanroep stil in het
-- cron-logboek en gebeurt er verder niets.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mail-ophalen',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/mail-ophalen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-sleutel',
      (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_sleutel')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
