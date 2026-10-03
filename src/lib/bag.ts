/**
 * Adressen uit de BAG (Basisregistratie Adressen en Gebouwen) ophalen voor
 * "Klanten lopen": per straat de Locatieserver voor de adressen en punten, en
 * per cel van ~200 m de BAG OGC API voor oppervlakte, gebruiksdoel en status.
 *
 * Gewone fetch, geen DOM en geen React — zodat het ook in tests draait. Alles
 * of niets: mislukt één verzoek na de herhalingen, dan geeft `haalStraatAdressen`
 * `null` terug en wordt er niets half bewaard.
 *
 * Daarna (`vulPandgegevens`, voor het hele gebied in één keer) de panden in
 * RD rond de adressen, voor het pand-id en het geschatte woningtype
 * (src/lib/woningtype.ts), en als laatste de 3D BAG voor het aantal
 * bouwlagen. Mislukt dat deel, dan blijven die velden leeg; de adressen zelf
 * gaan gewoon door (de database wist met een lege waarde nooit iets).
 *
 * Kaartmodus (`haalVeelhoekAdressen`): cellen over een getekende veelhoek,
 * met het adres en het punt uit het verblijfsobject zelf.
 */

import { woningtypen, type PandVorm, type Punt, type Woningtype } from "@/lib/woningtype";

const LOCATIESERVER = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
const BAG_VBO = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items";
const BAG_PAND = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items";
const DRIE_D_BAG = "https://api.3dbag.nl/collections/pand/items";
/** De BAG-API wil de RD-naam voluit; "EPSG:28992" geeft een 400. */
const RD_CRS = "http://www.opengis.net/def/crs/EPSG/0/28992";

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
  /** De feature-id's (UUID) van de panden uit `pand.href`; nog niet de pand-identificatie. */
  pand_refs: string[];
  /** BAG pand.identificatie, na `vulPandgegevens`. */
  pand_id: string | null;
  /** Alleen bij een woonfunctie, na `vulPandgegevens`. */
  woningtype: Woningtype | null;
  /** Uit de 3D BAG (b3_bouwlagen), na `vulPandgegevens`. */
  bouwlagen: number | null;
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
  "pand.href"?: string[] | null;
  // Het adres staat er zelf in; dat gebruikt de kaartmodus (geen Locatieserver).
  openbare_ruimte_naam?: string | null;
  openbare_ruimte_naam_kort?: string | null;
  woonplaats_naam?: string | null;
  huisnummer?: number | null;
  huisletter?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
}

interface VboFeature {
  properties?: VboEigenschappen;
  /** Een Point in WGS84: [lon, lat]. */
  geometry?: { type?: string; coordinates?: unknown } | null;
}

interface Links {
  links?: { rel?: string; href?: string }[];
}

/** Een pand uit de BAG OGC API v2, met `crs` = RD. */
interface PandFeature {
  /** De UUID waar `pand.href` van een verblijfsobject naar wijst. */
  id?: string;
  properties?: {
    identificatie?: string;
    aantal_verblijfsobjecten?: number;
    status?: string;
  };
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

/** Eén gebouw uit de 3D BAG (CityJSON-feature); `id` = "NL.IMBAG.Pand.<identificatie>". */
interface DrieDFeature {
  id?: string;
  CityObjects?: Record<string, { attributes?: { b3_bouwlagen?: number | null } }>;
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

/**
 * WGS84 (lengte, breedte) naar RD (EPSG:28992), in meters. De benadering van
 * Schreutelkamp en Strang van Hees: binnen ~1 m nauwkeurig in heel Nederland,
 * ruim genoeg voor een bbox.
 */
export function naarRd(lon: number, lat: number): Punt {
  const f = 0.36 * (lat - 52.1551744);
  const l = 0.36 * (lon - 5.38720621);
  const x =
    155000 +
    190094.945 * l -
    11832.228 * f * l -
    114.221 * f * f * l -
    32.391 * l ** 3 -
    0.705 * f -
    2.34 * f ** 3 * l -
    0.608 * f * l ** 3 -
    0.008 * l * l +
    0.148 * f * f * l ** 3;
  const y =
    463000 +
    309056.544 * f +
    3638.893 * l * l +
    73.077 * f * f -
    157.984 * f * l * l +
    59.788 * f ** 3 +
    0.433 * l -
    6.439 * f * f * l * l -
    0.032 * f * l +
    0.092 * l ** 4 -
    0.054 * f * l ** 4;
  return [x, y];
}

/** "https://…/pand/items/9a46dd63-…" naar "9a46dd63-…". */
export function pandRef(href: string): string {
  return href.replace(/\/+$/, "").split("/").pop() ?? "";
}

/** Panden die er niet (meer) staan doen niet mee als buur. */
const PAND_WEG = new Set([
  "Pand gesloopt",
  "Niet gerealiseerd pand",
  "Pand ten onrechte opgevoerd",
]);

/** De ringen van een Polygon of MultiPolygon in RD, alleen x en y. */
function ringenVan(geometrie: PandFeature["geometry"]): Punt[][] {
  const ring = (r: unknown): Punt[] =>
    Array.isArray(r)
      ? r
          .filter(
            (p): p is [number, number] =>
              Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
          )
          .map((p): Punt => [p[0], p[1]])
      : [];
  const c = geometrie?.coordinates;
  if (!Array.isArray(c)) return [];
  if (geometrie?.type === "Polygon") return c.map(ring);
  if (geometrie?.type === "MultiPolygon") {
    return c.flatMap((poly: unknown) => (Array.isArray(poly) ? poly.map(ring) : []));
  }
  return [];
}

/** Een RD-cel van 200 m, voor de panden en de 3D BAG. */
const RD_CEL = 200;
/** Rond de adressen ook de panden tot 30 m verder: het buurhuis net buiten het gebied telt mee. */
const RD_RAND = 30;

function rdCelSleutel([x, y]: Punt): string {
  return `${Math.floor(x / RD_CEL)}_${Math.floor(y / RD_CEL)}`;
}

function rdBboxTekst(b: [number, number, number, number]): string {
  return b.map((n) => n.toFixed(1)).join(",");
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

/**
 * Alle features van een lijst die met `next`-links doorloopt. `genoeg` mag
 * na elke pagina zeggen dat we klaar zijn. `null` = een pagina mislukte.
 */
async function haalPaginas<F>(
  eerste: string,
  signal: AbortSignal | undefined,
  opties: { maxPaginas?: number; genoeg?: (features: F[]) => boolean } = {},
): Promise<F[] | null> {
  const uit: F[] = [];
  let volgende: string | null = eerste;
  // Een vangnet tegen een `next`-keten die nooit ophoudt.
  for (let pagina = 0; volgende && pagina < (opties.maxPaginas ?? 50); pagina++) {
    const json: (Links & { features?: F[] }) | null = await haalOp<Links & { features?: F[] }>(
      volgende,
      signal,
    );
    if (!json) return null;
    const features: F[] = json.features ?? [];
    uit.push(...features);
    if (opties.genoeg?.(features)) break;
    volgende =
      features.length > 0 ? (json.links?.find((l) => l.rel === "next")?.href ?? null) : null;
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
  return haalPaginas<VboFeature>(eerste.toString(), signal);
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
        pand_refs: (p["pand.href"] ?? []).map(pandRef).filter(Boolean),
        pand_id: null,
        woningtype: null,
        bouwlagen: null,
      });
    }
  }

  return ontdubbel(rijen).sort(
    (a, b) => a.huisnummer - b.huisnummer || a.toevoeging.localeCompare(b.toevoeging),
  );
}

/** ~30 m rond de veelhoek, in graden op 52°N. */
const VEELHOEK_RAND_LON = 0.00045;
const VEELHOEK_RAND_LAT = 0.00027;
/** Groter dan dit (bbox van de veelhoek, of aantal adressen) halen we niet op. */
const MAX_VEELHOEK_KM2 = 2;
const MAX_VEELHOEK_ADRESSEN = 6000;
const MAX_VEELHOEK_CELLEN = 100;
export const TE_GROOT = "Dit gebied is te groot; maak het kleiner.";

/** Het punt van een verblijfsobject: een Point, of het midden van een vlak. */
function vboPunt(geometrie: VboFeature["geometry"]): [number, number] | null {
  const c = geometrie?.coordinates;
  if (geometrie?.type === "Point" && Array.isArray(c)) {
    const [lon, lat] = c as unknown[];
    return typeof lon === "number" && typeof lat === "number" ? [lon, lat] : null;
  }
  if (geometrie?.type === "Polygon" && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = (c[0] as unknown[]).filter(
      (p): p is [number, number] =>
        Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
    );
    if (ring.length === 0) return null;
    const som = ring.reduce((t, p) => [t[0] + p[0], t[1] + p[1]], [0, 0]);
    return [som[0] / ring.length, som[1] / ring.length];
  }
  return null;
}

/**
 * Alle woningen en bedrijfspanden binnen een op de kaart getekende veelhoek
 * (`ring` in [lon, lat], WGS84), met pand, woningtype en bouwlagen erbij.
 *
 * Cellen van ~200 m over de bbox van de veelhoek (+ ~30 m); een adres doet
 * mee als zijn BAG-punt binnen de veelhoek ligt. Het adres zelf komt uit het
 * verblijfsobject, er is hier geen Locatieserver nodig.
 *
 * `null` = het ophalen mislukte (ook bij afbreken). Is het gebied te groot
 * (bbox > 2 km², meer dan 100 cellen of meer dan 6000 adressen), dan een
 * fout met {@link TE_GROOT}.
 */
export async function haalVeelhoekAdressen(
  ring: [number, number][],
  opties: BagOpties = {},
): Promise<BagAdres[] | null> {
  const { onVoortgang, signal } = opties;
  if (ring.length < 3) return [];

  let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  const breedteM = (maxLon - minLon) * 111320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const hoogteM = (maxLat - minLat) * 110574;
  if ((breedteM * hoogteM) / 1e6 > MAX_VEELHOEK_KM2) throw new Error(TE_GROOT);

  const cellen: string[] = [];
  const [x0, x1] = [minLon - VEELHOEK_RAND_LON, maxLon + VEELHOEK_RAND_LON];
  const [y0, y1] = [minLat - VEELHOEK_RAND_LAT, maxLat + VEELHOEK_RAND_LAT];
  for (let ix = Math.floor(x0 / CEL_LON); ix <= Math.floor(x1 / CEL_LON); ix++) {
    for (let iy = Math.floor(y0 / CEL_LAT); iy <= Math.floor(y1 / CEL_LAT); iy++) {
      cellen.push(`${ix}_${iy}`);
    }
  }
  // Een lange smalle lijn heeft bijna geen oppervlakte, maar wel veel cellen.
  if (cellen.length > MAX_VEELHOEK_CELLEN) throw new Error(TE_GROOT);

  const binnen = new Map<string, BagAdres>();
  let nr = 0;
  for (const sleutel of cellen) {
    nr++;
    onVoortgang?.(`Cel ${nr} van ${cellen.length}`);
    const features = await haalCel(celBbox(sleutel), signal);
    if (!features) return null;

    for (const f of features) {
      const p = f.properties;
      const id = p?.identificatie;
      if (!p || !isVerblijfsobjectId(id) || binnen.has(id!)) continue;
      if (typeof p.huisnummer !== "number") continue;
      if (!houdStatus(p.status) || !soortVanGebruik(p.gebruiksdoel)) continue;
      const punt = vboPunt(f.geometry);
      if (!punt || !binnenVeelhoek(punt, ring)) continue;

      binnen.set(id!, {
        vbo_id: id!,
        straat: (p.openbare_ruimte_naam ?? "").trim(),
        straat_verkort: (p.openbare_ruimte_naam_kort ?? "").trim(),
        woonplaats: (p.woonplaats_naam ?? "").trim(),
        huisnummer: p.huisnummer,
        toevoeging: `${p.huisletter ?? ""}${p.toevoeging ?? ""}`.replace(/\s+/g, "").toUpperCase(),
        postcode: (p.postcode ?? "").replace(/\s+/g, "").toUpperCase(),
        oppervlakte: typeof p.oppervlakte === "number" ? p.oppervlakte : null,
        gebruiksdoel: gebruiksdoelLabel(p.gebruiksdoel),
        lon: punt[0],
        lat: punt[1],
        pand_refs: (p["pand.href"] ?? []).map(pandRef).filter(Boolean),
        pand_id: null,
        woningtype: null,
        bouwlagen: null,
      });
    }
    if (binnen.size > MAX_VEELHOEK_ADRESSEN) throw new Error(TE_GROOT);
  }

  const adressen = [...binnen.values()].sort(
    (a, b) =>
      a.straat.localeCompare(b.straat, "nl") ||
      a.huisnummer - b.huisnummer ||
      a.toevoeging.localeCompare(b.toevoeging),
  );
  const uit = await vulPandgegevens(adressen, opties);
  return signal?.aborted ? null : uit;
}

/** Een pand zoals we het hieronder gebruiken. */
interface Pand {
  identificatie: string;
  ringen: Punt[][];
  aantal_verblijfsobjecten: number;
}

/**
 * Alle panden rond de adressen (cellen van 200 m in RD, met 30 m rand), op
 * feature-id (de UUID uit `pand.href`). `null` = het ophalen mislukte.
 */
async function haalPanden(
  adressen: BagAdres[],
  { onVoortgang, signal }: BagOpties,
): Promise<Map<string, Pand> | null> {
  // Per cel van 200 m de bbox om de adrespunten, plus 30 m rand: zo blijft
  // een straat een smalle strook en geen blok van 260 × 260 m.
  const cellen = new Map<string, [number, number, number, number]>();
  for (const a of adressen) {
    const punt = naarRd(a.lon, a.lat);
    const sleutel = rdCelSleutel(punt);
    const b = cellen.get(sleutel);
    if (!b) cellen.set(sleutel, [punt[0], punt[1], punt[0], punt[1]]);
    else {
      b[0] = Math.min(b[0], punt[0]);
      b[1] = Math.min(b[1], punt[1]);
      b[2] = Math.max(b[2], punt[0]);
      b[3] = Math.max(b[3], punt[1]);
    }
  }
  const panden = new Map<string, Pand>();
  let nr = 0;
  for (const b of cellen.values()) {
    nr++;
    onVoortgang?.(`Panden: cel ${nr} van ${cellen.size}`);
    const url = new URL(BAG_PAND);
    url.searchParams.set(
      "bbox",
      rdBboxTekst([b[0] - RD_RAND, b[1] - RD_RAND, b[2] + RD_RAND, b[3] + RD_RAND]),
    );
    url.searchParams.set("bbox-crs", RD_CRS);
    url.searchParams.set("crs", RD_CRS);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("f", "json");
    const features = await haalPaginas<PandFeature>(url.toString(), signal);
    if (!features) return null;
    for (const f of features) {
      const p = f.properties;
      if (!f.id || !p?.identificatie || (p.status && PAND_WEG.has(p.status))) continue;
      const ringen = ringenVan(f.geometry);
      if (ringen.length === 0 || panden.has(f.id)) continue;
      panden.set(f.id, {
        identificatie: p.identificatie,
        ringen,
        // Onbekend: als één adres, dan wordt het in elk geval geen appartement.
        aantal_verblijfsobjecten:
          typeof p.aantal_verblijfsobjecten === "number" ? p.aantal_verblijfsobjecten : 1,
      });
    }
  }
  return panden;
}

/**
 * Het aantal bouwlagen per pand-identificatie uit de 3D BAG. Die is traag
 * (~50 panden per pagina), dus per RD-cel alleen de bbox om de panden die we
 * nodig hebben, en een cel stopt zodra ze er allemaal zijn. Mislukt een
 * verzoek, dan houden we wat er al was.
 */
async function haalBouwlagen(
  nodig: Map<string, Pand>,
  { onVoortgang, signal }: BagOpties,
): Promise<Map<string, number>> {
  const perCel = new Map<string, Pand[]>();
  for (const p of nodig.values()) {
    const eerste = p.ringen[0]?.[0];
    if (!eerste) continue;
    const sleutel = rdCelSleutel(eerste);
    const lijst = perCel.get(sleutel);
    if (lijst) lijst.push(p);
    else perCel.set(sleutel, [p]);
  }

  const lagen = new Map<string, number>();
  const gezien = new Set<string>();
  const totaal = nodig.size;
  for (const panden of perCel.values()) {
    const open = new Set(panden.map((p) => p.identificatie).filter((id) => !gezien.has(id)));
    if (open.size === 0) continue;
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of panden) {
      for (const ring of p.ringen) {
        for (const [x, y] of ring) {
          box[0] = Math.min(box[0], x);
          box[1] = Math.min(box[1], y);
          box[2] = Math.max(box[2], x);
          box[3] = Math.max(box[3], y);
        }
      }
    }
    onVoortgang?.(`Verdiepingen uit de 3D BAG: ${gezien.size} van ${totaal} panden`);
    const url = new URL(DRIE_D_BAG);
    url.searchParams.set("bbox", rdBboxTekst([box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1]));
    url.searchParams.set("limit", "100");
    const features = await haalPaginas<DrieDFeature>(url.toString(), signal, {
      maxPaginas: 200,
      genoeg: (pagina) => {
        for (const f of pagina) {
          const id = f.id?.replace(/^NL\.IMBAG\.Pand\./, "");
          if (!id || !nodig.has(id)) continue;
          gezien.add(id);
          open.delete(id);
          const n = f.CityObjects?.[f.id!]?.attributes?.b3_bouwlagen;
          if (typeof n === "number" && n > 0) lagen.set(id, Math.round(n));
        }
        onVoortgang?.(`Verdiepingen uit de 3D BAG: ${gezien.size} van ${totaal} panden`);
        return open.size === 0;
      },
    });
    if (!features) break;
  }
  return lagen;
}

/**
 * Vult bij de adressen van een heel gebied het pand-id, het geschatte
 * woningtype (alleen bij een woonfunctie) en het aantal bouwlagen in.
 *
 * Geeft altijd de adressen terug: mislukken de panden, dan blijven pand-id en
 * woningtype leeg; mislukt de 3D BAG, dan alleen de bouwlagen. Afbreken
 * (`signal`) geeft ook de adressen terug; de aanroeper kijkt zelf of hij
 * moet stoppen.
 */
export async function vulPandgegevens(
  adressen: BagAdres[],
  opties: BagOpties = {},
): Promise<BagAdres[]> {
  if (adressen.length === 0) return adressen;
  const panden = await haalPanden(adressen, opties);
  if (!panden) return adressen;

  // Per adres het eerste pand dat we kennen.
  const pandVan = (a: BagAdres) => a.pand_refs.find((ref) => panden.has(ref));
  const woonPanden = new Set<string>();
  for (const a of adressen) {
    const ref = pandVan(a);
    if (ref && a.gebruiksdoel === "woonfunctie") woonPanden.add(ref);
  }
  const vormen: PandVorm[] = [...panden].map(([ref, p]) => ({
    id: ref,
    ringen: p.ringen,
    aantal_verblijfsobjecten: p.aantal_verblijfsobjecten,
    woon: woonPanden.has(ref),
  }));
  const typen = woningtypen(vormen);

  const nodig = new Map<string, Pand>();
  for (const a of adressen) {
    const ref = pandVan(a);
    if (ref) nodig.set(panden.get(ref)!.identificatie, panden.get(ref)!);
  }
  const lagen = opties.signal?.aborted
    ? new Map<string, number>()
    : await haalBouwlagen(nodig, opties);

  return adressen.map((a) => {
    const ref = pandVan(a);
    if (!ref) return a;
    const pand = panden.get(ref)!;
    return {
      ...a,
      pand_id: pand.identificatie,
      woningtype: a.gebruiksdoel === "woonfunctie" ? (typen.get(ref) ?? null) : null,
      bouwlagen: lagen.get(pand.identificatie) ?? null,
    };
  });
}
