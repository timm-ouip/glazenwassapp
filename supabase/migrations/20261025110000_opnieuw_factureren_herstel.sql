-- Herstel: "opnieuw factureren" na een creditnota liep vast.
--
-- De versie uit 20261012113000_fase1_review sorteerde op `g.ordinality`
-- (bij twee keer klikken wint het laatste bedrag), maar vroeg die kolom niet
-- op. Elke aanroep gaf daardoor "column g.ordinality does not exist", dus na
-- het crediteren kon het werk niet opnieuw op een factuur. Zelfde valkuil als
-- in 20261012107000: `with ordinality` mag niet samen met een kolomlijst, dus
-- via `rows from`.
--
-- Verder gelijk aan de versie uit 20261012113000_fase1_review.

create or replace function public.factuur_opnieuw(factuur uuid, keuzes jsonb default '[]'::jsonb)
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

  select * into f from public.facturen
    where id = factuur and company_id = bedrijf for update;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.status <> 'gecrediteerd' then
    raise exception 'Alleen werk van een gecrediteerde factuur kun je opnieuw factureren.';
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort,
    wasdag_regel_id, klus_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl,
    bedrag_met_de_hand
  )
  select fr.company_id, fr.klant_id, fr.customer_id, fr.soort,
         fr.wasdag_regel_id, fr.klus_id, fr.datum,
         fr.omschrijving, fr.notitie,
         k.bedrag,
         fr.btw_inclusief, fr.btw_procent,
         public.factuur_excl(k.bedrag, fr.btw_inclusief, fr.btw_procent),
         true
    from (
      select distinct on (g.id) g.id, g.bedrag
        from rows from (
          jsonb_to_recordset(coalesce(keuzes, '[]'::jsonb)) as (id uuid, bedrag numeric)
        ) with ordinality as g(id, bedrag, ordinality)
       where g.id is not null
       order by g.id, g.ordinality desc
    ) gekozen
    join public.factuurregels fr on fr.id = gekozen.id
    cross join lateral (
      select case when gekozen.bedrag is null or gekozen.bedrag <= 0
                  then fr.bedrag else round(gekozen.bedrag, 2) end as bedrag
    ) k
    join public.klanten kl on kl.id = fr.klant_id and kl.deleted_at is null
    left join public.customers cu on cu.id = fr.customer_id
    where fr.factuur_id = factuur and fr.company_id = bedrijf
      and fr.deleted_at is null
      and (fr.customer_id is null or cu.deleted_at is null)
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

revoke execute on function public.factuur_opnieuw(uuid, jsonb) from public, anon;
grant execute on function public.factuur_opnieuw(uuid, jsonb) to authenticated;
