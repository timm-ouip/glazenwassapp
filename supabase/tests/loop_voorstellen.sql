-- Proef: het prijsvoorstel, voor een loper met alleen "Klanten lopen" (plan klanten-lopen, stap 5 b).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug. Twee wegwerpbedrijven A en B.
-- Laat hij "OK loop_voorstellen" zien, dan klopt alles.
--
-- De opzet in bedrijf A (wijk "Proefwijk", stuk "Noord"):
--   Proefstraat   (stuk Noord)  de doelen, plus prijzen in de straat
--   Groepstraat   (stuk Noord)  niet in het gebied, wel hetzelfde stuk
--   Wijkstraat    (geen stuk)   niet in het gebied, wel dezelfde wijk
--   Gebiedstraat  (geen stuk)   in het gebied
--   Verrestraat   in een andere wijk
-- Bedrijf B heeft een eigen Proefstraat in Proefstad met hoge prijzen; die
-- mogen nergens meetellen.

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
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefwijk', 'Proefstad'),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Andere proefwijk', 'Proefstad'),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefwijk B', 'Proefstad');

insert into public.straat_groepen (id, company_id, district_id, naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Noord', 1);

insert into public.streets (id, company_id, district_id, groep_id, name, volledige_naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000b1', 'Proefstraat', 'Proefstraat', 1),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000b1', 'Groepstraat', 'Groepstraat', 2),
  ('aaaaaaaa-0000-4000-8000-0000000000e3', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', null, 'Wijkstraat', 'Wijkstraat', 3),
  ('aaaaaaaa-0000-4000-8000-0000000000e4', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', null, 'Gebiedstraat', 'Gebiedstraat', 4),
  ('aaaaaaaa-0000-4000-8000-0000000000e5', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d2', null, 'Verrestraat', 'Verrestraat', 1),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000d1', null, 'Proefstraat', 'Proefstraat', 1);

-- In de Proefstraat: actieve klanten 107, 125 en 129 (tussen; 14, 16, 18),
-- 131 (hoek, 100: de enige klantprijs bij de hoekwoningen) en de inactieve
-- 109 (99). B heeft een actieve klant van 1000 op hetzelfde huisnummer.
insert into public.customers (id, company_id, street_id, house_number, postcode, inactief_op, inactief_reden, sort_order) values
  ('aaaaaaaa-0000-4000-8000-000000000107', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 7, '', null, null, 1),
  ('aaaaaaaa-0000-4000-8000-000000000109', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 9, '', now(), 'gestopt', 2),
  ('aaaaaaaa-0000-4000-8000-000000000125', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 25, '', null, null, 3),
  ('aaaaaaaa-0000-4000-8000-000000000129', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 29, '', null, null, 4),
  ('aaaaaaaa-0000-4000-8000-000000000131', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 31, '', null, null, 5),
  ('bbbbbbbb-0000-4000-8000-000000000107', 'bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000e1', 7, '', null, null, 1);
update public.adres_prijzen set prijs = 14.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000107';
update public.adres_prijzen set prijs = 99.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000109';
update public.adres_prijzen set prijs = 16.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000125';
update public.adres_prijzen set prijs = 18.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000129';
update public.adres_prijzen set prijs = 100.00 where customer_id = 'aaaaaaaa-0000-4000-8000-000000000131';
update public.adres_prijzen set prijs = 1000.00 where customer_id = 'bbbbbbbb-0000-4000-8000-000000000107';

insert into public.loopgebieden (id, company_id, naam, district_id, opgehaald_op) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied A', 'aaaaaaaa-0000-4000-8000-0000000000d1', now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Proefgebied B', 'bbbbbbbb-0000-4000-8000-0000000000d1', now());

-- Het id eindigt op het huisnummer; de straat zit erin als 1xx (Proefstraat),
-- 2xx (Groepstraat), 3xx (Wijkstraat), 4xx (Gebiedstraat), 5xx (Verrestraat).
insert into public.loop_adressen (id, company_id, vbo_id, street_id, straat, woonplaats, huisnummer, postcode, oppervlakte, gebruiksdoel, woningtype, woningtype_zelf, prijs, customer_id) values
  -- Proefstraat: tussenwoningen. Doel 101, en 123 (zelf verbeterd van vrijstaand naar tussen).
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000101', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 1, '', 100, 'woonfunctie', 'tussen', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000103', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000103', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 3, '', 100, 'woonfunctie', 'tussen', null, 10.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000105', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000105', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 5, '', 100, 'woonfunctie', 'tussen', null, 12.00, null),
  -- klant 107: telt met zijn klantprijs (14), niet met deze loopprijs
  ('aaaaaaaa-0000-4000-8000-000000000107', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000107', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 7, '', 100, 'woonfunctie', 'tussen', null, null, 'aaaaaaaa-0000-4000-8000-000000000107'),
  ('aaaaaaaa-0000-4000-8000-000000000125', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000125', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 25, '', 100, 'woonfunctie', 'tussen', null, null, 'aaaaaaaa-0000-4000-8000-000000000125'),
  ('aaaaaaaa-0000-4000-8000-000000000129', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000129', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 29, '', 100, 'woonfunctie', 'tussen', null, null, 'aaaaaaaa-0000-4000-8000-000000000129'),
  -- inactieve klant 109: telt niet, ook zijn loopprijs niet
  ('aaaaaaaa-0000-4000-8000-000000000109', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000109', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 9, '', 100, 'woonfunctie', 'tussen', null, 99.00, null),
  -- prijs 0 telt niet als vergelijking (en is wel een eigen prijs)
  ('aaaaaaaa-0000-4000-8000-000000000111', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000111', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 11, '', 100, 'woonfunctie', 'tussen', null, 0, null),
  ('aaaaaaaa-0000-4000-8000-000000000123', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000123', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 23, '', 100, 'woonfunctie', 'vrijstaand', 'tussen', null, null),
  -- Proefstraat: hoekwoningen. Doel 113; maar 2 prijzen in de straat.
  ('aaaaaaaa-0000-4000-8000-000000000113', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000113', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 13, '', 100, 'woonfunctie', 'hoek', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000115', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000115', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 15, '', 100, 'woonfunctie', 'hoek', null, 20.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000117', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000117', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 17, '', 100, 'woonfunctie', 'hoek', null, 22.00, null),
  -- klant 131: de enige klantprijs bij de hoekwoningen (100); telt dus niet,
  -- anders was hij met twee eigen loopprijzen precies terug te rekenen
  ('aaaaaaaa-0000-4000-8000-000000000131', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000131', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 31, '', 100, 'woonfunctie', 'hoek', null, null, 'aaaaaaaa-0000-4000-8000-000000000131'),
  -- Proefstraat: doel 119 (2-onder-1-kap, alleen prijzen in de wijk),
  -- 121 (vrijstaand, maar één prijs in de wijk) en 127 (geen type).
  ('aaaaaaaa-0000-4000-8000-000000000119', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000119', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 19, '', 100, 'woonfunctie', 'twee_onder_een_kap', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000121', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000121', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 21, '', 100, 'woonfunctie', 'vrijstaand', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000127', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000127', 'aaaaaaaa-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 27, '', 100, 'winkelfunctie', null, null, null, null),
  -- Groepstraat (zelfde stuk): een hoekwoning van 30
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000202', 'aaaaaaaa-0000-4000-8000-0000000000e2', 'Groepstraat', 'Proefstad', 2, '', 100, 'woonfunctie', 'hoek', null, 30.00, null),
  -- Wijkstraat (zelfde wijk, ander stuk): hoek 50 (telt niet in de buurt),
  -- 2-onder-1-kap 40 en 44 (die laatste alleen op naam aan de wijk gekoppeld)
  -- en één vrijstaande van 60.
  ('aaaaaaaa-0000-4000-8000-000000000302', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000302', 'aaaaaaaa-0000-4000-8000-0000000000e3', 'Wijkstraat', 'Proefstad', 2, '', 100, 'woonfunctie', 'hoek', null, 50.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000304', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000304', 'aaaaaaaa-0000-4000-8000-0000000000e3', 'Wijkstraat', 'Proefstad', 4, '', 100, 'woonfunctie', 'twee_onder_een_kap', null, 40.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000306', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000306', null, 'Wijkstraat', 'Proefstad', 6, '', 100, 'woonfunctie', 'twee_onder_een_kap', null, 44.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000308', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000308', 'aaaaaaaa-0000-4000-8000-0000000000e3', 'Wijkstraat', 'Proefstad', 8, '', 100, 'woonfunctie', 'vrijstaand', null, 60.00, null),
  -- Gebiedstraat (in het gebied): appartementen. Prijzen 10 en 11 bij 100 m²;
  -- doelen van 200 m² (schaal tot 1,25), 25 m² (schaal tot 0,8) en zonder m².
  ('aaaaaaaa-0000-4000-8000-000000000402', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000402', 'aaaaaaaa-0000-4000-8000-0000000000e4', 'Gebiedstraat', 'Proefstad', 2, '', 200, 'woonfunctie', 'appartement', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000404', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000404', 'aaaaaaaa-0000-4000-8000-0000000000e4', 'Gebiedstraat', 'Proefstad', 4, '', 100, 'woonfunctie', 'appartement', null, 10.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000406', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000406', 'aaaaaaaa-0000-4000-8000-0000000000e4', 'Gebiedstraat', 'Proefstad', 6, '', 100, 'woonfunctie', 'appartement', null, 11.00, null),
  ('aaaaaaaa-0000-4000-8000-000000000408', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000408', 'aaaaaaaa-0000-4000-8000-0000000000e4', 'Gebiedstraat', 'Proefstad', 8, '', 25, 'woonfunctie', 'appartement', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000410', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000410', 'aaaaaaaa-0000-4000-8000-0000000000e4', 'Gebiedstraat', 'Proefstad', 10, '', null, 'woonfunctie', 'appartement', null, null, null),
  -- Verrestraat (andere wijk): een 2-onder-1-kap van 100, telt niet
  ('aaaaaaaa-0000-4000-8000-000000000502', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000502', 'aaaaaaaa-0000-4000-8000-0000000000e5', 'Verrestraat', 'Proefstad', 2, '', 100, 'woonfunctie', 'twee_onder_een_kap', null, 100.00, null),
  -- Bedrijf B: dezelfde straatnaam en plaats, hoge prijzen voor elk type
  ('bbbbbbbb-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000101', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 1, '', 100, 'woonfunctie', 'tussen', null, 1000.00, null),
  ('bbbbbbbb-0000-4000-8000-000000000103', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000103', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 3, '', 100, 'woonfunctie', 'hoek', null, 1000.00, null),
  ('bbbbbbbb-0000-4000-8000-000000000105', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000105', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 5, '', 100, 'woonfunctie', 'twee_onder_een_kap', null, 1000.00, null),
  ('bbbbbbbb-0000-4000-8000-000000000107', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000107', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 7, '', 100, 'woonfunctie', 'vrijstaand', null, null, 'bbbbbbbb-0000-4000-8000-000000000107'),
  ('bbbbbbbb-0000-4000-8000-000000000109', 'bbbbbbbb-0000-4000-8000-000000000000', '9990010000000109', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Proefstraat', 'Proefstad', 9, '', 100, 'woonfunctie', 'appartement', null, 1000.00, null);

-- In gebied A: de Proefstraat en de Gebiedstraat. In gebied B: alles van B.
insert into public.loopgebied_adressen (gebied_id, adres_id, company_id)
select case when la.company_id = 'aaaaaaaa-0000-4000-8000-000000000000'
            then 'aaaaaaaa-0000-4000-8000-0000000000f1'::uuid
            else 'bbbbbbbb-0000-4000-8000-0000000000f1'::uuid end,
       la.id, la.company_id
from public.loop_adressen la
where la.company_id = 'bbbbbbbb-0000-4000-8000-000000000000'
   or (la.company_id = 'aaaaaaaa-0000-4000-8000-000000000000' and la.straat in ('Proefstraat', 'Gebiedstraat'));

-- ---------------------------------------------------------------------
-- Als loper A (alleen Klanten lopen, geen Prijzen zien, met inlogcode)
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  v record;
  gebied constant uuid := 'aaaaaaaa-0000-4000-8000-0000000000f1';
  ok boolean;
begin
  -- Alleen de doelen: geen eigen prijs, geen klant, wel een type.
  assert (select count(*) from public.loop_voorstellen(gebied)) = 7,
    format('b: er moeten 7 voorstellen zijn, maar het zijn er %s',
           (select count(*) from public.loop_voorstellen(gebied)));
  assert not exists (
    select 1 from public.loop_voorstellen(gebied) l
    where l.adres_id in ('aaaaaaaa-0000-4000-8000-000000000103', 'aaaaaaaa-0000-4000-8000-000000000107',
                         'aaaaaaaa-0000-4000-8000-000000000125', 'aaaaaaaa-0000-4000-8000-000000000131',
                         'aaaaaaaa-0000-4000-8000-000000000109', 'aaaaaaaa-0000-4000-8000-000000000111',
                         'aaaaaaaa-0000-4000-8000-000000000121', 'aaaaaaaa-0000-4000-8000-000000000127')
  ), 'b: geen voorstel bij een eigen prijs (ook 0), een klant, te weinig prijzen of zonder type';

  -- Straat: 5 prijzen (loopprijzen 10 en 12, klantprijzen 14, 16 en 18); de
  -- inactieve klant, de 0 en B tellen niet. Mediaan 14.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000101';
  assert v.niveau = 'straat' and v.n = 5 and v.voorstel = 14.00,
    format('b: tussenwoning: straat, 5, 14,00 verwacht, maar %s, %s, %s', v.niveau, v.n, v.voorstel);
  -- De eigen correctie (woningtype_zelf) gaat voor de schatting.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000123';
  assert v.niveau = 'straat' and v.n = 5 and v.voorstel = 14.00,
    format('b: de verbeterde tussenwoning: straat, 5, 14,00 verwacht, maar %s, %s, %s', v.niveau, v.n, v.voorstel);

  -- Buurt: maar 2 loopprijzen in de straat, en de ene klantprijs (100) telt
  -- niet mee (minder dan 3 klantprijzen). Dus de buurt (+ de Groepstraat; de
  -- Wijkstraat telt hier nog niet). Mediaan van 20, 22, 30.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000113';
  assert v.niveau = 'buurt' and v.n = 3 and v.voorstel = 22.00,
    format('b: hoekwoning: buurt, 3, 22,00 verwacht, maar %s, %s, %s', v.niveau, v.n, v.voorstel);

  -- Wijk: alleen in de Wijkstraat (40, en 44 op naam); de andere wijk en B tellen niet.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000119';
  assert v.niveau = 'wijk' and v.n = 2 and v.voorstel = 42.00,
    format('b: 2-onder-1-kap: wijk, 2, 42,00 verwacht, maar %s, %s, %s', v.niveau, v.n, v.voorstel);

  -- m²: 200 tegen 100 is sqrt(2), begrensd op 1,25: 12,50 en 13,75, mediaan
  -- 13,125, afgerond op € 0,50 wordt dat 13,00. In de buurt (het gebied),
  -- want in de straat zijn er maar 2.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000402';
  assert v.niveau = 'buurt' and v.n = 2 and v.voorstel = 13.00,
    format('b: groot appartement: buurt, 2, 13,00 verwacht, maar %s, %s, %s', v.niveau, v.n, v.voorstel);
  -- 25 tegen 100 is 0,5, begrensd op 0,8: 8,00 en 8,80, mediaan 8,40 → 8,50.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000408';
  assert v.voorstel = 8.50, format('b: klein appartement: 8,50 verwacht, maar %s', v.voorstel);
  -- Zonder m²: de prijzen zelf, mediaan 10,50.
  select * into v from public.loop_voorstellen(gebied) l where l.adres_id = 'aaaaaaaa-0000-4000-8000-000000000410';
  assert v.voorstel = 10.50, format('b: appartement zonder m²: 10,50 verwacht, maar %s', v.voorstel);

  -- Afgerond op € 0,50: geen enkel voorstel heeft andere centen.
  assert not exists (select 1 from public.loop_voorstellen(gebied) l where (l.voorstel * 2) <> round(l.voorstel * 2)),
    'b: elk voorstel is afgerond op € 0,50';

  -- Geen enkele prijs van B (1000), en de losse klantprijs van 100 ook niet.
  assert not exists (select 1 from public.loop_voorstellen(gebied) l where l.voorstel >= 100),
    'B: geen prijs van bedrijf B (en geen losse klantprijs) in een voorstel';

  -- Het gebied van B: bestaat niet voor A.
  ok := false;
  begin
    perform * from public.loop_voorstellen('bbbbbbbb-0000-4000-8000-0000000000f1');
  exception when raise_exception then ok := sqlerrm = 'Dit gebied bestaat niet (meer).';
  end;
  assert ok, 'B: het gebied van B geeft "bestaat niet"';
end $$;

-- ---------------------------------------------------------------------
-- Nakijken als postgres
-- ---------------------------------------------------------------------
reset role;

do $$
begin
  -- Precies vier kolommen terug, verder niets.
  assert (
    select array_agg(p.parameter_name::text order by p.ordinal_position)
    from information_schema.parameters p
    join information_schema.routines r on r.specific_name = p.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'loop_voorstellen' and p.parameter_mode = 'OUT'
  ) = array['adres_id', 'voorstel', 'n', 'niveau'],
    'b: loop_voorstellen geeft alleen adres_id, voorstel, n en niveau terug';

  -- Security definer met vaste search_path, niet voor anon.
  assert (select p.prosecdef from pg_proc p where p.oid = 'public.loop_voorstellen(uuid)'::regprocedure),
    'e: loop_voorstellen is security definer';
  assert (select 'search_path=public' = any(p.proconfig) from pg_proc p where p.oid = 'public.loop_voorstellen(uuid)'::regprocedure),
    'e: loop_voorstellen heeft search_path=public';
  assert not has_function_privilege('anon', 'public.loop_voorstellen(uuid)', 'execute'),
    'e: anon mag loop_voorstellen niet aanroepen';
  assert has_function_privilege('authenticated', 'public.loop_voorstellen(uuid)', 'execute'),
    'e: authenticated mag loop_voorstellen aanroepen';
end $$;

-- Een rol zonder Klanten lopen krijgt een fout.
update public.rollen set rechten = array[]::text[] where id = 'aaaaaaaa-0000-4000-8000-0000000000c1';
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$
declare
  ok boolean := false;
begin
  begin
    perform * from public.loop_voorstellen('aaaaaaaa-0000-4000-8000-0000000000f1');
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'e: zonder Klanten lopen geen voorstellen';
end $$;
reset role;

select 'OK loop_voorstellen' as uitslag;

rollback;
