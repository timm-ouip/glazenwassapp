-- Fase 5, stap B: prijzen in hun eigen tabellen.
--
-- Een medewerker zonder het recht "prijzen zien" mag straks nergens een bedrag
-- kunnen opvragen, ook niet door slim te filteren of te sorteren. Rijen kun je
-- afschermen, losse kolommen niet netjes; daarom krijgen prijzen hun eigen
-- tabellen, met als slot heeft_recht('prijzen_zien').
--
-- Deze stap voegt alleen toe. De oude kolommen (customers.price, de "extra" in
-- customers.maandwerk, wasdag_regels.prijs en klussen.prijs) blijven, en
-- worden in beide richtingen bijgehouden: de app van nu werkt gewoon door. In
-- stap D stapt de app over op de nieuwe tabellen en gaan de oude kolommen weg.

-- ---------------------------------------------------------------------
-- 0. Reservekopie, buiten het bereik van de app
-- ---------------------------------------------------------------------
create schema if not exists backup_fase5;
revoke all on schema backup_fase5 from public, anon, authenticated;

create table backup_fase5.customers_prijs as
  select id, company_id, price, maandwerk, now() as bewaard_op from public.customers;
create table backup_fase5.wasdag_regels_prijs as
  select id, company_id, prijs, now() as bewaard_op from public.wasdag_regels;
create table backup_fase5.klussen_prijs as
  select id, company_id, prijs, now() as bewaard_op from public.klussen;

-- ---------------------------------------------------------------------
-- 1. Samengestelde sleutels, zodat een prijs nooit aan een rij van een
--    ander bedrijf kan hangen
-- ---------------------------------------------------------------------
alter table public.customers add constraint customers_id_bedrijf_uniek unique (id, company_id);
alter table public.wasdag_regels add constraint wasdag_regels_id_bedrijf_uniek unique (id, company_id);
alter table public.klussen add constraint klussen_id_bedrijf_uniek unique (id, company_id);

-- ---------------------------------------------------------------------
-- 2. Maandwerk krijgt vaste id's
--
-- Het meerwerk ("in september de serre erbij, € 25") staat als lijst in
-- customers.maandwerk. Het bedrag gaat apart, en moet dan weten bij welk stuk
-- werk het hoort: vandaar een id per stuk. De database deelt ze uit, dus ook
-- de app van nu (die ze nog niet kent) krijgt ze.
-- ---------------------------------------------------------------------
create or replace function public.maandwerk_met_ids(werk jsonb)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(w) = 'object' and coalesce(w ->> 'id', '') = ''
          then w || jsonb_build_object('id', gen_random_uuid()::text)
        else w
      end
      order by nr
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(case when jsonb_typeof(werk) = 'array' then werk else '[]'::jsonb end)
    with ordinality as t(w, nr)
$$;

-- {id: bedrag} voor de stukken werk met een meerprijs.
create or replace function public.maandwerk_extra_van(werk jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(w ->> 'id', w -> 'extra'), '{}'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(werk) = 'array' then werk else '[]'::jsonb end) as t(w)
  where jsonb_typeof(w) = 'object'
    and coalesce(w ->> 'id', '') <> ''
    and jsonb_typeof(w -> 'extra') = 'number'
$$;

update public.customers
set maandwerk = public.maandwerk_met_ids(maandwerk)
where jsonb_typeof(maandwerk) = 'array' and jsonb_array_length(maandwerk) > 0;

create or replace function public.customers_maandwerk_ids()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.maandwerk is distinct from old.maandwerk then
    new.maandwerk := public.maandwerk_met_ids(new.maandwerk);
  end if;
  return new;
end
$$;

create trigger customers_maandwerk_ids before insert or update of maandwerk on public.customers
  for each row execute function public.customers_maandwerk_ids();

-- ---------------------------------------------------------------------
-- 3. De prijstabellen
-- ---------------------------------------------------------------------
create table public.adres_prijzen (
  customer_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  prijs numeric not null default 0,
  -- {maandwerk-id: meerprijs}
  maandwerk_extra jsonb not null default '{}'::jsonb,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade
);
create index adres_prijzen_company_idx on public.adres_prijzen (company_id);

-- Momentopname per dagregel, net als nu: een prijsverhoging maakt een dag van
-- vorige week niet duurder.
create table public.wasdag_prijzen (
  regel_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  prijs numeric not null default 0,
  foreign key (regel_id, company_id) references public.wasdag_regels (id, company_id) on delete cascade
);
create index wasdag_prijzen_company_idx on public.wasdag_prijzen (company_id);

create table public.klus_prijzen (
  klus_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  prijs numeric not null default 0,
  foreign key (klus_id, company_id) references public.klussen (id, company_id) on delete cascade
);
create index klus_prijzen_company_idx on public.klus_prijzen (company_id);

create trigger adres_prijzen_set_company_id before insert on public.adres_prijzen
  for each row execute function public.set_company_id();
create trigger wasdag_prijzen_set_company_id before insert on public.wasdag_prijzen
  for each row execute function public.set_company_id();
create trigger klus_prijzen_set_company_id before insert on public.klus_prijzen
  for each row execute function public.set_company_id();

-- Lezen: alleen wie prijzen mag zien (de eigenaar altijd). Invoeren en
-- wijzigen vraagt daarnaast het recht om dat soort rij te bewerken. Weghalen
-- kan niemand los: een prijs verdwijnt samen met zijn adres, dagregel of klus.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('adres_prijzen', '(select public.heeft_recht(''klanten_bewerken''))'),
      ('wasdag_prijzen', '(select public.heeft_recht(''planning''))'),
      ('klus_prijzen', '((select public.heeft_recht(''planning'')) or (select public.heeft_recht(''klanten_bewerken'')))')
    ) as v(tabel, bewerken)
  loop
    execute format('alter table public.%I enable row level security', t.tabel);
    execute format('revoke all on public.%I from anon', t.tabel);
    execute format(
      'create policy "Prijzen zien" on public.%I for select to authenticated
         using (company_id = (select public.current_company_id()) and (select public.heeft_recht(''prijzen_zien'')))',
      t.tabel);
    execute format(
      'create policy "Prijzen invoeren" on public.%I for insert to authenticated
         with check (company_id = (select public.current_company_id()) and (select public.heeft_recht(''prijzen_zien'')) and %s)',
      t.tabel, t.bewerken);
    execute format(
      'create policy "Prijzen wijzigen" on public.%I for update to authenticated
         using (company_id = (select public.current_company_id()) and (select public.heeft_recht(''prijzen_zien'')) and %s)
         with check (company_id = (select public.current_company_id()) and (select public.heeft_recht(''prijzen_zien'')) and %s)',
      t.tabel, t.bewerken, t.bewerken);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Vullen met wat er nu staat
-- ---------------------------------------------------------------------
insert into public.adres_prijzen (customer_id, company_id, prijs, maandwerk_extra)
  select id, company_id, coalesce(price, 0), public.maandwerk_extra_van(maandwerk)
  from public.customers;

insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  select id, company_id, coalesce(prijs, 0) from public.wasdag_regels;

insert into public.klus_prijzen (klus_id, company_id, prijs)
  select id, company_id, coalesce(prijs, 0) from public.klussen;

-- ---------------------------------------------------------------------
-- 5. Bijhouden in beide richtingen, tot stap D
--
-- Een eigen vlag (wooshy.prijs_sync) als rem: staat hij aan, dan komt de
-- wijziging zelf uit zo'n bijhoud-trigger, en dan niet weer terugschrijven
-- (anders ping-pongt het eindeloos). Bewust geen pg_trigger_depth(): dan zou
-- een prijs die later vanuit een andere trigger gezet wordt stil niet
-- bijgehouden worden.
-- ---------------------------------------------------------------------

-- Oude kolommen → nieuwe tabellen
create or replace function public.adres_prijs_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  insert into public.adres_prijzen (customer_id, company_id, prijs, maandwerk_extra)
  values (new.id, new.company_id, coalesce(new.price, 0), public.maandwerk_extra_van(new.maandwerk))
  on conflict (customer_id) do update
    set prijs = excluded.prijs, maandwerk_extra = excluded.maandwerk_extra
    where (adres_prijzen.prijs, adres_prijzen.maandwerk_extra)
      is distinct from (excluded.prijs, excluded.maandwerk_extra);
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger customers_prijs_bijhouden after insert or update of price, maandwerk on public.customers
  for each row execute function public.adres_prijs_bijhouden();

create or replace function public.wasdag_prijs_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  insert into public.wasdag_prijzen (regel_id, company_id, prijs)
  values (new.id, new.company_id, coalesce(new.prijs, 0))
  on conflict (regel_id) do update
    set prijs = excluded.prijs
    where wasdag_prijzen.prijs is distinct from excluded.prijs;
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger wasdag_regels_prijs_bijhouden after insert or update of prijs on public.wasdag_regels
  for each row execute function public.wasdag_prijs_bijhouden();

create or replace function public.klus_prijs_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  insert into public.klus_prijzen (klus_id, company_id, prijs)
  values (new.id, new.company_id, coalesce(new.prijs, 0))
  on conflict (klus_id) do update
    set prijs = excluded.prijs
    where klus_prijzen.prijs is distinct from excluded.prijs;
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger klussen_prijs_bijhouden after insert or update of prijs on public.klussen
  for each row execute function public.klus_prijs_bijhouden();

-- Nieuwe tabellen → oude kolommen
create or replace function public.adres_prijs_terugschrijven()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  update public.customers c
  set price = new.prijs,
      maandwerk = (
        select coalesce(
          jsonb_agg(
            case
              when jsonb_typeof(w) = 'object' and new.maandwerk_extra ? (w ->> 'id')
                then w || jsonb_build_object('extra', new.maandwerk_extra -> (w ->> 'id'))
              when jsonb_typeof(w) = 'object'
                then w || jsonb_build_object('extra', null)
              else w
            end
            order by nr
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end)
          with ordinality as t(w, nr)
      )
  where c.id = new.customer_id
    and c.company_id = new.company_id
    and (coalesce(c.price, 0) is distinct from new.prijs
         or public.maandwerk_extra_van(c.maandwerk) is distinct from new.maandwerk_extra);
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger adres_prijzen_terugschrijven after insert or update on public.adres_prijzen
  for each row execute function public.adres_prijs_terugschrijven();

create or replace function public.wasdag_prijs_terugschrijven()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  update public.wasdag_regels
  set prijs = new.prijs
  where id = new.regel_id and company_id = new.company_id and prijs is distinct from new.prijs;
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger wasdag_prijzen_terugschrijven after insert or update on public.wasdag_prijzen
  for each row execute function public.wasdag_prijs_terugschrijven();

create or replace function public.klus_prijs_terugschrijven()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('wooshy.prijs_sync', true) = '1' then
    return null;
  end if;
  perform set_config('wooshy.prijs_sync', '1', true);
  update public.klussen
  set prijs = new.prijs
  where id = new.klus_id and company_id = new.company_id and prijs is distinct from new.prijs;
  perform set_config('wooshy.prijs_sync', '', true);
  return null;
end
$$;
create trigger klus_prijzen_terugschrijven after insert or update on public.klus_prijzen
  for each row execute function public.klus_prijs_terugschrijven();

-- De hulpfuncties hoeft niemand van buiten aan te roepen.
revoke execute on function public.maandwerk_met_ids(jsonb) from public, anon;
revoke execute on function public.adres_prijs_bijhouden() from public, anon, authenticated;
revoke execute on function public.wasdag_prijs_bijhouden() from public, anon, authenticated;
revoke execute on function public.klus_prijs_bijhouden() from public, anon, authenticated;
revoke execute on function public.adres_prijs_terugschrijven() from public, anon, authenticated;
revoke execute on function public.wasdag_prijs_terugschrijven() from public, anon, authenticated;
revoke execute on function public.klus_prijs_terugschrijven() from public, anon, authenticated;
