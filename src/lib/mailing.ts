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
  /** Leeg als antwoorden nog niet binnenkomen bij de app. */
  antwoordadres: string;
  melding: string;
  /** Hoe het postvak ervoor staat, per stap. */
  inbox: {
    /** Het subdomein waar antwoorden op binnenkomen; leeg is niet ingesteld. */
    domein: string;
    /** Staat het subdomein bij Brevo als domein? */
    brevoKentDomein: boolean;
    /** En heeft Brevo het goedgekeurd? Zonder dat neemt Brevo geen post aan. */
    brevoKeurtGoed: boolean;
    /** De regels die er bij de domeinbeheerder nog bij moeten. */
    dnsNodig: { naam: string; type: string; waarde: string; goed: boolean }[];
    /** Wijzen de MX-records van dat domein naar Brevo? */
    dnsGoed: boolean;
    /** Waar ze nu naartoe wijzen, om te zien wat er anders moet. */
    dnsGevonden: string[];
    /** Kent Brevo de koppeling naar onze inbox? */
    gekoppeld: boolean;
    /** Staat de sleutel van de assistent op de server? */
    assistent: boolean;
    /** Krijgen aankondigingen het antwoordadres al mee? */
    actief: boolean;
  };
}

/** Kijkt of alles klaarstaat. Verstuurt niets en verandert niets. */
export function controleerVerbinding(): Promise<Controle> {
  return roep<Controle>({ actie: "controle" });
}

/**
 * Zet het postvak open. Weigert zolang de DNS nog niet goed staat, en maakt
 * daarna bij Brevo de koppeling aan — twee keer klikken geeft geen tweede.
 */
export function koppelPostvak(): Promise<{ ok: true; adres: string }> {
  return roep<{ ok: true; adres: string }>({ actie: "inbox-koppelen" });
}

/**
 * Een voorstel van de assistent doorvoeren. Langs de server en niet in de
 * browser: dan komt het in hetzelfde rapport als automatisch doorvoeren, en
 * draai je het op dezelfde manier terug.
 */
export function voerVoorstelDoor(antwoord_id: string): Promise<{ ok: true; aangepast: number }> {
  return roep<{ ok: true; aangepast: number }>({ actie: "doorvoeren", antwoord_id });
}

/** Haalt één aanpassing uit het rapport weer weg. */
export function draaiWijzigingTerug(wijziging_id: string): Promise<{ ok: true }> {
  return roep<{ ok: true }>({ actie: "terugdraaien", wijziging_id });
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

/**
 * Laat de assistent een binnengekomen bericht nog een keer lezen — als het de
 * eerste keer misging door een storing of een leeg tegoed. Wat de klant schreef
 * en of het al is afgehandeld blijft staan.
 */
export function leesOpnieuw(antwoord_id: string): Promise<{ ok: boolean; ai_fout: string }> {
  return roep<{ ok: boolean; ai_fout: string }>({ actie: "opnieuw-lezen", antwoord_id });
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
  /** Deed de assistent het doorvoeren zelf? */
  doorgevoerd_automatisch: boolean;
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
  "id,ontvangen_op,van_naam,van_email,onderwerp,tekst,klant_id,categorie,samenvatting,voorstel_maanden,voorstel_adressen,concept,zekerheid,ai_fout,status,doorgevoerd_op,doorgevoerd_automatisch,beantwoord_op";

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

// ---------------------------------------------------------------------
// Het rapport: alles wat de assistent (of iemand) heeft aangepast
// ---------------------------------------------------------------------

export interface Wijziging {
  id: string;
  created_at: string;
  antwoord_id: string | null;
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
    .select("id,created_at,antwoord_id,soort,adres,klant,maanden,automatisch,zekerheid,teruggedraaid_op")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Wijziging[];
}

// ---------------------------------------------------------------------
// Instellingen van de assistent
// ---------------------------------------------------------------------

export interface AssistentInstellingen {
  /** Mag hij bij zekerheid zelf doorvoeren? */
  automatisch: boolean;
  /** Hoe antwoorden moeten klinken, in je eigen woorden. */
  schrijfstijl: string;
}

export async function fetchAssistentInstellingen(): Promise<AssistentInstellingen> {
  const { data, error } = await supabase
    .from("companies")
    .select("mail_auto_doorvoeren,mail_schrijfstijl")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    automatisch: data?.["mail_auto_doorvoeren"] === true,
    schrijfstijl: data?.["mail_schrijfstijl"] ?? "",
  };
}

/**
 * De schakelaar en de schrijfstijl slaan elk alleen hun eigen veld op. Ze
 * staan op verschillende pagina's; zou de een ook het veld van de ander
 * meesturen, dan zet een pagina die nog de oude waarde kent die terug.
 */
export async function zetZelfDoorvoeren(companyId: string, aan: boolean) {
  const { error } = await supabase
    .from("companies")
    .update({ mail_auto_doorvoeren: aan })
    .eq("id", companyId);
  if (error) throw error;
}

export async function bewaarSchrijfstijl(companyId: string, schrijfstijl: string) {
  const { error } = await supabase
    .from("companies")
    .update({ mail_schrijfstijl: schrijfstijl.trim() })
    .eq("id", companyId);
  if (error) throw error;
}

/**
 * Hoeveel antwoorden er al met de hand zijn verstuurd — daar leert de
 * assistent de stijl van. Alleen tellen, niet ophalen.
 */
export async function aantalVerstuurdeAntwoorden(): Promise<number> {
  const { count, error } = await supabase
    .from("mail_antwoorden")
    .select("id", { count: "exact", head: true })
    .not("beantwoord_op", "is", null)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
