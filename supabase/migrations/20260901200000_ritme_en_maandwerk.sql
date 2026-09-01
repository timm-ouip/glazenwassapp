-- Het ritme van een adres: om de hoeveel maanden hij gewassen wordt, en in
-- welke maanden dat uitkomt. Tot nu toe kon dat alleen "elke", "even" of
-- "oneven" zijn, en dat is te weinig voor een klant die je één keer per
-- kwartaal doet.
--
-- interval_maanden: om de hoeveel maanden. Niet "interval", want dat is in
--   Postgres de naam van een type en dat vraagt om verwarring.
-- ritme: de ankermaand binnen het jaar (1-12). Een adres is aan de beurt in
--   maand m als (m - ritme) deelbaar is door interval_maanden. Om de 2 met
--   ritme 2 zijn de even maanden, met ritme 1 de oneven; om de 3 met ritme 3
--   is maart/juni/september/december. Bij interval_maanden 1 doet ritme niet
--   mee.
-- maandwerk: werk dat er alleen in bepaalde maanden bij komt, met eventueel
--   een eigen prijs voor die ronde. De maanden zijn kalendermaanden
--   ('01'-'12'), dus het herhaalt zich elk jaar:
--     [{"maanden":["03","09"],"notitie":"serre","prijs":25}]
--   prijs is de hele prijs voor die ronde, niet de meerkosten; null betekent
--   gewoon de vaste prijs van het adres.
--
-- frequency, note_even en note_oneven blijven voorlopig staan. Ze kosten
-- niets en zijn de weg terug als hier iets niet blijkt te kloppen.

alter table public.customers
  add column interval_maanden int   not null default 1  check (interval_maanden in (1, 2, 3, 6, 12)),
  add column ritme            int   not null default 1  check (ritme between 1 and 12),
  add column maandwerk        jsonb not null default '[]'::jsonb;

-- Wat er in frequency stond, in het nieuwe ritme. "elke" is de standaard en
-- hoeft niets. start_maand blijft ongemoeid: wanneer een adres begint staat
-- los van in welke maanden hij valt.
update public.customers set interval_maanden = 2, ritme = 2 where frequency = 'even';
update public.customers set interval_maanden = 2, ritme = 1 where frequency = 'oneven';

-- De twee maandnotities worden uitzonderingen op kalendermaanden: even is
-- februari tot en met december, oneven januari tot en met november.
update public.customers
   set maandwerk =
     (case
        when btrim(note_even) <> '' then jsonb_build_array(jsonb_build_object(
          'maanden', jsonb_build_array('02', '04', '06', '08', '10', '12'),
          'notitie', btrim(note_even),
          'prijs', null))
        else '[]'::jsonb
      end)
     ||
     (case
        when btrim(note_oneven) <> '' then jsonb_build_array(jsonb_build_object(
          'maanden', jsonb_build_array('01', '03', '05', '07', '09', '11'),
          'notitie', btrim(note_oneven),
          'prijs', null))
        else '[]'::jsonb
      end)
 where btrim(note_even) <> '' or btrim(note_oneven) <> '';
