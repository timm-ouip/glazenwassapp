/**
 * Hier stuurt Meta alles naartoe wat er op het WhatsApp-nummer gebeurt:
 * berichten van klanten, wat je zelf in de app verstuurde, of een bericht
 * aangekomen of gelezen is, en de oude chats na het koppelen.
 *
 * Geen ingelogde gebruiker, dus zonder JWT-controle. Het slot is de
 * handtekening: Meta ondertekent elke body met het app-geheim
 * (WHATSAPP_APP_SECRET). Klopt die niet, dan doen we niets. Dat is het geheim
 * van de Meta-app van Wooshy: alle bedrijven koppelen via die ene app.
 *
 * Meta probeert het opnieuw als we geen 200 geven. Wat al binnen is, slaat
 * de unieke index op wa_id over, dus dubbel binnenkomen kan geen kwaad.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { handtekeningKlopt, leesWijziging, STATUS, STATUS_RANG } from "../_gedeeld/whatsapp.ts";

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
  const geheim = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
  if (!(await handtekeningKlopt(body, req.headers.get("x-hub-signature-256"), geheim))) {
    return tekst("Handtekening klopt niet", 401);
  }

  let json: { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  try {
    json = JSON.parse(body);
  } catch {
    return tekst("Onleesbaar", 400);
  }
  if (json.object !== "whatsapp_business_account") return tekst("ok");

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    for (const entry of json.entry ?? []) {
      for (const change of entry.changes ?? []) {
        await verwerk(db, String(change.field ?? ""), change.value ?? {});
      }
    }
  } catch (e) {
    // Een 500 laat Meta het later opnieuw proberen; dubbele berichten slaan we over.
    console.error("whatsapp-webhook:", e instanceof Error ? e.message : e);
    return tekst("Fout", 500);
  }
  return tekst("ok");
});

async function verwerk(db: Db, field: string, value: Record<string, unknown>) {
  const phoneNumberId = String((value.metadata as Record<string, unknown> | undefined)?.phone_number_id ?? "");
  if (!phoneNumberId) return;
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .select("id,company_id,status,weergavenummer")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) throw new Error(`Koppeling ophalen: ${error.message}`);
  // Een nummer dat we niet (meer) kennen: niets mee doen, wel 200 geven.
  if (!koppeling || koppeling.status === "uit") return;

  const inhoud = leesWijziging(field, value, koppeling.company_id, koppeling.weergavenummer);

  if (inhoud.rijen.length > 0) {
    const { error: opslaanFout } = await db
      .from("berichten")
      .upsert(inhoud.rijen, { onConflict: "company_id,wa_id", ignoreDuplicates: true });
    if (opslaanFout) throw new Error(`Berichten opslaan: ${opslaanFout.message}`);
    const { error: bijwerkFout } = await db
      .from("whatsapp_koppelingen")
      .update({ laatste_bericht_op: new Date().toISOString(), status: "actief", fout: "" })
      .eq("id", koppeling.id);
    if (bijwerkFout) console.error("whatsapp-webhook laatste bericht:", bijwerkFout.message);
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
  }
}
