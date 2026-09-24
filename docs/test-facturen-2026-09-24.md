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

---

# De vier laatste losse eindjes van fase 1

Later op 24-09. De lijst uit `overdracht-facturen-2026-09-23.md` had zeven
punten; hiervan zijn de eerste vier gedaan.

## 1. Contant en overmaken op de startpagina

De pillen staan in de kop van `home.tsx` en sturen "Omzet per maand". De keuze
zit in `localStorage` van het toestel, dus wie hem hier omzet, ziet het
dashboard net zo staan. "Planning vandaag" blijft ongefilterd: dat vak gaat
naar `/dag`, en daar is geen filter — elk vak laat zien wat er achter zit.

De som erachter (welk adres ligt in welke wijk, en hoe betaalt het) stond in
`dashboard.tsx` en zit nu in `geldfilter.ts` als `adresgeldMap` en
`contantVan`. Home haalt de adressen met inactief erbij, net als het
dashboard, maar pas zodra je echt splitst — bij "Allebei" komt er niets extra
over de lijn.

## 2. "Btw hierover" onder het omzetgetal

Niet *waarvan* btw. Bij een particulier zit de btw in de prijs, bij een
bedrijf of VvE komt hij er juist bovenop; "waarvan" zou dan een bedrag noemen
dat niet in het getal erboven zit. Het klanttype bepaalt welke van de twee het
is, met hetzelfde rekenwerk als `factuur_excl` in de database.

Zonder centen, anders past de regel van een heel jaar niet meer op een
telefoon (nagemeten op 375 px). Het gemiddelde per maand stond op die plek en
is verhuisd naar de grafiek "Omzet per maand".

Wat er níet in meegerekend wordt: een klant kan in de database een eigen
`btw_inclusief` of `btw_procent` hebben. Geen enkel scherm vult die, dus het
dashboard kijkt alleen naar het klanttype en het tarief van het bedrijf. Komt
die nooduitgang ooit in gebruik, dan moeten ze mee in `fetchKlanttypen`.

## 3. Extra opdrachten bij "Dag klaar"

Vink je een extra opdracht niet af, dan telt hij nergens mee en komt er ook
geen factuurregel van — hij is de volgende dag gewoon van die dag af. Daarom
staan de openstaande opdrachten van die dag nu in de afmelddialoog, met een
vinkje, standaard aan.

Ze horen bij de dag en niet bij een team. De vraag komt dus bij het **laatste**
team dat nog niet afgemeld is, gekeken naar álle teams van die dag — wie
alleen zijn eigen team op het scherm heeft, is daarmee nog niet de laatste die
buiten loopt.

## 4. De verstuurde factuur in het klantdossier

Facturen gaan via Brevo, buiten de eigen mailbox om. Daardoor stonden ze
nergens: niet in Verzonden en niet bij de klant. Dat kan ook niet zomaar met
een rij in `berichten`, want `berichten_kanaal_velden_check` eist bij
`kanaal = 'mail'` een `uid` — een mail moet echt op de server staan.

Daarom legt de edge function de mail nu na het versturen zelf in de map
Verzonden (opnieuw opgemaakt, met de PDF eraan), en schrijft hij de rij in
`berichten` met het `klant_id` van de factuur. Dat staartstuk zat al in
`stuurAntwoord` en is eruit getrokken als `kopieInVerzonden`. Eén IMAP-sessie
per stapel van vijftig facturen: niet per factuur opnieuw inloggen, en nooit
meer dan vijftig PDF's tegelijk in het geheugen.

De kopie heeft een eigen Message-ID (Brevo geeft niet terug wat het over de
lijn stuurde). Voor Verzonden is dat geen bezwaar.

## Wat er van gecontroleerd is in de app

Aangeklikt en gezien: de pillen op Home (allebei € 267, contant € 252,
overmaken € 15, ook meteen goed na een verse pagina), "btw hierover € 47"
onder de omzet (€ 252 inclusief + € 15 exclusief = € 46,89), het gemiddelde
bij de grafiek, en dat de afmelddialoog van 23-09 ongewijzigd opent.

**Niet aangeklikt: het lijstje extra opdrachten in die dialoog.** Er staat op
geen enkele dag een openstaande opdracht, en een opdracht op een dag zetten
gaat alleen met slepen — dat lukte niet aan te sturen. Er staat nu wel één
klaar om het mee te doen: *TEST dakrand (Claude)*, € 30, bij Markgraaf A 138,
nog zonder dag. Sleep hem op een dag die nog niet afgemeld is, en hij hoort
onderaan de dialoog te verschijnen.

De kopie in het dossier is ook niet echt gelopen: daar hoort een echte
verzending bij, en die ligt stil op het uitloggen.

`bunx tsc --noEmit`, `bunx eslint` op de gewijzigde bestanden, `bun run build`
en `deno check` op de edge function zijn schoon (deno geeft alleen de vier
bekende fouten in `_gedeeld/geheim.ts` en `_gedeeld/smtp.ts`, die er al
stonden).

## Nog open van fase 1

6. Maandconcepten via `pg_cron` in de nacht van de 1e, en de por als er na de
   5e nog concepten staan.
7. Het btw-kwartaaloverzicht op het dashboard.

En uit de vorige sessie nog steeds: een weggegooide of achteraf geprijsde klus
houdt zijn factuurregel.

---

# De vangnetten (punt 5)

Vier manieren waarop een adres op "overmaken" geen factuur oplevert, en alle
vier gebeuren ze zonder dat je er iets van merkt — er staat dan gewoon geen
factuur, en een getal dat er niet is valt niemand op:

| reden | wat er gebeurt |
|---|---|
| Geen klant aan het adres | `factuurregels_maken` doet een join op `klanten`; de regel ontstaat niet |
| Geen prijs | `wp.prijs > 0` slaat hem over |
| Geen e-mailadres | regel en factuur ontstaan wél, maar het versturen strandt: de factuur blijft als concept liggen |
| Extra opdracht zonder prijs | `klus_factuurregel_bijhouden` slaat hem over |

## Waar het vandaan komt

Migratie `20261012109000_facturen_vangnet.sql` (plus `20261012110000` met wat
de review ving) zet er twee functies neer:

- **`facturen_vangnet()`** — één rij per adres dat het laat afweten, met de
  reden erbij. Staat het factureren uit (`factuur_start_op` leeg), dan komt er
  niets terug: dan valt er ook niets te missen. Ook leeg zonder het recht
  `facturen`.
- **`wijk_overmaken_telling(wijk)`** — hoeveel adressen meegaan als een wijk op
  overmaken gaat, en hoeveel daarvan het laten afweten. Alleen voor de
  eigenaar, want alleen die mag de betaalmethode van een wijk veranderen.

Allebei gebruiken ze **`adres_heeft_prijs(adres)`**: de basisprijs, óf een
meerprijs voor maandwerk die ergens boven nul staat. Een adres dat alleen in
oktober de serre doet, kost dus niet "niets" — dat stond er eerst wel in.

## Waar je het ziet

- **Rood vak boven de facturenlijst** met de telling, en achter "Bekijken" een
  eigen blad met de lijst per reden en een printknop. Om mee de straat in te
  nemen: bij het ene adres haal je een mailadres op, bij het andere een naam.
- **Bij het omzetten van een wijk** komt er eerst een vraag: "2 adressen volgen
  de wijk en gaan dus mee naar overmaken… Bij één daarvan komt er geen factuur
  de deur uit: 1 zonder prijs." Zeg je nee, dan springt de keuze terug.
- **In het klantdossier** een geel briefje zodra een klant nergens een
  e-mailadres heeft — bij de e-mailvelden zelf, dus ook bij een particulier.

## Wat er van getest is in de app

Tijdelijk één adres in Rijswijk op overmaken gezet en het factureren
aangezet:

- de lijst vond **Birkhoven 36** als "geen klant aan het adres", met de
  officiële straatnaam en niet de werknaam ("Zwaanwijck");
- het rode vak, het blad en de teksten klopten;
- de wijkvraag bij Scheveningen las de zin hierboven, en "Annuleren" liet
  alles staan zoals het was;
- het gele briefje verscheen zodra de e-mailvelden leeg waren (in het scherm,
  zonder op te slaan).

Daarna alles teruggezet: `factuur_start_op` weer leeg, het adres volgt weer de
wijk.

Ook nagemeten zonder het factureren aan: `wijk_overmaken_telling` gaf voor
Madestein 507 adressen waarvan 507 zonder klant, voor Rijswijk 152 waarvan 149
zonder klant, en voor Scheveningen 2 waarvan 1 zonder prijs. Dat klopt met
"656 van de 662 adressen nog zonder naam".

**Niet aangeklikt:** de printknop zelf — die opent het printvenster van de Mac,
en dat blokkeert de browser. De knoppen staan op `print:hidden` en `AppLayout`
verbergt de zijbalk en de titelbalk al bij het printen.

---

# Fase 1 helemaal af: punt 6, punt 7 en de losse eindjes

Zelfde dag, later. Hiermee is de fase-1-lijst leeg.

## 6. De maandconcepten zetten zichzelf klaar

`cron.schedule('facturen-maandconcepten', '0 2 1 * *', …)` roept
`facturen_maandconcepten()` aan (migratie `20261012111000`). Die loopt over elk
bedrijf met `factuur_start_op` gevuld. Omdat `current_company_id()` en
`heeft_recht` er 's nachts niet zijn, zit het werk nu in
`facturen_klaarzetten_voor(bedrijf, nu_ook)` en is `facturen_klaarzetten` een
dunne schil met de rechtencontrole eromheen.

**Versturen blijft met de hand.** Klaarzetten is veilig — een concept heeft
geen nummer en gaat nergens heen — maar versturen stuurt een mail met een
bedrag.

### De por

Staat er een concept langer dan vijf dagen klaar, dan zegt de app er wat van:
een geel vak in de facturentab ("Er staan 3 concepten klaar om te versturen;
het oudste al 9 dagen") met een knop "Allemaal kiezen", en de tegel Facturen op
Overzicht leest "concept wacht al · versturen".

Op de ouderdom van het oudste concept, niet op de dag van de maand. Dat was de
eerste versie, en die zei op de 22e al "staat al te wachten" over een concept
van diezelfde middag, terwijl hij op de 3e zweeg over twintig concepten van
vorige maand. Daarvoor is `facturen_lijst` uitgebreid met `datum`: de
factuurdatum, of bij een concept de dag waarop hij ontstond.

## 7. Btw per kwartaal

Een tabel onderaan het dashboard: kwartaal, periode, omzet, btw. Van het
lopende jaar alleen de kwartalen die al begonnen zijn, en het kwartaal waar je
in zit staat als "loopt nog".

Met opzet gerekend uit de **ongefilterde** posten: zou hij de keuze
contant/overmaken volgen, dan stond er een bedrag onder "btw" dat je zo over
kunt nemen en dat niet klopt. Over contant werk draag je net zo goed btw af.
Dat staat er ook onder, samen met waar het vandaan komt: uit het werk in de
planning met het klanttype zoals het nu staat — een hulpmiddel voor de
aangifte, niet de optelsom van de verstuurde facturen.

## De losse eindjes

`klus_factuurregel_bijwerken(klus)` is nu de enige plek die bepaalt of een
klus een losse factuurregel hoort te hebben en met welk bedrag. Drie triggers
komen daar langs: `klussen`, `klus_prijzen` en `wasdag_prijzen`.

Wat daarmee opgelost is:

| was | is |
|---|---|
| Weggegooide klus hield zijn factuurregel | regel gaat mee de prullenbak in, en komt terug als je de klus terughaalt |
| Klus afvinken vóór de prijs gaf nooit een regel | de prijs erin zetten maakt hem alsnog |
| Prijs achteraf aanpassen veranderde niets | het bedrag beweegt mee |
| "Prijs deze dag" bij een wasbeurt idem | idem, en een prijs op een al afgemelde dag maakt de regel alsnog |

Overal dezelfde grens: een regel op een **genummerde** factuur, een vervangen
regel (van een creditnota) en een regel met een bedrag dat je met de hand koos
blijven met rust.

## Het euroteken

Stond sinds 23-09 als open vraag. Uitgeprobeerd met een losse proef-PDF:
pdf-lib zet zijn standaardletters neer met `/WinAnsiEncoding`, en daar zit de
€ in als byte `0x80`. De PDF en de mail schrijven nu `€ 30,00`.

## Wat er van getest is

Op de database, met het factureren tijdelijk aan en een proefklus bij
Fultonstraat 75:

- afvinken zonder prijs → geen regel; prijs erin → regel met € 40 excl en
  € 8,40 btw (bedrijf, dus exclusief); prijs naar 25 → volgt; omschrijving
  aanpassen → volgt;
- prullenbak → regel weg én het lege concept weg; terughalen → regel terug;
  prijs 0 → weg; vinkje eruit → weg;
- op een concept beweegt hij nog mee;
- klus verhuisd naar Fultonstraat 77 (andere klant) → de regel verhuist mee
  naar die klant en komt los te staan; het concept van de vorige klant wordt
  opgeruimd;
- een regel met `bedrag_met_de_hand` bleef op € 12 staan terwijl de klusprijs
  naar 55 ging;
- bij een wasbeurt: een prijs op een al afgemelde dag maakte de regel alsnog,
  verdere wijzigingen volgden, prijs 0 haalde hem weg.

In beeld: het btw-kwartaalpaneel (Q3 € 2.784 / € 483,72, en het blijft op het
hele bedrijf staan als je bovenaan op overmaken drukt terwijl de tegel naar
€ 3 zakt), het porvak met "Allemaal kiezen", en de tegel Facturen die
"concept wacht al · versturen" leest.

Daarna alles teruggezet: geen factuurregels, geen facturen, geen tellers,
`factuur_start_op` leeg, geen proefklussen, en alleen Fultonstraat 75 staat
weer op overmaken.

## De review daarop

Acht punten, alle acht opgelost. De drie die er het meest toe deden: een klus
die je achteraf op het juiste adres zet hield zijn regel bij de vórige klant;
een concept bleef als € 0,00 in de lijst staan als zijn laatste regel
verdween; en de btw-tabel deed zich voor als de optelsom van de facturen
terwijl hij uit de planning komt. De rest: `company_id` ontbrak op één join in
een `security definer`-functie, een handmatig bedrag na crediteren werd
overschreven, de por keek alleen naar de dag van de maand, en het btw-paneel
bleef zonder uitleg leeg als het tarief niet op te halen was.

De overdracht voor fase 2 staat in
`overdracht-facturen-fase2-2026-09-24.md`.
