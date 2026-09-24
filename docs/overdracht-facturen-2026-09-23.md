# Overdracht: het tweede betalingssysteem (facturen)

Geschreven op 23-09-2026, halverwege fase 1. Het goedgekeurde plan staat in
`~/.claude/plans/oke-big-new-system-cozy-newt.md`; dit document vertelt waar
het werk staat en wat er nog moet.

## Waar het over gaat

De app kon één soort geld: contant ophalen (de geldloop). Dit is de andere
helft: klanten die overmaken krijgen een factuur. De keuzes zijn in tien
rondes met Timmie doorgesproken; de dragende zijn:

- Prijzen zijn **inclusief btw** (21%, overal). Of bedragen incl of excl
  getoond worden volgt het **klanttype**: particulier incl, bedrijf/VvE excl.
- Bij het afmelden van de **hele** dag (alle teams klaar) ontstaan *te
  factureren regels*: geen nummer, niets naar buiten. De factuur ontstaat pas
  bij het versturen.
- Factuurnummer pas bij versturen: `2026-0001`, per bedrijf, reset per jaar.
  **Factuurdatum = de dag van de laatste beurt erop**, zodat omzet in de maand
  van het werk valt en naast de contante kant te leggen is.
- Een verstuurde factuur staat vast: niet te wijzigen, niet weg te leggen,
  klantgegevens bevroren. Rechtzetten gaat met een creditfactuur.
- Versturen via **Brevo transactioneel mét PDF-bijlage** (dat kan wél),
  Mollie-betaallink via de **Payment Links API** (die verloopt niet) in de
  mail. Dus géén eigen factuurwebpagina.
- Nieuw recht `facturen`, los van `prijzen_zien`.

## Wat er af is

**Database** — vijf migraties, alle doorgezet (`supabase db push` draaide
schoon):

| bestand | wat |
|---|---|
| `20261012090000_facturen_fundament.sql` | recht `facturen`; klanttype + zakelijke velden op `klanten`; `btw_procent`/`factuur_termijn_dagen`/`factuur_start_op` op `companies`; `betaalmethode` + `notitie_op_factuur` op `wasdag_regels`; tabellen `factuurregels`, `facturen`, `factuur_tellers`; RLS |
| `20261012091000_factuurregels_bij_afmelden.sql` | `factuurregels_maken(dag)`, trigger op `klussen`, aangepaste `dag_afmelden` en `dag_heropenen`, `factuurregels_terug(dag)` |
| `20261012092000_facturen_maken.sql` | `facturen_klaarzetten`, `factuur_vastzetten`, `factuur_verstuurd`, `factuur_betaald`, `factuur_crediteren`, `facturen_lijst`, `factuur_totalen` |
| `20261012093000_factuur_met_rust.sql` | `factuur_met_rust` (een verstuurde factuur staat verder op slot) |
| `20261012094000_met_rust_leeg.sql` | standaardwaarde zodat "met rust" ook uit kan |
| `20261012095000_factuur_bestanden.sql` | opslagbak `facturen` voor de verstuurde PDF's |
| `20261012096000_facturen_review.sql` | wat de code-review ving: `with check` op de regelpolicy, `for update` in `factuur_vastzetten`, weggelegde klanten overslaan, lege concepten opruimen |

**App**

- `src/lib/facturen.ts` — nieuw: types, `fetchFacturen`, `facturenKlaarzetten`,
  `factuurBetaald`, `factuurCrediteren`, `factuurMetRust`, `openBedrag`,
  `factuurStand`.
- `src/lib/rechten.ts` — recht `facturen` erbij, ook in `rechtenVoorPad`.
- `src/lib/betalingen.ts` — tabblad `facturen` erbij in `TABBLADEN`/`TABNAAM`.
- `src/lib/klanten.ts` — `Klant` uitgebreid met klanttype en de zakelijke/
  factuurvelden; `LEEG_KLANT` geëxporteerd; `KlantTekstVeld` voor inline
  bewerken; `KLANT_VELDEN` moet één letterlijke tekst blijven (anders leidt
  Supabase het rijtype niet af).
- `src/components/KlantgegevensDialog.tsx` — blok "Wat voor klant", en bij
  bedrijf/VvE de blokken "Zakelijke gegevens" en "Facturen".
- `src/components/Pillen.tsx` — nieuw, uit `BetaalwijzeKiezer` getrokken.
- `src/routes/instellingen.tsx` — kaart "Facturen" (startdatum, btw-tarief,
  termijn).
- `scripts/types.sh` + `docs/types-opnieuw-genereren.md` — de types moeten na
  het genereren drie reparaties krijgen, anders regent het typefouten. De
  `types.ts` in de repo liep twaalf tabellen achter; die is nu bij.

- `src/components/betalingen/FacturenLijst.tsx` — de facturentab: filters,
  selectie, bulk versturen, betaald afvinken, crediteren, concept weggooien,
  geel vakje voor losse regels.
- `src/routes/betalingen.tsx` — tabblad aangehaakt; wie alleen het recht
  `facturen` heeft komt meteen op de facturen uit in plaats van in de geldloop.
- `src/components/betalingen/Avondoverzicht.tsx` — tegel "Facturen".
- `src/lib/geldfilter.ts` + `src/components/Geldfilter.tsx` — contant /
  overmaken / allebei, onthouden per toestel. Aangesloten op
  `src/routes/dashboard.tsx`: het filtert de posten, dus álle grafieken
  (per maand, per wijk, per werkdag) bewegen mee.
- `supabase/functions/_gedeeld/factuurpdf.ts` — de PDF, zelf getekend met
  pdf-lib.
- `supabase/functions/facturen/index.ts` — versturen: vastzetten → PDF →
  opslaan → Brevo → verstuurd melden. **Uitgerold.**
- `supabase/functions/_gedeeld/mail.ts` — `bijlagen` erbij op `BrevoMail`.

`bunx tsc --noEmit`, `bunx eslint` en `bun run build` staan alle drie schoon.
De edge function is met `deno check --node-modules-dir=auto` nagekeken.

## Wat de code-review ving

Opgelost: de `with check` op "Regel van een concept bijwerken" liet een losse
regel alsnog aan een verstuurde factuur hangen; `factuur_vastzetten` las
zonder rijvergrendeling, waardoor twee gelijktijdige verzendingen twee nummers
konden trekken (nu `for update`, plus ontdubbelen in de edge function); het
dashboard gebruikte de betaalmethode van *nu* in plaats van de bij het
afmelden vastgelegde (`wasdag_regels.betaalmethode`, nu meegenomen in
`fetchWasdagen`); één onbekend teken in een notitie kon de PDF laten klappen
nádat het nummer al getrokken was; een mislukte PDF-upload legde toch een
`pdf_pad` vast; de overzichtstegel haalde de hele factuurgeschiedenis op;
lege concepten bleven staan na het heropenen van een dag; een weggelegde klant
kreeg alsnog een concept.

Nog open, bewust doorgeschoven:

- **Een adres op "overmaken" zonder klant wordt stilzwijgend nooit
  gefactureerd** (de `join` op `klanten` in `factuurregels_maken`). Hoort bij
  de vangnetten hieronder: tellen en tonen, bijvoorbeeld in het gele vakje.
  Hetzelfde geldt voor een adres met prijs 0.
- **Een weggegooide of achteraf geprijsde klus** houdt zijn factuurregel: de
  trigger luistert alleen naar `gedaan_op`, niet naar `deleted_at` of de
  prijs. Moet meegenomen worden zolang de regel nog op geen genummerde
  factuur staat.

## Wat er NIET getest is

Belangrijk om te weten voor wie verdergaat: er is **niets van de keten in de
praktijk uitgeprobeerd**. De dev-server waar ik bij kon, was ingelogd als een
medewerker zonder het recht `facturen`, dus ik heb alleen kunnen zien dát de
rechtencontrole werkt ("Je rol mag de facturen niet zien"). Nog te doen:

1. Bij Instellingen → Bedrijf een **startdatum** invullen, anders gebeurt er
   niets: zonder `factuur_start_op` maakt de app geen enkele factuurregel.
2. Het recht `facturen` aan een rol geven (de eigenaar heeft het vanzelf).
3. Een testklant op *bedrijf* zetten, zijn adres op *overmaken*, een dag
   plannen en helemaal afmelden, en kijken of er een regel ontstaat.
4. Concepten klaarzetten, versturen naar het testadres van Wassersapp beta —
   **nooit** naar `info@deramensopperij.nl`.
5. Controleren of de PDF er goed uitziet, en of `BREVO_API_KEY` als secret
   gezet is voor deze functie.

## Wat er nog moet (fase 1)

1. **`src/routes/home.tsx`** — daar staan de contant/overmaken-knoppen nog
   niet; op het dashboard wel. Gebruik `GeldfilterPillen` + `teltMee`.
2. **"Waarvan btw" onder het omzetgetal** op het dashboard. Kan nog niet:
   `posten` weet niet welk klanttype bij een adres hoort, en juist dat bepaalt
   of de opgeslagen prijs inclusief of exclusief btw is. `adresInfo` moet
   daarvoor het klanttype meenemen via `customers.klant_id`.
3. **`DagKlaar.tsx`** — bij het afmelden vragen naar klussen van die dag die
   nog geen `gedaan_op` hebben. Let op: `dag_afmelden` raakt klussen niet;
   een klus maakt zijn factuurregel via de trigger op `gedaan_op`.
4. **Kopie in het klantdossier** — de edge function schrijft de verstuurde
   factuur nog niet weg als bericht bij de klant (spoor van
   `20260929090000_dossier_mail_klachten.sql`). Dat was wél afgesproken.
5. **Vangnetten**: telling + waarschuwing bij het omzetten van een hele wijk
   naar overmaken (`WijkKiezer.tsx`, `zetWijkBetaalmethode`), waarschuwing bij
   een klant zonder e-mailadres, lijstje "kan niet gemaild" met printknop.
6. **Maandconcepten** via `pg_cron` in de nacht van de 1e
   (`facturen_klaarzetten`), plus de por als er na de 5e nog concepten staan.
7. **Btw-kwartaaloverzicht** op het dashboard.

Daarna fase 2 (vormgeving + briefpapier), 3 (Mollie), 4 (herinneringen).

## Vallen waar ik in gelopen ben

- `supabase gen types` levert een striktere `types.ts` dan hoe deze app
  geschreven is. Gebruik **altijd** `./scripts/types.sh`.
- Een samengestelde foreign key met `on delete set null` maakt *elke* kolom
  leeg, ook `company_id` (die niet leeg mag). Daarom is
  `factuurregels_factuur_fk` enkelvoudig.
- `KLANT_VELDEN` mag niet met `+` aan elkaar geplakt worden.
- De migratienummers lopen vooruit op de kalender (de laatste was
  `20261011187000`); nieuwe migraties moeten daarna sorteren.
- `deno check` heeft `--node-modules-dir=auto` nodig voor `npm:pdf-lib`, en
  laat dan een `deno.lock` achter die niet in de repo hoort.
- De PDF schrijft voorlopig `EUR 30,00` in plaats van `€ 30,00`: het euroteken
  in de standaardletters van pdf-lib is niet getest. Meenemen in fase 2, waar
  de vormgeving toch aan de beurt is.

## Nog niet hard

- Het exacte Nederlandse WhatsApp-utility-tarief (een paar cent per bericht,
  utility — niet marketing, dat is in Nederland ~$0,16).
- Timmie werkt alleen met 21%; het btw-veld per klant blijft als nooduitgang.
