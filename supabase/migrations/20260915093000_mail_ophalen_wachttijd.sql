-- Meer geduld voor de ophaalronde.
--
-- De functie antwoordt meteen en werkt daarna op de achtergrond door, maar na
-- een deploy of een rustige nacht moet hij eerst opstarten. Dat duurde langer
-- dan de 5 seconden die pg_net wachtte, en dan staat er een time-out in het
-- logboek terwijl er niets mis is. Zelfde taak, zelfde naam: cron.schedule
-- werkt de bestaande bij.
select cron.schedule(
  'mail-ophalen',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/mail-ophalen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-sleutel',
      (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_sleutel')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
