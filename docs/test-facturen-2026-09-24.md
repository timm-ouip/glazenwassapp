# Test: de facturenketen, voor het eerst helemaal doorlopen

24-09-2026. Vervolg op `overdracht-facturen-2026-09-23.md`, waarin stond dat er
**niets** van de keten in de praktijk was uitgeprobeerd. Dat is nu wel gebeurd:
er is één echte factuur gemaakt, verstuurd, betaald gemeld en gecrediteerd.

Het factureren staat aan het eind van deze test **weer uit** (`factuur_start_op`
is leeg), zodat er niet ongemerkt facturen ontstaan.

## Wat de test was

In De Ramensopperij:

- startdatum `01-09-2026` bij Instellingen → Bedrijf, btw 21%, termijn 14 dagen;
- klant **Timmert** (Fultonstraat 75) op *bedrijf* gezet, bedrijfsnaam
  "Timmert Testbedrijf BV", e-mail `meneertimmie@hotmail.com` (Timmies eigen
  postvak, met opzet geen klantadres);
- dat adres op *overmaken*, prijs € 15;
- vandaag als wasdag gepland met alleen dat adres, en helemaal afgemeld.

De dag van 23-09 is niet aangeraakt.

## Wat werkt (gezien, niet aangenomen)

| stap | uitkomst |
|---|---|
| Startdatum leeg | er ontstaat niets — dat is de aan/uit-knop, en die werkt beide kanten op |
| Klant op *bedrijf* | de blokken "Zakelijke gegevens" en "Facturen" komen erbij, met de melding "Bedragen exclusief btw, met btw eronder" |
| Dag afmelden | één factuurregel: € 15 excl, € 3,15 btw, € 18,15 incl, omschrijving "Glazenwassen Fultonstraat 75", nog zonder nummer |
| Dag heropenen | de regel gaat mee terug én het lege concept wordt opgeruimd; beide tabellen weer leeg |
| Opnieuw afmelden | de regel komt terug |
| Concepten klaarzetten | één concept per klant, zonder nummer, zonder datum, zonder bevroren gegevens |
| Versturen | nummer **2026-0001**, factuurdatum 24-09 (de dag van de beurt), vervaldatum 08-10, PDF gemaakt én opgeslagen in de bak, Brevo heeft de mail aangenomen, klantgegevens bevroren, teller op 1 |
| De PDF | klopt: afzender, "AAN", nummer/datum/vervaldatum, de regel met 21%, subtotaal/btw/te betalen, "Graag betalen vóór", IBAN twee keer (regel + voettekst), KvK en btw-nummer |
| Betaald afvinken | status *betaald*, bedrag € 18,15, datum vandaag; "nog niet binnen" gaat naar € 0 |
| Crediteren | creditconcept met negatieve regels (−€ 15 / −€ 3,15 / −€ 18,15), de oude factuur op *gecrediteerd* |
| Dag heropenen ná versturen | terecht geweigerd, met een nette melding in beeld |

De btw-kant klopt dus van de afmelding tot op het papier: een bedrijf krijgt
exclusief met de btw eronder.

## Wat er niet goed is

### 1. "Crediteer die eerst" is een doodlopende weg (middel)

Heropen je een dag waarvoor een factuur is verstuurd, dan zegt de app:
*"Voor 1 adres(sen) van deze dag is al een factuur verstuurd. Crediteer die
eerst."* Maar na het crediteren blijft het geweigerd: de controle in
`factuurregels_terug` kijkt alleen of er een nummer op de factuur staat, niet
of hij inmiddels gecrediteerd is. De melding wijst een uitweg die er niet is.
Zelf getest: gecrediteerd, en nog steeds geweigerd.

### 2. Een betaalde factuur kun je niet crediteren (middel)

In `FacturenLijst.tsx` verschijnen "Betaald" en "Crediteren" alleen bij
`status === "verstuurd"`. Vink je betaald af, dan is crediteren weg. De
database staat het wél toe (`factuur_crediteren` weigert alleen een concept en
een al gecrediteerde factuur) — en terugbetalen ná ontvangst is juist het
gewone geval. Nu moet je in de database duiken om eruit te komen.

### 3. Bij een bedrijf staat het verkeerde bedrag vooraan (middel)

In de lijst is het dikke getal € 18,15 (inclusief) met "Excl. btw € 15"
eronder. Voor een bedrijf/VvE is dat omgekeerd aan de afspraak. De PDF doet
het goed; alleen het scherm niet.

### 4. "Met rust" zit nergens (klein)

`factuurMetRust` staat in `src/lib/facturen.ts` en er zijn twee migraties voor
(`20261012093000`, `20261012094000`), maar geen enkel component gebruikt het.
Er is dus geen knop om een factuur even met rust te laten.

### 5. Taal (klein)

- "1 te factureren regel **staan** nog los" → *staat*.
- "1 regel(s)" en "adres(sen)" — enkelvoud/meervoud netjes maken.

### 6. De facturentab opent op een lege lijst (klein)

De tab begint op *Concepten*. Is die leeg, dan lees je "Zodra een dag helemaal
is afgemeld, komen ze hier vanzelf te staan" — terwijl de dag wél afgemeld is
en je zelf op "Concepten klaarzetten" moet drukken. Na het versturen staat de
tab weer op Concepten en lijkt de factuur verdwenen; hij staat onder
*Verstuurd*.

### 7. Zonder IBAN gaat er een factuur uit waar niemand op kan betalen (klein)

De IBAN stond leeg. De factuur ging er gewoon uit, alleen zonder
rekeningnummer — op het papier én in de mail. De code drukt de IBAN wel af
zodra hij er staat (inmiddels ingevuld). Hier hoort een waarschuwing bij het
aanzetten van het factureren.

## Twee dingen om te weten voordat het echt aan gaat

1. **De teller staat op 1.** `2026-0001` is deze testfactuur. Gaat het zo aan,
   dan is de eerste echte factuur `2026-0002` en mist `2026-0001` in de reeks.
   Voor de Belastingdienst wil je daar geen gat. Opruimen vóór de start:
   de testfactuur en het creditconcept weg, de PDF uit de bak, en de rij van
   dat jaar in `factuur_tellers` **wissen** (niet op 0 zetten: dan wordt het
   weer 1, en dat is niet hetzelfde als "nog geen teller"). Inmiddels gedaan,
   en er is nu ook een instelling voor het eerste nummer — zie onderaan.
2. **Eén adres staat op "overmaken"** in De Ramensopperij (Fultonstraat 75, van
   deze test). Al het andere staat op contant en maakt dus geen factuurregel.

## Nog open uit de vorige sessie (ongewijzigd)

- Een adres op "overmaken" **zonder klant** wordt stilzwijgend nooit
  gefactureerd (de `join` op `klanten`); hetzelfde bij prijs 0. In het hele
  systeem staat er nu één zo'n adres (bij Wassersapp beta).
- Een weggegooide of achteraf geprijsde klus houdt zijn factuurregel.
- De rest van de fase-1-lijst in `overdracht-facturen-2026-09-23.md`:
  knoppen op `home.tsx`, "waarvan btw" op het dashboard, `DagKlaar.tsx`,
  kopie in het klantdossier, de vangnetten, maandconcepten via `pg_cron`,
  btw-kwartaaloverzicht.

## Val: `deno check` sloopt de node_modules

De `deno check --node-modules-dir=auto` uit de vorige sessie had niet alleen
een `deno.lock` achtergelaten, maar **113 pakketten in `node_modules`
vervangen door snelkoppelingen naar een `.deno`-map van 458 MB**. Daardoor kon
Vite `react` en `use-sync-external-store` niet meer laden en bleef de app op
elke poort op "Laden…" hangen. Hersteld met `bun install --force`; alleen de
zeven pakketten die puur bij de edge functions horen (`pdf-lib`, `imapflow`,
`postal-mime`, `nodemailer`, `@anthropic-ai/sdk`) lopen nog via `.deno`.

Draai deno daarom **nooit** vanuit de hoofdmap met `--node-modules-dir=auto`.
Wat hier wel goed ging: het script in een eigen map zetten en deno starten met
een eigen `DENO_DIR`; dan blijft `node_modules` ongemoeid (nagekeken).

## Voor fase 2 staat het materiaal klaar

Timmie heeft aangeleverd:

- `~/Documents/Documents - Mac/Ramensopperij/Ramensopperij Logos/` — Logo v5 in
  alpha, zwart en wit als PNG, plus het `.ai`-bestand.
- `~/Downloads/Factuur Papier.pdf` — het huidige briefpapier. A4
  (595,44 × 842,16 pt), twee afbeeldingen, letters PP Charlevoix Bold en
  Poppins Bold/Light.

`factuurpdf.ts` houdt links en boven al ruimte vrij voor een achterlaag, dus
dat briefpapier kan er als achtergrond onder. Meenemen in fase 2, samen met
`EUR 30,00` → `€ 30,00` (het euroteken in de standaardletters van pdf-lib is
nog niet getest).

---

# Wat er dezelfde dag op is gelost

Na de test meteen doorgepakt. De testfactuur, het creditconcept, de PDF in de
bak en de teller zijn opgeruimd, en het factureren staat uit
(`factuur_start_op` leeg). De IBAN van Timmie staat er nu wel in.

## Nieuw: een eigen eerste factuurnummer

Migratie `20261012097000_factuurnummer_en_crediteren.sql` zet twee kolommen op
`companies`: `factuur_eerste_nummer` en `factuur_eerste_nummer_jaar`. In
Instellingen → Bedrijf staat er een veld **Eerste factuurnummer**.

Waarvoor: stap je over van een ander pakket, dan moet de nummering dóórlopen.
Stond daar `2026-0249` als laatste, dan vul je 250 in.

Het jaar wordt afgeleid van de startdatum (staat die er niet, dan het huidige
jaar) en alleen bewaard als het nummer groter dan 1 is. Daardoor geldt het
startnummer voor precies één jaar en begint januari vanzelf weer bij 1, zonder
dat iemand eraan hoeft te denken. Nagemeten op de database: 2027 gaf 250, toen
251, en 2028 gaf 1.

## De zeven vondsten

| # | wat | hoe opgelost |
|---|---|---|
| 1 | "Crediteer die eerst" liep dood | `factuurregels_terug` blokkeert nu alleen op een factuur die nog niet gecrediteerd is, en gooit alleen regels weg die op geen genummerde factuur staan. `factuurregels_maken` negeert regels op een gecrediteerde factuur, zodat opnieuw gedaan werk opnieuw gefactureerd kan worden |
| 2 | betaalde factuur niet te crediteren | de knop "Crediteren" hangt niet meer aan status *verstuurd*, maar aan "heeft een nummer, is geen creditfactuur en is nog niet gecrediteerd" — net als de database het al zag |
| 3 | verkeerde bedrag vooraan bij een bedrijf | nieuwe helper `exclusiefVoorop` in `facturen.ts`, één plek voor de regel. Een bedrijf ziet nu € 15 groot met "Btw € 3,15 · te betalen € 18,15" eronder; een particulier het bedrag dat hij overmaakt |
| 4 | "met rust" zat nergens | knop "Even met rust" / "Weer oppakken" bij een verstuurde factuur, twee weken, en nog een keer drukken haalt het weer weg |
| 5 | taal | "1 te factureren regel **staat** nog los", "1 regel" i.p.v. "1 regel(s)", en "1 adres" in de foutmelding bij het heropenen. Ook "concept(en)" en "factuur(en)" in de meldingen |
| 6 | lege facturenlijst was misleidend | de tekst hangt nu af van wat er aan de hand is: staan er regels klaar, dan wijst hij naar de knop; is er wel iets verstuurd, dan naar dat tabblad |
| 7 | geen IBAN, geen waarschuwing | geel vakje in Instellingen zodra er een startdatum staat maar geen IBAN |

Meegenomen omdat het bij hetzelfde principe hoort: `facturen_lijst` leest naam,
klanttype en e-mailadres van een verstuurde factuur nu uit de bevroren
`klantgegevens`. Zet je een klant later van particulier naar bedrijf, dan gaat
een oude factuur daar niet anders van lezen.

## Wat er van gecontroleerd is in de app

Aangeklikt en gezien: het nieuwe veld slaat op (250 → jaar 2027), de
nummertrekking begint op 250 en valt in 2028 terug naar 1, "1 regel staat nog
los", de nieuwe lege-lijst-tekst, en een bedrijfsconcept dat € 15 groot toont
met de btw eronder.

Alleen gelezen, niet aangeklikt (dat kost een tweede echte mail en een tweede
factuurnummer): de knop "Crediteren" bij een betaalde factuur, en "Even met
rust". Waard om na te doen bij de volgende echte proefverzending.

`bunx tsc --noEmit` en `bun run build` zijn schoon. `bun run lint` geeft 3468
meldingen, maar die zitten in `.claude/worktrees/` (kopieën van andere chats)
en in bestanden die niet zijn aangeraakt; de gewijzigde bestanden zijn schoon.
Overweeg `.claude/worktrees` uit te sluiten in de eslint-config, anders is
`bun run lint` niet meer te gebruiken.

## De code-review daarop, en wat die ving

De subagent `code-reviewer` keek de wijziging na en vond vijf punten. Eén was
ernstiger dan wat het moest oplossen, dus die is het vermelden waard:

**Mijn eerste poging bij punt 1 was fout.** Ik liet `factuurregels_maken`
regels op een gecrediteerde factuur negeren. Maar op `factuurregels` ligt een
unieke index op `wasdag_regel_id`, dus de nieuwe regel botste met de oude en
"Dag klaar" zou eruit klappen met een databasefout — de dag was dan helemaal
niet meer af te melden, erger dan het slot dat er eerst zat. Nagetest en
bevestigd: `duplicate key value violates unique constraint
factuurregels_wasbeurt_uniek`.

Nu andersom opgelost, en eenvoudiger: bij het crediteren laat de oude regel
zijn verwijzing naar de beurt los (`wasdag_regel_id` en `klus_id` op leeg). De
factuur houdt zijn regels en bedragen — dat papier heeft de klant — maar de
beurt is weer vrij om opnieuw gefactureerd te worden. Daardoor kon de
ontdubbeling terug naar de eenvoudige vorm.

De andere vier: het lege concept werd niet meer opgeruimd (stond in de vorige
review-migratie en was bij het herschrijven uitgevallen); het startnummer
werkte alleen als er nog géén teller voor dat jaar stond, wat precies na een
testfactuur niet zo is (nu `greatest(laatste + 1, startnummer)`, zodat een
startnummer de reeks vooruit kan zetten maar nooit terug); de knop
"Crediteren" verscheen ook bij een factuur die alleen vastgezet was en nooit
verstuurd; en de rustdatum werd in UTC berekend, wat tussen middernacht en
02:00 een dag te vroeg uitkomt (nu `datumSleutel`, dat er al in de code stond
mét die waarschuwing erboven).

Uit dezelfde gedachtegang kwam nog iets: een factuur die vastgezet was maar
waarvan het mailen mislukte, was niet opnieuw te versturen — het vinkje
verdween zodra er een nummer op stond, terwijl de edge function er juist op
gebouwd is om het opnieuw te proberen met hetzelfde nummer. Dat vinkje hangt
nu aan "is een concept", niet aan "heeft nog geen nummer".

### En wat het natesten daarna zelf nog ving

Bij het doorlopen van de nieuwe uitweg bleek dat het heropenen van een dag de
**creditnota weggooide**. De regels van een creditnota zijn een kopie van de
originele regels, dus met dezelfde datum en `soort = 'wasbeurt'`, en
`factuurregels_terug` ruimde alles van die dag op wat nog geen nummer had. Je
hield dan een verstuurde factuur met de stand "gecrediteerd" over, zonder
creditnota om dat mee aan te tonen. Migratie `20261012099000` voegt daarom
`and f.soort <> 'credit'` toe: een creditnota ontstaat door het crediteren,
niet door het afmelden, en hoort dus niet bij het werk van die dag.

### Hoe de hele uitweg nu loopt (aangeklikt, niet aangenomen)

1. Factuur staat op *verstuurd* → betaald afvinken → **Crediteren staat er nu
   ook bij een betaalde factuur** (dat was punt 2 van de test).
2. Crediteren → de oude factuur op *gecrediteerd*, een creditconcept met
   −€ 15 / −€ 3,15 / −€ 18,15, en de link naar de beurt losgelaten.
3. Dag heropenen → *"Weer opengezet: je kunt deze dag opnieuw afmelden."* De
   gecrediteerde factuur houdt zijn regel, de creditnota blijft staan, en
   alleen de losse dagregel gaat mee terug.
4. Dag klaar → *"Dag afgemeld: 1 gedaan"*, geen fout, en er staat een verse
   factuurregel klaar om opnieuw te factureren.

Voor deze test is de verstuurde factuur nagebouwd in de database (nummer
2026-9001 en 2026-9002) in plaats van echt gemaild: de mailkant was al bewezen
met 2026-0001, en zo kostte het geen tweede mail en geen echt factuurnummer.
Het crediteren, heropenen en afmelden zijn wél door de app zelf gedaan.

Alles is daarna opgeruimd: geen facturen, geen regels, geen tellers, niets in
de opslagbak, en `factuur_start_op` leeg. `bunx tsc --noEmit`, `bunx eslint` op
de gewijzigde bestanden en `bun run build` zijn schoon.

---

# Na crediteren: het lijstje panden

Idee van Timmie, en beter dan wat er eerst lag. Je crediteert omdat de factuur
te hoog was: een deel van het werk is niet gedaan, of een huis is vergeten.
Daarna hoort er een aangepaste factuur uit te gaan.

Bij een gecrediteerde factuur staat nu een lijstje van de panden die erop
stonden. Alles staat standaard aangevinkt — meestal is er maar één pand mis —
en je vinkt uit wat er níet op moet. Per pand kun je het bedrag aanpassen,
want soms is maar de helft van een pand gedaan. Eén knop zet het aangevinkte
werk terug op de lijst, waar je er met "Concepten klaarzetten" een aangepaste
factuur van maakt.

## Waarom `vervangen_op` erbij kwam

Mijn eerste oplossing maakte bij het crediteren de verwijzing naar de beurt
leeg (`wasdag_regel_id`, `klus_id`). Dat werkte om het vastlopen op te heffen,
maar het gooide ook weg *welke* beurt het was — en dat is precies wat dit
lijstje nodig heeft.

Nu krijgt de regel een stempel `vervangen_op`. De verwijzing blijft staan, de
twee ontdubbelindexen kijken langs vervangen regels, en `factuurregels_maken`
en de klus-trigger doen dat ook. Zo kan er wél een nieuwe regel voor dezelfde
beurt komen, maar nooit twee levende — dubbele facturatie blijft onmogelijk.

## Wat er van getest is in de app

- Een gecrediteerde maandfactuur met twee panden (Fultonstraat 75 en 77): 77
  uitgevinkt, en alleen 75 kwam terug als los werk. De gecrediteerde factuur
  hield zijn twee regels en zijn bedrag.
- Daarna "Concepten klaarzetten": de aangepaste factuur stond klaar naast de
  creditnota.
- Bedrag aangepast van € 15 naar € 7,50: de nieuwe regel werd € 7,50 excl met
  € 1,58 btw (€ 9,08), terwijl de gecrediteerde factuur op € 15 / € 18,15
  bleef staan. De btw wordt met het tarief van de oorspronkelijke regel
  gerekend, niet met dat van vandaag.
- Op databaseniveau: de vervangen regel houdt zijn `wasdag_regel_id`, een
  nieuwe regel voor dezelfde beurt mag erbij, en twee levende regels voor
  dezelfde beurt wordt nog steeds geweigerd.

# Wat er níet getest is, en waarom

**Het versturen is na de laatste wijziging niet meer echt gelopen.** Factuur
2026-0001 is vanmorgen wél echt verstuurd, met PDF, dus de keten is bewezen.
Maar daarna is `factuur_verstuurd` aangepast (een creditnota staat bij het
versturen meteen verwerkt), en die wijziging is alleen op de kolommen
nagemeten, niet door een echte verzending.

De reden: **de app logt je uit zodra je op "Versturen" drukt.** Reproduceerbaar,
ook binnen een minuut na opnieuw inloggen. Dat is geen factuurprobleem — de
factuur krijgt geen nummer, en het nummer trekken is de eerste stap ín de
verstuurfunctie, dus die komt niet eens op gang. Het struikelt op de
authenticatie ervóór. Daar loopt een aparte opdracht voor.

Zodra dat verholpen is: één concept versturen, dan crediteren, dan de
creditnota versturen, en controleren dat die twee samen verwerkt op de lijst
staan (de creditnota hoort meteen op "betaald" te komen en nooit in "Te laat").

Ook nog niet aangeklikt, wel getypecheckt: de vraag "nog een keer versturen?"
bij een factuur die al vastgezet was.

## De derde review, en een fout die alleen bij het aanroepen bleek

De reviewer vond vijf punten op het lijstje panden. Drie waren hinderlijk in
het gebruik, twee waren ontbrekende sloten.

**Vinkjes en bedragen sprongen stil terug.** Het vullen van de vinkjes en de
bedragen hing aan de opgehaalde regels, en die worden opnieuw opgehaald zodra
je terugkomt in het tabblad. Je vinkte een pand uit, zette een bedrag op 7,50,
keek even in je mail, kwam terug — en alles stond weer aan met de oude
bedragen, zonder dat je dat op het scherm zag. Drukte je dan op de knop, dan
factureerde je het volle bedrag. Nu wordt er één keer per factuur gevuld.
Nagetest: bedrag op 9,25 gezet, naar een ander tabblad en terug, en het stond
nog op 9,25.

**Een leeg bedrag betekende stil "het oude bedrag".** Leeg werd 0, en 0 las de
database als "laat het oorspronkelijke bedrag staan". Nu blokkeert de knop en
staat er "Vul bij elk aangevinkt pand een bedrag in."

**Twee keer klikken was niet afgeschermd.** De knop gaat nu op "Bezig…" en de
database ontdubbelt de lijst. Nagetest: een tweede keer drukken geeft "Dit
werk stond al klaar om opnieuw gefactureerd te worden" en er komt geen tweede
regel bij.

De twee sloten: een creditnota is nu ook in de database niet te crediteren (dat
stond alleen in het scherm), en het opnieuw aanmelden slaat een adres of klant
over die in de prullenbak ligt — net als bij het afmelden van een dag.

### En toen ging het alsnog mis

Mijn ontdubbeling gebruikte `with ordinality` samen met een kolomlijst. Postgres
maakt de functie dan wél aan — de body wordt niet zo diep nagekeken — maar bij
het aanroepen kwam er "WITH ORDINALITY cannot be used with a column definition
list" uit. Dat stond letterlijk in het scherm toen ik op de knop drukte.

Dat is precies waarom dit soort werk aangeklikt moet worden en niet alleen
doorgezet: `supabase db push` zei drie keer "Finished" over een functie die bij
de eerste aanroep klapte. Nu via `jsonb_array_elements`, en daarna werkt het:
€ 9,25 werd € 9,25 excl met € 1,94 btw (€ 11,19).
