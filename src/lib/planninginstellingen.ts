import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { STANDAARD_INSTELLINGEN, type PlanInstellingen } from "@/lib/dagplanning";

/**
 * De instellingen voor de planning: het uurtarief waarmee de duur uit de
 * prijs komt, de werktijd, de pauze, de rijtijd bij een wijkwissel, vanaf
 * wanneer een pand een eigen blok krijgt, en of de tijdlijn aanstaat.
 *
 * Ze staan als kolommen op `companies`, net als de werkdagen: iedereen van
 * het bedrijf leest ze, alleen de eigenaar wijzigt ze.
 */
const VELDEN =
  "plan_tarief_uur,plan_begin,plan_eind,plan_pauze_van,plan_pauze_min,plan_rijtijd_min,plan_groot_pand_min,plan_tijdlijn,plan_tijdvak_mailen";

/** "08:00:00" uit de database wordt "08:00" op het scherm. */
function kortTijd(waarde: string | null | undefined, terugval: string): string {
  if (!waarde) return terugval;
  return waarde.slice(0, 5);
}

async function fetchInstellingen(companyId: string): Promise<PlanInstellingen> {
  const { data, error } = await supabase
    .from("companies")
    .select(VELDEN)
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return STANDAARD_INSTELLINGEN;
  return {
    tariefUur: Number(data.plan_tarief_uur ?? STANDAARD_INSTELLINGEN.tariefUur),
    begin: kortTijd(data.plan_begin, STANDAARD_INSTELLINGEN.begin),
    eind: kortTijd(data.plan_eind, STANDAARD_INSTELLINGEN.eind),
    pauzeVan: kortTijd(data.plan_pauze_van, STANDAARD_INSTELLINGEN.pauzeVan),
    pauzeMin: data.plan_pauze_min ?? STANDAARD_INSTELLINGEN.pauzeMin,
    rijtijdMin: data.plan_rijtijd_min ?? STANDAARD_INSTELLINGEN.rijtijdMin,
    grootPandMin: data.plan_groot_pand_min ?? STANDAARD_INSTELLINGEN.grootPandMin,
    tijdlijn: data.plan_tijdlijn ?? STANDAARD_INSTELLINGEN.tijdlijn,
    tijdvakMailen: data.plan_tijdvak_mailen ?? STANDAARD_INSTELLINGEN.tijdvakMailen,
  };
}

/**
 * De planningsinstellingen van je bedrijf. Tot ze geladen zijn (of als het
 * ophalen mislukt) de standaard, zodat de planning altijd iets kan rekenen.
 */
export function usePlanningInstellingen(): PlanInstellingen {
  const { company } = useAuth();
  const { data } = useQuery({
    queryKey: ["planning-instellingen", company?.id],
    queryFn: () => fetchInstellingen(company!.id),
    enabled: !!company?.id,
  });
  return data ?? STANDAARD_INSTELLINGEN;
}

export async function bewaarPlanningInstellingen(companyId: string, i: PlanInstellingen) {
  const { data, error } = await supabase
    .from("companies")
    .update({
      plan_tarief_uur: i.tariefUur,
      plan_begin: i.begin,
      plan_eind: i.eind,
      plan_pauze_van: i.pauzeVan,
      plan_pauze_min: i.pauzeMin,
      plan_rijtijd_min: i.rijtijdMin,
      plan_groot_pand_min: i.grootPandMin,
      plan_tijdlijn: i.tijdlijn,
      plan_tijdvak_mailen: i.tijdvakMailen,
    })
    .eq("id", companyId)
    .select("id");
  if (error) throw error;
  // Een geweigerde wijziging geeft geen fout, maar raakt nul rijen.
  if ((data ?? []).length === 0) {
    throw new Error("Alleen de eigenaar kan de planningsinstellingen aanpassen.");
  }
}

/** Hoeveel adressen een automatische duur hebben, en hoeveel je zelf invulde. */
export async function telDuren(): Promise<{ automatisch: number; zelf: number }> {
  const auto = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .not("duur_min", "is", null)
    .eq("duur_zelf", false);
  if (auto.error) throw auto.error;
  const zelf = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("duur_zelf", true);
  if (zelf.error) throw zelf.error;
  return { automatisch: auto.count ?? 0, zelf: zelf.count ?? 0 };
}

export interface Herberekening {
  kenmerk: string;
  adressen: number;
  klussen: number;
}

/**
 * De duren opnieuw uit de prijs rekenen met een nieuw tarief. `ookZelf` neemt
 * ook mee wat met de hand is ingevuld. Geeft het kenmerk terug waarmee je het
 * meteen ongedaan kunt maken.
 */
export async function herberekenDuren(tarief: number, ookZelf: boolean): Promise<Herberekening> {
  const { data, error } = await supabase.rpc("duren_herberekenen", { tarief, ook_zelf: ookZelf });
  if (error) throw error;
  const uit = (data ?? {}) as { kenmerk?: string; adressen?: number; klussen?: number };
  return { kenmerk: uit.kenmerk ?? "", adressen: uit.adressen ?? 0, klussen: uit.klussen ?? 0 };
}

export async function draaiHerberekeningTerug(kenmerk: string): Promise<number> {
  const { data, error } = await supabase.rpc("duren_terugzetten", { kenmerk });
  if (error) throw error;
  return data ?? 0;
}
