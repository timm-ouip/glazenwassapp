-- Mail zoals in een mailprogramma: altijd naar spam, herinneringen, later
-- versturen en een gesprek als draad.

-- ---------------------------------------------------------------------
-- 1. Altijd naar spam (per afzender)
-- ---------------------------------------------------------------------

create table public.mail_regels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxen(id) on delete cascade,
  van_email text not null check (van_email <> '' and van_email = lower(trim(van_email))),
  actie text not null default 'spam' check (actie in ('spam')),
  created_at timestamptz not null default now(),
  unique (mailbox_id, van_email)
);

alter table public.mail_regels enable row level security;
create policy "Lezen met recht" on public.mail_regels for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('mail_lezen')));

-- ---------------------------------------------------------------------
-- 2. Herinneringen: op dat moment staat de mail in "Wacht op jou"
-- ---------------------------------------------------------------------

alter table public.berichten add column if not exists herinner_op timestamptz;

create index if not exists berichten_herinner_idx
  on public.berichten (map_id, herinner_op)
  where herinner_op is not null;

-- ---------------------------------------------------------------------
-- 3. Later versturen
-- ---------------------------------------------------------------------

create table public.geplande_mails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxen(id) on delete cascade,
  door uuid,
  -- Alles wat versturen nodig heeft (aan, cc, onderwerp, tekst, bijlagen…).
  inhoud jsonb not null,
  -- Voor de lijst, zodat die niet de hele inhoud met bijlagen hoeft op te halen.
  onderwerp text not null default '',
  aan_tekst text not null default '',
  versturen_op timestamptz not null,
  status text not null default 'wacht'
    check (status in ('wacht', 'bezig', 'verstuurd', 'mislukt', 'geannuleerd')),
  fout text not null default '',
  verstuurd_op timestamptz,
  created_at timestamptz not null default now()
);

create index geplande_mails_wacht_idx on public.geplande_mails (versturen_op) where status = 'wacht';

alter table public.geplande_mails enable row level security;
create policy "Lezen met recht" on public.geplande_mails for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('mail_lezen')));

-- De planner pakt mails op zonder dat twee rondes dezelfde versturen.
create or replace function public.geplande_mails_oppakken(maximaal integer)
returns setof public.geplande_mails
language sql
security definer
set search_path = public
as $$
  update public.geplande_mails g
     set status = 'bezig'
   where g.id in (
     select id from public.geplande_mails
      where status = 'wacht' and versturen_op <= now()
      order by versturen_op
      limit maximaal
      for update skip locked
   )
  returning g.*;
$$;

revoke execute on function public.geplande_mails_oppakken(integer) from public, anon, authenticated;

-- Blijft er een mail op "bezig" hangen (functie viel om), dan na een kwartier
-- op "mislukt": liever melden dan misschien twee keer versturen.
create or replace function public.geplande_mails_opruimen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.geplande_mails
     set status = 'mislukt', fout = 'Het versturen bleef hangen. Kijk in Verzonden of hij toch weg is.'
   where status = 'bezig' and versturen_op < now() - interval '15 minutes';
$$;

revoke execute on function public.geplande_mails_opruimen() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Een gesprek als draad
-- ---------------------------------------------------------------------

-- Alle mail uit hetzelfde gesprek als deze: via Message-ID, In-Reply-To en
-- References. Security invoker: RLS op berichten geldt gewoon.
create or replace function public.gesprek_van(bericht uuid)
returns table (
  id uuid,
  richting text,
  van_naam text,
  van_email text,
  onderwerp text,
  fragment text,
  ontvangen_op timestamptz,
  op_server boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with deze as (
    select b.mailbox_id, b.message_id, b.in_reply_to, b.referenties
      from public.berichten b
     where b.id = bericht
  ),
  sleutels as (
    select distinct s as sleutel
      from deze, unnest(array[deze.message_id, deze.in_reply_to] || deze.referenties) s
     where s <> ''
  )
  select b.id, b.richting, b.van_naam, b.van_email, b.onderwerp, b.fragment, b.ontvangen_op, b.op_server
    from public.berichten b, deze
   where b.mailbox_id = deze.mailbox_id
     and b.deleted_at is null
     and (
       b.message_id in (select sleutel from sleutels)
       or b.in_reply_to in (select sleutel from sleutels)
       or b.referenties && (select coalesce(array_agg(sleutel), '{}') from sleutels)
     )
   order by b.ontvangen_op
   limit 50;
$$;

grant execute on function public.gesprek_van(uuid) to authenticated;

create index if not exists berichten_in_reply_to_idx
  on public.berichten (mailbox_id, in_reply_to)
  where in_reply_to <> '';

-- ---------------------------------------------------------------------
-- 5. De planner, elke minuut
-- ---------------------------------------------------------------------

select cron.schedule(
  'mail-planner',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/mail-planner',
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
