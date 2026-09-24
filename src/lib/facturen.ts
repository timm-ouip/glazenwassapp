/**
 * Facturen: voor de klanten die overmaken.
 *
 * De volgorde waarin een factuur ontstaat, want die verklaart de rest:
 *
 *   1. Een dag wordt helemaal afgemeld → de database maakt *te factureren
 *      regels*. Geen nummer, niets naar buiten.
 *   2. Die regels worden een concept (per beurt, of verzameld per maand).
 *   3. Bij het versturen trekt de factuur zijn nummer en bevriest hij de
 *      klantgegevens. Vanaf dat moment is er niets meer aan te veranderen:
 *      de klant heeft dat papier al. Rechtzetten gaat met een creditfactuur.
 *
 * Het rekenwerk zit in de database (zie de migraties facturen_fundament en
 * facturen_maken); hier staat alleen hoe de app het opvraagt.
 */
import { supabase } from "@/integrations/supabase/client";

export type FactuurStatus = "concept" | "verstuurd" | "betaald" | "gecrediteerd";
export type FactuurSoort = "factuur" | "credit";
export type Klanttype = "particulier" | "bedrijf" | "vve";

export const KLANTTYPEN: { waarde: Klanttype; label: string; uitleg: string }[] = [
  { waarde: "particulier", label: "Particulier", uitleg: "Bedragen inclusief btw" },
  { waarde: "bedrijf", label: "Bedrijf", uitleg: "Bedragen exclusief btw, met btw eronder" },
  { waarde: "vve", label: "VvE", uitleg: "Bedragen exclusief btw, meestal één factuur per maand" },
];

export function klanttypeLabel(t: Klanttype | null | undefined): string {
  return KLANTTYPEN.find((k) => k.waarde === t)?.label ?? "Particulier";
}

/** Staat de prijs van deze klant inclusief btw? Leeg = volgt het klanttype. */
export function btwInclusief(
  klanttype: Klanttype | null | undefined,
  eigen: boolean | null | undefined,
): boolean {
  return eigen ?? (klanttype ?? "particulier") === "particulier";
}

export interface FactuurTotalen {
  regels: number;
  excl: number;
  btw: number;
  incl: number;
}

export interface Factuur {
  id: string;
  /** Leeg zolang het een concept is. */
  nummer: string | null;
  soort: FactuurSoort;
  status: FactuurStatus;
  klant_id: string;
  /** De bedrijfsnaam als die er is, anders de naam van de klant. */
  klant: string;
  klanttype: Klanttype;
  /** Waar hij heen gaat: het aparte factuuradres, anders het gewone. */
  mail: string;
  factuurdatum: string | null;
  vervaldatum: string | null;
  te_laat: boolean;
  met_rust_tot: string | null;
  herinnering_trap: number;
  betaald_bedrag: number;
  verstuurd_op: string | null;
  verstuurd_via: "mail" | "whatsapp" | "print" | null;
  mollie_link: string | null;
  totalen: FactuurTotalen;
}

/**
 * Staan de bedragen van deze factuur exclusief btw vooraan? Een particulier
 * ziet het bedrag dat hij overmaakt; een bedrijf of VvE rekent in bedragen
 * zonder btw, met de btw eronder. Dezelfde regel als op de PDF, zodat het
 * scherm en het papier hetzelfde getal groot maken.
 */
export function exclusiefVoorop(f: Pick<Factuur, "klanttype">): boolean {
  return !btwInclusief(f.klanttype, null);
}

/** Wat er nog open staat op deze factuur. Nooit onder nul. */
export function openBedrag(f: Factuur): number {
  return Math.max(0, Math.round((f.totalen.incl - f.betaald_bedrag) * 100) / 100);
}

/**
 * Hoe de factuur ervoor staat, in één woord voor op het scherm. Let op het
 * verschil tussen "Concept" en "Klaargezet": zodra er een nummer op staat is
 * hij vastgezet en kan er niets meer aan veranderen, ook al is de mail nog
 * niet de deur uit.
 */
export function factuurStand(f: Factuur): string {
  if (f.soort === "credit") return "Creditfactuur";
  if (f.status === "gecrediteerd") return "Gecrediteerd";
  if (f.status === "betaald") return "Betaald";
  if (f.status === "concept") return f.nummer ? "Klaargezet" : "Concept";
  if (f.betaald_bedrag > 0) return "Deels betaald";
  if (f.te_laat) return "Te laat";
  return "Verstuurd";
}

function leesFactuur(x: Factuur): Factuur {
  const t = x.totalen ?? { regels: 0, excl: 0, btw: 0, incl: 0 };
  return {
    ...x,
    betaald_bedrag: Number(x.betaald_bedrag ?? 0),
    totalen: {
      regels: Number(t.regels ?? 0),
      excl: Number(t.excl ?? 0),
      btw: Number(t.btw ?? 0),
      incl: Number(t.incl ?? 0),
    },
  };
}

export async function fetchFacturen(vanaf?: string, tot?: string): Promise<Factuur[]> {
  const { data, error } = await supabase.rpc("facturen_lijst", {
    vanaf: vanaf ?? null,
    tot: tot ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as Factuur[]).map(leesFactuur);
}

/** Eén regel op een factuur, zoals hij bij de klant op papier komt. */
export interface Factuurregel {
  id: string;
  soort: "wasbeurt" | "klus";
  datum: string;
  omschrijving: string;
  notitie: string;
  /** De prijs zoals ingevoerd: bij een particulier inclusief btw, bij een
   *  bedrijf exclusief. Wat je aanpast als er maar een deel gedaan is. */
  bedrag: number;
  bedrag_excl: number;
  btw_bedrag: number;
  bedrag_incl: number;
  btw_procent: number;
  factuur_id: string | null;
}

export async function fetchFactuurregels(factuurId: string): Promise<Factuurregel[]> {
  const { data, error } = await supabase
    .from("factuurregels")
    .select(
      "id,soort,datum,omschrijving,notitie,bedrag,bedrag_excl,btw_bedrag,bedrag_incl,btw_procent,factuur_id",
    )
    .eq("factuur_id", factuurId)
    .is("deleted_at", null)
    .order("datum");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    soort: r.soort as "wasbeurt" | "klus",
    bedrag: Number(r.bedrag ?? 0),
    bedrag_excl: Number(r.bedrag_excl ?? 0),
    btw_bedrag: Number(r.btw_bedrag ?? 0),
    bedrag_incl: Number(r.bedrag_incl ?? 0),
    btw_procent: Number(r.btw_procent ?? 0),
  }));
}

/** Hoeveel regels er nog op geen enkele factuur staan. Voor het gele vakje. */
export async function fetchLosseRegels(): Promise<number> {
  const { count, error } = await supabase
    .from("factuurregels")
    .select("id", { count: "exact", head: true })
    .is("factuur_id", null)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Losse regels bundelen tot concepten. `nuOok` pakt ook de lopende maand mee. */
export async function facturenKlaarzetten(nuOok = false): Promise<number> {
  const { data, error } = await supabase.rpc("facturen_klaarzetten", { nu_ook: nuOok });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * De facturen echt de deur uit doen. Het zware werk gebeurt op de server:
 * daar wordt per factuur het nummer getrokken, de PDF gebouwd en de mail
 * verstuurd. De browser krijgt alleen terug hoeveel er gelukt zijn.
 */
export async function facturenVersturen(ids: string[]): Promise<{
  gelukt: number;
  mislukt: { id: string; reden: string }[];
}> {
  const { data, error } = await supabase.functions.invoke("facturen", {
    body: { actie: "versturen", ids },
  });
  if (error) throw error;
  return data as { gelukt: number; mislukt: { id: string; reden: string }[] };
}

export async function factuurWeggooien(id: string) {
  // De regels blijven bestaan en komen los te staan: ze wachten gewoon op
  // een volgende factuur. Alleen een concept kan weg; de database houdt een
  // factuur met een nummer zelf tegen.
  const { error } = await supabase.from("facturen").delete().eq("id", id);
  if (error) throw error;
}

export async function factuurBetaald(id: string, bedrag: number, op?: string) {
  const { data, error } = await supabase.rpc("factuur_betaald", {
    factuur: id,
    bedrag,
    op: op ?? null,
  });
  if (error) throw error;
  return data as unknown as { betaald: number; totaal: number; open: number };
}

export async function factuurCrediteren(id: string, reden = ""): Promise<string> {
  const { data, error } = await supabase.rpc("factuur_crediteren", { factuur: id, reden });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * Van een gecrediteerde factuur het aangevinkte werk opnieuw aanmelden, zodat
 * het op een aangepaste factuur komt. Geeft terug hoeveel regels erbij kwamen;
 * werk dat al opnieuw is aangemeld wordt overgeslagen.
 */
export async function factuurOpnieuw(
  id: string,
  keuzes: { id: string; bedrag: number }[],
): Promise<number> {
  const { data, error } = await supabase.rpc("factuur_opnieuw", { factuur: id, keuzes });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Deze factuur even met rust laten: geen herinnering tot die datum. Gaat via
 * een eigen functie, want een verstuurde factuur staat verder op slot en dit
 * ene veld is de uitzondering.
 */
export async function factuurMetRust(id: string, tot: string | null) {
  const { error } = await supabase.rpc("factuur_met_rust", { factuur: id, tot });
  if (error) throw error;
}
