/**
 * Rekenen met tijd op een dag: welke blokken er staan, hoe laat ze beginnen,
 * hoe vol de dag is, en welk tijdvak een klant beloofd kan worden.
 *
 * Bewust zuivere functies zonder database erin. De weekweergave, de
 * dagweergave, de dagpagina en de aankondiging rekenen hier alle vier mee;
 * zouden ze het los van elkaar doen, dan staan er tijden op één scherm die
 * niet bij elkaar passen.
 *
 * Een blok is een straat, een groot pand apart, of een extra opdracht. Blokken
 * staan niet in de database: ze volgen uit de regels van die dag (welke ploeg,
 * welke volgorde, en of het de rest van een straat is).
 *
 * Alle duren zijn minuten werk voor één persoon. De klok loopt anders: met
 * twee man in een ploeg is een blok van een uur in een half uur klaar.
 */

/** De instellingen van het bedrijf (companies.plan_*). */
export interface PlanInstellingen {
  tariefUur: number;
  begin: string;
  eind: string;
  pauzeVan: string;
  pauzeMin: number;
  rijtijdMin: number;
  grootPandMin: number;
  tijdlijn: boolean;
  tijdvakMailen: boolean;
}

export const STANDAARD_INSTELLINGEN: PlanInstellingen = {
  tariefUur: 75,
  begin: "08:00",
  eind: "16:30",
  pauzeVan: "12:00",
  pauzeMin: 30,
  rijtijdMin: 15,
  grootPandMin: 45,
  tijdlijn: true,
  tijdvakMailen: false,
};

/** Wie er die dag in een ploeg zit. */
export interface PloegLid {
  teamlid_id: string;
  naam: string;
  employee_id: string | null;
}

/** Een ploeg op één dag; lege tijden betekenen: de standaard van het bedrijf. */
export interface Ploeg {
  nr: number;
  leden: PloegLid[];
  begin?: string | null;
  eind?: string | null;
  pauzeVan?: string | null;
  pauzeMin?: number | null;
}

/** Eén adres op een dag, zoals het in de database staat. */
export interface DagRegel {
  customer_id: string;
  ploeg_nr: number | null;
  volgorde: number | null;
  rest: boolean;
  vaste_start: string | null;
}

/** Eén extra opdracht op een dag. */
export interface DagKlus {
  id: string;
  customer_id: string;
  omschrijving: string;
  duur: number;
  bedrag: number;
  ploeg_nr: number | null;
  volgorde: number | null;
  vaste_start: string | null;
}

/** Wat de rekenkern van een adres moet weten. De duur en de prijs van die
 *  maand rekent de aanroeper uit (duurVoorMaand, prijsVoorMaand). */
export interface AdresInfo {
  id: string;
  street_id: string;
  sort_order: number;
  house_number: number;
  addition: string;
  naam: string;
  duur: number;
  bedrag: number;
  eigenBlok: boolean;
}

export interface StraatInfo {
  id: string;
  naam: string;
  wijk_id: string;
  sort_order: number;
}

export interface WijkInfo {
  id: string;
  naam: string;
  sort_order: number;
  /** Plek in de wijkenlijst. Daar hangt de kleur van de wijk aan (`wijkVlak`,
   *  `wijkInkt`), dus hij moet dezelfde lijst en dezelfde volgorde volgen als
   *  de kalender — anders krijgt dezelfde wijk twee kleuren. */
  index: number;
}

export type BlokSoort = "straat" | "pand" | "klus";

export interface Blok {
  /** Uniek op een dag: "s:<straat>", "s:<straat>:rest", "c:<adres>", "k:<klus>". */
  sleutel: string;
  soort: BlokSoort;
  titel: string;
  wijk_id: string;
  wijknaam: string;
  street_id: string | null;
  /** De adressen in dit blok, op volgorde. Bij een klus het adres eromheen. */
  adressen: string[];
  klusId?: string;
  /** Minuten werk voor één persoon. */
  duur: number;
  bedrag: number;
  volgorde: number | null;
  vasteStart: string | null;
  /** Dit is de rest van een straat die op een andere dag begon. */
  rest: boolean;
}

/** Ploeg 0 betekent: nog niet ingedeeld. */
export const NIET_INGEDEELD = 0;

// ---------------------------------------------------------------------
// Tijd
// ---------------------------------------------------------------------

/** "08:30" → 510 minuten na middernacht. Leeg of onleesbaar → null. */
export function minutenVan(tijd: string | null | undefined): number | null {
  if (!tijd) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(tijd);
  if (!m) return null;
  const uren = Number(m[1]);
  const min = Number(m[2]);
  if (uren > 23 || min > 59) return null;
  return uren * 60 + min;
}

/** 510 → "08:30". */
export function tijdVan(minuten: number): string {
  const heel = Math.max(0, Math.round(minuten));
  const u = Math.floor(heel / 60) % 24;
  const m = heel % 60;
  return `${String(u).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "1u20" of "45m"; 0 wordt "0m". */
export function duurTekst(minuten: number): string {
  const m = Math.max(0, Math.round(minuten));
  const u = Math.floor(m / 60);
  const rest = m % 60;
  if (u === 0) return `${rest}m`;
  return rest === 0 ? `${u}u` : `${u}u${String(rest).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Blokken
// ---------------------------------------------------------------------

interface BlokInvoer {
  regels: DagRegel[];
  klussen?: DagKlus[];
  adressen: Map<string, AdresInfo>;
  straten: Map<string, StraatInfo>;
  wijken: Map<string, WijkInfo>;
}

/**
 * De blokken van één dag, per ploeg. Een straat is één blok; een groot pand
 * (of een adres dat je apart zette) krijgt een eigen blok, en een extra
 * opdracht ook. Zonder eigen volgorde vallen blokken achteraan, in de gewone
 * volgorde: wijk, straat, huisnummer.
 */
export function maakBlokken(invoer: BlokInvoer): Map<number, Blok[]> {
  const { regels, adressen, straten, wijken } = invoer;
  const perSleutel = new Map<
    string,
    Blok & { ploeg: number; wijkVolgorde: number; straatVolgorde: number; eersteNummer: number }
  >();

  for (const r of regels) {
    if (!r.customer_id) continue;
    const adres = adressen.get(r.customer_id);
    if (!adres) continue;
    const straat = straten.get(adres.street_id);
    const wijk = straat ? wijken.get(straat.wijk_id) : undefined;
    const ploeg = r.ploeg_nr ?? NIET_INGEDEELD;
    const sleutel = adres.eigenBlok
      ? `c:${adres.id}`
      : `s:${adres.street_id}${r.rest ? ":rest" : ""}:${ploeg}`;

    const bestaand = perSleutel.get(sleutel);
    if (bestaand) {
      bestaand.adressen.push(adres.id);
      bestaand.duur += adres.duur;
      bestaand.bedrag += adres.bedrag;
      bestaand.eersteNummer = Math.min(bestaand.eersteNummer, adres.house_number);
      // De laagste volgorde telt: zo blijft een straat bij elkaar, ook als
      // één adres later is bijgezet zonder volgorde.
      if (r.volgorde !== null && (bestaand.volgorde === null || r.volgorde < bestaand.volgorde)) {
        bestaand.volgorde = r.volgorde;
      }
      if (r.vaste_start && !bestaand.vasteStart) bestaand.vasteStart = r.vaste_start;
      continue;
    }

    perSleutel.set(sleutel, {
      sleutel,
      soort: adres.eigenBlok ? "pand" : "straat",
      titel: adres.eigenBlok
        ? adres.naam
        : `${straat?.naam ?? "Onbekende straat"}${r.rest ? " (rest)" : ""}`,
      wijk_id: wijk?.id ?? "",
      wijknaam: wijk?.naam ?? "",
      street_id: adres.street_id,
      adressen: [adres.id],
      duur: adres.duur,
      bedrag: adres.bedrag,
      volgorde: r.volgorde,
      vasteStart: r.vaste_start,
      rest: r.rest,
      ploeg,
      wijkVolgorde: wijk?.sort_order ?? 9999,
      straatVolgorde: straat?.sort_order ?? 9999,
      eersteNummer: adres.house_number,
    });
  }

  for (const k of invoer.klussen ?? []) {
    const adres = adressen.get(k.customer_id);
    const straat = adres ? straten.get(adres.street_id) : undefined;
    const wijk = straat ? wijken.get(straat.wijk_id) : undefined;
    perSleutel.set(`k:${k.id}`, {
      sleutel: `k:${k.id}`,
      soort: "klus",
      titel: `${k.omschrijving}${adres ? ` — ${adres.naam}` : ""}`,
      wijk_id: wijk?.id ?? "",
      wijknaam: wijk?.naam ?? "",
      street_id: adres?.street_id ?? null,
      adressen: adres ? [adres.id] : [],
      klusId: k.id,
      duur: k.duur,
      bedrag: k.bedrag,
      volgorde: k.volgorde,
      vasteStart: k.vaste_start,
      rest: false,
      ploeg: k.ploeg_nr ?? NIET_INGEDEELD,
      wijkVolgorde: wijk?.sort_order ?? 9999,
      straatVolgorde: straat?.sort_order ?? 9999,
      eersteNummer: adres?.house_number ?? 0,
    });
  }

  const perPloeg = new Map<number, Blok[]>();
  for (const b of perSleutel.values()) {
    const lijst = perPloeg.get(b.ploeg) ?? [];
    lijst.push(b);
    perPloeg.set(b.ploeg, lijst);
  }
  for (const [ploeg, lijst] of perPloeg) {
    lijst.sort((a, b) => {
      const av = a.volgorde ?? Number.MAX_SAFE_INTEGER;
      const bv = b.volgorde ?? Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
      const aa = a as Blok & { wijkVolgorde: number; straatVolgorde: number; eersteNummer: number };
      const bb = b as Blok & { wijkVolgorde: number; straatVolgorde: number; eersteNummer: number };
      if (aa.wijkVolgorde !== bb.wijkVolgorde) return aa.wijkVolgorde - bb.wijkVolgorde;
      if (aa.straatVolgorde !== bb.straatVolgorde) return aa.straatVolgorde - bb.straatVolgorde;
      return aa.eersteNummer - bb.eersteNummer;
    });
    perPloeg.set(ploeg, lijst);
  }
  return perPloeg;
}

// ---------------------------------------------------------------------
// Tijden en hoe vol een dag is
// ---------------------------------------------------------------------

export interface DagOpzet {
  begin: string;
  eind: string;
  pauzeVan: string;
  pauzeMin: number;
  rijtijdMin: number;
  /** Hoeveel mensen er in deze ploeg werken (minstens 1). */
  mensen: number;
}

export type ItemSoort = BlokSoort | "pauze" | "rijtijd";

export interface TijdlijnItem {
  sleutel: string;
  soort: ItemSoort;
  titel: string;
  /** Minuten na middernacht. */
  start: number;
  /** Hoe lang het op de klok duurt (dus gedeeld door het aantal mensen). */
  minuten: number;
  blok?: Blok;
}

export interface Tijdlijn {
  items: TijdlijnItem[];
  /** Werk op de klok, zonder pauze: waar de vol-balk mee rekent. */
  werkMin: number;
  /** Wat er op een dag past, op de klok: eind − begin − pauze. */
  capaciteitMin: number;
  /** Hoe laat je klaar bent (minuten na middernacht). */
  klaarOm: number;
  /** Loopt het over de eindtijd heen? */
  teVol: boolean;
}

/** De opzet van een ploeg: zijn eigen tijden, anders die van het bedrijf. */
export function opzetVan(instellingen: PlanInstellingen, ploeg?: Ploeg | null): DagOpzet {
  return {
    begin: ploeg?.begin || instellingen.begin,
    eind: ploeg?.eind || instellingen.eind,
    pauzeVan: ploeg?.pauzeVan || instellingen.pauzeVan,
    pauzeMin: ploeg?.pauzeMin ?? instellingen.pauzeMin,
    rijtijdMin: instellingen.rijtijdMin,
    mensen: Math.max(1, ploeg?.leden.length ?? 1),
  };
}

/**
 * De blokken op de klok zetten. Tussen twee wijken komt rijtijd, en de pauze
 * valt op de eerste bloknaad vanaf de pauzetijd — blokken worden niet
 * doormidden geknipt, want je stopt niet halverwege een straat.
 */
export function berekenTijden(blokken: Blok[], opzet: DagOpzet): Tijdlijn {
  const begin = minutenVan(opzet.begin) ?? 480;
  const eind = minutenVan(opzet.eind) ?? 990;
  const pauzeVan = minutenVan(opzet.pauzeVan);
  const items: TijdlijnItem[] = [];
  let klok = begin;
  let werk = 0;
  let pauzeGezet = opzet.pauzeMin <= 0 || pauzeVan === null;
  let vorigeWijk: string | null = null;

  for (const blok of blokken) {
    // Naar een andere wijk rijden kost tijd; binnen een wijk loop je door.
    if (vorigeWijk !== null && blok.wijk_id !== vorigeWijk && opzet.rijtijdMin > 0) {
      items.push({
        sleutel: `rij:${blok.sleutel}`,
        soort: "rijtijd",
        titel: `Naar ${blok.wijknaam || "de volgende wijk"}`,
        start: klok,
        minuten: opzet.rijtijdMin,
      });
      klok += opzet.rijtijdMin;
      werk += opzet.rijtijdMin;
    }

    if (!pauzeGezet && pauzeVan !== null && klok >= pauzeVan) {
      items.push({
        sleutel: "pauze",
        soort: "pauze",
        titel: "Pauze",
        start: klok,
        minuten: opzet.pauzeMin,
      });
      klok += opzet.pauzeMin;
      pauzeGezet = true;
    }

    const vast = minutenVan(blok.vasteStart);
    if (vast !== null && vast > klok) klok = vast;

    const minuten = Math.max(1, Math.ceil(blok.duur / opzet.mensen));
    items.push({
      sleutel: blok.sleutel,
      soort: blok.soort,
      titel: blok.titel,
      start: klok,
      minuten,
      blok,
    });
    klok += minuten;
    werk += minuten;
    vorigeWijk = blok.wijk_id;
  }

  const capaciteit = Math.max(0, eind - begin - Math.max(0, opzet.pauzeMin));
  return { items, werkMin: werk, capaciteitMin: capaciteit, klaarOm: klok, teVol: klok > eind };
}

/** Hoe vol de dag is, in procenten (kan boven de 100 komen). */
export function volPercentage(t: Pick<Tijdlijn, "werkMin" | "capaciteitMin">): number {
  if (t.capaciteitMin <= 0) return t.werkMin > 0 ? 100 : 0;
  return Math.round((t.werkMin / t.capaciteitMin) * 100);
}

/**
 * Het tijdvak dat je een klant belooft: een venster van twee uur rond de
 * geplande starttijd, op halve uren, met een half uur speling vooraf. Loopt
 * een blok uit, dan is het nog steeds waar.
 */
export function tijdvakVan(startMinuten: number, dagBegin?: string): { van: string; tot: string } {
  const ondergrens = minutenVan(dagBegin ?? null);
  let van = Math.floor((startMinuten - 30) / 30) * 30;
  if (ondergrens !== null && van < ondergrens) van = ondergrens;
  if (van < 0) van = 0;
  return { van: tijdVan(van), tot: tijdVan(van + 120) };
}

/** Het tijdvak van een blok in een berekende tijdlijn, of null. */
export function tijdvakVanBlok(tijdlijn: Tijdlijn, sleutel: string, dagBegin?: string) {
  const item = tijdlijn.items.find((i) => i.sleutel === sleutel);
  return item ? tijdvakVan(item.start, dagBegin) : null;
}

// ---------------------------------------------------------------------
// Nog in te plannen, en het voorstel
// ---------------------------------------------------------------------

export interface OpenBlok {
  sleutel: string;
  titel: string;
  wijk_id: string;
  wijknaam: string;
  street_id: string;
  adressen: string[];
  duur: number;
  bedrag: number;
  wijkVolgorde: number;
  straatVolgorde: number;
}

/**
 * De straten die deze maand nog aan de beurt zijn en nog nergens gepland
 * staan, als blokken in de volgorde van de ronde. Dit is de strook naast de
 * weekweergave.
 */
export function nogInTePlannen(
  teDoen: AdresInfo[],
  straten: Map<string, StraatInfo>,
  wijken: Map<string, WijkInfo>,
): OpenBlok[] {
  const per = new Map<string, OpenBlok>();
  for (const adres of teDoen) {
    const straat = straten.get(adres.street_id);
    const wijk = straat ? wijken.get(straat.wijk_id) : undefined;
    const sleutel = `s:${adres.street_id}`;
    const bestaand = per.get(sleutel);
    if (bestaand) {
      bestaand.adressen.push(adres.id);
      bestaand.duur += adres.duur;
      bestaand.bedrag += adres.bedrag;
      continue;
    }
    per.set(sleutel, {
      sleutel,
      titel: straat?.naam ?? "Onbekende straat",
      wijk_id: wijk?.id ?? "",
      wijknaam: wijk?.naam ?? "",
      street_id: adres.street_id,
      adressen: [adres.id],
      duur: adres.duur,
      bedrag: adres.bedrag,
      wijkVolgorde: wijk?.sort_order ?? 9999,
      straatVolgorde: straat?.sort_order ?? 9999,
    });
  }
  return [...per.values()].sort(
    (a, b) => a.wijkVolgorde - b.wijkVolgorde || a.straatVolgorde - b.straatVolgorde,
  );
}

export interface VrijePlek {
  datum: string;
  ploeg_nr: number;
  /** Hoeveel minuten er op de klok nog bij kunnen. */
  vrij: number;
  mensen: number;
}

export interface Voorstel {
  datum: string;
  ploeg_nr: number;
  blokken: OpenBlok[];
}

/**
 * Een voorstel: wat zou er passen in de vrije ruimte van deze week? De app
 * zet niets neer — dit is de gestippelde schets die je zelf kunt volgen.
 */
export function stelWeekVoor(open: OpenBlok[], plekken: VrijePlek[]): Voorstel[] {
  const wachtrij = [...open];
  const uit: Voorstel[] = [];
  for (const plek of plekken) {
    let vrij = plek.vrij;
    const hier: OpenBlok[] = [];
    while (wachtrij.length > 0) {
      const eerste = wachtrij[0]!;
      const klok = Math.ceil(eerste.duur / Math.max(1, plek.mensen));
      if (klok > vrij) break;
      vrij -= klok;
      hier.push(eerste);
      wachtrij.shift();
    }
    if (hier.length > 0) uit.push({ datum: plek.datum, ploeg_nr: plek.ploeg_nr, blokken: hier });
  }
  return uit;
}
