/**
 * De overzichten van Betalingen voor de eigenaar: wie wat ophaalde op een
 * avond, wie er nog moet betalen, en per straat een jaar zoals de papieren
 * kaart. Alleen lezen; rekenen doet de database (zie geld_overzichten).
 */
import { supabase } from "@/integrations/supabase/client";
import { beurtenTekst, type GeldDeel } from "@/lib/betalingen";

export interface Gebeurtenis {
  id: string;
  customer_id: string;
  adres: string;
  soort:
    | "beginstand"
    | "betaald"
    | "korting"
    | "niet_thuis"
    | "geen_geld"
    | "vooruit"
    | "terugbetaald"
    | "omgerekend";
  bedrag: number;
  reden: string;
  aantal: number | null;
  maanden: string[];
  bron: "geldloop" | "dag" | "kantoor";
  door: string | null;
  door_naam: string;
  op: string;
  vrijgave_id: string | null;
  botsing_met: string | null;
  /** Kwam veel later binnen dan hij getikt werd (geen bereik). */
  later_binnen?: boolean;
  ongedaan: { id: string; door_naam: string; op: string } | null;
  /** Bij vooruit: de prijs per beurt en vanaf welke beurt hij telt. */
  prijs_per_beurt?: number | null;
  vanaf?: string | null;
  /** Tikte de loper een andere prijs dan de gewone? Dan staat die hier. */
  prijs_verwacht?: number | null;
  /** Bij vooruit: hoeveel beurten al gebruikt of teruggegeven zijn. */
  gebruikt?: number;
  teruggegeven?: number;
  /** Bij omgerekend: hoeveel beurten er werden omgerekend. */
  omgerekend_van?: number;
}

function leesGebeurtenissen(x: unknown): Gebeurtenis[] {
  return (Array.isArray(x) ? x : []).map((ruw) => {
    const g = ruw as Gebeurtenis;
    return {
      ...g,
      bedrag: Number(g.bedrag ?? 0),
      maanden: g.maanden ?? [],
      prijs_per_beurt: g.prijs_per_beurt == null ? null : Number(g.prijs_per_beurt),
      prijs_verwacht: g.prijs_verwacht == null ? null : Number(g.prijs_verwacht),
      gebruikt: Number(g.gebruikt ?? 0),
      teruggegeven: Number(g.teruggegeven ?? 0),
      omgerekend_van: Number(g.omgerekend_van ?? 0),
    };
  });
}

export interface Avond {
  vrijgaven: {
    id: string;
    begin_op: string;
    eind_op: string;
    ingetrokken_op: string | null;
    wijken: string[];
    lopers: { id: string; naam: string }[];
  }[];
  gebeurtenissen: Gebeurtenis[];
  klachten: {
    id: string;
    omschrijving: string;
    customer_id: string | null;
    klant_id: string | null;
    adres: string | null;
    door_naam: string | null;
    op: string;
    status: string;
  }[];
  vaste_kortingen: {
    id: string;
    naam: string;
    bedrag: number;
    customer_id: string;
    adres: string;
    door_naam: string;
    op: string;
    weg: boolean;
  }[];
  pof: number;
  pof_adressen: number;
}

export async function fetchAvond(datum: string): Promise<Avond> {
  const { data, error } = await supabase.rpc("geld_avond", { datum });
  if (error) throw error;
  const x = data as unknown as Avond;
  return {
    vrijgaven: x.vrijgaven ?? [],
    gebeurtenissen: leesGebeurtenissen(x.gebeurtenissen),
    klachten: x.klachten ?? [],
    vaste_kortingen: (x.vaste_kortingen ?? []).map((k) => ({ ...k, bedrag: Number(k.bedrag) })),
    pof: Number(x.pof ?? 0),
    pof_adressen: Number(x.pof_adressen ?? 0),
  };
}

/** Per geldloper: wat hij ophaalde en hoe vaak hij aanbelde. */
export interface PerLoper {
  naam: string;
  door: string | null;
  opgehaald: number;
  betaald: number;
  /** Hoe vaak er beurten vooruit betaald zijn. */
  vooruit: number;
  nietThuis: number;
  geenGeld: number;
  korting: number;
}

export function perLoper(gebeurtenissen: Gebeurtenis[]): PerLoper[] {
  const uit = new Map<string, PerLoper>();
  for (const g of gebeurtenissen) {
    if (g.ongedaan) continue;
    const sleutel = g.door ?? g.door_naam;
    const r = uit.get(sleutel) ?? {
      naam: g.door_naam || "?",
      door: g.door,
      opgehaald: 0,
      betaald: 0,
      vooruit: 0,
      nietThuis: 0,
      geenGeld: 0,
      korting: 0,
    };
    // Vooruit is ook opgehaald geld; teruggegeven geld telt nooit mee.
    if (g.soort === "betaald") {
      r.opgehaald += g.bedrag;
      r.betaald += 1;
    } else if (g.soort === "vooruit") {
      r.opgehaald += g.bedrag;
      r.vooruit += 1;
    } else if (g.soort === "korting") r.korting += g.bedrag;
    else if (g.soort === "niet_thuis") r.nietThuis += 1;
    else if (g.soort === "geen_geld") r.geenGeld += 1;
    uit.set(sleutel, r);
  }
  return [...uit.values()].sort((a, b) => b.opgehaald - a.opgehaald);
}

export interface PofRegel {
  id: string;
  wijk_id: string;
  wijk: string;
  straat_id: string;
  straat: string;
  house_number: number;
  addition: string;
  naam: string;
  methode: "contant" | "overmaken";
  gestopt: boolean;
  open: number;
  open_wassen: number;
  delen: GeldDeel[];
  vooruit_over: number;
  vooruit_waarde: number;
  /** Beurten die niet meer gebruikt worden (gestopt, of een nieuwe bewoner). */
  vooruit_vast: number;
  /** Ongebruikte beurten van vorige bewoners, en van de huidige (laatste) klant. */
  vooruit_vorige: number;
  vooruit_vorige_waarde: number;
  vooruit_eigen: number;
  vooruit_eigen_waarde: number;
  /**
   * Wat er nu terug moet: de beurten van vorige bewoners, en bij een gestopt
   * adres ook de eigen beurten plus tegoed, min wat er nog open staat.
   */
  terug: number;
  laatst_betaald: string | null;
  laatste_poging: { soort: "niet_thuis" | "geen_geld"; op: string; door_naam: string } | null;
}

export async function fetchPof(wijken: string[] | null): Promise<PofRegel[]> {
  const { data, error } = await supabase.rpc("geld_pof", { wijken });
  if (error) throw error;
  return (Array.isArray(data) ? (data as unknown as PofRegel[]) : []).map((r) => ({
    ...r,
    open: Number(r.open),
    open_wassen: Number(r.open_wassen),
    vooruit_over: Number(r.vooruit_over ?? 0),
    vooruit_waarde: Number(r.vooruit_waarde ?? 0),
    vooruit_vast: Number(r.vooruit_vast ?? 0),
    vooruit_vorige: Number(r.vooruit_vorige ?? 0),
    vooruit_vorige_waarde: Number(r.vooruit_vorige_waarde ?? 0),
    vooruit_eigen: Number(r.vooruit_eigen ?? 0),
    vooruit_eigen_waarde: Number(r.vooruit_eigen_waarde ?? 0),
    terug: Number(r.terug ?? 0),
  }));
}

export interface KaartPost {
  soort: "beginstand" | "wassen" | "klus";
  datum: string;
  bedrag: number;
  aantal: number;
  omschrijving: string;
  gedekt: number;
  betaald_soort: "betaald" | "korting" | "vooruit" | null;
  /** Wat er met een vooruitbetaalde beurt van betaald is. */
  vooruit: number;
  betaald_op: string | null;
  betaald_door: string | null;
  /** Bij een wasbeurt: de ronde ("2026-09"). Een septemberbeurt op
   *  1 oktober hoort in het septembervakje. */
  ronde?: string | null;
}

export interface KaartAdres {
  id: string;
  posten: KaartPost[];
  vooruit_over: number;
  vooruit_vast: number;
  gebeurtenissen: Gebeurtenis[];
}

export interface Kaart {
  wijk: { id: string; naam: string; peildatum: string | null; betaalmethode: string };
  adressen: KaartAdres[];
}

export async function fetchKaart(straat: string, jaar: number): Promise<Kaart> {
  const { data, error } = await supabase.rpc("geld_kaart", { straat, jaar });
  if (error) throw error;
  const x = data as unknown as Kaart;
  return {
    wijk: x.wijk,
    adressen: (x.adressen ?? []).map((a) => ({
      id: a.id,
      posten: (a.posten ?? []).map((p) => ({
        ...p,
        bedrag: Number(p.bedrag),
        gedekt: Number(p.gedekt),
        aantal: Number(p.aantal ?? 1),
        vooruit: Number(p.vooruit ?? 0),
      })),
      vooruit_over: Number(a.vooruit_over ?? 0),
      vooruit_vast: Number(a.vooruit_vast ?? 0),
      gebeurtenissen: leesGebeurtenissen(a.gebeurtenissen),
    })),
  };
}

/** Een geplande of net uitgevoerde wissel naar overmaken (zie het dossier). */
export interface Betaalwissel {
  status: "gepland" | "uitgevoerd";
  gepland_op: string | null;
  gepland_naam: string | null;
  uitgevoerd_op: string | null;
}

export interface GeldAdres {
  open: number;
  open_wassen: number;
  delen: GeldDeel[];
  /** Vooruitbetaalde beurten die nog niet gebruikt zijn (ook die vastzitten). */
  vooruit_over: number;
  vooruit_waarde: number;
  /** Daarvan: die niet meer gebruikt worden (gestopt, of een nieuwe bewoner). */
  vooruit_vast: number;
  /** Ongebruikte beurten van vorige bewoners, en van de huidige (laatste) klant. */
  vooruit_vorige: number;
  vooruit_vorige_waarde: number;
  vooruit_eigen: number;
  vooruit_eigen_waarde: number;
  /** Wat er nu terug moet (zoals de server het bij "Teruggegeven" controleert). */
  terug: number;
  /** De prijs per beurt voor een nieuwe vooruitbetaling; leeg zonder prijs. */
  vooruit_p: number | null;
  wissel: Betaalwissel | null;
  gebeurtenissen: Gebeurtenis[];
  vaste_kortingen: { id: string; naam: string; bedrag: number; door_naam: string; op: string }[];
}

export async function fetchGeldAdres(adres: string): Promise<GeldAdres> {
  const { data, error } = await supabase.rpc("geld_adres", { adres });
  if (error) throw error;
  const x = data as unknown as GeldAdres;
  return {
    open: Number(x.open ?? 0),
    open_wassen: Number(x.open_wassen ?? 0),
    delen: (x.delen ?? []).map((d) => ({
      ...d,
      bedrag: Number(d.bedrag),
      rest: Number(d.rest),
      aantal: Number(d.aantal ?? 1),
      omschrijving: d.omschrijving ?? "",
      vooruit: Number(d.vooruit ?? 0),
    })),
    vooruit_over: Number(x.vooruit_over ?? 0),
    vooruit_waarde: Number(x.vooruit_waarde ?? 0),
    vooruit_vast: Number(x.vooruit_vast ?? 0),
    vooruit_vorige: Number(x.vooruit_vorige ?? 0),
    vooruit_vorige_waarde: Number(x.vooruit_vorige_waarde ?? 0),
    vooruit_eigen: Number(x.vooruit_eigen ?? 0),
    vooruit_eigen_waarde: Number(x.vooruit_eigen_waarde ?? 0),
    terug: Number(x.terug ?? 0),
    vooruit_p: x.vooruit_p == null ? null : Number(x.vooruit_p),
    wissel: x.wissel ?? null,
    gebeurtenissen: leesGebeurtenissen(x.gebeurtenissen),
    vaste_kortingen: (x.vaste_kortingen ?? []).map((k) => ({ ...k, bedrag: Number(k.bedrag) })),
  };
}

/** "Betaald", "Niet thuis", ... zoals op het scherm. */
export function soortLabel(s: Gebeurtenis["soort"]): string {
  return {
    beginstand: "Beginstand",
    betaald: "Betaald",
    korting: "Korting",
    niet_thuis: "Niet thuis",
    geen_geld: "Geen geld",
    vooruit: "Vooruit betaald",
    terugbetaald: "Teruggegeven",
    omgerekend: "Omgerekend naar nieuwe prijs",
  }[s];
}

/** "4 beurten vooruit", voor een regel in een overzicht. */
export function vooruitLabel(aantal: number | null | undefined): string {
  return `${beurtenTekst(aantal ?? 0)} vooruit`;
}

/**
 * Wat de bevestiging zegt bij het ongedaan maken van een vooruitbetaling:
 * beurten die al gebruikt zijn, komen weer open te staan.
 */
export function vooruitOngedaanTekst(g: Pick<Gebeurtenis, "aantal" | "gebruikt">): string {
  const gebruikt = g.gebruikt ?? 0;
  return gebruikt > 0
    ? `${gebruikt} van de ${g.aantal ?? 0} beurten ${gebruikt === 1 ? "is" : "zijn"} al gebruikt; die komen weer open te staan. De rest vervalt.`
    : "Er is nog geen beurt van gebruikt; de beurten vervallen.";
}
