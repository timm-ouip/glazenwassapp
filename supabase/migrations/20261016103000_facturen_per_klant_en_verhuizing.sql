-- 1. facturen_lijst kan ook de facturen van één klant geven (het dossier
--    vroeg eerst alle facturen op en filterde in de browser).
--    Een extra parameter met create or replace zou een tweede versie naast
--    de oude maken; daarom eerst de oude weg. De rechten zoals elders: niet
--    voor anon (eerst mocht iedereen hem aanroepen; de rechtencheck binnenin
--    hield het al tegen, maar zo hoort het).
-- 2. Verhuist een klant (stoppen met de reden verhuisd), dan wordt het
--    wijzigingslog van dat adres leeggemaakt: de nieuwe bewoner begint leeg.
--    Wat bij de klant zelf hoort (klant_id) blijft. Er komt één regel
--    "Verhuisd: geschiedenis leeggemaakt" (veld 'verhuisd', automatisch).
--    Wordt de verhuizing teruggedraaid (stoppen_terugdraaien), dan komt de
--    geschiedenis niet terug.

-- ---------------------------------------------------------------------
-- 1. Facturen per klant
-- ---------------------------------------------------------------------
drop function public.facturen_lijst(date, date);

create function public.facturen_lijst(vanaf date default null, tot date default null, klant uuid default null)
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
        'datum', coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date),
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
        and (klant is null or f.klant_id = klant)
        and (vanaf is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) >= vanaf)
        and (tot is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) <= tot)
    ) x
  ), '[]'::jsonb);
end
$$;

revoke execute on function public.facturen_lijst(date, date, uuid) from public, anon;
grant execute on function public.facturen_lijst(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Verhuisd: het log van het adres leeg
-- ---------------------------------------------------------------------
-- Security definer: niemand mag zelf uit `wijzigingen` verwijderen.
-- zet_adressen_inactief (security invoker) roept hem aan, dus hij moet voor
-- authenticated en de server aan te roepen zijn. Daarom doet hij alleen iets
-- met adressen die in DEZELFDE transactie op verhuisd zijn gezet
-- (inactief_op = now()): dat kan alleen via zet_adressen_inactief, dat met de
-- rechten van de aanroeper (de regels op customers) heeft gecontroleerd dat
-- hij die adressen mocht laten stoppen. Los aanroepen doet dus niets.
create or replace function public.verhuizing_log_legen(adressen uuid[], voor_bedrijf uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  verhuisd uuid[];
  weg integer;
begin
  if bedrijf is null then
    return 0;
  end if;

  select coalesce(array_agg(c.id), '{}') into verhuisd
  from public.customers c
  where c.company_id = bedrijf
    and c.id = any(adressen)
    and c.deleted_at is null
    and c.inactief_reden = 'verhuisd'
    and c.inactief_op = now();
  if cardinality(verhuisd) = 0 then
    return 0;
  end if;

  delete from public.wijzigingen w
  where w.company_id = bedrijf
    and w.customer_id = any(verhuisd)
    and w.op <= now();
  get diagnostics weg = row_count;

  insert into public.wijzigingen (company_id, tabel, rij_id, customer_id, veld, door, door_naam, bron)
  select bedrijf, 'customers', a, a, 'verhuisd', auth.uid(), coalesce(public.geld_mijn_naam(), ''), 'systeem'
  from unnest(verhuisd) as a;

  return weg;
end
$$;
revoke execute on function public.verhuizing_log_legen(uuid[], uuid) from public, anon;
grant execute on function public.verhuizing_log_legen(uuid[], uuid) to authenticated, service_role;

-- Gelijk aan 20261016090000_vooruit_betalen.sql, met het leegmaken erbij.
create or replace function public.zet_adressen_inactief(
  adressen uuid[],
  reden text,
  planning_weg boolean,
  voor_bedrijf uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- De server mag altijd; een gebruiker alleen met het recht.
  prijzen_zichtbaar boolean := auth.role() = 'service_role' or public.heeft_recht('prijzen_zien');
  nu timestamptz := now();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  gezet uuid[] := '{}';
  klanten_weg uuid[] := '{}';
  planning jsonb := '[]'::jsonb;
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if reden is null or reden not in ('verhuisd', 'gestopt') then
    raise exception 'Onbekende reden.';
  end if;

  with u as (
    update public.customers
    set inactief_op = nu, inactief_reden = reden
    where company_id = bedrijf
      and id = any(adressen)
      and deleted_at is null
      and inactief_op is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into gezet from u;

  if planning_weg and cardinality(gezet) > 0 then
    -- Eerst vastleggen wat er weggaat (met de prijs, als je die mag zien):
    -- de prijsregel verdwijnt mee met de dagregel.
    select coalesce(jsonb_agg(
      jsonb_build_object('datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'ronde', r.ronde)
      || case when prijzen_zichtbaar
              then jsonb_build_object('prijs', coalesce(wp.prijs, 0), 'normaal', wp.normaal)
              else '{}'::jsonb end
    ), '[]'::jsonb)
    into planning
    from public.wasdag_regels r
    left join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.company_id = bedrijf
      and r.customer_id = any(gezet)
      -- Vandaag blijft staan: dat werk kan vanochtend al gedaan zijn.
      and r.datum > vandaag;

    delete from public.wasdag_regels
    where company_id = bedrijf
      and customer_id = any(gezet)
      and datum > vandaag;
  end if;

  -- Bij een verhuizing gaan de klantgegevens weg, maar alleen als de klant
  -- geen ander adres heeft dat actief is of op "gestopt" staat.
  if reden = 'verhuisd' and cardinality(gezet) > 0 then
    with k as (
      update public.klanten kl
      set deleted_at = nu
      where kl.company_id = bedrijf
        and kl.deleted_at is null
        and kl.id in (
          select c.klant_id from public.customers c
          where c.id = any(gezet) and c.klant_id is not null
        )
        and not exists (
          select 1 from public.customers c
          where c.klant_id = kl.id
            and c.deleted_at is null
            and (c.inactief_op is null or c.inactief_reden = 'gestopt')
        )
      returning kl.id
    )
    select coalesce(array_agg(id), '{}') into klanten_weg from k;
  end if;

  -- Bij een verhuizing begint de nieuwe bewoner met een lege geschiedenis.
  if reden = 'verhuisd' and cardinality(gezet) > 0 then
    perform public.verhuizing_log_legen(gezet, bedrijf);
  end if;

  return jsonb_build_object(
    'adressen', to_jsonb(gezet),
    'klanten', to_jsonb(klanten_weg),
    'planning', planning,
    'inactief_op', nu
  );
end
$$;

revoke execute on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) from public, anon;
grant execute on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) to authenticated, service_role;
