/**
 * De aanmeldpagina, de kant van de server.
 *
 * Een bezoeker van /aanmelden is niet ingelogd en heeft dus geen enkel recht
 * op de database: elke tabel zit achter RLS op `company_id =
 * current_company_id()`, en dat leunt op `auth.uid()`. Daarom loopt alles hier
 * langs de service-role-client, die RLS omzeilt — hetzelfde patroon als
 * `team.functions.ts` bij het aanmaken van een bedrijf, maar zónder de
 * `requireSupabaseAuth`-middleware, want er is niemand om te herkennen.
 *
 * Dat betekent dat dit bestand de enige poortwachter is. Twee regels die
 * daarom nergens gebroken mogen worden:
 *
 *  1. De token uit de URL bepaalt het bedrijf. Elke query hieronder filtert op
 *     dat ene company_id — nooit op iets wat de bezoeker zelf meestuurt.
 *  2. Naar buiten gaat alleen "gelukt" of een algemene melding. Geen
 *     database-fout, geen id, geen aantal, en vooral geen antwoord op de vraag
 *     "is dit adres klant bij jullie". Zou de pagina dat verschil laten zien,
 *     dan kan iedereen met een postcodeboek de klantenlijst nalopen.
 */
import { netjesEmail, netjesPostcode, netjesStraat } from "@/lib/schoonschrift";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

/** Wat de bezoeker invult. Alles tekst; de server knipt en controleert zelf. */
export interface Inzending {
  token: string;
  naam: string;
  email: string;
  telefoon: string;
  postcode: string;
  straat: string;
  huisnummer: string;
  plaats: string;
  /** Het verborgen veld. Een mens ziet het niet en laat het dus leeg. */
  val?: string;
}

/**
 * Hoeveel tekens een veld mag zijn. Niet om netjes te doen, maar omdat een
 * open formulier op internet anders een gratis opslagplek is voor wie er een
 * boek in wil plakken.
 */
const MAXIMA: Record<keyof Omit<Inzending, "token" | "val">, number> = {
  naam: 120,
  email: 160,
  telefoon: 40,
  postcode: 12,
  straat: 120,
  huisnummer: 12,
  plaats: 80,
};

/** Hoeveel inzendingen er per tijdvak door mogen. */
const REM = {
  perIpMinuten: 5,
  perIpAantal: 3,
  perBedrijfMinuten: 60,
  perBedrijfAantal: 20,
};

/** De melding die de bezoeker ziet als de rem aanslaat of de link niet werkt. */
const ALGEMEEN = "Dit lukt nu niet. Probeer het later nog eens.";

function kort(waarde: string | undefined, max: number) {
  return (waarde ?? "").trim().slice(0, max);
}

/**
 * Het IP-adres van de bezoeker, voor de rem. De app draait op Cloudflare
 * Workers, dus `cf-connecting-ip` is daar het betrouwbare veld;
 * `x-forwarded-for` is de terugval voor lokaal draaien.
 */
function ipVan(): string {
  try {
    const h = getRequest().headers;
    const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "";
    return ip.trim().slice(0, 64);
  } catch {
    return "";
  }
}

function sleutel(naam: string) {
  return naam.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "3811cv" en "3811 CV" zijn dezelfde postcode. */
function postcodeSleutel(postcode: string) {
  return postcode.replace(/\s+/g, "").toUpperCase();
}

/** Splitst "12a" in het getal en de toevoeging — zoals `splitsHuisnummer`. */
function splitsNummer(tekst: string) {
  const m = tekst.trim().match(/^(\d+)\s*(.*)$/);
  if (!m) return null;
  return { nummer: Number(m[1]), toevoeging: (m[2] ?? "").trim() };
}

/**
 * De service-role-client. Alleen als type geïmporteerd: een gewone import zou
 * de geheime sleutel in de client-bundel trekken, en dit bestand eindigt op
 * `.functions.ts` — dat gaat mee naar de browser.
 */
type Admin = SupabaseClient<Database>;

/** Zoekt het bedrijf bij een token, of gooit de algemene melding. */
async function bedrijfBijToken(admin: Admin, token: string) {
  const { data } = await admin
    .from("companies")
    .select("id,name,aanmeld_aan")
    .eq("aanmeld_token", kort(token, 64))
    .maybeSingle();
  if (!data || !data.aanmeld_aan) throw new Error(ALGEMEEN);
  return data;
}

/**
 * De naam van het bedrijf, zodat de klant bovenaan de pagina ziet dat hij goed
 * zit. Meer geeft dit niet terug: geen id, geen wijken, geen aantallen.
 */
export const haalAanmeldPagina = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bedrijf = await bedrijfBijToken(supabaseAdmin, data.token);
    return { bedrijf: bedrijf.name };
  });

/**
 * Zoekt de adresregel die bij de inzending hoort. In deze orde, en bij twijfel
 * niets:
 *
 *  1. Hard op postcode + huisnummer. Dat is de zekerste, maar werkt alleen als
 *     de postcode op de adresregel al gevuld is — bij de geïmporteerde regels
 *     is dat niet altijd zo.
 *  2. Anders via de straatnaam, binnen de wijken waarvan de plaats klopt.
 *
 * Meer dan één treffer is óók niets: dezelfde straatnaam kan in twee wijken
 * staan, en dan is gokken erger dan het aan een mens voorleggen.
 */
async function zoekAdresRegel(
  admin: Admin,
  companyId: string,
  velden: { postcode: string; straat: string; plaats: string; nummer: number; toevoeging: string },
) {
  const toevoeging = sleutel(velden.toevoeging);
  const past = (c: { house_number: number; addition: string | null }) =>
    c.house_number === velden.nummer && sleutel(c.addition ?? "") === toevoeging;

  // 1. Op postcode.
  const pc = postcodeSleutel(velden.postcode);
  if (pc) {
    const { data } = await admin
      .from("customers")
      // Alleen adressen in een straat en wijk die er nog zijn: de adressen van
      // een weggegooide wijk blijven zelf staan en telden anders nog mee.
      .select(
        "id,house_number,addition,postcode,klant_id,aangemeld_op,inactief_op,inactief_reden,streets!inner(deleted_at,districts!inner(deleted_at))",
      )
      .eq("company_id", companyId)
      .eq("house_number", velden.nummer)
      .is("deleted_at", null)
      .is("streets.deleted_at", null)
      .is("streets.districts.deleted_at", null);
    const treffers = (data ?? []).filter(
      (c) => postcodeSleutel(c.postcode ?? "") === pc && past(c),
    );
    if (treffers.length === 1) return treffers[0]!;
  }

  // 2. Op straatnaam. Eerst de wijken waarvan de plaats klopt; staat er
  //    nergens een plaats (die kolom is jong), dan doen alle wijken mee.
  const naam = sleutel(velden.straat);
  if (!naam) return null;

  const { data: wijken } = await admin
    .from("districts")
    .select("id,plaats")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  const alle = wijken ?? [];
  const plaats = sleutel(velden.plaats);
  const passendeWijken = plaats ? alle.filter((w) => sleutel(w.plaats ?? "") === plaats) : [];
  const wijkIds = (passendeWijken.length > 0 ? passendeWijken : alle).map((w) => w.id);
  if (wijkIds.length === 0) return null;

  const { data: straten } = await admin
    .from("streets")
    .select("id,name,volledige_naam,district_id")
    .in("district_id", wijkIds)
    .is("deleted_at", null);
  const straatIds = (straten ?? [])
    .filter((s) => sleutel(s.name) === naam || sleutel(s.volledige_naam ?? "") === naam)
    .map((s) => s.id);
  if (straatIds.length === 0) return null;

  const { data: adressen } = await admin
    .from("customers")
    .select("id,house_number,addition,postcode,klant_id,aangemeld_op,inactief_op,inactief_reden")
    .in("street_id", straatIds)
    .eq("house_number", velden.nummer)
    .is("deleted_at", null);
  const treffers = (adressen ?? []).filter(past);
  return treffers.length === 1 ? treffers[0]! : null;
}

/**
 * Neemt de inzending aan. Geeft altijd hetzelfde antwoord terug, of het adres
 * nu bekend was of niet — zie de kop van dit bestand.
 */
export const dienGegevensIn = createServerFn({ method: "POST" })
  .validator((data: Inzending) => data)
  .handler(async ({ data }) => {
    // Een robot vult het verborgen veld. Geen foutmelding: dan weet hij wat
    // hem verraadde. Hij krijgt hetzelfde bedankje als een mens, en wij niks.
    if ((data.val ?? "").trim() !== "") return { ok: true as const };

    // Wat een klant zelf typt, schrijven we net zo netjes weg als wat wij
    // zelf invullen: "1234ab" wordt "1234 AB", "kerkstraat" wordt
    // "Kerkstraat" en een e-mailadres gaat in kleine letters.
    const naam = kort(data.naam, MAXIMA.naam);
    const email = netjesEmail(kort(data.email, MAXIMA.email));
    const telefoon = kort(data.telefoon, MAXIMA.telefoon);
    const postcode = netjesPostcode(kort(data.postcode, MAXIMA.postcode));
    const straat = netjesStraat(kort(data.straat, MAXIMA.straat));
    const huisnummer = kort(data.huisnummer, MAXIMA.huisnummer);
    const plaats = kort(data.plaats, MAXIMA.plaats);

    if (!naam) throw new Error("Vul je naam in.");
    // Eén van de twee is genoeg. Er staat niets op het formulier dat dat
    // uitlegt: wie beide invult is de bedoeling, en een regeltje dat zegt dat
    // één mag, nodigt uit om er één weg te laten.
    if (!telefoon && !email) throw new Error("Vul een telefoonnummer of een e-mailadres in.");
    const nr = splitsNummer(huisnummer);
    if (!straat || !nr) throw new Error("Vul je straat en huisnummer in.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bedrijf = await bedrijfBijToken(supabaseAdmin, data.token);
    const ip = ipVan();

    // De rem. Twee tellingen: per bezoeker tegen driftig doorklikken, per
    // bedrijf tegen een hele lijst die erdoor geduwd wordt.
    const sinds = (minuten: number) => new Date(Date.now() - minuten * 60_000).toISOString();
    if (ip) {
      const { count } = await supabaseAdmin
        .from("aanmeldingen")
        .select("id", { count: "exact", head: true })
        .eq("company_id", bedrijf.id)
        .eq("ip", ip)
        .gte("created_at", sinds(REM.perIpMinuten));
      if ((count ?? 0) >= REM.perIpAantal) throw new Error(ALGEMEEN);
    }
    const { count: perBedrijf } = await supabaseAdmin
      .from("aanmeldingen")
      .select("id", { count: "exact", head: true })
      .eq("company_id", bedrijf.id)
      .gte("created_at", sinds(REM.perBedrijfMinuten));
    if ((perBedrijf ?? 0) >= REM.perBedrijfAantal) throw new Error(ALGEMEEN);

    const adres = await zoekAdresRegel(supabaseAdmin, bedrijf.id, {
      postcode,
      straat,
      plaats,
      nummer: nr.nummer,
      toevoeging: nr.toevoeging,
    });

    /** De klant die er vóór deze aanmelding aan het adres hing, zoals hij was. */
    let bestaandeVooraf: {
      id: string;
      naam: string;
      email: string;
      telefoon: string;
      straat: string;
      huisnummer: string;
      postcode: string;
      plaats: string;
    } | null = null;
    let soort: "gekoppeld" | "wijziging" | "onbekend" | "bekend_adres" = "onbekend";
    let klantId: string | null = null;
    /** Wat er automatisch veranderde, om het precies terug te kunnen draaien
     *  (zie de migratie aanmelding_terugdraaien). */
    let automatisch: Record<string, unknown> | null = null;

    if (adres?.inactief_op) {
      // Dit huis kennen we: iemand stopte of verhuisde. Niets automatisch
      // koppelen; de eigenaar ziet de oude gegevens als voorstel. Bij "gestopt"
      // hoort de vorige klant er nog bij, bij "verhuisd" ligt die in de prullenbak.
      soort = "bekend_adres";
      klantId = adres.inactief_reden === "gestopt" ? adres.klant_id : null;
    } else if (adres) {
      // Staan er al gegevens bij dit adres? Dan wordt er niets aangeraakt.
      // Iemand die een postcode kan typen mag niet het telefoonnummer van een
      // bestaande klant kunnen overschrijven.
      let bestaande: {
        id: string;
        naam: string;
        email: string;
        telefoon: string;
        straat: string;
        huisnummer: string;
        postcode: string;
        plaats: string;
      } | null = null;
      if (adres.klant_id) {
        const { data: k } = await supabaseAdmin
          .from("klanten")
          .select("id,naam,email,telefoon,straat,huisnummer,postcode,plaats")
          .eq("id", adres.klant_id)
          .eq("company_id", bedrijf.id)
          .is("deleted_at", null)
          .maybeSingle();
        bestaande = k ?? null;
        bestaandeVooraf = bestaande;
      }
      const heeftGegevens =
        !!bestaande &&
        (bestaande.naam.trim() !== "" ||
          bestaande.email.trim() !== "" ||
          bestaande.telefoon.trim() !== "");

      if (heeftGegevens) {
        soort = "wijziging";
        klantId = bestaande!.id;
      } else {
        // Het adres is nog leeg: de gegevens komen er meteen bij. Wel open in
        // Te doen (niet stil op klaar), met Klopt en Ongedaan maken.
        const velden = { naam, email, telefoon, straat, huisnummer, postcode, plaats };
        const postcodeGevuld = !!postcode && !(adres.postcode ?? "").trim();
        let nieuweKlant: string | null = null;
        let kon = true;
        if (bestaande) {
          const { error } = await supabaseAdmin
            .from("klanten")
            .update(velden)
            .eq("id", bestaande.id)
            .eq("company_id", bedrijf.id);
          if (error) {
            console.error("aanmelding: klant bijwerken", error.message);
            kon = false;
          } else klantId = bestaande.id;
        } else {
          const { data: nieuw, error } = await supabaseAdmin
            .from("klanten")
            .insert({ ...velden, company_id: bedrijf.id })
            .select("id")
            .single();
          if (error || !nieuw) {
            console.error("aanmelding: klant aanmaken", error?.message);
            kon = false;
          } else klantId = nieuweKlant = nieuw.id;
        }
        if (kon) {
          // Alleen als er nog steeds dezelfde (of geen) klant aan hangt: komen
          // er twee aanmeldingen vlak na elkaar binnen, dan wint de eerste en
          // blijft er geen losse klant achter.
          let vraag = supabaseAdmin
            .from("customers")
            .update({
              klant_id: klantId,
              aangemeld_op: new Date().toISOString(),
              // De postcode alleen bijvullen als hij nog leeg was: wat er staat
              // komt van het Kadaster en is betrouwbaarder dan een typefout.
              ...(postcodeGevuld ? { postcode } : {}),
            })
            .eq("id", adres.id)
            .eq("company_id", bedrijf.id);
          vraag = adres.klant_id
            ? vraag.eq("klant_id", adres.klant_id)
            : vraag.is("klant_id", null);
          const { data: geraakt, error } = await vraag.select("id");
          if (error || (geraakt ?? []).length === 0) {
            console.error(
              "aanmelding: adres koppelen",
              error?.message ?? "adres was intussen veranderd",
            );
            kon = false;
          }
        }
        if (kon) {
          soort = "gekoppeld";
          automatisch = {
            klant_nieuw: nieuweKlant !== null,
            vorige_klant_id: adres.klant_id ?? null,
            vorige_klant: bestaande
              ? {
                  naam: bestaande.naam,
                  email: bestaande.email,
                  telefoon: bestaande.telefoon,
                  straat: bestaande.straat,
                  huisnummer: bestaande.huisnummer,
                  postcode: bestaande.postcode,
                  plaats: bestaande.plaats,
                }
              : null,
            postcode_gevuld: postcodeGevuld,
            vorige_aangemeld_op: adres.aangemeld_op ?? null,
          };
        } else {
          // Niet gelukt: half gekoppeld is erger dan niet. De net gemaakte
          // klant weg, of de oude (lege) gegevens terug; een mens handelt het
          // af, net als een onbekend adres.
          await draaiKlantTerug(nieuweKlant, bestaande);
          soort = "onbekend";
          klantId = null;
        }
      }
    }

    /** Een automatisch gemaakte of bijgewerkte klant terug zoals hij was. */
    async function draaiKlantTerug(
      nieuw: string | null,
      oud: {
        id: string;
        naam: string;
        email: string;
        telefoon: string;
        straat: string;
        huisnummer: string;
        postcode: string;
        plaats: string;
      } | null,
    ) {
      const { error } = nieuw
        ? await supabaseAdmin
            .from("klanten")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", nieuw)
            .eq("company_id", bedrijf.id)
        : oud
          ? await supabaseAdmin
              .from("klanten")
              .update((({ id: _, ...rest }) => rest)(oud))
              .eq("id", oud.id)
              .eq("company_id", bedrijf.id)
          : { error: null };
      if (error) console.error("aanmelding: klant terugzetten mislukt", error.message);
    }

    const { error: logFout } = await supabaseAdmin.from("aanmeldingen").insert({
      company_id: bedrijf.id,
      customer_id: adres?.id ?? null,
      klant_id: klantId,
      naam,
      email,
      telefoon,
      postcode,
      straat,
      huisnummer: String(nr.nummer),
      toevoeging: nr.toevoeging,
      plaats,
      soort,
      // Ook een automatisch gekoppelde blijft open, tot iemand hem nakeek.
      status: "open",
      automatisch: automatisch as Json | null,
      ip,
    });
    if (logFout) {
      console.error("aanmelding: vastleggen", logFout.message);
      // Zonder aanmelding in Te doen is een automatische koppeling onzichtbaar
      // en niet terug te draaien. Dan liever niets: de koppeling eraf.
      if (soort === "gekoppeld" && adres && automatisch) {
        const au = automatisch as {
          vorige_klant_id: string | null;
          vorige_aangemeld_op: string | null;
          postcode_gevuld: boolean;
          klant_nieuw: boolean;
        };
        const { error: adresFout } = await supabaseAdmin
          .from("customers")
          .update({
            klant_id: au.vorige_klant_id,
            aangemeld_op: au.vorige_aangemeld_op,
            ...(au.postcode_gevuld ? { postcode: "" } : {}),
          })
          .eq("id", adres.id)
          .eq("company_id", bedrijf.id);
        if (adresFout) console.error("aanmelding: adres terugzetten mislukt", adresFout.message);
        // De klant: `bestaande` is nog precies wat er vóór de aanmelding stond.
        const vooraf = adres.klant_id ? bestaandeVooraf : null;
        await draaiKlantTerug(au.klant_nieuw ? klantId : null, vooraf);
      }
      throw new Error(ALGEMEEN);
    }

    return { ok: true as const };
  });
