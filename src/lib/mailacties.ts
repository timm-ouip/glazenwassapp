/**
 * Iets doen met mail: gelezen markeren, weggooien, terugzetten, versturen.
 *
 * Alles loopt via de Edge Function `mail-acties`, want het moet op de
 * mailserver gebeuren — anders zie je op je telefoon iets anders dan hier.
 */
import { supabase } from "@/integrations/supabase/client";

/** De mail is misschien toch weg: niet zomaar opnieuw versturen. */
export class MogelijkVerstuurdFout extends Error {}

async function roep<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("mail-acties", { body });
  if (error) {
    const res = (error as { context?: Response })?.context;
    let uitleg: { fout?: string; mogelijk_verstuurd?: boolean } = {};
    if (res && typeof res.text === "function") {
      try {
        uitleg = JSON.parse(await res.text()) as typeof uitleg;
      } catch {
        // geen uitleg meegestuurd
      }
    } else if (body["actie"] === "versturen") {
      // Geen antwoord van de server: de verbinding viel weg. Het versturen kan
      // dan best gelukt zijn.
      throw new MogelijkVerstuurdFout(
        "De verbinding viel weg. De mail is misschien toch verstuurd: kijk in Verzonden voor je het opnieuw probeert.",
      );
    }
    if (uitleg.mogelijk_verstuurd) throw new MogelijkVerstuurdFout(uitleg.fout ?? "");
    // Een serverfout zonder eigen uitleg tijdens versturen (bijvoorbeeld een
    // functie die te lang duurde): de mail kan al weg zijn.
    if (body["actie"] === "versturen" && !uitleg.fout && res && res.status >= 500) {
      throw new MogelijkVerstuurdFout(
        "Er ging iets mis. De mail is misschien toch verstuurd: kijk in Verzonden voor je het opnieuw probeert.",
      );
    }
    throw new Error(uitleg.fout || error.message);
  }
  const uit = data as { fout?: string } & T;
  if (uit?.fout) throw new Error(uit.fout);
  return uit;
}

export function zetGelezen(berichtId: string, gelezen: boolean): Promise<{ ok: true }> {
  return roep({ actie: "gelezen", bericht_id: berichtId, gelezen });
}

/** `verplaatst` is onwaar als de server de nieuwe plek nog niet gaf. */
export function gooiWeg(berichtId: string): Promise<{ ok: true; verplaatst: boolean }> {
  return roep({ actie: "weggooien", bericht_id: berichtId });
}

export function zetTerug(berichtId: string): Promise<{ ok: true; verplaatst: boolean }> {
  return roep({ actie: "terugzetten", bericht_id: berichtId });
}

/** Klaar met deze mail, of toch weer open. */
export function handelAf(berichtId: string, klaar: boolean): Promise<{ ok: true }> {
  return roep({ actie: "afhandelen", bericht_id: berichtId, klaar });
}

/** Paaltje leest de mail bij de volgende ronde opnieuw. */
export function laatOpnieuwLezen(berichtId: string): Promise<{ ok: true }> {
  return roep({ actie: "opnieuw-lezen", bericht_id: berichtId });
}

/** Het afzenderadres hoort bij deze klant: koppelen, op de mail zetten, opnieuw laten lezen. */
export function koppelKlant(berichtId: string, klantId: string): Promise<{ ok: true }> {
  return roep({ actie: "klant-koppelen", bericht_id: berichtId, klant_id: klantId });
}

/** Het overslaan-voorstel van Paaltje doorvoeren. */
export function overslaanDoorvoeren(berichtId: string): Promise<{ ok: true; aangepast: number }> {
  return roep({ actie: "overslaan-doorvoeren", bericht_id: berichtId });
}

export interface NieuweMail {
  aan: { email: string; naam?: string }[];
  cc?: { email: string; naam?: string }[];
  onderwerp: string;
  tekst: string;
  /** Het bericht waarop je antwoordt, zodat het in dezelfde draad valt. */
  antwoordOp?: string;
}

/** Zo lang mag een mail zijn; de server weigert langer. */
export const MAX_MAILTEKST = 50_000;

export function verstuurMail(m: NieuweMail): Promise<{ ok: true; kopieFout: string }> {
  return roep({
    actie: "versturen",
    aan: m.aan,
    cc: m.cc ?? [],
    onderwerp: m.onderwerp,
    tekst: m.tekst,
    ...(m.antwoordOp ? { antwoord_op: m.antwoordOp } : {}),
  });
}

/**
 * "jan@x.nl, Piet <piet@y.nl>; kees@z.nl" → losse adressen. Een komma binnen
 * aanhalingstekens of vóór een <adres> hoort bij de naam ("Jansen, Piet"
 * <piet@x.nl>), niet tussen twee adressen.
 */
export function leesAdressen(tekst: string): { email: string; naam?: string }[] {
  const stukken: string[] = [];
  let huidig = "";
  let inAanhalingstekens = false;
  let inHaken = false;
  for (const teken of tekst) {
    if (teken === '"') inAanhalingstekens = !inAanhalingstekens;
    if (teken === "<") inHaken = true;
    if (teken === ">") inHaken = false;
    const scheiding = (teken === "," || teken === ";" || teken === "\n") && !inAanhalingstekens && !inHaken;
    if (scheiding) {
      stukken.push(huidig);
      huidig = "";
    } else {
      huidig += teken;
    }
  }
  stukken.push(huidig);

  // Een stuk dat eruitziet als een naam ("Jansen"), gevolgd door een stuk met
  // <adres>, is een afgeknipte naam: weer aan elkaar. Alleen letters en
  // spaties; een tikfout als "jan.x.nl" blijft los, zodat hij als ongeldig
  // adres gemeld wordt in plaats van stil te verdwijnen.
  const samen: string[] = [];
  for (const stuk of stukken.map((s) => s.trim()).filter(Boolean)) {
    const vorige = samen[samen.length - 1];
    if (vorige !== undefined && /^[\p{L}' -]+$/u.test(vorige) && /<[^<>]+>$/.test(stuk)) {
      samen[samen.length - 1] = `${vorige}, ${stuk}`;
    } else {
      samen.push(stuk);
    }
  }

  return samen.map((stuk) => {
    const m = stuk.match(/^(.*)<([^<>]+)>$/);
    if (m) return { naam: (m[1] ?? "").trim().replace(/^"|"$/g, ""), email: (m[2] ?? "").trim() };
    return { email: stuk };
  });
}

export function geldigAdres(email: string): boolean {
  return /^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(email);
}
