/**
 * Betalingen: wie contant betaalt, wat er open staat, en de beginstand.
 *
 * Wat er open staat rekent de database uit (zie de migratie
 * betalingen_fundament): de beginstand van de papieren kaart, plus elke
 * afgemelde wasbeurt en uitgevoerde klus sinds de start van de wijk, min wat
 * er betaald en aan korting gegeven is. Betalingen dekken de oudste schuld
 * eerst. Hier staat alleen hoe de app dat opvraagt en laat zien.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, type Customer, type District } from "@/lib/klanten";

export type Betaalmethode = "contant" | "overmaken";

export const BETAALMETHODEN: { waarde: Betaalmethode; label: string }[] = [
  { waarde: "contant", label: "Contant" },
  { waarde: "overmaken", label: "Overmaken" },
];

/**
 * De weergaven van de Betalingen-pagina, zoals ze in het webadres staan.
 * Ze staan hier en niet in de route, omdat het menu (de zijbalk en de balk
 * onderin) ze als sublijstje toont: dat menu staat op elke pagina, ook als
 * Betalingen zelf nog niet geladen is.
 */
export const TABBLADEN = ["vanavond", "vrijgeven", "lopen", "pof", "kaart"] as const;

export type BetalingenTab = (typeof TABBLADEN)[number];

/**
 * Wat er in het menu staat. Pof is geen tabblad meer: dat is een lijst die je
 * vanaf het overzicht opent. De beginstand ook niet: die vul je op de kaart
 * in, en dat doe je maar één keer.
 */
export const MENU_TABBLADEN = ["vanavond", "vrijgeven", "lopen", "kaart"] as const;

export const TABNAAM: Record<BetalingenTab, string> = {
  vanavond: "Overzicht",
  vrijgeven: "Vrijgeven",
  lopen: "Lopen",
  pof: "Pof",
  kaart: "Kaart",
};

export function betaalmethodeLabel(m: Betaalmethode): string {
  return m === "contant" ? "Contant" : "Overmaken";
}

/** Wat een adres echt doet: zijn eigen keuze, anders die van de wijk. */
export function effectieveMethode(
  c: Pick<Customer, "betaalmethode">,
  wijk: Pick<District, "betaalmethode"> | null | undefined,
): Betaalmethode {
  return c.betaalmethode ?? wijk?.betaalmethode ?? "contant";
}

/** Eén post die (nog) niet helemaal betaald is. */
export interface GeldDeel {
  soort: "beginstand" | "wassen" | "klus";
  /** De dag van de wasbeurt of klus; bij de beginstand de stand van de kaart. */
  datum: string;
  bedrag: number;
  /** Wat er van dit bedrag nog open staat. */
  rest: number;
  /** Bij de beginstand: voor hoeveel wasbeurten hij staat. */
  aantal: number;
  /** Wat de klus was, of het extra werk en de dagnotitie bij een wasbeurt. */
  omschrijving: string;
}

export interface GeldStand {
  id: string;
  /** Wat er open staat; negatief is tegoed. */
  open: number;
  /** Hoeveel wasbeurten er open staan (een deels betaalde beginstand naar verhouding). */
  open_wassen: number;
  delen: GeldDeel[];
  beginstand: {
    bedrag: number;
    aantal: number;
    door: string;
    op: string;
    /** Uit de kaartweergave: welke maanden nog open stonden ("2026-07"). */
    maanden: string[];
  } | null;
}

function leesDelen(x: unknown): GeldDeel[] {
  if (!Array.isArray(x)) return [];
  return x.map((d) => ({
    soort: d.soort,
    datum: String(d.datum ?? ""),
    bedrag: Number(d.bedrag ?? 0),
    rest: Number(d.rest ?? 0),
    aantal: Number(d.aantal ?? 1),
    omschrijving: String(d.omschrijving ?? ""),
  }));
}

/** Zoals de database een stand teruggeeft (jsonb). */
interface RuweStand {
  id: string;
  open: number | string | null;
  open_wassen: number | null;
  delen: unknown;
  beginstand: {
    bedrag: number | string;
    aantal: number | null;
    door: string;
    op: string;
    maanden: string[] | null;
  } | null;
}

/** De stand van alle adressen van een wijk. Alleen met "prijzen zien". */
export async function fetchGeldStandWijk(wijk: string): Promise<GeldStand[]> {
  const { data, error } = await supabase.rpc("geld_stand_wijk", { wijk });
  if (error) throw error;
  const rijen = (Array.isArray(data) ? data : []) as unknown as RuweStand[];
  return rijen.map((x) => ({
    id: String(x.id),
    open: Number(x.open ?? 0),
    open_wassen: Number(x.open_wassen ?? 0),
    delen: leesDelen(x.delen),
    beginstand: x.beginstand
      ? {
          bedrag: Number(x.beginstand.bedrag ?? 0),
          aantal: Number(x.beginstand.aantal ?? 1),
          door: String(x.beginstand.door ?? ""),
          op: String(x.beginstand.op ?? ""),
          maanden: x.beginstand.maanden ?? [],
        }
      : null,
  }));
}

export async function zetWijkBetaalmethode(wijk: string, methode: Betaalmethode) {
  const { data, error } = await supabase
    .from("districts")
    .update({ betaalmethode: methode })
    .eq("id", wijk)
    .select("id");
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error("Alleen de eigenaar kan dit veranderen.");
}

/** Tot en met `peildatum` zit alles in de beginstand; daarna telt Wooshy. */
export async function startWijk(wijk: string, peildatum: string) {
  const { error } = await supabase.rpc("geld_wijk_starten", { wijk, peildatum });
  if (error) throw error;
}

export async function zetBeginstand(
  adres: string,
  bedrag: number,
  aantal: number,
  maanden: string[] | null = null,
) {
  const { error } = await supabase.rpc("geld_beginstand_zetten", {
    adres_id: adres,
    bedrag,
    aantal,
    maanden,
  });
  if (error) throw error;
}

export async function zetWijkKlaar(wijk: string, klaar: boolean) {
  const { error } = await supabase.rpc("geld_wijk_klaar", { wijk, klaar });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Laten zien
// ---------------------------------------------------------------------

/** "om de maand", "1× per 3 maanden": zoals het op de kaart staat. */
export function frequentieKort(c: Pick<Customer, "interval_maanden" | "ritme">): string {
  const n = c.interval_maanden || 1;
  if (n <= 1) return "elke maand";
  // Even of oneven, zoals het % op de papieren kaart in de goede maanden stond.
  if (n === 2) return `om de maand, ${c.ritme % 2 === 0 ? "even" : "oneven"}`;
  if (n === 12) return "1× per jaar";
  return `1× per ${n} maanden`;
}

const MAANDEN = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** "sep", of "dec '25" als het niet dit jaar was. */
export function maandKort(datum: string, nu = new Date()): string {
  const [jaar, maand] = datum.split("-").map(Number);
  if (!jaar || !maand) return datum;
  const naam = MAANDEN[maand - 1] ?? "";
  return jaar === nu.getFullYear() ? naam : `${naam} '${String(jaar).slice(2)}`;
}

/** "12 sep" */
export function dagKort(datum: string): string {
  const [, maand, dag] = datum.split("-").map(Number);
  if (!maand || !dag) return datum;
  return `${dag} ${MAANDEN[maand - 1] ?? ""}`;
}

export interface RekeningRegel {
  /** "2× wassen à € 28", "Klus: dakgoot", "Beginstand" */
  label: string;
  /** "jul, sep", "12 sep", "stand 1 sep" */
  wanneer: string;
  /** Extra uitleg: het extra werk of de dagnotitie. */
  uitleg?: string | undefined;
  bedrag: number;
}

/**
 * De open posten als rekening. Gewone wasbeurten met hetzelfde bedrag komen
 * op één regel ("2× wassen à € 28 · jul, sep"); een wasbeurt met extra werk
 * of een notitie, een klus of een deels betaalde post staat apart, zodat je
 * aan de deur kunt uitleggen waar een bedrag vandaan komt.
 */
export function rekening(delen: GeldDeel[]): RekeningRegel[] {
  const regels: RekeningRegel[] = [];
  const groepen = new Map<number, string[]>();
  for (const d of delen) {
    if (d.soort === "beginstand") {
      const deels = d.rest < d.bedrag - 0.005;
      // Uit de kaartweergave komen de maanden mee ("2026-07,2026-08").
      const maanden = d.omschrijving
        .split(",")
        .filter((m) => /^\d{4}-\d{2}$/.test(m))
        .map((m) => maandKort(`${m}-01`));
      regels.push({
        label: deels ? "Van de kaart, rest" : "Van de kaart",
        wanneer: maanden.length > 0 ? maanden.join(", ") : `stand ${dagKort(d.datum)}`,
        uitleg: d.aantal > 1 && maanden.length === 0 ? `${d.aantal} wasbeurten` : undefined,
        bedrag: d.rest,
      });
    } else if (d.soort === "klus") {
      regels.push({
        label: `Klus: ${d.omschrijving || "extra werk"}`,
        wanneer: dagKort(d.datum),
        bedrag: d.rest,
      });
    } else if (d.omschrijving || d.rest < d.bedrag - 0.005) {
      regels.push({
        label: d.rest < d.bedrag - 0.005 ? "Wassen, rest" : "Wassen",
        wanneer: maandKort(d.datum),
        uitleg: d.omschrijving ? `incl. ${d.omschrijving}` : undefined,
        bedrag: d.rest,
      });
    } else {
      const sleutel = Math.round(d.bedrag * 100);
      groepen.set(sleutel, [...(groepen.get(sleutel) ?? []), d.datum]);
    }
  }
  const gewoon: RekeningRegel[] = [...groepen.entries()].map(([centen, datums]) => {
    const prijs = centen / 100;
    return {
      label: datums.length === 1 ? "Wassen" : `${datums.length}× wassen à ${formatPrice(prijs)}`,
      wanneer: datums.map((d) => maandKort(d)).join(", "),
      bedrag: prijs * datums.length,
    };
  });
  // De beginstand bovenaan, dan de wasbeurten, dan de rest in volgorde.
  const begin = regels.filter((r) => r.label.startsWith("Van de kaart"));
  const overig = regels.filter((r) => !r.label.startsWith("Van de kaart"));
  return [...begin, ...gewoon, ...overig];
}

/** "2× € 28 = € 56" in één regel, voor een smalle rij. */
export function rekeningKort(stand: Pick<GeldStand, "open" | "delen">): string {
  if (stand.open < -0.005) return `tegoed ${formatPrice(-stand.open)}`;
  const r = rekening(stand.delen);
  if (r.length === 0) return "";
  if (r.length === 1) return r[0]!.wanneer;
  return r.map((x) => x.wanneer).join(" + ");
}
