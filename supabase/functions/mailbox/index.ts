/**
 * De mailbox van het bedrijf koppelen, nu ophalen, of ontkoppelen.
 *
 * Alleen de eigenaar. Het wachtwoord komt hier één keer binnen, wordt getest
 * bij de mailserver, en gaat dan versleuteld de database in. Het gaat nooit
 * meer terug naar de app.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { versleutel } from "../_gedeeld/geheim.ts";
import { probeerSmtp } from "../_gedeeld/smtp.ts";
import {
  haalOp,
  MAILBOX_KOLOMMEN,
  maakImap,
  pakSlot,
  rolVan,
  uitlegFout,
  type MailboxRij,
} from "../_gedeeld/ophalen.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

interface Verzoek {
  actie: "koppelen" | "ophalen" | "ontkoppelen";
  adres?: string;
  wachtwoord?: string;
}

const STANDAARD_HOST = "mail.mijndomein.nl";
const IMAP_POORT = 993;
const SMTP_POORT = 465;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) {
    return antwoord({ fout: "De server is niet goed ingesteld." }, 500);
  }

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
  if (medewerker.rol !== "eigenaar") {
    return antwoord({ fout: "Alleen de eigenaar kan de mailbox beheren." }, 403);
  }

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  if (verzoek.actie === "koppelen") return await koppel(db, medewerker, verzoek);

  const { data: box } = await db
    .from("mailboxen")
    .select(MAILBOX_KOLOMMEN)
    .eq("company_id", medewerker.company_id)
    .maybeSingle();
  if (!box) return antwoord({ fout: "Er is nog geen mailbox gekoppeld." }, 404);

  if (verzoek.actie === "ophalen") {
    if (box.status === "uit") return antwoord({ fout: "De mailbox is ontkoppeld." }, 400);
    let slot;
    try {
      slot = await pakSlot(db, box.id);
    } catch {
      return antwoord({ fout: "Dat lukte even niet. Probeer het zo nog eens." }, 503);
    }
    if (!slot) return antwoord({ ok: true, nieuw: 0, klaar: false, bezig: true });
    const uit = await haalOp(db, box as MailboxRij, slot, { tijdMs: 25_000 });
    if (uit.fout) return antwoord({ fout: uit.fout }, 400);
    return antwoord({ ok: true, nieuw: uit.nieuw, klaar: uit.klaar });
  }

  if (verzoek.actie === "ontkoppelen") {
    // Het slot blijft staan: loopt er nog een ronde, dan maakt die zelf af en
    // ziet aan de status dat hij niet meer "actief" terug mag zetten.
    const { error: geheimFout } = await db.from("mailbox_geheimen").delete().eq("mailbox_id", box.id);
    const { error } = await db.from("mailboxen").update({ status: "uit", fout: "" }).eq("id", box.id);
    if (geheimFout || error) {
      return antwoord({ fout: `Ontkoppelen mislukte: ${(geheimFout ?? error)?.message}` }, 500);
    }
    return antwoord({ ok: true });
  }

  return antwoord({ fout: "Onbekende actie." }, 400);
});

// deno-lint-ignore no-explicit-any
type Db = any;

async function koppel(
  db: Db,
  medewerker: { id: string; company_id: string },
  verzoek: Verzoek,
): Promise<Response> {
  const adres = String(verzoek.adres ?? "").trim().toLowerCase();
  // Het wachtwoord niet trimmen: een spatie aan het eind kan er echt bij horen.
  const wachtwoord = String(verzoek.wachtwoord ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres) || adres.length > 254) {
    return antwoord({ fout: "Dat is geen geldig mailadres." }, 400);
  }
  if (!wachtwoord || wachtwoord.length > 500) {
    return antwoord({ fout: "Vul het wachtwoord van de mailbox in." }, 400);
  }

  // 1. Eerst proberen, dan pas bewaren. Een fout wachtwoord hoort niet in de
  //    database te belanden en daar elke twee minuten geweigerd te worden.
  const client = maakImap(
    { adres, imap_host: STANDAARD_HOST, imap_poort: IMAP_POORT },
    wachtwoord,
  );
  let mappen = 0;
  try {
    await client.connect();
    mappen = (await client.list()).filter((m) => rolVan(m.path, m.specialUse) !== null).length;
  } catch (e) {
    const { tekst, inlog } = uitlegFout(e);
    return antwoord({ fout: inlog ? "Inloggen geweigerd: kloppen het adres en wachtwoord?" : tekst }, 400);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }

  // Versturen komt later, maar dan wil je nu al weten of het inloggen daar lukt.
  const smtpFout = await probeerSmtp({
    host: STANDAARD_HOST,
    poort: SMTP_POORT,
    adres,
    wachtwoord,
  });

  // 2. Bewaren. Een ander adres dan eerst is een andere mailbox: de spiegel van
  //    de oude gaat weg, anders lopen twee mailboxen door elkaar.
  const { data: bestaand } = await db
    .from("mailboxen")
    .select("id,adres")
    .eq("company_id", medewerker.company_id)
    .maybeSingle();
  if (bestaand && bestaand.adres !== adres) {
    const { error } = await db.from("mailboxen").delete().eq("id", bestaand.id);
    if (error) return antwoord({ fout: `De oude mailbox weghalen mislukte: ${error.message}` }, 500);
  }

  let mailboxId: string;
  if (bestaand && bestaand.adres === adres) {
    mailboxId = bestaand.id;
    // Het slot niet leegmaken: een ronde die nog loopt moet eerst afmaken.
    const { error } = await db
      .from("mailboxen")
      .update({ status: "actief", fout: "", gekoppeld_door: medewerker.id })
      .eq("id", mailboxId);
    if (error) return antwoord({ fout: `Bewaren mislukte: ${error.message}` }, 500);
  } else {
    const { data, error } = await db
      .from("mailboxen")
      .insert({ company_id: medewerker.company_id, adres, gekoppeld_door: medewerker.id })
      .select("id")
      .single();
    if (error || !data) return antwoord({ fout: `Bewaren mislukte: ${error?.message}` }, 500);
    mailboxId = data.id;
  }

  const geheim = await versleutel(wachtwoord);
  const { error: geheimFout } = await db
    .from("mailbox_geheimen")
    .upsert({ mailbox_id: mailboxId, ...geheim, updated_at: new Date().toISOString() });
  if (geheimFout) return antwoord({ fout: `Bewaren mislukte: ${geheimFout.message}` }, 500);

  // 3. Meteen een eerste ronde op de achtergrond, zodat je niet op de klok
  //    hoeft te wachten om de eerste mail te zien. Lukt dat niet, dan pakt de
  //    klok het over twee minuten op: het koppelen zelf is gelukt.
  try {
    const { data: box } = await db
      .from("mailboxen")
      .select(MAILBOX_KOLOMMEN)
      .eq("id", mailboxId)
      .single();
    const slot = box && typeof EdgeRuntime !== "undefined" ? await pakSlot(db, mailboxId) : null;
    if (box && slot && typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(haalOp(db, box as MailboxRij, slot, { tijdMs: 100_000 }));
    }
  } catch (e) {
    console.error("eerste ronde:", e instanceof Error ? e.message : e);
  }

  return antwoord({ ok: true, mappen, smtpFout });
}
