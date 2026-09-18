/**
 * De dagplanning vastzetten: staat het slot aan, dan opent de app op dit
 * toestel meteen op de route van vandaag in plaats van op de wijken. Handig
 * tijdens het wassen — je pakt de telefoon en de dag staat er.
 *
 * Het slot hoort bij het toestel (localStorage), niet bij het account: wie op
 * kantoor plant, wil gewoon op de wijken beginnen.
 */
const SLEUTEL = "wooshy.dag-vast";

export function dagVast(): boolean {
  try {
    return localStorage.getItem(SLEUTEL) === "1";
  } catch {
    // Privémodus of geblokkeerde opslag: dan is er geen slot.
    return false;
  }
}

export function zetDagVast(aan: boolean) {
  try {
    if (aan) localStorage.setItem(SLEUTEL, "1");
    else localStorage.removeItem(SLEUTEL);
  } catch {
    /* zie dagVast() */
  }
}

/**
 * Opende de app kaal op de wijken? Alleen dan gaat hij naar de dag: zo start
 * het beginscherm-icoon. Een link naar een wijk of dag (`/?dag=…`) of naar
 * een andere pagina blijft waar hij is, net als herladen — anders gooit een
 * pull-to-refresh je midden in het plannen uit de wijken. Wordt vastgelegd
 * zodra dit bestand laadt, en dat is bij het opstarten: de root importeert het.
 */
let kaleStart =
  typeof window !== "undefined" &&
  window.location.pathname === "/" &&
  window.location.search === "" &&
  (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
    ?.type !== "reload";

/** Eén keer per keer dat de app opent: moet hij naar de dag? */
export function naarDagBijOpstarten(): boolean {
  const ja = kaleStart;
  kaleStart = false;
  return ja && dagVast();
}
