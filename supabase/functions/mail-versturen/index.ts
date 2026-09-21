/**
 * De aankondiging versturen, per mail en/of per WhatsApp.
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

import {
  antwoord,
  CORS,
  inStukjes,
  perGroepje,
  stuurMail,
  vulIn,
} from "../_gedeeld/mail.ts";
import { draaiTerug } from "../_gedeeld/doorvoeren.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import {
  datumVoluit,
  mobielAlsWa,
  toegangVan,
  type Toegang,
  verstuurSjabloon,
  vulSjabloonIn,
} from "../_gedeeld/whatsapp.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";

interface Verzoek {
  /** Proefmail naar dit adres in plaats van naar jezelf. */
  proef_naar?: string;
  /**
   * `tellen` bouwt de lijst zonder te versturen, `versturen` doet allebei,
   * `controle` kijkt alleen of de verbinding met Brevo klopt, en
   * `terugdraaien` haalt een aanpassing uit het rapport weer weg.
   */
  actie: "tellen" | "versturen" | "controle" | "terugdraaien" | "wijziging_tellen" | "wijziging";
  /** De wasdag waarvan de adressen komen, als 'jjjj-mm-dd'. */
  datum: string;
  onderwerp: string;
  tekst: string;
  /** Proef: alleen naar jezelf, met de eerste echte ontvanger als voorbeeld. */
  test?: boolean;
  /** Toch versturen, ook al ging deze dag het afgelopen uur al de deur uit. */
  toch?: boolean;
  /** Bij `terugdraaien`: welke regel uit het rapport. */
  wijziging_id?: string;
  /** Waarlangs: mail, WhatsApp, allebei, of zoals bij elke klant ingesteld. */
  kanaal?: Kanaal;
  /** Het WhatsApp-sjabloon voor de appjes. */
  sjabloon_id?: string;
  /** Proef via WhatsApp naar dit nummer. */
  proef_telefoon?: string;
  /** Het beloofde tijdvak per adres: { "<customer-id>": { van, tot } }. */
  tijdvakken?: Record<string, { van?: string; tot?: string }>;
  /** Bij een wijziging: welke adressen het betreft. */
  customer_ids?: string[];
  /** "wijziging" of "niet_af". */
  soort?: string;
  /** Waarom de planning verandert ("Door de regen"). */
  reden?: string;
}

/** Een tijdvak zoals het in het bericht komt. */
interface Tijdvak {
  van: string;
  tot: string;
}

const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;

/** De tijdvakken uit het verzoek, alleen wat er als tijd uitziet. */
function leesTijdvakken(rauw: unknown): Map<string, Tijdvak> {
  const uit = new Map<string, Tijdvak>();
  if (!rauw || typeof rauw !== "object") return uit;
  for (const [id, waarde] of Object.entries(rauw as Record<string, unknown>)) {
    if (!UUID_RE.test(id) || !waarde || typeof waarde !== "object") continue;
    const van = String((waarde as Record<string, unknown>)["van"] ?? "");
    const tot = String((waarde as Record<string, unknown>)["tot"] ?? "");
    if (TIJD.test(van) && TIJD.test(tot)) uit.set(id, { van, tot });
  }
  return uit;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De zin die onder de tekst komt als een klant een tijdvak beloofd krijgt. */
function tijdvakZin(tijdvak: Tijdvak | undefined, adres: string): string {
  if (!tijdvak) return "";
  return `Voor ${adres} komen we tussen ${tijdvak.van} en ${tijdvak.tot}.`;
}

type Kanaal = "mail" | "whatsapp" | "beide" | "voorkeur";

interface WaOntvanger {
  wa: string;
  naam: string;
  klant_id: string | null;
  adressen: string[];
  customer_ids: string[];
  oudeDatum?: string;
  nieuweDatum?: string;
}

interface Sjabloon {
  id: string;
  titel: string;
  meta_naam: string;
  categorie: "utility" | "marketing";
  tekst: string;
  variabelen: string[];
  status: string;
}

/** Eén ontvanger: een mens, met alle adressen die hij die dag heeft. */
interface Ontvanger {
  email: string;
  naam: string;
  klant_id: string | null;
  adressen: string[];
  customer_ids: string[];
  oudeDatum?: string;
  nieuweDatum?: string;
}

const MAX_ONDERWERP = 200;
const MAX_TEKST = 20000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const brevo = Deno.env.get("BREVO_API_KEY") ?? "";

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
    .select("id,name,mail_afzender_naam,mail_afzender_email")
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

  // Tellen, versturen en de controle van de verbinding: het recht om mail te
  // versturen. Terugdraaien blijft hieronder bij de eigenaar.
  if (
    ["tellen", "versturen", "controle", "wijziging_tellen", "wijziging"].includes(
      String(verzoek.actie),
    ) &&
    !(await heeftRecht(beheerder, medewerker, "mail_versturen"))
  ) {
    return antwoord({ fout: "Je hebt geen recht om mail te versturen." }, 403);
  }

  // Alleen kijken of alles klaarstaat. Verstuurt niets en verandert niets.
  if (verzoek.actie === "controle") {
    return await controleer(bedrijf, brevo, await mailboxAdresVan(beheerder, bedrijf.id));
  }

  // Terugdraaien verandert de planning en komt in het rapport, en dat rapport
  // ziet alleen de eigenaar. Dan mag ook alleen de eigenaar dit.
  if (verzoek.actie === "terugdraaien") {
    if (medewerker.rol !== "eigenaar") {
      return antwoord({ fout: "Alleen de eigenaar kan dit terugdraaien." }, 403);
    }
    const uit = await draaiTerug(
      beheerder,
      bedrijf.id,
      String(verzoek.wijziging_id ?? ""),
      medewerker.id,
    );
    return uit.ok ? antwoord({ ok: true }) : antwoord({ fout: uit.fout }, 400);
  }

  // "De planning is veranderd": naar de klanten van een paar adressen, met de
  // oude en de nieuwe dag erin.
  if (verzoek.actie === "wijziging_tellen" || verzoek.actie === "wijziging") {
    return await wijzigingsbericht(beheerder, bedrijf, medewerker, verzoek, brevo);
  }

  if (verzoek.actie !== "tellen" && verzoek.actie !== "versturen") {
    return antwoord({ fout: "Onbekende actie." }, 400);
  }

  const datum = String(verzoek.datum ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return antwoord({ fout: "Geen geldige datum." }, 400);
  }
  const onderwerp = String(verzoek.onderwerp ?? "").trim().slice(0, MAX_ONDERWERP);
  const tekst = String(verzoek.tekst ?? "").trim().slice(0, MAX_TEKST);
  const versturen = verzoek.actie === "versturen";
  const test = verzoek.test === true;
  const kanaal: Kanaal = ["mail", "whatsapp", "beide", "voorkeur"].includes(String(verzoek.kanaal))
    ? (verzoek.kanaal as Kanaal)
    : "mail";

  // Het WhatsApp-sjabloon, als er appjes bij kunnen zitten. Een reclame-
  // sjabloon gaat alleen naar wie daar apart ja op zei.
  let sjabloon: Sjabloon | null = null;
  if (kanaal !== "mail" && verzoek.sjabloon_id) {
    const { data } = await beheerder
      .from("wa_sjablonen")
      .select("id,titel,meta_naam,categorie,tekst,variabelen,status")
      .eq("company_id", bedrijf.id)
      .eq("id", String(verzoek.sjabloon_id))
      .is("deleted_at", null)
      .maybeSingle();
    sjabloon = (data as Sjabloon | null) ?? null;
  }

  // 3. De ontvangers, uit de dag zelf, per kanaal.
  const klanten = await klantenVoorDag(beheerder, bedrijf.id, datum);
  const verdeling = verdeel(klanten, kanaal, sjabloon?.categorie === "marketing");
  const ontvangers = verdeling.mail;

  if (!versturen) {
    const dekking = await telDekking(beheerder, bedrijf.id, datum);
    return antwoord({
      aantal: ontvangers.length,
      aantalWhatsApp: verdeling.whatsapp.length,
      zonderWhatsApp: verdeling.zonderWhatsApp,
      zonderEmail: dekking.zonderEmail,
      overgeslagen: dekking.overgeslagen,
      voorbeeld: ontvangers.slice(0, 5).map((o) => ({
        naam: o.naam,
        email: o.email,
        adressen: o.adressen,
      })),
      voorbeeldWhatsApp: verdeling.whatsapp.slice(0, 5).map((o) => ({
        naam: o.naam,
        telefoon: o.wa,
        adressen: o.adressen,
      })),
    });
  }

  // Een proef gaat naar jezelf (mail) en/of naar het proefnummer (WhatsApp).
  // Een WhatsApp-proef alleen naar een 06-nummer, en alleen met een sjabloon:
  // zonder sjabloon is er geen appje om te proberen, en dan gaat alleen de
  // proefmail.
  const proefTelefoon = test ? mobielAlsWa(String(verzoek.proef_telefoon ?? "")) : "";
  const metMail = test ? kanaal !== "whatsapp" : ontvangers.length > 0;
  const metWhatsApp = test
    ? kanaal !== "mail" && !!proefTelefoon && !!sjabloon
    : verdeling.whatsapp.length > 0;

  if (!metMail && !metWhatsApp) {
    return antwoord(
      {
        fout: test
          ? "Kies een template en vul een 06-nummer in om de WhatsApp-proef te versturen."
          : "Er staat niemand op deze dag die een bericht kan krijgen.",
      },
      400,
    );
  }
  if (metMail && (!onderwerp || !tekst)) {
    return antwoord({ fout: "Vul een onderwerp en een tekst in." }, 400);
  }
  if (metWhatsApp && (!sjabloon || sjabloon.status !== "goedgekeurd")) {
    return antwoord({ fout: "Kies een WhatsApp-template die door Meta is goedgekeurd." }, 400);
  }

  // Mag dit bedrijf vanaf zijn afzender mailen? Eerst dat, dan pas versturen.
  if (metMail) {
    const vooraf = await afzenderFout(beheerder, bedrijf.id, brevo, String(bedrijf.mail_afzender_email ?? ""));
    if (vooraf) return antwoord({ fout: vooraf }, 400);
  }

  // En WhatsApp: gekoppeld, met token.
  let wa: { phoneNumberId: string; toegang: Toegang } | null = null;
  if (metWhatsApp) {
    const { data: koppeling } = await beheerder
      .from("whatsapp_koppelingen")
      .select("id,phone_number_id,status")
      .eq("company_id", bedrijf.id)
      .maybeSingle();
    const toegang = koppeling && koppeling.status !== "uit" ? await toegangVan(beheerder, koppeling.id, ontsleutel) : null;
    if (!koppeling || !toegang) {
      return antwoord({ fout: "WhatsApp is niet (meer) gekoppeld. Koppel het nummer opnieuw bij Instellingen." }, 400);
    }
    wa = { phoneNumberId: koppeling.phone_number_id, toegang };
  }

  // 4. Vanaf hier gaat er echt iets de deur uit.
  if (metMail && !brevo) {
    return antwoord(
      { fout: "De Brevo-sleutel ontbreekt op de server. Zet BREVO_API_KEY als secret." },
      500,
    );
  }
  const afzenderEmail = (bedrijf.mail_afzender_email ?? "").trim();
  if (metMail && !afzenderEmail) {
    return antwoord(
      { fout: "Stel eerst een afzender in bij Instellingen." },
      400,
    );
  }
  const afzender = {
    naam: (bedrijf.mail_afzender_naam ?? "").trim() || bedrijf.name,
    email: afzenderEmail,
  };

  const mailboxAdres = metMail ? await mailboxAdresVan(beheerder, bedrijf.id) : "";
  const antwoordNaar = antwoordAdres(mailboxAdres);

  // Een proef gaat naar jezelf, maar met de gegevens van de eerste echte
  // ontvanger erin: zo zie je wat er in de plaatshouders terechtkomt.
  const echt = ontvangers;
  const echtWa = verdeling.whatsapp;

  // Een proef mag ook naar een ander adres, bijvoorbeeld een Hotmail-adres om
  // te zien wat klanten zien. Eén adres, en hooguit 10 proeven per uur per
  // bedrijf (zie proefmail_vastleggen hieronder): anders is dit een manier om
  // los mail te versturen.
  let proefAdres = String(medewerker.email ?? "");
  if (test) {
    const gekozen = String(verzoek.proef_naar ?? "").trim().toLowerCase();
    if (gekozen) {
      if (gekozen.length > 254 || !/^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(gekozen)) {
        return antwoord({ fout: "Dat proefadres klopt niet." }, 400);
      }
      proefAdres = gekozen;
    }
  }

  const voorbeeldKlant = echt[0] ?? echtWa[0];
  const teVersturen: Ontvanger[] = !metMail
    ? []
    : test
      ? [
          {
            email: proefAdres,
            // De naam van de eerste echte ontvanger, zodat {{naam}} er in de
            // proef uitziet zoals bij een klant.
            naam: voorbeeldKlant?.naam || medewerker.naam || proefAdres,
            klant_id: null,
            adressen: voorbeeldKlant?.adressen ?? ["Voorbeeldstraat 1"],
            customer_ids: [],
          },
        ]
      : echt;
  const appjes: WaOntvanger[] = !metWhatsApp
    ? []
    : test
      ? [
          {
            wa: proefTelefoon,
            naam: voorbeeldKlant?.naam || medewerker.naam || "Klant",
            klant_id: null,
            adressen: voorbeeldKlant?.adressen ?? ["Voorbeeldstraat 1"],
            customer_ids: [],
          },
        ]
      : echtWa;

  const vastOnderwerp = onderwerp || `WhatsApp: ${sjabloon?.titel ?? "aankondiging"}`;
  const vastTekst = tekst || sjabloon?.tekst || "";

  let mailing: { id: string };
  if (test) {
    // Tellen en vastleggen in één stap, met een slot per bedrijf: tien
    // verzoeken tegelijk komen zo niet allemaal langs de telling.
    const { data: plek, error: plekFout } = await beheerder.rpc("proefmail_vastleggen", {
      bedrijf: bedrijf.id,
      dag: datum,
      onderwerp: vastOnderwerp,
      tekst: vastTekst,
      door: medewerker.id,
    });
    if (plekFout) return antwoord({ fout: "Kon de proef niet vastleggen." }, 500);
    if (!plek) {
      return antwoord({ fout: "Je hebt het afgelopen uur al 10 proeven verstuurd. Probeer het straks nog eens." }, 429);
    }
    mailing = { id: String(plek) };
    const { error: kanaalFout } = await beheerder
      .from("mailingen")
      .update({ kanaal, sjabloon_id: sjabloon?.id ?? null })
      .eq("id", mailing.id);
    if (kanaalFout) console.error("proef kanaal vastleggen:", kanaalFout.message);
  } else {
    // Dezelfde dag het afgelopen uur al echt verstuurd? Dan is dit bijna
    // altijd een tweede druk op de knop, bijvoorbeeld omdat het antwoord van
    // de eerste bij slecht bereik niet aankwam. Iedereen zou alles dubbel
    // krijgen (en de appjes kosten dubbel). Alleen met `toch` gaat hij door:
    // de app vraagt dat eerst.
    if (verzoek.toch !== true) {
      const { data: recent, error: recentFout } = await beheerder
        .from("mailingen")
        .select("kanaal,aantal,aantal_whatsapp,mislukt")
        .eq("company_id", bedrijf.id)
        .eq("datum", datum)
        .eq("test", false)
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
      if (recentFout) {
        return antwoord({ fout: "Kon niet nagaan of deze dag al verstuurd is." }, 500);
      }
      // Telt niet mee: een poging waarbij alles geweigerd werd (niets de deur
      // uit), en een ander kanaal (eerst de mail, later bewust alleen de
      // appjes). Een verzending die nog bezig is (alles nog 0) telt wél.
      const metMail = (k: string) => k !== "whatsapp";
      const metApp = (k: string) => k !== "mail";
      const overlapt = (recent ?? []).some((m) => {
        const allesGeweigerd = m.aantal === 0 && m.aantal_whatsapp === 0 && m.mislukt > 0;
        const zelfdeKanaal =
          (metMail(m.kanaal) && metMail(kanaal)) || (metApp(m.kanaal) && metApp(kanaal));
        return !allesGeweigerd && zelfdeKanaal;
      });
      if (overlapt) {
        return antwoord(
          {
            fout: "De aankondiging voor deze dag is het afgelopen uur al verstuurd.",
            al_verstuurd: true,
          },
          409,
        );
      }
    }
    const { data, error: mailingFout } = await beheerder
      .from("mailingen")
      .insert({
        company_id: bedrijf.id,
        datum,
        onderwerp: vastOnderwerp,
        tekst: vastTekst,
        test,
        kanaal,
        sjabloon_id: sjabloon?.id ?? null,
        verzonden_door: medewerker.id,
      })
      .select("id")
      .single();
    if (mailingFout || !data) {
      return antwoord({ fout: "Kon de verzending niet vastleggen." }, 500);
    }
    mailing = data;
  }

  const tijdvakken = leesTijdvakken(verzoek.tijdvakken);

  const uitslag = await perGroepje(teVersturen, 6, async (o) => {
    // Het tijdvak van dit bericht: het eerste adres van deze klant waarvoor
    // er een tijdvak gepland staat. Zo'n belofte hoort bij een groot pand,
    // dus in de praktijk is dat er hooguit een.
    const metTijd = o.customer_ids.find((id) => tijdvakken.has(id));
    const tijdvak = metTijd ? tijdvakken.get(metTijd) : undefined;
    const velden = {
      naam: o.naam || "buurtbewoner",
      adres: o.adressen.join(" en "),
      datum: datumVoluit(datum),
      tijdvak: tijdvakZin(tijdvak, o.adressen[0] ?? "uw adres"),
    };
    // Staat {{tijdvak}} niet in de tekst, dan komt de zin er onderaan bij:
    // anders belooft de app iets wat de klant nooit leest.
    const basis = vulIn(tekst, velden);
    const heeftPlek = /\{\{\s*tijdvak\s*\}\}/.test(tekst);
    const volledig = !tijdvak || heeftPlek ? basis : `${basis}\n\n${velden.tijdvak}`;
    const res = await stuurMail(brevo.trim(), afzender, {
      naar: { email: o.email, naam: o.naam },
      onderwerp: (test ? "[PROEF] " : "") + vulIn(onderwerp, velden),
      tekst: volledig,
      antwoordNaar,
    });
    return { o, res, tijdvak };
  });

  const rijen = uitslag.map(({ o, res }) => ({
    company_id: bedrijf.id,
    mailing_id: mailing.id,
    klant_id: o.klant_id,
    kanaal: "mail",
    email: o.email,
    telefoon: "",
    naam: o.naam,
    adressen: o.adressen.join(", "),
    status: res.ok ? "verzonden" : "mislukt",
    fout: res.ok ? "" : res.fout,
    // Het kenmerk van Brevo: daarmee vindt de webhook deze ontvanger terug
    // als de mailserver van de klant zich later meldt.
    message_id: res.ok ? res.id : "",
    wa_id: "",
  }));

  // De appjes: per klant het sjabloon, met zijn naam, adres en de dag.
  const datumTekst = datumVoluit(datum);
  const waUitslag = await perGroepje(appjes, 4, async (o) => {
    // Zelfde als in de mail: zonder naam "buurtbewoner", en dat staat dan ook in het gesprek.
    const waarden = { naam: o.naam || "buurtbewoner", adres: o.adressen.join(" en "), datum: datumTekst };
    const parameters = (sjabloon!.variabelen ?? []).map((v) => waarden[v as keyof typeof waarden] ?? "");
    const res = await verstuurSjabloon(wa!.toegang, wa!.phoneNumberId, o.wa, sjabloon!.meta_naam, parameters);
    return { o, res, tekst: vulSjabloonIn(sjabloon!.tekst, waarden) };
  });
  for (const { o, res } of waUitslag) {
    rijen.push({
      company_id: bedrijf.id,
      mailing_id: mailing.id,
      klant_id: o.klant_id,
      kanaal: "whatsapp",
      email: "",
      telefoon: o.wa,
      naam: o.naam,
      adressen: o.adressen.join(", "),
      status: res.ok ? "verzonden" : "mislukt",
      fout: res.ok ? "" : res.fout.slice(0, 300),
      message_id: "",
      wa_id: res.ok ? (res as { waId: string }).waId : "",
    });
  }
  // Wat via WhatsApp wegging, staat ook in het gesprek met de klant.
  // Een proef niet: dan zou het proefnummer als gesprek (of in een dossier) verschijnen.
  const gesprekRijen = waUitslag
    .filter(({ res }) => res.ok && !test)
    .map(({ o, res, tekst: t }) => ({
      company_id: bedrijf.id,
      kanaal: "whatsapp",
      wa_id: (res as { waId: string }).waId,
      wa_telefoon: o.wa,
      wa_type: "template",
      wa_status: "verstuurd",
      richting: "uit",
      bron: "wooshy",
      tekst: t,
      fragment: t.replace(/\s+/g, " ").slice(0, 200),
      ontvangen_op: new Date().toISOString(),
      gelezen: true,
      op_server: false,
      paaltje_status: "overslaan",
    }));
  for (const stuk of inStukjes(gesprekRijen, 200)) {
    const { error } = await beheerder.from("berichten").insert(stuk);
    if (error) console.error("aankondiging in gesprek:", error.message);
  }

  let opslagFout = "";
  // Per ontvanger de adressen van die dag, zodat de planning kan tonen wat er
  // verstuurd is en wat er beloofd is. Een proef niet: die ging naar jezelf.
  //
  // Op adres en niet op volgorde: de database mag zijn rijen teruggeven in de
  // volgorde die hem uitkomt, en dan zou het tijdvak van de een bij het adres
  // van de ander belanden.
  const adresBij = new Map<string, { customer_ids: string[]; tijdvak?: Tijdvak | undefined }>();
  for (const { o, tijdvak } of uitslag) {
    adresBij.set(`mail:${o.email.toLowerCase()}`, { customer_ids: o.customer_ids, tijdvak });
  }
  for (const { o } of waUitslag) {
    adresBij.set(`whatsapp:${o.wa}`, { customer_ids: o.customer_ids });
  }
  for (const stuk of inStukjes(rijen, 200)) {
    const { data: gemaakt, error } = await beheerder
      .from("mail_ontvangers")
      .insert(stuk)
      .select("id,kanaal,email,telefoon");
    if (error) {
      console.error("ontvangers opslaan:", error.message);
      opslagFout = "Verstuurd, maar de lijst met ontvangers kon niet bewaard worden.";
      continue;
    }
    if (!test) {
      const koppels: Record<string, unknown>[] = [];
      for (const rij of (gemaakt ?? []) as {
        id: string;
        kanaal: string;
        email: string;
        telefoon: string;
      }[]) {
        const sleutel =
          rij.kanaal === "whatsapp"
            ? `whatsapp:${rij.telefoon}`
            : `mail:${(rij.email ?? "").toLowerCase()}`;
        const bij = adresBij.get(sleutel);
        for (const customerId of bij?.customer_ids ?? []) {
          koppels.push({
            company_id: bedrijf.id,
            ontvanger_id: rij.id,
            customer_id: customerId,
            datum,
            tijdvak_van: bij?.tijdvak?.van ?? null,
            tijdvak_tot: bij?.tijdvak?.tot ?? null,
            soort: "aankondiging",
          });
        }
      }
      for (const brok of inStukjes(koppels, 200)) {
        const { error: koppelFout } = await beheerder.from("aankondiging_adressen").insert(brok);
        if (koppelFout) console.error("aankondiging per adres opslaan:", koppelFout.message);
      }
    }
  }

  const mislukt = rijen.filter((r) => r.status === "mislukt").length;
  const gelukt = (k: string) => rijen.filter((r) => r.kanaal === k && r.status === "verzonden").length;
  const { error: aantalFout } = await beheerder
    .from("mailingen")
    .update({ aantal: gelukt("mail"), aantal_whatsapp: gelukt("whatsapp"), mislukt })
    .eq("id", mailing.id);
  if (aantalFout) {
    console.error("aantallen bijwerken:", aantalFout.message);
    opslagFout ||= "Verstuurd, maar de aantallen konden niet bewaard worden.";
  }

  return antwoord({
    mailing_id: mailing.id,
    verstuurd: gelukt("mail"),
    verstuurdWhatsApp: gelukt("whatsapp"),
    mislukt,
    // Eén voorbeeldfout is genoeg om te snappen wat er mis ging; de rest
    // staat in de tabel.
    eersteFout: rijen.find((r) => r.status === "mislukt")?.fout ?? opslagFout,
  });
});

/**
 * "De planning is veranderd" — het bericht bij een verschoven dag of bij werk
 * dat niet af kwam.
 *
 * Het gaat over een paar adressen, niet over een hele dag. Per adres zoekt de
 * server zelf op wat er eerder aangekondigd was (de oude dag) en waar het nu
 * staat (de nieuwe dag); de app hoeft alleen te zeggen wélke adressen het
 * betreft. Zo kan niemand een bericht met een verzonnen datum laten sturen.
 */
// deno-lint-ignore no-explicit-any
async function wijzigingsbericht(
  db: any,
  bedrijf: { id: string; name: string; mail_afzender_naam: string | null; mail_afzender_email: string | null },
  medewerker: { id: string; naam: string; email: string },
  verzoek: Verzoek,
  brevo: string,
): Promise<Response> {
  const soort = verzoek.soort === "niet_af" ? "niet_af" : "wijziging";
  const ids = (verzoek.customer_ids ?? []).filter((id) => UUID_RE.test(id)).slice(0, 500);
  if (ids.length === 0) return antwoord({ fout: "Geen adressen meegegeven." }, 400);

  const vandaag = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }))
    .toISOString()
    .slice(0, 10);

  // Waar staan deze adressen nu? De eerstvolgende dag vanaf vandaag. Alleen
  // vanaf vandaag: de geschiedenis van een jaar wassen loopt zo tegen de
  // duizend rijen per opvraging aan, en dan zou juist de dag die nog moet
  // komen wegvallen — en beloven we een datum die allang geweest is.
  const nieuweDatum = new Map<string, string>();
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("wasdag_regels")
      .select("customer_id,datum")
      .eq("company_id", bedrijf.id)
      .in("customer_id", stuk)
      .gte("datum", vandaag)
      .order("datum", { ascending: true });
    for (const r of data ?? []) {
      const id = r["customer_id"] as string;
      const datum = r["datum"] as string;
      const was = nieuweDatum.get(id);
      if (!was || datum < was) nieuweDatum.set(id, datum);
    }
  }

  // En waarvoor was het aangekondigd? De laatste zending per adres. Ook hier
  // alleen het recente verleden; oudere rondes zeggen niets meer.
  const oudeDatum = new Map<string, string>();
  const sinds = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("aankondiging_adressen")
      .select("customer_id,datum,created_at")
      .eq("company_id", bedrijf.id)
      .in("customer_id", stuk)
      .gte("datum", sinds)
      .order("created_at", { ascending: true });
    for (const r of data ?? []) oudeDatum.set(r["customer_id"] as string, r["datum"] as string);
  }

  // De klanten erbij. De maand van de nieuwe dag telt voor "slaat over".
  const maand = (nieuweDatum.values().next().value ?? vandaag).slice(0, 7);
  const klanten = await klantenVoorAdressen(db, bedrijf.id, ids, maand);
  for (const k of klanten) {
    const metDatum = k.customer_ids.find((id) => nieuweDatum.has(id));
    const metOud = k.customer_ids.find((id) => oudeDatum.has(id));
    k.nieuweDatum = metDatum ? nieuweDatum.get(metDatum) : undefined;
    k.oudeDatum = metOud ? oudeDatum.get(metOud) : undefined;
  }

  // Zonder WhatsApp-sjabloon gaat alles per mail: een appje kan alleen met een
  // sjabloon dat Meta heeft goedgekeurd.
  let sjabloon: Sjabloon | null = null;
  if (verzoek.sjabloon_id) {
    const { data } = await db
      .from("wa_sjablonen")
      .select("id,titel,meta_naam,categorie,tekst,variabelen,status")
      .eq("company_id", bedrijf.id)
      .eq("id", String(verzoek.sjabloon_id))
      .is("deleted_at", null)
      .maybeSingle();
    sjabloon = (data as Sjabloon | null) ?? null;
  }
  // Wie nooit iets over deze dag hoorde, krijgt ook geen wijziging: dan zou
  // er "we komen niet op , maar op donderdag" staan. En wie nergens meer op
  // de planning staat evenmin: dan is er geen nieuwe dag om te noemen.
  const metBericht = klanten.filter((k) => !!k.oudeDatum && !!k.nieuweDatum);
  const zonderAankondiging = klanten.length - metBericht.length;
  const verdeling = verdeel(metBericht, sjabloon ? "voorkeur" : "mail", false);
  const zonderContact = metBericht.filter(
    (k) => !k.email && !verdeling.whatsapp.some((w) => w.klant_id === k.klant_id),
  ).length;

  if (verzoek.actie === "wijziging_tellen") {
    return antwoord({
      aantal: verdeling.mail.length,
      aantalWhatsApp: verdeling.whatsapp.length,
      zonderContact,
      zonderAankondiging,
      voorbeeld: [...verdeling.mail, ...verdeling.whatsapp].slice(0, 5).map((o) => ({
        naam: o.naam,
        adressen: o.adressen,
        oudeDatum: o.oudeDatum ? datumVoluit(o.oudeDatum) : "nog niet aangekondigd",
        nieuweDatum: o.nieuweDatum ? datumVoluit(o.nieuweDatum) : "geen nieuwe dag",
      })),
    });
  }

  // Twee keer op Versturen (of twee tabbladen) hoort niet twee berichten te
  // geven. Kreeg een van deze adressen het afgelopen uur al ditzelfde soort
  // bericht, dan vragen we het eerst.
  if (verzoek.toch !== true) {
    const eenUur = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    for (const stuk of inStukjes(ids)) {
      const { data: recent } = await db
        .from("aankondiging_adressen")
        .select("customer_id")
        .eq("company_id", bedrijf.id)
        .eq("soort", soort)
        .in("customer_id", stuk)
        .gte("created_at", eenUur)
        .limit(1);
      if ((recent ?? []).length > 0) {
        return antwoord(
          {
            fout: "Deze adressen kregen het afgelopen uur al zo'n bericht.",
            al_verstuurd: true,
          },
          409,
        );
      }
    }
  }

  const onderwerp = String(verzoek.onderwerp ?? "").trim().slice(0, MAX_ONDERWERP);
  const tekst = String(verzoek.tekst ?? "").trim().slice(0, MAX_TEKST);
  const reden = String(verzoek.reden ?? "").trim().slice(0, 120);
  if (!onderwerp || !tekst) return antwoord({ fout: "Vul een onderwerp en een tekst in." }, 400);
  if (verdeling.mail.length === 0 && verdeling.whatsapp.length === 0) {
    return antwoord(
      {
        fout:
          zonderAankondiging > 0
            ? "Deze adressen hebben nog geen bericht gehad over deze dag, of staan nergens meer ingepland; er valt dus niets te wijzigen."
            : "Van deze adressen is niemand te bereiken.",
      },
      400,
    );
  }

  const afzenderEmail = (bedrijf.mail_afzender_email ?? "").trim();
  if (verdeling.mail.length > 0) {
    const vooraf = await afzenderFout(db, bedrijf.id, brevo, afzenderEmail);
    if (vooraf) return antwoord({ fout: vooraf }, 400);
  }
  const afzender = {
    naam: (bedrijf.mail_afzender_naam ?? "").trim() || bedrijf.name,
    email: afzenderEmail,
  };
  const antwoordNaar = antwoordAdres(await mailboxAdresVan(db, bedrijf.id));

  // De dag die in het logboek komt: de nieuwe dag als die voor iedereen
  // dezelfde is, anders leeg — dan gaat het over meer dagen tegelijk.
  const nieuweDagen = [...new Set([...nieuweDatum.values()])];
  const { data: mailingRij, error: mailingFout } = await db
    .from("mailingen")
    .insert({
      company_id: bedrijf.id,
      datum: nieuweDagen.length === 1 ? nieuweDagen[0] : null,
      onderwerp,
      tekst,
      test: false,
      kanaal: sjabloon ? "voorkeur" : "mail",
      soort,
      sjabloon_id: sjabloon?.id ?? null,
      verzonden_door: medewerker.id,
    })
    .select("id")
    .single();
  if (mailingFout || !mailingRij) {
    return antwoord({ fout: "Kon de verzending niet vastleggen." }, 500);
  }

  function velden(o: Ontvanger | WaOntvanger) {
    return {
      naam: o.naam || "buurtbewoner",
      adres: o.adressen.join(" en "),
      datum: o.oudeDatum ? datumVoluit(o.oudeDatum) : "",
      "nieuwe datum": o.nieuweDatum ? datumVoluit(o.nieuweDatum) : "",
      reden,
      tijdvak: "",
    };
  }

  const uitslag = await perGroepje(verdeling.mail, 6, async (o) => {
    const v = velden(o);
    const res = await stuurMail(brevo.trim(), afzender, {
      naar: { email: o.email, naam: o.naam },
      onderwerp: vulIn(onderwerp, v),
      tekst: vulIn(tekst, v),
      antwoordNaar,
    });
    return { o, res };
  });

  const waUitslag = sjabloon
    ? await perGroepje(verdeling.whatsapp, 4, async (o) => {
        const v = velden(o);
        const parameters = (sjabloon!.variabelen ?? []).map(
          (naam) => (v as Record<string, string>)[naam] ?? "",
        );
        const koppeling = await waToegang(db, bedrijf.id);
        const res = koppeling
          ? await verstuurSjabloon(koppeling.toegang, koppeling.phoneNumberId, o.wa, sjabloon!.meta_naam, parameters)
          : { ok: false as const, fout: "WhatsApp is niet gekoppeld." };
        return { o, res };
      })
    : [];

  const rijen = [
    ...uitslag.map(({ o, res }) => ({
      company_id: bedrijf.id,
      mailing_id: mailingRij.id,
      klant_id: o.klant_id,
      kanaal: "mail",
      email: o.email,
      telefoon: "",
      naam: o.naam,
      adressen: o.adressen.join(", "),
      status: res.ok ? "verzonden" : "mislukt",
      fout: res.ok ? "" : res.fout.slice(0, 300),
      message_id: res.ok ? res.id : "",
      wa_id: "",
    })),
    ...waUitslag.map(({ o, res }) => ({
      company_id: bedrijf.id,
      mailing_id: mailingRij.id,
      klant_id: o.klant_id,
      kanaal: "whatsapp",
      email: "",
      telefoon: o.wa,
      naam: o.naam,
      adressen: o.adressen.join(", "),
      status: res.ok ? "verzonden" : "mislukt",
      fout: res.ok ? "" : String(res.fout).slice(0, 300),
      message_id: "",
      wa_id: res.ok ? (res as { waId: string }).waId : "",
    })),
  ];
  // Ook hier op adres koppelen, niet op volgorde.
  const bijSleutel = new Map<string, Ontvanger | WaOntvanger>();
  for (const { o } of uitslag) bijSleutel.set(`mail:${o.email.toLowerCase()}`, o);
  for (const { o } of waUitslag) bijSleutel.set(`whatsapp:${o.wa}`, o);

  for (const stuk of inStukjes(rijen, 200)) {
    const { data: gemaakt, error } = await db
      .from("mail_ontvangers")
      .insert(stuk)
      .select("id,kanaal,email,telefoon");
    if (error) {
      console.error("wijziging opslaan:", error.message);
      continue;
    }
    const koppels: Record<string, unknown>[] = [];
    for (const rij of (gemaakt ?? []) as {
      id: string;
      kanaal: string;
      email: string;
      telefoon: string;
    }[]) {
      const o = bijSleutel.get(
        rij.kanaal === "whatsapp"
          ? `whatsapp:${rij.telefoon}`
          : `mail:${(rij.email ?? "").toLowerCase()}`,
      );
      for (const customerId of o?.customer_ids ?? []) {
        const dag = nieuweDatum.get(customerId) ?? o?.nieuweDatum;
        if (!dag) continue;
        koppels.push({
          company_id: bedrijf.id,
          ontvanger_id: rij.id,
          customer_id: customerId,
          datum: dag,
          soort,
        });
      }
    }
    for (const brok of inStukjes(koppels, 200)) {
      const { error: koppelFout } = await db.from("aankondiging_adressen").insert(brok);
      if (koppelFout) console.error("wijziging per adres opslaan:", koppelFout.message);
    }
  }

  const gelukt = (k: string) => rijen.filter((r) => r.kanaal === k && r.status === "verzonden").length;
  const mislukt = rijen.filter((r) => r.status === "mislukt").length;
  await db
    .from("mailingen")
    .update({ aantal: gelukt("mail"), aantal_whatsapp: gelukt("whatsapp"), mislukt })
    .eq("id", mailingRij.id);

  return antwoord({
    mailing_id: mailingRij.id,
    verstuurd: gelukt("mail"),
    verstuurdWhatsApp: gelukt("whatsapp"),
    mislukt,
    eersteFout: rijen.find((r) => r.status === "mislukt")?.fout ?? "",
  });
}

/** De WhatsApp-koppeling van dit bedrijf, als die er is en werkt. */
// deno-lint-ignore no-explicit-any
async function waToegang(
  db: any,
  companyId: string,
): Promise<{ phoneNumberId: string; toegang: Toegang } | null> {
  const { data: koppeling } = await db
    .from("whatsapp_koppelingen")
    .select("id,phone_number_id,status")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!koppeling || koppeling["status"] === "uit") return null;
  const toegang = await toegangVan(db, koppeling["id"] as string, ontsleutel);
  return toegang ? { phoneNumberId: koppeling["phone_number_id"] as string, toegang } : null;
}

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
  mailboxAdres: string,
): Promise<Response> {
  const afzender = String(bedrijf["mail_afzender_email"] ?? "").trim().toLowerCase();

  const uit: Record<string, unknown> = {
    sleutel: false,
    account: "",
    afzenderIngevuld: afzender,
    afzenderBekend: false,
    afzenderActief: false,
    afzenderPastBijMailbox: afzenderPastBij(afzender, mailboxAdres),
    mailboxDomein: domeinVan(mailboxAdres),
    melding: "",
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
      // Alleen bij het eigen domein: anders kun je via deze knop raden welke
      // adressen van andere bedrijven Brevo kent.
      const eigen = afzenderPastBij(afzender, mailboxAdres);
      uit["afzenderBekend"] = eigen && !!gevonden;
      uit["afzenderActief"] = eigen && gevonden?.active === true;
      // Alleen adressen op het domein van de eigen mailbox: het Brevo-account
      // is van heel Wooshy, en de afzenders van andere bedrijven gaan niemand
      // anders iets aan.
      const eigenDomein = domeinVan(mailboxAdres);
      uit["bekendeAfzenders"] = eigenDomein
        ? (senders.senders ?? [])
            .map((s) => (s.email ?? "").trim())
            .filter((e) => e && domeinVan(e) === eigenDomein)
            .slice(0, 10)
        : [];
    }
  } catch (e) {
    uit["melding"] = e instanceof Error ? e.message : "Onbekende fout.";
  }

  return antwoord(uit);
}

/**
 * Het adres van de gekoppelde mailbox, als die werkt. Leeg als er geen is.
 */
// deno-lint-ignore no-explicit-any
async function mailboxAdresVan(db: any, companyId: string): Promise<string> {
  const { data } = await db
    .from("mailboxen")
    .select("adres,status")
    .eq("company_id", companyId)
    .maybeSingle();
  return data?.status === "actief" ? String(data.adres ?? "") : "";
}

function domeinVan(adres: string): string {
  const at = adres.lastIndexOf("@");
  return at < 0 ? "" : adres.slice(at + 1).trim().toLowerCase();
}

/** Staat de afzender op hetzelfde domein als de gekoppelde mailbox? */
function afzenderPastBij(afzender: string, mailboxAdres: string): boolean {
  const domein = domeinVan(mailboxAdres);
  return !!domein && domeinVan(afzender) === domein;
}

/**
 * Mag dit bedrijf vanaf dit adres versturen? Leeg als het mag, anders de reden.
 *
 * Het Brevo-account is van heel Wooshy. Zonder deze controle kan een bedrijf
 * elk adres invullen dat Brevo kent, ook dat van een ander bedrijf, en dan
 * zien zijn klanten die naam. Een mailbox koppelen lukt alleen met het echte
 * wachtwoord, dus het domein daarvan is het bewijs dat het adres van jou is.
 */
// deno-lint-ignore no-explicit-any
async function afzenderFout(db: any, companyId: string, brevo: string, afzender: string): Promise<string> {
  const adres = afzender.trim().toLowerCase();
  if (!brevo) return "De Brevo-sleutel ontbreekt op de server.";
  if (!adres) return "Stel eerst een afzender in bij Instellingen.";
  const { data: box, error } = await db
    .from("mailboxen")
    .select("adres,status")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return "Je mailbox kon even niet opgezocht worden. Probeer het zo nog eens.";
  if (!box) {
    return "Koppel eerst je eigen mailbox bij Instellingen → mail. Pas dan kan Wooshy zien dat het afzenderadres echt van jou is.";
  }
  if (box.status !== "actief") {
    return "Je mailbox moet opnieuw gekoppeld worden (Instellingen → mail). Tot dan kan Wooshy niet zien dat het afzenderadres van jou is.";
  }
  const mailboxAdres = String(box.adres ?? "");
  if (!afzenderPastBij(adres, mailboxAdres)) {
    return `Het afzenderadres moet eindigen op @${domeinVan(mailboxAdres)}, het domein van je gekoppelde mailbox.`;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/senders", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Brevo kon de afzender niet controleren (${res.status}). Probeer het zo nog eens.`;
    const lijst = (await res.json()) as { senders?: { email?: string; active?: boolean }[] };
    const gevonden = (lijst.senders ?? []).find((s) => (s.email ?? "").trim().toLowerCase() === adres);
    if (!gevonden) return `${adres} staat nog niet bij Brevo als afzender. Laat hem daar eerst toevoegen.`;
    if (gevonden.active !== true) return `${adres} is bij Brevo nog niet goedgekeurd. Bevestig hem eerst via de mail van Brevo.`;
  } catch {
    return "Brevo is even niet bereikbaar. Probeer het zo nog eens.";
  }
  return "";
}

/**
 * Het antwoordadres van een aankondiging — of niets.
 *
 * Is de eigen mailbox gekoppeld, dan antwoorden klanten gewoon daarheen: dan
 * staat alles in één mailbox, ook op de telefoon, en leest Paaltje het mee.
 * Zonder gekoppelde mailbox niets, en gaat een antwoord gewoon naar de
 * afzender. (Versturen weigert dan toch al, zie afzenderFout.)
 */
function antwoordAdres(mailboxAdres: string): string | undefined {
  return mailboxAdres || undefined;
}

/** Eén klant op de dag, met alles wat nodig is om te kiezen waarlangs hij bericht krijgt. */
interface KlantOpDag {
  klant_id: string;
  /** De adres-id's van die dag: nodig om per adres te bewaren wat er beloofd is. */
  customer_ids: string[];
  naam: string;
  email: string;
  /** Als WhatsApp-nummer ("316…"), leeg als hij geen 06-nummer heeft. */
  wa: string;
  voorkeur: "mail" | "whatsapp" | "beide";
  toestemming: boolean;
  marketing: boolean;
  afgemeld: boolean;
  adressen: string[];
  /** Bij een wijziging: de dag waarvoor het al aangekondigd was, en de nieuwe. */
  oudeDatum?: string;
  nieuweDatum?: string;
}

/**
 * De klanten achter de adressen van één dag.
 *
 * Van de dag naar de adressen, van de adressen naar de klanten. Een klant met
 * twee panden op dezelfde dag krijgt één bericht met beide adressen erin — twee
 * losse berichtjes over dezelfde ochtend leest als een storing.
 */
async function klantenVoorDag(
  db: ReturnType<typeof createClient>,
  companyId: string,
  datum: string,
): Promise<KlantOpDag[]> {
  // Wie deze maand overslaat staat nog wel op de dag, maar komt niet: die
  // hoort ook geen aankondiging te krijgen.
  const maand = datum.slice(0, 7);
  const { data: regels } = await db
    .from("wasdag_regels")
    .select("customer_id")
    .eq("company_id", companyId)
    .eq("datum", datum);

  const ids = (regels ?? [])
    .map((r) => r["customer_id"] as string | null)
    .filter((id): id is string => !!id);
  return await klantenVoorAdressen(db, companyId, ids, maand);
}

/**
 * Dezelfde klanten, maar dan bij een lijst adressen in plaats van bij een dag.
 * Het wijzigingsbericht gebruikt dit: dat gaat over de adressen die je hebt
 * verplaatst, niet over alles van die dag.
 */
async function klantenVoorAdressen(
  db: ReturnType<typeof createClient>,
  companyId: string,
  ids: string[],
  maand: string,
): Promise<KlantOpDag[]> {
  if (ids.length === 0) return [];

  const adressen: {
    id: string;
    klant_id: string | null;
    huis: number;
    toevoeging: string;
    street_id: string;
  }[] = [];
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("customers")
      .select("id,klant_id,house_number,addition,street_id,overslaan")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      // Inactief (gestopt of verhuisd): die krijgt geen aankondiging meer, ook
      // als er nog een oude regel op de planning staat.
      .is("inactief_op", null)
      .in("id", stuk);
    for (const c of data ?? []) {
      if (((c["overslaan"] as string[] | null) ?? []).includes(maand)) continue;
      adressen.push({
        id: c["id"] as string,
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
  // "Ameland", maar in een bericht hoort "Amelandstraat".
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

  const klanten = new Map<string, KlantOpDag>();
  for (const stuk of inStukjes(klantIds)) {
    const { data } = await db
      .from("klanten")
      .select("id,naam,email,telefoon,telefoon2,kanaal_voorkeur,wa_toestemming_op,wa_marketing_op,wa_afgemeld_op")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const k of data ?? []) {
      const voorkeur = String(k["kanaal_voorkeur"] ?? "mail");
      klanten.set(k["id"] as string, {
        klant_id: k["id"] as string,
        customer_ids: [],
        naam: (k["naam"] as string) ?? "",
        email: ((k["email"] as string) ?? "").trim(),
        wa: mobielAlsWa(String(k["telefoon"] ?? "")) || mobielAlsWa(String(k["telefoon2"] ?? "")),
        voorkeur: voorkeur === "whatsapp" || voorkeur === "beide" ? voorkeur : "mail",
        toestemming: !!k["wa_toestemming_op"],
        marketing: !!k["wa_marketing_op"],
        afgemeld: !!k["wa_afgemeld_op"],
        adressen: [],
      });
    }
  }

  for (const a of adressen) {
    if (!a.klant_id) continue;
    const klant = klanten.get(a.klant_id);
    if (!klant) continue;
    const adres = `${straatNaam.get(a.street_id) ?? ""} ${a.huis}${a.toevoeging}`.trim();
    if (!klant.adressen.includes(adres)) klant.adressen.push(adres);
    if (!klant.customer_ids.includes(a.id)) klant.customer_ids.push(a.id);
  }

  return [...klanten.values()]
    .filter((k) => k.adressen.length > 0)
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
}

/**
 * Wie krijgt een mail en wie een appje. Bij "voorkeur" telt wat bij de klant
 * staat; kan hij geen WhatsApp krijgen (geen 06-nummer, geen toestemming,
 * afgemeld), dan krijgt hij een mail als dat kan. Kies je zelf "WhatsApp",
 * dan krijgt wie het niet kan niets — dat staat in de telling.
 */
function verdeel(
  klanten: KlantOpDag[],
  kanaal: Kanaal,
  marketing: boolean,
): { mail: Ontvanger[]; whatsapp: WaOntvanger[]; zonderWhatsApp: number } {
  const perEmail = new Map<string, Ontvanger>();
  const perNummer = new Map<string, WaOntvanger>();
  let zonderWhatsApp = 0;
  for (const k of klanten) {
    const wil = kanaal === "voorkeur" ? k.voorkeur : kanaal;
    const kanWa = !!k.wa && k.toestemming && !k.afgemeld && (!marketing || k.marketing);
    const wilWa = wil === "whatsapp" || wil === "beide";
    const doeWa = wilWa && kanWa;
    if (wilWa && !kanWa) zonderWhatsApp += 1;
    const doeMail =
      !!k.email && (wil === "mail" || wil === "beide" || (kanaal === "voorkeur" && wil === "whatsapp" && !kanWa));

    if (doeMail) {
      // Op e-mailadres: twee klantkaarten met hetzelfde adres erachter is één
      // mens met één postvak.
      const sleutel = k.email.toLowerCase();
      const bestaand = perEmail.get(sleutel);
      if (bestaand) {
        for (const a of k.adressen) if (!bestaand.adressen.includes(a)) bestaand.adressen.push(a);
        for (const id of k.customer_ids) if (!bestaand.customer_ids.includes(id)) bestaand.customer_ids.push(id);
      } else {
        perEmail.set(sleutel, {
          email: k.email,
          naam: k.naam,
          klant_id: k.klant_id,
          adressen: [...k.adressen],
          customer_ids: [...k.customer_ids],
          ...(k.oudeDatum ? { oudeDatum: k.oudeDatum } : {}),
          ...(k.nieuweDatum ? { nieuweDatum: k.nieuweDatum } : {}),
        });
      }
    }
    if (doeWa) {
      const bestaand = perNummer.get(k.wa);
      if (bestaand) {
        for (const a of k.adressen) if (!bestaand.adressen.includes(a)) bestaand.adressen.push(a);
        for (const id of k.customer_ids) if (!bestaand.customer_ids.includes(id)) bestaand.customer_ids.push(id);
      } else {
        perNummer.set(k.wa, {
          wa: k.wa,
          naam: k.naam,
          klant_id: k.klant_id,
          adressen: [...k.adressen],
          customer_ids: [...k.customer_ids],
          ...(k.oudeDatum ? { oudeDatum: k.oudeDatum } : {}),
          ...(k.nieuweDatum ? { nieuweDatum: k.nieuweDatum } : {}),
        });
      }
    }
  }
  return { mail: [...perEmail.values()], whatsapp: [...perNummer.values()], zonderWhatsApp };
}


/**
 * Hoe goed de aankondiging deze dag dekt: hoeveel adressen we niet kunnen
 * mailen, en hoeveel deze maand overslaan en dus ook geen mail krijgen. Die
 * getallen horen naast het aantal ontvangers: "42 mensen, 18 zonder
 * e-mailadres, 3 slaan over" vertelt je meteen waar de rest is gebleven.
 */
async function telDekking(
  db: ReturnType<typeof createClient>,
  companyId: string,
  datum: string,
): Promise<{ zonderEmail: number; overgeslagen: number }> {
  const maand = datum.slice(0, 7);
  const { data: regels } = await db
    .from("wasdag_regels")
    .select("customer_id")
    .eq("company_id", companyId)
    .eq("datum", datum);
  const ids = (regels ?? [])
    .map((r) => r["customer_id"] as string | null)
    .filter((id): id is string => !!id);
  if (ids.length === 0) return { zonderEmail: 0, overgeslagen: 0 };

  let overgeslagen = 0;
  const klantVan: (string | null)[] = [];
  for (const stuk of inStukjes(ids)) {
    const { data } = await db
      .from("customers")
      .select("klant_id,overslaan")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      // Zelfde telling als lijstVoorDag: inactieve adressen doen niet mee.
      .is("inactief_op", null)
      .in("id", stuk);
    for (const c of data ?? []) {
      if (((c["overslaan"] as string[] | null) ?? []).includes(maand)) {
        overgeslagen += 1;
        continue;
      }
      klantVan.push(c["klant_id"] as string | null);
    }
  }

  const metEmail = new Set<string>();
  const klantIds = [...new Set(klantVan.filter((x): x is string => !!x))];
  for (const stuk of inStukjes(klantIds)) {
    const { data } = await db
      .from("klanten")
      .select("id,email")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("id", stuk);
    for (const k of data ?? []) {
      if (((k["email"] as string) ?? "").trim()) metEmail.add(k["id"] as string);
    }
  }
  const zonderEmail = klantVan.filter((id) => !id || !metEmail.has(id)).length;
  return { zonderEmail, overgeslagen };
}
