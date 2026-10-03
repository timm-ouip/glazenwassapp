-- Proef: tegoed bij de facturen (migratie 20261025090000_tegoed).
--
-- Draaien als postgres (supabase db query of de SQL-editor). Alles gebeurt in
-- één transactie en rolt aan het eind terug: er blijft niets achter.
-- Twee wegwerpbedrijven A en B; geen echt bedrijf, geen echte klant.
--
-- Laat de proef "OK tegoed" zien, dan klopt alles. Gaat een controle mis,
-- dan stopt hij met een melding die zegt wat er niet klopt.

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
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000000', 'Proefklant A', 'klant-a@proef.invalid', 'particulier'),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000000', 'Andere klant A', 'klant-a2@proef.invalid', 'particulier');

-- Zes concepten voor klant A1 (f1..f6) en één voor klant A2 (f7), elk met
-- één regel, inclusief 21% btw.
insert into public.facturen (id, company_id, klant_id) values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f4', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f5', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f6', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  ('aaaaaaaa-0000-4000-8000-0000000000f7', 'aaaaaaaa-0000-4000-8000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000c2');

insert into public.factuurregels (company_id, klant_id, soort, datum, omschrijving, bedrag, btw_inclusief, btw_procent, bedrag_excl, factuur_id)
select 'aaaaaaaa-0000-4000-8000-000000000000', k, 'los', date '2026-10-01', 'Proefwerk', b, true, 21,
       public.factuur_excl(b, true, 21), f
from (values
  ('aaaaaaaa-0000-4000-8000-0000000000f1'::uuid, 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid, 40.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-0000000000c1', 45.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f3', 'aaaaaaaa-0000-4000-8000-0000000000c1', 5.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f4', 'aaaaaaaa-0000-4000-8000-0000000000c1', 8.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f5', 'aaaaaaaa-0000-4000-8000-0000000000c1', 20.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f6', 'aaaaaaaa-0000-4000-8000-0000000000c1', 30.00),
  ('aaaaaaaa-0000-4000-8000-0000000000f7', 'aaaaaaaa-0000-4000-8000-0000000000c2', 30.00)
) as v(f, k, b);

-- ---------------------------------------------------------------------
-- Eigenaar A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  k uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';
  f1 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f1';
  f2 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f2';
  f3 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f3';
  f4 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f4';
  f5 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f5';
  f6 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f6';
  f7 uuid := 'aaaaaaaa-0000-4000-8000-0000000000f7';
  uit jsonb;
  saldo numeric;
  r public.facturen;
  gelukt boolean;
begin
  -- 1. Een factuur van 40 zonder tegoed; de klant maakt 50 over.
  uit := public.factuur_vastzetten(f1);
  if (uit ->> 'tegoed')::numeric <> 0 then
    raise exception 'f1: zonder tegoed hoort er niets verrekend te worden, kreeg %', uit;
  end if;
  perform public.factuur_verstuurd(f1, 'mail', 'klant-a@proef.invalid');
  uit := public.factuur_betaald(f1, 50);
  if (uit ->> 'tegoed')::numeric <> 10 or (uit ->> 'open')::numeric <> 0 then
    raise exception 'f1: 10 te veel betaald hoort 10 tegoed en 0 open te geven, kreeg %', uit;
  end if;
  select * into r from public.facturen where id = f1;
  if r.status <> 'betaald' then
    raise exception 'f1: hoort betaald te zijn, staat op %', r.status;
  end if;
  saldo := (public.klant_tegoed(k) ->> 'saldo')::numeric;
  if saldo <> 10 then
    raise exception 'Na f1 hoort het tegoed 10 te zijn, is %', saldo;
  end if;

  -- 2. De volgende factuur (45) krijgt de 10 eraf.
  uit := public.factuur_vastzetten(f2);
  if (uit ->> 'tegoed')::numeric <> 10 then
    raise exception 'f2: hoort 10 tegoed te verrekenen, kreeg %', uit;
  end if;
  -- Een tweede poging (de mail mislukte) verrekent niet nog een keer.
  uit := public.factuur_vastzetten(f2);
  if (uit ->> 'tegoed')::numeric <> 10 or (uit ->> 'opnieuw')::boolean is not true then
    raise exception 'f2: tweede vastzetten hoort hetzelfde terug te geven, kreeg %', uit;
  end if;
  perform public.factuur_verstuurd(f2, 'mail', 'klant-a@proef.invalid');
  select * into r from public.facturen where id = f2;
  if r.status <> 'verstuurd' or r.betaald_bedrag <> 10 or r.tegoed_verrekend <> 10 then
    raise exception 'f2: hoort verstuurd met 10 betaald uit tegoed, is % / % / %',
      r.status, r.betaald_bedrag, r.tegoed_verrekend;
  end if;
  saldo := (public.klant_tegoed(k) ->> 'saldo')::numeric;
  if saldo <> 0 then
    raise exception 'Na f2 hoort het tegoed op te zijn, is %', saldo;
  end if;

  -- 3. Zonder tegoed verrekent een factuur niets.
  uit := public.factuur_vastzetten(f3);
  if (uit ->> 'tegoed')::numeric <> 0 then
    raise exception 'f3: er was geen tegoed meer, kreeg %', uit;
  end if;
  perform public.factuur_verstuurd(f3, 'mail', 'klant-a@proef.invalid');

  -- 4. f2 crediteren: de 10 die erop verrekend was, komt terug.
  perform public.factuur_crediteren(f2);
  saldo := (public.klant_tegoed(k) ->> 'saldo')::numeric;
  if saldo <> 10 then
    raise exception 'Na het crediteren van f2 hoort het tegoed 10 te zijn, is %', saldo;
  end if;

  -- 5. Een factuur van 8: helemaal met tegoed betaald, dus meteen betaald.
  uit := public.factuur_vastzetten(f4);
  if (uit ->> 'tegoed')::numeric <> 8 then
    raise exception 'f4: hoort 8 tegoed te verrekenen, kreeg %', uit;
  end if;
  perform public.factuur_verstuurd(f4, 'mail', 'klant-a@proef.invalid');
  select * into r from public.facturen where id = f4;
  if r.status <> 'betaald' or r.betaald_op is null then
    raise exception 'f4: helemaal met tegoed betaald hoort op betaald te staan, staat op %', r.status;
  end if;
  -- Afboeken gaat nooit onder wat er met tegoed op betaald is.
  perform public.factuur_betaald(f4, -8);
  select * into r from public.facturen where id = f4;
  if r.betaald_bedrag <> 8 then
    raise exception 'f4: afboeken hoort niet onder het tegoed te zakken, betaald is %', r.betaald_bedrag;
  end if;
  saldo := (public.klant_tegoed(k) ->> 'saldo')::numeric;
  if saldo <> 2 then
    raise exception 'Na f4 hoort er 2 tegoed over te zijn, is %', saldo;
  end if;

  -- 6. Op een betaalde factuur komt nog een overboeking binnen: tegoed, en
  --    de betaaldatum blijft staan.
  update public.facturen set betaald_op = date '2026-10-02' where id = f1;
  if found then
    raise exception 'Een verstuurde factuur hoort niet met de hand bij te werken te zijn.';
  end if;
  uit := public.factuur_betaald(f1, 5, date '2026-10-20');
  if (uit ->> 'tegoed')::numeric <> 5 then
    raise exception 'f1: een extra 5 op een betaalde factuur hoort tegoed te zijn, kreeg %', uit;
  end if;

  -- 7. Vereffenen zet het saldo op nul (2 + 5 = 7).
  saldo := public.tegoed_vereffenen(k, 'Teruggestort');
  if saldo <> 7 then
    raise exception 'Vereffenen hoort 7 terug te geven, kreeg %', saldo;
  end if;
  saldo := (public.klant_tegoed(k) ->> 'saldo')::numeric;
  if saldo <> 0 then
    raise exception 'Na vereffenen hoort het tegoed 0 te zijn, is %', saldo;
  end if;
  begin
    perform public.tegoed_vereffenen(k, '');
    gelukt := true;
  exception when others then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'Vereffenen zonder tegoed hoort geweigerd te worden.';
  end if;

  -- 8. Mollie betaalt het restant van een factuur waar tegoed op verrekend is.
  perform public.factuur_betaald(f3, 15);          -- 10 te veel op f3 (totaal 5)
  uit := public.factuur_vastzetten(f5);            -- 20, daar gaat 10 af
  if (uit ->> 'tegoed')::numeric <> 10 then
    raise exception 'f5: hoort 10 tegoed te verrekenen, kreeg %', uit;
  end if;
  perform public.factuur_verstuurd(f5, 'mail', 'klant-a@proef.invalid');

  -- 9. Het verrekende tegoed is niet met de hand te zetten.
  begin
    update public.facturen set tegoed_verrekend = 100 where id = f6;
    gelukt := true;
  exception when others then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'Het verrekende tegoed hoort niet met de hand te zetten te zijn.';
  end if;

  -- 10. Tegoed van de ene klant gaat niet naar de andere.
  uit := public.factuur_vastzetten(f7);
  if (uit ->> 'tegoed')::numeric <> 0 then
    raise exception 'f7: een andere klant hoort geen tegoed te krijgen, kreeg %', uit;
  end if;

  -- 11. De lijst geeft de tegoedvelden mee.
  if not exists (
    select 1 from jsonb_array_elements(public.facturen_lijst(null, null, k)) e
    where e ->> 'id' = f1::text and (e ->> 'tegoed_uit')::numeric = 15
  ) then
    raise exception 'facturen_lijst hoort bij f1 tegoed_uit = 15 te geven.';
  end if;
  -- f1 te veel, f2 terug, f2 af, f3 te veel, f4 af, f5 af, vereffend.
  if (select count(*) from jsonb_array_elements(public.klant_tegoed(k) -> 'regels')) <> 7 then
    raise exception 'klant_tegoed hoort zeven regels te geven, kreeg %',
      public.klant_tegoed(k) -> 'regels';
  end if;
end
$$;

-- Mollie meldt het restant van f5 (als de server, dus als postgres).
reset role;
do $$
declare
  r public.facturen;
begin
  perform public.factuur_mollie_betaald('aaaaaaaa-0000-4000-8000-0000000000f5', 10);
  select * into r from public.facturen where id = 'aaaaaaaa-0000-4000-8000-0000000000f5';
  if r.status <> 'betaald' or r.betaald_bedrag <> 20 then
    raise exception 'f5: tegoed plus Mollie hoort betaald te zijn met 20, is % / %', r.status, r.betaald_bedrag;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- Eigenaar B ziet niets van A
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'role', 'authenticated', 'aal', 'aal2')::text, true);

do $$
declare
  t jsonb;
  gelukt boolean;
begin
  if exists (select 1 from public.tegoed_boekingen) then
    raise exception 'B hoort de tegoedboekingen van A niet te zien.';
  end if;
  t := public.klant_tegoed('aaaaaaaa-0000-4000-8000-0000000000c1');
  if (t ->> 'saldo')::numeric <> 0 or jsonb_array_length(t -> 'regels') <> 0 then
    raise exception 'B hoort niets van het tegoed van A te zien, kreeg %', t;
  end if;
  begin
    perform public.tegoed_vereffenen('aaaaaaaa-0000-4000-8000-0000000000c1', '');
    gelukt := true;
  exception when others then
    gelukt := false;
  end;
  if gelukt then
    raise exception 'B hoort het tegoed van A niet te kunnen vereffenen.';
  end if;
end
$$;

select 'OK tegoed' as uitslag;

rollback;
