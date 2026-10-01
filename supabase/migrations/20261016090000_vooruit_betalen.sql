-- Contant vooruitbetalen.
--
-- Een klant betaalt aan de deur (of op kantoor) een aantal beurten vooruit,
-- tegen een vaste prijs per beurt die op dat moment geldt: wat hij normaal
-- per beurt betaalt (de basisprijs min een vaste korting). Die beurten maakt
-- hij daarna één voor één op, oudste open beurt eerst.
--
-- Hoe het rekent (alles wordt elke keer opnieuw uitgerekend, niets wordt
-- overschreven):
--   * Een vooruit-beurt dekt de gewone beurt van die dag (`normaal`, de
--     adresprijs toen de dag werd ingepland). Wordt de prijs later hoger, dan
--     is de beurt toch helemaal betaald: dat hebben we zo afgesproken.
--   * Kost een beurt meer dan normaal (serre, maandwerk), dan staat alleen
--     dat verschil open, als gewone pof.
--   * Kost hij minder dan wat er vooruit per beurt betaald is (alleen de
--     voorkant, of de prijs ging omlaag), dan wordt het verschil tegoed.
--   * Klussen en de beginstand van de papieren kaart gebruiken nooit een
--     vooruit-beurt.
--   * Stopt een klant, of komt er een nieuwe bewoner, dan worden zijn
--     beurten niet meer opgemaakt. Wat over is geeft de eigenaar terug; dat
--     legt hij vast met "terugbetaald".
--   * Wil een adres naar overmaken terwijl er nog beurten vooruit betaald
--     zijn, dan wordt de wissel gepland: hij gaat pas door als de laatste
--     beurt op is. Een beurt die met vooruit betaald is krijgt zo nooit ook
--     nog een factuurregel.

-- ---------------------------------------------------------------------
-- 1. Het logboek: twee nieuwe soorten
-- ---------------------------------------------------------------------
alter table public.betaal_gebeurtenissen drop constraint betaal_gebeurtenissen_soort_check;
alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_soort_check check (soort in (
  'beginstand', 'betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan', 'vooruit', 'terugbetaald'
));

alter table public.betaal_gebeurtenissen
  -- Wat één vooruitbetaalde beurt kostte, op het moment van betalen.
  add column prijs_per_beurt numeric(10, 2),
  -- Vanaf welke wasbeurt de vooruitbetaling geldt: de oudste die toen nog
  -- open stond, of anders de eerstvolgende.
  add column vanaf date,
  -- Voor wie er betaald is. Komt er een nieuwe bewoner, dan gebruikt die
  -- deze beurten niet.
  add column klant_id uuid,
  -- Rekende de telefoon met een andere prijs dan de database nu zou doen,
  -- dan staat hier wat de database verwachtte (zodat de eigenaar het ziet).
  add column prijs_verwacht numeric(10, 2);

alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_vooruit_check check (
  soort <> 'vooruit' or (
    aantal between 1 and 12
    and prijs_per_beurt > 0 and prijs_per_beurt <= 1000
    and vanaf is not null
    and bedrag = aantal * prijs_per_beurt
  )
);

-- De rekensom hieronder zoekt eerst of een adres überhaupt vooruit heeft.
create index betaal_gebeurtenissen_vooruit on public.betaal_gebeurtenissen (customer_id)
  where soort in ('vooruit', 'terugbetaald');

-- ---------------------------------------------------------------------
-- 2. De gewone prijs van de dag
--
-- wasdag_prijzen.prijs is wat de beurt kost, mét het extra werk van die
-- ronde. `normaal` is de adresprijs zonder dat extra werk, vastgezet op het
-- moment dat de dag werd ingepland. Leeg = gelijk aan prijs.
-- ---------------------------------------------------------------------
alter table public.wasdag_prijzen add column normaal numeric;

-- Wat er al staat: prijs min het extra werk van die ronde, met dezelfde
-- rekensom als bij het aanmaken.
update public.wasdag_prijzen wp
set normaal = greatest(0, wp.prijs - coalesce((
  select sum((ap.maandwerk_extra ->> (w ->> 'id'))::numeric)
  from public.customers c, jsonb_array_elements(
    case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
  ) as t(w)
  where c.id = r.customer_id
    and w -> 'maanden' ? substr(r.ronde, 6, 2)
    and coalesce(w ->> 'jaar', substr(r.ronde, 1, 4)) = substr(r.ronde, 1, 4)
    and jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')) = 'number'
), 0))
from public.wasdag_regels r
left join public.adres_prijzen ap on ap.customer_id = r.customer_id and ap.company_id = r.company_id
where wp.regel_id = r.id;

-- Prijs bij het aanmaken, nu met de gewone prijs erbij (was: 20261014090000_ronde_per_beurt.sql)
create or replace function public.wasdag_prijs_aanmaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrag numeric := 0;
  gewoon numeric;
begin
  if new.customer_id is not null then
    select coalesce(ap.prijs, 0) + coalesce((
      select sum((ap.maandwerk_extra ->> (w ->> 'id'))::numeric)
      from public.customers c, jsonb_array_elements(
        case when jsonb_typeof(c.maandwerk) = 'array' then c.maandwerk else '[]'::jsonb end
      ) as t(w)
      where c.id = new.customer_id
        and w -> 'maanden' ? substr(new.ronde, 6, 2)
        and coalesce(w ->> 'jaar', substr(new.ronde, 1, 4)) = substr(new.ronde, 1, 4)
        and jsonb_typeof(ap.maandwerk_extra -> (w ->> 'id')) = 'number'
    ), 0),
    coalesce(ap.prijs, 0)
    into bedrag, gewoon
    from public.adres_prijzen ap
    where ap.customer_id = new.customer_id and ap.company_id = new.company_id;
  end if;
  insert into public.wasdag_prijzen (regel_id, company_id, prijs, normaal)
  values (new.id, new.company_id, coalesce(bedrag, 0), gewoon)
  on conflict (regel_id) do nothing;
  return null;
end
$$;
revoke execute on function public.wasdag_prijs_aanmaken() from public, anon, authenticated;

-- Weghalen en terugzetten: de gewone prijs gaat mee (was: 20261014090000_ronde_per_beurt.sql)
create or replace function public.wasdag_weghalen(dag date, adressen uuid[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  weg jsonb;
  kenmerk uuid;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald where company_id = bedrijf and created_at < now() - interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'datum', r.datum, 'customer_id', r.customer_id, 'notitie', r.notitie, 'prijs', wp.prijs,
    'normaal', wp.normaal,
    'ploeg_nr', r.ploeg_nr, 'volgorde', r.volgorde, 'rest', r.rest, 'vaste_start', r.vaste_start,
    'gedaan_op', r.gedaan_op, 'gedaan_door', r.gedaan_door, 'gedaan_bewaard', r.gedaan_bewaard,
    'ronde', r.ronde
  )), '[]'::jsonb)
  into weg
  from public.wasdag_regels r
  left join public.wasdag_prijzen wp on wp.regel_id = r.id
  where r.company_id = bedrijf
    and r.datum = dag
    and (adressen is null or r.customer_id = any(adressen));

  if jsonb_array_length(weg) = 0 then
    return null;
  end if;

  delete from public.wasdag_regels
  where company_id = bedrijf
    and datum = dag
    and (adressen is null or customer_id = any(adressen));

  insert into public.wasdag_weggehaald (company_id, regels) values (bedrijf, weg)
  returning id into kenmerk;
  return kenmerk;
end
$$;
revoke execute on function public.wasdag_weghalen(date, uuid[]) from public, anon;
grant execute on function public.wasdag_weghalen(date, uuid[]) to authenticated;

create or replace function public.wasdag_terugzetten(kenmerk uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  bewaard jsonb;
  nieuw uuid[] := '{}';
  aantal integer := 0;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;

  delete from public.wasdag_weggehaald
  where id = kenmerk and company_id = bedrijf
  returning regels into bewaard;
  if bewaard is null then
    raise exception 'Dit is al teruggezet of te lang geleden.';
  end if;
  perform set_config('wooshy.gedaan', '1', true);

  -- Eerst terugzetten, mét de indeling van die dag en of het gedaan was. De
  -- prijsregel maakt een trigger aan zodra deze opdracht klaar is; pas daarna
  -- kan het bedrag erin.
  with ins as (
    insert into public.wasdag_regels
      (company_id, datum, customer_id, notitie, ploeg_nr, volgorde, rest, vaste_start,
       gedaan_op, gedaan_door, gedaan_bewaard, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ploeg_nr', '')::smallint,
           nullif(r ->> 'volgorde', '')::integer,
           coalesce((r ->> 'rest')::boolean, false),
           nullif(r ->> 'vaste_start', '')::time,
           nullif(r ->> 'gedaan_op', '')::timestamptz,
           nullif(r ->> 'gedaan_door', '')::uuid,
           case when jsonb_typeof(r -> 'gedaan_bewaard') = 'object' then r -> 'gedaan_bewaard' end,
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(bewaard) as t(r)
    where r ->> 'customer_id' is not null
      and exists (
        select 1 from public.customers c
        where c.id = (r ->> 'customer_id')::uuid
          and c.company_id = bedrijf
          -- Gedaan werk komt altijd terug; de planning alleen voor wie nog
          -- klant is.
          and (
            (r ->> 'datum')::date <= vandaag
            or (c.deleted_at is null and c.inactief_op is null)
          )
      )
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;
  aantal := cardinality(nieuw);

  -- De gewone prijs gaat mee terug. Een oude momentopname zonder die prijs:
  -- dan telt de beurtprijs zelf als gewoon.
  update public.wasdag_prijzen wp
  set prijs = (r ->> 'prijs')::numeric,
      normaal = case when jsonb_typeof(r -> 'normaal') = 'number' then (r ->> 'normaal')::numeric end
  from public.wasdag_regels w, jsonb_array_elements(bewaard) as t(r)
  where wp.regel_id = w.id
    and w.id = any(nieuw)
    and w.customer_id = (r ->> 'customer_id')::uuid
    and w.datum = (r ->> 'datum')::date
    and jsonb_typeof(r -> 'prijs') = 'number';

  return aantal;
end
$$;
revoke execute on function public.wasdag_terugzetten(uuid) from public, anon;
grant execute on function public.wasdag_terugzetten(uuid) to authenticated;

-- Stoppen en terugdraaien: de gewone prijs gaat mee (was: 20261014090000_ronde_per_beurt.sql)
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

  return jsonb_build_object(
    'adressen', to_jsonb(gezet),
    'klanten', to_jsonb(klanten_weg),
    'planning', planning,
    'inactief_op', nu
  );
end
$$;
revoke execute on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) from public, anon;
grant execute on function public.zet_adressen_inactief(uuid[], text, boolean, uuid) to authenticated;

create or replace function public.stoppen_terugdraaien(uitkomst jsonb, voor_bedrijf uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  bedrijf uuid := coalesce(
    public.current_company_id(),
    case when auth.role() = 'service_role' then voor_bedrijf end
  );
  -- Het oude bedrag terugzetten mag wie een dagprijs mag wijzigen: prijzen
  -- zien én planning (zoals de regels op wasdag_prijzen). Anders blijft de
  -- momentopname die de database zelf uitrekent.
  prijzen_zichtbaar boolean := auth.role() = 'service_role'
    or (public.heeft_recht('prijzen_zien') and public.heeft_recht('planning'));
  moment timestamptz := (uitkomst ->> 'inactief_op')::timestamptz;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  terug uuid[] := '{}';
  nieuw uuid[] := '{}';
begin
  if bedrijf is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;
  if moment is null then
    raise exception 'Onbekende stopzetting.';
  end if;

  with u as (
    update public.customers
    set inactief_op = null, inactief_reden = null
    where company_id = bedrijf
      and deleted_at is null
      and inactief_op = moment
      and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'adressen', '[]'::jsonb)))::uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into terug from u;

  update public.klanten
  set deleted_at = null
  where company_id = bedrijf
    and deleted_at = moment
    and id in (select (jsonb_array_elements_text(coalesce(uitkomst -> 'klanten', '[]'::jsonb)))::uuid);

  -- De planning terug. De prijs rekent de database zelf opnieuw uit (trigger
  -- op wasdag_regels); alleen wie prijzen mag zien, zet het oude bedrag terug.
  -- Alleen de regels die hier echt terugkomen krijgen straks hun oude prijs:
  -- een dag die intussen opnieuw is ingepland houdt zijn eigen bedrag.
  with ins as (
    insert into public.wasdag_regels (company_id, datum, customer_id, notitie, ronde)
    select bedrijf, (r ->> 'datum')::date, (r ->> 'customer_id')::uuid, r ->> 'notitie',
           nullif(r ->> 'ronde', '')
    from jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where (r ->> 'datum')::date >= vandaag
      and (r ->> 'customer_id')::uuid = any(terug)
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into nieuw from ins;

  if prijzen_zichtbaar then
    update public.wasdag_prijzen wp
    set prijs = (r ->> 'prijs')::numeric,
        normaal = case when jsonb_typeof(r -> 'normaal') = 'number' then (r ->> 'normaal')::numeric end
    from public.wasdag_regels w,
      jsonb_array_elements(coalesce(uitkomst -> 'planning', '[]'::jsonb)) as t(r)
    where wp.regel_id = w.id
      and w.id = any(nieuw)
      and w.company_id = bedrijf
      and w.customer_id = (r ->> 'customer_id')::uuid
      and w.datum = (r ->> 'datum')::date
      and w.customer_id = any(terug)
      and w.datum >= vandaag
      and jsonb_typeof(r -> 'prijs') = 'number';
  end if;

  return cardinality(terug);
end
$$;
revoke execute on function public.stoppen_terugdraaien(jsonb, uuid) from public, anon;
grant execute on function public.stoppen_terugdraaien(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Het adres: nieuwe bewoner en de geplande wissel
-- ---------------------------------------------------------------------
alter table public.customers
  -- Sinds wanneer de huidige klant bij dit adres hoort (alleen gezet als er
  -- een andere klant kwam). Vooruit betaalde beurten van de vorige klant
  -- worden na dit moment niet meer opgemaakt.
  add column klant_sinds timestamptz,
  -- Naar overmaken zodra de vooruitbetaling op is. 'gepland' = wacht nog,
  -- 'uitgevoerd' = is doorgegaan. Alleen de database schrijft hierin.
  add column wissel_status text check (wissel_status in ('gepland', 'uitgevoerd')),
  -- De betaalmethode van het adres zelf van vóór de wissel (leeg = volgde de wijk).
  add column wissel_vorige text check (wissel_vorige in ('contant', 'overmaken')),
  add column wissel_gepland_op timestamptz,
  add column wissel_gepland_naam text,
  add column wissel_uitgevoerd_op timestamptz,
  -- Tot en met deze dag telde het adres nog contant.
  add column wissel_periode_tot date;

-- De wissel mag de betaalmethode zetten, ook bij wie het recht niet heeft:
-- het is de afspraak die de eigenaar al maakte, die nu pas doorgaat.
-- Verder gelijk aan de versie uit geldloop_dossier.
create or replace function public.adres_wijziging_controleren()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.current_company_id() is null
     or coalesce(current_setting('wooshy.geldloop', true), '') = '1'
     or coalesce(current_setting('wooshy.wissel', true), '') = '1' then
    return new;
  end if;
  if (new.deleted_at, new.inactief_op, new.inactief_reden, new.klant_id, new.house_number, new.addition, new.betaalmethode)
     is distinct from
     (old.deleted_at, old.inactief_op, old.inactief_reden, old.klant_id, old.house_number, old.addition, old.betaalmethode)
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen, van klant wisselen of de betaalmethode veranderen.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- 4. De rekensom
--
-- Alleen voor andere functies: die controleren eerst wie er vraagt.
-- ---------------------------------------------------------------------

-- Wat één beurt vooruit kost: de basisprijs min de vaste kortingen. Leeg als
-- het adres geen (geldige) prijs heeft; dan kan er niet vooruit betaald worden.
create or replace function public.vooruit_prijs(adres uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when x.p > 0 and x.p <= 1000 then x.p end
  from (
    select round(ap.prijs - coalesce((
      select sum(vk.bedrag) from public.vaste_kortingen vk
      where vk.customer_id = ap.customer_id and vk.deleted_at is null
    ), 0), 2) as p
    from public.adres_prijzen ap
    where ap.customer_id = adres
  ) x
$$;
revoke execute on function public.vooruit_prijs(uuid) from public, anon, authenticated;

-- Een dagregel die bij "Dag klaar" als overmaken is vastgelegd, telt nooit
-- als contante schuld: die krijgt een factuurregel. Zo kan een beurt nooit
-- twee keer betaald worden (ook niet als een adres midden op de dag van
-- methode wisselde). Verder gelijk aan de versie uit ronde_per_beurt.
create or replace function public.geld_schuld(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag, greatest(coalesce(g.aantal, 1), 1)::int,
         coalesce(array_to_string(g.maanden, ','), ''), 0, g.id
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort = 'beginstand' and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  -- Wasbeurten: met de dagnotitie en het extra werk van die ronde erbij.
  select r.customer_id, 'wassen', r.datum, wp.prijs, 1,
         concat_ws(' · ',
           (select string_agg(btrim(m ->> 'notitie'), ', ')
              from jsonb_array_elements(
                     case when jsonb_typeof(cu.maandwerk) = 'array' then cu.maandwerk else '[]'::jsonb end
                   ) m
              where coalesce(m -> 'maanden', '[]'::jsonb) ? substr(r.ronde, 6, 2)
                and coalesce(m ->> 'jaar', '') in ('', substr(r.ronde, 1, 4))
                and btrim(coalesce(m ->> 'notitie', '')) <> ''),
           nullif(btrim(r.notitie), '')),
         1, r.id
  from public.wasdag_regels r
  join public.wasdag_prijzen wp on wp.regel_id = r.id
  join public.customers cu on cu.id = r.customer_id
  where r.company_id = bedrijf and r.customer_id = any (adressen)
    and r.gedaan_op is not null and wp.prijs > 0
    and r.niet_gewassen_op is null
    and r.betaalmethode is distinct from 'overmaken'
    and r.datum <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = r.customer_id and r.datum >= p.vanaf and (p.tot is null or r.datum <= p.tot)
    )
  union all
  -- Uitgevoerde klussen, met wat het was.
  select k.customer_id, 'klus', k.gedaan_op, kp.prijs, 1, k.omschrijving, 2, k.id
  from public.klussen k
  join public.klus_prijzen kp on kp.klus_id = k.id
  where k.company_id = bedrijf and k.customer_id = any (adressen)
    and k.gedaan_op is not null and k.deleted_at is null and kp.prijs > 0
    and k.gedaan_op <= (now() at time zone 'Europe/Amsterdam')::date
    and exists (
      select 1 from public.contant_periodes p
      where p.customer_id = k.customer_id and k.gedaan_op >= p.vanaf and (p.tot is null or k.gedaan_op <= p.tot)
    )
$$;
revoke execute on function public.geld_schuld(uuid, uuid[]) from public, anon, authenticated;

-- Welke wasbeurt met welke vooruitbetaling betaald is. Per adres, oud naar
-- nieuw: elke wasbeurt neemt een beurt van de oudste vooruitbetaling die nog
-- beurten over heeft en voor die datum al gold. Wat eruit komt:
--   dekking      deze wasbeurt is (tot de gewone prijs) met vooruit betaald
--   tegoed       vooruit per beurt was meer dan deze beurt kostte: verschil
--                is tegoed
--   terug        bij "terugbetaald": de beurten die toen nog over waren,
--                als tegoed (ref = het terugbetaald, vooruit_id = de betaling)
--   terugbetaald wat er is teruggegeven, als min-bedrag
--   over         beurten die nog over zijn
--   over_vast    beurten die nog over zijn maar niet meer opgemaakt worden
--                (adres gestopt, of er woont een andere klant): terug te geven
-- Zonder vooruitbetalingen is een adres meteen klaar.
create or replace function public.geld_vooruit(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  ref uuid,
  vooruit_id uuid,
  datum date,
  bedrag numeric,
  aantal int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  a uuid;
  cu record;
  p record;
  stop_dag date;
  nieuw_dag date;
  s_id uuid[];
  s_binnen timestamptz[];
  s_rest int[];
  s_p numeric[];
  s_vanaf date[];
  s_klant uuid[];
  s_grens date[];
  t_id uuid[];
  t_op timestamptz[];
  t_binnen timestamptz[];
  t_bedrag numeric[];
  n int;
  m int;
  i int;
  ti int;
  t_dag date;
  dek numeric;
  meer numeric;
begin
  for a in
    select distinct g.customer_id
    from public.betaal_gebeurtenissen g
    where g.company_id = bedrijf and g.customer_id = any (adressen)
      and g.soort in ('vooruit', 'terugbetaald')
      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  loop
    select c.klant_id, c.inactief_op, c.klant_sinds into cu from public.customers c where c.id = a;
    stop_dag := (cu.inactief_op at time zone 'Europe/Amsterdam')::date;
    nieuw_dag := (cu.klant_sinds at time zone 'Europe/Amsterdam')::date;

    select array_agg(g.id order by g.op, g.id),
           array_agg(g.ontvangen_op order by g.op, g.id),
           array_agg(g.aantal::int order by g.op, g.id), array_agg(g.prijs_per_beurt order by g.op, g.id),
           array_agg(g.vanaf order by g.op, g.id), array_agg(g.klant_id order by g.op, g.id)
      into s_id, s_binnen, s_rest, s_p, s_vanaf, s_klant
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort = 'vooruit'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id);
    n := coalesce(cardinality(s_id), 0);

    -- Tot en met welke dag een betaling beurten mag opmaken: niet na het
    -- stoppen, en niet meer als er intussen een andere klant woont.
    s_grens := '{}';
    for i in 1 .. n loop
      s_grens := array_append(s_grens, least(
        stop_dag,
        case when s_klant[i] is not null and s_klant[i] is distinct from cu.klant_id
             then coalesce(nieuw_dag, '-infinity'::date) end
      ));
    end loop;

    select array_agg(g.id order by g.op, g.id), array_agg(g.op order by g.op, g.id),
           array_agg(g.ontvangen_op order by g.op, g.id), array_agg(g.bedrag order by g.op, g.id)
      into t_id, t_op, t_binnen, t_bedrag
      from public.betaal_gebeurtenissen g
      where g.customer_id = a and g.company_id = bedrijf and g.soort = 'terugbetaald'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id);
    m := coalesce(cardinality(t_id), 0);
    ti := 1;

    for p in
      select x.ref, x.datum, x.bedrag as w, coalesce(nullif(wp.normaal, 0), x.bedrag) as b
      from public.geld_schuld(bedrijf, array[a]) x
      left join public.wasdag_prijzen wp on wp.regel_id = x.ref
      where x.soort = 'wassen'
      order by x.datum, x.ref
    loop
      -- Eerst wat er vóór deze beurt is teruggegeven: de beurten die toen
      -- over waren komen vrij als tegoed, en het teruggegeven geld gaat eraf.
      -- "Toen over" = al binnen op het moment dat het teruggeven binnenkwam;
      -- een vooruit-tik zonder bereik die later binnenkomt, telt gewoon door.
      while ti <= m and (t_op[ti] at time zone 'Europe/Amsterdam')::date < p.datum loop
        t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
        for i in 1 .. n loop
          if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0 then
            customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
            datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
            return next;
            s_rest[i] := 0;
          end if;
        end loop;
        customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
        datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
        return next;
        ti := ti + 1;
      end loop;

      for i in 1 .. n loop
        if s_rest[i] > 0 and s_vanaf[i] <= p.datum and (s_grens[i] is null or p.datum <= s_grens[i]) then
          s_rest[i] := s_rest[i] - 1;
          dek := least(p.w, p.b);
          customer_id := a; soort := 'dekking'; ref := p.ref; vooruit_id := s_id[i];
          datum := p.datum; bedrag := dek; aantal := 1;
          return next;
          meer := greatest(0, s_p[i] - dek);
          if meer > 0 then
            customer_id := a; soort := 'tegoed'; ref := p.ref; vooruit_id := s_id[i];
            datum := p.datum; bedrag := meer; aantal := 0;
            return next;
          end if;
          exit;
        end if;
      end loop;
    end loop;

    -- Wat er na de laatste beurt is teruggegeven.
    while ti <= m loop
      t_dag := (t_op[ti] at time zone 'Europe/Amsterdam')::date;
      for i in 1 .. n loop
        if s_binnen[i] <= t_binnen[ti] and s_rest[i] > 0 then
          customer_id := a; soort := 'terug'; ref := t_id[ti]; vooruit_id := s_id[i];
          datum := t_dag; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
          return next;
          s_rest[i] := 0;
        end if;
      end loop;
      customer_id := a; soort := 'terugbetaald'; ref := t_id[ti]; vooruit_id := null;
      datum := t_dag; bedrag := -t_bedrag[ti]; aantal := 0;
      return next;
      ti := ti + 1;
    end loop;

    for i in 1 .. n loop
      if s_rest[i] > 0 then
        customer_id := a;
        soort := case when s_grens[i] is not null then 'over_vast' else 'over' end;
        ref := s_id[i]; vooruit_id := s_id[i];
        datum := s_vanaf[i]; bedrag := s_rest[i] * s_p[i]; aantal := s_rest[i];
        return next;
      end if;
    end loop;
  end loop;
end
$$;
revoke execute on function public.geld_vooruit(uuid, uuid[]) from public, anon, authenticated;

-- Betalingen en kortingen die niet zijn teruggedraaid, plus wat de
-- vooruitbetalingen als euro's opleveren: tegoed, vrijgekomen beurten bij
-- teruggeven, en het teruggegeven geld zelf (negatief).
create or replace function public.geld_krediet(bedrijf uuid, adressen uuid[])
returns table (id uuid, customer_id uuid, soort text, bedrag numeric, op timestamptz, door_naam text)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.customer_id, g.soort, g.bedrag, g.op, g.door_naam
  from public.betaal_gebeurtenissen g
  where g.company_id = bedrijf and g.customer_id = any (adressen)
    and g.soort in ('betaald', 'korting') and g.bedrag > 0
    and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
  union all
  select case when v.soort = 'terug' then v.vooruit_id else v.ref end,
         v.customer_id,
         case v.soort when 'tegoed' then 'vooruit_tegoed' when 'terug' then 'vooruit_terug' else 'terugbetaald' end,
         v.bedrag, g.op, g.door_naam
  from public.geld_vooruit(bedrijf, adressen) v
  join public.betaal_gebeurtenissen g on g.id = case when v.soort = 'tegoed' then v.vooruit_id else v.ref end
  where v.soort in ('tegoed', 'terug', 'terugbetaald') and v.bedrag <> 0
$$;
revoke execute on function public.geld_krediet(uuid, uuid[]) from public, anon, authenticated;

-- De return-kolommen veranderen: eerst weg, dan opnieuw.
drop function public.geld_stand(uuid, uuid[]);
drop function public.geld_posten(uuid, uuid[]);
drop function public.geld_posten_betaald(uuid, uuid[]);

-- Elke schuldpost met hoeveel ervan betaald is. Eerst gaat eraf wat met
-- vooruit betaald is (`vooruit`); wat dan nog over is, dekt het geld van oud
-- naar nieuw: een post is gedekt voor zover het totaal aan betalingen verder
-- reikt dan alle euro-schuld die ervóór kwam.
create function public.geld_posten(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  volg int,
  ref uuid,
  gedekt numeric,
  vooruit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select v.ref, sum(v.bedrag) as dek
    from public.geld_vooruit(bedrijf, adressen) v
    where v.soort = 'dekking'
    group by v.ref
  ),
  s as (
    select x.*, coalesce(d.dek, 0) as dek,
      sum(x.bedrag - coalesce(d.dek, 0)) over (
        partition by x.customer_id order by x.datum, x.volg, x.ref
        rows between unbounded preceding and current row
      ) - (x.bedrag - coalesce(d.dek, 0)) as ervoor
    from public.geld_schuld(bedrijf, adressen) x
    left join d on d.ref = x.ref and x.soort = 'wassen'
  ),
  k as (
    select y.customer_id, sum(y.bedrag) as totaal
    from public.geld_krediet(bedrijf, adressen) y
    group by y.customer_id
  )
  select s.customer_id, s.soort, s.datum, s.bedrag, s.aantal, s.omschrijving, s.volg, s.ref,
    s.dek + greatest(0, least(s.bedrag - s.dek, coalesce(k.totaal, 0) - s.ervoor)),
    s.dek
  from s
  left join k on k.customer_id = s.customer_id
$$;
revoke execute on function public.geld_posten(uuid, uuid[]) from public, anon, authenticated;

-- Per adres: wat er open staat (negatief = tegoed), hoeveel wasbeurten dat
-- zijn, de posten die nog niet (helemaal) betaald zijn, en de beurten die nog
-- vooruit betaald zijn. Een beurt waarvan alleen de meerprijs openstaat telt
-- niet als open wasbeurt.
create function public.geld_stand(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  open numeric,
  open_wassen int,
  delen jsonb,
  vooruit_over int,
  vooruit_waarde numeric,
  vooruit_vast int
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select * from public.geld_posten(bedrijf, adressen)
  ),
  schuld as (
    select p.customer_id, sum(p.bedrag) as totaal, sum(p.vooruit) as dek from p group by p.customer_id
  ),
  krediet as (
    select k.customer_id, sum(k.bedrag) as totaal
    from public.geld_krediet(bedrijf, adressen) k group by k.customer_id
  ),
  vooruit as (
    select v.customer_id,
      coalesce(sum(v.aantal) filter (where v.soort in ('over', 'over_vast')), 0)::int as stuks,
      coalesce(sum(v.bedrag) filter (where v.soort in ('over', 'over_vast')), 0) as waarde,
      coalesce(sum(v.aantal) filter (where v.soort = 'over_vast'), 0)::int as vast
    from public.geld_vooruit(bedrijf, adressen) v group by v.customer_id
  ),
  onbetaald as (
    select p.customer_id,
      sum(case
            when p.soort = 'beginstand' then ceil(p.aantal * (p.bedrag - p.gedekt) / p.bedrag - 0.0001)
            when p.soort = 'wassen' and p.vooruit = 0 then 1
            else 0
          end)::int as open_wassen,
      jsonb_agg(jsonb_build_object(
        'soort', p.soort,
        'datum', p.datum,
        'bedrag', p.bedrag,
        'rest', round(p.bedrag - p.gedekt, 2),
        'aantal', p.aantal,
        'omschrijving', coalesce(p.omschrijving, ''),
        'vooruit', p.vooruit
      ) order by p.datum, p.volg, p.ref) as delen
    from p
    where p.bedrag - p.gedekt > 0.005
    group by p.customer_id
  )
  select a.id,
    round(coalesce(s.totaal, 0) - coalesce(s.dek, 0) - coalesce(k.totaal, 0), 2),
    coalesce(o.open_wassen, 0),
    coalesce(o.delen, '[]'::jsonb),
    coalesce(v.stuks, 0),
    coalesce(v.waarde, 0),
    coalesce(v.vast, 0)
  from unnest(adressen) as a(id)
  left join schuld s on s.customer_id = a.id
  left join krediet k on k.customer_id = a.id
  left join vooruit v on v.customer_id = a.id
  left join onbetaald o on o.customer_id = a.id
$$;
revoke execute on function public.geld_stand(uuid, uuid[]) from public, anon, authenticated;

-- Zelfde rekensom als geld_posten, maar per post ook de betaling die hem als
-- laatste dekte (was: 20261011110000_geld_overzichten.sql). Een beurt die
-- helemaal met vooruit betaald is, hoort bij die vooruitbetaling. Het totaal
-- is de som van alle kredietregels (teruggegeven geld telt negatief); "betaald
-- met" zoekt alleen tussen de positieve regels, zodat dat lopend totaal
-- alleen maar stijgt.
create function public.geld_posten_betaald(bedrijf uuid, adressen uuid[])
returns table (
  customer_id uuid,
  soort text,
  datum date,
  bedrag numeric,
  aantal int,
  omschrijving text,
  ref uuid,
  gedekt numeric,
  betaald_met uuid,
  betaald_soort text,
  betaald_op timestamptz,
  betaald_door text,
  vooruit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select v.ref, sum(v.bedrag) as dek, (array_agg(v.vooruit_id))[1] as vooruit_id
    from public.geld_vooruit(bedrijf, adressen) v
    where v.soort = 'dekking'
    group by v.ref
  ),
  s as (
    select x.*, coalesce(d.dek, 0) as dek, d.vooruit_id,
      x.bedrag - coalesce(d.dek, 0) as euro,
      sum(x.bedrag - coalesce(d.dek, 0)) over w - (x.bedrag - coalesce(d.dek, 0)) as ervoor,
      sum(x.bedrag - coalesce(d.dek, 0)) over w as tot
    from public.geld_schuld(bedrijf, adressen) x
    left join d on d.ref = x.ref and x.soort = 'wassen'
    window w as (partition by x.customer_id order by x.datum, x.volg, x.ref
                 rows between unbounded preceding and current row)
  ),
  alle as (
    select * from public.geld_krediet(bedrijf, adressen)
  ),
  totaal as (
    select alle.customer_id, sum(alle.bedrag) as som from alle group by alle.customer_id
  ),
  k as (
    select y.*,
      sum(y.bedrag) over w - y.bedrag as k_van,
      sum(y.bedrag) over w as k_tot
    from alle y
    where y.bedrag > 0
    window w as (partition by y.customer_id order by y.op, y.id
                 rows between unbounded preceding and current row)
  )
  select s.customer_id, s.soort, s.datum, s.bedrag, s.aantal, s.omschrijving, s.ref,
    s.dek + greatest(0, least(s.euro, coalesce(t.som, 0) - s.ervoor)),
    coalesce(b.id, vg.id),
    coalesce(b.soort, case when vg.id is not null then 'vooruit' end),
    coalesce(b.op, vg.op),
    coalesce(b.door_naam, vg.door_naam),
    s.dek
  from s
  left join totaal t on t.customer_id = s.customer_id
  left join lateral (
    select k.id, k.soort, k.op, k.door_naam from k
    where s.euro > 0.005
      and k.customer_id = s.customer_id and k.k_van < s.tot and k.k_tot >= s.tot - 0.005
    order by k.k_tot limit 1
  ) b on true
  left join public.betaal_gebeurtenissen vg on vg.id = s.vooruit_id and s.euro <= 0.005
$$;
revoke execute on function public.geld_posten_betaald(uuid, uuid[]) from public, anon, authenticated;

-- Eén gebeurtenis als jsonb, met wie hem terugdraaide. Bij een
-- vooruitbetaling ook de prijs per beurt, vanaf wanneer, en hoeveel beurten
-- al gebruikt of teruggegeven zijn (was: 20261011110000_geld_overzichten.sql).
create or replace function public.geld_gebeurtenis_json(g public.betaal_gebeurtenissen)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', g.id, 'customer_id', g.customer_id, 'adres', g.adres, 'soort', g.soort,
    'bedrag', g.bedrag, 'reden', g.reden, 'aantal', g.aantal,
    'maanden', coalesce(to_jsonb(g.maanden), '[]'::jsonb),
    'bron', g.bron, 'door', g.door, 'door_naam', g.door_naam, 'op', g.op, 'vrijgave_id', g.vrijgave_id,
    'botsing_met', g.botsing_met,
    -- Kwam hij pas veel later binnen dan hij getikt werd (geen bereik)?
    'later_binnen', g.ontvangen_op > g.op + interval '10 minutes',
    'ongedaan', (select jsonb_build_object('id', o.id, 'door_naam', o.door_naam, 'op', o.op)
                 from public.betaal_gebeurtenissen o where o.herroept_id = g.id),
    'prijs_per_beurt', g.prijs_per_beurt,
    'vanaf', g.vanaf,
    'prijs_verwacht', g.prijs_verwacht
  ) || case when g.soort = 'vooruit' then (
    select jsonb_build_object(
      'gebruikt', count(*) filter (where v.soort = 'dekking'),
      'teruggegeven', coalesce(sum(v.aantal) filter (where v.soort = 'terug'), 0)
    )
    from public.geld_vooruit(g.company_id, array[g.customer_id]) v
    where v.vooruit_id = g.id
  ) else '{}'::jsonb end
$$;
revoke execute on function public.geld_gebeurtenis_json(public.betaal_gebeurtenissen) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. De wissel naar overmaken, pas als de vooruitbetaling op is
-- ---------------------------------------------------------------------

-- De contante periode sluiten mag nu ook op een andere dag dan gisteren:
-- gaat de wissel door na de laatste vooruit-beurt van vandaag, dan telt
-- vandaag nog contant (wooshy.periode_tot). Verder gelijk aan de versie uit
-- betalingen_fundament.
create or replace function public.geld_periode_bijwerken(adres uuid, start date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  lopend record;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  sluit_op date := coalesce(nullif(current_setting('wooshy.periode_tot', true), '')::date, vandaag - 1);
begin
  select cu.company_id, coalesce(cu.betaalmethode, d.betaalmethode) as methode, d.geld_peildatum as peil
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres;
  if not found then
    return;
  end if;
  select id, vanaf into lopend from public.contant_periodes where customer_id = adres and tot is null;
  if c.methode = 'contant' and c.peil is not null then
    if lopend.id is null then
      insert into public.contant_periodes (company_id, customer_id, vanaf)
        values (c.company_id, adres, coalesce(start, greatest(c.peil + 1, vandaag)));
    end if;
  elsif lopend.id is not null then
    -- Tot en met gisteren (of de dag die de wissel meegeeft) was het contant.
    -- Begon de periode pas later, dan heeft hij nooit gegolden.
    if lopend.vanaf > sluit_op then
      delete from public.contant_periodes where id = lopend.id;
    else
      update public.contant_periodes set tot = sluit_op where id = lopend.id;
    end if;
  end if;
end
$$;
revoke execute on function public.geld_periode_bijwerken(uuid, date) from public, anon, authenticated;

-- Hoeveel vooruit betaalde beurten een adres nog kan opmaken, zolang het
-- contant telt. 0 als het niet (meer) contant telt of niets vooruit heeft.
create or replace function public.vooruit_beurten_open(adres uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  beurten int;
begin
  if not exists (select 1 from public.contant_periodes p where p.customer_id = adres and p.tot is null)
     or not exists (select 1 from public.betaal_gebeurtenissen g
                    where g.customer_id = adres and g.soort = 'vooruit'
                      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)) then
    return 0;
  end if;
  select greatest(0, st.vooruit_over - st.vooruit_vast) into beurten
    from public.customers c, public.geld_stand(c.company_id, array[c.id]) st
    where c.id = adres;
  return coalesce(beurten, 0);
end
$$;
revoke execute on function public.vooruit_beurten_open(uuid) from public, anon, authenticated;

-- Houdt de kolommen van dit bestand bij, bij elke wijziging van een adres:
--   * klant_sinds: komt er een andere klant, dan vanaf nu (of vanaf het
--     stoppen van de vorige).
--   * de wisselkolommen: alleen de database zelf (vlag wooshy.wissel).
--   * wordt een contant adres met nog vooruit-beurten op overmaken gezet,
--     dan blijft het nog contant en wordt de wissel gepland.
--   * verhuist zo'n adres naar een wijk waar het niet meer contant telt
--     (overmaken, of de wijk is nog niet gestart), dan stopt het: daar kan
--     de database de beurten niet meer opmaken. Eerst opmaken of teruggeven.
-- Security definer omdat hij de geldstand moet lezen; daarom controleert hij
-- zelf het recht: deze trigger loopt vóór customers_wijziging_controleren en
-- zet de methode terug, waardoor die daarna niets meer ziet veranderen.
create or replace function public.customers_vooruit_bewaken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vlag boolean := coalesce(current_setting('wooshy.wissel', true), '') = '1';
  oud_methode text;
  nieuw_wijk text;
  nieuw_peil date;
  nieuw_methode text;
  beurten int;
begin
  if new.klant_id is distinct from old.klant_id and old.klant_id is not null then
    new.klant_sinds := coalesce(old.inactief_op, now());
  else
    new.klant_sinds := old.klant_sinds;
  end if;

  if vlag then
    return new;
  end if;
  new.wissel_status := old.wissel_status;
  new.wissel_vorige := old.wissel_vorige;
  new.wissel_gepland_op := old.wissel_gepland_op;
  new.wissel_gepland_naam := old.wissel_gepland_naam;
  new.wissel_uitgevoerd_op := old.wissel_uitgevoerd_op;
  new.wissel_periode_tot := old.wissel_periode_tot;

  if new.betaalmethode is not distinct from old.betaalmethode
     and new.street_id is not distinct from old.street_id then
    return new;
  end if;

  -- Zelf een andere methode kiezen na een doorgegane wissel: dan hoort die
  -- wissel er niet meer bij.
  if old.wissel_status = 'uitgevoerd' and new.betaalmethode is distinct from old.betaalmethode then
    new.wissel_status := null;
    new.wissel_vorige := null;
    new.wissel_gepland_op := null;
    new.wissel_gepland_naam := null;
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;

  oud_methode := coalesce(old.betaalmethode, (
    select d.betaalmethode from public.streets s join public.districts d on d.id = s.district_id
    where s.id = old.street_id), 'contant');
  select d.betaalmethode, d.geld_peildatum into nieuw_wijk, nieuw_peil
    from public.streets s join public.districts d on d.id = s.district_id
    where s.id = new.street_id;
  nieuw_methode := coalesce(new.betaalmethode, nieuw_wijk, 'contant');
  if oud_methode <> 'contant' then
    return new;
  end if;

  -- Zelf weer uitdrukkelijk contant kiezen terwijl er een wissel klaarstaat:
  -- dan gaat die wissel niet meer door.
  if old.wissel_status = 'gepland' and new.betaalmethode is distinct from old.betaalmethode
     and nieuw_methode = 'contant' then
    new.wissel_status := null;
    new.wissel_vorige := null;
    new.wissel_gepland_op := null;
    new.wissel_gepland_naam := null;
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;

  if new.street_id is distinct from old.street_id then
    if nieuw_methode = 'overmaken' or nieuw_peil is null then
      beurten := public.vooruit_beurten_open(old.id);
      if beurten > 0 then
        raise exception 'Dit adres heeft nog % vooruit betaalde beurt(en). Verhuis het pas naar deze wijk als die op zijn, of geef ze eerst terug.', beurten;
      end if;
    end if;
    return new;
  end if;

  if nieuw_methode <> 'overmaken' then
    return new;
  end if;
  beurten := public.vooruit_beurten_open(old.id);
  if beurten = 0 then
    return new;
  end if;

  if not (auth.role() = 'service_role' or public.current_company_id() is null
          or coalesce(current_setting('wooshy.geldloop', true), '') = '1')
     and not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag een adres niet weggooien, laten stoppen, van klant wisselen of de betaalmethode veranderen.';
  end if;

  -- Blijft contant zoals het was; de wissel komt later.
  new.betaalmethode := case when coalesce(nieuw_wijk, 'contant') = 'overmaken' then 'contant' else old.betaalmethode end;
  if old.wissel_status is distinct from 'gepland' then
    new.wissel_status := 'gepland';
    new.wissel_vorige := old.betaalmethode;
    new.wissel_gepland_op := now();
    new.wissel_gepland_naam := coalesce(public.geld_mijn_naam(), '');
    new.wissel_uitgevoerd_op := null;
    new.wissel_periode_tot := null;
  end if;
  return new;
end
$$;
drop trigger if exists customers_vooruit_bewaken on public.customers;
create trigger customers_vooruit_bewaken before update on public.customers
  for each row execute function public.customers_vooruit_bewaken();

-- Een hele wijk gaat naar overmaken: de adressen die de wijk volgen en nog
-- vooruit-beurten hebben, blijven contant tot die op zijn.
create or replace function public.vooruit_wissel_plannen(adressen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  oud text := coalesce(current_setting('wooshy.wissel', true), '');
begin
  for c in
    select cu.id
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    where cu.id = any (adressen) and cu.betaalmethode is null and d.betaalmethode = 'overmaken'
  loop
    if public.vooruit_beurten_open(c.id) > 0 then
      perform set_config('wooshy.wissel', '1', true);
      update public.customers
        set betaalmethode = 'contant', wissel_status = 'gepland', wissel_vorige = null,
            wissel_gepland_op = now(), wissel_gepland_naam = coalesce(public.geld_mijn_naam(), ''),
            wissel_uitgevoerd_op = null, wissel_periode_tot = null
        where id = c.id;
      perform set_config('wooshy.wissel', oud, true);
    end if;
  end loop;
end
$$;
revoke execute on function public.vooruit_wissel_plannen(uuid[]) from public, anon, authenticated;

-- Een straat naar een andere wijk: gaat een adres met nog vooruit-beurten
-- daardoor niet meer contant tellen, dan stopt het (zie hierboven).
-- Verder gelijk aan de versie uit betalingen_fundament.
create or replace function public.geld_periode_straat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
begin
  select w.betaalmethode, w.geld_peildatum into d from public.districts w where w.id = new.district_id;
  if exists (
    select 1 from public.customers c
    where c.street_id = new.id
      and (coalesce(c.betaalmethode, d.betaalmethode) = 'overmaken' or d.geld_peildatum is null)
      and public.vooruit_beurten_open(c.id) > 0
  ) then
    raise exception 'In deze straat heeft een adres nog vooruit betaalde beurten. Verplaats de straat pas als die op zijn, of geef ze eerst terug.';
  end if;
  perform public.geld_periode_bijwerken(c.id) from public.customers c where c.street_id = new.id;
  return null;
end
$$;

-- (was: 20261011090000_betalingen_fundament.sql)
create or replace function public.geld_periode_wijk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.vooruit_wissel_plannen(array(
    select c.id from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = new.id and c.betaalmethode is null));
  perform public.geld_periode_bijwerken(c.id)
    from public.customers c join public.streets s on s.id = c.street_id
    where s.district_id = new.id and c.betaalmethode is null;
  return null;
end
$$;

-- Zet geplande wissels door zodra de vooruitbetaling op is, en draait een
-- doorgegane wissel terug als er toch weer een beurt vrijkomt (dag
-- heropend, niet gewassen, betaling ongedaan). Mag vaker lopen: doet alleen
-- iets als het nodig is.
create or replace function public.betaalwissels_bijwerken(bedrijf uuid, adressen uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  beurten int;
  laatst date;
  sluit_op date;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  oud_vlag text := coalesce(current_setting('wooshy.wissel', true), '');
  oud_tot text := coalesce(current_setting('wooshy.periode_tot', true), '');
  periode uuid;
begin
  for c in
    select cu.id, cu.betaalmethode, cu.wissel_status, cu.wissel_vorige, cu.wissel_periode_tot,
           d.betaalmethode as wijk
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.company_id = bedrijf and cu.id = any (adressen) and cu.wissel_status is not null
  loop
    select greatest(0, st.vooruit_over - st.vooruit_vast) into beurten
      from public.geld_stand(bedrijf, array[c.id]) st;
    beurten := coalesce(beurten, 0);

    if c.wissel_status = 'gepland' and beurten = 0 then
      -- De laatste contante beurt telt nog mee, ook als die vandaag was.
      select max(r.datum) into laatst
        from public.wasdag_regels r
        where r.customer_id = c.id and r.company_id = bedrijf
          and r.gedaan_op is not null and r.niet_gewassen_op is null
          and r.betaalmethode is distinct from 'overmaken' and r.datum <= vandaag;
      sluit_op := greatest(vandaag - 1, laatst);
      perform set_config('wooshy.wissel', '1', true);
      perform set_config('wooshy.periode_tot', sluit_op::text, true);
      update public.customers
        set betaalmethode = case when c.wissel_vorige is null and c.wijk = 'overmaken' then null else 'overmaken' end,
            wissel_status = 'uitgevoerd', wissel_uitgevoerd_op = now(), wissel_periode_tot = sluit_op
        where id = c.id;
      perform set_config('wooshy.periode_tot', oud_tot, true);
      perform set_config('wooshy.wissel', oud_vlag, true);

    elsif c.wissel_status = 'uitgevoerd' and beurten > 0
          and coalesce(c.betaalmethode, c.wijk, 'contant') = 'overmaken' then
      -- De contante periode loopt gewoon door, alsof er niets gebeurd is.
      -- Wat intussen als overmaken is afgemeld blijft overmaken (die regels
      -- tellen nooit als contante schuld).
      if not exists (select 1 from public.contant_periodes p where p.customer_id = c.id and p.tot is null) then
        select p.id into periode from public.contant_periodes p
          where p.customer_id = c.id and p.tot = c.wissel_periode_tot
          order by p.vanaf desc limit 1;
        if periode is not null then
          update public.contant_periodes set tot = null where id = periode;
        end if;
      end if;
      perform set_config('wooshy.wissel', '1', true);
      update public.customers
        set betaalmethode = case when c.wissel_vorige is null and c.wijk = 'overmaken' then 'contant' else c.wissel_vorige end,
            wissel_status = 'gepland', wissel_uitgevoerd_op = null, wissel_periode_tot = null
        where id = c.id;
      perform set_config('wooshy.wissel', oud_vlag, true);
    end if;
  end loop;
end
$$;
revoke execute on function public.betaalwissels_bijwerken(uuid, uuid[]) from public, anon, authenticated;

-- De wissel ongedaan maken (geel vakje in het dossier). Gepland: het adres
-- blijft gewoon contant. Doorgegaan: terug naar contant, en de contante
-- periode loopt door waar hij ophield.
create or replace function public.betaalwissel_ongedaan(adres uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  c record;
  periode uuid;
begin
  if bedrijf is null or not public.heeft_recht('klanten_bewerken') then
    raise exception 'Je rol mag de betaalmethode niet veranderen.';
  end if;
  select cu.id, cu.wissel_status, cu.wissel_vorige, cu.wissel_periode_tot, d.betaalmethode as wijk
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres and cu.company_id = bedrijf
    for update of cu;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if c.wissel_status is null then
    return;
  end if;

  if c.wissel_status = 'uitgevoerd'
     and not exists (select 1 from public.contant_periodes p where p.customer_id = c.id and p.tot is null) then
    select p.id into periode from public.contant_periodes p
      where p.customer_id = c.id and p.tot = c.wissel_periode_tot
      order by p.vanaf desc limit 1;
    if periode is not null then
      update public.contant_periodes set tot = null where id = periode;
    end if;
  end if;

  perform set_config('wooshy.wissel', '1', true);
  update public.customers
    set betaalmethode = case
          when c.wissel_status = 'gepland' then betaalmethode
          when c.wissel_vorige is null and c.wijk = 'overmaken' then 'contant'
          else c.wissel_vorige end,
        wissel_status = null, wissel_vorige = null, wissel_gepland_op = null, wissel_gepland_naam = null,
        wissel_uitgevoerd_op = null, wissel_periode_tot = null
    where id = c.id;
  perform set_config('wooshy.wissel', '', true);
end
$$;
revoke execute on function public.betaalwissel_ongedaan(uuid) from public, anon;
grant execute on function public.betaalwissel_ongedaan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Boeken: vooruit en terugbetaald
-- ---------------------------------------------------------------------
-- Twee parameters erbij (aantal, prijs_per_beurt), dus de oude eerst weg.
-- Oude telefoons sturen benoemde parameters en komen met de standaardwaarden
-- gewoon aan. Verder gelijk aan de versie uit geld_herstel, met:
--   * vooruit: aan de deur (geldloper) of op kantoor (eigenaar), alleen bij
--     een contant adres dat niet gestopt is, 1 tot 12 beurten. Zonder prijs
--     rekent de database die zelf uit; wijkt de prijs van de telefoon af, dan
--     wordt dat vastgelegd voor de eigenaar.
--   * terugbetaald: alleen de eigenaar op kantoor. Het bedrag rekent de
--     database zelf; klopt het niet meer met wat de eigenaar zag, dan stopt
--     het.
--   * een vaste korting op een beurt die al vooruit betaald is kan niet: die
--     korting zit al in de prijs per beurt.
drop function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text);

create function public.geld_boeken(
  id uuid,
  adres_id uuid,
  soort text,
  bedrag numeric default 0,
  reden text default '',
  vaste_korting uuid default null,
  herroept uuid default null,
  op timestamptz default null,
  getoond_open numeric default null,
  bron text default 'geldloop',
  aantal int default null,
  prijs_per_beurt numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  eigenaar boolean := public.is_eigenaar();
  moment timestamptz := coalesce(op, now());
  vrij uuid;
  vrij_eind timestamptz;
  bestaand public.betaal_gebeurtenissen;
  oud public.betaal_gebeurtenissen;
  schoon numeric := round(coalesce(bedrag, 0), 2);
  tekst text := btrim(coalesce(reden, ''));
  botsing uuid;
  vk public.vaste_kortingen;
  stuks int := aantal;
  per_beurt numeric := prijs_per_beurt;
  verwacht numeric;
  begint date;
  klant uuid;
  adres_rij record;
  st record;
  terug numeric;
  nieuw int;
begin
  if bedrijf is null then
    raise exception 'Je bent niet ingelogd.';
  end if;

  select * into bestaand from public.betaal_gebeurtenissen g where g.id = geld_boeken.id;
  if found then
    if bestaand.company_id = bedrijf and bestaand.customer_id = adres_id and bestaand.soort = soort then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', bestaand.botsing_met is not null);
    end if;
    raise exception 'Deze tik bestaat al voor iets anders.';
  end if;

  if soort not in ('betaald', 'korting', 'niet_thuis', 'geen_geld', 'ongedaan', 'vooruit', 'terugbetaald') then
    raise exception 'Onbekende soort.';
  end if;
  if bron not in ('geldloop', 'kantoor', 'dag') then
    raise exception 'Onbekende bron.';
  end if;
  if moment > now() + interval '2 minutes' then
    raise exception 'De klok van je telefoon loopt voor. Zet hem goed en probeer het opnieuw.';
  end if;
  moment := least(moment, now());

  if not exists (select 1 from public.customers c where c.id = adres_id and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;

  -- Wie mag dit?
  if bron = 'kantoor' then
    if not eigenaar then
      raise exception 'Alleen de eigenaar kan op kantoor betalingen boeken.';
    end if;
  elsif bron = 'dag' then
    -- Een wasser die overdag geld krijgt: alleen bij een contant adres dat
    -- vandaag op de route staat, en alleen vandaag.
    if soort not in ('betaald', 'ongedaan') then
      raise exception 'Overdag kun je alleen een betaling intikken.';
    end if;
    if not public.dag_geld_toegang(adres_id)
       or (moment at time zone 'Europe/Amsterdam')::date <> (now() at time zone 'Europe/Amsterdam')::date then
      raise exception 'Dit adres staat vandaag niet op je route, of betaalt niet contant.';
    end if;
  else
    if soort = 'terugbetaald' then
      raise exception 'Teruggeven legt de eigenaar vast, op kantoor.';
    end if;
    vrij := public.geldloop_vrijgave_voor(adres_id, moment);
    if vrij is null and not eigenaar then
      raise exception 'Deze wijk is niet (meer) voor je vrijgegeven.';
    end if;
    if vrij is null and eigenaar then
      -- De eigenaar loopt zelf mee: hang de tik aan de avond van die wijk.
      select v.id into vrij
        from public.customers c
        join public.streets s on s.id = c.street_id
        join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id
        join public.geldloop_vrijgaven v on v.id = w.vrijgave_id
        where c.id = adres_id and v.ingetrokken_op is null
          and moment >= v.begin_op and moment < v.eind_op
        order by v.eind_op desc limit 1;
    end if;
    if vrij is not null then
      select eind_op into vrij_eind from public.geldloop_vrijgaven where geldloop_vrijgaven.id = vrij;
      if now() > vrij_eind + interval '24 hours' then
        raise exception 'Deze tik komt te laat binnen (meer dan een dag na de avond).';
      end if;
    end if;
  end if;

  -- Wat er bij deze soort hoort.
  if soort in ('betaald', 'korting') then
    if schoon <= 0 or schoon > 10000 then
      raise exception 'Vul een bedrag in.';
    end if;
  elsif soort not in ('vooruit', 'terugbetaald') then
    schoon := 0;
  end if;
  if length(tekst) > 200 then
    raise exception 'De reden is te lang.';
  end if;
  if soort = 'korting' and vaste_korting is not null then
    select * into vk from public.vaste_kortingen k
      where k.id = vaste_korting and k.customer_id = adres_id and k.deleted_at is null;
    if not found then
      raise exception 'Die vaste korting bestaat niet meer.';
    end if;
    if tekst = '' then
      tekst := vk.naam;
    end if;
    -- Staan er nog beurten vooruit, of is de laatste beurt met vooruit
    -- betaald, dan zit de vaste korting al in de prijs per beurt.
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    if st.vooruit_over - st.vooruit_vast > 0 or coalesce((
      select x.vooruit > 0 from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' order by x.datum desc, x.ref desc limit 1
    ), false) then
      raise exception 'Deze beurt is vooruit betaald; de vaste korting zit al in de prijs per beurt.';
    end if;
  elsif soort = 'korting' and tekst = '' then
    raise exception 'Zet erbij waarom je korting geeft.';
  end if;

  if soort = 'vooruit' then
    select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') as methode, cu.inactief_op, cu.deleted_at, cu.klant_id
      into adres_rij
      from public.customers cu
      left join public.streets s on s.id = cu.street_id
      left join public.districts d on d.id = s.district_id
      where cu.id = adres_id;
    if adres_rij.deleted_at is not null or adres_rij.inactief_op is not null then
      raise exception 'Dit adres is gestopt; vooruit betalen kan niet meer.';
    end if;
    if adres_rij.methode <> 'contant'
       or not exists (select 1 from public.contant_periodes p where p.customer_id = adres_id and p.tot is null) then
      raise exception 'Dit adres betaalt niet contant; vooruit betalen kan hier niet.';
    end if;
    if stuks is null or stuks < 1 or stuks > 12 then
      raise exception 'Kies tussen 1 en 12 beurten.';
    end if;
    verwacht := public.vooruit_prijs(adres_id);
    per_beurt := round(coalesce(per_beurt, verwacht), 2);
    if per_beurt is null then
      raise exception 'Dit adres heeft geen prijs.';
    end if;
    if per_beurt <= 0 or per_beurt > 1000 then
      raise exception 'De prijs per beurt moet tussen 0 en 1.000 euro liggen.';
    end if;
    if verwacht is not null and abs(verwacht - per_beurt) <= 0.005 then
      verwacht := null;
    end if;
    schoon := stuks * per_beurt;
    klant := adres_rij.klant_id;
    -- Vanaf welke beurt: de oudste wasbeurt die nu nog open staat (niet al
    -- met vooruit betaald), anders de dag na de laatste wasbeurt, anders
    -- vandaag. De beginstand van de papieren kaart doet niet mee.
    select min(x.datum) into begint from public.geld_posten(bedrijf, array[adres_id]) x
      where x.soort = 'wassen' and x.bedrag - x.gedekt > 0.005 and x.vooruit = 0;
    if begint is null then
      select max(x.datum) + 1 into begint from public.geld_posten(bedrijf, array[adres_id]) x
        where x.soort = 'wassen';
    end if;
    begint := coalesce(begint, (moment at time zone 'Europe/Amsterdam')::date);
  elsif soort = 'terugbetaald' then
    select * into st from public.geld_stand(bedrijf, array[adres_id]);
    terug := greatest(0, round(st.vooruit_waarde - st.open, 2));
    if st.vooruit_over = 0 and terug = 0 then
      raise exception 'Er is niets terug te geven.';
    end if;
    if abs(schoon - terug) > 0.005 then
      raise exception 'Het bedrag is intussen veranderd. Kijk opnieuw en probeer het nog eens.';
    end if;
    schoon := terug;
    stuks := least(st.vooruit_over, 99);
  else
    stuks := null;
    per_beurt := null;
  end if;

  if soort = 'ongedaan' then
    select * into oud from public.betaal_gebeurtenissen g
      where g.id = herroept and g.customer_id = adres_id and g.company_id = bedrijf;
    if not found or oud.soort in ('ongedaan', 'beginstand') then
      raise exception 'Dat kan niet ongedaan gemaakt worden.';
    end if;
    if exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = oud.id) then
      return jsonb_build_object('status', 'al_ontvangen', 'botsing', false);
    end if;
    if not eigenaar and not (
      oud.door = auth.uid()
      and (
        (oud.vrijgave_id is not null
         and moment < (select eind_op from public.geldloop_vrijgaven where geldloop_vrijgaven.id = oud.vrijgave_id))
        or (oud.bron = 'dag'
            and (oud.op at time zone 'Europe/Amsterdam')::date = (now() at time zone 'Europe/Amsterdam')::date)
      )
    ) then
      raise exception 'Na de eindtijd kan alleen de eigenaar dit nog herstellen.';
    end if;
    vrij := coalesce(vrij, oud.vrijgave_id);
  end if;

  -- Een andere betaling op hetzelfde adres, vlak ervoor: van een collega, of
  -- twee keer op de knop gedrukt. Alleen van dezelfde soort: eerst de pof
  -- van de kaart betalen en daarna beurten vooruit is juist de bedoeling.
  if soort in ('betaald', 'vooruit') then
    select g.id into botsing from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.soort = geld_boeken.soort and g.id <> geld_boeken.id
        and g.op > moment - interval '30 minutes' and g.op <= moment + interval '1 minute'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc limit 1;
  end if;

  insert into public.betaal_gebeurtenissen
    (id, company_id, customer_id, adres, soort, bedrag, reden, vaste_korting_id, herroept_id,
     vrijgave_id, bron, door, door_naam, op, getoond_open, botsing_met,
     aantal, prijs_per_beurt, vanaf, klant_id, prijs_verwacht)
  values
    (geld_boeken.id, bedrijf, adres_id, public.geld_adres_tekst(adres_id), soort, schoon, tekst,
     case when soort = 'korting' then vaste_korting end,
     case when soort = 'ongedaan' then herroept end,
     vrij, bron, auth.uid(), public.geld_mijn_naam(), moment,
     round(getoond_open, 2), botsing,
     stuks,
     case when soort = 'vooruit' then per_beurt end,
     case when soort = 'vooruit' then begint end,
     case when soort = 'vooruit' then klant end,
     case when soort = 'vooruit' then verwacht end)
  on conflict do nothing;
  get diagnostics nieuw = row_count;

  -- Beurten erbij of eraf: misschien kan een geplande wissel nu door (of
  -- moet een doorgegane terug).
  if nieuw > 0 and soort in ('vooruit', 'terugbetaald', 'ongedaan') then
    perform public.betaalwissels_bijwerken(bedrijf, array[adres_id]);
  end if;

  return jsonb_build_object('status', 'nieuw', 'botsing', botsing is not null,
                            'prijs_afwijkend', verwacht is not null and soort = 'vooruit');
end
$$;
revoke execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) from public, anon;
grant execute on function public.geld_boeken(uuid, uuid, text, numeric, text, uuid, uuid, timestamptz, numeric, text, int, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Dag klaar en heropenen: de wissel bijhouden
-- ---------------------------------------------------------------------
-- Gelijk aan de versie uit factuurregels_bij_afmelden, met de wissel erbij:
-- vóór het vastleggen van de methode (komt er langs een andere weg een beurt
-- vrij, dan is het adres weer contant) en erna, vóór de factuurregels (is de
-- laatste vooruit-beurt nu op, dan gaat de volgende via overmaken).
create or replace function public.dag_afmelden(dag date, ploeg smallint, weg uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  wegIds uuid[];
  kenmerk uuid;
  gedaan integer;
  nieuw uuid;
  regels integer;
  adressen uuid[];
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if dag is null or dag > vandaag then
    raise exception 'Een dag kun je pas afmelden als hij begonnen is.';
  end if;

  perform set_config('wooshy.gedaan', '1', true);
  select coalesce(array_agg(r.customer_id), '{}') into wegIds
    from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg
      and r.customer_id = any (coalesce(weg, '{}'));
  if cardinality(wegIds) > 0 then
    kenmerk := public.wasdag_weghalen(dag, wegIds);
  end if;

  select coalesce(array_agg(r.customer_id), '{}') into adressen
    from public.wasdag_regels r
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg and r.gedaan_op is null and r.customer_id is not null;
  perform public.betaalwissels_bijwerken(bedrijf, adressen);

  update public.wasdag_regels r
    set gedaan_op = now(),
        gedaan_door = auth.uid(),
        betaalmethode = coalesce(
          (select coalesce(cu.betaalmethode, d.betaalmethode, 'contant')
             from public.customers cu
             left join public.streets s on s.id = cu.street_id
             left join public.districts d on d.id = s.district_id
            where cu.id = r.customer_id),
          'contant')
    where r.company_id = bedrijf and r.datum = dag
      and r.ploeg_nr is not distinct from ploeg and r.gedaan_op is null;
  get diagnostics gedaan = row_count;

  perform public.betaalwissels_bijwerken(bedrijf, adressen);

  insert into public.dag_afmeldingen (company_id, datum, ploeg_nr, door, door_naam, gedaan, weg, weg_kenmerk)
    values (bedrijf, dag, ploeg, auth.uid(), public.geld_mijn_naam(), gedaan, cardinality(wegIds), kenmerk)
    returning id into nieuw;

  regels := public.factuurregels_maken(dag);

  return jsonb_build_object('id', nieuw, 'gedaan', gedaan, 'weg', cardinality(wegIds),
                            'factuurregels', regels);
end
$$;
revoke execute on function public.dag_afmelden(date, smallint, uuid[]) from public, anon;
grant execute on function public.dag_afmelden(date, smallint, uuid[]) to authenticated;

-- Gelijk aan de versie uit factuurregels_bij_afmelden; aan het eind de
-- wissel: komt er een vooruit-beurt vrij, dan wordt het adres weer contant.
create or replace function public.dag_heropenen(dag date, ploeg smallint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  a public.dag_afmeldingen;
  n integer;
  adressen uuid[];
begin
  if bedrijf is null or not public.heeft_recht('planning') then
    raise exception 'Je rol mag de planning niet aanpassen.';
  end if;
  if not public.is_eigenaar() then
    if not exists (
      select 1 from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    ) then
      raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
    end if;
    for a in
      select * from public.dag_afmeldingen
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null
    loop
      if not public.dag_afmelding_mag_open(a) then
        raise exception 'Alleen de eigenaar kan een afgemelde dag weer openzetten.';
      end if;
    end loop;
  end if;

  -- Eerst de factuurregels: gaat dat niet, dan blijft de dag afgemeld staan.
  perform public.factuurregels_terug(dag);

  perform set_config('wooshy.gedaan', '1', true);
  update public.dag_afmeldingen
    set heropend_op = now(), heropend_door = auth.uid(), heropend_naam = public.geld_mijn_naam()
    where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and heropend_op is null;
  with u as (
    update public.wasdag_regels
      set gedaan_op = null, gedaan_door = null, betaalmethode = null
      where company_id = bedrijf and datum = dag and ploeg_nr is not distinct from ploeg and gedaan_op is not null
      returning customer_id
  )
  select count(*), coalesce(array_agg(customer_id) filter (where customer_id is not null), '{}')
    into n, adressen from u;

  perform public.betaalwissels_bijwerken(bedrijf, adressen);
  return n;
end
$$;
revoke execute on function public.dag_heropenen(date, smallint) from public, anon;
grant execute on function public.dag_heropenen(date, smallint) to authenticated;

-- "Niet gewassen" aan de deur: de beurt telt niet meer, dus een vooruit-beurt
-- kan vrijkomen. Gelijk aan de versie uit niet_gewassen_blijft_staan.
create or replace function public.geldloop_niet_gewassen(adres_id uuid, dag date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  vrij uuid := public.geldloop_dossier_toegang(adres_id);
  r public.wasdag_regels;
  naam text := public.geld_mijn_naam();
  tekst text := public.geld_adres_tekst(adres_id);
begin
  -- Een geldloper meldt dit aan de deur, dus over de avond waarop hij loopt.
  if vrij is not null and not public.is_eigenaar() and not exists (
    select 1 from public.geldloop_vrijgaven v where v.id = vrij and v.datum = dag
  ) then
    raise exception 'Dat kan alleen voor de dag van je eigen avond.';
  end if;

  -- De laatste wasbeurt van die maand die al gewassen én afgemeld is. Wat nog
  -- gepland staat blijft staan: daar is nog niets mee misgegaan.
  select * into r from public.wasdag_regels w
   where w.customer_id = adres_id and w.company_id = bedrijf
     and date_trunc('month', w.datum) = date_trunc('month', dag)
     and w.datum <= dag
     and w.gedaan_op is not null
     and w.niet_gewassen_op is null
   order by w.datum desc
   limit 1;
  if not found then
    if exists (
      select 1 from public.wasdag_regels w
       where w.customer_id = adres_id and w.company_id = bedrijf
         and date_trunc('month', w.datum) = date_trunc('month', dag)
         and w.niet_gewassen_op is not null
    ) then
      raise exception 'Deze maand staat al als niet gewassen gemeld op dit adres.';
    end if;
    raise exception 'Er is deze maand geen wasbeurt afgemeld op dit adres.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  insert into public.geldloop_wijzigingen
    (company_id, customer_id, vrijgave_id, soort, voor, na, adres, door_naam)
  values (bedrijf, adres_id, vrij, 'niet_gewassen',
          jsonb_build_object('id', r.id, 'datum', r.datum, 'gemarkeerd', true),
          '{}'::jsonb, tekst, naam);

  update public.wasdag_regels
    set niet_gewassen_op = now(), niet_gewassen_door = auth.uid(), niet_gewassen_naam = naam
    where id = r.id;

  perform public.betaalwissels_bijwerken(bedrijf, array[adres_id]);
end
$fn$;
revoke execute on function public.geldloop_niet_gewassen(uuid, date) from public, anon;
grant execute on function public.geldloop_niet_gewassen(uuid, date) to authenticated;

-- Terugdraaien kan een beurt weer laten meetellen (of juist niet): daarna
-- de wissel bijwerken. Gelijk aan de versie uit niet_gewassen_blijft_staan.
create or replace function public.geldloop_wijziging_terugdraaien(wijziging uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  w public.geldloop_wijzigingen;
  nu jsonb;
begin
  select * into w from public.geldloop_wijzigingen where id = wijziging and company_id = bedrijf for update;
  if not found then
    raise exception 'Die wijziging bestaat niet.';
  end if;
  if w.teruggedraaid_op is not null then
    raise exception 'Deze wijziging is al teruggedraaid.';
  end if;
  if not public.is_eigenaar() and not (
    w.door = auth.uid() and w.vrijgave_id is not null and public.geldloop_loopt_voor_mij(w.vrijgave_id)
  ) then
    raise exception 'Na de eindtijd kan alleen de eigenaar dit nog terugdraaien.';
  end if;
  perform set_config('wooshy.geldloop', '1', true);

  if w.soort = 'adres' then
    select jsonb_build_object('note', c.note, 'interval_maanden', c.interval_maanden,
                              'ritme', c.ritme, 'maandwerk', public.maandwerk_kern(c.maandwerk))
      into nu from public.customers c where c.id = w.customer_id;
    if nu is distinct from (w.na || jsonb_build_object('maandwerk', public.maandwerk_kern(w.na -> 'maandwerk'))) then
      raise exception 'Dit adres is intussen opnieuw gewijzigd; pas het in het dossier zelf aan.';
    end if;
    update public.customers set
      note = w.voor ->> 'note',
      interval_maanden = (w.voor ->> 'interval_maanden')::int,
      ritme = (w.voor ->> 'ritme')::int,
      maandwerk = w.voor -> 'maandwerk'
    where id = w.customer_id;
  elsif w.soort = 'prijs' then
    select jsonb_build_object('prijs', ap.prijs, 'maandwerk_extra', ap.maandwerk_extra)
      into nu from public.adres_prijzen ap where ap.customer_id = w.customer_id;
    if nu is distinct from w.na then
      raise exception 'De prijs is intussen opnieuw gewijzigd; pas hem in het dossier zelf aan.';
    end if;
    update public.adres_prijzen set
      prijs = (w.voor ->> 'prijs')::numeric,
      maandwerk_extra = w.voor -> 'maandwerk_extra'
    where customer_id = w.customer_id;
  elsif w.soort = 'klant' then
    select jsonb_build_object('naam', coalesce(k.naam, ''), 'telefoon', coalesce(k.telefoon, ''),
                              'telefoon2', coalesce(k.telefoon2, ''), 'email', coalesce(k.email, ''),
                              'email2', coalesce(k.email2, ''), 'klant_id', k.id)
      into nu from public.klanten k where k.id = (w.na ->> 'klant_id')::uuid;
    if nu is distinct from w.na then
      raise exception 'De klantgegevens zijn intussen opnieuw gewijzigd; pas ze in het dossier zelf aan.';
    end if;
    update public.klanten set
      naam = w.voor ->> 'naam', telefoon = w.voor ->> 'telefoon', telefoon2 = w.voor ->> 'telefoon2',
      email = w.voor ->> 'email', email2 = w.voor ->> 'email2'
    where id = (w.voor ->> 'klant_id')::uuid;
  elsif w.soort = 'klant_nieuw' then
    -- Terug naar wie er eerst aan het adres hing (ook een verhuisde klant, die
    -- met het terugdraaien van "laten stoppen" terugkomt), of naar niemand.
    update public.customers set klant_id = nullif(w.voor ->> 'klant_id', '')::uuid
      where id = w.customer_id and klant_id = (w.na ->> 'klant_id')::uuid;
    -- Klachten van dit adres die intussen aan de nieuwe klant hingen, gaan mee.
    update public.klachten set klant_id = nullif(w.voor ->> 'klant_id', '')::uuid
      where customer_id = w.customer_id and klant_id = (w.na ->> 'klant_id')::uuid;
    update public.klanten set deleted_at = now()
      where id = (w.na ->> 'klant_id')::uuid and deleted_at is null
        and not exists (select 1 from public.customers c where c.klant_id = klanten.id)
        and not exists (select 1 from public.klachten k where k.klant_id = klanten.id)
        and not exists (select 1 from public.berichten b where b.klant_id = klanten.id);
  elsif w.soort = 'stoppen' then
    if public.stoppen_terugdraaien(w.na) = 0 then
      raise exception 'Dit adres is intussen opnieuw gewijzigd; zet het in het dossier zelf weer actief.';
    end if;
  elsif w.soort = 'niet_gewassen' then
    if coalesce((w.voor ->> 'gemarkeerd')::boolean, false) then
      -- De regel is blijven staan: het stempel eraf halen is genoeg.
      update public.wasdag_regels
        set niet_gewassen_op = null, niet_gewassen_door = null, niet_gewassen_naam = null
        where id = (w.voor ->> 'id')::uuid and niet_gewassen_op is not null;
      if not found then
        raise exception 'Deze wasbeurt staat niet meer als niet gewassen gemeld.';
      end if;
    else
      -- Oude regels, van vóór deze migratie: de hele wasbeurt was weggehaald.
      if exists (
        select 1 from public.wasdag_regels r
         where r.customer_id = w.customer_id and r.datum = (w.voor ->> 'datum')::date
      ) then
        raise exception 'Dit adres staat alweer op die dag ingepland.';
      end if;
      perform set_config('wooshy.gedaan', '1', true);
      insert into public.wasdag_regels
        select * from jsonb_populate_record(null::public.wasdag_regels, w.voor - 'prijs');
      if jsonb_typeof(w.voor -> 'prijs') = 'number' then
        update public.wasdag_prijzen wp
          set prijs = (w.voor ->> 'prijs')::numeric
          where wp.regel_id = (w.voor ->> 'id')::uuid;
      end if;
    end if;
  end if;

  update public.geldloop_wijzigingen
    set teruggedraaid_op = now(), teruggedraaid_door = auth.uid(), teruggedraaid_naam = public.geld_mijn_naam()
    where id = wijziging;

  perform public.betaalwissels_bijwerken(bedrijf, array[w.customer_id]);
end
$$;
revoke execute on function public.geldloop_wijziging_terugdraaien(uuid) from public, anon;
grant execute on function public.geldloop_wijziging_terugdraaien(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Wat de app ziet
-- ---------------------------------------------------------------------

-- Overdag bij de wasser: een beurt die met vooruit betaald wordt staat niet
-- open; alleen een meerprijs boven de gewone prijs (was: 20261011150000_geldloop_herstel.sql).
create or replace function public.dag_geld_stand(adres_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  st record;
  vandaag_prijs numeric;
  vandaag_normaal numeric;
  gedekt boolean;
  erbij numeric;
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if bedrijf is null or not public.dag_geld_toegang(adres_id) then
    return null;
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres_id]);
  select wp.prijs, coalesce(nullif(wp.normaal, 0), wp.prijs) into vandaag_prijs, vandaag_normaal
    from public.wasdag_regels r join public.wasdag_prijzen wp on wp.regel_id = r.id
    where r.customer_id = adres_id and r.datum = vandaag and r.gedaan_op is null
      -- Alleen als hij straks ook echt meetelt (na de start van de wijk).
      and exists (select 1 from public.contant_periodes p
                  where p.customer_id = adres_id and vandaag >= p.vanaf and (p.tot is null or vandaag <= p.tot));
  gedekt := coalesce(vandaag_prijs, 0) > 0 and st.vooruit_over - st.vooruit_vast > 0;
  erbij := case when gedekt then greatest(0, vandaag_prijs - vandaag_normaal) else coalesce(vandaag_prijs, 0) end;
  return jsonb_build_object(
    'open', st.open + erbij,
    'open_wassen', st.open_wassen + case when coalesce(vandaag_prijs, 0) > 0 and not gedekt then 1 else 0 end,
    'delen', st.delen || case when erbij > 0
                              then jsonb_build_array(jsonb_build_object(
                                'soort', 'wassen', 'datum', vandaag, 'bedrag', vandaag_prijs,
                                'rest', erbij, 'aantal', 1, 'omschrijving', '',
                                'vooruit', vandaag_prijs - erbij))
                              else '[]'::jsonb end,
    'vooruit_over', st.vooruit_over,
    'vandaag', (select jsonb_build_object('id', g.id, 'bedrag', g.bedrag, 'door', g.door,
                                          'door_naam', g.door_naam, 'op', g.op)
                from public.betaal_gebeurtenissen g
                where g.customer_id = adres_id and g.bron = 'dag' and g.soort = 'betaald'
                  and (g.op at time zone 'Europe/Amsterdam')::date = vandaag
                  and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                order by g.op desc limit 1)
  );
end
$$;
revoke execute on function public.dag_geld_stand(uuid) from public, anon;
grant execute on function public.dag_geld_stand(uuid) to authenticated;

-- Het dossier: de vooruit-beurten, wat er terug te geven is, en de wissel
-- (was: 20261011113000_geld_adres_herstel.sql).
create or replace function public.geld_adres(adres uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  bedrijf uuid := public.current_company_id();
  st record;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers c where c.id = adres and c.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select * into st from public.geld_stand(bedrijf, array[adres]);
  return jsonb_build_object(
    'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
    'vooruit_over', st.vooruit_over, 'vooruit_waarde', st.vooruit_waarde, 'vooruit_vast', st.vooruit_vast,
    -- Wat er terug moet als de klant nu stopt: resterende beurten plus
    -- tegoed, min wat er nog open staat.
    'terug', greatest(0, round(st.vooruit_waarde - st.open, 2)),
    'vooruit_p', public.vooruit_prijs(adres),
    'wissel', (select case when c.wissel_status is null then null else jsonb_build_object(
                 'status', c.wissel_status, 'vorige', c.wissel_vorige,
                 'gepland_op', c.wissel_gepland_op, 'gepland_naam', c.wissel_gepland_naam,
                 'uitgevoerd_op', c.wissel_uitgevoerd_op, 'periode_tot', c.wissel_periode_tot) end
               from public.customers c where c.id = adres),
    'gebeurtenissen', coalesce((
      select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op desc)
      from public.betaal_gebeurtenissen g
      where g.customer_id = adres and g.company_id = bedrijf and g.soort <> 'ongedaan'
    ), '[]'::jsonb),
    'vaste_kortingen', coalesce((
      select jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag,
                                          'door_naam', vk.gemaakt_naam, 'op', vk.gemaakt_op)
                       order by vk.gemaakt_op)
      from public.vaste_kortingen vk where vk.customer_id = adres and vk.deleted_at is null
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.geld_adres(uuid) from public, anon;
grant execute on function public.geld_adres(uuid) to authenticated;

-- De pof-lijst: ook gestopte adressen (of met een nieuwe bewoner) waar nog
-- vooruit-beurten terug te geven zijn (was: 20261011140000_geld_herstel.sql).
create or replace function public.geld_pof(wijken uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  adressen uuid[];
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  -- Alleen adressen die ooit contant betaalden (of een beginstand hebben).
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c
    join public.streets s on s.id = c.street_id and s.deleted_at is null
    join public.districts d on d.id = s.district_id and d.deleted_at is null
    where c.company_id = bedrijf and c.deleted_at is null
      and (wijken is null or s.district_id = any (wijken))
      and (exists (select 1 from public.contant_periodes p where p.customer_id = c.id)
           or exists (select 1 from public.betaal_gebeurtenissen g where g.customer_id = c.id));
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'wijk_id', d.id, 'wijk', d.name, 'straat_id', s.id, 'straat', s.name,
      'house_number', c.house_number, 'addition', coalesce(c.addition, ''),
      'naam', coalesce(k.naam, ''), 'methode', coalesce(c.betaalmethode, d.betaalmethode),
      'gestopt', c.inactief_op is not null,
      'open', st.open, 'open_wassen', st.open_wassen, 'delen', st.delen,
      'vooruit_over', st.vooruit_over, 'vooruit_waarde', st.vooruit_waarde, 'vooruit_vast', st.vooruit_vast,
      'terug', greatest(0, round(st.vooruit_waarde - st.open, 2)),
      'laatst_betaald', (select max(g.op) from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('betaald', 'vooruit')
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
      'laatste_poging', (select jsonb_build_object('soort', g.soort, 'op', g.op, 'door_naam', g.door_naam)
                         from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('niet_thuis', 'geen_geld')
                           and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
                         order by g.op desc limit 1)
    ) order by st.open desc)
    from public.geld_stand(bedrijf, adressen) st
    join public.customers c on c.id = st.customer_id
    join public.streets s on s.id = c.street_id
    join public.districts d on d.id = s.district_id
    left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
    where abs(st.open) > 0.005 or st.vooruit_vast > 0
  ), '[]'::jsonb);
end
$$;
revoke execute on function public.geld_pof(uuid[]) from public, anon;
grant execute on function public.geld_pof(uuid[]) to authenticated;

-- De kaart: per adres hoeveel beurten nog vooruit staan, per post wat met
-- vooruit betaald is (was: 20261014090000_ronde_per_beurt.sql).
create or replace function public.geld_kaart(straat uuid, jaar int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  adressen uuid[];
  tot timestamptz := (make_date(jaar + 1, 1, 1)::timestamp) at time zone 'Europe/Amsterdam';
  wijk record;
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  select d.id, d.name, d.geld_peildatum, d.betaalmethode into wijk
    from public.streets s join public.districts d on d.id = s.district_id
    where s.id = straat and s.company_id = bedrijf;
  if not found then
    raise exception 'Die straat bestaat niet.';
  end if;
  select coalesce(array_agg(c.id), '{}') into adressen
    from public.customers c where c.street_id = straat and c.company_id = bedrijf and c.deleted_at is null;

  return jsonb_build_object(
    'wijk', jsonb_build_object('id', wijk.id, 'naam', wijk.name, 'peildatum', wijk.geld_peildatum,
                               'betaalmethode', wijk.betaalmethode),
    'adressen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'posten', coalesce((
          select jsonb_agg(jsonb_build_object(
            'soort', p.soort, 'datum', p.datum, 'bedrag', p.bedrag, 'aantal', p.aantal,
            'omschrijving', p.omschrijving, 'gedekt', p.gedekt,
            -- Bij een wasbeurt: in welk maandvakje hij hoort.
            'ronde', case when p.soort = 'wassen' then
              (select w.ronde from public.wasdag_regels w where w.id = p.ref) end,
            'betaald_soort', p.betaald_soort, 'betaald_op', p.betaald_op, 'betaald_door', p.betaald_door,
            'vooruit', p.vooruit
          ) order by p.datum)
          from public.geld_posten_betaald(bedrijf, array[c.id]) p
        ), '[]'::jsonb),
        'vooruit_over', coalesce((
          select sum(v.aantal) from public.geld_vooruit(bedrijf, array[c.id]) v
          where v.soort in ('over', 'over_vast')), 0),
        'vooruit_vast', coalesce((
          select sum(v.aantal) from public.geld_vooruit(bedrijf, array[c.id]) v
          where v.soort = 'over_vast'), 0),
        'gebeurtenissen', coalesce((
          select jsonb_agg(public.geld_gebeurtenis_json(g) order by g.op)
          from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.soort <> 'ongedaan' and g.op < tot
        ), '[]'::jsonb)
      ) order by c.sort_order, c.house_number)
      from public.customers c where c.id = any (adressen)
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.geld_kaart(uuid, int) from public, anon;
grant execute on function public.geld_kaart(uuid, int) to authenticated;

-- De looplijst: per adres de vooruit-beurten en de prijs per beurt, vooruit
-- telt als opgehaald en als "vanavond gedaan" (was: 20261014090000_ronde_per_beurt.sql).
create or replace function public.geldloop_lijst(vrijgave uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  ids uuid[];
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not (
    v.ingetrokken_op is null and now() >= v.begin_op and now() < v.eind_op
    and exists (select 1 from public.geldloop_vrijgave_lopers l
                where l.vrijgave_id = v.id and l.employee_id = auth.uid())
  ) then
    raise exception 'Deze wijk is nu niet voor je vrijgegeven.';
  end if;

  select array_agg(c.id) into ids
    from public.customers c
    join public.streets s on s.id = c.street_id
    join public.geldloop_vrijgave_wijken w on w.district_id = s.district_id and w.vrijgave_id = v.id
    where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null;

  return (
    with basis as (
      select
        c.id, c.house_number, c.addition, c.sort_order, c.hoek_kant, c.note,
        c.interval_maanden, c.ritme, c.inactief_op, c.betaalmethode, c.klant_id,
        s.id as straat_id, s.name as straat, s.sort_order as straat_sort,
        s.sort_desc, s.doorlopend,
        d.id as wijk_id, d.name as wijk, d.sort_order as wijk_sort, d.betaalmethode as wijk_methode,
        k.naam as klantnaam,
        st.open, st.open_wassen, st.delen, st.vooruit_over, st.vooruit_waarde,
        public.vooruit_prijs(c.id) as vooruit_p,
        (select coalesce(array_agg(sl.employee_id order by sl.employee_id), '{}')
           from public.geldloop_straat_lopers sl
          where sl.vrijgave_id = v.id and sl.street_id = s.id) as lopers,
        -- Staat er deze maand nog een beurt te doen? Dan is dit adres nog niet
        -- aan de beurt om op te halen. Een beurt die als niet gewassen is
        -- gemeld telt hier niet mee: die is afgehandeld, en de geldloper moet
        -- er wél kunnen blijven staan voor de pof van eerder.
        exists (select 1 from public.wasdag_regels wr
                 where wr.customer_id = c.id and wr.company_id = bedrijf
                   and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
                   and wr.gedaan_op is null
                   and wr.niet_gewassen_op is null) as wacht,
        (select jsonb_build_object('id', g.id, 'soort', g.soort, 'bedrag', g.bedrag, 'op', g.op,
                                   'door', g.door, 'door_naam', g.door_naam, 'aantal', g.aantal)
           from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.vrijgave_id = v.id
            and g.soort in ('betaald', 'vooruit', 'niet_thuis', 'geen_geld')
            and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
          order by g.op desc limit 1) as vanavond
      from public.geld_stand(bedrijf, coalesce(ids, '{}')) st
      join public.customers c on c.id = st.customer_id
      join public.streets s on s.id = c.street_id
      join public.districts d on d.id = s.district_id
      left join public.klanten k on k.id = c.klant_id and k.deleted_at is null
      where c.inactief_op is null or st.open <> 0
    ),
    geteld as (
      select
        (b.vanavond is not null) as gedaan,
        (b.open > 0.005 and b.vanavond is null and not b.wacht) as nog_open,
        (coalesce(cardinality(b.lopers), 0) = 0 or auth.uid() = any (b.lopers)) as van_mij,
        b.straat_id
      from basis b
    )
    select jsonb_build_object(
      'vrijgave', jsonb_build_object('id', v.id, 'datum', v.datum, 'begin_op', v.begin_op,
                                     'eind_op', v.eind_op, 'ingetrokken', v.ingetrokken_op is not null),
      'adressen', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'wijk_id', b.wijk_id, 'wijk', b.wijk, 'wijk_sort', b.wijk_sort,
          'straat_id', b.straat_id, 'straat', b.straat, 'straat_sort', b.straat_sort,
          'sort_desc', b.sort_desc, 'doorlopend', b.doorlopend,
          'house_number', b.house_number, 'addition', coalesce(b.addition, ''),
          'sort_order', b.sort_order, 'hoek_kant', coalesce(b.hoek_kant, ''),
          'naam', coalesce(b.klantnaam, ''),
          'note', coalesce(b.note, ''),
          'interval_maanden', b.interval_maanden, 'ritme', b.ritme,
          'methode', coalesce(b.betaalmethode, b.wijk_methode),
          'gestopt', b.inactief_op is not null,
          'wacht_op_wasbeurt', b.wacht,
          'open', b.open, 'open_wassen', b.open_wassen, 'delen', b.delen,
          'vooruit_over', b.vooruit_over, 'vooruit_waarde', b.vooruit_waarde, 'vooruit_p', b.vooruit_p,
          'straat_lopers', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', e.id, 'naam', coalesce(nullif(e.naam, ''), e.email)) order by e.naam), '[]')
                            from public.employees e where e.id = any (b.lopers)),
          'klachten', (select coalesce(jsonb_agg(kl.omschrijving order by kl.ontvangen_op desc), '[]')
                       from public.klachten kl
                       where kl.deleted_at is null and kl.status = 'open'
                         and ((kl.customer_id = b.id and kl.klant_id is not distinct from b.klant_id)
                              or (kl.customer_id is null and kl.klant_id = b.klant_id))),
          'vaste_kortingen', (select coalesce(jsonb_agg(jsonb_build_object('id', vk.id, 'naam', vk.naam, 'bedrag', vk.bedrag)
                                                        order by vk.gemaakt_op), '[]')
                              from public.vaste_kortingen vk where vk.customer_id = b.id and vk.deleted_at is null),
          'kortingen_vanavond', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id', g.id, 'bedrag', g.bedrag, 'reden', g.reden,
                                     'door', g.door, 'door_naam', g.door_naam, 'op', g.op) order by g.op), '[]')
                                 from public.betaal_gebeurtenissen g
                                 where g.customer_id = b.id and g.vrijgave_id = v.id and g.soort = 'korting'
                                   and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)),
          'vanavond', b.vanavond
        ))
        from basis b
      ), '[]'::jsonb),
      'opgehaald', (select jsonb_build_object(
                      'mij', coalesce(sum(g.bedrag) filter (where g.door = auth.uid()), 0),
                      'mij_aantal', count(*) filter (where g.door = auth.uid()),
                      -- Wat het team samen ophaalde is voor de eigenaar; een
                      -- loper ziet alleen zijn eigen tas. Het weglaten aan deze
                      -- kant scheelt dat het meereist naar een telefoon die het
                      -- niet hoort te weten.
                      'totaal', case when public.is_eigenaar()
                                     then coalesce(sum(g.bedrag), 0) else 0 end)
                    from public.betaal_gebeurtenissen g
                    where g.vrijgave_id = v.id and g.soort in ('betaald', 'vooruit')
                      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id))
                   || (select jsonb_build_object(
                        'mijn_open', count(*) filter (where t.nog_open and t.van_mij),
                        'mijn_gedaan', count(*) filter (where t.gedaan and t.van_mij),
                        'mijn_straten_open', count(distinct t.straat_id) filter (where t.nog_open and t.van_mij),
                        'samen_open', count(*) filter (where t.nog_open),
                        'samen_gedaan', count(*) filter (where t.gedaan),
                        'samen_straten_open', count(distinct t.straat_id) filter (where t.nog_open))
                      from geteld t)
    )
  );
end
$$;
revoke execute on function public.geldloop_lijst(uuid) from public, anon;
grant execute on function public.geldloop_lijst(uuid) to authenticated;

-- Eerlijk verdelen: een vooruitbetaling vanavond telt als gedaan (was: 20261014090000_ronde_per_beurt.sql).
create or replace function public.geldloop_straten_eerlijk(vrijgave uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  v public.geldloop_vrijgaven;
  mensen uuid[];
  hoeveel integer;
  route jsonb;
  totaal numeric := 0;
  doel numeric;
  gelopen numeric := 0;
  beurt integer := 1;
  r record;
  verdeeld integer := 0;
begin
  select * into v from public.geldloop_vrijgaven where id = vrijgave and company_id = bedrijf;
  if not found then
    raise exception 'Die avond bestaat niet.';
  end if;
  if not public.is_eigenaar() and not public.geldloop_loopt_voor_mij(vrijgave) then
    raise exception 'Je loopt deze avond niet, dus je kunt de straten niet verdelen.';
  end if;

  select coalesce(array_agg(employee_id order by employee_id), '{}') into mensen
    from public.geldloop_vrijgave_lopers where vrijgave_id = v.id;
  hoeveel := coalesce(cardinality(mensen), 0);
  if hoeveel < 2 then
    raise exception 'Er loopt maar één iemand: er valt niets te verdelen.';
  end if;

  -- De straten van deze avond op een rij, in de volgorde van de wijkkaart,
  -- met per straat zijn gewicht. Straten zonder stuk staan achter de stukken
  -- van hun eigen wijk, net als op de wijkenpagina.
  with alle_adressen as (
    select array_agg(c.id) as ids
      from public.customers c
      join public.streets s on s.id = c.street_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
     where c.company_id = bedrijf and c.deleted_at is null and s.deleted_at is null
  ),
  stand as (
    select * from public.geld_stand(bedrijf, coalesce((select ids from alle_adressen), '{}'))
  ),
  per_adres as (
    select
      c.street_id,
      (c.inactief_op is null) as actief,
      (
        st.open > 0.005
        and not exists (
          select 1 from public.betaal_gebeurtenissen g
           where g.customer_id = c.id and g.vrijgave_id = v.id
             and g.soort in ('betaald', 'vooruit', 'niet_thuis', 'geen_geld')
             and not exists (select 1 from public.betaal_gebeurtenissen o
                              where o.herroept_id = g.id)
        )
        and not exists (
          select 1 from public.wasdag_regels wr
           where wr.customer_id = c.id and wr.company_id = bedrijf
             and (date_trunc('month', wr.datum) = date_trunc('month', v.datum)
                        or wr.ronde = to_char(v.datum, 'YYYY-MM'))
             and wr.gedaan_op is null
             and wr.niet_gewassen_op is null
        )
      ) as telt
      from stand st
      join public.customers c on c.id = st.customer_id
  ),
  per_straat as (
    select
      s.id,
      d.sort_order as wijk_sort,
      coalesce(g.sort_order, 1000000) as stuk_sort,
      s.sort_order as straat_sort,
      s.name as naam,
      count(*) filter (where a.telt) * 1000 + count(*) filter (where a.actief) as gewicht
      from public.streets s
      join public.districts d on d.id = s.district_id
      join public.geldloop_vrijgave_wijken w
        on w.district_id = s.district_id and w.vrijgave_id = v.id
      left join public.straat_groepen g on g.id = s.groep_id
      left join per_adres a on a.street_id = s.id
     where s.company_id = bedrijf and s.deleted_at is null
     group by s.id, d.sort_order, g.sort_order, s.sort_order, s.name
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', p.id, 'gewicht', p.gewicht)
                     order by p.wijk_sort, p.stuk_sort, p.straat_sort, p.naam),
           '[]'::jsonb)
    into route
    from per_straat p;

  select coalesce(sum((e ->> 'gewicht')::numeric), 0) into totaal
    from jsonb_array_elements(route) e;
  doel := case when totaal > 0 then totaal / hoeveel else 0 end;

  -- In één keer schoon, en daarna rechtstreeks wegschrijven: zo staat deze
  -- klik niet als dertig regels in het logboek van de avond.
  delete from public.geldloop_straat_lopers sl
    using public.streets s, public.geldloop_vrijgave_wijken w
    where sl.vrijgave_id = v.id and s.id = sl.street_id
      and w.vrijgave_id = v.id and w.district_id = s.district_id;

  for r in
    select (e ->> 'id')::uuid as id, (e ->> 'gewicht')::numeric as gewicht
      from jsonb_array_elements(route) e
  loop
    insert into public.geldloop_straat_lopers (vrijgave_id, street_id, employee_id, company_id)
      values (v.id, r.id, mensen[beurt], bedrijf);
    verdeeld := verdeeld + 1;
    gelopen := gelopen + r.gewicht;
    -- Zodra dit stuk zijn deel heeft, gaat de volgende loper verder waar
    -- deze ophoudt. Eén knip per loper: een enkele grote straat schuift dus
    -- niemand over.
    if beurt < hoeveel and doel > 0 and gelopen >= doel * beurt then
      beurt := beurt + 1;
    end if;
  end loop;

  return jsonb_build_object('straten', verdeeld, 'lopers', hoeveel);
end
$$;
revoke execute on function public.geldloop_straten_eerlijk(uuid) from public, anon;
grant execute on function public.geldloop_straten_eerlijk(uuid) to authenticated;
