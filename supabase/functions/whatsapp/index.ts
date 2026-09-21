/**
 * Het WhatsApp-nummer van het bedrijf koppelen en beheren, de kant van de app.
 *
 * Twee manieren van koppelen:
 * - Meta's testnummer handmatig (phone_number_id, id van het WhatsApp
 *   Business-account en een toegangstoken). Het token gaat hier één keer
 *   binnen, wordt bij Meta getest en gaat versleuteld de database in; het gaat
 *   nooit terug naar de app.
 * - Het echte nummer via Kapso: `kapso_link` maakt een koppellink waarmee de
 *   eigenaar bij Meta inlogt en zijn nummer uit de WhatsApp Business-app
 *   kiest; `kapso_afronden` zoekt daarna bij Kapso op welk nummer dat werd,
 *   meldt onze webhook aan en slaat de koppeling op. Eén Kapso-sleutel
 *   (KAPSO_API_KEY) voor alle bedrijven; elk bedrijf is een eigen "customer".
 *
 * Koppelen en ontkoppelen: alleen de eigenaar. Een gesprek als gelezen
 * markeren en media alsnog ophalen: wie berichten mag lezen. Antwoorden: wie
 * berichten mag versturen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { ontsleutel, versleutel } from "../_gedeeld/geheim.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";
import { telefoonAlsSleutel } from "../_gedeeld/paaltje.ts";
import { bevestigKlant, draaiKlantgegevensTerug } from "../_gedeeld/klantgegevens-acties.ts";
import {
  annuleerGeplandeAntwoorden,
  datumVoluit,
  graph,
  kapsoPlatform,
  SJABLOON_STATUS,
  sjabloonVoorMeta,
  verstuurSjabloon,
  voorbeeldWaarden,
  vulSjabloonIn,
  type Plaatshouder,
  haalMediaBinnen,
  toegangVan,
  type Toegang,
  VENSTER_MS,
  ververSjablonen,
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
    | "kapso_link"
    | "kapso_afronden"
    | "ontkoppelen"
    | "gelezen"
    | "versturen"
    | "media_ophalen"
    | "antwoord_annuleren"
    | "antwoord_nu"
    | "sjabloon_maken"
    | "sjablonen_verversen"
    | "sjabloon_weg"
    | "sjabloon_voorbeeld"
    | "sjabloon_versturen"
    | "klant_bevestigen"
    | "klantgegevens_terugdraaien";
  titel?: string;
  categorie?: string;
  sjabloon_id?: string;
  waarden?: Record<string, unknown>;
  tekst?: string;
  bericht_id?: string;
  phone_number_id?: string;
  waba_id?: string;
  token?: string;
  telefoon?: string;
  terug_url?: string;
  klant_id?: string;
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
      case "kapso_link":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan WhatsApp koppelen." }, 403);
        return await kapsoLink(db, m, String(verzoek.terug_url ?? ""));
      case "kapso_afronden":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan WhatsApp koppelen." }, 403);
        return await kapsoAfronden(db, m, String(verzoek.phone_number_id ?? ""));
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
      case "sjabloon_maken":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan templates maken." }, 403);
        return await sjabloonMaken(db, m, verzoek);
      case "sjabloon_weg":
        if (m.rol !== "eigenaar") return antwoord({ fout: "Alleen de eigenaar kan templates weggooien." }, 403);
        return await sjabloonWeg(db, m, String(verzoek.sjabloon_id ?? ""));
      case "sjablonen_verversen":
        if (!(await heeftRecht(db, m, "mail_versturen"))) {
          return antwoord({ fout: "Je mag geen berichten versturen." }, 403);
        }
        return await sjablonenVerversen(db, m);
      case "sjabloon_voorbeeld":
      case "sjabloon_versturen":
        if (!(await heeftRecht(db, m, "mail_versturen"))) {
          return antwoord({ fout: "Je mag geen berichten versturen." }, 403);
        }
        return await sjabloonNaarKlant(db, m, verzoek, verzoek.actie === "sjabloon_versturen");
      // Wat Wooshy met klantgegevens uit een appje deed: bevestigen of
      // terugdraaien. Net als bij mail: wie berichten leest én klanten bewerkt.
      case "klant_bevestigen":
      case "klantgegevens_terugdraaien": {
        if (!(await heeftRecht(db, m, "mail_lezen")) || !(await heeftRecht(db, m, "klanten_bewerken"))) {
          return antwoord({ fout: "Je hebt geen recht om klanten te bewerken." }, 403);
        }
        const bereik = { kanaal: "whatsapp" as const, companyId: m.company_id };
        const uit =
          verzoek.actie === "klant_bevestigen"
            ? await bevestigKlant(db, bereik, String(verzoek.bericht_id ?? ""), String(verzoek.klant_id ?? ""))
            : await draaiKlantgegevensTerug(db, bereik, String(verzoek.bericht_id ?? ""));
        return antwoord(uit.body, uit.status);
      }
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
  const toegang: Toegang = { aanbieder: "meta", token };
  const nummer = await graph<{ display_phone_number?: string; verified_name?: string }>(
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
    toegang,
  );
  if (!nummer.ok) {
    return antwoord({ fout: `Meta accepteerde dit niet: ${nummer.fout}` }, 400);
  }

  const bezet = await nummerVanAnder(db, m, phoneNumberId);
  if (bezet) return bezet;

  // Zonder dit abonnement stuurt Meta geen berichten naar onze webhook.
  const abonnement = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, toegang, { method: "POST" });
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
        aanbieder: "meta",
        kapso_webhook_id: "",
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

/**
 * Hoort dit nummer al bij een ander bedrijf, dan niet overnemen (foutantwoord).
 * Was dat bedrijf al ontkoppeld, dan ruimen we die oude koppeling op.
 */
async function nummerVanAnder(db: Db, m: Medewerker, phoneNumberId: string): Promise<Response | null> {
  const { data: bestaand } = await db
    .from("whatsapp_koppelingen")
    .select("id,company_id,status")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (!bestaand || bestaand.company_id === m.company_id) return null;
  if (bestaand.status !== "uit") {
    return antwoord({ fout: "Dit nummer is al gekoppeld aan een ander bedrijf." }, 409);
  }
  const { error: opruimFout } = await db.from("whatsapp_koppelingen").delete().eq("id", bestaand.id);
  if (opruimFout) throw new Error(`Oude koppeling opruimen: ${opruimFout.message}`);
  return null;
}

// ---------------------------------------------------------------------
// Koppelen via Kapso
// ---------------------------------------------------------------------

/** Waar Kapso na het koppelen naar terugstuurt: alleen de eigen app. */
const TOEGESTANE_HOSTS = ["timm-ouip-glazenwassapp.wasapp.workers.dev", "localhost", "127.0.0.1"];

function kapsoSleutel(): string | Response {
  const sleutel = Deno.env.get("KAPSO_API_KEY") ?? "";
  if (!sleutel) return antwoord({ fout: "De Kapso-sleutel staat nog niet op de server (KAPSO_API_KEY)." }, 500);
  return sleutel;
}

/** Het adres van onze webhook voor Kapso. */
function kapsoWebhookUrl(): string {
  return `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/whatsapp-webhook?aanbieder=kapso`;
}

/** De customer van dit bedrijf bij Kapso; maakt hem aan als hij er nog niet is. */
async function kapsoCustomer(db: Db, m: Medewerker, sleutel: string): Promise<string> {
  const { data: bekend, error } = await db
    .from("kapso_klanten")
    .select("customer_id")
    .eq("company_id", m.company_id)
    .maybeSingle();
  if (error) throw new Error(`Kapso-klant ophalen: ${error.message}`);
  if (bekend?.customer_id) return String(bekend.customer_id);

  const { data: bedrijf } = await db.from("companies").select("name").eq("id", m.company_id).maybeSingle();
  const naam = String(bedrijf?.name ?? "").trim().slice(0, 100) || "Wooshy-bedrijf";
  const extern = `wooshy-${m.company_id}`;
  let customerId = "";
  const nieuw = await kapsoPlatform<{ data?: { id?: string } }>("customers", sleutel, {
    method: "POST",
    body: JSON.stringify({ customer: { name: naam, external_customer_id: extern } }),
  });
  if (nieuw.ok) {
    customerId = String(nieuw.data.data?.id ?? "");
  } else {
    // Bestond hij al (een eerdere poging die hier niet werd opgeslagen)? Opzoeken, alle pagina's.
    for (let pagina = 1; pagina <= 50 && !customerId; pagina++) {
      const lijst = await kapsoPlatform<{
        data?: { id?: string; external_customer_id?: string }[];
        meta?: { total_pages?: number };
      }>(`customers?per_page=100&page=${pagina}`, sleutel);
      if (!lijst.ok) break;
      customerId = String(lijst.data.data?.find((c) => c.external_customer_id === extern)?.id ?? "");
      if (pagina >= Number(lijst.data.meta?.total_pages ?? 1)) break;
    }
    if (!customerId) throw new Error(`Kapso-klant aanmaken: ${nieuw.fout}`);
  }
  if (!customerId) throw new Error("Kapso gaf geen klant-id terug.");
  const { error: opslaanFout } = await db
    .from("kapso_klanten")
    .upsert({ company_id: m.company_id, customer_id: customerId }, { onConflict: "company_id" });
  if (opslaanFout) throw new Error(`Kapso-klant opslaan: ${opslaanFout.message}`);
  return customerId;
}

/** Een koppellink van Kapso: daar log je in bij Meta en kies je je nummer. */
async function kapsoLink(db: Db, m: Medewerker, terugUrl: string): Promise<Response> {
  const sleutel = kapsoSleutel();
  if (sleutel instanceof Response) return sleutel;

  let terug: URL;
  try {
    terug = new URL(terugUrl);
  } catch {
    return antwoord({ fout: "Onbekend terugkeeradres." }, 400);
  }
  const lokaal = terug.hostname === "localhost" || terug.hostname === "127.0.0.1";
  if (!TOEGESTANE_HOSTS.includes(terug.hostname) || (!lokaal && terug.protocol !== "https:")) {
    return antwoord({ fout: "Onbekend terugkeeradres." }, 400);
  }
  const klaar = new URL("/instellingen", terug.origin);
  klaar.searchParams.set("tab", "mail");
  klaar.searchParams.set("kapso", "klaar");
  const mislukt = new URL(klaar);
  mislukt.searchParams.set("kapso", "mislukt");

  const customerId = await kapsoCustomer(db, m, sleutel);
  const link = await kapsoPlatform<{ data?: { url?: string; expires_at?: string } }>(
    `customers/${encodeURIComponent(customerId)}/setup_links`,
    sleutel,
    {
      method: "POST",
      body: JSON.stringify({
        setup_link: {
          // Alleen coexistence: het nummer blijft in de WhatsApp Business-app.
          allowed_connection_types: ["coexistence"],
          // Meta schrijft de kosten zelf af bij het bedrijf, niet via Kapso.
          meta_billing_mode: "customer_managed",
          // Geen nieuw (Amerikaans) nummer laten aanmaken.
          provision_phone_number: false,
          success_redirect_url: klaar.toString(),
          failure_redirect_url: mislukt.toString(),
        },
      }),
    },
  );
  if (!link.ok) return antwoord({ fout: `Kapso maakte geen koppellink: ${link.fout}` }, 502);
  const url = String(link.data.data?.url ?? "");
  if (!url.startsWith("https://")) return antwoord({ fout: "Kapso gaf geen bruikbare koppellink terug." }, 502);
  return antwoord({ ok: true, url });
}

interface KapsoNummer {
  phone_number_id?: string;
  business_account_id?: string;
  display_phone_number?: string;
  verified_name?: string;
  is_coexistence?: boolean;
  customer_id?: string | null;
  kind?: string;
}

/**
 * Na de koppellink: bij Kapso nakijken welk nummer bij dit bedrijf hoort (niet
 * blind het nummer uit de terugkeerlink geloven), onze webhook aanmelden en de
 * koppeling opslaan. Kan ook later nog eens, met "Koppeling controleren".
 */
async function kapsoAfronden(db: Db, m: Medewerker, gevraagd: string): Promise<Response> {
  const sleutel = kapsoSleutel();
  if (sleutel instanceof Response) return sleutel;
  const geheim = Deno.env.get("KAPSO_WEBHOOK_SECRET") ?? "";
  if (!geheim) return antwoord({ fout: "Het webhookgeheim voor Kapso staat nog niet op de server." }, 500);
  if (gevraagd && !/^\d{5,30}$/.test(gevraagd)) return antwoord({ fout: "Onbekend nummer." }, 400);

  // Om te testen: één bedrijf (KAPSO_SANDBOX_BEDRIJF) mag Kapso's
  // sandbox-nummer van het project koppelen. Dat nummer hoort bij geen customer.
  const sandboxMag = (Deno.env.get("KAPSO_SANDBOX_BEDRIJF") ?? "") === m.company_id;

  const { data: bekend } = await db.from("kapso_klanten").select("customer_id").eq("company_id", m.company_id).maybeSingle();
  const customerId = String(bekend?.customer_id ?? "");
  if (!customerId && !sandboxMag) return antwoord({ fout: "Begin eerst met koppelen via Kapso." }, 409);

  let nummers: KapsoNummer[] = [];
  if (customerId) {
    const lijst = await kapsoPlatform<{ data?: KapsoNummer[] }>(
      `whatsapp/phone_numbers?customer_id=${encodeURIComponent(customerId)}`,
      sleutel,
    );
    if (!lijst.ok) return antwoord({ fout: `Kapso gaf de nummers niet: ${lijst.fout}` }, 502);
    // Het filter nog eens zelf nakijken: nooit een nummer van een andere customer.
    nummers = (lijst.data.data ?? []).filter((n) => n.customer_id === customerId && n.phone_number_id);
  }
  const sandbox: KapsoNummer[] = [];
  if (sandboxMag) {
    for (let pagina = 1; pagina <= 50; pagina++) {
      const lijst = await kapsoPlatform<{ data?: KapsoNummer[]; meta?: { total_pages?: number } }>(
        `whatsapp/phone_numbers?per_page=100&page=${pagina}`,
        sleutel,
      );
      if (!lijst.ok) return antwoord({ fout: `Kapso gaf de nummers niet: ${lijst.fout}` }, 502);
      sandbox.push(...(lijst.data.data ?? []).filter((n) => n.kind === "sandbox" && !n.customer_id && n.phone_number_id));
      if (pagina >= Number(lijst.data.meta?.total_pages ?? 1)) break;
    }
  }
  // Zonder gevraagd nummer: het eigen nummer gaat voor, anders de sandbox.
  const nummer = gevraagd
    ? [...nummers, ...sandbox].find((n) => n.phone_number_id === gevraagd)
    : (nummers[0] ?? sandbox[0]);
  if (!nummer?.phone_number_id) {
    return antwoord({ fout: "Bij Kapso is nog geen nummer gekoppeld. Maak de koppeling eerst af via de link." }, 409);
  }
  if (!gevraagd && nummers.length > 1) {
    return antwoord({ fout: "Bij Kapso staan meer nummers voor dit bedrijf. Koppel opnieuw via de link." }, 409);
  }
  const phoneNumberId = nummer.phone_number_id;

  const bezet = await nummerVanAnder(db, m, phoneNumberId);
  if (bezet) return bezet;

  // Onze webhook aanmelden. Eerst oude aanmeldingen op ons adres weghalen,
  // anders komt alles dubbel binnen.
  const adres = kapsoWebhookUrl();
  const pad = `whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`;
  const oud = await kapsoPlatform<{ data?: { id?: string; url?: string }[] }>(pad, sleutel);
  if (!oud.ok) return antwoord({ fout: `Kapso gaf de webhooks niet: ${oud.fout}` }, 502);
  for (const w of oud.data.data ?? []) {
    if (w.id && w.url === adres) {
      const weg = await kapsoPlatform(`${pad}/${encodeURIComponent(w.id)}`, sleutel, { method: "DELETE" });
      if (!weg.ok && weg.status !== 404) console.error("kapso oude webhook weghalen:", weg.fout);
    }
  }
  const webhook = await kapsoPlatform<{ data?: { id?: string } }>(pad, sleutel, {
    method: "POST",
    body: JSON.stringify({
      whatsapp_webhook: {
        kind: "kapso",
        url: adres,
        events: [
          "whatsapp.message.received",
          "whatsapp.message.sent",
          "whatsapp.message.delivered",
          "whatsapp.message.read",
          "whatsapp.message.failed",
        ],
        secret_key: geheim,
        active: true,
        payload_version: "v2",
        // Paaltje wacht zelf al even; bundelen hoeft niet.
        buffer_enabled: false,
      },
    }),
  });
  if (!webhook.ok) return antwoord({ fout: `Kapso nam de webhook niet aan: ${webhook.fout}` }, 502);

  const { data: huidig } = await db
    .from("whatsapp_koppelingen")
    .select("phone_number_id,paaltje_vanaf")
    .eq("company_id", m.company_id)
    .maybeSingle();
  const nu = new Date().toISOString();
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .upsert(
      {
        company_id: m.company_id,
        phone_number_id: phoneNumberId,
        waba_id: String(nummer.business_account_id ?? ""),
        weergavenummer: String(nummer.display_phone_number ?? ""),
        soort: nummer.kind === "sandbox" ? "test" : "app",
        aanbieder: "kapso",
        kapso_webhook_id: String(webhook.data.data?.id ?? ""),
        status: "actief",
        fout: "",
        // Hetzelfde nummer opnieuw nakijken: Paaltje begint niet opnieuw.
        paaltje_vanaf: huidig?.phone_number_id === phoneNumberId ? huidig.paaltje_vanaf : nu,
        updated_at: nu,
      },
      { onConflict: "company_id" },
    )
    .select("id")
    .single();
  if (error?.code === "23505") return antwoord({ fout: "Dit nummer is al gekoppeld aan een ander bedrijf." }, 409);
  if (error) throw new Error(`Koppeling opslaan: ${error.message}`);
  // Een oud Meta-token hoort niet meer bij deze koppeling.
  const { error: geheimFout } = await db.from("whatsapp_geheimen").delete().eq("koppeling_id", koppeling.id);
  if (geheimFout) console.error("oud token weghalen:", geheimFout.message);

  return antwoord({
    ok: true,
    weergavenummer: nummer.display_phone_number ?? "",
    naam: nummer.verified_name ?? "",
    coexistence: nummer.is_coexistence === true,
  });
}

async function ontkoppel(db: Db, m: Medewerker): Promise<Response> {
  const { data: koppeling } = await db
    .from("whatsapp_koppelingen")
    .select("id,aanbieder,phone_number_id,kapso_webhook_id")
    .eq("company_id", m.company_id)
    .maybeSingle();
  if (!koppeling) return antwoord({ fout: "Er is geen WhatsApp gekoppeld." }, 404);
  // Via Kapso: onze webhook afmelden, zodat er niets meer binnenkomt. Het
  // nummer zelf blijft bij Kapso staan; dat haal je daar weg.
  const sleutel = Deno.env.get("KAPSO_API_KEY") ?? "";
  if (koppeling.aanbieder === "kapso" && koppeling.kapso_webhook_id && sleutel) {
    const weg = await kapsoPlatform(
      `whatsapp/phone_numbers/${encodeURIComponent(koppeling.phone_number_id)}/webhooks/${encodeURIComponent(koppeling.kapso_webhook_id)}`,
      sleutel,
      { method: "DELETE" },
    );
    if (!weg.ok && weg.status !== 404) console.error("kapso webhook afmelden:", weg.fout);
  }
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
): Promise<{ id: string; phone_number_id: string; toegang: Toegang } | Response> {
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .select("id,phone_number_id,status")
    .eq("company_id", m.company_id)
    .maybeSingle();
  if (error) throw new Error(`Koppeling ophalen: ${error.message}`);
  if (!koppeling || koppeling.status === "uit") return antwoord({ fout: "Er is geen WhatsApp gekoppeld." }, 404);
  const toegang = await toegangVan(db, koppeling.id, ontsleutel);
  if (!toegang) return antwoord({ fout: "De toegang tot WhatsApp ontbreekt. Koppel het nummer opnieuw." }, 409);
  return { id: koppeling.id, phone_number_id: koppeling.phone_number_id, toegang };
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
        fout: "Het laatste bericht van deze klant is meer dan 24 uur oud. WhatsApp staat dan alleen een goedgekeurde template toe.",
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
  const uit = await verstuurTekst(koppeling.toegang, koppeling.phone_number_id, nummer, tekst);
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
  const uit = await haalMediaBinnen(db, koppeling.toegang, m.company_id, bericht.id, media);
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

// ---------------------------------------------------------------------
// Sjablonen
// ---------------------------------------------------------------------

const UUID = /^[0-9a-f-]{36}$/i;

async function koppelingMetAccount(db: Db, m: Medewerker) {
  const k = await actieveKoppeling(db, m);
  if (k instanceof Response) return k;
  const { data, error } = await db.from("whatsapp_koppelingen").select("waba_id").eq("id", k.id).single();
  if (error) throw new Error(`Account ophalen: ${error.message}`);
  if (!data?.waba_id) return antwoord({ fout: "Het WhatsApp-account-ID ontbreekt. Koppel het nummer opnieuw." }, 409);
  return { ...k, waba_id: String(data.waba_id) };
}

async function sjabloonMaken(db: Db, m: Medewerker, verzoek: Verzoek): Promise<Response> {
  const titel = String(verzoek.titel ?? "").trim().slice(0, 60);
  const categorie = verzoek.categorie === "marketing" ? "marketing" : "utility";
  if (!titel) return antwoord({ fout: "Geef de template een naam." }, 400);
  const omgezet = sjabloonVoorMeta(String(verzoek.tekst ?? ""));
  if (!omgezet.ok) return antwoord({ fout: omgezet.fout }, 400);

  const k = await koppelingMetAccount(db, m);
  if (k instanceof Response) return k;

  // De naam bij Meta: uit de titel, met iets unieks erachter (een afgewezen
  // naam kun je bij Meta een tijd niet opnieuw gebruiken).
  const basis = titel
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "sjabloon";
  const metaNaam = `${basis}_${crypto.randomUUID().slice(0, 6)}`;

  const uit = await graph<{ id?: string; status?: string; category?: string }>(`${k.waba_id}/message_templates`, k.toegang, {
    method: "POST",
    body: JSON.stringify({
      name: metaNaam,
      language: "nl",
      category: categorie === "marketing" ? "MARKETING" : "UTILITY",
      components: [
        {
          type: "BODY",
          text: omgezet.body,
          ...(omgezet.variabelen.length > 0
            ? { example: { body_text: [voorbeeldWaarden(omgezet.variabelen)] } }
            : {}),
        },
      ],
    }),
  });
  if (!uit.ok) return antwoord({ fout: `Meta nam het sjabloon niet aan: ${uit.fout}` }, 400);

  const { data, error } = await db
    .from("wa_sjablonen")
    .insert({
      company_id: m.company_id,
      titel,
      meta_naam: metaNaam,
      meta_id: String(uit.data.id ?? ""),
      // Meta kan de categorie meteen aanpassen (utility dat eigenlijk reclame is).
      categorie: String(uit.data.category ?? "").toUpperCase() === "MARKETING" ? "marketing" : categorie,
      tekst: String(verzoek.tekst ?? "").replace(/\r\n/g, "\n").trim(),
      variabelen: omgezet.variabelen,
      status: SJABLOON_STATUS[String(uit.data.status ?? "PENDING").toUpperCase()] ?? "ingediend",
    })
    .select("id,status")
    .single();
  if (error) throw new Error(`Sjabloon bewaren: ${error.message}`);
  return antwoord({ ok: true, id: data.id, status: data.status });
}

async function sjablonenVerversen(db: Db, m: Medewerker): Promise<Response> {
  const k = await koppelingMetAccount(db, m);
  if (k instanceof Response) return k;
  const uit = await ververSjablonen(db, m.company_id, k.toegang, k.waba_id);
  if (!uit.ok) return antwoord({ fout: `Meta gaf de sjablonen niet: ${uit.fout}` }, 502);
  return antwoord({ ok: true, bijgewerkt: uit.data });
}

async function sjabloonWeg(db: Db, m: Medewerker, id: string): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Onbekende template." }, 400);
  const { data: sjabloon } = await db
    .from("wa_sjablonen")
    .select("id,meta_naam")
    .eq("company_id", m.company_id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sjabloon) return antwoord({ fout: "Onbekende template." }, 404);
  // Eerst bij Meta: lukt dat niet, dan blijft hij hier ook staan, anders
  // denk je dat hij weg is terwijl hij bij Meta nog bestaat.
  const k = await koppelingMetAccount(db, m);
  if (k instanceof Response) return k;
  const uit = await graph(`${k.waba_id}/message_templates?name=${encodeURIComponent(sjabloon.meta_naam)}`, k.toegang, {
    method: "DELETE",
  });
  // Bestaat hij bij Meta al niet meer, dan is dat prima.
  if (!uit.ok && uit.status !== 404) {
    return antwoord({ fout: `Meta gooide het sjabloon niet weg: ${uit.fout}` }, 502);
  }
  const { error } = await db
    .from("wa_sjablonen")
    .update({ deleted_at: new Date().toISOString(), status: "uitgeschakeld" })
    .eq("id", sjabloon.id);
  if (error) throw new Error(`Sjabloon weggooien: ${error.message}`);
  return antwoord({ ok: true });
}

/**
 * Een sjabloon naar één klant: `voorbeeld` geeft de ingevulde tekst terug,
 * `versturen` stuurt hem. De waarden vult de server zelf in uit de klant
 * (naam, adres, volgende wasdag); wat je zelf intypt gaat voor.
 */
async function sjabloonNaarKlant(db: Db, m: Medewerker, verzoek: Verzoek, versturen: boolean): Promise<Response> {
  const nummer = waNummer(verzoek.telefoon);
  const id = String(verzoek.sjabloon_id ?? "");
  if (!nummer || !UUID.test(id)) return antwoord({ fout: "Kies een klant en een template." }, 400);

  const { data: sjabloon } = await db
    .from("wa_sjablonen")
    .select("id,meta_naam,categorie,tekst,variabelen,status")
    .eq("company_id", m.company_id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sjabloon) return antwoord({ fout: "Onbekende template." }, 404);
  if (sjabloon.status !== "goedgekeurd") return antwoord({ fout: "Deze template is (nog) niet goedgekeurd door Meta." }, 409);

  // Alleen naar een nummer dat bij een klant hoort.
  const sleutel = telefoonAlsSleutel(nummer);
  const { data: bijNummer, error: nummerFout } = await db
    .from("klant_telefoons")
    .select("klant_id,klanten!inner(deleted_at)")
    .eq("company_id", m.company_id)
    .eq("telefoon", sleutel || "-")
    .is("klanten.deleted_at", null)
    .limit(5);
  if (nummerFout) throw new Error(`Klant zoeken: ${nummerFout.message}`);
  const klantIds = [...new Set<string>((bijNummer ?? []).map((r: { klant_id: string }) => r.klant_id))];
  if (klantIds.length !== 1) return antwoord({ fout: "Dit nummer hoort niet bij (precies één) klant." }, 409);
  const klantId = klantIds[0];
  const { data: klant } = await db
    .from("klanten")
    .select("id,naam,wa_afgemeld_op,wa_marketing_op")
    .eq("company_id", m.company_id)
    .eq("id", klantId)
    .maybeSingle();
  if (!klant) return antwoord({ fout: "Klant niet gevonden." }, 404);
  if (versturen && klant.wa_afgemeld_op) {
    return antwoord({ fout: "Deze klant wil geen WhatsApp-berichten meer." }, 409);
  }
  if (versturen && sjabloon.categorie === "marketing" && !klant.wa_marketing_op) {
    return antwoord({ fout: "Deze klant gaf geen toestemming voor nieuws en acties via WhatsApp." }, 409);
  }

  const standaard = await klantWaarden(db, m.company_id, klant.id, klant.naam);
  const eigen = verzoek.waarden && typeof verzoek.waarden === "object" ? verzoek.waarden : {};
  const waarden: Record<Plaatshouder, string> = { ...standaard };
  for (const sleutel of ["naam", "datum", "adres"] as Plaatshouder[]) {
    const v = eigen[sleutel];
    if (typeof v === "string" && v.trim()) waarden[sleutel] = v.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const variabelen = (sjabloon.variabelen ?? []) as Plaatshouder[];
  const tekst = vulSjabloonIn(sjabloon.tekst, waarden);
  const leeg = [...new Set(variabelen.filter((v) => !waarden[v]))];
  if (!versturen) return antwoord({ ok: true, tekst, waarden, leeg });
  if (leeg.length > 0) return antwoord({ fout: `Vul nog in: ${leeg.join(", ")}.` }, 400);

  // Zelfde rem als bij gewone antwoorden: elk sjabloonbericht kost geld.
  const { count, error: telFout } = await db
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", m.company_id)
    .eq("kanaal", "whatsapp")
    .eq("bron", "wooshy")
    .gte("ontvangen_op", new Date(Date.now() - 60_000).toISOString());
  if (telFout) throw new Error(`Tellen: ${telFout.message}`);
  if ((count ?? 0) >= MAX_PER_MINUUT) {
    return antwoord({ fout: "Even rustig aan: te veel berichten in één minuut." }, 429);
  }

  const k = await actieveKoppeling(db, m);
  if (k instanceof Response) return k;
  const uit = await verstuurSjabloon(k.toegang, k.phone_number_id, nummer, sjabloon.meta_naam, variabelen.map((v) => waarden[v]));
  if (!uit.ok) return antwoord({ fout: `WhatsApp weigerde het bericht: ${uit.fout}` }, 502);

  const nu = new Date().toISOString();
  const { error } = await db.from("berichten").insert({
    company_id: m.company_id,
    kanaal: "whatsapp",
    wa_id: uit.waId,
    wa_telefoon: nummer,
    wa_type: "template",
    wa_status: "verstuurd",
    richting: "uit",
    bron: "wooshy",
    tekst,
    fragment: tekst.replace(/\s+/g, " ").slice(0, 200),
    ontvangen_op: nu,
    gelezen: true,
    op_server: false,
    paaltje_status: "overslaan",
  });
  if (error) console.error("sjabloonbericht opslaan:", error.message);
  return antwoord({ ok: true, bewaard: !error });
}

/** Naam, adres(sen) en de eerstvolgende wasdag van een klant, voor in een sjabloon. */
async function klantWaarden(db: Db, companyId: string, klantId: string, naam: string): Promise<Record<Plaatshouder, string>> {
  const { data: adressen, error } = await db
    .from("customers")
    .select("id,house_number,addition,overslaan,streets(name,volledige_naam)")
    .eq("company_id", companyId)
    .eq("klant_id", klantId)
    .is("deleted_at", null)
    .is("inactief_op", null);
  if (error) throw new Error(`Adressen: ${error.message}`);
  const lijst = (adressen ?? []) as {
    id: string;
    house_number: number;
    addition: string | null;
    overslaan: string[] | null;
    streets: { name: string; volledige_naam: string } | null;
  }[];
  const adres = lijst
    .map((a) => `${a.streets?.volledige_naam || a.streets?.name || ""} ${a.house_number}${a.addition ?? ""}`.trim())
    .join(" en ");

  let datum = "";
  if (lijst.length > 0) {
    const vandaag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
    const { data: dagen, error: dagFout } = await db
      .from("wasdag_regels")
      .select("customer_id,datum")
      .eq("company_id", companyId)
      .in("customer_id", lijst.map((a) => a.id))
      .gte("datum", vandaag)
      .order("datum")
      .limit(50);
    if (dagFout) throw new Error(`Planning: ${dagFout.message}`);
    const overslaan = new Map(lijst.map((a) => [a.id, new Set(a.overslaan ?? [])]));
    const eerst = (dagen ?? []).find(
      (d: { customer_id: string; datum: string }) => !overslaan.get(d.customer_id)?.has(String(d.datum).slice(0, 7)),
    );
    if (eerst) datum = datumVoluit(String(eerst.datum));
  }
  return { naam: naam.trim(), adres, datum };
}
