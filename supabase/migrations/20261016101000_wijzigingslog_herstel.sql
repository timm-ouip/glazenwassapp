-- Herstel van het wijzigingslog (20261016100000), na de review.
--
-- 1. De tabel krijgt de vangrail set_company_id, zoals elke tabel.
-- 2. Extra werk en zijn meerprijs gaan samen terug: los terugzetten van het
--    werk (bijvoorbeeld door een planner die de prijs niet ziet) zou het werk
--    terugbrengen zonder prijs. De duur die de database zelf bij extra werk
--    invult telt niet als "intussen gewijzigd".
-- 3. Wat de server schrijft (service-role-sleutel) heet 'systeem', niet
--    'paaltje': daar valt ook een klant onder die zich aanmeldt.
-- 4. Een klantwissel gaat niet terug naar een klant die weg is.

create trigger wijzigingen_set_company_id before insert on public.wijzigingen
  for each row execute function public.set_company_id();

-- Het extra werk zonder de duur per stuk.
create or replace function public.maandwerk_zonder_duur(maandwerk jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(w) = 'object' then w - 'duur' - 'duur_zelf' else w end
           order by nr), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(maandwerk) = 'array' then maandwerk else '[]'::jsonb end)
       with ordinality as t(w, nr)
$$;

-- Hoort er bij deze wijziging van het extra werk een meerprijs (zelfde adres,
-- binnen een minuut, nog niet teruggezet, en nog zoals hij nu staat) die niet
-- in `ids` zit? Security
-- definer, omdat wie de prijzen niet ziet die regel ook niet kan lezen; er
-- komt alleen ja of nee uit.
create or replace function public.wijziging_meerprijs_los(wijziging uuid, ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wijzigingen w
    join public.wijzigingen m
      on m.company_id = w.company_id and m.customer_id = w.customer_id
     and m.veld = 'meerprijs' and m.bron = 'app' and m.teruggedraaid_op is null
     and m.op between w.op - interval '1 minute' and w.op + interval '1 minute'
    -- Alleen de meerprijs die nu nog staat (een oudere is al voorbij).
    join public.adres_prijzen ap
      on ap.customer_id = m.customer_id and ap.maandwerk_extra = m.na -> 'maandwerk_extra'
    where w.id = wijziging
      and w.company_id = public.current_company_id()
      and not (m.id = any (ids))
  )
$$;
revoke execute on function public.wijziging_meerprijs_los(uuid, uuid[]) from public, anon;
grant execute on function public.wijziging_meerprijs_los(uuid, uuid[]) to authenticated;

create or replace function public.log_wijziging()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  oud jsonb := to_jsonb(old);
  nieuw jsonb := to_jsonb(new);
  wie uuid := auth.uid();
  herroepen uuid := nullif(current_setting('wooshy.herroept', true), '')::uuid;
  herkomst text;
  naam text;
  rij uuid;
  adres uuid;
  klant uuid;
  aangemaakt timestamptz;
  arg text;
  veldnaam text;
  kolommen text[];
  waarde_voor jsonb;
  waarde_na jsonb;
begin
  if coalesce(current_setting('wooshy.geen_log', true), '') = '1'
     or coalesce(current_setting('wooshy.geldloop', true), '') = '1' then
    return null;
  end if;

  herkomst := case
    when coalesce(current_setting('wooshy.wissel', true), '') = '1' then 'systeem'
    -- De server (service-role-sleutel) is niet alleen Paaltje: ook een klant
    -- die zich aanmeldt, of een medewerker die in de mailbox op doorvoeren
    -- klikt. Wie het was weten we daar niet, dus: automatisch.
    when wie is null then 'systeem'
    else 'app'
  end;

  if tg_table_name = 'customers' then
    rij := (nieuw ->> 'id')::uuid;
    adres := rij;
    aangemaakt := (nieuw ->> 'created_at')::timestamptz;
  elsif tg_table_name = 'adres_prijzen' then
    rij := (nieuw ->> 'customer_id')::uuid;
    adres := rij;
  elsif tg_table_name = 'klanten' then
    rij := (nieuw ->> 'id')::uuid;
    klant := rij;
    aangemaakt := (nieuw ->> 'created_at')::timestamptz;
  else
    rij := (nieuw ->> 'id')::uuid;
    adres := (nieuw ->> 'customer_id')::uuid;
    if adres is null then
      return null;
    end if;
  end if;

  foreach arg in array tg_argv loop
    veldnaam := split_part(arg, ':', 1);
    kolommen := string_to_array(split_part(arg, ':', 2), ',');
    select jsonb_object_agg(k, oud -> k), jsonb_object_agg(k, nieuw -> k)
      into waarde_voor, waarde_na
      from unnest(kolommen) as k;
    continue when waarde_voor = waarde_na;

    -- Het eerste invullen van iets dat net gemaakt is, is geen wijziging.
    if herroepen is null and tg_table_name <> 'wasdag_regels'
       and not exists (
         select 1 from jsonb_each(waarde_voor) e
         where e.value not in ('null'::jsonb, '""'::jsonb, '0'::jsonb, '[]'::jsonb, '{}'::jsonb, 'false'::jsonb)
       ) then
      if aangemaakt is null and tg_table_name = 'adres_prijzen' then
        select c.created_at into aangemaakt from public.customers c where c.id = adres;
      end if;
      continue when aangemaakt > now() - interval '15 minutes';
    end if;

    if naam is null then
      naam := coalesce(public.geld_mijn_naam(), '');
    end if;
    insert into public.wijzigingen
      (company_id, tabel, rij_id, customer_id, klant_id, veld, voor, na, door, door_naam, bron, herroept)
    values
      ((nieuw ->> 'company_id')::uuid, tg_table_name, rij, adres, klant, veldnaam, waarde_voor, waarde_na, wie, naam, herkomst, herroepen);

    -- Een Ongedaan maken (wijzigingen_ongedaan): de oude regel is pas
    -- teruggedraaid als de waarden echt weer zijn wat er vóór stond.
    if herroepen is not null then
      update public.wijzigingen w
        set teruggedraaid_op = now(), teruggedraaid_door = wie, teruggedraaid_naam = naam
        where w.id = herroepen
          and w.company_id = (nieuw ->> 'company_id')::uuid
          and w.tabel = tg_table_name and w.rij_id = rij and w.veld = veldnaam
          and w.voor = waarde_na
          and w.teruggedraaid_op is null;
    end if;
  end loop;
  return null;
end
$$;
revoke execute on function public.log_wijziging() from public, anon, authenticated;

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
revoke execute on function public.maandwerk_zonder_duur(jsonb) from public, anon;
grant execute on function public.maandwerk_zonder_duur(jsonb) to authenticated;
