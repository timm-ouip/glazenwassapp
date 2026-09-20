-- Hoe lang een adres duurt, zodat de app kan zeggen wat er op een dag past.
--
-- De duur staat in minuten en geldt voor één persoon. Hij wordt één keer
-- ingevuld uit de prijs, met het tarief van het bedrijf ("wat was je weg per
-- uur", standaard € 75). Daarna blijft hij staan: een nieuwe prijs rekent
-- niets opnieuw uit. Verandert het tarief, dan vraagt de app of de duren
-- bijgewerkt moeten worden (duren_herberekenen, met duren_terugzetten als
-- ongedaan maken).
--
-- duur_zelf onthoudt of jij hem invulde. Alleen dan laat het bijwerken hem
-- met rust. Hetzelfde geldt per stuk maandwerk: daar staan "duur" en
-- "duur_zelf" in de jsonb-regel zelf, naast de meerprijs die in
-- adres_prijzen.maandwerk_extra hangt.

alter table public.customers
  add column duur_min   smallint,
  add column duur_zelf  boolean not null default false,
  -- leeg = automatisch (vanaf plan_groot_pand_min), true/false = zelf gekozen
  add column eigen_blok boolean;

alter table public.customers
  add constraint customers_duur_min_check check (duur_min is null or duur_min between 1 and 1440);

alter table public.klussen
  add column duur_min  smallint,
  add column duur_zelf boolean not null default false;

alter table public.klussen
  add constraint klussen_duur_min_check check (duur_min is null or duur_min between 1 and 1440);

-- De instellingen voor de planning. Alleen de eigenaar mag companies
-- wijzigen; lezen doet iedereen van het bedrijf (bestaande regels).
alter table public.companies
  add column plan_tarief_uur     numeric(10,2) not null default 75,
  add column plan_begin          time          not null default '08:00',
  add column plan_eind           time          not null default '16:30',
  add column plan_pauze_van      time          not null default '12:00',
  add column plan_pauze_min      smallint      not null default 30,
  add column plan_rijtijd_min    smallint      not null default 15,
  add column plan_groot_pand_min smallint      not null default 45,
  add column plan_tijdlijn       boolean       not null default true,
  add column plan_tijdvak_mailen boolean       not null default false;

alter table public.companies
  add constraint companies_plan_check check (
    plan_tarief_uur > 0
    and plan_pauze_min between 0 and 240
    and plan_rijtijd_min between 0 and 240
    and plan_groot_pand_min between 5 and 600
    and plan_eind > plan_begin
  );

-- ---------------------------------------------------------------------
-- Van prijs naar minuten
-- ---------------------------------------------------------------------
create or replace function public.duur_uit_prijs(prijs numeric, tarief numeric)
returns smallint
language sql
immutable
as $$
  select greatest(1, least(1440, round(coalesce(prijs, 0) * 60 / nullif(tarief, 0))))::smallint
$$;

-- Vult wat nog leeg is zodra een adres een prijs heeft. Nooit opnieuw, en
-- nooit over iets heen: import, Paaltje en het prijsschermpje lopen hier
-- allemaal langs.
create or replace function public.adres_duur_vullen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tarief numeric;
begin
  select plan_tarief_uur into tarief from public.companies where id = new.company_id;
  if tarief is null or tarief <= 0 then
    return null;
  end if;

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

  return null;
end
$$;

drop trigger if exists adres_prijzen_duur_vullen on public.adres_prijzen;
create trigger adres_prijzen_duur_vullen
  after insert or update of prijs, maandwerk_extra on public.adres_prijzen
  for each row execute function public.adres_duur_vullen();

-- Zelfde voor een extra opdracht: die telt ook mee in de dag.
create or replace function public.klus_duur_vullen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tarief numeric;
begin
  if coalesce(new.prijs, 0) <= 0 then
    return null;
  end if;
  select plan_tarief_uur into tarief from public.companies where id = new.company_id;
  if tarief is null or tarief <= 0 then
    return null;
  end if;
  update public.klussen k
     set duur_min = public.duur_uit_prijs(new.prijs, tarief)
   where k.id = new.klus_id
     and k.duur_min is null;
  return null;
end
$$;

drop trigger if exists klus_prijzen_duur_vullen on public.klus_prijzen;
create trigger klus_prijzen_duur_vullen
  after insert or update of prijs on public.klus_prijzen
  for each row execute function public.klus_duur_vullen();

-- ---------------------------------------------------------------------
-- Opnieuw uitrekenen (bij een nieuw tarief), met ongedaan maken
-- ---------------------------------------------------------------------
create table public.duur_herberekening (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  waarden jsonb not null,
  created_at timestamptz not null default now()
);
create index duur_herberekening_company_idx on public.duur_herberekening (company_id, created_at);

-- Alleen via de functies hieronder; net als wasdag_weggehaald toch een
-- bedrijfsregel, zodat niemand ooit de oude duren van een ander bedrijf ziet.
alter table public.duur_herberekening enable row level security;
revoke all on public.duur_herberekening from anon, authenticated;
create policy "Eigen bedrijf" on public.duur_herberekening
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
create trigger duur_herberekening_set_company_id before insert on public.duur_herberekening
  for each row execute function public.set_company_id();

/**
 * Rekent de duren opnieuw uit de prijs, met het meegegeven tarief.
 * `ook_zelf` neemt ook de duren mee die met de hand zijn ingevuld.
 * Geeft het kenmerk voor ongedaan maken terug, plus de aantallen.
 */
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

/** Zet de duren terug zoals ze vlak voor het herberekenen stonden. */
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

  update public.customers c
     set duur_min = nullif(r ->> 'duur', '')::smallint,
         duur_zelf = coalesce((r ->> 'zelf')::boolean, false),
         maandwerk = case when jsonb_typeof(r -> 'maandwerk') = 'array' then r -> 'maandwerk' else c.maandwerk end
    from jsonb_array_elements(bewaard -> 'adressen') as t(r)
   where c.id = (r ->> 'id')::uuid
     and c.company_id = bedrijf;
  get diagnostics aantal = row_count;

  update public.klussen k
     set duur_min = nullif(r ->> 'duur', '')::smallint,
         duur_zelf = coalesce((r ->> 'zelf')::boolean, false)
    from jsonb_array_elements(bewaard -> 'klussen') as t(r)
   where k.id = (r ->> 'id')::uuid
     and k.company_id = bedrijf;

  return aantal;
end
$$;

revoke all on function public.duren_herberekenen(numeric, boolean) from public, anon;
grant execute on function public.duren_herberekenen(numeric, boolean) to authenticated;
revoke all on function public.duren_terugzetten(uuid) from public, anon;
grant execute on function public.duren_terugzetten(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Eenmalig invullen voor wat er al staat (€ 75 per uur)
-- ---------------------------------------------------------------------
update public.customers c
   set duur_min = public.duur_uit_prijs(ap.prijs, co.plan_tarief_uur)
  from public.adres_prijzen ap, public.companies co
 where ap.customer_id = c.id
   and co.id = c.company_id
   and c.duur_min is null
   and coalesce(ap.prijs, 0) > 0;

update public.customers c
   set maandwerk = (
     select coalesce(jsonb_agg(
       case
         when coalesce(jsonb_typeof(w -> 'duur'), '') = 'number'
           or coalesce(w ->> 'id', '') = ''
           or coalesce(jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')), '') <> 'number'
           or (ap.maandwerk_extra ->> (w ->> 'id'))::numeric <= 0
         then w
         else w || jsonb_build_object(
           'duur',
           public.duur_uit_prijs((ap.maandwerk_extra ->> (w ->> 'id'))::numeric, co.plan_tarief_uur)
         )
       end
       order by nr
     ), '[]'::jsonb)
     from jsonb_array_elements(
       case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
     ) with ordinality as t(w, nr)
   )
  from public.adres_prijzen ap, public.companies co
 where ap.customer_id = c.id
   and co.id = c.company_id
   and jsonb_typeof(c.maandwerk) = 'array'
   and jsonb_array_length(c.maandwerk) > 0;

update public.klussen k
   set duur_min = public.duur_uit_prijs(kp.prijs, co.plan_tarief_uur)
  from public.klus_prijzen kp, public.companies co
 where kp.klus_id = k.id
   and co.id = k.company_id
   and k.duur_min is null
   and coalesce(kp.prijs, 0) > 0;
