# Tegoed en bankbestanden inlezen

Gebouwd in oktober 2026, op vraag van Timmie: "als mensen per ongeluk te veel
overmaken, komt dat als tegoed in hun dossier, en bij de volgende factuur gaat
het eraf met een regel reeds betaald / nog te betalen". En: overmakingen
vanzelf inlezen, eerst met een bankbestand (hij bankiert bij ASN en boekhoudt
in SnelStart).

## Tegoed

- **Waar het vandaan komt:** te veel betaald op een factuur, of al betaald op
  een factuur die daarna gecrediteerd wordt (ook tegoed dat erop verrekend
  was komt zo terug).
- **Waar het heen gaat:** bij het **vastzetten** van de volgende factuur van
  die klant (het nummer trekken, vlak voor het versturen) — niet bij het
  klaarzetten van het concept. Op de PDF: Totaal, "Reeds betaald (tegoed)",
  "Nog te betalen". De regels en de btw blijven heel: het is een betaling,
  geen korting. De Mollie-link en de mail gaan over het restbedrag; dekt het
  tegoed alles, dan geen link en "je hoeft niets te betalen".
- **Het saldo** wordt niet bijgehouden maar uitgerekend uit de facturen
  (`factuur_tegoed_uit`) plus wat er met de hand vereffend is
  (`tegoed_boekingen`). Verrekend tegoed telt mee in `betaald_bedrag`, zodat
  alles wat "totaal min betaald" rekent (herinneringen, open bedrag,
  Mollie-melding) vanzelf het restbedrag gebruikt.
- **Scherm:** kaart "Tegoed" in het dossier (tab Facturen) met de knop
  "Tegoed vereffend…". Bij een factuur "Ander bedrag…" / "Betaling boeken…"
  voor een deel of juist te veel.
- Tegoed van facturen (per klant) staat los van het tegoed in de geldloop
  (contant, per adres).

Migratie `20261025090000_tegoed.sql`, proef `supabase/tests/tegoed.sql`.

## Bankbestanden inlezen

Betalingen › Facturen › **Bank inlezen**. Het bestand wordt in de browser
gelezen (`src/lib/bankbestand.ts`): CAMT.053, MT940 (gestructureerd zoals
ING/Rabobank/ABN AMRO, en vrije tekst zoals de Volksbank), de CSV van ASN
(zonder kopregel) en de CSV van ING (met kopregel, kolommen op naam; uit
Mededelingen alleen wat achter "Omschrijving:" staat).
Alleen bijschrijvingen gaan naar de database (`bank_inlezen`), die per stuk:

1. Mollie-uitbetalingen overslaat (die staan al via de Mollie-melding bij de
   facturen);
2. een factuurnummer in de omschrijving zoekt (`2026-0042`, ook met spatie of
   schuine streep, en aan elkaar als het geen datum kan zijn) en daar boekt —
   maar niet op een factuur die al betaald of gecrediteerd is: die komt op het
   lijstje, want het kan ook een afvinkfout zijn;
3. bij een bekende rekening (`klant_ibans`, geleerd bij elke koppeling) boekt
   als het bedrag precies past op één openstaande factuur, of op alles samen;
4. de rest op het lijstje "Om na te kijken" zet, met een voorstel.

Elke boeking staat per factuur in `bank_koppelingen` en is met "Ongedaan
maken" precies terug te draaien.

**Rekeningnummers** (`klant_ibans`) leert de app alleen van een betaling die
op een factuur van die klant geboekt is. In het dossier (tab Facturen) staan
ze onder "Betaalt vanaf", met een knop om er een weg te halen; toevoegen met
de hand kan niet. Gaat een klant in de prullenbak (ook bij een verhuizing),
dan wist een trigger op `klanten.deleted_at` zijn rekeningen: het is een
persoonsgegeven. Hetzelfde bestand twee keer inlezen maakt
niets dubbel; twee echt gelijke overmakingen in één bestand blijven er twee.

Migratie `20261025100000_bank_inlezen.sql`, proef
`supabase/tests/bank_inlezen.sql`.

**Let op:** wie bankbestanden inleest, moet overmakingen niet óók nog met de
hand afvinken. Dan staat de betaling er twee keer en wordt de tweede tegoed.

## Meegenomen

`20261025110000_opnieuw_factureren_herstel.sql`: "opnieuw factureren" na een
creditnota gaf altijd de fout `column g.ordinality does not exist`.

## Uitrollen

1. `supabase db push` (drie migraties).
2. De edge functions `facturen` en `factuur-herinneringen` opnieuw uitrollen
   (`supabase functions deploy facturen factuur-herinneringen`).
3. Daarna `./scripts/types.sh` draaien en kijken of `types.ts` gelijk blijft:
   de nieuwe types zijn met de hand toegevoegd omdat er hier geen gekoppeld
   project was.

## Getest

- De drie proeven in `supabase/tests/` (`tegoed`, `bank_inlezen` en de
  bestaande `loop_*`) op een lokale Postgres 16 met alle migraties.
- De parser met zelfgemaakte voorbeeldbestanden in elk formaat. **Nog niet met
  een echt bestand van ASN of ING**: de kolommen van beide CSV's en de opbouw
  van het MT940-omschrijvingsveld komen uit wat er over die formaten bekend
  is, niet uit een echt afschrift. Het eerste echte bestand is de proef.
- De PDF met tegoed (deels en helemaal gedekt) bekeken.
- Niet in de draaiende app geklikt: daar was hier geen database voor.

## Later

- Een echte bankkoppeling (open banking via een partij als Ponto, Tink of
  Enable Banking) kan de bestand-upload vervangen; `bank_inlezen` en alles
  erachter blijft dan hetzelfde. Voor zover bekend heeft ASN geen eigen
  koppeling voor ondernemers zoals bunq die heeft; nagaan vóór je eraan begint.
- SnelStart en e-Boekhouden hebben allebei een API; daar kunnen de
  banktransacties ook vandaan komen als de bank daar al gekoppeld is.
