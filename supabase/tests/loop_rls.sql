-- Proef: wie mag wat bij Klanten lopen (plan klanten-lopen, stap 1 b, c, d, d2, e).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug: er blijft niets achter.
-- Twee wegwerpbedrijven A en B; geen echt bedrijf, geen echte wijk.
--
-- Laat de proef "OK loop_rls" zien, dan klopt alles. Gaat een controle mis,
-- dan stopt hij met een melding die zegt wat er niet klopt.

begin;

-- ---------------------------------------------------------------------
-- Opzet (als postgres, vóór de rolwissel)
-- ---------------------------------------------------------------------
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Proefbedrijf B (test)');

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'loper-a@proef.invalid', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'planner-a@proef.invalid', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'loper-b@proef.invalid', 'authenticated', 'authenticated');

insert into public.rollen (id, company_id, naam, rechten) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefloper', array['klanten_lopen']),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefplanner', array['planning']),
  ('bbbbbbbb-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefloper', array['klanten_lopen']);

insert into public.employees (id, company_id, naam, email, rol, rol_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Loper A', 'loper-a@proef.invalid', 'medewerker', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Planner A', 'planner-a@proef.invalid', 'medewerker', 'aaaaaaaa-0000-4000-8000-0000000000c2'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Loper B', 'loper-b@proef.invalid', 'medewerker', 'bbbbbbbb-0000-4000-8000-0000000000c1');

insert into public.districts (id, company_id, name, plaats) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefwijk Noord', 'Proefstad'),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefwijk B', 'Proefstad');

insert into public.streets (id, company_id, district_id, name, volledige_naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Proefstr', 'Proefstraat', 1),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Proefstraat', 'Proefstraat', 1);

-- Klant A1 actief (Proefstraat 10, postcode), klant A2 inactief (Proefstraat 12, zonder postcode).
insert into public.customers (id, company_id, street_id, house_number, postcode, inactief_op, inactief_reden) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 10, '0001 AA', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 12, '', now(), 'gestopt'),
  ('bbbbbbbb-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000e1', 10, '0001 AA', null, null);
update public.adres_prijzen set prijs = 41.50
 where customer_id in ('aaaaaaaa-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000101');

insert into public.loopgebieden (id, company_id, naam, district_id, opgehaald_op, deleted_at) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied A', 'aaaaaaaa-0000-4000-8000-0000000000d1', now(), null),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000000', 'Weggegooid gebied A', null, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefgebied B', 'bbbbbbbb-0000-4000-8000-0000000000d1', now(), null);

-- 201: klant actief (via postcode), met een loopprijs die nooit terug mag komen.
-- 202: klant inactief (via straat + plaats + nummer). 203: gewone woning.
-- 204: bedrijf. B heeft hetzelfde vbo_id als 201: dat mag, per bedrijf.
insert into public.loop_adressen (id, company_id, vbo_id, street_id, straat, woonplaats, huisnummer, postcode, gebruiksdoel, prijs) values
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000001', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 10, '0001AA', 'woonfunctie', 33.00),
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000002', null, 'Proefstraat', 'Proefstad', 12, '', 'woonfunctie', 34.00),
  ('aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000003', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 14, '0001AA', 'woonfunctie', 18.00),
  ('aaaaaaaa-0000-4000-8000-000000000204', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000004', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 16, '0001AA', 'winkelfunctie', null),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000001', null, 'Proefstraat', 'Proefstad', 10, '0001AA', 'woonfunctie', 50.00);

insert into public.loopgebied_adressen (gebied_id, adres_id, company_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000204', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000');

-- ---------------------------------------------------------------------
-- (c) De database zet de datums zelf (als postgres: alleen zo kun je een
--     datum meesturen, een loper mag die kolommen niet eens noemen)
-- ---------------------------------------------------------------------
insert into public.loop_adressen (id, company_id, vbo_id, straat, woonplaats, huisnummer, uitkomst, uitkomst_op, notitie, notitie_op) values
  ('aaaaaaaa-0000-4000-8000-000000000291', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000091', 'Proefstraat', 'Proefstad', 91, 'nee', '2000-01-01', 'Proefnotitie', '2000-01-01'),
  ('aaaaaaaa-0000-4000-8000-000000000292', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000092', 'Proefstraat', 'Proefstad', 92, null, '2000-01-01', '', '2000-01-01');

do $$
declare
  r record;
begin
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000291';
  assert r.uitkomst_op = now(), 'c: insert met uitkomst moet uitkomst_op op nu zetten, niet de meegestuurde datum';
  assert r.notitie_op = now(), 'c: insert met notitie moet notitie_op op nu zetten, niet de meegestuurde datum';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000292';
  assert r.uitkomst_op is null and r.uitkomst_door is null, 'c: insert zonder uitkomst moet uitkomst_op leeg laten';
  assert r.notitie_op is null, 'c: insert zonder notitie moet notitie_op leeg laten';

  -- Een update die alleen een datum meestuurt, houdt de oude datum.
  update public.loop_adressen set uitkomst_op = '2001-01-01', notitie_op = '2001-01-01'
   where id = 'aaaaaaaa-0000-4000-8000-000000000291';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000291';
  assert r.uitkomst_op = now() and r.notitie_op = now(), 'c: een meegestuurde datum zonder nieuwe uitkomst of notitie moet genegeerd worden';
end $$;

-- ---------------------------------------------------------------------
-- (b) Loper A: ziet en wijzigt alleen bedrijf A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  n integer;
begin
  select count(*) into n from public.loopgebieden;
  assert n = 2, format('b: loper A hoort 2 gebieden van A te zien (ook het weggegooide), zag er %s', n);
  select count(*) into n from public.loopgebieden where company_id = 'bbbbbbbb-0000-4000-8000-000000000000';
  assert n = 0, 'b: loper A mag geen gebied van B zien';
  select count(*) into n from public.loop_adressen;
  assert n = 6, format('b: loper A hoort 6 adressen van A te zien, zag er %s', n);
  select count(*) into n from public.loop_adressen where company_id = 'bbbbbbbb-0000-4000-8000-000000000000';
  assert n = 0, 'b: loper A mag geen adres van B zien';
  select count(*) into n from public.loopgebied_adressen;
  assert n = 5, format('b: loper A hoort 5 koppelingen te zien, zag er %s', n);

  update public.loopgebieden set naam = 'Proefgebied A hernoemd' where id = 'aaaaaaaa-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  assert n = 1, 'b: loper A moet zijn gebied kunnen hernoemen';

  insert into public.loopgebieden (naam, plaats) values ('Nieuw proefgebied', 'Proefstad');
  select count(*) into n from public.loopgebieden where naam = 'Nieuw proefgebied' and company_id = 'aaaaaaaa-0000-4000-8000-000000000000';
  assert n = 1, 'b: loper A moet een gebied kunnen maken (bedrijf vult zichzelf in)';

  -- Een adres of gebied van B bijwerken raakt niets.
  update public.loop_adressen set uitkomst = 'nee' where id = 'bbbbbbbb-0000-4000-8000-000000000201';
  get diagnostics n = row_count;
  assert n = 0, 'b: loper A mag geen adres van B bijwerken';
  update public.loopgebieden set naam = 'Gekaapt' where id = 'bbbbbbbb-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  assert n = 0, 'b: loper A mag geen gebied van B bijwerken';

  -- Weggooien kan niet: er is geen delete-regel op loop_adressen.
  delete from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  get diagnostics n = row_count;
  assert n = 0, 'b: een loper kan een adres niet echt weggooien';
end $$;

-- (c) als loper: een andere uitkomst zet datum en loper, leeg maakt beide leeg.
do $$
declare
  r record;
begin
  update public.loop_adressen set uitkomst = 'interesse' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert r.uitkomst = 'interesse', 'c: uitkomst moet bewaard zijn';
  assert r.uitkomst_op = now(), 'c: uitkomst_op moet automatisch gezet zijn';
  assert r.uitkomst_door = 'aaaaaaaa-0000-4000-8000-0000000000a1', 'c: uitkomst_door moet de loper zijn';

  update public.loop_adressen set prijs = 19.50, notitie = 'Grote ramen aan de achterkant'
   where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert r.uitkomst_op = now() and r.uitkomst_door is not null, 'c: zonder nieuwe uitkomst blijven datum en loper staan';
  assert r.notitie_op = now(), 'c: een notitie krijgt een datum';

  update public.loop_adressen set notitie = '' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert r.notitie_op is null, 'c: een lege notitie maakt notitie_op leeg';

  update public.loop_adressen set uitkomst = null where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert r.uitkomst_op is null and r.uitkomst_door is null, 'c: terug naar open maakt uitkomst_op en uitkomst_door leeg';
end $$;

-- (d2) een loper wijzigt alleen uitkomst, prijs, notitie en woningtype_zelf.
do $$
declare
  ok boolean;
begin
  ok := false;
  begin
    update public.loop_adressen set customer_id = 'aaaaaaaa-0000-4000-8000-000000000101' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag customer_id niet zelf zetten';

  ok := false;
  begin
    update public.loop_adressen set straat = 'Andere straat' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag de straat niet wijzigen';

  ok := false;
  begin
    update public.loop_adressen set oppervlakte = 500 where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag de oppervlakte niet wijzigen';

  ok := false;
  begin
    update public.loop_adressen set uitkomst_op = '2000-01-01' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag uitkomst_op niet zelf zetten';

  ok := false;
  begin
    insert into public.loop_adressen (vbo_id, straat, woonplaats, huisnummer)
    values ('9990010000000099', 'Proefstraat', 'Proefstad', 99);
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag niet zelf adressen toevoegen';

  ok := false;
  begin
    insert into public.loopgebied_adressen (gebied_id, adres_id)
    values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000291');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: een loper mag niet zelf koppelingen toevoegen';

  ok := false;
  begin
    update public.loopgebieden set opgehaald_op = null where id = 'aaaaaaaa-0000-4000-8000-0000000000f1';
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'd2: alleen loop_gebied_vullen zet opgehaald_op';

  -- woningtype_zelf: bij een gewone woning wel, bij een klant niet.
  update public.loop_adressen set woningtype_zelf = 'hoek' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert (select woningtype_zelf from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203') = 'hoek',
    'd2: woningtype_zelf van een gewone woning moet te verbeteren zijn';

  ok := false;
  begin
    update public.loop_adressen set woningtype_zelf = 'tussen' where id = 'aaaaaaaa-0000-4000-8000-000000000201';
  exception when raise_exception then ok := sqlerrm like 'Dit adres is al klant%';
  end;
  assert ok, 'd2: woningtype_zelf op een klantrij moet geweigerd worden';
end $$;

-- (d) de looplijst: klant_status wel, naam en klantprijs nooit.
do $$
declare
  r record;
  n integer;
begin
  -- Zonder Klanten bekijken ziet hij de klanten zelf niet.
  select count(*) into n from public.customers;
  assert n = 0, 'd: een loper zonder Klanten bekijken mag geen klantadressen lezen';
  select count(*) into n from public.klanten;
  assert n = 0, 'd: een loper zonder Klanten bekijken mag geen klantnamen lezen';

  select count(*) into n from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1');
  assert n = 4, format('d: de looplijst hoort 4 adressen te hebben, had er %s', n);

  select * into r from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l where l.vbo_id = '9990010000000001';
  assert r.klant_status = 'actief', 'd: Proefstraat 10 is een actieve klant (via de postcode)';
  assert r.klant_adres_id = 'aaaaaaaa-0000-4000-8000-000000000101', 'd: klant_adres_id moet het klantadres zijn';
  assert r.prijs is null, 'd: een klantrij mag geen prijs teruggeven';

  select * into r from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l where l.vbo_id = '9990010000000002';
  assert r.klant_status = 'inactief', 'd: Proefstraat 12 is een inactieve klant (via straat en plaats)';
  assert r.prijs is null, 'd: een inactieve klantrij mag geen prijs teruggeven';

  select * into r from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l where l.vbo_id = '9990010000000003';
  assert r.klant_status is null and r.klant_adres_id is null, 'd: Proefstraat 14 is geen klant';
  assert r.prijs = 19.50, 'd: een gewone woning geeft de loopprijs terug';
  assert r.straat_volgorde = 1, 'd: Proefstraat is de eerste straat van de wijk';

  select * into r from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l where l.vbo_id = '9990010000000004';
  assert r.gebruiksdoel = 'winkelfunctie' and r.klant_status is null, 'd: het bedrijf staat erin, zonder klant';

  -- De functie heeft geen kolom met een naam van een klant.
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(naam)
  where p.oid = 'public.loop_lijst(uuid)'::regprocedure
    and a.naam in ('naam', 'klant_naam', 'telefoon', 'email');
  assert n = 0, 'd: loop_lijst mag geen naam, telefoon of mail van een klant teruggeven';
end $$;

-- (e) een gebied van een ander bedrijf of een weggegooid gebied geeft een fout.
do $$
declare
  ok boolean;
  n integer;
begin
  ok := false;
  begin
    perform * from public.loop_lijst('bbbbbbbb-0000-4000-8000-0000000000f1');
  exception when raise_exception then ok := sqlerrm like 'Dit gebied bestaat niet%';
  end;
  assert ok, 'e: loop_lijst met een gebied van B moet een fout geven';

  ok := false;
  begin
    perform * from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f3');
  exception when raise_exception then ok := sqlerrm like 'Dit gebied bestaat niet%';
  end;
  assert ok, 'e: loop_lijst met een weggegooid gebied moet een fout geven';

  ok := false;
  begin
    perform public.loop_gebied_vullen('bbbbbbbb-0000-4000-8000-0000000000f1', '[]'::jsonb, true, true);
  exception when raise_exception then ok := sqlerrm like 'Dit gebied bestaat niet%';
  end;
  assert ok, 'e: loop_gebied_vullen met een gebied van B moet een fout geven';

  ok := false;
  begin
    perform * from public.loop_maak_klant('bbbbbbbb-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-0000000000d1',
      'aaaaaaaa-0000-4000-8000-0000000000e1', 20, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm like 'Dit adres staat niet%';
  end;
  assert ok, 'e: loop_maak_klant met een adres van B moet een fout geven';

  select count(*) into n from public.loop_tellingen() t
  where t.gebied_id in ('bbbbbbbb-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-0000000000f3');
  assert n = 0, 'e: loop_tellingen mag geen gebied van B of een weggegooid gebied tonen';
end $$;

-- (b) Planner A heeft geen Klanten lopen: ziet niets en kan niets toevoegen.
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  n integer;
  ok boolean;
begin
  select count(*) into n from public.loopgebieden;
  assert n = 0, 'b: zonder recht zie je geen gebieden';
  select count(*) into n from public.loop_adressen;
  assert n = 0, 'b: zonder recht zie je geen adressen';
  select count(*) into n from public.loopgebied_adressen;
  assert n = 0, 'b: zonder recht zie je geen koppelingen';

  update public.loop_adressen set uitkomst = 'nee' where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  get diagnostics n = row_count;
  assert n = 0, 'b: zonder recht kun je niets bijwerken';

  ok := false;
  begin
    insert into public.loopgebieden (naam) values ('Mag niet');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'b: zonder recht kun je geen gebied maken';

  ok := false;
  begin
    perform * from public.loop_tellingen();
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'b: zonder recht geeft loop_tellingen een fout';
end $$;

-- Zonder aal2 (alleen wachtwoord) ziet de loper ook niets.
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal1')::text, true);

do $$
begin
  assert (select count(*) from public.loop_adressen) = 0, 'b: zonder inlogcode (aal1) zie je geen adressen';
end $$;

-- ---------------------------------------------------------------------
-- (e) De functies zelf: search_path, security definer en wie ze mag aanroepen
-- ---------------------------------------------------------------------
reset role;

do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as naam, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid in (
      'public.loop_lijst(uuid)'::regprocedure,
      'public.loop_tellingen()'::regprocedure,
      'public.loop_gebied_vullen(uuid,jsonb,boolean,boolean,text)'::regprocedure,
      'public.loop_maak_klant(uuid,uuid,uuid,numeric,integer,integer,text,text,text)'::regprocedure,
      'public.loop_notities_opruimen()'::regprocedure,
      'public.loop_adres_bijhouden()'::regprocedure
    )
  loop
    assert f.prosecdef, format('e: %s hoort security definer te zijn', f.naam);
    assert f.proconfig @> array['search_path=public'], format('e: %s mist search_path=public', f.naam);
    assert not has_function_privilege('anon', f.oid, 'execute'), format('e: anon mag %s niet aanroepen', f.naam);
  end loop;

  assert has_function_privilege('authenticated', 'public.loop_lijst(uuid)', 'execute'), 'e: een loper moet loop_lijst kunnen aanroepen';
  assert not has_function_privilege('authenticated', 'public.loop_notities_opruimen()', 'execute'), 'e: alleen de nacht ruimt notities op';
  assert not has_function_privilege('authenticated', 'public.loop_adres_klanten(uuid)', 'execute'), 'e: loop_adres_klanten is alleen voor de functies zelf';
  assert not has_function_privilege('anon', 'public.loop_adres_klanten(uuid)', 'execute'), 'e: loop_adres_klanten is alleen voor de functies zelf';
end $$;

-- Niets van B is aangeraakt.
do $$
declare
  r record;
begin
  select * into r from public.loop_adressen where id = 'bbbbbbbb-0000-4000-8000-000000000201';
  assert r.uitkomst is null and r.prijs = 50.00, 'b: het adres van B moet onaangeroerd zijn';
  assert (select naam from public.loopgebieden where id = 'bbbbbbbb-0000-4000-8000-0000000000f1') = 'Proefgebied B',
    'b: het gebied van B moet onaangeroerd zijn';
end $$;

select 'OK loop_rls' as uitslag;

rollback;
