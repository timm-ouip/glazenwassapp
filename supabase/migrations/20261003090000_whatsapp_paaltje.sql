-- WhatsApp, fase 3: Paaltje leest WhatsApp en antwoordt waar dat mag.
--
-- 1. Per categorie: mag Paaltje een WhatsApp zelf beantwoorden. Standaard
--    alleen bij overslaan en bij vragen over de planning (nieuwe categorie).
-- 2. Per bedrijf: hoe lang Paaltje wacht (jij kunt eerst zelf antwoorden) en
--    tussen welke tijden hij antwoordt.
-- 3. Per bericht: het antwoord dat Paaltje heeft ingepland, en wat ermee
--    gebeurde. De planner verstuurt het als de wachttijd voorbij is en
--    niemand intussen zelf antwoordde.
-- 4. Per klant: of hij WhatsApp heeft uitgezet ("stop").

-- ---------------------------------------------------------------------
-- 1. Categorieën
-- ---------------------------------------------------------------------

alter table public.mail_categorieen drop constraint if exists mail_categorieen_sleutel_check;
alter table public.mail_categorieen
  add constraint mail_categorieen_sleutel_check
  check (sleutel in ('klachten', 'nieuwe_klanten', 'afzeggingen', 'overslaan', 'prijsopvraging', 'planning', 'overig'));

alter table public.mail_categorieen
  add column if not exists zelf_antwoorden_whatsapp boolean not null default false;

create or replace function public.maak_standaard_categorieen(bedrijf uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mail_categorieen (company_id, sleutel, naam, zelfstandigheid, volgorde, zelf_antwoorden_whatsapp)
  values
    (bedrijf, 'klachten',       'Klachten',             'concept',          10, false),
    (bedrijf, 'nieuwe_klanten', 'Nieuwe klanten',       'concept_voorstel', 20, false),
    (bedrijf, 'afzeggingen',    'Afzeggingen',          'concept_voorstel', 30, false),
    (bedrijf, 'overslaan',      'Overslaan',            'concept_voorstel', 40, true),
    (bedrijf, 'prijsopvraging', 'Prijsopvraging',       'concept',          50, false),
    (bedrijf, 'planning',       'Vragen over planning', 'concept',          60, true),
    (bedrijf, 'overig',         'Overig',               'niets',            90, false)
  on conflict do nothing
$$;

revoke execute on function public.maak_standaard_categorieen(uuid) from public, anon, authenticated;

-- Bestaande bedrijven: de nieuwe categorie erbij, en overslaan mag zelf
-- antwoorden op WhatsApp (zoals gekozen).
select public.maak_standaard_categorieen(id) from public.companies;
update public.mail_categorieen set zelf_antwoorden_whatsapp = true where sleutel = 'overslaan';

-- ---------------------------------------------------------------------
-- 2. Wachttijd en tijden
-- ---------------------------------------------------------------------

alter table public.companies
  add column if not exists wa_wachttijd_min integer not null default 10
    check (wa_wachttijd_min between 0 and 240),
  add column if not exists wa_antwoord_van time not null default '07:00',
  add column if not exists wa_antwoord_tot time not null default '21:00';

-- ---------------------------------------------------------------------
-- 3. Het ingeplande antwoord
-- ---------------------------------------------------------------------

alter table public.berichten
  -- Wanneer Paaltje het antwoord mag versturen.
  add column if not exists wa_antwoord_op timestamptz,
  --   gepland     = wacht op de planner
  --   bezig       = de planner verstuurt het net
  --   verstuurd   = weg
  --   geannuleerd = niet verstuurd (jij antwoordde, of je zette het stop)
  --   mislukt     = WhatsApp weigerde het
  add column if not exists wa_antwoord_status text not null default ''
    check (wa_antwoord_status in ('', 'gepland', 'bezig', 'verstuurd', 'geannuleerd', 'mislukt')),
  add column if not exists wa_antwoord_reden text not null default '',
  -- Jij drukte op "Nu versturen": dan gelden de antwoordtijden niet.
  add column if not exists wa_antwoord_direct boolean not null default false;

create index if not exists berichten_wa_gepland_idx
  on public.berichten (wa_antwoord_op)
  where wa_antwoord_status in ('gepland', 'bezig');

-- ---------------------------------------------------------------------
-- 4. WhatsApp uitgezet door de klant
-- ---------------------------------------------------------------------

alter table public.klanten
  add column if not exists wa_afgemeld_op timestamptz;

alter table public.mail_wijzigingen drop constraint if exists mail_wijzigingen_soort_check;
alter table public.mail_wijzigingen
  add constraint mail_wijzigingen_soort_check
  check (soort in ('overslaan', 'stoppen', 'aanmelding', 'klant_email', 'whatsapp_afgemeld', 'whatsapp_antwoord'));

-- ---------------------------------------------------------------------
-- 5. De planner, elke minuut
-- ---------------------------------------------------------------------

select cron.unschedule('whatsapp-planner')
where exists (select 1 from cron.job where jobname = 'whatsapp-planner');

select cron.schedule(
  'whatsapp-planner',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/whatsapp-planner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-sleutel',
      (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_sleutel')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
