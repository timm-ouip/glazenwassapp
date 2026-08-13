# Compacter overzicht, Excel-stijl tabel en slepen

Doel: alles compact op één A4 (liggend), bewerken direct in de tabel, en volgorde aanpassen door te slepen.

## 1. Excel-stijl tabel op het scherm

- Strakke, compacte tabel in plaats van de huidige grote kaarten: dunne rasterlijnen, kleine regelhoogte, straatnaam als grijze kopregel over de volle breedte (zoals in je Excel).
- Per straat twee kolommen naast elkaar: even en oneven kant, elk met nummer, notitie en prijs.
- Meerdere straten naast elkaar in kolommen zodat er veel op één scherm past.
- Compactheidsknop (normaal / extra compact) zodat je op de telefoon wat groter kunt lezen.

## 2. Liggend printen op A4

- Printweergave staat standaard op liggend A4 met smalle marges.
- Kolommen worden automatisch gevuld (3 of 4 kolommen naast elkaar, instelbaar) zodat een volle lijst op één vel past.
- Straten worden nooit halverwege afgebroken tenzij ze langer zijn dan een kolom.
- Prijzen aan/uit blijft bestaan; ook een keuze staand/liggend.

## 3. Bewerken in de tabel zelf

- Klik op een cel (nummer, notitie of prijs) en typ direct — zoals in Excel.
- Tab of Enter springt naar de volgende cel, Escape annuleert; wijziging wordt meteen opgeslagen.
- Notitieveld toont snelkeuzes (H, HD, balkon, …) tijdens het typen; je kunt er meerdere tegelijk kiezen en zelf nieuwe snelkeuzes toevoegen die bewaard blijven.
- Onderaan elke straat een lege regel: daarin typen maakt direct een nieuwe klant aan.
- Het bestaande scherm om een klant toe te voegen blijft gewoon bestaan.

## 4. Slepen om volgorde te bepalen

- Straten slepen: pak de grijze straatkop en sleep de hele straat naar een andere plek in de route.
- Klanten slepen: pak een regel en verplaats hem binnen de straat of naar een andere straat (handig voor een deel van een straat).
- Meerdere regels selecteren (klikken met shift) en samen verslepen, zodat je een stuk van een straat in één keer verplaatst.
- Het handmatige volgordenummer verdwijnt uit het straatscherm; de sleepvolgorde bepaalt alles.

## Technisch

- Nieuwe kolom `sort_order` op `customers` (met migratie en eenmalige vulling op huisnummer), en `sort_order` op `streets` wordt bijgewerkt bij slepen (batch-update na loslaten).
- Slepen met `@dnd-kit` (touch-vriendelijk, werkt op telefoon).
- Inline bewerken via eigen lichte cel-component met optimistische update en opslag naar de database; fout = terugdraaien met melding.
- Printweergave krijgt `@page { size: A4 landscape; margin: 8mm }` en CSS-kolommen met `break-inside: avoid`.
