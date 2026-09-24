-- Een creditnota en de factuur die hij tegenboekt zijn altijd samen verwerkt.
--
-- Afspraak met Timmie: er mag nooit een creditnota als verwerkt staan terwijl
-- de originele factuur nog openstaat. Die twee horen bij elkaar en netten
-- tegen elkaar uit.
--
-- Hoe het liep vóór deze migratie:
--
--   * De originele factuur gaat bij het crediteren meteen op 'gecrediteerd',
--     dus die valt goed uit het openstaande bedrag. Dat klopte al.
--   * De creditnota zelf werd na het versturen een gewone 'verstuurd'-factuur
--     mét een vervaldatum. Daardoor kwam hij na die datum in "Te laat" te
--     staan -- alsof je een negatief bedrag van de klant moet innen. En hij
--     bleef daar staan, want crediteren kan bij een creditnota niet.
--
-- Nu: bij het versturen van een creditnota is hij daarmee verwerkt. Er valt
-- niets te innen; hij is de tegenboeking van een factuur die al op
-- 'gecrediteerd' staat. Die twee gaan dus in één beweging van de lijst af.
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
        -- Een creditnota staat bij het versturen meteen verwerkt: hij netto
        -- tegen een factuur die al op 'gecrediteerd' staat.
        betaald_bedrag = case when soort_ = 'credit' then public.factuur_totalen(factuur)->>'incl' end::numeric,
        betaald_op = case when soort_ = 'credit' then vandaag end,
        verstuurd_op = now(),
        verstuurd_via = via, verstuurd_naar = coalesce(naar, ''), pdf_pad = coalesce(pdf, pdf_pad)
    where id = factuur and company_id = bedrijf and nummer is not null and status = 'concept';
  if not found then
    raise exception 'Deze factuur staat niet klaar om verstuurd te worden.';
  end if;
end
$$;

-- En voor de zekerheid ook aan de leeskant: een creditnota is nooit "te laat",
-- wat er ook in de stand staat. Je int er niets op.
create or replace function public.facturen_lijst(vanaf date default null, tot date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag de facturen niet zien.';
  end if;
  return coalesce((
    select jsonb_agg(x.regel order by x.sorteer desc nulls first)
    from (
      select jsonb_build_object(
        'id', f.id,
        'nummer', f.nummer,
        'soort', f.soort,
        'status', f.status,
        'klant_id', f.klant_id,
        'klant', coalesce(nullif(btrim(f.klantgegevens->>'bedrijfsnaam'), ''),
                          nullif(btrim(f.klantgegevens->>'naam'), ''),
                          nullif(btrim(k.bedrijfsnaam), ''), k.naam),
        'klanttype', coalesce(nullif(btrim(f.klantgegevens->>'klanttype'), ''), k.klanttype),
        'mail', coalesce(nullif(btrim(f.klantgegevens->>'email'), ''), public.factuur_mailadres(k)),
        'factuurdatum', f.factuurdatum,
        'vervaldatum', f.vervaldatum,
        'te_laat', f.soort <> 'credit'
                   and f.nummer is not null and f.status = 'verstuurd'
                   and f.vervaldatum < vandaag
                   and (f.met_rust_tot is null or f.met_rust_tot < vandaag),
        'met_rust_tot', f.met_rust_tot,
        'herinnering_trap', f.herinnering_trap,
        'betaald_bedrag', f.betaald_bedrag,
        'verstuurd_op', f.verstuurd_op,
        'verstuurd_via', f.verstuurd_via,
        'mollie_link', f.mollie_link,
        'totalen', public.factuur_totalen(f.id)
      ) as regel,
      coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) as sorteer
      from public.facturen f
      join public.klanten k on k.id = f.klant_id
      where f.company_id = bedrijf and f.deleted_at is null
        and (vanaf is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) >= vanaf)
        and (tot is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) <= tot)
    ) x
  ), '[]'::jsonb);
end
$$;
