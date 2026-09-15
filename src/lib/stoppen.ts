/**
 * Een klant die stopt. Niet weggooien, maar inactief maken, met een reden:
 *
 *  - verhuisd: de klantgegevens gaan naar de prullenbak, het huis blijft
 *    bewaard (prijs, frequentie, notities) voor de volgende bewoner;
 *  - gestopt: alles blijft bewaard, voor als de klant terugkomt.
 *
 * Het echte werk doet de database in één stap (zet_adressen_inactief), zodat
 * er nooit een half gestopte klant achterblijft.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { vandaag } from "@/lib/wasdag";
import { eenVan } from "@/lib/embed";
import { haalAllePaginas } from "@/lib/pagineren";

export type StopReden = "verhuisd" | "gestopt";

export const STOP_REDENEN: { waarde: StopReden; label: string; uitleg: string }[] = [
  {
    waarde: "verhuisd",
    label: "Verhuisd",
    uitleg:
      "De klantgegevens gaan naar de prullenbak. Het huis blijft bewaard met prijs en notities, voor de volgende bewoner.",
  },
  {
    waarde: "gestopt",
    label: "Andere reden",
    uitleg: "Alles blijft bewaard, voor als de klant later terugkomt.",
  },
];

export function redenLabel(reden: string | null | undefined): string {
  return reden === "verhuisd" ? "Verhuisd" : reden === "gestopt" ? "Gestopt" : "Inactief";
}

/** Wat er gebeurde, zodat het terug te draaien is. */
export interface StopUitkomst {
  adressen: string[];
  /** Klanten die naar de prullenbak gingen (alleen bij een verhuizing). */
  klanten: string[];
  /** Planningsregels die van de planning zijn gehaald. */
  planning: { datum: string; customer_id: string; prijs: number; notitie: string | null }[];
  inactief_op: string;
}

/** De wasdagen vanaf morgen waarop deze adressen nog staan (vandaag blijft, zie de migratie). */
export async function geplandeDagen(ids: string[]): Promise<{ dagen: string[]; aantal: number }> {
  if (ids.length === 0) return { dagen: [], aantal: 0 };
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("datum")
    .in("customer_id", ids)
    .gt("datum", vandaag());
  if (error) throw error;
  const dagen = [...new Set((data ?? []).map((r) => r.datum))].sort();
  return { dagen, aantal: dagen.length };
}

export async function zetInactief(
  ids: string[],
  reden: StopReden,
  planningWeg: boolean,
): Promise<StopUitkomst> {
  const { data, error } = await supabase.rpc("zet_adressen_inactief", {
    adressen: ids,
    reden,
    planning_weg: planningWeg,
  });
  if (error) throw error;
  return data as unknown as StopUitkomst;
}

export async function zetActief(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc("zet_adressen_actief", { adressen: ids });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Ongedaan maken, met dezelfde voorzichtigheid als het Rapport: alleen wat nog
 * van déze stopzetting is, planning alleen vanaf vandaag, en een dag die
 * intussen opnieuw is ingepland blijft zoals hij is. Zie stoppen_terugdraaien.
 */
export async function draaiStoppenTerug(u: StopUitkomst): Promise<number> {
  const { data, error } = await supabase.rpc("stoppen_terugdraaien", {
    uitkomst: u as unknown as Json,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Een aanmelding op een bekend adres overnemen, in één stap. Geeft de klant. */
export async function bekendAdresOvernemen(aanmeldingId: string, metVorigeKlant: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("bekend_adres_overnemen", {
    aanmelding: aanmeldingId,
    met_vorige_klant: metVorigeKlant,
  });
  if (error) throw error;
  return String(data);
}

export interface InactiefAdres {
  id: string;
  street_id: string;
  house_number: number;
  addition: string;
  klant_id: string | null;
  note: string;
  price: number;
  interval_maanden: number;
  ritme: number;
  inactief_op: string;
  inactief_reden: StopReden;
}

/** Alle inactieve adressen van het bedrijf, nieuwste eerst. */
export async function fetchInactieveAdressen(): Promise<InactiefAdres[]> {
  // In stukken van 1000, zoals alle lijsten die kunnen groeien.
  const data = await haalAllePaginas((van, tot) =>
    supabase
      .from("customers")
      .select("id,street_id,house_number,addition,klant_id,note,interval_maanden,ritme,inactief_op,inactief_reden,adres_prijzen(prijs)")
      .is("deleted_at", null)
      .not("inactief_op", "is", null)
      .order("inactief_op", { ascending: false })
      .order("id", { ascending: true })
      .range(van, tot),
  );
  return data.map((c) => ({
    ...c,
    addition: c.addition ?? "",
    note: c.note ?? "",
    // Uit adres_prijzen; zonder het recht "prijzen zien" is dat 0.
    price: Number(eenVan(c.adres_prijzen)?.prijs ?? 0),
    interval_maanden: c.interval_maanden ?? 1,
    ritme: c.ritme ?? 1,
  })) as InactiefAdres[];
}
