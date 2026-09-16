-- WhatsApp, fase 4: zelf berichten beginnen via WhatsApp.
--
-- 1. Per klant: via welk kanaal hij aankondigingen krijgt, en of hij
--    toestemming gaf voor WhatsApp (en apart voor nieuws/acties).
-- 2. Sjablonen: berichten die je zelf begint, moeten eerst door Meta
--    goedgekeurd zijn. Ze staan hier met hun status bij Meta.
-- 3. Aankondigingen: per verzending het kanaal en het sjabloon, per
--    ontvanger of het een mail of een appje was.
-- 4. Toestemming van bestaande klanten in één keer vastleggen (en terug).

-- ---------------------------------------------------------------------
-- 1. Klanten
-- ---------------------------------------------------------------------

alter table public.klanten
  add column if not exists kanaal_voorkeur text not null default 'mail'
    check (kanaal_voorkeur in ('mail', 'whatsapp', 'beide')),
  -- Mag hij berichten via WhatsApp krijgen die wij beginnen (aankondigingen)?
  add column if not exists wa_toestemming_op timestamptz,
  -- Hoe: 'bestaande klant', 'mondeling', 'aanmeldpagina', …
  add column if not exists wa_toestemming_bron text not null default ''
    check (char_length(wa_toestemming_bron) <= 60),
  -- En apart: nieuws en acties (reclame) via WhatsApp.
  add column if not exists wa_marketing_op timestamptz;

-- ---------------------------------------------------------------------
-- 2. Sjablonen
-- ---------------------------------------------------------------------

create table if not exists public.wa_sjablonen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Hoe jij hem noemt.
  titel text not null check (char_length(titel) between 1 and 60),
  -- De naam bij Meta: kleine letters, cijfers en lage streepjes.
  meta_naam text not null check (meta_naam ~ '^[a-z0-9_]{1,512}$'),
  meta_id text not null default '',
  -- utility = over een afspraak (aankondiging), marketing = nieuws en acties.
  categorie text not null check (categorie in ('utility', 'marketing')),
  -- De tekst zoals jij hem schreef, met {naam}, {datum} en {adres}.
  tekst text not null check (char_length(tekst) between 1 and 1024),
  -- De plaatshouders in volgorde: {{1}} is variabelen[1].
  variabelen text[] not null default '{}',
  status text not null default 'ingediend'
    check (status in ('ingediend', 'goedgekeurd', 'afgewezen', 'gepauzeerd', 'uitgeschakeld')),
  afwijsreden text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, meta_naam)
);

drop trigger if exists wa_sjablonen_set_company_id on public.wa_sjablonen;
create trigger wa_sjablonen_set_company_id before insert on public.wa_sjablonen
  for each row execute function public.set_company_id();

-- Lezen mag wie berichten mag lezen; maken, wijzigen en weggooien gaat via de
-- server, want dat moet ook bij Meta gebeuren.
alter table public.wa_sjablonen enable row level security;
drop policy if exists "Lezen met recht" on public.wa_sjablonen;
create policy "Lezen met recht" on public.wa_sjablonen for select to authenticated
  using ((company_id = (select public.current_company_id()))
    and ((select public.heeft_recht('mail_lezen')) or (select public.heeft_recht('mail_versturen'))));

-- ---------------------------------------------------------------------
-- 3. Aankondigingen per kanaal
-- ---------------------------------------------------------------------

alter table public.mailingen
  -- voorkeur = zoals bij elke klant ingesteld.
  add column if not exists kanaal text not null default 'mail'
    check (kanaal in ('mail', 'whatsapp', 'beide', 'voorkeur')),
  add column if not exists sjabloon_id uuid references public.wa_sjablonen(id) on delete set null,
  add column if not exists aantal_whatsapp integer not null default 0;

alter table public.mail_ontvangers
  add column if not exists kanaal text not null default 'mail' check (kanaal in ('mail', 'whatsapp')),
  add column if not exists telefoon text not null default '';

alter table public.mail_ontvangers alter column email set default '';

-- ---------------------------------------------------------------------
-- 4. Toestemming van bestaande klanten
-- ---------------------------------------------------------------------

-- Alle klanten met een mobiel nummer en nog geen toestemming: "akkoord,
-- bestaande klant", met hetzelfde tijdstip, zodat het in één keer terug kan.
-- Alleen de eigenaar.
create or replace function public.wa_toestemming_bestaande_klanten()
returns table (aantal integer, op timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  nu timestamptz := now();
  bedrijf uuid := public.current_company_id();
  n integer;
begin
  if not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.' using errcode = '42501';
  end if;
  update public.klanten k
     set wa_toestemming_op = nu,
         wa_toestemming_bron = 'bestaande klant'
   where k.company_id = bedrijf
     and k.deleted_at is null
     and k.wa_toestemming_op is null
     and k.wa_afgemeld_op is null
     and (public.telefoon_sleutel(k.telefoon) like '06%' or public.telefoon_sleutel(k.telefoon2) like '06%');
  get diagnostics n = row_count;
  return query select n, nu;
end
$$;

revoke execute on function public.wa_toestemming_bestaande_klanten() from public, anon;
grant execute on function public.wa_toestemming_bestaande_klanten() to authenticated;

create or replace function public.wa_toestemming_bestaande_klanten_terug(op timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan dit.' using errcode = '42501';
  end if;
  update public.klanten k
     set wa_toestemming_op = null,
         wa_toestemming_bron = ''
   where k.company_id = public.current_company_id()
     and k.wa_toestemming_bron = 'bestaande klant'
     and k.wa_toestemming_op = op;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.wa_toestemming_bestaande_klanten_terug(timestamptz) from public, anon;
grant execute on function public.wa_toestemming_bestaande_klanten_terug(timestamptz) to authenticated;

-- Hoeveel klanten er in één keer akkoord gezet zouden worden, en hoeveel er al zijn.
create or replace function public.wa_toestemming_telling()
returns table (zonder integer, met integer, afgemeld integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where wa_toestemming_op is null and wa_afgemeld_op is null
      and (public.telefoon_sleutel(telefoon) like '06%' or public.telefoon_sleutel(telefoon2) like '06%'))::integer,
    count(*) filter (where wa_toestemming_op is not null and wa_afgemeld_op is null)::integer,
    count(*) filter (where wa_afgemeld_op is not null)::integer
  from public.klanten
  where deleted_at is null
$$;

revoke execute on function public.wa_toestemming_telling() from public, anon;
grant execute on function public.wa_toestemming_telling() to authenticated;
