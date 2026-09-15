/**
 * De aankondigingsmail, de kant van de app.
 *
 * Het versturen zelf gebeurt niet hier maar in de Edge Function
 * `mail-versturen`. Twee redenen: de Brevo-sleutel hoort op de server te
 * blijven, en de ontvangerslijst hoort daar gebouwd te worden — wie de lijst
 * meestuurt vanaf een scherm, bepaalt zelf naar wie er post gaat.
 *
 * Wat hier staat is dus vooral: vragen hoeveel mensen het worden, de opdracht
 * geven, en terugkijken wat er verstuurd en aangepast is. Antwoorden van
 * klanten komen in de eigen mailbox binnen (zie berichten.ts).
 */
import { supabase } from "@/integrations/supabase/client";

/** Wat de telling teruggeeft, vóór er iets verstuurd is. */
export interface Telling {
  /** Hoeveel mensen er een mail zouden krijgen. */
  aantal: number;
  /** Hoeveel adressen van die dag we niet kunnen mailen. */
  zonderEmail: number;
  /** Hoeveel adressen deze maand overslaan — die krijgen ook geen mail. */
  overgeslagen: number;
  /** De eerste paar, om te zien dat het de goede mensen zijn. */
  voorbeeld: { naam: string; email: string; adressen: string[] }[];
}

export interface Verzending {
  verstuurd: number;
  mislukt: number;
  eersteFout: string;
}

async function roep<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mail-versturen", { body });
  if (error) {
    // Een Edge Function die een 4xx teruggeeft komt hier binnen als fout; de
    // uitleg zit in het antwoord zelf, niet in de melding van de bibliotheek.
    const uitleg = await leesFout(error);
    throw new Error(uitleg || error.message);
  }
  const uit = data as { fout?: string } & T;
  if (uit?.fout) throw new Error(uit.fout);
  return uit;
}

/** De tekst die de functie meestuurde bij een foutcode. */
async function leesFout(error: unknown): Promise<string> {
  const res = (error as { context?: Response })?.context;
  if (!res || typeof res.text !== "function") return "";
  try {
    const body = JSON.parse(await res.text()) as { fout?: string };
    return body.fout ?? "";
  } catch {
    return "";
  }
}

/**
 * Wat de controle teruggeeft. Alles wat er mis kan zijn voordat er ook maar
 * één mail weggaat, op één plek — zodat je het merkt vóór de eerste honderd
 * geweigerd worden en niet erna.
 */
export interface Controle {
  /** Werkt de sleutel die op de server staat? */
  sleutel: boolean;
  /** De naam van het Brevo-account, als de sleutel werkt. */
  account: string;
  afzenderIngevuld: string;
  /** Staat dat adres bij Brevo als afzender bekend? */
  afzenderBekend: boolean;
  /** En is het daar ook goedgekeurd? */
  afzenderActief: boolean;
  /** Staat de afzender op het domein van de gekoppelde mailbox? Anders mag versturen niet. */
  afzenderPastBijMailbox: boolean;
  /** Domein van de gekoppelde mailbox; leeg zonder mailbox. */
  mailboxDomein: string;
  /** De adressen die Brevo wél kent — meestal zie je zo de typefout. */
  bekendeAfzenders?: string[];
  melding: string;
}

/** Kijkt of alles klaarstaat. Verstuurt niets en verandert niets. */
export function controleerVerbinding(): Promise<Controle> {
  return roep<Controle>({ actie: "controle" });
}

/** Haalt één aanpassing uit het rapport weer weg. */
export function draaiWijzigingTerug(wijziging_id: string): Promise<{ ok: true }> {
  return roep<{ ok: true }>({ actie: "terugdraaien", wijziging_id });
}

/** Hoeveel mensen krijgen de mail van deze dag? Verstuurt niets. */
export function telOntvangers(datum: string): Promise<Telling> {
  return roep<Telling>({ actie: "tellen", datum });
}

/**
 * Versturen. `test` stuurt één proefmail en verder niemand: naar `proefNaar`
 * als dat is ingevuld, anders naar jezelf.
 */
export function verstuurAankondiging(opdracht: {
  datum: string;
  onderwerp: string;
  tekst: string;
  test: boolean;
  proefNaar?: string;
}): Promise<Verzending> {
  const { proefNaar, ...rest } = opdracht;
  return roep<Verzending>({ actie: "versturen", ...rest, ...(proefNaar ? { proef_naar: proefNaar } : {}) });
}

// ---------------------------------------------------------------------
// Wat er verstuurd is
// ---------------------------------------------------------------------

export interface Mailing {
  id: string;
  created_at: string;
  datum: string | null;
  onderwerp: string;
  tekst: string;
  test: boolean;
  aantal: number;
  mislukt: number;
}

export async function fetchMailingen(): Promise<Mailing[]> {
  const { data, error } = await supabase
    .from("mailingen")
    .select("id,created_at,datum,onderwerp,tekst,test,aantal,mislukt")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Mailing[];
}

// ---------------------------------------------------------------------
// De afzender
// ---------------------------------------------------------------------

export interface Afzender {
  naam: string;
  email: string;
}

export async function fetchAfzender(): Promise<Afzender> {
  const { data, error } = await supabase
    .from("companies")
    .select("mail_afzender_naam,mail_afzender_email")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    naam: data?.["mail_afzender_naam"] ?? "",
    email: data?.["mail_afzender_email"] ?? "",
  };
}

export async function bewaarAfzender(companyId: string, afzender: Afzender) {
  const { error } = await supabase
    .from("companies")
    .update({
      mail_afzender_naam: afzender.naam.trim(),
      mail_afzender_email: afzender.email.trim(),
    })
    .eq("id", companyId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Het rapport: alles wat de assistent (of iemand) heeft aangepast
// ---------------------------------------------------------------------

export interface Wijziging {
  id: string;
  created_at: string;
  /** overslaan, stoppen, aanmelding of klant_email. */
  soort: string;
  /** Adres en klant zoals ze heetten op het moment van aanpassen. */
  adres: string;
  klant: string;
  maanden: string[];
  automatisch: boolean;
  zekerheid: number | null;
  teruggedraaid_op: string | null;
}

export async function fetchWijzigingen(): Promise<Wijziging[]> {
  const { data, error } = await supabase
    .from("mail_wijzigingen")
    .select("id,created_at,soort,adres,klant,maanden,automatisch,zekerheid,teruggedraaid_op")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Wijziging[];
}

// ---------------------------------------------------------------------
// De schrijfstijl van Paaltje
// ---------------------------------------------------------------------

/** Hoe antwoorden moeten klinken, in je eigen woorden. */
export async function fetchSchrijfstijl(): Promise<string> {
  const { data, error } = await supabase
    .from("companies")
    .select("mail_schrijfstijl")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.["mail_schrijfstijl"] ?? "";
}

/** Slaat alleen de schrijfstijl op, zodat andere velden van het bedrijf niet
 *  teruggezet worden door een pagina die nog een oude waarde kent. */
export async function bewaarSchrijfstijl(companyId: string, schrijfstijl: string) {
  const { error } = await supabase
    .from("companies")
    .update({ mail_schrijfstijl: schrijfstijl.trim() })
    .eq("id", companyId);
  if (error) throw error;
}

/**
 * Hoeveel antwoorden er al vanuit het postvak zijn verstuurd — daar leert
 * Paaltje de stijl van. Dezelfde keuze als `voorbeelden` in
 * supabase/functions/_gedeeld/paaltje.ts. Alleen tellen, niet ophalen.
 */
export async function aantalVerstuurdeAntwoorden(): Promise<number> {
  const { count, error } = await supabase
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .not("beantwoord_op", "is", null)
    .neq("concept", "");
  if (error) throw error;
  return count ?? 0;
}
