import { supabase } from "@/integrations/supabase/client";

/**
 * Een wasdag is niets meer dan een selectie adressen bij een datum. Wat er
 * 's ochtends aanstaat is de planning, wat er 's avonds aanstaat is wat er
 * werkelijk gedaan is — dezelfde vinkjes, dus geen aparte administratie.
 *
 * Het bedrag staat op de regel zelf en niet op de klant: een prijsverhoging
 * van volgend jaar hoort een dag van vorige week niet duurder te maken.
 */
export interface WasdagRegel {
  /** Leeg als het adres later definitief uit de prullenbak gewist is. */
  customer_id: string | null;
  prijs: number;
}

/**
 * Vandaag als `jjjj-mm-dd` in lokale tijd. Bewust niet via `toISOString()`:
 * die rekent in UTC en zet een Nederlandse zomeravond na 22:00 al op morgen.
 */
export function vandaag(): string {
  const nu = new Date();
  const maand = String(nu.getMonth() + 1).padStart(2, "0");
  const dag = String(nu.getDate()).padStart(2, "0");
  return `${nu.getFullYear()}-${maand}-${dag}`;
}

/** Toont een datum als "31 augustus", of "vandaag" als dat vandaag is. */
export function toonDatum(datum: string): string {
  if (datum === vandaag()) return "vandaag";
  const d = new Date(`${datum}T12:00:00`);
  if (Number.isNaN(d.getTime())) return datum;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/** Alle regels van één dag, over alle wijken heen. */
export async function fetchWasdag(datum: string): Promise<WasdagRegel[]> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("customer_id,prijs")
    .eq("datum", datum);
  if (error) throw error;
  return (data ?? []) as WasdagRegel[];
}

/**
 * Zet adressen op de dag. Upsert op (company_id, datum, customer_id), zodat
 * een adres dat er al op staat geen tweede regel oplevert — je vinkt in de
 * praktijk zo een hele straat aan waar de helft al op stond.
 */
export async function voegToeAanWasdag(
  datum: string,
  regels: { customer_id: string; prijs: number }[],
) {
  if (regels.length === 0) return;
  const { error } = await supabase
    .from("wasdag_regels")
    .upsert(
      regels.map((r) => ({ datum, customer_id: r.customer_id, prijs: r.prijs })),
      { onConflict: "company_id,datum,customer_id" },
    );
  if (error) throw error;
}

/** Haalt adressen van de dag af. */
export async function haalUitWasdag(datum: string, customerIds: string[]) {
  if (customerIds.length === 0) return;
  const { error } = await supabase
    .from("wasdag_regels")
    .delete()
    .eq("datum", datum)
    .in("customer_id", customerIds);
  if (error) throw error;
}
