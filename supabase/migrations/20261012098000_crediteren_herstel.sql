-- Wat de code-review op de vorige migratie ving. Drie dingen, en het eerste
-- was erger dan wat het moest oplossen.

-- ---------------------------------------------------------------------
-- 1. Startnummer werkt nu ook als er al een teller staat
-- ---------------------------------------------------------------------
-- De vorige versie zette het startnummer alleen bij het aanmaken van de
-- tellerrij. Stond er al een rij voor dat jaar -- en die staat er zodra er
-- één factuur uit is, ook een testfactuur -- dan gebeurde er ogenschijnlijk
-- niets: je vulde 250 in en kreeg 0002.
--
-- `excluded.laatste` is wat we wilden invoegen, dus het startnummer (of 1).
-- Het hoogste van "één verder" en dat startnummer: daarmee kan een startnummer
-- de reeks vooruit zetten, maar nooit terug -- een nummer twee keer uitgeven
-- is het enige wat echt niet mag.
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
    coalesce(
      (select c.factuur_eerste_nummer
         from public.companies c
        where c.id = bedrijf
          and c.factuur_eerste_nummer_jaar = voor_jaar
          and c.factuur_eerste_nummer > 0),
      1)
  )
  on conflict (company_id, jaar)
    do update set laatste = greatest(factuur_tellers.laatste + 1, excluded.laatste)
  returning laatste
$$;
revoke execute on function public.factuur_nummer_trekken(uuid, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Het lege concept weer opruimen
-- ---------------------------------------------------------------------
-- Dit stond in `20261012096000_facturen_review.sql` en was er bij het
-- herschrijven uitgevallen. Zonder dit blijft er na het heropenen van een dag
-- een concept van € 0,00 met nul regels in de lijst staan.
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
  -- Een factuur die nog echt buiten staat houdt de dag tegen; een
  -- gecrediteerde niet meer.
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
  -- en die op een concept. Wat op een genummerde factuur staat blijft staan.
  delete from public.factuurregels fr
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));
  get diagnostics weg = row_count;

  -- En het concept dat daardoor leeg achterblijft.
  delete from public.facturen f
    where f.company_id = bedrijf and f.nummer is null
      and not exists (select 1 from public.factuurregels fr where fr.factuur_id = f.id);

  return weg;
end
$$;
revoke execute on function public.factuurregels_terug(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Crediteren laat de beurt los, in plaats van de ontdubbeling op te rekken
-- ---------------------------------------------------------------------
-- De vorige poging liet `factuurregels_maken` regels op een gecrediteerde
-- factuur negeren. Dat werkte niet: op `factuurregels` ligt een unieke index
-- op `wasdag_regel_id`, dus de nieuwe regel botste met de oude en "Dag klaar"
-- klapte eruit met een databasefout. Je kwam dus nóg verder vast te zitten
-- dan met het oude slot.
--
-- Nu andersom, en eenvoudiger: bij het crediteren laat de oude regel zijn
-- verwijzing naar de beurt los. De factuur houdt zijn regels en bedragen --
-- die staan op papier bij de klant -- maar de beurt is weer vrij om opnieuw
-- gefactureerd te worden. `wasdag_regel_id` en `klus_id` zijn nergens anders
-- voor dan deze ontdubbeling, dus er gaat niets verloren.
create or replace function public.factuur_crediteren(factuur uuid, reden text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  nieuw uuid;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen crediteren.';
  end if;
  select * into f from public.facturen where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is null then
    raise exception 'Een concept hoef je niet te crediteren: gooi hem weg.';
  end if;
  if f.status = 'gecrediteerd' then
    raise exception 'Deze factuur is al gecrediteerd.';
  end if;

  insert into public.facturen (company_id, klant_id, soort, crediteert_id, klantgegevens)
    values (bedrijf, f.klant_id, 'credit', f.id, f.klantgegevens)
    returning id into nieuw;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, datum, omschrijving, notitie,
    bedrag, btw_inclusief, btw_procent, bedrag_excl, factuur_id
  )
  select fr.company_id, fr.klant_id, fr.customer_id, fr.soort, fr.datum,
         'Creditering: ' || fr.omschrijving,
         coalesce(nullif(btrim(reden), ''), fr.notitie),
         -fr.bedrag, fr.btw_inclusief, fr.btw_procent, -fr.bedrag_excl, nieuw
    from public.factuurregels fr
    where fr.factuur_id = factuur and fr.deleted_at is null;

  -- De beurt weer vrijgeven. Doe je het werk opnieuw, dan ontstaat er een
  -- nieuwe regel; de oude blijft ongemoeid op de gecrediteerde factuur.
  update public.factuurregels
    set wasdag_regel_id = null, klus_id = null
    where factuur_id = factuur and company_id = bedrijf;

  update public.facturen set status = 'gecrediteerd' where id = factuur;
  return nieuw;
end
$$;

-- En daarmee kan de ontdubbeling in `factuurregels_maken` terug naar de
-- eenvoudige vorm: één regel per beurt, punt.
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
      where fr.wasdag_regel_id = r.id and fr.deleted_at is null
    );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuurregels_maken(date) from public, anon, authenticated;
