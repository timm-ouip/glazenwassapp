-- Paaltje leest elke twee minuten de mail die op hem wacht.

-- Een mail die Paaltje aan het lezen is staat op "bezig", zodat twee rondes
-- hem nooit tegelijk oppakken.
alter table public.berichten drop constraint if exists berichten_paaltje_status_check;
alter table public.berichten
  add constraint berichten_paaltje_status_check
  check (paaltje_status in ('overslaan', 'wacht', 'bezig', 'klaar', 'fout'));

-- Hoe vaak Paaltje een mail al probeerde. Een mail die elke keer vastloopt of
-- mislukt, kost anders elke ronde opnieuw een aanroep van het taalmodel.
alter table public.berichten
  add column if not exists paaltje_pogingen integer not null default 0;

-- Een minuut na het ophalen (dat draait op de even minuten), zodat nieuwe mail
-- er meestal al staat. Zelfde sleutel en adres uit Vault als het ophalen.
select cron.schedule(
  'paaltje-lezen',
  '1-59/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/paaltje-lezen',
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
