-- Wat de eerste echte test van de facturenketen aan het licht bracht.
--
-- Drie dingen, en ze hangen samen met hetzelfde thema: een verstuurde factuur
-- staat vast, maar dan moet er wél een weg terug zijn.
--
--   1. Een eigen startnummer, zodat je kunt doortellen waar je oude systeem
--      gebleven was. In het nieuwe jaar valt hij vanzelf terug naar 1.
--   2. "Crediteer die eerst" was een doodlopende weg: na het crediteren bleef
--      het heropenen van de dag geweigerd.
--   3. Op een verstuurde factuur hoort het klanttype van dát moment te staan,
--      niet dat van nu.

-- ---------------------------------------------------------------------
-- 1. Doortellen vanaf je oude systeem
-- ---------------------------------------------------------------------
-- Stap je over van een ander pakket, dan moet de nummering dóórlopen: staat
-- daar 2026-0249 als laatste, dan begint deze app op 250. Het jaar staat er
-- met opzet bij: het nummer geldt alleen voor dát jaar, zodat januari gewoon
-- weer bij 1 begint zonder dat iemand eraan hoeft te denken.
alter table public.companies
  add column if not exists factuur_eerste_nummer integer,
  add column if not exists factuur_eerste_nummer_jaar smallint;

comment on column public.companies.factuur_eerste_nummer is
  'Het nummer dat de eerste factuur van factuur_eerste_nummer_jaar krijgt. Leeg of 1 = gewoon bij 1 beginnen.';
comment on column public.companies.factuur_eerste_nummer_jaar is
  'Voor welk jaar factuur_eerste_nummer geldt. Andere jaren beginnen altijd bij 1.';

create or replace function public.factuur_nummer_trekken(bedrijf uuid, voor_jaar int)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.factuur_tellers (company_id, jaar, laatste)
  values (
    bedrijf,
    voor_jaar,
    -- Alleen de állereerste factuur van dit jaar kijkt naar het startnummer;
    -- daarna telt de teller zelf verder. Een ander jaar begint bij 1.
    coalesce(
      (select c.factuur_eerste_nummer
         from public.companies c
        where c.id = bedrijf
          and c.factuur_eerste_nummer_jaar = voor_jaar
          and c.factuur_eerste_nummer > 0),
      1)
  )
  on conflict (company_id, jaar)
    do update set laatste = factuur_tellers.laatste + 1
  returning laatste
$$;
revoke execute on function public.factuur_nummer_trekken(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Crediteren geeft de dag weer vrij
-- ---------------------------------------------------------------------
-- Zat er een fout in een dag waarvoor de factuur al de deur uit was, dan liep
-- je vast: heropenen mocht niet ("crediteer die eerst"), maar na het
-- crediteren mocht het nog steeds niet. De controle keek namelijk alleen of er
-- een nummer op de factuur stond.
--
-- Nu: een factuur die nog echt buiten staat houdt de dag tegen, een
-- gecrediteerde niet meer. De regels van die verstuurde factuur blijven wél
-- staan -- dat papier heeft de klant, dat poets je niet weg -- maar ze houden
-- een nieuwe beurt niet langer tegen.
create or replace function public.factuurregels_terug(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  buiten integer;
  weg integer;
begin
  select count(*) into buiten
    from public.factuurregels fr
    join public.facturen f on f.id = fr.factuur_id
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and fr.deleted_at is null and f.nummer is not null
      and f.status <> 'gecrediteerd';
  if buiten > 0 then
    raise exception 'Voor % van deze dag is al een factuur verstuurd. Crediteer die eerst, dan kan de dag weer open.',
      case when buiten = 1 then '1 adres' else buiten::text || ' adressen' end;
  end if;

  -- Weg mogen alleen de regels die nog nergens de deur uit zijn: losse regels
  -- en die op een concept.
  delete from public.factuurregels fr
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.factuurregels_terug(date) from public, anon, authenticated;

-- En de andere kant op: is het werk gecrediteerd en doe je de beurt opnieuw,
-- dan moet daar ook een nieuwe regel van komen. Anders is het werk gedaan en
-- kan het nooit meer gefactureerd worden. De oude regel op de gecrediteerde
-- factuur telt daarom niet meer mee als "die heeft al een regel".
create or replace function public.factuurregels_maken(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  start_op date;
  gemaakt integer := 0;
begin
  if bedrijf is null then
    return 0;
  end if;

  select c.factuur_start_op into start_op from public.companies c where c.id = bedrijf;
  if start_op is null or dag < start_op then
    return 0;
  end if;

  if exists (
    select 1 from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.customer_id is not null and r.gedaan_op is null
  ) then
    return 0;
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, wasdag_regel_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    bedrijf, k.id, cu.id, 'wasbeurt', r.id, r.datum,
    coalesce(nullif(btrim(k.factuur_omschrijving), ''),
             'Glazenwassen ' || public.factuur_adres_tekst(cu.id)),
    case when r.notitie_op_factuur then coalesce(r.notitie, '') else '' end,
    wp.prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(wp.prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  from public.wasdag_regels r
  join public.customers cu on cu.id = r.customer_id
  join public.klanten k on k.id = cu.klant_id and k.company_id = r.company_id
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  left join public.streets s on s.id = cu.street_id
  left join public.districts d on d.id = s.district_id
  where r.company_id = bedrijf and r.datum = dag
    and r.gedaan_op is not null
    and r.niet_gewassen_op is null
    and wp.prijs > 0
    and cu.deleted_at is null and k.deleted_at is null
    and coalesce(r.betaalmethode, cu.betaalmethode, d.betaalmethode, 'contant') = 'overmaken'
    and not exists (
      select 1 from public.factuurregels fr
      left join public.facturen f on f.id = fr.factuur_id
      where fr.wasdag_regel_id = r.id and fr.deleted_at is null
        and coalesce(f.status, '') <> 'gecrediteerd'
    );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuurregels_maken(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Het klanttype van het moment van versturen
-- ---------------------------------------------------------------------
-- De lijst bepaalt hiermee of de bedragen inclusief of exclusief btw vooraan
-- staan. Bij een verstuurde factuur hoort dat het type te zijn dat op het
-- papier staat: zet je een klant later van particulier naar bedrijf, dan mag
-- een oude factuur daar niet anders van gaan lezen.
create or replace function public.facturen_lijst(vanaf date default null, tot date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag de facturen niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(x.regel order by x.sorteer desc nulls first)
    from (
      select jsonb_build_object(
        'id', f.id,
        'nummer', f.nummer,
        'soort', f.soort,
        'status', f.status,
        'klant_id', f.klant_id,
        'klant', coalesce(nullif(btrim(f.klantgegevens->>'bedrijfsnaam'), ''),
                          nullif(btrim(f.klantgegevens->>'naam'), ''),
                          nullif(btrim(k.bedrijfsnaam), ''), k.naam),
        'klanttype', coalesce(nullif(btrim(f.klantgegevens->>'klanttype'), ''), k.klanttype),
        'mail', coalesce(nullif(btrim(f.klantgegevens->>'email'), ''), public.factuur_mailadres(k)),
        'factuurdatum', f.factuurdatum,
        'vervaldatum', f.vervaldatum,
        'te_laat', f.nummer is not null and f.status = 'verstuurd'
                   and f.vervaldatum < vandaag
                   and (f.met_rust_tot is null or f.met_rust_tot < vandaag),
        'met_rust_tot', f.met_rust_tot,
        'herinnering_trap', f.herinnering_trap,
        'betaald_bedrag', f.betaald_bedrag,
        'verstuurd_op', f.verstuurd_op,
        'verstuurd_via', f.verstuurd_via,
        'mollie_link', f.mollie_link,
        'totalen', public.factuur_totalen(f.id)
      ) as regel,
      coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) as sorteer
      from public.facturen f
      join public.klanten k on k.id = f.klant_id
      where f.company_id = bedrijf and f.deleted_at is null
        and (vanaf is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) >= vanaf)
        and (tot is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) <= tot)
    ) x
  ), '[]'::jsonb);
end
$$;
