-- Proef: Ja → klant, voor een loper met alleen "Klanten lopen" (plan klanten-lopen, stap 4 g en h).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug. Twee wegwerpbedrijven A en B.
-- Laat hij "OK loop_maak_klant" zien, dan klopt alles.

begin;

-- ---------------------------------------------------------------------
-- Opzet (als postgres)
-- ---------------------------------------------------------------------
insert into public.companies (id, name, plan_tarief_uur) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)', 75),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Proefbedrijf B (test)', 75);

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

insert into public.klanten (id, company_id, naam, telefoon) values
  ('aaaaaaaa-0000-4000-8000-000000000301', 'aaaaaaaa-0000-4000-8000-000000000000', 'Bestaande Proefklant', '0600000001');

-- 101 actief met klant en prijs, 102 inactief, 104 actief zonder postcode. B heeft er één.
insert into public.customers (id, company_id, street_id, house_number, postcode, klant_id, inactief_op, inactief_reden, sort_order) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 10, '0001 AA', 'aaaaaaaa-0000-4000-8000-000000000301', null, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 12, '', null, now(), 'gestopt', 2),
  ('aaaaaaaa-0000-4000-8000-000000000104', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 40, '', null, null, null, 3),
  ('bbbbbbbb-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000e1', 10, '0001 AA', null, null, null, 1);
update public.adres_prijzen set prijs = 40.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000101';
update public.adres_prijzen set prijs = 45.00 where customer_id = 'bbbbbbbb-0000-4000-8000-000000000101';

insert into public.loopgebieden (id, company_id, naam, district_id, opgehaald_op) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied A', 'aaaaaaaa-0000-4000-8000-0000000000d1', now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefgebied B', 'bbbbbbbb-0000-4000-8000-0000000000d1', now());

insert into public.loop_adressen (id, company_id, vbo_id, street_id, straat, woonplaats, huisnummer, toevoeging, postcode, prijs) values
  -- nieuwe klant, met naam en telefoon, toevoeging in kleine letter
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000001', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 20, 'a', '0001AB', 17.50),
  -- nieuwbouw: nog geen wijkstraat en geen postcode
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000002', null, 'Nieuwe  Proefweg ', 'Proefstad', 5, '', '', null),
  -- al actieve klant 101: andere straatnaam, zelfde postcode + nummer
  ('aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000003', null, 'Officiele Proefstraatnaam', 'Proefstad', 10, '', '0001AA', 22.00),
  -- inactieve klant 102 (straat + plaats + nummer)
  ('aaaaaaaa-0000-4000-8000-000000000204', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000004', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 12, '', '', 23.00),
  -- voor de foute wijk/straat
  ('aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000005', null, 'Proefstraat', 'Proefstad', 30, '', '0001AC', 24.00),
  -- al actieve klant 104, alleen te vinden via huisnummer in de gekozen straat
  ('aaaaaaaa-0000-4000-8000-000000000206', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000006', null, 'Proefstraat-Oost', 'Proefstad', 40, '', '', 25.00),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000001', null, 'Proefstraat', 'Proefstad', 20, '', '', null);

insert into public.loopgebied_adressen (gebied_id, adres_id, company_id)
select case when la.company_id = 'aaaaaaaa-0000-4000-8000-000000000000'
            then 'aaaaaaaa-0000-4000-8000-0000000000f1'::uuid
            else 'bbbbbbbb-0000-4000-8000-0000000000f1'::uuid end,
       la.id, la.company_id
from public.loop_adressen la
where la.company_id in ('aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000');

-- ---------------------------------------------------------------------
-- Als loper A (alleen Klanten lopen, met inlogcode)
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

-- Een nieuwe klant, met naam en telefoon.
do $$
declare
  r record;
begin
  select * into r from public.loop_maak_klant(
    'aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
    17.50, 2, 1, '', ' Nieuwe Proefklant ', '0600000002');
  assert r.customer_id is not null and not r.bestond, 'g: er moet een nieuw klantadres zijn gemaakt';
  perform set_config('proef.nieuw_1', r.customer_id::text, true);

  -- Na het omzetten geeft een gewone select geen prijs meer (h).
  assert (select prijs from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000201') is null,
    'h: na het omzetten staat er geen prijs meer op het loopadres';
  assert (select uitkomst from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000201') = 'ja',
    'g: de uitkomst is ja';
  assert (select customer_id from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000201') = r.customer_id,
    'g: het loopadres wijst naar het nieuwe klantadres';
  assert (select l.klant_status from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l
          where l.id = 'aaaaaaaa-0000-4000-8000-000000000201') = 'actief',
    'g: in de looplijst is de rij nu een klant';
end $$;

-- Twee keer achter elkaar Ja op hetzelfde adres.
do $$
declare
  ok boolean := false;
begin
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
      17.50, 2, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm = 'Dit adres is net al klant gemaakt.';
  end;
  assert ok, 'g: een tweede Ja op hetzelfde adres moet "net al klant gemaakt" geven';
end $$;

-- Nieuwbouw: een nieuwe straat met de BAG-naam, zonder klantgegevens en zonder postcode.
do $$
declare
  r record;
begin
  select * into r from public.loop_maak_klant(
    'aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-0000000000d1', null,
    12, 1, 1, '', '', '');
  assert r.customer_id is not null and not r.bestond, 'g: ook zonder straat komt er een klantadres';
  perform set_config('proef.nieuw_2', r.customer_id::text, true);
end $$;

-- Al een actieve klant (zelfde postcode + nummer, andere straatnaam): alleen koppelen.
do $$
declare
  r record;
begin
  select * into r from public.loop_maak_klant(
    'aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-0000000000d1', null,
    22.00, 1, 1, '', 'Iemand anders', '0600000003');
  assert r.bestond and r.customer_id = 'aaaaaaaa-0000-4000-8000-000000000101',
    'g: een bestaande actieve klant geeft bestond = true en zijn klantadres';
  assert (select prijs from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203') = 22.00,
    'g: de ingevulde prijs blijft op het loopadres staan';
  assert (select l.prijs from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l
          where l.id = 'aaaaaaaa-0000-4000-8000-000000000203') is null,
    'g: de looplijst geeft voor de klantrij geen prijs';
end $$;

-- Al een actieve klant, alleen te vinden via het huisnummer in de gekozen straat.
do $$
declare
  r record;
begin
  select * into r from public.loop_maak_klant(
    'aaaaaaaa-0000-4000-8000-000000000206', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
    25.00, 1, 1, '', '', '');
  assert r.bestond and r.customer_id = 'aaaaaaaa-0000-4000-8000-000000000104',
    'g: hetzelfde huisnummer in de gekozen straat geeft bestond = true';
end $$;

-- Foute invoer en de inactieve klant.
do $$
declare
  ok boolean;
begin
  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000204', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
      23.00, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm like 'Dit adres staat bij Inactief%';
  end;
  assert ok, 'g: een inactief adres geeft de bestaande melding';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e2',
      24.00, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm = 'Deze straat ligt niet in de gekozen wijk.';
  end;
  assert ok, 'g: een straat die niet in de gekozen wijk ligt, moet falen';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000e1',
      24.00, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm = 'Deze straat ligt niet in de gekozen wijk.';
  end;
  assert ok, 'g: een straat van B moet falen';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000205', 'bbbbbbbb-0000-4000-8000-0000000000d1', null,
      24.00, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm = 'Kies een wijk van je eigen bedrijf.';
  end;
  assert ok, 'g: een wijk van B moet falen';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'bbbbbbbb-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
      24.00, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm like 'Dit adres staat niet (meer)%';
  end;
  assert ok, 'g: een adres van B moet falen';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
      null, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm = 'Vul een prijs in.';
  end;
  assert ok, 'g: zonder prijs moet het falen';

  ok := false;
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000205', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
      24.00, 1, 1, 'okt', '', '');
  exception when raise_exception then ok := sqlerrm = 'De startmaand klopt niet.';
  end;
  assert ok, 'g: een startmaand die geen jjjj-mm is, moet falen';

  assert (select customer_id from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000205') is null,
    'g: na de fouten is adres 30 nog geen klant';
end $$;

-- Het klantadres van de nieuwbouw gaat naar de prullenbak (als postgres, zonder
-- ingelogde gebruiker, zoals de eigenaar het zou doen).
reset role;
select set_config('request.jwt.claims', '', true);
update public.customers set deleted_at = now() where id = current_setting('proef.nieuw_2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  ok boolean := false;
begin
  assert (select l.klant_status from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1') l
          where l.id = 'aaaaaaaa-0000-4000-8000-000000000202') is null,
    'g: een klantadres in de prullenbak telt in de looplijst niet meer als klant';
  begin
    perform * from public.loop_maak_klant(
      'aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-0000000000d1', null,
      12, 1, 1, '', '', '');
  exception when raise_exception then ok := sqlerrm like '%ligt nu in de prullenbak%';
  end;
  assert ok, 'g: opnieuw Ja op een adres waarvan de klant in de prullenbak ligt, verwijst naar de prullenbak';
end $$;

-- ---------------------------------------------------------------------
-- Nakijken als postgres (de loper mag customers niet lezen)
-- ---------------------------------------------------------------------
reset role;

do $$
declare
  c record;
  k record;
  nieuw_1 uuid := current_setting('proef.nieuw_1')::uuid;
  nieuw_2 uuid := current_setting('proef.nieuw_2')::uuid;
begin
  -- De nieuwe klant met naam.
  select * into c from public.customers where id = nieuw_1;
  assert c.company_id = 'aaaaaaaa-0000-4000-8000-000000000000', 'g: het klantadres hoort bij A';
  assert c.street_id = 'aaaaaaaa-0000-4000-8000-0000000000e1' and c.house_number = 20, 'g: straat en huisnummer kloppen';
  assert c.addition = 'A', format('g: de toevoeging staat in hoofdletters, maar is %L', c.addition);
  assert c.postcode = '0001 AB', format('g: de postcode staat netjes met spatie, maar is %L', c.postcode);
  assert c.interval_maanden = 2 and c.ritme = 1, 'g: de frequentie klopt';
  assert c.sort_order = 4, format('g: het adres staat achteraan in de straat (4), maar staat op %s', c.sort_order);
  assert c.duur_min is not null, 'g: de duur is uit de prijs gevuld';
  assert c.duur_min = public.duur_uit_prijs(17.50, 75), 'g: de duur hoort bij 17,50 en 75 per uur';
  assert c.klant_id is not null, 'g: met naam en telefoon hangt er een klant aan';
  select * into k from public.klanten where id = c.klant_id;
  assert k.naam = 'Nieuwe Proefklant' and k.telefoon = '0600000002' and k.company_id = c.company_id,
    'g: de klant heeft de ingevulde naam en telefoon, bij A';
  assert (select prijs from public.adres_prijzen where customer_id = nieuw_1) = 17.50,
    'g: adres_prijzen.prijs is de ingevulde prijs, niet de 0 van de trigger';

  -- Geen update op customers die klant_id wisselt (customers_wijziging_controleren gaf geen fout).
  assert not exists (
    select 1 from public.wijzigingen w where w.tabel = 'customers' and w.rij_id = nieuw_1 and w.veld = 'klant'
  ), 'g: klant_id is nooit achteraf gewijzigd';

  -- De nieuwbouw.
  select * into c from public.customers where id = nieuw_2;
  assert c.postcode = '', format('g: een lege postcode blijft leeg, maar is %L', c.postcode);
  assert c.klant_id is null, 'g: zonder naam of telefoon geen klant';
  assert (select s.name from public.streets s where s.id = c.street_id) = 'Nieuwe Proefweg',
    'g: de nieuwe straat heeft de BAG-naam (netjes, zonder dubbele spaties)';
  assert (select s.volledige_naam from public.streets s where s.id = c.street_id) = 'Nieuwe Proefweg',
    'g: de nieuwe straat heeft ook de officiële naam';
  assert (select s.district_id from public.streets s where s.id = c.street_id) = 'aaaaaaaa-0000-4000-8000-0000000000d1',
    'g: de nieuwe straat ligt in de gekozen wijk';
  assert (select s.sort_order from public.streets s where s.id = c.street_id) = 2,
    'g: de nieuwe straat staat achteraan in de wijk';
  assert (select prijs from public.adres_prijzen where customer_id = nieuw_2) = 12, 'g: de prijs van de nieuwbouw klopt';

  -- De bestaande klant 101 is onveranderd.
  assert (select prijs from public.adres_prijzen where customer_id = 'aaaaaaaa-0000-4000-8000-000000000101') = 40.00,
    'g: de prijs van de bestaande klant is niet aangeraakt';
  assert (select klant_id from public.customers where id = 'aaaaaaaa-0000-4000-8000-000000000101') = 'aaaaaaaa-0000-4000-8000-000000000301',
    'g: de klant van het bestaande adres is niet gewisseld';
  assert (select naam from public.klanten where id = 'aaaaaaaa-0000-4000-8000-000000000301') = 'Bestaande Proefklant',
    'g: de naam van de bestaande klant is niet aangeraakt';
  assert not exists (select 1 from public.klanten where naam = 'Iemand anders'), 'g: bij een bestaande klant komt er geen nieuwe klant bij';

  -- Geen dubbele regels in de straat.
  assert (select count(*) from public.customers where street_id = 'aaaaaaaa-0000-4000-8000-0000000000e1' and house_number = 40) = 1,
    'g: hetzelfde huisnummer geeft geen tweede regel';

  -- Niets van B is aangeraakt.
  assert (select count(*) from public.customers where company_id = 'bbbbbbbb-0000-4000-8000-000000000000') = 1, 'B: geen klantadres bij B bij';
  assert (select count(*) from public.streets where company_id = 'bbbbbbbb-0000-4000-8000-000000000000') = 1, 'B: geen straat bij B bij';
  assert (select prijs from public.adres_prijzen where customer_id = 'bbbbbbbb-0000-4000-8000-000000000101') = 45.00, 'B: de prijs van B is onaangeroerd';
  assert (select customer_id from public.loop_adressen where id = 'bbbbbbbb-0000-4000-8000-000000000201') is null, 'B: het loopadres van B is onaangeroerd';
end $$;

select 'OK loop_maak_klant' as uitslag;

rollback;
