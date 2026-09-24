/**
 * Facturen: voor de klanten die overmaken.
 *
 * De volgorde waarin een factuur ontstaat, want die verklaart de rest:
 *
 *   1. Een dag wordt helemaal afgemeld → de database maakt *te factureren
 *      regels*. Geen nummer, niets naar buiten.
 *   2. Die regels worden een concept (per beurt, of verzameld per maand).
 *   3. Bij het versturen trekt de factuur zijn nummer en bevriest hij de
 *      klantgegevens. Vanaf dat moment is er niets meer aan te veranderen:
 *      de klant heeft dat papier al. Rechtzetten gaat met een creditfactuur.
 *
 * Het rekenwerk zit in de database (zie de migraties facturen_fundament en
 * facturen_maken); hier staat alleen hoe de app het opvraagt.
 */
import { supabase } from "@/integrations/supabase/client";
import { haalAllePaginas } from "@/lib/pagineren";

export type FactuurStatus = "concept" | "verstuurd" | "betaald" | "gecrediteerd";
export type FactuurSoort = "factuur" | "credit";
export type Klanttype = "particulier" | "bedrijf" | "vve";

export const KLANTTYPEN: { waarde: Klanttype; label: string; uitleg: string }[] = [
  { waarde: "particulier", label: "Particulier", uitleg: "Bedragen inclusief btw" },
  { waarde: "bedrijf", label: "Bedrijf", uitleg: "Bedragen exclusief btw, met btw eronder" },
  { waarde: "vve", label: "VvE", uitleg: "Bedragen exclusief btw, meestal één factuur per maand" },
];

export function klanttypeLabel(t: Klanttype | null | undefined): string {
  return KLANTTYPEN.find((k) => k.waarde === t)?.label ?? "Particulier";
}

/** Staat de prijs van deze klant inclusief btw? Leeg = volgt het klanttype. */
export function btwInclusief(
  klanttype: Klanttype | null | undefined,
  eigen: boolean | null | undefined,
): boolean {
  return eigen ?? (klanttype ?? "particulier") === "particulier";
}

export interface FactuurTotalen {
  regels: number;
  excl: number;
  btw: number;
  incl: number;
}

export interface Factuur {
  id: string;
  /** Leeg zolang het een concept is. */
  nummer: string | null;
  soort: FactuurSoort;
  status: FactuurStatus;
  klant_id: string;
  /** De bedrijfsnaam als die er is, anders de naam van de klant. */
  klant: string;
  klanttype: Klanttype;
  /** Waar hij heen gaat: het aparte factuuradres, anders het gewone. */
  mail: string;
  factuurdatum: string | null;
  /** De dag waar hij bij hoort: de factuurdatum, of bij een concept de dag
   *  waarop hij is aangemaakt. Altijd gevuld. */
  datum: string;
  vervaldatum: string | null;
  te_laat: boolean;
  met_rust_tot: string | null;
  herinnering_trap: number;
  betaald_bedrag: number;
  verstuurd_op: string | null;
  verstuurd_via: "mail" | "whatsapp" | "print" | null;
  mollie_link: string | null;
  totalen: FactuurTotalen;
}

/**
 * Staan de bedragen van deze factuur exclusief btw vooraan? Een particulier
 * ziet het bedrag dat hij overmaakt; een bedrijf of VvE rekent in bedragen
 * zonder btw, met de btw eronder. Dezelfde regel als op de PDF, zodat het
 * scherm en het papier hetzelfde getal groot maken.
 */
export function exclusiefVoorop(f: Pick<Factuur, "klanttype">): boolean {
  return !btwInclusief(f.klanttype, null);
}

/** Wat er nog open staat op deze factuur. Nooit onder nul. */
export function openBedrag(f: Factuur): number {
  return Math.max(0, Math.round((f.totalen.incl - f.betaald_bedrag) * 100) / 100);
}

/**
 * Hoe de factuur ervoor staat, in één woord voor op het scherm. Let op het
 * verschil tussen "Concept" en "Klaargezet": zodra er een nummer op staat is
 * hij vastgezet en kan er niets meer aan veranderen, ook al is de mail nog
 * niet de deur uit.
 */
export function factuurStand(f: Factuur): string {
  if (f.soort === "credit") return "Creditfactuur";
  if (f.status === "gecrediteerd") return "Gecrediteerd";
  if (f.status === "betaald") return "Betaald";
  if (f.status === "concept") return f.nummer ? "Klaargezet" : "Concept";
  if (f.betaald_bedrag > 0) return "Deels betaald";
  if (f.te_laat) return "Te laat";
  return "Verstuurd";
}

function leesFactuur(x: Factuur): Factuur {
  const t = x.totalen ?? { regels: 0, excl: 0, btw: 0, incl: 0 };
  return {
    ...x,
    betaald_bedrag: Number(x.betaald_bedrag ?? 0),
    totalen: {
      regels: Number(t.regels ?? 0),
      excl: Number(t.excl ?? 0),
      btw: Number(t.btw ?? 0),
      incl: Number(t.incl ?? 0),
    },
  };
}

export async function fetchFacturen(vanaf?: string, tot?: string): Promise<Factuur[]> {
  const { data, error } = await supabase.rpc("facturen_lijst", {
    vanaf: vanaf ?? null,
    tot: tot ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as Factuur[]).map(leesFactuur);
}

/** Eén regel op een factuur, zoals hij bij de klant op papier komt. */
export interface Factuurregel {
  id: string;
  soort: "wasbeurt" | "klus";
  datum: string;
  omschrijving: string;
  notitie: string;
  /** De prijs zoals ingevoerd: bij een particulier inclusief btw, bij een
   *  bedrijf exclusief. Wat je aanpast als er maar een deel gedaan is. */
  bedrag: number;
  bedrag_excl: number;
  btw_bedrag: number;
  bedrag_incl: number;
  btw_procent: number;
  factuur_id: string | null;
}

export async function fetchFactuurregels(factuurId: string): Promise<Factuurregel[]> {
  const { data, error } = await supabase
    .from("factuurregels")
    .select(
      "id,soort,datum,omschrijving,notitie,bedrag,bedrag_excl,btw_bedrag,bedrag_incl,btw_procent,factuur_id",
    )
    .eq("factuur_id", factuurId)
    .is("deleted_at", null)
    .order("datum");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    soort: r.soort as "wasbeurt" | "klus",
    bedrag: Number(r.bedrag ?? 0),
    bedrag_excl: Number(r.bedrag_excl ?? 0),
    btw_bedrag: Number(r.btw_bedrag ?? 0),
    bedrag_incl: Number(r.bedrag_incl ?? 0),
    btw_procent: Number(r.btw_procent ?? 0),
  }));
}

/** Hoeveel regels er nog op geen enkele factuur staan. Voor het gele vakje. */
export async function fetchLosseRegels(): Promise<number> {
  const { count, error } = await supabase
    .from("factuurregels")
    .select("id", { count: "exact", head: true })
    .is("factuur_id", null)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Losse regels bundelen tot concepten. `nuOok` pakt ook de lopende maand mee. */
export async function facturenKlaarzetten(nuOok = false): Promise<number> {
  const { data, error } = await supabase.rpc("facturen_klaarzetten", { nu_ook: nuOok });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * De facturen echt de deur uit doen. Het zware werk gebeurt op de server:
 * daar wordt per factuur het nummer getrokken, de PDF gebouwd en de mail
 * verstuurd. De browser krijgt alleen terug hoeveel er gelukt zijn.
 */
export async function facturenVersturen(ids: string[]): Promise<{
  gelukt: number;
  mislukt: { id: string; reden: string }[];
}> {
  const { data, error } = await supabase.functions.invoke("facturen", {
    body: { actie: "versturen", ids },
  });
  if (error) throw error;
  return data as { gelukt: number; mislukt: { id: string; reden: string }[] };
}

export async function factuurWeggooien(id: string) {
  // De regels blijven bestaan en komen los te staan: ze wachten gewoon op
  // een volgende factuur. Alleen een concept kan weg; de database houdt een
  // factuur met een nummer zelf tegen.
  const { error } = await supabase.from("facturen").delete().eq("id", id);
  if (error) throw error;
}

export async function factuurBetaald(id: string, bedrag: number, op?: string) {
  const { data, error } = await supabase.rpc("factuur_betaald", {
    factuur: id,
    bedrag,
    op: op ?? null,
  });
  if (error) throw error;
  return data as unknown as { betaald: number; totaal: number; open: number };
}

export async function factuurCrediteren(id: string, reden = ""): Promise<string> {
  const { data, error } = await supabase.rpc("factuur_crediteren", { factuur: id, reden });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * Van een gecrediteerde factuur het aangevinkte werk opnieuw aanmelden, zodat
 * het op een aangepaste factuur komt. Geeft terug hoeveel regels erbij kwamen;
 * werk dat al opnieuw is aangemeld wordt overgeslagen.
 */
export async function factuurOpnieuw(
  id: string,
  keuzes: { id: string; bedrag: number }[],
): Promise<number> {
  const { data, error } = await supabase.rpc("factuur_opnieuw", { factuur: id, keuzes });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Deze factuur even met rust laten: geen herinnering tot die datum. Gaat via
 * een eigen functie, want een verstuurde factuur staat verder op slot en dit
 * ene veld is de uitzondering.
 */
export async function factuurMetRust(id: string, tot: string | null) {
  const { error } = await supabase.rpc("factuur_met_rust", { factuur: id, tot });
  if (error) throw error;
}

/**
 * Het btw-tarief van het bedrijf. Staat er niets, dan 21 — hetzelfde
 * uitgangspunt als in de database (`factuur_btw_procent`).
 *
 * RLS laat je maar één bedrijf zien, dus er hoeft niet op gefilterd te worden.
 */
export async function fetchBtwProcent(): Promise<number> {
  const { data, error } = await supabase.from("companies").select("btw_procent").limit(1).single();
  if (error) throw error;
  return Number(data.btw_procent ?? 21) || 21;
}

/**
 * Hoeveel btw er in een bedrag zit. Staat de prijs inclusief (particulier),
 * dan rekenen we hem eruit; staat hij exclusief (bedrijf, VvE), dan komt hij
 * er bovenop. Dezelfde som als `factuur_excl` in de database.
 */
export function btwIn(bedrag: number, inclusief: boolean, procent: number): number {
  const deel = procent / 100;
  return inclusief ? bedrag - bedrag / (1 + deel) : bedrag * deel;
}

/**
 * Van elke klant alleen zijn type. Genoeg om te weten of een prijs inclusief
 * of exclusief btw genoteerd staat, en veel lichter dan het hele
 * klantenbestand: daar zitten mailadressen en notities in die hier niets te
 * zoeken hebben.
 */
export async function fetchKlanttypen(): Promise<Map<string, Klanttype>> {
  const data = await haalAllePaginas((van, tot) =>
    supabase
      .from("klanten")
      .select("id,klanttype")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(van, tot),
  );
  return new Map(
    (data as { id: string; klanttype: Klanttype | null }[]).map((k) => [
      k.id,
      k.klanttype ?? "particulier",
    ]),
  );
}

// ---------------------------------------------------------------------
// Vangnetten
// ---------------------------------------------------------------------

/**
 * Waarom een adres op "overmaken" geen factuur oplevert. Drie manieren, en
 * alle drie gebeuren ze zonder dat je er iets van merkt: er staat gewoon geen
 * factuur.
 */
export type VangnetSoort = "zonder_klant" | "zonder_prijs" | "zonder_mail" | "zonder_klusprijs";

export interface VangnetRij {
  soort: VangnetSoort;
  customer_id: string;
  klant_id: string | null;
  /** "Markgraaf A 138", met de officiële straatnaam. */
  adres: string;
  wijk: string;
  naam: string;
}

export const VANGNET: {
  soort: VangnetSoort;
  kop: string;
  uitleg: string;
}[] = [
  {
    soort: "zonder_klant",
    kop: "Geen klant aan het adres",
    uitleg:
      "Een factuur gaat naar een klant, niet naar een adres. Hangt er geen klant aan, dan ontstaat er niets — ook niet als de dag netjes is afgemeld.",
  },
  {
    soort: "zonder_prijs",
    kop: "Geen prijs",
    uitleg: "Zonder prijs valt er niets te factureren; deze beurten slaat de app over.",
  },
  {
    soort: "zonder_mail",
    kop: "Geen e-mailadres",
    uitleg:
      "De factuur wordt wel gemaakt, maar blijft als concept staan: er is geen adres om hem heen te sturen.",
  },
  {
    soort: "zonder_klusprijs",
    kop: "Extra opdracht zonder prijs",
    uitleg:
      "Het adres zelf is in orde, maar hier staat een extra opdracht open waar geen prijs bij hoort. Vink je die af, dan telt hij nergens mee.",
  },
];

/**
 * De adressen die het laten afweten. Leeg zolang het factureren uitstaat —
 * dan valt er ook niets te missen.
 */
export async function fetchVangnet(): Promise<VangnetRij[]> {
  const { data, error } = await supabase.rpc("facturen_vangnet");
  if (error) throw error;
  return (data ?? []) as VangnetRij[];
}

/** Wat er verandert als een hele wijk op overmaken gaat. */
export interface WijkTelling {
  /** Adressen die de wijk volgen; wie het zelf ingesteld heeft, verandert niet. */
  adressen: number;
  zonder_klant: number;
  zonder_prijs: number;
  zonder_mail: number;
}

export async function fetchWijkTelling(wijk: string): Promise<WijkTelling> {
  const { data, error } = await supabase.rpc("wijk_overmaken_telling", { wijk });
  if (error) throw error;
  const x = (data ?? {}) as Partial<WijkTelling>;
  return {
    adressen: Number(x.adressen ?? 0),
    zonder_klant: Number(x.zonder_klant ?? 0),
    zonder_prijs: Number(x.zonder_prijs ?? 0),
    zonder_mail: Number(x.zonder_mail ?? 0),
  };
}

/** "80 zonder klant, 5 zonder prijs en 2 zonder e-mailadres". */
function opsomming(delen: string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;
}

/**
 * Wat er te zeggen valt voordat een hele wijk op overmaken gaat. Eén klik zet
 * soms honderden adressen om, en van de adressen die het daarna laten afweten
 * hoor je niets meer — dus die telling hoort ervóór.
 *
 * Leeg als er niets te melden is: geen enkel adres volgt de wijk.
 */
export function wijkWaarschuwing(t: WijkTelling): string | null {
  if (t.adressen === 0) return null;
  const kop =
    t.adressen === 1
      ? "1 adres volgt de wijk en gaat dus mee naar overmaken: dat krijgt voortaan een factuur in plaats van contant."
      : `${t.adressen} adressen volgen de wijk en gaan dus mee naar overmaken: die krijgen voortaan een factuur in plaats van contant.`;
  const stuk = opsomming(
    [
      t.zonder_klant > 0 ? `${t.zonder_klant} zonder klant` : "",
      t.zonder_prijs > 0 ? `${t.zonder_prijs} zonder prijs` : "",
      t.zonder_mail > 0 ? `${t.zonder_mail} zonder e-mailadres` : "",
    ].filter(Boolean),
  );
  if (!stuk) return kop;
  const mis = t.zonder_klant + t.zonder_prijs + t.zonder_mail;
  return (
    `${kop} Bij ${mis === 1 ? "één daarvan" : `${mis} daarvan`} komt er geen factuur de deur uit: ` +
    `${stuk}. Dat merk je verder nergens aan — er staat dan gewoon geen factuur.`
  );
}

// ---------------------------------------------------------------------
// De por
// ---------------------------------------------------------------------

/** Zoveel dagen mag een concept klaarstaan voordat de app er wat van zegt. */
export const POR_DAGEN = 5;

/**
 * Hoe lang staat het oudste concept al te wachten? Leeg als er niets staat of
 * als alles nog vers is.
 *
 * Een concept gaat niet vanzelf de deur uit — dat is met opzet, want er zit
 * een mail met een bedrag aan vast. Maar "ik doe het nog wel" wordt zo een
 * maand, en dan staat de omzet van september pas in november op de rekening.
 *
 * Op de ouderdom van het oudste concept, niet op de dag van de maand: een
 * concept dat vanmiddag ontstond hoort niet te zeuren, en twintig concepten
 * van vorige maand horen dat op de 3e wél te doen.
 */
export function porNodig(concepten: Pick<Factuur, "datum">[], vandaagIso: string): number | null {
  const oudste = concepten
    .map((f) => f.datum)
    .filter(Boolean)
    .sort()[0];
  if (!oudste) return null;
  const dagen = Math.round((Date.parse(vandaagIso) - Date.parse(oudste)) / 86_400_000);
  return dagen > POR_DAGEN ? dagen : null;
}

// --------------------------------------------------------------- vormgeving

/**
 * Hoe de factuur eruitziet.
 *
 * Het tekenen zelf gebeurt op de server (`_gedeeld/factuurpdf.ts`), want daar
 * wordt de PDF gemaakt die de klant krijgt. Hier staan alleen de knoppen: wat
 * er in `companies` bewaard wordt, en hoe je er een proef van opvraagt.
 *
 * De maten zijn millimeters. Niet omdat een PDF daarin rekent -- die rekent in
 * punten -- maar omdat je ze naast een uitdraai met een liniaal wilt kunnen
 * nameten.
 */
export interface FactuurVorm {
  briefpapier_pad: string | null;
  kader_boven: number;
  kader_onder: number;
  eigen_kop: boolean;
  eigen_voet: boolean;
  /** Leeg is het gewone zwart-grijs. */
  kleur: string;
  koptekst: string;
  voettekst: string;
}

export const STANDAARD_VORM: FactuurVorm = {
  briefpapier_pad: null,
  kader_boven: 20,
  kader_onder: 20,
  eigen_kop: true,
  eigen_voet: true,
  kleur: "",
  koptekst: "",
  voettekst: "",
};

/**
 * Wat er als briefpapier mag, en tot welke omvang.
 *
 * Twee megabyte, en dat is ruim: dit bestand zit straks in *elke* factuur-PDF.
 * Een ingescande briefkop van vijf megabyte maakt elke factuur vijf megabyte
 * zwaar, en dan loopt een maandrun vast op de grens van de mailserver -- ná
 * dat de facturen hun nummer al getrokken hebben. Een PDF van echt briefpapier
 * blijft ver onder deze grens.
 */
export const BRIEFPAPIER_SOORTEN = ["application/pdf", "image/png", "image/jpeg"];
const BRIEFPAPIER_MAX = 2 * 1024 * 1024;

export async function fetchFactuurVorm(companyId: string): Promise<FactuurVorm> {
  const { data, error } = await supabase
    .from("companies")
    .select(
      "factuur_briefpapier_pad,factuur_kader_boven,factuur_kader_onder,factuur_eigen_kop,factuur_eigen_voet,factuur_kleur,factuur_koptekst,factuur_voettekst",
    )
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return STANDAARD_VORM;
  return {
    briefpapier_pad: data.factuur_briefpapier_pad,
    kader_boven: data.factuur_kader_boven ?? STANDAARD_VORM.kader_boven,
    kader_onder: data.factuur_kader_onder ?? STANDAARD_VORM.kader_onder,
    eigen_kop: data.factuur_eigen_kop !== false,
    eigen_voet: data.factuur_eigen_voet !== false,
    kleur: data.factuur_kleur ?? "",
    koptekst: data.factuur_koptekst ?? "",
    voettekst: data.factuur_voettekst ?? "",
  };
}

export async function bewaarFactuurVorm(companyId: string, v: FactuurVorm) {
  const { error } = await supabase
    .from("companies")
    .update({
      factuur_briefpapier_pad: v.briefpapier_pad,
      factuur_kader_boven: v.kader_boven,
      factuur_kader_onder: v.kader_onder,
      factuur_eigen_kop: v.eigen_kop,
      factuur_eigen_voet: v.eigen_voet,
      // Leeg moet echt leeg zijn: de database laat alleen #rrggbb of niets toe.
      factuur_kleur: /^#[0-9a-fA-F]{6}$/.test(v.kleur) ? v.kleur.toLowerCase() : null,
      factuur_koptekst: v.koptekst.trim() || null,
      factuur_voettekst: v.voettekst.trim() || null,
    })
    .eq("id", companyId);
  if (error) throw error;
}

/**
 * Het briefpapier in de opslagbak zetten, altijd onder <bedrijf>/merk/.
 * Alleen dáár mag de browser schrijven; de verstuurde facturen staan onder
 * <bedrijf>/<jaar>/ en blijven van de service role.
 */
export async function uploadBriefpapier(companyId: string, bestand: File): Promise<string> {
  if (!BRIEFPAPIER_SOORTEN.includes(bestand.type)) {
    throw new Error("Alleen een PDF, een PNG of een JPG.");
  }
  if (bestand.size > BRIEFPAPIER_MAX) {
    throw new Error("Het bestand mag hooguit 2 MB zijn.");
  }
  const extensie =
    bestand.type === "application/pdf" ? "pdf" : bestand.type === "image/png" ? "png" : "jpg";
  const pad = `${companyId}/merk/briefpapier.${extensie}`;
  const { error } = await supabase.storage
    .from("facturen")
    .upload(pad, bestand, { contentType: bestand.type, upsert: true });
  if (error) throw error;
  return pad;
}

export async function verwijderBriefpapier(pad: string) {
  const { error } = await supabase.storage.from("facturen").remove([pad]);
  if (error) throw error;
}

/**
 * Een proef-PDF met verzonnen gegevens.
 *
 * Met opzet bij de server opgehaald en niet in de browser nagebouwd: dan zou
 * je naar een tekening kijken die lijkt op de factuur in plaats van naar de
 * factuur. Er komt geen nummer aan te pas en er wordt niets bewaard.
 */
export async function voorbeeldFactuur(v: FactuurVorm): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke("facturen", {
    body: {
      actie: "voorbeeld",
      vorm: {
        kaderBoven: v.kader_boven,
        kaderOnder: v.kader_onder,
        eigenKop: v.eigen_kop,
        eigenVoet: v.eigen_voet,
        kleur: v.kleur,
        koptekst: v.koptekst,
        voettekst: v.voettekst,
      },
    },
  });
  if (error) throw error;
  const uit = data as { pdf?: string; fout?: string };
  if (!uit.pdf) throw new Error(uit.fout ?? "Er kwam geen voorbeeld terug.");
  const ruw = atob(uit.pdf);
  const bytes = new Uint8Array(ruw.length);
  for (let i = 0; i < ruw.length; i += 1) bytes[i] = ruw.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}
