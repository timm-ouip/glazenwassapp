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
import { formatPrice, ritmeMaanden, type Customer, type District } from "@/lib/klanten";

export type Betaalmethode = "contant" | "overmaken";

export const BETAALMETHODEN: { waarde: Betaalmethode; label: string }[] = [
  { waarde: "contant", label: "Contant" },
  { waarde: "overmaken", label: "Overmaken" },
];

/**
 * De weergaven van de Betalingen-pagina, zoals ze in het webadres staan.
 * Geen ervan staat in het menu: je opent ze allemaal vanaf het overzicht,
 * waar ze als vak staan — de pof-lijst, het lopen, de wijkkaarten en het
 * venster om een wijk vrij te geven.
 */
export const TABBLADEN = ["vanavond", "lopen", "pof", "kaart", "facturen"] as const;

export type BetalingenTab = (typeof TABBLADEN)[number];

export const TABNAAM: Record<BetalingenTab, string> = {
  vanavond: "Overzicht",
  lopen: "Lopen",
  pof: "Pof",
  kaart: "Wijkkaarten",
  facturen: "Facturen",
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
  /**
   * Bij een wasbeurt: het deel dat met een vooruitbetaalde beurt betaald is.
   * Staat er dan nog iets open, dan is dat de meerprijs (extra werk).
   */
  vooruit?: number;
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
    vooruit: Number(d.vooruit ?? 0),
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

/** Tot en met `peildatum` zit alles in de beginstand; daarna telt Paaltje Systems. */
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

/**
 * De kaart van één adres bewaren (zie geld_kaart_zetten): de vakjes van de
 * beginstand en de maanden met een 1 (vooruit betaald, van vóór de app).
 * null = dat deel laten staan; een lege lijst = weghalen.
 */
export async function zetKaart(
  adres: string,
  begin: { maand: string; teken: string; bedrag: number }[] | null,
  vooruit: string[] | null,
) {
  const { error } = await supabase.rpc("geld_kaart_zetten", {
    adres_id: adres,
    begin_vakjes: begin,
    vooruit_maanden: vooruit,
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

/**
 * Hoe vaak er gewassen wordt, in een halve zin: "elke maand", "even maanden".
 * Even of oneven is hoe het op de papieren kaart stond — het % in de maanden
 * dat er niet gewassen werd.
 */
export function frequentieZin(c: Pick<Customer, "interval_maanden" | "ritme">): string {
  const n = c.interval_maanden || 1;
  if (n <= 1) return "elke maand";
  if (n === 2) return `${c.ritme % 2 === 0 ? "even" : "oneven"} maanden`;
  if (n === 12) return "1× per jaar";
  return `1× per ${n} maanden`;
}

/**
 * Nog korter, voor de kolom op de kaart: daar staat het woord "Frequentie"
 * al boven, dus "om de maand," kan eraf. Blijft over: elke maand, even of
 * oneven — precies zoals het op de papieren kaart stond.
 */
export function frequentieKaart(c: Pick<Customer, "interval_maanden" | "ritme">): string {
  const n = c.interval_maanden || 1;
  if (n <= 1) return "elke maand";
  if (n === 2) return c.ritme % 2 === 0 ? "even" : "oneven";
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
  const vanDeKaart: RekeningRegel[] = [];
  const groepen = new Map<number, string[]>();
  for (const d of delen) {
    if (d.soort === "beginstand") {
      const deels = d.rest < d.bedrag - 0.005;
      const maanden = maandenVanDeKaart(d);
      // Met een letter of + erin is het geen rij hele beurten meer.
      const metTekens = d.omschrijving.includes("=");
      vanDeKaart.push({
        label: metTekens
          ? deels
            ? "Van de kaart, rest"
            : "Van de kaart"
          : deels
            ? "Wasbeurt, rest"
            : d.aantal > 1
              ? `${d.aantal}× wasbeurt`
              : "Wasbeurt",
        // De maanden waar de pof voor staat, niet de dag waarop de kaart is
        // overgenomen: "sep" bij een stand van september is anders zo gelezen
        // als de wasbeurt van september zelf.
        wanneer: maanden.length > 0 ? maanden.join(", ") : `van vóór ${dagKort(d.datum)}`,
        bedrag: d.rest,
      });
    } else if (d.soort === "klus") {
      regels.push({
        label: `Klus: ${d.omschrijving || "extra werk"}`,
        wanneer: dagKort(d.datum),
        bedrag: d.rest,
      });
    } else if ((d.vooruit ?? 0) > 0.005) {
      // De beurt zelf is vooruit betaald; wat openstaat is het extra werk.
      regels.push({
        label: "Meerprijs",
        wanneer: maandKort(d.datum),
        uitleg: d.omschrijving
          ? `incl. ${d.omschrijving}; de beurt zelf is vooruit betaald`
          : "de beurt zelf is vooruit betaald",
        bedrag: d.rest,
      });
    } else if (d.omschrijving || d.rest < d.bedrag - 0.005) {
      regels.push({
        label: d.rest < d.bedrag - 0.005 ? "Wasbeurt, rest" : "Wasbeurt",
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
      label:
        datums.length === 1 ? "Wasbeurt" : `${datums.length}× wasbeurt à ${formatPrice(prijs)}`,
      wanneer: datums.map((d) => maandKort(d)).join(", "),
      bedrag: prijs * datums.length,
    };
  });
  // De beginstand bovenaan, dan de wasbeurten, dan de rest in volgorde.
  return [...vanDeKaart, ...gewoon, ...regels];
}

/**
 * De maanden waar een overgenomen kaartstand voor staat ("jul, aug"). Ze
 * komen als "2026-07,2026-08" mee uit de kaartweergave; staat er niets, dan
 * weten we alleen dat het van vóór de peildatum is. Een letter of + op de
 * kaart komt erachter als merkje ("2026-08=v") en staat er dan bij: "aug v".
 */
export function maandenVanDeKaart(d: GeldDeel): string[] {
  const delen = d.omschrijving.split(",");
  const merk = new Map(
    delen
      .map((x) => /^(\d{4}-\d{2})=(.+)$/.exec(x))
      .filter((m) => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
  return delen
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .map((m) => `${maandKort(`${m}-01`)}${merk.has(m) ? ` ${merk.get(m)}` : ""}`);
}

/** "2× € 28 = € 56" in één regel, voor een smalle rij. */
export function rekeningKort(stand: Pick<GeldStand, "open" | "delen">): string {
  if (stand.open < -0.005) return `tegoed ${formatPrice(-stand.open)}`;
  const r = rekening(stand.delen);
  if (r.length === 0) return "";
  if (r.length === 1) return r[0]!.wanneer;
  return r.map((x) => x.wanneer).join(" + ");
}

// ---------------------------------------------------------------------
// Vooruit betalen
// ---------------------------------------------------------------------

/** "1 beurt", "4 beurten". */
export function beurtenTekst(n: number): string {
  return n === 1 ? "1 beurt" : `${n} beurten`;
}

/** De maand van nu, als "2026-09". */
export function maandVanNu(nu = new Date()): string {
  return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" → "2026-10", en "2026-12" → "2027-01". */
export function volgendeMaand(maand: string): string {
  const [jaar, m] = maand.split("-").map(Number);
  if (!jaar || !m) return maand;
  return m === 12 ? `${jaar + 1}-01` : `${jaar}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Welke open wasbeurten een nieuwe vooruitbetaling als eerste dekt: de open
 * wasbeurten (niet al met vooruit betaald) vanaf `vanaf`, oudste eerst. Die
 * datum rekent de database uit (geld_vooruit_vanaf, zie
 * 20261017130000_vooruit_vanaf_een_regel.sql) en geeft hij mee als
 * `vooruit_vanaf`; zo laat de app precies zien wat er geboekt wordt. Meestal
 * is dat de beurt van nu, en blijft oudere pof gewone pof. Zonder datum (een
 * oude lijst) de open wasbeurten, oudste eerst.
 */
export function vooruitEerst(delen: GeldDeel[], vanaf: string | null | undefined): GeldDeel[] {
  return delen
    .filter(
      (d) =>
        d.soort === "wassen" &&
        d.rest > 0.005 &&
        (d.vooruit ?? 0) <= 0.005 &&
        (!vanaf || d.datum >= vanaf),
    )
    .sort((x, y) => x.datum.localeCompare(y.datum));
}

/**
 * Voor welke maanden een nieuwe vooruitbetaling van `aantal` beurten
 * ongeveer betaalt ("2026-09", "2026-10", ...): eerst de open beurten die hij
 * dekt (zie vooruitEerst), dan de komende maanden van de frequentie. De
 * beurten die er al vooruit staan (`over`) nemen de eerste komende maanden.
 * De komende maanden beginnen na de laatste open beurt die hij dekt, of
 * anders bij `start`.
 */
export function vooruitNieuweMaanden(
  c: Pick<Customer, "interval_maanden" | "ritme"> & { overslaan?: string[] | undefined },
  aantal: number,
  delen: GeldDeel[],
  vanaf: string | null | undefined,
  over: number,
  start: string,
): string[] {
  const eerst = vooruitEerst(delen, vanaf).map((d) => d.datum.slice(0, 7));
  const laatste = eerst[eerst.length - 1];
  const verder = laatste ? volgendeMaand(laatste) : start;
  const komend = vooruitMaanden(c, over + Math.max(0, aantal - eerst.length), verder);
  return [...eerst, ...komend.slice(over)].slice(0, aantal);
}

/**
 * Welke maanden de vooruitbetaalde beurten die nog over zijn ongeveer gaan
 * dekken ("2026-10", "2026-12", ...): de volgende maanden van de frequentie,
 * vanaf `start`, zonder de maanden die hij overslaat. Het is een schatting —
 * een extra beurt tussendoor gebruikt er ook een — maar genoeg voor "t/m
 * ongeveer maart" en de lichte vakjes op de kaart.
 */
export function vooruitMaanden(
  c: Pick<Customer, "interval_maanden" | "ritme"> & { overslaan?: string[] | undefined },
  over: number,
  start: string,
): string[] {
  const uit: string[] = [];
  const [beginJaar, beginMaand] = start.split("-").map(Number);
  if (over <= 0 || !beginJaar || !beginMaand) return uit;
  const aanDeBeurt = ritmeMaanden(c);
  if (aanDeBeurt.length === 0) return uit;
  const overslaan = c.overslaan ?? [];
  let jaar = beginJaar;
  let maand = beginMaand;
  // Hooguit dertig jaar vooruit kijken: alles overgeslagen mag niet eindeloos lopen.
  for (let i = 0; i < 360 && uit.length < over; i++) {
    const sleutel = `${jaar}-${String(maand).padStart(2, "0")}`;
    if (aanDeBeurt.includes(maand) && !overslaan.includes(sleutel)) uit.push(sleutel);
    maand += 1;
    if (maand > 12) {
      maand = 1;
      jaar += 1;
    }
  }
  return uit;
}

/**
 * Tot en met welke maand de vooruitbetaling ongeveer reikt: "mrt '27", of
 * "onbekend" als er geen frequentie is om mee te rekenen.
 */
export function vooruitTot(
  c: Pick<Customer, "interval_maanden" | "ritme"> & { overslaan?: string[] | undefined },
  over: number,
  start: string,
  nu = new Date(),
): string {
  const maanden = vooruitMaanden(c, over, start);
  const laatste = maanden[maanden.length - 1];
  return laatste && maanden.length === over ? maandKort(`${laatste}-01`, nu) : "onbekend";
}

/**
 * Vanaf welke maand de beurten die nog over zijn meetellen: deze maand, of
 * de maand na de laatste gewassen beurt als die van deze maand er al is.
 */
export function vooruitStart(laatsteRonde: string | null | undefined, nu = new Date()): string {
  const hier = maandVanNu(nu);
  if (!laatsteRonde) return hier;
  const erna = volgendeMaand(laatsteRonde.slice(0, 7));
  return erna > hier ? erna : hier;
}

/**
 * Omrekenen na een prijsverhoging: hetzelfde geld, minder beurten tegen de
 * nieuwe prijs; wat overblijft wordt tegoed. € 37,50 bij € 15 = 2 beurten en
 * € 7,50 tegoed. (De database rekent hetzelfde en controleert het.)
 */
export function omrekenen(waarde: number, prijs: number): { beurten: number; tegoed: number } {
  const centen = Math.round(waarde * 100);
  const perBeurt = Math.round(prijs * 100);
  if (perBeurt <= 0) return { beurten: 0, tegoed: centen / 100 };
  const beurten = Math.floor(centen / perBeurt);
  return { beurten, tegoed: (centen - beurten * perBeurt) / 100 };
}

export interface TerugStand {
  /** Ongebruikte beurten van vorige bewoners, en wat ze waard zijn. */
  vorige: number;
  vorigeWaarde: number;
  /** Ongebruikte beurten van de huidige (laatste) klant, en wat ze waard zijn. */
  eigen: number;
  eigenWaarde: number;
  /** Wat er open staat (negatief = tegoed). */
  open: number;
  gestopt: boolean;
}

/** Wat er terug moet (zoals de database het rekent, zie vooruit_terug). */
export function terugBedrag(t: TerugStand): number {
  const eigen = t.gestopt ? Math.max(0, t.eigenWaarde - t.open) : 0;
  return Math.round((t.vorigeWaarde + eigen) * 100) / 100;
}

/**
 * Wat er terug moet, in één regel: "2 beurten (€ 25) + tegoed € 2,50 =
 * € 27,50". De beurten van een vorige bewoner gaan altijd helemaal terug:
 * wat de huidige klant open heeft gaat daar niet af. Bij een gestopt adres
 * komen de eigen beurten en het tegoed erbij, min wat er nog open staat. Loopt
 * het adres nog, dan blijft tegoed op het adres staan.
 */
export function terugTekst(t: TerugStand): string {
  const terug = terugBedrag(t);
  const delen: { tekst: string; kort: string }[] = [];
  if (t.vorige > 0) {
    const wie = `${beurtenTekst(t.vorige)} van de vorige bewoner`;
    delen.push({ tekst: `${wie} (${formatPrice(t.vorigeWaarde)})`, kort: wie });
  }
  if (t.gestopt && t.eigen > 0) {
    delen.push({
      tekst: `${beurtenTekst(t.eigen)} (${formatPrice(t.eigenWaarde)})`,
      kort: beurtenTekst(t.eigen),
    });
  }
  if (t.gestopt && t.open < -0.005) {
    const tegoed = `tegoed ${formatPrice(-t.open)}`;
    delen.push({ tekst: tegoed, kort: tegoed });
  }
  // Wat er open staat gaat alleen van de eigen beurten af, nooit verder.
  const aftrek = t.gestopt && t.open > 0.005 ? Math.min(t.open, t.eigenWaarde) : 0;
  if (delen.length === 0) return formatPrice(terug);
  const min = aftrek > 0.005 ? ` − nog open ${formatPrice(aftrek)}` : "";
  const enige = delen.length === 1 && !min ? delen[0] : undefined;
  // Eén deel: "1 beurt = € 12,50", of alleen "tegoed € 5".
  if (enige)
    return enige.kort === enige.tekst ? enige.tekst : `${enige.kort} = ${formatPrice(terug)}`;
  return `${delen.map((d) => d.tekst).join(" + ")}${min} = ${formatPrice(terug)}`;
}

/**
 * De ronde van de laatste gewassen beurt ("2026-09"), om te weten vanaf
 * welke maand de vooruitbetaalde beurten die nog over zijn gaan tellen.
 */
export async function fetchLaatsteRonde(adres: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("ronde")
    .eq("customer_id", adres)
    .not("gedaan_op", "is", null)
    // Teruggemeld als niet gewassen: die beurt telt niet, dus ook niet als laatste.
    .is("niet_gewassen_op", null)
    .order("ronde", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.ronde ?? null;
}

/** Een vooruitbetaling ongedaan laten: de geplande (of net gedane) wissel naar overmaken. */
export async function draaiBetaalwisselTerug(adres: string) {
  const { error } = await supabase.rpc("betaalwissel_ongedaan", { adres });
  if (error) throw error;
}

/** Staat er voor dit adres een wissel naar overmaken klaar? */
export async function fetchWisselStatus(adres: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("wissel_status")
    .eq("id", adres)
    .maybeSingle();
  if (error) throw error;
  return data?.wissel_status ?? null;
}

/**
 * Hoeveel adressen die de wijk volgen nog vooruitbetaalde beurten hebben:
 * die gaan niet meteen mee naar overmaken, maar pas als het op is. Eerst de
 * adressen die ooit vooruit betaalden (weinig), dan per adres de stand.
 */
export async function telVooruitInWijk(wijk: string): Promise<number> {
  // Meteen op de wijk gefilterd (en alleen adressen die de wijk volgen en
  // nog lopen): zo blijven er maar een paar adressen over om na te kijken.
  const { data: rijen, error } = await supabase
    .from("betaal_gebeurtenissen")
    .select(
      "customer_id, customers!inner(betaalmethode, inactief_op, deleted_at, streets!inner(district_id))",
    )
    .eq("soort", "vooruit")
    .eq("customers.streets.district_id", wijk)
    .is("customers.betaalmethode", null)
    .is("customers.inactief_op", null)
    .is("customers.deleted_at", null);
  if (error) throw error;
  const adressen = [...new Set((rijen ?? []).map((r) => r.customer_id))];
  const standen = await Promise.all(
    adressen.map(async (id) => {
      const { data, error: e } = await supabase.rpc("geld_adres", { adres: id });
      if (e) throw e;
      const x = (data ?? {}) as { vooruit_over?: number; vooruit_vast?: number };
      return Number(x.vooruit_over ?? 0) - Number(x.vooruit_vast ?? 0);
    }),
  );
  return standen.filter((n) => n > 0).length;
}

/**
 * Hoe vaak een adres open staat, kort: "3×", of "1,5×" als een deel van de
 * beginstand betaald is. Leeg als er geen beurt open staat (alleen een klus,
 * of een restje van een beurt).
 */
export function keerOpen(openWassen: number): string {
  const n = Math.round(openWassen * 2) / 2;
  if (n <= 0) return "";
  return `${n.toLocaleString("nl-NL")}×`;
}
