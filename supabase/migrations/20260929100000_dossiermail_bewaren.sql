-- Nazorg op mail en klachten in het dossier (na de code-review).
--
-- 1. "Uit het dossier halen" is iets anders dan de mail weggooien: hij blijft
--    in het postvak en in de mailbox staan. Daarom een eigen kolom in plaats
--    van deleted_at (dat verborg hem ook in het postvak). Echt wissen kan pas
--    als hij ook uit de mailbox weg is; anders haalt de volgende ophaalronde
--    hem gewoon weer binnen.
-- 2. Klantmail overleeft een verdwenen map of een andere mailbox: de mail
--    blijft staan zonder map, en alleen mail zonder klant gaat mee weg.
-- 3. Een klacht blijft af te handelen als zijn adres intussen bij een andere
--    klant hoort (verhuisd): het adres wordt alleen gecontroleerd als het
--    verandert.
-- 4. De omgezette oude klachten krijgen de datum van hun mail, zodat het
--    dagrapport ze niet als nieuw meldt.

-- ---------------------------------------------------------------------
-- 1. Uit het dossier
-- ---------------------------------------------------------------------

alter table public.berichten add column if not exists uit_dossier_op timestamptz;

-- Wat al met deleted_at uit een dossier gehaald was, gaat over op de nieuwe kolom.
update public.berichten
   set uit_dossier_op = deleted_at, deleted_at = null
 where deleted_at is not null and klant_id is not null;

create or replace function public.bericht_uit_dossier(bericht uuid, weg boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_eigenaar()) then
    raise exception 'Alleen de eigenaar mag een mail uit het dossier halen.' using errcode = '42501';
  end if;
  update public.berichten
     set uit_dossier_op = case when weg then now() else null end
   where id = bericht
     and company_id = (select public.current_company_id());
end
$$;

create or replace function public.bericht_echt_wissen(bericht uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rij record;
begin
  if not (select public.is_eigenaar()) then
    raise exception 'Alleen de eigenaar mag een mail wissen.' using errcode = '42501';
  end if;
  select op_server, uit_dossier_op into rij
    from public.berichten
   where id = bericht
     and company_id = (select public.current_company_id());
  if not found or rij.uit_dossier_op is null then
    return;
  end if;
  if rij.op_server then
    raise exception 'Deze mail staat nog in je mailbox. Gooi hem daar eerst weg (ook uit de prullenbak van je mailbox); daarna kun je hem hier definitief wissen.'
      using errcode = 'P0001';
  end if;
  delete from public.berichten where id = bericht;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Klantmail blijft, ook zonder map of mailbox
-- ---------------------------------------------------------------------

alter table public.berichten alter column map_id drop not null;
alter table public.berichten alter column mailbox_id drop not null;

alter table public.berichten drop constraint if exists berichten_map_id_fkey;
alter table public.berichten
  add constraint berichten_map_id_fkey foreign key (map_id)
  references public.mail_mappen(id) on delete set null;

alter table public.berichten drop constraint if exists berichten_mailbox_id_fkey;
alter table public.berichten
  add constraint berichten_mailbox_id_fkey foreign key (mailbox_id)
  references public.mailboxen(id) on delete set null;

-- Een mailbox die weggaat (bijvoorbeeld een ander adres gekoppeld): mail
-- zonder klant gaat mee weg, klantmail blijft als archief in het dossier.
create or replace function public.mailboxen_mail_opruimen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.berichten where mailbox_id = old.id and klant_id is null;
  update public.berichten
     set op_server = false,
         weg_sinds = coalesce(weg_sinds, now()),
         paaltje_status = case when paaltje_status in ('wacht', 'bezig') then 'overslaan' else paaltje_status end
   where mailbox_id = old.id;
  return old;
end
$$;

revoke execute on function public.mailboxen_mail_opruimen() from public, anon, authenticated;

drop trigger if exists mailboxen_mail_opruimen on public.mailboxen;
create trigger mailboxen_mail_opruimen
  before delete on public.mailboxen
  for each row execute function public.mailboxen_mail_opruimen();

-- ---------------------------------------------------------------------
-- 3. Adres van een klacht alleen controleren als het verandert
-- ---------------------------------------------------------------------

create or replace function public.klachten_controleren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'afgehandeld' and new.afgehandeld_op is null then
    new.afgehandeld_op := now();
  elsif new.status = 'open' then
    new.afgehandeld_op := null;
  end if;
  if new.customer_id is not null
     and (tg_op = 'INSERT'
          or new.customer_id is distinct from old.customer_id
          or new.klant_id is distinct from old.klant_id)
     and not exists (
       select 1 from public.customers c
        where c.id = new.customer_id and c.klant_id = new.klant_id
     ) then
    raise exception 'Dat adres hoort niet bij deze klant.' using errcode = '23514';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Omgezette klachten: datum van de mail
-- ---------------------------------------------------------------------

update public.klachten
   set created_at = ontvangen_op
 where door_paaltje
   and gemaakt_door is null
   and created_at = '2026-09-16 12:05:32.107507+00';
