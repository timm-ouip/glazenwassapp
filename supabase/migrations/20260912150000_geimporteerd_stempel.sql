-- Welke adressen via een import binnenkwamen.
--
-- In het dossier staat sinds wanneer een adres op de lijst staat. Bij een
-- adres dat je zelf invoert is dat "klant sinds"; bij een geïmporteerd adres
-- zegt die datum alleen wanneer de import draaide — die klant was er daarvóór
-- al. Dat verschil is het verschil tussen "sinds augustus klant" en "in
-- augustus overgezet, en wie weet hoeveel jaar daarvoor al klant".
--
-- Een vlag en geen datum: wanneer het gebeurde staat al in created_at, en twee
-- kolommen die hetzelfde moment bewaren lopen vroeg of laat uit elkaar.
alter table public.customers
  add column if not exists geimporteerd boolean not null default false;

-- Met terugwerkende kracht voor wat er nu in staat: alles van vóór september
-- 2026 komt uit de Excel-import. Wat daarna is aangemaakt is met de hand
-- ingevoerd en blijft dus "klant sinds".
update public.customers
  set geimporteerd = true
  where created_at < '2026-09-01';
