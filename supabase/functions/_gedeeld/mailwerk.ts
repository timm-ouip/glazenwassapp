/**
 * Het werk op de mailbox zelf dat meer dan één functie nodig heeft: een mail
 * terugvinden op de server, verplaatsen, en versturen met een kopie in
 * Verzonden. De knoppen in de app (mail-acties) en de planner op de
 * achtergrond (mail-planner: later versturen, altijd naar spam) gebruiken
 * allemaal dezelfde code.
 */
import { antwoord } from "./mail.ts";
import { maakOp } from "./opmaken.ts";
import { bijlageDelen, knip, maakImap, type MapRol } from "./ophalen.ts";
import { verstuurBericht } from "./smtp.ts";
import { eigenTekst } from "./paaltje.ts";
import { ontsleutel } from "./geheim.ts";

// deno-lint-ignore no-explicit-any
export type Db = any;

export interface Adres {
  email: string;
  naam?: string;
}

/** Wat versturen nodig heeft; het verzoek uit de app mag meer velden hebben. */
export interface VerstuurVerzoek {
  aan?: Adres[];
  cc?: Adres[];
  onderwerp?: string;
  tekst?: string;
  /** Het bericht waarop dit een antwoord is. */
  antwoord_op?: string;
  /** In wiens dossier de mail komt. */
  klant_id?: string;
  /** Doorsturen: de bijlagen van dit bericht gaan mee. */
  bijlagen_van?: string;
  /** Zelf toegevoegde bestanden, als base64. */
  bijlagen?: { naam: string; type: string; inhoud: string }[];
}

export const MAX_ONTVANGERS = 20;
export const MAX_ONDERWERP = 300;
export const MAX_TEKST = 50_000;
/**
 * Hoeveel mails Wooshy per mailbox mag versturen. Mijndomein staat er zo'n 10
 * per 5 minuten toe; wij blijven daaronder, zodat een knop die blijft hangen
 * of een overgenomen account het adres niet op een zwarte lijst krijgt.
 * Aankondigingen gaan via Brevo en tellen hier niet mee.
 */
export const MAX_PER_5_MIN = 8;
export const MAX_PER_UUR = 60;
/** Alleen gewone zichtbare tekens: een stuurteken of é in een adres geeft bij
 *  de server een onduidelijke fout in plaats van "adres klopt niet". */
export const EMAIL = /^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Box {
  id: string;
  company_id: string;
  adres: string;
  imap_host: string;
  imap_poort: number;
  smtp_host: string;
  smtp_poort: number;
}

export interface BerichtPlek {
  id: string;
  uid: number;
  uidvalidity: number;
  map_id: string;
  pad: string;
  rol: MapRol;
}

/** Waar een bericht op de server staat, alleen als het bij deze mailbox hoort. */
export async function plekVan(db: Db, box: Box, id: string): Promise<BerichtPlek | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db
    .from("berichten")
    // Expliciet via map_id: er is ook een koppeling via vorige_map_id, en zonder
    // deze aanwijzing weigert de database te kiezen.
    .select("id,uid,uidvalidity,map_id,op_server,mail_mappen!berichten_map_id_fkey(pad,rol)")
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

export type ImapClient = ReturnType<typeof maakImap>;

/**
 * Iets doen op de mailserver. Met `bestaand` wordt een al geopende verbinding
 * hergebruikt (bij veel mails tegelijk); anders één voor deze keer.
 */
export async function metImap<T>(
  box: Box,
  wachtwoord: string,
  doe: (client: ImapClient) => Promise<T>,
  bestaand?: ImapClient,
): Promise<T> {
  if (bestaand) return await doe(bestaand);
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
export async function mapMetRol(db: Db, box: Box, rol: MapRol) {
  const { data, error } = await db
    .from("mail_mappen")
    .select("id,pad,uidvalidity,rol")
    .eq("mailbox_id", box.id)
    .eq("rol", rol)
    .order("pad", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Map opzoeken: ${error.message}`);
  return data as { id: string; pad: string; uidvalidity: number | null; rol: MapRol } | null;
}

export const VERANDERD =
  "Deze mail is intussen op de server veranderd. Wacht even tot Wooshy hem opnieuw heeft opgehaald.";

/** De map waar een mail in stond voor hij in de prullenbak ging, als die er nog is. */
export async function vorigeMap(db: Db, box: Box, id: string) {
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
  return map as { id: string; pad: string; uidvalidity: number | null; rol: MapRol };
}

/**
 * Een mail naar de prullenbak, of eruit terug naar waar hij stond. Hij krijgt
 * daar een nieuw nummer; dat geeft de server terug (UIDPLUS), en dan hangen we
 * de rij meteen aan zijn nieuwe plek. Geeft de server het nummer niet, dan zet
 * de volgende ophaalronde hem goed — en zegt het antwoord `verplaatst: false`,
 * zodat de app geen "ongedaan maken" aanbiedt dat nog even niet kan.
 */
export async function verplaats(
  db: Db,
  box: Box,
  wachtwoord: string,
  id: string,
  richting: "weg" | "terug" | { naar: string },
  verbinding?: ImapClient,
): Promise<Response> {
  const plek = await plekVan(db, box, id);
  if (!plek) return antwoord({ fout: "Die mail bestaat niet (meer)." }, 404);

  let doel: { id: string; pad: string; uidvalidity: number | null; rol?: MapRol } | null;
  if (typeof richting === "object") {
    // Naar een map naar keuze: alleen een map van deze mailbox.
    if (!UUID.test(richting.naar)) return antwoord({ fout: "Die map bestaat niet (meer)." }, 404);
    if (richting.naar === plek.map_id) return antwoord({ ok: true, verplaatst: true });
    const { data, error } = await db
      .from("mail_mappen")
      .select("id,pad,uidvalidity,rol")
      .eq("id", richting.naar)
      .eq("mailbox_id", box.id)
      .maybeSingle();
    if (error) throw new Error(`Map opzoeken: ${error.message}`);
    if (!data) return antwoord({ fout: "Die map bestaat niet (meer)." }, 404);
    doel = data;
  } else if (richting === "weg") {
    if (plek.rol === "prullenbak") return antwoord({ ok: true, verplaatst: true });
    doel = await mapMetRol(db, box, "prullenbak");
    if (!doel) return antwoord({ fout: "Er is geen prullenbak in deze mailbox." }, 400);
  } else {
    if (plek.rol !== "prullenbak") return antwoord({ ok: true, verplaatst: true });
    doel = (await vorigeMap(db, box, plek.id)) ?? (await mapMetRol(db, box, "postvak"));
    if (!doel) return antwoord({ fout: "Er is geen postvak gevonden." }, 400);
  }
  const bestemming = doel;
  // Onthouden waar hij vandaan kwam: terugzetten uit de prullenbak gaat daarheen.
  const vorige = richting === "terug" ? null : plek.map_id;

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
  }, verbinding);
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
    if (!error) {
      await paaltjeNaVerplaatsen(db, box, plek.id, bestemming.rol);
      return antwoord({ ok: true, verplaatst: true });
    }
    console.error("verplaatsen bijwerken:", error.message);
  }
  // Nieuwe plek onbekend: uit beeld, en de volgende ronde hangt hem goed.
  const { error: wegFout } = await db
    .from("berichten")
    .update({ op_server: false, weg_sinds: new Date().toISOString(), vorige_map_id: vorige })
    .eq("id", plek.id);
  if (wegFout) console.error("uit beeld zetten:", wegFout.message);
  await paaltjeNaVerplaatsen(db, box, plek.id, bestemming.rol);
  return antwoord({ ok: true, verplaatst: false });
}

/**
 * Paaltje leest alleen wat in het postvak staat. Gaat een mail die nog op hem
 * wacht naar spam, de prullenbak of een eigen map, dan niet meer. Komt hij in
 * het postvak ("geen spam", terugzetten), dan leest hij hem alsnog — maar
 * alleen als hij dat nog nooit deed en de mail niet ouder is dan het moment
 * dat Paaltje aanging, net als bij het ophalen.
 */
export async function paaltjeNaVerplaatsen(db: Db, box: Box, id: string, rol: MapRol | undefined) {
  if (rol !== "postvak") {
    const { error } = await db
      .from("berichten")
      .update({ paaltje_status: "overslaan" })
      .eq("id", id)
      .eq("paaltje_status", "wacht");
    if (error) console.error("paaltje niet laten lezen:", error.message);
    return;
  }
  const { data: mb, error: mbFout } = await db
    .from("mailboxen")
    .select("paaltje_vanaf")
    .eq("id", box.id)
    .maybeSingle();
  if (mbFout || !mb?.paaltje_vanaf) return;
  const { error } = await db
    .from("berichten")
    .update({ paaltje_status: "wacht" })
    .eq("id", id)
    .eq("richting", "in")
    .eq("paaltje_status", "overslaan")
    .is("gelezen_door_paaltje_op", null)
    .gte("ontvangen_op", mb.paaltje_vanaf);
  if (error) console.error("paaltje laten lezen:", error.message);
}

export function adressenUit(lijst: unknown): Adres[] | null {
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
export async function verstuurdSinds(db: Db, box: Box, sinds: Date): Promise<number> {
  const { count, error } = await db
    .from("mail_verzendpogingen")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_id", box.id)
    .gte("created_at", sinds.toISOString());
  if (error) throw new Error(`Tellen: ${error.message}`);
  return count ?? 0;
}

export async function verstuur(db: Db, box: Box, wachtwoord: string, verzoek: VerstuurVerzoek): Promise<Response> {
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

  // De klant van deze mail, zodat hij in diens dossier komt: van de mail waar
  // dit een antwoord op is, of gekozen vanuit het dossier.
  // Vóór de poging: een geweigerde klant hoort niet mee te tellen voor de rem.
  let klantId: string | null = null;
  if (verzoek.klant_id) {
    const gekozen = String(verzoek.klant_id);
    if (!UUID.test(gekozen)) return antwoord({ fout: "Die klant bestaat niet (meer)." }, 400);
    const { data: klant, error } = await db
      .from("klanten")
      .select("id")
      .eq("id", gekozen)
      .eq("company_id", box.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(`Klant opzoeken: ${error.message}`);
    if (!klant) return antwoord({ fout: "Die klant bestaat niet (meer)." }, 400);
    klantId = klant.id;
  }

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
      .select("message_id,referenties,klant_id")
      .eq("id", id)
      .eq("mailbox_id", box.id)
      .maybeSingle();
    if (error) throw new Error(`Oorspronkelijke mail opzoeken: ${error.message}`);
    if (origineel?.message_id) {
      antwoordOp = { messageId: origineel.message_id, referenties: origineel.referenties ?? [] };
    }
    klantId = klantId ?? origineel?.klant_id ?? null;
  }

  const { data: bedrijf } = await db
    .from("companies")
    .select("name,mail_afzender_naam")
    .eq("id", box.company_id)
    .single();
  const vanNaam = String(bedrijf?.mail_afzender_naam || bedrijf?.name || "").trim();

  // Bijlagen: zelf toegevoegd, en bij doorsturen die van de oude mail.
  const bijlagen: { naam: string; type: string; inhoud: string }[] = [];
  if (verzoek.bijlagen !== undefined) {
    if (!Array.isArray(verzoek.bijlagen) || verzoek.bijlagen.length > MAX_BIJLAGEN) {
      return antwoord({ fout: `Hooguit ${MAX_BIJLAGEN} bijlagen per mail.` }, 400);
    }
    for (const b of verzoek.bijlagen) {
      const inhoud = String(b?.inhoud ?? "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(inhoud)) return antwoord({ fout: "Een bijlage is onleesbaar." }, 400);
      bijlagen.push({
        naam: knip(String(b?.naam ?? "bijlage").replace(/[\r\n"\\/]/g, " ").trim(), 200) || "bijlage",
        type: /^[\w.+-]+\/[\w.+-]+$/.test(String(b?.type ?? "")) ? String(b.type) : "application/octet-stream",
        inhoud,
      });
    }
  }
  if (verzoek.bijlagen_van) {
    const opgehaald = await haalBijlagen(db, box, wachtwoord, String(verzoek.bijlagen_van));
    if ("fout" in opgehaald) return antwoord({ fout: opgehaald.fout }, 400);
    bijlagen.push(...opgehaald.bijlagen);
  }
  if (bijlagen.reduce((som, b) => som + (b.inhoud.length * 3) / 4, 0) > MAX_BIJLAGEN_BYTES) {
    return antwoord({ fout: "De bijlagen zijn samen te groot (hooguit 15 MB)." }, 400);
  }

  const opgemaakt = await maakOp({
    van: { naam: vanNaam, adres: box.adres },
    aan,
    cc,
    onderwerp,
    tekst,
    antwoordOp,
    bijlagen,
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
          bijlagen: bijlagen.map((b) => ({ naam: b.naam, type: b.type, grootte: Math.round((b.inhoud.length * 3) / 4) })),
          ontvangen_op: new Date().toISOString(),
          gelezen: true,
          paaltje_status: "overslaan",
          // Leeg: dan zoekt de database de klant op het aan-adres.
          klant_id: klantId,
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
      .update({ beantwoord_op: nu, afgehandeld_op: nu, herinner_op: null, concept: knip(eigenTekst(tekst), 20_000) })
      .eq("id", String(verzoek.antwoord_op))
      .eq("mailbox_id", box.id);
    if (error) console.error("antwoord markeren:", error.message);
  }

  return antwoord({ ok: true, kopieFout });
}


const MAX_BIJLAGEN = 10;
/** Samen; Mijndomein neemt grotere mail wel aan, maar de functie moet het ook in zijn geheugen houden. */
export const MAX_BIJLAGEN_BYTES = 15_000_000;

function naarBase64(bytes: Uint8Array): string {
  let binair = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binair += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binair);
}

/**
 * De bijlagen van een mail van de server halen: allemaal, of alleen die met
 * nummer `alleen` (in de volgorde van `berichten.bijlagen`).
 */
export async function haalBijlagen(
  db: Db,
  box: Box,
  wachtwoord: string,
  berichtId: string,
  alleen?: number,
): Promise<{ bijlagen: { naam: string; type: string; inhoud: string }[] } | { fout: string }> {
  const plek = await plekVan(db, box, berichtId);
  if (!plek) return { fout: "Die mail staat niet meer in je mailbox; de bijlagen zijn er niet meer." };

  return await metImap(box, wachtwoord, async (client) => {
    const lock = await client.getMailboxLock(plek.pad);
    try {
      if (Number(client.mailbox && client.mailbox.uidValidity) !== plek.uidvalidity) return { fout: VERANDERD };
      const kop = await client.fetchOne(String(plek.uid), { bodyStructure: true }, { uid: true });
      if (!kop) return { fout: "Die mail staat niet meer in je mailbox." };
      let delen = bijlageDelen(kop.bodyStructure as Parameters<typeof bijlageDelen>[0]).map((d) => ({
        ...d,
        // Een mail die in zijn geheel één bestand is, heeft geen deelnummer: dan deel 1.
        part: d.part || "1",
      }));
      if (alleen !== undefined) delen = delen.filter((_, i) => i === alleen);
      if (delen.length === 0) return { fout: "Die bijlage is er niet (meer)." };
      if (delen.reduce((som, d) => som + d.grootte, 0) > MAX_BIJLAGEN_BYTES * 1.4) {
        return { fout: "De bijlagen zijn te groot (hooguit 15 MB)." };
      }

      const uit: { naam: string; type: string; inhoud: string }[] = [];
      let totaal = 0;
      for (const deel of delen) {
        const { content } = await client.download(String(plek.uid), deel.part, { uid: true });
        const stukken: Uint8Array[] = [];
        for await (const stuk of content as AsyncIterable<Uint8Array>) {
          totaal += stuk.length;
          if (totaal > MAX_BIJLAGEN_BYTES) return { fout: "De bijlagen zijn te groot (hooguit 15 MB)." };
          stukken.push(stuk);
        }
        const bytes = new Uint8Array(stukken.reduce((som, s) => som + s.length, 0));
        let plekInBytes = 0;
        for (const s of stukken) {
          bytes.set(s, plekInBytes);
          plekInBytes += s.length;
        }
        uit.push({ naam: deel.naam, type: deel.type || "application/octet-stream", inhoud: naarBase64(bytes) });
      }
      if (uit.length === 0) return { fout: "Die bijlage kon niet opgehaald worden." };
      return { bijlagen: uit };
    } finally {
      lock.release();
    }
  });
}

/** De mailbox van een bedrijf met het wachtwoord, voor werk zonder ingelogde gebruiker. */
export async function laadBox(
  db: Db,
  mailboxId: string,
): Promise<{ box: Box; wachtwoord: string } | null> {
  const { data: box } = await db
    .from("mailboxen")
    .select("id,company_id,adres,imap_host,imap_poort,smtp_host,smtp_poort,status")
    .eq("id", mailboxId)
    .maybeSingle();
  if (!box || box.status !== "actief") return null;
  const { data: geheim } = await db
    .from("mailbox_geheimen")
    .select("versleuteld,iv")
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (!geheim) return null;
  try {
    return { box, wachtwoord: await ontsleutel(geheim.versleuteld, geheim.iv) };
  } catch {
    return null;
  }
}
