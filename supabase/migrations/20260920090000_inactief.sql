-- Een klant die stopt is inactief, niet weg.
--
-- Timmie wil de gegevens van een woning bewaren: de prijs, de frequentie, de
-- notities. Komt de klant terug, of wordt de volgende bewoner klant, dan staat
-- alles er nog. Daarom geen prullenbak maar een stempel op het adres, met een
-- reden:
--
--   verhuisd: de klantgegevens (naam, mail, telefoon) gaan naar de prullenbak;
--             de woning blijft, voor de volgende bewoner.
--   gestopt:  alles blijft bewaard, voor als de klant terugkomt.
--
-- Inactieve adressen staan niet op de wijklijst, de planning of in de omzet,
-- maar zijn op de klantenpagina terug te vinden en weer actief te maken.

alter table public.customers
  add column inactief_op timestamptz,
  add column inactief_reden text,
  add constraint customers_inactief_reden_check check (inactief_reden in ('verhuisd', 'gestopt')),
  add constraint customers_inactief_samen_check check ((inactief_op is null) = (inactief_reden is null));

create index customers_inactief_idx
  on public.customers (company_id, inactief_op)
  where inactief_op is not null and deleted_at is null;

-- Een aanmelding op een adres dat inactief is: dat huis kennen we al. Die
-- krijgt een eigen soort, zodat je de oude gegevens als voorstel ziet.
alter table public.aanmeldingen drop constraint aanmeldingen_soort_check;
alter table public.aanmeldingen
  add constraint aanmeldingen_soort_check
  check (soort in ('gekoppeld', 'wijziging', 'onbekend', 'bekend_adres'));

-- ---------------------------------------------------------------------
-- Inactief maken, in één stap
--
-- Toekomstige planning betekent: vanaf morgen.
--
-- Security invoker: de gewone regels (RLS) gelden, dus je raakt alleen je
-- eigen bedrijf. Alleen de server (service role, bijvoorbeeld Paaltje) mag het
-- bedrijf zelf meegeven, want die heeft geen ingelogde gebruiker.
--
-- Geeft terug wat er gebeurde, zodat het terug te draaien is: welke adressen,
-- welke klanten naar de prullenbak gingen, en welke planningsregels weg zijn.
-- ---------------------------------------------------------------------
create or replace function public.zet_adressen_inactief(
  adressen uuid[],
  reden text,
  planning_weg boolean,
  voor_bedrijf uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  nu timestamptz := now();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  gezet uuid[] := '{}';
  klanten_weg uuid[] := '{}';
  planning jsonb := '[]'::jsonb;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if reden is null or reden not in ('verhuisd', 'gestopt') then
    raise exception 'Onbekende reden.';
  end if;

  with u as (
    update public.customers
    set inactief_op = nu, inactief_reden = reden
    where company_id = bedrijf
      and id = any(adressen)
      and deleted_at is null
      and inactief_op is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into gezet from u;

  if planning_weg and cardinality(gezet) > 0 then
    with d as (
      delete from public.wasdag_regels
      where company_id = bedrijf
        and customer_id = any(gezet)
        -- Vandaag blijft staan: dat werk kan vanochtend al gedaan zijn.
        and datum > vandaag
      returning datum, customer_id, prijs, notitie
    )
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into planning from d;
  end if;

  -- Bij een verhuizing gaan de klantgegevens weg, maar alleen als de klant
  -- geen ander actief adres meer heeft: wie twee panden heeft en uit één
  -- verhuist, blijft klant.
  if reden = 'verhuisd' and cardinality(gezet) > 0 then
    with k as (
      update public.klanten kl
      set deleted_at = nu
      where kl.company_id = bedrijf
        and kl.deleted_at is null
        and kl.id in (
          select c.klant_id from public.customers c
          where c.id = any(gezet) and c.klant_id is not null
        )
        -- Een ander adres dat actief is, of op "gestopt" staat (alles
        -- bewaren), houdt de klantgegevens vast.
        and not exists (
          select 1 from public.customers c
          where c.klant_id = kl.id
            and c.deleted_at is null
            and (c.inactief_op is null or c.inactief_reden = 'gestopt')
        )
      returning kl.id
    )
    select coalesce(array_agg(id), '{}') into klanten_weg from k;
  end if;

  return jsonb_build_object(
    'adressen', to_jsonb(gezet),
    'klanten', to_jsonb(klanten_weg),
    'planning', planning,
    'inactief_op', nu
  );
end
$$;

-- Weer actief maken. De klantgegevens van een verhuizing komen niet vanzelf
-- terug: die haal je zelf uit de prullenbak als je je vergiste.
create or replace function public.zet_adressen_actief(
  adressen uuid[],
  voor_bedrijf uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  aantal integer;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and id = any(adressen)
      and inactief_op is not null
      and deleted_at is null
    returning 1
  )
  select count(*)::integer into aantal from u;
  return aantal;
end
$$;

revoke all on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) from public, anon;
grant execute on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) to authenticated, service_role;
revoke all on function public.zet_adressen_actief(uuid[], uuid) from public, anon;
grant execute on function public.zet_adressen_actief(uuid[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Stoppen terugdraaien (de ongedaan-knop op de klantenpagina en wijklijst)
--
-- Met dezelfde voorzichtigheid als het terugdraaien in het Rapport:
--  - alleen adressen die nog precies van déze stopzetting inactief zijn;
--  - klantgegevens alleen terug als ze nog van deze stopzetting in de
--    prullenbak liggen (niet als je ze intussen zelf weggooide);
--  - planning alleen voor vandaag en later, en een dag die intussen opnieuw
--    is ingepland blijft zoals hij is.
-- ---------------------------------------------------------------------
create or replace function public.stoppen_terugdraaien(uitkomst jsonb, voor_bedrijf uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  moment timestamptz := (uitkomst ->> 'inactief_op')::timestamptz;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  terug uuid[] := '{}';
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if moment is null then
    raise exception 'Onbekende stopzetting.';
  end if;

  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and deleted_at is null
      and inactief_op = moment
      and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'adressen', '[]'::jsonb)))::uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into terug from u;

  update public.klanten
  set deleted_at = null
  where company_id = bedrijf
    and deleted_at = moment
    and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'klanten', '[]'::jsonb)))::uuid);

  insert into public.wasdag_regels (company_id, datum, customer_id, prijs, notitie)
  select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, coalesce((r ->> 'prijs')::numeric, 0), r ->> 'notitie'
  from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
  where (r ->> 'datum')::date >= vandaag
    and (r ->> 'customer_id')::uuid = any(terug)
  on conflict (company_id, datum, customer_id) do nothing;

  return cardinality(terug);
end
$$;

-- ---------------------------------------------------------------------
-- Een aanmelding op een bekend adres overnemen, in één stap
--
-- Eerst kijken of het adres nog inactief is en de aanmelding nog open staat;
-- pas dan een klant maken (of de vorige gebruiken), koppelen, actief zetten
-- en de aanmelding afronden. Zo ontstaat er nooit een dubbele klant, en wordt
-- een adres dat een collega intussen al weer actief maakte niet overschreven.
-- ---------------------------------------------------------------------
create or replace function public.bekend_adres_overnemen(aanmelding uuid, met_vorige_klant boolean)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.aanmeldingen%rowtype;
  adres_id uuid;
  vorige uuid;
  klant uuid;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;

  select * into a from public.aanmeldingen
  where id = aanmelding and company_id = bedrijf
  for update;
  if not found or a.status <> 'open' or a.soort <> 'bekend_adres' or a.customer_id is null then
    raise exception 'Deze aanmelding is al afgehandeld.';
  end if;

  select id, klant_id into adres_id, vorige from public.customers
  where id = a.customer_id and company_id = bedrijf and deleted_at is null and inactief_op is not null
  for update;
  if adres_id is null then
    raise exception 'Dit adres staat niet meer op inactief. Kijk op de klantenpagina hoe het er nu voor staat.';
  end if;

  if met_vorige_klant then
    select id into klant from public.klanten
    where id = vorige and company_id = bedrijf and deleted_at is null;
    if klant is null then
      raise exception 'De vorige klant is er niet meer.';
    end if;
  else
    insert into public.klanten (company_id, naam, email, telefoon, straat, huisnummer, postcode, plaats, notitie)
    values (bedrijf, a.naam, a.email, a.telefoon, a.straat, a.huisnummer || coalesce(a.toevoeging, ''), a.postcode, a.plaats, '')
    returning id into klant;
  end if;

  update public.customers
  set klant_id = klant, inactief_op = null, inactief_reden = null, aangemeld_op = now()
  where id = adres_id;

  update public.aanmeldingen
  set status = 'klaar', klant_id = klant
  where id = a.id;

  return klant;
end
$$;

revoke all on function public.stoppen_terugdraaien(jsonb, uuid) from public, anon;
grant execute on function public.stoppen_terugdraaien(jsonb, uuid) to authenticated, service_role;
revoke all on function public.bekend_adres_overnemen(uuid, boolean) from public, anon;
grant execute on function public.bekend_adres_overnemen(uuid, boolean) to authenticated;
