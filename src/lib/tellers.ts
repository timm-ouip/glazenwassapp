/**
 * Wat de tellers in de vakken het laatst lieten zien, per naam.
 *
 * Daardoor telt een vak ook als je even weg was: pas je een wijk aan en kom je
 * terug op Home, dan loopt het getal van de oude stand naar de nieuwe in
 * plaats van er meteen te staan. Het leeft zolang de app open is; na verversen
 * begint hij blanco en zet hij het nieuwe getal gewoon neer.
 *
 * Het staat hier en niet in het onderdeel zelf, zodat het uitloggen erbij kan
 * zonder dat lib een onderdeel hoeft te kennen.
 */
export const LAATSTE_STANDEN = new Map<string, number>();

/**
 * Bij het uitloggen leegmaken: logt er daarna iemand anders in op dezelfde
 * computer, dan hoort die het bedrag van de vorige niet even te zien staan
 * voordat de teller naar zijn eigen stand loopt.
 */
export function vergeetTellers() {
  LAATSTE_STANDEN.clear();
}
