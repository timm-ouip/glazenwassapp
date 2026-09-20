import { supabase } from "@/integrations/supabase/client";

/**
 * De vaste teksten voor berichten aan klanten.
 *
 * Drie soorten: de aankondiging ("morgen komen wij"), een wijziging in de
 * planning, en "we zijn niet aan uw adres toegekomen". Per soort kun je er
 * meerdere maken; eentje is de standaard, en daarmee begint het opstellen.
 *
 * Plaatshouders vult de server in bij het versturen:
 *   {{naam}} {{adres}} {{datum}} {{nieuwe datum}} {{reden}} {{tijdvak}}
 */
export type SjabloonSoort = "aankondiging" | "wijziging" | "niet_af";

export const SOORT_LABEL: Record<SjabloonSoort, string> = {
  aankondiging: "Aankondiging",
  wijziging: "Wijziging in de planning",
  niet_af: "Niet af gekomen",
};

export const PLAATSHOUDERS: { sleutel: string; uitleg: string }[] = [
  { sleutel: "{{naam}}", uitleg: "de naam van de klant" },
  { sleutel: "{{adres}}", uitleg: "zijn adres(sen) van die dag" },
  { sleutel: "{{datum}}", uitleg: "de dag waar het over gaat" },
  { sleutel: "{{nieuwe datum}}", uitleg: "de nieuwe dag, bij een wijziging" },
  { sleutel: "{{reden}}", uitleg: "waarom het verandert" },
  { sleutel: "{{tijdvak}}", uitleg: "het beloofde tijdvak, bij grote panden" },
];

export interface Sjabloon {
  id: string;
  soort: SjabloonSoort;
  naam: string;
  onderwerp: string;
  tekst: string;
  wa_sjabloon_id: string | null;
  standaard: boolean;
  sort_order: number;
}

export async function fetchSjablonen(): Promise<Sjabloon[]> {
  const { data, error } = await supabase
    .from("bericht_sjablonen")
    .select("id,soort,naam,onderwerp,tekst,wa_sjabloon_id,standaard,sort_order")
    .is("deleted_at", null)
    .order("soort", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Sjabloon[];
}

/** Het sjabloon waarmee je begint; zonder standaard het eerste van die soort. */
export function standaardVan(sjablonen: Sjabloon[], soort: SjabloonSoort): Sjabloon | null {
  const van = sjablonen.filter((s) => s.soort === soort);
  return van.find((s) => s.standaard) ?? van[0] ?? null;
}

export async function bewaarSjabloon(
  s: Partial<Sjabloon> & { soort: SjabloonSoort; naam: string; tekst: string },
): Promise<string> {
  const rij = {
    soort: s.soort,
    naam: s.naam.trim(),
    onderwerp: (s.onderwerp ?? "").trim(),
    tekst: s.tekst,
    wa_sjabloon_id: s.wa_sjabloon_id ?? null,
    sort_order: s.sort_order ?? 0,
  };
  if (s.id) {
    const { error } = await supabase.from("bericht_sjablonen").update(rij).eq("id", s.id);
    if (error) throw error;
    return s.id;
  }
  const { data, error } = await supabase
    .from("bericht_sjablonen")
    .insert(rij)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Eén standaard per soort: de oude gaat uit voor de nieuwe aangaat. */
export async function maakStandaard(id: string, soort: SjabloonSoort) {
  const uit = await supabase
    .from("bericht_sjablonen")
    .update({ standaard: false })
    .eq("soort", soort)
    .eq("standaard", true);
  if (uit.error) throw uit.error;
  const { error } = await supabase
    .from("bericht_sjablonen")
    .update({ standaard: true })
    .eq("id", id);
  if (error) throw error;
}

/** Weghalen is wegleggen; verstuurde berichten blijven kloppen. */
export async function legSjabloonWeg(id: string) {
  const { error } = await supabase
    .from("bericht_sjablonen")
    .update({ deleted_at: new Date().toISOString(), standaard: false })
    .eq("id", id);
  if (error) throw error;
}

export interface Reden {
  id: string;
  tekst: string;
  sort_order: number;
}

export async function fetchRedenen(): Promise<Reden[]> {
  const { data, error } = await supabase
    .from("snelle_redenen")
    .select("id,tekst,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function maakReden(tekst: string, sortOrder: number) {
  const { error } = await supabase
    .from("snelle_redenen")
    .insert({ tekst: tekst.trim(), sort_order: sortOrder });
  if (error) throw error;
}

export async function wisReden(id: string) {
  const { error } = await supabase.from("snelle_redenen").delete().eq("id", id);
  if (error) throw error;
}

/** Een voorbeeld van hoe het bericht eruitziet, met verzonnen gegevens. */
export function vulInVoorbeeld(tekst: string): string {
  return tekst
    .replaceAll("{{naam}}", "mevrouw Jansen")
    .replaceAll("{{adres}}", "Markgraaf 12")
    .replaceAll("{{datum}}", "dinsdag 7 oktober")
    .replaceAll("{{nieuwe datum}}", "donderdag 9 oktober")
    .replaceAll("{{reden}}", "Door de regen")
    .replaceAll("{{tijdvak}}", "We komen tussen 10:00 en 12:00.")
    .replace(/[ \t]{2,}/g, " ");
}
