/**
 * Invoer netjes wegschrijven, hoe je hem ook intypt.
 *
 * Dit gebeurt bij het opslaan en niet terwijl je typt: anders springt de
 * cursor of verandert er iets onder je handen. Wat er al in de database
 * staat, laten we met rust — een straatnaam die ooit in hoofdletters is
 * ingelezen blijft zoals hij is.
 */

/** "1234ab", "1234 ab" of " 1234AB " → "1234 AB". Wat er niet op lijkt, blijft zoals het is. */
export function netjesPostcode(waarde: string): string {
  const kaal = waarde.replace(/\s+/g, "").toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(kaal) ? `${kaal.slice(0, 4)} ${kaal.slice(4)}` : waarde.trim();
}

/**
 * Een straatnaam begint met een hoofdletter. De rest laten we staan: "de
 * Ruijterstraat" hoort geen "De Ruijterstraat" te worden, en een naam die
 * helemaal in hoofdletters is ingevoerd blijft zo.
 */
export function netjesStraat(waarde: string): string {
  const naam = waarde.trim();
  if (!naam) return naam;
  // De IJ is in het Nederlands één letter: het Kadaster schrijft
  // "IJsselstraat", niet "Ijsselstraat".
  if (/^ij/i.test(naam)) return "IJ" + naam.slice(2);
  return naam[0]!.toLocaleUpperCase("nl-NL") + naam.slice(1);
}

/** E-mailadressen zijn niet hoofdlettergevoelig; kleine letters leest rustiger. */
export function netjesEmail(waarde: string): string {
  return waarde.trim().toLowerCase();
}

/**
 * Hetzelfde, maar dan op naam van het veld. Zo hoeft elke plek die een klant
 * of een adres wegschrijft niet zelf te weten welk veld welke behandeling
 * krijgt; wat hier niet in staat, wordt alleen ontdaan van spaties.
 */
export function netjesVeld(veld: string, waarde: string): string {
  if (veld === "email" || veld === "email2") return netjesEmail(waarde);
  if (veld === "postcode") return netjesPostcode(waarde);
  if (veld === "straat") return netjesStraat(waarde);
  return waarde.trim();
}
