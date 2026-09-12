-- Een straat waarvan de nummers per 1 oplopen.
--
-- Normaal staat een straat in twee kolommen: even links, oneven rechts. Dat
-- klopt met hoe je loopt — de ene kant heen, de andere terug. Maar niet elke
-- straat is zo genummerd: soms staan alle nummers, even én oneven, aan
-- dezelfde kant en loop je ze gewoon op volgorde af.
--
-- Staat deze vlag aan, dan telt de app de straat door: de eerste helft links,
-- de tweede helft rechts. Het blok blijft even compact, en je leest links naar
-- beneden en rechts verder.
--
-- Geen gevolgen voor bestaande straten: standaard uit, dus die blijven even en
-- oneven. Ook niets om terug te kunnen halen — het is een weergave-instelling,
-- geen werk dat verloren gaat.
alter table public.streets
  add column if not exists doorlopend boolean not null default false;
