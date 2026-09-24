-- Een creditnota mag niet verdwijnen als de dag weer opengaat.
--
-- Uit het natesten van de vorige migratie: crediteer de factuur van een dag,
-- zet die dag weer open, en de creditnota was weg. De regels van een
-- creditnota zijn namelijk een kopie van de originele regels -- dus met
-- dezelfde datum en `soort = 'wasbeurt'` -- en `factuurregels_terug` ruimt
-- alles van die dag op wat nog niet genummerd is. Een creditconcept is nog
-- niet genummerd, dus die ging mee, en daarna werd het lege concept ook nog
-- opgeruimd.
--
-- Gevolg in de boeken: een verstuurde factuur met de stand "gecrediteerd",
-- maar geen creditnota meer om dat mee aan te tonen.
--
-- Een creditnota hoort ook niet bij het werk van die dag: hij ontstaat door
-- het crediteren, niet door het afmelden. Vandaar de extra voorwaarde.
create or replace function public.factuurregels_terug(dag date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  buiten integer;
  weg integer;
begin
  -- Een factuur die nog echt buiten staat houdt de dag tegen; een
  -- gecrediteerde niet meer.
  select count(*) into buiten
    from public.factuurregels fr
    join public.facturen f on f.id = fr.factuur_id
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and fr.deleted_at is null and f.nummer is not null
      and f.status <> 'gecrediteerd';
  if buiten > 0 then
    raise exception 'Voor % van deze dag is al een factuur verstuurd. Crediteer die eerst, dan kan de dag weer open.',
      case when buiten = 1 then '1 adres' else buiten::text || ' adressen' end;
  end if;

  -- Weg mogen alleen de regels die nog nergens de deur uit zijn: losse regels
  -- en die op een gewoon concept. Wat op een genummerde factuur staat blijft
  -- staan, en een creditnota blijft óók staan -- die hoort niet bij deze dag.
  delete from public.factuurregels fr
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id
                         and f.nummer is null
                         and f.soort <> 'credit'));
  get diagnostics weg = row_count;

  -- En het concept dat daardoor leeg achterblijft. Een creditnota valt hier
  -- vanzelf buiten: die heeft zijn regels nog.
  delete from public.facturen f
    where f.company_id = bedrijf and f.nummer is null
      and not exists (select 1 from public.factuurregels fr where fr.factuur_id = f.id);

  return weg;
end
$$;
revoke execute on function public.factuurregels_terug(date) from public, anon, authenticated;
