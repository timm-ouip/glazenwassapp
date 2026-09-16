/**
 * Paaltje als assistent: het gesprek, en zijn voorstellen om iets in de
 * database te wijzigen.
 *
 * Paaltje schrijft zelf nooit iets — hij zet een voorstel klaar. Wie het
 * recht heeft drukt op Doorvoeren; wie dat niet heeft stuurt het als
 * aanvraag naar iemand die het wél mag. Alles loopt via de Edge Function
 * `paaltje-chat`, net als `mailacties.ts` dat voor mail doet.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import { formatPrice, toonMaand } from "@/lib/klanten";
import { datumSleutel, vandaag } from "@/lib/wasdag";

export type Veld =
  | "notitie"
  | "prijs"
  | "frequentie"
  | "overslaan"
  | "wassen_vanaf"
  | "klant_naam"
  | "klant_email"
  | "klant_email2"
  | "klant_telefoon"
  | "klant_telefoon2";

/** Eén regel van een voorstel: één veld van één adres, oud en nieuw. */
export interface Regel {
  id: string;
  customer_id: string;
  klant_id: string | null;
  adres: string;
  klant: string;
  veld: Veld;
  oud: unknown | null;
  oud_verborgen?: boolean;
  nieuw: unknown;
  aan: boolean;
  let_op?: string;
  /** Alleen bij een doorgevoerde regel: de echte waarde vlak vóór het
   *  schrijven, waar Ongedaan maken naar terugzet. */
  voor?: unknown;
  /** Alleen bij een doorgevoerde overslaan-regel: `{ overslaan, start_maand }`
   *  ná het schrijven. Puur informatief voor de server; het scherm toont dit
   *  nergens en negeert het gewoon. */
  na?: unknown;
}

/**
 * Wat je terugstuurt bij `doorvoeren`/`aanvragen`: altijd `id` en `aan`, de
 * rest alleen als je het ook echt aanpast. Vooral bij een prijsregel die je
 * niet aanraakt mag je geen `nieuw: null` sturen — dat weigert de server;
 * dan laat je `nieuw` gewoon weg.
 */
export type RegelPatch = Pick<Regel, "id" | "aan"> & Partial<Omit<Regel, "id" | "aan">>;

export type VoorstelStatus =
  "open" | "te_keuren" | "doorgevoerd" | "afgewezen" | "geannuleerd" | "teruggedraaid";

export interface Voorstel {
  id: string;
  company_id: string;
  aangevraagd_door: string | null;
  status: VoorstelStatus;
  samenvatting: string;
  gevraagd: Regel[];
  doorgevoerd: Regel[] | null;
  aangepast_door_keurder: boolean;
  afgehandeld_door: string | null;
  afgehandeld_op: string | null;
  reden: string;
  teruggedraaid_door: string | null;
  teruggedraaid_op: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatBericht {
  id: string;
  rol: "gebruiker" | "paaltje";
  tekst: string;
  voorstel_id: string | null;
  created_at: string;
}

/** Het bedrijf heeft voor vandaag genoeg berichten gehad. */
export class DaglimietFout extends Error {}

/** Sinds het voorstel klaargezet is, is een van de waarden alweer veranderd. */
export class VoorstelVerouderdFout extends Error {
  verouderd: { regel_id: string; nu: unknown }[];
  constructor(bericht: string, verouderd: { regel_id: string; nu: unknown }[]) {
    super(bericht);
    this.verouderd = verouderd;
  }
}

async function roep<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("paaltje-chat", { body });
  if (error) {
    const res = (error as { context?: Response })?.context;
    let uitleg: {
      fout?: string;
      limiet?: boolean;
      verouderd?: { regel_id: string; nu: unknown }[];
    } = {};
    if (res && typeof res.text === "function") {
      try {
        uitleg = JSON.parse(await res.text()) as typeof uitleg;
      } catch {
        // geen uitleg meegestuurd
      }
    }
    if (res?.status === 429 || uitleg.limiet) {
      throw new DaglimietFout(
        uitleg.fout ||
          "Paaltje heeft voor vandaag genoeg berichten beantwoord. Morgen weer verder.",
      );
    }
    if (res?.status === 409 && uitleg.verouderd) {
      throw new VoorstelVerouderdFout(
        uitleg.fout || "Dit voorstel is intussen veranderd.",
        uitleg.verouderd,
      );
    }
    throw new Error(uitleg.fout || error.message);
  }
  const uit = data as { fout?: string } & T;
  if (uit?.fout) throw new Error(uit.fout);
  return uit;
}

export function stuur(
  tekst: string,
): Promise<{ antwoord: ChatBericht; voorstel: Voorstel | null }> {
  return roep({ actie: "stuur", tekst });
}

export function doorvoeren(
  voorstelId: string,
  regels?: RegelPatch[],
  ondanksWijziging?: boolean,
): Promise<{ voorstel: Voorstel }> {
  return roep({
    actie: "doorvoeren",
    voorstel_id: voorstelId,
    ...(regels ? { regels } : {}),
    ...(ondanksWijziging ? { ondanks_wijziging: true } : {}),
  });
}

export function aanvragen(
  voorstelId: string,
  regels?: RegelPatch[],
): Promise<{ voorstel: Voorstel }> {
  return roep({ actie: "aanvragen", voorstel_id: voorstelId, ...(regels ? { regels } : {}) });
}

export function afwijzen(voorstelId: string, reden?: string): Promise<{ voorstel: Voorstel }> {
  return roep({
    actie: "afwijzen",
    voorstel_id: voorstelId,
    ...(reden?.trim() ? { reden: reden.trim() } : {}),
  });
}

export function annuleren(voorstelId: string): Promise<{ voorstel: Voorstel }> {
  return roep({ actie: "annuleren", voorstel_id: voorstelId });
}

export function terugdraaien(
  voorstelId: string,
): Promise<{ voorstel: Voorstel; overgeslagen: { regel_id: string; reden: string }[] }> {
  return roep({ actie: "terugdraaien", voorstel_id: voorstelId });
}

export function wisGesprek(): Promise<{ ok: true }> {
  return roep({ actie: "wis_gesprek" });
}

// --- Lezen -----------------------------------------------------------------

/** Het eigen gesprek met Paaltje, de laatste drie dagen, oud naar nieuw.
 *  `enabled` is er om pas te lezen zodra het paneel echt open is. */
export function useGesprek(enabled = true) {
  const { employee } = useAuth();
  return useQuery({
    queryKey: ["paaltje-gesprek", employee?.id],
    queryFn: async (): Promise<ChatBericht[]> => {
      const sinds = new Date();
      sinds.setDate(sinds.getDate() - 3);
      const { data, error } = await supabase
        .from("paaltje_berichten")
        .select("id,rol,tekst,voorstel_id,created_at")
        .gte("created_at", sinds.toISOString())
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatBericht[];
    },
    enabled: enabled && !!employee,
  });
}

/**
 * Voorstellen lezen kan niet rechtstreeks uit de tabel — daar staan prijzen
 * in, dus dat gaat via de Edge Function, die per lezer bepaalt wat hij mag
 * zien. Zonder `prijzen_zien` komen `oud`, `voor` en `nieuw` van een
 * prijsregel als `null` terug met `oud_verborgen: true`; de vrager ziet zijn
 * eigen gevraagde prijs wel (`nieuw` in `gevraagd`).
 */
function leesVoorstellen(
  params: { ids?: string[]; te_keuren?: boolean } = {},
): Promise<{ voorstellen: Voorstel[]; namen: Record<string, string> }> {
  return roep({ actie: "lees_voorstellen", ...params });
}

/** Eén of meer voorstellen, geïndexeerd op hun id, met de namen erbij
 *  (aangevraagd_door, afgehandeld_door, teruggedraaid_door). `enabled` gaat
 *  uit als het paneel dicht is: dan hoeft er niets gelezen te worden. */
export function useVoorstellen(ids: string[], enabled = true) {
  // De 50 nieuwste (ids komen in gespreksvolgorde), pas daarna sorteren voor de sleutel.
  const unieke = [...new Set(ids)].filter(Boolean).slice(-50).sort();
  return useQuery({
    queryKey: ["paaltje-voorstellen", unieke],
    queryFn: async (): Promise<{
      bij: Record<string, Voorstel>;
      namen: Record<string, string>;
    }> => {
      if (unieke.length === 0) return { bij: {}, namen: {} };
      const { voorstellen, namen } = await leesVoorstellen({ ids: unieke.slice(0, 50) });
      const bij: Record<string, Voorstel> = {};
      for (const v of voorstellen) bij[v.id] = v;
      return { bij, namen };
    },
    enabled: enabled && unieke.length > 0,
  });
}

/** De voorstellen die op jouw goedkeuring wachten, met de naam van wie erom
 *  vroeg erbij. Alleen zichtbaar met het recht om klanten te bewerken. */
export function useTeKeuren(enabled = true) {
  const { employee } = useAuth();
  const magKeuren = useRecht("klanten_bewerken");
  return useQuery({
    queryKey: ["paaltje-te-keuren", employee?.company_id],
    queryFn: () => leesVoorstellen({ te_keuren: true }),
    enabled: enabled && magKeuren,
    refetchInterval: 60_000,
  });
}

/** Alleen het aantal, voor het bolletje op de knop — blijft pollen ook als
 *  het paneel dicht is, zodat de teller altijd klopt. */
export function useTeKeurenAantal() {
  const { employee } = useAuth();
  const magKeuren = useRecht("klanten_bewerken");
  return useQuery({
    queryKey: ["paaltje-te-keuren-aantal", employee?.company_id],
    queryFn: async () => (await roep<{ aantal: number }>({ actie: "te_keuren_aantal" })).aantal,
    enabled: magKeuren,
    refetchInterval: 60_000,
  });
}

// --- Labels en weergave ------------------------------------------------------

export const VELD_LABEL: Record<Veld, string> = {
  notitie: "Notitie",
  prijs: "Prijs",
  frequentie: "Frequentie",
  overslaan: "Overslaan",
  wassen_vanaf: "Wassen vanaf",
  klant_naam: "Naam",
  klant_email: "E-mail",
  klant_email2: "E-mail 2",
  klant_telefoon: "Telefoon",
  klant_telefoon2: "Telefoon 2",
};

/** "elke maand" / "even maanden" / "oneven maanden" / "om de 3 maanden". */
export function frequentieTekst(waarde: unknown): string {
  const f = waarde as { interval_maanden?: number; ritme?: number } | null;
  if (!f || typeof f.interval_maanden !== "number") return "";
  const interval = f.interval_maanden;
  const ritme = f.ritme ?? 1;
  if (interval <= 1) return "elke maand";
  if (interval === 2) return ritme % 2 === 0 ? "even maanden" : "oneven maanden";
  return `om de ${interval} maanden`;
}

/** "december 2026" — een maandsleutel ("jjjj-mm") met het jaar erbij, zodat
 *  een startmaand of een overgeslagen maand niet ieder jaar hetzelfde leest. */
export function maandMetJaar(sleutel: string): string {
  const jaar = sleutel.split("-")[0];
  const naam = toonMaand(sleutel);
  return jaar ? `${naam} ${jaar}` : naam;
}

export function overslaanTekst(waarde: unknown): string {
  const maanden = Array.isArray(waarde) ? (waarde as string[]) : [];
  if (maanden.length === 0) return "geen";
  return maanden.map(maandMetJaar).join(", ");
}

/** Lege startmaand: het adres doet gewoon meteen mee, geen "vanaf …" ervoor. */
export const GEEN_STARTMAAND = "geen startmaand (doet meteen mee)";

/** De waarde van een regel als leestekst, voor "oud → nieuw". */
export function regelWaarde(veld: Veld, waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "leeg";
  switch (veld) {
    case "prijs":
      return typeof waarde === "number" ? formatPrice(waarde) : String(waarde);
    case "frequentie":
      return frequentieTekst(waarde) || "onbekend";
    case "overslaan":
      return overslaanTekst(waarde);
    case "wassen_vanaf":
      return typeof waarde === "string" && waarde.trim() ? maandMetJaar(waarde) : GEEN_STARTMAAND;
    default: {
      const tekst = String(waarde).trim();
      return tekst || "leeg";
    }
  }
}

/** Heb je de rechten die dit veld vraagt? Prijs vraagt er twee, de rest één. */
export function magRegel(
  veld: Veld,
  heeftKlantenBewerken: boolean,
  heeftPrijzenZien: boolean,
): boolean {
  if (veld === "prijs") return heeftKlantenBewerken && heeftPrijzenZien;
  return heeftKlantenBewerken;
}

// --- Instellingen: daglimiet en verbruik ------------------------------------

export async function fetchPaaltjeDaglimiet(companyId: string): Promise<number> {
  const { data, error } = await supabase
    .from("companies")
    .select("paaltje_daglimiet")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data?.paaltje_daglimiet ?? 200;
}

export async function bewaarPaaltjeDaglimiet(companyId: string, daglimiet: number): Promise<void> {
  const { error } = await supabase
    .from("companies")
    .update({ paaltje_daglimiet: Math.round(daglimiet) })
    .eq("id", companyId);
  if (error) throw error;
}

export interface PaaltjeVerbruikDag {
  dag: string;
  berichten: number;
  invoer_tokens: number;
  uitvoer_tokens: number;
}

/**
 * Het verbruik van de laatste `dagen` dagen, nieuwste eerst. Alleen de
 * eigenaar mag dit lezen (RLS).
 *
 * De server telt per dag in Europe/Amsterdam (zie `paaltje_verbruik_tellen`),
 * dus "vandaag" moet hier ook die dag zijn — vandaar `vandaag()`/`datumSleutel()`
 * uit `wasdag.ts` en niet `toISOString()`, die in UTC rekent en 's avonds al
 * op de volgende dag uitkomt.
 */
export async function fetchPaaltjeVerbruik(dagen = 7): Promise<PaaltjeVerbruikDag[]> {
  const nu = new Date();
  const vanaf = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - (dagen - 1));
  const { data, error } = await supabase
    .from("paaltje_verbruik")
    .select("dag,berichten,invoer_tokens,uitvoer_tokens")
    .gte("dag", datumSleutel(vanaf))
    .order("dag", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PaaltjeVerbruikDag[];
}

/** Van vandaag alleen, of nul als er nog niets was. */
export function verbruikVandaag(rijen: PaaltjeVerbruikDag[]): PaaltjeVerbruikDag {
  const dag = vandaag();
  return (
    rijen.find((r) => r.dag === dag) ?? { dag, berichten: 0, invoer_tokens: 0, uitvoer_tokens: 0 }
  );
}
