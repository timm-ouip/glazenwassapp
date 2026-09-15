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

import {
  antwoord,
  CORS,
  inStukjes,
  perGroepje,
  stuurMail,
  vulIn,
} from "../_gedeeld/mail.ts";
import { draaiTerug } from "../_gedeeld/doorvoeren.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";

interface Verzoek {
  /** Proefmail naar dit adres in plaats van naar jezelf. */
  proef_naar?: string;
  /**
   * `tellen` bouwt de lijst zonder te versturen, `versturen` doet allebei,
   * `controle` kijkt alleen of de verbinding met Brevo klopt, en
   * `terugdraaien` haalt een aanpassing uit het rapport weer weg.
   */
  actie: "tellen" | "versturen" | "controle" | "terugdraaien";
  /** De wasdag waarvan de adressen komen, als 'jjjj-mm-dd'. */
  datum: string;
  onderwerp: string;
  tekst: string;
  /** Proef: alleen naar jezelf, met de eerste echte ontvanger als voorbeeld. */
  test?: boolean;
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
    ["tellen", "versturen", "controle"].includes(String(verzoek.actie)) &&
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
  const antwoordNaar = antwoordAdres(mailboxAdres);

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
