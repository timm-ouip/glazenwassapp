/**
 * Elke twee minuten: nieuwe mail ophalen, voor elke gekoppelde mailbox.
 *
 * pg_cron roept dit aan (zie migratie 20260915090000_mailbox.sql). Er is geen
 * ingelogde gebruiker, dus de functie staat zonder JWT-controle open; de
 * sleutel in de kop `x-cron-sleutel` is het slot.
 *
 * Het antwoord gaat meteen terug en het werk loopt op de achtergrond door:
 * pg_net wacht maar even, en een ronde met een jaar oude mail duurt langer.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { haalOp, MAILBOX_KOLOMMEN, pakSlot, type MailboxRij } from "../_gedeeld/ophalen.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Na zoveel tijd begint deze aanroep geen nieuwe mailbox meer; de rest is
 *  over twee minuten aan de beurt, en dan eerst. */
const NIEUWE_MAILBOX_TOT_MS = 90_000;

/**
 * Twee sleutels vergelijken zonder dat de rekentijd verraadt hoeveel tekens
 * er al goed waren: eerst allebei hashen, dan elk byte bekijken.
 */
async function gelijk(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let verschil = 0;
  for (let i = 0; i < x.length; i++) verschil |= x[i] ^ y[i];
  return verschil === 0;
}

Deno.serve(async (req) => {
  const geheim = Deno.env.get("MAIL_CRON_SLEUTEL") ?? "";
  if (!geheim || !(await gelijk(req.headers.get("x-cron-sleutel") ?? "", geheim))) {
    return antwoord({ ok: false }, 401);
  }

  // Vanaf hier weet de aanroeper de sleutel; dan mag het antwoord zeggen wat
  // er misging. Dat komt in het logboek van pg_net, en daar kijken we in.
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return antwoord({ ok: false, fase: "instellingen" }, 500);
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Alleen actieve mailboxen, langst niet geprobeerd eerst. Op de laatste
  // póging en niet de laatste geslaagde ronde: een mailbox die steeds misgaat
  // mag niet elke keer vooraan staan. Een geweigerde login ('fout') wacht tot
  // iemand opnieuw koppelt of zelf op ophalen klikt.
  const { data: boxen, error } = await db
    .from("mailboxen")
    .select(MAILBOX_KOLOMMEN)
    .eq("status", "actief")
    .order("laatste_poging", { ascending: true, nullsFirst: true });
  if (error) {
    console.error("mailboxen lezen:", error.message);
    return antwoord({ ok: false, fase: "mailboxen lezen", fout: error.message.slice(0, 200) }, 500);
  }

  const begin = Date.now();
  const werk = (async () => {
    for (const box of (boxen ?? []) as MailboxRij[]) {
      if (Date.now() - begin > NIEUWE_MAILBOX_TOT_MS) break;
      try {
        const slot = await pakSlot(db, box.id);
        if (!slot) continue;
        const uit = await haalOp(db, box, slot);
        console.log(
          `mailbox ${box.id}: ${uit.nieuw} nieuw${uit.klaar ? "" : ", nog niet klaar"}${uit.fout ? `, fout: ${uit.fout}` : ""}`,
        );
      } catch (e) {
        console.error(`mailbox ${box.id}:`, e instanceof Error ? e.message : e);
      }
    }
  })();

  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(werk);
  else await werk;

  return antwoord({ ok: true, mailboxen: (boxen ?? []).length });
});
