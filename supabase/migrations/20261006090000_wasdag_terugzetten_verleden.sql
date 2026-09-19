-- Terugzetten van "dag leegmaken" of "opschuiven" liet regels stil weg.
--
-- wasdag_terugzetten zette alleen adressen terug die nog actief en niet
-- weggegooid zijn. Voor een dag in de toekomst klopt dat: een gestopt adres
-- hoort niet meer op de planning. Maar een dag die al geweest is, is gedaan
-- werk: die regel is de factuurregel (bedrag en notitie van die dag). Stopte
-- de klant daarna, en maakte je die dag per ongeluk leeg, dan kwam bij
-- Ongedaan maken alles terug behalve zijn regel — en die was dan weg.
--
-- Nu: t/m vandaag komt elke regel terug waarvan het adres nog bestaat (ook
-- gestopt of in de prullenbak); na vandaag alleen actieve adressen, zoals
-- voorheen. Een adres dat definitief gewist is kan niet terug (geen rij meer).

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

  -- Eerst terugzetten. De prijsregel van een nieuwe regel maakt een trigger
  -- aan zodra deze opdracht klaar is; pas daarna kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie'
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
