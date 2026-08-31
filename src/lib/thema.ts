/**
 * Licht of donker. Standaard volgt de app je systeem; je kunt het ook vast
 * zetten. De keuze staat in localStorage, want hij hoort bij dit apparaat en
 * niet bij je account — op je telefoon wil je 's avonds misschien donker
 * terwijl de laptop op kantoor licht blijft.
 */

export type Thema = "systeem" | "licht" | "donker";

export const THEMA_OPSLAG = "glazenwas.thema";

export const themaLabels: Record<Thema, string> = {
  systeem: "Systeem",
  licht: "Licht",
  donker: "Donker",
};

export function leesThema(): Thema {
  if (typeof window === "undefined") return "systeem";
  try {
    const opgeslagen = window.localStorage.getItem(THEMA_OPSLAG);
    return opgeslagen === "licht" || opgeslagen === "donker" ? opgeslagen : "systeem";
  } catch {
    return "systeem";
  }
}

/** Wat er nu daadwerkelijk op het scherm staat, met "systeem" uitgerekend. */
export function isDonker(thema: Thema): boolean {
  if (thema !== "systeem") return thema === "donker";
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function pasThemaToe(thema: Thema) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDonker(thema));
}

export function bewaarThema(thema: Thema) {
  try {
    if (thema === "systeem") window.localStorage.removeItem(THEMA_OPSLAG);
    else window.localStorage.setItem(THEMA_OPSLAG, thema);
  } catch {
    // Privémodus: dan geldt de keuze alleen zolang dit tabblad open staat.
  }
  pasThemaToe(thema);
}

/**
 * Draait vóór het schilderen, als eerste in de <head>. Zonder dit zie je bij
 * elke paginalading eerst het lichte thema oplichten voordat React de klasse
 * zet — precies het moment waarop je in het donker zit te kijken.
 */
export const THEMA_SCRIPT = `(function(){try{
var k=localStorage.getItem(${JSON.stringify(THEMA_OPSLAG)});
var d=k==="donker"||(k!=="licht"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(d)document.documentElement.classList.add("dark");
}catch(e){}})();`;
