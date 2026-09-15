-- Fase 5, stap D: prijzen alleen nog in hun eigen tabellen.
--
-- Stap B zette de prijzen in adres_prijzen, wasdag_prijzen en klus_prijzen
-- (lezen alleen met het recht "prijzen zien") en hield de oude kolommen
-- bijgehouden. Nu stapt de app over, en gaan de oude kolommen weg: dan is er
-- nergens meer een bedrag te vinden voor wie het niet mag zien.
--
-- De reservekopie van vóór stap B staat in het schema backup_fase5.

-- ---------------------------------------------------------------------
-- 1. Het bijhouden in twee richtingen stopt
-- ---------------------------------------------------------------------
drop trigger if exists customers_prijs_bijhouden on public.customers;
drop trigger if exists wasdag_regels_prijs_bijhouden on public.wasdag_regels;
drop trigger if exists klussen_prijs_bijhouden on public.klussen;
drop trigger if exists adres_prijzen_terugschrijven on public.adres_prijzen;
drop trigger if exists wasdag_prijzen_terugschrijven on public.wasdag_prijzen;
drop trigger if exists klus_prijzen_terugschrijven on public.klus_prijzen;
drop function if exists public.adres_prijs_bijhouden();
drop function if exists public.wasdag_prijs_bijhouden();
drop function if exists public.klus_prijs_bijhouden();
drop function if exists public.adres_prijs_terugschrijven();
drop function if exists public.wasdag_prijs_terugschrijven();
drop function if exists public.klus_prijs_terugschrijven();

-- ---------------------------------------------------------------------
-- 2. Nog één keer gelijktrekken: de oude kolommen waren tot nu toe de bron
-- ---------------------------------------------------------------------
insert into public.adres_prijzen (customer_id, company_id, prijs, maandwerk_extra)
  select c.id, c.company_id, coalesce(c.price, 0), public.maandwerk_extra_van(c.maandwerk)
  from public.customers c
on conflict (customer_id) do update
  set prijs = excluded.prijs, maandwerk_extra = excluded.maandwerk_extra;

insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  select r.id, r.company_id, coalesce(r.prijs, 0) from public.wasdag_regels r
on conflict (regel_id) do update set prijs = excluded.prijs;

insert into public.klus_prijzen (klus_id, company_id, prijs)
  select k.id, k.company_id, coalesce(k.prijs, 0) from public.klussen k
on conflict (klus_id) do update set prijs = excluded.prijs;

-- De meerprijs uit de maandwerk-lijst halen: die staat nu in
-- adres_prijzen.maandwerk_extra, bij het id van het stuk werk.
update public.customers c
set maandwerk = (
  select coalesce(jsonb_agg(case when jsonb_typeof(w) = 'object' then w - 'extra' else w end order by nr), '[]'::jsonb)
  from jsonb_array_elements(c.maandwerk) with ordinality as t(w, nr)
)
where jsonb_typeof(c.maandwerk) = 'array'
  and exists (select 1 from jsonb_array_elements(c.maandwerk) w where jsonb_typeof(w) = 'object' and w ? 'extra');

-- ---------------------------------------------------------------------
-- 3. Nieuwe rijen krijgen meteen een prijsregel
--
-- Ook als wie de rij maakt geen prijzen mag zien: een medewerker die een
-- adres aanmaakt of een dag inplant. Security definer, want die medewerker
-- mag de prijstabel zelf niet in. Wie wél prijzen mag zien, zet daarna het
-- bedrag dat hij wil.
-- ---------------------------------------------------------------------
create or replace function public.adres_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.adres_prijzen (customer_id, company_id, prijs)
  values (new.id, new.company_id, 0)
  on conflict (customer_id) do nothing;
  return null;
end
$$;
create trigger customers_prijs_aanmaken after insert on public.customers
  for each row execute function public.adres_prijs_aanmaken();

-- Een wasdag krijgt de prijs van dat moment: de vaste prijs van het adres
-- plus het meerwerk van die maand. Een momentopname, zoals altijd.
create or replace function public.wasdag_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrag numeric := 0;
begin
  if new.customer_id is not null then
    select coalesce(ap.prijs, 0) + coalesce((
      select sum((ap.maandwerk_extra ->> (w ->> 'id'))::numeric)
      from public.customers c, jsonb_array_elements(
        case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
      ) as t(w)
      where c.id = new.customer_id
        and w -> 'maanden' ? to_char(new.datum, 'MM')
        and jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')) = 'number'
    ), 0)
    into bedrag
    from public.adres_prijzen ap
    where ap.customer_id = new.customer_id and ap.company_id = new.company_id;
  end if;
  insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  values (new.id, new.company_id, coalesce(bedrag, 0))
  on conflict (regel_id) do nothing;
  return null;
end
$$;
create trigger wasdag_regels_prijs_aanmaken after insert on public.wasdag_regels
  for each row execute function public.wasdag_prijs_aanmaken();

create or replace function public.klus_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.klus_prijzen (klus_id, company_id, prijs)
  values (new.id, new.company_id, 0)
  on conflict (klus_id) do nothing;
  return null;
end
$$;
create trigger klussen_prijs_aanmaken after insert on public.klussen
  for each row execute function public.klus_prijs_aanmaken();

revoke execute on function public.adres_prijs_aanmaken() from public, anon, authenticated;
revoke execute on function public.wasdag_prijs_aanmaken() from public, anon, authenticated;
revoke execute on function public.klus_prijs_aanmaken() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. De richtprijs uit de afgeschermde tabel
--
-- Security invoker blijft: wie geen prijzen mag zien, krijgt geen richtprijs.
-- ---------------------------------------------------------------------
create or replace function public.richtprijs(straat uuid)
returns table (prijs numeric, aantal integer, bereik text)
language sql
stable
security invoker
set search_path = public
as $$
  with deze as (
    select s.id, s.district_id
    from public.streets s
    join public.districts d on d.id = s.district_id
    where s.id = richtprijs.straat and s.deleted_at is null and d.deleted_at is null
  ),
  in_straat as (
    select ap.prijs
    from public.customers c
    join deze on deze.id = c.street_id
    join public.adres_prijzen ap on ap.customer_id = c.id
    where c.deleted_at is null and ap.prijs > 0
  ),
  in_wijk as (
    select ap.prijs
    from public.customers c
    join public.streets s on s.id = c.street_id
    join deze on deze.district_id = s.district_id
    join public.adres_prijzen ap on ap.customer_id = c.id
    where c.deleted_at is null and s.deleted_at is null and ap.prijs > 0
  )
  select
    percentile_cont(0.5) within group (order by in_straat.prijs)::numeric(10, 2),
    count(*)::integer,
    'straat'
  from in_straat
  having count(*) >= 3
  union all
  select
    percentile_cont(0.5) within group (order by in_wijk.prijs)::numeric(10, 2),
    count(*)::integer,
    'wijk'
  from in_wijk
  having count(*) >= 3 and (select count(*) from in_straat) < 3
$$;

-- ---------------------------------------------------------------------
-- 5. Stoppen en terugdraaien: prijzen alleen voor wie ze mag zien
-- ---------------------------------------------------------------------
create or replace function public.zet_adressen_inactief(
  adressen uuid[],
  reden text,
  planning_weg boolean,
  voor_bedrijf uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- De server mag altijd; een gebruiker alleen met het recht.
  prijzen_zichtbaar boolean := auth.role() = 'service_role' or public.heeft_recht('prijzen_zien');
  nu timestamptz := now();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  gezet uuid[] := '{}';
  klanten_weg uuid[] := '{}';
  planning jsonb := '[]'::jsonb;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if reden is null or reden not in ('verhuisd', 'gestopt') then
    raise exception 'Onbekende reden.';
  end if;

  with u as (
    update public.customers
    set inactief_op = nu, inactief_reden = reden
    where company_id = bedrijf
      and id = any(adressen)
      and deleted_at is null
      and inactief_op is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into gezet from u;

  if planning_weg and cardinality(gezet) > 0 then
    -- Eerst vastleggen wat er weggaat (met de prijs, als je die mag zien):
    -- de prijsregel verdwijnt mee met de dagregel.
    select coalesce(jsonb_agg(
      jsonb_build_object('datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie)
      || case when prijzen_zichtbaar then jsonb_build_object('prijs', coalesce(wp.prijs, 0)) else '{}'::jsonb end
    ), '[]'::jsonb)
    into planning
    from public.wasdag_regels r
    left join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.company_id = bedrijf
      and r.customer_id = any(gezet)
      -- Vandaag blijft staan: dat werk kan vanochtend al gedaan zijn.
      and r.datum > vandaag;

    delete from public.wasdag_regels
    where company_id = bedrijf
      and customer_id = any(gezet)
      and datum > vandaag;
  end if;

  -- Bij een verhuizing gaan de klantgegevens weg, maar alleen als de klant
  -- geen ander adres heeft dat actief is of op "gestopt" staat.
  if reden = 'verhuisd' and cardinality(gezet) > 0 then
    with k as (
      update public.klanten kl
      set deleted_at = nu
      where kl.company_id = bedrijf
        and kl.deleted_at is null
        and kl.id in (
          select c.klant_id from public.customers c
          where c.id = any(gezet) and c.klant_id is not null
        )
        and not exists (
          select 1 from public.customers c
          where c.klant_id = kl.id
            and c.deleted_at is null
            and (c.inactief_op is null or c.inactief_reden = 'gestopt')
        )
      returning kl.id
    )
    select coalesce(array_agg(id), '{}') into klanten_weg from k;
  end if;

  return jsonb_build_object(
    'adressen', to_jsonb(gezet),
    'klanten', to_jsonb(klanten_weg),
    'planning', planning,
    'inactief_op', nu
  );
end
$$;

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
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie'
    from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where (r ->> 'datum')::date >= vandaag
      and (r ->> 'customer_id')::uuid = any(terug)
    on conflict (company_id, datum, customer_id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;

  if prijzen_zichtbaar then
    update public.wasdag_prijzen wp
    set prijs = (r ->> 'prijs')::numeric
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

-- ---------------------------------------------------------------------
-- 6. De oude kolommen weg
-- ---------------------------------------------------------------------
alter table public.customers drop column price;
alter table public.wasdag_regels drop column prijs;
alter table public.klussen drop column prijs;
