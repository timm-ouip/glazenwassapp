/**
 * Alles wat met Meta's WhatsApp Cloud API te maken heeft en door meerdere
 * functies gebruikt wordt: de handtekening van een webhook controleren, een
 * webhook omzetten in rijen voor `berichten`, en de Graph API aanroepen.
 *
 * Een koppeling loopt rechtstreeks via Meta (het testnummer, met een token
 * per bedrijf) of via Kapso (een Meta-partner, met één sleutel voor alle
 * bedrijven). Kapso volgt de paden en berichten van Meta, dus alleen het
 * adres en de sleutel verschillen; dat regelt `graph()`.
 *
 * Wat hier binnenkomt is van buiten: elk veld wordt nagekeken en ingekort
 * voordat het de database in gaat.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export const GRAPH = "https://graph.facebook.com/v23.0";
/** Kapso's doorgeefluik naar Meta: dezelfde paden, eigen sleutel. */
export const KAPSO_GRAPH = "https://api.kapso.ai/meta/whatsapp/v24.0";
export const KAPSO_PLATFORM = "https://api.kapso.ai/platform/v1";

/** Hoe we bij WhatsApp binnenkomen voor één koppeling. */
export type Toegang =
  | { aanbieder: "meta"; token: string }
  | { aanbieder: "kapso"; sleutel: string; phoneNumberId: string };

const MAX_TEKST = 20_000;

/** Klopt `X-Hub-Signature-256` (Meta) bij deze body? Vergelijkt in vaste tijd. */
export function handtekeningKlopt(body: string, kop: string | null, geheim: string): Promise<boolean> {
  if (!kop?.startsWith("sha256=")) return Promise.resolve(false);
  return hmacKlopt(body, kop.slice("sha256=".length), geheim);
}

/** Klopt `X-Webhook-Signature` (Kapso, kaal hex) bij deze body? */
export function kapsoHandtekeningKlopt(body: string, kop: string | null, geheim: string): Promise<boolean> {
  return hmacKlopt(body, kop ?? "", geheim);
}

async function hmacKlopt(body: string, hex: string, geheim: string): Promise<boolean> {
  if (!geheim || !hex) return false;
  const sleutel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(geheim),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const handtekening = new Uint8Array(await crypto.subtle.sign("HMAC", sleutel, new TextEncoder().encode(body)));
  const verwacht = [...handtekening].map((b) => b.toString(16).padStart(2, "0")).join("");
  const gekregen = hex.trim().toLowerCase();
  if (gekregen.length !== verwacht.length) return false;
  let verschil = 0;
  for (let i = 0; i < verwacht.length; i++) verschil |= verwacht.charCodeAt(i) ^ gekregen.charCodeAt(i);
  return verschil === 0;
}

/** Alleen cijfers: "+31 6 1234 5678" → "31612345678". */
export function waNummer(tekst: unknown): string {
  return String(tekst ?? "").replace(/\D/g, "").slice(0, 20);
}

function knip(tekst: string, max: number): string {
  return tekst.length <= max ? tekst : tekst.slice(0, max);
}

function obj(waarde: unknown): Record<string, unknown> {
  return waarde && typeof waarde === "object" && !Array.isArray(waarde) ? (waarde as Record<string, unknown>) : {};
}

function lijst(waarde: unknown): unknown[] {
  return Array.isArray(waarde) ? waarde : [];
}

/** Wat er in de lijst en voor Paaltje staat als een bericht geen tekst is. */
const OMSCHRIJVING: Record<string, string> = {
  image: "[foto]",
  audio: "[spraakbericht]",
  video: "[video]",
  document: "[document]",
  sticker: "[sticker]",
  location: "[locatie]",
  contacts: "[contact]",
  reaction: "[reactie]",
  unsupported: "[bericht dat WhatsApp niet doorgeeft]",
};

export interface WaMedia {
  media_id: string;
  mime: string;
  naam: string;
  /** Leeg zolang het bestand nog niet in de opslag staat. */
  pad: string;
}

/** De tekst en eventuele media van één bericht zoals WhatsApp het stuurt. */
export function leesInhoud(bericht: Record<string, unknown>): { type: string; tekst: string; media: WaMedia[] } {
  const type = knip(String(bericht.type ?? ""), 30);
  const deel = obj(bericht[type]);
  let tekst = "";
  if (type === "text") tekst = String(obj(bericht.text).body ?? "");
  else if (type === "button") tekst = String(obj(bericht.button).text ?? "");
  else if (type === "interactive") {
    const i = obj(bericht.interactive);
    tekst = String(obj(i.button_reply).title ?? obj(i.list_reply).title ?? "");
  } else if (type === "reaction") tekst = `[reactie ${String(deel.emoji ?? "")}]`.trim();
  else if (type === "location") {
    const naam = [deel.name, deel.address].filter(Boolean).join(", ");
    tekst = naam ? `[locatie: ${naam}]` : "[locatie]";
  } else {
    const onderschrift = String(deel.caption ?? "").trim();
    const omschrijving = OMSCHRIJVING[type] ?? `[${type || "bericht"}]`;
    tekst = onderschrift ? `${omschrijving} ${onderschrift}` : omschrijving;
  }

  const media: WaMedia[] = [];
  if (["image", "audio", "video", "document", "sticker"].includes(type) && typeof deel.id === "string") {
    media.push({
      media_id: knip(deel.id, 100),
      mime: knip(String(deel.mime_type ?? ""), 100),
      naam: knip(String(deel.filename ?? ""), 200),
      pad: "",
    });
  }
  return { type, tekst: knip(tekst.trim(), MAX_TEKST), media };
}

export interface WaRij {
  kanaal: "whatsapp";
  company_id: string;
  wa_id: string;
  wa_telefoon: string;
  wa_type: string;
  richting: "in" | "uit";
  bron: "klant" | "app" | "geschiedenis";
  van_naam: string;
  tekst: string;
  fragment: string;
  media: WaMedia[];
  ontvangen_op: string;
  gelezen: boolean;
  /** Een appje staat niet op een mailserver. */
  op_server: false;
  paaltje_status: "overslaan" | "wacht";
}

function tijd(timestamp: unknown): string {
  const s = Number(timestamp);
  const d = Number.isFinite(s) && s > 0 ? new Date(s * 1000) : new Date();
  return d.toISOString();
}

function rij(
  companyId: string,
  bericht: Record<string, unknown>,
  ander: string,
  richting: "in" | "uit",
  bron: WaRij["bron"],
  naam: string,
): WaRij | null {
  const id = knip(String(bericht.id ?? ""), 200);
  if (!id || !ander) return null;
  const inhoud = leesInhoud(bericht);
  return {
    kanaal: "whatsapp",
    company_id: companyId,
    wa_id: id,
    wa_telefoon: ander,
    wa_type: inhoud.type,
    richting,
    bron,
    van_naam: knip(naam, 200),
    tekst: inhoud.tekst,
    fragment: knip(inhoud.tekst.replace(/\s+/g, " "), 200),
    media: inhoud.media,
    ontvangen_op: tijd(bericht.timestamp),
    // Wat je zelf stuurde of wat uit de geschiedenis komt, is al gelezen.
    gelezen: bron !== "klant",
    op_server: false,
    // Paaltje leest pas mee vanaf fase 3.
    paaltje_status: "overslaan",
  };
}

export interface Webhookinhoud {
  phoneNumberId: string;
  eigenNummer: string;
  rijen: WaRij[];
  statussen: { wa_id: string; status: string; fout: string }[];
}

/**
 * Eén `change` uit een webhook. `companyId` hoort bij het phone_number_id in
 * `metadata`; dat zoekt de aanroeper eerst op.
 */
export function leesWijziging(
  field: string,
  value: Record<string, unknown>,
  companyId: string,
  /** Het eigen nummer uit de koppeling, voor als Meta het niet meestuurt. */
  reserveNummer = "",
): Webhookinhoud {
  const metadata = obj(value.metadata);
  const eigenNummer = waNummer(metadata.display_phone_number) || waNummer(reserveNummer);
  const uit: Webhookinhoud = {
    phoneNumberId: String(metadata.phone_number_id ?? ""),
    eigenNummer,
    rijen: [],
    statussen: [],
  };

  if (field === "messages") {
    const namen = new Map<string, string>();
    for (const c of lijst(value.contacts)) {
      const contact = obj(c);
      namen.set(waNummer(contact.wa_id), String(obj(contact.profile).name ?? ""));
    }
    for (const b of lijst(value.messages)) {
      const bericht = obj(b);
      const van = waNummer(bericht.from);
      const r = rij(companyId, bericht, van, "in", "klant", namen.get(van) ?? "");
      if (r) uit.rijen.push(r);
    }
    for (const s of lijst(value.statuses)) {
      const status = obj(s);
      const fout = lijst(status.errors).map((e) => String(obj(e).title ?? obj(e).message ?? "")).join("; ");
      uit.statussen.push({ wa_id: String(status.id ?? ""), status: String(status.status ?? ""), fout: knip(fout, 500) });
    }
  }

  // Wat je in de WhatsApp Business-app op je telefoon verstuurde.
  if (field === "smb_message_echoes") {
    for (const b of lijst(value.message_echoes)) {
      const bericht = obj(b);
      const r = rij(companyId, bericht, waNummer(bericht.to), "uit", "app", "");
      if (r) uit.rijen.push(r);
    }
  }

  // De chats van vóór het koppelen.
  if (field === "history") {
    for (const h of lijst(value.history)) {
      for (const t of lijst(obj(h).threads)) {
        const draad = obj(t);
        const ander = waNummer(draad.id);
        for (const b of lijst(draad.messages)) {
          const bericht = obj(b);
          const vanMij = eigenNummer !== "" && waNummer(bericht.from) === eigenNummer;
          const r = rij(companyId, bericht, ander, vanMij ? "uit" : "in", "geschiedenis", "");
          if (r) uit.rijen.push(r);
        }
      }
    }
  }

  return uit;
}

/**
 * Eén gebeurtenis uit een Kapso-webhook (`whatsapp.message.*`, vorm v2):
 * `{ message, conversation, phone_number_id }`. Het bericht zelf heeft de
 * vorm van Meta, met een extra blok `kapso` (richting, herkomst, status).
 *
 * - binnengekomen: een rij van de klant (of uit de geschiedenis);
 * - verstuurd vanuit de WhatsApp Business-app (herkomst business_app): een
 *   rij met bron app, net als Meta's echo;
 * - verstuurd vanuit Paaltje Systems zelf (herkomst cloud_api): die rij schreven we
 *   al bij het versturen, dus alleen de status.
 */
export function leesKapsoGebeurtenis(item: Record<string, unknown>, companyId: string): Webhookinhoud {
  const bericht = obj(item.message);
  const kapso = obj(bericht.kapso);
  const gesprek = obj(item.conversation);
  const uit: Webhookinhoud = {
    phoneNumberId: String(item.phone_number_id ?? gesprek.phone_number_id ?? ""),
    eigenNummer: "",
    rijen: [],
    statussen: [],
  };
  const richting = kapso.direction === "outbound" ? "uit" : "in";
  const herkomst = String(kapso.origin ?? "");
  const ander = waNummer(richting === "in" ? bericht.from : bericht.to) || waNummer(gesprek.phone_number);
  const naam = richting === "in" ? String(gesprek.contact_name ?? "") : "";

  let r: WaRij | null = null;
  if (herkomst === "history_sync") r = rij(companyId, bericht, ander, richting, "geschiedenis", naam);
  else if (richting === "in") r = rij(companyId, bericht, ander, "in", "klant", naam);
  else if (herkomst === "business_app") r = rij(companyId, bericht, ander, "uit", "app", "");
  if (r) uit.rijen.push(r);

  if (richting === "uit") {
    const waId = String(bericht.id ?? "");
    const status = String(kapso.status ?? "");
    const meta = lijst(kapso.statuses).map(obj).find((x) => String(x.status ?? "") === status);
    const fout = lijst(meta?.errors).map((e) => String(obj(e).title ?? obj(e).message ?? "")).join("; ");
    if (waId && STATUS[status]) uit.statussen.push({ wa_id: waId, status, fout: knip(fout, 500) });
  }
  return uit;
}

/** WhatsApp-status → wat wij bewaren. Een status gaat nooit terug. */
export const STATUS: Record<string, { waarde: string; rang: number }> = {
  sent: { waarde: "verstuurd", rang: 1 },
  delivered: { waarde: "afgeleverd", rang: 2 },
  read: { waarde: "gelezen", rang: 3 },
  failed: { waarde: "mislukt", rang: 4 },
};

export const STATUS_RANG: Record<string, number> = { "": 0, verstuurd: 1, afgeleverd: 2, gelezen: 3, mislukt: 4 };

type Uitkomst<T> = { ok: true; data: T } | { ok: false; status: number; fout: string };

async function haal<T>(adres: string, koppen: Record<string, string>, init: RequestInit): Promise<Uitkomst<T>> {
  let res: Response;
  try {
    res = await fetch(adres, {
      ...init,
      headers: { ...koppen, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, status: 0, fout: e instanceof Error ? e.message : String(e) };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta: {error: {message}}. Kapso: soms {error: "tekst"} of {errors: [...]}.
    const j = obj(json);
    const fout = obj(j.error);
    const tekst =
      fout.error_user_msg ??
      fout.message ??
      (typeof j.error === "string" ? j.error : undefined) ??
      (Array.isArray(j.errors) ? j.errors.map((e) => (typeof e === "string" ? e : String(obj(e).message ?? obj(e).detail ?? ""))).join("; ") : undefined) ??
      res.statusText;
    return { ok: false, status: res.status, fout: String(tekst).slice(0, 500) };
  }
  return { ok: true, data: json as T };
}

/** Een Graph API-aanroep voor een koppeling, via Meta of via Kapso. */
export function graph<T>(pad: string, toegang: Toegang, init: RequestInit = {}): Promise<Uitkomst<T>> {
  if (toegang.aanbieder === "kapso") {
    return haal<T>(`${KAPSO_GRAPH}/${pad}`, { "X-API-Key": toegang.sleutel }, init);
  }
  return haal<T>(`${GRAPH}/${pad}`, { Authorization: `Bearer ${toegang.token}` }, init);
}

/** Een aanroep van Kapso's eigen API (klanten, koppellinks, webhooks). */
export function kapsoPlatform<T>(pad: string, sleutel: string, init: RequestInit = {}): Promise<Uitkomst<T>> {
  return haal<T>(`${KAPSO_PLATFORM}/${pad}`, { "X-API-Key": sleutel }, init);
}

/**
 * Hoe we bij WhatsApp binnenkomen voor deze koppeling, of null als dat niet
 * kan (token weg, of de Kapso-sleutel staat niet op de server).
 */
export async function toegangVan(
  db: Db,
  koppelingId: string,
  ontsleutel: (v: string, iv: string) => Promise<string>,
): Promise<Toegang | null> {
  const { data: koppeling, error } = await db
    .from("whatsapp_koppelingen")
    .select("aanbieder,phone_number_id")
    .eq("id", koppelingId)
    .maybeSingle();
  // Een storing is iets anders dan "geen toegang": niet laten opnieuw koppelen.
  if (error) throw new Error(`Koppeling ophalen: ${error.message}`);
  if (!koppeling) return null;
  if (koppeling.aanbieder === "kapso") {
    const sleutel = Deno.env.get("KAPSO_API_KEY") ?? "";
    return sleutel ? { aanbieder: "kapso", sleutel, phoneNumberId: String(koppeling.phone_number_id) } : null;
  }
  const { data, error: geheimFout } = await db
    .from("whatsapp_geheimen")
    .select("versleuteld,iv")
    .eq("koppeling_id", koppelingId)
    .maybeSingle();
  if (geheimFout) throw new Error(`Token ophalen: ${geheimFout.message}`);
  if (!data) return null;
  try {
    return { aanbieder: "meta", token: await ontsleutel(data.versleuteld, data.iv) };
  } catch {
    return null;
  }
}

export const MEDIA_BUCKET = "whatsapp-media";
/** Meta staat tot 16 MB voor foto, spraak en video toe; documenten tot 100 MB houden we buiten. */
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const EXTENSIE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

/**
 * Alleen bekende types bewaren we met hun eigen type. De rest (een "document"
 * dat eigenlijk een webpagina of SVG is) krijgt een neutraal type, zodat de
 * browser het nooit als pagina opent.
 */
function veiligType(mime: string): { mime: string; ext: string } {
  const kaal = mime.split(";")[0].trim().toLowerCase();
  const ext = EXTENSIE[kaal];
  return ext ? { mime: kaal, ext } : { mime: "application/octet-stream", ext: "bin" };
}

/**
 * Media van een bericht bij Meta ophalen en in de eigen opslag zetten. Meta
 * bewaart ze 7 dagen en de downloadlink werkt maar 5 minuten, dus dit gebeurt
 * meteen na binnenkomst. Wat al een pad heeft, blijft staan. Geeft terug of
 * alles nu binnen is.
 */
export async function haalMediaBinnen(
  db: Db,
  toegang: Toegang,
  companyId: string,
  berichtId: string,
  media: WaMedia[],
): Promise<{ media: WaMedia[]; compleet: boolean }> {
  let compleet = true;
  let veranderd = false;
  const uit: WaMedia[] = [];
  for (const m of media) {
    if (m.pad || !/^[\w-]{1,100}$/.test(m.media_id)) {
      uit.push(m);
      continue;
    }
    // Via Kapso: het nummer moet erbij, en Kapso geeft een eigen downloadlink
    // waar de toegang al in zit (4 minuten geldig). Meta's eigen link vraagt
    // een Meta-token, en dat hebben we dan niet.
    const kapso = toegang.aanbieder === "kapso";
    const info = await graph<{ url?: string; download_url?: string; mime_type?: string; file_size?: number | string }>(
      kapso ? `${m.media_id}?phone_number_id=${encodeURIComponent(toegang.phoneNumberId)}` : m.media_id,
      toegang,
    );
    const link = info.ok ? (kapso ? info.data.download_url : info.data.url) : undefined;
    if (!info.ok || !link || Number(info.data.file_size ?? 0) > MAX_MEDIA_BYTES) {
      if (!info.ok) console.error(`media ${m.media_id} opvragen:`, info.fout);
      compleet = false;
      uit.push(m);
      continue;
    }
    // Alleen van Meta of Kapso zelf downloaden; het token alleen naar Meta.
    let adres: URL;
    try {
      adres = new URL(link);
    } catch {
      compleet = false;
      uit.push(m);
      continue;
    }
    const hostKlopt = kapso
      ? adres.hostname === "api.kapso.ai"
      : /(^|\.)(fbsbx|facebook|whatsapp)\.(com|net)$/.test(adres.hostname);
    if (adres.protocol !== "https:" || !hostKlopt) {
      console.error(`media ${m.media_id}: onverwachte host ${adres.hostname}`);
      compleet = false;
      uit.push(m);
      continue;
    }
    try {
      const res = await fetch(adres, {
        headers: toegang.aanbieder === "meta" ? { Authorization: `Bearer ${toegang.token}` } : {},
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Eerst naar de opgegeven grootte kijken, dan pas inlezen.
      const lengte = Number(res.headers.get("content-length") ?? 0);
      if (lengte > MAX_MEDIA_BYTES) {
        await res.body?.cancel();
        throw new Error("te groot");
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("te groot");
      const { mime, ext } = veiligType(m.mime || String(info.data.mime_type ?? ""));
      const pad = `${companyId}/${berichtId}/${m.media_id}.${ext}`;
      const { error } = await db.storage.from(MEDIA_BUCKET).upload(pad, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error(error.message);
      uit.push({ ...m, mime, pad });
      veranderd = true;
    } catch (e) {
      console.error(`media ${m.media_id} ophalen:`, e instanceof Error ? e.message : e);
      compleet = false;
      uit.push(m);
    }
  }
  if (veranderd) {
    const { error } = await db.from("berichten").update({ media: uit }).eq("id", berichtId).eq("company_id", companyId);
    if (error) console.error("media opslaan in bericht:", error.message);
  }
  return { media: uit, compleet };
}

/** Een tekstbericht versturen. Geeft het wamid van WhatsApp terug. */
export async function verstuurTekst(
  toegang: Toegang,
  phoneNumberId: string,
  aan: string,
  tekst: string,
): Promise<{ ok: true; waId: string } | { ok: false; status: number; fout: string }> {
  const uit = await graph<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, toegang, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: aan,
      type: "text",
      text: { body: tekst, preview_url: false },
    }),
  });
  if (!uit.ok) return uit;
  const waId = String(uit.data.messages?.[0]?.id ?? "");
  if (!waId) return { ok: false, status: 502, fout: "WhatsApp gaf geen bericht-id terug." };
  return { ok: true, waId };
}

/** Het 24-uursvenster: vrije tekst mag tot 24 uur na het laatste bericht van de klant. */
export const VENSTER_MS = 24 * 60 * 60 * 1000;

/** Datum en tijd zoals in Nederland op de klok. */
function nederlandseKlok(d: Date): { j: number; m: number; d: number; u: number; min: number } {
  const delen = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { j: +delen.year, m: +delen.month, d: +delen.day, u: +delen.hour, min: +delen.minute };
}

/** Een Nederlandse kloktijd als echt moment (houdt rekening met zomer- en wintertijd). */
function vanNederlandseKlok(j: number, m: number, d: number, u: number, min: number): Date {
  const gok = Date.UTC(j, m - 1, d, u, min);
  const k = nederlandseKlok(new Date(gok));
  const verschil = Date.UTC(k.j, k.m - 1, k.d, k.u, k.min) - gok;
  return new Date(gok - verschil);
}

function minuten(tijd: string): number {
  const [u, m] = tijd.split(":").map((x) => Number(x));
  return (Number.isFinite(u) ? u : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Het eerste moment vanaf `moment` dat binnen de antwoordtijden valt
 * ("07:00" tot "21:00", Nederlandse tijd). Valt het er al binnen, dan dat.
 */
export function binnenAntwoordtijd(moment: Date, van: string, tot: string): Date {
  const k = nederlandseKlok(moment);
  const nu = k.u * 60 + k.min;
  const begin = minuten(van);
  const eind = minuten(tot);
  if (begin >= eind) return moment; // niet ingesteld zoals verwacht: dan altijd
  if (nu >= begin && nu < eind) return moment;
  const morgen = nu >= eind ? 1 : 0;
  const dag = new Date(Date.UTC(k.j, k.m - 1, k.d + morgen));
  return vanNederlandseKlok(dag.getUTCFullYear(), dag.getUTCMonth() + 1, dag.getUTCDate(), Math.floor(begin / 60), begin % 60);
}

export function binnenTijden(moment: Date, van: string, tot: string): boolean {
  return binnenAntwoordtijd(moment, van, tot).getTime() === moment.getTime();
}

/** Iemand antwoordde zelf: wat Paaltje voor dit nummer had ingepland, gaat niet meer. */
export async function annuleerGeplandeAntwoorden(db: Db, companyId: string, nummer: string, reden: string) {
  const { error } = await db
    .from("berichten")
    .update({ wa_antwoord_status: "geannuleerd", wa_antwoord_reden: reden })
    .eq("company_id", companyId)
    .eq("kanaal", "whatsapp")
    .eq("wa_telefoon", nummer)
    .eq("wa_antwoord_status", "gepland");
  if (error) console.error("geplande antwoorden annuleren:", error.message);
}

// ---------------------------------------------------------------------
// Sjablonen
// ---------------------------------------------------------------------

/** De plaatshouders die je in een sjabloon mag gebruiken. */
export const PLAATSHOUDERS = ["naam", "datum", "adres"] as const;
export type Plaatshouder = (typeof PLAATSHOUDERS)[number];

/** Een voorbeeld per plaatshouder: Meta wil bij het indienen zien wat erin komt. */
const VOORBEELD: Record<Plaatshouder, string> = {
  naam: "Jan de Vries",
  datum: "dinsdag 22 september",
  adres: "Dorpsstraat 12",
};

/**
 * Jouw tekst ("Hoi {naam}, we komen {datum}") omzetten naar de vorm van Meta
 * ("Hoi {{1}}, we komen {{2}}"), met de plaatshouders op volgorde. Geeft een
 * fout in gewone taal als iets niet mag.
 */
export function sjabloonVoorMeta(
  tekst: string,
): { ok: true; body: string; variabelen: Plaatshouder[] } | { ok: false; fout: string } {
  const schoon = tekst.replace(/\r\n/g, "\n").trim();
  if (!schoon) return { ok: false, fout: "De tekst is leeg." };
  if (schoon.length > 1024) return { ok: false, fout: "Hooguit 1024 tekens." };
  if (/\n{3,}/.test(schoon)) return { ok: false, fout: "Hooguit één lege regel achter elkaar." };
  const onbekend = [...schoon.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((n) => !PLAATSHOUDERS.includes(n as Plaatshouder));
  if (onbekend.length > 0) {
    return { ok: false, fout: `Onbekende plaatshouder {${onbekend[0]}}. Gebruik {naam}, {datum} of {adres}.` };
  }
  if (/\{\{|\}\}/.test(schoon)) return { ok: false, fout: "Gebruik enkele accolades: {naam}." };
  if (/^\{[a-z]+\}/.test(schoon) || /\{[a-z]+\}[.!?]?$/.test(schoon)) {
    return { ok: false, fout: "Meta staat niet toe dat de tekst begint of eindigt met een plaatshouder." };
  }
  if (/\}\s*\{/.test(schoon)) return { ok: false, fout: "Zet tekst tussen twee plaatshouders." };
  const variabelen: Plaatshouder[] = [];
  const body = schoon.replace(/\{(naam|datum|adres)\}/g, (_, n: Plaatshouder) => {
    variabelen.push(n);
    return `{{${variabelen.length}}}`;
  });
  return { ok: true, body, variabelen };
}

export function voorbeeldWaarden(variabelen: string[]): string[] {
  return variabelen.map((v) => VOORBEELD[v as Plaatshouder] ?? "voorbeeld");
}

/** De tekst zoals de klant hem krijgt. */
export function vulSjabloonIn(tekst: string, waarden: Partial<Record<Plaatshouder, string>>): string {
  return tekst.replace(/\{(naam|datum|adres)\}/g, (_, n: Plaatshouder) => waarden[n] ?? "");
}

/** Status bij Meta → wat wij bewaren. */
export const SJABLOON_STATUS: Record<string, string> = {
  APPROVED: "goedgekeurd",
  REJECTED: "afgewezen",
  PENDING: "ingediend",
  IN_APPEAL: "ingediend",
  PENDING_DELETION: "uitgeschakeld",
  DELETED: "uitgeschakeld",
  DISABLED: "uitgeschakeld",
  PAUSED: "gepauzeerd",
  REINSTATED: "goedgekeurd",
  LIMIT_EXCEEDED: "gepauzeerd",
};

/**
 * De status van de sjablonen van dit bedrijf bij Meta ophalen en bijwerken.
 * Kapso stuurt geen melding als Meta een sjabloon goed- of afkeurt, dus dit
 * gebeurt ook af en toe vanzelf (whatsapp-planner). Geeft het aantal
 * bijgewerkte sjablonen terug.
 */
export async function ververSjablonen(db: Db, companyId: string, toegang: Toegang, wabaId: string): Promise<Uitkomst<number>> {
  const uit = await graph<{ data?: { id?: string; name?: string; status?: string; category?: string; rejected_reason?: string }[] }>(
    `${wabaId}/message_templates?fields=id,name,status,category,rejected_reason&limit=200`,
    toegang,
  );
  if (!uit.ok) return uit;
  let bijgewerkt = 0;
  for (const t of uit.data.data ?? []) {
    if (!t.name) continue;
    const reden = String(t.rejected_reason ?? "");
    const { data, error } = await db
      .from("wa_sjablonen")
      .update({
        status: SJABLOON_STATUS[String(t.status ?? "").toUpperCase()] ?? "ingediend",
        categorie: String(t.category ?? "").toUpperCase() === "MARKETING" ? "marketing" : "utility",
        afwijsreden: reden && reden !== "NONE" ? reden.slice(0, 300) : "",
        ...(t.id ? { meta_id: t.id } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("meta_naam", t.name)
      .select("id");
    if (error) throw new Error(`Sjabloon bijwerken: ${error.message}`);
    bijgewerkt += (data ?? []).length;
  }
  return { ok: true, data: bijgewerkt };
}

/** Een goedgekeurd sjabloon versturen. Geeft het wamid terug. */
export async function verstuurSjabloon(
  toegang: Toegang,
  phoneNumberId: string,
  aan: string,
  metaNaam: string,
  parameters: string[],
): Promise<{ ok: true; waId: string } | { ok: false; status: number; fout: string }> {
  const uit = await graph<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, toegang, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: aan,
      type: "template",
      template: {
        name: metaNaam,
        language: { code: "nl" },
        ...(parameters.length > 0
          ? {
              components: [
                {
                  type: "body",
                  // WhatsApp weigert lege parameters en regeleinden erin.
                  parameters: parameters.map((p) => ({
                    type: "text",
                    text: (p.replace(/\s+/g, " ").trim() || "-").slice(0, 200),
                  })),
                },
              ],
            }
          : {}),
      },
    }),
  });
  if (!uit.ok) return uit;
  const waId = String(uit.data.messages?.[0]?.id ?? "");
  if (!waId) return { ok: false, status: 502, fout: "WhatsApp gaf geen bericht-id terug." };
  return { ok: true, waId };
}

const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAANDNAMEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "2026-09-22" → "dinsdag 22 september". */
export function datumVoluit(datum: string): string {
  const m = datum.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return datum;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAGEN[d.getUTCDay()]} ${+m[3]} ${MAANDNAMEN[+m[2] - 1]}`;
}

/** Een Nederlands mobiel nummer ("06…") als WhatsApp-nummer ("316…"); leeg als het geen 06-nummer is. */
export function mobielAlsWa(tekst: string): string {
  let d = String(tekst ?? "").replace(/\D/g, "");
  if (d.startsWith("0031")) d = `0${d.slice(4)}`;
  else if (d.startsWith("31") && d.length === 11) d = `0${d.slice(2)}`;
  return /^06\d{8}$/.test(d) ? `31${d.slice(1)}` : "";
}
