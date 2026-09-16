/**
 * Elke minuut, zonder gebruiker (pg_cron):
 *
 *  1. Geplande mail versturen die aan de beurt is ("later versturen").
 *  2. Nieuwe mail van een afzender die je "altijd naar spam" gaf, naar de
 *     spammap verplaatsen — net als een regel in een mailprogramma.
 *
 * Het slot is de kop `x-cron-sleutel`, net als bij mail-ophalen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { MogelijkVerstuurd } from "../_gedeeld/smtp.ts";
import { uitlegFout } from "../_gedeeld/ophalen.ts";
import { type Box, type Db, laadBox, mapMetRol, verplaats, verstuur } from "../_gedeeld/mailwerk.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** Zoveel geplande mails per minuut; de rem van de mailbox telt ook nog mee. */
const PER_RONDE = 3;
/** Zo ver terug kijken naar nieuwe mail voor de spamregels. */
const SPAM_TERUG_MS = 24 * 3600_000;

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
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return antwoord({ ok: false, fase: "instellingen" }, 500);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const werk = (async () => {
    try {
      await verstuurGepland(db);
    } catch (e) {
      console.error("gepland:", e instanceof Error ? e.message : e);
    }
    try {
      await spamRegels(db);
    } catch (e) {
      console.error("spamregels:", e instanceof Error ? e.message : e);
    }
  })();
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(werk);
  else await werk;
  return antwoord({ ok: true });
});

async function verstuurGepland(db: Db) {
  await db.rpc("geplande_mails_opruimen");
  const { data, error } = await db.rpc("geplande_mails_oppakken", { maximaal: PER_RONDE });
  if (error) throw new Error(`Oppakken: ${error.message}`);
  const boxen = new Map<string, { box: Box; wachtwoord: string } | null>();

  for (const id of (data ?? []) as string[]) {
    // Pas nu de inhoud: één mail met bijlagen tegelijk in het geheugen.
    const { data: g, error: leesFout } = await db
      .from("geplande_mails")
      .select("id,mailbox_id,inhoud")
      .eq("id", id)
      .single();
    if (leesFout || !g) {
      console.error(`gepland ${id} lezen:`, leesFout?.message);
      await db.from("geplande_mails").update({ status: "wacht" }).eq("id", id);
      continue;
    }
    if (!boxen.has(g.mailbox_id)) boxen.set(g.mailbox_id, await laadBox(db, g.mailbox_id));
    const mb = boxen.get(g.mailbox_id);
    let status: "verstuurd" | "mislukt" = "mislukt";
    let fout = "";
    if (!mb) {
      fout = "De mailbox is niet (meer) gekoppeld.";
    } else {
      try {
        const res = await verstuur(db, mb.box, mb.wachtwoord, g.inhoud);
        const uit = (await res.json()) as { fout?: string; kopieFout?: string };
        if (res.ok) {
          status = "verstuurd";
          fout = uit.kopieFout ?? "";
        } else if (res.status === 429) {
          // De rem: gewoon over een minuut opnieuw.
          await db.from("geplande_mails").update({ status: "wacht" }).eq("id", g.id);
          continue;
        } else {
          fout = uit.fout ?? "Versturen lukte niet.";
        }
      } catch (e) {
        fout =
          e instanceof MogelijkVerstuurd
            ? e.message
            : uitlegFout(e).tekst;
      }
    }
    const { error: bijFout } = await db
      .from("geplande_mails")
      .update({ status, fout: fout.slice(0, 300), verstuurd_op: status === "verstuurd" ? new Date().toISOString() : null })
      .eq("id", g.id);
    if (bijFout) console.error(`gepland ${g.id}:`, bijFout.message);
  }
}

async function spamRegels(db: Db) {
  const { data: regels, error } = await db.from("mail_regels").select("mailbox_id,van_email").eq("actie", "spam");
  if (error) throw new Error(`Regels: ${error.message}`);
  const perBox = new Map<string, string[]>();
  for (const r of (regels ?? []) as { mailbox_id: string; van_email: string }[]) {
    perBox.set(r.mailbox_id, [...(perBox.get(r.mailbox_id) ?? []), r.van_email]);
  }

  for (const [mailboxId, adressen] of perBox) {
    const { data: postvak } = await db
      .from("mail_mappen")
      .select("id")
      .eq("mailbox_id", mailboxId)
      .eq("rol", "postvak")
      .limit(1)
      .maybeSingle();
    if (!postvak) continue;
    const { data: mails, error: mailFout } = await db
      .from("berichten")
      .select("id")
      .eq("mailbox_id", mailboxId)
      .eq("map_id", postvak.id)
      .eq("op_server", true)
      .eq("richting", "in")
      .is("deleted_at", null)
      .in("van_email", adressen)
      .gte("created_at", new Date(Date.now() - SPAM_TERUG_MS).toISOString())
      .limit(20);
    if (mailFout) throw new Error(`Mail zoeken: ${mailFout.message}`);
    if (!mails?.length) continue;

    const mb = await laadBox(db, mailboxId);
    if (!mb) continue;
    const spam = await mapMetRol(db, mb.box, "spam");
    if (!spam) continue;
    for (const m of mails as { id: string }[]) {
      try {
        await verplaats(db, mb.box, mb.wachtwoord, m.id, { naar: spam.id });
      } catch (e) {
        console.error(`spam ${m.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }
}
