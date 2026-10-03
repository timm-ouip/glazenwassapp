-- Proef: notities na 24 maanden wissen (plan klanten-lopen, stap 1 f).
--
-- Draait als postgres en zonder ingelogde gebruiker, zoals pg_cron 's nachts.
-- Alles gebeurt in één transactie en rolt aan het eind terug. Let op: de
-- opruimfunctie werkt over alle bedrijven, maar door de rollback blijft er
-- nergens iets van over.
-- Laat hij "OK loop_notities_opruimen" zien, dan klopt alles.

begin;

-- Geen JWT, zoals onder pg_cron.
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------
-- Opzet
-- ---------------------------------------------------------------------
insert into public.companies (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000000', 'Proefbedrijf A (test)');

insert into public.loop_adressen (id, company_id, vbo_id, straat, woonplaats, huisnummer, uitkomst, notitie) values
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000001', 'Proefstraat', 'Proefstad', 1, 'interesse', 'Notitie van 25 maanden geleden'),
  ('aaaaaaaa-0000-4000-8000-000000000202', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000002', 'Proefstraat', 'Proefstad', 3, 'nee', 'Notitie van 23 maanden geleden'),
  ('aaaaaaaa-0000-4000-8000-000000000203', 'aaaaaaaa-0000-4000-8000-000000000000', '9990010000000003', 'Proefstraat', 'Proefstad', 5, 'niet_thuis', 'Notitie van vandaag');

-- De trigger zet notitie_op altijd zelf; om een oude datum neer te zetten
-- staat hij heel even uit (alleen binnen deze transactie).
alter table public.loop_adressen disable trigger loop_adressen_bijhouden;
update public.loop_adressen set notitie_op = now() - interval '25 months' where id = 'aaaaaaaa-0000-4000-8000-000000000201';
update public.loop_adressen set notitie_op = now() - interval '23 months' where id = 'aaaaaaaa-0000-4000-8000-000000000202';
alter table public.loop_adressen enable trigger loop_adressen_bijhouden;

-- ---------------------------------------------------------------------
-- Opruimen
-- ---------------------------------------------------------------------
do $$
declare
  n integer;
  r record;
begin
  n := public.loop_notities_opruimen();
  assert n >= 1, 'f: er moet minstens één notitie gewist zijn';

  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000201';
  assert r.notitie = '' and r.notitie_op is null, 'f: de notitie van 25 maanden geleden moet weg zijn';
  assert r.uitkomst = 'interesse' and r.uitkomst_op is not null, 'f: de uitkomst blijft altijd staan';

  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000202';
  assert r.notitie = 'Notitie van 23 maanden geleden' and r.notitie_op is not null, 'f: de notitie van 23 maanden geleden blijft staan';
  assert r.uitkomst = 'nee', 'f: de uitkomst blijft altijd staan';

  select * into r from public.loop_adressen where id = 'aaaaaaaa-0000-4000-8000-000000000203';
  assert r.notitie = 'Notitie van vandaag' and r.notitie_op = now(), 'f: de notitie van vandaag blijft staan';
end $$;

-- ---------------------------------------------------------------------
-- Een ingelogde gebruiker mag hem niet aanroepen
-- ---------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('authenticated', 'public.loop_notities_opruimen()', 'execute'),
    'f: authenticated mag loop_notities_opruimen niet aanroepen';
  assert not has_function_privilege('anon', 'public.loop_notities_opruimen()', 'execute'),
    'f: anon mag loop_notities_opruimen niet aanroepen';
end $$;

set local role authenticated;
do $$
declare
  ok boolean := false;
begin
  begin
    perform public.loop_notities_opruimen();
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'f: als authenticated aanroepen moet "permission denied" geven';
end $$;
reset role;

-- ---------------------------------------------------------------------
-- De nachtelijke taak bestaat precies één keer, ook na opnieuw plannen
-- ---------------------------------------------------------------------
do $$
begin
  assert (select count(*) from cron.job where jobname = 'loop-notities-opruimen') = 1,
    'f: de cron-taak loop-notities-opruimen moet precies één keer bestaan';
  assert (select schedule from cron.job where jobname = 'loop-notities-opruimen') = '20 3 * * *',
    'f: de cron-taak draait om 03:20 UTC';
end $$;

-- Hetzelfde blok als in de migratie, nog een keer.
select cron.unschedule('loop-notities-opruimen')
where exists (select 1 from cron.job where jobname = 'loop-notities-opruimen');

select cron.schedule(
  'loop-notities-opruimen',
  '20 3 * * *',
  $$select public.loop_notities_opruimen();$$
);

do $$
begin
  assert (select count(*) from cron.job where jobname = 'loop-notities-opruimen') = 1,
    'f: na opnieuw plannen bestaat de cron-taak nog steeds precies één keer';
end $$;

select 'OK loop_notities_opruimen' as uitslag;

rollback;
