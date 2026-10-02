-- De klant vult zijn eigen gegevens in, via een linkje uit het dossier.
--
-- Per klant een geheim linkje dat 7 dagen werkt. Wie het opent ziet alleen
-- naam, telefoon en e-mail; de rest van het dossier blijft dicht. Wat hij
-- invult komt meteen in het dossier, en in de wijzigingslog met bron
-- 'klant'. Het dossier laat die regels geel zien (Klopt / Ongedaan maken);
-- Ongedaan maken is hetzelfde terugzetten als in de geschiedenis.
--
-- De token staat in een eigen tabel, niet op `klanten`: klantgegevens mag
-- ook lezen wie alleen plant, en met de token zou die ze kunnen wijzigen.

create table if not exists public.klant_links (
  klant_id uuid primary key references public.klanten (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  token text not null unique,
  geldig_tot timestamptz not null,
  -- Tot hier is wat de klant invulde bekeken (Klopt); alles daarna is geel.
  gezien_op timestamptz,
  -- Hoe vaak er via dit linkje is opgeslagen: een rem tegen volschrijven.
  aantal integer not null default 0,
  created_at timestamptz not null default now()
);

create trigger klant_links_set_company_id before insert on public.klant_links
  for each row execute function public.set_company_id();

alter table public.klant_links enable row level security;
revoke all on public.klant_links from anon;
create policy "Linkjes met recht" on public.klant_links
  for all to authenticated
  using (
    company_id = (select public.current_company_id())
    and (select public.heeft_recht('klanten_bewerken'))
  )
  with check (
    company_id = (select public.current_company_id())
    and (select public.heeft_recht('klanten_bewerken'))
  );

-- In de wijzigingslog: "door de klant zelf", en dus ook vanuit de
-- geschiedenis terug te zetten (anders dan 'systeem').
alter table public.wijzigingen drop constraint if exists wijzigingen_bron_check;
alter table public.wijzigingen
  add constraint wijzigingen_bron_check check (bron in ('app', 'paaltje', 'systeem', 'klant'));

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
    -- De klant zelf, via zijn invul-linkje (klant_vult_gegevens_in).
    when wie is null and coalesce(current_setting('wooshy.door_klant', true), '') = '1' then 'klant'
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
    -- Wat de klant zelf invult telt altijd: ook bij een klant die net bestaat.
    if herroepen is null and tg_table_name <> 'wasdag_regels' and herkomst <> 'klant'
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
      naam := case when herkomst = 'klant' then 'de klant zelf'
                   else coalesce(public.geld_mijn_naam(), '') end;
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

-- Wat de klant op de invulpagina verstuurt. Alleen voor de server
-- (klantgegevens.functions.ts), die de tekst al heeft opgeschoond; de token
-- bepaalt welke klant, nooit iets anders uit de aanvraag. Geeft false als het
-- linkje niet (meer) werkt of te vaak gebruikt is.
create or replace function public.klant_vult_gegevens_in(sleutel text, velden jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.klant_links;
  k public.klanten;
  huidig jsonb;
  veld text;
  nieuw text;
  na jsonb := '{}'::jsonb;
begin
  select * into l
    from public.klant_links
    where token = sleutel and geldig_tot > now() and aantal < 30
    for update;
  if not found then
    return false;
  end if;
  select * into k from public.klanten where id = l.klant_id and deleted_at is null for update;
  if not found then
    return false;
  end if;
  update public.klant_links set aantal = aantal + 1 where klant_id = l.klant_id;

  huidig := to_jsonb(k);
  foreach veld in array array['naam', 'telefoon', 'telefoon2', 'email', 'email2'] loop
    continue when not (velden ? veld);
    nieuw := left(btrim(coalesce(velden ->> veld, '')), 160);
    -- Een naam laat je niet leeg: dan heet de klant in de lijst niets meer.
    continue when veld = 'naam' and nieuw = '';
    continue when nieuw = coalesce(huidig ->> veld, '');
    na := na || jsonb_build_object(veld, nieuw);
  end loop;
  if na = '{}'::jsonb then
    return true;
  end if;
  -- Ook na samenvoegen nog ergens te bereiken.
  if coalesce(na ->> 'telefoon', k.telefoon, '') = '' and coalesce(na ->> 'email', k.email, '') = '' then
    return false;
  end if;

  perform set_config('wooshy.door_klant', '1', true);
  update public.klanten set
    naam = coalesce(na ->> 'naam', naam),
    telefoon = coalesce(na ->> 'telefoon', telefoon),
    telefoon2 = coalesce(na ->> 'telefoon2', telefoon2),
    email = coalesce(na ->> 'email', email),
    email2 = coalesce(na ->> 'email2', email2)
  where id = k.id;
  perform set_config('wooshy.door_klant', '', true);
  return true;
end
$$;
revoke execute on function public.klant_vult_gegevens_in(text, jsonb) from public, anon, authenticated;
grant execute on function public.klant_vult_gegevens_in(text, jsonb) to service_role;
