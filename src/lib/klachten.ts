/**
 * Klachten: een eigen regel bij de persoon, met optioneel het adres waar hij
 * over gaat. Paaltje maakt ze uit mail; een mens voert ze zelf in na een
 * telefoontje, aan de deur of via een appje.
 *
 * Weggooien is wegleggen (deleted_at). Een klacht die Paaltje maakte en die
 * niet klopt, gaat zo met Ongedaan maken naar de prullenbak.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type KlachtBron = "mail" | "telefoon" | "deur" | "app" | "anders";
export type KlachtStatus = "open" | "afgehandeld";

export const BRON_LABEL: Record<KlachtBron, string> = {
  mail: "Mail",
  telefoon: "Telefoon",
  deur: "Aan de deur",
  app: "Appje",
  anders: "Anders",
};

export interface Klacht {
  id: string;
  klant_id: string;
  customer_id: string | null;
  omschrijving: string;
  bron: KlachtBron;
  ontvangen_op: string;
  status: KlachtStatus;
  afgehandeld_op: string | null;
  door_paaltje: boolean;
  /** De mails die bij deze klacht horen. */
  bericht_ids: string[];
}

const KOLOMMEN =
  "id,klant_id,customer_id,omschrijving,bron,ontvangen_op,status,afgehandeld_op,door_paaltje,klacht_berichten(bericht_id)";

type Rij = Omit<Klacht, "bericht_ids"> & { klacht_berichten: { bericht_id: string }[] | null };

function alsKlacht(r: Rij): Klacht {
  const { klacht_berichten, ...rest } = r;
  return { ...rest, bericht_ids: (klacht_berichten ?? []).map((k) => k.bericht_id) };
}

/** Alle klachten van één klant: open bovenaan, daarbinnen nieuwste eerst. */
export async function fetchKlachtenVanKlant(klantId: string): Promise<Klacht[]> {
  const { data, error } = await supabase
    .from("klachten")
    .select(KOLOMMEN)
    .eq("klant_id", klantId)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const lijst = ((data ?? []) as unknown as Rij[]).map(alsKlacht);
  return [...lijst.filter((k) => k.status === "open"), ...lijst.filter((k) => k.status !== "open")];
}

/** Een open klacht op de planning: bij welke klant, en eventueel welk adres. */
export interface OpenKlacht {
  id: string;
  klant_id: string;
  customer_id: string | null;
  omschrijving: string;
}

/** Alle open klachten van het bedrijf, voor het rode stipje op de planning. */
export async function fetchOpenKlachten(): Promise<OpenKlacht[]> {
  const uit: OpenKlacht[] = [];
  for (let vanaf = 0; ; vanaf += 1000) {
    const { data, error } = await supabase
      .from("klachten")
      .select("id,klant_id,customer_id,omschrijving")
      .eq("status", "open")
      .is("deleted_at", null)
      .order("id")
      .range(vanaf, vanaf + 999);
    if (error) throw new Error(error.message);
    uit.push(...((data ?? []) as OpenKlacht[]));
    if ((data ?? []).length < 1000) return uit;
  }
}

/**
 * Open klachten bij een adres: die met precies dit adres, en die van de klant
 * waar nog geen adres bij gekozen is (die gelden voor al zijn adressen).
 */
export function useKlachtenBijAdres(): (adres: { id: string; klant_id: string | null }) => OpenKlacht[] {
  const { data } = useQuery({ queryKey: ["open-klachten"], queryFn: fetchOpenKlachten });
  return useMemo(() => {
    const perAdres = new Map<string, OpenKlacht[]>();
    const perKlant = new Map<string, OpenKlacht[]>();
    for (const k of data ?? []) {
      const [map, sleutel] = k.customer_id ? [perAdres, k.customer_id] : [perKlant, k.klant_id];
      map.set(sleutel, [...(map.get(sleutel) ?? []), k]);
    }
    return (adres) => [
      // Verhuisd: het adres hoort nu bij een ander, dan geldt de klacht hier niet meer.
      ...(perAdres.get(adres.id) ?? []).filter((k) => k.klant_id === adres.klant_id),
      ...(adres.klant_id ? (perKlant.get(adres.klant_id) ?? []) : []),
    ];
  }, [data]);
}

export async function nieuweKlacht(k: {
  klant_id: string;
  customer_id: string | null;
  omschrijving: string;
  bron: KlachtBron;
  ontvangen_op: string;
}): Promise<void> {
  const { error } = await supabase.from("klachten").insert(k);
  if (error) throw new Error(error.message);
}

export async function zetKlachtStatus(id: string, status: KlachtStatus): Promise<void> {
  const { error } = await supabase.from("klachten").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function zetKlachtAdres(id: string, customerId: string | null): Promise<void> {
  const { error } = await supabase
    .from("klachten")
    .update({ customer_id: customerId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Wegleggen (prullenbak) of terugzetten. */
export async function legKlachtWeg(id: string, weg: boolean): Promise<void> {
  const { error } = await supabase
    .from("klachten")
    .update({ deleted_at: weg ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
