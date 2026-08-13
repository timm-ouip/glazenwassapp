# Import controleren en corrigeren

## Wat er nu misgaat

Een cel die per ongeluk grijs was (zoals "€") wordt als straatnaam gelezen. Alle klanten die eronder staan komen dan onder die verkeerde straat terecht, en dat merk je pas na het importeren.

## Wat er komt

### 1. Waarschuwing bij verdachte straatnamen
Na het inlezen krijg je bovenaan een gele waarschuwingsbalk met de straatnamen die waarschijnlijk fout zijn, bijvoorbeeld:
- korter dan 3 tekens (zoals "€", "H", "-")
- alleen cijfers, symbolen of een bedrag
- staat er maar één of twee adressen onder
- ziet eruit als een notitie (H, HD, balkon, …)

Per verdachte straat kies je: **hernoemen**, **samenvoegen met een andere straat uit de lijst**, of **regels weggooien**.

### 2. Voorbeeldlijst wordt bewerkbaar
De tabel onder de knoppen wordt een werklijst in plaats van alleen kijken:
- straat, nummer, notitie, prijs en frequentie zijn per regel aan te passen (klik en typ, zoals in het overzicht)
- prullenbakknop per regel om die klant niet te importeren
- knop om alle regels van één straat in één keer te verwijderen of te hernoemen
- alle rijen zichtbaar (nu maximaal 100), met een teller bovenaan
- pas bij "importeren" gaat de gecorrigeerde lijst naar de database

## Technisch

- `src/routes/importeren.tsx`: `teImporteren` wordt bewerkbare state (`useState` gevuld bij inlezen en bij wijziging van frequentie per tabblad) in plaats van alleen een `useMemo`; elke rij krijgt een stabiel id.
- Nieuwe helper `verdachteStraten(rijen)` die de heuristieken hierboven toepast en een lijst met redenen teruggeeft.
- Bewerken in de tabel hergebruikt `InlineCel` en `NotitieCel`; straat wordt een combobox over de gevonden straatnamen met vrije invoer.
- Bulkacties (hernoemen/samenvoegen/verwijderen per straat) werken puur op de lokale state; de bestaande `importeer()` blijft ongewijzigd behalve dat hij de bewerkte state gebruikt.
