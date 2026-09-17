-- WhatsApp via Kapso.
--
-- Een bedrijf koppelt zijn eigen nummer via Kapso (een Meta-partner): de
-- eigenaar krijgt een link van Kapso, logt daar in bij Meta en kiest zijn
-- nummer uit de WhatsApp Business-app. Wooshy praat daarna met Kapso in
-- plaats van rechtstreeks met Meta. Het testnummer van Meta blijft werken.
--
-- 1. Per koppeling: via wie (meta of kapso) en welke webhook bij Kapso.
-- 2. Per bedrijf: zijn "customer" bij Kapso. Alleen de server leest en
--    schrijft dit; wie dit kan veranderen, kan het nummer van een ander
--    bedrijf opvragen.

alter table public.whatsapp_koppelingen
  add column if not exists aanbieder text not null default 'meta'
    check (aanbieder in ('meta', 'kapso')),
  add column if not exists kapso_webhook_id text not null default '';

create table if not exists public.kapso_klanten (
  company_id uuid primary key references public.companies(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.kapso_klanten enable row level security;
revoke all on public.kapso_klanten from anon, authenticated;
