-- Mail en klachten in het klantdossier.
--
-- 1. Mails van een klant blijven bewaard, ook als ze uit de mailbox weg zijn
--    (ophalen.ts wist ze dan niet meer). Alleen de eigenaar haalt een mail uit
--    het dossier, en dat is wegleggen (deleted_at), net als de rest van Wooshy.
-- 2. Ook verzonden mail hangt aan een klant: bij binnenkomst op het
--    aan-adres, en oude mails worden nagekoppeld zodra een adres bekend wordt.
-- 3. Klachten: een eigen regel bij de persoon, met optioneel het adres waar
--    hij over gaat. Paaltje maakt ze uit mail, een mens kan ze zelf invoeren
--    (telefoon, aan de deur, appje).

-- ---------------------------------------------------------------------
-- 1. Mails per klant snel vinden
-- ---------------------------------------------------------------------

create index if not exists berichten_klant_idx
  on public.berichten (klant_id, ontvangen_op desc)
  where klant_id is not null;

-- ---------------------------------------------------------------------
-- 2. Mail aan een klant koppelen op mailadres
-- ---------------------------------------------------------------------

-- De klant bij een mailadres, alleen als dat er precies één is. Een stel met
-- één gedeeld adres blijft dus ongekoppeld; daar kiest Paaltje of een mens.
create or replace function public.enige_klant_bij_email(bedrijf uuid, adres text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when count(distinct ke.klant_id) = 1 then min(ke.klant_id::text)::uuid end
  from public.klant_emails ke
  join public.klanten k on k.id = ke.klant_id and k.deleted_at is null
  where ke.company_id = bedrijf
    and ke.email = lower(trim(adres))
    and trim(coalesce(adres, '')) <> ''
$$;

revoke execute on function public.enige_klant_bij_email(uuid, text) from public, anon, authenticated;

-- De klant van een mail: bij binnenkomend de afzender, bij verzonden de
-- eerste ontvanger die bij precies één klant hoort.
create or replace function public.klant_van_bericht(
  bedrijf uuid,
  richting text,
  van_email text,
  aan jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ontvanger jsonb;
  gevonden uuid;
begin
  if richting = 'in' then
    return public.enige_klant_bij_email(bedrijf, van_email);
  end if;
  for ontvanger in select * from jsonb_array_elements(coalesce(aan, '[]'::jsonb)) loop
    gevonden := public.enige_klant_bij_email(bedrijf, ontvanger ->> 'email');
    if gevonden is not null then
      return gevonden;
    end if;
  end loop;
  return null;
end
$$;

revoke execute on function public.klant_van_bericht(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.berichten_klant_koppelen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.klant_id is null then
    new.klant_id := public.klant_van_bericht(new.company_id, new.richting, new.van_email, new.aan);
  end if;
  return new;
end
$$;

revoke execute on function public.berichten_klant_koppelen() from public, anon, authenticated;

drop trigger if exists berichten_klant_koppelen on public.berichten;
create trigger berichten_klant_koppelen
  before insert on public.berichten
  for each row execute function public.berichten_klant_koppelen();

-- Komt er een mailadres bij een klant, dan krijgen oude ongekoppelde mails
-- van en aan dat adres die klant alsnog.
create or replace function public.klant_emails_mails_nakoppelen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  klant uuid := public.enige_klant_bij_email(new.company_id, new.email);
begin
  if klant is null then
    return new;
  end if;
  update public.berichten b
     set klant_id = klant
   where b.company_id = new.company_id
     and b.klant_id is null
     and (
       (b.richting = 'in' and b.van_email = new.email)
       or (b.richting = 'uit' and b.aan @> jsonb_build_array(jsonb_build_object('email', new.email)))
     );
  return new;
end
$$;

revoke execute on function public.klant_emails_mails_nakoppelen() from public, anon, authenticated;

drop trigger if exists klant_emails_mails_nakoppelen on public.klant_emails;
create trigger klant_emails_mails_nakoppelen
  after insert on public.klant_emails
  for each row execute function public.klant_emails_mails_nakoppelen();

-- Eenmalig: alles wat er al staat nakoppelen.
update public.berichten b
   set klant_id = public.klant_van_bericht(b.company_id, b.richting, b.van_email, b.aan)
 where b.klant_id is null;

-- ---------------------------------------------------------------------
-- 3. Een mail uit het dossier halen (alleen de eigenaar)
-- ---------------------------------------------------------------------

-- Wegleggen en terugzetten. Echt wissen gebeurt vanuit de prullenbak.
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
     set deleted_at = case when weg then now() else null end
   where id = bericht
     and company_id = (select public.current_company_id());
end
$$;

revoke execute on function public.bericht_uit_dossier(uuid, boolean) from public, anon;
grant execute on function public.bericht_uit_dossier(uuid, boolean) to authenticated;

create or replace function public.bericht_echt_wissen(bericht uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select public.is_eigenaar()) then
    raise exception 'Alleen de eigenaar mag een mail wissen.' using errcode = '42501';
  end if;
  -- Alleen wat al in de prullenbak ligt.
  delete from public.berichten
   where id = bericht
     and company_id = (select public.current_company_id())
     and deleted_at is not null;
end
$$;

revoke execute on function public.bericht_echt_wissen(uuid) from public, anon;
grant execute on function public.bericht_echt_wissen(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Klachten
-- ---------------------------------------------------------------------

create table public.klachten (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- De persoon die klaagde.
  klant_id uuid not null,
  -- Het adres waar het over gaat; leeg = nog niet gekozen (dan geldt hij voor
  -- alle adressen van de klant).
  customer_id uuid,
  omschrijving text not null check (char_length(omschrijving) between 1 and 500),
  bron text not null default 'mail' check (bron in ('mail', 'telefoon', 'deur', 'app', 'anders')),
  ontvangen_op timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'afgehandeld')),
  afgehandeld_op timestamptz,
  -- Paaltje maakte hem: dan staat er "door Paaltje" en Ongedaan maken bij.
  door_paaltje boolean not null default false,
  gemaakt_door uuid default auth.uid(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (klant_id, company_id) references public.klanten(id, company_id) on delete cascade,
  foreign key (customer_id, company_id) references public.customers(id, company_id)
    on delete set null (customer_id),
  check ((status = 'open') = (afgehandeld_op is null))
);

create index klachten_klant_idx on public.klachten (klant_id, ontvangen_op desc);
create index klachten_open_idx on public.klachten (company_id) where status = 'open' and deleted_at is null;

create trigger klachten_set_company_id before insert on public.klachten
  for each row execute function public.set_company_id();

-- Status en datum kloppen altijd samen, en het adres hoort bij de klant.
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
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id = new.customer_id and c.klant_id = new.klant_id
  ) then
    raise exception 'Dat adres hoort niet bij deze klant.' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.klachten_controleren() from public, anon, authenticated;

create trigger klachten_controleren before insert or update on public.klachten
  for each row execute function public.klachten_controleren();

-- Welke mails bij een klacht horen. Een vervolgmail komt bij de open klacht.
create table public.klacht_berichten (
  klacht_id uuid not null,
  bericht_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (klacht_id, bericht_id),
  foreign key (klacht_id, company_id) references public.klachten(id, company_id) on delete cascade,
  foreign key (bericht_id, company_id) references public.berichten(id, company_id) on delete cascade
);

create index klacht_berichten_bericht_idx on public.klacht_berichten (bericht_id);

create trigger klacht_berichten_set_company_id before insert on public.klacht_berichten
  for each row execute function public.set_company_id();

alter table public.klachten enable row level security;
alter table public.klacht_berichten enable row level security;

-- Zien: wie klanten mag zien. Toevoegen, afvinken en wegleggen: wie klanten
-- mag bewerken. Echt wissen alleen vanuit de prullenbak (eigenaar).
create policy "Lezen met recht" on public.klachten for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))));
create policy "Maken met recht" on public.klachten for insert to authenticated
  with check (company_id = (select public.current_company_id())
    and (select public.heeft_recht('klanten_bewerken')));
create policy "Wijzigen met recht" on public.klachten for update to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('klanten_bewerken')))
  with check (company_id = (select public.current_company_id())
    and (select public.heeft_recht('klanten_bewerken')));
create policy "Weggooien door eigenaar" on public.klachten for delete to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.is_eigenaar()) and deleted_at is not null);

-- De koppeling zegt alleen wélke mail; de mail zelf blijft achter mail_lezen.
create policy "Lezen met recht" on public.klacht_berichten for select to authenticated
  using (company_id = (select public.current_company_id())
    and ((select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))));

-- ---------------------------------------------------------------------
-- 5. Eenmalig: oude klachtmails worden afgehandelde klachten
-- ---------------------------------------------------------------------

do $$
declare
  m record;
  nieuw uuid;
begin
  for m in
    select distinct b.id, b.company_id, b.klant_id, b.ontvangen_op,
           left(coalesce(nullif(trim(b.samenvatting), ''), nullif(trim(b.onderwerp), ''), 'Klacht uit mail'), 500) as omschrijving
      from public.berichten b
      join public.bericht_categorieen bc on bc.bericht_id = b.id
      join public.mail_categorieen mc on mc.id = bc.categorie_id and mc.sleutel = 'klachten'
     where b.klant_id is not null
       and b.deleted_at is null
       and b.richting = 'in'
  loop
    insert into public.klachten
      (company_id, klant_id, customer_id, omschrijving, bron, ontvangen_op, status, door_paaltje, gemaakt_door)
    values (
      m.company_id,
      m.klant_id,
      -- Heeft de klant precies één adres, dan gaat het daarover.
      (select case when count(*) = 1 then min(c.id::text)::uuid end
         from public.customers c
        where c.klant_id = m.klant_id and c.deleted_at is null),
      m.omschrijving, 'mail', m.ontvangen_op, 'afgehandeld', true, null)
    returning id into nieuw;
    insert into public.klacht_berichten (klacht_id, bericht_id, company_id)
    values (nieuw, m.id, m.company_id);
  end loop;
end
$$;
