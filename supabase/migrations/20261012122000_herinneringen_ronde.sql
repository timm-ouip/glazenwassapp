-- De dagelijkse ronde herinneringen.
--
-- 's Ochtends om half negen Nederlandse tijd, dus 06:30 UTC in de zomer. Dat
-- het in de winter half acht wordt is hier niet erg: een herinnering is geen
-- afspraak, en een uur schuiven merkt niemand. Bewust ná het gele vakje van
-- gisteren, zodat er altijd een dag tussen zit waarop je "niet doen" kunt
-- aanklikken.
select cron.unschedule('factuur-herinneringen')
where exists (select 1 from cron.job where jobname = 'factuur-herinneringen');

select cron.schedule(
  'factuur-herinneringen',
  '30 6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/factuur-herinneringen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-sleutel',
      (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_sleutel')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
