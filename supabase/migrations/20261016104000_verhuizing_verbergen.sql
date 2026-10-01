-- Verhuisd: de geschiedenis verbergen in plaats van wissen (herstel van
-- 20261016103000).
--
-- Verhuist een klant, dan ziet de nieuwe bewoner een lege geschiedenis, maar
-- de regels van het adres blijven bewaard: ze krijgen `verborgen_door` (de
-- verhuisd-regel). Draai je de verhuizing terug (stoppen_terugdraaien, ook
-- via Ongedaan, Paaltje of de geldloper), dan komen ze weer tevoorschijn en
-- staat de verhuisd-regel op teruggedraaid. Een jaar na een verhuizing die
-- niet is teruggedraaid, wist een nachtelijke taak de verborgen regels echt;
-- de verhuisd-regel zelf blijft staan.
--
-- Verbergen is weergave, geen afscherming: wie het log mag lezen, mag ook de
-- verborgen regels lezen (zelfde RLS). Het dossier vraagt ze niet op.

alter table public.wijzigingen
  add column verborgen_door uuid references public.wijzigingen (id) on delete cascade;
create index wijzigingen_verborgen_door on public.wijzigingen (verborgen_door)
  where verborgen_door is not null;

-- ---------------------------------------------------------------------
-- Verbergen bij een verhuizing
-- ---------------------------------------------------------------------
-- Zelfde bescherming als in 20261016103000: alleen adressen die in DEZELFDE
-- transactie op verhuisd zijn gezet (inactief_op = now()), dus via
-- zet_adressen_inactief. De verhuisd-regel onthoudt de klant (voor.klant_id):
-- daaraan herkent het dossier de nieuwe bewoner, en terugdraaien mag alleen
-- als die klant er nog aan hangt.
create or replace function public.verhuizing_log_legen(adressen uuid[], voor_bedrijf uuid default null)
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
  verhuisd uuid[];
  verborgen integer;
begin
  if bedrijf is null then
    return 0;
  end if;

  select coalesce(array_agg(c.id), '{}') into verhuisd
  from public.customers c
  where c.company_id = bedrijf
    and c.id = any(adressen)
    and c.deleted_at is null
    and c.inactief_reden = 'verhuisd'
    and c.inactief_op = now();
  if cardinality(verhuisd) = 0 then
    return 0;
  end if;

  -- Wat een eerdere verhuizing al verborg, blijft bij die verhuizing horen.
  with v as (
    insert into public.wijzigingen (company_id, tabel, rij_id, customer_id, veld, voor, door, door_naam, bron)
    select bedrijf, 'customers', c.id, c.id, 'verhuisd',
           jsonb_build_object('klant_id', c.klant_id),
           auth.uid(), coalesce(public.geld_mijn_naam(), ''), 'systeem'
    from public.customers c
    where c.id = any(verhuisd)
    returning id, customer_id
  )
  update public.wijzigingen w
  set verborgen_door = v.id
  from v
  where w.company_id = bedrijf
    and w.customer_id = v.customer_id
    and w.id <> v.id
    and w.verborgen_door is null
    and w.op <= now();
  get diagnostics verborgen = row_count;

  return verborgen;
end
$$;
revoke execute on function public.verhuizing_log_legen(uuid[], uuid) from public, anon;
grant execute on function public.verhuizing_log_legen(uuid[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Terug bij het terugdraaien van een verhuizing
-- ---------------------------------------------------------------------
-- Roept stoppen_terugdraaien aan (security invoker). Alleen met het recht om
-- adressen te wijzigen (zoals de regels op customers), alleen voor de
-- verhuizing van precies dat moment, alleen als het adres weer actief is en
-- dezelfde klant er nog aan hangt (dus niet na een nieuwe bewoner).
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
  if not (auth.role() = 'service_role'
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
revoke execute on function public.verhuizing_log_terug(uuid[], timestamptz, uuid) from public, anon;
grant execute on function public.verhuizing_log_terug(uuid[], timestamptz, uuid) to authenticated, service_role;

-- Gelijk aan 20261016091000_vooruit_betalen_herstel.sql, met de verborgen
-- geschiedenis terug erbij.
create or replace function public.stoppen_terugdraaien(uitkomst jsonb, voor_bedrijf uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- Het oude bedrag terugzetten mag wie een dagprijs mag wijzigen: prijzen
  -- zien én planning (zoals de regels op wasdag_prijzen). Anders blijft de
  -- momentopname die de database zelf uitrekent.
  prijzen_zichtbaar boolean := auth.role() = 'service_role'
    or (public.heeft_recht('prijzen_zien') and public.heeft_recht('planning'));
  moment timestamptz := (uitkomst ->> 'inactief_op')::timestamptz;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  terug uuid[] := '{}';
  nieuw uuid[] := '{}';
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if moment is null then
    raise exception 'Onbekende stopzetting.';
  end if;

  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and deleted_at is null
      and inactief_op = moment
      and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'adressen', '[]'::jsonb)))::uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into terug from u;

  -- De geschiedenis van een verhuisd adres komt weer tevoorschijn.
  perform public.verhuizing_log_terug(terug, moment, bedrijf);

  update public.klanten
  set deleted_at = null
  where company_id = bedrijf
    and deleted_at = moment
    and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'klanten', '[]'::jsonb)))::uuid);

  -- De planning terug. De prijs rekent de database zelf opnieuw uit (trigger
  -- op wasdag_regels); alleen wie prijzen mag zien, zet het oude bedrag terug.
  -- Alleen de regels die hier echt terugkomen krijgen straks hun oude prijs:
  -- een dag die intussen opnieuw is ingepland houdt zijn eigen bedrag.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where (r ->> 'datum')::date >= vandaag
      and (r ->> 'customer_id')::uuid = any(terug)
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;

  if prijzen_zichtbaar then
    update public.wasdag_prijzen wp
    set prijs = (r ->> 'prijs')::numeric,
        normaal = case when jsonb_typeof(r -> 'normaal') = 'number' then (r ->> 'normaal')::numeric else wp.normaal end
    from public.wasdag_regels w,
      jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where wp.regel_id = w.id
      and w.id = any(nieuw)
      and w.company_id = bedrijf
      and w.customer_id = (r ->> 'customer_id')::uuid
      and w.datum = (r ->> 'datum')::date
      and w.customer_id = any(terug)
      and w.datum >= vandaag
      and jsonb_typeof(r -> 'prijs') = 'number';
  end if;

  return cardinality(terug);
end
$$;

revoke execute on function public.stoppen_terugdraaien(jsonb, uuid) from public, anon;
grant execute on function public.stoppen_terugdraaien(jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Na een jaar echt weg
-- ---------------------------------------------------------------------
-- Wist wat verborgen is door een verhuizing van meer dan een jaar geleden die
-- niet is teruggedraaid. De verhuisd-regel blijft staan. Alleen voor de nacht
-- (pg_cron), niet voor gebruikers.
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
  where w.verborgen_door = v.id
    and v.veld = 'verhuisd'
    and v.teruggedraaid_op is null
    and v.op < now() - interval '1 year';
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.verhuizing_log_opruimen() from public, anon, authenticated;

-- pg_cron rekent in UTC; 03:15 UTC is hier vier of vijf uur 's nachts.
select cron.unschedule('verhuizing-log-opruimen')
where exists (select 1 from cron.job where jobname = 'verhuizing-log-opruimen');

select cron.schedule(
  'verhuizing-log-opruimen',
  '15 3 * * *',
  $$select public.verhuizing_log_opruimen();$$
);
