# Wijken toevoegen

## Wat je krijgt

- Bovenaan het overzicht een **keuzemenu wijken**: je kiest een wijk en ziet alleen de straten en klanten van die wijk.
- Knop **Wijk toevoegen** (en hernoemen/verwijderen) naast het keuzemenu.
- Een nieuwe straat maak je direct in de tabel aan (zoals een nieuw huisnummer, zonder apart scherm); hij valt automatisch onder de wijk die je op dat moment open hebt staan.
- De **printlijst** print de gekozen wijk (dus één wijk per A4, zoals nu één Excel-bestand per wijk).
- Bij **importeren** kies je vooraf de wijk waar het Excel-bestand in geladen wordt.
- Slepen (volgorde van straten en regels) blijft werken, maar dan binnen de gekozen wijk.
- Je keuze van wijk blijft staan als je tussen overzicht en printen wisselt.

## Bestaande gegevens

Alle straten die er nu staan komen automatisch in één standaardwijk ("Wijk 1"), die je daarna kunt hernoemen. Er gaat niets verloren.

## Is het veilig om je echte lijst te importeren?

Kort: voor namen, adressen en prijzen is dit prima, met één kanttekening.

- Je gegevens staan in je eigen beveiligde database in de cloud (niet in een bestand op een openbare site) en worden versleuteld opgeslagen en verstuurd.
- **Maar**: de app heeft nu bewust geen login, zodat je snel kunt werken. Wie de link van je app kent, kan de lijst zien en aanpassen. De link is niet te raden en staat nergens gepubliceerd, maar is niet afgeschermd.
- Advies: importeer gerust je echte lijst, en laat mij daarna een simpele login (e-mail + wachtwoord, alleen voor jou) toevoegen voordat je de app publiceert of op meerdere apparaten gebruikt. Ook goed om te weten: zet er geen gegevens in die je echt niet kwijt wilt raken zonder login, zoals telefoonnummers of sleutelafspraken.

Zeg het als je wilt dat ik de login meteen meeneem in deze stap.

## Technisch

- Migratie: tabel `public.districts` (naam, sort_order, timestamps) met GRANTs + RLS-policy gelijk aan de andere tabellen; kolom `district_id` op `public.streets` (FK naar districts). Standaardwijk aanmaken en bestaande straten daaraan koppelen in dezelfde migratie, daarna kolom NOT NULL.
- `src/lib/klanten.ts`: `District`-type, `fetchDistricts`, `addDistrict`, `renameDistrict`, `deleteDistrict` (alleen als leeg), `fetchStreets(districtId)` filtert op wijk.
- `src/routes/index.tsx`: wijkselector (Select) + WijkDialog; straten/klanten gefilterd op actieve wijk; actieve wijk in URL-searchparam zodat printen en herladen de keuze behouden.
- `src/components/StraatDialog.tsx`: wijkkeuze bij nieuwe straat (default = actieve wijk).
- `src/routes/printen.tsx`: leest wijk uit searchparam, print alleen die wijk, titel toont wijknaam.
- `src/routes/importeren.tsx`: wijkkeuze (bestaand of nieuw aanmaken) vóór import; nieuwe straten krijgen die `district_id`.
