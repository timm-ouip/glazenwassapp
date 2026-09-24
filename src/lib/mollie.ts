/**
 * Mollie: de betaallink onder de factuur.
 *
 * De sleutel zelf komt hier nooit langs nadat hij één keer verstuurd is. Hij
 * gaat versleuteld de database in, in een tabel waar alleen de server bij kan,
 * en wat de app terugkrijgt is niet meer dan: gekoppeld ja of nee, en met de
 * test- of de echte sleutel.
 */
import { supabase } from "@/integrations/supabase/client";

export type MollieModus = "test" | "live" | null;

async function roep<T = { modus?: MollieModus }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mollie", { body });
  if (error) {
    // supabase-js maakt van elke foutcode "Edge Function returned a non-2xx
    // status code" en gooit de uitleg weg. Die zit in het antwoord zelf, en
    // juist die wil je lezen: "deze sleutel herkent Mollie niet".
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

async function modusVan(body: Record<string, unknown>): Promise<MollieModus> {
  const uit = await roep<{ modus?: MollieModus }>(body);
  return uit?.modus ?? null;
}

export function fetchMollieModus(): Promise<MollieModus> {
  return modusVan({ actie: "nakijken" });
}

export function koppelMollie(sleutel: string): Promise<MollieModus> {
  return modusVan({ actie: "koppelen", sleutel });
}

export function ontkoppelMollie(): Promise<MollieModus> {
  return modusVan({ actie: "ontkoppelen" });
}

/**
 * Een echte betaallink van één cent, zonder factuur eraan.
 *
 * De enige andere manier om te zien dat Mollie werkt, is een echte factuur
 * versturen -- en daar hangt een factuurnummer aan dat je nooit meer weg
 * krijgt. Hiermee loop je de hele weg naar Mollie een keer zonder dat er iets
 * vast komt te liggen. Er wordt niets bewaard.
 */
export async function proefBetaallink(): Promise<string> {
  const uit = await roep<{ url?: string }>({ actie: "proef" });
  if (!uit?.url) throw new Error("Mollie gaf geen link terug.");
  return uit.url;
}
