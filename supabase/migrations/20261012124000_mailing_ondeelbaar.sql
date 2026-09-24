-- Twee mensen die op hetzelfde moment op versturen drukken.
--
-- `mail-versturen` keek eerst of deze dag het afgelopen uur al verstuurd was
-- en legde daarna pas de verzending vast. Tussen die twee stappen zit tijd, en
-- twee verzoeken die er tegelijk doorheen lopen zien allebei "nog niets" --
-- waarna de hele wijk twee keer een aankondiging krijgt. Bij WhatsApp kost dat
-- ook nog eens dubbel geld.
--
-- Dit is niet op te lossen met een unieke sleutel: het mág vaker per dag, want
-- na een half uur nog een ronde voor wie hem nog niet had is gewoon goed. Het
-- gaat om die ene paar seconden.
--
-- Daarom: het vastleggen gaat door één functie heen die eerst een slot neemt
-- op dit bedrijf en deze dag. Wie tweede is, wacht netjes tot de eerste klaar
-- is, ziet dán dat er al iets ligt en krijgt niets terug. De functie geeft
-- alleen het id terug als hij de verzending echt heeft vastgelegd.
--
-- Het slot geldt per transactie, dus het valt vanzelf weg als deze functie
-- klaar is -- ook als hij halverwege klapt.

create or replace function public.mailing_vastleggen(
  bedrijf uuid,
  dag date,
  onderwerp_in text,
  tekst_in text,
  is_test boolean,
  kanaal_in text,
  sjabloon uuid,
  door uuid,
  -- Binnen zoveel seconden is het een dubbele druk op de knop en geen tweede
  -- ronde. Ruim genoeg voor twee mensen naast elkaar, kort genoeg om een
  -- bewuste tweede ronde ("toch") niet in de weg te zitten.
  binnen_seconden integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nieuw uuid;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf meegegeven.';
  end if;

  -- Een proef gaat alleen naar jezelf; daar valt niets dubbel te versturen.
  if not is_test then
    -- Twee getallen, want een advisory lock neemt geen tekst. hashtext kan
    -- botsen, maar dan wachten hooguit twee bedrijven heel even op elkaar.
    perform pg_advisory_xact_lock(hashtext(bedrijf::text), hashtext(coalesce(dag::text, '')));

    if exists (
      select 1
      from public.mailingen m
      where m.company_id = bedrijf
        and m.datum is not distinct from dag
        and m.test = false
        and m.kanaal = kanaal_in
        and m.created_at > now() - make_interval(secs => greatest(binnen_seconden, 0))
    ) then
      return null;
    end if;
  end if;

  insert into public.mailingen
    (company_id, datum, onderwerp, tekst, test, kanaal, sjabloon_id, verzonden_door)
  values
    (bedrijf, dag, onderwerp_in, tekst_in, is_test, kanaal_in, sjabloon, door)
  returning id into nieuw;

  return nieuw;
end
$$;

-- Alleen de server: `mail-versturen` roept hem aan met de service role en
-- heeft het bedrijf op dat moment al nagelopen.
revoke execute on function public.mailing_vastleggen(
  uuid, date, text, text, boolean, text, uuid, uuid, integer
) from public, anon, authenticated;

-- Het slot en de controle kijken naar bedrijf + dag; zonder deze index wordt
-- dat een scan over alle verzendingen van het bedrijf.
create index if not exists mailingen_dag_idx
  on public.mailingen (company_id, datum, created_at desc);
