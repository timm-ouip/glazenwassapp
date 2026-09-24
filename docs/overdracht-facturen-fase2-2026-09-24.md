# Overdracht: de facturen, na fase 1

Geschreven op 24-09-2026, aan het eind van de dag waarop fase 1 is afgemaakt.
Dit document vertelt waar het staat en waarmee fase 2 begint. De twee
voorgangers blijven staan en zijn nog steeds het lezen waard:

- `overdracht-facturen-2026-09-23.md` — waarom het systeem is zoals het is,
  en welke keuzes er met Timmie zijn doorgesproken.
- `test-facturen-2026-09-24.md` — de eerste echte test, alles wat daaruit
  kwam, en de vier punten plus de vangnetten die daarna zijn gebouwd.

Het goedgekeurde plan staat in
`~/.claude/plans/oke-big-new-system-cozy-newt.md`.

---

## Fase 1 is af

Alle zeven punten van de fase-1-lijst staan erin:

| # | wat | waar |
|---|---|---|
| 1 | Contant/overmaken op de startpagina | `home.tsx`, gedeeld rekenwerk in `lib/geldfilter.ts` |
| 2 | Btw onder het omzetgetal | `dashboard.tsx`, `btwIn`/`fetchBtwProcent` in `lib/facturen.ts` |
| 3 | Extra opdrachten bij "Dag klaar" | `components/DagKlaar.tsx` |
| 4 | De verstuurde factuur in het klantdossier | `functions/facturen/index.ts` + `kopieInVerzonden` in `_gedeeld/verzenden.ts` |
| 5 | De vangnetten | migraties `…109000` en `…110000`, `components/betalingen/Vangnet.tsx` |
| 6 | Maandconcepten vanzelf, en de por | migratie `…111000`, `porNodig` in `lib/facturen.ts` |
| 7 | Btw-kwartaaloverzicht | `dashboard.tsx`, paneel "Btw per kwartaal" |

En het losse eind uit de eerste sessie: een weggegooide of achteraf geprijsde
klus houdt zijn factuurregel niet meer (migratie `…112000`).

### Wat de nacht van de 1e doet

`cron.schedule('facturen-maandconcepten', '0 2 1 * *', …)` roept
`facturen_maandconcepten()` aan. Die loopt over elk bedrijf met
`factuur_start_op` gevuld en bundelt de losse regels tot concepten, met een
`exception` per bedrijf zodat er niet één de rest meeneemt. **Versturen blijft
met de hand** — daar hangt een mail met een bedrag aan.

Gaat het klaarzetten voor een bedrijf mis, dan staat dat alleen als
waarschuwing in het logboek van de server. Dat is bewust genoeg: de losse
regels blijven dan gewoon staan, en die laat het gele vakje in de facturentab
al zien ("N te factureren regels staan nog los") met de knop ernaast. Er gaat
dus niets stil verloren.

Staan die concepten na de 5e nog te wachten, dan zegt de app er wat van:
een geel vak in de facturentab met een knop "Allemaal kiezen", en de tegel
"Facturen" op Overzicht leest dan "concept wacht al · versturen". Eén regel
bepaalt dat: `porNodig()` in `lib/facturen.ts`.

### Waar de regel nu de klus volgt

`klus_factuurregel_bijwerken(klus)` is de enige plek die bepaalt of een klus
een losse factuurregel hoort te hebben en met welk bedrag. Drie triggers komen
daar langs: `klussen` (vinkje, prullenbak, omschrijving, adres),
`klus_prijzen` en `wasdag_prijzen`. Overal dezelfde grens: **een regel op een
genummerde factuur en een regel met `vervangen_op` blijven met rust** — dat
papier ligt bij de klant, rechtzetten gaat met een creditfactuur.

---

## Wat er bewezen is, en wat niet

**Wel echt gelopen.** Eén complete factuur (2026-0001) is op 24-09 gemaakt,
verstuurd met PDF, betaald gemeld en gecrediteerd. Daarna is de hele uitweg na
crediteren doorgeklikt, inclusief het lijstje panden voor de aangepaste
factuur. De vangnetten, de maandconcepten, de por, het btw-kwartaal en de
klus-triggers zijn alle vier in de app of op de database aangeklikt (zie de
testparagrafen in `test-facturen-2026-09-24.md`).

**Niet gelopen, en waarom.**

1. **Versturen is na 24-09 09:00 niet meer echt gedaan.** `factuur_verstuurd`
   is daarna aangepast (een creditnota staat bij het versturen meteen
   verwerkt) en er is een kopie in Verzonden bij gekomen. Dat kan pas echt na
   het volgende punt.
2. **De app logt je uit zodra je op "Versturen" drukt.** Reproduceerbaar. Het
   struikelt op de authenticatie vóór de verstuurfunctie: de factuur krijgt
   niet eens een nummer. Daar loopt een aparte opdracht voor; er staat een
   tijdelijk meekijk-haakje in `src/integrations/supabase/fout-melder.ts` dat
   weg mag zodra de oorzaak bekend is.
3. **Een regel op een genummerde factuur blijft met rust** — dat staat zo in
   de code en is gelezen, maar niet aangeklikt: daar hoort een echt
   factuurnummer bij, en dat zou een gat in de reeks achterlaten.
4. **De pg_cron-taak zelf.** De functie erachter is aangeklikt; dát de taak om
   twee uur 's nachts op de 1e afgaat, is niet af te wachten. Kijk de eerste
   keer mee: `select * from cron.job_run_details where jobname =
   'facturen-maandconcepten'`.
5. **De printknop** bij de vangnetlijst opent het printvenster van de Mac.
6. **Een bedrag dat met de hand gekozen is** (`factuurregels.bedrag_met_de_hand`,
   gezet door `factuur_opnieuw` na een creditnota) blijft staan als de prijs
   van de klus daarna verandert. Nagedaan door de vlag zelf te zetten; de weg
   ernaartoe — crediteren en opnieuw factureren — vraagt een echt
   factuurnummer en is dus niet doorlopen.

### Nog uit te rollen

De edge function `facturen` is op de server nog de versie van vanmorgen. Er
zijn sindsdien twee dingen bij gekomen: de kopie in Verzonden (en daarmee in
het klantdossier) en het euroteken. Die staan wel in de repo, maar nog niet
live:

```bash
bunx supabase functions deploy facturen
```

Bewust nog niet gedaan: versturen kan toch niet zolang het uitloggen speelt,
en de eerste echte verzending is meteen de proef op deze twee wijzigingen.
Rol hem dus uit zodra het inloggen weer werkt, en stuur dan één factuur.

---

## Zo test je veilig naast Timmie

Timmie werkt tegelijk in dezelfde app en dezelfde database. Wat hier goed
ging:

- **Het factureren staat uit** (`companies.factuur_start_op` leeg). Zet hem
  aan voor de proef, doe je ding, en zet hem meteen terug. Zolang hij uit
  staat ontstaat er geen enkele factuurregel.
- **Nooit op "Versturen" drukken voor een proef.** Dat trekt een echt
  factuurnummer uit `factuur_tellers`, en een genummerde factuur is niet meer
  weg te gooien (de RLS staat alleen het weggooien van een concept toe). Dan
  mist er een nummer in de reeks, en dat moet je aan de Belastingdienst
  uitleggen.
- **Een concept mag wel.** `facturen_klaarzetten` geeft een factuur zonder
  nummer; die kun je gewoon weer weggooien.
- **De database benaderen vanuit het browservenster** kan zonder sleutels:
  `const m = await import('/src/integrations/supabase/client.ts')` geeft je in
  de dev-server dezelfde `supabase`-client als de app, mét de sessie. Handig om
  een nieuwe databasefunctie echt aan te roepen — en dat moet, want
  `supabase db push` zegt "Finished" over een functie die bij de eerste aanroep
  klapt.
- **Opruimen na afloop**: klus weg, concept weg, `factuur_start_op` leeg.
  Controleer dat `factuur_tellers` leeg blijft.

Er staat met opzet één ding klaar in de app: een extra opdracht **TEST
dakrand (Claude), € 30, bij Markgraaf A 138**, nog zonder dag. Sleep hem op een
dag die nog niet afgemeld is om het lijstje extra opdrachten in "Dag klaar" te
zien.

---

## Fase 2: vormgeving en briefpapier

### Wat er klaarligt

- `~/Documents/Documents - Mac/Ramensopperij/Ramensopperij Logos/` — Logo v5
  als `Logo v5.ai`, plus PNG's: `Logo v5 Alpha.png`, `Logo v5 Black.png`,
  `Logo v5 White.png`, `Logo v5 White Alpha.png`.
- `~/Downloads/Factuur Papier.pdf` — het huidige briefpapier. A4
  (595,44 × 842,16 pt), twee afbeeldingen, letters PP Charlevoix Bold en
  Poppins Bold/Light.

### Waar het in de code landt

`supabase/functions/_gedeeld/factuurpdf.ts` (271 regels) tekent de factuur
zelf met pdf-lib — bewust geen omzetdienst van buiten. De indeling houdt links
en boven al ruimte vrij voor een achterlaag, dus het briefpapier kan er als
achtergrond onder.

Twee dingen om te weten:

- **Het euroteken werkt.** Dat stond hier als open vraag; het is nu
  uitgeprobeerd met een losse proef-PDF. pdf-lib zet zijn standaardletters
  neer met `/WinAnsiEncoding`, en daar zit de € in als byte `0x80`. `euro()`
  schrijft nu `€ 30,00` in plaats van `EUR 30,00`, op papier én in de mail.
- **Eigen letters kosten wél werk.** PP Charlevoix en Poppins zijn geen
  standaardletters van pdf-lib; die moeten als bestand mee (`embedFont` met
  `fontkit`). Dat maakt de edge function zwaarder en de PDF groter. Weeg af of
  het briefpapier als achterlaag niet al genoeg is.

### Waar te beginnen

1. Het briefpapier als PDF-pagina onder de factuur leggen
   (`PDFDocument.load` + `embedPage` + `drawPage`), niet als afbeelding: dan
   blijft de tekst scherp en het bestand klein.
2. Een plek waar Timmie zijn briefpapier zelf kan uploaden (er is al een
   opslagbak `facturen`; een bak `merk` of een kolom op `companies` ligt voor
   de hand).
3. Pas daarna de letters, als het dan nog nodig is.

### Daarna

- **Fase 3: Mollie.** De betaallink is in de code al voorzien
  (`facturen.mollie_link`, de knop "Direct betalen" in de mail en de regel op
  de PDF). Via de **Payment Links API**, want die verloopt niet.
- **Fase 4: herinneringen.** Een factuur die over de vervaldatum gaat, staat
  al op "Te laat" in de lijst; er gaat alleen nog niets vanzelf de deur uit.

---

## Vallen waar anderen al in gelopen zijn

- **Draai deno nooit vanuit de hoofdmap met `--node-modules-dir=auto`.** Dat
  heeft op 23-09 de hele `node_modules` overgenomen (113 pakketten werden
  snelkoppelingen naar een `.deno`-map van 458 MB) waarna Vite `react` niet
  meer kon laden. Zet een deno-script in de scratchpad en geef het een eigen
  `DENO_DIR`; dan blijft alles heel. Typechecken van een edge function:
  `DENO_DIR=<scratchpad>/deno bunx deno check --no-config --node-modules-dir=none supabase/functions/<naam>/index.ts`.
  `_gedeeld/geheim.ts` en `_gedeeld/smtp.ts` geven al langer vier fouten die
  niet van jouw wijziging komen.
- **Gebruik altijd `./scripts/types.sh`** voor `types.ts`, nooit
  `supabase gen types` los: de generator is strenger dan hoe de app geschreven
  is, en het script zet drie dingen terug.
- **`KLANT_VELDEN` moet één letterlijke tekst blijven**, anders leidt
  supabase-js het rijtype niet meer af.
- **De migratienummers lopen vooruit op de kalender.** De laatste is
  `20261012112000`; nieuwe migraties moeten daarna sorteren.
- **Een samengestelde foreign key met `on delete set null`** maakt élke kolom
  leeg, ook `company_id` (die niet leeg mag). Daarom is
  `factuurregels_factuur_fk` enkelvoudig.
- **Een `security definer`-functie gaat langs de RLS heen.** Filter dan zelf
  op `company_id` én op het recht (`heeft_recht`, `is_eigenaar`), en geef de
  joins met `adres_prijzen` en `klanten` ook een `company_id` mee.
