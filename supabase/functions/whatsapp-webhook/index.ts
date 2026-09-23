/**
 * Hier stuurt Meta alles naartoe wat er op het WhatsApp-nummer gebeurt:
 * berichten van klanten, wat je zelf in de app verstuurde, of een bericht
 * aangekomen of gelezen is, en de oude chats na het koppelen.
 *
 * Geen ingelogde gebruiker, dus zonder JWT-controle. Het slot is de
 * handtekening: Meta ondertekent elke body met het app-geheim
 * (WHATSAPP_APP_SECRET). Klopt die niet, dan doen we niets. Dat is het geheim
 * van de Meta-app van Paaltje Systems: alle bedrijven koppelen via die ene app.
 *
 * Via Kapso komt hetzelfde binnen op `?aanbieder=kapso`, in Kapso's eigen
 * vorm en ondertekend met KAPSO_WEBHOOK_SECRET (kop X-Webhook-Signature).
 * Dat geheim geven we aan Kapso mee bij het koppelen van een nummer. Kapso
 * wil binnen 10 seconden antwoord en probeert het nog twee keer.
 *
 * Meta probeert het opnieuw als we geen 200 geven. Wat al binnen is, slaat
 * de unieke index op wa_id over, dus dubbel binnenkomen kan geen kwaad.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { ontsleutel } from "../_gedeeld/geheim.ts";
import {
  SJABLOON_STATUS,
  annuleerGeplandeAntwoorden,
  haalMediaBinnen,
  handtekeningKlopt,
  kapsoHandtekeningKlopt,
  leesKapsoGebeurtenis,
  leesWijziging,
  STATUS,
  STATUS_RANG,
  toegangVan,
  type WaMedia,
  type Webhookinhoud,
} from "../_gedeeld/whatsapp.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MAX_MEDIA_PER_AANROEP = 10;

// deno-lint-ignore no-explicit-any
type Db = any;

function tekst(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta controleert bij het instellen of dit adres van ons is.
  if (req.method === "GET") {
    const verwacht = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
    if (
      verwacht &&
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === verwacht
    ) {
      return tekst(url.searchParams.get("hub.challenge") ?? "");
    }
    return tekst("Verboden", 403);
  }
  if (req.method !== "POST") return tekst("Niet toegestaan", 405);

  const body = await req.text();
  if (url.searchParams.get("aanbieder") === "kapso") return await vanKapso(req, body);

  const geheim = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
  if (!(await handtekeningKlopt(body, req.headers.get("x-hub-signature-256"), geheim))) {
    return tekst("Handtekening klopt niet", 401);
  }

  let json: { object?: string; entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  try {
    json = JSON.parse(body);
  } catch {
    return tekst("Onleesbaar", 400);
  }
  if (json.object !== "whatsapp_business_account") return tekst("ok");

  const db = beheerder();

  try {
    for (const entry of json.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const field = String(change.field ?? "");
        if (field === "message_template_status_update" || field === "template_category_update") {
          await sjabloonBijwerken(db, String(entry.id ?? ""), field, change.value ?? {});
        } else {
          const value = change.value ?? {};
          const phoneNumberId = String((value.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? "");
          await verwerk(db, phoneNumberId, "meta", (k) => leesWijziging(field, value, k.company_id, k.weergavenummer));
        }
      }
    }
  } catch (e) {
    // Een 500 laat Meta het later opnieuw proberen; dubbele berichten slaan we over.
    console.error("whatsapp-webhook:", e instanceof Error ? e.message : e);
    return tekst("Fout", 500);
  }
  return tekst("ok");
});

function beheerder(): Db {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Wat Kapso stuurt: één gebeurtenis, of een bundel als bufferen aan staat. */
async function vanKapso(req: Request, body: string): Promise<Response> {
  const geheim = Deno.env.get("KAPSO_WEBHOOK_SECRET") ?? "";
  if (!(await kapsoHandtekeningKlopt(body, req.headers.get("x-webhook-signature"), geheim))) {
    return tekst("Handtekening klopt niet", 401);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body);
  } catch {
    return tekst("Onleesbaar", 400);
  }
  const soort = String(req.headers.get("x-webhook-event") ?? json.type ?? "");
  // Alleen berichten en hun status; de rest (gesprek begonnen, …) negeren we.
  if (!soort.startsWith("whatsapp.message.")) return tekst("ok");
  const items = json.batch === true && Array.isArray(json.data) ? json.data : [json];

  const db = beheerder();
  try {
    for (const i of items) {
      const item = i && typeof i === "object" ? (i as Record<string, unknown>) : {};
      const gesprek = (item.conversation ?? {}) as Record<string, unknown>;
      const phoneNumberId = String(item.phone_number_id ?? gesprek.phone_number_id ?? "");
      await verwerk(db, phoneNumberId, "kapso", (k) => leesKapsoGebeurtenis(item, k.company_id));
    }
  } catch (e) {
    console.error("whatsapp-webhook kapso:", e instanceof Error ? e.message : e);
    return tekst("Fout", 500);
  }
  return tekst("ok");
}

interface Koppeling {
  id: string;
  company_id: string;
  status: string;
  weergavenummer: string;
  paaltje_vanaf: string;
}

async function verwerk(
  db: Db,
  phoneNumberId: string,
  aanbieder: "meta" | "kapso",
  lees: (koppeling: Koppeling) => Webhookinhoud,
) {
  if (!phoneNumberId) return;
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .select("id,company_id,status,weergavenummer,paaltje_vanaf")
    .eq("phone_number_id", phoneNumberId)
    // Een ondertekend bericht van Kapso mag alleen een Kapso-koppeling vullen, en andersom.
    .eq("aanbieder", aanbieder)
    .maybeSingle();
  if (error) throw new Error(`Koppeling ophalen: ${error.message}`);
  // Een nummer dat we niet (meer) kennen: niets mee doen, wel 200 geven.
  if (!koppeling || koppeling.status === "uit") return;

  const inhoud = lees(koppeling as Koppeling);

  // Paaltje leest wat een klant stuurt, vanaf het koppelen (niet de oude chats).
  const vanaf = new Date(koppeling.paaltje_vanaf).getTime();
  for (const r of inhoud.rijen) {
    if (r.bron === "klant" && new Date(r.ontvangen_op).getTime() >= vanaf) r.paaltje_status = "wacht";
  }

  if (inhoud.rijen.length > 0) {
    const { data: nieuw, error: opslaanFout } = await db
      .from("berichten")
      .upsert(inhoud.rijen, { onConflict: "company_id,wa_id", ignoreDuplicates: true })
      .select("id,media,bron,ontvangen_op,wa_telefoon");
    if (opslaanFout) throw new Error(`Berichten opslaan: ${opslaanFout.message}`);

    // Foto's en spraakberichten meteen binnenhalen, maar Meta niet laten
    // wachten: het antwoord gaat nu terug, het downloaden loopt door.
    // Oude chats: Meta bewaart media maar 7 dagen, ouder heeft geen zin. En
    // hooguit een handvol per aanroep; de rest kan later met "Nu ophalen".
    const grens = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const metMedia = (
      (nieuw ?? []) as { id: string; media: WaMedia[]; bron: string; ontvangen_op: string }[]
    )
      .filter((r) => r.media?.length)
      .filter((r) => r.bron !== "geschiedenis" || new Date(r.ontvangen_op).getTime() > grens)
      .slice(0, MAX_MEDIA_PER_AANROEP);
    if (metMedia.length > 0) {
      const werk = (async () => {
        const toegang = await toegangVan(db, koppeling.id, ontsleutel);
        if (!toegang) return;
        for (const r of metMedia) await haalMediaBinnen(db, toegang, koppeling.company_id, r.id, r.media);
      })().catch((e) => console.error("whatsapp-webhook media:", e instanceof Error ? e.message : e));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(werk);
      else await werk;
    }
    const { error: bijwerkFout } = await db
      .from("whatsapp_koppelingen")
      .update({ laatste_bericht_op: new Date().toISOString(), status: "actief", fout: "" })
      .eq("id", koppeling.id);
    if (bijwerkFout) console.error("whatsapp-webhook laatste bericht:", bijwerkFout.message);

    // Je antwoordde zelf op je telefoon: wat Paaltje voor dat gesprek had
    // ingepland gaat niet meer, en wat openstond is beantwoord. Alleen voor
    // rijen die nu echt nieuw zijn: Kapso kan hetzelfde appje nog eens sturen
    // bij "afgeleverd" of "gelezen", en dat is geen nieuw antwoord.
    const zelfGeantwoord = new Map<string, string>();
    for (const r of (nieuw ?? []) as { bron: string; wa_telefoon: string; ontvangen_op: string }[]) {
      if (r.bron !== "app") continue;
      const eerder = zelfGeantwoord.get(r.wa_telefoon);
      if (!eerder || r.ontvangen_op > eerder) zelfGeantwoord.set(r.wa_telefoon, r.ontvangen_op);
    }
    for (const [nummer, op] of zelfGeantwoord) {
      await annuleerGeplandeAntwoorden(db, koppeling.company_id, nummer, "Je antwoordde zelf op je telefoon.");
      const { error: beantwoordFout } = await db
        .from("berichten")
        .update({ beantwoord_op: op })
        .eq("company_id", koppeling.company_id)
        .eq("kanaal", "whatsapp")
        .eq("wa_telefoon", nummer)
        .eq("richting", "in")
        .is("beantwoord_op", null)
        .lte("ontvangen_op", op);
      if (beantwoordFout) console.error("whatsapp-webhook beantwoord:", beantwoordFout.message);
    }
  }

  for (const s of inhoud.statussen) {
    const nieuw = STATUS[s.status];
    if (!nieuw || !s.wa_id) continue;
    const { data: bericht, error: zoekFout } = await db
      .from("berichten")
      .select("id,wa_status")
      .eq("company_id", koppeling.company_id)
      .eq("wa_id", s.wa_id)
      .maybeSingle();
    if (zoekFout) {
      console.error("whatsapp-webhook status zoeken:", zoekFout.message);
      continue;
    }
    // Statussen kunnen in een andere volgorde binnenkomen: nooit terug.
    if (!bericht || (STATUS_RANG[bericht.wa_status] ?? 0) >= nieuw.rang) continue;
    if (s.fout) console.error(`whatsapp-webhook bericht ${s.wa_id} mislukt:`, s.fout);
    const { error: statusFout } = await db
      .from("berichten")
      .update({ wa_status: nieuw.waarde })
      .eq("id", bericht.id);
    if (statusFout) console.error("whatsapp-webhook status bijwerken:", statusFout.message);

    // Was dit een aankondiging of een wijziging, dan hoort de planning het
    // ook te weten: daar staat het vinkje naast het adres.
    await bezorgstatusBijwerken(db, koppeling.company_id, s.wa_id, nieuw.waarde);
  }
}

/** Van de WhatsApp-status naar wat de planning erover toont. */
const WA_BEZORGSTATUS: Record<string, string> = {
  afgeleverd: "afgeleverd",
  gelezen: "gelezen",
  mislukt: "gebounced",
};
const BEZORG_RANG: Record<string, number> = {
  "": 0,
  vertraagd: 1,
  afgeleverd: 2,
  gelezen: 3,
  spam: 4,
  ongeldig: 5,
  geblokkeerd: 6,
  gebounced: 7,
};

/** Het appje bij de verstuurde aankondiging, als het er een was. */
async function bezorgstatusBijwerken(
  db: Db,
  companyId: string,
  waId: string,
  waStatus: string,
) {
  const status = WA_BEZORGSTATUS[waStatus];
  if (!status) return;
  // Deze functie draait met de service-sleutel, dus langs de vaste regels
  // heen: het bedrijf moet er zelf bij.
  const { data: rijen, error } = await db
    .from("mail_ontvangers")
    .select("id,bezorgstatus")
    .eq("company_id", companyId)
    .eq("wa_id", waId);
  if (error) {
    console.error("whatsapp-webhook ontvanger zoeken:", error.message);
    return;
  }
  for (const rij of rijen ?? []) {
    if ((BEZORG_RANG[status] ?? 0) <= (BEZORG_RANG[String(rij.bezorgstatus ?? "")] ?? 0)) continue;
    const { error: schrijfFout } = await db
      .from("mail_ontvangers")
      .update({ bezorgstatus: status, status_op: new Date().toISOString() })
      .eq("id", rij.id);
    if (schrijfFout) console.error("whatsapp-webhook bezorgstatus:", schrijfFout.message);
  }
}

/** Meta keurde een sjabloon goed of af, of gaf het een andere categorie. */
async function sjabloonBijwerken(db: Db, wabaId: string, field: string, value: Record<string, unknown>) {
  const metaId = String(value.message_template_id ?? "");
  if (!wabaId || !metaId) return;
  // Het account kan bij meer koppelingen horen (een oude die uit staat): alleen
  // de actieve tellen, en het sjabloon moet bij een van die bedrijven horen.
  const { data: koppelingen, error: koppelFout } = await db
    .from("whatsapp_koppelingen")
    .select("company_id")
    .eq("waba_id", wabaId)
    .neq("status", "uit");
  if (koppelFout) throw new Error(`Koppeling bij sjabloon: ${koppelFout.message}`);
  const bedrijven = [...new Set((koppelingen ?? []).map((k: { company_id: string }) => k.company_id))];
  if (bedrijven.length === 0) return;
  const bijwerken: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (field === "message_template_status_update") {
    const status = SJABLOON_STATUS[String(value.event ?? "").toUpperCase()];
    if (!status) return;
    bijwerken.status = status;
    const reden = String(value.reason ?? "");
    bijwerken.afwijsreden = reden && reden !== "NONE" ? reden.slice(0, 300) : "";
  } else {
    const nieuw = String(value.new_category ?? "").toUpperCase();
    if (!nieuw) return;
    bijwerken.categorie = nieuw === "MARKETING" ? "marketing" : "utility";
  }
  const { error } = await db
    .from("wa_sjablonen")
    .update(bijwerken)
    .in("company_id", bedrijven)
    .eq("meta_id", metaId);
  if (error) throw new Error(`Sjabloon bijwerken: ${error.message}`);
}
