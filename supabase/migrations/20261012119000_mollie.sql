-- Fase 3 van de facturen: betalen via een Mollie-betaallink.
--
-- De factuur gaat al de deur uit met een IBAN en een betaalkenmerk; wie wil
-- kan overmaken en jij vinkt het met de hand af. Dat blijft allemaal staan.
-- Hier komt een tweede weg bij: een knop in de mail waarmee de klant met iDEAL
-- betaalt, en een melding van Mollie die de factuur vanzelf afvinkt.
--
-- Bewust een **betaallink** (Payment Links API) en geen gewone betaling: een
-- gewone Mollie-betaling verloopt na een kwartier, en dat is precies verkeerd
-- voor een factuur die veertien dagen open staat. Een betaallink verloopt niet.

-- ---------------------------------------------------------------------
-- 1. De sleutel
-- ---------------------------------------------------------------------
-- Zichtbaar op `companies`: dát er gekoppeld is, en of het de test- of de
-- echte sleutel is. De sleutel zelf niet -- die gaat versleuteld in een eigen
-- tabel waar alleen de server bij kan, precies zoals `mailbox_geheimen`.

alter table public.companies
  add column mollie_modus text check (mollie_modus in ('test', 'live'));

comment on column public.companies.mollie_modus is
  'test of live zodra er een Mollie-sleutel staat; leeg is niet gekoppeld.';

create table public.mollie_geheimen (
  company_id uuid primary key references public.companies(id) on delete cascade,
  versleuteld text not null,
  iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.mollie_geheimen enable row level security;
revoke all on public.mollie_geheimen from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Wat er via Mollie binnenkwam
-- ---------------------------------------------------------------------
-- Apart van `betaald_bedrag`, en dat is de hele truc. Een klant kan de helft
-- overmaken (door jou met de hand afgevinkt) en de rest via de link betalen.
-- Zonder dit vak zou de melding van Mollie het met de hand afgevinkte deel
-- overschrijven -- of, als we zouden optellen, zou een tweede melding over
-- dezelfde betaling het bedrag verdubbelen.

alter table public.facturen
  add column mollie_betaald numeric(10, 2) not null default 0
    check (mollie_betaald >= 0);

comment on column public.facturen.mollie_betaald is
  'Het deel van betaald_bedrag dat via de Mollie-betaallink binnenkwam.';

-- ---------------------------------------------------------------------
-- 3. Afvinken zonder gebruiker
-- ---------------------------------------------------------------------
-- `factuur_betaald` eist een ingelogde medewerker met het recht `facturen`.
-- De melding van Mollie heeft geen gebruiker, dus die kan daar niet langs.
-- Deze functie is het tegenstuk: alleen voor de server, met het volledige
-- bedrag dat bij Mollie binnenstaat (niet een bijtelling), zodat twee
-- meldingen over dezelfde betaling hetzelfde resultaat geven.

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

  update public.facturen
    set mollie_betaald = round(greatest(bij_mollie, 0), 2),
        betaald_bedrag = nieuw,
        betaald_op = case
                       when nieuw >= totaal
                       then coalesce(op, (now() at time zone 'Europe/Amsterdam')::date)
                       else null
                     end,
        status = case
                   when f.status = 'gecrediteerd' then 'gecrediteerd'
                   when nieuw >= totaal then 'betaald'
                   else 'verstuurd'
                 end
    where id = factuur;

  return jsonb_build_object('betaald', nieuw, 'totaal', totaal, 'open', round(totaal - nieuw, 2));
end
$$;

-- Alleen de server. Een ingelogde medewerker vinkt af met `factuur_betaald`,
-- en die kijkt wél naar het bedrijf en het recht.
revoke execute on function public.factuur_mollie_betaald(uuid, numeric, date)
  from public, anon, authenticated;
