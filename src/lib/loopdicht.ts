/**
 * Welke straten op de looplijst dichtgeklapt staan, per gebied. Zo is een
 * straat die je af hebt na het vergrendelen van je telefoon of het herstarten
 * van de app nog steeds dicht.
 *
 * Hoort bij het toestel (localStorage), net als de open straat bij het
 * geldlopen (openstraat.ts). Onthouden op straatnaam: het volgnummer van een
 * straat kan verschuiven als het gebied opnieuw wordt opgehaald.
 */
const SLEUTEL = "wooshy.loop-dicht";
/** Oude gebieden hoeven niet bewaard; een paar is genoeg voor wie wisselt. */
const HOOGUIT = 5;

type Onthouden = Record<string, string[]>;

function lees(): Onthouden {
  try {
    const ruw = JSON.parse(localStorage.getItem(SLEUTEL) ?? "{}") as unknown;
    return ruw && typeof ruw === "object" && !Array.isArray(ruw) ? (ruw as Onthouden) : {};
  } catch {
    // Privémodus, geblokkeerde opslag of een kapotte waarde: niets onthouden.
    return {};
  }
}

/** De straten die in dit gebied dicht stonden. */
export function leesDichteStraten(gebiedId: string): string[] {
  const straten = lees()[gebiedId];
  return Array.isArray(straten) ? straten.filter((s) => typeof s === "string") : [];
}

export function onthoudDichteStraten(gebiedId: string, straten: string[]) {
  // De nieuwste achteraan, zodat de oudste er als eerste uit valt.
  const { [gebiedId]: _oud, ...rest } = lees();
  const nieuw = Object.fromEntries(
    [...Object.entries(rest), [gebiedId, straten] as const].slice(-HOOGUIT),
  );
  try {
    localStorage.setItem(SLEUTEL, JSON.stringify(nieuw));
  } catch {
    /* zie lees() */
  }
}
