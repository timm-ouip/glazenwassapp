# Glazenwasser klantenapp — eerste versie

Een webapp (telefoon + laptop) met jouw klantenlijst, filter op even/oneven maand en een nette printlijst voor A4.

## Wat je krijgt

**1. Klantenlijst**
- Klanten gegroepeerd per straat, en binnen de straat gesplitst in even en oneven huisnummers (zoals in je Excel).
- Per klant: huisnummer, toevoeging (bijv. 12a), notitie (vrij tekstveld, met snelknoppen voor veelgebruikte notities zoals H, HD, balkon), prijs, en frequentie.
- Frequentie per klant instelbaar: elke maand / even maand / oneven maand.

**2. Filter**
- Knoppen bovenaan: Alles / Even maand / Oneven maand.
- Ook een zoekveld op straatnaam.

**3. Printlijst**
- Knop "Printlijst maken" met keuze even/oneven maand.
- Nette, compacte opmaak die op A4 past: straatnaam als kop, daaronder de nummers in twee blokken (even / oneven).
- Prijzen standaard verborgen op de print, met een schakelaar "prijzen tonen" als je ze toch wilt meenemen.

**4. Klanten toevoegen en bewerken**
- Handmatig een klant toevoegen, wijzigen of verwijderen.
- Straten toevoegen en de volgorde van straten aanpassen (zodat je looproute klopt).

**5. Excel-import**
- Je uploadt je bestaande Excel-bestand; de app leest straatnaam (grijze kop), huisnummers, notities en prijzen in.
- Voorbeeldweergave vóór het importeren, zodat je ziet wat er binnenkomt en het kunt bevestigen.
- Bij import kies je of dat bestand de even- of oneven-maandlijst is; dat wordt de frequentie van die klanten.

## Wat er later bij komt

Afrekenen (aanvinken wie betaald heeft, totalen per dag). Dat bouwen we nadat deze versie staat.

## Technisch

- Lovable Cloud wordt aangezet voor de database (tabellen `streets` en `customers`) zodat je gegevens bewaard blijven op al je apparaten.
- Import gebeurt in de browser met een xlsx-parser; alleen de bevestigde rijen worden opgeslagen.
- Print via een aparte printweergave met CSS `@media print` (A4, marges, prijskolom verbergbaar).
- Nederlandse teksten in de hele app.

## Open punt

Voorlopig is de app zonder inlog: iedereen met de link ziet de lijst. Zeg het als je wel een inlog wilt, dan voegen we dat toe.
