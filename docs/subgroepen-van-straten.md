# Plan: subgroepen van straten binnen een wijk

Geschreven op 9 september 2026. Nog niets van gebouwd — dit is de bedoeling,
zodat je hem kunt afkeuren of bijstellen vóór er code komt.

Doel: binnen een wijk straten kunnen bundelen onder een naam die je zelf
verzint ("Noordkant"), die naam blijft staan, je kunt de hele bundel in- en
uitklappen, en je kunt hem in één handeling op een wasdag zetten.

**Gebouwd op 9 september 2026.** Onderaan, na de aannames, staat wat het
uiteindelijk geworden is en wat er getest is.

Aan het eind staat de lijst met aannames. Die zijn op 9 september allemaal met
Timmie doorgenomen; wat hij besliste staat erbij, en de tekst hierboven is
daarop aangepast. Er staat dus niets meer open.

---

## 0. Wat er nu staat (voor de context)

- De wijkpagina is `src/routes/index.tsx`, 2328 regels. Alle straten van de
  actieve wijk komen uit `groepen` (een `useMemo`), en worden als losse
  `StraatBlok`-secties getekend in één `<div>` met `md:columns-1 xl:columns-2`
  — een CSS-kolommenlayout, waar de straten vanzelf doorheen stromen.
- In- en uitklappen van een straat: `ingeklapt`, een `Set<string>` met
  straat-id's, plus `klapStraat(id)` en de knop in de straatkop. Het staat
  alleen in het geheugen van de pagina; na een herlading is alles weer open.
- Een hele straat op de dag zetten: `onStraatOpDag(streetId, aan)` →
  `zetStraatOpDag(g, aan)` → `pasKeuzeAan(erbij, eraf)`. Dat is puur lokaal;
  pas "Inplannen voor" (`planIn`) praat met de database.
- Met de muis over meerdere straatkoppen slepen om ze aan te vinken loopt via
  `startVerf` / `verfOpPunt`, die in de DOM zoekt naar `data-verf-straat` en
  `data-verf-klant`.
- Straat bewerken: `StraatDialog` (`src/components/StraatDialog.tsx`), twee
  velden (korte naam, volledige naam), schrijft rechtstreeks naar `streets`.

---

## 1. Schema

### Nieuwe tabel

Migratie: `supabase/migrations/20260909120000_straatgroepen.sql`

```sql
create table public.straat_groepen (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  district_id uuid not null references public.districts(id) on delete cascade,
  naam text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index straat_groepen_wijk_idx
  on public.straat_groepen (company_id, district_id);

create trigger straat_groepen_set_company_id before insert on public.straat_groepen
  for each row execute function public.set_company_id();

alter table public.straat_groepen enable row level security;

create policy "Bedrijf beheert eigen straatgroepen" on public.straat_groepen
  for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

alter table public.streets
  add column if not exists groep_id uuid
  references public.straat_groepen(id) on delete set null;

create index streets_groep_idx on public.streets (groep_id) where deleted_at is null;
```

Waarom zo:

- **`district_id` op de groep, niet alleen op de straat.** Een groep hoort bij
  precies één wijk, ook als er (nog) geen straat in zit. Anders bestaat een
  lege groep nergens en kun je hem niet vullen.
- **Geen `deleted_at`, anders dan bij wijken, straten en klanten.** Een groep
  is geen ding om terug te kunnen halen: er zit geen werk in dat verloren gaat.
  Verwijder je hem, dan blijven de straten en al hun adressen gewoon staan —
  ze vallen alleen terug op "geen groep". Een nieuwe groep maken en de straten
  er weer in zetten is een paar klikken. Dit is dezelfde afweging als bij
  `wasdag_regels`, waar in de migratie staat: een vinkje is niets om terug te
  kunnen halen.
- **`on delete set null` op de verwijzing** is wat dat mogelijk maakt: de
  groeprij verdwijnt, de straten blijven, hun `groep_id` wordt leeg. Een
  straat mag nooit met een groep meeverdwijnen.
- **De policy volgt `wasdag_regels`**: één `for all`-policy, `using` én
  `with check` op `current_company_id()`. Dat is het patroon voor alle
  bedrijfsgebonden tabellen hier.
- **`(select public.current_company_id())` in plaats van kaal.** Zelfde reden
  als in `20260908120000_rls_auth_uid_eenmalig.sql`: in een subquery rekent
  Postgres hem één keer per query uit in plaats van één keer per rij. In
  `current_company_id()` zelf zit `auth.uid()`, dus zonder die haakjes betaal
  je die kosten per rij. Meteen goed doen kost nu niets.

Los daarvan: **`public.current_company_id()` gebruikt intern nog `auth.uid()`
zonder subquery.** Dat kunnen we in dezelfde migratie rechtzetten — het is één
regel — maar het raakt élke tabel, dus dat is een aparte beslissing en geen
onderdeel van dit plan. (Zie aanname A7.)

### Wat er in de app mee moet

- `src/integrations/supabase/types.ts` is met de hand bijgewerkt, niet
  gegenereerd. Daar moeten `straat_groepen` (Row/Insert/Update) en het nieuwe
  veld `streets.groep_id` bij, anders geeft TypeScript overal fouten op de
  nieuwe queries. Dit is de stap die bij eerdere migraties het vaakst vergeten
  is.
- `src/lib/klanten.ts`: `Street` krijgt `groep_id: string | null`,
  `fetchStreets` haalt de kolom mee op (het is één letterlijke `select`-string
  — daar moet `groep_id` in), plus een nieuwe `fetchStraatGroepen()`,
  `nieuweStraatGroep()`, `hernoemStraatGroep()`, `verwijderStraatGroep()` en
  `persistGroepOrder()` naast de bestaande `persistStreetOrder`.
- Een nieuwe query `["straat_groepen"]` op de wijkpagina, en `herlaad()` moet
  hem meenemen.

---

## 2. Aanmaken en hernoemen

**Toewijzen** gebeurt in `StraatDialog`, zoals afgesproken: een derde veld,
een keuzelijst met "Geen groep", daaronder de bestaande groepen van deze wijk,
en onderaan "Nieuwe groep…". Kies je die laatste, dan verschijnt er een
tekstveldje in dezelfde dialoog; bij Opslaan wordt eerst de groep aangemaakt en
daarna de straat opgeslagen met dat `groep_id`. Zo hoef je nergens anders heen
om een groep te laten bestaan, en er is geen aparte beheerpagina nodig.

**Hernoemen, verwijderen en verplaatsen** zit in de kop van de groep zelf, in
hetzelfde soort knopjesrij als de straatkop nu heeft:

- potloodje → hernoemen (klein dialoogje met één veld, of ter plekke
  bewerkbaar; ik neig naar een dialoogje, dat is consistent met de rest)
- prullenbakje → groep verwijderen. Echt weg, geen prullenbak. De straten
  blijven staan en vallen terug op "geen groep". Wél met de gewone
  undo-melding (`pushUndo` + `meldUndo`): het terugdraaien maakt de groep
  opnieuw aan en zet de straten die erin zaten er weer in. Daarvoor moet het
  lijstje straat-id's van vóór het verwijderen in de undo-actie bewaard
  worden — want `on delete set null` heeft ze op dat moment al leeggemaakt.
- greepje → groepen onderling verslepen (dat is de `sort_order` op de groep).

Waarom hier en niet in een instellingenscherm: je ziet de naam op het moment
dat je hem wil veranderen, en het is één plek minder om te bouwen.

**Straten zonder groep** krijgen helemaal geen kop. Ze staan gewoon los onder
de groepen, precies zoals straten er nu bij staan. Geen "Overig", geen lege
omlijsting. Heeft een wijk geen enkele groep, dan ziet de pagina eruit als nu —
geen koppen, geen extra laag. Wie geen subgroepen gebruikt, mag er niets van
merken.

---

## 3. In- en uitklappen

**Het bestaande patroon is te hergebruiken, vrijwel ongewijzigd.**

`ingeklapt` is een `Set<string>` en `klapStraat(id)` doet niets straat-
specifieks: hij haalt een id eruit of stopt hem erin. De handler die naar
beneden gaat (`opKlap`) neemt al een `string`. We zetten er groep-id's bij met
een voorvoegsel, net zoals dnd-kit dat al doet met `s:` en `c:`:

- `"<straat-id>"` — deze straat is ingeklapt (blijft zoals het is)
- `"g:<groep-id>"` — deze groep is ingeklapt

`klapStraat` wordt dan `klapItem`, en de groepkop roept
`onKlap("g:" + groep.id)` aan. Eén nieuwe regel logica, geen nieuw mechanisme.

Wat er wél bij moet:

- **Een ingeklapte groep tekent zijn straten helemaal niet.** Dat is het
  verschil met een ingeklapte straat, die zijn kop houdt. Dit is meteen de
  grootste winst van de hele functie: een wijk van 29 straten waarvan er 20 in
  een dichtgeklapte groep zitten, mount er nog 9.
- **Een straat houdt zijn eigen ingeklapt-stand** terwijl de groep dicht is.
  Klap je de groep weer open, dan staat alles zoals je het achterliet. Dat gaat
  vanzelf goed als de twee soorten sleutels naast elkaar in dezelfde `Set`
  leven.
- `allesIngeklapt` / `klapAlles` (de knop "Alles inklappen") moet gaan over
  groepen én straten: alles dicht betekent alle groepen dicht.

---

## 4. "Plan deze hele subgroep in"

Ook hier: hergebruiken, niets nieuws.

De keten voor een straat is `onStraatOpDag(streetId, aan)` → zoekt de straat op
in `groepen` → `zetStraatOpDag(g, aan)` → verzamelt de id's van
`[...g.even, ...g.oneven]` → `pasKeuzeAan(erbij, eraf)`.

Daar komt één handler naast:

```
opGroepOpDag(groepId, aan)
  → alle secties van deze groep uit `groepen` halen
  → hun even + oneven id's aan elkaar plakken
  → één keer pasKeuzeAan(...)
```

Eén aanroep voor de hele groep, dus één `setKeuze` en één hertekening. Dat het
door `pasKeuzeAan` gaat is wat telt: dan doet inplannen, undo, het bedrag in de
balk, en `planIn` bij het opslaan automatisch mee. Er komt geen tweede pad naar
de database bij.

Wat de groepkop verder overneemt van de straatkop, met dezelfde berekening maar
opgeteld over de straten in de groep:

- het driestandenvinkje (leeg / half / vol) — `erop` tegen `zichtbaar.length`
- de amberkleurige vulling van de kop, die laat zien hoeveel er al op staat
- de tellers "x gedaan" en "x gepland" uit `eerderGewassen` / `elderGepland`
- `data-verf-groep` naast `data-verf-straat`, zodat de streek-selectie
  (`verfOpPunt`) ook over een groepkop werkt. Dat is drie regels in
  `verfOpPunt`: nog een `closest()`, en bij een treffer de id's van de hele
  groep in plaats van van één straat.

Deze optellingen horen in een `useMemo` bovenop `groepen` (een nieuwe
`secties`-lijst), niet in de groepkop zelf — anders rekent hij tijdens elke
sleepbeweging opnieuw.

---

## 5. Wat dit betekent voor de renderaanpak

Hier moet ik eerst iets rechtzetten, want de vraag gaat uit van iets dat er
niet is.

**Op de wijkpagina bestaat de geleidelijke mount niet.** Het "25 tegelijk, en
25 erbij als je scrollt" met de `IntersectionObserver` zit in
`src/routes/klanten.tsx` (commit `9a938b9`). Op de wijkpagina worden nog altijd
alle straten van de wijk in één keer getekend; wat daar gebeurd is, is iets
anders: `KlantRij` is gesplitst zodat de dure inhoud tijdens het slepen blijft
staan (commit `cdd2df4`).

Dus: **er is niets om aan te passen.** Wel drie dingen om te weten:

1. **Subgroepen zijn zélf de goedkoopste vorm van minder tekenen die we tot nu
   toe hebben.** Een dichtgeklapte groep mount zijn straten niet, en dus ook
   hun klantregels niet. Dat is geen truc met een waarnemer die op scrollen
   let, dat is gewoon: je hebt gezegd dat je die kant van de wijk nu niet
   nodig hebt. Als de wijkpagina traag opent, is dit waarschijnlijk de
   effectiefste maatregel — effectiever dan een geleidelijke mount.
2. **Komt er later tóch een geleidelijke mount op de wijkpagina**, dan is de
   volgorde: opengeklapte groepen eerst, van boven naar beneden, en
   dichtgeklapte groepen tellen niet mee (er valt niets te mounten). De
   eenheid om per keer bij te tekenen blijft de straat, niet de groep — een
   groep kan twintig straten hebben en dan is de stap te grof.
3. **`memo` op `StraatBlok` mag hier niet stukgaan.** De groepkop wordt een
   eigen component in `memo`, en de opgetelde cijfers komen uit de `useMemo`
   hierboven. Zou je ze in de render van de pagina uitrekenen, dan is elk
   getal bij elke muisbeweging tijdens een sleep vers, en hertekent alles mee
   — precies de fout die in `docs/performance-notes.md` beschreven staat.

---

## 6. Twee dingen die geraakt worden en waar ik geen antwoord op heb

**De kolommenlayout.** De straten stromen nu door `xl:columns-2`. Zodra
straten in een groep-container zitten, is die container het blok dat door de
kolommen stroomt: een groep van twintig straten wordt dan één lange kolom en de
andere kolom blijft leeg. Twee uitwegen, allebei met een nadeel:

- *De groep is één blok.* Netjes afgebakend, maar de pagina wordt langer en
  ongelijker verdeeld. Voor smalle schermen (`columns-1`) maakt het niets uit.
- *De groepkop is een blok, de straten blijven los eronder stromen.* De
  layout blijft zoals nu, maar visueel is minder duidelijk waar een groep
  ophoudt.

Ik zou beginnen met de eerste en er samen naar kijken op een echte wijk; het
is de eerlijkste weergave van "dit hoort bij elkaar", en het is achteraf te
veranderen zonder aan het schema te komen.

**Slepen van straten tussen groepen.** `onDragEnd` rekent nu met de index in
één platte lijst `streets`. Zodra de zichtbare volgorde gegroepeerd is, klopt
die rekensom niet meer wanneer je een straat op een straat in een ándere groep
loslaat. Mijn voorstel: zo'n sleep zet gewoon het `groep_id` mee om, precies
zoals het slepen van een klantregel naar een andere straat nu het `street_id`
omzet. Dat is geen nieuwe sleepbeweging — het is dezelfde beweging die iets
meer doet. Maar het is wel iets waar je "nee" tegen kunt zeggen: het
alternatief is zo'n loslaten negeren en toewijzen alleen via de dialoog laten
lopen.

---

## Aannames, en wat er besloten is

Dit waren de plekken waar de code of de opdracht geen antwoord gaf en ik zelf
iets koos. Alle elf zijn op 9 september doorgenomen; hieronder staat per punt
wat het geworden is. De tekst hierboven is daarop aangepast.

- **A1. Vastgesteld: een groep is geen prullenbak-ding.**
  Verwijderen is definitief, want er gaat niets verloren — de straten en hun
  adressen blijven staan en een groep is zo opnieuw gemaakt. Wel met undo, en
  die undo moet zelf onthouden welke straten erin zaten.
- **A2. Vastgesteld: straten zonder groep krijgen geen kop.**
  Ze staan los onder de groepen, zoals nu.
- **A3. Akkoord: de volgorde van straten blijft één `sort_order` per wijk.**
  De groep bepaalt alleen de bundeling; binnen een groep staan de straten in
  hun bestaande volgorde. Geen aparte volgorde per groep. Bij het verplaatsen
  van een straat naar een andere groep kan de volgorde daardoor onlogisch
  uitpakken tot je hem één keer versleept.
- **A4. Akkoord: slepen van een straat naar een andere groep
  verandert zijn groep.** Zie hierboven: geen nieuwe sleepbeweging, wel een
  bestaande die meer doet.
- **A5. Akkoord: zoeken.** Een groep die door de zoekterm geen enkele straat
  overhoudt verdwijnt, en een dichtgeklapte groep gaat tijdens het zoeken
  tijdelijk open — anders zoek je iets en zie je het niet. Dit is nieuw gedrag
  ten opzichte van straten, die tijdens het zoeken ingeklapt blijven.
- **A6. Akkoord: het in-/uitklappen van groepen blijft, net als bij straten,
  alleen in het geheugen van de pagina.** Ververs je, dan staat alles weer
  open. Onthouden (zoals de actieve wijk in `wijkgeheugen.ts`) kan later; het
  is klein werk, maar het zit hier niet in.
- **A7. Akkoord: `current_company_id()` blijft zoals hij is.** De nieuwe
  policy zet er wél `(select ...)` omheen, maar de `auth.uid()` binnenín die
  functie blijft ongemoeid — dat raakt elke bestaande tabel en hoort in een
  eigen migratie met een eigen test.
- **A8. Afgehandeld: geen unieke naam per wijk.** De database staat twee
  groepen "Noordkant" in dezelfde wijk toe. Waar ik op doelde: dan staan er
  twee koppen die er identiek uitzien, elk met een deel van de straten erin,
  zonder dat de app iets zegt. Komt in de praktijk niet voor, dus geen regel
  erop.
- **A9. Vastgesteld: de printlijst blijft ongemoeid.**
  `src/routes/printen.tsx` weet niets van groepen en houdt zijn eigen
  rasterindeling. Voorlopig niet nodig; als een groep ooit ook op papier een
  kop moet krijgen, is dat een apart plan.
- **A10. Akkoord: namen in de database zijn Nederlands** (`straat_groepen`,
  `naam`), in de lijn van `wasdag_regels` en `maandnotities`. De verwijzing
  vanaf `streets` heet `groep_id`, naast bestaande Nederlandse kolommen daar
  zoals `kolom_start` en `volledige_naam`.
- **A11. Akkoord: één niveau diep.** Een groep zit niet in een andere groep.
  Dat maakt zowel de layout als het inplannen aanzienlijk ingewikkelder, en er
  was niet om gevraagd.


---

## Wat er gebouwd is, 9 september 2026

Alles uit dit plan zit erin. De bestanden:

- `supabase/migrations/20260909120000_straatgroepen.sql` — de tabel, de
  policy, de kolom `streets.groep_id`. Doorgezet naar Supabase; de
  migratiegeschiedenis liep in de pas, dus een `repair` was niet nodig.
- `src/integrations/supabase/types.ts` — met de hand bij, niet gegenereerd.
- `src/lib/klanten.ts` — `groep_id` op `Street`, en `fetchStraatGroepen`,
  `nieuweStraatGroep`, `hernoemStraatGroep`, `verwijderStraatGroep`,
  `herstelStraatGroep`, `zetStratenInGroep`, `persistGroepOrder`.
- `src/components/StraatDialog.tsx` — het veld "Onderdeel van", met
  "Nieuwe groep…" erin.
- `src/components/GroepDialog.tsx` — hernoemen.
- `src/routes/index.tsx` — `secties`, `GroepSectie`, het in- en uitklappen,
  het inplannen van een hele groep, de streek over een groepkop, en het
  slepen.

Twee dingen zijn onderweg anders uitgepakt dan hierboven staat:

1. **De kolommenlayout: een groep is één blok geworden**, zoals voorgesteld in
   hoofdstuk 6. Op een echte wijk ziet dat er goed uit — de groep is een
   omlijnd vak met de straten erin — maar het blijft iets om na een paar weken
   gebruik nog eens tegen het licht te houden.
2. **De sleep-id's laten een ingeklapte groep weg.** Zijn straten staan niet
   op het scherm, dus er valt ook niets naast te laten vallen. Dat stond niet
   in het plan en bleek nodig toen het er eenmaal stond.

### Wat er getest is, met de hand op wijk Gouda (43 straten, 288 adressen)

- Een groep aanmaken vanuit het straat-dialoogvenster ("Nieuwe groep…" →
  "Noordkant"), en daarna een tweede straat in diezelfde groep zetten via de
  keuzelijst. De kop telt op: 6 + 7 = 13 adressen, € 96 + € 243 = € 339.
- In- en uitklappen: dicht staat er "13 adressen ingeklapt" en zijn beide
  straten werkelijk uit de pagina verdwenen.
- De hele groep op een dag zetten: één klik op de kop gaf "Geselecteerd € 339
  · 13 adressen" en "Inplannen voor (13)", met alle regels in beide straten
  aangevinkt.
- Zoeken: op "slufter" bleef binnen de groep alleen die straat over, met het
  bijgestelde totaal (7, € 243). Op "haaks" ging een dichtgeklapte groep
  vanzelf open — dat is aanname A5, en het werkt zoals bedoeld.
- Hernoemen, en het daarna terugdraaien met "Ongedaan"
  ("Teruggedraaid: Groepnaam Noordkant").
- Verwijderen: de groep verdween, de twee straten bleven met al hun adressen
  gewoon staan, los onder de andere. Het terugdraaien zette de groep terug
  mét beide straten erin — dat is het pad waar de undo zelf moet onthouden wie
  erin zat, en dat klopt.

**Het slepen** — een straat naar een andere groep, en groepen onderling — is
door Timmie zelf geprobeerd en werkt. Met een aangestuurde browser was het niet
betrouwbaar na te doen, vandaar dat het hier niet in de eigen testronde staat.

In de testdatabase staat één groep "Noordkant" in wijk Gouda.

### Wijzigingen na de eerste versie, dezelfde dag

Na het meekijken zijn er vier dingen aangepast:

1. **De uitleg onder het naamveld is weg.** Een veld met "Naam" erboven in een
   venster dat "Groep hernoemen" heet, legt zichzelf uit.
2. **Een groep loopt over beide kolommen.** De sectie heeft
   `[column-span:all]`, waardoor de straten die er niet in zitten er gewoon
   ónder verdergaan in plaats van ernaast. Binnen de groep staan de straten
   zelf weer in twee kolommen, net als daarbuiten. Dit is duidelijk beter dan
   de variant uit hoofdstuk 6, waar de groep één kolom vulde en de rest ernaast
   doorliep.
3. **De rechtermuisknop op een straatkop** geeft nu "Nieuwe groep met deze
   straat…", de bestaande groepen om hem aan toe te voegen (met een vinkje bij
   de groep waar hij nu in zit), en "Uit de groep halen". Daarmee is de
   keuzelijst in `StraatDialog` niet langer de enige weg naar een groep — en de
   snelle weg loopt nu langs de straat waar je toch al met je muis bent.
4. **`GroepDialog` maakt ook nieuwe groepen.** Komt er een groep mee, dan
   hernoemt hij; komt er een straat mee, dan maakt hij een groep met die straat
   erin. Het terugdraaien haalt de straat er weer uit én gooit de groep weg.

Ook dit is nagelopen: een straat aan een bestaande groep toevoegen
("Schiermonnikoog zit nu in Noordkant", de kop telt door naar 15 · € 484), een
nieuwe groep vanaf de rechtermuisknop ("Groep 'Testgroep' gemaakt, met
Scheygrond erin"), en het terugdraaien daarvan — waarna Scheygrond weer in
Noordkant zat en Testgroep verdwenen was.
