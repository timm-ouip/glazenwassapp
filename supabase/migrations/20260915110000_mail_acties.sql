-- Twee dingen die de knoppen in het postvak nodig hebben.

-- 1. Waar een mail vandaan kwam voordat hij in de prullenbak ging. Terugzetten
--    hoort hem daar terug te zetten: een weggegooide verzonden mail hoort in
--    Verzonden, niet in het postvak.
alter table public.berichten
  add column if not exists vorige_map_id uuid references public.mail_mappen(id) on delete set null;

-- 2. Elke poging om te versturen, vóór het versturen zelf. De limiet (hoeveel
--    mails per paar minuten) telt hierop. Tellen op de kopie in Verzonden zou
--    niets tellen als die kopie mislukt, en dan is er geen rem meer.
create table public.mail_verzendpogingen (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxen(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index mail_verzendpogingen_idx
  on public.mail_verzendpogingen (mailbox_id, created_at desc);

-- Alleen de Edge Function schrijft en leest hier.
alter table public.mail_verzendpogingen enable row level security;
revoke all on public.mail_verzendpogingen from anon, authenticated;
