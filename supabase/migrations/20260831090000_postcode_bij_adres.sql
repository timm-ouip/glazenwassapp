-- Postcode hoort bij het adres, niet bij de persoon.
--
-- Hij stond op `klanten`, waardoor hij pas kon bestaan zodra iemand een naam
-- had ingevuld — terwijl de postcode van een huis vaststaat, of we de
-- bewoner nu kennen of niet. Daardoor bleef de kolom in de praktijk overal
-- leeg.
--
-- Nu op de adresregel zelf, zodat hij in één keer voor de hele wijk op te
-- halen is. De woonplaats krijgt géén kolom: die staat al op de wijk
-- (`districts.plaats`) en is per wijk hetzelfde.
--
-- `klanten.postcode`, `.plaats`, `.straat` en `.huisnummer` blijven bestaan:
-- dat is het postadres van de persoon, dat kan afwijken van het pand dat we
-- wassen — denk aan een beheerder die ergens anders woont.

alter table public.customers add column if not exists postcode text not null default '';
