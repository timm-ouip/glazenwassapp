-- Twee reparaties aan de losse factuur.
--
-- 1. Een los concept weggooien liet zijn regels achter. De koppeling van regel
--    naar factuur is "on delete set null", en dat is juist voor regels uit de
--    planning: die wachten dan op een volgende factuur. Maar een regel die je
--    zelf in een losse factuur hebt getypt, bestaat alleen voor dát concept.
--    Bleef hij staan, dan zette "Concepten klaarzetten" hem later ongevraagd
--    op een gewone factuur. Nu gaan ze mee als het concept weggaat.
--
-- 2. Het aantal wordt afgerond vóór het rekenen, zodat aantal x prijs precies
--    het bedrag is dat er staat.

-- ---------------------------------------------------------------------
-- 1. Losse regels gaan mee met hun concept
-- ---------------------------------------------------------------------

create or replace function public.factuur_losse_regels_mee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.factuurregels
    where factuur_id = old.id and soort = 'los';
  return old;
end
$$;

drop trigger if exists facturen_losse_regels_mee on public.facturen;
create trigger facturen_losse_regels_mee
  before delete on public.facturen
  for each row execute function public.factuur_losse_regels_mee();

-- Wat er al los is komen te staan, heeft geen concept meer om bij te horen.
delete from public.factuurregels where soort = 'los' and factuur_id is null;

-- ---------------------------------------------------------------------
-- 2. Het aantal eerst afronden
-- ---------------------------------------------------------------------

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

    -- Eerst afronden zoals de kolom het bewaart, dan pas controleren en
    -- rekenen: anders staat er "1,33 x € 10" bij een bedrag van € 13,33.
    aantal_regel := round(coalesce(nullif(r ->> 'aantal', '')::numeric, 1), 2);
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
