-- Proef: bankbestanden inlezen (migratie 20261025100000_bank_inlezen).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug: er blijft niets achter.
-- Twee wegwerpbedrijven A en B; geen echt bedrijf, geen echte klant.
--
-- Laat de proef "OK bank_inlezen" zien, dan klopt alles. Gaat een controle
-- mis, dan stopt hij met een melding die zegt wat er niet klopt.

begin;

-- ---------------------------------------------------------------------
-- Opzet (als postgres, vóór de rolwissel)
-- ---------------------------------------------------------------------
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)'),
  ('bbbbbbbb-0000-4000-8000-000000000000', 'Proefbedrijf B (test)');

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'eigenaar-a@proef.invalid', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'eigenaar-b@proef.invalid', 'authenticated', 'authenticated');

insert into public.employees (id, company_id, naam, email, rol) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Eigenaar A', 'eigenaar-a@proef.invalid', 'eigenaar'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000000', 'Eigenaar B', 'eigenaar-b@proef.invalid', 'eigenaar');

insert into public.klanten (id, company_id, naam, email, klanttype) values
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Jansen (test)', 'jansen@proef.invalid', 'particulier'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Pietersen (test)', 'pietersen@proef.invalid', 'particulier');

-- f1 en f2 van Jansen (45 en 30), f3 en f4 van Pietersen (60 en 20).
insert into public.facturen (id, company_id, klant_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c2'),
  ('aaaaaaaa-0000-4000-8000-0000000000f4', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c2');

insert into public.factuurregels (company_id, klant_id, soort, datum, omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl, factuur_id)
select 'aaaaaaaa-0000-4000-8000-000000000000', k, 'los', date '2026-10-01', 'Proefwerk', b, true, 21,
       public.factuur_excl(b, true, 21), f
from (values
  ('aaaaaaaa-0000-4000-8000-0000000000f1'::uuid, 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid, 45.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-0000000000c1', 30.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-0000000000c2', 60.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f4', 'aaaaaaaa-0000-4000-8000-0000000000c2', 20.00)
) as v(f, k, b);

-- ---------------------------------------------------------------------
-- Eigenaar A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  f uuid;
  nr text;
  i integer := 0;
begin
  -- Op volgorde vastzetten en versturen: 2026-0001 t/m 2026-0004.
  foreach f in array array[
    'aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-0000000000f2',
    'aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-0000000000f4']::uuid[]
  loop
    i := i + 1;
    nr := public.factuur_vastzetten(f) ->> 'nummer';
    if nr <> '2026-000' || i then
      raise exception 'Verwachtte nummer 2026-000%, kreeg %', i, nr;
    end if;
    perform public.factuur_verstuurd(f, 'mail', 'proef@proef.invalid');
  end loop;
  -- f4 is al betaald (met de hand afgevinkt).
  perform public.factuur_betaald('aaaaaaaa-0000-4000-8000-0000000000f4', 20);
end
$$;

-- Het bestand, zoals src/lib/bankbestand.ts het aanlevert.
select set_config('proef.regels', $json$[
  {"datum": "2026-10-05", "bedrag": 45.00, "tegen_iban": "NL01 TEST 0000 0000 01", "tegen_naam": "J JANSEN", "omschrijving": "Factuur 2026-0001", "kenmerk": "", "ref": "a1"},
  {"datum": "2026-10-06", "bedrag": 30.00, "tegen_iban": "NL01TEST0000000001", "tegen_naam": "J JANSEN", "omschrijving": "glazenwassen oktober", "kenmerk": "", "ref": "a2"},
  {"datum": "2026-10-06", "bedrag": 25.00, "tegen_iban": "NL55DEUT0000000000", "tegen_naam": "Stichting Mollie Payments", "omschrijving": "Uitbetaling st.12345", "kenmerk": "", "ref": "a3"},
  {"datum": "2026-10-07", "bedrag": 20.00, "tegen_iban": "NL02TEST0000000002", "tegen_naam": "P PIETERSEN", "omschrijving": "2026-0004", "kenmerk": "", "ref": "a4"},
  {"datum": "2026-10-07", "bedrag": 70.00, "tegen_iban": "NL03TEST0000000003", "tegen_naam": "P PIETERSEN", "omschrijving": "betaling 2026/0003", "kenmerk": "", "ref": "a5"},
  {"datum": "2026-10-07", "bedrag": -10.00, "tegen_iban": "NL04TEST0000000004", "tegen_naam": "Tankstation", "omschrijving": "Pinbetaling", "kenmerk": "", "ref": "a6"},
  {"datum": "2026-10-08", "bedrag": 12.00, "tegen_iban": "NL09TEST0000000009", "tegen_naam": "ONBEKEND", "omschrijving": "bedankt", "kenmerk": "", "ref": ""},
  {"datum": "2026-10-08", "bedrag": 12.00, "tegen_iban": "NL09TEST0000000009", "tegen_naam": "ONBEKEND", "omschrijving": "bedankt", "kenmerk": "", "ref": ""}
]$json$, true);

do $$
declare
  uit jsonb;
  t public.bank_transacties;
  r public.facturen;
  saldo numeric;
  r4 uuid;
  r7 uuid;
  r1 uuid;
begin
  uit := public.bank_inlezen('camt053', 'proef.xml', current_setting('proef.regels')::jsonb);
  if uit <> '{"nieuw": 7, "al_bekend": 0, "gekoppeld": 3, "genegeerd": 1, "te_controleren": 3}'::jsonb then
    raise exception 'Eerste keer inlezen gaf %', uit;
  end if;

  -- Hetzelfde bestand nog een keer: niets nieuws.
  uit := public.bank_inlezen('camt053', 'proef.xml', current_setting('proef.regels')::jsonb);
  if (uit ->> 'nieuw')::int <> 0 or (uit ->> 'al_bekend')::int <> 7 then
    raise exception 'Tweede keer inlezen hoort niets nieuws te geven, gaf %', uit;
  end if;

  -- f1 via het nummer, f2 via de rekening die bij f1 geleerd is.
  select * into r from public.facturen where id = 'aaaaaaaa-0000-4000-8000-0000000000f1';
  if r.status <> 'betaald' or r.betaald_op <> date '2026-10-05' then
    raise exception 'f1 hoort betaald te zijn op 5-10, is % op %', r.status, r.betaald_op;
  end if;
  select * into r from public.facturen where id = 'aaaaaaaa-0000-4000-8000-0000000000f2';
  if r.status <> 'betaald' then
    raise exception 'f2 hoort via de bekende rekening betaald te zijn, is %', r.status;
  end if;
  select * into t from public.bank_transacties where omschrijving = 'glazenwassen oktober';
  if not t.door_app then
    raise exception 'De koppeling van f2 hoort door de app gedaan te zijn.';
  end if;

  -- Mollie genegeerd.
  if (select status from public.bank_transacties where tegen_naam ~* 'mollie') <> 'genegeerd' then
    raise exception 'Een uitbetaling van Mollie hoort genegeerd te worden.';
  end if;

  -- f3: 70 op 60 is 10 tegoed voor Pietersen.
  select * into r from public.facturen where id = 'aaaaaaaa-0000-4000-8000-0000000000f3';
  if r.status <> 'betaald' or r.betaald_bedrag <> 70 then
    raise exception 'f3 hoort betaald met 70, is % / %', r.status, r.betaald_bedrag;
  end if;
  saldo := (public.klant_tegoed('aaaaaaaa-0000-4000-8000-0000000000c2') ->> 'saldo')::numeric;
  if saldo <> 10 then
    raise exception 'Pietersen hoort 10 tegoed te hebben, heeft %', saldo;
  end if;

  -- f4 was al betaald: te controleren, met f4 als voorstel.
  select * into t from public.bank_transacties where omschrijving = '2026-0004';
  r4 := t.id;
  if t.status <> 'open' or t.voorstel <> array['aaaaaaaa-0000-4000-8000-0000000000f4']::uuid[]
     or t.reden not like '%al betaald%' then
    raise exception 'De betaling op de al betaalde f4 hoort te wachten met f4 als voorstel, is % / % / %',
      t.status, t.voorstel, t.reden;
  end if;

  -- Twee gelijke regels blijven er twee.
  if (select count(*) from public.bank_transacties where omschrijving = 'bedankt') <> 2 then
    raise exception 'Twee gelijke bijschrijvingen horen er twee te blijven.';
  end if;
  select id into r7 from public.bank_transacties where omschrijving = 'bedankt' limit 1;

  -- Toch boeken op f4: dat wordt tegoed (10 + 20 = 30).
  perform public.bank_koppelen(r4, array['aaaaaaaa-0000-4000-8000-0000000000f4']::uuid[]);
  saldo := (public.klant_tegoed('aaaaaaaa-0000-4000-8000-0000000000c2') ->> 'saldo')::numeric;
  if saldo <> 30 then
    raise exception 'Na het boeken op f4 hoort Pietersen 30 tegoed te hebben, heeft %', saldo;
  end if;
  -- Nog een keer koppelen kan niet.
  begin
    perform public.bank_koppelen(r4, array['aaaaaaaa-0000-4000-8000-0000000000f4']::uuid[]);
    raise exception 'dubbel';
  exception when others then
    if sqlerrm = 'dubbel' then
      raise exception 'Een geboekte bijschrijving hoort niet nog een keer te boeken.';
    end if;
  end;

  -- En weer terug.
  perform public.bank_terugzetten(r4);
  saldo := (public.klant_tegoed('aaaaaaaa-0000-4000-8000-0000000000c2') ->> 'saldo')::numeric;
  if saldo <> 10 then
    raise exception 'Na het terugzetten hoort Pietersen weer 10 tegoed te hebben, heeft %', saldo;
  end if;
  if (select status from public.bank_transacties where id = r4) <> 'open'
     or exists (select 1 from public.bank_koppelingen where transactie_id = r4) then
    raise exception 'Na het terugzetten hoort de bijschrijving weer open te staan zonder koppelingen.';
  end if;

  -- Negeren.
  perform public.bank_negeren(r7);
  if (select status from public.bank_transacties where id = r7) <> 'genegeerd' then
    raise exception 'Negeren hoort de status op genegeerd te zetten.';
  end if;

  -- De automatische koppeling van f1 terugdraaien zet f1 weer open.
  select id into r1 from public.bank_transacties where omschrijving = 'Factuur 2026-0001';
  perform public.bank_terugzetten(r1);
  select * into r from public.facturen where id = 'aaaaaaaa-0000-4000-8000-0000000000f1';
  if r.status <> 'verstuurd' or r.betaald_bedrag <> 0 then
    raise exception 'Na het terugzetten hoort f1 weer open te staan, is % / %', r.status, r.betaald_bedrag;
  end if;

  -- De rekening van Jansen is onthouden, in de nette vorm: de koppeling van
  -- f2 bevestigt hem nog, dus het terugzetten van f1 laat hem staan.
  if not exists (select 1 from public.klant_ibans
                 where klant_id = 'aaaaaaaa-0000-4000-8000-0000000000c1' and iban = 'NL01TEST0000000001') then
    raise exception 'De rekening van Jansen hoort onthouden te zijn.';
  end if;
  -- Pietersen betaalde f3 vanaf NL03; terugzetten vergeet die rekening.
  perform public.bank_terugzetten((select id from public.bank_transacties where omschrijving = 'betaling 2026/0003'));
  if exists (select 1 from public.klant_ibans where iban = 'NL03TEST0000000003') then
    raise exception 'Na het terugzetten hoort de rekening van f3 vergeten te zijn.';
  end if;

  -- Dezelfde overmaking uit een ander soort bestand wordt niet vanzelf geboekt.
  uit := public.bank_inlezen('mt940', 'proef.sta', $json$[
    {"datum": "2026-10-06", "bedrag": 30.00, "tegen_iban": "NL01TEST0000000001", "tegen_naam": "J JANSEN", "omschrijving": "glazenwassen oktober", "kenmerk": "", "ref": "x9"}
  ]$json$::jsonb);
  if (uit ->> 'te_controleren')::int <> 1 then
    raise exception 'Een dubbele uit een ander soort bestand hoort te wachten, gaf %', uit;
  end if;

  -- Een klant die Mollie heet, is geen uitbetaling van Mollie.
  uit := public.bank_inlezen('csv', 'proef.csv', $json$[
    {"datum": "2026-10-09", "bedrag": 45.00, "tegen_iban": "NL05TEST0000000005", "tegen_naam": "MOLLIE DE VRIES", "omschrijving": "2026-0001", "kenmerk": "", "ref": "c1", "volg": 1}
  ]$json$::jsonb);
  if (uit ->> 'gekoppeld')::int <> 1 then
    raise exception 'Mollie de Vries hoort gewoon geboekt te worden, gaf %', uit;
  end if;

  -- Tweelingen die over twee stukken verdeeld zijn, blijven er twee.
  uit := public.bank_inlezen('csv', 'proef.csv', $json$[
    {"datum": "2026-10-10", "bedrag": 5.00, "tegen_iban": "", "tegen_naam": "X", "omschrijving": "fooi", "kenmerk": "", "ref": "", "volg": 1}
  ]$json$::jsonb);
  uit := public.bank_inlezen('csv', 'proef.csv', $json$[
    {"datum": "2026-10-10", "bedrag": 5.00, "tegen_iban": "", "tegen_naam": "X", "omschrijving": "fooi", "kenmerk": "", "ref": "", "volg": 2}
  ]$json$::jsonb);
  if (uit ->> 'nieuw')::int <> 1 then
    raise exception 'De tweede tweeling in een volgend stuk hoort nieuw te zijn, gaf %', uit;
  end if;

  -- Een rekening met de hand weghalen mag.
  delete from public.klant_ibans where iban = 'NL01TEST0000000001';
  if exists (select 1 from public.klant_ibans where iban = 'NL01TEST0000000001') then
    raise exception 'Een rekening weghalen hoort te kunnen.';
  end if;

  -- In de prullenbak: de rekeningen gaan mee. Mollie de Vries (NL05) betaalde
  -- op f1 van Jansen, dus Jansen kent NL05 nu.
  if not exists (select 1 from public.klant_ibans where iban = 'NL05TEST0000000005') then
    raise exception 'NL05 hoort bij Jansen onthouden te zijn.';
  end if;
  update public.klanten set deleted_at = now() where id = 'aaaaaaaa-0000-4000-8000-0000000000c1';
  if exists (select 1 from public.klant_ibans where klant_id = 'aaaaaaaa-0000-4000-8000-0000000000c1') then
    raise exception 'Een klant in de prullenbak hoort geen rekeningen meer te hebben.';
  end if;

  -- Rechtstreeks schrijven mag niet.
  begin
    insert into public.bank_transacties (sleutel, datum, bedrag, bron)
    values ('x', current_date, 1, 'csv');
    raise exception 'ingevoegd';
  exception when others then
    if sqlerrm = 'ingevoegd' then
      raise exception 'Rechtstreeks een banktransactie invoegen hoort niet te kunnen.';
    end if;
  end;
end
$$;

-- ---------------------------------------------------------------------
-- Eigenaar B ziet niets van A
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  a uuid;
begin
  if exists (select 1 from public.bank_transacties)
     or exists (select 1 from public.bank_koppelingen)
     or exists (select 1 from public.klant_ibans) then
    raise exception 'B hoort niets van de bank van A te zien.';
  end if;
  -- En kan er ook niets van weghalen.
  reset role;
  insert into public.klant_ibans (company_id, iban, klant_id)
  values ('aaaaaaaa-0000-4000-8000-000000000000', 'NL07TEST0000000007', 'aaaaaaaa-0000-4000-8000-0000000000c2');
  set local role authenticated;
  delete from public.klant_ibans;
  reset role;
  if not exists (select 1 from public.klant_ibans) then
    raise exception 'B hoort de rekeningen van A niet te kunnen weghalen.';
  end if;
  set local role authenticated;
  -- Een id van A raden helpt niet.
  reset role;
  select id into a from public.bank_transacties where status = 'open' limit 1;
  set local role authenticated;
  begin
    perform public.bank_negeren(a);
    raise exception 'gelukt';
  exception when others then
    if sqlerrm = 'gelukt' then
      raise exception 'B hoort een bijschrijving van A niet te kunnen negeren.';
    end if;
  end;
  begin
    perform public.bank_koppelen(a, array['aaaaaaaa-0000-4000-8000-0000000000f1']::uuid[]);
    raise exception 'gelukt';
  exception when others then
    if sqlerrm = 'gelukt' then
      raise exception 'B hoort een bijschrijving van A niet te kunnen koppelen.';
    end if;
  end;
end
$$;

select 'OK bank_inlezen' as uitslag;

rollback;
