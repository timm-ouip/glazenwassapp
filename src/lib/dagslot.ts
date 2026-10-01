/**
 * De dagplanning of het geldlopen vastzetten: staat een slot aan, dan opent
 * de app op dit toestel meteen op de route van vandaag (of op het loopscherm
 * van de avond) in plaats van op Home. Handig onderweg — je pakt de telefoon
 * en je staat er.
 *
 * De sloten horen bij het toestel (localStorage), niet bij het account: wie
 * op kantoor plant, wil gewoon op Home beginnen. Er kan er maar één aan staan:
 * de app kan maar op één plek openen, dus zet je de een vast, dan gaat de
 * ander los.
 */
import { useSyncExternalStore } from "react";

const DAG = "wooshy.dag-vast";
const GELDLOOP = "wooshy.geldloop-vast";
/** Tot wanneer het slot op het geldlopen geldt: het eind van die avond. */
const GELDLOOP_TOT = "wooshy.geldloop-tot";
/** Zelfde tab: het storage-event komt alleen bij de andere tabs aan. */
const GEWISSELD = "wooshy:dag-vast";

function staatAan(sleutel: string): boolean {
  try {
    return localStorage.getItem(sleutel) === "1";
  } catch {
    // Privémodus of geblokkeerde opslag: dan is er geen slot.
    return false;
  }
}

function zet(sleutel: string, ander: string, aan: boolean, tot?: string) {
  try {
    // Gaat het geldloop-slot om (of weg, doordat de dag vast gaat), dan gaat
    // zijn oude eindtijd mee; een nieuwe staat er vóór het seintje hieronder,
    // zodat wie meeleest meteen de goede stand ziet.
    if (sleutel === GELDLOOP || aan) localStorage.removeItem(GELDLOOP_TOT);
    if (aan) {
      localStorage.setItem(sleutel, "1");
      localStorage.removeItem(ander);
      if (tot) localStorage.setItem(GELDLOOP_TOT, tot);
    } else localStorage.removeItem(sleutel);
  } catch {
    /* zie staatAan() */
  }
  window.dispatchEvent(new Event(GEWISSELD));
}

export function dagVast(): boolean {
  return staatAan(DAG);
}

export function zetDagVast(aan: boolean) {
  zet(DAG, GELDLOOP, aan);
}

/**
 * Opent de app op dit toestel meteen op het loopscherm van de avond? Is die
 * avond voorbij, dan niet meer: de volgende ochtend begin je gewoon op Home,
 * zonder eerst het slot los te hoeven maken. Zonder eindtijd geldt het niet.
 */
export function geldloopVast(): boolean {
  if (!staatAan(GELDLOOP)) return false;
  try {
    const tot = Date.parse(localStorage.getItem(GELDLOOP_TOT) ?? "");
    return Date.now() < tot;
  } catch {
    return false;
  }
}

/** `tot`: het eind van de avond; daarna gaat het slot vanzelf los. */
export function zetGeldloopVast(aan: boolean, tot?: string) {
  zet(GELDLOOP, DAG, aan, tot);
}

function luister(veranderd: () => void) {
  const opOpslag = (e: StorageEvent) => {
    // key is null als de hele opslag gewist werd.
    if (e.key === DAG || e.key === GELDLOOP || e.key === GELDLOOP_TOT || e.key === null)
      veranderd();
  };
  window.addEventListener(GEWISSELD, veranderd);
  window.addEventListener("storage", opOpslag);
  return () => {
    window.removeEventListener(GEWISSELD, veranderd);
    window.removeEventListener("storage", opOpslag);
  };
}

/**
 * Staat het slot aan? Volgt het meteen als het omgaat, ook vanuit een andere
 * tab. Op de server (en bij het hydrateren) uit: die kent de opslag niet.
 */
export function useDagVast(): boolean {
  return useSyncExternalStore(luister, dagVast, () => false);
}

/** Hetzelfde voor het slot op het geldlopen. */
export function useGeldloopVast(): boolean {
  return useSyncExternalStore(luister, geldloopVast, () => false);
}

/**
 * Opende de app kaal op Home of de wijken? Alleen dan gaat hij naar de dag of
 * het loopscherm: zo start het beginscherm-icoon (nu op /home, eerder op /).
 * Een link naar een wijk of dag (`/?dag=…`) of naar
 * een andere pagina blijft waar hij is, net als herladen — anders gooit een
 * pull-to-refresh je midden in het plannen uit de wijken. Wordt vastgelegd
 * zodra dit bestand laadt, en dat is bij het opstarten: de root importeert het.
 */
let kaleStart =
  typeof window !== "undefined" &&
  (window.location.pathname === "/" || window.location.pathname === "/home") &&
  window.location.search === "" &&
  (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
    ?.type !== "reload";

/** Eén keer per keer dat de app opent: moet hij ergens anders heen, en waar? */
export function startBijOpstarten(): "dag" | "lopen" | null {
  const ja = kaleStart;
  kaleStart = false;
  if (!ja) return null;
  if (dagVast()) return "dag";
  if (geldloopVast()) return "lopen";
  return null;
}
