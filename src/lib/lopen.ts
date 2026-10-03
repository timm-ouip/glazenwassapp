/**
 * Klanten lopen: langs de deur in een gebied, per adres noteren wat er gezegd
 * is, en bij "Ja" meteen een klant met prijs maken.
 *
 * De adressen komen uit de BAG (src/lib/bag.ts) en staan daarna in de
 * database (loop_adressen). De looplijst, de tellers en het klant maken lopen
 * via de functies uit supabase/migrations/20261023090000_klanten_lopen.sql;
 * een loper ziet daardoor van een klant alleen "klant" of "inactief".
 *
 * Plan: .omc/plans/klanten-lopen.md, §8 en §9.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  haalStraatAdressen,
  haalVeelhoekAdressen,
  ontdubbel,
  vulPandgegevens,
  type BagAdres,
} from "@/lib/bag";
import { kantVan, type Kant } from "@/lib/klanten";
import { nummerSleutel } from "@/lib/postcode";
import { alsWoningtype, woningtypeLabel, type Woningtype } from "@/lib/woningtype";

export type Uitkomst = "niet_thuis" | "interesse" | "ja" | "nee";

export const UITKOMSTEN: { waarde: Uitkomst; label: string }[] = [
  { waarde: "niet_thuis", label: "Niet thuis" },
  { waarde: "interesse", label: "Interesse" },
  { waarde: "ja", label: "Ja" },
  { waarde: "nee", label: "Nee" },
];

export function uitkomstLabel(u: Uitkomst): string {
  return UITKOMSTEN.find((x) => x.waarde === u)?.label ?? u;
}

/** Eén gebied met zijn tellers (loop_tellingen). */
export interface LoopGebied {
  gebied_id: string;
  naam: string;
  district_id: string | null;
  /** De naam van de wijk; leeg bij een los gebied. */
  wijk: string | null;
  plaats: string;
  straten: string[];
  /** Op de kaart omcirkeld: de ring in [lon, lat] (open, zonder herhaald eerste punt). */
  veelhoek: [number, number][] | null;
  opgehaald_op: string | null;
  created_at: string;
  totaal: number;
  klanten: number;
  te_lopen: number;
  niet_thuis: number;
  interesse: number;
  ja: number;
  nee: number;
  onvolledig: boolean;
}

/** Eén adres op de looplijst (loop_lijst). */
export interface LoopAdres {
  id: string;
  vbo_id: string;
  street_id: string | null;
  straat: string;
  woonplaats: string;
  huisnummer: number;
  toevoeging: string;
  postcode: string;
  oppervlakte: number | null;
  gebruiksdoel: string;
  woningtype: string | null;
  woningtype_zelf: string | null;
  bouwlagen: number | null;
  /** De loopprijs; altijd leeg bij een klantadres. */
  prijs: number | null;
  uitkomst: Uitkomst | null;
  uitkomst_op: string | null;
  uitkomst_door_naam: string | null;
  notitie: string;
  klant_status: "actief" | "inactief" | null;
  klant_adres_id: string | null;
  klant_hoek_kant: Kant | "";
  straat_volgorde: number;
  sort_desc: boolean;
  doorlopend: boolean;
}

export const LOOP_TELLINGEN = ["loop-tellingen"] as const;
export const loopLijstSleutel = (gebied: string) => ["loop-lijst", gebied] as const;
export const LOOP_VOORSTELLEN = ["loop-voorstellen"] as const;
export const loopVoorstellenSleutel = (gebied: string) => ["loop-voorstellen", gebied] as const;

/** Een prijsvoorstel voor één adres (loop_voorstellen). */
export interface LoopVoorstel {
  voorstel: number;
  /** Op hoeveel prijzen het voorstel rust. */
  n: number;
  niveau: "straat" | "buurt" | "wijk";
}

// ---------------------------------------------------------------------------
// Ophalen
// ---------------------------------------------------------------------------

export async function fetchLoopTellingen(): Promise<LoopGebied[]> {
  // loop_tellingen geeft de veelhoek niet mee; die halen we er los bij.
  const [{ data, error }, kaart] = await Promise.all([
    supabase.rpc("loop_tellingen"),
    supabase
      .from("loopgebieden")
      .select("id, veelhoek")
      .is("deleted_at", null)
      .not("veelhoek", "is", null),
  ]);
  if (error) throw error;
  if (kaart.error) throw kaart.error;
  const veelhoeken = new Map((kaart.data ?? []).map((r) => [r.id, ringUitVeelhoek(r.veelhoek)]));
  return (data ?? []).map((g) => ({
    gebied_id: g.gebied_id,
    naam: g.naam,
    district_id: g.district_id ?? null,
    wijk: g.wijk ?? null,
    plaats: g.plaats ?? "",
    straten: g.straten ?? [],
    veelhoek: veelhoeken.get(g.gebied_id) ?? null,
    opgehaald_op: g.opgehaald_op ?? null,
    created_at: g.created_at,
    totaal: g.totaal ?? 0,
    klanten: g.klanten ?? 0,
    te_lopen: g.te_lopen ?? 0,
    niet_thuis: g.niet_thuis ?? 0,
    interesse: g.interesse ?? 0,
    ja: g.ja ?? 0,
    nee: g.nee ?? 0,
    onvolledig: !!g.onvolledig,
  }));
}

/** Per adres-id het voorstel; adressen zonder voorstel staan er niet in. */
export async function fetchLoopVoorstellen(gebied: string): Promise<Record<string, LoopVoorstel>> {
  const { data, error } = await supabase.rpc("loop_voorstellen", { gebied });
  if (error) throw error;
  const uit: Record<string, LoopVoorstel> = {};
  for (const r of data ?? []) {
    if (r.niveau !== "straat" && r.niveau !== "buurt" && r.niveau !== "wijk") continue;
    uit[r.adres_id] = { voorstel: Number(r.voorstel), n: r.n, niveau: r.niveau };
  }
  return uit;
}

/** De prijsvoorstellen van een gebied. Ververst met de lijst mee (zie useLoopLive). */
export function useLoopVoorstellen(gebied: string, enabled: boolean) {
  return useQuery({
    queryKey: loopVoorstellenSleutel(gebied),
    queryFn: () => fetchLoopVoorstellen(gebied),
    enabled,
  });
}

const UITKOMST_SET = new Set<string>(UITKOMSTEN.map((u) => u.waarde));

export async function fetchLoopLijst(gebied: string): Promise<LoopAdres[]> {
  const { data, error } = await supabase.rpc("loop_lijst", { gebied });
  if (error) throw error;
  // types.ts noemt alles verplicht, maar veel kolommen kunnen leeg zijn.
  return (data ?? []).map((r) => ({
    id: r.id,
    vbo_id: r.vbo_id,
    street_id: r.street_id ?? null,
    straat: r.straat ?? "",
    woonplaats: r.woonplaats ?? "",
    huisnummer: r.huisnummer,
    toevoeging: r.toevoeging ?? "",
    postcode: r.postcode ?? "",
    oppervlakte: r.oppervlakte ?? null,
    gebruiksdoel: r.gebruiksdoel ?? "",
    woningtype: r.woningtype ?? null,
    woningtype_zelf: r.woningtype_zelf ?? null,
    bouwlagen: r.bouwlagen ?? null,
    prijs: r.prijs === null || r.prijs === undefined ? null : Number(r.prijs),
    uitkomst: r.uitkomst && UITKOMST_SET.has(r.uitkomst) ? (r.uitkomst as Uitkomst) : null,
    uitkomst_op: r.uitkomst_op ?? null,
    uitkomst_door_naam: r.uitkomst_door_naam ?? null,
    notitie: r.notitie ?? "",
    klant_status:
      r.klant_status === "actief" || r.klant_status === "inactief" ? r.klant_status : null,
    klant_adres_id: r.klant_adres_id ?? null,
    klant_hoek_kant:
      r.klant_hoek_kant === "even" || r.klant_hoek_kant === "oneven" ? r.klant_hoek_kant : "",
    straat_volgorde: r.straat_volgorde ?? 0,
    sort_desc: !!r.sort_desc,
    doorlopend: !!r.doorlopend,
  }));
}

// ---------------------------------------------------------------------------
// Bewaren
// ---------------------------------------------------------------------------

export type LoopPatch = Partial<
  Pick<LoopAdres, "uitkomst" | "prijs" | "notitie" | "woningtype_zelf">
>;

/** Uitkomst, prijs, notitie of het verbeterde woningtype van één adres
 *  bewaren. Wie en wanneer zet de database zelf. */
export async function zetLoopAdres(id: string, patch: LoopPatch): Promise<void> {
  // Per adres één tegelijk, in de volgorde van tikken: anders kan een
  // eerdere tik die later aankomt de laatste keuze overschrijven.
  const vorige = wachtrij.get(id) ?? Promise.resolve();
  const deze = vorige
    .catch(() => undefined)
    .then(async () => {
      const { data, error } = await supabase
        .from("loop_adressen")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Niet bewaard: dit adres is er niet (meer).");
    });
  wachtrij.set(id, deze);
  onderweg++;
  try {
    await deze;
  } finally {
    onderweg--;
    if (wachtrij.get(id) === deze) wachtrij.delete(id);
  }
}

/** De opslag die per adres nog loopt (zie zetLoopAdres). */
const wachtrij = new Map<string, Promise<void>>();
/** Hoeveel eigen opslagen er nog onderweg zijn; zolang dat er zijn wacht de
 *  live verversing, anders springt een net getikte rij even terug. */
let onderweg = 0;

export async function maakGebied(gebied: {
  naam: string;
  district_id: string | null;
  plaats: string;
  straten: string[];
  /** Op de kaart omcirkeld: de ring in [lon, lat]. */
  veelhoek?: [number, number][] | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("loopgebieden")
    .insert({
      naam: gebied.naam.trim(),
      district_id: gebied.district_id,
      plaats: gebied.plaats.trim(),
      straten: gebied.straten,
      ...(gebied.veelhoek ? { veelhoek: veelhoekAlsGeoJson(gebied.veelhoek) as Json } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function wijzigGebied(
  id: string,
  velden: { naam?: string; straten?: string[] },
): Promise<void> {
  const { error } = await supabase.from("loopgebieden").update(velden).eq("id", id);
  if (error) throw error;
}

/** Weggooien is wegleggen: met `terug` staat het gebied er weer. */
export async function gooiGebiedWeg(id: string, terug = false): Promise<void> {
  const { error } = await supabase
    .from("loopgebieden")
    .update({ deleted_at: terug ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Wat er per adres naar loop_gebied_vullen gaat. */
export interface LoopInvoer {
  vbo_id: string;
  straat: string;
  woonplaats: string;
  huisnummer: number;
  toevoeging: string;
  postcode: string;
  street_id: string | null;
  pand_id: string | null;
  oppervlakte: number | null;
  gebruiksdoel: string;
  /** Het geschatte type; null wist niets (de database houdt dan het oude). */
  woningtype: string | null;
  bouwlagen: number | null;
}

/** Een straat om op te halen: de officiële naam, en de wijkstraat erbij (of leeg). */
export interface OphaalStraat {
  naam: string;
  street_id: string | null;
}

/** De Locatieserver kent Den Haag alleen als "'s-Gravenhage". */
export function bagPlaats(plaats: string): string {
  const p = plaats.trim();
  return /^den\s+haag$/i.test(p) ? "'s-Gravenhage" : p;
}

/** Zoveel adressen per aanroep; de database neemt er hooguit 5000. */
const PER_STUK = 3000;

/**
 * Alle adressen van een rij straten uit de BAG, één straat tegelijk, en
 * daarna voor het hele gebied in één keer de panden (woningtype) en de 3D
 * BAG (bouwlagen).
 *
 * Een straat die de Locatieserver niet kent, komt in `nietGevonden` (meestal
 * een afgekorte werknaam); met `stopBijNietGevonden` slaat hij dan de panden
 * over, want er wordt toch nog niets bewaard. Mislukt het ophalen van de
 * adressen zelf, dan komt er een fout met de naam van de straat; er is dan
 * nog niets bewaard. Mislukken alleen de panden of de 3D BAG, dan gaan de
 * adressen door zonder woningtype of bouwlagen. `onthoud` bewaart de
 * adressen die al binnen zijn, zodat een tweede poging alleen de rest ophaalt.
 */
export async function haalGebiedAdressen(
  straten: OphaalStraat[],
  plaats: string,
  opties: {
    onVoortgang?: (tekst: string) => void;
    signal?: AbortSignal;
    onthoud?: Map<string, BagAdres[]>;
    stopBijNietGevonden?: boolean;
  } = {},
): Promise<{ rijen: LoopInvoer[]; nietGevonden: string[] }> {
  const woonplaats = bagPlaats(plaats);
  const gevonden: { adres: BagAdres; street_id: string | null }[] = [];
  const nietGevonden: string[] = [];
  let nr = 0;
  for (const s of straten) {
    nr++;
    const sleutel = `${s.naam.trim().toLowerCase()}|${woonplaats.toLowerCase()}`;
    let adressen = opties.onthoud?.get(sleutel);
    if (!adressen) {
      const voortgang = (tekst: string) =>
        opties.onVoortgang?.(`Straat ${nr} van ${straten.length} · ${tekst}`);
      const binnen = await haalStraatAdressen(s.naam, woonplaats, {
        onVoortgang: voortgang,
        ...(opties.signal ? { signal: opties.signal } : {}),
      });
      if (binnen === null) {
        throw new Error(
          opties.signal?.aborted
            ? "Ophalen afgebroken."
            : `Ophalen mislukt bij ${s.naam}. Het adressenregister reageert niet; probeer het zo opnieuw.`,
        );
      }
      adressen = binnen;
      opties.onthoud?.set(sleutel, binnen);
    }
    if (adressen.length === 0) nietGevonden.push(s.naam);
    for (const adres of adressen) gevonden.push({ adres, street_id: s.street_id });
  }

  // Twee straten kunnen hetzelfde adres opleveren (een hoekpand); één keer,
  // met de wijkstraat erbij als een van de twee die heeft.
  const straatVan = new Map<string, string | null>();
  for (const { adres, street_id } of gevonden) {
    if (!straatVan.get(adres.vbo_id)) straatVan.set(adres.vbo_id, street_id);
  }
  let uniek = ontdubbel(gevonden.map((g) => g.adres));

  if (uniek.length > 0 && !(opties.stopBijNietGevonden && nietGevonden.length > 0)) {
    uniek = await vulPandgegevens(uniek, {
      ...(opties.onVoortgang ? { onVoortgang: opties.onVoortgang } : {}),
      ...(opties.signal ? { signal: opties.signal } : {}),
    });
    if (opties.signal?.aborted) throw new Error("Ophalen afgebroken.");
  }

  const rijen = uniek.map((a): LoopInvoer => ({
    vbo_id: a.vbo_id,
    straat: a.straat,
    woonplaats: a.woonplaats,
    huisnummer: a.huisnummer,
    toevoeging: a.toevoeging,
    postcode: a.postcode,
    street_id: straatVan.get(a.vbo_id) ?? null,
    pand_id: a.pand_id,
    oppervlakte: a.oppervlakte,
    gebruiksdoel: a.gebruiksdoel,
    woningtype: a.woningtype,
    bouwlagen: a.bouwlagen,
  }));
  return { rijen, nietGevonden };
}

/**
 * Schrijft de adressen naar het gebied, in stukken. Het eerste stuk zet het
 * gebied op onvolledig, het laatste (met `afmaken`) op opgehaald. Gaat er
 * tussendoor iets mis, dan blijft het gebied "Onvolledig" staan; opnieuw
 * ophalen maakt niets dubbel.
 */
export async function schrijfGebied(
  gebied: string,
  rijen: LoopInvoer[],
  opties: { afmaken?: boolean; onVoortgang?: (tekst: string) => void } = {},
): Promise<number> {
  const afmaken = opties.afmaken ?? true;
  const stukken: LoopInvoer[][] = [];
  for (let i = 0; i < rijen.length; i += PER_STUK) stukken.push(rijen.slice(i, i + PER_STUK));
  if (stukken.length === 0) stukken.push([]);
  let aantal = 0;
  for (let i = 0; i < stukken.length; i++) {
    if (stukken.length > 1) opties.onVoortgang?.(`Bewaren: stuk ${i + 1} van ${stukken.length}`);
    else opties.onVoortgang?.("Bewaren…");
    const { data, error } = await supabase.rpc("loop_gebied_vullen", {
      gebied,
      adressen: stukken[i] as unknown as Json,
      eerste: i === 0,
      laatste: afmaken && i === stukken.length - 1,
    });
    if (error) throw error;
    aantal = data ?? aantal;
  }
  return aantal;
}

/** Haalt de adressen van één straat uit het gebied; de adressen zelf blijven. */
export async function haalStraatUitGebied(gebied: string, straat: string): Promise<void> {
  const { error } = await supabase.rpc("loop_gebied_vullen", {
    gebied,
    adressen: [] as unknown as Json,
    eerste: false,
    laatste: false,
    straat_weg: straat,
  });
  if (error) throw error;
}

/**
 * Ophalen en bewaren in één keer, voor "Opnieuw ophalen". Er komen alleen
 * koppelingen bij; wat je al noteerde blijft staan.
 */
export async function vulGebied(
  gebied: string,
  straten: OphaalStraat[],
  plaats: string,
  opties: { onVoortgang?: (tekst: string) => void; signal?: AbortSignal; afmaken?: boolean } = {},
): Promise<{ aantal: number; nietGevonden: string[] }> {
  const { rijen, nietGevonden } = await haalGebiedAdressen(straten, plaats, {
    ...(opties.onVoortgang ? { onVoortgang: opties.onVoortgang } : {}),
    ...(opties.signal ? { signal: opties.signal } : {}),
  });
  const aantal = await schrijfGebied(gebied, rijen, {
    ...(opties.afmaken !== undefined ? { afmaken: opties.afmaken } : {}),
    ...(opties.onVoortgang ? { onVoortgang: opties.onVoortgang } : {}),
  });
  return { aantal, nietGevonden };
}

/** Een ring als GeoJSON-Polygon (WGS84), met het eerste punt aan het eind herhaald. */
export function veelhoekAlsGeoJson(ring: [number, number][]): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const eerste = ring[0];
  const laatste = ring[ring.length - 1];
  const gesloten =
    eerste && laatste && (eerste[0] !== laatste[0] || eerste[1] !== laatste[1])
      ? [...ring, eerste]
      : ring;
  return { type: "Polygon", coordinates: [gesloten.map(([lon, lat]) => [lon, lat])] };
}

/** Een bewaarde GeoJSON-Polygon terug naar een open ring; `null` als het geen bruikbare is. */
export function ringUitVeelhoek(json: unknown): [number, number][] | null {
  if (!json || typeof json !== "object") return null;
  const v = json as { type?: unknown; coordinates?: unknown };
  if (v.type !== "Polygon" || !Array.isArray(v.coordinates) || !Array.isArray(v.coordinates[0])) {
    return null;
  }
  const ring = (v.coordinates[0] as unknown[])
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map(([lon, lat]): [number, number] => [lon, lat]);
  const eerste = ring[0];
  const laatste = ring[ring.length - 1];
  if (ring.length > 1 && eerste![0] === laatste![0] && eerste![1] === laatste![1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

/**
 * Alle adressen binnen een op de kaart omcirkelde veelhoek, als rijen voor
 * loop_gebied_vullen, en de straatnamen die erin liggen (op alfabet). Bij een
 * wijk krijgt een adres de wijkstraat met dezelfde naam erbij. Mislukt het
 * ophalen, of is het gebied te groot, dan een fout; er is dan niets bewaard.
 */
export async function haalVeelhoekGebied(
  ring: [number, number][],
  wijkStraten: { id: string; name: string; volledige_naam: string }[],
  opties: { onVoortgang?: (tekst: string) => void; signal?: AbortSignal } = {},
): Promise<{ rijen: LoopInvoer[]; straten: string[] }> {
  const adressen = await haalVeelhoekAdressen(ring, opties);
  if (adressen === null) {
    throw new Error(
      opties.signal?.aborted
        ? "Ophalen afgebroken."
        : "Ophalen mislukt. Het adressenregister reageert niet; probeer het zo opnieuw.",
    );
  }
  const straatId = new Map<string, string | null>();
  for (const a of adressen) {
    if (!straatId.has(a.straat))
      straatId.set(a.straat, wijkstraatVoor(a.straat, wijkStraten)?.id ?? null);
  }
  const rijen = adressen.map((a): LoopInvoer => ({
    vbo_id: a.vbo_id,
    straat: a.straat,
    woonplaats: a.woonplaats,
    huisnummer: a.huisnummer,
    toevoeging: a.toevoeging,
    postcode: a.postcode,
    street_id: straatId.get(a.straat) ?? null,
    pand_id: a.pand_id,
    oppervlakte: a.oppervlakte,
    gebruiksdoel: a.gebruiksdoel,
    woningtype: a.woningtype,
    bouwlagen: a.bouwlagen,
  }));
  const straten = [...straatId.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, "nl"));
  return { rijen, straten };
}

/** De officiële naam van een wijkstraat, met de werknaam als terugval. */
export function officieleNaam(s: { name: string; volledige_naam: string }): string {
  return s.volledige_naam.trim() || s.name.trim();
}

/** Bij een naam uit `loopgebieden.straten` de wijkstraat zoeken. */
export function wijkstraatVoor<T extends { id: string; name: string; volledige_naam: string }>(
  naam: string,
  straten: T[],
): T | null {
  const n = naam.trim().toLowerCase();
  return (
    straten.find((s) => s.volledige_naam.trim().toLowerCase() === n) ??
    straten.find((s) => s.name.trim().toLowerCase() === n) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Ja → klant
// ---------------------------------------------------------------------------

export async function maakKlantVanAdres(invoer: {
  adres: string;
  wijk: string;
  straat: string | null;
  prijs: number;
  interval_maanden: number;
  ritme: number;
  start_maand: string;
  naam: string;
  telefoon: string;
}): Promise<{ customer_id: string; bestond: boolean }> {
  const { data, error } = await supabase.rpc("loop_maak_klant", invoer);
  if (error) throw error;
  const rij = data?.[0];
  if (!rij) throw new Error("Er kwam geen klant terug.");
  return { customer_id: rij.customer_id, bestond: !!rij.bestond };
}

// ---------------------------------------------------------------------------
// Volgorde
// ---------------------------------------------------------------------------

/** Eén straat van de looplijst: eerst `heen`, dan `terug`. */
export interface LoopStraat {
  straat_volgorde: number;
  straat: string;
  woonplaats: string;
  street_id: string | null;
  doorlopend: boolean;
  heen: LoopAdres[];
  terug: LoopAdres[];
}

type VolgordeRij = Pick<
  LoopAdres,
  | "straat"
  | "woonplaats"
  | "street_id"
  | "huisnummer"
  | "toevoeging"
  | "klant_hoek_kant"
  | "straat_volgorde"
  | "sort_desc"
  | "doorlopend"
>;

/** De kant van een adres: het huisnummer, of bij een klant zijn hoek_kant
 *  (dezelfde regel als de Wijken-pagina, `kantVan` in klanten.ts). */
function loopKant(r: Pick<LoopAdres, "huisnummer" | "klant_hoek_kant">): Kant {
  return kantVan({ house_number: r.huisnummer, hoek_kant: r.klant_hoek_kant ?? "" });
}

/**
 * De looplijst per straat, in de volgorde van de wijk (`straat_volgorde`).
 *
 * Binnen een straat: eerst de oneven kant in de richting van de straat
 * (heen; `sort_desc` draait die om), dan de even kant in de andere richting
 * (terug). Een doorlopende straat is één lijst, zonder kanten. Een klant met
 * een `hoek_kant` staat aan die kant, zoals op de Wijken-pagina.
 */
export function looplijstVolgorde<T extends VolgordeRij>(
  rijen: T[],
): (Omit<LoopStraat, "heen" | "terug"> & { heen: T[]; terug: T[] })[] {
  const perStraat = new Map<number, T[]>();
  for (const r of rijen) {
    const lijst = perStraat.get(r.straat_volgorde);
    if (lijst) lijst.push(r);
    else perStraat.set(r.straat_volgorde, [r]);
  }

  return [...perStraat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([volgorde, lijst]) => {
      const eerste = lijst[0]!;
      const oplopend = [...lijst].sort(
        (a, b) => a.huisnummer - b.huisnummer || a.toevoeging.localeCompare(b.toevoeging),
      );
      const richting = eerste.sort_desc ? [...oplopend].reverse() : oplopend;
      const basis = {
        straat_volgorde: volgorde,
        straat: eerste.straat,
        woonplaats: eerste.woonplaats,
        street_id: eerste.street_id,
        doorlopend: eerste.doorlopend,
      };
      if (eerste.doorlopend) return { ...basis, heen: richting, terug: [] as T[] };
      return {
        ...basis,
        heen: richting.filter((r) => loopKant(r) === "oneven"),
        terug: richting.filter((r) => loopKant(r) === "even").reverse(),
      };
    });
}

/**
 * De sleutel waarop een BAG-adres een klantadres herkent: postcode zonder
 * spatie in hoofdletters, en het nummer zoals `nummerSleutel` ("12a"). Gelijk
 * aan de 'pc'-sleutel in loop_adres_klanten (de migratie).
 */
export function klantMatchSleutel(a: {
  postcode: string;
  huisnummer: number | string;
  toevoeging: string;
}): string {
  return `${a.postcode.replace(/\s/g, "").toUpperCase()}|${nummerSleutel(a.huisnummer, a.toevoeging)}`;
}

/** Staat er bij dit adres nog niets: geen klant en nog geen uitkomst. */
export function nogTeLopen(r: Pick<LoopAdres, "klant_status" | "uitkomst">): boolean {
  return r.klant_status === null && r.uitkomst === null;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

/** Wat een loper zelf wijzigt; de rest van de rij komt alleen uit loop_lijst. */
type LoopWijziging = Pick<
  LoopAdres,
  "uitkomst" | "uitkomst_op" | "prijs" | "notitie" | "woningtype" | "woningtype_zelf" | "bouwlagen"
> & { id: string; customer_id: string | null };

/** Zoveel meldingen kort na elkaar zetten we nog rij voor rij neer; daarboven
 *  (opnieuw ophalen door een collega) één keer de hele lijst. */
const MAX_LOSSE_MELDINGEN = 25;

/**
 * Zet één gewijzigde rij meteen in elke geopende looplijst. Lukt dat niet
 * (de rij is nieuw, of hij werd net klant), dan is `bijgezet` false en wordt
 * de lijst opnieuw opgehaald. `raaktVoorstel`: de prijs of het type is
 * anders dan in de lijst, dus de voorstellen moeten opnieuw.
 */
function zetRijBij(
  qc: ReturnType<typeof useQueryClient>,
  w: LoopWijziging,
): { bijgezet: boolean; raaktVoorstel: boolean } {
  let bijgezet = false;
  let raaktVoorstel = false;
  const prijs = w.prijs === null || w.prijs === undefined ? null : Number(w.prijs);
  for (const [sleutel, rijen] of qc.getQueriesData<LoopAdres[]>({ queryKey: ["loop-lijst"] })) {
    const oud = rijen?.find((r) => r.id === w.id);
    if (!oud) continue;
    if (w.customer_id !== null || oud.klant_status !== null) {
      return { bijgezet: false, raaktVoorstel: true };
    }
    bijgezet = true;
    raaktVoorstel ||=
      oud.prijs !== prijs ||
      oud.woningtype !== (w.woningtype ?? null) ||
      oud.woningtype_zelf !== (w.woningtype_zelf ?? null);
    qc.setQueryData<LoopAdres[]>(sleutel, (lijst) =>
      lijst?.map((r) =>
        r.id === w.id
          ? {
              ...r,
              uitkomst: w.uitkomst,
              uitkomst_op: w.uitkomst_op,
              uitkomst_door_naam: w.uitkomst === r.uitkomst ? r.uitkomst_door_naam : null,
              prijs,
              notitie: w.notitie ?? "",
              woningtype: w.woningtype ?? null,
              woningtype_zelf: w.woningtype_zelf ?? null,
              bouwlagen: w.bouwlagen ?? null,
            }
          : r,
      ),
    );
  }
  return { bijgezet, raaktVoorstel };
}

/**
 * Live meekijken: tikt een collega iets in, dan komt alleen die ene rij bij
 * (de melding bevat de hele rij). Bij nieuwe adressen, een nieuwe klant of
 * een stortvloed aan meldingen (een collega haalt het gebied opnieuw op)
 * haalt de lijst zich één keer opnieuw op. De tellers volgen met een kleine
 * vertraging, zodat vijf tikken vlak na elkaar één keer ophalen worden (zoals
 * useGeldloopLive); de prijsvoorstellen alleen als er een prijs of type
 * veranderde.
 */
export function useLoopLive(companyId: string | undefined) {
  const qc = useQueryClient();
  const wacht = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heleLijst = useRef(false);
  const voorstellen = useRef(false);
  const aantal = useRef(0);
  useEffect(() => {
    if (!companyId) return;
    const kanaal = supabase
      .channel(`lopen:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loop_adressen",
          filter: `company_id=eq.${companyId}`,
        },
        (melding) => {
          aantal.current++;
          const nieuw = melding.new as Partial<LoopWijziging> | undefined;
          const uit =
            melding.eventType === "UPDATE" &&
            onderweg === 0 &&
            !heleLijst.current &&
            aantal.current <= MAX_LOSSE_MELDINGEN &&
            !!nieuw?.id
              ? zetRijBij(qc, nieuw as LoopWijziging)
              : { bijgezet: false, raaktVoorstel: true };
          if (!uit.bijgezet) heleLijst.current = true;
          if (uit.raaktVoorstel) voorstellen.current = true;
          if (wacht.current) clearTimeout(wacht.current);
          const ververs = () => {
            // Nog een eigen tik onderweg: straks, anders wist de oude stand
            // uit de database even wat je net tikte.
            if (onderweg > 0) {
              wacht.current = setTimeout(ververs, 500);
              return;
            }
            aantal.current = 0;
            if (heleLijst.current) {
              heleLijst.current = false;
              void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
            }
            if (voorstellen.current) {
              voorstellen.current = false;
              void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
            }
            void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
          };
          wacht.current = setTimeout(ververs, 500);
        },
      )
      .subscribe();
    return () => {
      if (wacht.current) clearTimeout(wacht.current);
      void supabase.removeChannel(kanaal);
    };
  }, [companyId, qc]);
}

// ---------------------------------------------------------------------------
// Tekst
// ---------------------------------------------------------------------------

/** "2 okt" */
export function korteDatum(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** "12", "12 A" */
export function loopNummer(r: Pick<LoopAdres, "huisnummer" | "toevoeging">): string {
  return r.toevoeging ? `${r.huisnummer} ${r.toevoeging}` : String(r.huisnummer);
}

const BEDRIJF_LABELS: Record<string, string> = {
  winkelfunctie: "winkel",
  kantoorfunctie: "kantoor",
  bijeenkomstfunctie: "bijeenkomst",
  gezondheidszorgfunctie: "zorg",
  onderwijsfunctie: "school",
  logiesfunctie: "logies",
  sportfunctie: "sport",
  industriefunctie: "industrie",
};

/** Het type dat telt: de eigen correctie, anders de schatting. */
export function woningtypeVan(
  r: Pick<LoopAdres, "woningtype" | "woningtype_zelf">,
): Woningtype | null {
  return alsWoningtype(r.woningtype_zelf) ?? alsWoningtype(r.woningtype);
}

/** Een bedrijf (geen woonfunctie) krijgt nooit een woningtype. */
export function isBedrijf(r: Pick<LoopAdres, "gebruiksdoel">): boolean {
  return !!r.gebruiksdoel && r.gebruiksdoel !== "woonfunctie";
}

/** "tussenwoning (geschat)", "hoekwoning" (zelf gekozen), of leeg. */
export function woningtypeTekst(r: Pick<LoopAdres, "woningtype" | "woningtype_zelf">): string {
  const zelf = alsWoningtype(r.woningtype_zelf);
  if (zelf) return woningtypeLabel(zelf);
  const schatting = alsWoningtype(r.woningtype);
  return schatting ? `${woningtypeLabel(schatting)} (geschat)` : "";
}

/**
 * De kleine regel onder het huisnummer: "tussenwoning (geschat) · 96 m² ·
 * 3 lagen", of "bedrijf · winkel · 80 m²". Met `zonderType` zonder het type
 * vooraan (de rij zet dat er zelf als knop voor).
 */
export function adresOmschrijving(
  r: Pick<
    LoopAdres,
    "oppervlakte" | "gebruiksdoel" | "woningtype" | "woningtype_zelf" | "bouwlagen"
  >,
  opties: { zonderType?: boolean } = {},
): string {
  const delen: string[] = [];
  if (isBedrijf(r)) {
    delen.push("bedrijf");
    const soort = BEDRIJF_LABELS[r.gebruiksdoel];
    if (soort) delen.push(soort);
  } else if (!opties.zonderType) {
    const type = woningtypeTekst(r);
    if (type) delen.push(type);
  }
  if (r.oppervlakte) delen.push(`${r.oppervlakte} m²`);
  if (r.bouwlagen) delen.push(`${r.bouwlagen} ${r.bouwlagen === 1 ? "laag" : "lagen"}`);
  return delen.join(" · ");
}

const NIVEAU_TEKST: Record<LoopVoorstel["niveau"], string> = {
  straat: "in deze straat",
  buurt: "in de buurt",
  wijk: "in de wijk",
};

/** "3 tussenwoningen in deze straat" */
export function voorstelUitleg(v: LoopVoorstel, type: Woningtype | null): string {
  const wat = type ? woningtypeLabel(type, v.n) : v.n === 1 ? "adres" : "adressen";
  return `${v.n} ${wat} ${NIVEAU_TEKST[v.niveau]}`;
}

/** "€ 14,50" naar 14.5; leeg wordt null, onzin wordt undefined. */
export function leesPrijs(tekst: string): number | null | undefined {
  const t = tekst.replace(/€/g, "").replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
}

/** 14.5 naar "14,50" voor in een invulveld. */
export function prijsTekst(prijs: number | null): string {
  if (prijs === null) return "";
  return Number.isInteger(prijs) ? String(prijs) : prijs.toFixed(2).replace(".", ",");
}

/** De tekst van een fout uit Supabase of van onszelf, om te tonen. */
export function foutTekst(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
}
