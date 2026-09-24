-- Wat de nakijker ving op de Mollie-melding.
--
-- Een factuur kan met een nummer én op "concept" staan: de mail ging weg, maar
-- het afmelden erna mislukte. De klant heeft dan wel de betaalknop. Betaalt
-- hij, dan zette de melding hem op "verstuurd" of "betaald" -- zonder
-- verzenddatum, en daarna liep een nieuwe verstuurpoging vast op "deze factuur
-- staat niet klaar", nadat de klant al een tweede mail had gekregen.
--
-- De melding gaat over geld, niet over verzenden. Vanaf nu laat hij de status
-- met rust zolang die nog op "concept" staat; het bedrag wordt wel bewaard,
-- zodat het zichtbaar is zodra het versturen alsnog goed afloopt.

create or replace function public.factuur_mollie_betaald(
  factuur uuid,
  bij_mollie numeric,
  op date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.facturen;
  totaal numeric;
  handmatig numeric;
  nieuw numeric;
  af boolean;
begin
  select * into f from public.facturen where id = factuur;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.nummer is null then
    raise exception 'Een concept kan nog niet betaald zijn.';
  end if;

  totaal := (public.factuur_totalen(factuur) ->> 'incl')::numeric;
  -- Wat er met de hand is afgevinkt, blijft staan.
  handmatig := greatest(coalesce(f.betaald_bedrag, 0) - coalesce(f.mollie_betaald, 0), 0);
  nieuw := round(handmatig + greatest(bij_mollie, 0), 2);
  af := nieuw >= totaal;

  update public.facturen
    set mollie_betaald = round(greatest(bij_mollie, 0), 2),
        betaald_bedrag = nieuw,
        betaald_op = case
                       when af and f.status <> 'concept'
                       then coalesce(op, (now() at time zone 'Europe/Amsterdam')::date)
                       else null
                     end,
        status = case
                   -- Nog niet verstuurd: dan zegt deze melding niets over de
                   -- status. Het bedrag staat er wel, en zodra het versturen
                   -- alsnog lukt klopt het beeld vanzelf.
                   when f.status = 'concept' then 'concept'
                   when f.status = 'gecrediteerd' then 'gecrediteerd'
                   when af then 'betaald'
                   else 'verstuurd'
                 end
    where id = factuur;

  return jsonb_build_object('betaald', nieuw, 'totaal', totaal, 'open', round(totaal - nieuw, 2));
end
$$;

revoke execute on function public.factuur_mollie_betaald(uuid, numeric, date)
  from public, anon, authenticated;
