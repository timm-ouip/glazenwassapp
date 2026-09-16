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
    .select("id,richting,bron,wa_type,wa_status,tekst,van_naam,ontvangen_op,media,klant_id")
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
