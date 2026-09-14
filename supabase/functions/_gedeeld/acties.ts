/**
 * Wat Paaltje met een gelezen mail mag doen.
 *
 * Per categorie stelt het bedrijf in hoe zelfstandig hij is (zie de migratie
 * 20260916090000_paaltje.sql). Hier staat wat dat per soort betekent:
 *
 *  - Overslaan: bij "zelf doorvoeren", als hij heel zeker is én de klant maar
 *    één adres heeft, zet hij de maanden zelf op overslaan — met dezelfde
 *    regels en hetzelfde rapport als het oude postvak. Anders een voorstel.
 *    Bij meer adressen weet hij niet zeker welk adres bedoeld is ("mijn huis",
 *    niet de winkel), dus dan beslist een mens.
 *  - Afzeggingen: nooit zelf. Een klant laten stoppen is te groot om zonder
 *    mens te doen; hij zet klaar welke adressen het betreft.
 *  - Nieuwe klanten: een aanmelding klaarzetten in Aanmeldingen, met wat er
 *    uit de mail te halen viel. Daar kijkt de glazenwasser toch altijd naar.
 *  - Prijsopvraging: de prijs erbij (eigen prijs of richtprijs per wijk).
 *  - Klachten en Overig: alleen lezen en eventueel een concept.
 *
 * Opnieuw lezen mag nooit dubbel doen: wat al gedaan is staat in `voorstel`,
 * en dat wordt meegegeven. En op een mail die al beantwoord of afgehandeld is
 * gebeurt niets meer.
 */
import { veiligVoorAutomatisch, voerOverslaanDoor, ZEKER_AUTOMATISCH } from "./doorvoeren.ts";
import type { Categorie, TeLezen, Uitkomst, Zelfstandigheid } from "./paaltje.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const NIVEAU: Record<Zelfstandigheid, number> = {
  niets: 0,
  concept: 1,
  concept_voorstel: 2,
  zelf_doorvoeren: 3,
};

export interface Voorstel {
  overslaan?: { maanden: string[]; adressen: string[]; doorgevoerd?: boolean; teruggedraaid?: boolean };
  stoppen?: { adressen: string[]; doorgevoerd?: boolean };
  /** Waarom Paaltje de bevestiging niet (zeker) kon versturen. */
  bevestiging_fout?: string;
  aanmelding_id?: string;
  prijs?: { eigen?: { adres: string; prijs: number }[]; richtprijzen?: { wijk: string; prijs: number }[] };
}

export interface Resultaat {
  voorstel: Voorstel;
  /** Mag er een concept klaarstaan? Niet als alle categorieën op "niets" staan. */
  conceptToegestaan: boolean;
  doorgevoerd: boolean;
}

export interface MailStand {
  /** Door een mens gekoppelde klant; die gaat voor op wat Paaltje vond. */
  klant_id: string | null;
  beantwoord_op: string | null;
  afgehandeld_op: string | null;
  voorstel: Voorstel;
}

/** Adressen (id, omschrijving, prijs) van een klant, alleen binnen dit bedrijf. */
async function adressenVanKlant(db: Db, companyId: string, klantId: string) {
  const { data, error } = await db
    .from("customers")
    .select("id,house_number,addition,price,streets(name,volledige_naam)")
    .eq("company_id", companyId)
    .eq("klant_id", klantId)
    .is("deleted_at", null);
  if (error) throw new Error(`Adressen van klant: ${error.message}`);
  return (data ?? []).map((c: { id: string; house_number: number; addition: string | null; price: number; streets: { name: string; volledige_naam: string } | null }) => ({
    id: c.id,
    omschrijving: `${c.streets?.volledige_naam || c.streets?.name || ""} ${c.house_number}${c.addition ?? ""}`.trim(),
    prijs: Number(c.price) || 0,
  }));
}

export async function voerActiesUit(
  db: Db,
  mail: TeLezen,
  uit: Uitkomst,
  categorieen: Categorie[],
  stand: MailStand,
  /** Direct bewaren wat al gedaan is, zodat een halverwege gestopte ronde het niet overdoet. */
  bewaarVoorstel: (v: Voorstel) => Promise<void>,
): Promise<Resultaat> {
  const eerder = stand.voorstel ?? {};
  const gekozen = uit.categorieen
    .map((c) => categorieen.find((x) => x.id === c.id))
    .filter((c): c is Categorie => !!c);

  if (!uit.is_klantmail || gekozen.length === 0 || uit.ai_fout) {
    return { voorstel: eerder, conceptToegestaan: false, doorgevoerd: false };
  }
  const conceptToegestaan = gekozen.some((c) => NIVEAU[c.zelfstandigheid] >= NIVEAU.concept);

  // Al beantwoord of afgehandeld: alleen opnieuw indelen, niets meer doen.
  if (stand.beantwoord_op || stand.afgehandeld_op) {
    return { voorstel: eerder, conceptToegestaan, doorgevoerd: false };
  }

  const niveauVoor = (sleutel: string) =>
    Math.max(-1, ...gekozen.filter((c) => c.sleutel === sleutel).map((c) => NIVEAU[c.zelfstandigheid]));

  // Welke klant: die een mens koppelde gaat voor.
  const klantId = stand.klant_id ?? uit.klant_id;
  const adressen = klantId
    ? (uit.klanten.find((k) => k.id === klantId)?.adressen ?? (await adressenVanKlant(db, mail.company_id, klantId)))
    : [];
  const adresIds = adressen.map((a) => a.id);
  const voorstel: Voorstel = { ...eerder };
  // Een oude melding over de bevestiging hoort niet bij deze nieuwe lezing.
  delete voorstel.bevestiging_fout;
  let doorgevoerd = false;

  // Overslaan
  const overslaan = niveauVoor("overslaan");
  if (overslaan >= NIVEAU.concept_voorstel && uit.maanden.length > 0 && adresIds.length > 0 && !eerder.overslaan?.doorgevoerd) {
    const teruggedraaid = eerder.overslaan?.teruggedraaid === true;
    voorstel.overslaan = { maanden: uit.maanden, adressen: adresIds, ...(teruggedraaid ? { teruggedraaid } : {}) };
    const mag =
      !teruggedraaid &&
      overslaan >= NIVEAU.zelf_doorvoeren &&
      uit.zekerheid >= ZEKER_AUTOMATISCH &&
      adresIds.length === 1 &&
      veiligVoorAutomatisch(uit.maanden);
    if (mag) {
      const r = await voerOverslaanDoor(db, {
        companyId: mail.company_id,
        antwoordId: null,
        berichtId: mail.id,
        customerIds: adresIds,
        maanden: uit.maanden,
        automatisch: true,
        zekerheid: uit.zekerheid,
        door: null,
      });
      // Alleen "doorgevoerd" als er niets misging; anders blijft het een
      // voorstel met een knop, en kan een mens het opnieuw proberen.
      if (r.mislukt === 0) {
        voorstel.overslaan.doorgevoerd = true;
        doorgevoerd = r.aangepast > 0;
        await bewaarVoorstel(voorstel);
      }
    }
  }

  // Afzeggingen: alleen klaarzetten.
  if (niveauVoor("afzeggingen") >= NIVEAU.concept_voorstel && adresIds.length > 0) {
    // Al doorgevoerd: dan blijft het zoals het was (met de adressen van toen).
    voorstel.stoppen = eerder.stoppen?.doorgevoerd ? eerder.stoppen : { adressen: adresIds };
  }

  // Nieuwe klanten: één aanmelding per mail, ook als hij opnieuw gelezen wordt.
  if (
    niveauVoor("nieuwe_klanten") >= NIVEAU.concept_voorstel &&
    uit.aanmelding &&
    !eerder.aanmelding_id &&
    !klantId
  ) {
    const a = uit.aanmelding;
    const { data, error } = await db
      .from("aanmeldingen")
      .insert({
        company_id: mail.company_id,
        naam: a.naam || mail.van_naam,
        email: mail.van_email,
        telefoon: a.telefoon,
        postcode: a.postcode.replace(/\s+/g, "").toUpperCase(),
        straat: a.straat,
        huisnummer: a.huisnummer,
        plaats: a.plaats,
        soort: "onbekend",
        status: "open",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Aanmelding klaarzetten: ${error?.message}`);
    voorstel.aanmelding_id = data.id;
    // Meteen vastleggen: stopt de ronde hierna, dan komt er geen tweede.
    await bewaarVoorstel(voorstel);
    const { error: rapportFout } = await db.from("mail_wijzigingen").insert({
      company_id: mail.company_id,
      bericht_id: mail.id,
      soort: "aanmelding",
      klant: a.naam || mail.van_naam,
      adres: [a.straat, a.huisnummer, a.plaats].filter(Boolean).join(" "),
      automatisch: true,
      zekerheid: uit.zekerheid,
      details: { aanmelding_id: data.id },
    });
    if (rapportFout) console.error("rapport aanmelding:", rapportFout.message);
  }

  // Prijsopvraging: de prijs die Paaltje in zijn concept gebruikte, ook zichtbaar.
  if (niveauVoor("prijsopvraging") >= NIVEAU.concept) {
    voorstel.prijs = adressen.length
      ? { eigen: adressen.filter((x) => x.prijs > 0).map((x) => ({ adres: x.omschrijving, prijs: x.prijs })) }
      : { richtprijzen: uit.richtprijzen };
  }

  return { voorstel, conceptToegestaan, doorgevoerd };
}
