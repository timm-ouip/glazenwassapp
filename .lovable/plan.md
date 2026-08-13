# Compacter vouwblad: minder witruimte per kwart

Ja, daar kan meer op. De lege plek komt niet doordat de tekst al zo klein mogelijk is, maar door hoe de straten nu verdeeld worden.

## Wat er nu gebeurt

- De straten worden zo verdeeld dat elke kolom ongeveer even hoog wordt (balanceren). Daardoor houdt elke kolom een beetje lucht over in plaats van dat één kolom helemaal vol loopt.
- Alle vier de kwarten krijgen dezelfde tekstgrootte, bepaald door het volste kwart. Zit één kwart propvol, dan blijven de andere drie te ruim staan.
- Straten worden nooit gesplitst, dus een lange straat duwt de rest in één keer door.

## Wat ik ga aanpassen

1. **Vullen in plaats van balanceren**: elke kolom wordt tot aan de vouwlijn volgestopt; wat niet meer past schuift door naar de volgende kolom. Witruimte blijft dan alleen achteraan over.
2. **Schaal opzoeken die echt past**: de tekstgrootte wordt stap voor stap vergroot zolang alle straten nog binnen de vier kwarten passen (en verkleind zodra het niet meer past). Zo vult het blad zichzelf maximaal.
3. **Regelhoogte iets krapper** in de printweergave (rijhoogte en randen), zodat er per kolom een paar regels extra bij kunnen.
4. Volgorde van de route blijft gerespecteerd en slepen blijft werken zoals nu.

## Technisch

- In `src/routes/printen.tsx`: `verdeelInBlokken` vervangen door een fill-tot-capaciteit-verdeling die de gemeten blokhoogtes en de beschikbare `kwartHoogte` gebruikt, in plaats van binair zoeken naar een gebalanceerde hoogte.
- De schaalloop koppelen aan die verdeling: bij elke iteratie opnieuw verdelen op de nieuwe `kwartHoogte`, en de schaal verhogen zolang alle groepen in 4 kwarten passen (bovengrens blijft `MAX_SCHAAL`), met demping om heen-en-weer springen te voorkomen.
- Kleine dichtheidswinst in `StraatBlok`: rij-`line-height` en cel-padding iets omlaag.
