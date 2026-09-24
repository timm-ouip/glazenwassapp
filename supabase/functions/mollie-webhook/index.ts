/**
 * Hier meldt Mollie dat er iets met een betaling gebeurd is.
 *
 * Het uitgangspunt: **we geloven niets van wat er binnenkomt.** De melding
 * zegt alleen "kijk eens naar factuur X"; wát er betaald is halen we daarna
 * zelf bij Mollie op, met de sleutel van dat bedrijf. Een melding kan een
 * factuur dus nooit op betaald zetten -- alleen op het bedrag dat er bij
 * Mollie echt tegenover staat.
 *
 * De factuur staat als `?factuur=<id>` in de meldings-URL die we bij het
 * aanmaken van de betaallink aan Mollie meegeven, met een kort kenmerk erbij.
 * Dat moet zo: een betaallink kan geen eigen gegevens meekrijgen (de Payment
 * Links API kent geen `metadata`), en de melding zelf noemt alleen een
 * betaling. Het kenmerk is geen tweede slot op de waarheid maar een rem: zonder
 * kenmerk zou iedereen die ooit een factuur-id ziet onbeperkt navraag bij
 * Mollie kunnen uitlokken.
 *
 * Over het antwoord: 200 betekent voor Mollie "aangekomen, niet meer
 * proberen". Dat mogen we alleen zeggen als de melding niet van ons is. Gaat
 * het aan ónze kant mis -- Mollie onbereikbaar, de sleutel weg, de database
 * die klapt -- dan hoort er een foutcode terug, anders staat er een betaalde
 * factuur open en krijgt de klant straks een herinnering voor geld dat hij al
 * betaald heeft.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { betaaldViaLink, kenmerkKlopt, meldingKenmerk, mollieSleutel } from "../_gedeeld/mollie.ts";

/** Aangekomen, en er valt niets te doen. Mollie hoeft niet terug te komen. */
const KLAAR = new Response("ok", { status: 200 });
/** Aan onze kant misgegaan; Mollie probeert het vanzelf opnieuw. */
const NOGMAALS = new Response("later", { status: 503 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return KLAAR;

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) {
    console.error("mollie-webhook: de server is niet goed ingesteld.");
    return NOGMAALS;
  }

  const zoek = new URL(req.url).searchParams;
  const factuurId = zoek.get("factuur") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(factuurId)) return KLAAR;

  const verwacht = await meldingKenmerk(factuurId);
  if (!verwacht) {
    // Zonder MAIL_SLEUTEL kunnen we het kenmerk niet narekenen. Dan liever
    // later opnieuw dan een melding die we niet kunnen thuisbrengen weggooien.
    console.error("mollie-webhook: MAIL_SLEUTEL ontbreekt, kenmerk niet na te rekenen.");
    return NOGMAALS;
  }
  if (!kenmerkKlopt(verwacht, zoek.get("kenmerk") ?? "")) return KLAAR;

  const beheerder = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: factuur, error: zoekFout } = await beheerder
    .from("facturen")
    .select("id,company_id,nummer,mollie_id")
    .eq("id", factuurId)
    .maybeSingle();
  if (zoekFout) {
    console.error("mollie-webhook: factuur niet op te zoeken:", zoekFout.message);
    return NOGMAALS;
  }
  // Onbekend, nog een concept of zonder betaallink: dan hoort deze melding
  // niet bij ons en heeft opnieuw proberen geen zin.
  if (!factuur || !factuur.nummer || !factuur.mollie_id) return KLAAR;

  try {
    const sleutel = await mollieSleutel(beheerder, String(factuur.company_id));
    if (!sleutel) throw new Error("geen bruikbare Mollie-sleutel meer");
    const { bedrag, op } = await betaaldViaLink(sleutel, String(factuur.mollie_id));
    const { error } = await beheerder.rpc("factuur_mollie_betaald", {
      factuur: factuur.id,
      bij_mollie: bedrag,
      op,
    });
    if (error) throw new Error(error.message);
    console.log(`mollie-webhook: factuur ${factuur.nummer} staat op ${bedrag} via Mollie.`);
    return KLAAR;
  } catch (e) {
    console.error(`mollie-webhook (${factuur.nummer}):`, e instanceof Error ? e.message : e);
    return NOGMAALS;
  }
});
