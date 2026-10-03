-- Klanten lopen, fase 1: gebieden, de adressen uit de BAG, de uitkomst aan de
-- deur, en bij "Ja" een nieuwe klant met prijs.
--
-- Plan: .omc/plans/klanten-lopen.md, §4.
--
-- * Een gebied (loopgebieden) hoort bij een wijk of is los (eigen naam en
--   plaats). De adressen komen één keer uit de BAG en staan daarna in
--   loop_adressen: één rij per BAG-verblijfsobject per bedrijf, los van het
--   gebied. De koppeltabel loopgebied_adressen zegt welke adressen in welk
--   gebied liggen; twee gebieden mogen elkaar overlappen.
-- * Uitkomst, prijs, notitie en de eigen correctie van het woningtype horen
--   bij het BAG-adres. Opnieuw ophalen raakt ze nooit aan, en een lege waarde
--   uit de BAG wist nooit iets wat er al stond.
-- * Een loper ziet van een klant alleen "klant" of "inactief", nooit een naam
--   of een prijs. Alles wat customers leest, loopt via de functies hieronder
--   (security definer), en die geven dat niet terug.
-- * Een loper wijzigt met een gewone update alleen uitkomst, prijs, notitie en
--   woningtype_zelf. De BAG-kolommen, de straat en de klant schrijven alleen
--   de functies.
-- * Een vrije notitie wist zichzelf na 24 maanden (pg_cron). De uitkomst blijft.

-- ---------------------------------------------------------------------
-- 0. Samengestelde sleutels, zodat een verwijzing nooit naar een ander
--    bedrijf kan wijzen (customers en klanten hebben er al een)
-- ---------------------------------------------------------------------
alter table public.districts add constraint districts_id_bedrijf_uniek unique (id, company_id);
alter table public.streets   add constraint streets_id_bedrijf_uniek   unique (id, company_id);
alter table public.employees add constraint employees_id_bedrijf_uniek unique (id, company_id);

-- ---------------------------------------------------------------------
-- 1. Het nieuwe recht (de lijst uit 20261019110000_oude_avonden_herstellen.sql
--    plus klanten_lopen)
-- ---------------------------------------------------------------------
alter table public.rollen drop constraint rollen_rechten_check;
alter table public.rollen add constraint rollen_rechten_check check (
  rechten <@ array[
    'mail_lezen', 'mail_versturen', 'klanten_bekijken', 'klanten_bewerken',
    'prijzen_zien', 'planning', 'instellingen_team', 'geldlopen', 'facturen',
    'afrekenen', 'herstellen', 'klanten_lopen'
  ]::text[]
);

-- ---------------------------------------------------------------------
-- 2. De tabellen
-- ---------------------------------------------------------------------
create table public.loopgebieden (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  naam text not null check (length(btrim(naam)) between 1 and 100),
  district_id uuid,                         -- leeg = los gebied
  plaats text not null default '',          -- woonplaatsnaam voor de Locatieserver
  straten text[] not null default '{}',     -- officiële namen (stratenmodus)
  veelhoek jsonb,                           -- GeoJSON Polygon in WGS84 (fase 3)
  opgehaald_op timestamptz,                 -- leeg = onvolledig of nog niet opgehaald
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, company_id),
  foreign key (district_id, company_id) references public.districts(id, company_id) on delete set null (district_id),
  foreign key (created_by, company_id) references public.employees(id, company_id) on delete set null (created_by)
);
create index loopgebieden_company_idx on public.loopgebieden (company_id) where deleted_at is null;
create index loopgebieden_district_idx on public.loopgebieden (district_id) where district_id is not null;

create table public.loop_adressen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vbo_id text not null,                       -- BAG verblijfsobject.identificatie
  pand_id text,
  street_id uuid,                             -- de aangevinkte wijkstraat (bij het ophalen), anders leeg
  straat text not null,
  woonplaats text not null,
  huisnummer int not null,
  toevoeging text not null default '',        -- huisletter + toevoeging, zoals customers.addition
  postcode text not null default '',          -- '2565AV', zonder spatie
  oppervlakte int,
  gebruiksdoel text not null default '',      -- 'woonfunctie', of bv. 'winkelfunctie' (label "bedrijf")
  woningtype text check (woningtype in ('vrijstaand', 'twee_onder_een_kap', 'hoek', 'tussen', 'appartement')),
  woningtype_zelf text check (woningtype_zelf in ('vrijstaand', 'twee_onder_een_kap', 'hoek', 'tussen', 'appartement')),
  bouwlagen int,
  prijs numeric(8,2) check (prijs >= 0),
  uitkomst text check (uitkomst in ('niet_thuis', 'interesse', 'ja', 'nee')),
  uitkomst_op timestamptz,
  uitkomst_door uuid,
  notitie text not null default '',
  notitie_op timestamptz,                     -- voor het wissen na 24 maanden
  customer_id uuid,                           -- gezet bij Ja → klant
  unique (company_id, vbo_id),
  unique (id, company_id),
  foreign key (street_id, company_id) references public.streets(id, company_id) on delete set null (street_id),
  foreign key (customer_id, company_id) references public.customers(id, company_id) on delete set null (customer_id),
  foreign key (uitkomst_door, company_id) references public.employees(id, company_id) on delete set null (uitkomst_door)
);
create index loop_adressen_street_idx on public.loop_adressen (street_id) where street_id is not null;
create index loop_adressen_customer_idx on public.loop_adressen (customer_id) where customer_id is not null;
create index loop_adressen_notitie_op_idx on public.loop_adressen (notitie_op) where notitie_op is not null;

create table public.loopgebied_adressen (
  gebied_id uuid not null,
  adres_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (gebied_id, adres_id),
  foreign key (gebied_id, company_id) references public.loopgebieden(id, company_id) on delete cascade,
  foreign key (adres_id, company_id) references public.loop_adressen(id, company_id) on delete cascade
);
create index loopgebied_adressen_adres_idx on public.loopgebied_adressen (adres_id);

-- ---------------------------------------------------------------------
-- 3. Het bedrijf vult zichzelf in
-- ---------------------------------------------------------------------
create trigger loopgebieden_set_company_id before insert on public.loopgebieden
  for each row execute function public.set_company_id();
create trigger loop_adressen_set_company_id before insert on public.loop_adressen
  for each row execute function public.set_company_id();
create trigger loopgebied_adressen_set_company_id before insert on public.loopgebied_adressen
  for each row execute function public.set_company_id();

-- ---------------------------------------------------------------------
-- 4. Welke klant hoort bij een BAG-adres
--
-- Eén keer alle klantadressen van het bedrijf omzetten naar sleutels, en die
-- met een hash-join aan de BAG-adressen koppelen; nooit een functie per rij.
-- Volgorde: de klant die bij Ja is gekoppeld, dan op postcode + nummer, dan
-- op straat + plaats + nummer. Het nummer is huisnummer + toevoeging zonder
-- spaties en streepjes, in kleine letters (gelijk aan nummerSleutel in
-- postcode.ts). De straat is de hoekstraat, anders de officiële naam, anders
-- de werknaam (gelijk aan adresVanRegel in klanten.ts). Staan er op één
-- sleutel een actieve en een inactieve klant, dan wint de actieve.
--
-- Geeft alleen de adressen terug die een klant hebben:
--   adres_id     loop_adressen.id
--   customer_id  het klantadres (customers.id)
--   inactief     true als het klantadres gestopt is (inactief_op gevuld)
--   hoek_kant    customers.hoek_kant ('', 'even' of 'oneven')
--
-- Alleen voor de functies hieronder; niemand mag hem zelf aanroepen. Gewone
-- SQL zonder security definer en zonder set-regel, zodat Postgres hem in de
-- aanroepende query kan opnemen. Alle namen staan daarom voluit.
-- ---------------------------------------------------------------------
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
                 || '|' || pg_catalog.lower(pg_catalog.btrim(d.plaats)) || '|' || n.nr)
    ) as v(soort, sleutel)
    where c.company_id = bedrijf
      and c.deleted_at is null
      and v.sleutel is not null
    order by v.soort, v.sleutel, (c.inactief_op is not null), c.created_at desc
  ),
  adressen as (
    select la.id, la.customer_id, la.postcode,
      pg_catalog.lower(pg_catalog.regexp_replace(la.huisnummer::text || la.toevoeging, '[\s-]', '', 'g')) as nr,
      pg_catalog.lower(pg_catalog.btrim(la.straat)) || '|' || pg_catalog.lower(pg_catalog.btrim(la.woonplaats)) as straat_plaats
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

-- ---------------------------------------------------------------------
-- 5. Wie wat wanneer deed, zet de database zelf
--
-- Een meegestuurde datum telt nooit: bij een insert alleen als er een
-- uitkomst of notitie is, bij een update alleen als die echt verandert.
-- Het woningtype van een klantadres verbeter je niet vanuit de looplijst.
-- ---------------------------------------------------------------------
create or replace function public.loop_adres_bijhouden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.uitkomst_op := case when new.uitkomst is not null then now() end;
    new.uitkomst_door := case when new.uitkomst is not null then auth.uid() end;
    new.notitie_op := case when btrim(coalesce(new.notitie, '')) <> '' then now() end;
    return new;
  end if;

  -- UPDATE
  if new.uitkomst is distinct from old.uitkomst then
    new.uitkomst_op := case when new.uitkomst is not null then now() end;
    new.uitkomst_door := case when new.uitkomst is not null then auth.uid() end;
  else
    new.uitkomst_op := old.uitkomst_op;
    new.uitkomst_door := old.uitkomst_door;
  end if;

  if new.notitie is distinct from old.notitie then
    new.notitie_op := case when btrim(coalesce(new.notitie, '')) <> '' then now() end;
  else
    new.notitie_op := old.notitie_op;
  end if;

  if new.woningtype_zelf is distinct from old.woningtype_zelf
     and exists (select 1 from public.loop_adres_klanten(new.company_id) k where k.adres_id = new.id) then
    raise exception 'Dit adres is al klant. Het woningtype van een klant verbeter je niet vanuit de looplijst.';
  end if;
  return new;
end
$$;
revoke execute on function public.loop_adres_bijhouden() from public, anon, authenticated;

create trigger loop_adressen_bijhouden before insert or update on public.loop_adressen
  for each row execute function public.loop_adres_bijhouden();

-- ---------------------------------------------------------------------
-- 6. Wie wat mag
-- ---------------------------------------------------------------------
alter table public.loopgebieden enable row level security;
alter table public.loop_adressen enable row level security;
alter table public.loopgebied_adressen enable row level security;

create policy "Lopers zien gebieden" on public.loopgebieden
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));
create policy "Lopers maken gebieden" on public.loopgebieden
  for insert to authenticated
  with check (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));
create policy "Lopers wijzigen gebieden" on public.loopgebieden
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')))
  with check (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));

create policy "Lopers zien adressen" on public.loop_adressen
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));
create policy "Lopers noteren bij adressen" on public.loop_adressen
  for update to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')))
  with check (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));

create policy "Lopers zien welke adressen in een gebied liggen" on public.loopgebied_adressen
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));
create policy "Lopers halen adressen uit een gebied" on public.loopgebied_adressen
  for delete to authenticated
  using (company_id = (select public.current_company_id()) and (select public.heeft_recht('klanten_lopen')));

-- Zonder inlog niets.
revoke all on public.loopgebieden, public.loop_adressen, public.loopgebied_adressen from anon;

-- Een gebied: naam, plaats, straten, veelhoek en weggooien. Wanneer het is
-- opgehaald zet alleen loop_gebied_vullen; de wijk ligt vast bij het maken.
revoke insert, update on public.loopgebieden from authenticated;
grant insert (naam, district_id, plaats, straten, veelhoek) on public.loopgebieden to authenticated;
grant update (naam, plaats, straten, veelhoek, deleted_at) on public.loopgebieden to authenticated;

-- Een adres: alleen wat je aan de deur noteert. Toevoegen gaat alleen via
-- loop_gebied_vullen, klant maken via loop_maak_klant.
revoke insert, update on public.loop_adressen from authenticated;
grant update (uitkomst, prijs, notitie, woningtype_zelf) on public.loop_adressen to authenticated;
revoke insert, update on public.loopgebied_adressen from authenticated;

-- Twee lopers zien elkaars invoer zonder te herladen.
alter publication supabase_realtime add table public.loop_adressen;

-- ---------------------------------------------------------------------
-- 7. De looplijst van één gebied
--
-- loop_lijst(gebied uuid), één rij per adres:
--   id, vbo_id, street_id, straat, woonplaats, huisnummer, toevoeging,
--   postcode, oppervlakte, gebruiksdoel, woningtype, woningtype_zelf,
--   bouwlagen,
--   prijs               de loopprijs; altijd leeg bij een klantadres
--   uitkomst, uitkomst_op,
--   uitkomst_door_naam  employees.naam van wie de uitkomst zette
--   notitie,
--   klant_status        'actief', 'inactief', of leeg (geen klant)
--   klant_adres_id      customers.id, of leeg
--   klant_hoek_kant     customers.hoek_kant van die klant, of leeg
--   straat_volgorde     1, 2, 3 … in de volgorde van de wijk (wijk, stuk,
--                       straat); straten zonder wijkstraat (nieuwbouw)
--                       achteraan op alfabet
--   sort_desc, doorlopend  van die wijkstraat (false zonder wijkstraat)
-- Gesorteerd op straat_volgorde, huisnummer, toevoeging. Nooit een naam of
-- een prijs van een klant.
-- ---------------------------------------------------------------------
create or replace function public.loop_lijst(gebied uuid)
returns table (
  id uuid,
  vbo_id text,
  street_id uuid,
  straat text,
  woonplaats text,
  huisnummer integer,
  toevoeging text,
  postcode text,
  oppervlakte integer,
  gebruiksdoel text,
  woningtype text,
  woningtype_zelf text,
  bouwlagen integer,
  prijs numeric,
  uitkomst text,
  uitkomst_op timestamptz,
  uitkomst_door_naam text,
  notitie text,
  klant_status text,
  klant_adres_id uuid,
  klant_hoek_kant text,
  straat_volgorde integer,
  sort_desc boolean,
  doorlopend boolean
)
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
  where g.id = loop_lijst.gebied and g.company_id = v_cid and g.deleted_at is null;
  if not found then
    raise exception 'Dit gebied bestaat niet (meer).';
  end if;

  return query
  with rijen as (
    select la.*
    from public.loopgebied_adressen ga
    join public.loop_adressen la on la.id = ga.adres_id and la.company_id = v_cid
    where ga.gebied_id = loop_lijst.gebied and ga.company_id = v_cid
  ),
  -- De straten van de wijk op naam, voor adressen zonder gekoppelde wijkstraat.
  -- De officiële naam gaat voor de werknaam.
  wijkstraten as (
    select distinct on (n.naam) n.naam, s.id, s.groep_id, s.sort_order, s.sort_desc, s.doorlopend, s.district_id
    from public.streets s
    cross join lateral (values
      (lower(nullif(btrim(s.volledige_naam), '')), 1),
      (lower(btrim(s.name)), 2)
    ) as n(naam, voorkeur)
    where v_wijk is not null
      and s.district_id = v_wijk
      and s.company_id = v_cid
      and s.deleted_at is null
      and n.naam is not null
    order by n.naam, n.voorkeur, s.sort_order
  ),
  met_straat as (
    select r.*,
      coalesce(s0.id, w.id) as ws_id,
      coalesce(s0.sort_order, w.sort_order) as ws_sort,
      coalesce(s0.sort_desc, w.sort_desc) as ws_desc,
      coalesce(s0.doorlopend, w.doorlopend) as ws_door,
      coalesce(s0.groep_id, w.groep_id) as ws_groep,
      coalesce(s0.district_id, w.district_id) as ws_wijk
    from rijen r
    left join public.streets s0
      on s0.id = r.street_id and s0.company_id = v_cid and s0.deleted_at is null
     and (v_wijk is null or s0.district_id = v_wijk)
    left join wijkstraten w
      on s0.id is null and w.naam = lower(btrim(r.straat))
  ),
  geordend as (
    select m.*,
      k.customer_id as k_id, k.inactief as k_inactief, k.hoek_kant as k_hoek,
      dense_rank() over (
        order by (m.ws_id is null), d.sort_order, grp.sort_order nulls last, m.ws_sort,
          case when m.ws_id is null then lower(m.straat) || '|' || lower(m.woonplaats) else m.ws_id::text end
      ) as volgorde
    from met_straat m
    left join public.loop_adres_klanten(v_cid) k on k.adres_id = m.id
    left join public.straat_groepen grp on grp.id = m.ws_groep and grp.company_id = v_cid
    left join public.districts d on d.id = m.ws_wijk and d.company_id = v_cid and d.deleted_at is null
  )
  select
    o.id, o.vbo_id, o.street_id, o.straat, o.woonplaats, o.huisnummer, o.toevoeging, o.postcode,
    o.oppervlakte, o.gebruiksdoel, o.woningtype, o.woningtype_zelf, o.bouwlagen,
    case when o.k_id is null then o.prijs end,
    o.uitkomst, o.uitkomst_op, e.naam, o.notitie,
    case when o.k_id is null then null when o.k_inactief then 'inactief' else 'actief' end,
    o.k_id, o.k_hoek,
    o.volgorde::integer,
    coalesce(o.ws_desc, false), coalesce(o.ws_door, false)
  from geordend o
  left join public.employees e on e.id = o.uitkomst_door and e.company_id = v_cid
  order by o.volgorde, o.huisnummer, o.toevoeging;
end
$$;
revoke execute on function public.loop_lijst(uuid) from public, anon;
grant execute on function public.loop_lijst(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. De tellers van alle gebieden in één keer (gebiedenlijst en Home)
--
-- loop_tellingen(), één rij per gebied dat niet is weggegooid:
--   gebied_id, naam, district_id, wijk (naam van de wijk, leeg bij los),
--   plaats, straten, opgehaald_op, created_at,
--   totaal      alle adressen in het gebied
--   klanten     adressen met een klant (actief of inactief)
--   te_lopen    geen klant en nog geen uitkomst (woningen én bedrijven)
--   niet_thuis, interesse, nee   die uitkomst, zonder klant
--   ja          uitkomst ja (ook als er inmiddels een klant aan hangt)
--   onvolledig  opgehaald_op is leeg
-- Nieuwste gebied eerst.
-- ---------------------------------------------------------------------
create or replace function public.loop_tellingen()
returns table (
  gebied_id uuid,
  naam text,
  district_id uuid,
  wijk text,
  plaats text,
  straten text[],
  opgehaald_op timestamptz,
  created_at timestamptz,
  totaal integer,
  klanten integer,
  te_lopen integer,
  niet_thuis integer,
  interesse integer,
  ja integer,
  nee integer,
  onvolledig boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cid uuid;
begin
  if not public.heeft_recht('klanten_lopen') then
    raise exception 'Je rol mag geen klanten lopen.' using errcode = '42501';
  end if;
  v_cid := public.current_company_id();

  return query
  with rijen as (
    select ga.gebied_id as gid, la.uitkomst as uk, (k.adres_id is not null) as is_klant
    from public.loopgebied_adressen ga
    join public.loopgebieden g on g.id = ga.gebied_id and g.company_id = v_cid and g.deleted_at is null
    join public.loop_adressen la on la.id = ga.adres_id and la.company_id = v_cid
    left join public.loop_adres_klanten(v_cid) k on k.adres_id = la.id
    where ga.company_id = v_cid
  ),
  per_gebied as (
    select r.gid,
      count(*)::integer as n_totaal,
      (count(*) filter (where r.is_klant))::integer as n_klanten,
      (count(*) filter (where not r.is_klant and r.uk is null))::integer as n_te_lopen,
      (count(*) filter (where not r.is_klant and r.uk = 'niet_thuis'))::integer as n_niet_thuis,
      (count(*) filter (where not r.is_klant and r.uk = 'interesse'))::integer as n_interesse,
      (count(*) filter (where r.uk = 'ja'))::integer as n_ja,
      (count(*) filter (where not r.is_klant and r.uk = 'nee'))::integer as n_nee
    from rijen r
    group by r.gid
  )
  select g.id, g.naam, g.district_id, d.name, g.plaats, g.straten, g.opgehaald_op, g.created_at,
    coalesce(p.n_totaal, 0), coalesce(p.n_klanten, 0), coalesce(p.n_te_lopen, 0),
    coalesce(p.n_niet_thuis, 0), coalesce(p.n_interesse, 0), coalesce(p.n_ja, 0), coalesce(p.n_nee, 0),
    g.opgehaald_op is null
  from public.loopgebieden g
  left join public.districts d on d.id = g.district_id and d.company_id = v_cid and d.deleted_at is null
  left join per_gebied p on p.gid = g.id
  where g.company_id = v_cid and g.deleted_at is null
  order by g.created_at desc;
end
$$;
revoke execute on function public.loop_tellingen() from public, anon;
grant execute on function public.loop_tellingen() to authenticated;

-- ---------------------------------------------------------------------
-- 9. Een gebied vullen met adressen uit de BAG
--
-- loop_gebied_vullen(gebied, adressen, eerste, laatste, straat_weg) → het
-- aantal adressen dat daarna in het gebied ligt.
--
-- adressen is een jsonb-lijst met per adres:
--   { "vbo_id": "0518010000123456",  -- verplicht, 16 cijfers, teken 5–6 = 01
--     "straat": "Rozenstraat",        -- verplicht, officiële BAG-naam
--     "woonplaats": "'s-Gravenhage",  -- verplicht
--     "huisnummer": 12,               -- verplicht, > 0
--     "toevoeging": "A",              -- huisletter + toevoeging, of ""
--     "postcode": "2565AV",
--     "street_id": "<uuid>",          -- de aangevinkte wijkstraat, of null
--     "pand_id": "0518100000654321",
--     "oppervlakte": 96,
--     "gebruiksdoel": "woonfunctie",
--     "woningtype": "tussen",         -- of null
--     "bouwlagen": 3 }                -- of null
-- Een dubbel vbo_id telt één keer. Een lege waarde wist nooit wat er al stond,
-- en uitkomst, prijs, notitie, woningtype_zelf en de klant blijven altijd
-- onaangeroerd.
--
-- eerste = true zet het gebied eerst op onvolledig, laatste = true zet daarna
-- opgehaald_op. In stukken: het eerste stuk eerste, het laatste laatste; gaat
-- er tussendoor iets mis, dan blijft het gebied "Onvolledig".
-- straat_weg (de BAG-naam) haalt de adressen van die straat uit het gebied;
-- de adressen zelf blijven bestaan. De lijst straten op het gebied werkt de
-- app zelf bij.
-- ---------------------------------------------------------------------
create or replace function public.loop_gebied_vullen(
  gebied uuid,
  adressen jsonb,
  eerste boolean,
  laatste boolean,
  straat_weg text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_cid uuid;
  v_wijk uuid;
  v_invoer jsonb := coalesce(loop_gebied_vullen.adressen, '[]'::jsonb);
  v_weg text := nullif(regexp_replace(btrim(coalesce(loop_gebied_vullen.straat_weg, '')), '\s+', ' ', 'g'), '');
  v_aantal integer;
begin
  if not public.heeft_recht('klanten_lopen') then
    raise exception 'Je rol mag geen klanten lopen.' using errcode = '42501';
  end if;
  v_cid := public.current_company_id();
  if v_cid is null then
    raise exception 'Geen bedrijf gevonden.';
  end if;

  select g.district_id into v_wijk
  from public.loopgebieden g
  where g.id = loop_gebied_vullen.gebied and g.company_id = v_cid and g.deleted_at is null
  for update;
  if not found then
    raise exception 'Dit gebied bestaat niet (meer).';
  end if;

  if jsonb_typeof(v_invoer) <> 'array' then
    raise exception 'De adressen moeten een lijst zijn.';
  end if;
  if jsonb_array_length(v_invoer) > 5000 then
    raise exception 'Te veel adressen in één keer (meer dan 5000). Stuur ze in stukken.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_invoer) as r(vbo_id text, straat text, woonplaats text, huisnummer integer)
    where r.vbo_id is null
       or r.vbo_id !~ '^[0-9]{4}01[0-9]{10}$'
       or btrim(coalesce(r.straat, '')) = ''
       or btrim(coalesce(r.woonplaats, '')) = ''
       or r.huisnummer is null
       or r.huisnummer <= 0
  ) then
    raise exception 'Een adres uit de BAG is niet compleet (id, straat, plaats of huisnummer ontbreekt).';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_invoer) as r(street_id uuid)
    where r.street_id is not null
      and not exists (
        select 1 from public.streets s
        where s.id = r.street_id
          and s.company_id = v_cid
          and s.deleted_at is null
          and s.district_id = v_wijk
      )
  ) then
    raise exception 'Een straat hoort niet bij de wijk van dit gebied.';
  end if;

  if loop_gebied_vullen.eerste then
    update public.loopgebieden g set opgehaald_op = null
    where g.id = loop_gebied_vullen.gebied and g.company_id = v_cid;
  end if;

  insert into public.loop_adressen as la (
    company_id, vbo_id, pand_id, street_id, straat, woonplaats, huisnummer, toevoeging,
    postcode, oppervlakte, gebruiksdoel, woningtype, bouwlagen
  )
  select distinct on (r.vbo_id)
    v_cid,
    r.vbo_id,
    nullif(btrim(coalesce(r.pand_id, '')), ''),
    r.street_id,
    regexp_replace(btrim(r.straat), '\s+', ' ', 'g'),
    regexp_replace(btrim(r.woonplaats), '\s+', ' ', 'g'),
    r.huisnummer,
    btrim(coalesce(r.toevoeging, '')),
    upper(regexp_replace(coalesce(r.postcode, ''), '\s', '', 'g')),
    r.oppervlakte,
    btrim(coalesce(r.gebruiksdoel, '')),
    nullif(btrim(coalesce(r.woningtype, '')), ''),
    r.bouwlagen
  from jsonb_to_recordset(v_invoer) as r(
    vbo_id text, pand_id text, street_id uuid, straat text, woonplaats text, huisnummer integer,
    toevoeging text, postcode text, oppervlakte integer, gebruiksdoel text, woningtype text, bouwlagen integer
  )
  order by r.vbo_id, r.street_id nulls last
  on conflict (company_id, vbo_id) do update set
    pand_id = coalesce(excluded.pand_id, la.pand_id),
    street_id = coalesce(excluded.street_id, la.street_id),
    straat = excluded.straat,
    woonplaats = excluded.woonplaats,
    huisnummer = excluded.huisnummer,
    toevoeging = excluded.toevoeging,
    postcode = coalesce(nullif(excluded.postcode, ''), la.postcode),
    oppervlakte = coalesce(excluded.oppervlakte, la.oppervlakte),
    gebruiksdoel = coalesce(nullif(excluded.gebruiksdoel, ''), la.gebruiksdoel),
    woningtype = coalesce(excluded.woningtype, la.woningtype),
    bouwlagen = coalesce(excluded.bouwlagen, la.bouwlagen)
  where (la.pand_id, la.street_id, la.straat, la.woonplaats, la.huisnummer, la.toevoeging,
         la.postcode, la.oppervlakte, la.gebruiksdoel, la.woningtype, la.bouwlagen)
        is distinct from
        (coalesce(excluded.pand_id, la.pand_id), coalesce(excluded.street_id, la.street_id),
         excluded.straat, excluded.woonplaats, excluded.huisnummer, excluded.toevoeging,
         coalesce(nullif(excluded.postcode, ''), la.postcode), coalesce(excluded.oppervlakte, la.oppervlakte),
         coalesce(nullif(excluded.gebruiksdoel, ''), la.gebruiksdoel), coalesce(excluded.woningtype, la.woningtype),
         coalesce(excluded.bouwlagen, la.bouwlagen));

  insert into public.loopgebied_adressen (gebied_id, adres_id, company_id)
  select loop_gebied_vullen.gebied, la.id, v_cid
  from public.loop_adressen la
  where la.company_id = v_cid
    and la.vbo_id in (select r.vbo_id from jsonb_to_recordset(v_invoer) as r(vbo_id text))
  on conflict do nothing;

  if v_weg is not null then
    delete from public.loopgebied_adressen ga
    using public.loop_adressen la
    where ga.gebied_id = loop_gebied_vullen.gebied
      and ga.company_id = v_cid
      and la.id = ga.adres_id
      and la.company_id = v_cid
      and lower(la.straat) = lower(v_weg);
  end if;

  if loop_gebied_vullen.laatste then
    update public.loopgebieden g set opgehaald_op = now()
    where g.id = loop_gebied_vullen.gebied and g.company_id = v_cid;
  end if;

  select count(*)::integer into v_aantal
  from public.loopgebied_adressen ga
  where ga.gebied_id = loop_gebied_vullen.gebied and ga.company_id = v_cid;
  return v_aantal;
end
$$;
revoke execute on function public.loop_gebied_vullen(uuid, jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.loop_gebied_vullen(uuid, jsonb, boolean, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Ja → klant, voor elke loper (ook zonder Klanten bewerken)
--
-- loop_maak_klant(adres, wijk, straat, prijs, interval_maanden, ritme,
--                 start_maand, naam, telefoon)
--   → (customer_id uuid, bestond boolean)
--
-- straat leeg = een straat in de wijk met de BAG-naam (bestaat die naam al in
-- de wijk, dan die). naam en telefoon zijn optioneel; is een van beide
-- gevuld, dan komt er een klant bij. start_maand komt uit de app
-- (startMaandVoorNieuw).
--
-- Is het adres al een actieve klant (dezelfde regel als de looplijst, of
-- hetzelfde huisnummer in de gekozen straat), dan wordt alleen het BAG-adres
-- gekoppeld en komt bestond = true terug; aan die klant verandert niets, ook
-- de prijs niet. Een inactieve klant geeft dezelfde melding als "+ adres".
--
-- De volgorde houdt rekening met de triggers op customers: klant_id gaat
-- meteen mee in de insert (een latere wijziging van klant_id vraagt Klanten
-- bewerken), customers_prijs_aanmaken maakt de prijsregel met 0 en die zetten
-- we daarna op de prijs; adres_prijzen_duur_vullen vult dan de duur.
-- ---------------------------------------------------------------------
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
        and c.house_number = v_adres.huisnummer
        and upper(btrim(c.addition)) = upper(btrim(v_adres.toevoeging))
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

-- ---------------------------------------------------------------------
-- 11. Notities ouder dan 24 maanden wissen
--
-- Alleen voor de nacht (pg_cron, zonder ingelogde gebruiker), over alle
-- bedrijven. De uitkomst blijft altijd staan. Geeft het aantal gewiste
-- notities terug.
-- ---------------------------------------------------------------------
create or replace function public.loop_notities_opruimen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  weg integer;
begin
  update public.loop_adressen la
     set notitie = '', notitie_op = null
   where la.notitie_op < now() - interval '24 months';
  get diagnostics weg = row_count;
  return weg;
end
$$;
revoke execute on function public.loop_notities_opruimen() from public, anon, authenticated;

-- pg_cron rekent in UTC; 03:20 UTC is hier vier of vijf uur 's nachts.
select cron.unschedule('loop-notities-opruimen')
where exists (select 1 from cron.job where jobname = 'loop-notities-opruimen');

select cron.schedule(
  'loop-notities-opruimen',
  '20 3 * * *',
  $$select public.loop_notities_opruimen();$$
);
