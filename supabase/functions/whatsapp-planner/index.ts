/**
 * Elke minuut: de WhatsApp-antwoorden versturen die Paaltje heeft ingepland.
 *
 * Paaltje plant een antwoord in met een wachttijd, zodat de glazenwasser eerst
 * zelf kan reageren. Vlak voor het versturen kijken we alles opnieuw na:
 *  - antwoordde iemand intussen (in de app op de telefoon of in Wooshy)?
 *  - kwam er van de klant nog een bericht bij? Dan leest Paaltje dat eerst.
 *  - valt het binnen de antwoordtijden? Anders schuift het door.
 *  - is het 24-uursvenster van WhatsApp nog open?
 *
 * pg_cron roept dit aan met de sleutel in `x-cron-sleutel`.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { cronSleutelKlopt } from "../_gedeeld/cron.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import { binnenAntwoordtijd, tokenVan, VENSTER_MS, verstuurTekst } from "../_gedeeld/whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const PER_RONDE = 20;
/** Staat een antwoord zo lang op "bezig", dan is de ronde halverwege gestopt. */
const VASTGELOPEN_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (!(await cronSleutelKlopt(req))) return antwoord({ ok: false }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const n = await ronde(db);
    return antwoord({ ok: true, verstuurd: n });
  } catch (e) {
    console.error("whatsapp-planner:", e instanceof Error ? e.message : e);
    return antwoord({ ok: false }, 500);
  }
});

interface Gepland {
  id: string;
  company_id: string;
  wa_telefoon: string;
  ontvangen_op: string;
  concept: string;
  beantwoord_op: string | null;
  wa_antwoord_direct: boolean;
}

async function ronde(db: Db): Promise<number> {
  // Een ronde die halverwege stopte: we weten niet of het weg is. Niet
  // opnieuw sturen (dan krijgt de klant het misschien twee keer), wel melden.
  const { error: vastFout } = await db
    .from("berichten")
    .update({
      wa_antwoord_status: "mislukt",
      wa_antwoord_reden: "Onderbroken tijdens het versturen. Kijk op je telefoon of het is aangekomen.",
    })
    .eq("wa_antwoord_status", "bezig")
    .lt("wa_antwoord_op", new Date(Date.now() - VASTGELOPEN_MS).toISOString());
  if (vastFout) console.error("vastgelopen antwoorden:", vastFout.message);

  const { data: klaar, error } = await db
    .from("berichten")
    .select("id")
    .eq("kanaal", "whatsapp")
    .eq("wa_antwoord_status", "gepland")
    .lte("wa_antwoord_op", new Date().toISOString())
    .is("deleted_at", null)
    .order("wa_antwoord_op")
    .limit(PER_RONDE);
  if (error) throw new Error(`Geplande antwoorden: ${error.message}`);

  let verstuurd = 0;
  const tijden = new Map<string, { van: string; tot: string }>();
  for (const { id } of klaar ?? []) {
    // Pakken: alleen als het nog gepland staat.
    const { data: gepakt, error: pakFout } = await db
      .from("berichten")
      .update({ wa_antwoord_status: "bezig", wa_antwoord_op: new Date().toISOString() })
      .eq("id", id)
      .eq("wa_antwoord_status", "gepland")
      .select("id,company_id,wa_telefoon,ontvangen_op,concept,beantwoord_op,wa_antwoord_direct");
    if (pakFout) {
      console.error(`antwoord ${id} pakken:`, pakFout.message);
      continue;
    }
    const b = gepakt?.[0] as Gepland | undefined;
    if (!b) continue;
    try {
      if (await verstuurEen(db, b, tijden)) verstuurd += 1;
    } catch (e) {
      const reden = e instanceof Error ? e.message.slice(0, 300) : String(e);
      console.error(`antwoord ${id}:`, reden);
      await zet(db, b.id, "mislukt", reden);
    }
  }
  return verstuurd;
}

async function zet(db: Db, id: string, status: string, reden: string, extra: Record<string, unknown> = {}) {
  const { error } = await db
    .from("berichten")
    .update({ wa_antwoord_status: status, wa_antwoord_reden: reden, ...extra })
    .eq("id", id);
  if (error) console.error(`antwoord ${id} op ${status}:`, error.message);
}

async function verstuurEen(db: Db, b: Gepland, tijden: Map<string, { van: string; tot: string }>): Promise<boolean> {
  const tekst = String(b.concept ?? "").trim();
  if (!tekst) {
    await zet(db, b.id, "geannuleerd", "Er was geen antwoord.");
    return false;
  }
  if (b.beantwoord_op) {
    await zet(db, b.id, "geannuleerd", "Er was al geantwoord.");
    return false;
  }

  if (!(await gesprekStil(db, b))) return false;

  if (Date.now() - new Date(b.ontvangen_op).getTime() > VENSTER_MS) {
    await zet(db, b.id, "geannuleerd", "Meer dan 24 uur na het bericht van de klant; WhatsApp staat vrije tekst dan niet toe.");
    return false;
  }

  let t = tijden.get(b.company_id);
  if (!t) {
    const { data: bedrijf } = await db
      .from("companies")
      .select("wa_antwoord_van,wa_antwoord_tot")
      .eq("id", b.company_id)
      .single();
    t = { van: String(bedrijf?.wa_antwoord_van ?? "07:00"), tot: String(bedrijf?.wa_antwoord_tot ?? "21:00") };
    tijden.set(b.company_id, t);
  }
  const nu = new Date();
  const mag = binnenAntwoordtijd(nu, t.van, t.tot);
  if (!b.wa_antwoord_direct && mag.getTime() !== nu.getTime()) {
    // Buiten de tijden (bijvoorbeeld ingesteld na het inplannen): doorschuiven.
    await zet(db, b.id, "gepland", "", { wa_antwoord_op: mag.toISOString() });
    return false;
  }

  const { data: koppeling } = await db
    .from("whatsapp_koppelingen")
    .select("id,phone_number_id,status")
    .eq("company_id", b.company_id)
    .maybeSingle();
  if (!koppeling || koppeling.status === "uit") {
    await zet(db, b.id, "geannuleerd", "WhatsApp is niet meer gekoppeld.");
    return false;
  }
  const token = await tokenVan(db, koppeling.id, ontsleutel);
  if (!token) {
    await zet(db, b.id, "mislukt", "Het WhatsApp-token ontbreekt.");
    return false;
  }

  // Vlak voor het versturen nog één keer: antwoordde iemand net?
  const { data: nogGepakt } = await db.from("berichten").select("wa_antwoord_status,beantwoord_op").eq("id", b.id).single();
  if (nogGepakt?.wa_antwoord_status !== "bezig" || nogGepakt?.beantwoord_op) return false;
  if (!(await gesprekStil(db, b))) return false;

  const uit = await verstuurTekst(token, koppeling.phone_number_id, b.wa_telefoon, tekst);
  if (!uit.ok) {
    await zet(db, b.id, "mislukt", `WhatsApp weigerde het bericht: ${uit.fout}`.slice(0, 300));
    return false;
  }

  const verstuurdOp = new Date().toISOString();
  const { error: opslaanFout } = await db.from("berichten").insert({
    company_id: b.company_id,
    kanaal: "whatsapp",
    wa_id: uit.waId,
    wa_telefoon: b.wa_telefoon,
    wa_type: "text",
    wa_status: "verstuurd",
    richting: "uit",
    bron: "paaltje",
    tekst,
    fragment: tekst.replace(/\s+/g, " ").slice(0, 200),
    ontvangen_op: verstuurdOp,
    gelezen: true,
    op_server: false,
    paaltje_status: "overslaan",
  });
  if (opslaanFout) console.error(`verstuurd antwoord ${b.id} opslaan:`, opslaanFout.message);

  await zet(db, b.id, "verstuurd", "", { beantwoord_op: verstuurdOp, afgehandeld_op: verstuurdOp });
  // Eerdere berichtjes uit dezelfde beurt zijn nu ook beantwoord.
  const { error: beurtFout } = await db
    .from("berichten")
    .update({ beantwoord_op: verstuurdOp })
    .eq("company_id", b.company_id)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", b.wa_telefoon)
    .eq("richting", "in")
    .is("beantwoord_op", null)
    .lte("ontvangen_op", b.ontvangen_op);
  if (beurtFout) console.error("beurt beantwoord:", beurtFout.message);
  return true;
}

/**
 * Is er na dit bericht niets meer in het gesprek gebeurd? Een antwoord van
 * ons: dan niet versturen. Een nieuw bericht van de klant: dan leest Paaltje
 * het gesprek eerst opnieuw.
 */
async function gesprekStil(db: Db, b: Gepland): Promise<boolean> {
  const { data: later, error } = await db
    .from("berichten")
    .select("richting")
    .eq("company_id", b.company_id)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", b.wa_telefoon)
    .gt("ontvangen_op", b.ontvangen_op)
    .is("deleted_at", null)
    .limit(20);
  if (error) throw new Error(`Gesprek nakijken: ${error.message}`);
  if ((later ?? []).some((r: { richting: string }) => r.richting === "uit")) {
    await zet(db, b.id, "geannuleerd", "Er is intussen al geantwoord.");
    return false;
  }
  if ((later ?? []).some((r: { richting: string }) => r.richting === "in")) {
    await zet(db, b.id, "geannuleerd", "De klant stuurde nog een bericht; Paaltje leest het gesprek opnieuw.");
    return false;
  }
  return true;
}
