-- Proef: bestaande klanten herkennen ondanks "Den Haag" ↔ "'s-Gravenhage" en
-- "12 A" ↔ "12a" (migratie 20261023100000_klanten_lopen_herkennen).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles rolt aan het
-- eind terug. Laat hij "OK loop_herkennen" zien, dan klopt alles.

begin;

insert into public.companies (id, name, plan_tarief_uur) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)', 75);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'loper-a@proef.invalid', 'authenticated', 'authenticated');

insert into public.rollen (id, company_id, naam, rechten) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefloper', array['klanten_lopen']);

insert into public.employees (id, company_id, naam, email, rol, rol_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Loper A', 'loper-a@proef.invalid', 'medewerker', 'aaaaaaaa-0000-4000-8000-0000000000c1');

-- Een wijk met plaats "Den Haag", zoals Scheveningen.
insert into public.districts (id, company_id, name, plaats) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefwijk Haag', 'Den Haag');

insert into public.streets (id, company_id, district_id, name, volledige_naam, sort_order) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Proefhofje', 'Proefhofje', 1);

-- Klanten zonder postcode: 7 (geen toevoeging) en 9 A (met spatie in de toevoeging).
insert into public.customers (id, company_id, street_id, house_number, addition, postcode, sort_order) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 7, '', '', 1),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000e1', 9, ' A', '', 2);

insert into public.loopgebieden (id, company_id, naam, opgehaald_op) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefgebied Haag', now());

-- Zo schrijft de BAG ze: plaats "'s-Gravenhage", toevoeging "A".
insert into public.loop_adressen (id, company_id, vbo_id, straat, woonplaats, huisnummer, toevoeging, postcode) values
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000001', 'Proefhofje', '''s-Gravenhage', 7, '', '2500AA'),
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000002', 'Ander Proefhofje', '''s-Gravenhage', 9, 'A', '2500AB'),
  ('aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000003', 'Proefhofje', '''s-Gravenhage', 11, '', '2500AC');

insert into public.loopgebied_adressen (gebied_id, adres_id, company_id)
select 'aaaaaaaa-0000-4000-8000-0000000000f1', la.id, la.company_id
from public.loop_adressen la where la.company_id = 'aaaaaaaa-0000-4000-8000-000000000000';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  s text;
begin
  -- 7: straat + "Den Haag" = straat + "'s-Gravenhage".
  select klant_status into s from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1')
  where id = 'aaaaaaaa-0000-4000-8000-000000000201';
  assert s = 'actief', 'Den Haag en ''s-Gravenhage moeten dezelfde plaats zijn (kreeg ' || coalesce(s, 'null') || ')';

  -- 11: geen klant.
  select klant_status into s from public.loop_lijst('aaaaaaaa-0000-4000-8000-0000000000f1')
  where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert s is null, 'nummer 11 is geen klant';
end $$;

-- 9 A staat onder een andere BAG-straatnaam; de lijst herkent hem dus niet,
-- maar Ja in de gekozen straat moet hem vinden ("A" = " A") en niet dubbel maken.
do $$
declare
  r record;
begin
  select * into r from public.loop_maak_klant(
    'aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000e1',
    15, 1, 1, '', '', '');
  assert r.bestond and r.customer_id = 'aaaaaaaa-0000-4000-8000-000000000102',
    '9 A moet de bestaande klant zijn, geen nieuwe';
end $$;

-- Als postgres tellen: een loper mag customers zelf niet lezen.
reset role;
do $$
declare
  n int;
begin
  select count(*) into n from public.customers
  where street_id = 'aaaaaaaa-0000-4000-8000-0000000000e1' and house_number = 9 and deleted_at is null;
  assert n = 1, 'er mag maar één adres 9 A zijn (kreeg ' || n || ')';
end $$;

select 'OK loop_herkennen' as uitslag;
rollback;
