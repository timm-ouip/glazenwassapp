/**
 * De aankondigingsmail, de kant van de app.
 *
 * Het versturen zelf gebeurt niet hier maar in de Edge Function
 * `mail-versturen`. Twee redenen: de Brevo-sleutel hoort op de server te
 * blijven, en de ontvangerslijst hoort daar gebouwd te worden — wie de lijst
 * meestuurt vanaf een scherm, bepaalt zelf naar wie er post gaat.
 *
 * Wat hier staat is dus vooral: vragen hoeveel mensen het worden, de opdracht
 * geven, en het postvak met antwoorden lezen.
 */
import { supabase } from "@/integrations/supabase/client";

/** Wat de telling teruggeeft, vóór er iets verstuurd is. */
export interface Telling {
  /** Hoeveel mensen er een mail zouden krijgen. */
  aantal: number;
  /** Hoeveel adressen van die dag we niet kunnen mailen. */
  zonderEmail: number;
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
  /** De adressen die Brevo wél kent — meestal zie je zo de typefout. */
  bekendeAfzenders?: string[];
  /** Leeg als antwoorden nog niet binnenkomen bij de app. */
  antwoordadres: string;
  melding: string;
}

/** Kijkt of alles klaarstaat. Verstuurt niets en verandert niets. */
export function controleerVerbinding(): Promise<Controle> {
  return roep<Controle>({ actie: "controle" });
}

/** Hoeveel mensen krijgen de mail van deze dag? Verstuurt niets. */
export function telOntvangers(datum: string): Promise<Telling> {
  return roep<Telling>({ actie: "tellen", datum });
}

/** Versturen. `test` stuurt één proefmail naar jezelf en verder niemand. */
export function verstuurAankondiging(opdracht: {
  datum: string;
  onderwerp: string;
  tekst: string;
  test: boolean;
}): Promise<Verzending> {
  return roep<Verzending>({ actie: "versturen", ...opdracht });
}

/** Eén antwoord terugsturen op een bericht uit het postvak. */
export function verstuurReactie(opdracht: {
  antwoord_id: string;
  onderwerp: string;
  tekst: string;
}): Promise<{ ok: true }> {
  return roep<{ ok: true }>({ actie: "reactie", ...opdracht });
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
// Wat er terugkwam
// ---------------------------------------------------------------------

/** Wat de assistent van een bericht maakte. Zie de migratie voor de uitleg. */
export type Categorie = "overslaan" | "afmelden" | "verzetten" | "vraag" | "akkoord" | "anders";

export type AntwoordStatus = "nieuw" | "klaar" | "genegeerd";

export interface MailAntwoord {
  id: string;
  ontvangen_op: string;
  van_naam: string;
  van_email: string;
  onderwerp: string;
  tekst: string;
  klant_id: string | null;
  categorie: Categorie;
  samenvatting: string;
  voorstel_maanden: string[];
  voorstel_adressen: string[];
  concept: string;
  zekerheid: number;
  ai_fout: string;
  status: AntwoordStatus;
  doorgevoerd_op: string | null;
  beantwoord_op: string | null;
}

/** Hoe een categorie op het scherm heet, en in welke kleur hij hoort. */
export const categorieNamen: Record<Categorie, string> = {
  overslaan: "Deze keer niet",
  afmelden: "Wil stoppen",
  verzetten: "Andere dag",
  vraag: "Vraag",
  akkoord: "Akkoord",
  anders: "Uitzoeken",
};

/** Dezelfde tinten als de rest van de app; rood is niet te kiezen, dus een
 *  afmelding krijgt oranje — dat is opletten, geen overgeslagen maand. */
export const categorieTint: Record<Categorie, string> = {
  overslaan: "bg-tint-blauw text-tint-blauw-ink",
  afmelden: "bg-tint-oranje text-tint-oranje-ink",
  verzetten: "bg-tint-paars text-tint-paars-ink",
  vraag: "bg-tint-amber text-tint-amber-ink",
  akkoord: "bg-tint-groen text-tint-groen-ink",
  anders: "bg-muted text-muted-foreground",
};

// Eén string en niet aan elkaar geplakt: de typen van Supabase worden uit de
// letterlijke tekst afgeleid, en een optelsom leest hij niet.
const ANTWOORD_VELDEN =
  "id,ontvangen_op,van_naam,van_email,onderwerp,tekst,klant_id,categorie,samenvatting,voorstel_maanden,voorstel_adressen,concept,zekerheid,ai_fout,status,doorgevoerd_op,beantwoord_op";

export async function fetchMailAntwoorden(): Promise<MailAntwoord[]> {
  const { data, error } = await supabase
    .from("mail_antwoorden")
    .select(ANTWOORD_VELDEN)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as MailAntwoord[];
}

export async function zetAntwoordStatus(id: string, status: AntwoordStatus) {
  const { error } = await supabase.from("mail_antwoorden").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Zet het stempel dat het voorstel is doorgevoerd. Het aanpassen van de
 *  adressen zelf loopt langs `slaSelectieOver`, net als overal elders. */
export async function stempelDoorgevoerd(id: string) {
  const { error } = await supabase
    .from("mail_antwoorden")
    .update({ doorgevoerd_op: new Date().toISOString(), status: "klaar" })
    .eq("id", id);
  if (error) throw error;
}

/** Het telletje in de zijbalk: hoeveel berichten wachten er op een mens. */
export async function aantalOpenMailAntwoorden(): Promise<number> {
  const { count, error } = await supabase
    .from("mail_antwoorden")
    .select("id", { count: "exact", head: true })
    .eq("status", "nieuw")
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
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
