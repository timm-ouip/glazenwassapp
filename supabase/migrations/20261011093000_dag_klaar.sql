-- Betalingen, fase 2: "Dag klaar".
--
-- Aan het eind van de dag meldt elk team zijn werk af. Wat aangevinkt blijft
-- is gedaan (wasdag_regels.gedaan_op); wat niet gedaan is gaat van de dag af,
-- terug naar de planning of met de maand overgeslagen (dat laatste doet de
-- app, met dezelfde code als "Overslaan" in de planning). Pas een afgemelde
-- wasbeurt staat open bij de klant.
--
-- Het logboek dag_afmeldingen zegt wie wanneer afmeldde en wie het weer
-- openzette. Een team is afgemeld zolang er een regel zonder heropend_op is.

create table public.dag_afmeldingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  datum date not null,
  -- Het team; leeg = het werk zonder team (of een dag zonder teamindeling).
  ploeg_nr smallint,
  door uuid default auth.uid(),
  door_naam text not null default '',
  op timestamptz not null default now(),
  gedaan integer not null default 0,
  weg integer not null default 0,
  -- Wat er van de dag af ging, om het met Ongedaan maken terug te zetten.
  weg_kenmerk uuid,
  heropend_op timestamptz,
  heropend_door uuid,
  heropend_naam text
);
create index dag_afmeldingen_dag on public.dag_afmeldingen (company_id, datum);
create trigger dag_afmeldingen_set_company_id before insert on public.dag_afmeldingen
  for each row execute function public.set_company_id();

alter table public.dag_afmeldingen enable row level security;
revoke all on public.dag_afmeldingen from anon;
create policy "Afmeldingen lezen" on public.dag_afmeldingen
  for select to authenticated
  using (
    company_id = (select public.current_company_id())
    and ((select public.heeft_recht('planning')) or (select public.heeft_recht('prijzen_zien')))
  );

-- ---------------------------------------------------------------------
-- Gedaan bijhouden
--
-- Alleen "Dag klaar", weer openzetten en terugzetten zetten de stempel (met
-- de vlag wooshy.gedaan); verder blijft hij van niemand. Komt er een regel
-- bij op een team dat al is afgemeld, dan is hij gedaan: hij staat er
-- achteraf, dus het werk is gebeurd. Verhuist gedaan werk naar een andere
-- dag, dan is het daar nog niet gedaan; komt het terug op zijn eigen dag
-- (Ongedaan maken), dan krijgt het zijn stempel terug.
-- De naam begint met zz zodat hij na set_company_id draait.
-- ---------------------------------------------------------------------
create or replace function public.wasdag_gedaan_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mag boolean := coalesce(current_setting('wooshy.gedaan', true), '') = '1'
                 or auth.role() = 'service_role';
begin
  if tg_op = 'INSERT' then
    if not mag then
      new.gedaan_op := null;
      new.gedaan_door := null;
      new.gedaan_bewaard := null;
    end if;
  else
    if not mag then
      new.gedaan_op := old.gedaan_op;
      new.gedaan_door := old.gedaan_door;
      new.gedaan_bewaard := old.gedaan_bewaard;
    end if;
    if new.datum is not distinct from old.datum then
      return new;
    end if;
    if new.gedaan_op is not null then
      -- Weg van de dag waarop het gedaan was: onthouden.
      new.gedaan_bewaard := jsonb_build_object('datum', old.datum, 'op', new.gedaan_op, 'door', new.gedaan_door);
      new.gedaan_op := null;
      new.gedaan_door := null;
    elsif new.gedaan_bewaard is not null and (new.gedaan_bewaard ->> 'datum')::date = new.datum then
      -- Terug op zijn eigen dag.
      new.gedaan_op := (new.gedaan_bewaard ->> 'op')::timestamptz;
      new.gedaan_door := nullif(new.gedaan_bewaard ->> 'door', '')::uuid;
      new.gedaan_bewaard := null;
      return new;
    end if;
  end if;
  if new.gedaan_op is null and exists (
    select 1 from public.dag_afmeldingen a
    where a.company_id = new.company_id and a.datum = new.datum
      and a.ploeg_nr is not distinct from new.ploeg_nr and a.heropend_op is null
  ) then
    new.gedaan_op := now();
    new.gedaan_door := auth.uid();
  end if;
  return new;
end
$$;
create trigger wasdag_regels_zz_gedaan before insert or update on public.wasdag_regels
  for each row execute function public.wasdag_gedaan_bijhouden();

-- ---------------------------------------------------------------------
-- Weghalen en terugzetten onthouden ook of het gedaan was. Verder gelijk
-- aan de versie uit ploegen_en_volgorde.
-- ---------------------------------------------------------------------
create or replace function public.wasdag_weghalen(dag date, adressen uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  weg jsonb;
  kenmerk uuid;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald where company_id = bedrijf and created_at < now() - interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'prijs', wp.prijs,
    'ploeg_nr', r.ploeg_nr, 'volgorde', r.volgorde, 'rest', r.rest, 'vaste_start', r.vaste_start,
    'gedaan_op', r.gedaan_op, 'gedaan_door', r.gedaan_door, 'gedaan_bewaard', r.gedaan_bewaard
  )), '[]'::jsonb)
  into weg
  from public.wasdag_regels r
  left join public.wasdag_prijzen wp on wp.regel_id = r.id
  where r.company_id = bedrijf
    and r.datum = dag
    and (adressen is null or r.customer_id = any(adressen));

  if jsonb_array_length(weg) = 0 then
    return null;
  end if;

  delete from public.wasdag_regels
  where company_id = bedrijf
    and datum = dag
    and (adressen is null or customer_id = any(adressen));

  insert into public.wasdag_weggehaald (company_id, regels) values (bedrijf, weg)
  returning id into kenmerk;
  return kenmerk;
end
$$;

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
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
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
  perform set_config('wooshy.gedaan', '1', true);

  -- Eerst terugzetten, mét de indeling van die dag en of het gedaan was. De
  -- prijsregel maakt een trigger aan zodra deze opdracht klaar is; pas daarna
  -- kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels
      (company_id, datum, customer_id, notitie, ploeg_nr, volgorde, rest, vaste_start,
       gedaan_op, gedaan_door, gedaan_bewaard)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time,
           nullif(r ->> 'gedaan_op', '')::timestamptz,
           nullif(r ->> 'gedaan_door', '')::uuid,
           case when jsonb_typeof(r -> 'gedaan_bewaard') = 'object' then r -> 'gedaan_bewaard' end
    from jsonb_array_elements(bewaard) as t(r)
    where r ->> 'customer_id' is not null
      and exists (
        select 1 from public.customers c
        where c.id = (r ->> 'customer_id')::uuid
          and c.company_id = bedrijf
          -- Gedaan werk komt altijd terug; de planning alleen voor wie nog
          -- klant is.
          and (
            (r ->> 'datum')::date <= vandaag
            or (c.deleted_at is null and c.inactief_op is null)
          )
      )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;
  aantal := cardinality(nieuw);

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

-- ---------------------------------------------------------------------
-- Dag klaar
-- ---------------------------------------------------------------------
-- Meldt het werk van één team op één dag af. `weg` zijn de adressen die niet
-- gedaan zijn: die gaan (bewaard) van de dag af. De rest is gedaan.
create or replace function public.dag_afmelden(dag date, ploeg smallint, weg uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  wegIds uuid[];
  kenmerk uuid;
  gedaan integer;
  nieuw uuid;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if dag is null or dag > vandaag then
    raise exception 'Een dag kun je pas afmelden als hij begonnen is.';
  end if;

  perform set_config('wooshy.gedaan', '1', true);
  -- Alleen adressen die echt bij dit team op deze dag staan. Een lege lijst
  -- mag nooit bij wasdag_weghalen aankomen: dan haalt die de hele dag weg.
  select coalesce(array_agg(r.customer_id), '{}') into wegIds
    from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg
      and r.customer_id = any (coalesce(weg, '{}'));
  if cardinality(wegIds) > 0 then
    kenmerk := public.wasdag_weghalen(dag, wegIds);
  end if;

  update public.wasdag_regels
    set gedaan_op = now(), gedaan_door = auth.uid()
    where company_id = bedrijf and datum = dag
      and ploeg_nr is not distinct from ploeg and gedaan_op is null;
  get diagnostics gedaan = row_count;

  insert into public.dag_afmeldingen (company_id, datum, ploeg_nr, door, door_naam, gedaan, weg, weg_kenmerk)
    values (bedrijf, dag, ploeg, auth.uid(), public.geld_mijn_naam(), gedaan, cardinality(wegIds), kenmerk)
    returning id into nieuw;

  return jsonb_build_object('id', nieuw, 'gedaan', gedaan, 'weg', cardinality(wegIds));
end
$$;

-- Wie een afmelding weer open mag zetten: de eigenaar altijd, en wie hem
-- deed op dezelfde dag (een vergissing meteen herstellen).
create or replace function public.dag_afmelding_mag_open(a public.dag_afmeldingen)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_eigenaar()
    or (a.door = auth.uid()
        and (a.op at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date)
$$;
revoke execute on function public.dag_afmelding_mag_open(public.dag_afmeldingen) from public, anon, authenticated;

-- Zet een team op een dag weer open: niets meer gedaan. Wat bij het afmelden
-- van de dag af ging, blijft in de planning staan.
create or replace function public.dag_heropenen(dag date, ploeg smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.dag_afmeldingen;
  n integer;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  -- De eigenaar altijd. Anderen alleen hun eigen afmelding van vandaag; een
  -- dag die zonder afmelding als gedaan staat (van vóór "Dag klaar") niet.
  if not public.is_eigenaar() then
    if not exists (
      select 1 from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    ) then
      raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
    end if;
    for a in
      select * from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    loop
      if not public.dag_afmelding_mag_open(a) then
        raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
      end if;
    end loop;
  end if;
  perform set_config('wooshy.gedaan', '1', true);
  update public.dag_afmeldingen
    set heropend_op = now(), heropend_door = auth.uid(), heropend_naam = public.geld_mijn_naam()
    where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null;
  update public.wasdag_regels
    set gedaan_op = null, gedaan_door = null
    where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and gedaan_op is not null;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Ongedaan maken, meteen na "Dag klaar": weer open, en wat van de dag af
-- ging komt terug (zolang dat nog bewaard is: een week).
create or replace function public.dag_afmelden_terugdraaien(afmelding uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.dag_afmeldingen;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  select * into a from public.dag_afmeldingen where id = afmelding and company_id = bedrijf;
  if not found then
    raise exception 'Die afmelding bestaat niet.';
  end if;
  if a.heropend_op is not null then
    raise exception 'Deze dag is al weer opengezet.';
  end if;
  perform public.dag_heropenen(a.datum, a.ploeg_nr);
  if a.weg_kenmerk is not null
     and exists (select 1 from public.wasdag_weggehaald where id = a.weg_kenmerk and company_id = bedrijf) then
    perform public.wasdag_terugzetten(a.weg_kenmerk);
  end if;
end
$$;

-- Per dag en team: hoeveel werk er staat, hoeveel gedaan is, en de laatste
-- afmelding die nog geldt. Voor de knop "Dag klaar" en de stipjes in de
-- planning.
create or replace function public.dag_afmeldstatus(vanaf date, tot date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
begin
  if bedrijf is null or not (public.heeft_recht('planning') or public.heeft_recht('prijzen_zien')) then
    raise exception 'Je rol mag de planning niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'datum', g.datum,
      'ploeg_nr', g.ploeg_nr,
      'regels', g.regels,
      'gedaan', g.gedaan,
      'afmelding', (
        select jsonb_build_object('id', a.id, 'door', a.door, 'door_naam', a.door_naam, 'op', a.op,
                                  'mag_open', public.dag_afmelding_mag_open(a))
        from public.dag_afmeldingen a
        where a.company_id = bedrijf and a.datum = g.datum
          and a.ploeg_nr is not distinct from g.ploeg_nr and a.heropend_op is null
        order by a.op desc limit 1
      )
    ) order by g.datum, g.ploeg_nr nulls first)
    from (
      select r.datum, r.ploeg_nr, count(*)::int as regels, count(r.gedaan_op)::int as gedaan
      from public.wasdag_regels r
      where r.company_id = bedrijf and r.datum between vanaf and tot and r.customer_id is not null
      group by r.datum, r.ploeg_nr
    ) g
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.dag_afmelden(date, smallint, uuid[]) from public, anon;
grant execute on function public.dag_afmelden(date, smallint, uuid[]) to authenticated;
revoke execute on function public.dag_heropenen(date, smallint) from public, anon;
grant execute on function public.dag_heropenen(date, smallint) to authenticated;
revoke execute on function public.dag_afmelden_terugdraaien(uuid) from public, anon;
grant execute on function public.dag_afmelden_terugdraaien(uuid) to authenticated;
revoke execute on function public.dag_afmeldstatus(date, date) from public, anon;
grant execute on function public.dag_afmeldstatus(date, date) to authenticated;
revoke execute on function public.wasdag_gedaan_bijhouden() from public, anon, authenticated;
