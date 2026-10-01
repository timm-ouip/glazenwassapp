-- Herstel van 20261016104000 (verhuizing verbergen), na de review.
--
-- 1. De geldloper die een verhuizing in zijn ronde terugdraait
--    (geldloop_wijziging_terugdraaien) haalt de geschiedenis ook terug, ook
--    zonder het recht planning of klanten_bewerken.
-- 2. Neemt de vorige klant het adres weer over (bekend_adres_overnemen met
--    de vorige klant), dan komt zijn geschiedenis terug.
-- 3. De nachtelijke opruimtaak wist niets van een klant die weer actief op
--    hetzelfde adres staat (bijvoorbeeld na "weer actief" en de klant uit de
--    prullenbak).
-- 4. Ongedaan maken weigert een verborgen regel (van de vorige bewoner).

-- 1.
create or replace function public.verhuizing_log_terug(
  adressen uuid[],
  moment timestamptz,
  voor_bedrijf uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  regels uuid[];
  terug integer;
begin
  if bedrijf is null or moment is null then
    return 0;
  end if;
  -- Wie het stoppen mocht terugdraaien: de server, wie adressen mag
  -- wijzigen, of de geldloper via geldloop_wijziging_terugdraaien (die zet
  -- wooshy.geldloop zelf; vanuit de browser kan dat niet).
  if not (auth.role() = 'service_role'
          or coalesce(current_setting('wooshy.geldloop', true), '') = '1'
          or public.heeft_recht('planning')
          or public.heeft_recht('klanten_bewerken')) then
    return 0;
  end if;

  select coalesce(array_agg(v.id), '{}') into regels
  from public.wijzigingen v
  join public.customers c on c.id = v.customer_id and c.company_id = bedrijf
  where v.company_id = bedrijf
    and v.customer_id = any(adressen)
    and v.veld = 'verhuisd'
    and v.op = moment
    and v.teruggedraaid_op is null
    and c.deleted_at is null
    and c.inactief_op is null
    and c.klant_id is not distinct from nullif(v.voor ->> 'klant_id', '')::uuid;
  if cardinality(regels) = 0 then
    return 0;
  end if;

  update public.wijzigingen
  set verborgen_door = null
  where company_id = bedrijf and verborgen_door = any(regels);
  get diagnostics terug = row_count;

  update public.wijzigingen
  set teruggedraaid_op = now(),
      teruggedraaid_door = auth.uid(),
      teruggedraaid_naam = coalesce(public.geld_mijn_naam(), '')
  where company_id = bedrijf and id = any(regels);

  return terug;
end
$$;


-- 2. Gelijk aan 20260920090000_inactief.sql, met de geschiedenis terug.
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
  moment timestamptz;
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

  select id, klant_id, inactief_op into adres_id, vorige, moment from public.customers
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

  -- Komt de vorige klant terug, dan ook zijn geschiedenis (na een verhuizing).
  if met_vorige_klant then
    perform public.verhuizing_log_terug(array[adres_id], moment, bedrijf);
  end if;

  update public.aanmeldingen
  set status = 'klaar', klant_id = klant
  where id = a.id;

  return klant;
end
$$;

revoke all on function public.bekend_adres_overnemen(uuid, boolean) from public, anon;
grant execute on function public.bekend_adres_overnemen(uuid, boolean) to authenticated;

-- 3.
create or replace function public.verhuizing_log_opruimen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  weg integer;
begin
  delete from public.wijzigingen w
  using public.wijzigingen v
  join public.customers c on c.id = v.customer_id
  where w.verborgen_door = v.id
    and v.veld = 'verhuisd'
    and v.teruggedraaid_op is null
    and v.op < now() - interval '1 year'
    -- Staat dezelfde klant weer actief op het adres, dan is hij niet weg.
    and not (
      c.inactief_op is null
      and c.deleted_at is null
      and c.klant_id is not null
      and c.klant_id = nullif(v.voor ->> 'klant_id', '')::uuid
      and exists (select 1 from public.klanten k where k.id = c.klant_id and k.deleted_at is null)
    );
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.verhuizing_log_opruimen() from public, anon, authenticated;

-- 4. Gelijk aan 20261016101000_wijzigingslog_herstel.sql, met de verborgen regels erbij.
create or replace function public.wijzigingen_ongedaan(ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  w public.wijzigingen;
  sleutel text;
  kolommen text[];
  nu jsonb;
  n integer;
  aantal integer := 0;
  vlag text := coalesce(current_setting('wooshy.herroept', true), '');
begin
  if public.current_company_id() is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if (select count(*) from public.wijzigingen where id = any (ids))
     <> (select count(distinct x) from unnest(ids) as x) then
    raise exception 'Die wijziging bestaat niet (meer).';
  end if;

  for w in select * from public.wijzigingen where id = any (ids) order by op desc, id loop
    if w.teruggedraaid_op is not null then
      raise exception 'Deze wijziging is al ongedaan gemaakt.';
    end if;
    if w.tabel = 'wasdag_regels' then
      raise exception 'Een verplaatsing zet je terug in de planning.';
    end if;
    if w.bron = 'paaltje' then
      raise exception 'Dit deed Paaltje; maak het daar ongedaan.';
    end if;
    if w.bron = 'systeem' then
      raise exception 'Dit ging automatisch; dat zet je hier niet terug.';
    end if;
    if w.verborgen_door is not null then
      raise exception 'Dit hoort bij de vorige bewoner; dat zet je niet terug.';
    end if;

    -- Extra werk en zijn meerprijs worden los bewaard; terug gaan ze samen,
    -- anders komt het werk terug zonder zijn prijs.
    if w.veld = 'extra_werk' and public.wijziging_meerprijs_los(w.id, ids) then
      raise exception 'Het extra werk ging samen met de meerprijs; die zet alleen wie prijzen mag zien samen terug.';
    end if;
    -- Een vorige klant die weg is, komt niet terug aan het adres.
    if w.veld = 'klant' and nullif(w.voor ->> 'klant_id', '') is not null
       and not exists (select 1 from public.klanten k
                       where k.id = (w.voor ->> 'klant_id')::uuid and k.deleted_at is null) then
      raise exception 'De vorige klant is er niet meer; koppel de klant in het dossier.';
    end if;

    sleutel := case when w.tabel = 'adres_prijzen' then 'customer_id' else 'id' end;
    kolommen := array(select jsonb_object_keys(w.na));

    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', w.tabel, sleutel)
      into nu using w.rij_id;
    if nu is null then
      raise exception 'Dit staat er niet meer.';
    end if;
    -- De duur die de database zelf bij het extra werk invult, telt niet als
    -- opnieuw gewijzigd.
    if (case when w.veld = 'extra_werk'
             then public.maandwerk_zonder_duur(nu -> 'maandwerk') is distinct from public.maandwerk_zonder_duur(w.na -> 'maandwerk')
             else (select jsonb_object_agg(k, nu -> k) from unnest(kolommen) as k) is distinct from w.na
        end) then
      raise exception 'Intussen opnieuw gewijzigd; pas het in het dossier aan.';
    end if;

    perform set_config('wooshy.herroept', w.id::text, true);
    begin
      execute format(
        'update public.%1$I t set (%2$s) = (select %3$s from jsonb_populate_record(null::public.%1$I, $1) r) where t.%4$I = $2',
        w.tabel,
        (select string_agg(format('%I', k), ', ') from unnest(kolommen) as k),
        (select string_agg(format('r.%I', k), ', ') from unnest(kolommen) as k),
        sleutel)
        using w.voor, w.rij_id;
      get diagnostics n = row_count;
    exception when insufficient_privilege then
      raise exception 'Je rol mag dit niet terugzetten.';
    end;
    perform set_config('wooshy.herroept', vlag, true);
    if n = 0 then
      raise exception 'Je rol mag dit niet terugzetten.';
    end if;
    if not exists (select 1 from public.wijzigingen x where x.id = w.id and x.teruggedraaid_op is not null) then
      raise exception 'Terugzetten lukte niet: het kwam anders uit dan wat er eerst stond.';
    end if;
    aantal := aantal + 1;
  end loop;
  return aantal;
end
$$;

revoke execute on function public.wijzigingen_ongedaan(uuid[]) from public, anon;
grant execute on function public.wijzigingen_ongedaan(uuid[]) to authenticated;
