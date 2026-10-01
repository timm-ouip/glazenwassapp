-- De geldkaart invullen zoals de papieren kaart: meer dan alleen een 0.
--
-- Vóór (en in) de startmaand van de wijk zet je per maand:
--   0        een hele beurt niet betaald: de adresprijs staat open
--   x        niet gewassen: er staat niets open en het telt niet als pof
--   v 8      een eigen letter met een bedrag (v = alleen de voorkant):
--            dat bedrag staat open. De b mag niet: B is al "vooruit betaald".
--   +5       te weinig betaald: er staat nog 5 euro open
-- Na de startmaand:
--   1        die maand was al vooruit betaald, van vóór de app
--
-- Opslag:
--   * De beginstand blijft één rij in betaal_gebeurtenissen (soort
--     'beginstand'), nu met `vakjes`: per maand {maand, teken, bedrag}. Het
--     bedrag van de rij is de som, `aantal` het aantal nullen (hele beurten),
--     `maanden` de maanden waar iets open staat. Oude rijen hebben geen
--     vakjes en rekenen precies zoals altijd.
--   * De enen worden één gewone vooruitbetaling (soort 'vooruit') met bron
--     'kaart': de maanden staan in `maanden`, de beurten gaan vanaf de eerste
--     van die maanden. Hij rekent als elke andere vooruitbetaling (dekken,
--     omrekenen, teruggeven), maar is geen geld van een avond: hij hangt aan
--     geen vrijgave, dus het Avondoverzicht, de looplijst en "opgehaald"
--     tellen hem niet. Het moment is het begin van de peildatum (het geld kwam
--     vóór de app), zodat hij ook als eerste beurten opmaakt.
--   * Wissen of veranderen maakt de vorige rij ongedaan en zet een nieuwe,
--     zoals bij de beginstand altijd al: niets wordt overschreven.
--
-- "3×" (open_wassen): een 0 is één beurt. Een letter of een + is een bedrag
-- en geen hele beurt; die tellen als 0. Staat er in één beginstand een
-- mengeling, dan rekent geld_stand zoals altijd naar verhouding van wat er
-- nog open is (naar boven afgerond).

-- ---------------------------------------------------------------------
-- 1. De vakjes, en de bron 'kaart'
-- ---------------------------------------------------------------------
alter table public.betaal_gebeurtenissen add column vakjes jsonb;

-- Klopt een lijst vakjes? Tussen 1 en 99 maanden, elke maand één keer, een
-- bekend teken (0, x, + of een letter behalve b en x) en een bedrag in
-- centen: x = 0, de rest meer dan 0 en hooguit 10.000.
create or replace function public.geld_vakjes_geldig(v jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(v) = 'array'
    and jsonb_array_length(v) between 1 and 99
    and not exists (
      select 1 from jsonb_array_elements(v) x
      where case
              when jsonb_typeof(x) <> 'object' then true
              when coalesce(x ->> 'maand', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then true
              when coalesce(x ->> 'teken', '') !~ '^([0x+]|[ac-wyz])$' then true
              when jsonb_typeof(x -> 'bedrag') is distinct from 'number' then true
              else (x ->> 'bedrag')::numeric < 0
                or (x ->> 'bedrag')::numeric > 10000
                or round((x ->> 'bedrag')::numeric, 2) <> (x ->> 'bedrag')::numeric
                or (x ->> 'teken' = 'x') <> ((x ->> 'bedrag')::numeric = 0)
            end
    )
    and (select count(distinct x ->> 'maand') = count(*) from jsonb_array_elements(v) x)
$$;
revoke execute on function public.geld_vakjes_geldig(jsonb) from public, anon, authenticated;

alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_vakjes_check check (
  vakjes is null or (soort = 'beginstand' and public.geld_vakjes_geldig(vakjes))
);

alter table public.betaal_gebeurtenissen drop constraint betaal_gebeurtenissen_bron_check;
alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_bron_check check (
  bron in ('geldloop', 'dag', 'kantoor', 'kaart')
);
-- Van de kaart komt alleen een vooruitbetaling, met de maanden erbij.
alter table public.betaal_gebeurtenissen add constraint betaal_gebeurtenissen_kaart_check check (
  bron <> 'kaart' or (soort = 'vooruit' and maanden is not null and vrijgave_id is null)
);

-- ---------------------------------------------------------------------
-- 2. De rekensom: een beginstand met vakjes
--
-- Verder gelijk aan de versie uit 20261016090000_vooruit_betalen.sql. Alleen
-- de beginstand met vakjes rekent anders:
--   * aantal = het aantal nullen, ook als dat 0 is (alleen een +5);
--   * de omschrijving noemt eerst de open maanden ("2026-07,2026-08"), zoals
--     altijd, en daarna per letter of + een merkje ("2026-08=v"). Wie alleen
--     maanden leest (/^\d{4}-\d{2}$/) ziet dus precies wat hij altijd zag.
-- ---------------------------------------------------------------------
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
  select g.customer_id, 'beginstand', g.peildatum, g.bedrag,
         case when g.vakjes is null then greatest(coalesce(g.aantal, 1), 1)
              else coalesce(g.aantal, 0) end::int,
         case when g.vakjes is null then coalesce(array_to_string(g.maanden, ','), '')
              else concat_ws(',',
                     nullif(array_to_string(g.maanden, ','), ''),
                     (select string_agg((v ->> 'maand') || '=' || (v ->> 'teken'), ',' order by v ->> 'maand')
                        from jsonb_array_elements(g.vakjes) v
                        where v ->> 'teken' not in ('0', 'x')))
         end,
         0, g.id
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

-- ---------------------------------------------------------------------
-- 3. De kaart invullen
--
-- `begin_vakjes`: de maanden tot en met de startmaand, als [{maand, teken,
-- bedrag}]. Het bedrag telt alleen bij een letter of een +; bij een 0 neemt
-- de database de adresprijs, bij een x 0. Een 0 die er al stond houdt zijn
-- bedrag, ook uit een oude beginstand (alleen maanden): dan het bedrag
-- gedeeld door de maanden, het restje van de centen in de laatste maand.
-- Leeg ([]) = geen beginstand meer; null = laat de beginstand staan.
-- `vooruit_maanden`: de maanden na de start met een 1. Leeg = geen; null =
-- laat staan. Een nieuwe 1 kan niet in een maand waarvan de wasbeurt al
-- (deels) betaald is: dat geld zou dan naar andere posten schuiven. Wat niet
-- verandert, blijft staan zoals het was.
-- ---------------------------------------------------------------------
create or replace function public.geld_kaart_zetten(
  adres_id uuid,
  begin_vakjes jsonb default null,
  vooruit_maanden text[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  naam text := public.geld_mijn_naam();
  tekst text := public.geld_adres_tekst(adres_id);
  a record;
  peil_maand text;
  oud public.betaal_gebeurtenissen;
  weg uuid;
  nieuw jsonb;
  totaal numeric;
  maanden_nieuw text[];
  per_beurt numeric;
  st record;
begin
  if bedrijf is null or not public.is_eigenaar() then
    raise exception 'Alleen de eigenaar kan de kaart invullen.';
  end if;
  select d.geld_peildatum as peil, coalesce(ap.prijs, 0) as prijs,
         coalesce(cu.betaalmethode, d.betaalmethode, 'contant') as methode,
         cu.inactief_op, cu.deleted_at, cu.klant_id
    into a
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    left join public.adres_prijzen ap on ap.customer_id = cu.id
    where cu.id = adres_id and cu.company_id = bedrijf;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if a.peil is null then
    raise exception 'Kies eerst de datum van de beginstand voor deze wijk.';
  end if;
  peil_maand := to_char(a.peil, 'YYYY-MM');

  -- Vóór de start: de beginstand.
  if begin_vakjes is not null then
    if jsonb_typeof(begin_vakjes) <> 'array'
       or exists (select 1 from jsonb_array_elements(begin_vakjes) x where jsonb_typeof(x) <> 'object') then
      raise exception 'Onbekende invoer.';
    end if;
    if exists (select 1 from jsonb_array_elements(begin_vakjes) x where coalesce(x ->> 'maand', '') > peil_maand) then
      raise exception 'Na de start van de wijk (%) kun je alleen een 1 invullen: vooruit betaald.', peil_maand;
    end if;
    select g.* into oud from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'beginstand'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc, g.id desc
      limit 1;

    select jsonb_agg(jsonb_build_object(
             'maand', x ->> 'maand',
             'teken', lower(x ->> 'teken'),
             'bedrag', case lower(x ->> 'teken')
                         when 'x' then 0
                         when '0' then coalesce((
                           select (y ->> 'bedrag')::numeric
                           from jsonb_array_elements(case when jsonb_typeof(oud.vakjes) = 'array'
                                                          then oud.vakjes else '[]'::jsonb end) y
                           where y ->> 'maand' = x ->> 'maand' and y ->> 'teken' = '0'
                           limit 1), (
                           select case when o.i < o.n then round(oud.bedrag / o.n, 2)
                                       else oud.bedrag - round(oud.bedrag / o.n, 2) * (o.n - 1) end
                           from (select u.m, u.i, cardinality(oud.maanden) as n
                                   from unnest(oud.maanden) with ordinality as u(m, i)) o
                           where oud.vakjes is null and oud.bedrag > 0 and o.m = x ->> 'maand'
                           limit 1), a.prijs)
                         else case when jsonb_typeof(x -> 'bedrag') = 'number'
                                   then round((x ->> 'bedrag')::numeric, 2) end
                       end)
           order by x ->> 'maand')
      into nieuw
      from jsonb_array_elements(begin_vakjes) x;

    if nieuw is not null then
      if exists (select 1 from jsonb_array_elements(nieuw) x
                 where x ->> 'teken' = '0' and (x ->> 'bedrag')::numeric <= 0) then
        raise exception 'Dit adres heeft nog geen prijs, dus Paaltje Systems weet niet wat een maand kost.';
      end if;
      if exists (select 1 from jsonb_array_elements(nieuw) x where x ->> 'teken' = 'b') then
        raise exception 'De B staat al voor vooruit betaald. Kies een andere letter.';
      end if;
      if not public.geld_vakjes_geldig(nieuw) then
        raise exception 'Een vakje klopt niet. Gebruik 0, x, een letter met een bedrag (v 8) of + met een bedrag (+5).';
      end if;
      select sum((x ->> 'bedrag')::numeric) into totaal from jsonb_array_elements(nieuw) x;
      if totaal > 10000 then
        raise exception 'De beginstand mag samen niet meer dan 10.000 euro zijn.';
      end if;
    end if;

    -- Alleen als er echt iets verandert.
    if not ((oud.id is null and nieuw is null) or coalesce(oud.vakjes = nieuw, false)) then
      for weg in
        select g.id from public.betaal_gebeurtenissen g
        where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'beginstand'
          and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      loop
        insert into public.betaal_gebeurtenissen
          (company_id, customer_id, adres, soort, herroept_id, bron, door, door_naam)
          values (bedrijf, adres_id, tekst, 'ongedaan', weg, 'kantoor', auth.uid(), naam);
      end loop;
      if nieuw is not null then
        insert into public.betaal_gebeurtenissen
          (company_id, customer_id, adres, soort, bedrag, aantal, peildatum, maanden, vakjes,
           bron, door, door_naam)
          values (bedrijf, adres_id, tekst, 'beginstand', totaal,
                  (select count(*) from jsonb_array_elements(nieuw) x where x ->> 'teken' = '0'),
                  a.peil,
                  (select array_agg(x ->> 'maand' order by x ->> 'maand')
                     from jsonb_array_elements(nieuw) x where (x ->> 'bedrag')::numeric > 0),
                  nieuw, 'kantoor', auth.uid(), naam);
      end if;
    end if;
  end if;

  -- Na de start: de enen, als één vooruitbetaling van de kaart.
  if vooruit_maanden is not null then
    if exists (select 1 from unnest(vooruit_maanden) m where m is null or m !~ '^\d{4}-(0[1-9]|1[0-2])$') then
      raise exception 'Onbekende maand.';
    end if;
    if exists (select 1 from unnest(vooruit_maanden) m where m <= peil_maand) then
      raise exception 'Een 1 (vooruit betaald) kan alleen in een maand na de start van de wijk (%).', peil_maand;
    end if;
    select array_agg(distinct m order by m) into maanden_nieuw from unnest(vooruit_maanden) m;
    select g.* into oud from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'vooruit' and g.bron = 'kaart'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc, g.id desc
      limit 1;

    if not ((oud.id is null and maanden_nieuw is null) or coalesce(oud.maanden = maanden_nieuw, false)) then
      if maanden_nieuw is not null then
        if a.deleted_at is not null or a.inactief_op is not null then
          raise exception 'Dit adres is gestopt; vooruit betaald kan hier niet meer.';
        end if;
        if a.methode <> 'contant'
           or not exists (select 1 from public.contant_periodes p where p.customer_id = adres_id and p.tot is null) then
          raise exception 'Dit adres betaalt niet contant; vooruit betaald kan hier niet.';
        end if;
        if cardinality(maanden_nieuw) > 12 then
          raise exception 'Hooguit 12 maanden vooruit betaald.';
        end if;
        per_beurt := public.vooruit_prijs(adres_id);
        if per_beurt is null then
          raise exception 'Dit adres heeft nog geen prijs, dus Paaltje Systems weet niet wat een beurt kost.';
        end if;
        -- Een nieuwe 1 niet waar de wasbeurt al met geld of met een andere
        -- vooruitbetaling betaald is (wel als hij nog open staat).
        if exists (
          select 1
          from public.geld_posten_betaald(bedrijf, array[adres_id]) p
          join public.wasdag_regels w on w.id = p.ref
          where p.soort = 'wassen' and p.gedekt > 0.005
            and p.betaald_met is distinct from oud.id
            and coalesce(w.ronde, to_char(p.datum, 'YYYY-MM')) = any (maanden_nieuw)
            and not (coalesce(w.ronde, to_char(p.datum, 'YYYY-MM')) = any (coalesce(oud.maanden, '{}')))
        ) then
          raise exception 'Die maand is al betaald; daar kan geen 1 (vooruit betaald) meer bij.';
        end if;
      end if;

      for weg in
        select g.id from public.betaal_gebeurtenissen g
        where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'vooruit' and g.bron = 'kaart'
          and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      loop
        insert into public.betaal_gebeurtenissen
          (company_id, customer_id, adres, soort, herroept_id, bron, door, door_naam)
          values (bedrijf, adres_id, tekst, 'ongedaan', weg, 'kantoor', auth.uid(), naam);
      end loop;

      if maanden_nieuw is not null then
        -- Zoals bij geld_boeken: eerst de beurten van een vorige bewoner.
        select * into st from public.geld_stand(bedrijf, array[adres_id]);
        if st.vooruit_vast > 0 then
          raise exception 'Geef eerst de vooruitbetaalde beurten van de vorige bewoner terug.';
        end if;
        insert into public.betaal_gebeurtenissen
          (company_id, customer_id, adres, soort, bedrag, aantal, prijs_per_beurt, vanaf, klant_id,
           maanden, reden, bron, door, door_naam, op)
          values (bedrijf, adres_id, tekst, 'vooruit', cardinality(maanden_nieuw) * per_beurt,
                  cardinality(maanden_nieuw), per_beurt, (maanden_nieuw[1] || '-01')::date, a.klant_id,
                  maanden_nieuw, 'van de papieren kaart', 'kaart', auth.uid(), naam,
                  (a.peil::timestamp) at time zone 'Europe/Amsterdam');
      end if;

      -- Beurten erbij of eraf: misschien kan een geplande wissel nu door.
      perform public.betaalwissels_bijwerken(bedrijf, array[adres_id]);
    end if;
  end if;
end
$$;
revoke execute on function public.geld_kaart_zetten(uuid, jsonb, text[]) from public, anon;
grant execute on function public.geld_kaart_zetten(uuid, jsonb, text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Wat de app ziet
-- ---------------------------------------------------------------------

-- De kaart: per adres ook de vakjes van de beginstand en de enen van de
-- kaart, los van het jaar (was: 20261016090000_vooruit_betalen.sql).
--   begin_vakjes   de vakjes van de beginstand, of null (geen beginstand,
--                  of een oude zonder vakjes: dan gelden de maanden)
--   kaart_vooruit  {maanden, aantal, over} van de enen, of null; `over` =
--                  de beurten die er nog niet van gebruikt zijn
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
        'begin_vakjes', (
          select g.vakjes from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.soort = 'beginstand'
            and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
          order by g.op desc, g.id desc limit 1),
        'kaart_vooruit', (
          select jsonb_build_object(
            'maanden', to_jsonb(g.maanden), 'aantal', g.aantal,
            'over', coalesce((select sum(v.aantal) from public.geld_vooruit(bedrijf, array[c.id]) v
                              where v.vooruit_id = g.id and v.soort = 'over'), 0))
          from public.betaal_gebeurtenissen g
          where g.customer_id = c.id and g.soort = 'vooruit' and g.bron = 'kaart'
            and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
          order by g.op desc, g.id desc limit 1),
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

-- De pof-lijst: een 1 van de kaart is geen betaling die je ophaalde, dus
-- telt niet als "laatst betaald". Verder gelijk aan de versie uit
-- 20261016095000_vooruit_terug_per_klant.sql.
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
      'vooruit_vorige', coalesce(vk.vorige, 0), 'vooruit_vorige_waarde', coalesce(vk.vorige_waarde, 0),
      'vooruit_eigen', coalesce(vk.eigen, 0), 'vooruit_eigen_waarde', coalesce(vk.eigen_waarde, 0),
      'terug', public.vooruit_terug(c.inactief_op is not null, vk.vorige_waarde, vk.eigen_waarde, st.open),
      'laatst_betaald', (select max(g.op) from public.betaal_gebeurtenissen g
                         where g.customer_id = c.id and g.soort in ('betaald', 'vooruit')
                           and g.bron <> 'kaart'
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
    left join public.geld_vooruit_klanten(bedrijf, adressen) vk on vk.customer_id = c.id
    where abs(st.open) > 0.005 or st.vooruit_vast > 0
  ), '[]'::jsonb);
end
$$;
revoke execute on function public.geld_pof(uuid[]) from public, anon;
grant execute on function public.geld_pof(uuid[]) to authenticated;
