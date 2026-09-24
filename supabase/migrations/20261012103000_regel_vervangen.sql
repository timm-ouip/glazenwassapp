-- Een gecrediteerde regel is "vervangen", niet "linkloos".
--
-- Vanmiddag loste ik het vastlopen na crediteren op door bij het crediteren
-- `wasdag_regel_id` en `klus_id` leeg te maken. Dat werkte, maar het gooide
-- ook weg *welke* beurt het was. En dat is precies wat je nodig hebt om
-- achteraf te kunnen zeggen: "deze panden moeten op de aangepaste factuur, die
-- niet" -- want dan moet je weten welke panden er op de gecrediteerde factuur
-- stonden, en er een nieuwe regel van kunnen maken die aan dezelfde beurt
-- hangt.
--
-- Dus: de link blijft staan, en de regel krijgt een stempel `vervangen_op`.
-- De unieke index kijkt daar nu langs, zodat er wél een nieuwe regel voor
-- dezelfde beurt kan komen. De gecrediteerde factuur houdt zijn regels en
-- bedragen; dat papier ligt bij de klant.
alter table public.factuurregels
  add column if not exists vervangen_op timestamptz;

comment on column public.factuurregels.vervangen_op is
  'Gezet bij het crediteren: deze regel is teruggeboekt en houdt een nieuwe regel voor dezelfde beurt niet meer tegen.';

-- De twee ontdubbelindexen kijken langs vervangen regels.
drop index if exists factuurregels_wasbeurt_uniek;
create unique index factuurregels_wasbeurt_uniek on public.factuurregels (wasdag_regel_id)
  where wasdag_regel_id is not null and deleted_at is null and vervangen_op is null;

drop index if exists factuurregels_klus_uniek;
create unique index factuurregels_klus_uniek on public.factuurregels (klus_id)
  where klus_id is not null and deleted_at is null and vervangen_op is null;

-- ---------------------------------------------------------------------
-- Crediteren: stempelen in plaats van leegmaken
-- ---------------------------------------------------------------------
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

  -- De regels zijn teruggeboekt: ze houden een nieuwe regel voor dezelfde
  -- beurt niet meer tegen, maar we weten nog wél welke beurt het was.
  update public.factuurregels
    set vervangen_op = now()
    where factuur_id = factuur and company_id = bedrijf and vervangen_op is null;

  update public.facturen set status = 'gecrediteerd' where id = factuur;
  return nieuw;
end
$$;

-- ---------------------------------------------------------------------
-- De ontdubbeling kijkt ook langs vervangen regels
-- ---------------------------------------------------------------------
create or replace function public.factuurregels_maken(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  start_op date;
  gemaakt integer := 0;
begin
  if bedrijf is null then
    return 0;
  end if;

  select c.factuur_start_op into start_op from public.companies c where c.id = bedrijf;
  if start_op is null or dag < start_op then
    return 0;
  end if;

  if exists (
    select 1 from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.customer_id is not null and r.gedaan_op is null
  ) then
    return 0;
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, wasdag_regel_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    bedrijf, k.id, cu.id, 'wasbeurt', r.id, r.datum,
    coalesce(nullif(btrim(k.factuur_omschrijving), ''),
             'Glazenwassen ' || public.factuur_adres_tekst(cu.id)),
    case when r.notitie_op_factuur then coalesce(r.notitie, '') else '' end,
    wp.prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(wp.prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  from public.wasdag_regels r
  join public.customers cu on cu.id = r.customer_id
  join public.klanten k on k.id = cu.klant_id and k.company_id = r.company_id
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  left join public.streets s on s.id = cu.street_id
  left join public.districts d on d.id = s.district_id
  where r.company_id = bedrijf and r.datum = dag
    and r.gedaan_op is not null
    and r.niet_gewassen_op is null
    and wp.prijs > 0
    and cu.deleted_at is null and k.deleted_at is null
    and coalesce(r.betaalmethode, cu.betaalmethode, d.betaalmethode, 'contant') = 'overmaken'
    and not exists (
      select 1 from public.factuurregels fr
      where fr.wasdag_regel_id = r.id and fr.deleted_at is null and fr.vervangen_op is null
    );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuurregels_maken(date) from public, anon, authenticated;

-- En de klus-trigger, om dezelfde reden.
create or replace function public.klus_factuurregel_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  start_op date;
  methode text;
  k public.klanten;
  prijs numeric;
begin
  if new.gedaan_op is not distinct from old.gedaan_op then
    return new;
  end if;

  if new.gedaan_op is null then
    -- Vinkje eruit: de regel gaat mee, zolang er nog geen nummer op staat.
    -- Een vervangen regel hoort bij een gecrediteerde factuur en blijft.
    delete from public.factuurregels fr
      where fr.klus_id = new.id
        and fr.vervangen_op is null
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f where f.id = fr.factuur_id and f.nummer is null));
    return new;
  end if;

  select c.factuur_start_op into start_op from public.companies c where c.id = new.company_id;
  if start_op is null or new.gedaan_op < start_op then
    return new;
  end if;

  select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') into methode
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = new.customer_id and cu.deleted_at is null;
  if methode is distinct from 'overmaken' then
    return new;
  end if;

  select kl.* into k
    from public.klanten kl
    join public.customers cu on cu.klant_id = kl.id
    where cu.id = new.customer_id and kl.deleted_at is null;
  if not found then
    return new;
  end if;

  select kp.prijs into prijs from public.klus_prijzen kp where kp.klus_id = new.id;
  if coalesce(prijs, 0) <= 0 then
    return new;
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, klus_id, datum,
    omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    new.company_id, k.id, new.customer_id, 'klus', new.id, new.gedaan_op,
    coalesce(nullif(btrim(new.omschrijving), ''), 'Extra opdracht'),
    prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  where not exists (
    select 1 from public.factuurregels fr
    where fr.klus_id = new.id and fr.deleted_at is null and fr.vervangen_op is null
  );
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- Wat stond er op de gecrediteerde factuur, en wat gaat er opnieuw op?
-- ---------------------------------------------------------------------
-- Voor het lijstje panden bij "stuur een aangepaste factuur": je ziet wat er
-- op de gecrediteerde factuur stond en vinkt aan wat er opnieuw op moet.
create or replace function public.factuur_opnieuw(factuur uuid, regels uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  gemaakt integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;
  select * into f from public.facturen where id = factuur and company_id = bedrijf;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.status <> 'gecrediteerd' then
    raise exception 'Dit kan alleen bij een gecrediteerde factuur.';
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, wasdag_regel_id, klus_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select fr.company_id, fr.klant_id, fr.customer_id, fr.soort,
         fr.wasdag_regel_id, fr.klus_id, fr.datum,
         fr.omschrijving, fr.notitie,
         fr.bedrag, fr.btw_inclusief, fr.btw_procent, fr.bedrag_excl
    from public.factuurregels fr
    where fr.factuur_id = factuur and fr.company_id = bedrijf
      and fr.deleted_at is null
      and fr.id = any (coalesce(regels, '{}'))
      -- Staat er al een levende regel voor deze beurt of klus, dan is het werk
      -- al opnieuw aangemeld en hoeft er niets bij.
      and not exists (
        select 1 from public.factuurregels x
        where x.deleted_at is null and x.vervangen_op is null
          and ((fr.wasdag_regel_id is not null and x.wasdag_regel_id = fr.wasdag_regel_id)
            or (fr.klus_id is not null and x.klus_id = fr.klus_id))
      );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuur_opnieuw(uuid, uuid[]) from public, anon;
grant execute on function public.factuur_opnieuw(uuid, uuid[]) to authenticated;
