import { supabase } from "@/integrations/supabase/client";
import { vandaag } from "@/lib/wasdag";
import { eenVan } from "@/lib/embed";

/**
 * Een extra opdracht: werk bij een adres dat niet aan een maand vastzit. Een
 * dakrand, een serre die één keer meemoet, een keer de goot. Je maakt er een
 * prijs voor en hij blijft openstaan tot je hem afvinkt.
 *
 * Dit is iets anders dan `maandwerk` op een adres: dat komt elk jaar in
 * dezelfde kalendermaanden terug. Een klus gebeurt één keer, op een moment
 * dat het uitkomt.
 */
export interface Klus {
  id: string;
  customer_id: string;
  omschrijving: string;
  prijs: number;
  /** De dag waarop hij meerijdt; leeg is: nog niet ingedeeld. */
  gepland_op: string | null;
  /** De dag waarop je hem afvinkte; leeg is: nog te doen. */
  gedaan_op: string | null;
}

/**
 * Op welke dag deze klus meetelt in de omzet — of nergens.
 *
 * Dit is de enige plek waar die vraag beantwoord wordt, en dat is met opzet:
 * de kalender, het dagpaneel en de dagpagina rekenen er alle drie mee, en als
 * ze het los van elkaar zouden uitrekenen staan er getallen op één scherm die
 * niet bij elkaar optellen.
 *
 * - Afgevinkt: op de dag dat je hem deed.
 * - Nog niet afgevinkt, staat op vandaag of later: op die dag. Dat is de
 *   vooruitblik — je ziet wat een dag gaat opleveren.
 * - Nog niet afgevinkt, stond op een dag die geweest is: **nergens**. Je hebt
 *   hem niet gedaan, dus het is geen omzet, en de dag van gisteren hoort niet
 *   duurder te lijken dan hij was. Hij staat dan weer bovenaan de strook.
 */
export function telDagVan(k: Klus, nu = vandaag()): string | null {
  if (k.gedaan_op) return k.gedaan_op;
  if (!k.gepland_op) return null;
  return k.gepland_op >= nu ? k.gepland_op : null;
}

/** Staat deze klus nog open? Afvinken is het enige wat hem sluit. */
export function staatOpen(k: Klus): boolean {
  return !k.gedaan_op;
}

/**
 * Stond hij op een dag die geweest is zonder dat je hem afvinkte? Dan is hij
 * van die dag af, en laat de strook zien wanneer dat was.
 */
export function blijvenLiggen(k: Klus, nu = vandaag()): boolean {
  return !k.gedaan_op && !!k.gepland_op && k.gepland_op < nu;
}

const VELDEN = "id,customer_id,omschrijving,gepland_op,gedaan_op,klus_prijzen(prijs)";

/**
 * Alles wat openstaat, plus wat er al afgevinkt is binnen een periode — dat
 * laatste voor de bedragen van een maand die je terugkijkt. Zonder periode
 * komt alleen het openstaande werk mee.
 */
export async function fetchKlussen(vanaf?: string, tot?: string): Promise<Klus[]> {
  const open = supabase.from("klussen").select(VELDEN).is("deleted_at", null).is("gedaan_op", null);
  const vragen = [open];
  if (vanaf && tot) {
    vragen.push(
      supabase
        .from("klussen")
        .select(VELDEN)
        .is("deleted_at", null)
        .not("gedaan_op", "is", null)
        .gte("gedaan_op", vanaf)
        .lte("gedaan_op", tot),
    );
  }
  const uitkomsten = await Promise.all(vragen);
  const uit: Klus[] = [];
  for (const { data, error } of uitkomsten) {
    if (error) throw error;
    for (const rij of (data ?? []) as unknown as (Omit<Klus, "prijs"> & { klus_prijzen: { prijs: number } | { prijs: number }[] | null })[]) {
      // Het bedrag staat in klus_prijzen; zonder het recht "prijzen zien" is dat 0.
      const { klus_prijzen, ...rest } = rij;
      uit.push({ ...rest, prijs: Number(eenVan(klus_prijzen)?.prijs ?? 0) });
    }
  }
  return uit;
}

export async function nieuweKlus(
  customerId: string,
  omschrijving: string,
  prijs: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("klussen")
    .insert({ customer_id: customerId, omschrijving: omschrijving.trim() })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  // De database zette de prijs op 0; wie prijzen mag zien, zet hier het bedrag.
  const { error: prijsFout } = await supabase.from("klus_prijzen").upsert({ klus_id: id, prijs }, { onConflict: "klus_id" });
  if (prijsFout && prijsFout.code !== "42501") throw prijsFout;
  return id;
}

export async function patchKlus(
  id: string,
  patch: Partial<Pick<Klus, "omschrijving" | "prijs" | "gepland_op" | "gedaan_op">>,
) {
  const { prijs, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    const { error } = await supabase.from("klussen").update(rest).eq("id", id);
    if (error) throw error;
  }
  if (prijs !== undefined) {
    const { error } = await supabase.from("klus_prijzen").upsert({ klus_id: id, prijs }, { onConflict: "klus_id" });
    if (error) throw error;
  }
}

/** Op een dag zetten, of er met `null` weer af halen. */
export async function zetKlusOpDag(id: string, datum: string | null) {
  await patchKlus(id, { gepland_op: datum });
}

/**
 * Afvinken. Het bedrag telt op de dag dat je hem echt deed: vandaag. Stond
 * hij op een latere dag, dan deed je hem eerder; was hij blijven liggen, dan
 * deed je hem nu (en niet op die dag in augustus).
 *
 * `bekekenDag`: vink je af op de dagpagina van een dag die geweest is, dan
 * ben je díe dag aan het bijwerken, en telt hij daar.
 */
export async function vinkKlusAf(k: Klus, aan: boolean, bekekenDag?: string) {
  const nu = vandaag();
  const dag = bekekenDag && bekekenDag <= nu ? bekekenDag : nu;
  await patchKlus(k.id, { gedaan_op: aan ? dag : null });
}

/** Terugdraaien: precies de afvinkdag van daarvoor, niet opnieuw uitrekenen. */
export async function zetAfvinkTerug(k: Klus) {
  await patchKlus(k.id, { gedaan_op: k.gedaan_op });
}

/** Wegleggen, zoals overal in deze app: de rij blijft staan met een stempel. */
export async function verwijderKlus(id: string) {
  const { error } = await supabase
    .from("klussen")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function haalKlusTerug(id: string) {
  const { error } = await supabase.from("klussen").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}
