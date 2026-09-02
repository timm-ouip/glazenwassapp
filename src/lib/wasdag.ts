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

/** Eén regel met de dag erbij, voor het maandoverzicht. */
export interface WasdagDagRegel extends WasdagRegel {
  datum: string;
}

/** Alle regels tussen twee datums (beide meegerekend), voor de kalender. */
export async function fetchWasdagen(vanaf: string, tot: string): Promise<WasdagDagRegel[]> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("datum,customer_id,prijs")
    .gte("datum", vanaf)
    .lte("datum", tot);
  if (error) throw error;
  return (data ?? []) as WasdagDagRegel[];
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
  const { error } = await supabase.from("wasdag_regels").upsert(
    regels.map((r) => ({ datum, customer_id: r.customer_id, prijs: r.prijs })),
    { onConflict: "company_id,datum,customer_id" },
  );
  if (error) throw error;
}

/**
 * Haalt adressen van de dag af. In stukjes, want de id's gaan als filter mee
 * in de URL: een hele wijk in één keer (honderden adressen) maakt die te lang.
 */
export async function haalUitWasdag(datum: string, customerIds: string[]) {
  const PER_KEER = 80;
  for (let i = 0; i < customerIds.length; i += PER_KEER) {
    const { error } = await supabase
      .from("wasdag_regels")
      .delete()
      .eq("datum", datum)
      .in("customer_id", customerIds.slice(i, i + PER_KEER));
    if (error) throw error;
  }
}

/** Veegt een hele dag leeg — op datum, dus zonder lijst met id's. */
export async function maakWasdagLeeg(datum: string) {
  const { error } = await supabase.from("wasdag_regels").delete().eq("datum", datum);
  if (error) throw error;
}

/**
 * `n` werkdagen verder. Zaterdag en zondag tellen niet mee, dus vrijdag plus
 * één is maandag — schuif je een dag op omdat het regent, dan hoort dat werk
 * niet in het weekend te belanden.
 */
export function werkdagenVerder(datum: string, n: number): string {
  const d = new Date(`${datum}T12:00:00`);
  let over = n;
  while (over > 0) {
    d.setDate(d.getDate() + 1);
    const dag = d.getDay();
    if (dag !== 0 && dag !== 6) over -= 1;
  }
  const maand = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${maand}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * De eerste en laatste dag van de maand waarin `datum` valt. Gebruikt om te
 * zien wat er die maand al gewassen is: bij een nieuwe maand begint die
 * telling vanzelf weer op nul.
 */
export function maandGrenzen(datum: string): { vanaf: string; tot: string } {
  const d = new Date(`${datum}T12:00:00`);
  const laatste = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const maand = String(d.getMonth() + 1).padStart(2, "0");
  return {
    vanaf: `${d.getFullYear()}-${maand}-01`,
    tot: `${laatste.getFullYear()}-${maand}-${String(laatste.getDate()).padStart(2, "0")}`,
  };
}
