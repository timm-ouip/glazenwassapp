/**
 * De overzichten van Betalingen voor de eigenaar: wie wat ophaalde op een
 * avond, wie er nog moet betalen, en per straat een jaar zoals de papieren
 * kaart. Alleen lezen; rekenen doet de database (zie geld_overzichten).
 */
import { supabase } from "@/integrations/supabase/client";
import type { GeldDeel } from "@/lib/betalingen";

export interface Gebeurtenis {
  id: string;
  customer_id: string;
  adres: string;
  soort: "beginstand" | "betaald" | "korting" | "niet_thuis" | "geen_geld";
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
}

function leesGebeurtenissen(x: unknown): Gebeurtenis[] {
  return (Array.isArray(x) ? x : []).map((g) => ({
    ...(g as Gebeurtenis),
    bedrag: Number((g as Gebeurtenis).bedrag ?? 0),
    maanden: (g as Gebeurtenis).maanden ?? [],
  }));
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
      nietThuis: 0,
      geenGeld: 0,
      korting: 0,
    };
    if (g.soort === "betaald") {
      r.opgehaald += g.bedrag;
      r.betaald += 1;
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
  }));
}

export interface KaartPost {
  soort: "beginstand" | "wassen" | "klus";
  datum: string;
  bedrag: number;
  aantal: number;
  omschrijving: string;
  gedekt: number;
  betaald_soort: "betaald" | "korting" | null;
  betaald_op: string | null;
  betaald_door: string | null;
}

export interface KaartAdres {
  id: string;
  posten: KaartPost[];
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
      })),
      gebeurtenissen: leesGebeurtenissen(a.gebeurtenissen),
    })),
  };
}

export interface GeldAdres {
  open: number;
  open_wassen: number;
  delen: GeldDeel[];
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
    })),
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
  }[s];
}
