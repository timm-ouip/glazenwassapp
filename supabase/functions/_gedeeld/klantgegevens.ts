/**
 * Klantgegevens uit een mail: wie is het, en wat weten we nu meer.
 *
 * Paaltje haalt naam, adres en telefoon van de afzender uit de mail (het veld
 * `aanmelding` in paaltje.ts). De rest gebeurt hier, zonder taalmodel:
 *
 *  - `herken`: hoort het mailadres bij geen klant, dan zoeken we de klant op
 *    telefoonnummer, of op adres mét een naam die klopt. Klopt alleen het
 *    adres (een nieuwe bewoner, de buurman), dan is het een gok die een mens
 *    bevestigt.
 *  - `vulAan`: bij een bekende klant de lege vakjes invullen. Wat er al staat
 *    wordt nooit overschreven: een afzender is na te maken. Past het niet meer
 *    in een leeg vak, dan komt het als "anders" naast de mail en kiest een mens.
 *
 * Een klant heeft twee vakjes voor mail en telefoon (vaak mailen of appen de
 * man én de vrouw). Is het eerste vol, dan telt een leeg tweede als leeg vak.
 *
 * Wat hier gebeurt komt in `berichten.klantgegevens`, zodat het naast de mail
 * staat en "Ongedaan maken" (mail-acties) het kan terugdraaien.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type Veld =
  | "naam"
  | "email"
  | "email2"
  | "telefoon"
  | "telefoon2"
  | "straat"
  | "huisnummer"
  | "postcode"
  | "plaats";

export const VELDEN: Veld[] = [
  "naam",
  "email",
  "email2",
  "telefoon",
  "telefoon2",
  "straat",
  "huisnummer",
  "postcode",
  "plaats",
];

export interface Gevonden {
  naam: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  plaats: string;
  telefoon: string;
}

export const GEEN_GEGEVENS: Gevonden = { naam: "", straat: "", huisnummer: "", postcode: "", plaats: "", telefoon: "" };

export interface Herkend {
  klant_id: string;
  via: "telefoon" | "adres";
  /** Het mailadres dat daarom aan de klant gekoppeld is (leeg als de mail er geen had). */
  email: string;
}

/** Dezelfde vorm als `KlantGegevens` in src/lib/berichten.ts. */
export interface KlantGegevens {
  gevonden?: Gevonden;
  herkend?: Herkend;
  toegevoegd?: { klant_id: string; velden: Partial<Record<Veld, string>> };
  anders?: { telefoon?: string; email?: string; adres?: string };
  afgewezen?: string[];
  teruggedraaid?: {
    op: string;
    velden: Partial<Record<Veld, string>>;
    herkend?: Herkend;
    bleven: Veld[];
    /** Waarden (zie `vergelijkbaar`) die Wooshy niet nog eens invult. */
    waarden: string[];
  };
}

export function leesKlantgegevens(waarde: unknown): KlantGegevens {
  return waarde && typeof waarde === "object" && !Array.isArray(waarde) ? (waarde as KlantGegevens) : {};
}

const EMAIL = /^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** "06-12 34 56 78" of "+31 6 12345678" → "0612345678"; leeg als het geen Nederlands nummer lijkt. */
export function telefoonSleutel(tekst: string | null | undefined): string {
  let d = String(tekst ?? "").replace(/\D/g, "");
  if (d.startsWith("0031")) d = `0${d.slice(4)}`;
  else if (d.startsWith("31") && d.length === 11) d = `0${d.slice(2)}`;
  return d.length === 10 && d.startsWith("0") ? d : "";
}

function sleutel(tekst: string | null | undefined): string {
  return String(tekst ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function postcodeSleutel(tekst: string | null | undefined): string {
  const p = String(tekst ?? "").replace(/\s+/g, "").toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(p) ? p : "";
}

/** Waaraan we een teruggedraaide waarde herkennen, wat voor veld het ook is. */
export function vergelijkbaar(waarde: string): string {
  return telefoonSleutel(waarde) || sleutel(waarde);
}

const GEEN_NAAMWOORD = new Set([
  "van", "der", "den", "het", "de", "ter", "ten", "dhr", "mevr", "mevrouw", "meneer", "familie", "fam",
]);

function naamWoorden(naam: string): Set<string> {
  return new Set(
    String(naam ?? "")
      .toLowerCase()
      .split(/[\s,.'&/-]+/)
      .map((w) => w.replace(/[^\p{L}]/gu, ""))
      .filter((w) => w.length >= 3 && !GEEN_NAAMWOORD.has(w)),
  );
}

/** Delen de namen een echt woord (meestal de achternaam)? */
function naamKlopt(a: string, b: string): boolean {
  const woorden = naamWoorden(a);
  for (const w of naamWoorden(b)) if (woorden.has(w)) return true;
  return false;
}

function splitsNummer(tekst: string) {
  const m = String(tekst ?? "").trim().match(/^(\d+)\s*[-/]?\s*(.*)$/);
  if (!m) return null;
  return { nummer: Number(m[1]), toevoeging: (m[2] ?? "").trim() };
}

interface AdresRegel {
  id: string;
  klant_id: string | null;
  inactief_op: string | null;
}

/**
 * Het ene adres dat bij de gegevens hoort, zoals de aanmeldpagina het zoekt
 * (zoekAdresRegel in src/lib/aanmelden.functions.ts): eerst op postcode +
 * huisnummer, anders op straatnaam binnen de wijken waarvan de plaats klopt.
 * Meer dan één treffer is niets.
 */
async function zoekAdres(db: Db, companyId: string, g: Gevonden): Promise<AdresRegel | null> {
  const nr = splitsNummer(g.huisnummer);
  if (!nr) return null;
  const toevoeging = sleutel(nr.toevoeging);
  const past = (c: { house_number: number; addition: string | null }) =>
    c.house_number === nr.nummer && sleutel(c.addition) === toevoeging;

  const pc = postcodeSleutel(g.postcode);
  if (pc) {
    const { data, error } = await db
      .from("customers")
      .select("id,house_number,addition,postcode,klant_id,inactief_op")
      .eq("company_id", companyId)
      .eq("house_number", nr.nummer)
      .is("deleted_at", null);
    if (error) throw new Error(`Adres op postcode zoeken: ${error.message}`);
    const treffers = (data ?? []).filter(
      (c: { postcode: string | null; house_number: number; addition: string | null }) =>
        postcodeSleutel(c.postcode) === pc && past(c),
    );
    if (treffers.length === 1) return treffers[0];
  }

  const naam = sleutel(g.straat);
  if (!naam) return null;
  const { data: wijken, error: wijkFout } = await db
    .from("districts")
    .select("id,plaats")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (wijkFout) throw new Error(`Wijken zoeken: ${wijkFout.message}`);
  const alle = (wijken ?? []) as { id: string; plaats: string | null }[];
  const plaats = sleutel(g.plaats);
  const passend = plaats ? alle.filter((w) => sleutel(w.plaats) === plaats) : [];
  const wijkIds = (passend.length > 0 ? passend : alle).map((w) => w.id);
  if (wijkIds.length === 0) return null;

  // In de database op naam zoeken, niet alle straten ophalen: boven de 1000
  // kapt Supabase een lijst stil af. Twee losse zoekopdrachten in plaats van
  // één .or(): de straatnaam komt uit de mail, en dan geen filtertaal erin.
  const patroon = g.straat.trim().replace(/[\\%_]/g, (t) => `\\${t}`);
  const straatIds: string[] = [];
  for (const kolom of ["name", "volledige_naam"]) {
    const { data: straten, error: straatFout } = await db
      .from("streets")
      .select("id,name,volledige_naam")
      .in("district_id", wijkIds)
      .is("deleted_at", null)
      .ilike(kolom, patroon)
      .limit(20);
    if (straatFout) throw new Error(`Straten zoeken: ${straatFout.message}`);
    for (const s of (straten ?? []) as { id: string; name: string; volledige_naam: string | null }[]) {
      if ((sleutel(s.name) === naam || sleutel(s.volledige_naam) === naam) && !straatIds.includes(s.id)) {
        straatIds.push(s.id);
      }
    }
  }
  if (straatIds.length === 0) return null;

  const { data: adressen, error: adresFout } = await db
    .from("customers")
    .select("id,house_number,addition,klant_id,inactief_op")
    .eq("company_id", companyId)
    .in("street_id", straatIds)
    .eq("house_number", nr.nummer)
    .is("deleted_at", null);
  if (adresFout) throw new Error(`Adres op straat zoeken: ${adresFout.message}`);
  const treffers = (adressen ?? []).filter(past);
  return treffers.length === 1 ? treffers[0] : null;
}

/**
 * Welke klant dit is, als het mailadres bij niemand hoort.
 *
 *  - Telefoonnummer klopt bij precies één klant → herkend.
 *  - Adres klopt en de naam ook → herkend. Alleen het adres → een gok.
 *  - Wijzen telefoon en adres naar twee verschillende klanten → niets.
 *
 * Klanten in `afgewezen` (eerder teruggedraaid bij deze mail) tellen niet.
 */
export async function herken(
  db: Db,
  companyId: string,
  g: Gevonden,
  vanNaam: string,
  afgewezen: string[],
): Promise<{ herkend: { klant_id: string; via: "telefoon" | "adres" } | null; gok: string | null }> {
  const uit = new Set(afgewezen);

  let viaTelefoon: string | null = null;
  const tel = telefoonSleutel(g.telefoon);
  if (tel) {
    // Het nummer van het bedrijf zelf staat soms in een geciteerde mail.
    const { data: bedrijf, error: bedrijfFout } = await db
      .from("companies")
      .select("telefoon")
      .eq("id", companyId)
      .maybeSingle();
    // Onbekend of dit het eigen nummer is: dan niet op telefoon herkennen.
    if (bedrijfFout) console.error("bedrijfsnummer ophalen:", bedrijfFout.message);
    else if (tel !== telefoonSleutel(bedrijf?.telefoon)) {
      // Grof voorfilteren op de laatste cijfers (met ruimte voor spaties en
      // streepjes ertussen), daarna precies vergelijken.
      const patroon = `%${tel.slice(-6).split("").join("%")}%`;
      const { data, error } = await db
        .from("klanten")
        .select("id,telefoon,telefoon2")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .or(`telefoon.ilike.${patroon},telefoon2.ilike.${patroon}`)
        .limit(200);
      if (error) throw new Error(`Klant op telefoon zoeken: ${error.message}`);
      const ids = [
        ...new Set(
          ((data ?? []) as { id: string; telefoon: string; telefoon2: string }[])
            .filter((k) => telefoonSleutel(k.telefoon) === tel || telefoonSleutel(k.telefoon2) === tel)
            .map((k) => k.id),
        ),
      ];
      if (ids.length === 1 && !uit.has(ids[0])) viaTelefoon = ids[0];
    }
  }

  let viaAdres: string | null = null;
  let gok: string | null = null;
  const adres = await zoekAdres(db, companyId, g);
  // Een inactief adres (gestopt, verhuisd) niet: daar woont misschien iemand anders.
  if (adres?.klant_id && !adres.inactief_op && !uit.has(adres.klant_id)) {
    const { data: klant, error } = await db
      .from("klanten")
      .select("id,naam")
      .eq("id", adres.klant_id)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`Klant bij adres: ${error.message}`);
    if (klant) {
      if (naamKlopt(klant.naam, g.naam) || naamKlopt(klant.naam, vanNaam)) viaAdres = klant.id;
      else gok = klant.id;
    }
  }

  if (viaTelefoon && viaAdres && viaTelefoon !== viaAdres) return { herkend: null, gok: null };
  if (viaTelefoon) return { herkend: { klant_id: viaTelefoon, via: "telefoon" }, gok: null };
  if (viaAdres) return { herkend: { klant_id: viaAdres, via: "adres" }, gok: null };
  return { herkend: null, gok };
}

/**
 * Hoort dit mailadres echt bij de klant: op de klant zelf, of door een mens
 * gekoppeld? Een koppeling die Wooshy zelf maakte (bron 'paaltje') telt niet.
 */
export async function zekerGekoppeld(db: Db, companyId: string, email: string, klantId: string): Promise<boolean> {
  const adres = email.trim().toLowerCase();
  if (!adres) return false;
  const { data, error } = await db
    .from("klant_emails")
    .select("id")
    .eq("company_id", companyId)
    .eq("klant_id", klantId)
    .eq("email", adres)
    .in("bron", ["klant", "mens"])
    .limit(1);
  if (error) throw new Error(`Koppeling nakijken: ${error.message}`);
  return (data ?? []).length > 0;
}

function knip(tekst: string, max: number): string {
  return tekst.length <= max ? tekst : tekst.slice(0, max);
}

/**
 * Lege vakjes van een klant invullen met wat in de mail staat. Elk vak alleen
 * als het in de database (nog) leeg is: typt iemand er tegelijk iets in, dan
 * wint die. Waarden in `overslaan` waren eerder teruggedraaid.
 */
export async function vulAan(
  db: Db,
  companyId: string,
  klantId: string,
  g: Gevonden,
  vanEmail: string,
  overslaan: string[],
): Promise<{ toegevoegd: Partial<Record<Veld, string>>; anders: NonNullable<KlantGegevens["anders"]> }> {
  const nee = new Set(overslaan);
  const toegevoegd: Partial<Record<Veld, string>> = {};
  const anders: NonNullable<KlantGegevens["anders"]> = {};

  const { data, error } = await db
    .from("klanten")
    .select("id,naam,email,email2,telefoon,telefoon2,straat,huisnummer,postcode,plaats")
    .eq("id", klantId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Klant ophalen: ${error.message}`);
  if (!data) return { toegevoegd, anders };
  const k = data as Record<Veld, string>;

  const vul = async (veld: Veld, waarde: string): Promise<boolean> => {
    if (String(k[veld] ?? "").trim()) return false;
    const { data: gezet, error: fout } = await db
      .from("klanten")
      .update({ [veld]: waarde })
      .eq("id", klantId)
      .eq("company_id", companyId)
      .eq(veld, "")
      .select("id");
    if (fout) throw new Error(`Klant aanvullen (${veld}): ${fout.message}`);
    if (!gezet?.length) return false;
    toegevoegd[veld] = waarde;
    k[veld] = waarde;
    return true;
  };

  // Telefoon: in het eerste lege vak, tenzij hij er al staat.
  const telefoon = knip(g.telefoon.trim(), 40);
  const tel = telefoonSleutel(telefoon);
  if (tel && !nee.has(tel) && tel !== telefoonSleutel(k.telefoon) && tel !== telefoonSleutel(k.telefoon2)) {
    if (!(await vul("telefoon", telefoon)) && !(await vul("telefoon2", telefoon))) anders.telefoon = telefoon;
  }

  // Mailadres van de afzender: net zo.
  const email = vanEmail.trim().toLowerCase();
  if (EMAIL.test(email) && email.length <= 254 && !nee.has(email) && email !== sleutel(k.email) && email !== sleutel(k.email2)) {
    if (!(await vul("email", email)) && !(await vul("email2", email))) anders.email = email;
  }

  const naam = knip(g.naam.trim(), 120);
  if (naam && !nee.has(sleutel(naam))) await vul("naam", naam);

  // Postadres: alleen als er nog helemaal geen staat. Een ander adres kan ook
  // een tweede pand zijn; dat laten we zien in plaats van overschrijven.
  const straat = knip(g.straat.trim(), 120);
  const huisnummer = knip(g.huisnummer.trim(), 20);
  if (straat && huisnummer) {
    const adresLeeg = (["straat", "huisnummer", "postcode", "plaats"] as Veld[]).every((v) => !String(k[v] ?? "").trim());
    if (adresLeeg) {
      if (!nee.has(sleutel(straat))) {
        await vul("straat", straat);
        await vul("huisnummer", huisnummer);
        const pc = postcodeSleutel(g.postcode);
        if (pc) await vul("postcode", `${pc.slice(0, 4)} ${pc.slice(4)}`);
        const plaats = knip(g.plaats.trim(), 80);
        if (plaats) await vul("plaats", plaats);
      }
    } else if (sleutel(straat) !== sleutel(k.straat) || sleutel(huisnummer) !== sleutel(k.huisnummer)) {
      anders.adres = [`${straat} ${huisnummer}`, [g.postcode.trim(), g.plaats.trim()].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
    }
  }

  return { toegevoegd, anders };
}
