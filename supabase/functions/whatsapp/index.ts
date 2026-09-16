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
 * markeren: wie berichten mag lezen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { versleutel } from "../_gedeeld/geheim.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";
import { graph, waNummer } from "../_gedeeld/whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface Medewerker {
  id: string;
  company_id: string;
  rol: string;
}

interface Verzoek {
  actie?: "test_instellen" | "ontkoppelen" | "gelezen";
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
