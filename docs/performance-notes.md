# Wat we weten over de traagheid

Aantekeningen bij het onderzoek van 8 september 2026. Alle cijfers hieronder
zijn gemeten, niet geschat; waar iets een vermoeden is, staat dat erbij.

Gemeten op de wijk Madestein: 29 straten, 341 klanten. Eén sleep is steeds
dezelfde handeling: een regel binnen Markgraaf A (45 klanten) vijf plaatsen
omhoog, met twaalf muisbewegingen ertussen.

## De sleepvertraging komt van dnd-kit, niet van de props

Dit is de kern, en het is iets anders dan we eerst dachten.

`useSortable` abonneert het component waarin het staat op de `DndContext`.
Die context werkt bij *elke muisbeweging* bij, en dan hertekent iedereen die
eraan hangt. Dat gebeurt op drie plekken: in `StraatBlok` (om straten te
kunnen slepen), in `StraatKolom` (via `useDroppable`) en in `KlantRij` (om
regels te kunnen slepen). Bij 341 regels en 29 straten zijn dat bijna
vierhonderd abonnementen.

Renders tijdens één sleep:

| component | tijdens de sleep | inclusief loslaten |
|---|---|---|
| `Index` (de pagina zelf) | 2 | 4 |
| `StraatBlok` | 522 | 638 |
| `KlantRij` | **6166** | **7530** |

De verdeling wijst de oorzaak aan. Kwamen die renders van de pagina, dan
waren er hooguit 2 × 341 mogelijk geweest voor de regels. Het zijn er 6166 —
ruim achttien per regel, één per muisbeweging. Ze komen dus van binnenuit,
uit de drag-context, en niet van bovenaf.

**`memo` kan hier per definitie niets tegen doen.** Dat kijkt alleen naar
props, en de props zijn niet wat er verandert.

De cijfers laten ook zien waar het gewicht zit: `KlantRij` is goed voor 92%
van alle renders. Een oplossing die alleen naar `StraatBlok` kijkt, pakt een
kleine minderheid van het probleem aan.

## Wat de memo/useStabiel-wijziging wél deed

`StraatBlok` en `StraatKolom` staan sinds commit `ebd06b7` in `memo`, en de
zes handlers voor een straat hebben een vaste identiteit via `useStabiel`.
Onderweg bleek dat `streets` en `customers` bij elke render verse arrays
waren, waardoor `groepen` zich telkens opnieuw berekende; die staan nu ook
in een `useMemo`.

- **Lost niet op:** de sleepvertraging. Zie hierboven.
- **Lost wel op:** onnodig hertekenen bij alles wat élders op de pagina van
  toestand verandert — een dialoog die opengaat, de zoekbalk, een menu. Daar
  hertekende voorheen de hele wijk mee.

Het is dus winst, maar niet de winst waarvoor het bedoeld was.

## De trage wasdagen-query lag niet aan de database

Eén aanvraag aan `wasdag_regels` duurde in de Network-tab een keer 101 ms en
een andere keer 3,75 seconde, bij een antwoord van 3,9 kB.

Uit `pg_stat_statements`, voor precies die SELECT (sinds 28 augustus):

| | |
|---|---|
| aanroepen | 1207 |
| gemiddeld | 0,73 ms |
| snelste | 0,01 ms |
| **traagste ooit** | **28,97 ms** |
| standaardafwijking | 1,66 ms |

De tabel bevat 119 rijen. Postgres heeft deze query dus nog nooit langer dan
29 milliseconden vastgehouden. Die 3,75 seconde zat ergens anders.

**Vermoeden, niet bevestigd:** de browser was bezig met de duizenden renders
hierboven en kwam pas laat toe aan het al binnengekomen antwoord. De
Network-tab meet tot het moment dat de JavaScript de response verwerkt, dus
een bezette hoofddraad ziet er in die tabel uit als een trage server. Dit is
niet gemeten en zou de twee bevindingen aan elkaar knopen — maar het kan ook
iets anders zijn, bijvoorbeeld een token-vernieuwing die supabase-js vóór de
query afhandelt.

Nog iets om te weten bij verder zoeken: beide Supabase-clients praten via
HTTPS met PostgREST, niet rechtstreeks met Postgres. Pooler-instellingen
(pgbouncer, transaction pooler) raken deze aanvragen dus niet — die gelden
alleen voor directe databaseverbindingen, zoals migraties.

## Opgelost: twee RLS-policies rekenden per rij

De performance-advisor van Supabase meldde dat `auth.uid()` in twee policies
voor elke rij opnieuw werd uitgevoerd:

- `companies` → "Eigenaar wijzigt bedrijf"
- `employees` → "Eigenaar verwijdert medewerkers"

Migratie `20260908120000_rls_auth_uid_eenmalig.sql` zet ze in een subquery,
zodat Postgres ze één keer per query uitrekent. Wie wat mag is niet
veranderd; dat is na afloop getest met een gesimuleerde eigenaar en een
gesimuleerde medewerker, voor beide policies. De advisor meldt nu niets meer.

Op 119 rijen scheelt dit niets merkbaars. Het gaat om later.

## Opgelost: `companies` werd drie keer per paginalading opgehaald

`AuthProvider` haalde de employees- en companies-rij bij elke paginalading
drie keer op: één keer via `getSession()`, en daarbovenop nog een paar keer
omdat `onAuthStateChange` bij het opstarten meer dan één event afvuurt.

`laadMedewerker` in `src/lib/auth.tsx` onthoudt nu voor welke gebruiker het
al gedaan is. Op de gebruiker en niet op de sessie: een verversde token is
dezelfde persoon. Bij uitloggen gaat de vlag eraf, dus in- en uitloggen
verversen nog gewoon. Gemeten: van drie aanvragen naar één.

## Plan voor de sleep-refactor (nog niet uitgevoerd)

Doel: het slepen soepel maken. Wacht op akkoord.

De renders tijdens het slepen zijn niet te vermijden — dnd-kit werkt zo, en
elk component dat wil kunnen slepen moet zijn context volgen. De uitweg is
niet om ze te voorkomen, maar om ze **goedkoop** te maken: laat het abonnement
op de context in een dun schilletje zitten, en houd de dure inhoud daarbuiten.

### Stap 1 — `KlantRij` splitsen (grootste winst, kleinste ingreep)

Hier zit 92% van het werk. Splits het component in tweeën:

- `KlantRijSleep` — roept `useSortable` aan en rendert niets meer dan de
  buitenste `<div>`: `setNodeRef`, de `transform`/`transition`-stijl, de
  drag-handle met `attributes`/`listeners`, en `isDragging` voor de opmaak.
- `KlantRijInhoud` — in `memo`, met alles wat er nu in staat: de cellen, de
  prijs, de notitie, het menu.

De schil hertekent dan nog steeds achttien keer per sleep, maar dat is een
`<div>` met een stijl. De inhoud blijft staan, want haar props veranderen
niet tijdens het slepen.

Voorwaarde: alle props van `KlantRijInhoud` moeten een vaste identiteit
hebben. De handlers hebben dat al via `useStabiel`. Na te lopen: `quickNotes`,
`klantNaam`, en of `geselecteerd` niet onnodig wisselt.

Waarom dit boven een render-prop of `children` vanaf de kolom: `StraatKolom`
hangt zelf ook aan de drag-context (`useDroppable`), dus elementen die dáár
gemaakt worden hertekenen alsnog mee. De splitsing binnen de rij is
onafhankelijk van wat erboven gebeurt, en dat maakt hem betrouwbaarder.

### Stap 2 — hetzelfde voor `StraatBlok`

Zelfde patroon, kleinere winst (522 renders). Wel meer werk, want de
drag-handle zit midden in de straatkop tussen de andere knoppen. De kop moet
zo worden opgeknipt dat de schil de handle levert en de rest eromheen
onaangeroerd blijft. Pas oppakken als stap 1 gedaan en gemeten is — mogelijk
is het daarna al snel genoeg en is dit niet meer nodig.

### Stap 3 — bij loslaten niet alles opnieuw groeperen

Bij het loslaten verandert `customers`, en dan draait `groepen` opnieuw voor
alle 29 straten. Elke straat krijgt daardoor nieuwe `even`- en
`oneven`-arrays, dus hertekent alsnog alles — ook de 28 straten waar niets
aan veranderd is. Dit is de reden dat je ná het loslaten nog een hapering
ziet.

Aanpak: geef `groepen` een geheugen. Houd per `street.id` de vorige uitkomst
bij in een `useRef`, en hergebruik die als de klanten van die straat
inhoudelijk niet gewijzigd zijn. Alleen de straat waarin gesleept is krijgt
dan nieuwe arrays; de andere 28 houden hun oude identiteit en blijven staan.

Let op bij het vergelijken: het gaat om de klantenrijen zelf, niet om de
array eromheen. Een sleep verandert de volgorde binnen één straat; een
prijswijziging verandert één klantobject. Beide moeten die ene straat
verversen en de rest met rust laten.

### Wat we daarna moeten meten

Dezelfde meting als hierboven, met dezelfde sleep in dezelfde straat, zodat
de getallen vergelijkbaar zijn. Streefbeeld: `KlantRijInhoud` blijft tijdens
een sleep op vrijwel nul renders, en na het loslaten hertekent alleen de
straat waarin gesleept is.

Tellen kan met een tijdelijke teller op `window`; React DevTools werkt niet
in de browser waarin dit onderzoek gedaan is, omdat die geen extensies laadt.
