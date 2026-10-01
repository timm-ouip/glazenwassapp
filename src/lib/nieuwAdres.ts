import { supabase } from "@/integrations/supabase/client";
import {
  alsRij,
  bewaarKlant,
  eersteBeurtVanaf,
  koppelKlant,
  LEEG_KLANT,
  maakStraat,
  maandSleutel,
  patchCustomer,
  schuifStartOp,
  splitsHuisnummer,
  type Customer,
  type KlantVelden,
} from "@/lib/klanten";

/**
 * Een nieuw adres aanmaken, met zo nodig een nieuwe straat en een klant
 * erbij. Los van het scherm, zodat elk formulier (het dossier in de
 * nieuw-stand, en wat er later nog komt) dezelfde regels volgt.
 */

/** Een nieuw adres begint in de eerste maand van zijn frequentie: maak je in
 *  september een adres voor de even maanden, dan is hij pas in oktober nieuw.
 *  Leeg als deze maand al in de frequentie valt. */
export function startMaandVoorNieuw(ritme: { interval_maanden: number; ritme: number }): string {
  const dezeMaand = maandSleutel(new Date());
  const start = eersteBeurtVanaf(dezeMaand, ritme);
  return start === dezeMaand ? "" : start;
}

/** Achteraan in de straat, zoals bij "+ adres" in de wijken. */
export function plekAchteraan(
  customers: Pick<Customer, "street_id" | "sort_order">[],
  streetId: string,
) {
  return (
    Math.max(0, ...customers.filter((c) => c.street_id === streetId).map((c) => c.sort_order)) + 1
  );
}

/** Velden die het formulier zelf uit het adres vult; die maken nog geen klant. */
const ADRES_VELDEN = new Set<string>(["straat", "huisnummer", "postcode", "plaats"]);

/** Is er iets van een klant ingevuld? Dan hoort er een klant bij het adres.
 *  Een keuze die nog op zijn begin staat (particulier, per beurt) telt niet. */
export function heeftKlantGegevens(velden: KlantVelden): boolean {
  const leeg = LEEG_KLANT as Record<string, unknown>;
  return Object.entries(velden).some(([veld, waarde]) => {
    if (ADRES_VELDEN.has(veld)) return false;
    if (veld === "klanttype" || veld === "factuur_per") return waarde !== leeg[veld];
    return typeof waarde === "string" ? waarde.trim() !== "" : waarde != null;
  });
}

export interface NieuwAdresInvoer {
  /** Een bestaande straat, of een nieuwe met naam in een wijk. */
  straat: { id: string } | { wijkId: string; naam: string };
  /** "12a": het nummer met de toevoeging. */
  huisnummer: string;
  /** Wat er bij het pand hoort (zoals in het dossier onder "Het adres"). */
  pand: Pick<
    Customer,
    | "note"
    | "interval_maanden"
    | "ritme"
    | "overslaan"
    | "start_maand"
    | "markering"
    | "eigen_blok"
    | "postcode"
    | "betaalmethode"
    | "maandwerk"
  > &
    Partial<Pick<Customer, "duur_min" | "duur_zelf">>;
  /** De prijs; null als je geen prijzen mag zien (dan sturen we hem niet mee). */
  prijs: number | null;
  /** De klantgegevens; een klant komt er alleen bij als er iets is ingevuld. */
  klant: KlantVelden | null;
  /** De plek in de straat, zodra bekend is welke straat het wordt. */
  plek: (streetId: string) => number;
  /** Zodra een nieuwe straat er staat: gaat daarna iets mis, dan kies je die
   *  straat bij een volgende poging, in plaats van hem dubbel te maken. */
  opStraat?: (streetId: string) => void;
}

export interface NieuwAdresUitkomst {
  adresId: string;
  streetId: string;
  klantId: string | null;
  /** Wat ná het adres niet lukte (de prijs, de klant). Het adres staat er wel. */
  mislukt: string[];
}

/** Het adres staat al (actief) op de wijklijst; koppel dan aan dat adres. */
export class AdresBestaatAl extends Error {
  adresId: string;
  constructor(adresId: string) {
    super("Dit adres staat al in de lijst.");
    this.adresId = adresId;
    this.name = "AdresBestaatAl";
  }
}

const reden = (e: unknown) =>
  e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);

/**
 * Maakt het adres aan. Gooit een fout zolang het adres er nog niet staat
 * (dan kun je het gewoon opnieuw proberen); wat daarna misgaat staat in
 * `mislukt`, want nog eens opslaan zou het adres dubbel maken.
 */
export async function maakNieuwAdres(invoer: NieuwAdresInvoer): Promise<NieuwAdresUitkomst> {
  const nr = splitsHuisnummer(invoer.huisnummer);
  if (!nr) throw new Error("Vul een huisnummer in.");

  let streetId: string;
  if ("id" in invoer.straat) {
    streetId = invoer.straat.id;
    // Staat dit nummer al in de straat, ook als inactief adres? Dan geen
    // tweede regel voor hetzelfde huis: dezelfde regel als zorgVoorAdres.
    const { data: zelfde, error: zoekFout } = await supabase
      .from("customers")
      .select("id,addition,inactief_op")
      .eq("street_id", streetId)
      .eq("house_number", nr.house_number)
      .is("deleted_at", null);
    if (zoekFout) throw zoekFout;
    const dubbel = (zelfde ?? []).filter(
      (c) => (c.addition ?? "").trim().toLowerCase() === nr.addition.toLowerCase(),
    );
    const actief = dubbel.find((c) => !c.inactief_op);
    if (actief) throw new AdresBestaatAl(actief.id);
    if (dubbel.length > 0) {
      throw new Error(
        "Dit adres staat bij Inactief (gestopt of verhuisd). Zet het eerst weer actief via Klanten → Inactief; dan blijven prijs en notities bewaard.",
      );
    }
  } else {
    // De naam die je typt (vaak uit de voorstellen van het adressenregister)
    // is ook de officiële naam, net als bij zorgVoorAdres.
    streetId = await maakStraat(invoer.straat.wijkId, invoer.straat.naam, invoer.straat.naam);
    invoer.opStraat?.(streetId);
  }

  const { maandwerk, ...pand } = invoer.pand;
  // Een startmaand die je overslaat schuift door naar de volgende maand,
  // zoals in het dossier.
  const rij = alsRij(
    schuifStartOp(
      {
        start_maand: "",
        created_at: new Date().toISOString(),
        overslaan: [],
        geimporteerd: false,
      },
      {
        ...pand,
        note: pand.note.trim(),
        overslaan: [...pand.overslaan].sort(),
        start_maand: pand.start_maand || startMaandVoorNieuw(pand),
        postcode: pand.postcode.trim(),
      },
    ),
  );
  const { data, error } = await supabase
    .from("customers")
    .insert({
      ...rij,
      street_id: streetId,
      house_number: nr.house_number,
      addition: nr.addition,
      sort_order: invoer.plek(streetId),
    })
    .select("id")
    .single();
  if (error) throw error;
  const adresId = data.id;

  const mislukt: string[] = [];
  // De prijs en de meerprijzen staan in hun eigen tabel.
  try {
    if (invoer.prijs !== null || maandwerk.length > 0) {
      await patchCustomer(adresId, {
        ...(invoer.prijs !== null ? { price: invoer.prijs } : {}),
        ...(maandwerk.length > 0 ? { maandwerk } : {}),
      });
    }
  } catch (e) {
    mislukt.push(`de prijs (${reden(e)})`);
  }

  let klantId: string | null = null;
  if (invoer.klant && heeftKlantGegevens(invoer.klant)) {
    try {
      klantId = (await bewaarKlant(null, invoer.klant)).id;
      await koppelKlant([adresId], klantId);
    } catch (e) {
      mislukt.push(`de klantgegevens (${reden(e)})`);
    }
  }

  return { adresId, streetId, klantId, mislukt };
}
