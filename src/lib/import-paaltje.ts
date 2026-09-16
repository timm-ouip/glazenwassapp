import { supabase } from "@/integrations/supabase/client";
import { zoekStraatPostcodes, zoekStraten } from "@/lib/postcode";

/**
 * Paaltje laten meekijken bij het importeren. De app vraagt eerst bij het
 * adressenregister welke straten er in de plaats bestaan, en legt dat samen
 * met de teksten uit het blad aan Paaltje voor. Wat terugkomt zijn alleen
 * voorstellen: het importscherm beslist wat er geel toegepast wordt.
 */

const PAUZE_MS = 350;
const HERSTEL_MS = 1500;
const MAX_MISLUKT = 3;

/** Een tekst uit het blad zoals Paaltje hem te zien krijgt. */
export interface ImportCel {
  id: string;
  tabblad: string;
  cel: string;
  tekst: string;
  grijs: boolean;
  vulkleur: string;
  vet: boolean;
  nummers_eronder: number;
  nu: "straat" | "notitie";
  straat_erboven: string;
}

export interface ImportStraat {
  naam: string;
  adressen: number;
  huisnummers: string;
  register: string[];
}

export interface PaaltjeUitkomst {
  cellen: { id: string; wordt: "straat" | "notitie"; zeker: boolean; reden: string }[];
  zelfde_straat: { namen: string[]; naam: string; zeker: boolean; reden: string }[];
  officieel: { straat: string; naam: string; zeker: boolean; reden: string }[];
}

export async function vraagPaaltje(body: {
  plaats: string;
  cellen: ImportCel[];
  straten: ImportStraat[];
}): Promise<PaaltjeUitkomst> {
  const { data, error } = await supabase.functions.invoke("paaltje-import", { body });
  if (error) {
    const res = (error as { context?: Response })?.context;
    let fout = "";
    if (res && typeof res.text === "function") {
      try {
        fout = (JSON.parse(await res.text()) as { fout?: string }).fout ?? "";
      } catch {
        // geen uitleg meegestuurd
      }
    }
    throw new Error(fout || "Paaltje is even niet bereikbaar.");
  }
  return data as PaaltjeUitkomst;
}

/**
 * De officiële namen die bij elke naam passen, binnen de plaats. `null` bij
 * een naam betekent: de dienst deed het niet — iets anders dan "niets gevonden".
 */
export async function zoekRegisternamen(
  namen: string[],
  plaats: string,
  onVoortgang?: (gedaan: number, totaal: number) => void,
): Promise<{ opties: Map<string, string[]>; afgebroken: boolean }> {
  const opties = new Map<string, string[]>();
  let mislukt = 0;
  for (const [i, naam] of namen.entries()) {
    const gevonden = await zoekStraten(naam, plaats);
    if (gevonden === null) {
      if (++mislukt >= MAX_MISLUKT) return { opties, afgebroken: true };
      await wacht(HERSTEL_MS);
      continue;
    }
    mislukt = 0;
    opties.set(naam, [...new Set(gevonden)]);
    onVoortgang?.(i + 1, namen.length);
    await wacht(PAUZE_MS);
  }
  return { opties, afgebroken: false };
}

/** Alle huisnummers met postcode per officiële straatnaam. */
export async function zoekHuisnummers(
  namen: string[],
  plaats: string,
  onVoortgang?: (gedaan: number, totaal: number) => void,
): Promise<{ kaarten: Map<string, Map<string, string>>; afgebroken: boolean }> {
  const kaarten = new Map<string, Map<string, string>>();
  let mislukt = 0;
  for (const [i, naam] of namen.entries()) {
    const kaart = await zoekStraatPostcodes(naam, plaats);
    if (kaart === null) {
      if (++mislukt >= MAX_MISLUKT) return { kaarten, afgebroken: true };
      await wacht(HERSTEL_MS);
      continue;
    }
    mislukt = 0;
    kaarten.set(naam, kaart);
    onVoortgang?.(i + 1, namen.length);
    await wacht(PAUZE_MS);
  }
  return { kaarten, afgebroken: false };
}

function wacht(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
