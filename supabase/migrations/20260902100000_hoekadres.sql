-- Een huisnummer op de hoek hoort officieel bij een andere straat.
--
-- "Westmade D 25 (hoek Aleid)" staat op de lijst bij Westmade D, maar het pand
-- kijkt uit op de Aleid en ligt fysiek tussen 26 en 32 in — dus in de even
-- kolom. De app leidt de kolom af uit het huisnummer, en die afleiding klopt
-- hier niet. Uitrekenen kan niet: alleen wie de wijk rijdt weet het.
--
-- hoek_straat: de straat waar het adres echt aan ligt, als werknaam zoals hij
--   op de lijst staat ('Aleid', niet 'Aleidisstraat'). Alleen om te tonen; het
--   adres blijft bij zijn eigen straat staan, want daar loop je hem. Vrije
--   tekst en geen verwijzing: die straat hoeft niet eens in je wijk te staan.
--   Prijs daarvan is dat hij stilletjes veroudert als je die straat hernoemt.
-- hoek_kant: in welke kolom de regel hoort. Zet je door hem daarheen te
--   slepen. Leeg is het gewone geval: dan beslist het huisnummer, zoals altijd.

alter table public.customers
  add column hoek_straat text not null default '',
  add column hoek_kant   text not null default '' check (hoek_kant in ('', 'even', 'oneven'));
