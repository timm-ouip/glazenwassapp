/**
 * Licht of donker. Standaard volgt de app je systeem; je kunt het ook vast
 * zetten. De keuze staat in localStorage, want hij hoort bij dit apparaat en
 * niet bij je account — op je telefoon wil je 's avonds misschien donker
 * terwijl de laptop op kantoor licht blijft.
 *
 * Er zijn drie thema's. Crème (licht en donker) is warm papier met zwevende
 * panelen. Fel zijn felle kleurvlakken met grote cijfers, op warm papier of op
 * zwart. Zakelijk is de rustige: koelgrijs, witte kaarten met een dun randje,
 * bijna zwarte knoppen en muntgroen als enige accent.
 *
 * "Systeem" is alleen crème: dat is het thema dat met je systeem meewisselt.
 * Kies je Fel of Zakelijk, dan kies je er licht of donker bij.
 */

export type Thema =
  "systeem" | "licht" | "donker" | "fel-licht" | "fel-donker" | "zak-licht" | "zak-donker";

export const THEMA_OPSLAG = "glazenwas.thema";

export const themaLabels: Record<Thema, string> = {
  systeem: "Systeem",
  licht: "Licht",
  donker: "Donker",
  "fel-licht": "Fel licht",
  "fel-donker": "Fel donker",
  "zak-licht": "Zakelijk licht",
  "zak-donker": "Zakelijk donker",
};

/** De drie families, voor de keuzelijst in Instellingen. */
export type ThemaFamilie = "creme" | "fel" | "zak";

export const familieLabels: Record<ThemaFamilie, string> = {
  creme: "Crème",
  fel: "Fel",
  zak: "Zakelijk",
};

export const familieOmschrijving: Record<ThemaFamilie, string> = {
  creme: "warm papier, zwevende panelen",
  fel: "felle vlakken, grote cijfers",
  zak: "koelgrijs, dunne randen, rustig",
};

/** Welke keuzes er per familie zijn. Crème kan ook met het systeem meelopen. */
export const familieKeuzes: Record<ThemaFamilie, Thema[]> = {
  creme: ["systeem", "licht", "donker"],
  fel: ["fel-licht", "fel-donker"],
  zak: ["zak-licht", "zak-donker"],
};

/** Het korte woord achter de familienaam in de lijst: Systeem, Licht, Donker. */
export const keuzeLabels: Record<Thema, string> = {
  systeem: "Systeem",
  licht: "Licht",
  donker: "Donker",
  "fel-licht": "Licht",
  "fel-donker": "Donker",
  "zak-licht": "Licht",
  "zak-donker": "Donker",
};

export function familieVan(thema: Thema): ThemaFamilie {
  if (isFel(thema)) return "fel";
  if (isZakelijk(thema)) return "zak";
  return "creme";
}

function isThema(waarde: string | null): waarde is Thema {
  return waarde !== null && Object.hasOwn(themaLabels, waarde);
}

export function leesThema(): Thema {
  if (typeof window === "undefined") return "systeem";
  try {
    const opgeslagen = window.localStorage.getItem(THEMA_OPSLAG);
    return isThema(opgeslagen) ? opgeslagen : "systeem";
  } catch {
    return "systeem";
  }
}

/** Wat er nu daadwerkelijk op het scherm staat, met "systeem" uitgerekend. */
export function isDonker(thema: Thema): boolean {
  if (thema !== "systeem") {
    return thema === "donker" || thema === "fel-donker" || thema === "zak-donker";
  }
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function isFel(thema: Thema): boolean {
  return thema === "fel-licht" || thema === "fel-donker";
}

export function isZakelijk(thema: Thema): boolean {
  return thema === "zak-licht" || thema === "zak-donker";
}

export function pasThemaToe(thema: Thema) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDonker(thema));
  document.documentElement.classList.toggle("fel", isFel(thema));
  document.documentElement.classList.toggle("zak", isZakelijk(thema));
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
var f=k==="fel-licht"||k==="fel-donker";
var z=k==="zak-licht"||k==="zak-donker";
var vast=k==="licht"||k==="fel-licht"||k==="zak-licht";
var d=k==="donker"||k==="fel-donker"||k==="zak-donker"||(!vast&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(d)document.documentElement.classList.add("dark");
if(f)document.documentElement.classList.add("fel");
if(z)document.documentElement.classList.add("zak");
}catch(e){}})();`;
