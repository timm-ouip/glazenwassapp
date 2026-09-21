/**
 * "Dag klaar": aan het eind van de dag meldt elk team zijn werk af. Wat
 * aangevinkt blijft is gedaan en staat daarna open bij de klant (zie
 * lib/betalingen); wat niet gedaan is gaat terug naar de planning of slaat
 * de maand over.
 */
import { supabase } from "@/integrations/supabase/client";

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

/** "Afgemeld door Kees om 17:32" */
export function afgemeldTekst(a: NonNullable<Afmeldstatus["afmelding"]>): string {
  const tijd = new Date(a.op).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `Afgemeld${a.door_naam ? ` door ${a.door_naam}` : ""} om ${tijd}`;
}
