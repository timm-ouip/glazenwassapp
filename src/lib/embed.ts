/**
 * Een gekoppelde rij uit een opvraag (bijvoorbeeld adres_prijzen bij een
 * adres). De database-ingang geeft die als los object of als lijstje met één
 * rij, afhankelijk van hoe hij de koppeling herkent. Hier maakt dat niet uit.
 */
export function eenVan<T>(waarde: T | T[] | null | undefined): T | null {
  if (Array.isArray(waarde)) return waarde[0] ?? null;
  return waarde ?? null;
}
