/**
 * De aankondigingsmail versturen.
 *
 * Eén ingang met twee standen. `tellen` bouwt de ontvangerslijst en geeft die
 * terug zonder iets te versturen; `versturen` doet precies hetzelfde en stuurt
 * daarna. Dat is met opzet dezelfde code: het aantal dat op het scherm staat
 * vlak voor je op versturen klikt, moet het aantal zijn dat er werkelijk uit
 * gaat — niet een telling die er toevallig naast zit.
 *
 * De ontvangerslijst wordt hier gebouwd en niet meegestuurd door de browser.
 * Anders zou wie de aanroep namaakt zelf mogen bepalen naar wie de mail gaat.
 *
 * Wie er mag versturen bepaalt Supabase: de aanroep draagt het token van de
 * ingelogde gebruiker, en daarmee halen we zijn bedrijf op. De service-role-
 * sleutel gebruiken we pas daarna, om te schrijven wat er verstuurd is.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

import {
  antwoord,
  CORS,
  inStukjes,
  perGroepje,
  stuurMail,
  vulIn,
} from "../_gedeeld/mail.ts";

interface Verzoek {
  /**
   * `tellen` bouwt de lijst zonder te versturen, `versturen` doet allebei,
   * `reactie` stuurt één antwoord terug op een binnengekomen bericht,
   * `controle` kijkt alleen of de verbinding met Brevo klopt, en
   * `inbox-koppelen` zet het postvak open zodra de DNS goed staat.
   */
  actie: "tellen" | "versturen" | "reactie" | "controle" | "inbox-koppelen";
  /** De wasdag waarvan de adressen komen, als 'jjjj-mm-dd'. */
  datum: string;
  onderwerp: string;
  tekst: string;
  /** Proef: alleen naar jezelf, met de eerste echte ontvanger als voorbeeld. */
  test?: boolean;
  /** Alleen bij `reactie`: op welk binnengekomen bericht dit het antwoord is. */
  antwoord_id?: string;
}

/** Eén ontvanger: een mens, met alle adressen die hij die dag heeft. */
interface Ontvanger {
  email: string;
  naam: string;
  klant_id: string | null;
  adressen: string[];
}

const MAX_ONDERWERP = 200;
const MAX_TEKST = 20000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const brevo = Deno.env.get("BREVO_API_KEY") ?? "";
  const inboxDomein = Deno.env.get("BREVO_INBOX_DOMEIN") ?? "";

  if (!url || !anon || !service) {
    return antwoord({ fout: "De server is niet goed ingesteld." }, 500);
  }

  // 1. Wie ben je, en bij welk bedrijf hoor je.
  const kop = req.headers.get("Authorization") ?? "";
  if (!kop.startsWith("Bearer ")) return antwoord({ fout: "Niet ingelogd." }, 401);

  const alsGebruiker = createClient(url, anon, {
    global: { headers: { Authorization: kop } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: gebruiker } = await alsGebruiker.auth.getUser();
  if (!gebruiker?.user) return antwoord({ fout: "Niet ingelogd." }, 401);

  // Langs RLS: deze rij mag je alleen zien als je hem bent.
  const { data: medewerker } = await alsGebruiker
    .from("employees")
    .select("id,company_id,naam,email,rol")
    .eq("id", gebruiker.user.id)
    .maybeSingle();
  if (!medewerker) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);

  const beheerder = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: bedrijf } = await beheerder
    .from("companies")
    .select("id,name,mail_afzender_naam,mail_afzender_email,mail_token,mail_inbox_actief")
    .eq("id", medewerker.company_id)
    .maybeSingle();
  if (!bedrijf) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);

  // 2. Wat wil je versturen.
  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  // Alleen kijken of alles klaarstaat. Verstuurt niets en verandert niets.
  if (verzoek.actie === "controle") {
    return await controleer(bedrijf, brevo, inboxDomein);
  }

  // Het postvak openzetten is een instelling van het hele bedrijf, en het
  // maakt een koppeling aan bij Brevo. Dat is iets voor de eigenaar.
  if (verzoek.actie === "inbox-koppelen") {
    if (medewerker.rol !== "eigenaar") {
      return antwoord({ fout: "Alleen de eigenaar kan het postvak koppelen." }, 403);
    }
    return await koppelInbox(beheerder, bedrijf, brevo, inboxDomein, url);
  }

  // Een reactie op een binnengekomen bericht gaat langs dezelfde Brevo-sleutel
  // en dezelfde afzender, maar heeft geen wasdag en geen ontvangerslijst: de
  // ontvanger is degene die schreef.
  if (verzoek.actie === "reactie") {
    return await stuurReactie(beheerder, bedrijf, brevo, inboxDomein, verzoek);
  }

  const datum = String(verzoek.datum ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return antwoord({ fout: "Geen geldige datum." }, 400);
  }
  const onderwerp = String(verzoek.onderwerp ?? "").trim().slice(0, MAX_ONDERWERP);
  const tekst = String(verzoek.tekst ?? "").trim().slice(0, MAX_TEKST);
  const versturen = verzoek.actie === "versturen";
  const test = verzoek.test === true;

  if (versturen && (!onderwerp || !tekst)) {
    return antwoord({ fout: "Vul een onderwerp en een tekst in." }, 400);
  }

  // 3. De ontvangerslijst, uit de dag zelf.
  const ontvangers = await lijstVoorDag(beheerder, bedrijf.id, datum);

  if (!versturen) {
    return antwoord({
      aantal: ontvangers.length,
      zonderEmail: await telZonderEmail(beheerder, bedrijf.id, datum),
      voorbeeld: ontvangers.slice(0, 5).map((o) => ({
        naam: o.naam,
        email: o.email,
        adressen: o.adressen,
      })),
    });
  }

  // 4. Vanaf hier gaat er echt iets de deur uit.
  if (!brevo) {
    return antwoord(
      { fout: "De Brevo-sleutel ontbreekt op de server. Zet BREVO_API_KEY als secret." },
      500,
    );
  }
  const afzenderEmail = (bedrijf.mail_afzender_email ?? "").trim();
  if (!afzenderEmail) {
    return antwoord(
      { fout: "Stel eerst een afzender in bij Instellingen." },
      400,
    );
  }
  const afzender = {
    naam: (bedrijf.mail_afzender_naam ?? "").trim() || bedrijf.name,
    email: afzenderEmail,
  };

  const antwoordNaar = antwoordAdres(bedrijf, inboxDomein);

  // Een proef gaat naar jezelf, maar met de gegevens van de eerste echte
  // ontvanger erin: zo zie je wat er in de plaatshouders terechtkomt.
  const echt = ontvangers;
  const teVersturen: Ontvanger[] = test
    ? [
        {
          email: medewerker.email,
          naam: medewerker.naam || medewerker.email,
          klant_id: null,
          adressen: echt[0]?.adressen ?? ["Voorbeeldstraat 1"],
        },
      ]
    : echt;

  if (teVersturen.length === 0) {
    return antwoord({ fout: "Er staat niemand met een e-mailadres op deze dag." }, 400);
  }

  const { data: mailing, error: mailingFout } = await beheerder
    .from("mailingen")
    .insert({
      company_id: bedrijf.id,
      datum,
      onderwerp,
      tekst,
      test,
      verzonden_door: medewerker.id,
    })
    .select("id")
    .single();
  if (mailingFout || !mailing) {
    return antwoord({ fout: "Kon de verzending niet vastleggen." }, 500);
  }

  const uitslag = await perGroepje(teVersturen, 6, async (o) => {
    const velden = { naam: o.naam || "buurtbewoner", adres: o.adressen.join(" en ") };
    const res = await stuurMail(brevo.trim(), afzender, {
      naar: { email: o.email, naam: o.naam },
      onderwerp: (test ? "[PROEF] " : "") + vulIn(onderwerp, velden),
      tekst: vulIn(tekst, velden),
      antwoordNaar,
    });
    return { o, res };
  });

  const rijen = uitslag.map(({ o, res }) => ({
    company_id: bedrijf.id,
    mailing_id: mailing.id,
    klant_id: o.klant_id,
    email: o.email,
    naam: o.naam,
    adressen: o.adressen.join(", "),
    status: res.ok ? "verzonden" : "mislukt",
    fout: res.ok ? "" : res.fout,
  }));
  for (const stuk of inStukjes(rijen, 200)) {
    await beheerder.from("mail_ontvangers").insert(stuk);
  }

  const mislukt = rijen.filter((r) => r.status === "mislukt").length;
  await beheerder
    .from("mailingen")
    .update({ aantal: rijen.length - mislukt, mislukt })
    .eq("id", mailing.id);

  return antwoord({
    mailing_id: mailing.id,
    verstuurd: rijen.length - mislukt,
    mislukt,
    // Eén voorbeeldfout is genoeg om te snappen wat er mis ging; de rest
    // staat in de tabel.
    eersteFout: rijen.find((r) => r.status === "mislukt")?.fout ?? "",
  });
});

/**
 * Staat alles klaar om te kunnen versturen?
 *
 * Vraagt het aan Brevo zelf en gokt niets: of de sleutel werkt, en of het
 * afzenderadres dat hier is ingevuld daar ook echt als afzender bekend staat.
 * Dat laatste is de fout die je anders pas merkt als de eerste honderd mails
 * geweigerd zijn.
 */
async function controleer(
  bedrijf: Record<string, unknown>,
  brevo: string,
  inboxDomein: string,
): Promise<Response> {
  const afzender = String(bedrijf["mail_afzender_email"] ?? "").trim().toLowerCase();

  const uit: Record<string, unknown> = {
    sleutel: false,
    account: "",
    afzenderIngevuld: afzender,
    afzenderBekend: false,
    afzenderActief: false,
    antwoordadres: antwoordAdres(bedrijf, inboxDomein) ?? "",
    melding: "",
    inbox: await inboxStatus(bedrijf, brevo, inboxDomein),
  };

  if (!brevo) {
    uit["melding"] = "Er staat nog geen Brevo-sleutel op de server.";
    return antwoord(uit);
  }

  // Hoe de sleutel eruitziet, zonder hem prijs te geven. Het begin verraadt
  // welke soort sleutel het is — een API-sleutel begint met `xkeysib-`, een
  // SMTP-sleutel met `xsmtpsib-`, en die laatste werkt hier niet — en de
  // lengte laat zien of er bij het plakken iets is weggevallen. Spaties of
  // een enter aan de rand zijn de derde klassieker.
  uit["sleutelBegin"] = brevo.slice(0, 8);
  uit["sleutelLengte"] = brevo.length;
  uit["sleutelRommel"] = brevo !== brevo.trim();

  try {
    const acc = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
    });
    if (!acc.ok) {
      // Brevo's eigen woorden erbij. "Key not found" betekent iets anders dan
      // "account not activated", en dat verschil bepaalt wat je eraan doet —
      // zonder die tekst sta je te gokken bij dezelfde foutcode.
      let reden = "";
      try {
        const body = (await acc.json()) as { message?: string; code?: string };
        reden = [body.code, body.message].filter(Boolean).join(": ");
      } catch {
        reden = "";
      }
      uit["brevoAntwoord"] = `${acc.status} ${reden}`.trim();
      uit["melding"] =
        acc.status === 401
          ? `Brevo weigert de sleutel${reden ? ` — ${reden}` : ""}.`
          : `Brevo antwoordde met ${acc.status}${reden ? ` — ${reden}` : ""}.`;
      return antwoord(uit);
    }
    const gegevens = (await acc.json()) as {
      companyName?: string;
      email?: string;
    };
    uit["sleutel"] = true;
    uit["account"] = gegevens.companyName || gegevens.email || "";

    // De lijst met adressen waarvandaan dit account mag versturen.
    const lijst = await fetch("https://api.brevo.com/v3/senders", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
    });
    if (lijst.ok) {
      const senders = (await lijst.json()) as {
        senders?: { email?: string; active?: boolean }[];
      };
      const gevonden = (senders.senders ?? []).find(
        (s) => (s.email ?? "").trim().toLowerCase() === afzender,
      );
      uit["afzenderBekend"] = !!gevonden;
      uit["afzenderActief"] = gevonden?.active === true;
      uit["bekendeAfzenders"] = (senders.senders ?? [])
        .map((s) => s.email ?? "")
        .filter(Boolean)
        .slice(0, 10);
    }
  } catch (e) {
    uit["melding"] = e instanceof Error ? e.message : "Onbekende fout.";
  }

  return antwoord(uit);
}

/**
 * Het antwoordadres van een aankondiging — of niets.
 *
 * Alleen als het postvak werkelijk openstaat. Zolang dat niet zo is, zou een
 * klant die op "beantwoorden" drukt zijn mail zien terugkaatsen; dan liever
 * gewoon naar de afzender, zoals bij elke andere mail.
 */
function antwoordAdres(
  bedrijf: Record<string, unknown>,
  inboxDomein: string,
): string | undefined {
  if (!inboxDomein || bedrijf["mail_inbox_actief"] !== true) return undefined;
  return `antwoord+${String(bedrijf["mail_token"] ?? "")}@${inboxDomein}`;
}

/** De mailservers van Brevo voor binnenkomende post. */
const BREVO_INBOUND = ["inbound1.sendinblue.com", "inbound2.sendinblue.com"];

/**
 * Waar de post voor een domein naartoe gaat, gevraagd aan een openbare
 * DNS-dienst. Niet aan de server zelf: die kan een oud antwoord onthouden, en
 * dan zou de knop "nog niet klaar" blijven zeggen terwijl het al goed staat.
 */
async function mailserversVan(domein: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domein)}&type=MX`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (json.Answer ?? [])
      .filter((a) => a.type === 15)
      .map((a) => (a.data.split(" ").pop() ?? "").replace(/\.$/, "").toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

interface BrevoWebhook {
  id: number;
  url?: string;
  domain?: string;
  type?: string;
}

/** De koppelingen voor binnenkomende post die Brevo al kent. */
async function inboundKoppelingen(brevo: string): Promise<BrevoWebhook[] | null> {
  try {
    const res = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { webhooks?: BrevoWebhook[] };
    return json.webhooks ?? [];
  } catch {
    return null;
  }
}

/**
 * Werkt de sleutel van de assistent? Niet alleen "staat hij er", maar gevraagd
 * aan Anthropic zelf — een verlopen of ingetrokken sleutel staat er ook, en
 * dan komen berichten ongelezen binnen zonder dat iemand weet waarom.
 *
 * Het opvragen van een model kost niets: er wordt geen tekst gelezen of
 * geschreven, dus er gaat geen tegoed af.
 */
async function assistentWerkt(): Promise<boolean> {
  const sleutel = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!sleutel) return false;
  try {
    await new Anthropic({ apiKey: sleutel, maxRetries: 0 }).models.retrieve("claude-opus-5");
    return true;
  } catch {
    return false;
  }
}

/**
 * Hoe het postvak ervoor staat, stap voor stap. Elk onderdeel apart, zodat de
 * pagina kan zeggen wélke stap nog ontbreekt in plaats van alleen "werkt niet".
 * Het adres van de koppeling gaat nooit mee naar buiten: daar zit de sleutel
 * van de inbox in.
 */
async function inboxStatus(
  bedrijf: Record<string, unknown>,
  brevo: string,
  inboxDomein: string,
) {
  const servers = inboxDomein ? await mailserversVan(inboxDomein) : [];
  const koppelingen = brevo && inboxDomein ? await inboundKoppelingen(brevo) : null;
  return {
    domein: inboxDomein,
    dnsGoed: servers.some((m) => BREVO_INBOUND.includes(m)),
    dnsGevonden: servers,
    gekoppeld: (koppelingen ?? []).some(
      (w) => (w.domain ?? "").toLowerCase() === inboxDomein.toLowerCase(),
    ),
    assistent: await assistentWerkt(),
    actief: bedrijf["mail_inbox_actief"] === true,
  };
}

/**
 * Het postvak openzetten.
 *
 * In deze volgorde, en elke stap pas als de vorige klopt:
 *  1. Staat de DNS goed? Anders komt er niets binnen, wat we ook koppelen.
 *  2. Kent Brevo de koppeling naar onze inbox al? Zo niet, dan maken we hem;
 *     staat hij er met een oud adres, dan werken we dat bij.
 *  3. Pas dan de vlag aan, en krijgen nieuwe aankondigingen het antwoordadres.
 *
 * Twee keer klikken kan geen kwaad: bestaat de koppeling al, dan blijft het
 * bij die ene.
 */
async function koppelInbox(
  db: ReturnType<typeof createClient>,
  bedrijf: Record<string, unknown>,
  brevo: string,
  inboxDomein: string,
  supabaseUrl: string,
): Promise<Response> {
  const sleutel = (Deno.env.get("MAIL_INBOX_SLEUTEL") ?? "").trim();
  if (!brevo || !inboxDomein || !sleutel) {
    return antwoord({ fout: "De server mist nog een instelling voor het postvak." }, 500);
  }

  const servers = await mailserversVan(inboxDomein);
  if (!servers.some((m) => BREVO_INBOUND.includes(m))) {
    return antwoord(
      {
        fout:
          servers.length === 0
            ? `Voor ${inboxDomein} staat nog geen MX-record. Het kan een paar uur duren voor een nieuwe instelling zichtbaar is.`
            : `${inboxDomein} wijst nog naar ${servers.join(", ")} in plaats van naar Brevo.`,
      },
      409,
    );
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/mail-inbox?sleutel=${sleutel}`;
  const bestaand = await inboundKoppelingen(brevo);
  if (bestaand === null) {
    return antwoord({ fout: "Brevo gaf de lijst met koppelingen niet." }, 502);
  }
  const zelfde = bestaand.find(
    (w) => (w.domain ?? "").toLowerCase() === inboxDomein.toLowerCase(),
  );

  const kop = {
    "api-key": brevo.trim(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (!zelfde) {
    const res = await fetch("https://api.brevo.com/v3/webhooks", {
      method: "POST",
      headers: kop,
      body: JSON.stringify({
        type: "inbound",
        events: ["inboundEmailProcessed"],
        url: webhookUrl,
        domain: inboxDomein,
        description: "Wooshy — antwoorden op aankondigingen",
      }),
    });
    if (!res.ok) {
      return antwoord({ fout: `Brevo weigerde de koppeling: ${(await res.text()).slice(0, 300)}` }, 502);
    }
  } else if (zelfde.url !== webhookUrl) {
    const res = await fetch(`https://api.brevo.com/v3/webhooks/${zelfde.id}`, {
      method: "PUT",
      headers: kop,
      body: JSON.stringify({ url: webhookUrl }),
    });
    if (!res.ok) {
      return antwoord({ fout: `Brevo weigerde het bijwerken: ${(await res.text()).slice(0, 300)}` }, 502);
    }
  }

  await db
    .from("companies")
    .update({ mail_inbox_actief: true })
    .eq("id", bedrijf["id"] as string);

  return antwoord({ ok: true, adres: `antwoord+${String(bedrijf["mail_token"] ?? "")}@${inboxDomein}` });
}

/**
 * Eén antwoord terug op een bericht uit het postvak. De tekst komt uit het
 * scherm en niet uit de database: wat de assistent klaarzette mag je eerst
 * bijschaven, en wat je verstuurt is wat je zag staan.
 */
async function stuurReactie(
  db: ReturnType<typeof createClient>,
  bedrijf: Record<string, unknown>,
  brevo: string,
  inboxDomein: string,
  verzoek: Verzoek,
): Promise<Response> {
  if (!brevo) return antwoord({ fout: "De Brevo-sleutel ontbreekt op de server." }, 500);

  const id = String(verzoek.antwoord_id ?? "");
  const tekst = String(verzoek.tekst ?? "").trim().slice(0, MAX_TEKST);
  if (!id || !tekst) return antwoord({ fout: "Geen bericht of geen tekst." }, 400);

  const afzenderEmail = String(bedrijf["mail_afzender_email"] ?? "").trim();
  if (!afzenderEmail) return antwoord({ fout: "Stel eerst een afzender in." }, 400);

  const { data: bericht } = await db
    .from("mail_antwoorden")
    .select("id,van_email,van_naam,onderwerp")
    .eq("company_id", bedrijf["id"] as string)
    .eq("id", id)
    .maybeSingle();
  if (!bericht) return antwoord({ fout: "Dat bericht bestaat niet." }, 404);

  const onderwerp = String(verzoek.onderwerp ?? "").trim() ||
    ("Re: " + String(bericht["onderwerp"] ?? "")).trim();

  const res = await stuurMail(
    brevo.trim(),
    {
      naam: String(bedrijf["mail_afzender_naam"] ?? "") || String(bedrijf["name"] ?? ""),
      email: afzenderEmail,
    },
    {
      naar: {
        email: String(bericht["van_email"] ?? ""),
        naam: String(bericht["van_naam"] ?? ""),
      },
      onderwerp: onderwerp.slice(0, MAX_ONDERWERP),
      tekst,
      antwoordNaar: antwoordAdres(bedrijf, inboxDomein),
    },
  );
  if (!res.ok) return antwoord({ fout: res.fout }, 502);

  await db
    .from("mail_antwoorden")
    .update({ beantwoord_op: new Date().toISOString(), status: "klaar", concept: tekst })
    .eq("id", id);

  return antwoord({ ok: true });
}

/**
 * De mensen achter de adressen van één dag, één regel per e-mailadres.
 *
 * Van de dag naar de adressen, van de adressen naar de klanten. Een klant met
 * twee panden op dezelfde dag krijgt één mail met beide adressen erin — twee
 * losse mailtjes over dezelfde ochtend leest als een storing.
 */
async function lijstVoorDag(
  db: ReturnType<typeof createClient>,
  companyId: string,
  datum: string,
): Promise<Ontvanger[]> {
  const { data: regels } = await db
    .from("wasdag_regels")
    .select("customer_id")
    .eq("company_id", companyId)
    .eq("datum", datum);

  const ids = (regels ?? [])
    .map((r) => r["customer_id"] as string | null)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  const adressen: {
    klant_id: string | null;
    huis: number;
    toevoeging: string;
    street_id: string;
  }[] = [];
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("customers")
      .select("id,klant_id,house_number,addition,street_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const c of data ?? []) {
      adressen.push({
        klant_id: c["klant_id"] as string | null,
        huis: c["house_number"] as number,
        toevoeging: (c["addition"] as string) ?? "",
        street_id: c["street_id"] as string,
      });
    }
  }

  const klantIds = [...new Set(adressen.map((a) => a.klant_id).filter((x): x is string => !!x))];
  if (klantIds.length === 0) return [];

  // De straatnamen erbij. `volledige_naam` als die er is: op de lijst staat
  // "Ameland", maar in een mail hoort "Amelandstraat".
  const straatIds = [...new Set(adressen.map((a) => a.street_id))];
  const straatNaam = new Map<string, string>();
  for (const stuk of inStukjes(straatIds)) {
    const { data } = await db
      .from("streets")
      .select("id,name,volledige_naam")
      .eq("company_id", companyId)
      .in("id", stuk);
    for (const s of data ?? []) {
      const vol = ((s["volledige_naam"] as string) ?? "").trim();
      straatNaam.set(s["id"] as string, vol || ((s["name"] as string) ?? ""));
    }
  }

  const klanten = new Map<string, { naam: string; email: string }>();
  for (const stuk of inStukjes(klantIds)) {
    const { data } = await db
      .from("klanten")
      .select("id,naam,email")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const k of data ?? []) {
      const email = ((k["email"] as string) ?? "").trim();
      if (email) klanten.set(k["id"] as string, { naam: (k["naam"] as string) ?? "", email });
    }
  }

  // Op e-mailadres en niet op klant-id: twee klantkaarten met hetzelfde adres
  // erachter is één mens met één postvak.
  const perEmail = new Map<string, Ontvanger>();
  for (const a of adressen) {
    if (!a.klant_id) continue;
    const klant = klanten.get(a.klant_id);
    if (!klant) continue;
    const sleutel = klant.email.toLowerCase();
    const straat = straatNaam.get(a.street_id) ?? "";
    const adres = `${straat} ${a.huis}${a.toevoeging}`.trim();
    const bestaand = perEmail.get(sleutel);
    if (bestaand) {
      if (!bestaand.adressen.includes(adres)) bestaand.adressen.push(adres);
    } else {
      perEmail.set(sleutel, {
        email: klant.email,
        naam: klant.naam,
        klant_id: a.klant_id,
        adressen: [adres],
      });
    }
  }

  return [...perEmail.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
}

/**
 * Hoeveel adressen van die dag we níet kunnen mailen. Dat getal hoort naast
 * het aantal ontvangers te staan: "42 mensen, 18 adressen zonder e-mailadres"
 * vertelt je meteen of de aankondiging genoeg dekking heeft.
 */
async function telZonderEmail(
  db: ReturnType<typeof createClient>,
  companyId: string,
  datum: string,
): Promise<number> {
  const { data: regels } = await db
    .from("wasdag_regels")
    .select("customer_id")
    .eq("company_id", companyId)
    .eq("datum", datum);
  const ids = (regels ?? [])
    .map((r) => r["customer_id"] as string | null)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return 0;

  let zonder = 0;
  const metEmail = new Set<string>();
  const klantVan: (string | null)[] = [];
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("customers")
      .select("klant_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const c of data ?? []) klantVan.push(c["klant_id"] as string | null);
  }
  const klantIds = [...new Set(klantVan.filter((x): x is string => !!x))];
  for (const stuk of inStukjes(klantIds)) {
    const { data } = await db
      .from("klanten")
      .select("id,email")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const k of data ?? []) {
      if ((((k["email"] as string) ?? "").trim())) metEmail.add(k["id"] as string);
    }
  }
  for (const id of klantVan) {
    if (!id || !metEmail.has(id)) zonder += 1;
  }
  return zonder;
}
