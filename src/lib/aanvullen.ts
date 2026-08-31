import { nummerSleutel, zoekStraatPostcodes, zoekStraten } from "@/lib/postcode";
import type { Customer, Street } from "@/lib/klanten";

/**
 * De twee lussen die de Locatieserver afgaan: officiële straatnamen erbij
 * zoeken, en daarna de postcodes ophalen. Ze staan hier los van het scherm
 * omdat ze op drie plekken draaien — de knop "Straatnamen", de knop
 * "Postcodes", en meteen na een import.
 *
 * Beide lussen doen hetzelfde tegen afknijpen: een pauze tussen de verzoeken,
 * en na drie keer géén antwoord stoppen ze. Doorgaan heeft dan geen zin, en
 * half werk bewaren is beter dan alles weggooien.
 */

const PAUZE_MS = 350;
const HERSTEL_MS = 1500;
const MAX_MISLUKT = 3;

export interface Voortgang {
  /** Hoeveel straten er behandeld zijn. */
  gedaan: number;
  totaal: number;
  /** Straatnamen dan wel postcodes die iets opleverden. */
  gevonden: number;
}

export interface StraatVoorstel {
  street: Street;
  /** Wat er opgeslagen wordt; leeg betekent overslaan. */
  waarde: string;
  /** Andere kandidaten, als PDOK er meer teruggaf. */
  opties: string[];
  aan: boolean;
}

/** Straten zonder officiële naam — die zijn het werk. */
export function stratenZonderNaam(streets: Street[]): Street[] {
  return streets.filter((s) => !s.volledige_naam.trim());
}

/**
 * Straten waarvan de postcodes op te halen zijn: ze hebben een officiële
 * naam, en er hangt minstens één adres zonder postcode aan.
 */
export function stratenZonderPostcode(streets: Street[], customers: Customer[]): Street[] {
  return streets.filter(
    (s) =>
      s.volledige_naam.trim() && customers.some((c) => c.street_id === s.id && !c.postcode.trim()),
  );
}

/**
 * Zoekt bij elke straat de officiële naam op.
 *
 * Geeft voorstellen terug in plaats van ze op te slaan: de zoekopdracht is
 * bewust fuzzy — zo wordt "Othilde" alsnog "Gravin Othildehof" — en juist
 * daarom is één treffer wat anders dan vier. Alleen een eenduidige treffer
 * staat vast aan.
 */
export async function haalStraatnamenOp(
  streets: Street[],
  plaats: string,
  onVoortgang?: (v: Voortgang, voorstellen: StraatVoorstel[]) => void,
): Promise<{ voorstellen: StraatVoorstel[]; afgebroken: boolean }> {
  const voorstellen: StraatVoorstel[] = [];
  let misluktAchtereen = 0;

  for (const [i, street] of streets.entries()) {
    const namen = await zoekStraten(street.name, plaats);

    if (namen === null) {
      if (++misluktAchtereen >= MAX_MISLUKT) {
        return { voorstellen, afgebroken: true };
      }
      await wacht(HERSTEL_MS);
      continue;
    }
    misluktAchtereen = 0;

    voorstellen.push({
      street,
      waarde: namen.length === 1 ? namen[0]! : "",
      opties: namen,
      aan: namen.length === 1,
    });
    onVoortgang?.({ gedaan: i + 1, totaal: streets.length, gevonden: voorstellen.length }, [
      ...voorstellen,
    ]);
    await wacht(PAUZE_MS);
  }

  return { voorstellen, afgebroken: false };
}

/**
 * Haalt de postcodes op van de meegegeven straten.
 *
 * Per straat één verzoek: de Locatieserver geeft alle huisnummers van een
 * straat in één antwoord terug, dus een wijk van veertig straten kost veertig
 * verzoeken in plaats van vierhonderd. `vorig` is er om de wijziging terug te
 * kunnen draaien.
 */
export async function haalPostcodesOp(
  streets: Street[],
  customers: Customer[],
  plaats: string,
  onVoortgang?: (v: Voortgang) => void,
): Promise<{
  wijzigingen: { id: string; postcode: string }[];
  vorig: { id: string; postcode: string }[];
  afgebroken: boolean;
}> {
  const wijzigingen: { id: string; postcode: string }[] = [];
  const vorig: { id: string; postcode: string }[] = [];
  let misluktAchtereen = 0;

  for (const [i, street] of streets.entries()) {
    const kaart = await zoekStraatPostcodes(street.volledige_naam, plaats);

    if (kaart === null) {
      if (++misluktAchtereen >= MAX_MISLUKT) {
        return { wijzigingen, vorig, afgebroken: true };
      }
      await wacht(HERSTEL_MS);
      continue;
    }
    misluktAchtereen = 0;

    for (const c of customers) {
      if (c.street_id !== street.id || c.postcode.trim()) continue;
      const gevonden = kaart.get(nummerSleutel(c.house_number, c.addition));
      if (gevonden) {
        wijzigingen.push({ id: c.id, postcode: gevonden });
        vorig.push({ id: c.id, postcode: c.postcode });
      }
    }

    onVoortgang?.({ gedaan: i + 1, totaal: streets.length, gevonden: wijzigingen.length });
    await wacht(PAUZE_MS);
  }

  return { wijzigingen, vorig, afgebroken: false };
}

function wacht(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
