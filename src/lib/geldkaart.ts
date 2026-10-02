/**
 * De geldkaart in vakjes, los van het scherm: wat er in één maandvakje van
 * één adres staat. Gedeeld door de geldkaart bij Betalingen (een hele straat)
 * en het tabblad Geld in het klantdossier (één adres), zodat die twee altijd
 * hetzelfde laten zien.
 */
import { vooruitMaanden, vooruitStart } from "@/lib/betalingen";
import { formatPrice, maandwerkVoor, ritmeMaanden, type Customer } from "@/lib/klanten";
import type { KaartAdres, KaartPost } from "@/lib/overzichten";
import { cn } from "@/lib/utils";

export type Vak =
  | { soort: "betaald"; aantal: number; korting: boolean }
  /** `kaart`: zo ingevuld op de kaart (0, een letter met bedrag of +bedrag).
   *  `bedrag`: wat er (nog) open staat; als het niet meer open staat, wat
   *  het was. */
  | { soort: "open"; nogOpen: boolean; kaart?: KaartVakje; bedrag?: number }
  /** Met een vooruitbetaalde beurt betaald, of (gepland) daar straks mee.
   *  `meerOpen`: de beurt is vooruit betaald, maar het extra werk nog niet.
   *  `kaart`: een 1 van de papieren kaart, die beurt komt nog. */
  | { soort: "vooruit"; gepland: boolean; meerOpen?: boolean; kaart?: boolean }
  /** `kaart`: met een x op de kaart gezet (niet gewassen). */
  | { soort: "overgeslagen"; kaart?: boolean }
  | { soort: "niet_aan_de_beurt" }
  | { soort: "leeg" };

/**
 * Eén vakje zoals het op de kaart is ingevuld:
 *   0        een hele beurt niet betaald (bedrag = de adresprijs)
 *   x        niet gewassen: er staat niets open
 *   a, v, …  een eigen letter (v = alleen de voorkant) met wat er open staat
 *   +        te weinig betaald: het bedrag staat nog open
 *   1        na de start: die maand was al vooruit betaald
 * `ingetypt`: geen echt vakje maar een beginstand die als bedrag is
 * ingetypt; die staat als 0 in de startmaand.
 */
export interface KaartVakje {
  maand: string;
  teken: string;
  bedrag: number;
  ingetypt?: boolean;
}

export function maandVan(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** In welk maandvakje een post hoort: bij een wasbeurt de ronde, zodat de
 *  septemberbeurt die uitliep tot 1 oktober in september staat. */
export function vakjeVan(p: KaartPost): string {
  return p.ronde || p.datum.slice(0, 7);
}

/**
 * De maanden die de vooruitbetaalde beurten die nog over zijn ongeveer gaan
 * dekken: vanaf deze maand, of de maand na de laatste gewassen beurt. Bij een
 * gestopt adres (of een nieuwe bewoner) worden ze niet meer gebruikt.
 */
export function vooruitGepland(c: Customer, data: KaartAdres | undefined): string[] {
  // De enen van de kaart staan al in hun eigen maanden; die tellen hier niet.
  const over =
    (data?.vooruit_over ?? 0) - (data?.vooruit_vast ?? 0) - (data?.kaart_vooruit?.over ?? 0);
  if (!data || over <= 0 || c.inactief_op) return [];
  const rondes = data.posten.filter((p) => p.soort === "wassen").map(vakjeVan);
  const laatste = rondes.reduce<string | null>((m, r) => (!m || r > m ? r : m), null);
  return vooruitMaanden(c, over, vooruitStart(laatste));
}

/** De maanden die in de beginstand open stonden ("2026-07"), uit de post. */
export function beginMaandenVan(data: KaartAdres | undefined): string[] {
  const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
  return (begin?.omschrijving ?? "").split(",").filter((m) => /^\d{4}-\d{2}$/.test(m));
}

/**
 * Alles wat er op de kaart is ingevuld, over alle jaren: de vakjes van de
 * beginstand en de enen van na de start. Een oude beginstand (alleen
 * maanden) wordt een rij nullen; een ingetypt bedrag zonder maanden een 0 in
 * de startmaand, met `ingetypt`.
 */
export function kaartVakjesVan(
  data: KaartAdres | undefined,
  peilMaand: string | null,
): KaartVakje[] {
  const uit: KaartVakje[] = [];
  if (data?.begin_vakjes) {
    uit.push(...data.begin_vakjes);
  } else {
    const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
    const maanden = beginMaandenVan(data);
    for (const maand of maanden) {
      uit.push({ maand, teken: "0", bedrag: begin ? begin.bedrag / maanden.length : 0 });
    }
    if (begin && maanden.length === 0 && peilMaand) {
      uit.push({ maand: peilMaand, teken: "0", bedrag: begin.bedrag, ingetypt: true });
    }
  }
  for (const maand of data?.kaart_vooruit?.maanden ?? [])
    uit.push({ maand, teken: "1", bedrag: 0 });
  return uit.sort((a, b) => a.maand.localeCompare(b.maand));
}

/**
 * In welke maanden een 1 van de kaart nog licht staat: de beurten ervan gaan
 * naar de eerstvolgende wasbeurten, niet per se in die maanden. Daarom alleen
 * zoveel enen als er beurten over zijn, de laatste, en niet waar al gewassen
 * is (daar staat de beurt zelf).
 */
export function kaartEnenOver(data: KaartAdres | undefined): string[] {
  const kv = data?.kaart_vooruit;
  if (!kv || kv.over <= 0) return [];
  const gewassen = new Set((data?.posten ?? []).filter((p) => p.soort === "wassen").map(vakjeVan));
  return kv.maanden.filter((m) => !gewassen.has(m)).slice(-kv.over);
}

/** Een bedrag zo kort mogelijk, voor in een vakje: 5, 12,5. */
export function kortBedrag(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** Hoe een ingevuld vakje eruitziet: 0, ×, v, +5 of 1. */
export function vakjeTeken(v: Pick<KaartVakje, "teken" | "bedrag">): string {
  if (v.teken === "x") return "×";
  if (v.teken === "+") return `+${kortBedrag(v.bedrag)}`;
  return v.teken;
}

/**
 * Wat je in een vakje typt, gelezen: "0", "x", "1", "v 8", "v8", "+5",
 * "+ 12,50". Hoofdletters mogen. Een letter of + heeft een bedrag nodig;
 * de B niet, want die staat al voor vooruit betaald.
 */
export function leesVakInvoer(tekst: string): { teken: string; bedrag: number } | { fout: string } {
  const t = tekst.trim().toLowerCase();
  if (t === "0") return { teken: "0", bedrag: 0 };
  if (t === "x" || t === "×") return { teken: "x", bedrag: 0 };
  if (t === "1") return { teken: "1", bedrag: 0 };
  const m = /^([a-z+])\s*(?:€\s*)?(\d+(?:[.,]\d{1,2})?)?$/.exec(t);
  if (!m) return { fout: "Typ 0, x, een letter met een bedrag (v 8) of + met een bedrag (+5)." };
  const teken = m[1]!;
  if (teken === "b") {
    return { fout: "De B staat al voor vooruit betaald. Kies een andere letter." };
  }
  if (teken === "x") return { fout: "Een x is niet gewassen, zonder bedrag." };
  if (!m[2]) {
    return {
      fout:
        teken === "+"
          ? "Zet er een bedrag achter, bijvoorbeeld +5."
          : `Zet er een bedrag achter, bijvoorbeeld ${teken} 8.`,
    };
  }
  const bedrag = Math.round(Number(m[2].replace(",", ".")) * 100) / 100;
  if (!(bedrag > 0) || bedrag > 10000) return { fout: "Vul een bedrag tussen 0,01 en 10.000 in." };
  return { teken, bedrag };
}

/**
 * Wat er van een rij vakjes naar de database gaat (geld_kaart_zetten): de
 * beginstand en de enen apart, en alleen het deel dat echt anders is dan
 * wat er staat (`was`); null = laat staan. Zo verandert een 1 nooit een oude
 * beginstand, en blijft een ingetypt bedrag staan tot je het vervangt.
 */
export function kaartDelen(
  lijst: KaartVakje[],
  was: KaartVakje[],
): { begin: { maand: string; teken: string; bedrag: number }[] | null; vooruit: string[] | null } {
  const beginVan = (l: KaartVakje[]) => l.filter((v) => v.teken !== "1");
  const vooruitVan = (l: KaartVakje[]) => l.filter((v) => v.teken === "1").map((v) => v.maand);
  const sleutel = (l: KaartVakje[]) =>
    beginVan(l)
      .map(
        (v) =>
          `${v.maand}${v.teken}${v.teken === "0" || v.teken === "x" ? "" : v.bedrag}${v.ingetypt ? "i" : ""}`,
      )
      .join("|");
  const begin = beginVan(lijst);
  return {
    begin:
      sleutel(lijst) === sleutel(was)
        ? null
        : begin
            .filter((v) => !v.ingetypt)
            .map((v) => ({ maand: v.maand, teken: v.teken, bedrag: v.bedrag })),
    vooruit: vooruitVan(lijst).join() === vooruitVan(was).join() ? null : vooruitVan(lijst),
  };
}

/**
 * Wat er in één maandvakje staat, zoals op de papieren kaart:
 *   1, 2 …  zoveel wasbeurten zijn die maand betaald (2 = er stond er een open)
 *   0       er is gewassen (of de kaart stond open) maar niet betaald
 *   v, +5   vóór de start: een deel open (een letter met bedrag, of te
 *           weinig betaald), zoals op de kaart ingevuld
 *   B       met een vooruitbetaalde beurt betaald; licht als die beurt nog
 *           moet komen (de beurten die over zijn, op de komende maanden)
 *   1 licht na de start: vooruit betaald van de papieren kaart, die beurt
 *           komt nog
 *   ×       overgeslagen, buiten de gewone frequentie om (of op de kaart
 *           als niet gewassen gezet)
 *   %       niet aan de beurt volgens de frequentie
 * Losse klussen tellen niet mee: op de kaart staan alleen wasbeurten. Een
 * wasbeurt die met eerder tegoed betaald is, telt in de maand dat hij gewassen
 * werd. `concept`: wat er net is ingevuld maar nog niet bewaard (alle vakjes
 * van dit adres, zie kaartVakjesVan).
 */
export function vakVoor(
  c: Customer,
  data: KaartAdres | undefined,
  maand: string,
  peilMaand: string | null,
  concept?: KaartVakje[],
  gepland: string[] = [],
): Vak {
  const posten = (data?.posten ?? []).filter((p) => p.soort !== "klus");
  // Net ingevuld maar nog niet bewaard: dat tonen we alvast.
  const vakje = (concept ?? kaartVakjesVan(data, peilMaand)).find((v) => v.maand === maand);
  const betaald = posten.filter((p) => {
    // Een beurt die met vooruit betaald is, staat als B in zijn eigen vakje
    // (ook als het extra werk later met euro's is betaald).
    if (!p.betaald_op || p.betaald_soort === "vooruit" || p.vooruit > 0.005) return false;
    const betaalMaand = maandVan(p.betaald_op);
    // Pas later betaald dan de maand waarin gewassen werd: dan staat het in
    // de maand van betalen. Anders in het vakje van de beurt (de ronde).
    return (betaalMaand > p.datum.slice(0, 7) ? betaalMaand : vakjeVan(p)) === maand;
  });
  if (betaald.length > 0) {
    return {
      soort: "betaald",
      // Een beginstand van alleen een letter of + is geen hele beurt, maar
      // telt hier wel als één keer betaald.
      aantal: betaald.reduce(
        (t, p) => t + (p.soort === "beginstand" ? Math.max(1, p.aantal) : 1),
        0,
      ),
      korting: betaald.every((p) => p.betaald_soort === "korting"),
    };
  }
  // Met vooruit betaald: altijd in het vakje van de beurt zelf, want het
  // geld kwam er (meestal) vóór.
  const vooruit = posten.filter(
    (p) => (p.betaald_soort === "vooruit" || p.vooruit > 0.005) && vakjeVan(p) === maand,
  );
  if (vooruit.length > 0) {
    return {
      soort: "vooruit",
      gepland: false,
      meerOpen: vooruit.some((p) => p.gedekt < p.bedrag - 0.005),
    };
  }
  // Vóór (en in) de startmaand: wat er op de kaart nog open stond. Is de
  // beginstand als bedrag ingetypt (zonder maanden), dan staat hij als 0 in
  // de startmaand (zie kaartVakjesVan).
  if (peilMaand && maand <= peilMaand && vakje && vakje.teken !== "1") {
    if (vakje.teken === "x") return { soort: "overgeslagen", kaart: true };
    const begin = posten.find((p) => p.soort === "beginstand");
    return {
      soort: "open",
      nogOpen: !!concept || !begin || begin.gedekt < begin.bedrag - 0.005,
      kaart: vakje,
      bedrag: vakje.bedrag,
    };
  }
  // Vanaf de startmaand: gewassen maar (nog) niet betaald.
  if (!peilMaand || maand >= peilMaand) {
    const gewassen = posten.filter((p) => p.soort === "wassen" && vakjeVan(p) === maand);
    if (gewassen.length > 0) {
      const nogOpen = gewassen.some((p) => p.gedekt < p.bedrag - 0.005);
      const bedrag = gewassen.reduce((t, p) => t + (nogOpen ? p.bedrag - p.gedekt : p.bedrag), 0);
      return { soort: "open", nogOpen, bedrag: Math.round(bedrag * 100) / 100 };
    }
  }
  // Na de start een 1 van de kaart: vooruit betaald, die beurt komt nog.
  // Net ingevuld staan ze er allemaal; daarna alleen zolang er beurten over zijn.
  if (
    vakje?.teken === "1" &&
    (!peilMaand || maand > peilMaand) &&
    (concept || kaartEnenOver(data).includes(maand))
  ) {
    return { soort: "vooruit", gepland: true, kaart: true };
  }
  if (c.overslaan.includes(maand)) return { soort: "overgeslagen" };
  const m = Number(maand.slice(5, 7));
  if (!ritmeMaanden(c).includes(m) && maandwerkVoor(c, maand).length === 0) {
    return { soort: "niet_aan_de_beurt" };
  }
  if (gepland.includes(maand)) return { soort: "vooruit", gepland: true };
  return { soort: "leeg" };
}

/** Het teken in een vakje, zoals op de papieren kaart (zie vakVoor). */
export function vakTeken(vak: Vak): string {
  switch (vak.soort) {
    case "betaald":
      return String(vak.aantal);
    case "open":
      return vak.kaart ? vakjeTeken(vak.kaart) : "0";
    case "vooruit":
      return vak.kaart ? "1" : "B";
    case "overgeslagen":
      return "×";
    case "niet_aan_de_beurt":
      return "%";
    case "leeg":
      return "";
  }
}

/**
 * De kleur van een vakje op de kaart van één adres (het dossier en de
 * geldkaart van één klant). Een open plek met een oranje rand: daar komt de
 * volgende beurt.
 */
export function vakKleur(vak: Vak, volgende: boolean): string {
  switch (vak.soort) {
    case "betaald":
      return vak.korting
        ? "bg-tint-paars font-semibold text-tint-paars-ink"
        : "bg-tint-salie font-semibold text-tint-salie-ink";
    case "open":
      return vak.nogOpen
        ? "bg-tint-rood font-semibold text-tint-rood-ink"
        : "font-semibold text-tint-rood-ink/60 ring-1 ring-inset ring-border";
    case "vooruit":
      return vak.gepland
        ? cn(
            "border-dashed font-semibold text-tint-groen-ink/60",
            volgende ? "border-primary" : "border-tint-groen-ink/40",
          )
        : vak.meerOpen
          ? "bg-tint-groen font-semibold text-tint-groen-ink ring-2 ring-inset ring-tint-rood-ink/60"
          : "bg-tint-groen font-semibold text-tint-groen-ink";
    case "overgeslagen":
      return "bg-tint-geel text-tint-geel-ink";
    case "niet_aan_de_beurt":
      return "bg-muted text-foreground";
    case "leeg":
      return volgende ? "border-primary" : "ring-1 ring-inset ring-border";
  }
}

// ---------------------------------------------------------------------------
// In woorden
//
// De codes (0, x, v 8, +5, 1) zijn alleen nog invoer: wat je op het scherm
// ziet, staat in woorden. Eén plek voor die vertaling, zodat de straatkaart,
// de kaart van één klant en het dossier hetzelfde zeggen.
// ---------------------------------------------------------------------------

/**
 * Wat er gedaan is als een beurt maar deels gewassen is: de letter die op de
 * kaart komt, en wat hij betekent. Op de papieren kaart staat v voor alleen
 * de voorkant; a (achterkant) en d (iets anders) horen bij de knoppen van de
 * kaart van één klant. Een andere letter (getypt op de straatkaart) heet
 * gewoon "deels gewassen".
 */
export const DEELS_GEWASSEN = [
  { teken: "v", label: "Alleen voorkant", kort: "Voorkant" },
  { teken: "a", label: "Alleen achterkant", kort: "Achter" },
  { teken: "d", label: "Deels gewassen", kort: "Deels" },
] as const;

function letterVan(teken: string): { label: string; kort: string } {
  return (
    DEELS_GEWASSEN.find((d) => d.teken === teken) ?? { label: "Deels gewassen", kort: "Deels" }
  );
}

/** Een vakje van de kaart in woorden, voluit: "Alleen voorkant · € 8 open". */
export function vakjeWoorden(v: Pick<KaartVakje, "teken" | "bedrag" | "ingetypt">): string {
  if (v.teken === "x") return "Niet gewassen";
  if (v.teken === "1") return "Al betaald (van de kaart)";
  if (v.teken === "0") {
    return v.ingetypt
      ? `Beginstand ${formatPrice(v.bedrag)} open`
      : v.bedrag > 0
        ? `Open · ${formatPrice(v.bedrag)}`
        : "Open";
  }
  if (v.teken === "+") return `${formatPrice(v.bedrag)} te weinig betaald`;
  return `${letterVan(v.teken).label} · ${formatPrice(v.bedrag)} open`;
}

/**
 * Wat er in één vakje staat, in woorden: `kort` in hooguit twee korte regels
 * voor in het vakje zelf, `lang` voluit (voor als je het aanwijst, en voor
 * een schermlezer). Leeg vakje: geen regels.
 */
export function vakWoorden(vak: Vak): { kort: string[]; lang: string } {
  switch (vak.soort) {
    case "betaald": {
      if (vak.korting) return { kort: ["Korting"], lang: "Met korting afgeboekt" };
      return vak.aantal > 1
        ? { kort: [`${vak.aantal}×`, "betaald"], lang: `${vak.aantal} beurten betaald` }
        : { kort: ["Betaald"], lang: "Betaald" };
    }
    case "open": {
      const k = vak.kaart;
      const bedrag = vak.bedrag ?? k?.bedrag ?? 0;
      const geld = bedrag > 0 ? formatPrice(bedrag) : "";
      if (!vak.nogOpen) {
        return {
          kort: ["Later", "betaald"],
          lang: `Stond open${geld ? ` (${geld})` : ""}, later betaald`,
        };
      }
      if (k && k.teken === "+") {
        return { kort: ["Te weinig", geld], lang: vakjeWoorden(k) };
      }
      if (k && k.teken !== "0") {
        // Het rood zegt al dat het open staat; zo blijft het bedrag heel.
        return { kort: [letterVan(k.teken).kort, geld], lang: vakjeWoorden(k) };
      }
      return {
        kort: geld ? ["Open", geld] : ["Open"],
        lang: k?.ingetypt ? vakjeWoorden(k) : geld ? `Open · ${geld}` : "Open",
      };
    }
    case "vooruit":
      if (vak.kaart) {
        return { kort: ["Al", "betaald"], lang: "Al betaald, van de papieren kaart" };
      }
      if (vak.gepland) {
        return { kort: ["Vooruit", "betaald"], lang: "Vooruit betaald, die beurt komt nog" };
      }
      return vak.meerOpen
        ? {
            kort: ["Vooruit", "+ extra"],
            lang: "Vooruit betaald, het extra werk staat nog open",
          }
        : { kort: ["Vooruit", "betaald"], lang: "Vooruit betaald" };
    case "overgeslagen":
      return vak.kaart
        ? { kort: ["Niet", "gewassen"], lang: "Niet gewassen" }
        : { kort: ["Over-", "geslagen"], lang: "Overgeslagen" };
    case "niet_aan_de_beurt":
      return { kort: ["Niet aan", "de beurt"], lang: "Niet aan de beurt" };
    case "leeg":
      return { kort: [], lang: "" };
  }
}

/**
 * Hoe één maand op de kaart stond, in woorden, voor het log onderaan de
 * kaart van een klant: "Open · € 27", "Niet gewassen", "Al betaald (van de
 * kaart)", of "Leeg".
 */
export function kaartStandWoorden(
  s: { vakje: Pick<KaartVakje, "teken" | "bedrag"> | null; een: boolean } | null | undefined,
): string {
  if (s?.vakje) return vakjeWoorden({ ...s.vakje, bedrag: Number(s.vakje.bedrag) });
  return s?.een ? "Al betaald (van de kaart)" : "Leeg";
}
