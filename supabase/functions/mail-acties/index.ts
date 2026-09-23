/**
 * Iets doen met een mail: gelezen markeren, weggooien, terugzetten, of een
 * mail versturen.
 *
 * Alles hier gebeurt eerst op de mailserver en pas daarna in Paaltje Systems. De server
 * is de baas: als het daar niet lukt, laten we in Paaltje Systems ook niets veranderen,
 * anders zie je op je telefoon iets anders dan hier.
 *
 * Alleen de eigenaar, net als het lezen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import { maakImap, uitlegFout } from "../_gedeeld/ophalen.ts";
import { MogelijkVerstuurd } from "../_gedeeld/smtp.ts";
import {
  type Adres,
  type Box,
  type Db,
  type ImapClient,
  adressenUit,
  haalBijlagen,
  mapMetRol,
  metImap,
  plekVan,
  UUID,
  VERANDERD,
  verplaats,
  verstuur,
} from "../_gedeeld/mailwerk.ts";
import { type StopReden, voerOverslaanDoor, voerStoppenDoor } from "../_gedeeld/doorvoeren.ts";
import { heeftRecht } from "../_gedeeld/rechten.ts";
import { bevestigKlant, draaiKlantgegevensTerug } from "../_gedeeld/klantgegevens-acties.ts";

interface Verzoek {
  actie:
    | "gelezen"
    | "markeren"
    | "verplaatsen"
    | "map-maken"
    | "map-hernoemen"
    | "map-verwijderen"
    | "bijlage"
    | "bulk"
    | "altijd-spam"
    | "spamregel-weg"
    | "herinneren"
    | "inplannen"
    | "gepland-annuleren"
    | "weggooien"
    | "terugzetten"
    | "versturen"
    | "afhandelen"
    | "opnieuw-lezen"
    | "overslaan-doorvoeren"
    | "klant-koppelen"
    | "klantgegevens-terugdraaien"
    | "stoppen-doorvoeren"
    | "stoppen-planning";
  /** Bij stoppen-doorvoeren: waarom de klant stopt. */
  reden?: string;
  /** Bij stoppen-doorvoeren: ook de wasdagen vanaf morgen van de planning halen (vandaag blijft staan). */
  planning_weg?: boolean;
  /** Bij klant-koppelen: welke klant. Bij versturen: in wiens dossier de mail komt. */
  klant_id?: string;
  /** Bij afhandelen: klaar (true) of toch weer open (false). */
  klaar?: boolean;
  bericht_id?: string;
  gelezen?: boolean;
  /** Bij verplaatsen: de map waar de mail heen gaat. */
  map_id?: string;
  /** Bij map-maken: de naam van de nieuwe map. */
  naam?: string;
  /** Bij bijlage: welke (volgorde zoals in `berichten.bijlagen`). */
  index?: number;
  /** Bij bulk: welke mails, en wat ermee. */
  bericht_ids?: string[];
  doe?: "gelezen" | "ongelezen" | "vlag" | "vlag-eraf" | "afhandelen" | "weggooien" | "verplaatsen";
  /** Bij spamregel-weg: het afzenderadres. */
  email?: string;
  /** Bij herinneren en inplannen: wanneer (ISO), of leeg om de herinnering weg te halen. */
  op?: string | null;
  /** Bij gepland-annuleren. */
  gepland_id?: string;
  /** Bij versturen en inplannen: bijlagen. */
  bijlagen_van?: string;
  bijlagen?: { naam: string; type: string; inhoud: string }[];
  /** Bij markeren: vlag erop (true) of eraf (false). */
  gemarkeerd?: boolean;
  aan?: Adres[];
  cc?: Adres[];
  onderwerp?: string;
  tekst?: string;
  /** Bij versturen: het bericht waarop dit een antwoord is. */
  antwoord_op?: string;
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
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await heeftRecht(db, medewerker, "mail_lezen"))) {
    return antwoord({ fout: "Je hebt geen recht om met de mail te werken." }, 403);
  }

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  // Versturen vraagt een eigen recht. Wat de planning verandert (doorvoeren,
  // stoppen) komt in het rapport van de eigenaar, en blijft daarom bij de
  // eigenaar. Een klant koppelen, of terugdraaien wat Paaltje Systems bij een klant
  // invulde, mag ook wie klanten bewerkt.
  // Een map maken verandert de echte mailbox (ook op de telefoon): dat is meer dan lezen.
  if (
    ["versturen", "inplannen", "gepland-annuleren", "map-maken", "map-hernoemen", "map-verwijderen"].includes(
      verzoek.actie,
    ) &&
    !(await heeftRecht(db, medewerker, "mail_versturen"))
  ) {
    return antwoord(
      {
        fout:
          verzoek.actie.startsWith("map-")
            ? "Je hebt geen recht om mappen te beheren."
            : "Je hebt geen recht om mail te versturen.",
      },
      403,
    );
  }
  const alleenEigenaar = ["overslaan-doorvoeren", "stoppen-doorvoeren", "stoppen-planning"];
  if (alleenEigenaar.includes(String(verzoek.actie)) && medewerker.rol !== "eigenaar") {
    return antwoord({ fout: "Alleen de eigenaar kan dit doorvoeren." }, 403);
  }
  const klantActies = ["klant-koppelen", "klantgegevens-terugdraaien"];
  if (klantActies.includes(String(verzoek.actie)) && !(await heeftRecht(db, medewerker, "klanten_bewerken"))) {
    return antwoord({ fout: "Je hebt geen recht om klanten te bewerken." }, 403);
  }

  // De mailbox van dít bedrijf. Alles hieronder hangt daaraan, zodat een
  // bericht-id van een ander bedrijf nooit iets doet.
  const { data: box } = await db
    .from("mailboxen")
    .select("id,company_id,adres,imap_host,imap_poort,smtp_host,smtp_poort,status")
    .eq("company_id", medewerker.company_id)
    .maybeSingle();
  if (!box || box.status === "uit") {
    return antwoord({ fout: "Er is geen mailbox gekoppeld." }, 400);
  }
  // Een geweigerde login niet bij elke klik opnieuw proberen: te veel foute
  // pogingen en de provider zet het account op slot.
  if (box.status === "fout") {
    return antwoord({ fout: "Koppel de mailbox opnieuw in Instellingen." }, 400);
  }

  const { data: geheim } = await db
    .from("mailbox_geheimen")
    .select("versleuteld,iv")
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (!geheim) return antwoord({ fout: "Koppel de mailbox opnieuw in Instellingen." }, 400);
  let wachtwoord: string;
  try {
    wachtwoord = await ontsleutel(geheim.versleuteld, geheim.iv);
  } catch {
    return antwoord({ fout: "Koppel de mailbox opnieuw in Instellingen." }, 400);
  }

  try {
    switch (verzoek.actie) {
      case "gelezen":
        return await zetGelezen(db, box, wachtwoord, verzoek);
      case "markeren":
        return await zetGemarkeerd(db, box, wachtwoord, verzoek);
      case "verplaatsen":
        return await verplaats(db, box, wachtwoord, String(verzoek.bericht_id ?? ""), {
          naar: String(verzoek.map_id ?? ""),
        });
      case "map-maken":
        return await maakMap(db, box, wachtwoord, String(verzoek.naam ?? ""));
      case "map-hernoemen":
        return await hernoemMap(db, box, wachtwoord, String(verzoek.map_id ?? ""), String(verzoek.naam ?? ""));
      case "map-verwijderen":
        return await verwijderMap(db, box, wachtwoord, String(verzoek.map_id ?? ""));
      case "bijlage": {
        const uit = await haalBijlagen(db, box, wachtwoord, String(verzoek.bericht_id ?? ""), Number(verzoek.index));
        if ("fout" in uit) return antwoord({ fout: uit.fout }, 400);
        return antwoord({ ok: true, bijlage: uit.bijlagen[0] });
      }
      case "bulk":
        return await bulk(db, box, wachtwoord, verzoek);
      case "altijd-spam":
        return await altijdSpam(db, box, wachtwoord, String(verzoek.bericht_id ?? ""));
      case "spamregel-weg": {
        const email = String(verzoek.email ?? "").trim().toLowerCase();
        const { error } = await db.from("mail_regels").delete().eq("mailbox_id", box.id).eq("van_email", email);
        if (error) throw new Error(`Regel weghalen: ${error.message}`);
        return antwoord({ ok: true });
      }
      case "herinneren":
        return await herinner(db, box, String(verzoek.bericht_id ?? ""), verzoek.op ?? null);
      case "inplannen":
        return await planIn(db, box, medewerker.id, verzoek);
      case "gepland-annuleren": {
        const id = String(verzoek.gepland_id ?? "");
        if (!UUID.test(id)) return antwoord({ fout: "Die geplande mail bestaat niet." }, 404);
        const { data, error } = await db
          .from("geplande_mails")
          .update({ status: "geannuleerd" })
          .eq("id", id)
          .eq("mailbox_id", box.id)
          .eq("status", "wacht")
          .select("id");
        if (error) throw new Error(`Annuleren: ${error.message}`);
        if (!data?.length) return antwoord({ fout: "Die mail is al verstuurd of geannuleerd." }, 409);
        return antwoord({ ok: true });
      }
      case "weggooien":
        return await verplaats(db, box, wachtwoord, String(verzoek.bericht_id ?? ""), "weg");
      case "terugzetten":
        return await verplaats(db, box, wachtwoord, String(verzoek.bericht_id ?? ""), "terug");
      case "versturen":
        return await verstuur(db, box, wachtwoord, verzoek);
      case "afhandelen":
        return await handelAf(db, box, String(verzoek.bericht_id ?? ""), verzoek.klaar !== false);
      case "opnieuw-lezen":
        return await leesOpnieuw(db, box, String(verzoek.bericht_id ?? ""));
      case "overslaan-doorvoeren":
        return await overslaanDoorvoeren(db, box, String(verzoek.bericht_id ?? ""), medewerker.id);
      case "stoppen-doorvoeren": {
        const reden = verzoek.reden;
        if (reden !== "verhuisd" && reden !== "gestopt") {
          return antwoord({ fout: "Kies of de klant verhuisd is of gestopt." }, 400);
        }
        return await stoppenDoorvoeren(
          db,
          box,
          String(verzoek.bericht_id ?? ""),
          medewerker.id,
          reden,
          verzoek.planning_weg === true,
        );
      }
      case "stoppen-planning":
        return await stoppenPlanning(db, box, String(verzoek.bericht_id ?? ""));
      case "klant-koppelen": {
        const uit = await bevestigKlant(
          db,
          { kanaal: "mail", companyId: box.company_id, mailboxId: box.id },
          String(verzoek.bericht_id ?? ""),
          String(verzoek.klant_id ?? ""),
        );
        return antwoord(uit.body, uit.status);
      }
      case "klantgegevens-terugdraaien": {
        const uit = await draaiKlantgegevensTerug(
          db,
          { kanaal: "mail", companyId: box.company_id, mailboxId: box.id },
          String(verzoek.bericht_id ?? ""),
        );
        return antwoord(uit.body, uit.status);
      }
      default:
        return antwoord({ fout: "Onbekende actie." }, 400);
    }
  } catch (e) {
    if (e instanceof MogelijkVerstuurd) {
      return antwoord({ fout: e.message, mogelijk_verstuurd: true }, 502);
    }
    const { tekst } = uitlegFout(e);
    console.error(`mail-acties ${verzoek.actie}:`, tekst);
    return antwoord({ fout: tekst }, 502);
  }
});

async function zetGelezen(
  db: Db,
  box: Box,
  wachtwoord: string,
  verzoek: Verzoek,
  verbinding?: ImapClient,
): Promise<Response> {
  const plek = await plekVan(db, box, String(verzoek.bericht_id ?? ""));
  if (!plek) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const gelezen = verzoek.gelezen !== false;

  const gelukt = await metImap(box, wachtwoord, async (client) => {
    const lock = await client.getMailboxLock(plek.pad);
    try {
      if (Number(client.mailbox && client.mailbox.uidValidity) !== plek.uidvalidity) return false;
      const bereik = String(plek.uid);
      if (gelezen) await client.messageFlagsAdd(bereik, ["\\Seen"], { uid: true });
      else await client.messageFlagsRemove(bereik, ["\\Seen"], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  }, verbinding);
  if (!gelukt) return antwoord({ fout: VERANDERD }, 409);

  const { error } = await db.from("berichten").update({ gelezen }).eq("id", plek.id);
  // Op de server is het gelukt; de volgende ophaalronde trekt Paaltje Systems gelijk.
  if (error) console.error("gelezen bijwerken:", error.message);
  return antwoord({ ok: true });
}

/** Een vlag op de mail, net als in een mailprogramma (op de server \Flagged). */
async function zetGemarkeerd(
  db: Db,
  box: Box,
  wachtwoord: string,
  verzoek: Verzoek,
  verbinding?: ImapClient,
): Promise<Response> {
  const plek = await plekVan(db, box, String(verzoek.bericht_id ?? ""));
  if (!plek) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const gemarkeerd = verzoek.gemarkeerd !== false;

  const gelukt = await metImap(box, wachtwoord, async (client) => {
    const lock = await client.getMailboxLock(plek.pad);
    try {
      if (Number(client.mailbox && client.mailbox.uidValidity) !== plek.uidvalidity) return false;
      const bereik = String(plek.uid);
      if (gemarkeerd) await client.messageFlagsAdd(bereik, ["\\Flagged"], { uid: true });
      else await client.messageFlagsRemove(bereik, ["\\Flagged"], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  }, verbinding);
  if (!gelukt) return antwoord({ fout: VERANDERD }, 409);

  const { error } = await db.from("berichten").update({ gemarkeerd }).eq("id", plek.id);
  if (error) console.error("gemarkeerd bijwerken:", error.message);
  return antwoord({ ok: true });
}

/** Een nieuwe map in de mailbox, net als in een mailprogramma. */
async function maakMap(db: Db, box: Box, wachtwoord: string, ruweNaam: string): Promise<Response> {
  const naam = ruweNaam.replace(/\s+/g, " ").trim();
  if (!naam) return antwoord({ fout: "Geef de map een naam." }, 400);
  if (naam.length > 60) return antwoord({ fout: "Die naam is te lang (hooguit 60 tekens)." }, 400);
  // Deze tekens betekenen iets voor de mailserver (submap, zoeken).
  if (/[/\\.*%"]/.test(naam) || naam.toUpperCase() === "INBOX") {
    return antwoord({ fout: "Gebruik in de naam geen / . \\ * % of aanhalingstekens." }, 400);
  }

  const pad = await metImap(box, wachtwoord, async (client) => {
    const bestaat = (await client.list()).some((m) => m.path.toLowerCase() === naam.toLowerCase());
    if (bestaat) return null;
    const res = await client.mailboxCreate(naam);
    // Meteen abonneren: anders tonen sommige mailprogramma's hem niet.
    try {
      await client.mailboxSubscribe(res.path);
    } catch {
      // niet erg
    }
    return res.path;
  });
  if (!pad) return antwoord({ fout: "Er is al een map met die naam." }, 409);

  const { data, error } = await db
    .from("mail_mappen")
    .upsert({ company_id: box.company_id, mailbox_id: box.id, pad, rol: "overig" }, { onConflict: "mailbox_id,pad" })
    .select("id")
    .single();
  if (error) throw new Error(`Map bewaren: ${error.message}`);
  return antwoord({ ok: true, map_id: data.id });
}

/**
 * Klaar met een mail (of toch niet). Alleen in Paaltje Systems: op de mailserver
 * bestaat "afgehandeld" niet.
 */
async function handelAf(db: Db, box: Box, id: string, klaar: boolean): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data, error } = await db
    .from("berichten")
    // Wat jij afhandelt is van jou: opnieuw laten lezen neemt het niet terug.
    // Afhandelen haalt ook een herinnering weg: die heeft zijn werk gedaan.
    .update({
      afgehandeld_op: klaar ? new Date().toISOString() : null,
      afgehandeld_door_paaltje: false,
      ...(klaar ? { herinner_op: null } : {}),
    })
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .select("id");
  if (error) throw new Error(`Afhandelen: ${error.message}`);
  if (!data?.length) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  return antwoord({ ok: true });
}

/**
 * Paaltje leest de mail nog een keer, bij de volgende ronde. Niet terwijl hij
 * er al mee bezig is. Wat hij al deed (een doorgevoerde overslaan, een
 * aanmelding) staat in `voorstel` en gebeurt niet nog eens.
 */
async function leesOpnieuw(db: Db, box: Box, id: string): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data, error } = await db
    .from("berichten")
    .update({ paaltje_status: "wacht", ai_fout: "", paaltje_pogingen: 0 })
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .eq("richting", "in")
    .neq("paaltje_status", "bezig")
    .select("id");
  if (error) throw new Error(`Opnieuw lezen: ${error.message}`);
  if (!data?.length) return antwoord({ fout: "Paaltje is hier al mee bezig." }, 409);
  // Zette Paaltje hem zelf op afgehandeld (geen klantmail), dan gaat dat eraf:
  // misschien leest hij hem nu wel als klantmail.
  const { error: afFout } = await db
    .from("berichten")
    .update({ afgehandeld_op: null, afgehandeld_door_paaltje: false })
    .eq("id", id)
    .eq("afgehandeld_door_paaltje", true);
  if (afFout) console.error("afgehandeld terugzetten:", afFout.message);
  return antwoord({ ok: true });
}

/**
 * Het overslaan-voorstel van Paaltje met de hand doorvoeren. Langs dezelfde
 * weg als automatisch, zodat het in hetzelfde rapport komt en op dezelfde
 * manier terug te draaien is.
 */
async function overslaanDoorvoeren(db: Db, box: Box, id: string, door: string): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data: rij, error } = await db
    .from("berichten")
    .select("id,company_id,voorstel")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  if (!rij) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const voorstel = (rij.voorstel ?? {}) as { overslaan?: { maanden?: string[]; adressen?: string[]; doorgevoerd?: boolean } };
  const o = voorstel.overslaan;
  if (!o?.maanden?.length || !o.adressen?.length) {
    return antwoord({ fout: "Bij deze mail staat geen voorstel om over te slaan." }, 400);
  }
  if (o.doorgevoerd) return antwoord({ ok: true, aangepast: 0 });

  // Pakken: alleen als het nog niet doorgevoerd is en Paaltje er niet net mee
  // bezig is. Twee tabbladen tegelijk voeren het zo niet twee keer door.
  const { data: gepakt, error: pakFout } = await db
    .from("berichten")
    .update({ doorgevoerd_op: new Date().toISOString(), doorgevoerd_automatisch: false })
    .eq("id", rij.id)
    .is("doorgevoerd_op", null)
    .neq("paaltje_status", "bezig")
    .select("id");
  if (pakFout) throw new Error(`Doorvoeren: ${pakFout.message}`);
  if (!gepakt?.length) {
    return antwoord({ fout: "Dit is al doorgevoerd, of Paaltje leest de mail net opnieuw." }, 409);
  }

  const uit = await voerOverslaanDoor(db, {
    companyId: box.company_id,
    berichtId: rij.id,
    customerIds: o.adressen,
    maanden: o.maanden,
    automatisch: false,
    zekerheid: null,
    door,
  });
  if (uit.mislukt > 0) {
    // Niet (helemaal) gelukt: slot eraf, zodat het opnieuw kan. Nog een keer
    // doorvoeren slaat de adressen die al klopten vanzelf over.
    await db.from("berichten").update({ doorgevoerd_op: null }).eq("id", rij.id);
    return antwoord({ fout: "Niet alle adressen konden aangepast worden. Probeer het opnieuw." }, 500);
  }
  const { error: bewaarFout } = await db
    .from("berichten")
    .update({ voorstel: { ...voorstel, overslaan: { ...o, doorgevoerd: true } } })
    .eq("id", rij.id);
  if (bewaarFout) console.error("voorstel bijwerken:", bewaarFout.message);
  return antwoord({ ok: true, aangepast: uit.aangepast });
}

/** "jjjj-mm-dd" in Nederlandse tijd — de server draait in UTC. */
function vandaagInNederland(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Hoeveel losse dagen `stoppen-planning` hooguit noemt. */
const MAX_DAGEN = 10;

/**
 * Wat er van de planning af zou gaan als je het stopvoorstel doorvoert: hoeveel
 * wasdagen vanaf morgen (vandaag blijft altijd staan) er voor die adressen staan, en op welke dagen. Zo zie
 * je vóór het klikken of "ook van de planning halen" iets uitmaakt.
 *
 * Alleen adressen die nog actief zijn: de rest verandert bij doorvoeren niet.
 */
async function stoppenPlanning(db: Db, box: Box, id: string): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data: rij, error } = await db
    .from("berichten")
    .select("id,voorstel")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  if (!rij) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const voorstel = (rij.voorstel ?? {}) as { stoppen?: { adressen?: string[] } };
  const gevraagd = (voorstel.stoppen?.adressen ?? []).filter((a) => UUID.test(String(a)));
  if (gevraagd.length === 0) return antwoord({ fout: "Bij deze mail staat geen stopvoorstel." }, 400);

  const { data: actief, error: adresFout } = await db
    .from("customers")
    .select("id")
    .eq("company_id", box.company_id)
    .is("deleted_at", null)
    .is("inactief_op", null)
    .in("id", gevraagd);
  if (adresFout) throw new Error(`Adressen opzoeken: ${adresFout.message}`);
  const adressen = (actief ?? []).map((c: { id: string }) => c.id);
  if (adressen.length === 0) return antwoord({ aantal: 0, dagen: [] });

  const { data: regels, error: planFout } = await db
    .from("wasdag_regels")
    .select("datum")
    .eq("company_id", box.company_id)
    .in("customer_id", adressen)
    .gt("datum", vandaagInNederland())
    .order("datum", { ascending: true })
    .limit(500);
  if (planFout) throw new Error(`Planning opzoeken: ${planFout.message}`);
  // Twee panden op dezelfde dag is één dag: tel de datums, niet de regels.
  const alleDagen = [...new Set((regels ?? []).map((r: { datum: string }) => r.datum))];
  return antwoord({ aantal: alleDagen.length, dagen: alleDagen.slice(0, MAX_DAGEN) });
}

/**
 * Het stopvoorstel van Paaltje uitvoeren: de adressen van de klant worden
 * inactief (verhuisd of gestopt), met een regel in het rapport (daar terug te
 * draaien).
 */
async function stoppenDoorvoeren(
  db: Db,
  box: Box,
  id: string,
  door: string,
  reden: StopReden,
  planningWeg: boolean,
): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data: rij, error } = await db
    .from("berichten")
    .select("id,voorstel,paaltje_status")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  if (!rij) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const voorstel = (rij.voorstel ?? {}) as { stoppen?: { adressen?: string[]; doorgevoerd?: boolean } };
  const s = voorstel.stoppen;
  if (!s?.adressen?.length) return antwoord({ fout: "Bij deze mail staat geen stopvoorstel." }, 400);
  if (s.doorgevoerd) return antwoord({ ok: true, aangepast: 0 });

  // Pakken: het voorstel alleen op "doorgevoerd" zetten als het dat nog niet
  // was en Paaltje de mail niet net leest. Twee klikken voeren het zo niet
  // twee keer uit.
  const { data: gepakt, error: pakFout } = await db
    .from("berichten")
    .update({ voorstel: { ...voorstel, stoppen: { ...s, doorgevoerd: true } } })
    .eq("id", rij.id)
    .neq("paaltje_status", "bezig")
    .is("voorstel->stoppen->>doorgevoerd", null)
    .select("id");
  if (pakFout) throw new Error(`Stoppen: ${pakFout.message}`);
  if (!gepakt?.length) {
    return antwoord({ fout: "Dit is al doorgevoerd, of Paaltje leest de mail net opnieuw." }, 409);
  }

  const uit = await voerStoppenDoor(db, {
    companyId: box.company_id,
    berichtId: rij.id,
    customerIds: s.adressen,
    reden,
    planningWeg,
    door,
  });
  if (uit.aangepast === 0 && uit.mislukt === 0) {
    // Niets te doen: dan het voorstel weer open zetten.
    await db.from("berichten").update({ voorstel }).eq("id", rij.id);
    return antwoord({ fout: "Deze adressen zijn al inactief of bestaan niet meer." }, 409);
  }
  if (uit.mislukt > 0) {
    // Wat lukte staat in Rapport; de rest blijft als voorstel staan, zodat de
    // knop het nog eens kan proberen.
    await db
      .from("berichten")
      .update({ voorstel: { ...voorstel, stoppen: { adressen: uit.mislukteIds } } })
      .eq("id", rij.id);
    return antwoord(
      { fout: `${uit.mislukt} ${uit.mislukt === 1 ? "adres kon" : "adressen konden"} niet op inactief gezet worden. Probeer het nog eens.` },
      500,
    );
  }
  return antwoord({ ok: true, aangepast: uit.aangepast });
}

/** Een eigen map een andere naam geven (ook op de server, dus ook op de telefoon). */
async function hernoemMap(db: Db, box: Box, wachtwoord: string, id: string, ruweNaam: string): Promise<Response> {
  const map = await eigenMap(db, box, id);
  if (!map) return antwoord({ fout: "Alleen je eigen mappen kun je hernoemen." }, 400);
  const naam = ruweNaam.replace(/\s+/g, " ").trim();
  const fout = naamFout(naam);
  if (fout) return antwoord({ fout }, 400);

  const nieuwPad = await metImap(box, wachtwoord, async (client) => {
    const bestaat = (await client.list()).some((m) => m.path.toLowerCase() === naam.toLowerCase());
    if (bestaat) return null;
    const res = await client.mailboxRename(map.pad, naam);
    return res.newPath ?? naam;
  });
  if (!nieuwPad) return antwoord({ fout: "Er is al een map met die naam." }, 409);
  const { error } = await db.from("mail_mappen").update({ pad: nieuwPad }).eq("id", map.id);
  if (error) throw new Error(`Map bijwerken: ${error.message}`);
  return antwoord({ ok: true });
}

/** Een eigen, lege map weghalen. Een map met mail erin niet: die mail zou mee verdwijnen. */
async function verwijderMap(db: Db, box: Box, wachtwoord: string, id: string): Promise<Response> {
  const map = await eigenMap(db, box, id);
  if (!map) return antwoord({ fout: "Alleen je eigen mappen kun je verwijderen." }, 400);
  const leeg = await metImap(box, wachtwoord, async (client) => {
    const status = await client.status(map.pad, { messages: true });
    if ((status.messages ?? 0) > 0) return false;
    await client.mailboxDelete(map.pad);
    return true;
  });
  if (!leeg) return antwoord({ fout: "Deze map is niet leeg. Verplaats of verwijder eerst de mail erin." }, 409);
  const { error } = await db.from("mail_mappen").delete().eq("id", map.id);
  if (error) throw new Error(`Map weghalen: ${error.message}`);
  return antwoord({ ok: true });
}

async function eigenMap(db: Db, box: Box, id: string): Promise<{ id: string; pad: string } | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db
    .from("mail_mappen")
    .select("id,pad,rol")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Map opzoeken: ${error.message}`);
  return data && data.rol === "overig" ? data : null;
}

function naamFout(naam: string): string {
  if (!naam) return "Geef de map een naam.";
  if (naam.length > 60) return "Die naam is te lang (hooguit 60 tekens).";
  if (/[/\\.*%"]/.test(naam) || naam.toUpperCase() === "INBOX") {
    return "Gebruik in de naam geen / . \\ * % of aanhalingstekens.";
  }
  return "";
}

const MAX_BULK = 50;

/** Hetzelfde met meerdere mails. Eén voor één: de mailserver houdt niet van tien tegelijk. */
async function bulk(db: Db, box: Box, wachtwoord: string, verzoek: Verzoek): Promise<Response> {
  const ids = Array.isArray(verzoek.bericht_ids) ? [...new Set(verzoek.bericht_ids.map(String))] : [];
  if (ids.length === 0) return antwoord({ fout: "Kies eerst een of meer mails." }, 400);
  if (ids.length > MAX_BULK) return antwoord({ fout: `Hooguit ${MAX_BULK} mails tegelijk.` }, 400);

  let gelukt = 0;
  const mislukt: string[] = [];
  // Eén verbinding voor alle mails: vijftig keer inloggen duurt te lang en de
  // provider remt het af. Afhandelen gebeurt alleen in Paaltje Systems.
  const verbinding = verzoek.doe === "afhandelen" ? undefined : maakImap(box, wachtwoord);
  if (verbinding) await verbinding.connect();
  try {
    for (const id of ids) {
      let res: Response;
      try {
        switch (verzoek.doe) {
          case "gelezen":
          case "ongelezen":
            res = await zetGelezen(
              db,
              box,
              wachtwoord,
              { ...verzoek, bericht_id: id, gelezen: verzoek.doe === "gelezen" },
              verbinding,
            );
            break;
          case "vlag":
          case "vlag-eraf":
            res = await zetGemarkeerd(
              db,
              box,
              wachtwoord,
              { ...verzoek, bericht_id: id, gemarkeerd: verzoek.doe === "vlag" },
              verbinding,
            );
            break;
          case "afhandelen":
            res = await handelAf(db, box, id, true);
            break;
          case "weggooien":
            res = await verplaats(db, box, wachtwoord, id, "weg", verbinding);
            break;
          case "verplaatsen":
            res = await verplaats(db, box, wachtwoord, id, { naar: String(verzoek.map_id ?? "") }, verbinding);
            break;
          default:
            return antwoord({ fout: "Onbekende actie." }, 400);
        }
      } catch (e) {
        console.error(`bulk ${verzoek.doe} ${id}:`, e instanceof Error ? e.message : e);
        mislukt.push(id);
        continue;
      }
      if (res.ok) gelukt++;
      else mislukt.push(id);
    }
  } finally {
    if (verbinding) {
      try {
        await verbinding.logout();
      } catch {
        verbinding.close();
      }
    }
  }
  return antwoord({ ok: true, gelukt, mislukt });
}

/** Deze afzender voortaan altijd naar spam, en deze mail er meteen heen. */
async function altijdSpam(db: Db, box: Box, wachtwoord: string, id: string): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data: mail, error } = await db
    .from("berichten")
    .select("van_email,richting")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  const email = String(mail?.van_email ?? "").trim().toLowerCase();
  if (!mail || mail.richting !== "in" || !email) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  if (email === box.adres.toLowerCase()) return antwoord({ fout: "Je eigen adres kan niet naar spam." }, 400);

  const { error: regelFout } = await db
    .from("mail_regels")
    .upsert(
      { company_id: box.company_id, mailbox_id: box.id, van_email: email, actie: "spam" },
      { onConflict: "mailbox_id,van_email" },
    );
  if (regelFout) throw new Error(`Regel bewaren: ${regelFout.message}`);

  const spam = await mapMetRol(db, box, "spam");
  if (!spam) return antwoord({ fout: "Er is geen spammap in deze mailbox." }, 400);
  const res = await verplaats(db, box, wachtwoord, id, { naar: spam.id });
  if (!res.ok) return res;
  return antwoord({ ok: true, email });
}

/** Een herinnering: op dat moment staat de mail in "Wacht op jou". */
async function herinner(db: Db, box: Box, id: string, op: string | null): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  let moment: string | null = null;
  if (op) {
    const d = new Date(op);
    if (Number.isNaN(d.getTime())) return antwoord({ fout: "Dat moment klopt niet." }, 400);
    if (d.getTime() > Date.now() + 366 * 24 * 3600_000) return antwoord({ fout: "Hooguit een jaar vooruit." }, 400);
    moment = d.toISOString();
  }
  const { data, error } = await db
    .from("berichten")
    // "Afgehandeld" blijft staan: pas als het moment voorbij is komt de mail
    // (via de herinnering) in "Wacht op jou".
    .update({ herinner_op: moment })
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .select("id");
  if (error) throw new Error(`Herinnering: ${error.message}`);
  if (!data?.length) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  return antwoord({ ok: true });
}

/** Later versturen: de planner stuurt hem op het gekozen moment. */
async function planIn(db: Db, box: Box, door: string, verzoek: Verzoek): Promise<Response> {
  const d = new Date(String(verzoek.op ?? ""));
  if (Number.isNaN(d.getTime())) return antwoord({ fout: "Kies wanneer de mail weg moet." }, 400);
  if (d.getTime() < Date.now() + 60_000) return antwoord({ fout: "Kies een moment in de toekomst." }, 400);
  if (d.getTime() > Date.now() + 366 * 24 * 3600_000) return antwoord({ fout: "Hooguit een jaar vooruit." }, 400);

  const aan = adressenUit(verzoek.aan);
  const cc = adressenUit(verzoek.cc);
  if (!aan || !cc || aan.length === 0) return antwoord({ fout: "Een van de adressen klopt niet." }, 400);
  if (!String(verzoek.tekst ?? "").trim()) return antwoord({ fout: "De mail is nog leeg." }, 400);
  const inhoud = {
    aan,
    cc,
    onderwerp: String(verzoek.onderwerp ?? ""),
    tekst: String(verzoek.tekst ?? ""),
    ...(verzoek.antwoord_op ? { antwoord_op: String(verzoek.antwoord_op) } : {}),
    ...(verzoek.klant_id ? { klant_id: String(verzoek.klant_id) } : {}),
    ...(verzoek.bijlagen_van ? { bijlagen_van: String(verzoek.bijlagen_van) } : {}),
    ...(Array.isArray(verzoek.bijlagen) && verzoek.bijlagen.length ? { bijlagen: verzoek.bijlagen } : {}),
  };
  if (JSON.stringify(inhoud).length > 21_000_000) return antwoord({ fout: "De bijlagen zijn te groot." }, 400);

  const { data, error } = await db
    .from("geplande_mails")
    .insert({
      company_id: box.company_id,
      mailbox_id: box.id,
      door,
      inhoud,
      onderwerp: String(verzoek.onderwerp ?? "").slice(0, 300),
      aan_tekst: aan.map((a) => a.naam || a.email).join(", ").slice(0, 300),
      versturen_op: d.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Inplannen: ${error.message}`);
  return antwoord({ ok: true, id: data.id });
}
