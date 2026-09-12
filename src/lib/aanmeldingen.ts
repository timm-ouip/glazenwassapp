/**
 * Het postvak: wat er via de aanmeldpagina binnenkomt.
 *
 * Dit is de kant van de ingelogde glazenwasser. Het invullen zelf loopt langs
 * `aanmelden.functions.ts`, want een bezoeker van die pagina is niet ingelogd;
 * hier is dat wel zo, dus hier kan de gewone client met RLS erop.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * Wat de server van een inzending maakte:
 *  - `gekoppeld`: het adres stond in de lijst en was nog leeg, de gegevens
 *    staan er nu bij. Klaar, alleen nog ter kennisgeving.
 *  - `wijziging`: het adres stond in de lijst, maar er stonden al gegevens.
 *    Er is niets aangeraakt; de glazenwasser kiest wat blijft.
 *  - `onbekend`: geen of meerdere passende adressen. Er is niets aangemaakt,
 *    want bij een nieuw adres horen een wijk en een prijs.
 */
export type AanmeldSoort = "gekoppeld" | "wijziging" | "onbekend";

export type AanmeldStatus = "open" | "klaar" | "geweigerd";

export interface Aanmelding {
  id: string;
  created_at: string;
  soort: AanmeldSoort;
  status: AanmeldStatus;
  naam: string;
  email: string;
  telefoon: string;
  postcode: string;
  straat: string;
  huisnummer: string;
  toevoeging: string;
  plaats: string;
  customer_id: string | null;
  klant_id: string | null;
}

const VELDEN =
  "id,created_at,soort,status,naam,email,telefoon,postcode,straat,huisnummer,toevoeging,plaats,customer_id,klant_id";

export async function fetchAanmeldingen(): Promise<Aanmelding[]> {
  const { data, error } = await supabase
    .from("aanmeldingen")
    .select(VELDEN)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Aanmelding[];
}

/** Het huisnummer zoals het op papier staat: "12" of "12a". */
export function aanmeldNummer(a: Aanmelding): string {
  return `${a.huisnummer}${a.toevoeging}`;
}

/** Het hele adres op één regel, voor de kop van een kaart in het postvak. */
export function aanmeldAdres(a: Aanmelding): string {
  const adres = `${a.straat} ${aanmeldNummer(a)}`.trim();
  const rest = [a.postcode, a.plaats].filter(Boolean).join(" ");
  return rest ? `${adres} · ${rest}` : adres;
}

export async function zetStatus(ids: string[], status: AanmeldStatus) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("aanmeldingen").update({ status }).in("id", ids);
  if (error) throw error;
}

/** Onthoudt bij welk adres en welke klant een inzending terechtkwam, zodat de
 *  kaart in het postvak later laat zien waar het naartoe ging. */
export async function zetVerwerkt(id: string, customerId: string, klantId: string | null) {
  const { error } = await supabase
    .from("aanmeldingen")
    .update({ status: "klaar", customer_id: customerId, klant_id: klantId })
    .eq("id", id);
  if (error) throw error;
}

/**
 * De aanmeldlink van dit bedrijf. Alleen in de browser te maken: de pagina
 * moet op hetzelfde adres staan als de app, en dat weet alleen de browser.
 */
export function aanmeldLink(token: string): string {
  if (typeof window === "undefined" || !token) return "";
  return `${window.location.origin}/aanmelden?c=${token}`;
}

/** Hoeveel inzendingen er nog op een mens wachten — het telletje in de
 *  zijbalk. Alleen tellen, niet ophalen: dit draait op elke pagina. */
export async function aantalOpenAanmeldingen(): Promise<number> {
  const { count, error } = await supabase
    .from("aanmeldingen")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
