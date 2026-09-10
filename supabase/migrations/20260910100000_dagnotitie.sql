-- Een notitie bij één adres op één dag.
--
-- De notitie op het adres zelf zegt wat er normaal gedaan wordt ("hele huis,
-- serre"). Wat er die ene keer anders ging hoort daar niet in: alleen de
-- voorkant gewassen omdat de steiger stond, of de achterdeur zat op slot.
-- Dat is een eigenschap van de dag, niet van de klant, en staat daarom hier —
-- naast het bedrag, dat om dezelfde reden al op de regel stond.
--
-- Straks komt deze regel op de factuur: het bedrag en waarom het dat bedrag
-- was, staan dan in één rij bij elkaar.

alter table public.wasdag_regels add column notitie text;
