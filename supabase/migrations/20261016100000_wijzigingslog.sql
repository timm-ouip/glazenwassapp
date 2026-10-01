-- Het wijzigingslog voor het klantdossier.
--
-- Elke wijziging aan een adres (frequentie, notitie, overslaan, kleur,
-- betaalmethode, klant, extra werk, duur, eigen blok), aan de prijs en aan
-- de klantgegevens komt met voor en na in `wijzigingen`. Het dossier laat ze
-- zien onder Geschiedenis ("Prijs gewijzigd van € 11,50 naar € 12,50 · door
-- Timmie"), met Ongedaan maken. Een verplaatsing in de planning komt er ook
-- in, maar die zet je terug in de planning zelf.
--
-- Eén regel is één ding dat samen terug moet: de frequentie is interval én
-- ritme, overslaan is de lijst én de startmaand. `voor` en `na` zijn altijd
-- een object met de kolommen als sleutel.
--
-- Wat er niet in komt:
-- * wat de geldloper doet (wooshy.geldloop): die heeft zijn eigen log;
-- * het herberekenen van de duur (wooshy.geen_log): dat heeft zijn eigen
--   Ongedaan maken, en het gaat over honderden adressen tegelijk;
-- * het eerste invullen van een net gemaakt adres of een net gemaakte klant
--   (de import en "+ Adres" zetten de prijs pas ná het aanmaken).
-- De automatische wissel naar overmaken (wooshy.wissel) komt er wél in, als
-- 'systeem', en wat de server doet (Paaltje) als 'paaltje'. Die twee zet je
-- hier niet terug: de wissel heeft zijn eigen knop, Paaltje zijn eigen log.

create table public.wijzigingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  tabel text not null check (tabel in ('customers', 'adres_prijzen', 'klanten', 'wasdag_regels')),
  rij_id uuid not null,
  customer_id uuid,
  klant_id uuid,
  veld text not null,
  voor jsonb not null default '{}'::jsonb,
  na jsonb not null default '{}'::jsonb,
  door uuid,
  door_naam text not null default '',
  bron text not null default 'app' check (bron in ('app', 'paaltje', 'systeem')),
  op timestamptz not null default now(),
  herroept uuid,
  teruggedraaid_op timestamptz,
  teruggedraaid_door uuid,
  teruggedraaid_naam text,
  -- Klantgegevens hangen aan de klant, al het andere aan het adres. Zo gaat
  -- het log mee als een klant (of een adres) definitief gewist wordt.
  check ((tabel = 'klanten') = (klant_id is not null)),
  check ((tabel = 'klanten') = (customer_id is null)),
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  foreign key (klant_id, company_id) references public.klanten (id, company_id) on delete cascade
);
create index wijzigingen_adres on public.wijzigingen (company_id, customer_id, op desc)
  where customer_id is not null;
create index wijzigingen_klant on public.wijzigingen (company_id, klant_id, op desc)
  where klant_id is not null;

alter table public.wijzigingen enable row level security;
revoke all on public.wijzigingen from anon, authenticated;
grant select on public.wijzigingen to authenticated;
-- Alleen lezen, en alleen wie het dossier mag zien. Prijzen alleen met
-- prijzen_zien. Schrijven doen alleen de triggers hieronder.
create policy "Wijzigingen lezen" on public.wijzigingen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      (select public.heeft_recht('planning'))
      or (select public.heeft_recht('klanten_bekijken'))
      or (select public.heeft_recht('klanten_bewerken'))
    )
    and (tabel <> 'adres_prijzen' or (select public.heeft_recht('prijzen_zien')))
  );

-- ---------------------------------------------------------------------
-- Vastleggen
-- ---------------------------------------------------------------------
-- De argumenten zijn de velden, elk als 'veld:kolom1,kolom2'.
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
    when wie is null and auth.role() = 'service_role' then 'paaltje'
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
      naam := case when herkomst = 'paaltje' then 'Paaltje' else coalesce(public.geld_mijn_naam(), '') end;
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

create trigger customers_wijzigingen
  after update on public.customers
  for each row
  when ((old.interval_maanden, old.ritme, old.note, old.overslaan, old.start_maand, old.markering,
         old.betaalmethode, old.klant_id, old.maandwerk, old.duur_min, old.duur_zelf, old.eigen_blok)
        is distinct from
        (new.interval_maanden, new.ritme, new.note, new.overslaan, new.start_maand, new.markering,
         new.betaalmethode, new.klant_id, new.maandwerk, new.duur_min, new.duur_zelf, new.eigen_blok))
  execute function public.log_wijziging(
    'frequentie:interval_maanden,ritme', 'notitie:note', 'overslaan:overslaan,start_maand',
    'markering:markering', 'betaalmethode:betaalmethode', 'klant:klant_id', 'extra_werk:maandwerk',
    'duur:duur_min,duur_zelf', 'eigen_blok:eigen_blok');

create trigger adres_prijzen_wijzigingen
  after update on public.adres_prijzen
  for each row
  when ((old.prijs, old.maandwerk_extra) is distinct from (new.prijs, new.maandwerk_extra))
  execute function public.log_wijziging('prijs:prijs', 'meerprijs:maandwerk_extra');

create trigger klanten_wijzigingen
  after update on public.klanten
  for each row
  when ((old.naam, old.telefoon, old.telefoon2, old.email, old.email2, old.klanttype, old.bedrijfsnaam,
         old.kvk, old.btw_nummer, old.factuur_per, old.factuur_email, old.factuur_straat,
         old.factuur_huisnummer, old.factuur_postcode, old.factuur_plaats, old.betalingstermijn_dagen,
         old.btw_procent, old.btw_inclusief, old.factuur_omschrijving)
        is distinct from
        (new.naam, new.telefoon, new.telefoon2, new.email, new.email2, new.klanttype, new.bedrijfsnaam,
         new.kvk, new.btw_nummer, new.factuur_per, new.factuur_email, new.factuur_straat,
         new.factuur_huisnummer, new.factuur_postcode, new.factuur_plaats, new.betalingstermijn_dagen,
         new.btw_procent, new.btw_inclusief, new.factuur_omschrijving))
  execute function public.log_wijziging(
    'naam:naam', 'telefoon:telefoon', 'telefoon2:telefoon2', 'email:email', 'email2:email2',
    'klanttype:klanttype', 'bedrijfsnaam:bedrijfsnaam', 'kvk:kvk', 'btw_nummer:btw_nummer',
    'factuur_per:factuur_per', 'factuur_email:factuur_email',
    'factuuradres:factuur_straat,factuur_huisnummer,factuur_postcode,factuur_plaats',
    'betalingstermijn:betalingstermijn_dagen', 'btw:btw_procent,btw_inclusief',
    'factuur_omschrijving:factuur_omschrijving');

-- Verplaatsen in de planning. Alleen vastleggen: Dag klaar, de factuurregels
-- en de ronde merken hier niets van (een AFTER-trigger die alleen schrijft
-- in het log).
create trigger wasdag_regels_verplaatst
  after update of datum on public.wasdag_regels
  for each row
  when (old.datum is distinct from new.datum and new.customer_id is not null)
  execute function public.log_wijziging('verplaatst:datum');

-- ---------------------------------------------------------------------
-- Ongedaan maken
-- ---------------------------------------------------------------------
-- Met de rechten van wie het vraagt (security invoker): de gewone regels op
-- adressen, prijzen en klanten beslissen of het mag. Alles of niets.
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

    sleutel := case when w.tabel = 'adres_prijzen' then 'customer_id' else 'id' end;
    kolommen := array(select jsonb_object_keys(w.na));

    execute format('select to_jsonb(t) from public.%I t where t.%I = $1', w.tabel, sleutel)
      into nu using w.rij_id;
    if nu is null then
      raise exception 'Dit staat er niet meer.';
    end if;
    if (select jsonb_object_agg(k, nu -> k) from unnest(kolommen) as k) is distinct from w.na then
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

-- ---------------------------------------------------------------------
-- De duur herberekenen hoort niet in het log (wooshy.geen_log). Verder
-- gelijk aan de huidige versies.
-- ---------------------------------------------------------------------
create or replace function public.adres_duur_vullen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tarief numeric;
  vlag text := coalesce(current_setting('wooshy.geen_log', true), '');
begin
  select plan_tarief_uur into tarief from public.companies where id = new.company_id;
  if tarief is null or tarief <= 0 then
    return null;
  end if;
  perform set_config('wooshy.geen_log', '1', true);

  if coalesce(new.prijs, 0) > 0 then
    update public.customers c
       set duur_min = public.duur_uit_prijs(new.prijs, tarief)
     where c.id = new.customer_id
       and c.duur_min is null;
  end if;

  -- Elk stuk maandwerk met een meerprijs en zonder duur.
  update public.customers c
     set maandwerk = (
       select coalesce(jsonb_agg(
         case
           when coalesce(jsonb_typeof(w -> 'duur'), '') = 'number'
             or coalesce(w ->> 'id', '') = ''
             or coalesce(jsonb_typeof(new.maandwerk_extra -> (w ->> 'id')), '') <> 'number'
             or (new.maandwerk_extra ->> (w ->> 'id'))::numeric <= 0
           then w
           else w || jsonb_build_object(
             'duur',
             public.duur_uit_prijs((new.maandwerk_extra ->> (w ->> 'id'))::numeric, tarief)
           )
         end
         order by nr
       ), '[]'::jsonb)
       from jsonb_array_elements(
         case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
       ) with ordinality as t(w, nr)
     )
   where c.id = new.customer_id
     and jsonb_typeof(c.maandwerk) = 'array'
     and exists (
       select 1
       from jsonb_array_elements(c.maandwerk) as t(w)
       where coalesce(jsonb_typeof(w -> 'duur'), '') <> 'number'
         and coalesce(w ->> 'id', '') <> ''
         and coalesce(jsonb_typeof(new.maandwerk_extra -> (w ->> 'id')), '') = 'number'
         and (new.maandwerk_extra ->> (w ->> 'id'))::numeric > 0
     );

  perform set_config('wooshy.geen_log', vlag, true);
  return null;
end
$$;

create or replace function public.duren_herberekenen(tarief numeric, ook_zelf boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  oud jsonb;
  kenmerk uuid;
  n_adres integer := 0;
  n_klus integer := 0;
  vlag text := coalesce(current_setting('wooshy.geen_log', true), '');
begin
  if bedrijf is null or not (public.heeft_recht('planning') or public.heeft_recht('klanten_bewerken')) then
    raise exception 'Je rol mag de duur niet aanpassen.';
  end if;
  if tarief is null or tarief <= 0 then
    raise exception 'Het tarief moet hoger dan nul zijn.';
  end if;

  delete from public.duur_herberekening
   where company_id = bedrijf and created_at < now() - interval '7 days';

  select jsonb_build_object(
    'adressen', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'duur', c.duur_min, 'zelf', c.duur_zelf, 'maandwerk', c.maandwerk
      )), '[]'::jsonb)
      from public.customers c
      where c.company_id = bedrijf and c.deleted_at is null
    ),
    'klussen', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id, 'duur', k.duur_min, 'zelf', k.duur_zelf
      )), '[]'::jsonb)
      from public.klussen k
      where k.company_id = bedrijf and k.deleted_at is null
    )
  ) into oud;

  perform set_config('wooshy.geen_log', '1', true);

  -- De vaste duur van een adres.
  update public.customers c
     set duur_min = public.duur_uit_prijs(ap.prijs, tarief),
         duur_zelf = false
    from public.adres_prijzen ap
   where ap.customer_id = c.id
     and c.company_id = bedrijf
     and c.deleted_at is null
     and coalesce(ap.prijs, 0) > 0
     and (ook_zelf or not c.duur_zelf)
     and c.duur_min is distinct from public.duur_uit_prijs(ap.prijs, tarief);
  get diagnostics n_adres = row_count;

  -- En elk stuk maandwerk met een meerprijs.
  update public.customers c
     set maandwerk = (
       select coalesce(jsonb_agg(
         case
           when coalesce(w ->> 'id', '') = ''
             or coalesce(jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')), '') <> 'number'
             or (ap.maandwerk_extra ->> (w ->> 'id'))::numeric <= 0
             or (not ook_zelf and coalesce((w ->> 'duur_zelf')::boolean, false))
           then w
           else w || jsonb_build_object(
             'duur',
             public.duur_uit_prijs((ap.maandwerk_extra ->> (w ->> 'id'))::numeric, tarief),
             'duur_zelf', false
           )
         end
         order by nr
       ), '[]'::jsonb)
       from jsonb_array_elements(
         case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
       ) with ordinality as t(w, nr)
     )
    from public.adres_prijzen ap
   where ap.customer_id = c.id
     and c.company_id = bedrijf
     and c.deleted_at is null
     and jsonb_typeof(c.maandwerk) = 'array'
     and jsonb_array_length(c.maandwerk) > 0;

  perform set_config('wooshy.geen_log', vlag, true);

  -- De extra opdrachten.
  update public.klussen k
     set duur_min = public.duur_uit_prijs(kp.prijs, tarief),
         duur_zelf = false
    from public.klus_prijzen kp
   where kp.klus_id = k.id
     and k.company_id = bedrijf
     and k.deleted_at is null
     and coalesce(kp.prijs, 0) > 0
     and (ook_zelf or not k.duur_zelf)
     and k.duur_min is distinct from public.duur_uit_prijs(kp.prijs, tarief);
  get diagnostics n_klus = row_count;

  insert into public.duur_herberekening (company_id, waarden)
  values (bedrijf, oud)
  returning id into kenmerk;

  return jsonb_build_object('kenmerk', kenmerk, 'adressen', n_adres, 'klussen', n_klus);
end
$$;

create or replace function public.duren_terugzetten(kenmerk uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  bewaard jsonb;
  aantal integer := 0;
  vlag text := coalesce(current_setting('wooshy.geen_log', true), '');
begin
  if bedrijf is null or not (public.heeft_recht('planning') or public.heeft_recht('klanten_bewerken')) then
    raise exception 'Je rol mag de duur niet aanpassen.';
  end if;

  delete from public.duur_herberekening
   where id = kenmerk and company_id = bedrijf
  returning waarden into bewaard;
  if bewaard is null then
    raise exception 'Dit is al teruggezet of te lang geleden.';
  end if;

  perform set_config('wooshy.geen_log', '1', true);
  update public.customers c
     set duur_min = nullif(r ->> 'duur', '')::smallint,
         duur_zelf = coalesce((r ->> 'zelf')::boolean, false),
         maandwerk = case when jsonb_typeof(r -> 'maandwerk') = 'array' then r -> 'maandwerk' else c.maandwerk end
    from jsonb_array_elements(bewaard -> 'adressen') as t(r)
   where c.id = (r ->> 'id')::uuid
     and c.company_id = bedrijf;
  get diagnostics aantal = row_count;
  perform set_config('wooshy.geen_log', vlag, true);

  update public.klussen k
     set duur_min = nullif(r ->> 'duur', '')::smallint,
         duur_zelf = coalesce((r ->> 'zelf')::boolean, false)
    from jsonb_array_elements(bewaard -> 'klussen') as t(r)
   where k.id = (r ->> 'id')::uuid
     and k.company_id = bedrijf;

  return aantal;
end
$$;
