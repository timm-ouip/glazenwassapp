-- De losse factuur, maar dan zoals een echte factuur.
--
-- De eerste versie kende per regel alleen een omschrijving en een bedrag, en
-- rekende de btw altijd zoals het klanttype zei. Voor een offerte die
-- doorgaat of een klus bij een bedrijf is dat te weinig:
--
--   * "3x dakkapel gewassen à € 5" -- aantal, eenheid en stukprijs per regel,
--     en het totaal rekent zichzelf uit;
--   * zelf kiezen of je inclusief of exclusief btw intypt, en per regel het
--     tarief (21%, 9% of 0%);
--   * een onderwerp ("Betreft"), het kenmerk van de klant (een inkoopnummer
--     bij een bedrijf of VvE), een eigen betaaltermijn en een opmerking
--     onderaan.
--
-- Alles wat hier bij komt heeft een standaard die precies doet wat het al
-- deed, dus de gewone regels uit de planning merken er niets van.

-- ---------------------------------------------------------------------
-- 1. Aantal, eenheid en stukprijs op een regel
-- ---------------------------------------------------------------------
-- `bedrag` blijft het totaal van de regel (aantal x stukprijs), zoals het
-- altijd al was; daar rekent alles op. Aantal en stukprijs staan ernaast
-- zodat de PDF "3 x € 5,00" kan laten zien. Een stukprijs die leeg is, is
-- een gewone regel van één keer het bedrag.

alter table public.factuurregels
  add column if not exists aantal numeric(10, 2) not null default 1,
  add column if not exists eenheid text not null default '',
  add column if not exists stukprijs numeric(10, 2);

comment on column public.factuurregels.aantal is
  'Hoeveel keer. Alleen een losse factuur zet hier iets anders dan 1.';
comment on column public.factuurregels.eenheid is
  'Waarvan: x, uur, stuks, m². Leeg is gewoon een bedrag.';
comment on column public.factuurregels.stukprijs is
  'Prijs per eenheid, op dezelfde manier inclusief of exclusief btw als bedrag. Leeg als de regel geen aantal kent.';

-- ---------------------------------------------------------------------
-- 2. Wat er boven en onder de regels staat
-- ---------------------------------------------------------------------

alter table public.facturen
  add column if not exists onderwerp text not null default '',
  add column if not exists kenmerk text not null default '',
  add column if not exists opmerking text not null default '',
  add column if not exists termijn_dagen integer;

alter table public.facturen
  drop constraint if exists facturen_termijn_dagen_check;
alter table public.facturen
  add constraint facturen_termijn_dagen_check
  check (termijn_dagen is null or termijn_dagen between 0 and 365);

comment on column public.facturen.onderwerp is 'Betreft: waar deze factuur over gaat.';
comment on column public.facturen.kenmerk is 'Het kenmerk van de klant, bijvoorbeeld een inkoopnummer.';
comment on column public.facturen.opmerking is 'Vrije tekst onder de regels.';
comment on column public.facturen.termijn_dagen is
  'Eigen betaaltermijn voor deze ene factuur. Leeg = die van de klant of het bedrijf.';

-- ---------------------------------------------------------------------
-- 3. De losse factuur maken
-- ---------------------------------------------------------------------
-- Nieuwe vorm: een derde argument met de gegevens van de factuur zelf. De
-- oude met twee argumenten gaat weg, anders kiest PostgREST er soms de
-- verkeerde van.

drop function if exists public.factuur_los_maken(uuid, jsonb);

create or replace function public.factuur_los_maken(
  klant uuid,
  regels jsonb,
  gegevens jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  k public.klanten;
  nieuw uuid;
  r jsonb;
  aantal_regel numeric;
  stuk numeric;
  bedrag numeric;
  inclusief boolean;
  procent numeric;
  standaard_procent numeric;
  termijn integer;
  aantal integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;

  select * into k from public.klanten
    where id = klant and company_id = bedrijf and deleted_at is null;
  if not found then
    raise exception 'Die klant bestaat niet.';
  end if;

  if jsonb_typeof(regels) <> 'array' or jsonb_array_length(regels) = 0 then
    raise exception 'Een factuur zonder regels kan niet.';
  end if;
  if jsonb_array_length(regels) > 200 then
    raise exception 'Maximaal 200 regels per factuur.';
  end if;

  gegevens := coalesce(gegevens, '{}'::jsonb);

  -- Inclusief of exclusief: wat je koos, anders wat bij de klant hoort.
  inclusief := coalesce((gegevens ->> 'inclusief')::boolean, public.factuur_btw_inclusief(k));
  standaard_procent := public.factuur_btw_procent(k);

  termijn := nullif(gegevens ->> 'termijn', '')::integer;
  if termijn is not null and (termijn < 0 or termijn > 365) then
    raise exception 'Een betaaltermijn ligt tussen 0 en 365 dagen.';
  end if;

  insert into public.facturen (
    company_id, klant_id, soort, status, onderwerp, kenmerk, opmerking, termijn_dagen
  ) values (
    bedrijf, klant, 'factuur', 'concept',
    left(btrim(coalesce(gegevens ->> 'onderwerp', '')), 200),
    left(btrim(coalesce(gegevens ->> 'kenmerk', '')), 100),
    left(btrim(coalesce(gegevens ->> 'opmerking', '')), 1000),
    termijn
  )
  returning id into nieuw;

  for r in select * from jsonb_array_elements(regels) loop
    if btrim(coalesce(r ->> 'omschrijving', '')) = '' then
      raise exception 'Een regel zonder omschrijving kan niet.';
    end if;

    aantal_regel := coalesce(nullif(r ->> 'aantal', '')::numeric, 1);
    if aantal_regel = 0 or abs(aantal_regel) >= 100000000 then
      raise exception 'Dat aantal kan niet: %.', aantal_regel;
    end if;

    -- Met een stukprijs rekent de regel zelf zijn totaal uit; zonder is het
    -- een gewoon bedrag, zoals in de eerste versie.
    stuk := round(nullif(r ->> 'stukprijs', '')::numeric, 2);
    if stuk is not null then
      bedrag := round(aantal_regel * stuk, 2);
    else
      bedrag := round(nullif(r ->> 'bedrag', '')::numeric, 2);
    end if;
    if bedrag is null then
      raise exception 'Een regel zonder bedrag kan niet.';
    end if;

    procent := coalesce(nullif(r ->> 'btw_procent', '')::numeric, standaard_procent);
    if procent < 0 or procent > 100 then
      raise exception 'Dat btw-tarief kan niet: %.', procent;
    end if;

    insert into public.factuurregels (
      company_id, klant_id, soort, datum, omschrijving, notitie,
      aantal, eenheid, stukprijs,
      bedrag, btw_inclusief, btw_procent, bedrag_excl, factuur_id
    ) values (
      bedrijf,
      klant,
      'los',
      coalesce(nullif(r ->> 'datum', '')::date, (now() at time zone 'Europe/Amsterdam')::date),
      left(btrim(r ->> 'omschrijving'), 200),
      left(btrim(coalesce(r ->> 'notitie', '')), 200),
      aantal_regel,
      left(btrim(coalesce(r ->> 'eenheid', '')), 20),
      stuk,
      bedrag,
      inclusief,
      procent,
      public.factuur_excl(bedrag, inclusief, procent),
      nieuw
    );
    aantal := aantal + 1;
  end loop;

  if aantal = 0 then
    raise exception 'Een factuur zonder regels kan niet.';
  end if;

  return nieuw;
end
$$;

revoke execute on function public.factuur_los_maken(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.factuur_los_maken(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Vastzetten: de eigen termijn gaat voor
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit 20261012096000_facturen_review, op één regel na:
-- heeft de factuur een eigen termijn, dan telt die.

create or replace function public.factuur_vastzetten(factuur uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  k public.klanten;
  laatste date;
  aantal integer;
  volg integer;
  jr smallint;
  termijn integer;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen versturen.';
  end if;

  select * into f from public.facturen
    where id = factuur and company_id = bedrijf
    for update;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is not null then
    return jsonb_build_object('id', f.id, 'nummer', f.nummer, 'factuurdatum', f.factuurdatum,
                              'vervaldatum', f.vervaldatum, 'opnieuw', true);
  end if;

  select count(*), max(fr.datum) into aantal, laatste
    from public.factuurregels fr
    where fr.factuur_id = factuur and fr.deleted_at is null;
  if coalesce(aantal, 0) = 0 then
    raise exception 'Een factuur zonder regels kun je niet versturen.';
  end if;

  select * into k from public.klanten where id = f.klant_id;
  termijn := coalesce(f.termijn_dagen, public.factuur_termijn(k));
  jr := extract(year from laatste)::smallint;
  volg := public.factuur_nummer_trekken(bedrijf, jr);

  update public.facturen
    set nummer = jr::text || '-' || lpad(volg::text, 4, '0'),
        jaar = jr,
        volgnummer = volg,
        factuurdatum = laatste,
        vervaldatum = laatste + termijn,
        klantgegevens = jsonb_build_object(
          'naam', k.naam,
          'klanttype', k.klanttype,
          'bedrijfsnaam', k.bedrijfsnaam,
          'kvk', k.kvk,
          'btw_nummer', k.btw_nummer,
          'straat', coalesce(nullif(btrim(k.factuur_straat), ''), k.straat),
          'huisnummer', coalesce(nullif(btrim(k.factuur_huisnummer), ''), k.huisnummer),
          'postcode', coalesce(nullif(btrim(k.factuur_postcode), ''), k.postcode),
          'plaats', coalesce(nullif(btrim(k.factuur_plaats), ''), k.plaats),
          'email', public.factuur_mailadres(k),
          'termijn', termijn
        )
    where id = factuur;

  return jsonb_build_object('id', factuur,
                            'nummer', jr::text || '-' || lpad(volg::text, 4, '0'),
                            'factuurdatum', laatste,
                            'vervaldatum', laatste + termijn,
                            'opnieuw', false);
end
$$;
