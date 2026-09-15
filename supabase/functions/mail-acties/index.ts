/**
 * Iets doen met een mail: gelezen markeren, weggooien, terugzetten, of een
 * mail versturen.
 *
 * Alles hier gebeurt eerst op de mailserver en pas daarna in Wooshy. De server
 * is de baas: als het daar niet lukt, laten we in Wooshy ook niets veranderen,
 * anders zie je op je telefoon iets anders dan hier.
 *
 * Alleen de eigenaar, net als het lezen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import { maakOp } from "../_gedeeld/opmaken.ts";
import { knip, maakImap, uitlegFout, type MapRol } from "../_gedeeld/ophalen.ts";
import { MogelijkVerstuurd, verstuurBericht } from "../_gedeeld/smtp.ts";
import { type StopReden, voerOverslaanDoor, voerStoppenDoor } from "../_gedeeld/doorvoeren.ts";
import { eigenTekst } from "../_gedeeld/paaltje.ts";

interface Adres {
  email: string;
  naam?: string;
}

interface Verzoek {
  actie:
    | "gelezen"
    | "weggooien"
    | "terugzetten"
    | "versturen"
    | "afhandelen"
    | "opnieuw-lezen"
    | "overslaan-doorvoeren"
    | "klant-koppelen"
    | "stoppen-doorvoeren"
    | "stoppen-planning";
  /** Bij stoppen-doorvoeren: waarom de klant stopt. */
  reden?: string;
  /** Bij stoppen-doorvoeren: ook de wasdagen vanaf morgen van de planning halen (vandaag blijft staan). */
  planning_weg?: boolean;
  /** Bij klant-koppelen: welke klant. */
  klant_id?: string;
  /** Bij afhandelen: klaar (true) of toch weer open (false). */
  klaar?: boolean;
  bericht_id?: string;
  gelezen?: boolean;
  aan?: Adres[];
  cc?: Adres[];
  onderwerp?: string;
  tekst?: string;
  /** Bij versturen: het bericht waarop dit een antwoord is. */
  antwoord_op?: string;
}

const MAX_ONTVANGERS = 20;
const MAX_ONDERWERP = 300;
const MAX_TEKST = 50_000;
/**
 * Hoeveel mails Wooshy per mailbox mag versturen. Mijndomein staat er zo'n 10
 * per 5 minuten toe; wij blijven daaronder, zodat een knop die blijft hangen
 * of een overgenomen account het adres niet op een zwarte lijst krijgt.
 * Aankondigingen gaan via Brevo en tellen hier niet mee.
 */
const MAX_PER_5_MIN = 8;
const MAX_PER_UUR = 60;
/** Alleen gewone zichtbare tekens: een stuurteken of é in een adres geeft bij
 *  de server een onduidelijke fout in plaats van "adres klopt niet". */
const EMAIL = /^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
type Db = any;

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
  if (medewerker.rol !== "eigenaar") {
    return antwoord({ fout: "Alleen de eigenaar kan met de mail werken." }, 403);
  }

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
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
      case "klant-koppelen":
        return await koppelKlant(db, box, String(verzoek.bericht_id ?? ""), String(verzoek.klant_id ?? ""));
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

interface Box {
  id: string;
  company_id: string;
  adres: string;
  imap_host: string;
  imap_poort: number;
  smtp_host: string;
  smtp_poort: number;
}

interface BerichtPlek {
  id: string;
  uid: number;
  uidvalidity: number;
  map_id: string;
  pad: string;
  rol: MapRol;
}

/** Waar een bericht op de server staat, alleen als het bij deze mailbox hoort. */
async function plekVan(db: Db, box: Box, id: string): Promise<BerichtPlek | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db
    .from("berichten")
    .select("id,uid,uidvalidity,map_id,op_server,mail_mappen(pad,rol)")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  if (!data || !data.op_server || !data.mail_mappen) return null;
  return {
    id: data.id,
    uid: Number(data.uid),
    uidvalidity: Number(data.uidvalidity),
    map_id: data.map_id,
    pad: data.mail_mappen.pad,
    rol: data.mail_mappen.rol,
  };
}

async function metImap<T>(
  box: Box,
  wachtwoord: string,
  doe: (client: ReturnType<typeof maakImap>) => Promise<T>,
): Promise<T> {
  const client = maakImap(box, wachtwoord);
  await client.connect();
  try {
    return await doe(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/** De map met een rol. Bij twee mappen met dezelfde rol altijd dezelfde. */
async function mapMetRol(db: Db, box: Box, rol: MapRol) {
  const { data, error } = await db
    .from("mail_mappen")
    .select("id,pad,uidvalidity")
    .eq("mailbox_id", box.id)
    .eq("rol", rol)
    .order("pad", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Map opzoeken: ${error.message}`);
  return data as { id: string; pad: string; uidvalidity: number | null } | null;
}

const VERANDERD =
  "Deze mail is intussen op de server veranderd. Wacht even tot Wooshy hem opnieuw heeft opgehaald.";

async function zetGelezen(db: Db, box: Box, wachtwoord: string, verzoek: Verzoek): Promise<Response> {
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
  });
  if (!gelukt) return antwoord({ fout: VERANDERD }, 409);

  const { error } = await db.from("berichten").update({ gelezen }).eq("id", plek.id);
  // Op de server is het gelukt; de volgende ophaalronde trekt Wooshy gelijk.
  if (error) console.error("gelezen bijwerken:", error.message);
  return antwoord({ ok: true });
}

/** De map waar een mail in stond voor hij in de prullenbak ging, als die er nog is. */
async function vorigeMap(db: Db, box: Box, id: string) {
  const { data: rij, error } = await db
    .from("berichten")
    .select("vorige_map_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Vorige map opzoeken: ${error.message}`);
  if (!rij?.vorige_map_id) return null;
  const { data: map, error: mapFout } = await db
    .from("mail_mappen")
    .select("id,pad,uidvalidity,rol")
    .eq("id", rij.vorige_map_id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (mapFout) throw new Error(`Vorige map opzoeken: ${mapFout.message}`);
  if (!map || map.rol === "prullenbak") return null;
  return map as { id: string; pad: string; uidvalidity: number | null };
}

/**
 * Een mail naar de prullenbak, of eruit terug naar waar hij stond. Hij krijgt
 * daar een nieuw nummer; dat geeft de server terug (UIDPLUS), en dan hangen we
 * de rij meteen aan zijn nieuwe plek. Geeft de server het nummer niet, dan zet
 * de volgende ophaalronde hem goed — en zegt het antwoord `verplaatst: false`,
 * zodat de app geen "ongedaan maken" aanbiedt dat nog even niet kan.
 */
async function verplaats(
  db: Db,
  box: Box,
  wachtwoord: string,
  id: string,
  richting: "weg" | "terug",
): Promise<Response> {
  const plek = await plekVan(db, box, id);
  if (!plek) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);

  let doel: { id: string; pad: string; uidvalidity: number | null } | null;
  if (richting === "weg") {
    if (plek.rol === "prullenbak") return antwoord({ ok: true, verplaatst: true });
    doel = await mapMetRol(db, box, "prullenbak");
    if (!doel) return antwoord({ fout: "Er is geen prullenbak in deze mailbox." }, 400);
  } else {
    if (plek.rol !== "prullenbak") return antwoord({ ok: true, verplaatst: true });
    doel = (await vorigeMap(db, box, plek.id)) ?? (await mapMetRol(db, box, "postvak"));
    if (!doel) return antwoord({ fout: "Er is geen postvak gevonden." }, 400);
  }
  const bestemming = doel;
  const vorige = richting === "weg" ? plek.map_id : null;

  const uitkomst = await metImap(box, wachtwoord, async (client) => {
    const lock = await client.getMailboxLock(plek.pad);
    try {
      if (Number(client.mailbox && client.mailbox.uidValidity) !== plek.uidvalidity) return null;
      const res = await client.messageMove(String(plek.uid), bestemming.pad, { uid: true });
      if (!res) throw new Error("Verplaatsen lukte niet.");
      const nieuweUid = res.uidMap?.get(plek.uid);
      return {
        uid: typeof nieuweUid === "number" ? nieuweUid : null,
        uidvalidity: res.uidValidity !== undefined ? Number(res.uidValidity) : null,
      };
    } finally {
      lock.release();
    }
  });
  if (!uitkomst) return antwoord({ fout: VERANDERD }, 409);

  const uidvalidity =
    uitkomst.uidvalidity ?? (bestemming.uidvalidity !== null ? Number(bestemming.uidvalidity) : null);
  if (uitkomst.uid !== null && uidvalidity !== null) {
    const nieuwePlek = {
      map_id: bestemming.id,
      uid: uitkomst.uid,
      uidvalidity,
      op_server: true,
      weg_sinds: null,
      vorige_map_id: vorige,
    };
    let { error } = await db.from("berichten").update(nieuwePlek).eq("id", plek.id);
    if (error?.code === "23505") {
      // Een ophaalronde was sneller en zette de mail al als nieuwe rij in de
      // doelmap. Die rij is kaal; de onze heeft wat Wooshy eraan hing. Dus
      // die weg, en de onze op zijn plek.
      await db
        .from("berichten")
        .delete()
        .eq("map_id", bestemming.id)
        .eq("uidvalidity", uidvalidity)
        .eq("uid", uitkomst.uid)
        .neq("id", plek.id);
      ({ error } = await db.from("berichten").update(nieuwePlek).eq("id", plek.id));
    }
    if (!error) return antwoord({ ok: true, verplaatst: true });
    console.error("verplaatsen bijwerken:", error.message);
  }
  // Nieuwe plek onbekend: uit beeld, en de volgende ronde hangt hem goed.
  const { error: wegFout } = await db
    .from("berichten")
    .update({ op_server: false, weg_sinds: new Date().toISOString(), vorige_map_id: vorige })
    .eq("id", plek.id);
  if (wegFout) console.error("uit beeld zetten:", wegFout.message);
  return antwoord({ ok: true, verplaatst: false });
}

/**
 * Klaar met een mail (of toch niet). Alleen in Wooshy: op de mailserver
 * bestaat "afgehandeld" niet.
 */
async function handelAf(db: Db, box: Box, id: string, klaar: boolean): Promise<Response> {
  if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);
  const { data, error } = await db
    .from("berichten")
    // Wat jij afhandelt is van jou: opnieuw laten lezen neemt het niet terug.
    .update({ afgehandeld_op: klaar ? new Date().toISOString() : null, afgehandeld_door_paaltje: false })
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
    antwoordId: null,
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

/**
 * Dit mailadres hoort bij deze klant. Het adres komt bij de klant, de klant
 * komt op de mail, en Paaltje leest de mail opnieuw met die klant erbij.
 */
async function koppelKlant(db: Db, box: Box, id: string, klantId: string): Promise<Response> {
  if (!UUID.test(id) || !UUID.test(klantId)) return antwoord({ fout: "Die mail of klant bestaat niet." }, 404);
  const { data: mail, error } = await db
    .from("berichten")
    .select("id,van_email,beantwoord_op")
    .eq("id", id)
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (error) throw new Error(`Mail opzoeken: ${error.message}`);
  const { data: klant, error: klantFout } = await db
    .from("klanten")
    .select("id")
    .eq("id", klantId)
    .eq("company_id", box.company_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (klantFout) throw new Error(`Klant opzoeken: ${klantFout.message}`);
  if (!mail || !klant) return antwoord({ fout: "Die mail of klant bestaat niet." }, 404);

  const email = String(mail.van_email ?? "").trim().toLowerCase();
  if (email) {
    const { error: koppelFout } = await db
      .from("klant_emails")
      .insert({ company_id: box.company_id, klant_id: klant.id, email, bron: "mens" });
    if (koppelFout && koppelFout.code !== "23505") throw new Error(`Koppelen: ${koppelFout.message}`);
  }

  const { data: gezet, error: mailFout } = await db
    .from("berichten")
    .update({
      klant_id: klant.id,
      klant_gok_id: null,
      paaltje_status: "wacht",
      paaltje_pogingen: 0,
      ai_fout: "",
    })
    .eq("id", mail.id)
    .neq("paaltje_status", "bezig")
    .select("id");
  if (mailFout) throw new Error(`Klant op de mail zetten: ${mailFout.message}`);
  if (!gezet?.length) {
    return antwoord(
      { fout: "Het mailadres is gekoppeld, maar Paaltje leest deze mail net. Probeer het zo nog eens." },
      409,
    );
  }
  // Zette Paaltje hem zelf op afgehandeld (hij dacht: geen klantmail), dan gaat
  // dat eraf: met deze klant erbij leest hij hem opnieuw.
  const { error: afFout } = await db
    .from("berichten")
    .update({ afgehandeld_op: null, afgehandeld_door_paaltje: false })
    .eq("id", mail.id)
    .eq("afgehandeld_door_paaltje", true);
  if (afFout) console.error("afgehandeld terugzetten:", afFout.message);
  return antwoord({ ok: true });
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

function adressenUit(lijst: unknown): Adres[] | null {
  if (lijst === undefined) return [];
  if (!Array.isArray(lijst)) return null;
  const uit: Adres[] = [];
  for (const a of lijst) {
    const email = String((a as Adres)?.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return null;
    const naam = knip(String((a as Adres)?.naam ?? "").replace(/[\r\n]/g, " ").trim(), 200);
    uit.push({ email, naam });
  }
  return uit;
}

/** Hoe vaak deze mailbox sinds `sinds` via Wooshy probeerde te versturen. */
async function verstuurdSinds(db: Db, box: Box, sinds: Date): Promise<number> {
  const { count, error } = await db
    .from("mail_verzendpogingen")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", box.id)
    .gte("created_at", sinds.toISOString());
  if (error) throw new Error(`Tellen: ${error.message}`);
  return count ?? 0;
}

async function verstuur(db: Db, box: Box, wachtwoord: string, verzoek: Verzoek): Promise<Response> {
  const aan = adressenUit(verzoek.aan);
  const cc = adressenUit(verzoek.cc);
  if (!aan || !cc) return antwoord({ fout: "Een van de adressen klopt niet." }, 400);
  if (aan.length === 0) return antwoord({ fout: "Aan wie moet de mail?" }, 400);
  if (aan.length + cc.length > MAX_ONTVANGERS) {
    return antwoord({ fout: `Hooguit ${MAX_ONTVANGERS} ontvangers per mail.` }, 400);
  }
  const onderwerp = knip(String(verzoek.onderwerp ?? "").replace(/[\r\n]+/g, " ").trim(), MAX_ONDERWERP);
  const tekst = String(verzoek.tekst ?? "");
  if (!tekst.trim()) return antwoord({ fout: "De mail is nog leeg." }, 400);
  if (tekst.length > MAX_TEKST) return antwoord({ fout: "De mail is te lang." }, 400);

  // Eerst de poging vastleggen, dan pas tellen — mét deze poging erbij. Andersom
  // zien twintig verzoeken die tegelijk binnenkomen allemaal nog ruimte, en
  // gaan ze allemaal door. De poging telt mee, ook als versturen mislukt.
  const { data: poging, error: pogingFout } = await db
    .from("mail_verzendpogingen")
    .insert({ mailbox_id: box.id, company_id: box.company_id })
    .select("id")
    .single();
  if (pogingFout || !poging) throw new Error(`Poging vastleggen: ${pogingFout?.message}`);

  const nu = Date.now();
  const teVeel =
    (await verstuurdSinds(db, box, new Date(nu - 5 * 60_000))) > MAX_PER_5_MIN
      ? "Even rustig aan: wacht een paar minuten voor je weer verstuurt."
      : (await verstuurdSinds(db, box, new Date(nu - 60 * 60_000))) > MAX_PER_UUR
        ? "Je hebt dit uur al veel mail verstuurd. Probeer het straks weer."
        : "";
  if (teVeel) {
    // Een geweigerde poging is niet verstuurd; die hoort de rem niet langer
    // te maken.
    await db.from("mail_verzendpogingen").delete().eq("id", poging.id);
    return antwoord({ fout: teVeel }, 429);
  }

  // Antwoord op een bericht: dan hoort hij in dezelfde draad.
  let antwoordOp: { messageId: string; referenties: string[] } | undefined;
  if (verzoek.antwoord_op) {
    const id = String(verzoek.antwoord_op);
    if (!UUID.test(id)) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 400);
    const { data: origineel, error } = await db
      .from("berichten")
      .select("message_id,referenties")
      .eq("id", id)
      .eq("mailbox_id", box.id)
      .maybeSingle();
    if (error) throw new Error(`Oorspronkelijke mail opzoeken: ${error.message}`);
    if (origineel?.message_id) {
      antwoordOp = { messageId: origineel.message_id, referenties: origineel.referenties ?? [] };
    }
  }

  const { data: bedrijf } = await db
    .from("companies")
    .select("name,mail_afzender_naam")
    .eq("id", box.company_id)
    .single();
  const vanNaam = String(bedrijf?.mail_afzender_naam || bedrijf?.name || "").trim();

  const opgemaakt = await maakOp({
    van: { naam: vanNaam, adres: box.adres },
    aan,
    cc,
    onderwerp,
    tekst,
    antwoordOp,
  });

  // 1. Versturen. Lukt dit niet, dan is er niets gebeurd (of: misschien toch,
  //    zie MogelijkVerstuurd — dat gaat als eigen melding terug).
  await verstuurBericht(
    { host: box.smtp_host, poort: box.smtp_poort, adres: box.adres, wachtwoord },
    opgemaakt.ontvangers,
    opgemaakt.bericht,
  );

  // 2. Een kopie in Verzonden, zoals elk mailprogramma doet. Mislukt dat, dan
  //    is de mail tóch weg; dat melden we, maar het is geen fout meer.
  let kopieFout = "";
  try {
    const verzonden = await mapMetRol(db, box, "verzonden");
    if (!verzonden) throw new Error("geen map Verzonden");

    const res = await metImap(box, wachtwoord, (client) =>
      client.append(verzonden.pad, opgemaakt.bericht, ["\\Seen"], new Date()),
    );

    // Meteen in Wooshy zetten, zodat hij in Verzonden staat zonder op de
    // volgende ophaalronde te wachten. Zonder nummer van de server laten we het
    // aan die ronde over.
    if (res && typeof res.uid === "number" && res.uidValidity !== undefined) {
      const { error } = await db.from("berichten").upsert(
        {
          company_id: box.company_id,
          mailbox_id: box.id,
          map_id: verzonden.id,
          uidvalidity: Number(res.uidValidity),
          uid: res.uid,
          message_id: opgemaakt.messageId,
          in_reply_to: antwoordOp?.messageId ?? "",
          referenties: antwoordOp ? [...antwoordOp.referenties, antwoordOp.messageId].slice(-20) : [],
          richting: "uit",
          van_naam: vanNaam,
          van_email: box.adres,
          aan: aan.map((a) => ({ naam: a.naam ?? "", email: a.email })),
          cc: cc.map((a) => ({ naam: a.naam ?? "", email: a.email })),
          onderwerp,
          fragment: knip(tekst.replace(/\s+/g, " ").trim(), 200),
          tekst,
          html: "",
          ontvangen_op: new Date().toISOString(),
          gelezen: true,
          paaltje_status: "overslaan",
        },
        { onConflict: "map_id,uidvalidity,uid", ignoreDuplicates: true },
      );
      // Staat hij op de server maar niet in Wooshy, dan haalt de volgende
      // ronde hem op. Geen reden om de gebruiker lastig te vallen.
      if (error) console.error("kopie in Wooshy:", error.message);
    }
  } catch (e) {
    kopieFout = "De mail is verstuurd, maar de kopie in Verzonden lukte niet.";
    console.error("kopie in Verzonden:", e instanceof Error ? e.message : e);
  }

  // 3. Was het een antwoord, dan is die mail nu beantwoord en afgehandeld. Wat
  //    er echt wegging komt in `concept`: daar leert Paaltje van (naast wat hij
  //    zelf schreef, in `concept_paaltje`).
  if (verzoek.antwoord_op && UUID.test(String(verzoek.antwoord_op))) {
    const nu = new Date().toISOString();
    const { error } = await db
      .from("berichten")
      .update({ beantwoord_op: nu, afgehandeld_op: nu, concept: knip(eigenTekst(tekst), 20_000) })
      .eq("id", String(verzoek.antwoord_op))
      .eq("mailbox_id", box.id);
    if (error) console.error("antwoord markeren:", error.message);
  }

  return antwoord({ ok: true, kopieFout });
}
