-- Bij het opnieuw factureren kun je het bedrag aanpassen.
--
-- Afspraak met Timmie: soms is niet een heel pand overgeslagen maar de helft
-- ervan. Dan moet er wél een factuur uit, maar voor minder. Het aanvinken
-- alleen is dus niet genoeg: per pand hoort er een bedrag bij dat je kunt
-- wijzigen.
--
-- De keuzes komen als jsonb binnen: [{"id": "<regel>", "bedrag": 12.5}].
-- Laat je `bedrag` weg, dan blijft het bedrag van de oorspronkelijke regel
-- staan.
--
-- De btw wordt opnieuw uitgerekend met het tarief van de oorspronkelijke
-- regel, niet met dat van vandaag: anders zou een tariefwijziging tussentijds
-- een oude beurt duurder maken.
drop function if exists public.factuur_opnieuw(uuid, uuid[]);

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
    from jsonb_to_recordset(coalesce(keuzes, '[]'::jsonb)) as gekozen(id uuid, bedrag numeric)
    join public.factuurregels fr on fr.id = gekozen.id
    -- Geen bedrag meegegeven, of een onzinnig bedrag: dan het oorspronkelijke.
    cross join lateral (
      select case when gekozen.bedrag is null or gekozen.bedrag <= 0
                  then fr.bedrag else round(gekozen.bedrag, 2) end as bedrag
    ) k
    where fr.factuur_id = factuur and fr.company_id = bedrijf
      and fr.deleted_at is null
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
revoke execute on function public.factuur_opnieuw(uuid, jsonb) from public, anon;
grant execute on function public.factuur_opnieuw(uuid, jsonb) to authenticated;
