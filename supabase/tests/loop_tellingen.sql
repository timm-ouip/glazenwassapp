-- Proef: de tellers per gebied (plan klanten-lopen, stap 1 d4).
--
-- "Te lopen" = geen klant en nog geen uitkomst; woningen en bedrijven tellen
-- allebei mee. Klanten (ook inactieve) tellen niet mee.
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug. Twee wegwerpbedrijven A en B.
-- Laat hij "OK loop_tellingen" zien, dan klopt alles.

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
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefwijk B', 'Proefstad');

insert into public.streets (id, company_id, district_id, name, volledige_naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Proefstr', 'Proefstraat', 1),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Proefstraat', 'Proefstraat', 1);

-- Klanten van A: 101 actief (postcode), 102 inactief (straat + plaats), 103 actief (bij Ja gekoppeld).
-- Klant van B op hetzelfde adres als 101: telt bij A nooit mee.
insert into public.customers (id, company_id, street_id, house_number, addition, postcode, inactief_op, inactief_reden) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 60, '', '0001 AA', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 70, 'b', '', now(), 'verhuisd'),
  ('aaaaaaaa-0000-4000-8000-000000000103', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 90, '', '', null, null),
  ('bbbbbbbb-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000e1', 10, '', '0001 AA', null, null);

insert into public.loopgebieden (id, company_id, naam, district_id, opgehaald_op, deleted_at, created_at) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied A', 'aaaaaaaa-0000-4000-8000-0000000000d1', now(), null, now() - interval '2 days'),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Leeg proefgebied', null, null, null, now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000000', 'Weggegooid proefgebied', null, now(), now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefgebied B', 'bbbbbbbb-0000-4000-8000-0000000000d1', now(), null, now());

insert into public.loop_adressen (id, company_id, vbo_id, straat, woonplaats, huisnummer, toevoeging, postcode, gebruiksdoel, uitkomst, customer_id) values
  -- te lopen
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000001', 'Proefstraat', 'Proefstad', 10, '', '0001AA', 'woonfunctie', null, null),
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000002', 'Proefstraat', 'Proefstad', 20, '', '0001AA', 'woonfunctie', 'niet_thuis', null),
  ('aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000003', 'Proefstraat', 'Proefstad', 30, '', '0001AA', 'woonfunctie', 'interesse', null),
  ('aaaaaaaa-0000-4000-8000-000000000204', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000004', 'Proefstraat', 'Proefstad', 40, '', '0001AA', 'woonfunctie', 'ja', null),
  ('aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000005', 'Proefstraat', 'Proefstad', 50, '', '0001AA', 'woonfunctie', 'nee', null),
  -- actieve klant via postcode + nummer
  ('aaaaaaaa-0000-4000-8000-000000000206', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000006', 'Proefstraat', 'Proefstad', 60, '', '0001AA', 'woonfunctie', null, null),
  -- inactieve klant via straat + plaats + nummer ("70 B" = "70-b")
  ('aaaaaaaa-0000-4000-8000-000000000207', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000007', 'Proefstraat', 'Proefstad', 70, '-B', '', 'woonfunctie', null, null),
  -- bedrijf, te lopen
  ('aaaaaaaa-0000-4000-8000-000000000208', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000008', 'Proefstraat', 'Proefstad', 80, '', '0001AA', 'winkelfunctie', null, null),
  -- bij Ja klant gemaakt
  ('aaaaaaaa-0000-4000-8000-000000000209', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000009', 'Andere naam', 'Elders', 90, '', '', 'woonfunctie', 'ja', 'aaaaaaaa-0000-4000-8000-000000000103'),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000001', 'Proefstraat', 'Proefstad', 10, '', '0001AA', 'woonfunctie', 'nee', null);

insert into public.loopgebied_adressen (gebied_id, adres_id, company_id)
select 'aaaaaaaa-0000-4000-8000-0000000000f1', la.id, la.company_id
from public.loop_adressen la
where la.company_id = 'aaaaaaaa-0000-4000-8000-000000000000';
insert into public.loopgebied_adressen (gebied_id, adres_id, company_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000');

-- ---------------------------------------------------------------------
-- Als loper A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  t record;
  n integer;
begin
  select count(*) into n from public.loop_tellingen();
  assert n = 2, format('d4: alleen de twee gebieden van A die niet zijn weggegooid; het waren er %s', n);

  select * into t from public.loop_tellingen() x where x.gebied_id = 'aaaaaaaa-0000-4000-8000-0000000000f1';
  assert t.naam = 'Proefgebied A' and t.wijk = 'Proefwijk Noord', 'd4: naam en wijk van het gebied';
  assert t.totaal = 9, format('d4: totaal hoort 9 te zijn, was %s', t.totaal);
  assert t.klanten = 3, format('d4: klanten (actief, inactief, bij Ja gekoppeld) hoort 3 te zijn, was %s', t.klanten);
  assert t.te_lopen = 2, format('d4: te lopen (woning 10 en bedrijf 80) hoort 2 te zijn, was %s', t.te_lopen);
  assert t.niet_thuis = 1, format('d4: niet thuis hoort 1 te zijn, was %s', t.niet_thuis);
  assert t.interesse = 1, format('d4: interesse hoort 1 te zijn, was %s', t.interesse);
  assert t.ja = 2, format('d4: ja (ook die al klant is) hoort 2 te zijn, was %s', t.ja);
  assert t.nee = 1, format('d4: nee hoort 1 te zijn, was %s', t.nee);
  assert not t.onvolledig, 'd4: dit gebied is opgehaald';

  select * into t from public.loop_tellingen() x where x.gebied_id = 'aaaaaaaa-0000-4000-8000-0000000000f2';
  assert t.totaal = 0 and t.te_lopen = 0 and t.onvolledig and t.wijk is null,
    'd4: een leeg los gebied staat er met 0 en als onvolledig';

  -- Nieuwste eerst.
  select x.gebied_id into t from public.loop_tellingen() x limit 1;
  assert t.gebied_id = 'aaaaaaaa-0000-4000-8000-0000000000f2', 'd4: het nieuwste gebied staat bovenaan';

  -- De looplijst is het eens met de tellers.
  select count(*) into n from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l
  where l.klant_status is null and l.uitkomst is null;
  assert n = 2, format('d4: loop_lijst en loop_tellingen moeten hetzelfde "te lopen" geven, lijst gaf %s', n);
  select count(*) into n from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l where l.klant_status = 'inactief';
  assert n = 1, 'd4: Proefstraat 70-B is een inactieve klant';
end $$;

select 'OK loop_tellingen' as uitslag;

rollback;
