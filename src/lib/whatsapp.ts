/**
 * WhatsApp, de kant van de app.
 *
 * Lezen gaat rechtstreeks uit de database (RLS: wie berichten mag lezen).
 * Koppelen, ontkoppelen en als gelezen markeren lopen via de Edge Function
 * `whatsapp`: die praat met Meta en is de enige die het token ooit ziet.
 */
import { supabase } from "@/integrations/supabase/client";
import { klantenMetAdressen, type KlantBijMail, type KlantGegevens } from "@/lib/berichten";

export interface WhatsAppKoppeling {
  id: string;
  phone_number_id: string;
  waba_id: string;
  weergavenummer: string;
  soort: "test" | "app";
  aanbieder: "meta" | "kapso";
  status: "actief" | "fout" | "uit";
  fout: string;
  laatste_bericht_op: string | null;
  created_at: string;
}

export interface WaGesprek {
  wa_telefoon: string;
  laatste_op: string;
  fragment: string;
  richting: "in" | "uit";
  wa_status: string;
  naam: string;
  klant_id: string | null;
  ongelezen: number;
}

export interface WaBericht {
  id: string;
  richting: "in" | "uit";
  bron: string;
  wa_type: string;
  wa_status: string;
  tekst: string;
  van_naam: string;
  ontvangen_op: string;
  media: { media_id: string; mime: string; naam: string; pad: string }[];
  klant_id: string | null;
  /** Wat Paaltje ervan maakte (alleen bij berichten van de klant). */
  paaltje_status: string;
  samenvatting: string;
  concept: string;
  zekerheid: number | null;
  voorstel: { overslaan?: { maanden?: string[]; doorgevoerd?: boolean } } | null;
  beantwoord_op: string | null;
  wa_antwoord_op: string | null;
  wa_antwoord_status: string;
  wa_antwoord_reden: string;
}

async function roep<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp", { body });
  if (error) {
    const res = (error as { context?: Response })?.context;
    let uitleg = "";
    if (res && typeof res.text === "function") {
      try {
        uitleg = (JSON.parse(await res.text()) as { fout?: string }).fout ?? "";
      } catch {
        // geen uitleg meegestuurd
      }
    }
    throw new Error(uitleg || error.message);
  }
  const uit = data as { fout?: string } & T;
  if (uit?.fout) throw new Error(uit.fout);
  return uit;
}

export async function fetchWhatsAppKoppeling(): Promise<WhatsAppKoppeling | null> {
  const { data, error } = await supabase
    .from("whatsapp_koppelingen")
    .select(
      "id,phone_number_id,waba_id,weergavenummer,soort,aanbieder,status,fout,laatste_bericht_op,created_at",
    )
    .maybeSingle();
  if (error) throw error;
  return (data as WhatsAppKoppeling | null) ?? null;
}

export function stelTestnummerIn(invoer: {
  phone_number_id: string;
  waba_id: string;
  token: string;
}): Promise<{ ok: true; weergavenummer: string; naam: string }> {
  return roep({ actie: "test_instellen", ...invoer });
}

/** Een koppellink van Kapso; daarna komt de eigenaar terug op Instellingen. */
export function maakKapsoLink(): Promise<{ ok: true; url: string }> {
  return roep({ actie: "kapso_link", terug_url: window.location.origin });
}

/** Na de koppellink: het nummer bij Kapso opzoeken en de koppeling opslaan. */
export function rondKapsoAf(phoneNumberId?: string): Promise<{
  ok: true;
  weergavenummer: string;
  naam: string;
  coexistence: boolean;
}> {
  return roep({ actie: "kapso_afronden", phone_number_id: phoneNumberId ?? "" });
}

export function ontkoppelWhatsApp(): Promise<{ ok: true }> {
  return roep({ actie: "ontkoppelen" });
}

export function markeerGesprekGelezen(telefoon: string): Promise<{ ok: true }> {
  return roep({ actie: "gelezen", telefoon });
}

export async function fetchGesprekken(): Promise<WaGesprek[]> {
  const { data, error } = await supabase.rpc("whatsapp_gesprekken", { aantal: 100 });
  if (error) throw error;
  return (data ?? []).map((g) => ({
    ...g,
    richting: g.richting === "uit" ? "uit" : "in",
    ongelezen: Number(g.ongelezen),
  }));
}

/** De laatste berichten van één gesprek, oudste bovenaan. */
export async function fetchWaBerichten(telefoon: string): Promise<WaBericht[]> {
  const { data, error } = await supabase
    .from("berichten")
    .select(
      "id,richting,bron,wa_type,wa_status,tekst,van_naam,ontvangen_op,media,klant_id,paaltje_status,samenvatting,concept,zekerheid,voorstel,beantwoord_op,wa_antwoord_op,wa_antwoord_status,wa_antwoord_reden",
    )
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", telefoon)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as WaBericht[]).reverse();
}

/** "31612345678" → "+31 6 12345678"; anders gewoon met een plus ervoor. */
export function toonNummer(nummer: string): string {
  const d = nummer.replace(/\D/g, "");
  if (/^316\d{8}$/.test(d)) return `+31 6 ${d.slice(3)}`;
  if (/^31\d{9}$/.test(d)) return `+31 ${d.slice(2, 4)} ${d.slice(4)}`;
  return d ? `+${d}` : "";
}

/** Fout bij versturen omdat het 24-uursvenster dicht is. */
export class VensterDichtFout extends Error {}

export async function verstuurWhatsApp(
  telefoon: string,
  tekst: string,
): Promise<{ ok: true; id: string | null; bewaard: boolean }> {
  const { data, error } = await supabase.functions.invoke("whatsapp", {
    body: { actie: "versturen", telefoon, tekst },
  });
  if (error) {
    const res = (error as { context?: Response })?.context;
    let uitleg: { fout?: string; venster_dicht?: boolean } = {};
    if (res && typeof res.text === "function") {
      try {
        uitleg = JSON.parse(await res.text()) as typeof uitleg;
      } catch {
        // geen uitleg meegestuurd
      }
    }
    if (uitleg.venster_dicht)
      throw new VensterDichtFout(uitleg.fout ?? "Het 24-uursvenster is dicht.");
    throw new Error(uitleg.fout || error.message);
  }
  return data as { ok: true; id: string | null; bewaard: boolean };
}

export function haalMediaAlsnogOp(berichtId: string): Promise<{ ok: true }> {
  return roep({ actie: "media_ophalen", bericht_id: berichtId });
}

/** Een tijdelijke link naar een bewaard bestand (een uur geldig). */
export async function mediaLink(pad: string): Promise<string> {
  const { data, error } = await supabase.storage.from("whatsapp-media").createSignedUrl(pad, 3600);
  if (error) throw error;
  return data.signedUrl;
}

/** Mag er nog vrije tekst naar dit nummer? Tot 24 uur na het laatste bericht van de klant. */
export function vensterOpen(berichten: WaBericht[]): boolean {
  const laatsteIn = [...berichten]
    .reverse()
    .find((b) => b.richting === "in" && b.bron !== "geschiedenis");
  return (
    !!laatsteIn && Date.now() - new Date(laatsteIn.ontvangen_op).getTime() < 24 * 60 * 60 * 1000
  );
}

/** "31612345678" → "0612345678", zoals klant_telefoons het bewaart (telefoon_sleutel() in de database). Leeg als het geen Nederlands nummer is. */
export function telefoonSleutel(nummer: string): string {
  let d = nummer.replace(/\D/g, "");
  if (d.startsWith("0031")) d = `0${d.slice(4)}`;
  else if (d.startsWith("31") && d.length === 11) d = `0${d.slice(2)}`;
  return d.length === 10 && d.startsWith("0") ? d : "";
}

/**
 * De klant(en) achter een WhatsApp-nummer, voor de tegel naast de chat: via
 * de telefoonnummers van klanten, plus de klant die Paaltje of jij al aan het
 * gesprek hing. Meer dan één kan (een stel met één nummer); dan tonen we ze
 * allemaal in plaats van er stil één te kiezen.
 */
export async function fetchKlantBijTelefoon(
  telefoon: string,
  klantId: string | null,
  vandaag: string,
): Promise<KlantBijMail[]> {
  const ids: string[] = klantId ? [klantId] : [];
  const sleutel = telefoonSleutel(telefoon);
  if (sleutel) {
    const { data, error } = await supabase
      .from("klant_telefoons")
      .select("klant_id")
      .eq("telefoon", sleutel)
      .limit(5);
    if (error) throw error;
    ids.push(...(data ?? []).map((k) => k.klant_id));
  }
  return await klantenMetAdressen([...new Set(ids)], vandaag);
}

/** Een appje waarin Wooshy iets met klantgegevens deed (of dat terugdraaide). */
export interface WaKlantgegevens {
  id: string;
  klant_id: string | null;
  klantgegevens: KlantGegevens;
}

/**
 * De appjes in dit gesprek waar Wooshy klantgegevens uit haalde, nieuwste
 * eerst: voor het gele vakje (met Klopt en Ongedaan maken) en "Anders in het
 * appje" in de klanttegel.
 */
export async function fetchWaKlantgegevens(telefoon: string): Promise<WaKlantgegevens[]> {
  const { data, error } = await supabase
    .from("berichten")
    .select("id,klant_id,klantgegevens")
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", telefoon)
    .eq("richting", "in")
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as unknown as WaKlantgegevens[])
    .map((r) => ({ ...r, klantgegevens: (r.klantgegevens ?? {}) as KlantGegevens }))
    .filter((r) => {
      const kg = r.klantgegevens;
      return !!(kg.herkend || kg.toegevoegd || kg.anders || kg.teruggedraaid);
    })
    // Wat nog terug te draaien is gaat voor: dat mag niet uit beeld raken
    // door nieuwere appjes met alleen "anders" of een oude terugdraaiing.
    .sort((a, b) => Number(!!(b.klantgegevens.herkend || b.klantgegevens.toegevoegd)) - Number(!!(a.klantgegevens.herkend || a.klantgegevens.toegevoegd)))
    .slice(0, 5);
}

/** "Klopt": dit appje (en dit nummer) hoort bij deze klant. */
export function bevestigWaKlant(berichtId: string, klantId: string): Promise<{ ok: true }> {
  return roep({ actie: "klant_bevestigen", bericht_id: berichtId, klant_id: klantId });
}

/** "Ongedaan maken": terugdraaien wat Wooshy uit dit appje bij de klant zette. */
export function draaiWaKlantgegevensTerug(berichtId: string): Promise<{ ok: true; bleven: string[] }> {
  return roep({ actie: "klantgegevens_terugdraaien", bericht_id: berichtId });
}

/** De nummers waarmee een klant appte, meest recente gesprek eerst. */
export async function fetchKlantNummers(klantId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("berichten")
    .select("wa_telefoon,ontvangen_op")
    .eq("kanaal", "whatsapp")
    .eq("klant_id", klantId)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(500);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.wa_telefoon))];
}

export interface AntwoordTijden {
  wachttijd: number;
  van: string;
  tot: string;
}

/** Hoe lang Paaltje wacht en tussen welke tijden hij zelf antwoordt. */
export async function fetchAntwoordTijden(companyId: string): Promise<AntwoordTijden> {
  const { data, error } = await supabase
    .from("companies")
    .select("wa_wachttijd_min,wa_antwoord_van,wa_antwoord_tot")
    .eq("id", companyId)
    .single();
  if (error) throw error;
  return {
    wachttijd: data.wa_wachttijd_min,
    van: String(data.wa_antwoord_van).slice(0, 5),
    tot: String(data.wa_antwoord_tot).slice(0, 5),
  };
}

export async function zetAntwoordTijden(companyId: string, t: AntwoordTijden): Promise<void> {
  const { error } = await supabase
    .from("companies")
    .update({ wa_wachttijd_min: t.wachttijd, wa_antwoord_van: t.van, wa_antwoord_tot: t.tot })
    .eq("id", companyId);
  if (error) throw error;
}

export function annuleerAntwoord(berichtId: string): Promise<{ ok: true }> {
  return roep({ actie: "antwoord_annuleren", bericht_id: berichtId });
}

export function verstuurAntwoordNu(berichtId: string): Promise<{ ok: true }> {
  return roep({ actie: "antwoord_nu", bericht_id: berichtId });
}

export interface BerichtWijziging {
  id: string;
  soort: string;
  maanden: string[];
  teruggedraaid_op: string | null;
}

/** Wat Paaltje na dit bericht in Wooshy veranderde (alleen de eigenaar ziet dit). */
export async function fetchWijzigingenVan(berichtId: string): Promise<BerichtWijziging[]> {
  const { data, error } = await supabase
    .from("mail_wijzigingen")
    .select("id,soort,maanden,teruggedraaid_op")
    .eq("bericht_id", berichtId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as BerichtWijziging[];
}

// ---------------------------------------------------------------------
// Sjablonen
// ---------------------------------------------------------------------

export type SjabloonStatus =
  "ingediend" | "goedgekeurd" | "afgewezen" | "gepauzeerd" | "uitgeschakeld";

export interface Sjabloon {
  id: string;
  titel: string;
  categorie: "utility" | "marketing";
  tekst: string;
  variabelen: string[];
  status: SjabloonStatus;
  afwijsreden: string;
  created_at: string;
}

export const SJABLOON_STATUS_TEKST: Record<SjabloonStatus, string> = {
  ingediend: "Wacht op Meta",
  goedgekeurd: "Goedgekeurd",
  afgewezen: "Afgewezen",
  gepauzeerd: "Gepauzeerd",
  uitgeschakeld: "Uitgeschakeld",
};

export async function fetchSjablonen(): Promise<Sjabloon[]> {
  const { data, error } = await supabase
    .from("wa_sjablonen")
    .select("id,titel,categorie,tekst,variabelen,status,afwijsreden,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Sjabloon[];
}

export function maakSjabloon(invoer: {
  titel: string;
  categorie: "utility" | "marketing";
  tekst: string;
}): Promise<{ ok: true; status: SjabloonStatus }> {
  return roep({ actie: "sjabloon_maken", ...invoer });
}

export function verversSjablonen(): Promise<{ ok: true; bijgewerkt: number }> {
  return roep({ actie: "sjablonen_verversen" });
}

export function gooiSjabloonWeg(id: string): Promise<{ ok: true }> {
  return roep({ actie: "sjabloon_weg", sjabloon_id: id });
}

export type SjabloonWaarden = { naam: string; datum: string; adres: string };

export function sjabloonVoorbeeld(
  telefoon: string,
  sjabloonId: string,
  waarden: Partial<SjabloonWaarden> = {},
): Promise<{ ok: true; tekst: string; waarden: SjabloonWaarden; leeg: string[] }> {
  return roep({ actie: "sjabloon_voorbeeld", telefoon, sjabloon_id: sjabloonId, waarden });
}

export function verstuurSjabloon(
  telefoon: string,
  sjabloonId: string,
  waarden: Partial<SjabloonWaarden>,
): Promise<{ ok: true; bewaard: boolean }> {
  return roep({ actie: "sjabloon_versturen", telefoon, sjabloon_id: sjabloonId, waarden });
}

// ---------------------------------------------------------------------
// Toestemming en voorkeur per klant
// ---------------------------------------------------------------------

export async function fetchToestemmingTelling(): Promise<{
  zonder: number;
  met: number;
  afgemeld: number;
}> {
  const { data, error } = await supabase.rpc("wa_toestemming_telling");
  if (error) throw error;
  const r = data?.[0];
  return {
    zonder: Number(r?.zonder ?? 0),
    met: Number(r?.met ?? 0),
    afgemeld: Number(r?.afgemeld ?? 0),
  };
}

export async function zetToestemmingBestaandeKlanten(): Promise<{ aantal: number; op: string }> {
  const { data, error } = await supabase.rpc("wa_toestemming_bestaande_klanten");
  if (error) throw error;
  const r = data?.[0];
  return { aantal: Number(r?.aantal ?? 0), op: String(r?.op ?? "") };
}

export async function draaiToestemmingTerug(op: string): Promise<number> {
  const { data, error } = await supabase.rpc("wa_toestemming_bestaande_klanten_terug", { op });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface KlantWhatsApp {
  kanaal_voorkeur: "mail" | "whatsapp" | "beide";
  wa_toestemming_op: string | null;
  wa_toestemming_bron: string;
  wa_marketing_op: string | null;
  wa_afgemeld_op: string | null;
}

export async function fetchKlantWhatsApp(klantId: string): Promise<KlantWhatsApp> {
  const { data, error } = await supabase
    .from("klanten")
    .select("kanaal_voorkeur,wa_toestemming_op,wa_toestemming_bron,wa_marketing_op,wa_afgemeld_op")
    .eq("id", klantId)
    .single();
  if (error) throw error;
  return data as KlantWhatsApp;
}

export async function zetKlantWhatsApp(
  klantId: string,
  patch: Partial<KlantWhatsApp>,
): Promise<void> {
  const { error } = await supabase.from("klanten").update(patch).eq("id", klantId);
  if (error) throw error;
}

/** "2026-09-22" → "dinsdag 22 september", zoals in het appje. */
export function datumVoluit(datum: string): string {
  const m = datum.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return datum;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
