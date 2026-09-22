/**
 * Paaltje in de app: de categorieën, zijn vaste afspraken, en wat je zelf
 * aan zijn indeling verandert.
 *
 * Dit is allemaal gewoon lezen en schrijven in de database (RLS: alleen de
 * eigenaar). Wat ook op de mailserver moet gebeuren, of wat Paaltje opnieuw
 * laat lezen, staat in `mailacties.ts`.
 */
import { supabase } from "@/integrations/supabase/client";

export type Zelfstandigheid = "niets" | "concept" | "concept_voorstel" | "zelf_doorvoeren";
export type Sleutel =
  | "klachten"
  | "nieuwe_klanten"
  | "afzeggingen"
  | "overslaan"
  | "prijsopvraging"
  | "planning"
  | "overig";

export interface MailCategorie {
  id: string;
  sleutel: Sleutel | null;
  naam: string;
  omschrijving: string;
  zelfstandigheid: Zelfstandigheid;
  /** Mag Paaltje een WhatsApp in deze categorie zelf beantwoorden? */
  zelf_antwoorden_whatsapp: boolean;
  volgorde: number;
}

/** Hoe een niveau op het scherm heet, en wat het betekent. */
export const ZELFSTANDIGHEID: Record<Zelfstandigheid, { naam: string; uitleg: string }> = {
  niets: { naam: "Alleen indelen", uitleg: "Paaltje zet de mail in deze categorie, verder niets." },
  concept: {
    naam: "Antwoord klaarzetten",
    uitleg: "Paaltje schrijft een antwoord; jij verstuurt het.",
  },
  concept_voorstel: {
    naam: "Antwoord + voorstel",
    uitleg: "Paaltje schrijft een antwoord en zet klaar wat er moet gebeuren; jij klikt.",
  },
  zelf_doorvoeren: {
    naam: "Zelf doorvoeren",
    uitleg: "Is Paaltje heel zeker, dan voert hij het zelf door. Het komt in het rapport.",
  },
};

/** Welke niveaus bij een categorie kunnen. Zelf doorvoeren kan alleen waar het veilig is. */
export function niveausVoor(c: Pick<MailCategorie, "sleutel">): Zelfstandigheid[] {
  if (c.sleutel === "overslaan") return ["niets", "concept", "concept_voorstel", "zelf_doorvoeren"];
  if (c.sleutel === "afzeggingen" || c.sleutel === "nieuwe_klanten") {
    return ["niets", "concept", "concept_voorstel"];
  }
  return ["niets", "concept"];
}

/** Tinten voor de labels: vaste categorieën een vaste kleur, eigen categorieën lopen door. */
// In Fel donker is "muted" bijna zo zwart als de ondergrond: dan een grijs
// dat je als stipje en als label nog ziet liggen.
const GEEN_TINT = "bg-muted text-muted-foreground fel:dark:bg-[#2e2c2a]";

const VASTE_TINT: Record<Sleutel, string> = {
  klachten: "bg-tint-rood text-tint-rood-ink",
  nieuwe_klanten: "bg-tint-groen text-tint-groen-ink",
  afzeggingen: "bg-tint-oranje text-tint-oranje-ink",
  overslaan: "bg-tint-blauw text-tint-blauw-ink",
  prijsopvraging: "bg-tint-amber text-tint-amber-ink",
  planning: "bg-tint-limoen text-tint-limoen-ink",
  overig: GEEN_TINT,
};

const EIGEN_TINTEN = [
  "bg-tint-paars text-tint-paars-ink",
  "bg-tint-turkoois text-tint-turkoois-ink",
  "bg-tint-roze text-tint-roze-ink",
  "bg-tint-limoen text-tint-limoen-ink",
];

export function categorieTint(c: MailCategorie, index: number): string {
  if (c.sleutel) return VASTE_TINT[c.sleutel];
  return EIGEN_TINTEN[index % EIGEN_TINTEN.length] ?? GEEN_TINT;
}

export async function fetchCategorieen(): Promise<MailCategorie[]> {
  const { data, error } = await supabase
    .from("mail_categorieen")
    .select("id,sleutel,naam,omschrijving,zelfstandigheid,zelf_antwoorden_whatsapp,volgorde")
    .is("deleted_at", null)
    .order("volgorde")
    .order("naam");
  if (error) throw error;
  return (data ?? []) as MailCategorie[];
}

export async function wijzigCategorie(
  id: string,
  patch: Partial<
    Pick<MailCategorie, "naam" | "omschrijving" | "zelfstandigheid" | "zelf_antwoorden_whatsapp">
  >,
): Promise<void> {
  const { error } = await supabase.from("mail_categorieen").update(patch).eq("id", id);
  if (error) throw error;
}

export async function nieuweCategorie(naam: string, omschrijving: string): Promise<void> {
  const { error } = await supabase.from("mail_categorieen").insert({
    naam: naam.trim(),
    omschrijving: omschrijving.trim(),
    zelfstandigheid: "niets",
    volgorde: 80,
  });
  if (error) throw error;
}

/** Wegleggen, niet wissen: de indeling van oude mail blijft bestaan. */
export async function legCategorieWeg(id: string): Promise<void> {
  const { error } = await supabase
    .from("mail_categorieen")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("sleutel", null);
  if (error) throw error;
}

/**
 * Jij weet het beter: deze mail hoort in deze categorieën. Wat Paaltje erop
 * zette gaat eraf, en Paaltje verandert het daarna niet meer.
 */
export async function zetCategorieen(berichtId: string, categorieIds: string[]): Promise<void> {
  // In één stap in de database: nooit een mail zonder categorieën halverwege,
  // en ook "geen categorie" wordt onthouden als keuze van jou.
  const { error } = await supabase.rpc("zet_bericht_categorieen", {
    bericht: berichtId,
    categorieen: categorieIds,
  });
  if (error) throw error;
}

// --- Vaste afspraken -----------------------------------------------------------

export type AfspraakStatus = "voorgesteld" | "goedgekeurd" | "afgewezen";

export interface Afspraak {
  id: string;
  tekst: string;
  status: AfspraakStatus;
  categorie_id: string | null;
  created_at: string;
}

export async function fetchAfspraken(): Promise<Afspraak[]> {
  const { data, error } = await supabase
    .from("paaltje_afspraken")
    .select("id,tekst,status,categorie_id,created_at")
    .is("deleted_at", null)
    .neq("status", "afgewezen")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Afspraak[];
}

export async function nieuweAfspraak(tekst: string, categorieId: string | null): Promise<void> {
  const { error } = await supabase
    .from("paaltje_afspraken")
    .insert({ tekst: tekst.trim(), categorie_id: categorieId, status: "goedgekeurd" });
  if (error) throw error;
}

export async function zetAfspraak(id: string, status: AfspraakStatus): Promise<void> {
  const { error } = await supabase.from("paaltje_afspraken").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function legAfspraakWeg(id: string): Promise<void> {
  const { error } = await supabase
    .from("paaltje_afspraken")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// --- Klanten -------------------------------------------------------------------

export async function klantNaam(id: string): Promise<string> {
  const { data } = await supabase.from("klanten").select("naam").eq("id", id).maybeSingle();
  return data?.naam ?? "";
}
