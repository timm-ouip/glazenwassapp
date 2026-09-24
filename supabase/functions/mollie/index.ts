/**
 * De Mollie-sleutel koppelen, nakijken of loskoppelen.
 *
 * De sleutel gaat versleuteld de database in (`mollie_geheimen`, geen enkele
 * policy, alleen de server komt erbij) en komt er nooit meer uit naar de
 * browser. Wat je op het scherm ziet is alleen óf er gekoppeld is en of het
 * de test- of de echte sleutel is.
 *
 * Alleen de eigenaar: dit is geld, en het hangt aan het bedrijf.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { versleutel } from "../_gedeeld/geheim.ts";
import { mollieWerkt } from "../_gedeeld/mollie.ts";

interface Verzoek {
  actie: "koppelen" | "ontkoppelen" | "nakijken";
  sleutel?: string;
}

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
  const bedrijfId = String(medewerker.company_id);
  const isEigenaar = medewerker.rol === "eigenaar";

  const beheerder = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  // Wie facturen mag versturen, mag ook zien óf er gekoppeld is -- anders
  // kijkt een medewerker naar een leeg invulvak alsof er niets staat.
  // Koppelen en loskoppelen blijven voor de eigenaar: het hangt aan het
  // bedrijf, en alleen hij komt bij de bedrijfsgegevens.
  if (verzoek.actie !== "nakijken" && !isEigenaar) {
    return antwoord({ fout: "Alleen de eigenaar kan Mollie koppelen." }, 403);
  }

  if (verzoek.actie === "ontkoppelen") {
    await beheerder.from("mollie_geheimen").delete().eq("company_id", bedrijfId);
    const { error } = await beheerder
      .from("companies")
      .update({ mollie_modus: null })
      .eq("id", bedrijfId);
    if (error) return antwoord({ fout: error.message }, 500);
    // De links die al bij klanten liggen blijven het gewoon doen; ze worden
    // alleen niet meer nagekeken. Ze hier weghalen zou een klant met een
    // openstaande factuur voor een dichte deur zetten.
    return antwoord({ modus: null });
  }

  if (verzoek.actie === "nakijken") {
    const { data: mag } = await alsGebruiker.rpc("heeft_recht", { recht: "facturen" });
    if (mag !== true) return antwoord({ fout: "Je mag geen facturen bekijken." }, 403);
    const { data: bedrijf } = await beheerder
      .from("companies")
      .select("mollie_modus")
      .eq("id", bedrijfId)
      .maybeSingle();
    return antwoord({ modus: bedrijf?.mollie_modus ?? null });
  }

  if (verzoek.actie !== "koppelen") {
    return antwoord({ fout: "Onbekende opdracht." }, 400);
  }

  const sleutel = String(verzoek.sleutel ?? "").trim();
  // Mollie geeft de sleutels uit als test_… en live_…; aan die twee woorden
  // zie je meteen of je met echt geld bezig bent.
  const modus = sleutel.startsWith("test_") ? "test" : sleutel.startsWith("live_") ? "live" : "";
  if (!modus) {
    return antwoord(
      { fout: "Dat lijkt geen Mollie-sleutel. Hij begint met test_ of met live_." },
      400,
    );
  }

  // Eerst uitproberen, dan pas bewaren: een sleutel die het niet doet, moet
  // je hier horen en niet pas als de eerste factuur de deur uit gaat.
  try {
    await mollieWerkt(sleutel);
  } catch (e) {
    return antwoord(
      { fout: `Mollie herkent deze sleutel niet: ${e instanceof Error ? e.message : e}` },
      400,
    );
  }

  const geheim = await versleutel(sleutel);
  const { error: geheimFout } = await beheerder.from("mollie_geheimen").upsert(
    {
      company_id: bedrijfId,
      versleuteld: geheim.versleuteld,
      iv: geheim.iv,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (geheimFout) return antwoord({ fout: geheimFout.message }, 500);

  const { error } = await beheerder
    .from("companies")
    .update({ mollie_modus: modus })
    .eq("id", bedrijfId);
  if (error) return antwoord({ fout: error.message }, 500);

  return antwoord({ modus });
});
