-- De proeffactuur van 24-09-2026 weg, inclusief het papier.
--
-- Factuur 2026-0001 was de proef op de som: is het uitloggen bij "Versturen"
-- verholpen, komt de kopie in het klantdossier, staat het euroteken op het
-- papier. Alle drie beantwoord. Maar op die PDF staan het adres, het
-- KvK-nummer, het btw-nummer en de IBAN van het bedrijf, en in de factuur
-- zitten de bevroren klantgegevens. Dat hoort niet te blijven staan nu de rest
-- van de echte gegevens er ook uit is.
--
-- Via een migratie, want een genummerde factuur is met opzet niet weg te
-- gooien vanuit de app (de RLS laat alleen een concept toe), en aan de
-- opslagbak komt de browser ook niet.
--
-- Alles hieronder noemt die ene factuur bij naam; er wordt niets "in het
-- algemeen" weggegooid.

delete from public.factuurregels
 where factuur_id in (select id from public.facturen where nummer = '2026-0001');

delete from public.facturen where nummer = '2026-0001';

-- De teller van 2026 hoort mee weg. Op 0 zetten is niet hetzelfde als "nog
-- geen teller": dan wordt het volgende nummer weer 1 terwijl de rij blijft
-- bestaan, en dat leest anders bij het instellen van een eerste nummer.
delete from public.factuur_tellers where jaar = 2026;

-- Het opgeslagen papier blijft hier staan: Supabase laat niet toe dat je
-- rechtstreeks uit `storage.objects` verwijdert, en de app mag het ook niet
-- (er is met opzet geen verwijderregel op de bak `facturen` -- een verstuurde
-- factuur is een stuk administratie dat je hoort te bewaren). Dat ene bestand
-- moet met de hand weg via het Supabase-dashboard:
--   Storage → facturen → <bedrijf>/2026/2026-0001.pdf
