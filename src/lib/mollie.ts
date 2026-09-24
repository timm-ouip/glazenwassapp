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

async function roep(body: Record<string, unknown>): Promise<MollieModus> {
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
  const uit = data as { modus?: MollieModus; fout?: string };
  if (uit?.fout) throw new Error(uit.fout);
  return uit?.modus ?? null;
}

export function fetchMollieModus(): Promise<MollieModus> {
  return roep({ actie: "nakijken" });
}

export function koppelMollie(sleutel: string): Promise<MollieModus> {
  return roep({ actie: "koppelen", sleutel });
}

export function ontkoppelMollie(): Promise<MollieModus> {
  return roep({ actie: "ontkoppelen" });
}
