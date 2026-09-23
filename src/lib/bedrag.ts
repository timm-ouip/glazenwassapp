/**
 * Het rekenwerk achter een bedrag op een tegel: waar het euroteken ophoudt,
 * en hoe groot het getal mag zijn om in zijn vak te passen. Staat los van
 * src/components/Bedrag.tsx, zodat dat bestand alleen het onderdeel zelf
 * bevat en de app tijdens het ontwikkelen blijft verversen.
 */

/** Na het euroteken staat een vaste spatie (U+00A0); \s vangt die ook. */
export function zonderEuro(tekst: string): string {
  return tekst.replace(/^€\s*/u, "");
}

/**
 * Hoe breed elk stuk van een bedrag is, in em, opgemeten in Outfit
 * tabellijnend op een cijferkaart. Een duizendpunt is nog niet half zo breed
 * als een cijfer, dus "1.240.500" is smaller dan negen cijfers zouden doen
 * vermoeden — daarom telt dit ze apart.
 *
 * De maten zijn die van het thema Zakelijk, waar de letters iets ruimer staan
 * (-0,02em tegen -0,045em in Fel). In Fel is het bedrag daardoor een paar
 * procent kleiner dan het had gemogen; dat is niet te zien, en het scheelt een
 * tweede rekensom die ook nog van het thema af zou hangen.
 */
const CIJFER = 0.57;
const DUIZENDPUNT = 0.274;
const EUROTEKEN = 0.502;

/** Er blijft wat marge over, zodat een getal nooit tegen de rand aan tikt. */
const MARGE = 0.97;

/**
 * Hoe groot een getal mag zijn om in zijn vak te passen. Geef het resultaat
 * als `font-size` mee aan een element binnen het vak, dan krimpt een lang
 * bedrag mee en blijft een kort getal op zijn volle maat staan.
 *
 * Niet op schermbreedte: de cijferkaarten staan altijd met z'n drieën naast
 * elkaar, dus rond 640 pixels springt de letter omhoog terwijl de kaart smal
 * blijft — daar viel het bedrag er juist dán uit. `cqi` is een honderdste van
 * de kaart zelf, dus dit klopt bij elke breedte, ook als de zijbalk open- of
 * dichtklapt.
 *
 * Werkt alleen in een vak met `@container` eromheen. Staat dat er niet, dan
 * kijkt `cqi` naar het scherm; door de `min` wordt het getal daar nooit groter
 * van dan het al was, dus er gaat niets stuk.
 */
export function pasIn(waarde: string): string {
  const getal = zonderEuro(waarde);
  const punten = (getal.match(/[.,]/gu) ?? []).length;
  const breedte =
    (getal.length - punten) * CIJFER + punten * DUIZENDPUNT + (getal === waarde ? 0 : EUROTEKEN);
  // Een leeg vakje heeft geen breedte; dan valt er ook niets te krimpen.
  if (breedte <= 0) return "1em";
  return `min(1em, ${((100 * MARGE) / breedte).toFixed(1)}cqi)`;
}
