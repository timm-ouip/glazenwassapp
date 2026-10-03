-- Klanten lopen, fase 2: een prijsvoorstel per adres.
--
-- Plan: .omc/plans/klanten-lopen.md, §7.
--
-- loop_voorstellen(gebied uuid) geeft per adres in het gebied zonder eigen
-- prijs, zonder klant en met een woningtype (de eigen correctie gaat voor de
-- schatting) één regel:
--   adres_id  loop_adressen.id
--   voorstel  de mediaan van de vergelijkbare prijzen, afgerond op € 0,50
--   n         op hoeveel prijzen dat voorstel rust
--   niveau    'straat', 'buurt' of 'wijk'
-- Meer niet: geen referentierijen, geen oppervlakte en geen huisnummers, zodat
-- de prijs van één klant er niet uit terug te rekenen is.
--
-- Wat telt als vergelijkbare prijs: een adres van het eigen bedrijf met
-- hetzelfde type en een prijs boven 0.
--   * Hoort er een actieve klant bij (dezelfde koppeling als de looplijst,
--     loop_adres_klanten), dan de prijs van die klant (adres_prijzen). Ook voor
--     een loper zonder "Prijzen zien": dat heeft Timmie zo besloten (D1).
--   * Een inactieve klant telt niet mee, ook zijn loopprijs niet.
--   * Anders de loopprijs die een loper intikte.
--   * Eén klant telt één keer; het adres zelf telt nooit mee.
--   * Klantprijzen tellen op een niveau alleen mee als er daar minstens 3
--     zijn. Anders kon een loper met twee zelf getikte loopprijzen (één heel
--     lage, één heel hoge) de prijs van die ene klant precies als mediaan
--     terugkrijgen. Met minstens 3 klantprijzen weet hij hooguit dat het
--     voorstel bij een van hen ligt, niet bij wie (het restlek uit D1).
--
-- Het niveau, op volgorde (D6):
--   1. straat  dezelfde straat (naam + plaats), minstens 3 prijzen;
--   2. buurt   ook de andere straten van dit gebied en de straten in hetzelfde
--              stuk (straat_groep) van de wijk, minstens 2;
--   3. wijk    ook alle straten van de wijk van het gebied, minstens 2;
--   anders geen voorstel (een gloednieuw gebied krijgt er pas een als er
--   prijzen zijn).
--
-- De schatting: de mediaan van prijs × least(1.25, greatest(0.8, sqrt(m / m_ref))),
-- met m de oppervlakte van het adres en m_ref die van de vergelijking. Ontbreekt
-- een van de twee, dan de prijs zelf.

create or replace function public.loop_voorstellen(gebied uuid)
returns table (adres_id uuid, voorstel numeric, n integer, niveau text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cid uuid;
  v_wijk uuid;
begin
  if not public.heeft_recht('klanten_lopen') then
    raise exception 'Je rol mag geen klanten lopen.' using errcode = '42501';
  end if;
  v_cid := public.current_company_id();
  select g.district_id into v_wijk
  from public.loopgebieden g
  where g.id = loop_voorstellen.gebied and g.company_id = v_cid and g.deleted_at is null;
  if not found then
    raise exception 'Dit gebied bestaat niet (meer).';
  end if;

  return query
  with klant as materialized (
    select k.adres_id, k.customer_id, k.inactief
    from public.loop_adres_klanten(v_cid) k
  ),
  in_gebied as (
    select ga.adres_id
    from public.loopgebied_adressen ga
    where ga.gebied_id = loop_voorstellen.gebied and ga.company_id = v_cid
  ),
  -- De straten van de wijk op naam (zoals in loop_lijst), voor adressen zonder
  -- gekoppelde wijkstraat. Alleen in de plaats van de wijk.
  wijkstraten as (
    select distinct on (nm.naam) nm.naam, s.id, public.loop_plaats_sleutel(d.plaats) as plaats
    from public.streets s
    join public.districts d on d.id = s.district_id and d.company_id = v_cid and d.deleted_at is null
    cross join lateral (values
      (lower(nullif(btrim(s.volledige_naam), '')), 1),
      (lower(btrim(s.name)), 2)
    ) as nm(naam, voorkeur)
    where v_wijk is not null
      and s.district_id = v_wijk
      and s.company_id = v_cid
      and s.deleted_at is null
      and nm.naam is not null
    order by nm.naam, nm.voorkeur, s.sort_order
  ),
  -- Elk adres van het bedrijf met een type, met zijn prijs en zijn wijkstraat:
  -- die van de klant, anders de gekoppelde, anders op naam.
  adressen as (
    select la.id,
      coalesce(la.woningtype_zelf, la.woningtype) as soort,
      la.oppervlakte as opp,
      lower(btrim(la.straat)) || '|' || public.loop_plaats_sleutel(la.woonplaats) as straat_sleutel,
      k.customer_id,
      (k.adres_id is not null) as is_klant,
      case when k.adres_id is null then la.prijs
           when not k.inactief then ap.prijs end as p,
      coalesce(cs.id, s0.id, w.id) as straat_id
    from public.loop_adressen la
    left join klant k on k.adres_id = la.id
    left join public.customers c
      on c.id = k.customer_id and c.company_id = v_cid and c.deleted_at is null
    left join public.adres_prijzen ap on ap.customer_id = c.id and ap.company_id = v_cid
    left join public.streets cs on cs.id = c.street_id and cs.company_id = v_cid and cs.deleted_at is null
    left join public.streets s0 on s0.id = la.street_id and s0.company_id = v_cid and s0.deleted_at is null
    left join wijkstraten w
      on w.naam = lower(btrim(la.straat))
     and (w.plaats = '' or w.plaats = public.loop_plaats_sleutel(la.woonplaats))
    where la.company_id = v_cid
      and coalesce(la.woningtype_zelf, la.woningtype) is not null
  ),
  met_straat as (
    select a.*, st.groep_id as groep, st.district_id as wijk, (ig.adres_id is not null) as in_dit_gebied
    from adressen a
    left join public.streets st on st.id = a.straat_id and st.company_id = v_cid and st.deleted_at is null
    left join in_gebied ig on ig.adres_id = a.id
  ),
  -- Waar een voorstel voor komt: in dit gebied, geen klant, geen eigen prijs.
  doelen as (
    select ms.* from met_straat ms
    where ms.in_dit_gebied and not ms.is_klant and ms.p is null
  ),
  -- De vergelijkbare prijzen, alleen die in de buurt van een doel liggen.
  referenties as (
    select distinct on (coalesce(ms.customer_id, ms.id)) ms.*
    from met_straat ms
    where ms.p > 0
      and (ms.in_dit_gebied
           or (v_wijk is not null and ms.wijk = v_wijk)
           or ms.groep in (select d.groep from doelen d where d.groep is not null)
           or ms.straat_sleutel in (select d.straat_sleutel from doelen d))
    order by coalesce(ms.customer_id, ms.id), ms.id
  ),
  kandidaten as (
    select d.id as doel,
      r.p * case when d.opp > 0 and r.opp > 0
                 then least(1.25, greatest(0.8, sqrt(d.opp::numeric / r.opp::numeric)))
                 else 1 end as schatting,
      r.is_klant,
      (r.straat_sleutel = d.straat_sleutel) as op_straat,
      (r.straat_sleutel = d.straat_sleutel
        or r.in_dit_gebied
        or (d.groep is not null and r.groep = d.groep)) as op_buurt,
      (r.straat_sleutel = d.straat_sleutel
        or r.in_dit_gebied
        or (d.groep is not null and r.groep = d.groep)
        or (v_wijk is not null and r.wijk = v_wijk)) as op_wijk
    from doelen d
    join referenties r on r.soort = d.soort and r.id <> d.id
  ),
  op_niveau as (
    select k.doel, v.niveau, v.rang, k.schatting, k.is_klant,
      count(*) filter (where k.is_klant) over (partition by k.doel, v.niveau) as klantprijzen
    from kandidaten k
    cross join lateral (values
      ('straat', 1, k.op_straat),
      ('buurt', 2, k.op_buurt),
      ('wijk', 3, k.op_wijk)
    ) as v(niveau, rang, telt)
    where v.telt
  ),
  per_niveau as (
    select o.doel, o.niveau, o.rang, count(*)::integer as aantal,
      percentile_cont(0.5) within group (order by o.schatting::float8) as mediaan
    from op_niveau o
    where not o.is_klant or o.klantprijzen >= 3
    group by o.doel, o.niveau, o.rang
  ),
  gekozen as (
    select distinct on (p.doel) p.doel, p.niveau, p.aantal, p.mediaan
    from per_niveau p
    where p.aantal >= case p.niveau when 'straat' then 3 else 2 end
    order by p.doel, p.rang
  )
  select g.doel, (round(g.mediaan::numeric * 2) / 2)::numeric(8, 2), g.aantal, g.niveau
  from gekozen g;
end
$$;
revoke execute on function public.loop_voorstellen(uuid) from public, anon;
grant execute on function public.loop_voorstellen(uuid) to authenticated;
