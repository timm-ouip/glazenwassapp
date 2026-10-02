-- De geldkaart van één klant: ook wie mag afrekenen vult hem in.
--
-- Timmie koos (02-10-2026): wie mag afrekenen mag in de kaart van één klant
-- hetzelfde als de eigenaar op gewone maanden: 0, ×, een letter met bedrag
-- (v 8), + met bedrag, en na de start een 1. Alleen daar: de straatkaart
-- (geld_kaart_zetten rechtstreeks) blijft van de eigenaar.
--
-- Dat gaat via geld_klantkaart_zetten: die controleert het recht en het
-- bedrijf, onthoudt hoe de maand stond, zet hem via geld_kaart_maand_zetten
-- (met de vlag wooshy.omzetten, dus met alle controles van geld_kaart_zetten,
-- ook die op de facturen) en schrijft in contant_omzettingen wie wat
-- wanneer veranderde (soort 'kaart', met kaart_was en kaart_na). Ook de
-- eigenaar gaat in de kaart van één klant hierlangs, zodat alles in hetzelfde
-- log staat. Terugzetten gaat met geld_omzetting_ongedaan, zolang de maand
-- nog zo staat als de wijziging hem achterliet.

-- ---------------------------------------------------------------------
-- 1. Het log: ook een maand op de kaart
-- ---------------------------------------------------------------------
alter table public.contant_omzettingen add column kaart_na jsonb;

alter table public.contant_omzettingen drop constraint contant_omzettingen_soort_check;
alter table public.contant_omzettingen add constraint contant_omzettingen_soort_check
  check (soort in ('adres', 'beurt', 'kaart'));

-- Was: alleen een beurt had kaart_was. Nu ook een maand op de kaart (met
-- de maand in `ronde` en de stand erna in kaart_na); telt en een
-- factuurregel blijven van een beurt.
alter table public.contant_omzettingen drop constraint contant_omzettingen_check1;
alter table public.contant_omzettingen add constraint contant_omzettingen_check1 check (
  case soort
    when 'beurt' then kaart_na is null
    when 'kaart' then not telt and factuurregel_id is null and ronde is not null
                      and kaart_was is not null and kaart_na is not null
    else not telt and factuurregel_id is null and kaart_was is null and kaart_na is null
  end
);

-- ---------------------------------------------------------------------
-- 2. Eén maand op de kaart van één klant zetten
--
-- `teken`: '0', 'x', een letter (niet b of x) of '+', of na de start '1';
-- null = de maand leeg. `bedrag` alleen bij een letter of +. Het adres moet
-- contant betalen, en in de maand mag geen beurt staan die nog als
-- overmaken is afgemeld (die zet je eerst om). Geeft het id van de regel in
-- het log, of null als er niets veranderde.
-- ---------------------------------------------------------------------
create or replace function public.geld_klantkaart_zetten(
  adres_id uuid,
  maand text,
  teken text,
  bedrag numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  bedrijf uuid := public.current_company_id();
  c record;
  peil_maand text;
  was jsonb;
  vakje jsonb;
  een boolean;
  nieuw uuid;
begin
  if bedrijf is null or not public.mag_afrekenen() then
    raise exception 'Alleen de eigenaar en wie mag afrekenen kunnen de kaart van een klant invullen.';
  end if;
  if maand is null or maand !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Onbekende maand.';
  end if;
  teken := lower(teken);
  if teken is not null and teken !~ '^([0x1+]|[ac-wyz])$' then
    raise exception 'Gebruik 0, x, een letter met een bedrag (v 8), + met een bedrag (+5) of 1.';
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
    raise exception 'Dit adres maakt over. Zet het eerst om naar contant.';
  end if;
  if exists (
    select 1 from public.wasdag_regels w
    where w.customer_id = adres_id and w.company_id = bedrijf and w.ronde = maand
      and w.gedaan_op is not null and w.niet_gewassen_op is null and w.betaalmethode = 'overmaken'
  ) then
    raise exception 'In deze maand staat een beurt die als overmaken is afgemeld. Zet die eerst om naar contant.';
  end if;

  peil_maand := to_char(c.peil, 'YYYY-MM');
  was := public.geld_kaart_maand_stand(adres_id, maand);
  vakje := nullif(was -> 'vakje', 'null'::jsonb);
  een := (was ->> 'een')::boolean;
  if maand <= peil_maand then
    if teken = '1' then
      raise exception 'Een 1 (vooruit betaald) kan alleen na de start.';
    end if;
    if teken in ('0', 'x') then
      vakje := jsonb_build_object('maand', maand, 'teken', teken, 'bedrag', 0);
    elsif teken is not null then
      if bedrag is null or bedrag <= 0 or bedrag > 10000 or round(bedrag, 2) <> bedrag then
        raise exception 'Zet er een bedrag achter tussen 0,01 en 10.000, bijvoorbeeld v 8 of +5.';
      end if;
      vakje := jsonb_build_object('maand', maand, 'teken', teken, 'bedrag', bedrag);
    else
      vakje := null;
    end if;
  else
    if teken is not null and teken <> '1' then
      raise exception 'Na de start kun je alleen een 1 invullen: al betaald.';
    end if;
    een := teken = '1';
    een := coalesce(een, false);
  end if;

  if not public.geld_kaart_maand_zetten(adres_id, maand, vakje, een) then
    return null;
  end if;
  insert into public.contant_omzettingen
    (company_id, customer_id, soort, ronde, kaart_was, kaart_na, door, door_naam, op)
    values (bedrijf, adres_id, 'kaart', maand, was, public.geld_kaart_maand_stand(adres_id, maand),
            auth.uid(), coalesce(public.geld_mijn_naam(), ''),
            -- De klok en niet het begin van de transactie: de volgorde van
            -- wijzigingen in dezelfde maand telt bij Ongedaan maken.
            clock_timestamp())
    returning id into nieuw;
  return nieuw;
end
$$;
revoke execute on function public.geld_klantkaart_zetten(uuid, text, text, numeric) from public, anon;
grant execute on function public.geld_klantkaart_zetten(uuid, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Ongedaan maken: ook een maand op de kaart
--
-- Gelijk aan de versie uit 20261021090000_omzetten_naar_contant.sql, met
-- de soort 'kaart' erbij: de maand terug zoals hij stond, maar alleen als
-- hij nog zo staat als de wijziging hem achterliet (anders is er intussen
-- iets anders gebeurd, en klopt "terug" niet meer).
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

  if o.soort = 'kaart' then
    select coalesce(cu.betaalmethode, d.betaalmethode, 'contant') into nu
      from public.customers cu
      left join public.streets s on s.id = cu.street_id
      left join public.districts d on d.id = s.district_id
      where cu.id = o.customer_id
      for update of cu;
    -- Eerst de nieuwste: anders klopt de volgorde in het log niet meer.
    if exists (select 1 from public.contant_omzettingen x
               where x.customer_id = o.customer_id and x.company_id = bedrijf and x.soort = 'kaart'
                 and x.ronde = o.ronde and x.ongedaan_op is null
                 and (x.op, x.id) > (o.op, o.id)) then
      raise exception 'Daarna is deze maand nog een keer veranderd; maak eerst die wijziging ongedaan.';
    end if;
    if public.geld_kaart_maand_stand(o.customer_id, o.ronde) is distinct from o.kaart_na then
      raise exception 'Deze maand is intussen opnieuw veranderd op de kaart; zet hem daar goed.';
    end if;
    -- Dezelfde regels als bij het zetten.
    if nu <> 'contant' then
      raise exception 'Dit adres maakt over. Zet het eerst om naar contant.';
    end if;
    if exists (
      select 1 from public.wasdag_regels w
      where w.customer_id = o.customer_id and w.company_id = bedrijf and w.ronde = o.ronde
        and w.gedaan_op is not null and w.niet_gewassen_op is null and w.betaalmethode = 'overmaken'
    ) then
      raise exception 'In deze maand staat een beurt die als overmaken is afgemeld. Zet die eerst om naar contant.';
    end if;
    perform public.geld_kaart_maand_zetten(o.customer_id, o.ronde, o.kaart_was -> 'vakje',
                                           (o.kaart_was ->> 'een')::boolean);
    update public.contant_omzettingen
      set ongedaan_op = now(), ongedaan_door = auth.uid(), ongedaan_naam = coalesce(public.geld_mijn_naam(), '')
      where id = o.id;
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
-- 4. Wat de kaart van één klant erbij ziet
--
-- Gelijk aan de versie uit 20261021090000_omzetten_naar_contant.sql; elke
-- omzetting nu ook met kaart_was en kaart_na (bij een maand op de kaart).
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
        'ongedaan_op', o.ongedaan_op, 'ongedaan_naam', o.ongedaan_naam,
        'kaart_was', o.kaart_was, 'kaart_na', o.kaart_na
      ) order by o.op desc, o.id)
      from public.contant_omzettingen o
      where o.customer_id = adres_id and o.company_id = bedrijf
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.geld_omzettingen(uuid) from public, anon;
grant execute on function public.geld_omzettingen(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Een 0 terugzetten met zijn eigen bedrag
--
-- Gelijk aan de versie uit 20261021090000_omzetten_naar_contant.sql. Alleen:
-- komt een 0 binnen via de functies van de kaart van één klant (vlag
-- wooshy.omzetten) mét een bedrag, dan geldt dat bedrag. Zo zet Ongedaan
-- maken een 0 terug zoals hij was (ook een oude prijs), in plaats van tegen
-- de prijs van nu. Rechtstreeks (de straatkaart) verandert er niets.
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
                         when '0' then coalesce(
                           -- Via de kaart van één klant met een bedrag: dat bedrag.
                           case when coalesce(current_setting('wooshy.omzetten', true), '') = '1'
                                     and jsonb_typeof(x -> 'bedrag') = 'number'
                                     and (x ->> 'bedrag')::numeric > 0
                                then round((x ->> 'bedrag')::numeric, 2) end, (
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
-- 6. Een maand terug naar overmaken: ook de kaartwijzigingen erna
--
-- Gelijk aan de versie uit 20261021090000_omzetten_naar_contant.sql, met
-- de wijzigingen op de kaart die na het omzetten in die maand gedaan zijn:
-- die gelden niet meer en worden mee teruggedraaid (met wie en wanneer),
-- zodat het log klopt met de kaart. Veranderde het omzetten zelf de kaart
-- niet, dan gaat de maand terug naar vóór de eerste van die wijzigingen.
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
  -- Veranderde het omzetten de kaart niet, maar iemand daarna wel (op de
  -- kaart van de klant), dan gaat de maand terug naar vóór die wijziging.
  if was is null then
    select x.kaart_was into was from public.contant_omzettingen x
      where x.customer_id = adres_id and x.company_id = bedrijf and x.soort = 'kaart'
        and x.ronde = maand and x.ongedaan_op is null
        and x.op >= (select min(y.op) from public.contant_omzettingen y
                     where y.customer_id = adres_id and y.company_id = bedrijf and y.soort = 'beurt'
                       and y.ronde = maand and y.ongedaan_op is null)
      order by x.op, x.id
      limit 1;
  end if;
  -- Het vakje van de beginstand vóór de beurten (zolang de beurt contant is
  -- houdt de factuurcontrole het niet tegen); een 1 erna (zolang de beurt
  -- contant is, telt hij als betaald en weigert de kaart een 1).
  if was is not null and maand <= peil_maand then
    perform public.geld_kaart_maand_zetten(adres_id, maand, was -> 'vakje', (was ->> 'een')::boolean);
  end if;
  -- De kaart van die maand gaat terug naar vóór het omzetten: wat er daarna
  -- op de kaart veranderde, geldt niet meer.
  if was is not null then
    update public.contant_omzettingen x
      set ongedaan_op = now(), ongedaan_door = auth.uid(), ongedaan_naam = coalesce(public.geld_mijn_naam(), '')
      where x.customer_id = adres_id and x.company_id = bedrijf and x.soort = 'kaart'
        and x.ronde = maand and x.ongedaan_op is null
        and x.op >= (select min(y.op) from public.contant_omzettingen y
                     where y.customer_id = adres_id and y.company_id = bedrijf and y.soort = 'beurt'
                       and y.ronde = maand and y.ongedaan_op is null);
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
-- 7. Hoe een maand staat: bij een oude beginstand met het echte bedrag
--
-- Gelijk aan de versie uit 20261021090000_omzetten_naar_contant.sql. Bij een
-- oude beginstand (een bedrag over maanden, zonder vakjes) gaf hij een 0
-- zonder bedrag; nu het deel van die maand. Zo onthoudt het log het echte
-- bedrag en zet Ongedaan maken het terug zoals het was.
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
  elsif maand = any (coalesce(oud.maanden, '{}')) and oud.bedrag > 0 then
    -- Een oude beginstand (een bedrag over maanden): het deel van deze
    -- maand, zoals geld_kaart_zetten het uitrekent (de centen in de laatste).
    select jsonb_build_object('maand', maand, 'teken', '0', 'bedrag',
             case when o.i < o.n then round(oud.bedrag / o.n, 2)
                  else oud.bedrag - round(oud.bedrag / o.n, 2) * (o.n - 1) end)
      into vakje
      from (select u.m, u.i, cardinality(oud.maanden) as n
              from unnest(oud.maanden) with ordinality as u(m, i)) o
      where o.m = maand
      limit 1;
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
