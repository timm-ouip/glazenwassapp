/**
 * Alles wat met Meta's WhatsApp Cloud API te maken heeft en door meerdere
 * functies gebruikt wordt: de handtekening van een webhook controleren, een
 * webhook omzetten in rijen voor `berichten`, en de Graph API aanroepen.
 *
 * Wat hier binnenkomt is van buiten: elk veld wordt nagekeken en ingekort
 * voordat het de database in gaat.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export const GRAPH = "https://graph.facebook.com/v23.0";

const MAX_TEKST = 20_000;

/** Klopt `X-Hub-Signature-256` bij deze body? Vergelijkt in vaste tijd. */
export async function handtekeningKlopt(body: string, kop: string | null, geheim: string): Promise<boolean> {
  if (!geheim || !kop?.startsWith("sha256=")) return false;
  const sleutel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(geheim),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const handtekening = new Uint8Array(await crypto.subtle.sign("HMAC", sleutel, new TextEncoder().encode(body)));
  const verwacht = [...handtekening].map((b) => b.toString(16).padStart(2, "0")).join("");
  const gekregen = kop.slice("sha256=".length).toLowerCase();
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

/** WhatsApp-status → wat wij bewaren. Een status gaat nooit terug. */
export const STATUS: Record<string, { waarde: string; rang: number }> = {
  sent: { waarde: "verstuurd", rang: 1 },
  delivered: { waarde: "afgeleverd", rang: 2 },
  read: { waarde: "gelezen", rang: 3 },
  failed: { waarde: "mislukt", rang: 4 },
};

export const STATUS_RANG: Record<string, number> = { "": 0, verstuurd: 1, afgeleverd: 2, gelezen: 3, mislukt: 4 };

/** Een Graph API-aanroep met het token van het bedrijf. */
export async function graph<T>(
  pad: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; fout: string }> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${pad}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, status: 0, fout: e instanceof Error ? e.message : String(e) };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fout = obj(obj(json).error);
    return { ok: false, status: res.status, fout: String(fout.error_user_msg ?? fout.message ?? res.statusText) };
  }
  return { ok: true, data: json as T };
}

/** Het (ontsleutelde) token van een koppeling, of null. */
export async function tokenVan(db: Db, koppelingId: string, ontsleutel: (v: string, iv: string) => Promise<string>) {
  const { data } = await db.from("whatsapp_geheimen").select("versleuteld,iv").eq("koppeling_id", koppelingId).maybeSingle();
  if (!data) return null;
  try {
    return await ontsleutel(data.versleuteld, data.iv);
  } catch {
    return null;
  }
}
