-- Dagen weghalen en terugzetten zonder dat een aangepaste dagprijs verloren gaat.
--
-- "Dag leegmaken" en het uitvinken bij "inplannen" halen regels weg; ongedaan
-- maken zette ze opnieuw neer met de prijs die de browser kende. Wie geen
-- prijzen mag zien, kent die prijs niet (0), en dan kreeg de dag weer de
-- gewone prijs. Nu bewaart de database zelf wat er wegging, mét het bedrag,
-- en zet dat bij ongedaan maken terug. De browser stuurt geen bedragen mee,
-- dus niemand kan zo een prijs verzinnen.

create table public.wasdag_weggehaald (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  regels jsonb not null,
  created_at timestamptz not null default now()
);
create index wasdag_weggehaald_company_idx on public.wasdag_weggehaald (company_id, created_at);

-- Alleen via de functies hieronder; niemand leest of schrijft deze tabel direct.
-- Toch de vaste regel per bedrijf en de bedrijfsinvulling: gaat hij ooit open,
-- dan ziet niemand de bewaarde planning van een ander bedrijf.
alter table public.wasdag_weggehaald enable row level security;
revoke all on public.wasdag_weggehaald from anon, authenticated;
create policy "Eigen bedrijf" on public.wasdag_weggehaald
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
create trigger wasdag_weggehaald_set_company_id before insert on public.wasdag_weggehaald
  for each row execute function public.set_company_id();

-- Haalt regels van een dag weg en bewaart ze. Zonder adressenlijst: de hele
-- dag. Geeft het kenmerk terug waarmee je ze terugzet (of null als er niets
-- weg hoefde).
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

  -- Oude bewaarde lijsten opruimen: ongedaan maken is voor direct daarna.
  delete from public.wasdag_weggehaald where company_id = bedrijf and created_at < now() - interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'prijs', wp.prijs
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

-- Zet bewaarde regels terug, met hun eigen bedrag. Een adres dat intussen
-- weer op die dag staat, blijft zoals het is.
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
    on conflict (company_id, datum, customer_id) do nothing
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

revoke all on function public.wasdag_weghalen(date, uuid[]) from public, anon;
grant execute on function public.wasdag_weghalen(date, uuid[]) to authenticated;
revoke all on function public.wasdag_terugzetten(uuid) from public, anon;
grant execute on function public.wasdag_terugzetten(uuid) to authenticated;
