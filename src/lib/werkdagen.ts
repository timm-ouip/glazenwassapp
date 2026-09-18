import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Op welke dagen van de week het bedrijf wast, zoals de database ze bewaart:
 * 1 = maandag … 7 = zondag. Opschuiven, het voorstel voor de volgende wijk en
 * "Inplannen voor…" slaan de andere dagen over.
 */
export const STANDAARD_WERKDAGEN: readonly number[] = [1, 2, 3, 4, 5];

export const WEEKDAGEN = [
  { nr: 1, kort: "ma", lang: "maandag" },
  { nr: 2, kort: "di", lang: "dinsdag" },
  { nr: 3, kort: "wo", lang: "woensdag" },
  { nr: 4, kort: "do", lang: "donderdag" },
  { nr: 5, kort: "vr", lang: "vrijdag" },
  { nr: 6, kort: "za", lang: "zaterdag" },
  { nr: 7, kort: "zo", lang: "zondag" },
] as const;

/** Is dit een werkdag? Zonder ingestelde dagen telt elke dag. */
export function isWerkdag(datum: string | Date, werkdagen: readonly number[]): boolean {
  if (werkdagen.length === 0) return true;
  const d = typeof datum === "string" ? new Date(`${datum}T12:00:00`) : datum;
  // getDay() begint op zondag = 0; de database op maandag = 1.
  return werkdagen.includes(d.getDay() === 0 ? 7 : d.getDay());
}

async function fetchWerkdagen(companyId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("werkdagen")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data?.werkdagen ?? [...STANDAARD_WERKDAGEN];
}

/** De werkdagen van je bedrijf; tot ze geladen zijn maandag t/m vrijdag. */
export function useWerkdagen(): readonly number[] {
  return useWerkdagenStatus().werkdagen;
}

/** Hetzelfde, met erbij of het al de echte instelling is en niet de
 *  standaard: wie er iets automatisch mee kiest, wacht daarop. */
export function useWerkdagenStatus(): { werkdagen: readonly number[]; geladen: boolean } {
  const { company } = useAuth();
  const { data, isError } = useQuery({
    queryKey: ["werkdagen", company?.id],
    queryFn: () => fetchWerkdagen(company!.id),
    enabled: !!company?.id,
  });
  // Lukt het ophalen niet, dan toch verder met de standaard: anders wordt er
  // nooit een dag gekozen.
  return { werkdagen: data ?? STANDAARD_WERKDAGEN, geladen: data !== undefined || isError };
}

export async function bewaarWerkdagen(companyId: string, werkdagen: number[]) {
  const { data, error } = await supabase
    .from("companies")
    .update({ werkdagen: [...werkdagen].sort((a, b) => a - b) })
    .eq("id", companyId)
    .select("id");
  if (error) throw error;
  // Een geweigerde wijziging geeft geen fout, maar raakt nul rijen.
  if ((data ?? []).length === 0) throw new Error("Alleen de eigenaar kan de werkdagen aanpassen.");
}
