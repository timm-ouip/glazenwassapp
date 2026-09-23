/**
 * Geldlopen: de eigenaar geeft een wijk vrij voor een avond, de geldlopers
 * tikken aan de deur wat er gebeurde. Buiten zo'n avond zien ze niets; alles
 * loopt via databasefuncties die dat controleren (zie de migratie geldlopen).
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { dagKort, maandKort, type GeldDeel } from "@/lib/betalingen";

export interface Vrijgave {
  id: string;
  datum: string;
  begin_op: string;
  eind_op: string;
  wijken: { id: string; naam: string }[];
  lopers?: { id: string; naam: string }[];
  vrijgegeven_naam?: string;
  ingetrokken_op?: string | null;
}

export interface Loper {
  id: string;
  naam: string;
  eigenaar: boolean;
}

export type Tiksoort = "betaald" | "korting" | "niet_thuis" | "geen_geld" | "ongedaan";

export interface GeldloopAdres {
  id: string;
  wijk_id: string;
  wijk: string;
  wijk_sort: number;
  straat_id: string;
  straat: string;
  straat_sort: number;
  sort_desc: boolean;
  doorlopend: boolean;
  house_number: number;
  addition: string;
  sort_order: number;
  hoek_kant: string;
  naam: string;
  note: string;
  interval_maanden: number;
  ritme: number;
  methode: "contant" | "overmaken";
  gestopt: boolean;
  /**
   * Er staat deze maand nog een wasbeurt open die niet gedaan is (of die als
   * niet gewassen is teruggemeld). Dan is dit adres nog niet aan de beurt.
   */
  wacht_op_wasbeurt: boolean;
  /** Wie deze straat vanavond loopt; leeg is: iedereen die meeloopt. */
  straat_lopers: { id: string; naam: string }[];
  open: number;
  open_wassen: number;
  delen: GeldDeel[];
  klachten: string[];
  vaste_kortingen: { id: string; naam: string; bedrag: number }[];
  /** De kortingen die vanavond gegeven zijn, om ze te kunnen herstellen. */
  kortingen_vanavond: {
    id: string;
    bedrag: number;
    reden: string;
    door: string | null;
    door_naam: string;
    op: string;
  }[];
  /** De laatste tik van vanavond op dit adres (betaald, niet thuis, geen geld). */
  vanavond: {
    id: string;
    soort: "betaald" | "niet_thuis" | "geen_geld";
    bedrag: number;
    op: string;
    door: string | null;
    door_naam: string;
  } | null;
}

export interface GeldloopLijst {
  vrijgave: { id: string; datum: string; begin_op: string; eind_op: string; ingetrokken: boolean };
  adressen: GeldloopAdres[];
  opgehaald: {
    mij: number;
    mij_aantal: number;
    totaal: number;
    /** Adressen van mij waar nog iets open staat en nog niets is ingetikt. */
    mijn_open: number;
    /** Adressen van mij waar vanavond iets is ingetikt, wat dan ook. */
    mijn_gedaan: number;
    mijn_straten_open: number;
    samen_open: number;
    samen_gedaan: number;
    samen_straten_open: number;
  };
}

function lijst<T>(data: unknown): T[] {
  return (Array.isArray(data) ? data : []) as T[];
}

// ---------------------------------------------------------------------
// De eigenaar
// ---------------------------------------------------------------------

export async function fetchVrijgaven(vanaf: string): Promise<Vrijgave[]> {
  const { data, error } = await supabase.rpc("geldloop_vrijgaven_vanaf", { vanaf });
  if (error) throw error;
  return lijst<Vrijgave>(data);
}

export async function fetchMogelijkeLopers(): Promise<Loper[]> {
  const { data, error } = await supabase.rpc("geldloop_mogelijke_lopers");
  if (error) throw error;
  return lijst<Loper>(data);
}

export interface NietAfgemeld {
  datum: string;
  wijk: string;
  aantal: number;
}

export async function fetchNietAfgemeld(wijken: string[]): Promise<NietAfgemeld[]> {
  if (wijken.length === 0) return [];
  const { data, error } = await supabase.rpc("geldloop_niet_afgemeld", { wijken });
  if (error) throw error;
  return lijst<NietAfgemeld>(data);
}

export async function geefVrij(
  datum: string,
  wijken: string[],
  lopers: string[],
  eind: string | null,
): Promise<{ id: string; niet_afgemeld: NietAfgemeld[] }> {
  const { data, error } = await supabase.rpc("geldloop_vrijgeven", { datum, wijken, lopers, eind });
  if (error) throw error;
  return data as unknown as { id: string; niet_afgemeld: NietAfgemeld[] };
}

export async function trekIn(vrijgave: string) {
  const { error } = await supabase.rpc("geldloop_intrekken", { vrijgave });
  if (error) throw error;
}

export async function wijzigEind(vrijgave: string, eind: string) {
  const { error } = await supabase.rpc("geldloop_eind_wijzigen", { vrijgave, eind });
  if (error) throw error;
}

export async function bewaarEindtijd(bedrijf: string, eind: string) {
  const { error } = await supabase
    .from("companies")
    .update({ geldloop_eindtijd: eind })
    .eq("id", bedrijf);
  if (error) throw error;
}

export async function fetchEindtijd(bedrijf: string): Promise<string> {
  const { data, error } = await supabase
    .from("companies")
    .select("geldloop_eindtijd")
    .eq("id", bedrijf)
    .maybeSingle();
  if (error) throw error;
  return (data?.geldloop_eindtijd ?? "23:00").slice(0, 5);
}

// ---------------------------------------------------------------------
// De geldloper
// ---------------------------------------------------------------------

export async function fetchMijnGeldloop(): Promise<Vrijgave[]> {
  const { data, error } = await supabase.rpc("mijn_geldloop");
  if (error) throw error;
  return lijst<Vrijgave>(data);
}

export async function fetchGeldloopLijst(vrijgave: string): Promise<GeldloopLijst> {
  const { data, error } = await supabase.rpc("geldloop_lijst", { vrijgave });
  if (error) throw error;
  const x = data as unknown as GeldloopLijst;
  return {
    vrijgave: x.vrijgave,
    opgehaald: {
      mij: Number(x.opgehaald?.mij ?? 0),
      mij_aantal: Number(x.opgehaald?.mij_aantal ?? 0),
      totaal: Number(x.opgehaald?.totaal ?? 0),
      mijn_open: Number(x.opgehaald?.mijn_open ?? 0),
      mijn_gedaan: Number(x.opgehaald?.mijn_gedaan ?? 0),
      mijn_straten_open: Number(x.opgehaald?.mijn_straten_open ?? 0),
      samen_open: Number(x.opgehaald?.samen_open ?? 0),
      samen_gedaan: Number(x.opgehaald?.samen_gedaan ?? 0),
      samen_straten_open: Number(x.opgehaald?.samen_straten_open ?? 0),
    },
    adressen: lijst<GeldloopAdres>(x.adressen).map((a) => ({
      ...a,
      wacht_op_wasbeurt: a.wacht_op_wasbeurt ?? false,
      straat_lopers: a.straat_lopers ?? [],
      open: Number(a.open ?? 0),
      open_wassen: Number(a.open_wassen ?? 0),
      delen: (a.delen ?? []).map((d) => ({
        ...d,
        bedrag: Number(d.bedrag),
        rest: Number(d.rest),
        aantal: Number(d.aantal ?? 1),
        omschrijving: d.omschrijving ?? "",
      })),
      vaste_kortingen: (a.vaste_kortingen ?? []).map((k) => ({ ...k, bedrag: Number(k.bedrag) })),
      kortingen_vanavond: (a.kortingen_vanavond ?? []).map((k) => ({
        ...k,
        bedrag: Number(k.bedrag),
      })),
      vanavond: a.vanavond ? { ...a.vanavond, bedrag: Number(a.vanavond.bedrag) } : null,
    })),
  };
}

export interface Tik {
  /** Op de telefoon gemaakt: komt hij twee keer binnen, dan telt hij één keer. */
  id: string;
  adres: string;
  soort: Tiksoort;
  bedrag?: number;
  reden?: string;
  vaste_korting?: string | null;
  herroept?: string | null;
  /** Wanneer er getikt werd. */
  op: string;
  getoond_open?: number | null;
  bron?: "geldloop" | "kantoor" | "dag";
}

export function nieuweTik(t: Omit<Tik, "id" | "op">): Tik {
  return { ...t, id: crypto.randomUUID(), op: new Date().toISOString() };
}

export async function boek(
  t: Tik,
  signaal?: AbortSignal,
): Promise<{ status: "nieuw" | "al_ontvangen"; botsing: boolean }> {
  const vraag = supabase.rpc("geld_boeken", {
    id: t.id,
    adres_id: t.adres,
    soort: t.soort,
    bedrag: t.bedrag ?? 0,
    reden: t.reden ?? "",
    vaste_korting: t.vaste_korting ?? null,
    herroept: t.herroept ?? null,
    op: t.op,
    getoond_open: t.getoond_open ?? null,
    bron: t.bron ?? "geldloop",
  });
  const { data, error } = await (signaal ? vraag.abortSignal(signaal) : vraag);
  if (error) throw error;
  return data as unknown as { status: "nieuw" | "al_ontvangen"; botsing: boolean };
}

export async function maakVasteKorting(adres: string, naam: string, bedrag: number) {
  const { error } = await supabase.rpc("geld_vaste_korting", { adres, naam, bedrag });
  if (error) throw error;
}

export async function haalVasteKortingWeg(korting: string) {
  const { error } = await supabase.rpc("geld_vaste_korting_weg", { korting });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Straten verdelen
// ---------------------------------------------------------------------

/**
 * Wie loopt welke straat vanavond. Een lege lijst zet de straat terug op "van
 * iedereen". Zowel de eigenaar als de lopers zelf mogen dit, zolang de avond
 * loopt: loopt de een achter, dan neemt de ander een straat over.
 */
export async function verdeelStraat(vrijgave: string, straat: string, lopers: string[]) {
  const { error } = await supabase.rpc("geldloop_straat_verdelen", { vrijgave, straat, lopers });
  if (error) throw error;
}

/** De straten eerlijk over de lopers van deze avond verdelen, op aantal adressen. */
export async function verdeelEerlijk(
  vrijgave: string,
): Promise<{ straten: number; lopers: number }> {
  const { data, error } = await supabase.rpc("geldloop_straten_eerlijk", { vrijgave });
  if (error) throw error;
  const x = (data ?? {}) as { straten?: number; lopers?: number };
  return { straten: Number(x.straten ?? 0), lopers: Number(x.lopers ?? 0) };
}

/** Wie welke straat loopt in deze vrijgave: straat-id → lopers. */
export async function fetchStraatVerdeling(vrijgave: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("geldloop_straat_lopers")
    .select("street_id,employee_id")
    .eq("vrijgave_id", vrijgave);
  if (error) throw error;
  const uit = new Map<string, string[]>();
  for (const r of (data ?? []) as { street_id: string; employee_id: string }[]) {
    uit.set(r.street_id, [...(uit.get(r.street_id) ?? []), r.employee_id]);
  }
  return uit;
}

export interface StraatWijziging {
  id: string;
  straat: string;
  voor_naam: string;
  na_naam: string;
  door: string | null;
  door_naam: string;
  op: string;
  teruggedraaid_op: string | null;
  teruggedraaid_naam: string | null;
}

export async function fetchStraatWijzigingen(datum: string): Promise<StraatWijziging[]> {
  const { data, error } = await supabase.rpc("geldloop_straat_wijzigingen_van", { datum });
  if (error) throw error;
  return lijst<StraatWijziging>(data);
}

export async function draaiStraatWijzigingTerug(wijziging: string) {
  const { error } = await supabase.rpc("geldloop_straat_wijziging_terugdraaien", { wijziging });
  if (error) throw error;
}

/** "Kerkstraat naar Sanne", "Kerkstraat weer van iedereen". */
export function straatWijzigingTekst(w: StraatWijziging): string {
  if (!w.na_naam) return `${w.straat} weer van iedereen`;
  return `${w.straat} naar ${w.na_naam}`;
}

/** De eerste letters van een naam, voor het strookje met straten: "SJ". */
export function initialen(naam: string): string {
  return naam
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((d) => d[0]!.toUpperCase())
    .join("");
}

export async function klachtAanDeDeur(adres: string, omschrijving: string) {
  const { error } = await supabase.rpc("geldloop_klacht", { adres, omschrijving });
  if (error) throw error;
}

/**
 * Live meekijken: tikt een collega iets in deze avond, dan wordt de lijst
 * opnieuw opgehaald. Een kleine vertraging, zodat vijf tikken vlak na elkaar
 * één keer ophalen worden.
 */
export function useGeldloopLive(vrijgave: string | undefined) {
  const qc = useQueryClient();
  const wacht = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!vrijgave) return;
    const kanaal = supabase
      .channel(`geldloop:${vrijgave}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "betaal_gebeurtenissen",
          filter: `vrijgave_id=eq.${vrijgave}`,
        },
        () => {
          if (wacht.current) clearTimeout(wacht.current);
          wacht.current = setTimeout(() => {
            void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave] });
          }, 500);
        },
      )
      .subscribe();
    return () => {
      if (wacht.current) clearTimeout(wacht.current);
      void supabase.removeChannel(kanaal);
    };
  }, [vrijgave, qc]);
}

/** De volgorde waarin je een straat loopt: zoals op de wijklijst. */
export function looprichting(a: GeldloopAdres[]): GeldloopAdres[] {
  const gesorteerd = [...a].sort(
    (x, y) =>
      x.sort_order - y.sort_order ||
      x.house_number - y.house_number ||
      x.addition.localeCompare(y.addition),
  );
  return a[0]?.sort_desc ? gesorteerd.reverse() : gesorteerd;
}

/** Staat er vanavond nog iets te doen bij dit adres? */
export function heeftIetsOpen(a: GeldloopAdres): boolean {
  return a.open > 0.005;
}

/**
 * Is dit adres vanavond aan de beurt om op te halen? Je haalt geld op nadat
 * er gewassen is, dus een adres waar deze maand nog een beurt op de planning
 * staat sla je over — ook als er van eerder nog pof staat. Staat een hele
 * straat nog te wachten, dan valt die straat vanzelf uit de lijst.
 */
export function aanDeBeurt(a: GeldloopAdres): boolean {
  return !a.wacht_op_wasbeurt;
}

// ---------------------------------------------------------------------
// Het dossier voor de geldloper (alleen tijdens zijn avond)
// ---------------------------------------------------------------------

export interface GeldloopDossierData {
  adres: {
    id: string;
    straat: string;
    house_number: number;
    addition: string;
    note: string;
    interval_maanden: number;
    ritme: number;
    maandwerk: { id?: string; maanden: string[]; jaar?: number; notitie: string }[];
    inactief_op: string | null;
    inactief_reden: string | null;
    prijs: number;
    maandwerk_extra: Record<string, number>;
  };
  klant: {
    id: string;
    naam: string;
    telefoon: string;
    telefoon2: string;
    email: string;
    email2: string;
  } | null;
}

export async function fetchGeldloopDossier(adres: string): Promise<GeldloopDossierData> {
  const { data, error } = await supabase.rpc("geldloop_dossier", { adres_id: adres });
  if (error) throw error;
  const x = data as unknown as GeldloopDossierData;
  return { ...x, adres: { ...x.adres, prijs: Number(x.adres.prijs ?? 0) } };
}

export async function bewaarGeldloopDossier(
  adres: string,
  wijzigingen: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await supabase.rpc("geldloop_dossier_bewaren", {
    adres_id: adres,
    wijzigingen: wijzigingen as never,
  });
  if (error) throw error;
  return Number((data as { wijzigingen?: number } | null)?.wijzigingen ?? 0);
}

export async function geldloopStoppen(adres: string, reden: "verhuisd" | "gestopt") {
  // De planning vanaf morgen gaat mee weg; de eigenaar kan het terugdraaien.
  const { error } = await supabase.rpc("geldloop_stoppen", {
    adres_id: adres,
    reden,
    planning_weg: true,
  });
  if (error) throw error;
}

export interface GeldloopWijziging {
  id: string;
  customer_id: string;
  soort: "adres" | "prijs" | "klant" | "klant_nieuw" | "stoppen" | "niet_gewassen";
  voor: Record<string, unknown>;
  na: Record<string, unknown>;
  adres: string;
  door: string | null;
  door_naam: string;
  op: string;
  teruggedraaid_op: string | null;
  teruggedraaid_naam: string | null;
}

export async function fetchGeldloopWijzigingen(filter: {
  adres?: string;
  datum?: string;
}): Promise<GeldloopWijziging[]> {
  const { data, error } = await supabase.rpc("geldloop_wijzigingen_van", {
    adres_id: filter.adres ?? null,
    datum: filter.datum ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as unknown as GeldloopWijziging[];
}

/**
 * Aan de deur blijkt dat er niet gewassen is. De beurt blijft op de dag
 * staan, maar gemarkeerd: rood, zonder bedrag, en hij telt niet meer als
 * gewassen — zo kun je hem opnieuw inplannen én zie je terug dat het misging.
 * De eigenaar ziet het in het overzicht staan en kan het in één klik
 * terugzetten.
 */
export async function geldloopNietGewassen(adres: string, dag: string) {
  const { error } = await supabase.rpc("geldloop_niet_gewassen", { adres_id: adres, dag });
  if (error) throw error;
}

/** Een adres dat een geldloper als "niet gewassen" terugmeldde. */
export interface Vergeten {
  id: string;
  customer_id: string;
  adres: string;
  /** De dag waarop hij gewassen had moeten zijn. */
  datum: string;
  door_naam: string;
  op: string;
}

/**
 * Wat er in een periode teruggemeld is als niet gewassen. Uit dezelfde lijst
 * met wijzigingen van geldlopers, dus wat de eigenaar terugdraaide telt niet
 * meer mee.
 */
export async function fetchVergeten(vanaf: string, tot: string): Promise<Vergeten[]> {
  const { data, error } = await supabase.rpc("geldloop_vergeten", { vanaf, tot });
  if (error) throw error;
  return lijst<Vergeten>(data);
}

export async function draaiGeldloopWijzigingTerug(id: string) {
  const { error } = await supabase.rpc("geldloop_wijziging_terugdraaien", { wijziging: id });
  if (error) throw error;
}

/** "Prijs € 15 → € 17,50", "Gestopt (verhuisd)": wat er veranderde, kort. */
export function wijzigingTekst(w: GeldloopWijziging): string {
  const v = w.voor as Record<string, unknown>;
  const n = w.na as Record<string, unknown>;
  const euro = (x: unknown) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(x ?? 0));
  switch (w.soort) {
    case "prijs":
      return Number(v["prijs"]) !== Number(n["prijs"])
        ? `prijs ${euro(v["prijs"])} → ${euro(n["prijs"])}`
        : "meerprijs extra werk aangepast";
    case "adres": {
      const delen: string[] = [];
      if (v["note"] !== n["note"]) delen.push(`notitie "${String(n["note"] ?? "")}"`);
      if (v["interval_maanden"] !== n["interval_maanden"] || v["ritme"] !== n["ritme"])
        delen.push("frequentie aangepast");
      if (JSON.stringify(v["maandwerk"]) !== JSON.stringify(n["maandwerk"]))
        delen.push("extra werk aangepast");
      return delen.join(", ") || "adres aangepast";
    }
    case "klant":
      return "klantgegevens aangepast";
    case "klant_nieuw":
      return `nieuwe klant ${String(n["naam"] ?? "")}`;
    case "stoppen":
      return n["reden"] === "verhuisd" ? "laten stoppen (verhuisd)" : "laten stoppen";
    case "niet_gewassen":
      return `niet gewassen: de beurt van ${dagKort(String(v["datum"] ?? ""))} telt niet mee`;
  }
}
