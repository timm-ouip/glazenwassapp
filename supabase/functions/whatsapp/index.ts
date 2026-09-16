/**
 * Het WhatsApp-nummer van het bedrijf koppelen en beheren, de kant van de app.
 *
 * Fase 1: Meta's testnummer handmatig instellen (phone_number_id, id van het
 * WhatsApp Business-account en een toegangstoken). Het token gaat hier één
 * keer binnen, wordt bij Meta getest en gaat versleuteld de database in; het
 * gaat nooit terug naar de app. Later komt hier het koppelen via de app
 * (Embedded Signup) bij.
 *
 * Koppelen en ontkoppelen: alleen de eigenaar. Een gesprek als gelezen
 * markeren en media alsnog ophalen: wie berichten mag lezen. Antwoorden: wie
 * berichten mag versturen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { ontsleutel, versleutel } from "../_gedeeld/geheim.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";
import {
  annuleerGeplandeAntwoorden,
  graph,
  haalMediaBinnen,
  tokenVan,
  VENSTER_MS,
  verstuurTekst,
  waNummer,
  type WaMedia,
} from "../_gedeeld/whatsapp.ts";

/** Meer berichten per minuut vanuit Wooshy niet: een knop die blijft hangen. */
const MAX_PER_MINUUT = 20;
const MAX_TEKST = 4096;

// deno-lint-ignore no-explicit-any
type Db = any;

interface Medewerker {
  id: string;
  company_id: string;
  rol: string;
}

interface Verzoek {
  actie?:
    | "test_instellen"
    | "ontkoppelen"
    | "gelezen"
    | "versturen"
    | "media_ophalen"
    | "antwoord_annuleren"
    | "antwoord_nu";
  tekst?: string;
  bericht_id?: string;
  phone_number_id?: string;
  waba_id?: string;
  token?: string;
  telefoon?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return antwoord({ fout: "De server is niet goed ingesteld." }, 500);

  const kop = req.headers.get("Authorization") ?? "";
  if (!kop.startsWith("Bearer ")) return antwoord({ fout: "Niet ingelogd." }, 401);
  const alsGebruiker = createClient(url, anon, {
    global: { headers: { Authorization: kop } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: gebruiker } = await alsGebruiker.auth.getUser();
  if (!gebruiker?.user) return antwoord({ fout: "Niet ingelogd." }, 401);
  const { data: medewerker } = await alsGebruiker
    .from("employees")
    .select("id,company_id,rol")
    .eq("id", gebruiker.user.id)
    .maybeSingle();
  if (!medewerker) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);
  const m = medewerker as Medewerker;
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  try {
    switch (verzoek.actie) {
      case "test_instellen":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan WhatsApp koppelen." }, 403);
        return await testInstellen(db, m, verzoek);
      case "ontkoppelen":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan WhatsApp ontkoppelen." }, 403);
        return await ontkoppel(db, m);
      case "gelezen":
        if (!(await heeftRecht(db, m, "mail_lezen"))) return antwoord({ fout: "Je mag geen berichten lezen." }, 403);
        return await markeerGelezen(db, m, String(verzoek.telefoon ?? ""));
      case "media_ophalen":
        if (!(await heeftRecht(db, m, "mail_lezen"))) return antwoord({ fout: "Je mag geen berichten lezen." }, 403);
        return await mediaOphalen(db, m, String(verzoek.bericht_id ?? ""));
      case "versturen":
        if (!(await heeftRecht(db, m, "mail_versturen"))) {
          return antwoord({ fout: "Je mag geen berichten versturen." }, 403);
        }
        return await verstuur(db, m, String(verzoek.telefoon ?? ""), String(verzoek.tekst ?? ""));
      case "antwoord_annuleren":
      case "antwoord_nu":
        if (!(await heeftRecht(db, m, "mail_versturen"))) {
          return antwoord({ fout: "Je mag geen berichten versturen." }, 403);
        }
        return await geplandAntwoord(db, m, String(verzoek.bericht_id ?? ""), verzoek.actie === "antwoord_nu");
      default:
        return antwoord({ fout: "Onbekende actie." }, 400);
    }
  } catch (e) {
    console.error(`whatsapp ${verzoek.actie}:`, e instanceof Error ? e.message : e);
    return antwoord({ fout: "Er ging iets mis op de server. Probeer het nog eens." }, 500);
  }
});

async function testInstellen(db: Db, m: Medewerker, verzoek: Verzoek): Promise<Response> {
  const phoneNumberId = String(verzoek.phone_number_id ?? "").trim();
  const wabaId = String(verzoek.waba_id ?? "").trim();
  const token = String(verzoek.token ?? "").trim();
  if (!/^\d{5,30}$/.test(phoneNumberId)) return antwoord({ fout: "Het nummer-ID bestaat alleen uit cijfers." }, 400);
  if (!/^\d{5,30}$/.test(wabaId)) return antwoord({ fout: "Het account-ID bestaat alleen uit cijfers." }, 400);
  if (token.length < 20 || token.length > 1000) return antwoord({ fout: "Dat lijkt geen toegangstoken." }, 400);

  // Eerst bij Meta proberen: klopt het token bij dit nummer?
  const nummer = await graph<{ display_phone_number?: string; verified_name?: string }>(
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
    token,
  );
  if (!nummer.ok) {
    return antwoord({ fout: `Meta accepteerde dit niet: ${nummer.fout}` }, 400);
  }

  // Hoort dit nummer al bij een ander bedrijf, dan niet overnemen. Was dat
  // bedrijf al ontkoppeld, dan ruimen we die oude koppeling op.
  const { data: bestaand } = await db
    .from("whatsapp_koppelingen")
    .select("id,company_id,status")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (bestaand && bestaand.company_id !== m.company_id) {
    if (bestaand.status !== "uit") {
      return antwoord({ fout: "Dit nummer is al gekoppeld aan een ander bedrijf." }, 409);
    }
    const { error: opruimFout } = await db.from("whatsapp_koppelingen").delete().eq("id", bestaand.id);
    if (opruimFout) throw new Error(`Oude koppeling opruimen: ${opruimFout.message}`);
  }

  // Zonder dit abonnement stuurt Meta geen berichten naar onze webhook.
  const abonnement = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
  if (!abonnement.ok) {
    return antwoord({ fout: `Het nummer klopt, maar aanmelden voor berichten mislukte: ${abonnement.fout}` }, 400);
  }

  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .upsert(
      {
        company_id: m.company_id,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        weergavenummer: String(nummer.data.display_phone_number ?? ""),
        soort: "test",
        status: "actief",
        fout: "",
        paaltje_vanaf: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    )
    .select("id")
    .single();
  // Twee pogingen tegelijk: de unieke index houdt de tweede tegen.
  if (error?.code === "23505") return antwoord({ fout: "Dit nummer is al gekoppeld aan een ander bedrijf." }, 409);
  if (error) throw new Error(`Koppeling opslaan: ${error.message}`);

  const geheim = await versleutel(token);
  const { error: geheimFout } = await db
    .from("whatsapp_geheimen")
    .upsert({ koppeling_id: koppeling.id, ...geheim, updated_at: new Date().toISOString() });
  if (geheimFout) throw new Error(`Token opslaan: ${geheimFout.message}`);

  return antwoord({ ok: true, weergavenummer: nummer.data.display_phone_number ?? "", naam: nummer.data.verified_name ?? "" });
}

async function ontkoppel(db: Db, m: Medewerker): Promise<Response> {
  const { data: koppeling } = await db
    .from("whatsapp_koppelingen")
    .select("id")
    .eq("company_id", m.company_id)
    .maybeSingle();
  if (!koppeling) return antwoord({ fout: "Er is geen WhatsApp gekoppeld." }, 404);
  const { error: geheimFout } = await db.from("whatsapp_geheimen").delete().eq("koppeling_id", koppeling.id);
  const { error } = await db
    .from("whatsapp_koppelingen")
    .update({ status: "uit", fout: "", updated_at: new Date().toISOString() })
    .eq("id", koppeling.id);
  if (geheimFout || error) throw new Error(`Ontkoppelen: ${(geheimFout ?? error)?.message}`);
  return antwoord({ ok: true });
}

async function markeerGelezen(db: Db, m: Medewerker, telefoon: string): Promise<Response> {
  const nummer = waNummer(telefoon);
  if (!nummer) return antwoord({ fout: "Geen nummer." }, 400);
  const { error } = await db
    .from("berichten")
    .update({ gelezen: true })
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", nummer)
    .eq("gelezen", false);
  if (error) throw new Error(`Gelezen: ${error.message}`);
  return antwoord({ ok: true });
}

/** De actieve koppeling van het bedrijf met het token erbij, of een foutantwoord. */
async function actieveKoppeling(
  db: Db,
  m: Medewerker,
): Promise<{ id: string; phone_number_id: string; token: string } | Response> {
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .select("id,phone_number_id,status")
    .eq("company_id", m.company_id)
    .maybeSingle();
  if (error) throw new Error(`Koppeling ophalen: ${error.message}`);
  if (!koppeling || koppeling.status === "uit") return antwoord({ fout: "Er is geen WhatsApp gekoppeld." }, 404);
  const token = await tokenVan(db, koppeling.id, ontsleutel);
  if (!token) return antwoord({ fout: "Het WhatsApp-token ontbreekt. Koppel het nummer opnieuw." }, 409);
  return { id: koppeling.id, phone_number_id: koppeling.phone_number_id, token };
}

async function verstuur(db: Db, m: Medewerker, telefoon: string, invoer: string): Promise<Response> {
  const nummer = waNummer(telefoon);
  const tekst = invoer.trim();
  if (!nummer) return antwoord({ fout: "Geen nummer." }, 400);
  if (!tekst) return antwoord({ fout: "Het bericht is leeg." }, 400);
  if (tekst.length > MAX_TEKST) return antwoord({ fout: `Hooguit ${MAX_TEKST} tekens per bericht.` }, 400);

  const koppeling = await actieveKoppeling(db, m);
  if (koppeling instanceof Response) return koppeling;

  // Vrije tekst mag alleen binnen 24 uur na het laatste bericht van de klant.
  const { data: laatsteIn, error: inFout } = await db
    .from("berichten")
    .select("id,ontvangen_op")
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", nummer)
    .eq("richting", "in")
    .neq("bron", "geschiedenis")
    .order("ontvangen_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (inFout) throw new Error(`Laatste bericht: ${inFout.message}`);
  if (!laatsteIn || Date.now() - new Date(laatsteIn.ontvangen_op).getTime() > VENSTER_MS) {
    return antwoord(
      {
        fout: "Het laatste bericht van deze klant is meer dan 24 uur oud. WhatsApp staat dan alleen een goedgekeurd sjabloon toe.",
        venster_dicht: true,
      },
      409,
    );
  }

  const sinds = new Date(Date.now() - 60_000).toISOString();
  const { count, error: telFout } = await db
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("bron", "wooshy")
    .gte("ontvangen_op", sinds);
  if (telFout) throw new Error(`Tellen: ${telFout.message}`);
  if ((count ?? 0) >= MAX_PER_MINUUT) {
    return antwoord({ fout: "Even rustig aan: te veel berichten in één minuut." }, 429);
  }

  // Eerst Paaltjes ingeplande antwoord tegenhouden, dan pas zelf versturen:
  // anders kunnen ze tegelijk weggaan.
  await annuleerGeplandeAntwoorden(db, m.company_id, nummer, "Er is vanuit Wooshy geantwoord.");
  const uit = await verstuurTekst(koppeling.token, koppeling.phone_number_id, nummer, tekst);
  if (!uit.ok) {
    console.error("whatsapp versturen:", uit.status, uit.fout);
    return antwoord({ fout: `WhatsApp weigerde het bericht: ${uit.fout}` }, 502);
  }

  const nu = new Date().toISOString();
  const { data: bericht, error } = await db
    .from("berichten")
    .insert({
      company_id: m.company_id,
      kanaal: "whatsapp",
      wa_id: uit.waId,
      wa_telefoon: nummer,
      wa_type: "text",
      wa_status: "verstuurd",
      richting: "uit",
      bron: "wooshy",
      tekst,
      fragment: tekst.replace(/\s+/g, " ").slice(0, 200),
      ontvangen_op: nu,
      gelezen: true,
      op_server: false,
      paaltje_status: "overslaan",
    })
    .select("id")
    .single();
  // Het bericht is al weg; een opslagfout mag dat niet verbergen.
  if (error) console.error("whatsapp verstuurd bericht opslaan:", error.message);
  // Meldingen van Meta ("afgeleverd", "gelezen") die binnenkomen vóór dit
  // opslaan klaar is, vindt de webhook niet; dan blijft het op "verstuurd".

  // Wat nog open stond van deze klant is nu beantwoord.
  const { error: beantwoordFout } = await db
    .from("berichten")
    .update({ beantwoord_op: nu, gelezen: true })
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", nummer)
    .eq("richting", "in")
    .is("beantwoord_op", null);
  if (beantwoordFout) console.error("whatsapp beantwoord zetten:", beantwoordFout.message);

  return antwoord({ ok: true, id: bericht?.id ?? null, bewaard: !error });
}

async function mediaOphalen(db: Db, m: Medewerker, berichtId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(berichtId)) return antwoord({ fout: "Onbekend bericht." }, 400);
  const { data: bericht, error } = await db
    .from("berichten")
    .select("id,media,ontvangen_op")
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("id", berichtId)
    .maybeSingle();
  if (error) throw new Error(`Bericht ophalen: ${error.message}`);
  if (!bericht) return antwoord({ fout: "Onbekend bericht." }, 404);
  const media = (bericht.media ?? []) as WaMedia[];
  if (media.every((x) => x.pad)) return antwoord({ ok: true, media });
  if (Date.now() - new Date(bericht.ontvangen_op).getTime() > 7 * 24 * 60 * 60 * 1000) {
    return antwoord({ fout: "Dit bestand is ouder dan 7 dagen; WhatsApp bewaart het niet meer." }, 410);
  }
  const koppeling = await actieveKoppeling(db, m);
  if (koppeling instanceof Response) return koppeling;
  const uit = await haalMediaBinnen(db, koppeling.token, m.company_id, bericht.id, media);
  if (!uit.compleet) return antwoord({ fout: "Het bestand kon niet worden opgehaald. Probeer het zo nog eens." }, 502);
  return antwoord({ ok: true, media: uit.media });
}

/**
 * Wat Paaltje heeft ingepland: niet versturen, of nu meteen. "Nu" zet alleen
 * het moment op nu; de planner verstuurt het binnen een minuut, met alle
 * controles (al geantwoord, nieuw bericht, 24 uur).
 */
async function geplandAntwoord(db: Db, m: Medewerker, berichtId: string, nu: boolean): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(berichtId)) return antwoord({ fout: "Onbekend bericht." }, 400);
  const { data, error } = await db
    .from("berichten")
    .update(
      nu
        ? { wa_antwoord_op: new Date().toISOString(), wa_antwoord_direct: true }
        : { wa_antwoord_status: "geannuleerd", wa_antwoord_reden: "Je zette het stop.", wa_antwoord_op: null },
    )
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("id", berichtId)
    .eq("wa_antwoord_status", "gepland")
    .select("id");
  if (error) throw new Error(`Gepland antwoord: ${error.message}`);
  if (!data?.length) return antwoord({ fout: "Dit antwoord staat niet (meer) klaar." }, 409);
  return antwoord({ ok: true });
}
