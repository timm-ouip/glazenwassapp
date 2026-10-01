/**
 * De geldkaart in vakjes, los van het scherm: wat er in één maandvakje van
 * één adres staat. Gedeeld door de geldkaart bij Betalingen (een hele straat)
 * en het tabblad Geld in het klantdossier (één adres), zodat die twee altijd
 * hetzelfde laten zien.
 */
import { vooruitMaanden, vooruitStart } from "@/lib/betalingen";
import { maandwerkVoor, ritmeMaanden, type Customer } from "@/lib/klanten";
import type { KaartAdres, KaartPost } from "@/lib/overzichten";

export type Vak =
  | { soort: "betaald"; aantal: number; korting: boolean }
  | { soort: "open"; nogOpen: boolean }
  /** Met een vooruitbetaalde beurt betaald, of (gepland) daar straks mee.
   *  `meerOpen`: de beurt is vooruit betaald, maar het extra werk nog niet. */
  | { soort: "vooruit"; gepland: boolean; meerOpen?: boolean }
  | { soort: "overgeslagen" }
  | { soort: "niet_aan_de_beurt" }
  | { soort: "leeg" };

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
  const over = (data?.vooruit_over ?? 0) - (data?.vooruit_vast ?? 0);
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
 * Wat er in één maandvakje staat, zoals op de papieren kaart:
 *   1, 2 …  zoveel wasbeurten zijn die maand betaald (2 = er stond er een open)
 *   0       er is gewassen (of de kaart stond open) maar niet betaald
 *   B       met een vooruitbetaalde beurt betaald; licht als die beurt nog
 *           moet komen (de beurten die over zijn, op de komende maanden)
 *   ×       overgeslagen, buiten de gewone frequentie om
 *   %       niet aan de beurt volgens de frequentie
 * Losse klussen tellen niet mee: op de kaart staan alleen wasbeurten. Een
 * wasbeurt die met eerder tegoed betaald is, telt in de maand dat hij gewassen
 * werd.
 */
export function vakVoor(
  c: Customer,
  data: KaartAdres | undefined,
  maand: string,
  peilMaand: string | null,
  concept?: string[],
  gepland: string[] = [],
): Vak {
  const posten = (data?.posten ?? []).filter((p) => p.soort !== "klus");
  // Net aangevinkt maar nog niet bewaard: dat tonen we alvast.
  const beginMaanden = concept ?? beginMaandenVan(data);
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
      aantal: betaald.reduce((t, p) => t + (p.soort === "beginstand" ? p.aantal : 1), 0),
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
  // de startmaand.
  if (peilMaand && maand <= peilMaand) {
    const begin = posten.find((p) => p.soort === "beginstand");
    if (
      beginMaanden.includes(maand) ||
      (!concept && begin && beginMaanden.length === 0 && maand === peilMaand)
    ) {
      return {
        soort: "open",
        nogOpen: !!concept || !begin || begin.gedekt < begin.bedrag - 0.005,
      };
    }
  }
  // Vanaf de startmaand: gewassen maar (nog) niet betaald.
  if (!peilMaand || maand >= peilMaand) {
    const gewassen = posten.filter((p) => p.soort === "wassen" && vakjeVan(p) === maand);
    if (gewassen.length > 0) {
      return { soort: "open", nogOpen: gewassen.some((p) => p.gedekt < p.bedrag - 0.005) };
    }
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
      return "0";
    case "vooruit":
      return "B";
    case "overgeslagen":
      return "×";
    case "niet_aan_de_beurt":
      return "%";
    case "leeg":
      return "";
  }
}
