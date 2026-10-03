/**
 * Adressen uit de BAG (Basisregistratie Adressen en Gebouwen) ophalen voor
 * "Klanten lopen": per straat de Locatieserver voor de adressen en punten, en
 * per cel van ~200 m de BAG OGC API voor oppervlakte, gebruiksdoel en status.
 *
 * Gewone fetch, geen DOM en geen React — zodat het ook in tests draait. Alles
 * of niets: mislukt één verzoek na de herhalingen, dan geeft `haalStraatAdressen`
 * `null` terug en wordt er niets half bewaard.
 *
 * Fase 2 voegt pand-id, woningtype en bouwlagen toe aan `BagAdres`.
 */

const LOCATIESERVER = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const BAG_VBO = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items";

/** Na zoveel milliseconden geven we één verzoek op. */
const TIMEOUT_MS = 20000;
/** Wachttijd vóór herhaling 1 en 2 (timeout, 429 of 5xx). */
const PAUZES_MS = [2000, 5000];

/** Een cel is ~200 m: 0,003° lengte × 0,002° breedte (op 52°N). */
const CEL_LON = 0.003;
const CEL_LAT = 0.002;
/** Rand om een cel (~20 m), zodat punten op de celgrens niet door afronding missen. */
const CEL_RAND = 0.0002;

export interface BagAdres {
  vbo_id: string;
  straat: string;
  straat_verkort: string;
  woonplaats: string;
  huisnummer: number;
  /** Huisletter + toevoeging, hoofdletters, zoals `customers.addition`: "A", "A2". */
  toevoeging: string;
  /** Zonder spatie: "2565AV". */
  postcode: string;
  oppervlakte: number | null;
  /** "woonfunctie", of het eerste bedrijfsdoel ("winkelfunctie"). */
  gebruiksdoel: string;
  lon: number;
  lat: number;
}

export interface BagOpties {
  onVoortgang?: (tekst: string) => void;
  signal?: AbortSignal;
}

/** Wat we uit de Locatieserver halen (`fl=`). */
interface LocatieDoc {
  adresseerbaarobject_id?: string;
  centroide_ll?: string;
  huisnummer?: number;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  straatnaam?: string;
  straatnaam_verkort?: string;
  woonplaatsnaam?: string;
}

/** Eigenschappen van een verblijfsobject in de BAG OGC API v2. */
interface VboEigenschappen {
  identificatie?: string;
  status?: string;
  /** Eén tekst, bij meer doelen kommagescheiden: "winkelfunctie,woonfunctie". */
  gebruiksdoel?: string | string[] | null;
  oppervlakte?: number | null;
}

interface VboFeature {
  properties?: VboEigenschappen;
}

interface VboPagina {
  features?: VboFeature[];
  links?: { rel?: string; href?: string }[];
}

// ---------------------------------------------------------------------------
// Zuivere hulpfuncties
// ---------------------------------------------------------------------------

/** Een verblijfsobject-id heeft op teken 5–6 (0-based 4..5) de code `01`. */
export function isVerblijfsobjectId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.length === 16 && id.slice(4, 6) === "01";
}

const STATUSSEN_HOUDEN = new Set([
  "Verblijfsobject in gebruik",
  "Verblijfsobject in gebruik (niet ingemeten)",
  "Verblijfsobject gevormd",
  "Verbouwing verblijfsobject",
]);

/** Houden we dit verblijfsobject op grond van zijn status? */
export function houdStatus(status: string | undefined | null): boolean {
  return !!status && STATUSSEN_HOUDEN.has(status);
}

const BEDRIJFSDOELEN = [
  "winkelfunctie",
  "kantoorfunctie",
  "bijeenkomstfunctie",
  "gezondheidszorgfunctie",
  "onderwijsfunctie",
  "logiesfunctie",
  "sportfunctie",
  "industriefunctie",
];

function doelenLijst(gebruiksdoel: string | string[] | null | undefined): string[] {
  const ruw = Array.isArray(gebruiksdoel) ? gebruiksdoel : (gebruiksdoel ?? "").split(",");
  return ruw.map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/**
 * 'woon' als er een woonfunctie bij zit, 'bedrijf' bij alleen een bedrijfsdoel,
 * en `null` als er alleen "overige gebruiksfunctie" en/of "celfunctie" is (of
 * niets bekends): garageboxen, bergingen en cellen willen we niet.
 */
export function soortVanGebruik(
  gebruiksdoel: string | string[] | null | undefined,
): "woon" | "bedrijf" | null {
  const doelen = doelenLijst(gebruiksdoel);
  if (doelen.includes("woonfunctie")) return "woon";
  if (doelen.some((d) => BEDRIJFSDOELEN.includes(d))) return "bedrijf";
  return null;
}

/** Het label dat in `BagAdres.gebruiksdoel` komt: "woonfunctie" of het eerste bedrijfsdoel. */
function gebruiksdoelLabel(gebruiksdoel: string | string[] | null | undefined): string {
  const doelen = doelenLijst(gebruiksdoel);
  if (doelen.includes("woonfunctie")) return "woonfunctie";
  return doelen.find((d) => BEDRIJFSDOELEN.includes(d)) ?? "";
}

/** Sleutel van de cel (~200 m) waarin een punt valt. */
export function celSleutel(lon: number, lat: number): string {
  return `${Math.floor(lon / CEL_LON)}_${Math.floor(lat / CEL_LAT)}`;
}

/** Hoekpunten van een cel, met rand: [minlon, minlat, maxlon, maxlat]. */
function celBbox(sleutel: string): [number, number, number, number] {
  const [ix, iy] = sleutel.split("_").map(Number) as [number, number];
  return [
    ix * CEL_LON - CEL_RAND,
    iy * CEL_LAT - CEL_RAND,
    (ix + 1) * CEL_LON + CEL_RAND,
    (iy + 1) * CEL_LAT + CEL_RAND,
  ];
}

/** Dubbele rijen eruit, op `vbo_id`: de cellen overlappen, dus dit hoort erbij. */
export function ontdubbel(rijen: BagAdres[]): BagAdres[] {
  const uit = new Map<string, BagAdres>();
  for (const r of rijen) if (!uit.has(r.vbo_id)) uit.set(r.vbo_id, r);
  return [...uit.values()];
}

/**
 * Ray casting: ligt `punt` ([lon, lat]) binnen de veelhoek `ring`? Voor een
 * punt precies op een rand of hoek is het antwoord willekeurig (gewone
 * even/oneven-telling). Een open of gesloten ring maakt niet uit; minder dan
 * drie punten is nooit "binnen".
 */
export function binnenVeelhoek(punt: [number, number], ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  const [x, y] = punt;
  let binnen = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}

/** "POINT(4.2596 52.0728)" naar [lon, lat]. */
function leesPunt(wkt: string | undefined): [number, number] | null {
  const m = wkt?.match(/POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

// ---------------------------------------------------------------------------
// Ophalen
// ---------------------------------------------------------------------------

/** Wacht `ms`, maar stopt meteen als `signal` afgebroken wordt. */
function wacht(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((klaar) => {
    const t = setTimeout(klaar, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        klaar();
      },
      { once: true },
    );
  });
}

/**
 * Haalt JSON op met tijdslimiet en herhalingen (2 s, dan 5 s) bij timeout,
 * 429 en 5xx. Andere fouten (400, 404, kapotte JSON) herhalen we niet. Een
 * afgebroken `signal` stopt meteen. `null` = het is niet gelukt.
 */
async function haalOp<T>(url: URL | string, signal?: AbortSignal): Promise<T | null> {
  for (let poging = 0; poging <= PAUZES_MS.length; poging++) {
    if (signal?.aborted) return null;
    const klok = new AbortController();
    const tijd = setTimeout(() => klok.abort(), TIMEOUT_MS);
    const stop = () => klok.abort();
    signal?.addEventListener("abort", stop);
    let opnieuw = false;
    try {
      const res = await fetch(url, { signal: klok.signal });
      if (res.ok) return (await res.json()) as T;
      opnieuw = res.status === 429 || res.status >= 500;
    } catch {
      // Timeout of netwerkfout: opnieuw, tenzij de gebruiker zelf afbrak.
      opnieuw = !signal?.aborted;
    } finally {
      clearTimeout(tijd);
      signal?.removeEventListener("abort", stop);
    }
    if (!opnieuw || poging === PAUZES_MS.length) return null;
    await wacht(PAUZES_MS[poging]!, signal);
  }
  return null;
}

/** Alle adressen van één straat uit de Locatieserver, in stukken van 100. */
async function haalLocatieDocs(
  straat: string,
  woonplaats: string,
  signal?: AbortSignal,
): Promise<LocatieDoc[] | null> {
  const PER_KEER = 100;
  const uit: LocatieDoc[] = [];
  let start = 0;

  while (true) {
    const url = new URL(LOCATIESERVER);
    url.searchParams.set("q", "*:*");
    url.searchParams.append("fq", "type:adres");
    url.searchParams.append("fq", `straatnaam:"${straat.replace(/"/g, "")}"`);
    url.searchParams.append("fq", `woonplaatsnaam:"${woonplaats.replace(/"/g, "")}"`);
    url.searchParams.set("rows", String(PER_KEER));
    url.searchParams.set("start", String(start));
    url.searchParams.set(
      "fl",
      "adresseerbaarobject_id,centroide_ll,huisnummer,huisletter,huisnummertoevoeging,postcode,straatnaam,straatnaam_verkort,woonplaatsnaam",
    );

    const json = await haalOp<{ response?: { numFound?: number; docs?: LocatieDoc[] } }>(
      url,
      signal,
    );
    if (!json) return null;

    const docs = json.response?.docs ?? [];
    uit.push(...docs);
    start += PER_KEER;
    if (docs.length < PER_KEER || start >= (json.response?.numFound ?? 0)) break;
  }
  return uit;
}

/** Alle verblijfsobjecten in één bbox uit de BAG, `next`-links volgend. */
async function haalCel(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<VboFeature[] | null> {
  const eerste = new URL(BAG_VBO);
  eerste.searchParams.set("bbox", bbox.map((n) => n.toFixed(6)).join(","));
  eerste.searchParams.set("limit", "1000");
  eerste.searchParams.set("f", "json");

  const uit: VboFeature[] = [];
  let volgende: string | null = eerste.toString();
  // Een vangnet tegen een `next`-keten die nooit ophoudt.
  for (let pagina = 0; volgende && pagina < 50; pagina++) {
    const json: VboPagina | null = await haalOp<VboPagina>(volgende, signal);
    if (!json) return null;
    const features: VboFeature[] = json.features ?? [];
    uit.push(...features);
    volgende =
      features.length > 0 ? (json.links?.find((l) => l.rel === "next")?.href ?? null) : null;
  }
  return uit;
}

/**
 * Alle woningen en bedrijfspanden van één straat, uit de BAG.
 *
 * Geeft `null` als het ophalen mislukte (ook bij afbreken) — dat is iets
 * anders dan een lege lijst voor een straat zonder verblijfsobjecten.
 */
export async function haalStraatAdressen(
  straat: string,
  woonplaats: string,
  opties: BagOpties = {},
): Promise<BagAdres[] | null> {
  const { onVoortgang, signal } = opties;
  const naam = straat.trim();
  const plaats = woonplaats.trim();
  if (!naam || !plaats) return [];

  onVoortgang?.(`${naam}: adressen zoeken…`);
  const docs = await haalLocatieDocs(naam, plaats, signal);
  if (!docs) return null;

  // Alleen verblijfsobjecten (geen standplaatsen of ligplaatsen) met een punt.
  const kandidaten = new Map<string, { doc: LocatieDoc; punt: [number, number] }>();
  for (const doc of docs) {
    const id = doc.adresseerbaarobject_id;
    const punt = leesPunt(doc.centroide_ll);
    if (!isVerblijfsobjectId(id) || !punt || doc.huisnummer === undefined) continue;
    if (!kandidaten.has(id!)) kandidaten.set(id!, { doc, punt });
  }

  // Punten in cellen van ~200 m, zodat een lange straat een rij cellen wordt.
  const cellen = new Set<string>();
  for (const { punt } of kandidaten.values()) cellen.add(celSleutel(punt[0], punt[1]));

  const rijen: BagAdres[] = [];
  let nr = 0;
  for (const sleutel of cellen) {
    nr++;
    onVoortgang?.(`${naam}: cel ${nr} van ${cellen.size}`);
    const features = await haalCel(celBbox(sleutel), signal);
    if (!features) return null;

    for (const f of features) {
      const p = f.properties;
      const id = p?.identificatie;
      const kand = id ? kandidaten.get(id) : undefined;
      if (!p || !id || !kand) continue;
      if (!houdStatus(p.status) || !soortVanGebruik(p.gebruiksdoel)) continue;

      const { doc, punt } = kand;
      rijen.push({
        vbo_id: id,
        straat: doc.straatnaam ?? naam,
        straat_verkort: doc.straatnaam_verkort ?? "",
        woonplaats: doc.woonplaatsnaam ?? plaats,
        huisnummer: doc.huisnummer!,
        toevoeging: `${doc.huisletter ?? ""}${doc.huisnummertoevoeging ?? ""}`
          .replace(/\s+/g, "")
          .toUpperCase(),
        postcode: (doc.postcode ?? "").replace(/\s+/g, "").toUpperCase(),
        oppervlakte: typeof p.oppervlakte === "number" ? p.oppervlakte : null,
        gebruiksdoel: gebruiksdoelLabel(p.gebruiksdoel),
        lon: punt[0],
        lat: punt[1],
      });
    }
  }

  return ontdubbel(rijen).sort(
    (a, b) => a.huisnummer - b.huisnummer || a.toevoeging.localeCompare(b.toevoeging),
  );
}
