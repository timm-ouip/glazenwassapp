/**
 * Licht of donker. Standaard volgt de app je systeem; je kunt het ook vast
 * zetten. De keuze staat in localStorage, want hij hoort bij dit apparaat en
 * niet bij je account — op je telefoon wil je 's avonds misschien donker
 * terwijl de laptop op kantoor licht blijft.
 *
 * Er zijn twee thema's. Fel zijn felle kleurvlakken met grote cijfers, op warm
 * papier of op zwart; dat is waar de app in staat als je niets kiest.
 * Zakelijk is de rustige: koelgrijs, witte kaarten met een dun randje, bijna
 * zwarte knoppen en muntgroen als enige accent.
 *
 * "Systeem" is alleen Fel: dat is het thema dat met je systeem meewisselt.
 * Kies je Zakelijk, dan kies je er licht of donker bij.
 *
 * Er staat altijd een thema op de pagina: zonder de klasse `fel` of `zak`
 * heeft de stylesheet (src/styles.css) alleen de gedeelde bodem en geen
 * kleuren. `pasThemaToe` en het script in de <head> zetten er daarom altijd
 * een van de twee neer.
 */

export type Thema = "systeem" | "fel-licht" | "fel-donker" | "zak-licht" | "zak-donker";

export const THEMA_OPSLAG = "glazenwas.thema";

export const themaLabels: Record<Thema, string> = {
  systeem: "Systeem",
  "fel-licht": "Fel licht",
  "fel-donker": "Fel donker",
  "zak-licht": "Zakelijk licht",
  "zak-donker": "Zakelijk donker",
};

/** De twee families, voor de keuzelijst in Instellingen. */
export type ThemaFamilie = "fel" | "zak";

export const familieLabels: Record<ThemaFamilie, string> = {
  fel: "Fel",
  zak: "Zakelijk",
};

export const familieOmschrijving: Record<ThemaFamilie, string> = {
  fel: "felle vlakken, grote cijfers",
  zak: "koelgrijs, dunne randen, rustig",
};

/** Welke keuzes er per familie zijn. Fel kan ook met het systeem meelopen. */
export const familieKeuzes: Record<ThemaFamilie, Thema[]> = {
  fel: ["systeem", "fel-licht", "fel-donker"],
  zak: ["zak-licht", "zak-donker"],
};

/** Het korte woord achter de familienaam in de lijst: Systeem, Licht, Donker. */
export const keuzeLabels: Record<Thema, string> = {
  systeem: "Systeem",
  "fel-licht": "Licht",
  "fel-donker": "Donker",
  "zak-licht": "Licht",
  "zak-donker": "Donker",
};

export function familieVan(thema: Thema): ThemaFamilie {
  return isZakelijk(thema) ? "zak" : "fel";
}

function isThema(waarde: string | null): waarde is Thema {
  return waarde !== null && Object.hasOwn(themaLabels, waarde);
}

export function leesThema(): Thema {
  if (typeof window === "undefined") return "systeem";
  try {
    const opgeslagen = window.localStorage.getItem(THEMA_OPSLAG);
    // Wie nog een weggehaald thema bewaard had, komt hier op Fel uit.
    return isThema(opgeslagen) ? opgeslagen : "systeem";
  } catch {
    return "systeem";
  }
}

/** Wat er nu daadwerkelijk op het scherm staat, met "systeem" uitgerekend. */
export function isDonker(thema: Thema): boolean {
  if (thema !== "systeem") return thema === "fel-donker" || thema === "zak-donker";
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function isZakelijk(thema: Thema): boolean {
  return thema === "zak-licht" || thema === "zak-donker";
}

/** Alles wat niet zakelijk is, is Fel — ook "systeem". */
export function isFel(thema: Thema): boolean {
  return !isZakelijk(thema);
}

export function pasThemaToe(thema: Thema) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDonker(thema));
  document.documentElement.classList.toggle("zak", isZakelijk(thema));
  document.documentElement.classList.toggle("fel", isFel(thema));
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
 * zet — precies het moment waarop je in het donker zit te kijken. Zonder
 * `fel` of `zak` heeft de pagina helemaal geen kleuren; de server zet `fel`
 * er alvast op (__root.tsx) en dit script wisselt hem zo nodig om.
 */
export const THEMA_SCRIPT = `(function(){try{
var k=localStorage.getItem(${JSON.stringify(THEMA_OPSLAG)});
var z=k==="zak-licht"||k==="zak-donker";
var vast=k==="fel-licht"||k==="zak-licht";
var d=k==="fel-donker"||k==="zak-donker"||(!vast&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var el=document.documentElement;
if(d)el.classList.add("dark");
el.classList.toggle("zak",z);
el.classList.toggle("fel",!z);
}catch(e){}})();`;
