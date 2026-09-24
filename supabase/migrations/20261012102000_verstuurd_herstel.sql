-- Herstel van een fout in de vorige migratie.
--
-- Daar zette `factuur_verstuurd` ook `betaald_bedrag`, met een `case` die bij
-- een gewone factuur leeg opleverde. Maar de kolom is `not null` én heeft
-- `check (betaald_bedrag >= 0)`:
--
--   * bij een gewone factuur was het een leeg-verbod: het versturen van élke
--     factuur zou zijn geklapt;
--   * bij een creditnota is het totaal negatief (-18,15), dus dat zou op de
--     check zijn gesneuveld.
--
-- Het veld hoeft er ook niet bij. "Verwerkt" zit in de stand, en het
-- openstaande bedrag wordt gerekend als `totaal - betaald`, nooit onder nul.
-- Voor een creditnota is dat totaal negatief, dus die staat vanzelf op nul
-- open. `betaald_bedrag` blijft dus gewoon 0.
create or replace function public.factuur_verstuurd(factuur uuid, via text, naar text, pdf text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  soort_ text;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen versturen.';
  end if;

  select f.soort into soort_ from public.facturen f
    where f.id = factuur and f.company_id = bedrijf;

  update public.facturen
    set status = case when soort_ = 'credit' then 'betaald' else 'verstuurd' end,
        -- Een creditnota is bij het versturen verwerkt: hij boekt een factuur
        -- tegen die al op 'gecrediteerd' staat. Die twee gaan samen van de
        -- lijst af, nooit de een zonder de ander.
        betaald_op = case when soort_ = 'credit' then vandaag else betaald_op end,
        verstuurd_op = now(),
        verstuurd_via = via, verstuurd_naar = coalesce(naar, ''), pdf_pad = coalesce(pdf, pdf_pad)
    where id = factuur and company_id = bedrijf and nummer is not null and status = 'concept';
  if not found then
    raise exception 'Deze factuur staat niet klaar om verstuurd te worden.';
  end if;
end
$$;
