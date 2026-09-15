-- Werkdagen per bedrijf, en een adres maar één keer per maand op de planning.
--
-- Werkdagen: op welke dagen van de week het bedrijf wast (1 = maandag … 7 =
-- zondag). Opschuiven, het voorstel voor de volgende wijk en "Inplannen
-- voor…" slaan de andere dagen over.
--
-- Eén keer per maand: een adres wordt hooguit één keer per maand gewassen.
-- Extra werk op een andere dag is een klus (tabel klussen), geen tweede
-- wasdag. De app slaat zulke adressen al over; deze index is het vangnet.
-- Vóór deze migratie stond er geen enkel adres dubbel in een maand.

alter table public.companies
  add column werkdagen smallint[] not null default '{1,2,3,4,5}'
  constraint companies_werkdagen_geldig check (
    cardinality(werkdagen) between 1 and 7
    and werkdagen <@ '{1,2,3,4,5,6,7}'::smallint[]
  );

create unique index wasdag_regels_een_per_maand
  on public.wasdag_regels (company_id, customer_id, (date_trunc('month', datum::timestamp)))
  where customer_id is not null;

-- De twee functies die planning terugzetten vingen alleen een dubbele regel
-- op dezelfde dag op. Nu kan een terugzetting ook botsen met een adres dat
-- intussen op een andere dag in die maand staat: dan blijft die staan en
-- komt de oude niet terug, in plaats van dat het hele terugzetten mislukt.
-- Verder ongewijzigd.

create or replace function public.wasdag_terugzetten(kenmerk uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  bewaard jsonb;
  nieuw uuid[] := '{}';
  aantal integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald
  where id = kenmerk and company_id = bedrijf
  returning regels into bewaard;
  if bewaard is null then
    raise exception 'Dit is al teruggezet of te lang geleden.';
  end if;

  -- Eerst terugzetten. De prijsregel van een nieuwe regel maakt een trigger
  -- aan zodra deze opdracht klaar is; pas daarna kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie'
    from jsonb_array_elements(bewaard) as t(r)
    where r ->> 'customer_id' is not null
      -- Alleen adressen van dit bedrijf die nog bestaan, niet weggegooid en
      -- niet gestopt zijn: die horen niet terug op de planning.
      and exists (
        select 1 from public.customers c
        where c.id = (r ->> 'customer_id')::uuid
          and c.company_id = bedrijf
          and c.deleted_at is null
          and c.inactief_op is null
      )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;
  aantal := cardinality(nieuw);

  -- Dan het eigen bedrag, alleen op de regels die hier echt terugkwamen.
  update public.wasdag_prijzen wp
  set prijs = (r ->> 'prijs')::numeric
  from public.wasdag_regels w, jsonb_array_elements(bewaard) as t(r)
  where wp.regel_id = w.id
    and w.id = any(nieuw)
    and w.customer_id = (r ->> 'customer_id')::uuid
    and w.datum = (r ->> 'datum')::date
    and jsonb_typeof(r -> 'prijs') = 'number';

  return aantal;
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
    on conflict do nothing
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
