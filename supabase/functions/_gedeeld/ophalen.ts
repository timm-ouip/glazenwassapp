/**
 * De mailbox bij de provider spiegelen naar Wooshy.
 *
 * Eén ronde loopt twee keer langs de mappen.
 *
 * Eerst alle mappen nalopen:
 *  1. Nummering gecontroleerd. Heeft de server de map opnieuw genummerd
 *     (UIDVALIDITY), dan klopt geen oud nummer meer en gaat alles eerst op
 *     "niet meer gezien".
 *  2. Wat er niet meer staat, gaat uit beeld.
 *  3. Gelezen en gemarkeerd overgenomen van de server.
 *
 * Daarna pas nieuwe mail ophalen, nieuwste eerst en nooit meer dan past in één
 * ronde. Die volgorde doet ertoe: een mail die op de telefoon van de ene map
 * naar de andere ging, staat na de eerste lus overal als "niet meer gezien",
 * en kan in de tweede lus aan zijn nieuwe plek gehangen worden (op
 * Message-ID) — met alles wat Wooshy er zelf aan had hangen.
 *
 * "Niet meer gezien" is nooit meteen weg: pas na twee dagen wordt zo'n rij
 * echt verwijderd. Dat geldt ook voor een hele map die van de server
 * verdwijnt, bijvoorbeeld omdat hij op de telefoon hernoemd is.
 *
 * Er wordt hier niets op de server veranderd: de mappen gaan alleen-lezen open.
 */
import { ImapFlow } from "npm:imapflow@2.0.2";
import PostalMime from "npm:postal-mime@3.0.0";

import { ontsleutel } from "./geheim.ts";
import { inStukjes } from "./mail.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type MapRol = "postvak" | "verzonden" | "concepten" | "prullenbak" | "spam" | "overig";

export interface MailboxRij {
  id: string;
  company_id: string;
  adres: string;
  imap_host: string;
  imap_poort: number;
  status: "actief" | "fout" | "uit";
  import_vanaf: string;
  paaltje_vanaf: string;
}

export const MAILBOX_KOLOMMEN =
  "id,company_id,adres,imap_host,imap_poort,status,import_vanaf,paaltje_vanaf";

interface MapRij {
  id: string;
  pad: string;
  rol: MapRol;
  uidvalidity: number | null;
}

/**
 * Het slot van één ronde. `tot` is precies de tijd die deze ronde zelf in
 * `bezig_tot` zette; verlengen en vrijgeven raken alleen een slot met die
 * tijd, zodat een trage ronde nooit het slot van een nieuwere afpakt.
 */
export interface Slot {
  tot: string;
}

/** Een andere ronde heeft het slot: geen fout van de mailserver, gewoon stoppen. */
class SlotKwijt extends Error {
  constructor() {
    super("Een andere ophaalronde heeft het overgenomen.");
  }
}

/** Zo lang houdt een ronde het slot vast. Na elke map wordt het verlengd. */
const SLOT_MS = 170_000;
/** Zoveel nieuwe mails per ronde, over alle mappen samen. */
const MAX_NIEUW = 60;
/** Zo lang mag een ronde nieuwe mail binnenhalen voor hij stopt. */
const STANDAARD_TIJD_MS = 60_000;
/** Groter dan dit halen we maar deels op: de tekst staat vooraan, de foto's erachter. */
const GROTE_MAIL = 1_500_000;
const DEEL_VAN_GROTE_MAIL = 300_000;
const MAX_TEKST = 100_000;
const MAX_HTML = 400_000;
/** Zo lang mag een mail "niet meer gezien" zijn voor we hem echt weghalen. */
const WEG_NA_MS = 2 * 24 * 60 * 60 * 1000;
const NUL_TEKEN = String.fromCharCode(0);

/** Volgorde van ophalen: waar vandaag post binnenkomt eerst. */
const MAP_VOORRANG: MapRol[] = ["postvak", "verzonden", "overig", "concepten", "spam", "prullenbak"];

export function maakImap(
  box: Pick<MailboxRij, "adres" | "imap_host" | "imap_poort">,
  wachtwoord: string,
): ImapFlow {
  const client = new ImapFlow({
    host: box.imap_host,
    port: box.imap_poort,
    secure: true,
    auth: { user: box.adres, pass: wachtwoord },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // Zonder luisteraar breekt een verbroken verbinding de hele functie af.
  client.on("error", () => {});
  return client;
}

/** Een foutmelding van de mailserver, in woorden voor op het scherm. */
export function uitlegFout(e: unknown): { tekst: string; inlog: boolean } {
  const fout = e as { authenticationFailed?: boolean; message?: string; code?: string };
  if (fout?.authenticationFailed) {
    return { tekst: "Inloggen geweigerd: kloppen het adres en wachtwoord nog?", inlog: true };
  }
  const reden = fout?.code || fout?.message || String(e);
  return { tekst: `De mailserver gaf een fout: ${reden}`.slice(0, 300), inlog: false };
}

/** Het slot pakken. Geeft het slot terug, of null als er al een ronde loopt. */
export async function pakSlot(db: Db, mailboxId: string): Promise<Slot | null> {
  const nu = new Date();
  const tot = new Date(nu.getTime() + SLOT_MS).toISOString();
  const { data, error } = await db
    .from("mailboxen")
    .update({ bezig_tot: tot })
    .eq("id", mailboxId)
    .or(`bezig_tot.is.null,bezig_tot.lt."${nu.toISOString()}"`)
    .select("id");
  // Een databasefout is iets anders dan "er loopt al een ronde".
  if (error) throw new Error(`Slot pakken: ${error.message}`);
  return (data ?? []).length > 0 ? { tot } : null;
}

async function verlengSlot(db: Db, mailboxId: string, slot: Slot) {
  const nieuw = new Date(Date.now() + SLOT_MS).toISOString();
  const { data, error } = await db
    .from("mailboxen")
    .update({ bezig_tot: nieuw })
    .eq("id", mailboxId)
    .eq("bezig_tot", slot.tot)
    .select("id");
  if (error) throw new Error(`Slot verlengen: ${error.message}`);
  if ((data ?? []).length === 0) throw new SlotKwijt();
  slot.tot = nieuw;
}

/**
 * Het eigen slot vrijgeven, en vastleggen dat er een poging was. Mag nooit
 * zelf een fout gooien: dit draait in een `finally`, en daar zou een fout de
 * echte uitkomst van de ronde overschrijven. Een slot dat blijft staan loopt
 * vanzelf af.
 */
async function geefSlotVrij(db: Db, mailboxId: string, slot: Slot) {
  const nu = new Date().toISOString();
  try {
    const { error: vrijFout } = await db
      .from("mailboxen")
      .update({ bezig_tot: null, laatste_poging: nu })
      .eq("id", mailboxId)
      .eq("bezig_tot", slot.tot);
    if (vrijFout) console.error("Slot vrijgeven:", vrijFout.message);
    // Was het slot al van een ander, dan toch de poging noteren: anders staat
    // deze mailbox bij de klok eeuwig vooraan.
    const { error: pogingFout } = await db
      .from("mailboxen")
      .update({ laatste_poging: nu })
      .eq("id", mailboxId);
    if (pogingFout) console.error("Poging noteren:", pogingFout.message);
  } catch (e) {
    console.error("Slot vrijgeven:", e instanceof Error ? e.message : e);
  }
}

export function rolVan(pad: string, specialUse?: string): MapRol | null {
  if (pad.toUpperCase() === "INBOX") return "postvak";
  switch (specialUse) {
    case "\\Sent":
      return "verzonden";
    case "\\Drafts":
      return "concepten";
    case "\\Trash":
      return "prullenbak";
    case "\\Junk":
      return "spam";
    // Verzamelmappen (Gmail "Alle berichten", "Met ster") bevatten kopieën van
    // mail die al in een andere map staat. Die slaan we over.
    case "\\All":
    case "\\Flagged":
      return null;
    default:
      return "overig";
  }
}

/**
 * Zoeken bij de server. imapflow geeft `false` als het zoeken mislukt; dat
 * mag nooit als "de map is leeg" gelezen worden, anders verdwijnt de hele map
 * uit beeld.
 */
async function zoek(client: ImapFlow, vraag: Record<string, unknown>): Promise<number[]> {
  const uit = await client.search(vraag, { uid: true });
  if (!Array.isArray(uit)) throw new Error("Zoeken bij de mailserver mislukte.");
  return uit;
}

export interface Uitkomst {
  nieuw: number;
  /** Alles binnen het venster is binnen. Onwaar = de volgende ronde gaat door. */
  klaar: boolean;
  fout?: string;
}

/**
 * Eén ronde voor één mailbox. Verwacht het slot dat `pakSlot` gaf, en geeft
 * het aan het eind altijd weer vrij.
 */
export async function haalOp(
  db: Db,
  box: MailboxRij,
  slot: Slot,
  opties: { tijdMs?: number } = {},
): Promise<Uitkomst> {
  const deadline = Date.now() + (opties.tijdMs ?? STANDAARD_TIJD_MS);

  // Een fout die niet aan de mailbox ligt: alleen melden, status laten staan.
  const meldFout = async (tekst: string, velden: Record<string, unknown> = {}) => {
    await db
      .from("mailboxen")
      .update({ fout: tekst, ...velden })
      .eq("id", box.id)
      .neq("status", "uit");
  };

  let client: ImapFlow | null = null;
  let nieuw = 0;
  let klaar = true;
  try {
    const { data: geheim, error: geheimFout } = await db
      .from("mailbox_geheimen")
      .select("versleuteld,iv")
      .eq("mailbox_id", box.id)
      .maybeSingle();
    if (geheimFout) {
      // Een haperende database is geen kwijtgeraakt wachtwoord.
      const tekst = "De database was even niet bereikbaar; de volgende ronde probeert het weer.";
      await meldFout(tekst);
      return { nieuw: 0, klaar: false, fout: tekst };
    }

    let wachtwoord = "";
    try {
      if (!geheim) throw new Error("geen wachtwoord");
      wachtwoord = await ontsleutel(geheim.versleuteld, geheim.iv);
    } catch {
      // Geen of onleesbaar wachtwoord: dit gaat niet vanzelf over. Maar net
      // ontkoppeld ("uit") mag niet ineens "fout" worden.
      const tekst = "Wooshy kent het wachtwoord niet meer. Koppel de mailbox opnieuw.";
      await meldFout(tekst, { status: "fout" });
      return { nieuw: 0, klaar: false, fout: tekst };
    }

    client = maakImap(box, wachtwoord);
    try {
      await client.connect();
    } catch (e) {
      const { tekst, inlog } = uitlegFout(e);
      // Een geweigerde login blijft niet elke twee minuten proberen: te veel
      // mislukte pogingen en de provider zet het account op slot. Een storing
      // mag wél vanzelf overgaan, dus dan blijft de status staan.
      await meldFout(tekst, inlog ? { status: "fout" } : {});
      return { nieuw: 0, klaar: false, fout: tekst };
    }

    const mappen = await bewaarMappen(db, box, await client.list());
    mappen.sort((a, b) => MAP_VOORRANG.indexOf(a.rol) - MAP_VOORRANG.indexOf(b.rol));

    // Lus 1: nalopen wat er staat.
    const stand = new Map<string, MapStand>();
    for (const map of mappen) {
      const s = await loopMapNa(db, client, map);
      if (s) stand.set(map.id, s);
      await verlengSlot(db, box.id, slot);
    }

    // Lus 2: nieuwe mail.
    for (const map of mappen) {
      const s = stand.get(map.id);
      if (!s) continue;
      if (Date.now() > deadline || nieuw >= MAX_NIEUW) {
        klaar = false;
        break;
      }
      const uit = await haalNieuwOp(db, client, box, map, s, {
        deadline,
        ruimte: MAX_NIEUW - nieuw,
      });
      nieuw += uit.nieuw;
      if (!uit.klaar) klaar = false;
      await verlengSlot(db, box.id, slot);
    }

    await ruimOp(db, box.id);
    // Status alleen terug naar actief als niemand intussen ontkoppelde.
    await db
      .from("mailboxen")
      .update({ status: "actief", fout: "", laatste_sync: new Date().toISOString() })
      .eq("id", box.id)
      .neq("status", "uit");
    return { nieuw, klaar };
  } catch (e) {
    // Slot kwijt aan een nieuwere ronde: die maakt het af. Geen melding,
    // want er is niets mis met de mailbox.
    if (e instanceof SlotKwijt) return { nieuw, klaar: false };
    const { tekst } = uitlegFout(e);
    await meldFout(tekst);
    return { nieuw, klaar: false, fout: tekst };
  } finally {
    await geefSlotVrij(db, box.id, slot);
    if (client) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }
}

/**
 * De mappenlijst van de server vastleggen. Een map die daar niet meer staat
 * gaat niet meteen weg: zijn mail wordt "niet meer gezien", zodat hij in een
 * hernoemde map terug te vinden is. De lege map verdwijnt later vanzelf.
 */
async function bewaarMappen(
  db: Db,
  box: MailboxRij,
  lijst: { path: string; specialUse?: string; flags: Set<string> }[],
): Promise<MapRij[]> {
  const bruikbaar = lijst
    .filter((m) => !m.flags.has("\\Noselect") && !m.flags.has("\\NonExistent"))
    .map((m) => ({ pad: m.path, rol: rolVan(m.path, m.specialUse) }))
    .filter((m): m is { pad: string; rol: MapRol } => m.rol !== null);

  // Een lege lijst is bij een echte mailbox nooit waar (INBOX bestaat altijd).
  if (bruikbaar.length === 0) throw new Error("De mailserver gaf geen mappen terug.");

  const { error } = await db.from("mail_mappen").upsert(
    bruikbaar.map((m) => ({
      company_id: box.company_id,
      mailbox_id: box.id,
      pad: m.pad,
      rol: m.rol,
    })),
    { onConflict: "mailbox_id,pad" },
  );
  if (error) throw new Error(`Mappen bewaren: ${error.message}`);

  const { data, error: leesFout } = await db
    .from("mail_mappen")
    .select("id,pad,rol,uidvalidity")
    .eq("mailbox_id", box.id);
  if (leesFout) throw new Error(`Mappen lezen: ${leesFout.message}`);

  const paden = new Set(bruikbaar.map((m) => m.pad));
  for (const map of (data as MapRij[]).filter((m) => !paden.has(m.pad))) {
    const { error: wegFout } = await db
      .from("berichten")
      .update({ op_server: false, weg_sinds: new Date().toISOString() })
      .eq("map_id", map.id)
      .eq("op_server", true);
    if (wegFout) throw new Error(`Verdwenen map: ${wegFout.message}`);

    const { count, error: telFout } = await db
      .from("berichten")
      .select("id", { count: "exact", head: true })
      .eq("map_id", map.id);
    if (telFout) throw new Error(`Verdwenen map: ${telFout.message}`);
    if ((count ?? 0) === 0) {
      const { error: mapFout } = await db.from("mail_mappen").delete().eq("id", map.id);
      if (mapFout) throw new Error(`Map opruimen: ${mapFout.message}`);
    }
  }
  return (data as MapRij[]).filter((m) => paden.has(m.pad));
}

interface BekendeRij {
  id: string;
  uid: number;
  gelezen: boolean;
  gemarkeerd: boolean;
}

/** Alle rijen die we van deze map kennen, in pagina's tot er een lege komt. */
async function bekendeRijen(db: Db, mapId: string, uidvalidity: number): Promise<BekendeRij[]> {
  const uit: BekendeRij[] = [];
  const stap = 1000;
  for (let vanaf = 0; ; vanaf += stap) {
    const { data, error } = await db
      .from("berichten")
      .select("id,uid,gelezen,gemarkeerd")
      .eq("map_id", mapId)
      .eq("uidvalidity", uidvalidity)
      .eq("op_server", true)
      .order("uid")
      .range(vanaf, vanaf + stap - 1);
    if (error) throw new Error(`Berichten lezen: ${error.message}`);
    const rijen = (data ?? []) as BekendeRij[];
    if (rijen.length === 0) return uit;
    uit.push(...rijen.map((r) => ({ ...r, uid: Number(r.uid) })));
  }
}

async function zet(db: Db, ids: string[], velden: Record<string, unknown>) {
  for (const stuk of inStukjes(ids)) {
    const { error } = await db.from("berichten").update(velden).in("id", stuk);
    if (error) throw new Error(`Berichten bijwerken: ${error.message}`);
  }
}

/** Wat lus 1 over een map weet, voor lus 2. */
interface MapStand {
  uidvalidity: number;
  bekend: Set<number>;
  leeg: boolean;
}

async function loopMapNa(db: Db, client: ImapFlow, map: MapRij): Promise<MapStand | null> {
  const lock = await client.getMailboxLock(map.pad, { readOnly: true });
  try {
    const info = client.mailbox;
    if (!info) return null;
    const uidvalidity = Number(info.uidValidity);

    // 1. Opnieuw genummerd: alles van vroeger is "niet meer gezien".
    if (map.uidvalidity !== null && Number(map.uidvalidity) !== uidvalidity) {
      const { error } = await db
        .from("berichten")
        .update({ op_server: false, weg_sinds: new Date().toISOString() })
        .eq("map_id", map.id)
        .eq("op_server", true);
      if (error) throw new Error(`Map opnieuw genummerd: ${error.message}`);
    }

    const opServer = new Set(info.exists > 0 ? await zoek(client, { all: true }) : []);
    const bekend = await bekendeRijen(db, map.id, uidvalidity);

    // 2. Weg van de server.
    const weg = bekend.filter((r) => !opServer.has(r.uid));
    await zet(db, weg.map((r) => r.id), { op_server: false, weg_sinds: new Date().toISOString() });
    const blijft = bekend.filter((r) => opServer.has(r.uid));

    // 3. Gelezen en gemarkeerd. Eerst alles verzamelen: tijdens een lopende
    //    fetch mag er geen ander IMAP-commando tussendoor.
    if (blijft.length > 0) {
      const perUid = new Map(blijft.map((r) => [r.uid, r]));
      const gelezenAan: string[] = [];
      const gelezenUit: string[] = [];
      const vlagAan: string[] = [];
      const vlagUit: string[] = [];
      for await (const m of client.fetch("1:*", { uid: true, flags: true }, { uid: true })) {
        const rij = perUid.get(m.uid);
        if (!rij) continue;
        const gelezen = m.flags?.has("\\Seen") ?? false;
        const gemarkeerd = m.flags?.has("\\Flagged") ?? false;
        if (gelezen !== rij.gelezen) (gelezen ? gelezenAan : gelezenUit).push(rij.id);
        if (gemarkeerd !== rij.gemarkeerd) (gemarkeerd ? vlagAan : vlagUit).push(rij.id);
      }
      await zet(db, gelezenAan, { gelezen: true });
      await zet(db, gelezenUit, { gelezen: false });
      await zet(db, vlagAan, { gemarkeerd: true });
      await zet(db, vlagUit, { gemarkeerd: false });
    }

    const ongelezen = info.exists > 0 ? (await zoek(client, { seen: false })).length : 0;
    const { error: telFout } = await db
      .from("mail_mappen")
      .update({
        uidvalidity,
        aantal: info.exists,
        ongelezen,
        bijgewerkt_op: new Date().toISOString(),
      })
      .eq("id", map.id);
    if (telFout) throw new Error(`Map bijwerken: ${telFout.message}`);

    return { uidvalidity, bekend: new Set(blijft.map((r) => r.uid)), leeg: info.exists === 0 };
  } finally {
    lock.release();
  }
}

async function haalNieuwOp(
  db: Db,
  client: ImapFlow,
  box: MailboxRij,
  map: MapRij,
  stand: MapStand,
  { deadline, ruimte }: { deadline: number; ruimte: number },
): Promise<{ nieuw: number; klaar: boolean }> {
  if (stand.leeg) return { nieuw: 0, klaar: true };
  const lock = await client.getMailboxLock(map.pad, { readOnly: true });
  try {
    const info = client.mailbox;
    // Tussen de twee lussen opnieuw genummerd: volgende ronde weer.
    if (!info || Number(info.uidValidity) !== stand.uidvalidity) return { nieuw: 0, klaar: false };

    const venster = await zoek(client, { since: new Date(box.import_vanaf) });
    const ontbrekend = venster.filter((uid) => !stand.bekend.has(uid)).sort((a, b) => b - a);
    const deze = ontbrekend.slice(0, Math.max(0, ruimte));
    let klaar = ontbrekend.length === deze.length;
    let nieuw = 0;
    if (deze.length === 0) return { nieuw, klaar };

    const koppen = await client.fetchAll(
      deze.join(","),
      {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
      },
      { uid: true },
    );
    koppen.sort((a, b) => b.uid - a.uid);

    for (const kop of koppen) {
      if (Date.now() > deadline) {
        klaar = false;
        break;
      }
      const groot = (kop.size ?? 0) > GROTE_MAIL;
      const bron = await client.fetchOne(
        String(kop.uid),
        { uid: true, source: groot ? { start: 0, maxLength: DEEL_VAN_GROTE_MAIL } : true },
        { uid: true },
      );
      const rij = await maakRij(box, map, stand.uidvalidity, kop, bron ? bron.source : undefined, groot);
      // Eén mail die niet op te slaan is mag de rest niet tegenhouden: anders
      // staat hij elke ronde weer vooraan en komt er nooit meer iets binnen.
      // Dan eerst een kale versie proberen, en lukt ook dat niet, overslaan.
      try {
        await bewaarBericht(db, box, rij);
      } catch (e) {
        console.error(`Mail ${kop.uid} in ${map.pad}:`, e instanceof Error ? e.message : e);
        try {
          await bewaarBericht(db, box, kaleRij(rij));
        } catch (e2) {
          console.error(`Ook kaal niet:`, e2 instanceof Error ? e2.message : e2);
          continue;
        }
      }
      nieuw += 1;
    }
    return { nieuw, klaar };
  } finally {
    lock.release();
  }
}

// --- Eén mail omzetten naar een rij ------------------------------------------

interface Adres {
  naam: string;
  email: string;
}

/** Postgres weigert het nul-teken in tekst; mail van buiten kan het bevatten. */
function schoon(tekst: string | undefined | null): string {
  return (tekst ?? "").split(NUL_TEKEN).join("");
}

/**
 * Inkorten zonder een teken doormidden te knippen. Een emoji bestaat in
 * JavaScript uit twee helften; een losse helft weigert de database.
 */
export function knip(tekst: string, max: number): string {
  if (tekst.length <= max) return tekst;
  const stuk = tekst.slice(0, max);
  const laatste = stuk.charCodeAt(stuk.length - 1);
  return laatste >= 0xd800 && laatste <= 0xdbff ? stuk.slice(0, -1) : stuk;
}

function adressen(lijst: { name?: string; address?: string }[] | undefined): Adres[] {
  return (lijst ?? [])
    .map((a) => ({
      naam: knip(schoon(a.name).trim(), 300),
      email: knip(schoon(a.address).trim().toLowerCase(), 300),
    }))
    .filter((a) => a.email || a.naam);
}

/** Uit html alleen de leesbare tekst, voor mails die geen platte versie meesturen. */
export function htmlNaarTekst(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

interface Structuur {
  type?: string;
  parameters?: Record<string, string>;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  size?: number;
  childNodes?: Structuur[];
}

/** Welke bijlagen erbij zaten, uit de structuur die de server al gaf. */
export function bijlagenUit(structuur: Structuur | undefined): { naam: string; type: string; grootte: number }[] {
  const uit: { naam: string; type: string; grootte: number }[] = [];
  const loop = (deel: Structuur | undefined) => {
    if (!deel) return;
    if (deel.childNodes?.length) {
      deel.childNodes.forEach(loop);
      return;
    }
    const naam = deel.dispositionParameters?.filename || deel.parameters?.name || "";
    const type = (deel.type ?? "").toLowerCase();
    const isTekst = type === "text/plain" || type === "text/html";
    if (deel.disposition === "attachment" || (naam && !isTekst)) {
      uit.push({ naam: knip(schoon(naam), 300) || "bijlage", type: knip(type, 100), grootte: deel.size ?? 0 });
    }
  };
  loop(structuur);
  return uit.slice(0, 100);
}

function referentiesUit(waarde: string | undefined): string[] {
  return (schoon(waarde).match(/<[^<>\s]+>/g) ?? []).slice(-50).map((r) => knip(r, 500));
}

async function maakRij(
  box: MailboxRij,
  map: MapRij,
  uidvalidity: number,
  kop: {
    uid: number;
    flags?: Set<string>;
    envelope?: {
      date?: Date | string;
      subject?: string;
      messageId?: string;
      inReplyTo?: string;
      from?: { name?: string; address?: string }[];
      to?: { name?: string; address?: string }[];
      cc?: { name?: string; address?: string }[];
      replyTo?: { name?: string; address?: string }[];
    };
    internalDate?: Date | string;
    size?: number;
    bodyStructure?: unknown;
  },
  bron: Uint8Array | undefined,
  afgekapt: boolean,
) {
  // deno-lint-ignore no-explicit-any
  let mail: any = null;
  if (bron) {
    try {
      mail = await PostalMime.parse(bron);
    } catch {
      // Onleesbare mail: we bewaren wat de server er zelf over wist.
    }
  }

  const env = kop.envelope ?? {};
  const van = adressen(env.from)[0] ?? { naam: "", email: "" };
  const html = schoon(mail?.html);
  const tekst = schoon(mail?.text) || (html ? htmlNaarTekst(html) : "");
  const referentieKop = (mail?.headers as { key: string; value: string }[] | undefined)?.find(
    (h) => h.key === "references",
  )?.value;

  const datum = new Date(kop.internalDate ?? env.date ?? Date.now());
  const ontvangen = Number.isNaN(datum.getTime()) ? new Date() : datum;
  const richting =
    map.rol === "verzonden" || map.rol === "concepten" || van.email === box.adres.toLowerCase()
      ? "uit"
      : "in";

  return {
    company_id: box.company_id,
    mailbox_id: box.id,
    map_id: map.id,
    uidvalidity,
    uid: kop.uid,
    message_id: knip(schoon(env.messageId || mail?.messageId).trim(), 500),
    in_reply_to: knip(schoon(env.inReplyTo || mail?.inReplyTo).trim(), 500),
    referenties: referentiesUit(referentieKop),
    richting,
    van_naam: van.naam,
    van_email: van.email,
    aan: adressen(env.to).slice(0, 100),
    cc: adressen(env.cc).slice(0, 100),
    antwoord_naar: adressen(env.replyTo)[0]?.email ?? "",
    onderwerp: knip(schoon(env.subject || mail?.subject).trim(), 500),
    fragment: knip(tekst.replace(/\s+/g, " ").trim(), 200),
    tekst: knip(tekst, MAX_TEKST),
    // Afgekapte html is kapotte html; dan liever de tekst alleen.
    html: html.length > MAX_HTML ? "" : html,
    bijlagen: bijlagenUit(kop.bodyStructure as Structuur | undefined),
    grootte: kop.size ?? 0,
    afgekapt: afgekapt || html.length > MAX_HTML || tekst.length > MAX_TEKST,
    ontvangen_op: ontvangen.toISOString(),
    gelezen: kop.flags?.has("\\Seen") ?? false,
    gemarkeerd: kop.flags?.has("\\Flagged") ?? false,
    paaltje_status:
      richting === "in" && map.rol === "postvak" && ontvangen >= new Date(box.paaltje_vanaf)
        ? "wacht"
        : "overslaan",
  };
}

type BerichtRij = Awaited<ReturnType<typeof maakRij>>;

/** Alleen wat een mail in de lijst herkenbaar maakt; de rest leeg. */
function kaleRij(rij: BerichtRij): BerichtRij {
  return {
    ...rij,
    referenties: [],
    aan: [],
    cc: [],
    fragment: "",
    tekst: "",
    html: "",
    bijlagen: [],
    afgekapt: true,
    onderwerp: rij.onderwerp.replace(/[^\x20-\x7e]/g, "?"),
    van_naam: rij.van_naam.replace(/[^\x20-\x7e]/g, "?"),
  };
}

/**
 * Een mail bewaren. Stond hij eerder in een andere map en was hij daar
 * verdwenen, dan is hij verplaatst: dezelfde rij krijgt zijn nieuwe plek.
 */
async function bewaarBericht(db: Db, box: MailboxRij, rij: BerichtRij) {
  if (rij.message_id) {
    const { data: los, error: zoekFout } = await db
      .from("berichten")
      .select("id")
      .eq("mailbox_id", box.id)
      .eq("message_id", rij.message_id)
      .eq("op_server", false)
      .order("weg_sinds", { ascending: false })
      .limit(1);
    // Niet kunnen zoeken is niet hetzelfde als niets gevonden: dan liever
    // deze ronde overslaan dan een dubbele rij maken.
    if (zoekFout) throw new Error(`Verplaatste mail zoeken: ${zoekFout.message}`);
    if (los && los.length > 0) {
      const { error } = await db
        .from("berichten")
        .update({
          map_id: rij.map_id,
          uidvalidity: rij.uidvalidity,
          uid: rij.uid,
          op_server: true,
          weg_sinds: null,
          gelezen: rij.gelezen,
          gemarkeerd: rij.gemarkeerd,
        })
        .eq("id", los[0].id);
      if (!error) return;
      // Botst de nieuwe plek met een rij die er al staat: gewoon verder.
    }
  }

  const { error } = await db
    .from("berichten")
    .upsert(rij, { onConflict: "map_id,uidvalidity,uid", ignoreDuplicates: true });
  if (error) throw new Error(`Bericht bewaren: ${error.message}`);
}

/** Wat al een paar dagen nergens meer opdook, is echt weg. */
async function ruimOp(db: Db, mailboxId: string) {
  const { error } = await db
    .from("berichten")
    .delete()
    .eq("mailbox_id", mailboxId)
    .eq("op_server", false)
    .lt("weg_sinds", new Date(Date.now() - WEG_NA_MS).toISOString());
  // Opruimen mag een keer mislukken; de volgende ronde probeert het weer.
  if (error) console.error(`Opruimen: ${error.message}`);
}
