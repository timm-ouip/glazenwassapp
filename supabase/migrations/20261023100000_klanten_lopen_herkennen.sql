-- Klanten lopen: bestaande klanten beter herkennen (na de code-review van 02-10-2026).
--
-- 1. De BAG noemt Den Haag "'s-Gravenhage" en Den Bosch "'s-Hertogenbosch";
--    wijken staan vaak als "Den Haag". Bij het zoeken op straat + plaats tellen
--    die namen nu als dezelfde plaats, zodat een klant zonder postcode niet als
--    "te lopen" verschijnt.
-- 2. De laatste dubbel-check in loop_maak_klant vergelijkt huisnummer en
--    toevoeging nu net als de rest van de app (nummerSleutel): zonder spaties
--    en streepjes, in kleine letters. "12 A", "12-a" en "12A" zijn hetzelfde.

create or replace function public.loop_plaats_sleutel(plaats text)
returns text
language sql
immutable
as $$
  select case pg_catalog.lower(pg_catalog.btrim(coalesce(plaats, '')))
    when 'den haag' then '''s-gravenhage'
    when 'den bosch' then '''s-hertogenbosch'
    else pg_catalog.lower(pg_catalog.btrim(coalesce(plaats, '')))
  end
$$;
revoke execute on function public.loop_plaats_sleutel(text) from public, anon;

create or replace function public.loop_adres_klanten(bedrijf uuid)
returns table (adres_id uuid, customer_id uuid, inactief boolean, hoek_kant text)
language sql
stable
as $$
  with klant_sleutels as materialized (
    select distinct on (v.soort, v.sleutel)
      v.soort, v.sleutel, c.id as customer_id, c.inactief_op is not null as inactief, c.hoek_kant
    from public.customers c
    join public.streets s on s.id = c.street_id and s.company_id = bedrijf and s.deleted_at is null
    join public.districts d on d.id = s.district_id and d.company_id = bedrijf and d.deleted_at is null
    cross join lateral (
      select pg_catalog.lower(pg_catalog.regexp_replace(c.house_number::text || c.addition, '[\s-]', '', 'g')) as nr
    ) n
    cross join lateral (values
      ('pc', case when pg_catalog.btrim(c.postcode) <> ''
                  then pg_catalog.upper(pg_catalog.regexp_replace(c.postcode, '\s', '', 'g')) || '|' || n.nr end),
      ('straat', pg_catalog.lower(coalesce(nullif(pg_catalog.btrim(c.hoek_straat_volledig), ''),
                                           nullif(pg_catalog.btrim(s.volledige_naam), ''),
                                           pg_catalog.btrim(s.name)))
                 || '|' || public.loop_plaats_sleutel(d.plaats) || '|' || n.nr)
    ) as v(soort, sleutel)
    where c.company_id = bedrijf
      and c.deleted_at is null
      and v.sleutel is not null
    order by v.soort, v.sleutel, (c.inactief_op is not null), c.created_at desc
  ),
  adressen as (
    select la.id, la.customer_id, la.postcode,
      pg_catalog.lower(pg_catalog.regexp_replace(la.huisnummer::text || la.toevoeging, '[\s-]', '', 'g')) as nr,
      pg_catalog.lower(pg_catalog.btrim(la.straat)) || '|' || public.loop_plaats_sleutel(la.woonplaats) as straat_plaats
    from public.loop_adressen la
    where la.company_id = bedrijf
  )
  select a.id,
    coalesce(cd.id, kp.customer_id, kst.customer_id),
    case when cd.id is not null then cd.inactief_op is not null
         when kp.customer_id is not null then kp.inactief
         else kst.inactief end,
    case when cd.id is not null then cd.hoek_kant
         when kp.customer_id is not null then kp.hoek_kant
         else kst.hoek_kant end
  from adressen a
  -- De klant die bij Ja is gekoppeld telt alleen zolang adres, straat en wijk
  -- er nog zijn (niet in de prullenbak), net als bij de sleutels hierboven.
  left join (
    public.customers cd
    join public.streets cs on cs.id = cd.street_id and cs.company_id = bedrijf and cs.deleted_at is null
    join public.districts cdd on cdd.id = cs.district_id and cdd.company_id = bedrijf and cdd.deleted_at is null
  ) on cd.id = a.customer_id and cd.company_id = bedrijf and cd.deleted_at is null
  left join klant_sleutels kp
    on kp.soort = 'pc' and a.postcode <> '' and kp.sleutel = a.postcode || '|' || a.nr
  left join klant_sleutels kst
    on kst.soort = 'straat' and kst.sleutel = a.straat_plaats || '|' || a.nr
  where cd.id is not null or kp.customer_id is not null or kst.customer_id is not null
$$;
revoke execute on function public.loop_adres_klanten(uuid) from public, anon, authenticated;

create or replace function public.loop_maak_klant(
  adres uuid,
  wijk uuid,
  straat uuid,
  prijs numeric,
  interval_maanden integer,
  ritme integer,
  start_maand text,
  naam text,
  telefoon text
)
returns table (customer_id uuid, bestond boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cid uuid;
  v_adres public.loop_adressen%rowtype;
  v_straat uuid := loop_maak_klant.straat;
  v_straatnaam text;
  v_treffer uuid;
  v_inactief boolean;
  v_klant uuid;
  v_nieuw uuid;
  v_naam text := btrim(coalesce(loop_maak_klant.naam, ''));
  v_telefoon text := btrim(coalesce(loop_maak_klant.telefoon, ''));
  v_inactief_melding constant text :=
    'Dit adres staat bij Inactief (gestopt of verhuisd). Zet het eerst weer actief via Klanten → Inactief; dan blijven prijs en notities bewaard.';
begin
  if not public.heeft_recht('klanten_lopen') then
    raise exception 'Je rol mag geen klanten lopen.' using errcode = '42501';
  end if;
  v_cid := public.current_company_id();
  if v_cid is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;

  -- 1. Het adres, op slot: twee lopers kunnen niet tegelijk Ja geven.
  select la.* into v_adres
  from public.loop_adressen la
  where la.id = loop_maak_klant.adres
    and la.company_id = v_cid
    and exists (
      select 1
      from public.loopgebied_adressen ga
      join public.loopgebieden g on g.id = ga.gebied_id and g.company_id = v_cid and g.deleted_at is null
      where ga.adres_id = la.id and ga.company_id = v_cid
    )
  for update of la;
  if not found then
    raise exception 'Dit adres staat niet (meer) in een gebied van je bedrijf.';
  end if;
  if v_adres.customer_id is not null then
    if exists (
      select 1
      from public.customers c
      join public.streets s on s.id = c.street_id and s.company_id = v_cid and s.deleted_at is null
      join public.districts d on d.id = s.district_id and d.company_id = v_cid and d.deleted_at is null
      where c.id = v_adres.customer_id and c.company_id = v_cid and c.deleted_at is null
    ) then
      raise exception 'Dit adres is net al klant gemaakt.';
    end if;
    raise exception 'Dit adres is al eens klant gemaakt en ligt nu in de prullenbak. Zet het daar terug in plaats van het opnieuw klant te maken.';
  end if;

  -- 2. Wijk, straat en prijs.
  perform 1 from public.districts d
  where d.id = loop_maak_klant.wijk and d.company_id = v_cid and d.deleted_at is null;
  if not found then
    raise exception 'Kies een wijk van je eigen bedrijf.';
  end if;
  if v_straat is not null then
    perform 1 from public.streets s
    where s.id = v_straat and s.company_id = v_cid and s.deleted_at is null
      and s.district_id = loop_maak_klant.wijk;
    if not found then
      raise exception 'Deze straat ligt niet in de gekozen wijk.';
    end if;
  end if;
  if loop_maak_klant.prijs is null or loop_maak_klant.prijs < 0 then
    raise exception 'Vul een prijs in.';
  end if;
  if loop_maak_klant.interval_maanden is null or loop_maak_klant.ritme is null then
    raise exception 'Kies een frequentie.';
  end if;
  -- Leeg, of een maand als '2026-10' (maandSleutel in klanten.ts).
  if btrim(coalesce(loop_maak_klant.start_maand, '')) !~ '^([0-9]{4}-(0[1-9]|1[0-2]))?$' then
    raise exception 'De startmaand klopt niet.';
  end if;

  -- 3a. Al klant volgens dezelfde regel als de looplijst?
  select k.customer_id, k.inactief into v_treffer, v_inactief
  from public.loop_adres_klanten(v_cid) k
  where k.adres_id = v_adres.id;

  -- 3b. Anders: hetzelfde huisnummer in de gekozen straat (of in de straat
  -- met de BAG-naam, als er geen straat is gekozen en die naam al bestaat).
  if v_treffer is null then
    if v_straat is null then
      -- Eén tegelijk per wijk, zodat twee lopers niet allebei dezelfde nieuwe
      -- straat aanmaken.
      perform pg_advisory_xact_lock(hashtextextended('loop_maak_klant_straat:' || loop_maak_klant.wijk::text, 0));
      v_straatnaam := regexp_replace(btrim(v_adres.straat), '\s+', ' ', 'g');
      select s.id into v_straat
      from public.streets s
      where s.district_id = loop_maak_klant.wijk
        and s.company_id = v_cid
        and s.deleted_at is null
        and (lower(btrim(s.volledige_naam)) = lower(v_straatnaam) or lower(btrim(s.name)) = lower(v_straatnaam))
      order by (lower(btrim(s.volledige_naam)) = lower(v_straatnaam)) desc, s.sort_order
      limit 1;
    end if;
    if v_straat is not null then
      select c.id, c.inactief_op is not null into v_treffer, v_inactief
      from public.customers c
      where c.street_id = v_straat
        and c.company_id = v_cid
        and c.deleted_at is null
        and lower(regexp_replace(c.house_number::text || c.addition, '[\s-]', '', 'g'))
            = lower(regexp_replace(v_adres.huisnummer::text || v_adres.toevoeging, '[\s-]', '', 'g'))
      order by (c.inactief_op is not null), c.created_at
      limit 1;
    end if;
  end if;

  if v_treffer is not null then
    if v_inactief then
      raise exception '%', v_inactief_melding;
    end if;
    -- Alleen koppelen; de klant zelf blijft zoals hij was.
    update public.loop_adressen la
       set customer_id = v_treffer, uitkomst = 'ja'
     where la.id = v_adres.id and la.company_id = v_cid;
    return query select v_treffer, true;
    return;
  end if;

  -- 4. Een nieuwe straat in de wijk, achteraan.
  if v_straat is null then
    insert into public.streets (company_id, district_id, name, volledige_naam, sort_order)
    values (
      v_cid, loop_maak_klant.wijk, v_straatnaam, v_straatnaam,
      greatest(0, coalesce((
        select max(s.sort_order) from public.streets s
        where s.district_id = loop_maak_klant.wijk and s.company_id = v_cid and s.deleted_at is null
      ), 0)) + 1
    )
    returning id into v_straat;
  end if;

  -- 5. Eerst de klant, als er een naam of telefoon is.
  if v_naam <> '' or v_telefoon <> '' then
    insert into public.klanten (company_id, naam, telefoon)
    values (v_cid, v_naam, v_telefoon)
    returning id into v_klant;
  end if;

  -- 6. Dan het adres, met de klant er meteen in. Daarna geen update meer op
  -- customers.
  insert into public.customers (
    company_id, street_id, house_number, addition, postcode,
    interval_maanden, ritme, start_maand, sort_order, klant_id
  )
  values (
    v_cid, v_straat, v_adres.huisnummer, v_adres.toevoeging,
    case when v_adres.postcode ~ '^[0-9]{4}[A-Z]{2}$'
         then substr(v_adres.postcode, 1, 4) || ' ' || substr(v_adres.postcode, 5, 2)
         else '' end,
    loop_maak_klant.interval_maanden, loop_maak_klant.ritme,
    btrim(coalesce(loop_maak_klant.start_maand, '')),
    greatest(0, coalesce((
      select max(c.sort_order) from public.customers c
      where c.street_id = v_straat and c.company_id = v_cid and c.deleted_at is null
    ), 0)) + 1,
    v_klant
  )
  returning id into v_nieuw;

  -- 7. De prijs: de trigger maakte de regel met 0.
  update public.adres_prijzen ap
     set prijs = loop_maak_klant.prijs
   where ap.customer_id = v_nieuw and ap.company_id = v_cid;

  -- 8. Het BAG-adres is nu klant; de prijs staat voortaan bij de klant.
  update public.loop_adressen la
     set customer_id = v_nieuw, uitkomst = 'ja', prijs = null
   where la.id = v_adres.id and la.company_id = v_cid;

  return query select v_nieuw, false;
end
$$;
revoke execute on function public.loop_maak_klant(uuid, uuid, uuid, numeric, integer, integer, text, text, text) from public, anon;
grant execute on function public.loop_maak_klant(uuid, uuid, uuid, numeric, integer, integer, text, text, text) to authenticated;
