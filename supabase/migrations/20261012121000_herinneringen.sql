-- Fase 4 van de facturen: herinneringen die vanzelf gaan.
--
-- Een factuur die over de vervaldatum gaat staat al op "Te laat" in de lijst,
-- maar er gebeurt niets mee. Vanaf nu gaat er een mail achteraan, in trappen
-- die je zelf instelt.
--
-- Twee dingen staan hier voorop, en die bepalen de hele opzet:
--
-- 1. Het gaat vooraf, niet achteraf. De app laat een dag van tevoren zien wat
--    er morgen weggaat, met een knop om het tegen te houden. Een herinnering
--    die je pas ziet nadat hij bij je klant ligt, is geen automaat maar een
--    verrassing.
-- 2. Versturen blijft een dagelijkse ronde, geen minuutwerk. Eén keer per dag
--    's ochtends; wat vandaag niet weg kan, gaat morgen.

-- ---------------------------------------------------------------------
-- 1. De trappen
-- ---------------------------------------------------------------------

create table public.factuur_herinneringen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- 1 is de eerste herinnering, 2 de tweede. Dit getal staat ook in
  -- facturen.herinnering_trap, en zo weet de planner waar hij gebleven was.
  volgnummer smallint not null check (volgnummer between 1 and 20),
  -- Dagen ná de vervaldatum.
  na_dagen smallint not null check (na_dagen between 0 and 365),
  onderwerp text not null,
  tekst text not null,
  aan boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, volgnummer)
);

alter table public.factuur_herinneringen enable row level security;

create policy "Herinneringen van eigen bedrijf zien" on public.factuur_herinneringen
  for select to authenticated
  using (company_id = (select public.current_company_id()));

create policy "Herinneringen van eigen bedrijf beheren" on public.factuur_herinneringen
  for all to authenticated
  using (
    company_id = (select public.current_company_id()) and (select public.heeft_recht('facturen'))
  )
  with check (
    company_id = (select public.current_company_id()) and (select public.heeft_recht('facturen'))
  );

create trigger factuur_herinneringen_company_id before insert on public.factuur_herinneringen
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 2. Waar je mee begint
-- ---------------------------------------------------------------------
-- Zeven en eenentwintig dagen: de eerste als vriendelijke herinnering, de
-- tweede steviger. Beide teksten mag je helemaal herschrijven; ze staan er
-- alleen zodat je niet met een leeg scherm begint.

create or replace function public.standaard_herinneringen(bedrijf uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  naam text;
begin
  select c.name into naam from public.companies c where c.id = bedrijf;
  insert into public.factuur_herinneringen
    (company_id, volgnummer, na_dagen, onderwerp, tekst, aan)
  values
    (bedrijf, 1, 7, 'Herinnering: factuur {{nummer}}',
     'Beste {{naam}},' || E'\n\n' ||
     'Onze factuur {{nummer}} van {{bedrag}} stond op {{vervaldatum}} open. ' ||
     'Waarschijnlijk is het u even ontschoten -- zou u er nog naar willen kijken?' || E'\n\n' ||
     'Is de betaling inmiddels onderweg, dan kunt u deze mail laten voor wat hij is.' || E'\n\n' ||
     'Met vriendelijke groet,' || E'\n' || coalesce(naam, ''),
     true),
    (bedrijf, 2, 21, 'Tweede herinnering: factuur {{nummer}}',
     'Beste {{naam}},' || E'\n\n' ||
     'Factuur {{nummer}} van {{bedrag}} staat nu {{dagen}} dagen open. ' ||
     'De vervaldatum was {{vervaldatum}}.' || E'\n\n' ||
     'Wilt u het bedrag alsnog overmaken? Lukt betalen niet in één keer, ' ||
     'laat het dan even weten -- dan zoeken we samen naar een oplossing.' || E'\n\n' ||
     'Met vriendelijke groet,' || E'\n' || coalesce(naam, ''),
     true)
  on conflict (company_id, volgnummer) do nothing;
end
$$;

revoke execute on function public.standaard_herinneringen(uuid) from public, anon, authenticated;

create or replace function public.herinneringen_bij_bedrijf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.standaard_herinneringen(new.id);
  return null;
end
$$;
create trigger companies_herinneringen after insert on public.companies
  for each row execute function public.herinneringen_bij_bedrijf();

do $$
declare
  b uuid;
begin
  for b in select id from public.companies loop
    perform public.standaard_herinneringen(b);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Welke facturen aan de beurt zijn
-- ---------------------------------------------------------------------
-- Eén plek waar de voorwaarden staan, zodat het gele vakje in de app precies
-- dezelfde lijst laat zien als wat de planner morgen gaat versturen. Zou dat
-- uit elkaar lopen, dan kondig je iets aan wat niet gebeurt -- of erger,
-- gebeurt er iets wat je niet aangekondigd hebt.

create or replace function public.factuur_herinneringen_klaar(op date, bedrijf uuid default null)
returns table (
  factuur_id uuid,
  company_id uuid,
  nummer text,
  klant text,
  mail text,
  open_bedrag numeric,
  vervaldatum date,
  dagen_open integer,
  trap smallint,
  onderwerp text,
  tekst text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    f.company_id,
    f.nummer,
    coalesce(nullif(btrim(f.klantgegevens->>'bedrijfsnaam'), ''),
             nullif(btrim(f.klantgegevens->>'naam'), ''), ''),
    btrim(coalesce(f.klantgegevens->>'email', '')),
    round((public.factuur_totalen(f.id) ->> 'incl')::numeric - coalesce(f.betaald_bedrag, 0), 2),
    f.vervaldatum,
    (op - f.vervaldatum)::integer,
    h.volgnummer,
    h.onderwerp,
    h.tekst
  from public.facturen f
  join public.factuur_herinneringen h
    on h.company_id = f.company_id
   and h.aan
   and h.volgnummer = f.herinnering_trap + 1
  where f.deleted_at is null
    -- Een creditnota herinner je niet: daar krijgt de klant geld van jou.
    and f.soort = 'factuur'
    and f.status = 'verstuurd'
    and f.nummer is not null
    and f.vervaldatum is not null
    and f.vervaldatum + h.na_dagen <= op
    and (f.met_rust_tot is null or f.met_rust_tot < op)
    and btrim(coalesce(f.klantgegevens->>'email', '')) <> ''
    and (bedrijf is null or f.company_id = bedrijf)
    and round((public.factuur_totalen(f.id) ->> 'incl')::numeric - coalesce(f.betaald_bedrag, 0), 2) > 0
  order by f.vervaldatum, f.nummer
$$;

revoke execute on function public.factuur_herinneringen_klaar(date, uuid)
  from public, anon, authenticated;

-- Wat er morgen weggaat, voor het gele vakje in de app. Alleen het eigen
-- bedrijf, en alleen voor wie facturen mag zien.
create or replace function public.facturen_herinneringen_straks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  morgen date := ((now() at time zone 'Europe/Amsterdam')::date + 1);
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.factuur_id,
      'nummer', k.nummer,
      'klant', k.klant,
      'mail', k.mail,
      'bedrag', k.open_bedrag,
      'vervaldatum', k.vervaldatum,
      'trap', k.trap
    ) order by k.vervaldatum, k.nummer)
    from public.factuur_herinneringen_klaar(morgen, bedrijf) k
  ), '[]'::jsonb);
end
$$;

grant execute on function public.facturen_herinneringen_straks() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Afmelden na het versturen
-- ---------------------------------------------------------------------

create or replace function public.factuur_herinnering_verstuurd(factuur uuid, trap smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.facturen
    set herinnering_trap = greatest(coalesce(herinnering_trap, 0), trap)
    where id = factuur and status = 'verstuurd';
end
$$;

revoke execute on function public.factuur_herinnering_verstuurd(uuid, smallint)
  from public, anon, authenticated;
