/**
 * De mailbox van het bedrijf, de kant van de app.
 *
 * Lezen gaat rechtstreeks uit de database (alleen de eigenaar mag dat, dat
 * regelt RLS). Koppelen, ophalen en ontkoppelen lopen via de Edge Function
 * `mailbox`: die praat met de mailserver en is de enige die het wachtwoord
 * ooit ziet.
 */
import { supabase } from "@/integrations/supabase/client";

export type MailboxStatus = "actief" | "fout" | "uit";
export type MapRol = "postvak" | "verzonden" | "concepten" | "prullenbak" | "spam" | "overig";

export interface Mailbox {
  id: string;
  adres: string;
  status: MailboxStatus;
  fout: string;
  laatste_sync: string | null;
  import_vanaf: string;
  created_at: string;
}

export interface MailMap {
  id: string;
  pad: string;
  rol: MapRol;
  aantal: number;
  ongelezen: number;
}

/** Namen op het scherm, in de volgorde van een mailprogramma. */
export const MAP_NAMEN: Record<MapRol, string> = {
  postvak: "Postvak IN",
  concepten: "Concepten",
  verzonden: "Verzonden",
  spam: "Spam",
  prullenbak: "Prullenbak",
  overig: "Overig",
};

export const MAP_VOLGORDE: MapRol[] = [
  "postvak",
  "concepten",
  "verzonden",
  "overig",
  "spam",
  "prullenbak",
];

export function mapNaam(map: Pick<MailMap, "rol" | "pad">): string {
  return map.rol === "overig" ? map.pad.split("/").pop() || map.pad : MAP_NAMEN[map.rol];
}

async function roep<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mailbox", { body });
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

const db = supabase;

export async function fetchMailbox(): Promise<Mailbox | null> {
  const { data, error } = await db
    .from("mailboxen")
    .select("id,adres,status,fout,laatste_sync,import_vanaf,created_at")
    .maybeSingle();
  if (error) throw error;
  return (data as Mailbox | null) ?? null;
}

export async function fetchMappen(): Promise<MailMap[]> {
  const { data, error } = await db.from("mail_mappen").select("id,pad,rol,aantal,ongelezen");
  if (error) throw error;
  const mappen = (data ?? []) as MailMap[];
  return mappen.sort(
    (a, b) =>
      MAP_VOLGORDE.indexOf(a.rol) - MAP_VOLGORDE.indexOf(b.rol) || a.pad.localeCompare(b.pad),
  );
}

/** Hoeveel mails er al in Paaltje Systems staan, per map-id. Eén vraag voor alle mappen. */
export async function telOpgehaald(): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("mail_tellingen");
  if (error) throw error;
  const uit: Record<string, number> = {};
  for (const r of data ?? []) uit[r.map_id] = Number(r.aantal);
  return uit;
}

export interface KoppelUitkomst {
  ok: true;
  mappen: number;
  /** Leeg als versturen ook werkt; anders de reden. */
  smtpFout: string;
}

export function koppelMailbox(adres: string, wachtwoord: string): Promise<KoppelUitkomst> {
  return roep<KoppelUitkomst>({ actie: "koppelen", adres, wachtwoord });
}

export function nuOphalen(): Promise<{ ok: true; nieuw: number; klaar: boolean }> {
  return roep({ actie: "ophalen" });
}

export function ontkoppelMailbox(): Promise<{ ok: true }> {
  return roep({ actie: "ontkoppelen" });
}
