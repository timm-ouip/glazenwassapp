/**
 * Het tabblad "Geschiedenis" van het klantdossier: alles wat er met een adres
 * gebeurde in één lijst, nieuwste eerst. Hier staat wat de lijst opvraagt
 * (de beurten en wat Paaltje deed) en hoe de regels uit de bronnen ontstaan:
 * de beurten, het geld, de klachten, het wijzigingslog en wat een geldloper
 * of Paaltje veranderde. Het scherm staat in
 * src/components/dossier/DossierGeschiedenis.tsx.
 */
import { supabase } from "@/integrations/supabase/client";
import { beurtenTekst } from "@/lib/betalingen";
import { bronTekst, korteDatum } from "@/lib/dossier";
import { wijzigingTekst, type GeldloopWijziging } from "@/lib/geldlopen";
import type { Klacht, KlachtBron } from "@/lib/klachten";
import { formatPrice, toonMaand } from "@/lib/klanten";
import { vooruitLabel, type Gebeurtenis } from "@/lib/overzichten";
import type { WijzigingGroep } from "@/lib/wijzigingen";

// ---------------------------------------------------------------------------
// Opvragen
// ---------------------------------------------------------------------------

/** Eén beurt die gedaan is, of waarvan een geldloper hoorde dat hij niet gedaan is. */
export interface GedaneBeurt {
  id: string;
  /** De dag, jjjj-mm-dd. */
  datum: string;
  /** De ronde ("2026-09"); niet altijd de maand van de datum. */
  ronde: string;
  ploeg_nr: number | null;
  notitie: string | null;
  gedaan_op: string | null;
  niet_gewassen_op: string | null;
  niet_gewassen_naam: string | null;
  /** Het bedrag van die dag; leeg zonder het recht om prijzen te zien. */
  prijs: number | null;
}

/** De laatste `limiet` beurten van een adres die gedaan of niet gewassen zijn. */
export async function fetchGedaneBeurten(
  adresId: string,
  limiet: number,
  metPrijs: boolean,
): Promise<GedaneBeurt[]> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select(
      `id,datum,ronde,ploeg_nr,notitie,gedaan_op,niet_gewassen_op,niet_gewassen_naam${
        metPrijs ? ",wasdag_prijzen(prijs)" : ""
      }`,
    )
    .eq("customer_id", adresId)
    .or("gedaan_op.not.is.null,niet_gewassen_op.not.is.null")
    .order("datum", { ascending: false })
    .limit(limiet);
  if (error) throw error;
  type Rij = Omit<GedaneBeurt, "prijs"> & {
    wasdag_prijzen?: { prijs: number } | { prijs: number }[] | null;
  };
  return ((data ?? []) as unknown as Rij[]).map(({ wasdag_prijzen, ...r }) => {
    const p = Array.isArray(wasdag_prijzen) ? wasdag_prijzen[0] : wasdag_prijzen;
    return { ...r, prijs: metPrijs && p ? Number(p.prijs) : null };
  });
}

/** Wat Paaltje (na een mail of appje) aan dit adres deed. Alleen voor de eigenaar. */
export interface PaaltjeWijziging {
  id: string;
  created_at: string;
  soort: string;
  maanden: string[];
  automatisch: boolean;
  teruggedraaid_op: string | null;
}

export async function fetchPaaltjeWijzigingen(adresId: string): Promise<PaaltjeWijziging[]> {
  const { data, error } = await supabase
    .from("mail_wijzigingen")
    .select("id,created_at,soort,maanden,automatisch,teruggedraaid_op")
    .eq("customer_id", adresId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as PaaltjeWijziging[];
}

// ---------------------------------------------------------------------------
// De regels
// ---------------------------------------------------------------------------

/** Paars = wijziging, groen = beurt, oranje = geld, rood = klacht. */
export type GeschiedenisSoort = "wijziging" | "beurt" | "geld" | "klacht";

export interface GeschiedenisRegel {
  sleutel: string;
  soort: GeschiedenisSoort;
  /** Voor de volgorde, in milliseconden. */
  moment: number;
  /** De dag waar hij onder valt, jjjj-mm-dd (lokale tijd). */
  datum: string;
  /** De titel; bij een opslag met meer velden één regel per veld. */
  titel: string[];
  /** De grijze regel eronder. */
  onder: string;
  /** Ging het automatisch (Paaltje of het systeem)? Dan staat hij geel. */
  geel: boolean;
  /** Al ongedaan gemaakt: hij blijft staan, maar lichter. */
  teruggedraaid: boolean;
  /** Wat "Ongedaan" terugzet; leeg = geen knop. */
  ongedaan: { soort: "log"; ids: string[] } | { soort: "geldloper"; id: string } | null;
}

/** Wat jouw rol mag; bepaalt de prijzen en of Ongedaan er staat. */
export interface GeschiedenisRechten {
  prijzen: boolean;
  bewerken: boolean;
  planOfBewerken: boolean;
  eigenaar: boolean;
}

export interface GeschiedenisBronnen {
  adresId: string;
  beurten: GedaneBeurt[];
  gebeurtenissen: Gebeurtenis[];
  klachten: Klacht[];
  wijzigingen: WijzigingGroep[];
  geldloper: GeldloopWijziging[];
  paaltje: PaaltjeWijziging[];
}

/** Een tijdstip als lokale dag, jjjj-mm-dd. */
function dagVan(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Een dag (jjjj-mm-dd) als moment: midden op de dag, lokale tijd. */
function middag(datum: string): number {
  return new Date(`${datum}T12:00:00`).getTime();
}

const hoofdletter = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const samen = (delen: (string | null | undefined | false)[]) =>
  delen.filter((x): x is string => Boolean(x && x.trim())).join(" · ");

/** Velden die ook wie plant mag zetten (zie PLAN_VELDEN in useDossier). */
const PLAN_VELDEN = new Set(["overslaan", "markering"]);

/** Mag deze rol dit veld terugzetten? De database controleert het nog eens. */
function magVeld(tabel: string, veld: string, r: GeschiedenisRechten): boolean {
  if (tabel === "adres_prijzen") return r.bewerken && r.prijzen;
  if (tabel === "customers" && PLAN_VELDEN.has(veld)) return r.planOfBewerken;
  return r.bewerken;
}

/**
 * @param melding De open "niet gewassen"-melding van een geldloper bij deze
 * beurt: die zet de eigenaar hier terug.
 */
function beurtRegel(
  b: GedaneBeurt,
  r: GeschiedenisRechten,
  melding?: GeldloopWijziging,
): GeschiedenisRegel {
  const team = b.ploeg_nr != null ? `team ${b.ploeg_nr}` : "";
  // Een septemberbeurt die op 1 oktober gebeurde, hoort bij september.
  const ronde = b.ronde && b.ronde !== b.datum.slice(0, 7) ? `${toonMaand(b.ronde)}beurt` : "";
  const notitie = b.notitie?.trim() ?? "";
  if (b.niet_gewassen_op) {
    return {
      sleutel: `beurt-${b.id}`,
      soort: "beurt",
      moment: middag(b.datum),
      datum: b.datum,
      titel: ["Niet gewassen"],
      onder: samen([
        team,
        ronde,
        b.niet_gewassen_naam ? `teruggemeld door ${b.niet_gewassen_naam}` : "teruggemeld",
        notitie,
      ]),
      geel: false,
      teruggedraaid: false,
      ongedaan: r.eigenaar && melding ? { soort: "geldloper", id: melding.id } : null,
    };
  }
  return {
    sleutel: `beurt-${b.id}`,
    soort: "beurt",
    moment: middag(b.datum),
    datum: b.datum,
    titel: [r.prijzen && b.prijs != null ? `Gewassen · ${formatPrice(b.prijs)}` : "Gewassen"],
    // Gedaan zet alleen "Dag klaar"; wat anders ging staat in de notitie.
    onder: samen([team, ronde, notitie || "afgemeld met Dag klaar"]),
    geel: false,
    teruggedraaid: false,
    ongedaan: null,
  };
}

function geldTitel(g: Gebeurtenis): string {
  const bedrag = g.bedrag ? ` · ${formatPrice(g.bedrag)}` : "";
  const avond = g.bron === "geldloop" ? " bij de avondronde" : "";
  switch (g.soort) {
    case "betaald":
      return `Betaald ${bronTekst(g.bron)}${bedrag}`;
    case "niet_thuis":
      return `Niet thuis${avond}`;
    case "geen_geld":
      return `Geen geld${avond}`;
    case "vooruit":
      return `${hoofdletter(vooruitLabel(g.aantal))} betaald${bedrag}`;
    case "korting":
      return `Korting${bedrag}`;
    case "terugbetaald":
      return `Teruggegeven${bedrag}`;
    case "omgerekend":
      return `Omgerekend naar de nieuwe prijs${bedrag}`;
    case "beginstand":
      return `Beginstand${bedrag}`;
  }
}

function geldRegel(g: Gebeurtenis): GeschiedenisRegel {
  const wie = g.door_naam
    ? g.bron === "geldloop"
      ? `geldloper ${g.door_naam}`
      : `door ${g.door_naam}`
    : g.bron === "geldloop"
      ? "geldloper"
      : "";
  return {
    sleutel: `geld-${g.id}`,
    soort: "geld",
    moment: Date.parse(g.op),
    datum: dagVan(g.op),
    titel: [geldTitel(g)],
    onder: samen([
      wie,
      g.soort === "omgerekend" && g.omgerekend_van ? beurtenTekst(g.omgerekend_van) : "",
      g.reden,
      g.ongedaan
        ? `ongedaan gemaakt${g.ongedaan.door_naam ? ` door ${g.ongedaan.door_naam}` : ""}`
        : "",
    ]),
    geel: false,
    teruggedraaid: Boolean(g.ongedaan),
    ongedaan: null,
  };
}

const KLACHT_BRON: Record<KlachtBron, string> = {
  mail: "uit mail",
  telefoon: "telefonisch",
  deur: "aan de deur",
  app: "via een appje",
  anders: "",
};

function klachtRegel(k: Klacht): GeschiedenisRegel {
  return {
    sleutel: `klacht-${k.id}`,
    soort: "klacht",
    moment: Date.parse(k.ontvangen_op),
    datum: dagVan(k.ontvangen_op),
    titel: [`Klacht genoteerd: ${k.omschrijving.trim()}`],
    onder: samen([
      KLACHT_BRON[k.bron] ?? "",
      k.door_paaltje ? "door Paaltje" : "",
      k.status === "afgehandeld"
        ? k.afgehandeld_op
          ? `afgehandeld op ${korteDatum(k.afgehandeld_op)}`
          : "afgehandeld"
        : "staat nog open",
    ]),
    geel: false,
    teruggedraaid: false,
    ongedaan: null,
  };
}

function wijzigingRegel(g: WijzigingGroep, r: GeschiedenisRechten): GeschiedenisRegel {
  const ids = g.ongedaanIds;
  const eigen = new Set(g.regels.map((x) => x.id));
  // Gaat er iets van een andere opslag mee terug (extra werk met zijn
  // meerprijs), dan moet je die prijs ook mogen terugzetten.
  const mag =
    ids.length > 0 &&
    g.regels.filter((x) => ids.includes(x.id)).every((x) => magVeld(x.tabel, x.veld, r)) &&
    (ids.every((id) => eigen.has(id)) || (r.bewerken && r.prijzen));
  return {
    sleutel: `log-${g.sleutel}`,
    soort: "wijziging",
    moment: Date.parse(g.op),
    datum: dagVan(g.op),
    titel: g.regels.map((x) => x.tekst),
    onder: samen([
      g.bron === "systeem" ? "automatisch" : `door ${g.door}`,
      g.teruggedraaid
        ? `ongedaan gemaakt${g.teruggedraaid.naam ? ` door ${g.teruggedraaid.naam}` : ""} op ${korteDatum(g.teruggedraaid.op)}`
        : "",
    ]),
    geel: g.bron !== "app",
    teruggedraaid: Boolean(g.teruggedraaid),
    ongedaan: mag ? { soort: "log", ids } : null,
  };
}

function geldloperRegel(w: GeldloopWijziging, r: GeschiedenisRechten): GeschiedenisRegel {
  return {
    sleutel: `geldloper-${w.id}`,
    soort: "wijziging",
    moment: Date.parse(w.op),
    datum: dagVan(w.op),
    titel: [hoofdletter(wijzigingTekst(w))],
    onder: samen([
      w.door_naam ? `geldloper ${w.door_naam}` : "geldloper",
      w.teruggedraaid_op
        ? `ongedaan gemaakt${w.teruggedraaid_naam ? ` door ${w.teruggedraaid_naam}` : ""} op ${korteDatum(w.teruggedraaid_op)}`
        : "",
    ]),
    geel: false,
    teruggedraaid: Boolean(w.teruggedraaid_op),
    // Wat een geldloper deed, zet alleen de eigenaar terug (zoals in het gele vak).
    ongedaan: r.eigenaar && !w.teruggedraaid_op ? { soort: "geldloper", id: w.id } : null,
  };
}

function paaltjeTitel(p: PaaltjeWijziging): string {
  switch (p.soort) {
    case "overslaan":
      return `${hoofdletter(p.maanden.map(toonMaand).join(" en "))} op overslaan gezet`;
    case "stoppen":
      return "Gestopt als klant";
    case "aanmelding":
      return "Aanmelding klaargezet";
    case "klant_email":
      return "Mailadres aan de klant gekoppeld";
    case "whatsapp_afgemeld":
      return "Wil geen WhatsApp meer, uitgezet";
    default:
      return hoofdletter(p.soort.replace(/_/g, " "));
  }
}

function paaltjeRegel(p: PaaltjeWijziging): GeschiedenisRegel {
  return {
    sleutel: `paaltje-${p.id}`,
    soort: "wijziging",
    moment: Date.parse(p.created_at),
    datum: dagVan(p.created_at),
    titel: [paaltjeTitel(p)],
    onder: samen([
      p.automatisch ? "door Paaltje, automatisch" : "door Paaltje, met de hand goedgekeurd",
      p.teruggedraaid_op ? `ongedaan gemaakt op ${korteDatum(p.teruggedraaid_op)}` : "",
    ]),
    geel: p.automatisch,
    teruggedraaid: Boolean(p.teruggedraaid_op),
    ongedaan: null,
  };
}

/** Hoe dicht een automatische regel in het log bij wat Paaltje deed moet liggen
 *  om hetzelfde te zijn. */
const ZELFDE_MOMENT_MS = 2 * 60 * 1000;

/**
 * Alle bronnen samen, nieuwste eerst. Wat dubbel zou staan gaat eruit: de
 * opslag die Paaltje via de server deed of terugdraaide (die staat al als
 * Paaltje-regel), en een open "niet gewassen" van een geldloper (dat staat al
 * bij de beurt).
 */
export function maakGeschiedenis(
  bronnen: GeschiedenisBronnen,
  r: GeschiedenisRechten,
): GeschiedenisRegel[] {
  // Na een verhuizing begint de nieuwe bewoner leeg: de beurten, het geld, de
  // geldloper en Paaltje van vóór de verhuizing horen bij de vorige bewoner.
  // Het log zelf laat de database al weg (verborgen_door). Draai je de
  // verhuizing terug, dan is de regel teruggedraaid en komt alles terug.
  const verhuisdOp = Math.max(
    ...bronnen.wijzigingen
      .flatMap((g) => g.regels)
      .filter((x) => x.veld === "verhuisd" && !x.teruggedraaid_op)
      .map((x) => Date.parse(x.op))
      .filter((t) => !Number.isNaN(t)),
  );
  const verhuisdag = Number.isFinite(verhuisdOp) ? dagVan(new Date(verhuisdOp).toISOString()) : "";
  const naVerhuizing = (iso: string) => !(Date.parse(iso) < verhuisdOp);
  const b: GeschiedenisBronnen = verhuisdag
    ? {
        ...bronnen,
        beurten: bronnen.beurten.filter((x) => x.datum > verhuisdag),
        gebeurtenissen: bronnen.gebeurtenissen.filter((g) => naVerhuizing(g.op)),
        geldloper: bronnen.geldloper.filter((w) => naVerhuizing(w.op)),
        paaltje: bronnen.paaltje.filter((p) => naVerhuizing(p.created_at)),
      }
    : bronnen;

  // Ook het terugdraaien door Paaltje schrijft (via de server) in het log.
  const paaltjeMomenten = b.paaltje.flatMap((p) =>
    [p.created_at, p.teruggedraaid_op].filter((x): x is string => !!x).map((x) => Date.parse(x)),
  );
  // De verhuisd-regel (het log is verborgen) is nooit dubbel: die blijft.
  const vanPaaltje = (g: WijzigingGroep) =>
    g.bron !== "app" &&
    !g.regels.some((x) => x.veld === "verhuisd") &&
    paaltjeMomenten.some((t) => Math.abs(Date.parse(g.op) - t) <= ZELFDE_MOMENT_MS);

  // "Niet gewassen" van een geldloper: staat het nog, dan hoort het bij de
  // beurt (met Ongedaan daar). Teruggedraaid, of de beurt is niet opgehaald,
  // dan als eigen regel, zodat het spoor blijft.
  // De melding onthoudt de beurt (voor.id); oudere meldingen alleen de datum.
  const openMelding = new Map<string, GeldloopWijziging>();
  for (const w of b.geldloper) {
    if (w.soort !== "niet_gewassen" || w.teruggedraaid_op) continue;
    for (const sleutel of [String(w.voor?.["id"] ?? ""), String(w.voor?.["datum"] ?? "")]) {
      if (!sleutel) continue;
      const al = openMelding.get(sleutel);
      if (!al || al.op < w.op) openMelding.set(sleutel, w);
    }
  }
  const bijBeurt = new Set<string>();
  const beurtRegels = b.beurten.map((x) => {
    const melding = x.niet_gewassen_op
      ? (openMelding.get(x.id) ?? openMelding.get(x.datum))
      : undefined;
    if (melding) bijBeurt.add(melding.id);
    return beurtRegel(x, r, melding);
  });

  const regels: GeschiedenisRegel[] = [
    ...beurtRegels,
    ...(r.prijzen ? b.gebeurtenissen.map(geldRegel) : []),
    ...b.klachten
      .filter((k) => !k.customer_id || k.customer_id === b.adresId)
      .map(klachtRegel),
    ...b.wijzigingen
      .filter((g) => r.prijzen || g.tabel !== "adres_prijzen")
      .filter((g) => !vanPaaltje(g))
      .map((g) => wijzigingRegel(g, r)),
    ...b.geldloper
      .filter((w) => !bijBeurt.has(w.id))
      .filter((w) => r.prijzen || (w.soort !== "prijs" && w.soort !== "stoppen"))
      .map((w) => geldloperRegel(w, r)),
    ...b.paaltje.map(paaltjeRegel),
  ];
  return regels
    .filter((x) => !Number.isNaN(x.moment))
    .sort((x, y) => y.moment - x.moment || x.sleutel.localeCompare(y.sleutel));
}

/** Per maand ("2026-09"), in de volgorde van de lijst. */
export function perMaand(
  regels: GeschiedenisRegel[],
): { maand: string; regels: GeschiedenisRegel[] }[] {
  const uit: { maand: string; regels: GeschiedenisRegel[] }[] = [];
  for (const x of regels) {
    const maand = x.datum.slice(0, 7);
    const laatste = uit[uit.length - 1];
    if (laatste?.maand === maand) laatste.regels.push(x);
    else uit.push({ maand, regels: [x] });
  }
  return uit;
}

/** "SEPTEMBER 2026" (de hoofdletters doet het scherm). */
export function maandKop(maand: string): string {
  return `${toonMaand(maand)} ${maand.slice(0, 4)}`;
}
