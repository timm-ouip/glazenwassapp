-- Officiële adresgegevens naast de werknamen van de wijklijst.
--
-- `districts.name` en `streets.name` zijn werknamen: kort, zoals ze op de
-- printlijst staan en zoals ze hardop gezegd worden ("Ameland", "Kz Max").
-- Die moeten kort blijven — de wasser leest ze in de auto.
--
-- Om een adres tegen het adressenregister te kunnen houden (postcode
-- opzoeken, later post versturen) is de officiële schrijfwijze nodig, en die
-- staat hier los naast:
--
--   districts.plaats        de woonplaats van de wijk. Een wijknaam zegt daar
--                           niets over: "Madestein" ligt in 's-Gravenhage.
--   streets.volledige_naam  de officiële straatnaam: "Ameland" is
--                           Amelandstraat, "Othilde" is Gravin Othildehof.
--
-- Allebei mogen leeg blijven. Niet elke regel op de wijklijst is een straat
-- in het register — sommige zijn blokaanduidingen als "Markgraaf CD".

alter table public.districts add column if not exists plaats text not null default '';
alter table public.streets add column if not exists volledige_naam text not null default '';
