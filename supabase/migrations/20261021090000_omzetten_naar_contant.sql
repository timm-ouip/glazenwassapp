-- Omzetten naar contant, en de geldkaart van één klant.
--
-- Een klant stond op overmaken (vaak gewoon "zoals de wijk"), maar betaalt
-- eigenlijk contant. Op straat zag de geldloper dan "Deze klant maakt over"
-- en kon hij niets: de maanden die nog open stonden, telden nergens mee.
--
-- Twee stappen, allebei voor de eigenaar en wie mag afrekenen:
--
--   1. "Omzetten naar contant" (geld_naar_contant): blijvend, hetzelfde als
--      in het dossier de betaalwijze op contant zetten. Er is geen
--      "eenmalig contant": wie overmaakt, maakt voor altijd over.
--   2. Daarna de geldkaart van alleen die klant. Elke wasbeurt onthoudt bij
--      het afmelden hoe er betaald werd (wasdag_regels.betaalmethode), en wat
--      als overmaken is afgemeld telt nooit als contante schuld. Per maand
--      zet je zo'n beurt om (geld_beurt_naar_contant):
--        0  contant open
--        1  contant, maar al betaald
--      Is de beurt van na de startdag van de wijk, dan staat hij zelf open
--      (of dekt een 1 van de kaart hem, zoals op de straatkaart). Is hij van
--      vóór of op de startdag, dan telt net als altijd de kaart: een 0 zet
--      het vakje van de beginstand, en de beurt zelf blijft buiten de
--      rekensom.
--
-- Wat er in de database gebeurt bij een overmaak-maand op 0:
--   * de betaalwijze van die beurt(en) wordt contant: dat was de bevroren
--     kopie die niet klopte (zo verschuift de omzet in de grafiek mee);
--   * een losse factuurregel van die beurt (nog op geen factuur) gaat weg
--     (deleted_at), zodat hij nooit ook nog gefactureerd wordt;
--   * er komt een regel in contant_omzettingen: wie, wanneer, welke beurt,
--     welke factuurregel weg ging. Die regel laat geld_schuld de beurt
--     meetellen, ook al viel hij buiten een contante periode.
-- Een beurt op een factuur met een nummer, of op een concept, gaat nooit
-- stil om: dan weigert de database, met wat je eerst moet doen.
--
-- Terugdraaien (Ongedaan maken, of "terug naar overmaken") zet alles terug:
-- de beurt weer op overmaken, de losse factuurregel terug, en die maand op
-- de kaart zoals hij vóór het omzetten stond. Het adres terugzetten draait
-- ook de maanden terug die daarna zijn omgezet.
--
-- Wie mag: de eigenaar en wie mag afrekenen (public.mag_afrekenen()). De
-- kaart zelf invullen (geld_kaart_zetten) blijft van de eigenaar; wie mag
-- afrekenen komt er alleen bij via het omzetten van een maand.

-- ---------------------------------------------------------------------
-- 1. Het logboek
-- ---------------------------------------------------------------------
create table public.contant_omzettingen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid not null,
  -- 'adres': de betaalwijze van het adres naar contant.
  -- 'beurt': één wasbeurt die als overmaken was afgemeld.
  soort text not null check (soort in ('adres', 'beurt')),
  -- Bij 'adres': wat het adres eerst had (leeg = zoals de wijk).
  vorige_methode text check (vorige_methode in ('contant', 'overmaken')),
  -- Bij 'beurt': welke, in welk maandvakje, op welke dag.
  regel_id uuid,
  ronde text,
  datum date,
  -- Telt de beurt zelf als open? Ja na de start van de wijk; vóór of op de
  -- startdag telt de kaart (de beginstand), zoals voor elke beurt.
  telt boolean not null default false,
  -- De losse factuurregel die daardoor weg ging (om terug te zetten).
  factuurregel_id uuid,
  -- Hoe die maand op de kaart stond vóór het omzetten ({vakje, een}), als
  -- het omzetten de kaart veranderde; leeg = de kaart bleef gelijk.
  kaart_was jsonb,
  door uuid default auth.uid(),
  door_naam text not null default '',
  op timestamptz not null default now(),
  ongedaan_op timestamptz,
  ongedaan_door uuid,
  ongedaan_naam text,
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete cascade,
  check ((soort = 'beurt') = (regel_id is not null and ronde is not null and datum is not null)),
  check (soort = 'beurt' or (not telt and factuurregel_id is null and kaart_was is null))
);
-- Een beurt is maar één keer tegelijk omgezet.
create unique index contant_omzettingen_regel on public.contant_omzettingen (regel_id)
  where regel_id is not null and ongedaan_op is null;
create index contant_omzettingen_adres on public.contant_omzettingen (customer_id, op);
create trigger contant_omzettingen_set_company_id before insert on public.contant_omzettingen
  for each row execute function public.set_company_id();

-- Alleen via de functies hieronder; niemand leest of schrijft deze tabel
-- direct. Toch de vaste regel per bedrijf.
alter table public.contant_omzettingen enable row level security;
revoke all on public.contant_omzettingen from anon, authenticated;
create policy "Eigen bedrijf" on public.contant_omzettingen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- ---------------------------------------------------------------------
-- 2. Staat een beurt bij de facturen?
--
-- null = nee (of alleen op een gecrediteerde factuur); 'los' = klaar om
-- gefactureerd te worden, nog op geen factuur; 'concept' = op een concept
-- zonder nummer; anders het factuurnummer.
-- ---------------------------------------------------------------------
create or replace function public.geld_beurt_factuur(regel uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when fr.factuur_id is null or f.id is null then 'los'
           when f.nummer is null then 'concept'
           else f.nummer
         end
  from public.factuurregels fr
  left join public.facturen f on f.id = fr.factuur_id
  where fr.wasdag_regel_id = regel and fr.deleted_at is null and fr.vervangen_op is null
    and coalesce(f.status, '') <> 'gecrediteerd'
  order by fr.created_at desc
  limit 1
$$;
revoke execute on function public.geld_beurt_factuur(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. De rekensom: een omgezette beurt telt mee
--
-- Gelijk aan de versie uit 20261017140000_kaart_bedragen_per_maand.sql;
-- alleen bij de wasbeurten mag het ook een omgezette beurt zijn.
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
                        where v ->> 'teken' not in ('0', 'x')),
                     -- Per maand wat hij kost ("2026-07~15.00~0"), zodat de
                     -- rekening er net als een factuur een regel per prijs
                     -- van kan maken. Wie alleen maanden of merkjes leest,
                     -- slaat deze stukjes over.
                     (select string_agg((v ->> 'maand') || '~' || round((v ->> 'bedrag')::numeric, 2)::text
                                        || '~' || (v ->> 'teken'), ',' order by v ->> 'maand')
                        from jsonb_array_elements(g.vakjes) v
                        where v ->> 'teken' <> 'x' and coalesce((v ->> 'bedrag')::numeric, 0) > 0))
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
    and (exists (
           select 1 from public.contant_periodes p
           where p.customer_id = r.customer_id and r.datum >= p.vanaf and (p.tot is null or r.datum <= p.tot)
         )
         -- Of als overmaken afgemeld en daarna omgezet naar contant (de
         -- geldkaart van de klant), na de start van de wijk.
         or exists (
           select 1 from public.contant_omzettingen o
           where o.regel_id = r.id and o.soort = 'beurt' and o.telt and o.ongedaan_op is null
         ))
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
-- 4. De kaart invullen: niet over een factuur heen
--
-- Gelijk aan de versie uit 20261017120000_kaart_vakjes.sql, met twee
-- veranderingen:
--   * vanuit de omzetfuncties hieronder mag ook wie mag afrekenen (met de
--     vlag wooshy.omzetten); rechtstreeks blijft het de eigenaar;
--   * een maand die nieuw open komt te staan terwijl de beurt van die maand
--     als overmaken is afgemeld en bij de facturen staat, weigert hij: dan
--     zou die beurt twee keer betaald worden.
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
  fout record;
begin
  -- De omzetfuncties (wie mag afrekenen) zetten de vlag wooshy.omzetten;
  -- vanuit de browser kan dat niet.
  if bedrijf is null or not (public.is_eigenaar()
                             or (public.mag_afrekenen()
                                 and coalesce(current_setting('wooshy.omzetten', true), '') = '1')) then
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
      -- Een maand die nieuw open komt te staan, terwijl de beurt van die
      -- maand als overmaken is afgemeld en bij de facturen staat: dan zou
      -- hij twee keer betaald worden. Wat er al stond, blijft gewoon staan.
      select v ->> 'maand' as maand, public.geld_beurt_factuur(w.id) as factuur
        into fout
        from jsonb_array_elements(nieuw) v
        join public.wasdag_regels w
          on w.customer_id = adres_id and w.company_id = bedrijf and w.ronde = v ->> 'maand'
         and w.gedaan_op is not null and w.niet_gewassen_op is null and w.betaalmethode = 'overmaken'
        where v ->> 'teken' <> 'x'
          and not ((v ->> 'maand') = any (coalesce(oud.maanden, '{}')))
          and public.geld_beurt_factuur(w.id) is not null
        order by v ->> 'maand'
        limit 1;
      if fout.maand is not null then
        raise exception '%',
          'In ' || public.ronde_naam(fout.maand) || ' ' || substr(fout.maand, 1, 4)
          || ' is de beurt als overmaken afgemeld en '
          || case fout.factuur
               when 'los' then 'staat hij klaar om gefactureerd te worden. Zet die maand om in de geldkaart van deze klant; dan gaat hij van de facturen af.'
               when 'concept' then 'staat hij op een conceptfactuur. Gooi dat concept eerst weg bij Facturen.'
               else 'staat hij op factuur ' || fout.factuur || '. Crediteer die factuur eerst.'
             end;
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
-- 5. Eén maand op de kaart, vanuit de database (intern)
--
-- `geld_kaart_maand_stand`: wat er nu in één maand op de kaart staat, als
-- {vakje, een}: het vakje van de beginstand ({maand, teken, bedrag} of
-- null) en of er een 1 (al betaald, van de kaart) staat.
-- `geld_kaart_maand_zetten`: zet één maand precies zo, en laat de rest van
-- de kaart staan. Bouwt de hele rij zoals de app dat doet en geeft hem aan
-- geld_kaart_zetten, met dezelfde controles (met de vlag wooshy.omzetten,
-- zodat ook wie mag afrekenen dit via de omzetfuncties kan). Geeft terug of
-- er iets veranderde.
-- ---------------------------------------------------------------------
create or replace function public.geld_kaart_maand_stand(adres_id uuid, maand text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  oud public.betaal_gebeurtenissen;
  vakje jsonb;
  enen text[];
begin
  select g.* into oud from public.betaal_gebeurtenissen g
    where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'beginstand'
      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
    order by g.op desc, g.id desc
    limit 1;
  if jsonb_typeof(oud.vakjes) = 'array' then
    select x into vakje from jsonb_array_elements(oud.vakjes) x where x ->> 'maand' = maand limit 1;
  elsif maand = any (coalesce(oud.maanden, '{}')) then
    vakje := jsonb_build_object('maand', maand, 'teken', '0', 'bedrag', 0);
  end if;
  select g.maanden into enen from public.betaal_gebeurtenissen g
    where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'vooruit' and g.bron = 'kaart'
      and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
    order by g.op desc, g.id desc
    limit 1;
  return jsonb_build_object('vakje', vakje, 'een', maand = any (coalesce(enen, '{}')));
end
$$;
revoke execute on function public.geld_kaart_maand_stand(uuid, text) from public, anon, authenticated;

create or replace function public.geld_kaart_maand_zetten(adres_id uuid, maand text, vakje jsonb, een boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  peil_maand text;
  nu jsonb := public.geld_kaart_maand_stand(adres_id, maand);
  nu_vakje jsonb := nullif(nu -> 'vakje', 'null'::jsonb);
  oud public.betaal_gebeurtenissen;
  lijst jsonb;
  enen text[];
  vlag text := coalesce(current_setting('wooshy.omzetten', true), '');
begin
  vakje := nullif(vakje, 'null'::jsonb);
  select to_char(d.geld_peildatum, 'YYYY-MM') into peil_maand
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    where cu.id = adres_id and cu.company_id = bedrijf;
  if peil_maand is null then
    raise exception 'Deze wijk doet nog niet mee met Betalingen.';
  end if;

  if maand <= peil_maand then
    -- Hetzelfde teken (en bij een letter of + hetzelfde bedrag): niets te doen.
    if coalesce(nu_vakje ->> 'teken', '') = coalesce(vakje ->> 'teken', '')
       and (coalesce(vakje ->> 'teken', '') in ('', '0', 'x')
            or (nu_vakje ->> 'bedrag')::numeric = (vakje ->> 'bedrag')::numeric) then
      return false;
    end if;
    select g.* into oud from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'beginstand'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc, g.id desc
      limit 1;
    if oud.id is not null and oud.vakjes is null and coalesce(cardinality(oud.maanden), 0) = 0 then
      raise exception 'Deze klant heeft een beginstand die als bedrag is ingetypt. Pas die eerst aan op de kaart bij Betalingen.';
    end if;
    lijst := coalesce(
      case when jsonb_typeof(oud.vakjes) = 'array' then oud.vakjes end,
      (select jsonb_agg(jsonb_build_object('maand', m, 'teken', '0', 'bedrag', 0)) from unnest(oud.maanden) m),
      '[]'::jsonb);
    lijst := coalesce((select jsonb_agg(x) from jsonb_array_elements(lijst) x where x ->> 'maand' <> maand),
                      '[]'::jsonb);
    if vakje is not null then
      lijst := lijst || jsonb_build_array(jsonb_build_object(
        'maand', maand, 'teken', vakje ->> 'teken', 'bedrag', coalesce((vakje ->> 'bedrag')::numeric, 0)));
    end if;
    perform set_config('wooshy.omzetten', '1', true);
    perform public.geld_kaart_zetten(adres_id, lijst, null);
    perform set_config('wooshy.omzetten', vlag, true);
  else
    if (nu ->> 'een')::boolean = coalesce(een, false) then
      return false;
    end if;
    select g.maanden into enen from public.betaal_gebeurtenissen g
      where g.customer_id = adres_id and g.company_id = bedrijf and g.soort = 'vooruit' and g.bron = 'kaart'
        and not exists (select 1 from public.betaal_gebeurtenissen o where o.herroept_id = g.id)
      order by g.op desc, g.id desc
      limit 1;
    select coalesce(array_agg(distinct m order by m), '{}') into enen
      from unnest(coalesce(enen, '{}') || case when een then array[maand] else '{}'::text[] end) m
      where een or m <> maand;
    perform set_config('wooshy.omzetten', '1', true);
    perform public.geld_kaart_zetten(adres_id, null, enen);
    perform set_config('wooshy.omzetten', vlag, true);
  end if;
  return true;
end
$$;
revoke execute on function public.geld_kaart_maand_zetten(uuid, text, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Een beurt terug naar overmaken (intern)
-- ---------------------------------------------------------------------
create or replace function public.geld_omzetting_terug(omzetting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.contant_omzettingen;
begin
  select * into o from public.contant_omzettingen x
    where x.id = omzetting and x.soort = 'beurt' and x.ongedaan_op is null
    for update;
  if not found then
    return;
  end if;
  -- Is de dag intussen heropend, dan is de beurt niet meer afgemeld en heeft
  -- hij geen betaalwijze; die krijgt hij weer bij het afmelden.
  update public.wasdag_regels set betaalmethode = 'overmaken'
    where id = o.regel_id and betaalmethode = 'contant';
  -- De losse factuurregel terug, als er intussen geen andere is gekomen.
  if o.factuurregel_id is not null then
    update public.factuurregels fr set deleted_at = null
      where fr.id = o.factuurregel_id and fr.deleted_at is not null
        and exists (select 1 from public.wasdag_regels w
                    where w.id = o.regel_id and w.betaalmethode = 'overmaken')
        and not exists (select 1 from public.factuurregels x
                        where x.wasdag_regel_id = fr.wasdag_regel_id
                          and x.deleted_at is null and x.vervangen_op is null);
  end if;
  update public.contant_omzettingen
    set ongedaan_op = now(), ongedaan_door = auth.uid(), ongedaan_naam = coalesce(public.geld_mijn_naam(), '')
    where id = o.id;
end
$$;
revoke execute on function public.geld_omzetting_terug(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Omzetten naar contant: het adres
--
-- Blijvend, net als in het dossier. Ook wie mag afrekenen zonder het recht
-- om klanten te bewerken: daarom met de vlag van de geldloper, en daarom
-- komt het niet in het gewone wijzigingslog maar hier, met wie en wanneer.
-- Geeft het id van de omzetting terug (voor Ongedaan maken).
-- ---------------------------------------------------------------------
create or replace function public.geld_naar_contant(adres_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  c record;
  vlag text := coalesce(current_setting('wooshy.geldloop', true), '');
  nieuw uuid;
begin
  if bedrijf is null or not public.mag_afrekenen() then
    raise exception 'Alleen de eigenaar en wie mag afrekenen kunnen een adres omzetten naar contant.';
  end if;
  select cu.betaalmethode, d.betaalmethode as wijk, cu.inactief_op, cu.deleted_at
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres_id and cu.company_id = bedrijf
    for update of cu;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if c.deleted_at is not null or c.inactief_op is not null then
    raise exception 'Dit adres is gestopt.';
  end if;
  if coalesce(c.betaalmethode, c.wijk, 'contant') <> 'overmaken' then
    raise exception 'Dit adres betaalt al contant.';
  end if;

  perform set_config('wooshy.geldloop', '1', true);
  update public.customers set betaalmethode = 'contant' where id = adres_id;
  perform set_config('wooshy.geldloop', vlag, true);

  insert into public.contant_omzettingen (company_id, customer_id, soort, vorige_methode, door, door_naam)
    values (bedrijf, adres_id, 'adres', c.betaalmethode, auth.uid(), coalesce(public.geld_mijn_naam(), ''))
    returning id into nieuw;
  return nieuw;
end
$$;
revoke execute on function public.geld_naar_contant(uuid) from public, anon;
grant execute on function public.geld_naar_contant(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Een maand omzetten: de beurten die als overmaken zijn afgemeld
--
-- `teken`: '0' = contant open, '1' = contant en al betaald. Het adres moet
-- nu contant betalen (eerst stap 7). Geeft het aantal omgezette beurten.
--
-- Of een beurt zelf telt, of de kaart (de beginstand): zoals overal. Een
-- beurt van na de startdag telt zelf, en ook een beurt die bij een ronde
-- ná de startmaand hoort (daar is geen vakje voor). Een beurt van vóór of
-- op de startdag, in een ronde tot en met de startmaand, telt niet zelf:
-- daar zet een 0 het vakje van de beginstand (een vakje dat er al staat,
-- blijft staan) en een 1 haalt het weg. Een 0 haalt een 1 van de kaart in
-- die maand weg, een 1 zet hem. Wat er zo op de kaart veranderde, onthoudt
-- de omzetting (kaart_was), zodat terugzetten precies dat terugzet.
-- ---------------------------------------------------------------------
create or replace function public.geld_beurt_naar_contant(adres_id uuid, maand text, teken text default '0')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  vandaag date := (now() at time zone 'Europe/Amsterdam')::date;
  c record;
  r record;
  factuur text;
  weg uuid;
  aantal integer := 0;
  voor_start integer := 0;
  zelf boolean;
  wanneer text;
  peil_maand text;
  nieuwe uuid[] := '{}';
  nieuw_id uuid;
  was jsonb;
  oud_was jsonb;
  veranderd boolean;
  vroeg boolean := false;
  vakje jsonb;
  een boolean;
begin
  if bedrijf is null or not public.mag_afrekenen() then
    raise exception 'Alleen de eigenaar en wie mag afrekenen kunnen een maand omzetten naar contant.';
  end if;
  if maand is null or maand !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Onbekende maand.';
  end if;
  if teken is null or teken not in ('0', '1') then
    raise exception 'Onbekende keuze.';
  end if;
  select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') as methode, d.geld_peildatum as peil
    into c
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = adres_id and cu.company_id = bedrijf
    for update of cu;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  if c.peil is null then
    raise exception 'Deze wijk doet nog niet mee met Betalingen.';
  end if;
  if c.methode <> 'contant' then
    raise exception 'Zet dit adres eerst om naar contant.';
  end if;
  peil_maand := to_char(c.peil, 'YYYY-MM');
  -- Hoe de kaart van deze maand er vóór het omzetten uitzag.
  was := public.geld_kaart_maand_stand(adres_id, maand);

  for r in
    select w.id, w.datum
    from public.wasdag_regels w
    where w.customer_id = adres_id and w.company_id = bedrijf and w.ronde = maand
      and w.gedaan_op is not null and w.niet_gewassen_op is null
      and w.betaalmethode = 'overmaken' and w.datum <= vandaag
    order by w.datum, w.id
    for update of w
  loop
    wanneer := to_char(r.datum, 'FMDD-FMMM-YYYY');
    zelf := r.datum > c.peil or maand > peil_maand;
    factuur := public.geld_beurt_factuur(r.id);
    if factuur = 'concept' then
      raise exception 'De beurt van % staat op een conceptfactuur. Gooi dat concept eerst weg bij Facturen; daarna kan hij om.', wanneer;
    elsif factuur is not null and factuur <> 'los' then
      raise exception 'De beurt van % staat op factuur %. Een gefactureerde beurt wordt niet stil contant: crediteer die factuur eerst.', wanneer, factuur;
    end if;
    -- Vooruit betaald vanaf vóór deze beurt, met beurten die er later
    -- (of nog niet) gebruikt worden: die zouden opschuiven. Een 1 van de
    -- kaart voor alleen deze maand niet: die zet het omzetten hieronder goed.
    if zelf and exists (
      select 1
      from public.geld_vooruit(bedrijf, array[adres_id]) v
      join public.betaal_gebeurtenissen g on g.id = v.vooruit_id
      where g.soort = 'vooruit' and g.vanaf <= r.datum
        and not (g.bron = 'kaart' and g.maanden = array[maand])
        and (v.soort in ('over', 'over_vast') or (v.soort = 'dekking' and v.datum > r.datum))
    ) then
      raise exception 'Dit adres heeft vooruit betaald vanaf vóór %; als deze beurt contant wordt, schuiven die beurten op. Laat de eigenaar die vooruitbetaling eerst ongedaan maken.', wanneer;
    end if;

    weg := null;
    if factuur = 'los' then
      update public.factuurregels fr set deleted_at = now()
        where fr.id = (select x.id from public.factuurregels x
                       where x.wasdag_regel_id = r.id and x.factuur_id is null
                         and x.deleted_at is null and x.vervangen_op is null
                       order by x.created_at desc limit 1)
        returning fr.id into weg;
    end if;
    update public.wasdag_regels set betaalmethode = 'contant' where id = r.id;
    -- Een oude omzetting van deze beurt die niet meer gold (dag heropend en
    -- weer als overmaken afgemeld), sluit af; hoe de kaart vóór die eerste
    -- omzetting stond, nemen we mee.
    oud_was := coalesce(oud_was, (select x.kaart_was from public.contant_omzettingen x
                                   where x.regel_id = r.id and x.ongedaan_op is null limit 1));
    update public.contant_omzettingen
      set ongedaan_op = now(), ongedaan_door = auth.uid(), ongedaan_naam = coalesce(public.geld_mijn_naam(), '')
      where regel_id = r.id and ongedaan_op is null;
    insert into public.contant_omzettingen
      (company_id, customer_id, soort, regel_id, ronde, datum, telt, factuurregel_id, door, door_naam)
      values (bedrijf, adres_id, 'beurt', r.id, maand, r.datum, zelf, weg,
              auth.uid(), coalesce(public.geld_mijn_naam(), ''))
      returning id into nieuw_id;
    nieuwe := nieuwe || nieuw_id;
    aantal := aantal + 1;
    if not zelf then
      voor_start := voor_start + 1;
    elsif r.datum < (maand || '-01')::date then
      vroeg := true;
    end if;
  end loop;

  if aantal = 0 then
    raise exception 'In deze maand staat geen beurt die als overmaken is afgemeld.';
  end if;

  -- De kaart van die maand.
  vakje := nullif(was -> 'vakje', 'null'::jsonb);
  een := (was ->> 'een')::boolean;
  if voor_start > 0 then
    if teken = '1' then
      vakje := null;
    elsif vakje is null or vakje ->> 'teken' = 'x' then
      vakje := jsonb_build_object('maand', maand, 'teken', '0', 'bedrag', 0);
    end if;
  end if;
  if aantal > voor_start then
    if teken = '1' and maand <= peil_maand then
      raise exception 'Een beurt van na de start, in de startmaand zelf, kan niet als al betaald op de kaart. Zet hem op 0 en boek de betaling.';
    end if;
    -- Een 1 van de kaart dekt pas vanaf de eerste van de maand; een beurt van
    -- deze ronde die eerder gewassen is, zou hij missen.
    if teken = '1' and vroeg then
      raise exception 'Deze beurt is gewassen vóór de maand waar hij bij hoort, en kan daarom niet als al betaald op de kaart. Zet hem op 0 en boek de betaling.';
    end if;
    een := teken = '1';
  end if;
  veranderd := public.geld_kaart_maand_zetten(adres_id, maand, vakje, een);
  if veranderd or oud_was is not null then
    update public.contant_omzettingen set kaart_was = coalesce(oud_was, was) where id = any (nieuwe);
  end if;
  return aantal;
end
$$;
revoke execute on function public.geld_beurt_naar_contant(uuid, text, text) from public, anon;
grant execute on function public.geld_beurt_naar_contant(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Een maand terug naar overmaken
--
-- Eerst de kaart van die maand terug zoals hij vóór het omzetten was (als
-- het omzetten hem veranderde), dan de beurten weer op overmaken, met hun
-- losse factuurregel terug. In die volgorde: zolang de beurt nog contant
-- is, houdt de factuurcontrole van de kaart het terugzetten niet tegen.
-- ---------------------------------------------------------------------
create or replace function public.geld_beurt_terug(adres_id uuid, maand text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  o uuid;
  was jsonb;
  peil_maand text;
  aantal integer := 0;
begin
  if bedrijf is null or not public.mag_afrekenen() then
    raise exception 'Alleen de eigenaar en wie mag afrekenen kunnen een maand terugzetten.';
  end if;
  select to_char(d.geld_peildatum, 'YYYY-MM') into peil_maand
    from public.customers cu
    join public.streets s on s.id = cu.street_id
    join public.districts d on d.id = s.district_id
    where cu.id = adres_id and cu.company_id = bedrijf;
  perform 1 from public.customers cu where cu.id = adres_id and cu.company_id = bedrijf for update;
  if not found then
    raise exception 'Dat adres bestaat niet.';
  end if;
  select x.kaart_was into was from public.contant_omzettingen x
    where x.customer_id = adres_id and x.company_id = bedrijf and x.soort = 'beurt'
      and x.ronde = maand and x.ongedaan_op is null and x.kaart_was is not null
    order by x.op, x.id
    limit 1;
  -- Het vakje van de beginstand vóór de beurten (zolang de beurt contant is
  -- houdt de factuurcontrole het niet tegen); een 1 erna (zolang de beurt
  -- contant is, telt hij als betaald en weigert de kaart een 1).
  if was is not null and maand <= peil_maand then
    perform public.geld_kaart_maand_zetten(adres_id, maand, was -> 'vakje', (was ->> 'een')::boolean);
  end if;
  for o in
    select x.id from public.contant_omzettingen x
    where x.customer_id = adres_id and x.company_id = bedrijf and x.soort = 'beurt'
      and x.ronde = maand and x.ongedaan_op is null
  loop
    perform public.geld_omzetting_terug(o);
    aantal := aantal + 1;
  end loop;
  if aantal = 0 then
    raise exception 'In deze maand is niets omgezet naar contant.';
  end if;
  if was is not null and maand > peil_maand then
    perform public.geld_kaart_maand_zetten(adres_id, maand, was -> 'vakje', (was ->> 'een')::boolean);
  end if;
  return aantal;
end
$$;
revoke execute on function public.geld_beurt_terug(uuid, text) from public, anon;
grant execute on function public.geld_beurt_terug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Ongedaan maken (de gele melding, en de lijst bij de kaart)
--
-- Een maand: zoals hierboven. Het adres: eerst de maanden die daarna zijn
-- omgezet, dan de betaalwijze terug zoals hij was. Is die intussen opnieuw
-- veranderd, dan niet: dan klopt "terug" niet meer. Geeft terug hoe het
-- adres daarna betaalt: 'overmaken'; 'gepland' als er nog vooruit betaalde
-- beurten zijn (dan gaat het pas over als die op zijn, zie
-- customers_vooruit_bewaken); 'contant' als het de wijk volgt en die
-- intussen contant is. Bij een maand: null.
-- ---------------------------------------------------------------------
create or replace function public.geld_omzetting_ongedaan(omzetting uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  o public.contant_omzettingen;
  nu text;
  m text;
  vlag text := coalesce(current_setting('wooshy.geldloop', true), '');
begin
  if bedrijf is null or not public.mag_afrekenen() then
    raise exception 'Alleen de eigenaar en wie mag afrekenen kunnen dit terugdraaien.';
  end if;
  select * into o from public.contant_omzettingen x where x.id = omzetting and x.company_id = bedrijf;
  if not found then
    raise exception 'Die omzetting bestaat niet.';
  end if;
  if o.ongedaan_op is not null then
    raise exception 'Dit is al ongedaan gemaakt.';
  end if;

  if o.soort = 'beurt' then
    perform public.geld_beurt_terug(o.customer_id, o.ronde);
    return null;
  end if;

  select cu.betaalmethode into nu from public.customers cu where cu.id = o.customer_id for update;
  if nu is distinct from 'contant' then
    raise exception 'Intussen is de betaalwijze van dit adres opnieuw veranderd; pas hem aan in het dossier.';
  end if;
  for m in
    select distinct x.ronde from public.contant_omzettingen x
    where x.customer_id = o.customer_id and x.company_id = bedrijf and x.soort = 'beurt'
      and x.ongedaan_op is null and x.op >= o.op
  loop
    perform public.geld_beurt_terug(o.customer_id, m);
  end loop;

  perform set_config('wooshy.geldloop', '1', true);
  update public.customers set betaalmethode = o.vorige_methode where id = o.customer_id;
  perform set_config('wooshy.geldloop', vlag, true);

  update public.contant_omzettingen
    set ongedaan_op = now(), ongedaan_door = auth.uid(), ongedaan_naam = coalesce(public.geld_mijn_naam(), '')
    where id = o.id;

  select case when cu.wissel_status = 'gepland' then 'gepland'
              else coalesce(cu.betaalmethode, d.betaalmethode, 'contant') end into nu
    from public.customers cu
    left join public.streets s on s.id = cu.street_id
    left join public.districts d on d.id = s.district_id
    where cu.id = o.customer_id;
  return nu;
end
$$;
revoke execute on function public.geld_omzetting_ongedaan(uuid) from public, anon;
grant execute on function public.geld_omzetting_ongedaan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Wat de kaart van één klant erbij ziet
--
--   beurten      de wasbeurten die als overmaken zijn afgemeld, of omgezet:
--                {regel_id, ronde, datum, prijs, betaalmethode, factuur,
--                 omzetting: {id, door_naam, op} | null}. `factuur`: null,
--                'los', 'concept', of het nummer (zonder het recht facturen
--                alleen 'factuur').
--   omzettingen  alles wat er is omgezet, nieuw naar oud, ook wat ongedaan is.
-- ---------------------------------------------------------------------
create or replace function public.geld_omzettingen(adres_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  facturen_zien boolean := public.heeft_recht('facturen');
begin
  if bedrijf is null or not public.heeft_recht('prijzen_zien') then
    raise exception 'Je mag geen bedragen zien.';
  end if;
  if not exists (select 1 from public.customers cu where cu.id = adres_id and cu.company_id = bedrijf) then
    raise exception 'Dat adres bestaat niet.';
  end if;
  return jsonb_build_object(
    'beurten', coalesce((
      select jsonb_agg(jsonb_build_object(
        'regel_id', w.id, 'ronde', w.ronde, 'datum', w.datum, 'prijs', coalesce(wp.prijs, 0),
        'betaalmethode', w.betaalmethode,
        'factuur', case
                     when f.factuur in ('los', 'concept') or facturen_zien then f.factuur
                     when f.factuur is not null then 'factuur'
                   end,
        'omzetting', (
          select jsonb_build_object('id', o.id, 'door_naam', o.door_naam, 'op', o.op)
          from public.contant_omzettingen o
          where o.regel_id = w.id and o.ongedaan_op is null
          limit 1)
      ) order by w.datum, w.id)
      from public.wasdag_regels w
      left join public.wasdag_prijzen wp on wp.regel_id = w.id
      cross join lateral (select public.geld_beurt_factuur(w.id) as factuur) f
      where w.customer_id = adres_id and w.company_id = bedrijf
        and w.gedaan_op is not null and w.niet_gewassen_op is null
        and (w.betaalmethode = 'overmaken'
             or exists (select 1 from public.contant_omzettingen o
                        where o.regel_id = w.id and o.ongedaan_op is null))
    ), '[]'::jsonb),
    'omzettingen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'soort', o.soort, 'ronde', o.ronde, 'datum', o.datum,
        'vorige_methode', o.vorige_methode, 'door_naam', o.door_naam, 'op', o.op,
        'ongedaan_op', o.ongedaan_op, 'ongedaan_naam', o.ongedaan_naam
      ) order by o.op desc, o.id)
      from public.contant_omzettingen o
      where o.customer_id = adres_id and o.company_id = bedrijf
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.geld_omzettingen(uuid) from public, anon;
grant execute on function public.geld_omzettingen(uuid) to authenticated;
