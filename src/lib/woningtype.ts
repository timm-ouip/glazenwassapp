/**
 * Het woningtype schatten uit de omtrek van de panden in de BAG.
 *
 * Puur rekenwerk, zonder fetch: de panden komen uit src/lib/bag.ts, in RD
 * (EPSG:28992, meters). Plan: .omc/plans/klanten-lopen.md, §6.
 *
 * - Buur: de rand van A ligt binnen 0,3 m van de rand van B over minstens
 *   2 m, als B een adres heeft. Een pand zonder adres (garage, schuur) telt
 *   pas als buur bij minstens 4 m gedeelde muur.
 * - Vaste buur: een buur waarvan de gedeelde muur voor allebei minstens half
 *   zo lang is als hun langste gedeelde muur. Een korte schakel (een garage
 *   tussen twee blokken) telt voor het type niet mee.
 * - Type: meer dan één verblijfsobject → appartement; geen buren →
 *   vrijstaand; twee of meer vaste buren → tussen; precies één vaste buur B:
 *   heeft B nog een andere vaste buur → hoek, anders twee_onder_een_kap.
 * - Alleen een pand met een woonfunctie krijgt een type.
 *
 * Het blijft een schatting: een hoekhuis in een gesloten bouwblok wordt
 * "tussen", en een rijtjeshuis met een steegje ernaast "hoek".
 * Daarom staat er op het scherm "geschat" en is het met één tik te verbeteren.
 */

export type Woningtype = "vrijstaand" | "twee_onder_een_kap" | "hoek" | "tussen" | "appartement";

export const WONINGTYPEN: { waarde: Woningtype; label: string; meervoud: string }[] = [
  { waarde: "vrijstaand", label: "vrijstaand", meervoud: "vrijstaande woningen" },
  { waarde: "twee_onder_een_kap", label: "2-onder-1-kap", meervoud: "twee-onder-een-kapwoningen" },
  { waarde: "hoek", label: "hoekwoning", meervoud: "hoekwoningen" },
  { waarde: "tussen", label: "tussenwoning", meervoud: "tussenwoningen" },
  { waarde: "appartement", label: "appartement", meervoud: "appartementen" },
];

const TYPE_SET = new Set<string>(WONINGTYPEN.map((t) => t.waarde));

/** Een tekst uit de database als woningtype, of null als het er geen is. */
export function alsWoningtype(waarde: string | null | undefined): Woningtype | null {
  return waarde && TYPE_SET.has(waarde) ? (waarde as Woningtype) : null;
}

/** "tussenwoning"; bij meer dan één "tussenwoningen". */
export function woningtypeLabel(t: Woningtype, aantal = 1): string {
  const def = WONINGTYPEN.find((x) => x.waarde === t);
  if (!def) return t;
  return aantal === 1 ? def.label : def.meervoud;
}

/** [x, y] in RD-meters. */
export type Punt = [number, number];

export interface PandVorm {
  /** Elke unieke sleutel; bag.ts gebruikt het feature-id. */
  id: string;
  /** De buitenrand en eventuele gaten, in RD. Open of gesloten ring maakt niet uit. */
  ringen: Punt[][];
  aantal_verblijfsobjecten: number;
  /** Zit er een woning in? Alleen dan krijgt het pand een type. */
  woon: boolean;
}

/** Binnen deze afstand liggen twee randen tegen elkaar (meters). */
const MARGE = 0.3;
/** Om de zoveel meter kijken we langs de rand. */
const STAP = 0.5;
/** Zoveel gedeelde muur maakt een pand met adres een buur. */
const MUUR_MET_ADRES = 2;
/** Zoveel gedeelde muur maakt een pand zonder adres (garage, schuur) een buur. */
const MUUR_ZONDER_ADRES = 4;
/** Een buur zit er echt aan vast als de muur minstens dit deel van de langste is. */
const DEEL_VAST = 0.5;
/** Afronding van de bemonstering: 2 m moet echt 2 m zijn. */
const SPELING = 1e-6;

type Rand = [Punt, Punt];
type Kader = [number, number, number, number];

function randenVan(ringen: Punt[][]): Rand[] {
  const uit: Rand[] = [];
  for (const ring of ringen) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) uit.push([ring[i]!, ring[i + 1]!]);
    const eerste = ring[0]!;
    const laatste = ring[ring.length - 1]!;
    if (eerste[0] !== laatste[0] || eerste[1] !== laatste[1]) uit.push([laatste, eerste]);
  }
  return uit;
}

function kaderVan(randen: Rand[]): Kader {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [a, b] of randen) {
    for (const [x, y] of [a, b]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function overlapt(a: Kader, b: Kader, marge: number): boolean {
  return (
    a[0] <= b[2] + marge && b[0] <= a[2] + marge && a[1] <= b[3] + marge && b[1] <= a[3] + marge
  );
}

/**
 * Kwadraat van de loodrechte afstand van punt p tot het lijnstuk a–b, of
 * Infinity als de loodlijn naast het lijnstuk valt. Zo telt een gevel die in
 * het verlengde van de buurgevel loopt niet als gedeelde muur.
 */
function afstand2(p: Punt, [a, b]: Rand): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengte2 = dx * dx + dy * dy;
  if (lengte2 === 0) return Infinity;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengte2;
  if (t < 0 || t > 1) return Infinity;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Twee randen lopen evenwijdig als de hoek ertussen kleiner is dan ~30°. */
const EVENWIJDIG = Math.cos((30 * Math.PI) / 180);

/** |cos| van de hoek tussen twee randen (1 = evenwijdig, 0 = haaks). */
function evenwijdig([p, q]: Rand, [a, b]: Rand): number {
  const ux = q[0] - p[0];
  const uy = q[1] - p[1];
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return n === 0 ? 0 : Math.abs(ux * vx + uy * vy) / n;
}

/**
 * Hoeveel meter van de rand van A binnen 0,3 m van de rand van B ligt. De
 * rand van A wordt om de 0,5 m bemonsterd; elk monster telt voor zijn stukje
 * rand. Alleen randen van B die in de buurt liggen én ongeveer evenwijdig
 * lopen tellen: de haakse voor- en achtergevel bij een hoekpunt is geen
 * gedeelde muur.
 */
function muurLangs(a: Rand[], b: Rand[]): number {
  const marge2 = MARGE * MARGE;
  let meter = 0;
  for (const rand of a) {
    const [p, q] = rand;
    const lengte = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (lengte === 0) continue;
    const kader = kaderVan([rand]);
    const dichtbij = b.filter(
      (r) => overlapt(kader, kaderVan([r]), MARGE) && evenwijdig(rand, r) >= EVENWIJDIG,
    );
    if (dichtbij.length === 0) continue;
    const stukken = Math.max(1, Math.ceil(lengte / STAP));
    const stuk = lengte / stukken;
    for (let i = 0; i < stukken; i++) {
      const t = (i + 0.5) / stukken;
      const punt: Punt = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
      if (dichtbij.some((r) => afstand2(punt, r) <= marge2)) meter += stuk;
    }
  }
  return meter;
}

/** De gedeelde muur tussen twee panden, in meters (van beide kanten gemeten, de langste). */
export function gedeeldeMuur(a: Punt[][], b: Punt[][]): number {
  return muurTussen(randenVan(a), randenVan(b));
}

function muurTussen(a: Rand[], b: Rand[]): number {
  return Math.max(muurLangs(a, b), muurLangs(b, a));
}

/** Per pand de id's van zijn buren (zie de regels bovenaan). */
export function burenVan(panden: PandVorm[]): Map<string, string[]> {
  return new Map([...murenVan(panden)].map(([id, muren]) => [id, [...muren.keys()]]));
}

/** Per pand zijn buren, met de lengte van de gedeelde muur in meters. */
function murenVan(panden: PandVorm[]): Map<string, Map<string, number>> {
  const vormen = panden
    .map((pand) => {
      const randen = randenVan(pand.ringen);
      return { pand, randen, kader: kaderVan(randen) };
    })
    .filter((v) => v.randen.length > 0)
    .sort((a, b) => a.kader[0] - b.kader[0]);

  const buren = new Map<string, Map<string, number>>(panden.map((p) => [p.id, new Map()]));
  const drempel = (p: PandVorm) =>
    p.aantal_verblijfsobjecten >= 1 ? MUUR_MET_ADRES : MUUR_ZONDER_ADRES;

  for (let i = 0; i < vormen.length; i++) {
    const a = vormen[i]!;
    // Gesorteerd op de linkerkant: verder naar rechts kan niets meer raken.
    for (let j = i + 1; j < vormen.length && vormen[j]!.kader[0] <= a.kader[2] + MARGE; j++) {
      const b = vormen[j]!;
      if (a.pand.id === b.pand.id || !overlapt(a.kader, b.kader, MARGE)) continue;
      const muur = muurTussen(a.randen, b.randen);
      if (muur + SPELING >= drempel(b.pand)) buren.get(a.pand.id)!.set(b.pand.id, muur);
      if (muur + SPELING >= drempel(a.pand)) buren.get(b.pand.id)!.set(a.pand.id, muur);
    }
  }
  return buren;
}

/** Het geschatte type per pand; null voor een pand zonder woning. */
export function woningtypen(panden: PandVorm[]): Map<string, Woningtype | null> {
  const muren = murenVan(panden);
  const langste = new Map(
    [...muren].map(([id, m]) => [id, m.size > 0 ? Math.max(...m.values()) : 0]),
  );
  // De buren waar het pand echt tegenaan gebouwd is: de gedeelde muur is voor
  // allebei minstens half zo lang als hun langste. Een korte schakel (een
  // garage tussen twee blokken 2-onder-1-kap) valt zo af, van beide kanten.
  const vasteBuren = (id: string): string[] =>
    [...(muren.get(id) ?? [])]
      .filter(
        ([buur, m]) =>
          m + SPELING >= (langste.get(id) ?? 0) * DEEL_VAST &&
          m + SPELING >= (langste.get(buur) ?? 0) * DEEL_VAST,
      )
      .map(([buur]) => buur);
  const uit = new Map<string, Woningtype | null>();
  for (const p of panden) {
    if (!p.woon) {
      uit.set(p.id, null);
      continue;
    }
    if (p.aantal_verblijfsobjecten > 1) {
      uit.set(p.id, "appartement");
      continue;
    }
    const eigen = vasteBuren(p.id);
    if (eigen.length === 0) uit.set(p.id, "vrijstaand");
    else if (eigen.length >= 2) uit.set(p.id, "tussen");
    else {
      const andere = vasteBuren(eigen[0]!).filter((id) => id !== p.id);
      uit.set(p.id, andere.length > 0 ? "hoek" : "twee_onder_een_kap");
    }
  }
  return uit;
}
