-- Wat de code-review op het lijstje panden ving: drie sloten die ontbraken.
--
--   1. Een creditnota kon zelf gecrediteerd worden. Via de knoppen kan het
--      niet -- het scherm laat die knop niet zien -- maar het slot hoort in de
--      database te zitten, niet alleen in het scherm. Anders kon er via
--      `factuur_opnieuw` een losse regel met een negatief bedrag ontstaan.
--   2. Dezelfde regel twee keer in één aanroep leverde twee nieuwe regels op
--      (of een rauwe databasefout), bijvoorbeeld bij twee keer klikken.
--   3. Een weggegooid adres of een weggegooide klant hield het opnieuw
--      aanmelden niet tegen, terwijl `factuurregels_maken` daar wél op let.

-- ---------------------------------------------------------------------
-- 1. Alleen een echte factuur is te crediteren
-- ---------------------------------------------------------------------
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
  if f.soort <> 'factuur' then
    raise exception 'Een creditnota kun je niet crediteren.';
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

  update public.factuurregels
    set vervangen_op = now()
    where factuur_id = factuur and company_id = bedrijf and vervangen_op is null;

  update public.facturen set status = 'gecrediteerd' where id = factuur;
  return nieuw;
end
$$;

-- ---------------------------------------------------------------------
-- 2 en 3. Opnieuw factureren: ontdubbeld, en niet voor weggelegde klanten
-- ---------------------------------------------------------------------
create or replace function public.factuur_opnieuw(factuur uuid, keuzes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  gemaakt integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;
  select * into f from public.facturen where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.soort <> 'factuur' then
    raise exception 'Dit kan alleen bij een gewone factuur.';
  end if;
  if f.status <> 'gecrediteerd' then
    raise exception 'Dit kan alleen bij een gecrediteerde factuur.';
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, wasdag_regel_id, klus_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select fr.company_id, fr.klant_id, fr.customer_id, fr.soort,
         fr.wasdag_regel_id, fr.klus_id, fr.datum,
         fr.omschrijving, fr.notitie,
         k.bedrag,
         fr.btw_inclusief, fr.btw_procent,
         public.factuur_excl(k.bedrag, fr.btw_inclusief, fr.btw_procent)
    -- Ontdubbeld: staat dezelfde regel twee keer in de lijst (twee keer
    -- klikken), dan komt hij er toch één keer bij. Het laatste bedrag wint.
    from (
      select distinct on (g.id) g.id, g.bedrag
        from jsonb_to_recordset(coalesce(keuzes, '[]'::jsonb)) as g(id uuid, bedrag numeric)
       where g.id is not null
       order by g.id, g.ordinality desc
    ) gekozen
    join public.factuurregels fr on fr.id = gekozen.id
    cross join lateral (
      select case when gekozen.bedrag is null or gekozen.bedrag <= 0
                  then fr.bedrag else round(gekozen.bedrag, 2) end as bedrag
    ) k
    -- Geen factuur maken voor een klant of adres dat in de prullenbak ligt;
    -- zelfde regel als bij het afmelden van een dag.
    join public.klanten kl on kl.id = fr.klant_id and kl.deleted_at is null
    left join public.customers cu on cu.id = fr.customer_id
    where fr.factuur_id = factuur and fr.company_id = bedrijf
      and fr.deleted_at is null
      and (fr.customer_id is null or cu.deleted_at is null)
      and not exists (
        select 1 from public.factuurregels x
        where x.deleted_at is null and x.vervangen_op is null
          and ((fr.wasdag_regel_id is not null and x.wasdag_regel_id = fr.wasdag_regel_id)
            or (fr.klus_id is not null and x.klus_id = fr.klus_id))
      );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuur_opnieuw(uuid, jsonb) from public, anon;
grant execute on function public.factuur_opnieuw(uuid, jsonb) to authenticated;
