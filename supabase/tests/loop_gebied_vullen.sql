-- Proef: een gebied vullen met adressen uit de BAG (plan klanten-lopen, stap 1 d3 en e).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug. Twee wegwerpbedrijven A en B.
-- Laat hij "OK loop_gebied_vullen" zien, dan klopt alles.

begin;

-- ---------------------------------------------------------------------
-- Opzet (als postgres)
-- ---------------------------------------------------------------------
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Proefbedrijf B (test)');

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'loper-a@proef.invalid', 'authenticated', 'authenticated');

insert into public.rollen (id, company_id, naam, rechten) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefloper', array['klanten_lopen']);

insert into public.employees (id, company_id, naam, email, rol, rol_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Loper A', 'loper-a@proef.invalid', 'medewerker', 'aaaaaaaa-0000-4000-8000-0000000000c1');

insert into public.districts (id, company_id, name, plaats) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefwijk Noord', 'Proefstad'),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefwijk Zuid', 'Proefstad'),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefwijk B', 'Proefstad');

insert into public.streets (id, company_id, district_id, name, volledige_naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Proefstraat', 'Proefstraat', 1),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d2', 'Zuiderproeflaan', 'Zuiderproeflaan', 1),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Proefstraat', 'Proefstraat', 1);

insert into public.loopgebieden (id, company_id, naam, district_id, plaats, deleted_at) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied bij wijk', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Proefstad', null),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Los proefgebied', null, 'Proefstad', null),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000000', 'Weggegooid proefgebied', null, 'Proefstad', now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefgebied B', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Proefstad', null);

-- B heeft al een adres met hetzelfde vbo_id als A straks krijgt.
insert into public.loop_adressen (id, company_id, vbo_id, straat, woonplaats, huisnummer, bouwlagen, prijs) values
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000001', 'Proefstraat', 'Proefstad', 10, 2, 50.00);
insert into public.loopgebied_adressen (gebied_id, adres_id, company_id) values
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000');

-- ---------------------------------------------------------------------
-- Als loper A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- Eerste vulling, met vbo 1 twee keer (twee cellen die overlappen).
do $$
declare
  n integer;
  r record;
begin
  n := public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
    {"vbo_id": "9990010000000001", "street_id": "aaaaaaaa-0000-4000-8000-0000000000e1", "straat": "Proefstraat",
     "woonplaats": "Proefstad", "huisnummer": 10, "toevoeging": "", "postcode": "0001 aa", "pand_id": "9990100000000001",
     "oppervlakte": 96, "gebruiksdoel": "woonfunctie", "woningtype": "tussen", "bouwlagen": 3},
    {"vbo_id": "9990010000000001", "street_id": "aaaaaaaa-0000-4000-8000-0000000000e1", "straat": "Proefstraat",
     "woonplaats": "Proefstad", "huisnummer": 10, "toevoeging": "", "postcode": "0001 aa", "pand_id": "9990100000000001",
     "oppervlakte": 96, "gebruiksdoel": "woonfunctie", "woningtype": "tussen", "bouwlagen": 3},
    {"vbo_id": "9990010000000002", "street_id": "aaaaaaaa-0000-4000-8000-0000000000e1", "straat": "Proefstraat",
     "woonplaats": "Proefstad", "huisnummer": 12, "toevoeging": "A", "postcode": "0001AA",
     "oppervlakte": 80, "gebruiksdoel": "winkelfunctie"}
  ]$j$::jsonb, true, true);
  assert n = 2, format('d3: een dubbel vbo_id moet één adres geven; het gebied heeft er %s', n);
  assert (select count(*) from public.loop_adressen where vbo_id = '9990010000000001') = 1,
    'd3: vbo 1 mag maar één keer bestaan (en de rij van B zie je niet)';
  assert (select opgehaald_op from public.loopgebieden where id = 'aaaaaaaa-0000-4000-8000-0000000000f1') = now(),
    'd3: na het laatste stuk staat opgehaald_op';

  select * into r from public.loop_adressen where vbo_id = '9990010000000001';
  assert r.postcode = '0001AA', 'd3: de postcode wordt zonder spatie en in hoofdletters bewaard';
  assert r.company_id = 'aaaaaaaa-0000-4000-8000-000000000000', 'd3: het adres hoort bij A';
end $$;

-- De loper noteert iets.
update public.loop_adressen
   set uitkomst = 'interesse', prijs = 21.00, notitie = 'Serre aan de achterkant', woningtype_zelf = 'hoek'
 where vbo_id = '9990010000000001';

-- Tweede vulling: de BAG kent bouwlagen, woningtype, postcode en straat niet meer, wel een nieuwe oppervlakte.
do $$
declare
  voor record;
  na record;
begin
  select * into voor from public.loop_adressen where vbo_id = '9990010000000001';
  perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
    {"vbo_id": "9990010000000001", "street_id": null, "straat": "Proefstraat", "woonplaats": "Proefstad",
     "huisnummer": 10, "toevoeging": "", "postcode": "", "oppervlakte": 98, "gebruiksdoel": "woonfunctie",
     "woningtype": null, "bouwlagen": null}
  ]$j$::jsonb, true, true);
  select * into na from public.loop_adressen where vbo_id = '9990010000000001';

  assert na.id = voor.id, 'd3: opnieuw ophalen maakt geen nieuwe rij';
  assert na.bouwlagen = 3, 'd3: een lege bouwlagen wist de bekende waarde niet';
  assert na.woningtype = 'tussen', 'd3: een leeg woningtype wist de schatting niet';
  assert na.street_id = 'aaaaaaaa-0000-4000-8000-0000000000e1', 'd3: een lege street_id wist de wijkstraat niet';
  assert na.postcode = '0001AA', 'd3: een lege postcode wist de bekende niet';
  assert na.pand_id = '9990100000000001', 'd3: een leeg pand_id wist het bekende niet';
  assert na.oppervlakte = 98, 'd3: een nieuwe oppervlakte uit de BAG komt wel door';
  assert na.uitkomst = 'interesse' and na.uitkomst_op = voor.uitkomst_op and na.uitkomst_door = voor.uitkomst_door,
    'd3: de uitkomst blijft onaangeroerd';
  assert na.prijs = 21.00, 'd3: de prijs blijft onaangeroerd';
  assert na.notitie = 'Serre aan de achterkant' and na.notitie_op = voor.notitie_op, 'd3: de notitie blijft onaangeroerd';
  assert na.woningtype_zelf = 'hoek', 'd3: de eigen correctie van het woningtype blijft onaangeroerd';
  assert na.customer_id is null, 'd3: de klantkoppeling blijft onaangeroerd';
end $$;

-- Een straat die niet bij de wijk van het gebied hoort, of van B is, faalt.
do $$
declare
  ok boolean;
begin
  ok := false;
  begin
    perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
      {"vbo_id": "9990010000000003", "street_id": "aaaaaaaa-0000-4000-8000-0000000000e2", "straat": "Zuiderproeflaan",
       "woonplaats": "Proefstad", "huisnummer": 1}
    ]$j$::jsonb, false, false);
  exception when raise_exception then ok := sqlerrm like 'Een straat hoort niet bij de wijk%';
  end;
  assert ok, 'd3: een street_id uit een andere wijk moet falen';

  ok := false;
  begin
    perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
      {"vbo_id": "9990010000000003", "street_id": "bbbbbbbb-0000-4000-8000-0000000000e1", "straat": "Proefstraat",
       "woonplaats": "Proefstad", "huisnummer": 1}
    ]$j$::jsonb, false, false);
  exception when raise_exception then ok := sqlerrm like 'Een straat hoort niet bij de wijk%';
  end;
  assert ok, 'd3: een street_id van een ander bedrijf moet falen';

  ok := false;
  begin
    perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f2', $j$[
      {"vbo_id": "9990010000000003", "street_id": "aaaaaaaa-0000-4000-8000-0000000000e1", "straat": "Proefstraat",
       "woonplaats": "Proefstad", "huisnummer": 1}
    ]$j$::jsonb, false, false);
  exception when raise_exception then ok := sqlerrm like 'Een straat hoort niet bij de wijk%';
  end;
  assert ok, 'd3: een los gebied heeft geen wijkstraten';

  ok := false;
  begin
    perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
      {"vbo_id": "9990100000000003", "straat": "Proefstraat", "woonplaats": "Proefstad", "huisnummer": 1}
    ]$j$::jsonb, false, false);
  exception when raise_exception then ok := sqlerrm like 'Een adres uit de BAG is niet compleet%';
  end;
  assert ok, 'd3: een id dat geen verblijfsobject is (teken 5-6 geen 01) moet falen';

  assert not exists (select 1 from public.loop_adressen where vbo_id in ('9990010000000003', '9990100000000003')),
    'd3: na een fout is er niets weggeschreven';
end $$;

-- Een fout tussen twee stukken: eerste stuk wel, laatste niet → Onvolledig.
do $$
begin
  perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
    {"vbo_id": "9990010000000004", "straat": "Proefstraat", "woonplaats": "Proefstad", "huisnummer": 14}
  ]$j$::jsonb, true, false);
  assert (select opgehaald_op from public.loopgebieden where id = 'aaaaaaaa-0000-4000-8000-0000000000f1') is null,
    'd3: na alleen het eerste stuk staat het gebied op Onvolledig';
  assert exists (select 1 from public.loop_tellingen() t where t.gebied_id = 'aaaaaaaa-0000-4000-8000-0000000000f1' and t.onvolledig),
    'd3: loop_tellingen meldt het gebied als onvolledig';

  -- Het tweede stuk komt nooit. Wie later opnieuw ophaalt, maakt het af.
  perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', '[]'::jsonb, false, true);
  assert (select opgehaald_op from public.loopgebieden where id = 'aaaaaaaa-0000-4000-8000-0000000000f1') is not null,
    'd3: na het laatste stuk staat opgehaald_op weer';
end $$;

-- Overlap: hetzelfde adres in een los gebied geeft geen tweede rij.
do $$
declare
  n integer;
begin
  n := public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f2', $j$[
    {"vbo_id": "9990010000000001", "straat": "Proefstraat", "woonplaats": "Proefstad", "huisnummer": 10}
  ]$j$::jsonb, true, true);
  assert n = 1, 'd3: het losse gebied heeft één adres';
  assert (select count(*) from public.loop_adressen where vbo_id = '9990010000000001') = 1, 'd3: overlap geeft geen dubbele rij';
  assert (select count(*) from public.loopgebied_adressen ga join public.loop_adressen la on la.id = ga.adres_id
          where la.vbo_id = '9990010000000001') = 2, 'd3: het adres ligt in beide gebieden';
  assert (select street_id from public.loop_adressen where vbo_id = '9990010000000001') = 'aaaaaaaa-0000-4000-8000-0000000000e1',
    'd3: het losse gebied wist de wijkstraat niet';
end $$;

-- Een straat weghalen haalt alleen de koppelingen weg.
do $$
declare
  n integer;
begin
  perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', $j$[
    {"vbo_id": "9990010000000005", "straat": "Tweede Proefstraat", "woonplaats": "Proefstad", "huisnummer": 1},
    {"vbo_id": "9990010000000006", "straat": "Tweede Proefstraat", "woonplaats": "Proefstad", "huisnummer": 3}
  ]$j$::jsonb, true, true);
  n := public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f1', '[]'::jsonb, false, true, ' tweede  proefstraat ');
  assert not exists (
    select 1 from public.loopgebied_adressen ga join public.loop_adressen la on la.id = ga.adres_id
    where ga.gebied_id = 'aaaaaaaa-0000-4000-8000-0000000000f1' and la.straat = 'Tweede Proefstraat'
  ), 'd3: na straat_weg ligt die straat niet meer in het gebied';
  assert (select count(*) from public.loop_adressen where straat = 'Tweede Proefstraat') = 2,
    'd3: de adressen zelf blijven bestaan';
  assert n = 3, format('d3: het gebied houdt 3 adressen over (10, 12 en 14), heeft er %s', n);
end $$;

-- (e) een gebied van B of een weggegooid gebied vullen geeft een fout.
do $$
declare
  ok boolean;
begin
  ok := false;
  begin
    perform public.loop_gebied_vullen('bbbbbbbb-0000-4000-8000-0000000000f1', $j$[
      {"vbo_id": "9990010000000007", "straat": "Proefstraat", "woonplaats": "Proefstad", "huisnummer": 7}
    ]$j$::jsonb, true, true);
  exception when raise_exception then ok := sqlerrm like 'Dit gebied bestaat niet%';
  end;
  assert ok, 'e: een gebied van B vullen moet falen';

  ok := false;
  begin
    perform public.loop_gebied_vullen('aaaaaaaa-0000-4000-8000-0000000000f3', '[]'::jsonb, true, true);
  exception when raise_exception then ok := sqlerrm like 'Dit gebied bestaat niet%';
  end;
  assert ok, 'e: een weggegooid gebied vullen moet falen';
end $$;

-- ---------------------------------------------------------------------
-- Niets van B is gelezen of geschreven
-- ---------------------------------------------------------------------
reset role;

do $$
declare
  r record;
begin
  assert (select count(*) from public.loop_adressen where company_id = 'bbbbbbbb-0000-4000-8000-000000000000') = 1,
    'B: er is geen adres bij B bijgekomen';
  select * into r from public.loop_adressen where id = 'bbbbbbbb-0000-4000-8000-000000000201';
  assert r.huisnummer = 10 and r.bouwlagen = 2 and r.prijs = 50.00 and r.oppervlakte is null, 'B: het adres van B is onaangeroerd';
  assert (select count(*) from public.loopgebied_adressen where gebied_id = 'bbbbbbbb-0000-4000-8000-0000000000f1') = 1,
    'B: het gebied van B heeft nog precies zijn ene adres';
  assert (select opgehaald_op from public.loopgebieden where id = 'bbbbbbbb-0000-4000-8000-0000000000f1') is null,
    'B: het gebied van B is niet als opgehaald gemarkeerd';
end $$;

select 'OK loop_gebied_vullen' as uitslag;

rollback;
