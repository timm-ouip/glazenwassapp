/**
 * "Dag klaar": aan het eind van de dag meldt elk team zijn werk af. Wat
 * aangevinkt blijft is gedaan en staat daarna open bij de klant (zie
 * lib/betalingen); wat niet gedaan is gaat terug naar de planning of slaat
 * de maand over.
 */
import { supabase } from "@/integrations/supabase/client";
import { datumSleutel, toonDatum } from "@/lib/wasdag";

export interface Afmeldstatus {
  datum: string;
  /** Het team; leeg = werk zonder team (of een dag zonder teams). */
  ploeg_nr: number | null;
  regels: number;
  gedaan: number;
  afmelding: {
    id: string;
    door_naam: string;
    op: string;
    /** Mag jij hem weer openzetten (de eigenaar, of jijzelf op dezelfde dag)? */
    mag_open: boolean;
  } | null;
}

export async function fetchAfmeldstatus(vanaf: string, tot: string): Promise<Afmeldstatus[]> {
  const { data, error } = await supabase.rpc("dag_afmeldstatus", { vanaf, tot });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as Afmeldstatus[];
}

/** Is dit team (of deze dag) helemaal afgemeld? */
export function isAfgemeld(s: Pick<Afmeldstatus, "regels" | "gedaan">): boolean {
  return s.regels > 0 && s.gedaan >= s.regels;
}

export async function dagAfmelden(
  datum: string,
  ploeg: number | null,
  weg: string[],
): Promise<{ id: string; gedaan: number; weg: number }> {
  const { data, error } = await supabase.rpc("dag_afmelden", { dag: datum, ploeg, weg });
  if (error) throw error;
  return data as unknown as { id: string; gedaan: number; weg: number };
}

export async function dagHeropenen(datum: string, ploeg: number | null) {
  const { error } = await supabase.rpc("dag_heropenen", { dag: datum, ploeg });
  if (error) throw error;
}

export async function dagAfmeldenTerugdraaien(afmelding: string) {
  const { error } = await supabase.rpc("dag_afmelden_terugdraaien", { afmelding });
  if (error) throw error;
}

/**
 * "Afgemeld door Kees om 17:32". Geef je de dag mee en gebeurde het op een
 * andere dag (een dag later nog afgemeld), dan staat die datum erbij:
 * "Afgemeld door Kees op 3 oktober om 09:10".
 */
export function afgemeldTekst(a: NonNullable<Afmeldstatus["afmelding"]>, dag?: string): string {
  const op = new Date(a.op);
  const tijd = op.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  const opDag = datumSleutel(op);
  const welkeDag = toonDatum(opDag);
  const wanneer =
    !dag || opDag === dag
      ? `om ${tijd}`
      : welkeDag === "vandaag"
        ? `vandaag om ${tijd}`
        : `op ${welkeDag} om ${tijd}`;
  return `Afgemeld${a.door_naam ? ` door ${a.door_naam}` : ""} ${wanneer}`;
}

/** Hoe ver een dag is met afmelden, voor het vinkje in de kalender en op de dag. */
export interface DagAfmeldstand {
  /** Hoeveel teams er die dag werk hadden (werk zonder team telt als één). */
  teams: number;
  /** Hoeveel daarvan al Dag klaar deden. */
  klaar: number;
  /** Wie wanneer afmeldde, op volgorde van tijd. */
  afmeldingen: NonNullable<Afmeldstatus["afmelding"]>[];
}

/** De afmeldstatus per team samengenomen tot één stand per dag. */
export function afmeldstandPerDag(rijen: Afmeldstatus[]): Map<string, DagAfmeldstand> {
  const perDag = new Map<string, DagAfmeldstand>();
  for (const s of rijen) {
    if (s.regels === 0) continue;
    const dag = perDag.get(s.datum) ?? { teams: 0, klaar: 0, afmeldingen: [] };
    dag.teams += 1;
    if (isAfgemeld(s)) {
      dag.klaar += 1;
      if (s.afmelding) dag.afmeldingen.push(s.afmelding);
    }
    perDag.set(s.datum, dag);
  }
  for (const dag of perDag.values()) dag.afmeldingen.sort((a, b) => a.op.localeCompare(b.op));
  return perDag;
}

/** "Afgemeld met Dag klaar", of "1 van 2 teams afgemeld met Dag klaar". */
export function afmeldstandTekst(stand: DagAfmeldstand): string {
  return stand.klaar >= stand.teams
    ? "Afgemeld met Dag klaar"
    : `${stand.klaar} van ${stand.teams} teams afgemeld met Dag klaar`;
}
