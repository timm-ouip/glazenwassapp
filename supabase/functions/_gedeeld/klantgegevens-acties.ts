/**
 * Wat een mens doet met wat Wooshy zelf deed met klantgegevens uit een
 * bericht (zie klantgegevens.ts): bevestigen ("Klopt") of terugdraaien
 * ("Ongedaan maken"). Voor mail (mail-acties) en WhatsApp (functie whatsapp)
 * dezelfde regels; alleen wat er aan de klant gekoppeld werd verschilt: bij
 * mail het mailadres, bij WhatsApp het telefoonnummer.
 *
 * Geeft een status en een body terug; de functie eromheen maakt er een
 * antwoord van.
 */
import {
  leesKlantgegevens,
  telefoonSleutel,
  type KlantGegevens,
  type Veld,
  VELDEN,
  vergelijkbaar,
} from "./klantgegevens.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Welke berichten dit verzoek mag raken: van dit bedrijf, en bij mail uit deze mailbox. */
export type Bereik =
  | { kanaal: "mail"; companyId: string; mailboxId: string }
  | { kanaal: "whatsapp"; companyId: string };

export interface Uitkomst {
  status: number;
  body: Record<string, unknown>;
}

function binnen(vraag: Db, bereik: Bereik): Db {
  const q = vraag.eq("company_id", bereik.companyId).eq("kanaal", bereik.kanaal);
  return bereik.kanaal === "mail" ? q.eq("mailbox_id", bereik.mailboxId) : q;
}

/** "deze mail" of "dit bericht", voor de foutmeldingen. */
function woord(bereik: Bereik) {
  return bereik.kanaal === "mail"
    ? { deze: "deze mail", die: "Die mail", Deze: "Deze mail" }
    : { deze: "dit bericht", die: "Dat bericht", Deze: "Dit bericht" };
}

/**
 * Dit bericht hoort bij deze klant. Het mailadres of nummer komt bij de klant,
 * de klant komt op het bericht, en Paaltje leest het opnieuw met die klant erbij.
 */
export async function bevestigKlant(db: Db, bereik: Bereik, id: string, klantId: string): Promise<Uitkomst> {
  const w = woord(bereik);
  if (!UUID.test(id) || !UUID.test(klantId)) {
    return { status: 404, body: { fout: `${w.die} of klant bestaat niet.` } };
  }
  const { data: rij, error } = await binnen(
    db.from("berichten").select("id,van_email,wa_telefoon,beantwoord_op,klantgegevens").eq("id", id),
    bereik,
  ).maybeSingle();
  if (error) throw new Error(`Bericht opzoeken: ${error.message}`);
  const { data: klant, error: klantFout } = await db
    .from("klanten")
    .select("id")
    .eq("id", klantId)
    .eq("company_id", bereik.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (klantFout) throw new Error(`Klant opzoeken: ${klantFout.message}`);
  if (!rij || !klant) return { status: 404, body: { fout: `${w.die} of klant bestaat niet.` } };

  // Het mailadres of het nummer bij de klant; had Wooshy dat al zelf gedaan,
  // dan is het nu door een mens bevestigd.
  const koppeling =
    bereik.kanaal === "mail"
      ? { tabel: "klant_emails", kolom: "email", waarde: String(rij.van_email ?? "").trim().toLowerCase() }
      : { tabel: "klant_telefoons", kolom: "telefoon", waarde: telefoonSleutel(rij.wa_telefoon) };
  if (koppeling.waarde) {
    const { error: koppelFout } = await db
      .from(koppeling.tabel)
      .insert({ company_id: bereik.companyId, klant_id: klant.id, [koppeling.kolom]: koppeling.waarde, bron: "mens" });
    if (koppelFout && koppelFout.code !== "23505") throw new Error(`Koppelen: ${koppelFout.message}`);
    if (koppelFout) {
      const { error: bevestigFout } = await db
        .from(koppeling.tabel)
        .update({ bron: "mens" })
        .eq("company_id", bereik.companyId)
        .eq("klant_id", klant.id)
        .eq(koppeling.kolom, koppeling.waarde)
        .eq("bron", "paaltje");
      if (bevestigFout) throw new Error(`Koppeling bevestigen: ${bevestigFout.message}`);
    }
  }

  // Een mens koppelt bewust: een eerder teruggedraaide klant mag dan weer, en
  // wat teruggedraaid was mag Wooshy weer aanvullen. Een herkenning van deze
  // klant is nu bevestigd en hoeft niet meer ongedaan gemaakt te kunnen worden.
  const kg: KlantGegevens = { ...leesKlantgegevens(rij.klantgegevens) };
  if (kg.herkend?.klant_id === klant.id) delete kg.herkend;
  if (kg.teruggedraaid) kg.teruggedraaid = { ...kg.teruggedraaid, waarden: [] };
  const { data: gezet, error: bijwerkFout } = await db
    .from("berichten")
    .update({
      klant_id: klant.id,
      klant_gok_id: null,
      klantgegevens: { ...kg, afgewezen: (kg.afgewezen ?? []).filter((k) => k !== klant.id) },
      paaltje_status: "wacht",
      paaltje_pogingen: 0,
      ai_fout: "",
    })
    .eq("id", rij.id)
    .neq("paaltje_status", "bezig")
    .select("id");
  if (bijwerkFout) throw new Error(`Klant op het bericht zetten: ${bijwerkFout.message}`);
  if (!gezet?.length) {
    const wat = bereik.kanaal === "mail" ? "Het mailadres" : "Het nummer";
    return {
      status: 409,
      body: { fout: `${wat} is gekoppeld, maar Paaltje leest ${w.deze} net. Probeer het zo nog eens.` },
    };
  }
  // Zette Paaltje het zelf op afgehandeld (hij dacht: geen klantbericht), dan
  // gaat dat eraf: met deze klant erbij leest hij het opnieuw.
  const { error: afFout } = await db
    .from("berichten")
    .update({ afgehandeld_op: null, afgehandeld_door_paaltje: false })
    .eq("id", rij.id)
    .eq("afgehandeld_door_paaltje", true);
  if (afFout) console.error("afgehandeld terugzetten:", afFout.message);
  return { status: 200, body: { ok: true } };
}

/**
 * Terugdraaien wat Wooshy met de klantgegevens uit een bericht deed. Een vak
 * gaat alleen weer leeg als er nog precies staat wat Wooshy invulde: heeft
 * iemand het intussen aangepast, dan blijft het staan (dat staat in `bleven`).
 *
 * Een herkende klant gaat van het bericht af, het zelf gekoppelde mailadres
 * of nummer ook, en Paaltje leest het opnieuw zonder die klant. Wat
 * teruggedraaid is doet Wooshy bij opnieuw lezen niet nog eens.
 */
export async function draaiKlantgegevensTerug(db: Db, bereik: Bereik, id: string): Promise<Uitkomst> {
  const w = woord(bereik);
  if (!UUID.test(id)) return { status: 404, body: { fout: `${w.die} bestaat niet (meer).` } };
  const { data: rij, error } = await binnen(
    db.from("berichten").select("id,klant_id,paaltje_status,klantgegevens,wa_telefoon").eq("id", id),
    bereik,
  ).maybeSingle();
  if (error) throw new Error(`Bericht opzoeken: ${error.message}`);
  if (!rij) return { status: 404, body: { fout: `${w.die} bestaat niet (meer).` } };
  if (rij.paaltje_status === "bezig") {
    return { status: 409, body: { fout: `Paaltje leest ${w.deze} net. Probeer het zo nog eens.` } };
  }
  const kg = leesKlantgegevens(rij.klantgegevens);
  const { toegevoegd, herkend } = kg;
  if (!toegevoegd && !herkend) return { status: 400, body: { fout: "Er is niets om terug te draaien." } };

  // WhatsApp: het terugdraaien raakt het hele gesprek. Leest Paaltje net een
  // ander appje van dit nummer, dan kan hij de herkenning er meteen weer op
  // zetten: dan eerst even wachten.
  const nummer = bereik.kanaal === "whatsapp" ? telefoonSleutel(rij.wa_telefoon) : "";
  if (nummer && herkend) {
    const { count, error: bezigFout } = await db
      .from("berichten")
      .select("id", { count: "exact", head: true })
      .eq("company_id", bereik.companyId)
      .eq("kanaal", "whatsapp")
      .eq("wa_sleutel", nummer)
      .eq("paaltje_status", "bezig");
    if (bezigFout) throw new Error(`Gesprek nakijken: ${bezigFout.message}`);
    if ((count ?? 0) > 0) {
      return { status: 409, body: { fout: "Paaltje leest net een appje van dit nummer. Probeer het zo nog eens." } };
    }
  }

  // Eerder teruggedraaid bij dit bericht blijft in de lijst staan.
  const waarden = new Set(kg.teruggedraaid?.waarden ?? []);
  for (const veld of VELDEN) {
    const waarde = toegevoegd?.velden?.[veld];
    if (typeof waarde === "string" && waarde) waarden.add(vergelijkbaar(waarde));
  }
  const eerderBleven = kg.teruggedraaid?.bleven ?? [];
  const vorigHerkend = herkend ?? kg.teruggedraaid?.herkend;
  const nieuw: KlantGegevens = {
    ...kg,
    // De klant, en bij een zelf aangemaakte klant ook het adres: anders maakt
    // Wooshy bij opnieuw lezen gewoon weer een klant aan op dat adres.
    afgewezen: herkend
      ? [
          ...new Set([
            ...(kg.afgewezen ?? []),
            herkend.klant_id,
            ...(herkend.aangemaakt && herkend.customer_id ? [herkend.customer_id] : []),
          ]),
        ]
      : kg.afgewezen,
    teruggedraaid: {
      op: new Date().toISOString(),
      velden: { ...(kg.teruggedraaid?.velden ?? {}), ...(toegevoegd?.velden ?? {}) },
      ...(vorigHerkend ? { herkend: vorigHerkend } : {}),
      bleven: eerderBleven,
      waarden: [...waarden],
    },
  };
  delete nieuw.toegevoegd;
  delete nieuw.herkend;
  delete nieuw.anders;

  // Eerst het bericht vastzetten (alleen als Paaltje er niet mee bezig is), en
  // pas daarna de klant terugdraaien. Andersom kan Paaltje het er net
  // tussendoor pakken en de gewiste vakjes meteen weer invullen.
  const bijwerken: Record<string, unknown> = { klantgegevens: nieuw };
  if (herkend && rij.klant_id === herkend.klant_id) {
    Object.assign(bijwerken, {
      klant_id: null,
      klant_gok_id: null,
      paaltje_status: "wacht",
      paaltje_pogingen: 0,
      ai_fout: "",
    });
  }
  const { data: gezet, error: bijwerkFout } = await db
    .from("berichten")
    .update(bijwerken)
    .eq("id", rij.id)
    .neq("paaltje_status", "bezig")
    .select("id");
  if (bijwerkFout) throw new Error(`Bericht bijwerken: ${bijwerkFout.message}`);
  if (!gezet?.length) {
    return { status: 409, body: { fout: `Paaltje leest ${w.deze} net. Probeer het zo nog eens.` } };
  }

  const bleven: Veld[] = [];
  if (toegevoegd && UUID.test(String(toegevoegd.klant_id))) {
    // Wat er nu staat, om te zien of het nog van Paaltje is. Niet letterlijk
    // vergelijken: de app schrijft een adres netjes weg, dus Paaltjes
    // "kerkstraat" kan intussen "Kerkstraat" heten en "1234ab" "1234 AB".
    // Dat is dezelfde waarde, en die hoort gewoon teruggedraaid te worden.
    const { data: nu, error: leesFout } = await db
      .from("klanten")
      .select(VELDEN.join(","))
      .eq("id", toegevoegd.klant_id)
      .eq("company_id", bereik.companyId)
      .maybeSingle();
    if (leesFout) throw new Error(`Terugdraaien: ${leesFout.message}`);
    const kaal = (t: unknown) => String(t ?? "").replace(/\s+/g, "").toLowerCase();
    const rij = (nu ?? {}) as Record<string, unknown>;

    for (const veld of VELDEN) {
      const waarde = toegevoegd.velden?.[veld];
      if (typeof waarde !== "string" || !waarde) continue;
      if (!nu || kaal(rij[veld]) !== kaal(waarde)) {
        bleven.push(veld);
        continue;
      }
      const { data, error: veldFout } = await db
        .from("klanten")
        .update({ [veld]: "" })
        .eq("id", toegevoegd.klant_id)
        .eq("company_id", bereik.companyId)
        .eq(veld, String(rij[veld] ?? ""))
        .select("id");
      if (veldFout) throw new Error(`Terugdraaien (${veld}): ${veldFout.message}`);
      if (!data?.length) bleven.push(veld);
    }
  }

  // Wat Wooshy zelf aan de klant koppelde gaat er weer af: bij mail het
  // mailadres, bij WhatsApp het nummer. Alleen als Paaltje het deed.
  if (herkend && UUID.test(String(herkend.klant_id))) {
    const koppeling =
      bereik.kanaal === "mail"
        ? { tabel: "klant_emails", kolom: "email", waarde: herkend.email }
        : { tabel: "klant_telefoons", kolom: "telefoon", waarde: telefoonSleutel(rij.wa_telefoon) };
    if (koppeling.waarde) {
      const { error: wegFout } = await db
        .from(koppeling.tabel)
        .delete()
        .eq("company_id", bereik.companyId)
        .eq("klant_id", herkend.klant_id)
        .eq(koppeling.kolom, koppeling.waarde)
        .eq("bron", "paaltje");
      if (wegFout) throw new Error(`Loskoppelen: ${wegFout.message}`);
    }

    // WhatsApp: een heel gesprek hoort bij één nummer. Toen Paaltje het nummer
    // koppelde, kregen de eerdere appjes van dat nummer die klant ook (trigger
    // klant_telefoons_berichten_nakoppelen). Die gaan er weer af, tenzij het
    // nummer via de klantkaart of een mens nog steeds bij deze klant hoort.
    // En staat dezelfde herkenning op een ander appje, dan is die nu ook
    // afgewezen: anders staat daar nog een Klopt-knop voor deze klant.
    if (bereik.kanaal === "whatsapp" && koppeling.waarde) {
      const { data: nog, error: nogFout } = await db
        .from("klant_telefoons")
        .select("id")
        .eq("company_id", bereik.companyId)
        .eq("klant_id", herkend.klant_id)
        .eq("telefoon", koppeling.waarde)
        .limit(1);
      if (nogFout) throw new Error(`Nummer nakijken: ${nogFout.message}`);
      // Hoort het nummer via de klantkaart of een mens nog bij deze klant, dan
      // blijven de andere appjes terecht bij hem en is er niets afgewezen.
      if (!nog?.length) {
        const { error: losFout } = await db
          .from("berichten")
          .update({ klant_id: null })
          .eq("company_id", bereik.companyId)
          .eq("kanaal", "whatsapp")
          .eq("wa_sleutel", koppeling.waarde)
          .eq("klant_id", herkend.klant_id)
          .neq("id", rij.id);
        if (losFout) throw new Error(`Klant van het gesprek halen: ${losFout.message}`);
        const { data: andere, error: andereFout } = await db
          .from("berichten")
          .select("id,klantgegevens")
          .eq("company_id", bereik.companyId)
          .eq("kanaal", "whatsapp")
          .eq("wa_sleutel", koppeling.waarde)
          .neq("id", rij.id)
          .eq("klantgegevens->herkend->>klant_id", herkend.klant_id);
        if (andereFout) throw new Error(`Andere herkenningen: ${andereFout.message}`);
        for (const a of (andere ?? []) as { id: string; klantgegevens: unknown }[]) {
          const ander: KlantGegevens = { ...leesKlantgegevens(a.klantgegevens) };
          delete ander.herkend;
          ander.afgewezen = [...new Set([...(ander.afgewezen ?? []), herkend.klant_id])];
          const { error: anderFout } = await db
            .from("berichten")
            .update({ klantgegevens: ander })
            .eq("id", a.id);
          if (anderFout) console.error("herkenning op ander appje:", anderFout.message);
        }
      }
    }
  }

  // Maakte Wooshy de klant zelf aan bij een adres zonder klant, dan gaat die
  // klant weer van het adres af. Naar de prullenbak (daar terug te halen) alleen
  // als hij echt van dit adres af ging en aan geen ander adres meer hangt:
  // hing iemand hem intussen ergens anders aan, dan blijft hij staan.
  if (herkend?.aangemaakt && UUID.test(String(herkend.klant_id)) && UUID.test(String(herkend.customer_id ?? ""))) {
    try {
      const { data: los, error: losFout } = await db
        .from("customers")
        .update({ klant_id: null })
        .eq("id", herkend.customer_id)
        .eq("company_id", bereik.companyId)
        .eq("klant_id", herkend.klant_id)
        .select("id");
      if (losFout) throw new Error(`Klant van het adres halen: ${losFout.message}`);
      if ((los ?? []).length > 0) {
        const { count, error: telFout } = await db
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("company_id", bereik.companyId)
          .eq("klant_id", herkend.klant_id)
          .is("deleted_at", null);
        if (telFout) throw new Error(`Andere adressen van de klant tellen: ${telFout.message}`);
        if ((count ?? 0) === 0) {
          const { error: prullenbakFout } = await db
            .from("klanten")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", herkend.klant_id)
            .eq("company_id", bereik.companyId)
            .is("deleted_at", null);
          if (prullenbakFout) throw new Error(`Klant naar de prullenbak: ${prullenbakFout.message}`);
        }
      }
    } catch (e) {
      // De herkenning terug op het bericht, zodat Ongedaan maken nog eens kan.
      const { error: herstelFout } = await db
        .from("berichten")
        .update({ klantgegevens: kg, klant_id: rij.klant_id })
        .eq("id", rij.id);
      if (herstelFout) console.error("herkenning terugzetten:", herstelFout.message);
      throw e;
    }
  }

  // Wat bleef staan erbij zetten, voor het vakje "Teruggedraaid".
  if (bleven.length > 0 && nieuw.teruggedraaid) {
    const { error: blevenFout } = await db
      .from("berichten")
      .update({
        klantgegevens: {
          ...nieuw,
          teruggedraaid: { ...nieuw.teruggedraaid, bleven: [...new Set([...eerderBleven, ...bleven])] },
        },
      })
      .eq("id", rij.id)
      .neq("paaltje_status", "bezig");
    if (blevenFout) console.error("bleven bewaren:", blevenFout.message);
  }
  return { status: 200, body: { ok: true, bleven } };
}
