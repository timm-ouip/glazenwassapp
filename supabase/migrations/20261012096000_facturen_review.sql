-- Wat de code-review op het factuursysteem ving.
--
-- Vier dingen, en ze gaan alle vier over dezelfde belofte: wat er in de app
-- staat moet kloppen met het papier dat de klant in huis heeft.

-- ---------------------------------------------------------------------
-- 1. Een regel mag niet alsnog aan een verstuurde factuur gehangen worden
-- ---------------------------------------------------------------------
-- De `using` keek wel of de factuur nog een concept was, de `with check`
-- niet. Daarmee kon je een losse regel alsnog aan een verstuurde factuur
-- koppelen en liep het bedrag in de app uit de pas met de PDF.
drop policy "Regel van een concept bijwerken" on public.factuurregels;
create policy "Regel van een concept bijwerken" on public.factuurregels for update to authenticated
  using (company_id = (select public.current_company_id())
    and (select public.heeft_recht('facturen'))
    and (factuur_id is null
         or exists (select 1 from public.facturen f
                    where f.id = factuurregels.factuur_id and f.nummer is null)))
  with check (company_id = (select public.current_company_id())
    and (factuur_id is null
         or exists (select 1 from public.facturen f
                    where f.id = factuurregels.factuur_id
                      and f.company_id = (select public.current_company_id())
                      and f.nummer is null)));

-- ---------------------------------------------------------------------
-- 2. Twee keer tegelijk versturen trekt geen twee nummers meer
-- ---------------------------------------------------------------------
-- De teller zelf kon al niet dubbelen, maar de controle ervóór ("heeft hij al
-- een nummer?") las zonder de rij vast te houden. Twee aanroepen die langs
-- elkaar liepen kregen daardoor allebei "nee" te horen. `for update` laat de
-- tweede wachten; die ziet dan het nummer van de eerste en geeft dat terug.
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
  termijn := public.factuur_termijn(k);
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

-- ---------------------------------------------------------------------
-- 3. Een weggelegde klant krijgt geen concept meer
-- ---------------------------------------------------------------------
-- Bij het máken van de regels werd al op de prullenbak gefilterd, maar een
-- klant die je dáárna weglegt kreeg alsnog een concept.
create or replace function public.facturen_klaarzetten(nu_ook boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  g record;
  nieuw uuid;
  gemaakt integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;

  for g in
    select
      fr.klant_id,
      case when k.factuur_per = 'maand' then date_trunc('month', fr.datum)::date else fr.datum end as bundel,
      array_agg(fr.id) as regels
    from public.factuurregels fr
    join public.klanten k on k.id = fr.klant_id
    where fr.company_id = bedrijf and fr.factuur_id is null and fr.deleted_at is null
      and k.deleted_at is null
      and (k.factuur_per = 'beurt'
           or nu_ook
           or fr.datum < date_trunc('month', vandaag)::date)
    group by 1, 2
  loop
    insert into public.facturen (company_id, klant_id)
      values (bedrijf, g.klant_id)
      returning id into nieuw;
    update public.factuurregels
      set factuur_id = nieuw
      where id = any (g.regels);
    gemaakt := gemaakt + 1;
  end loop;

  return gemaakt;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Heropenen laat geen lege concepten achter
-- ---------------------------------------------------------------------
-- De regels gingen mee terug, het concept bleef staan: een factuur van € 0,00
-- met nul regels die je niet kunt versturen en met de hand moest weggooien.
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

  delete from public.facturen f
    where f.company_id = bedrijf and f.nummer is null
      and not exists (select 1 from public.factuurregels fr where fr.factuur_id = f.id);

  return weg;
end
$$;
