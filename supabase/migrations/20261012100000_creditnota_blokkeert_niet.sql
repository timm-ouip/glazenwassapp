-- De creditnota mag de dag ook niet op slot zetten.
--
-- In de vorige migratie stond de uitzondering voor creditnota's alleen in het
-- wéggooien van de regels, niet in de controle erboven. Die controle telt elke
-- regel van die dag die op een genummerde factuur staat -- en de regels van een
-- creditnota hebben dezelfde datum en `soort = 'wasbeurt'`. Dus zodra je de
-- creditnota zelf had gemaild, hield hij de dag tegen:
--
--   factuur verstuurd → crediteren → dag heropenen lukt → creditnota versturen
--   → dag heropenen weigert weer, met "crediteer die eerst"
--
-- Terwijl een creditnota crediteren niet eens kan. Hetzelfde doodlopende
-- straatje, één stap later. Het getal in de melding klopte ook niet: de
-- creditregel én de nieuwe factuurregel werden beide meegeteld, dus één adres
-- las als twee.
--
-- Een creditnota telt dus nergens mee: hij is de tegenboeking, geen werk.
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
  -- Wat de dag tegenhoudt: een gewone factuur met een nummer die nog niet
  -- gecrediteerd is. Dat papier staat bij de klant en klopt nog.
  select count(*) into buiten
    from public.factuurregels fr
    join public.facturen f on f.id = fr.factuur_id
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and fr.deleted_at is null and f.nummer is not null
      and f.soort <> 'credit'
      and f.status <> 'gecrediteerd';
  if buiten > 0 then
    raise exception 'Voor % van deze dag is al een factuur verstuurd. Crediteer die eerst, dan kan de dag weer open.',
      case when buiten = 1 then '1 adres' else buiten::text || ' adressen' end;
  end if;

  -- Weg mogen alleen de regels die nog nergens de deur uit zijn: losse regels
  -- en die op een gewoon concept. Wat op een genummerde factuur staat blijft
  -- staan, en een creditnota blijft óók staan.
  delete from public.factuurregels fr
    where fr.company_id = bedrijf and fr.datum = dag and fr.soort = 'wasbeurt'
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id
                         and f.nummer is null
                         and f.soort <> 'credit'));
  get diagnostics weg = row_count;

  -- En het concept dat daardoor leeg achterblijft.
  delete from public.facturen f
    where f.company_id = bedrijf and f.nummer is null
      and not exists (select 1 from public.factuurregels fr where fr.factuur_id = f.id);

  return weg;
end
$$;
revoke execute on function public.factuurregels_terug(date) from public, anon, authenticated;
