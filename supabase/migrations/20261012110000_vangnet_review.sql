-- Wat de review op de vangnetten ving.
--
-- 1. "Geen prijs" keek alleen naar de basisprijs. De prijs van een beurt is de
--    basisprijs plus de meerprijs van het maandwerk van die maand (zie
--    `wasdag_prijs_aanmaken`). Een adres met basisprijs 0 dat alleen in oktober
--    de serre doet, krijgt dus gewoon een factuurregel -- en stond hier het
--    hele jaar als alarm dat je niet kon oplossen.
-- 2. Een extra opdracht zonder prijs levert net zo goed niets op
--    (`klus_factuurregel_bijhouden` slaat hem over), en zat er niet in.
-- 3. De twee functies telden net anders: de ene koppelde hard aan `streets`,
--    de andere los. Nu allebei hetzelfde, en een adres in een weggegooide
--    straat of wijk telt nergens mee -- net als in de rest van de app.
-- 4. Bij de koppeling met `adres_prijzen` en `klanten` stond geen `company_id`.
--    Deze functies gaan langs de RLS heen, dus dat is hier de enige rem.
-- 5. De wijktelling kon door elke ingelogde medewerker opgevraagd worden.
--    Alleen de eigenaar mag de betaalmethode van een wijk veranderen, dus
--    alleen de eigenaar hoeft te horen wat dat gaat betekenen.

-- ---------------------------------------------------------------------
-- Kan er ooit een bedrag uit dit adres komen?
-- ---------------------------------------------------------------------
-- Vooruitkijkend, niet voor één dag: de basisprijs, of anders een meerprijs
-- voor maandwerk die ergens boven nul staat. Zo blijft een adres dat alleen
-- in oktober iets kost buiten de lijst.
create or replace function public.adres_heeft_prijs(adres uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(ap.prijs, 0) > 0
      or exists (
           select 1
           from jsonb_each_text(coalesce(ap.maandwerk_extra, '{}'::jsonb)) as e(sleutel, waarde)
           -- De sleutels zijn van de gebruiker; een waarde die geen getal is,
           -- mag hier geen fout geven.
           where e.waarde ~ '^-?[0-9]+(\.[0-9]+)?$'
             and e.waarde::numeric > 0
         )
  from public.adres_prijzen ap
  where ap.customer_id = adres
$$;

revoke execute on function public.adres_heeft_prijs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- De lijst, opnieuw
-- ---------------------------------------------------------------------
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
  -- Een adres dat gestopt of verhuisd is, wordt niet meer gewassen; een adres
  -- in een weggegooide straat of wijk is uit de app verdwenen.
  overmaken as (
    select
      cu.id as customer_id,
      cu.klant_id,
      cu.company_id,
      public.factuur_adres_tekst(cu.id) as adres,
      d.name as wijk,
      coalesce(public.adres_heeft_prijs(cu.id), false) as heeft_prijs
    from public.customers cu
    join aan on aan.id = cu.company_id
    join public.streets s on s.id = cu.street_id and s.deleted_at is null
    join public.districts d on d.id = s.district_id and d.deleted_at is null
    where cu.deleted_at is null
      and cu.inactief_op is null
      and coalesce(cu.betaalmethode, d.betaalmethode, 'contant') = 'overmaken'
  ),
  -- De klant erbij, één keer, zodat elke tak hem niet apart hoeft te zoeken.
  met_klant as (
    select o.*, k.id as levende_klant, k.naam as klantnaam, public.factuur_mailadres(k) as mail
    from overmaken o
    left join public.klanten k
      on k.id = o.klant_id and k.company_id = o.company_id and k.deleted_at is null
  )
  select 'zonder_klant'::text, m.customer_id, null::uuid, m.adres, m.wijk, ''::text
  from met_klant m
  where m.levende_klant is null

  union all
  -- Eén reden per adres, in deze volgorde: zonder klant valt er ook niets over
  -- een prijs of een mailadres te zeggen.
  select 'zonder_prijs'::text, m.customer_id, m.levende_klant, m.adres, m.wijk, m.klantnaam
  from met_klant m
  where m.levende_klant is not null
    and not m.heeft_prijs

  union all
  select 'zonder_mail'::text, m.customer_id, m.levende_klant, m.adres, m.wijk, m.klantnaam
  from met_klant m
  where m.levende_klant is not null
    and m.heeft_prijs
    and m.mail = ''

  union all
  -- Extra opdrachten die nog open staan zonder prijs. Eén regel per adres:
  -- staan er twee, dan ga je toch naar hetzelfde adres kijken.
  select distinct 'zonder_klusprijs'::text, m.customer_id, m.levende_klant, m.adres, m.wijk,
         m.klantnaam
  from met_klant m
  join public.klussen kl
    on kl.customer_id = m.customer_id
   and kl.company_id = m.company_id
   and kl.deleted_at is null
   and kl.gedaan_op is null
  left join public.klus_prijzen kp on kp.klus_id = kl.id and kp.company_id = kl.company_id
  where m.levende_klant is not null
    and coalesce(kp.prijs, 0) <= 0

  order by 5, 4
$$;

revoke execute on function public.facturen_vangnet() from public, anon;
grant execute on function public.facturen_vangnet() to authenticated;

-- ---------------------------------------------------------------------
-- De wijktelling, opnieuw
-- ---------------------------------------------------------------------
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
    'zonder_prijs', count(*) filter (
      where k.id is not null and not coalesce(public.adres_heeft_prijs(cu.id), false)
    ),
    'zonder_mail', count(*) filter (
      where k.id is not null
        and coalesce(public.adres_heeft_prijs(cu.id), false)
        and public.factuur_mailadres(k) = ''
    )
  )
  from public.customers cu
  join public.streets s on s.id = cu.street_id and s.deleted_at is null
  join public.districts d on d.id = s.district_id and d.deleted_at is null
  left join public.klanten k
    on k.id = cu.klant_id and k.company_id = cu.company_id and k.deleted_at is null
  where cu.company_id = public.current_company_id()
    and public.is_eigenaar()
    and s.district_id = wijk
    and cu.deleted_at is null
    and cu.inactief_op is null
    -- Alleen de adressen die de wijk volgen; wie het zelf ingesteld heeft,
    -- verandert niet mee.
    and cu.betaalmethode is null
$$;

revoke execute on function public.wijk_overmaken_telling(uuid) from public, anon;
grant execute on function public.wijk_overmaken_telling(uuid) to authenticated;
