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
import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

import {
  antwoord,
  CORS,
  inStukjes,
  perGroepje,
  stuurMail,
  vulIn,
} from "../_gedeeld/mail.ts";
import { leesBericht } from "../_gedeeld/assistent.ts";
import {
  draaiTerug,
  veiligVoorAutomatisch,
  voerOverslaanDoor,
  ZEKER_AUTOMATISCH,
} from "../_gedeeld/doorvoeren.ts";

interface Verzoek {
  /** Proefmail naar dit adres in plaats van naar jezelf. */
  proef_naar?: string;
  /**
   * `tellen` bouwt de lijst zonder te versturen, `versturen` doet allebei,
   * `reactie` stuurt één antwoord terug op een binnengekomen bericht,
   * `controle` kijkt alleen of de verbinding met Brevo klopt, en
   * `inbox-koppelen` zet het postvak open zodra de DNS goed staat, en
   * `opnieuw-lezen` laat de assistent een binnengekomen bericht nog eens lezen,
   * `doorvoeren` zet een voorstel door, en `terugdraaien` haalt een
   * aanpassing uit het rapport weer weg.
   */
  actie:
    | "tellen"
    | "versturen"
    | "reactie"
    | "controle"
    | "inbox-koppelen"
    | "opnieuw-lezen"
    | "doorvoeren"
    | "terugdraaien";
  /** De wasdag waarvan de adressen komen, als 'jjjj-mm-dd'. */
  datum: string;
  onderwerp: string;
  tekst: string;
  /** Proef: alleen naar jezelf, met de eerste echte ontvanger als voorbeeld. */
  test?: boolean;
  /** Bij `reactie` en `opnieuw-lezen`: om welk binnengekomen bericht het gaat. */
  antwoord_id?: string;
  /** Bij `terugdraaien`: welke regel uit het rapport. */
  wijziging_id?: string;
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
    .select(
      "id,name,mail_afzender_naam,mail_afzender_email,mail_token,mail_inbox_actief,mail_auto_doorvoeren",
    )
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
    return await controleer(bedrijf, brevo, inboxDomein, await mailboxAdresVan(beheerder, bedrijf.id));
  }

  // Het postvak openzetten is een instelling van het hele bedrijf, en het
  // maakt een koppeling aan bij Brevo. Dat is iets voor de eigenaar.
  if (verzoek.actie === "inbox-koppelen") {
    if (medewerker.rol !== "eigenaar") {
      return antwoord({ fout: "Alleen de eigenaar kan het postvak koppelen." }, 403);
    }
    return await koppelInbox(beheerder, bedrijf, brevo, inboxDomein, url);
  }

  // Nog een keer lezen, als het de eerste keer misging. Alleen de uitleg van de
  // assistent wordt vervangen: wat de klant schreef, en of iemand het al heeft
  // afgehandeld, blijft zoals het was.
  if (verzoek.actie === "opnieuw-lezen") {
    const id = String(verzoek.antwoord_id ?? "");
    const { data: rij } = await beheerder
      .from("mail_antwoorden")
      .select("id,van_email,van_naam,onderwerp,tekst,mailing_id,doorgevoerd_op")
      .eq("company_id", bedrijf.id)
      .eq("id", id)
      .maybeSingle();
    if (!rij) return antwoord({ fout: "Dat bericht bestaat niet." }, 404);

    const gelezen = await leesBericht(beheerder, {
      companyId: bedrijf.id,
      bedrijfNaam: (bedrijf.mail_afzender_naam ?? "").trim() || bedrijf.name,
      vanEmail: rij.van_email,
      vanNaam: rij.van_naam,
      onderwerp: rij.onderwerp,
      tekst: rij.tekst,
      mailingId: rij.mailing_id,
    });
    await beheerder.from("mail_antwoorden").update(gelezen).eq("id", id);

    // Dezelfde regel als bij binnenkomst: was het nog niet doorgevoerd en weet
    // hij het nu zeker, dan alsnog zelf.
    // Automatisch doorvoeren komt in het rapport van de eigenaar; een
    // medewerker die opnieuw laat lezen start dat niet.
    if (
      medewerker.rol === "eigenaar" &&
      !rij.doorgevoerd_op &&
      bedrijf.mail_auto_doorvoeren === true &&
      gelezen.categorie === "overslaan" &&
      gelezen.zekerheid >= ZEKER_AUTOMATISCH &&
      gelezen.voorstel_adressen.length > 0 &&
      veiligVoorAutomatisch(gelezen.voorstel_maanden)
    ) {
      await voerOverslaanDoor(beheerder, {
        companyId: bedrijf.id,
        antwoordId: id,
        customerIds: gelezen.voorstel_adressen,
        maanden: gelezen.voorstel_maanden,
        automatisch: true,
        zekerheid: gelezen.zekerheid,
        door: null,
      });
    }
    return antwoord({ ok: gelezen.ai_fout === "", ai_fout: gelezen.ai_fout });
  }

  // Een voorstel met de hand doorvoeren. Langs dezelfde weg als automatisch,
  // zodat het in hetzelfde rapport komt en op dezelfde manier terugdraait.
  // Doorvoeren en terugdraaien veranderen de planning en komen in het rapport,
  // en dat rapport ziet alleen de eigenaar. Dan mag ook alleen de eigenaar dit.
  if ((verzoek.actie === "doorvoeren" || verzoek.actie === "terugdraaien") && medewerker.rol !== "eigenaar") {
    return antwoord({ fout: "Alleen de eigenaar kan dit doorvoeren of terugdraaien." }, 403);
  }

  if (verzoek.actie === "doorvoeren") {
    const id = String(verzoek.antwoord_id ?? "");
    const { data: rij } = await beheerder
      .from("mail_antwoorden")
      .select("id,voorstel_adressen,voorstel_maanden,zekerheid")
      .eq("company_id", bedrijf.id)
      .eq("id", id)
      .maybeSingle();
    if (!rij) return antwoord({ fout: "Dat bericht bestaat niet." }, 404);
    if ((rij.voorstel_adressen ?? []).length === 0 || (rij.voorstel_maanden ?? []).length === 0) {
      return antwoord({ fout: "Bij dit bericht staat geen voorstel." }, 400);
    }
    const uit = await voerOverslaanDoor(beheerder, {
      companyId: bedrijf.id,
      antwoordId: id,
      customerIds: rij.voorstel_adressen,
      maanden: rij.voorstel_maanden,
      automatisch: false,
      zekerheid: rij.zekerheid ?? null,
      door: medewerker.id,
    });
    return antwoord({ ok: true, aangepast: uit.aangepast });
  }

  if (verzoek.actie === "terugdraaien") {
    const uit = await draaiTerug(
      beheerder,
      bedrijf.id,
      String(verzoek.wijziging_id ?? ""),
      medewerker.id,
    );
    return uit.ok ? antwoord({ ok: true }) : antwoord({ fout: uit.fout }, 400);
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

  // Mag dit bedrijf vanaf zijn afzender versturen? Eerst dat, dan pas de lijst
  // opbouwen: wie niet mag, hoeft daar niet op te wachten.
  if (versturen) {
    const vooraf = await afzenderFout(beheerder, bedrijf.id, brevo, String(bedrijf.mail_afzender_email ?? ""));
    if (vooraf) return antwoord({ fout: vooraf }, 400);
  }

  // 3. De ontvangerslijst, uit de dag zelf.
  const ontvangers = await lijstVoorDag(beheerder, bedrijf.id, datum);

  if (!versturen) {
    const dekking = await telDekking(beheerder, bedrijf.id, datum);
    return antwoord({
      aantal: ontvangers.length,
      zonderEmail: dekking.zonderEmail,
      overgeslagen: dekking.overgeslagen,
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

  const mailboxAdres = await mailboxAdresVan(beheerder, bedrijf.id);
  const antwoordNaar = antwoordAdres(bedrijf, inboxDomein, mailboxAdres);

  // Een proef gaat naar jezelf, maar met de gegevens van de eerste echte
  // ontvanger erin: zo zie je wat er in de plaatshouders terechtkomt.
  const echt = ontvangers;

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

  const teVersturen: Ontvanger[] = test
    ? [
        {
          email: proefAdres,
          // De naam van de eerste echte ontvanger, zodat {{naam}} er in de
          // proef uitziet zoals bij een klant.
          naam: echt[0]?.naam || medewerker.naam || proefAdres,
          klant_id: null,
          adressen: echt[0]?.adressen ?? ["Voorbeeldstraat 1"],
        },
      ]
    : echt;

  if (teVersturen.length === 0) {
    return antwoord({ fout: "Er staat niemand met een e-mailadres op deze dag." }, 400);
  }

  let mailing: { id: string };
  if (test) {
    // Tellen en vastleggen in één stap, met een slot per bedrijf: tien
    // verzoeken tegelijk komen zo niet allemaal langs de telling.
    const { data: plek, error: plekFout } = await beheerder.rpc("proefmail_vastleggen", {
      bedrijf: bedrijf.id,
      dag: datum,
      onderwerp,
      tekst,
      door: medewerker.id,
    });
    if (plekFout) return antwoord({ fout: "Kon de proef niet vastleggen." }, 500);
    if (!plek) {
      return antwoord({ fout: "Je hebt het afgelopen uur al 10 proefmails verstuurd. Probeer het straks nog eens." }, 429);
    }
    mailing = { id: String(plek) };
  } else {
    const { data, error: mailingFout } = await beheerder
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
    if (mailingFout || !data) {
      return antwoord({ fout: "Kon de verzending niet vastleggen." }, 500);
    }
    mailing = data;
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
    antwoordadres: antwoordAdres(bedrijf, inboxDomein, mailboxAdres) ?? "",
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
 * Het aparte Brevo-antwoordadres blijft alleen nog voor bedrijven zonder
 * gekoppelde mailbox. (Antwoorden op oudere aankondigingen naar dat adres
 * komen via mail-inbox nog steeds binnen.)
 *
 * Staat geen van beide open, dan niets: een klant die op "beantwoorden" drukt
 * zou zijn mail anders zien terugkaatsen; dan liever gewoon naar de afzender.
 */
function antwoordAdres(
  bedrijf: Record<string, unknown>,
  inboxDomein: string,
  mailboxAdres: string,
): string | undefined {
  if (mailboxAdres) return mailboxAdres;
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

/**
 * De koppelingen voor binnenkomende post die Brevo al kent.
 *
 * Lukt het opvragen niet, dan komt Brevo's eigen uitleg mee in `fout`. Zonder
 * die tekst blijft er alleen "werkt niet" over, en daar kan niemand iets mee.
 */
async function inboundKoppelingen(
  brevo: string,
): Promise<{ lijst: BrevoWebhook[]; fout: "" } | { lijst: null; fout: string }> {
  try {
    const res = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
    });
    if (!res.ok) {
      const tekst = await res.text();
      // Heeft het account nog geen enkele koppeling, dan geeft Brevo geen lege
      // lijst maar een fout: "document_not_found". Dat is geen storing, dat is
      // precies het geval waarin we er een moeten aanmaken.
      if (res.status === 400 && tekst.includes("document_not_found")) {
        return { lijst: [], fout: "" };
      }
      return { lijst: null, fout: `${res.status} ${tekst.slice(0, 300)}`.trim() };
    }
    const json = (await res.json()) as { webhooks?: BrevoWebhook[] };
    return { lijst: json.webhooks ?? [], fout: "" };
  } catch (e) {
    return { lijst: null, fout: e instanceof Error ? e.message : "onbekende fout" };
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
 * De domeinen die Brevo van dit account kent, en of ze goedgekeurd zijn.
 * Brevo neemt alleen post aan op een domein dat hier geverifieerd staat —
 * een geverifieerd hoofddomein telt niet vanzelf voor een subdomein.
 */
async function brevoDomeinen(
  brevo: string,
): Promise<{ naam: string; geverifieerd: boolean; geauthenticeerd: boolean }[]> {
  try {
    const res = await fetch("https://api.brevo.com/v3/senders/domains", {
      headers: { "api-key": brevo.trim(), Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      domains?: { domain_name?: string; verified?: boolean; authenticated?: boolean }[];
    };
    return (json.domains ?? []).map((d) => ({
      naam: d.domain_name ?? "",
      geverifieerd: d.verified === true,
      geauthenticeerd: d.authenticated === true,
    }));
  } catch {
    return [];
  }
}

/** Eén DNS-regel zoals je hem bij je domeinbeheerder intypt. */
interface DnsRegel {
  /** Wat er in het veld "Naam" komt: het deel vóór het hoofddomein. */
  naam: string;
  type: string;
  waarde: string;
  /** Ziet Brevo hem al staan? */
  goed: boolean;
}

/**
 * Het domein zoals het bij de domeinbeheerder staat. Voor het subdomein
 * antwoord.deramensopperij.nl is dat deramensopperij.nl — en daar hoort het
 * veld "Naam" bij: "antwoord", niet de hele naam.
 */
function hoofdDomein(subdomein: string, bekend: { naam: string }[]): string {
  const sub = subdomein.toLowerCase();
  const ouder = bekend
    .map((d) => d.naam.toLowerCase())
    .filter((n) => n !== sub && sub.endsWith(`.${n}`))
    .sort((a, b) => b.length - a.length)[0];
  return ouder ?? sub.split(".").slice(-2).join(".");
}

/**
 * Brevo's DNS-regels omgezet naar wat je bij je domeinbeheerder invult.
 *
 * Brevo is niet eenduidig over de hostnaam: soms de volledige naam, soms "@"
 * voor het domein zelf, soms alleen het voorste stuk. Alle drie komen hier
 * uit op dezelfde vorm: het deel vóór het hoofddomein.
 */
function dnsRegelsUit(records: unknown, subdomein: string, hoofd: string): DnsRegel[] {
  if (!records || typeof records !== "object") return [];
  const lijst = Array.isArray(records) ? records : Object.values(records as Record<string, unknown>);
  const h = hoofd.toLowerCase();
  const sub = subdomein.toLowerCase();
  return lijst.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const x = r as Record<string, unknown>;
    const type = String(x["type"] ?? "").trim().toUpperCase();
    const waarde = String(x["value"] ?? "").trim();
    if (!type || !waarde) return [];
    // Het subdomein zoals het in het veld "Naam" staat: "antwoord".
    const subNaam = sub === h ? "@" : sub.slice(0, -(h.length + 1));
    const host = String(x["host_name"] ?? "").trim().replace(/\.$/, "").toLowerCase();
    let naam: string;
    if (!host || host === "@") {
      naam = subNaam;
    } else if (host === h || host.endsWith(`.${h}`)) {
      // Volledige naam: het hoofddomein eraf.
      naam = host === h ? "@" : host.slice(0, -(h.length + 1));
    } else if (subNaam !== "@" && (host === subNaam || host.endsWith(`.${subNaam}`))) {
      // Al ten opzichte van het hoofddomein ("_dmarc.antwoord"): zo laten.
      naam = host;
    } else {
      // Ten opzichte van het subdomein ("brevo1._domainkey"): subdomein erachter.
      naam = subNaam === "@" ? host : `${host}.${subNaam}`;
    }
    return [{ naam, type, waarde, goed: x["status"] === true }];
  });
}

/** De regels die Brevo voor een domein nog wil zien. */
async function brevoDomeinRegels(
  brevo: string,
  subdomein: string,
  hoofd: string,
): Promise<DnsRegel[]> {
  try {
    const res = await fetch(
      `https://api.brevo.com/v3/senders/domains/${encodeURIComponent(subdomein)}`,
      { headers: { "api-key": brevo.trim(), Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { dns_records?: unknown };
    return dnsRegelsUit(json.dns_records, subdomein, hoofd);
  } catch {
    return [];
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
  const koppelingen = brevo && inboxDomein ? (await inboundKoppelingen(brevo)).lijst : null;
  const domeinen = brevo ? await brevoDomeinen(brevo) : [];
  const bekend = domeinen.find((d) => d.naam.toLowerCase() === inboxDomein.toLowerCase());
  const dnsNodig =
    brevo && inboxDomein && bekend && !bekend.geauthenticeerd
      ? await brevoDomeinRegels(brevo, inboxDomein, hoofdDomein(inboxDomein, domeinen))
      : [];
  return {
    domein: inboxDomein,
    brevoKentDomein: !!bekend,
    brevoKeurtGoed: bekend?.geauthenticeerd === true,
    dnsNodig,
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

  const kop = {
    "api-key": brevo.trim(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Brevo neemt alleen post aan op een domein dat het zelf heeft goedgekeurd,
  // en een goedgekeurd hoofddomein telt niet voor een subdomein. Kent Brevo
  // het nog niet, dan voegen we het toe; Brevo geeft dan de regels die er bij
  // de domeinbeheerder bij moeten, en die toont de controle op de pagina.
  const domeinen = await brevoDomeinen(brevo);
  const bekend = domeinen.find((d) => d.naam.toLowerCase() === inboxDomein.toLowerCase());
  if (!bekend) {
    const res = await fetch("https://api.brevo.com/v3/senders/domains", {
      method: "POST",
      headers: kop,
      body: JSON.stringify({ name: inboxDomein }),
    });
    if (!res.ok) {
      return antwoord(
        { fout: `Brevo wilde ${inboxDomein} niet toevoegen: ${(await res.text()).slice(0, 300)}` },
        502,
      );
    }
    return antwoord(
      {
        fout:
          `${inboxDomein} staat nu bij Brevo, maar moet nog goedgekeurd worden. ` +
          "Klik op Controleer verbinding: daar staan de regels die er bij je domeinbeheerder bij moeten.",
      },
      409,
    );
  }
  if (!bekend.geauthenticeerd) {
    const res = await fetch(
      `https://api.brevo.com/v3/senders/domains/${encodeURIComponent(inboxDomein)}/authenticate`,
      { method: "PUT", headers: kop },
    );
    if (!res.ok) {
      return antwoord(
        {
          fout:
            `Brevo keurt ${inboxDomein} nog niet goed. Staan de regels uit de controle al bij je ` +
            `domeinbeheerder? Het kan een uur duren. (${(await res.text()).slice(0, 200)})`,
        },
        409,
      );
    }
  }

  const webhookUrl = `${supabaseUrl}/functions/v1/mail-inbox?sleutel=${sleutel}`;
  const opgevraagd = await inboundKoppelingen(brevo);
  if (opgevraagd.lijst === null) {
    return antwoord(
      { fout: `Brevo gaf de lijst met koppelingen niet: ${opgevraagd.fout}` },
      502,
    );
  }
  const bestaand = opgevraagd.lijst;
  const zelfde = bestaand.find(
    (w) => (w.domain ?? "").toLowerCase() === inboxDomein.toLowerCase(),
  );

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
  const mailboxAdres = await mailboxAdresVan(db, bedrijf["id"] as string);
  const afzenderNiet = await afzenderFout(db, bedrijf["id"] as string, brevo, afzenderEmail);
  if (afzenderNiet) return antwoord({ fout: afzenderNiet }, 400);

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
      antwoordNaar: antwoordAdres(bedrijf, inboxDomein, mailboxAdres),
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
