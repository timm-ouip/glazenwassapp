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
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { haalStraatAdressen, type BagAdres } from "@/lib/bag";
import { kantVan, type Kant } from "@/lib/klanten";
import { nummerSleutel } from "@/lib/postcode";

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

// ---------------------------------------------------------------------------
// Ophalen
// ---------------------------------------------------------------------------

export async function fetchLoopTellingen(): Promise<LoopGebied[]> {
  const { data, error } = await supabase.rpc("loop_tellingen");
  if (error) throw error;
  return (data ?? []).map((g) => ({
    gebied_id: g.gebied_id,
    naam: g.naam,
    district_id: g.district_id ?? null,
    wijk: g.wijk ?? null,
    plaats: g.plaats ?? "",
    straten: g.straten ?? [],
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

export type LoopPatch = Partial<Pick<LoopAdres, "uitkomst" | "prijs" | "notitie">>;

/** Uitkomst, prijs of notitie van één adres bewaren. Wie en wanneer zet de
 *  database zelf. */
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
}): Promise<string> {
  const { data, error } = await supabase
    .from("loopgebieden")
    .insert({
      naam: gebied.naam.trim(),
      district_id: gebied.district_id,
      plaats: gebied.plaats.trim(),
      straten: gebied.straten,
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
  oppervlakte: number | null;
  gebruiksdoel: string;
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
 * Alle adressen van een rij straten uit de BAG, één straat tegelijk.
 *
 * Een straat die de Locatieserver niet kent, komt in `nietGevonden` (meestal
 * een afgekorte werknaam). Mislukt het ophalen zelf, dan komt er een fout met
 * de naam van de straat; er is dan nog niets bewaard. `onthoud` bewaart wat
 * al binnen is, zodat een tweede poging alleen de rest ophaalt.
 */
export async function haalGebiedAdressen(
  straten: OphaalStraat[],
  plaats: string,
  opties: {
    onVoortgang?: (tekst: string) => void;
    signal?: AbortSignal;
    onthoud?: Map<string, BagAdres[]>;
  } = {},
): Promise<{ rijen: LoopInvoer[]; nietGevonden: string[] }> {
  const woonplaats = bagPlaats(plaats);
  const rijen: LoopInvoer[] = [];
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
    for (const a of adressen) {
      rijen.push({
        vbo_id: a.vbo_id,
        straat: a.straat,
        woonplaats: a.woonplaats,
        huisnummer: a.huisnummer,
        toevoeging: a.toevoeging,
        postcode: a.postcode,
        street_id: s.street_id,
        oppervlakte: a.oppervlakte,
        gebruiksdoel: a.gebruiksdoel,
      });
    }
  }
  // Twee straten kunnen hetzelfde adres opleveren (een hoekpand); één keer.
  const uniek = new Map<string, LoopInvoer>();
  for (const r of rijen) {
    const al = uniek.get(r.vbo_id);
    if (!al || (!al.street_id && r.street_id)) uniek.set(r.vbo_id, r);
  }
  return { rijen: [...uniek.values()], nietGevonden };
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
  "uitkomst" | "uitkomst_op" | "prijs" | "notitie" | "woningtype_zelf"
> & { id: string; customer_id: string | null };

/**
 * Zet één gewijzigde rij meteen in elke geopende looplijst. Lukt dat niet
 * (de rij is nieuw, of hij werd net klant), dan geeft hij false en wordt de
 * lijst opnieuw opgehaald.
 */
function zetRijBij(qc: ReturnType<typeof useQueryClient>, w: LoopWijziging): boolean {
  let gevonden = false;
  for (const [sleutel, rijen] of qc.getQueriesData<LoopAdres[]>({ queryKey: ["loop-lijst"] })) {
    const oud = rijen?.find((r) => r.id === w.id);
    if (!oud) continue;
    if (w.customer_id !== null || oud.klant_status !== null) return false;
    gevonden = true;
    qc.setQueryData<LoopAdres[]>(sleutel, (lijst) =>
      lijst?.map((r) =>
        r.id === w.id
          ? {
              ...r,
              uitkomst: w.uitkomst,
              uitkomst_op: w.uitkomst_op,
              uitkomst_door_naam: w.uitkomst === r.uitkomst ? r.uitkomst_door_naam : null,
              prijs: w.prijs === null ? null : Number(w.prijs),
              notitie: w.notitie ?? "",
              woningtype_zelf: w.woningtype_zelf,
            }
          : r,
      ),
    );
  }
  return gevonden;
}

/**
 * Live meekijken: tikt een collega iets in, dan komt alleen die ene rij bij
 * (de melding bevat de nieuwe uitkomst, prijs en notitie). Alleen bij nieuwe
 * adressen of een nieuwe klant haalt de lijst zich opnieuw op. De tellers
 * volgen met een kleine vertraging, zodat vijf tikken vlak na elkaar één keer
 * ophalen worden (zoals useGeldloopLive).
 */
export function useLoopLive(companyId: string | undefined) {
  const qc = useQueryClient();
  const wacht = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heleLijst = useRef(false);
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
          const nieuw = melding.new as Partial<LoopWijziging> | undefined;
          const bijgezet =
            melding.eventType === "UPDATE" &&
            onderweg === 0 &&
            !!nieuw?.id &&
            zetRijBij(qc, nieuw as LoopWijziging);
          if (!bijgezet) heleLijst.current = true;
          if (wacht.current) clearTimeout(wacht.current);
          const ververs = () => {
            // Nog een eigen tik onderweg: straks, anders wist de oude stand
            // uit de database even wat je net tikte.
            if (onderweg > 0) {
              wacht.current = setTimeout(ververs, 500);
              return;
            }
            if (heleLijst.current) {
              heleLijst.current = false;
              void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
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

/** De kleine regel onder het huisnummer: "96 m²", of "bedrijf · winkel · 80 m²". */
export function adresOmschrijving(
  r: Pick<LoopAdres, "oppervlakte" | "gebruiksdoel" | "woningtype" | "woningtype_zelf">,
): string {
  const delen: string[] = [];
  if (r.gebruiksdoel && r.gebruiksdoel !== "woonfunctie") {
    delen.push("bedrijf");
    const soort = BEDRIJF_LABELS[r.gebruiksdoel];
    if (soort) delen.push(soort);
  }
  if (r.oppervlakte) delen.push(`${r.oppervlakte} m²`);
  return delen.join(" · ");
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
