-- Tweede betalingssysteem, fase 1b: waar de te factureren regels vandaan komen.
--
-- Twee wegen, omdat wasbeurten en klussen nu eenmaal anders lopen:
--
--   * Een wasbeurt wordt gedaan verklaard door "Dag klaar". Dat gaat per
--     team, maar de regels ontstaan pas als élk team van die dag klaar is:
--     zolang er nog iemand buiten loopt, is de dag niet af.
--   * Een klus wordt met de hand afgevinkt, los van het afmelden van een dag.
--     Die maakt zijn regel op het moment van afvinken.
--
-- In beide gevallen is het resultaat een regel zonder nummer die nergens
-- naartoe gaat. Pas als iemand met het recht "facturen" op versturen drukt,
-- wordt het een factuur.

-- ---------------------------------------------------------------------
-- 1. Straatnaam voor op papier
-- ---------------------------------------------------------------------
-- geld_adres_tekst gebruikt streets.name: de werknaam waarmee jullie de
-- wijk lopen ("Gouda"). Op een factuur hoort de officiële naam te staan.
create or replace function public.factuur_adres_tekst(adres uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select concat_ws(' ',
           coalesce(nullif(btrim(s.volledige_naam), ''), nullif(btrim(s.name), ''), '?'),
           cu.house_number::text || coalesce(cu.addition, ''))
  from public.customers cu left join public.streets s on s.id = cu.street_id
  where cu.id = adres
$$;
revoke execute on function public.factuur_adres_tekst(uuid) from public, anon, authenticated;

-- Wat er van een bedrag overblijft zonder btw. Staat de prijs inclusief
-- (particulier), dan rekenen we hem eruit; staat hij exclusief (bedrijf,
-- VvE), dan is hij het al.
create or replace function public.factuur_excl(bedrag numeric, inclusief boolean, procent numeric)
returns numeric
language sql
immutable
as $$
  select round(case when inclusief then bedrag / (1 + procent / 100) else bedrag end, 2)
$$;

-- ---------------------------------------------------------------------
-- 2. De wasbeurten van een afgemelde dag
-- ---------------------------------------------------------------------
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

  -- Niets met terugwerkende kracht: pas vanaf de dag dat het bedrijf het
  -- factureren aanzet. Leeg = nog niet aan.
  select c.factuur_start_op into start_op from public.companies c where c.id = bedrijf;
  if start_op is null or dag < start_op then
    return 0;
  end if;

  -- Is de hele dag af? Eén team dat nog niet heeft afgemeld houdt alles
  -- tegen. Regels zonder adres tellen niet mee: daar valt niets te
  -- factureren.
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
    -- Een vaste omschrijving bij de klant wint: een VvE wil vaak letterlijk
    -- "Glasbewassing conform overeenkomst" zien.
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
    -- De bevroren methode van die dag als die er is, anders de gewone regel
    -- (adres, anders wijk, anders contant).
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

-- ---------------------------------------------------------------------
-- 3. Klussen: bij het afvinken
-- ---------------------------------------------------------------------
-- Een klus hangt niet aan "Dag klaar" -- iemand zet er met de hand een
-- vinkje bij, op de dagpagina of in de planning. Dat vinkje is hier het
-- moment. Wordt het vinkje weer weggehaald, dan verdwijnt de regel ook,
-- tenzij hij al op een verstuurde factuur staat.
create or replace function public.klus_factuurregel_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  start_op date;
  methode text;
  k public.klanten;
  prijs numeric;
begin
  if new.gedaan_op is not distinct from old.gedaan_op then
    return new;
  end if;

  if new.gedaan_op is null then
    -- Vinkje eruit: de regel gaat mee, zolang er nog geen nummer op staat.
    delete from public.factuurregels fr
      where fr.klus_id = new.id
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f where f.id = fr.factuur_id and f.nummer is null));
    return new;
  end if;

  select c.factuur_start_op into start_op from public.companies c where c.id = new.company_id;
  if start_op is null or new.gedaan_op < start_op then
    return new;
  end if;

  select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') into methode
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = new.customer_id and cu.deleted_at is null;
  if methode is distinct from 'overmaken' then
    return new;
  end if;

  select kl.* into k
    from public.klanten kl
    join public.customers cu on cu.klant_id = kl.id
    where cu.id = new.customer_id and kl.deleted_at is null;
  if not found then
    return new;
  end if;

  select kp.prijs into prijs from public.klus_prijzen kp where kp.klus_id = new.id;
  if coalesce(prijs, 0) <= 0 then
    return new;
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, klus_id, datum,
    omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    new.company_id, k.id, new.customer_id, 'klus', new.id, new.gedaan_op,
    coalesce(nullif(btrim(new.omschrijving), ''), 'Extra opdracht'),
    prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  where not exists (
    select 1 from public.factuurregels fr where fr.klus_id = new.id and fr.deleted_at is null
  );
  return new;
end
$$;

create trigger klussen_factuurregel after update of gedaan_op on public.klussen
  for each row execute function public.klus_factuurregel_bijhouden();

-- ---------------------------------------------------------------------
-- 4. Dag klaar: methode bevriezen en regels maken
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit dag_klaar.sql, met twee dingen erbij: de
-- betaalmethode wordt vastgelegd op de regels die gedaan worden verklaard,
-- en aan het eind wordt geprobeerd de factuurregels te maken (die functie
-- kijkt zelf of de hele dag af is).
create or replace function public.dag_afmelden(dag date, ploeg smallint, weg uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  wegIds uuid[];
  kenmerk uuid;
  gedaan integer;
  nieuw uuid;
  regels integer;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if dag is null or dag > vandaag then
    raise exception 'Een dag kun je pas afmelden als hij begonnen is.';
  end if;

  perform set_config('wooshy.gedaan', '1', true);
  select coalesce(array_agg(r.customer_id), '{}') into wegIds
    from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg
      and r.customer_id = any (coalesce(weg, '{}'));
  if cardinality(wegIds) > 0 then
    kenmerk := public.wasdag_weghalen(dag, wegIds);
  end if;

  update public.wasdag_regels r
    set gedaan_op = now(),
        gedaan_door = auth.uid(),
        betaalmethode = coalesce(
          (select coalesce(cu.betaalmethode, d.betaalmethode, 'contant')
             from public.customers cu
             left join public.streets s on s.id = cu.street_id
             left join public.districts d on d.id = s.district_id
            where cu.id = r.customer_id),
          'contant')
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg and r.gedaan_op is null;
  get diagnostics gedaan = row_count;

  insert into public.dag_afmeldingen (company_id, datum, ploeg_nr, door, door_naam, gedaan, weg, weg_kenmerk)
    values (bedrijf, dag, ploeg, auth.uid(), public.geld_mijn_naam(), gedaan, cardinality(wegIds), kenmerk)
    returning id into nieuw;

  regels := public.factuurregels_maken(dag);

  return jsonb_build_object('id', nieuw, 'gedaan', gedaan, 'weg', cardinality(wegIds),
                            'factuurregels', regels);
end
$$;

-- ---------------------------------------------------------------------
-- 5. Heropenen: de regels gaan mee terug
-- ---------------------------------------------------------------------
-- Zolang het concepten zijn merk je er niets van: ze verdwijnen en komen
-- terug zodra de dag weer helemaal is afgemeld. Staat er al een factuur de
-- deur uit, dan houdt de app het tegen -- de klant heeft dat papier al, dus
-- dat rechtzetten gaat met een creditfactuur en niet stiekem.
create or replace function public.factuurregels_terug(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  verstuurd integer;
  weg integer;
begin
  select count(*) into verstuurd
    from public.factuurregels fr
    join public.facturen f on f.id = fr.factuur_id
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and fr.deleted_at is null and f.nummer is not null;
  if verstuurd > 0 then
    raise exception 'Voor % adres(sen) van deze dag is al een factuur verstuurd. Crediteer die eerst.', verstuurd;
  end if;

  delete from public.factuurregels fr
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt';
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.factuurregels_terug(date) from public, anon, authenticated;

create or replace function public.dag_heropenen(dag date, ploeg smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.dag_afmeldingen;
  n integer;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if not public.is_eigenaar() then
    if not exists (
      select 1 from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    ) then
      raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
    end if;
    for a in
      select * from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    loop
      if not public.dag_afmelding_mag_open(a) then
        raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
      end if;
    end loop;
  end if;

  -- Eerst de factuurregels: gaat dat niet, dan blijft de dag afgemeld staan.
  perform public.factuurregels_terug(dag);

  perform set_config('wooshy.gedaan', '1', true);
  update public.dag_afmeldingen
    set heropend_op = now(), heropend_door = auth.uid(), heropend_naam = public.geld_mijn_naam()
    where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null;
  update public.wasdag_regels
    set gedaan_op = null, gedaan_door = null, betaalmethode = null
    where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and gedaan_op is not null;
  get diagnostics n = row_count;
  return n;
end
$$;
