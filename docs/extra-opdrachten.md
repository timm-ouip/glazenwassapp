# Extra opdrachten: werk zonder maand

Gebouwd op 9 september 2026.

Een klant vraagt of de dakrand ook meegenomen kan worden. Daar zeg je ja op,
je maakt er een prijs voor, en je doet het als je toch in die wijk bent en er
tijd is. Er hoort geen maand bij en geen ronde: het blijft liggen tot het
uitkomt.

Dat is iets anders dan `maandwerk` op een adres — dat is werk dat in bepaalde
kalendermaanden meekomt en zich elk jaar herhaalt, zoals een serre die in de
even maanden meegaat. Vandaar een eigen tabel.

## Hoe het werkt

- **Aanmaken** kan op drie plekken: met de rechtermuisknop op een adres in de
  wijklijst, in het dossier onder "Openstaand werk", en met de knop
  "Opdracht" onder de kalender (daar zoek je het adres erbij).
- **Onder de kalender** staat wat er openstaat, in drie groepjes: *Nu aan de
  beurt* (die wijk heeft een dag in de maand die je bekijkt), *Staat op een
  dag*, en ingeklapt *Wacht op een dag in die wijk*.
- **Op een dag zetten** doe je door hem op een dagvakje te slepen, of met de
  rechtermuisknop → "Zet op…". Dat laatste is er voor de telefoon: een
  kalendervakje raken met een kaartje in je hand is geen doen.
- **Afvinken** gebeurt op de dagpagina, tussen de adressen, of in de strook.

## De regel waar alles om draait

Op welke dag een opdracht meetelt in de omzet — of nergens — staat op één
plek: `telDagVan()` in `src/lib/klussen.ts`.

| de opdracht | telt mee op |
|---|---|
| afgevinkt | de dag waarop je hem deed (`gedaan_op`) |
| niet afgevinkt, staat op vandaag of later | die dag (`gepland_op`) — de vooruitblik |
| niet afgevinkt, stond op een dag die geweest is | **nergens** |

Die laatste regel is het hele punt van de functie. Zet je hem op dinsdag en kom
je er niet aan toe, dan is hij woensdag van die dag áf: hij telt niet mee in de
omzet van dinsdag, hij staat niet op de daglijst van dinsdag, en hij staat weer
bovenaan de strook met "stond op 3 september" erbij. Zo blijft een dag die
geweest is eerlijk — daar staat wat je gedaan hebt — en komt het werk vanzelf
weer voorbij zodra die wijk opnieuw aan de beurt is.

Dat die berekening op één plek staat is geen netheid maar noodzaak: de
kalender, het dagpaneel en de dagpagina rekenen er alle drie mee, en als ze het
los van elkaar zouden doen staan er getallen op één scherm die niet bij elkaar
optellen.

## Het model

Tabel `klussen`: bedrijf, adres, omschrijving, prijs, `gepland_op`,
`gedaan_op`, `deleted_at`. Eén policy voor alles met
`(select public.current_company_id())`, zoals bij `markeringen` en
`straat_groepen`.

- **Geen maand, geen ritme.** `gepland_op` is een losse dag en verder niets.
- **Wel `deleted_at`**, anders dan bij de straatgroepen: hier zit werk in — een
  omschrijving en een afgesproken prijs — dus weggooien is wegleggen.
- **Niet in `wasdag_regels` erbij.** Die tabel heeft een unieke index op
  (bedrijf, datum, adres); een opdracht op dezelfde dag als de gewone wasbeurt
  van dat adres zou daarop stuklopen.

## Wat er getest is

Op wijk Gouda, met de testdata:

- Een opdracht gemaakt vanaf de planningpagina ("De Slufter 8, dakrand
  schoonmaken, € 45") en één vanaf de rechtermuisknop in de wijklijst ("goot
  uitspuiten, € 30"). Beide staan in het dossier van dat adres onder
  Openstaand werk.
- Naar een dag gesleept: het bedrag van die dag ging met € 45 omhoog, de
  strook verplaatste hem naar "Staat op een dag", en het contextmenu op het
  dagvakje werkte daarna nog.
- **De belangrijkste:** op 3 september gezet, een dag die geweest is. Die dag
  bleef € 96 — dus níet € 141 — en op `/dag?datum=2026-09-03` stond hij niet.
  In de strook stond hij weer bovenaan met "stond op 3 september".
- Afgevinkt: 3 september werd € 141 en hij verscheen op de daglijst met een
  vinkje. Weer uitgevinkt: terug naar € 96 en weg van die dag.

### Eén ding onderweg

De eerste versie van het slepen liet de dag bepalen door de rechthoek van het
kaartje dat je vasthoudt — dnd-kit doet dat standaard. Je wees dan de tiende
aan en het landde op de negende. Met `collisionDetection={pointerWithin}` telt
waar je muis is, en dat is wat je bedoelt.

## Wat er nog niet in zit

**De geprinte daglijst.** Op het scherm staan de opdrachten op `/dag`, maar op
de printlijst van die dag nog niet. Die pagina meet zijn eigen indeling op en
schaalt hem naar het vel; daar hoort een eigen stap bij en die zat niet in deze
ronde. Neem je de lijst mee in de auto, dan staat het extra werk er dus nog
niet op.
