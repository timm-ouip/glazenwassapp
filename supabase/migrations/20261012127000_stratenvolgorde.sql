-- Straten verslepen in één opdracht.
--
-- Eén straat een plek opschuiven stuurde tot nu toe één bijwerkopdracht per
-- straat van het hele bedrijf -- tientallen los van elkaar, tegelijk de deur
-- uit. Drie dingen gingen daar mis:
--
-- * Het is traag, en het wordt trager naarmate er meer straten zijn.
-- * Mislukt er één halverwege, dan staat de volgorde half oud en half nieuw.
--   Er werd ook niet gekeken óf het lukte.
-- * Het schrijft ook naar straten die je niet aanraakte. Verzet een collega
--   op hetzelfde moment iets, dan veeg je dat weg.
--
-- Nu gaat de hele lijst in één keer mee en doet de database het in één
-- opdracht. Alleen wat echt verandert wordt geschreven: één plek opschuiven
-- raakt twee straten, niet vijftig.

create or replace function public.straten_volgorde(ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  geraakt integer;
begin
  -- Dezelfde grens als het gewone beleid op `streets`: wie plant, of wie
  -- klanten bewerkt (importeren maakt straten aan).
  if bedrijf is null
     or not (public.heeft_recht('planning') or public.heeft_recht('klanten_bewerken')) then
    raise exception 'Je rol mag de volgorde van straten niet aanpassen.';
  end if;

  update public.streets s
    set sort_order = v.nr
    from unnest(ids) with ordinality as v(id, nr)
    where s.id = v.id
      and s.company_id = bedrijf
      and s.sort_order is distinct from v.nr::integer;

  get diagnostics geraakt = row_count;
  return geraakt;
end
$$;

revoke execute on function public.straten_volgorde(uuid[]) from public, anon;
grant execute on function public.straten_volgorde(uuid[]) to authenticated;
