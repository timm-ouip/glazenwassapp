-- Het slot op het vastleggen iets scherper.
--
-- De eerste versie hield elke verzending tegen die in de laatste 30 seconden
-- was vastgelegd. Dat blokkeert ook een terechte tweede poging: ging er net
-- een verzending helemaal mis (niets de deur uit), dan wil je meteen opnieuw
-- kunnen -- en dan stond er dertig seconden lang "iemand anders is net aan het
-- versturen" terwijl er niemand anders was.
--
-- Nu telt een poging waarbij alles mislukte niet meer mee, precies zoals de
-- uur-controle in mail-versturen dat al deed. En vijftien seconden is genoeg:
-- het gat dat we dichten zit tussen lezen en vastleggen, en dat is een
-- oogwenk, geen halve minuut.

create or replace function public.mailing_vastleggen(
  bedrijf uuid,
  dag date,
  onderwerp_in text,
  tekst_in text,
  is_test boolean,
  kanaal_in text,
  sjabloon uuid,
  door uuid,
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
        -- Alles mislukt betekent dat er niets de deur uit ging; dan mag je het
        -- meteen opnieuw proberen.
        and not (m.aantal = 0 and m.aantal_whatsapp = 0 and m.mislukt > 0)
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

revoke execute on function public.mailing_vastleggen(
  uuid, date, text, text, boolean, text, uuid, uuid, integer
) from public, anon, authenticated;
