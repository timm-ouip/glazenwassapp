-- De hele straatnaam van een hoekadres, voor het postadres.
--
-- hoek_straat is de werknaam waarmee hij op de printlijst past ('Aleid'). Maar
-- op de klantenlijst en in het dossier staat een echt adres, en daar hoort de
-- officiële naam: 'Aleidisstraat 25', niet 'Westmade D 25'. Dat is ook de naam
-- waarmee je een postcode opzoekt, dus die kan niet afgekort zijn.
--
-- Leeg betekent: dit adres houdt de straat waar hij in de lijst staat.

alter table public.customers
  add column hoek_straat_volledig text not null default '';
