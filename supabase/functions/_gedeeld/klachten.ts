/**
 * Klachten uit mail. Deelt Paaltje een mail van een bekende klant in als
 * klacht, dan komt er een klacht in het dossier van die klant — rood, met
 * "door Paaltje" en Ongedaan maken.
 *
 * - Heeft de klant al een open klacht, dan komt de mail daarbij: een klant die
 *   nog eens mailt over dezelfde strepen maakt geen tweede klacht.
 * - Hing deze mail al aan een klacht (ook een die teruggedraaid is), dan doet
 *   opnieuw lezen niets: Ongedaan maken blijft ongedaan.
 * - Het adres vult Paaltje alleen in als het duidelijk is: de klant heeft er
 *   één, of het adres uit de mail hoort bij de klant. Anders blijft het leeg.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

interface AdresUitMail {
  straat: string;
  huisnummer: string;
}

export async function klachtUitMail(
  db: Db,
  mail: { id: string; company_id: string; onderwerp: string; ontvangen_op: string },
  klantId: string,
  /** Kort wat er niet goed was, zoals Paaltje het las. */
  watNietGoed: string,
  adres: AdresUitMail | null,
  /** Waar de klacht binnenkwam: mail, of een appje. */
  bron: "mail" | "app" = "mail",
): Promise<void> {
  const { data: al, error: alFout } = await db
    .from("klacht_berichten")
    .select("klacht_id")
    .eq("bericht_id", mail.id)
    .limit(1);
  if (alFout) throw new Error(`Klacht zoeken: ${alFout.message}`);
  if ((al ?? []).length > 0) return;

  const { data: open, error: openFout } = await db
    .from("klachten")
    .select("id")
    .eq("company_id", mail.company_id)
    .eq("klant_id", klantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(1);
  if (openFout) throw new Error(`Open klacht zoeken: ${openFout.message}`);

  let klachtId: string | undefined = open?.[0]?.id;
  if (!klachtId) {
    const omschrijving = (
      watNietGoed.trim() ||
      mail.onderwerp.trim() ||
      (bron === "app" ? "Klacht uit WhatsApp" : "Klacht uit mail")
    ).slice(0, 500);
    const { data: nieuw, error: nieuwFout } = await db
      .from("klachten")
      .insert({
        company_id: mail.company_id,
        klant_id: klantId,
        customer_id: await adresVanKlacht(db, mail.company_id, klantId, adres),
        omschrijving,
        bron,
        ontvangen_op: mail.ontvangen_op,
        door_paaltje: true,
        gemaakt_door: null,
      })
      .select("id")
      .single();
    if (nieuwFout) throw new Error(`Klacht maken: ${nieuwFout.message}`);
    klachtId = nieuw.id;
  }

  const { error: koppelFout } = await db
    .from("klacht_berichten")
    .insert({ klacht_id: klachtId, bericht_id: mail.id, company_id: mail.company_id });
  // Twee rondes tegelijk: de koppeling staat er al, prima.
  if (koppelFout && koppelFout.code !== "23505") throw new Error(`Mail aan klacht: ${koppelFout.message}`);
}

/** Het adres van de klacht, alleen als het duidelijk is. */
async function adresVanKlacht(
  db: Db,
  companyId: string,
  klantId: string,
  adres: AdresUitMail | null,
): Promise<string | null> {
  const { data, error } = await db
    .from("customers")
    .select("id,house_number,addition,streets(name,volledige_naam)")
    .eq("company_id", companyId)
    .eq("klant_id", klantId)
    .is("deleted_at", null);
  if (error) throw new Error(`Adressen van klant: ${error.message}`);
  const adressen = (data ?? []) as {
    id: string;
    house_number: number;
    addition: string;
    streets: { name: string; volledige_naam: string | null } | null;
  }[];
  if (adressen.length === 1) return adressen[0].id;
  if (!adres?.straat.trim() || !adres.huisnummer.trim()) return null;

  const schoon = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const straat = schoon(adres.straat);
  const nummer = schoon(adres.huisnummer);
  const treffers = adressen.filter((c) => {
    const namen = [c.streets?.name ?? "", c.streets?.volledige_naam ?? ""].map(schoon).filter(Boolean);
    return namen.includes(straat) && schoon(`${c.house_number}${c.addition ?? ""}`) === nummer;
  });
  return treffers.length === 1 ? treffers[0].id : null;
}
