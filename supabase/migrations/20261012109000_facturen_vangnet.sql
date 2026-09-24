-- Vangnetten bij de facturen.
--
-- Een adres op "overmaken" hoort een factuur op te leveren. Op drie manieren
-- gebeurt dat niet, en alle drie gebeuren ze stilzwijgend:
--
--   1. er hangt geen klant aan het adres (of die ligt in de prullenbak) --
--      `factuurregels_maken` doet een join op `klanten`, dus de regel ontstaat
--      gewoon niet;
--   2. de prijs is 0 -- daar staat `wp.prijs > 0` voor;
--   3. de klant heeft geen e-mailadres -- de regel en de factuur ontstaan wel,
--      maar het versturen strandt op "Deze klant heeft geen e-mailadres".
--
-- Je merkt er niets van: er staat gewoon geen factuur. Deze twee functies
-- maken dat zichtbaar -- één voor het overzicht in de facturentab, één voor de
-- waarschuwing als je een hele wijk op overmaken zet.

-- ---------------------------------------------------------------------
-- 1. Wat er nu misgaat
-- ---------------------------------------------------------------------
-- Eén rij per adres dat het laat afweten, met de reden erbij. Staat het
-- factureren nog uit (`factuur_start_op` leeg), dan komt er niets terug: dan
-- valt er ook niets te missen.
create or replace function public.facturen_vangnet()
returns table (
  soort text,
  customer_id uuid,
  klant_id uuid,
  adres text,
  wijk text,
  naam text
)
language sql
stable
security definer
set search_path = public
as $$
  with aan as (
    select c.id
    from public.companies c
    where c.id = public.current_company_id()
      and c.factuur_start_op is not null
      and public.heeft_recht('facturen')
  ),
  -- Elk levend adres dat overmaakt: zijn eigen keuze, anders die van de wijk.
  -- Een adres dat gestopt of verhuisd is, wordt niet meer gewassen en hoort
  -- hier dus niet te zeuren.
  overmaken as (
    select
      cu.id as customer_id,
      cu.klant_id,
      public.factuur_adres_tekst(cu.id) as adres,
      coalesce(d.name, '') as wijk,
      coalesce(ap.prijs, 0) as prijs
    from public.customers cu
    join aan on aan.id = cu.company_id
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    left join public.adres_prijzen ap on ap.customer_id = cu.id
    where cu.deleted_at is null
      and cu.inactief_op is null
      and coalesce(cu.betaalmethode, d.betaalmethode, 'contant') = 'overmaken'
  )
  select 'zonder_klant'::text, o.customer_id, null::uuid, o.adres, o.wijk, ''::text
  from overmaken o
  left join public.klanten k on k.id = o.klant_id and k.deleted_at is null
  where k.id is null

  union all
  -- Eén reden per adres, in deze volgorde: zonder klant valt er ook niets
  -- over een mailadres te zeggen, en zonder prijs komt de factuur er toch niet.
  select 'zonder_prijs'::text, o.customer_id, k.id, o.adres, o.wijk, k.naam
  from overmaken o
  join public.klanten k on k.id = o.klant_id and k.deleted_at is null
  where o.prijs <= 0

  union all
  select 'zonder_mail'::text, o.customer_id, k.id, o.adres, o.wijk, k.naam
  from overmaken o
  join public.klanten k on k.id = o.klant_id and k.deleted_at is null
  where o.prijs > 0
    and public.factuur_mailadres(k) = ''

  order by 5, 4
$$;

revoke execute on function public.facturen_vangnet() from public, anon;
grant execute on function public.facturen_vangnet() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Een hele wijk op overmaken
-- ---------------------------------------------------------------------
-- Eén klik zet soms honderden adressen om. Dit telt vooraf wat dat betekent:
-- hoeveel adressen er meegaan (alleen die geen eigen keuze hebben -- de rest
-- verandert niet), en hoeveel daarvan het stilzwijgend zouden laten afweten.
--
-- Dit kijkt niet naar `factuur_start_op`: ook met het factureren nog uit wil
-- je weten dat je driekwart van een wijk op een factuur zet waar geen adres
-- bij hoort.
create or replace function public.wijk_overmaken_telling(wijk uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'adressen', count(*),
    'zonder_klant', count(*) filter (where k.id is null),
    'zonder_prijs', count(*) filter (where k.id is not null and coalesce(ap.prijs, 0) <= 0),
    'zonder_mail', count(*) filter (
      where k.id is not null
        and coalesce(ap.prijs, 0) > 0
        and public.factuur_mailadres(k) = ''
    )
  )
  from public.customers cu
  join public.streets s on s.id = cu.street_id and s.deleted_at is null
  left join public.adres_prijzen ap on ap.customer_id = cu.id
  left join public.klanten k on k.id = cu.klant_id and k.deleted_at is null
  where cu.company_id = public.current_company_id()
    and s.district_id = wijk
    and cu.deleted_at is null
    and cu.inactief_op is null
    -- Alleen de adressen die de wijk volgen; wie het zelf ingesteld heeft,
    -- verandert niet mee.
    and cu.betaalmethode is null
$$;

revoke execute on function public.wijk_overmaken_telling(uuid) from public, anon;
grant execute on function public.wijk_overmaken_telling(uuid) to authenticated;
