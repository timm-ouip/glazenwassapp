/**
 * Zoeken in adressen en klanten, zoals je het intikt.
 *
 * Alles wordt eerst op dezelfde manier platgeslagen — kleine letters, geen
 * accenten, leestekens als spatie — zodat "Lindelaan 12-a", "lindelaan 12a" en
 * "Lindelaan 12 A" allemaal hetzelfde zoeken.
 */

/** "Prins Hendrik-straat 12-A" → "prins hendrik straat 12 a". */
export function zoekSleutel(tekst: string): string {
  return tekst
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Alle manieren waarop een adres getypt kan worden: elke straatnaam die het
 * adres heeft (de werknaam van de wijklijst én de officiële naam) met het
 * huisnummer, met en zonder spatie voor de toevoeging.
 */
export function adresVormen(
  straatnamen: (string | undefined)[],
  nummer: number,
  toevoeging: string,
): string[] {
  const nr = String(nummer);
  const toev = zoekSleutel(toevoeging);
  const namen = new Set(straatnamen.map((n) => zoekSleutel(n ?? "")).filter(Boolean));
  const uit: string[] = [];
  for (const naam of namen) {
    uit.push(`${naam} ${nr}${toev}`);
    if (toev) uit.push(`${naam} ${nr} ${toev}`);
  }
  return uit;
}

/** De velden van één regel als één tekst; de streep houdt velden uit elkaar. */
export function zoekHooiberg(velden: (string | undefined | null)[]): string {
  return velden
    .filter(Boolean)
    .map((v) => zoekSleutel(v!))
    .join("|");
}

/** Eén treffer is genoeg: met twee straten in de zoekbalk wil je ze allebei zien. */
export function zoekPast(hooiberg: string, termen: string[]): boolean {
  return termen.length === 0 || termen.some((t) => hooiberg.includes(t));
}
