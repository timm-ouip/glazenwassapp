-- Wat de nakijker ving op het slot rond het vastleggen.
--
-- Drie dingen, en het eerste maakte het slot half zo nuttig als bedoeld:
--
-- 1. Het keek of er net iets was vastgelegd via *exact hetzelfde* kanaal.
--    Stond de een op "zoals de klant het wil" en de ander op "mail", dan
--    telden die als twee verschillende verzendingen en gingen ze allebei door
--    -- precies de dubbele wijk die we wilden voorkomen. De uur-controle in
--    mail-versturen rekent al mét overlap ("mail" en "voorkeur" raken elkaar);
--    hier staat nu dezelfde regel.
-- 2. Het keek niet naar het soort bericht, dus een zojuist verstuurd
--    wijzigingsbericht kon de echte aankondiging voor diezelfde dag
--    tegenhouden.
-- 3. Het gold ook als iemand net bewust "toch nog een keer" had aangeklikt.
--    Hoe lang het slot duurt komt nu van de beller: kort als het een bewuste
--    tweede ronde is, en anders lang genoeg om twee mensen naast elkaar op te
--    vangen.
--
-- En het `grant` dat eronder hoort: elke vergelijkbare functie in dit project
-- geeft de serverrol uitdrukkelijk toestemming. Dat het waarschijnlijk ook
-- zonder werkt, is geen reden om het te laten staan -- als het net niet zo is,
-- gaat er geen enkele aankondiging meer de deur uit.

drop function if exists public.mailing_vastleggen(
  uuid, date, text, text, boolean, text, uuid, uuid, integer
);

create or replace function public.mailing_vastleggen(
  bedrijf uuid,
  dag date,
  onderwerp_in text,
  tekst_in text,
  is_test boolean,
  kanaal_in text,
  sjabloon uuid,
  door uuid,
  soort_in text default 'aankondiging',
  binnen_seconden integer default 15
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
  if not is_test and binnen_seconden > 0 then
    -- Twee getallen, want een advisory lock neemt geen tekst. hashtext kan
    -- botsen, maar dan wachten hooguit twee bedrijven heel even op elkaar.
    perform pg_advisory_xact_lock(hashtext(bedrijf::text), hashtext(coalesce(dag::text, '')));

    if exists (
      select 1
      from public.mailingen m
      where m.company_id = bedrijf
        and m.datum is not distinct from dag
        and m.test = false
        and m.soort = soort_in
        -- Dezelfde overlap als de uur-controle: "voorkeur" raakt zowel de
        -- mail- als de app-kant, dus die botst met allebei.
        and (
          (m.kanaal <> 'whatsapp' and kanaal_in <> 'whatsapp')
          or (m.kanaal <> 'mail' and kanaal_in <> 'mail')
        )
        and m.created_at > now() - make_interval(secs => binnen_seconden)
        -- Alles mislukt betekent dat er niets de deur uit ging; dan mag je het
        -- meteen opnieuw proberen.
        and not (m.aantal = 0 and m.aantal_whatsapp = 0 and m.mislukt > 0)
    ) then
      return null;
    end if;
  end if;

  insert into public.mailingen
    (company_id, datum, onderwerp, tekst, test, kanaal, soort, sjabloon_id, verzonden_door)
  values
    (bedrijf, dag, onderwerp_in, tekst_in, is_test, kanaal_in, soort_in, sjabloon, door)
  returning id into nieuw;

  return nieuw;
end
$$;

revoke execute on function public.mailing_vastleggen(
  uuid, date, text, text, boolean, text, uuid, uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.mailing_vastleggen(
  uuid, date, text, text, boolean, text, uuid, uuid, text, integer
) to service_role;
