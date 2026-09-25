-- Wat de nakijker ving op het opslaan van de straatvolgorde.
--
-- De functie schreef wat er te schrijven viel en zweeg over de rest. Paste een
-- id niet -- een straat die een collega net weggooide, of een lijst uit een
-- tabblad dat al een tijd openstond -- dan sloeg hij die stil over en meldde
-- de app "gelukt", terwijl de volgorde maar half aankwam.
--
-- Nu kijkt hij eerst of élke straat uit de lijst echt bestaat, van dit bedrijf
-- is en niet in de prullenbak staat. Klopt dat niet, dan wordt er niets
-- geschreven en hoort de gebruiker dat zijn lijst niet meer actueel is. Dat is
-- beter dan een half opgeslagen volgorde die pas opvalt als iemand de pagina
-- opnieuw laadt.

create or replace function public.straten_volgorde(ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  verwacht integer := coalesce(array_length(ids, 1), 0);
  gevonden integer;
  geraakt integer;
begin
  -- Dezelfde grens als het gewone beleid op `streets`: wie plant, of wie
  -- klanten bewerkt (importeren maakt straten aan).
  if bedrijf is null
     or not (public.heeft_recht('planning') or public.heeft_recht('klanten_bewerken')) then
    raise exception 'Je rol mag de volgorde van straten niet aanpassen.';
  end if;

  if verwacht = 0 then
    return 0;
  end if;

  select count(distinct s.id) into gevonden
  from public.streets s
  where s.id = any(ids)
    and s.company_id = bedrijf
    and s.deleted_at is null;

  if gevonden <> cardinality(array(select distinct unnest(ids))) then
    raise exception
      'De lijst met straten is niet meer actueel: % van de % straten bestaan nog. Ververs de pagina.',
      gevonden, verwacht;
  end if;

  update public.streets s
    set sort_order = v.nr
    from unnest(ids) with ordinality as v(id, nr)
    where s.id = v.id
      and s.company_id = bedrijf
      and s.deleted_at is null
      and s.sort_order is distinct from v.nr::integer;

  get diagnostics geraakt = row_count;
  return geraakt;
end
$$;

revoke execute on function public.straten_volgorde(uuid[]) from public, anon;
grant execute on function public.straten_volgorde(uuid[]) to authenticated;
