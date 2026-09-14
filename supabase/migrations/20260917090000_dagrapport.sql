-- Het dagrapport: elke ochtend om half zeven wat Wooshy sinds de vorige keer
-- deed. Wat er binnenkwam, wat Paaltje zelf doorvoerde, wat er verstuurd is,
-- wat nog op je wacht, en of er iets misging.
--
-- Het rapport gaat per mail naar de eigenaar en blijft hier staan, zodat je
-- het ook in Wooshy terugleest. Gebeurde er niets, dan komt er geen rapport.

create table public.dagrapporten (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- De dag in Nederlandse tijd. Eén rapport per bedrijf per dag: draait de
  -- klok twee keer (zomer- en wintertijd), dan komt er toch maar één.
  datum date not null,
  vanaf timestamptz not null,
  tot timestamptz not null,
  inhoud jsonb not null default '{}',
  gemaild_op timestamptz,
  mail_fout text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, datum)
);

create index dagrapporten_idx on public.dagrapporten (company_id, datum desc);

create trigger dagrapporten_set_company_id before insert on public.dagrapporten
  for each row execute function public.set_company_id();

-- Net als de mail zelf: alleen de eigenaar leest mee. De Edge Function schrijft.
alter table public.dagrapporten enable row level security;
create policy "Eigenaar ziet eigen dagrapporten" on public.dagrapporten
  for select to authenticated
  using (company_id = (select public.current_company_id()) and (select public.is_eigenaar()));

-- Om 04:30 en 05:30 UTC: dat is 06:30 in de zomer en in de winter. De functie
-- kijkt zelf welke van de twee het in Nederland echt half zeven is.
select cron.schedule(
  'dagrapport',
  '30 4,5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wooshy_project_url')
      || '/functions/v1/dagrapport',
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
