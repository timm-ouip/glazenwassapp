// Het wijzigingslog van het dossier: wat er aan een adres, de prijs of de
// klant veranderde, en wie dat deed. De database schrijft het zelf (triggers,
// zie de migratie 20261016100000_wijzigingslog.sql); hier lezen we het,
// maken we er Nederlandse zinnen van en zetten we een wijziging terug.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatPrice, ritmeMaanden, toonMaand, toonMaandKort } from "@/lib/klanten";

export type Wijziging = Database["public"]["Tables"]["wijzigingen"]["Row"];
/** "klant": de klant zelf, via zijn invul-linkje (/gegevens). */
export type WijzigingBron = "app" | "paaltje" | "systeem" | "klant";

/** Wat de zinnen nodig hebben buiten de regel zelf: namen bij de ids. */
export type WijzigingContext = {
  /** klant-id → naam (voor "Andere klant: …"). */
  klantNamen?: Map<string, string>;
  /** markering-sleutel → naam (voor "Kleur gewijzigd naar Geel"). */
  markeringNamen?: Map<string, string>;
  /** De klanten die van een adres verhuisden: de klant die daarna komt is
   *  een nieuwe bewoner, en de naam van de vorige blijft weg. */
  verhuisdeKlanten?: Set<string>;
};

export type WijzigingRegel = Wijziging & { tekst: string };

/** Eén keer opslaan: dezelfde tijd en dezelfde rij. */
export type WijzigingGroep = {
  sleutel: string;
  op: string;
  tabel: string;
  rij_id: string;
  bron: WijzigingBron;
  /** "Timmie", "Paaltje" of "automatisch". */
  door: string;
  regels: WijzigingRegel[];
  /** Wat Ongedaan maken samen terugzet; leeg betekent: geen knop. */
  ongedaanIds: string[];
  /** Staat alles al terug, dan wanneer en door wie. */
  teruggedraaid: { op: string; naam: string } | null;
};

const LABEL: Record<string, string> = {
  frequentie: "Frequentie",
  notitie: "Notitie",
  overslaan: "Overslaan",
  markering: "Kleur",
  betaalmethode: "Betaalmethode",
  klant: "Klant",
  extra_werk: "Extra werk",
  duur: "Duur",
  eigen_blok: "Eigen blok",
  prijs: "Prijs",
  meerprijs: "Meerprijs van het extra werk",
  naam: "Naam",
  telefoon: "Telefoon",
  telefoon2: "Telefoon 2",
  email: "E-mail",
  email2: "E-mail 2",
  klanttype: "Klanttype",
  bedrijfsnaam: "Bedrijfsnaam",
  kvk: "KvK-nummer",
  btw_nummer: "Btw-nummer",
  factuur_per: "Factuur",
  factuur_email: "Factuur-e-mail",
  factuuradres: "Factuuradres",
  betalingstermijn: "Betalingstermijn",
  btw: "Btw",
  factuur_omschrijving: "Omschrijving op de factuur",
  verplaatst: "Verplaatst",
};

/** Velden waar "van … naar …" te lang wordt: alleen het nieuwe. */
const ALLEEN_NA = new Set(["notitie", "factuur_omschrijving", "factuuradres"]);
/** Velden zonder leesbare waarde: alleen dát ze veranderden. */
const ZONDER_WAARDE = new Set(["extra_werk", "meerprijs"]);

const KLANTTYPE: Record<string, string> = {
  particulier: "particulier",
  bedrijf: "bedrijf",
  vve: "VvE",
};
const FACTUUR_PER: Record<string, string> = {
  beurt: "per beurt",
  maand: "per maand",
  kwartaal: "per kwartaal",
  halfjaar: "per half jaar",
  jaar: "per jaar",
};

/** De kolommen die in `voor` en `na` kunnen staan (en waar de zinnen naar kijken). */
type Waarden = Partial<
  Record<
    | "interval_maanden"
    | "ritme"
    | "note"
    | "overslaan"
    | "start_maand"
    | "markering"
    | "betaalmethode"
    | "klant_id"
    | "duur_min"
    | "eigen_blok"
    | "prijs"
    | "klanttype"
    | "factuur_per"
    | "factuur_straat"
    | "factuur_huisnummer"
    | "factuur_postcode"
    | "factuur_plaats"
    | "betalingstermijn_dagen"
    | "btw_procent"
    | "btw_inclusief"
    | "factuur_omschrijving"
    | "datum",
    unknown
  >
>;

function tekst(x: unknown): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x);
}

function kort(x: string, max = 80): string {
  return x.length > max ? `${x.slice(0, max - 1)}…` : x;
}

/** "elke maand", "om de 2 maanden (even)", "om de 3 maanden (mrt·jun·sep·dec)". */
export function frequentieTekst(interval: number, ritme: number): string {
  const stap = interval || 1;
  if (stap <= 1) return "elke maand";
  if (stap === 2) return `om de 2 maanden (${ritme % 2 === 0 ? "even" : "oneven"})`;
  const sleutels = ritmeMaanden({ interval_maanden: stap, ritme }).map(
    (m) => `2000-${String(m).padStart(2, "0")}`,
  );
  if (stap === 12) return `eens per jaar (${toonMaand(sleutels[0] ?? "")})`;
  return `om de ${stap} maanden (${sleutels.map(toonMaandKort).join("·")})`;
}

/** "november 2026" bij een maandsleutel, anders de sleutel zelf. */
function maandMetJaar(sleutel: string): string {
  return /^\d{4}-\d{2}$/.test(sleutel) ? `${toonMaand(sleutel)} ${sleutel.slice(0, 4)}` : sleutel;
}

/** "8 sep", met het jaar erbij als het niet dit jaar is. */
function datumKort(iso: string): string {
  const [j, m, d] = iso.split("-").map(Number);
  if (!j || !m || !d) return iso;
  const datum = new Date(j, m - 1, d);
  const metJaar = j !== new Date().getFullYear();
  return datum.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    ...(metJaar ? { year: "numeric" } : {}),
  });
}

/** De waarde van een veld als korte tekst; "" is leeg. */
function waardeTekst(veld: string, v: Waarden, ctx: WijzigingContext): string {
  switch (veld) {
    case "frequentie":
      return frequentieTekst(Number(v.interval_maanden ?? 1), Number(v.ritme ?? 1));
    case "notitie":
      return tekst(v.note) ? `“${kort(tekst(v.note))}”` : "";
    case "markering": {
      const s = tekst(v.markering);
      return s ? (ctx.markeringNamen?.get(s) ?? "een andere kleur") : "";
    }
    case "betaalmethode": {
      const m = tekst(v.betaalmethode);
      return m === "contant" ? "contant" : m === "overmaken" ? "overmaken" : "zoals de wijk";
    }
    case "klant": {
      const id = tekst(v.klant_id);
      return id ? (ctx.klantNamen?.get(id) ?? "een gewiste klant") : "";
    }
    case "duur": {
      const n = v.duur_min;
      return typeof n === "number" ? `${n} minuten` : "";
    }
    case "eigen_blok":
      return v.eigen_blok ? "aan" : "uit";
    case "prijs":
      return formatPrice(Number(v.prijs ?? 0));
    case "klanttype":
      return KLANTTYPE[tekst(v.klanttype)] ?? tekst(v.klanttype);
    case "factuur_per":
      return FACTUUR_PER[tekst(v.factuur_per)] ?? tekst(v.factuur_per);
    case "factuuradres": {
      const straat = [tekst(v.factuur_straat), tekst(v.factuur_huisnummer)]
        .filter(Boolean)
        .join(" ");
      const plaats = [tekst(v.factuur_postcode), tekst(v.factuur_plaats)].filter(Boolean).join(" ");
      return [straat, plaats].filter(Boolean).join(", ");
    }
    case "betalingstermijn": {
      const n = v.betalingstermijn_dagen;
      return typeof n === "number" ? `${n} dagen` : "";
    }
    case "btw": {
      if (typeof v.btw_procent !== "number") return "";
      const pct = String(v.btw_procent).replace(".", ",");
      return `${pct}% ${v.btw_inclusief === false ? "exclusief" : "inclusief"}`;
    }
    case "factuur_omschrijving":
      return tekst(v.factuur_omschrijving) ? `“${kort(tekst(v.factuur_omschrijving))}”` : "";
    case "verplaatst":
      return tekst(v.datum) ? datumKort(tekst(v.datum)) : "";
    default: {
      // Eén kolom met dezelfde naam als het veld: naam, telefoon, e-mail, kvk…
      const waarden = Object.values(v);
      return waarden.length === 1 ? tekst(waarden[0]) : "";
    }
  }
}

/** Overslaan en de startmaand: welke maanden erbij en eraf, en vanaf wanneer. */
function overslaanTekst(voor: Waarden, na: Waarden): string {
  const lijst = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  const oud = lijst(voor.overslaan);
  const nieuw = lijst(na.overslaan);
  const erbij = nieuw.filter((m) => !oud.includes(m)).map(maandMetJaar);
  const eraf = oud.filter((m) => !nieuw.includes(m)).map(maandMetJaar);
  const delen: string[] = [];
  if (erbij.length) delen.push(`Overslaan: ${erbij.join(", ")}`);
  if (eraf.length)
    delen.push(`${erbij.length ? "niet meer" : "Niet meer overslaan"}: ${eraf.join(", ")}`);
  const start = tekst(na.start_maand);
  if (start !== tekst(voor.start_maand)) {
    delen.push(start ? `wassen vanaf ${maandMetJaar(start)}` : "wassen vanaf weggehaald");
  }
  if (delen.length === 0) return "Overslaan gewijzigd";
  const zin = delen.join("; ");
  return zin.charAt(0).toUpperCase() + zin.slice(1);
}

function alsObject(x: unknown): Waarden {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Waarden) : {};
}

/**
 * Eén regel in gewone taal: "Prijs gewijzigd van € 11,50 naar € 12,50",
 * "Frequentie gewijzigd naar om de 2 maanden (even)", "Verplaatst van 8 sep
 * naar 15 sep". Een Ongedaan maken leest als "Prijs teruggezet naar € 11,50".
 */
export function beschrijfWijziging(
  w: Pick<Wijziging, "veld" | "voor" | "na" | "herroept" | "bron">,
  ctx: WijzigingContext = {},
): string {
  const voor = alsObject(w.voor);
  const na = alsObject(w.na);
  const label = LABEL[w.veld] ?? w.veld;
  const a = waardeTekst(w.veld, voor, ctx);
  const b = waardeTekst(w.veld, na, ctx);

  if (w.veld === "verplaatst") return `Verplaatst van ${a} naar ${b}`;
  // De klant verhuisde: alles van vóór die dag is verborgen (verhuizing_log_legen).
  if (w.veld === "verhuisd") return "Verhuisd: geschiedenis van de vorige bewoner verborgen";
  if (w.herroept) {
    if (w.veld === "overslaan" || ZONDER_WAARDE.has(w.veld) || !b) return `${label} teruggezet`;
    return `${label} teruggezet naar ${b}`;
  }
  if (w.veld === "overslaan") return overslaanTekst(voor, na);
  if (ZONDER_WAARDE.has(w.veld)) return `${label} gewijzigd`;

  const hoe = w.bron === "systeem" ? "automatisch gewijzigd" : "gewijzigd";
  if (w.veld === "eigen_blok") return `Eigen blok ${b === "aan" ? "aangezet" : "uitgezet"}`;
  if (w.veld === "klant") {
    if (b && ctx.verhuisdeKlanten?.has(tekst(voor.klant_id))) return `Nieuwe bewoner: ${b}`;
    if (!a) return `Klant gekoppeld: ${b}`;
    if (!b) return `Klant losgekoppeld (was ${a})`;
    return `Andere klant: ${b} (was ${a})`;
  }
  if (!a && b) return `${label} ingevuld: ${b}`;
  if (a && !b) return `${label} weggehaald`;
  if (ALLEEN_NA.has(w.veld) || w.veld === "frequentie") return `${label} ${hoe} naar ${b}`;
  return `${label} ${hoe} van ${a} naar ${b}`;
}

/** Kan deze regel hier terug? Paaltje en het systeem hebben hun eigen plek;
 *  een verplaatsing zet je terug in de planning. */
export function kanOngedaan(w: Pick<Wijziging, "bron" | "tabel" | "teruggedraaid_op">): boolean {
  return (
    (w.bron === "app" || w.bron === "klant") && w.tabel !== "wasdag_regels" && !w.teruggedraaid_op
  );
}

/** Per opslag: dezelfde tijd en dezelfde rij. Nieuwste eerst. */
export function groepeerWijzigingen(
  rijen: Wijziging[],
  ctx: WijzigingContext = {},
): WijzigingGroep[] {
  const verhuisdeKlanten = new Set(
    rijen
      .filter((w) => w.veld === "verhuisd" && !w.teruggedraaid_op)
      .map((w) => tekst(alsObject(w.voor).klant_id))
      .filter(Boolean),
  );
  const zinCtx = verhuisdeKlanten.size > 0 ? { ...ctx, verhuisdeKlanten } : ctx;
  const groepen = new Map<string, WijzigingGroep>();
  const gesorteerd = [...rijen].sort((x, y) => (x.op < y.op ? 1 : x.op > y.op ? -1 : 0));
  for (const w of gesorteerd) {
    const sleutel = `${w.op}|${w.tabel}|${w.rij_id}`;
    let g = groepen.get(sleutel);
    if (!g) {
      const bron = (w.bron as WijzigingBron) ?? "app";
      g = {
        sleutel,
        op: w.op,
        tabel: w.tabel,
        rij_id: w.rij_id,
        bron,
        door:
          bron === "systeem"
            ? "automatisch"
            : bron === "paaltje"
              ? "Paaltje"
              : bron === "klant"
                ? "de klant zelf"
                : w.door_naam || "onbekend",
        regels: [],
        ongedaanIds: [],
        teruggedraaid: null,
      };
      groepen.set(sleutel, g);
    }
    g.regels.push({ ...w, tekst: beschrijfWijziging(w, zinCtx) });
    if (kanOngedaan(w)) g.ongedaanIds.push(w.id);
  }
  for (const g of groepen.values()) {
    const terug = g.regels.filter((r) => r.teruggedraaid_op);
    if (terug.length > 0 && terug.length === g.regels.length) {
      const laatste = terug.reduce((x, y) =>
        (x.teruggedraaid_op ?? "") > (y.teruggedraaid_op ?? "") ? x : y,
      );
      g.teruggedraaid = {
        op: laatste.teruggedraaid_op ?? "",
        naam: laatste.teruggedraaid_naam ?? "",
      };
    }
  }
  // Extra werk en zijn meerprijs worden los bewaard (eerst het adres, dan de
  // prijs), maar gaan samen terug: anders komt het werk terug zonder prijs.
  const lijst = [...groepen.values()];
  for (const g of lijst) {
    if (g.ongedaanIds.length === 0 || !g.regels.some((r) => r.veld === "extra_werk")) continue;
    const t = Date.parse(g.op);
    const afstand = (p: WijzigingGroep) => Math.abs(Date.parse(p.op) - t);
    const prijs = lijst
      .filter(
        (p) =>
          p.tabel === "adres_prijzen" &&
          p.rij_id === g.rij_id &&
          p.regels.some((r) => r.veld === "meerprijs" && kanOngedaan(r)) &&
          afstand(p) <= 60_000,
      )
      .sort((a, b) => afstand(a) - afstand(b))[0];
    if (prijs) {
      const samen = [...new Set([...g.ongedaanIds, ...prijs.ongedaanIds])];
      g.ongedaanIds = samen;
      prijs.ongedaanIds = samen;
    }
  }
  return lijst;
}

/**
 * Het log van één dossier: alles over dit adres, en de klantgegevens van de
 * klant die erbij hoort. Prijsregels komen alleen mee voor wie prijzen mag
 * zien (dat regelt de database).
 */
export async function fetchWijzigingen(
  customerId: string,
  klantId: string | null,
): Promise<WijzigingGroep[]> {
  // Wat een verhuizing verborg (verborgen_door) hoort bij de vorige bewoner.
  let vraag = supabase
    .from("wijzigingen")
    .select("*")
    .is("verborgen_door", null)
    .order("op", { ascending: false })
    .limit(500);
  vraag = klantId
    ? vraag.or(`customer_id.eq.${customerId},klant_id.eq.${klantId}`)
    : vraag.eq("customer_id", customerId);
  const { data, error } = await vraag;
  if (error) throw error;
  const rijen = (data ?? []) as Wijziging[];

  // Namen bij de ids, alleen als er iets op te zoeken valt.
  const klantIds = new Set<string>();
  const sleutels = new Set<string>();
  for (const w of rijen) {
    for (const v of [alsObject(w.voor), alsObject(w.na)]) {
      if (w.veld === "klant" && tekst(v.klant_id)) klantIds.add(tekst(v.klant_id));
      if (w.veld === "markering" && tekst(v.markering)) sleutels.add(tekst(v.markering));
    }
  }
  const [klanten, markeringen] = await Promise.all([
    klantIds.size
      ? supabase
          .from("klanten")
          .select("id,naam")
          .in("id", [...klantIds])
      : Promise.resolve({ data: [] as { id: string; naam: string }[], error: null }),
    sleutels.size
      ? supabase
          .from("markeringen")
          .select("sleutel,naam")
          .in("sleutel", [...sleutels])
      : Promise.resolve({ data: [] as { sleutel: string; naam: string }[], error: null }),
  ]);
  if (klanten.error) throw klanten.error;
  if (markeringen.error) throw markeringen.error;

  return groepeerWijzigingen(rijen, {
    klantNamen: new Map((klanten.data ?? []).map((k) => [k.id, k.naam || "naamloze klant"])),
    markeringNamen: new Map((markeringen.data ?? []).map((m) => [m.sleutel, m.naam])),
  });
}

/**
 * Zet een opslag terug (de `ongedaanIds` van een groep). Alles of niets; de
 * database weigert met een leesbare zin als het intussen opnieuw gewijzigd is
 * of als je rol het niet mag.
 */
export async function wijzigingenOngedaan(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("wijzigingen_ongedaan", { ids });
  if (error) throw error;
  return data ?? 0;
}
