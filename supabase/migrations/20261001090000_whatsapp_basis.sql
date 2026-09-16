-- WhatsApp, fase 1: berichten binnen laten komen.
--
-- 1. WhatsApp-berichten staan in dezelfde tabel als mail (berichten), met
--    kanaal = 'whatsapp'. Zo werken categorieën, klachten, het rapport van
--    Paaltje en het klantdossier meteen voor beide. Een WhatsApp-bericht heeft
--    geen mailbox, map of uid.
-- 2. Klanten herkennen aan hun telefoonnummer, net als aan hun mailadres.
-- 3. De koppeling met het WhatsApp-nummer van het bedrijf; het toegangstoken
--    staat versleuteld apart, net als het mailboxwachtwoord.

-- ---------------------------------------------------------------------
-- 1. Berichten: mail of WhatsApp
-- ---------------------------------------------------------------------

alter table public.berichten
  add column if not exists kanaal text not null default 'mail'
    check (kanaal in ('mail', 'whatsapp')),
  -- Het id dat WhatsApp aan het bericht gaf (wamid.…).
  add column if not exists wa_id text,
  -- Het nummer van de ander in het gesprek (in én uit), als "31612345678".
  add column if not exists wa_telefoon text not null default '',
  -- text, image, audio, video, document, sticker, location, contacts, …
  add column if not exists wa_type text not null default '',
  -- Wat WhatsApp over een uitgaand bericht meldde.
  add column if not exists wa_status text not null default ''
    check (wa_status in ('', 'verstuurd', 'afgeleverd', 'gelezen', 'mislukt')),
  -- [{pad, mime, grootte, naam}] in de opslag, zodra het binnen is.
  add column if not exists media jsonb not null default '[]',
  -- Waar een bericht vandaan komt: de klant, de app op de telefoon, Wooshy,
  -- Paaltje, of de geschiedenis die bij het koppelen is opgehaald.
  add column if not exists bron text not null default ''
    check (bron in ('', 'klant', 'app', 'wooshy', 'paaltje', 'geschiedenis'));

alter table public.berichten alter column uid drop not null;
alter table public.berichten alter column uidvalidity drop not null;

-- Een mail heeft altijd een plek op de server gehad; WhatsApp nooit.
alter table public.berichten drop constraint if exists berichten_kanaal_velden_check;
alter table public.berichten
  add constraint berichten_kanaal_velden_check check (
    (kanaal = 'mail' and uid is not null and uidvalidity is not null)
    or (kanaal = 'whatsapp' and uid is null and wa_id is not null and wa_telefoon <> '')
  );

-- Webhooks van WhatsApp kunnen dubbel komen: één keer opslaan. Niet partieel,
-- anders kan "on conflict (company_id, wa_id)" hem niet vinden; mail heeft
-- wa_id leeg (null) en botst dus nooit.
create unique index if not exists berichten_wa_id_uniek
  on public.berichten (company_id, wa_id);

-- De gesprekkenlijst: per nummer het laatste bericht.
create index if not exists berichten_wa_gesprek_idx
  on public.berichten (company_id, wa_telefoon, ontvangen_op desc)
  where kanaal = 'whatsapp';

-- ---------------------------------------------------------------------
-- 2. Telefoonnummers van klanten
-- ---------------------------------------------------------------------

-- Hetzelfde als telefoonSleutel() in _gedeeld/klantgegevens.ts:
-- "06-12 34 56 78", "+31 6 12345678" en "31612345678" worden "0612345678".
-- Leeg als het geen Nederlands nummer lijkt.
create or replace function public.telefoon_sleutel(tekst text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(tekst, ''), '\D', '', 'g');
begin
  if d like '0031%' then
    d := '0' || substr(d, 5);
  elsif d like '31%' and length(d) = 11 then
    d := '0' || substr(d, 3);
  end if;
  if length(d) = 10 and d like '0%' then
    return d;
  end if;
  return '';
end
$$;

create table if not exists public.klant_telefoons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  klant_id uuid not null,
  -- Altijd als sleutel opgeslagen ("0612345678").
  telefoon text not null check (telefoon <> '' and telefoon = public.telefoon_sleutel(telefoon)),
  --   klant   = staat op de klant zelf (houdt zich vanzelf bij)
  --   mens    = de eigenaar koppelde het
  --   paaltje = Paaltje herkende het
  bron text not null default 'mens' check (bron in ('klant', 'mens', 'paaltje')),
  created_at timestamptz not null default now(),
  foreign key (klant_id, company_id) references public.klanten(id, company_id) on delete cascade
);

create unique index if not exists klant_telefoons_uniek_idx
  on public.klant_telefoons (company_id, klant_id, telefoon);
create index if not exists klant_telefoons_zoek_idx
  on public.klant_telefoons (company_id, telefoon);

drop trigger if exists klant_telefoons_set_company_id on public.klant_telefoons;
create trigger klant_telefoons_set_company_id before insert on public.klant_telefoons
  for each row execute function public.set_company_id();

alter table public.klant_telefoons enable row level security;
drop policy if exists "Lezen met recht" on public.klant_telefoons;
create policy "Lezen met recht" on public.klant_telefoons for select to authenticated
  using ((company_id = (select public.current_company_id()))
    and ((select public.heeft_recht('klanten_bekijken')) or (select public.heeft_recht('klanten_bewerken'))
      or (select public.heeft_recht('mail_lezen'))));
drop policy if exists "Maken met recht" on public.klant_telefoons;
create policy "Maken met recht" on public.klant_telefoons for insert to authenticated
  with check ((company_id = (select public.current_company_id())) and (select public.heeft_recht('klanten_bewerken')));
drop policy if exists "Wijzigen met recht" on public.klant_telefoons;
create policy "Wijzigen met recht" on public.klant_telefoons for update to authenticated
  using ((company_id = (select public.current_company_id())) and (select public.heeft_recht('klanten_bewerken')))
  with check ((company_id = (select public.current_company_id())) and (select public.heeft_recht('klanten_bewerken')));
drop policy if exists "Weggooien met recht" on public.klant_telefoons;
create policy "Weggooien met recht" on public.klant_telefoons for delete to authenticated
  using ((company_id = (select public.current_company_id())) and (select public.heeft_recht('klanten_bewerken')));

-- De nummers op de klant zelf houden zich bij, net als het mailadres.
create or replace function public.klant_telefoons_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nummer text;
begin
  delete from public.klant_telefoons where klant_id = new.id and bron = 'klant';
  foreach nummer in array array[public.telefoon_sleutel(new.telefoon), public.telefoon_sleutel(new.telefoon2)] loop
    if nummer <> '' then
      insert into public.klant_telefoons (company_id, klant_id, telefoon, bron)
      values (new.company_id, new.id, nummer, 'klant')
      on conflict (company_id, klant_id, telefoon) do update
        set bron = case when klant_telefoons.bron = 'mens' then 'mens' else 'klant' end;
    end if;
  end loop;
  return new;
end
$$;

revoke execute on function public.klant_telefoons_bijhouden() from public, anon, authenticated;

drop trigger if exists klanten_telefoons_bijhouden on public.klanten;
create trigger klanten_telefoons_bijhouden
  after insert or update of telefoon, telefoon2 on public.klanten
  for each row execute function public.klant_telefoons_bijhouden();

insert into public.klant_telefoons (company_id, klant_id, telefoon, bron)
select company_id, id, nummer, 'klant'
from public.klanten,
  lateral (values (public.telefoon_sleutel(telefoon)), (public.telefoon_sleutel(telefoon2))) as n(nummer)
where nummer <> ''
on conflict do nothing;

-- De klant bij een nummer, alleen als dat er precies één is.
create or replace function public.enige_klant_bij_telefoon(bedrijf uuid, nummer text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when count(distinct kt.klant_id) = 1 then min(kt.klant_id::text)::uuid end
  from public.klant_telefoons kt
  join public.klanten k on k.id = kt.klant_id and k.deleted_at is null
  where kt.company_id = bedrijf
    and public.telefoon_sleutel(nummer) <> ''
    and kt.telefoon = public.telefoon_sleutel(nummer)
$$;

revoke execute on function public.enige_klant_bij_telefoon(uuid, text) from public, anon, authenticated;

-- Het nummer als sleutel ("0612345678"), om snel oude appjes aan een klant
-- te koppelen als er een nummer bij die klant komt.
alter table public.berichten
  add column if not exists wa_sleutel text generated always as (public.telefoon_sleutel(wa_telefoon)) stored;

create index if not exists berichten_wa_nakoppelen_idx
  on public.berichten (company_id, wa_sleutel)
  where kanaal = 'whatsapp' and klant_id is null;

-- Bij binnenkomst: mail op mailadres, WhatsApp op nummer.
create or replace function public.berichten_klant_koppelen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.klant_id is null then
    if new.kanaal = 'whatsapp' then
      new.klant_id := public.enige_klant_bij_telefoon(new.company_id, new.wa_telefoon);
    else
      new.klant_id := public.klant_van_bericht(new.company_id, new.richting, new.van_email, new.aan);
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.berichten_klant_koppelen() from public, anon, authenticated;

-- Komt er een nummer bij een klant, dan krijgen oude ongekoppelde
-- WhatsApp-berichten van dat nummer die klant alsnog.
create or replace function public.klant_telefoons_berichten_nakoppelen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  klant uuid := public.enige_klant_bij_telefoon(new.company_id, new.telefoon);
begin
  if klant is null then
    return new;
  end if;
  update public.berichten b
     set klant_id = klant
   where b.company_id = new.company_id
     and b.kanaal = 'whatsapp'
     and b.klant_id is null
     and b.wa_sleutel = new.telefoon;
  return new;
end
$$;

revoke execute on function public.klant_telefoons_berichten_nakoppelen() from public, anon, authenticated;

drop trigger if exists klant_telefoons_berichten_nakoppelen on public.klant_telefoons;
create trigger klant_telefoons_berichten_nakoppelen
  after insert on public.klant_telefoons
  for each row execute function public.klant_telefoons_berichten_nakoppelen();

-- ---------------------------------------------------------------------
-- 3. De koppeling met WhatsApp
-- ---------------------------------------------------------------------

create table if not exists public.whatsapp_koppelingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  -- Het WhatsApp Business-account en het nummer bij Meta.
  waba_id text not null default '',
  phone_number_id text not null unique,
  -- Hoe het nummer eruitziet ("+31 6 12345678").
  weergavenummer text not null default '',
  -- soort: test = Meta's testnummer tijdens het bouwen, app = het echte
  -- nummer dat ook in de WhatsApp Business-app blijft.
  -- status: actief, fout (zie fout) of uit (ontkoppeld).
  soort text not null default 'test' check (soort in ('test', 'app')),
  status text not null default 'actief' check (status in ('actief', 'fout', 'uit')),
  fout text not null default '',
  -- Vanaf wanneer Paaltje berichten leest; de opgehaalde geschiedenis niet.
  paaltje_vanaf timestamptz not null default now(),
  laatste_bericht_op timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists whatsapp_koppelingen_set_company_id on public.whatsapp_koppelingen;
create trigger whatsapp_koppelingen_set_company_id before insert on public.whatsapp_koppelingen
  for each row execute function public.set_company_id();

alter table public.whatsapp_koppelingen enable row level security;
drop policy if exists "Lezen met recht" on public.whatsapp_koppelingen;
create policy "Lezen met recht" on public.whatsapp_koppelingen for select to authenticated
  using ((company_id = (select public.current_company_id())) and (select public.heeft_recht('mail_lezen')));

-- Alleen de server leest en schrijft dit: geen regels voor de app.
create table if not exists public.whatsapp_geheimen (
  koppeling_id uuid primary key references public.whatsapp_koppelingen(id) on delete cascade,
  versleuteld text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_geheimen enable row level security;
revoke all on public.whatsapp_geheimen from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. De gesprekkenlijst
-- ---------------------------------------------------------------------

-- Per nummer het laatste bericht, nieuwste gesprek eerst. Met de rechten van
-- wie het vraagt: wie geen berichten mag lezen, krijgt niets.
create or replace function public.whatsapp_gesprekken(ouder_dan timestamptz default null, aantal integer default 50)
returns table (
  wa_telefoon text,
  laatste_op timestamptz,
  fragment text,
  richting text,
  wa_status text,
  naam text,
  klant_id uuid,
  ongelezen bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with laatste as (
    select distinct on (b.wa_telefoon)
      b.wa_telefoon, b.ontvangen_op, b.fragment, b.richting, b.wa_status, b.klant_id
    from public.berichten b
    where b.kanaal = 'whatsapp' and b.deleted_at is null
    order by b.wa_telefoon, b.ontvangen_op desc
  )
  select
    l.wa_telefoon,
    l.ontvangen_op,
    l.fragment,
    l.richting,
    l.wa_status,
    coalesce(
      (select k.naam from public.klanten k where k.id = l.klant_id and k.deleted_at is null),
      (select b.van_naam from public.berichten b
        where b.kanaal = 'whatsapp' and b.wa_telefoon = l.wa_telefoon and b.van_naam <> ''
          and b.deleted_at is null
        order by b.ontvangen_op desc limit 1),
      ''
    ),
    l.klant_id,
    (select count(*) from public.berichten b
      where b.kanaal = 'whatsapp' and b.wa_telefoon = l.wa_telefoon
        and b.richting = 'in' and not b.gelezen and b.deleted_at is null)
  from laatste l
  where ouder_dan is null or l.ontvangen_op < ouder_dan
  order by l.ontvangen_op desc
  limit least(greatest(aantal, 1), 200)
$$;

revoke execute on function public.whatsapp_gesprekken(timestamptz, integer) from public, anon;
grant execute on function public.whatsapp_gesprekken(timestamptz, integer) to authenticated;
