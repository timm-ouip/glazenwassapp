/**
 * Wat Brevo terugmeldt over een verstuurde mail: afgeleverd, geweigerd,
 * gebounced.
 *
 * Alleen de aflevering, niet of iemand de mail opende. Openen bijhouden vraagt
 * een volgpixel, en die valt onder de cookieregels (toestemming van de klant);
 * of de mailserver van de ontvanger de mail aannam, is gewoon een melding van
 * die server zelf.
 *
 * Geen gebruiker, dus geen inlog: het slot is het geheim BREVO_WEBHOOK_SLEUTEL,
 * als `Authorization: Bearer …` of als `?sleutel=…` in de URL die je bij Brevo
 * instelt. Een melding over een mail die wij niet kennen (bijvoorbeeld een
 * uitnodiging) krijgt netjes 200 terug en verandert niets: Brevo hoeft niet
 * eindeloos opnieuw te proberen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

/** Van Brevo's woorden naar die van ons. */
const VERTALING: Record<string, string> = {
  delivered: "afgeleverd",
  hard_bounce: "gebounced",
  hardBounce: "gebounced",
  soft_bounce: "vertraagd",
  softBounce: "vertraagd",
  deferred: "vertraagd",
  blocked: "geblokkeerd",
  invalid_email: "ongeldig",
  invalid: "ongeldig",
  error: "gebounced",
  spam: "spam",
  complaint: "spam",
};

/**
 * Welke melding wint als er twee binnenkomen. Een mail kan eerst afgeleverd
 * zijn en daarna alsnog geweigerd; andersom zegt "afgeleverd" na een bounce
 * niets meer.
 */
const RANG: Record<string, number> = {
  "": 0,
  vertraagd: 1,
  afgeleverd: 2,
  gelezen: 3,
  spam: 4,
  ongeldig: 5,
  geblokkeerd: 6,
  gebounced: 7,
};

function sleutelKlopt(req: Request, geheim: string): boolean {
  if (!geheim) return false;
  const kop = req.headers.get("Authorization") ?? "";
  const uitKop = kop.startsWith("Bearer ") ? kop.slice(7).trim() : "";
  const uitUrl = new URL(req.url).searchParams.get("sleutel") ?? "";
  const gegeven = uitKop || uitUrl;
  if (gegeven.length !== geheim.length) return false;
  // Tijd-constant vergelijken: anders kun je het geheim letter voor letter raden.
  let verschil = 0;
  for (let i = 0; i < geheim.length; i++) verschil |= geheim.charCodeAt(i) ^ gegeven.charCodeAt(i);
  return verschil === 0;
}

/** Brevo stuurt het kenmerk soms met punthaken eromheen. */
function kenmerkVan(gebeurtenis: Record<string, unknown>): string {
  const rauw = String(gebeurtenis["message-id"] ?? gebeurtenis["messageId"] ?? "").trim();
  return rauw.replace(/^</, "").replace(/>$/, "");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const geheim = Deno.env.get("BREVO_WEBHOOK_SLEUTEL") ?? "";
  if (!sleutelKlopt(req, geheim)) {
    return new Response(JSON.stringify({ fout: "Niet toegestaan." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) {
    return new Response(JSON.stringify({ fout: "De server is niet goed ingesteld." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let lading: unknown;
  try {
    lading = await req.json();
  } catch {
    return new Response(JSON.stringify({ fout: "Onleesbaar." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const gebeurtenissen = (Array.isArray(lading) ? lading : [lading]).filter(
    (g): g is Record<string, unknown> => !!g && typeof g === "object",
  );

  let bijgewerkt = 0;
  for (const g of gebeurtenissen.slice(0, 200)) {
    const kenmerk = kenmerkVan(g);
    const status = VERTALING[String(g["event"] ?? "")] ?? "";
    if (!kenmerk || !status) continue;

    const { data: rijen, error } = await db
      .from("mail_ontvangers")
      .select("id,bezorgstatus")
      .eq("message_id", kenmerk);
    if (error) {
      console.error("ontvanger zoeken:", error.message);
      continue;
    }
    for (const rij of rijen ?? []) {
      const nu = String(rij.bezorgstatus ?? "");
      // Een melding die minder zegt dan wat we al weten, laten we liggen.
      if ((RANG[status] ?? 0) <= (RANG[nu] ?? 0)) continue;
      const { error: schrijfFout } = await db
        .from("mail_ontvangers")
        .update({ bezorgstatus: status, status_op: new Date().toISOString() })
        .eq("id", rij.id);
      if (schrijfFout) console.error("status bijwerken:", schrijfFout.message);
      else bijgewerkt += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, bijgewerkt }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
