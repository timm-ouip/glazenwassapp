-- Tweede betalingssysteem, fase 1c: van losse regels naar een factuur.
--
-- De volgorde is bewust in drieën geknipt:
--
--   klaarzetten  losse regels worden een concept. Nog geen nummer.
--   vastzetten   het concept trekt zijn nummer en bevriest de klantgegevens.
--                Vanaf hier is er niets meer aan te veranderen.
--   verstuurd    de mail is de deur uit; dit legt alleen vast dát het gelukt is.
--
-- Waarom vastzetten en versturen apart staan: als het mailen misgaat, heeft
-- de factuur zijn nummer al. Door hem dan gewoon te laten staan (met nummer,
-- nog niet verstuurd) kun je het opnieuw proberen met hetzelfde nummer. Zou
-- het nummer pas na een geslaagde mail getrokken worden, dan zou een
-- half-mislukte bulk gaten in de reeks achterlaten.

-- ---------------------------------------------------------------------
-- 1. Wat een factuur kost
-- ---------------------------------------------------------------------
create or replace function public.factuur_totalen(factuur uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'regels', count(*),
    'excl', coalesce(sum(fr.bedrag_excl), 0),
    'btw', coalesce(sum(fr.btw_bedrag), 0),
    'incl', coalesce(sum(fr.bedrag_incl), 0)
  )
  from public.factuurregels fr
  where fr.factuur_id = factuur and fr.deleted_at is null
$$;

revoke execute on function public.factuur_totalen(uuid) from public, anon, authenticated;

-- Waar de factuur heen moet: het aparte factuuradres als dat ingevuld is,
-- anders het gewone e-mailadres van de klant.
create or replace function public.factuur_mailadres(k public.klanten)
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(k.factuur_email), ''),
                  nullif(btrim(k.email), ''),
                  nullif(btrim(k.email2), ''),
                  '')
$$;

-- ---------------------------------------------------------------------
-- 2. Concepten vormen
-- ---------------------------------------------------------------------
-- Per klant zoals hij het wil: per beurt (dan is één dag één factuur) of
-- verzameld per maand. Bij "maand" wachten we tot de maand voorbij is,
-- anders stuur je halverwege een factuur en komt er daarna nog werk bij.
-- `nu_ook` doorbreekt dat wachten, voor de knop "toch nu klaarzetten".
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
-- 3. Vastzetten: nummer trekken en de gegevens bevriezen
-- ---------------------------------------------------------------------
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

  select * into f from public.facturen where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  -- Al vastgezet: geef gewoon terug wat er staat. Zo kan een mislukte
  -- verzending opnieuw, met hetzelfde nummer.
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
  -- De dag van de laatste beurt, niet de dag van versturen: dan valt de
  -- omzet in de maand van het werk.
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

-- Het mailen is gelukt. Meer doet dit niet.
create or replace function public.factuur_verstuurd(factuur uuid, via text, naar text, pdf text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen versturen.';
  end if;
  update public.facturen
    set status = 'verstuurd', verstuurd_op = now(),
        verstuurd_via = via, verstuurd_naar = coalesce(naar, ''), pdf_pad = coalesce(pdf, pdf_pad)
    where id = factuur and company_id = bedrijf and nummer is not null and status = 'concept';
  if not found then
    raise exception 'Deze factuur staat niet klaar om verstuurd te worden.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Betaald
-- ---------------------------------------------------------------------
-- Ook voor een deel: dan blijft de factuur openstaan voor de rest, en gaat
-- een herinnering straks over dat restbedrag en niet over het hele bedrag.
create or replace function public.factuur_betaald(factuur uuid, bedrag numeric, op date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  totaal numeric;
  nieuw numeric;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen betalingen afvinken.';
  end if;
  select * into f from public.facturen where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is null then
    raise exception 'Een concept kan nog niet betaald zijn.';
  end if;

  totaal := (public.factuur_totalen(factuur) ->> 'incl')::numeric;
  nieuw := round(coalesce(f.betaald_bedrag, 0) + bedrag, 2);
  if nieuw < 0 then
    nieuw := 0;
  end if;

  update public.facturen
    set betaald_bedrag = nieuw,
        betaald_op = case when nieuw >= totaal then coalesce(op, (now() at time zone 'Europe/Amsterdam')::date) else null end,
        status = case
                   when f.status = 'gecrediteerd' then 'gecrediteerd'
                   when nieuw >= totaal then 'betaald'
                   else 'verstuurd'
                 end
    where id = factuur;

  return jsonb_build_object('betaald', nieuw, 'totaal', totaal, 'open', round(totaal - nieuw, 2));
end
$$;

-- ---------------------------------------------------------------------
-- 5. Crediteren
-- ---------------------------------------------------------------------
-- Een verstuurde factuur veranderen mag niet: de klant heeft hem al. Dit
-- maakt een tegenfactuur met een eigen nummer uit dezelfde reeks, met
-- dezelfde regels maar dan negatief.
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

  update public.facturen set status = 'gecrediteerd' where id = factuur;
  return nieuw;
end
$$;

-- ---------------------------------------------------------------------
-- 6. De lijst
-- ---------------------------------------------------------------------
-- Eén functie voor de facturentab: de facturen met hun bedragen, de naam van
-- de klant en waar hij heen moet. Concepten eerst, dan op nummer aflopend.
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
        'klant', coalesce(nullif(btrim(k.bedrijfsnaam), ''), k.naam),
        'klanttype', k.klanttype,
        'mail', public.factuur_mailadres(k),
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
