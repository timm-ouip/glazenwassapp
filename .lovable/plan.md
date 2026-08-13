# Printlijst: compacter vullen + straten slepen

## Wat er nu gebeurt

De lege ruimte komt niet doordat het "moet" voor de A4: de tekst wordt alleen ooit kleiner gemaakt, nooit groter. Zodra alles past stopt het schalen op 100%, ook als er nog een halve kolom over is. Daarnaast worden de straten over de vier kwarten verdeeld met een ruwe schatting (aantal regels), niet met de echt gemeten hoogte, waardoor het ene kwart vol zit en het andere half leeg.

## Wat ik ga doen

### 1. Vel echt vullen
- Automatisch schalen mag ook omhoog (tot ca. 1,6x), zodat de tekst groter wordt als er ruimte over is en het geheel precies op één A4 blijft.
- De verdeling over de 4 kwarten gebeurt op basis van de werkelijk gemeten hoogte van elke straat, niet op een schatting. Zo raken alle vier de vakken even vol en blijft er geen halve kolom leeg.
- Ook zonder vouwmodus geldt hetzelfde: kolommen worden gelijkmatig gevuld en de tekst schaalt omhoog tot het vel vol is.
- Straten blijven altijd heel: geen vouwlijn of kolomsprong door een straat heen.

### 2. Straten slepen op de printpagina
- Elke straat op de printpagina krijgt een sleepgreep (zichtbaar op het scherm, niet bij het afdrukken).
- Je kunt een straat oppakken en op een andere plek neerzetten, ook in een ander kwart of een andere kolom.
- De nieuwe volgorde wordt opgeslagen als de vaste routevolgorde, dus het overzichtsscherm laat daarna dezelfde volgorde zien.
- "Ongedaan maken" (knop en Ctrl/Cmd+Z) werkt ook voor slepen op de printpagina.
- Na het slepen wordt de indeling opnieuw doorgerekend zodat het weer strak op één vel past.

## Technisch
- `src/routes/printen.tsx`: `verdeelInKwarten` vervangen door een verdeling op gemeten straathoogtes (meting in een verborgen laag, daarna verdelen); schaalzoekfunctie toestaan boven 1 met binaire benadering in plaats van alleen verkleinen.
- `@dnd-kit` (al in het project) toevoegen aan de printpagina; drop-resultaat schrijft `sort_order` op `streets` via dezelfde mutatie als in `src/routes/index.tsx`, en registreert de actie in `src/lib/undo.ts`.
- Sleepgrepen krijgen `print:hidden`.
