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

| #   | wat                                       | waar                                                                          |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Contant/overmaken op de startpagina       | `home.tsx`, gedeeld rekenwerk in `lib/geldfilter.ts`                          |
| 2   | Btw onder het omzetgetal                  | `dashboard.tsx`, `btwIn`/`fetchBtwProcent` in `lib/facturen.ts`               |
| 3   | Extra opdrachten bij "Dag klaar"          | `components/DagKlaar.tsx`                                                     |
| 4   | De verstuurde factuur in het klantdossier | `functions/facturen/index.ts` + `kopieInVerzonden` in `_gedeeld/verzenden.ts` |
| 5   | De vangnetten                             | migraties `…109000` en `…110000`, `components/betalingen/Vangnet.tsx`         |
| 6   | Maandconcepten vanzelf, en de por         | migratie `…111000`, `porNodig` in `lib/facturen.ts`                           |
| 7   | Btw-kwartaaloverzicht                     | `dashboard.tsx`, paneel "Btw per kwartaal"                                    |

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

## Fase 2 is af: het briefpapier

Bijgewerkt op 24-09-2026, 's avonds.

### Wat het doet

De factuur-PDF krijgt het eigen briefpapier als **achterlaag**: eerst het
papier, dan de tekst erop. Een PDF wordt met `embedPdf` + `drawPage` geplaatst
en blijft dus scherp; een PNG of JPG wordt over de hele bladzijde uitgerekt.
Het papier komt op **elke** bladzijde terug, ook op blad twee van een lange
maandfactuur, met dezelfde marges en met de kolomkoppen opnieuw erboven.

Het venijn zit in de dubbeling: briefpapier draagt meestal zelf al een logo,
een adres en een KvK-nummer. Zet je dat eronder nog eens neer, dan botst de
tekst op het logo en staat het adres er twee keer. Daarom hoort bij het papier:

| knop                             | wat het doet                                                      |
| -------------------------------- | ----------------------------------------------------------------- |
| Bovenaan / onderaan vrij         | millimeters die de tekst vrijlaat voor het papier                 |
| Naam en adres bovenaan           | onze eigen kop; uit zodra het papier hem al heeft                 |
| KvK, btw-nummer en IBAN onderaan | idem voor de voetregel                                            |
| Kleur                            | kop, lijnen en "Te betalen"; leeg is het zwart-grijs van hiervoor |
| Koptekst / voettekst             | eigen zinnen boven de regels en onderaan                          |

Millimeters en geen punten, met opzet: dit is wat je naast een uitdraai met een
liniaal wilt kunnen nameten.

**Zonder briefpapier verandert er niets.** `STANDAARD_VORMGEVING` in
`factuurpdf.ts` (20 mm boven en onder, eigen kop en voet aan) geeft dezelfde
factuur als vóór fase 2. Nagekeken met een proef naast elkaar.

### Waar het staat

| onderdeel                                     | waar                                                             |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Het tekenen                                   | `supabase/functions/_gedeeld/factuurpdf.ts`, `FactuurVormgeving` |
| Ophalen van het papier + de actie `voorbeeld` | `supabase/functions/facturen/index.ts`                           |
| De knoppen                                    | `src/components/facturen/FactuurVormgeving.tsx`                  |
| Opslaan en uploaden                           | `src/lib/facturen.ts`, onderaan                                  |
| Het tabblad                                   | `src/routes/instellingen.tsx`, tab `facturen`                    |
| Kolommen en beleid                            | migraties `…117000` en `…118000`                                 |

Het briefpapier gaat in de bestaande bak `facturen`, maar in een eigen map:
`<bedrijf>/merk/`. Alleen daar mag de browser schrijven, en alleen de eigenaar.
De verstuurde facturen staan onder `<bedrijf>/<jaar>/` en blijven van de
service role — dat papier ligt bij de klant en hoort van niemand meer te zijn.

### Het voorbeeld is een echte factuur

Het vak rechts in het scherm is geen tekening van een factuur maar een echte
factuur-PDF, gemaakt door dezelfde edge function die ze verstuurt, met
verzonnen gegevens. Dat is de hele reden dat er een actie `voorbeeld` bij is
gekomen in plaats van een nabouwsel in de browser: een nabouwsel gaat op den
duur afwijken van het papier dat de klant krijgt, en dan kijk je naar een
leugen. Er komt **geen nummer** uit `factuur_tellers` aan te pas en er wordt
niets bewaard, dus proeven is hier echt gratis.

Het briefpapier in het voorbeeld komt altijd uit de opslagbak; de schuifjes en
de teksten gaan mee zoals ze op dat moment op het scherm staan, ook als je nog
niet hebt opgeslagen. Uploaden slaat meteen op — anders zou je een bestand
hebben zonder dat de factuur er ooit naar kijkt.

### Wat er voor De Ramensopperij klaarstaat

`~/Downloads/Factuur Papier.pdf` is geüpload en ingesteld: 50 mm vrij bovenaan,
20 mm onderaan, eigen kop en voet uit. Kop- en voettekst zijn leeg gelaten —
dat zijn Timmies woorden, niet de mijne.

### Wat bewust niet gedaan is

- **Eigen letters.** PP Charlevoix en Poppins zijn geen standaardletters van
  pdf-lib; die moeten als bestand mee (`embedFont` met `fontkit`), wat de edge
  function zwaarder en de PDF groter maakt. Met het briefpapier eronder draagt
  de bladzijde het merk al; de tekst in Helvetica valt niet op als vreemd.
  Pak dit pas op als iemand erover begint.
- **Keuze uit 2–3 modellen**, zoals het plan noemt. Met eigen briefpapier
  bepaalt het papier de vorm en zou zo'n keuze vooral verwarren. Eén indeling
  die goed werkt is hier meer waard dan drie die half passen.

### Nog steeds open, en niet door fase 2 geraakt

De app logt je uit zodra je op **Versturen** drukt. De oorzaak is inmiddels
wél bekend gemaakt door de sessie die ernaar keek: het vernieuwen van het
inlogtoken (`/auth/v1/token?grant_type=refresh_token`) antwoordt met
_"Invalid Refresh Token: Refresh Token Not Found"_, waarna supabase-js de
sessie weggooit en `useRequireAuth` je naar `/login` stuurt. Het is dus geen
factuurprobleem — de edge function wordt niet eens bereikt. Het meekijk-haakje
in `src/integrations/supabase/fout-melder.ts` blijft staan tot Timmie het één
keer reproduceert met de console open.

De edge function `facturen` is op 24-09 's avonds **wél uitgerold**: dat moest,
anders bestond de actie `voorbeeld` niet op de server. Daarmee zijn ook de twee
dingen live die er nog op wachtten — de kopie in Verzonden en het euroteken.
Die zijn dus nog steeds niet in een echte verzending bewezen.

## Fase 3 is af: betalen via Mollie

Bijgewerkt op 24-09-2026, later op de avond.

### Wat het doet

Bij het versturen maakt de server een **betaallink** bij Mollie en zet die als
knop in de mail en als regel op de PDF. Betaalt de klant ermee, dan meldt
Mollie dat en vinkt de factuur zichzelf af.

Een **betaallink** (Payment Links API) en geen gewone Mollie-betaling, want een
gewone betaling verloopt na een kwartier -- precies verkeerd voor een factuur
die veertien dagen open staat. Een betaallink verloopt niet.

Alles wat er al was blijft staan: de IBAN en het betaalkenmerk staan gewoon op
de factuur, en met de hand afvinken werkt nog net zo.

### De webhook heeft geen slot, en dat is met opzet

`mollie-webhook` staat open op internet: `verify_jwt = false`, geen gedeeld
geheim. De reden is dat de melding **nooit geloofd wordt**. Mollie zegt alleen
"er is iets gebeurd"; wat er betaald is halen we daarna zelf op met
`GET /v2/payment-links/<id>/payments` en de sleutel van dat bedrijf. Wie de
URL kent kan dus hooguit een extra navraag uitlokken, en die zet de factuur op
precies het bedrag waar hij al op stond.

De factuur staat als `?factuur=<uuid>` in de meldings-URL die we bij het
aanmaken van de link meegeven. Dat moet: de Payment Links API kent geen
`metadata`, dus je kunt een link geen eigen kenmerk meegeven, en de melding
zelf noemt alleen een betaling.

### Het met de hand afgevinkte deel blijft staan

`facturen.mollie_betaald` houdt apart bij wat er via de link binnenkwam. Zonder
dat vak zou een melding van Mollie een bedrag overschrijven dat jij met de hand
had afgevinkt -- of, als we zouden optellen, zou een tweede melding over
dezelfde betaling het bedrag verdubbelen. De functie `factuur_mollie_betaald`
zet daarom altijd het **volledige** bedrag dat bij Mollie binnenstaat, en telt
het handmatige deel daarbij op. Twee meldingen over dezelfde betaling geven zo
hetzelfde resultaat, en een terugstorting zet de factuur weer open.

### Waar het staat

| onderdeel                 | waar                                             |
| ------------------------- | ------------------------------------------------ |
| Praten met Mollie         | `supabase/functions/_gedeeld/mollie.ts`          |
| Koppelen / loskoppelen    | `supabase/functions/mollie/index.ts`             |
| De melding van Mollie     | `supabase/functions/mollie-webhook/index.ts`     |
| De link bij het versturen | `supabase/functions/facturen/index.ts`           |
| De knoppen                | `src/components/facturen/MollieInstellingen.tsx` |
| Kolommen en de functie    | migratie `…119000`                               |

De sleutel gaat versleuteld in `mollie_geheimen` (geen enkele policy, alleen de
service role), met dezelfde `MAIL_SLEUTEL` als de mailbox: zelfde server,
zelfde vertrouwensgrens. Op `companies` staat alleen `mollie_modus` -- `test`
of `live` -- zodat het scherm kan laten zien wát er gekoppeld is zonder de
sleutel te kennen.

### Wat er bewezen is, en wat niet

**Wel gelopen.** Het koppelscherm, de controle op de vorm van de sleutel
("begint met test_ of live_"), en een échte aanroep naar Mollie met een
verzonnen sleutel -- die komt netjes terug als _"Mollie herkent deze sleutel
niet: Invalid Authorization header"_. De weg app → edge function → Mollie →
terug werkt dus, inclusief de Nederlandse melding.

**Niet gelopen, want daar is een echte sleutel voor nodig:** het aanmaken van
een betaallink, de knop in de mail, de melding van Mollie en het afvinken.
Timmie moet in zijn Mollie-dashboard een **testsleutel** maken (Ontwikkelaars →
API-sleutels) en die in Instellingen → Facturen plakken. Daarna kan de hele weg
één keer doorlopen worden met Mollie's testbetaling, zonder dat er geld in
beweging komt.

**Let op bij die eerste proef:** een betaallink ontstaat pas bij _Versturen_,
en daar hangt een echt factuurnummer aan. Zie de waarschuwing hieronder over
proeven zonder factuurnummer -- dit is het ene geval waarin je er niet omheen
kunt, dus doe het bewust en met de testsleutel.

### Nog niet gedaan

- **Fase 4: herinneringen.** Een factuur die over de vervaldatum gaat, staat al
  op "Te laat" in de lijst; er gaat alleen nog niets vanzelf de deur uit.
- **Automatische incasso** blijft uitdrukkelijk buiten beeld, zoals in het plan
  staat.

## Fase 4 is af: herinneringen die vanzelf gaan

Bijgewerkt op 24-09-2026, aan het eind van de avond.

### Wat het doet

Staat een factuur over de vervaldatum, dan gaat er vanzelf een mail achteraan,
in trappen die je zelf instelt. Standaard twee: na 7 dagen vriendelijk, na 21
dagen steviger. Je kunt er trappen bij zetten, ze uitzetten, en de teksten
helemaal herschrijven ({{naam}}, {{nummer}}, {{bedrag}}, {{vervaldatum}} en
{{dagen}} worden ingevuld). Onder elke herinnering komt vanzelf de IBAN, en de
Mollie-knop als die gekoppeld is.

### Vooraf, niet achteraf

Een dag voordat er iets weggaat staat het **geel in de facturenlijst**: "morgen
gaat er vanzelf een herinnering naar N facturen", met _Bekijken_ en per factuur
_Niet doen_. Dat laatste zet de factuur twee weken met rust -- dezelfde termijn
als de knop die al bij elke factuur zat, want één dag overslaan heeft geen zin:
dan staat hij morgen gewoon weer in het vakje.

Dit is het punt van de hele opzet. Een herinnering die je pas ziet als hij al
bij je klant ligt is geen automaat maar een verrassing, en soms weet jij iets
wat de app niet weet -- die klant belde gisteren.

**Het gele vakje en de ronde gebruiken dezelfde databasefunctie**
(`factuur_herinneringen_klaar`), alleen met een andere datum. Zouden dat twee
lijstjes zijn, dan kondig je vroeg of laat iets aan wat niet gebeurt -- of erger,
gaat er iets weg dat je niet hebt zien aankomen.

### Wanneer, en wat er niet meegaat

`cron.schedule('factuur-herinneringen', '30 6 * * *', …)` roept elke ochtend de
edge function `factuur-herinneringen` aan (06:30 UTC, dus half negen in de
zomer). Overgeslagen worden: creditnota's, concepten, betaalde en gecrediteerde
facturen, weggegooide facturen, alles met `met_rust_tot` in de toekomst, en
facturen zonder e-mailadres in de bevroren klantgegevens.

De trap gaat omhoog **vóór** het versturen en wordt teruggedraaid als de mail
mislukt. Andersom klinkt veiliger maar is het niet: ging de mail wél weg en dat
ene laatste stapje niet, dan stond de factuur nog op de oude trap en ging
dezelfde herinnering de volgende ochtend weer weg -- en de ochtend daarna weer.
Eén herinnering missen is vervelend; er elke dag een sturen is erger.

De grens van 200 per ronde telt **per bedrijf**. Zou er één grens over alles
heen liggen, dan kan één bedrijf met een stapel oude facturen -- en helemaal
een bedrijf waar niets weg kán, bijvoorbeeld zonder afzenderadres -- elke
ochtend alle plekken vullen en de rest eeuwig laten wachten.

De ronde zoekt niet "de volgende trap" maar **de eerstvolgende die aanstaat**.
Zet je de eerste herinnering uit, dan schuift alles door naar de tweede in
plaats van stil te vallen.

**De Mollie-knop gaat niet mee in een herinnering zodra er iets op betaald
is.** De betaallink is bij het versturen gemaakt voor het hele bedrag en staat
daar vast; heeft de klant de helft overgemaakt, dan zou de herinnering "nog
€ 50 open" zeggen met een knop die € 100 afschrijft. In dat geval blijven
alleen de IBAN en het betaalkenmerk over, en die staan er toch al onder.

### Waar het staat

| onderdeel                 | waar                                                            |
| ------------------------- | --------------------------------------------------------------- |
| De trappen en de selectie | migratie `…121000`                                              |
| De dagelijkse ronde       | migratie `…122000`, `supabase/functions/factuur-herinneringen/` |
| De knoppen                | `src/components/facturen/Herinneringstrappen.tsx`               |
| Het gele vak              | `src/components/betalingen/FacturenLijst.tsx`                   |

### Wat er bewezen is, en wat niet

**Wel gelopen.** De twee standaardtrappen staan er voor De Ramensopperij, het
scherm laat ze zien, een trap aanpassen en terugzetten werkt, en
`facturen_herinneringen_straks()` geeft netjes een lege lijst. De planner
weigert een verzoek zonder of met een verkeerde `x-cron-sleutel` (401).

**Let op bij de eerste ochtend.** Alle bestaande facturen staan op trap 0, dus
alles wat al over de eerste trap heen is krijgt bij de eerste ronde meteen een
herinnering. Nu is dat niets (er zijn geen facturen), maar kijk als er straks
wel facturen zijn eerst even wat er in het gele vak staat voordat je de nacht
erover laat gaan.

**Niet gelopen.** Het gele vak met echte inhoud, en een herinnering die echt
weggaat. Daar is een verstuurde factuur met een nummer en een verlopen
vervaldatum voor nodig, en dat betekent een echt factuurnummer trekken -- zie
de waarschuwing hieronder. Doe dat pas als er toch een eerste echte factuur
uitgaat. Kijk de eerste ochtend mee met
`select * from cron.job_run_details where jobname = 'factuur-herinneringen'`.

## Vallen waar anderen al in gelopen zijn

- **Draai deno nooit vanuit de hoofdmap met `--node-modules-dir=auto`.** Dat
  heeft op 23-09 de hele `node_modules` overgenomen (113 pakketten werden
  snelkoppelingen naar een `.deno`-map van 458 MB) waarna Vite `react` niet
  meer kon laden. Zet een deno-script in de scratchpad en geef het een eigen
  `DENO_DIR`; dan blijft alles heel. Typechecken van een edge function:
  `DENO_DIR=<scratchpad>/deno bunx deno check --no-config --node-modules-dir=none supabase/functions/<naam>/index.ts`.
  `_gedeeld/geheim.ts` en `_gedeeld/smtp.ts` geven al langer vier fouten die
  niet van jouw wijziging komen.
- **Een `.select()` moet één letterlijke tekst zijn.** Twee stukken met `+`
  aan elkaar geplakt leest supabase-js niet meer, en dan wordt het rijtype
  `GenericStringError`: 57 typefouten over een regel die op zich prima werkt.
  Dezelfde val als bij `KLANT_VELDEN` hieronder, maar dan in een edge function.
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
