-- Herstel: `with ordinality` mag niet samen met een kolomlijst.
--
-- In de vorige poging stond `jsonb_to_recordset(...) with ordinality as
-- g(id uuid, bedrag numeric, ord bigint)`. Postgres maakt de functie dan wel
-- aan, maar bij het aanroepen komt er "WITH ORDINALITY cannot be used with a
-- column definition list" uit -- en dat stond dus letterlijk in het scherm
-- toen ik op de knop drukte.
--
-- Nu via `jsonb_array_elements`, dat één kolom teruggeeft en dus geen
-- kolomlijst nodig heeft. De velden haal ik er daarna zelf uit. Bij een
-- dubbele regel in de lijst wint nog steeds het laatst meegegeven bedrag.
create or replace function public.factuur_opnieuw(factuur uuid, keuzes jsonb)
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
  if f.soort <> 'factuur' then
    raise exception 'Dit kan alleen bij een gewone factuur.';
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
         k.bedrag,
         fr.btw_inclusief, fr.btw_procent,
         public.factuur_excl(k.bedrag, fr.btw_inclusief, fr.btw_procent)
    from (
      select distinct on (q.id) q.id, q.bedrag
        from (
          select (e->>'id')::uuid as id,
                 (e->>'bedrag')::numeric as bedrag,
                 ord
            from jsonb_array_elements(coalesce(keuzes, '[]'::jsonb))
                   with ordinality as t(e, ord)
        ) q
       where q.id is not null
       order by q.id, q.ord desc
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
