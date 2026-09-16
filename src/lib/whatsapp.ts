/**
 * WhatsApp, de kant van de app.
 *
 * Lezen gaat rechtstreeks uit de database (RLS: wie berichten mag lezen).
 * Koppelen, ontkoppelen en als gelezen markeren lopen via de Edge Function
 * `whatsapp`: die praat met Meta en is de enige die het token ooit ziet.
 */
import { supabase } from "@/integrations/supabase/client";

export interface WhatsAppKoppeling {
  id: string;
  phone_number_id: string;
  waba_id: string;
  weergavenummer: string;
  soort: "test" | "app";
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
      "id,phone_number_id,waba_id,weergavenummer,soort,status,fout,laatste_bericht_op,created_at",
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
