-- Wat de review op het laatste stuk van fase 1 ving.
--
-- 1. Een afgevinkte klus die je achteraf op het juiste adres zet, hield zijn
--    factuurregel bij de vórige klant -- met de nieuwe omschrijving en het
--    nieuwe bedrag erop.
-- 2. Verdween de laatste regel van een concept (klus weggegooid, prijs op nul),
--    dan bleef er een concept van € 0,00 staan dat je niet kunt versturen en
--    dat wel meetelt in de por.
-- 3. De koppeling met de klant miste `company_id`. Deze functie gaat langs de
--    RLS heen, dus dat is daar de enige rem.
-- 4. Een bedrag dat je met de hand koos bij "opnieuw factureren" na een
--    creditnota, sprong terug naar de volle prijs zodra iemand de klus nog
--    aanraakte.
-- 5. Een concept heeft geen datum in de lijst, dus de por kon alleen naar de
--    dag van de maand kijken.

-- ---------------------------------------------------------------------
-- 1. Een bedrag dat met de hand gekozen is, blijft staan
-- ---------------------------------------------------------------------
alter table public.factuurregels
  add column if not exists bedrag_met_de_hand boolean not null default false;

comment on column public.factuurregels.bedrag_met_de_hand is
  'Gezet door factuur_opnieuw: het bedrag komt uit een bewuste keuze na een creditnota, dus de prijs van de klus of de beurt overschrijft het niet meer.';

-- `factuur_opnieuw` maakt een nieuwe regel met het bedrag dat iemand per pand
-- koos. Verder gelijk aan de versie van 20261012105000.
create or replace function public.factuur_opnieuw(factuur uuid, keuzes jsonb default '[]'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  f public.facturen;
  gemaakt integer := 0;
begin
  if bedrijf is null or not public.heeft_recht('facturen') then
    raise exception 'Je rol mag geen facturen maken.';
  end if;

  select * into f from public.facturen
    where id = factuur and company_id = bedrijf for update;
  if not found then
    raise exception 'Die factuur bestaat niet.';
  end if;
  if f.status <> 'gecrediteerd' then
    raise exception 'Alleen werk van een gecrediteerde factuur kun je opnieuw factureren.';
  end if;

  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort,
    wasdag_regel_id, klus_id, datum,
    omschrijving, notitie, bedrag, btw_inclusief, btw_procent, bedrag_excl,
    bedrag_met_de_hand
  )
  select fr.company_id, fr.klant_id, fr.customer_id, fr.soort,
         fr.wasdag_regel_id, fr.klus_id, fr.datum,
         fr.omschrijving, fr.notitie,
         k.bedrag,
         fr.btw_inclusief, fr.btw_procent,
         public.factuur_excl(k.bedrag, fr.btw_inclusief, fr.btw_procent),
         true
    from (
      select distinct on (g.id) g.id, g.bedrag
        from jsonb_to_recordset(coalesce(keuzes, '[]'::jsonb)) as g(id uuid, bedrag numeric)
       where g.id is not null
       order by g.id, g.ordinality desc
    ) gekozen
    join public.factuurregels fr on fr.id = gekozen.id
    cross join lateral (
      select case when gekozen.bedrag is null or gekozen.bedrag <= 0
                  then fr.bedrag else round(gekozen.bedrag, 2) end as bedrag
    ) k
    join public.klanten kl on kl.id = fr.klant_id and kl.deleted_at is null
    left join public.customers cu on cu.id = fr.customer_id
    where fr.factuur_id = factuur and fr.company_id = bedrijf
      and fr.deleted_at is null
      and (fr.customer_id is null or cu.deleted_at is null)
      and not exists (
        select 1 from public.factuurregels x
        where x.deleted_at is null and x.vervangen_op is null
          and ((fr.wasdag_regel_id is not null and x.wasdag_regel_id = fr.wasdag_regel_id)
            or (fr.klus_id is not null and x.klus_id = fr.klus_id))
      );
  get diagnostics gemaakt = row_count;
  return gemaakt;
end
$$;
revoke execute on function public.factuur_opnieuw(uuid, jsonb) from public, anon;
grant execute on function public.factuur_opnieuw(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Lege concepten opruimen
-- ---------------------------------------------------------------------
-- Verdwijnt de laatste regel van een concept, dan hoort het concept ook weg.
-- Dezelfde stap als in `factuurregels_terug` en `factuur_opnieuw`; hier als
-- eigen functie, zodat de triggers hem ook kunnen doen.
create or replace function public.lege_concepten_opruimen(bedrijf uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.facturen f
    where f.company_id = bedrijf
      and f.nummer is null
      and not exists (select 1 from public.factuurregels fr where fr.factuur_id = f.id);
$$;

revoke execute on function public.lege_concepten_opruimen(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. De regel van een klus, met alle vier de reparaties
-- ---------------------------------------------------------------------
create or replace function public.klus_factuurregel_bijwerken(kl_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kl public.klussen;
  start_op date;
  methode text;
  k public.klanten;
  prijs numeric;
  tekst text;
  hoort boolean := false;
begin
  select * into kl from public.klussen where id = kl_id;
  if not found then
    return;
  end if;

  if kl.gedaan_op is not null and kl.deleted_at is null then
    select c.factuur_start_op into start_op from public.companies c where c.id = kl.company_id;
    if start_op is not null and kl.gedaan_op >= start_op then
      select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') into methode
        from public.customers cu
        left join public.streets s on s.id = cu.street_id
        left join public.districts d on d.id = s.district_id
        where cu.id = kl.customer_id and cu.deleted_at is null;
      if methode = 'overmaken' then
        -- Met `company_id` erbij: deze functie gaat langs de RLS heen, dus dat
        -- is hier de enige rem.
        select kla.* into k
          from public.klanten kla
          join public.customers cu on cu.klant_id = kla.id
          where cu.id = kl.customer_id
            and kla.company_id = kl.company_id
            and kla.deleted_at is null;
        if found then
          select kp.prijs into prijs from public.klus_prijzen kp where kp.klus_id = kl.id;
          hoort := coalesce(prijs, 0) > 0;
        end if;
      end if;
    end if;
  end if;

  if not hoort then
    delete from public.factuurregels fr
      where fr.klus_id = kl_id
        and fr.vervangen_op is null
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f
                         where f.id = fr.factuur_id and f.nummer is null));
    perform public.lege_concepten_opruimen(kl.company_id);
    return;
  end if;

  tekst := coalesce(nullif(btrim(kl.omschrijving), ''), 'Extra opdracht');

  -- Verhuisd naar een ander adres? Dan hoort de regel bij een andere klant, en
  -- die kan niet op het concept van de vorige blijven staan. Weg ermee; hij
  -- ontstaat hieronder opnieuw bij de juiste klant.
  delete from public.factuurregels fr
    where fr.klus_id = kl_id
      and fr.deleted_at is null
      and fr.vervangen_op is null
      and (fr.klant_id <> k.id or fr.customer_id is distinct from kl.customer_id)
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));
  if found then
    perform public.lege_concepten_opruimen(kl.company_id);
  end if;

  -- Staat hij er al: bijwerken. Het btw-tarief van de regel zelf blijft staan,
  -- zodat een latere tariefwijziging een oude regel niet verandert. Een bedrag
  -- dat met de hand gekozen is bij "opnieuw factureren" blijft ook staan.
  update public.factuurregels fr
    set datum = kl.gedaan_op,
        omschrijving = tekst,
        bedrag = prijs,
        bedrag_excl = public.factuur_excl(prijs, fr.btw_inclusief, fr.btw_procent)
    where fr.klus_id = kl_id
      and fr.deleted_at is null
      and fr.vervangen_op is null
      and not fr.bedrag_met_de_hand
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));

  -- Anders een nieuwe. De `not exists` blijft nodig: staat er een regel op een
  -- genummerde factuur of met een eigen bedrag, dan raakte de update hierboven
  -- niets en zou een insert op de ontdubbelindex klappen.
  insert into public.factuurregels (
    company_id, klant_id, customer_id, soort, klus_id, datum,
    omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl
  )
  select
    kl.company_id, k.id, kl.customer_id, 'klus', kl.id, kl.gedaan_op,
    tekst,
    prijs,
    public.factuur_btw_inclusief(k),
    public.factuur_btw_procent(k),
    public.factuur_excl(prijs, public.factuur_btw_inclusief(k), public.factuur_btw_procent(k))
  where not exists (
    select 1 from public.factuurregels fr
    where fr.klus_id = kl_id and fr.deleted_at is null and fr.vervangen_op is null
  );
end
$$;

revoke execute on function public.klus_factuurregel_bijwerken(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Hetzelfde voor "prijs deze dag"
-- ---------------------------------------------------------------------
create or replace function public.wasdag_prijs_factuurregel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dag date;
begin
  if tg_op = 'UPDATE' and new.prijs is not distinct from old.prijs then
    return null;
  end if;

  if new.prijs > 0 then
    update public.factuurregels fr
      set bedrag = new.prijs,
          bedrag_excl = public.factuur_excl(new.prijs, fr.btw_inclusief, fr.btw_procent)
      where fr.wasdag_regel_id = new.regel_id
        and fr.deleted_at is null
        and fr.vervangen_op is null
        and not fr.bedrag_met_de_hand
        and (fr.factuur_id is null
             or exists (select 1 from public.facturen f
                         where f.id = fr.factuur_id and f.nummer is null));
    if found then
      return null;
    end if;

    -- Nog geen regel: de beurt was gratis toen de dag werd afgemeld, en krijgt
    -- nu alsnog een prijs. `factuurregels_maken` kijkt zelf of de hele dag af
    -- is en slaat over wat er al staat, dus dit mag gewoon opnieuw.
    select r.datum into dag from public.wasdag_regels r where r.id = new.regel_id;
    if dag is not null and public.current_company_id() = new.company_id then
      perform public.factuurregels_maken(dag);
    end if;
    return null;
  end if;

  delete from public.factuurregels fr
    where fr.wasdag_regel_id = new.regel_id
      and fr.vervangen_op is null
      and (fr.factuur_id is null
           or exists (select 1 from public.facturen f
                       where f.id = fr.factuur_id and f.nummer is null));
  perform public.lege_concepten_opruimen(new.company_id);
  return null;
end
$$;

-- ---------------------------------------------------------------------
-- 5. Een datum bij elk concept
-- ---------------------------------------------------------------------
-- Zonder datum kon de por alleen naar de dag van de maand kijken: een concept
-- van vanmiddag las dan als "staat al te wachten", en twintig concepten van
-- vorige maand zeiden op de 3e niets. `sorteer` stond er al; die komt nu ook
-- als `datum` mee naar buiten.
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
        and (vanaf is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) >= vanaf)
        and (tot is null or coalesce(f.factuurdatum, (f.created_at at time zone 'Europe/Amsterdam')::date) <= tot)
    ) x
  ), '[]'::jsonb);
end
$$;
