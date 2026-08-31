/**
 * Postcode opzoeken bij de PDOK Locatieserver — de open adressendienst van
 * de overheid. Gratis, geen sleutel, en CORS staat open.
 *
 * De gewone vrije zoekopdracht (`q=Kerkstraat 1 Amersfoort`) is te vaag: die
 * geeft ook buurnummers en gelijknamige straten in andere steden terug. Met
 * harde filters (`fq`) krijg je precies één treffer of niets, en dat is wat
 * we willen — liever niks invullen dan een verkeerde postcode.
 */

/** De velden die we bij de Locatieserver opvragen (`fl=`). */
interface PdokDoc {
  postcode?: string;
  straatnaam?: string;
  huisnummer?: number;
  huisletter?: string;
  huisnummertoevoeging?: string;
  woonplaatsnaam?: string;
}

const BASIS = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

/** Na zoveel milliseconden geven we het op. */
const TIMEOUT_MS = 8000;

/**
 * Haalt JSON op met een eigen tijdslimiet. De Locatieserver knijpt af bij te
 * veel verzoeken achter elkaar en laat een verzoek dan dertig seconden hangen
 * voordat er een 504 komt; zo lang wachten we niet.
 *
 * Geeft `null` terug als het misging — dat is iets anders dan een leeg
 * resultaat, en de aanroeper hoort dat verschil te kunnen zien.
 */
async function haalOp<T>(url: URL, signal?: AbortSignal): Promise<T | null> {
  const klok = new AbortController();
  const tijd = setTimeout(() => klok.abort(), TIMEOUT_MS);
  const stop = () => klok.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetch(url, { signal: klok.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(tijd);
    signal?.removeEventListener("abort", stop);
  }
}

export interface AdresVraag {
  straat: string;
  huisnummer: string;
  plaats: string;
}

export interface AdresTreffer {
  postcode: string;
  plaats: string;
}

/** "3811CV" → "3811 CV"; dat is hoe mensen het op post schrijven. */
function netjes(postcode: string) {
  const p = postcode.replace(/\s+/g, "").toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : postcode;
}

/**
 * Splitst "12a" of "61 bis" in het getal en de rest. De Locatieserver kent
 * huisletter (één letter) en huisnummertoevoeging apart; we filteren alleen
 * op het getal en vergelijken de rest zelf, want zo'n toevoeging wordt in de
 * praktijk op te veel manieren geschreven om hard op te filteren.
 */
function splitsNummer(huisnummer: string) {
  const m = huisnummer.trim().match(/^(\d+)\s*(.*)$/);
  if (!m) return null;
  return { nummer: Number(m[1]), toevoeging: (m[2] ?? "").replace(/[\s-]/g, "").toLowerCase() };
}

function quote(waarde: string) {
  return `"${waarde.replace(/"/g, "")}"`;
}

/**
 * Zoekt de postcode bij straat + huisnummer + plaats. Geeft `null` bij geen
 * of meerdere treffers, en bij elke fout — de gebruiker kan altijd zelf
 * typen, dus een mislukte opzoeking mag nooit in de weg zitten.
 */
export async function zoekAdres(
  { straat, huisnummer, plaats }: AdresVraag,
  signal?: AbortSignal,
): Promise<AdresTreffer | null> {
  const nr = splitsNummer(huisnummer);
  if (!straat.trim() || !plaats.trim() || !nr) return null;

  const url = new URL(BASIS);
  url.searchParams.set("q", "*:*");
  url.searchParams.append("fq", "type:adres");
  url.searchParams.append("fq", `straatnaam:${quote(straat.trim())}`);
  url.searchParams.append("fq", `huisnummer:${nr.nummer}`);
  url.searchParams.append("fq", `woonplaatsnaam:${quote(plaats.trim())}`);
  url.searchParams.set("rows", "25");
  url.searchParams.set(
    "fl",
    "postcode,straatnaam,huisnummer,huisletter,huisnummertoevoeging,woonplaatsnaam",
  );

  // Offline, geblokkeerd of afgebroken: gewoon niets invullen.
  const json = await haalOp<{ response?: { docs?: PdokDoc[] } }>(url, signal);
  if (!json) return null;
  const docs = json.response?.docs ?? [];

  // Bij een toevoeging pakken we de bijpassende; zonder toevoeging het kale
  // nummer. Blijft er meer dan één over, dan gokken we niet.
  const passend = docs.filter((d) => {
    const rest = `${d.huisletter ?? ""}${d.huisnummertoevoeging ?? ""}`
      .replace(/[\s-]/g, "")
      .toLowerCase();
    return rest === nr.toevoeging;
  });
  const kandidaten = passend.length > 0 ? passend : nr.toevoeging === "" ? docs : [];
  if (kandidaten.length !== 1) return null;

  const treffer = kandidaten[0]!;
  if (!treffer.postcode) return null;
  return { postcode: netjes(treffer.postcode), plaats: treffer.woonplaatsnaam ?? plaats.trim() };
}

const SUGGEST = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest";

/**
 * Officiële straatnamen die op `zoekterm` lijken, binnen één plaats.
 *
 * Nodig omdat de wijklijst afkortingen gebruikt ("Othilde" voor "Gravin
 * Othildehof"). Zo'n afkorting vindt de postcode-opzoeking nooit; met deze
 * suggesties kiest de gebruiker de officiële naam in het klantadres, terwijl
 * de wijklijst zijn eigen korte namen houdt.
 */
export async function zoekStraten(
  zoekterm: string,
  plaats: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  if (zoekterm.trim().length < 2 || !plaats.trim()) return [];

  const url = new URL(SUGGEST);
  url.searchParams.set("q", zoekterm.trim());
  url.searchParams.append("fq", "type:weg");
  url.searchParams.append("fq", `woonplaatsnaam:${quote(plaats.trim())}`);
  url.searchParams.set("rows", "8");

  const json = await haalOp<{ response?: { docs?: { weergavenaam?: string }[] } }>(url, signal);
  // null betekent: de dienst deed het niet. Dat is iets anders dan "deze
  // straat bestaat niet", en het scherm dat namen aanvult moet dat weten.
  if (!json) return null;
  // weergavenaam is "Gravin Othildehof, 's-Gravenhage" — alleen de straat.
  return (json.response?.docs ?? [])
    .map((d) => (d.weergavenaam ?? "").split(",")[0]?.trim() ?? "")
    .filter(Boolean);
}

/**
 * Woonplaatsen die op `zoekterm` lijken — voor het plaatsveld bij een wijk.
 *
 * De weergavenaam is "Hoogland, Amersfoort, Utrecht" (plaats, gemeente,
 * provincie); alleen het eerste deel is de woonplaatsnaam waarop de
 * adressenzoekopdracht filtert.
 */
export async function zoekWoonplaatsen(zoekterm: string, signal?: AbortSignal): Promise<string[]> {
  if (zoekterm.trim().length < 2) return [];

  const url = new URL(SUGGEST);
  url.searchParams.set("q", zoekterm.trim());
  url.searchParams.append("fq", "type:woonplaats");
  url.searchParams.set("rows", "8");

  const json = await haalOp<{ response?: { docs?: { weergavenaam?: string }[] } }>(url, signal);
  const namen = (json?.response?.docs ?? [])
    .map((d) => (d.weergavenaam ?? "").split(",")[0]?.trim() ?? "")
    .filter(Boolean);
  return [...new Set(namen)];
}

/** Sleutel waarop een huisnummer met toevoeging te herkennen is: "12a". */
export function nummerSleutel(huisnummer: number | string, toevoeging = ""): string {
  return `${huisnummer}${toevoeging}`.replace(/[\s-]/g, "").toLowerCase();
}

/**
 * Alle postcodes van één straat in één keer.
 *
 * Veel sneller — en veel vriendelijker voor de Locatieserver — dan per
 * huisnummer vragen: een straat van veertig huizen kost zo één verzoek in
 * plaats van veertig. Geeft `null` terug als de dienst het liet afweten, zodat
 * de aanroeper dat kan onderscheiden van "deze straat staat er niet in".
 */
export async function zoekStraatPostcodes(
  straat: string,
  plaats: string,
  signal?: AbortSignal,
): Promise<Map<string, string> | null> {
  if (!straat.trim() || !plaats.trim()) return new Map();

  const uit = new Map<string, string>();
  // rows boven de honderd weigert de dienst met een 400, dus in stukjes.
  const PER_KEER = 100;
  let start = 0;

  while (true) {
    const url = new URL(BASIS);
    url.searchParams.set("q", "*:*");
    url.searchParams.append("fq", "type:adres");
    url.searchParams.append("fq", `straatnaam:${quote(straat.trim())}`);
    url.searchParams.append("fq", `woonplaatsnaam:${quote(plaats.trim())}`);
    url.searchParams.set("rows", String(PER_KEER));
    url.searchParams.set("start", String(start));
    url.searchParams.set("fl", "huisnummer,huisletter,huisnummertoevoeging,postcode");

    const json = await haalOp<{ response?: { numFound?: number; docs?: PdokDoc[] } }>(url, signal);
    if (!json) return null;

    const docs = json.response?.docs ?? [];
    for (const d of docs) {
      if (d.huisnummer === undefined || !d.postcode) continue;
      const toevoeging = `${d.huisletter ?? ""}${d.huisnummertoevoeging ?? ""}`;
      uit.set(nummerSleutel(d.huisnummer, toevoeging), netjes(d.postcode));
    }

    start += PER_KEER;
    if (docs.length < PER_KEER || start >= (json.response?.numFound ?? 0)) break;
  }

  return uit;
}
