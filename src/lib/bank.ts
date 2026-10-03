/**
 * Bijschrijvingen van de bank bij de facturen.
 *
 * Het bestand lezen gebeurt in bankbestand.ts; hier staat hoe de app het
 * resultaat aan de database geeft en weer opvraagt. Wat de database er zelf
 * mee doet (vanzelf koppelen op factuurnummer of een bekende rekening) staat
 * in de migratie bank_inlezen.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { BankBestand } from "@/lib/bankbestand";

export type BankStatus = "open" | "gekoppeld" | "genegeerd";

export interface BankTransactie {
  id: string;
  datum: string;
  bedrag: number;
  tegen_iban: string;
  tegen_naam: string;
  omschrijving: string;
  kenmerk: string;
  status: BankStatus;
  door_app: boolean;
  reden: string;
  voorstel: string[];
  afgehandeld_op: string | null;
  /** Op welke facturen hij geboekt is, met het deel per factuur. */
  koppelingen: { factuur_id: string; bedrag: number }[];
}

export interface BankUitkomst {
  nieuw: number;
  al_bekend: number;
  gekoppeld: number;
  genegeerd: number;
  te_controleren: number;
}

const VELDEN =
  "id,datum,bedrag,tegen_iban,tegen_naam,omschrijving,kenmerk,status,door_app,reden,voorstel,afgehandeld_op";

type Rij = Omit<BankTransactie, "koppelingen">;

async function metKoppelingen(rijen: Rij[]): Promise<BankTransactie[]> {
  const ids = rijen.filter((r) => r.status === "gekoppeld").map((r) => r.id);
  const per = new Map<string, { factuur_id: string; bedrag: number }[]>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("bank_koppelingen")
      .select("transactie_id,factuur_id,bedrag")
      .in("transactie_id", ids);
    if (error) throw error;
    for (const k of data ?? []) {
      const lijst = per.get(k.transactie_id) ?? [];
      lijst.push({ factuur_id: k.factuur_id, bedrag: Number(k.bedrag) });
      per.set(k.transactie_id, lijst);
    }
  }
  return rijen.map((r) => ({
    ...r,
    bedrag: Number(r.bedrag),
    voorstel: r.voorstel ?? [],
    koppelingen: per.get(r.id) ?? [],
  }));
}

/** Wat nog op een mens wacht, nieuwste eerst. */
export async function fetchBankOpen(): Promise<BankTransactie[]> {
  const { data, error } = await supabase
    .from("bank_transacties")
    .select(VELDEN)
    .eq("status", "open")
    .order("datum", { ascending: false })
    .limit(500);
  if (error) throw error;
  return metKoppelingen((data ?? []) as Rij[]);
}

/** Hoeveel er op een mens wacht, voor het vakje boven de facturen. */
export async function fetchBankOpenAantal(): Promise<number> {
  const { count, error } = await supabase
    .from("bank_transacties")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

/** Wat het laatst verwerkt is, vanzelf of met de hand: om na te kijken. */
export async function fetchBankVerwerkt(): Promise<BankTransactie[]> {
  const { data, error } = await supabase
    .from("bank_transacties")
    .select(VELDEN)
    .neq("status", "open")
    .order("afgehandeld_op", { ascending: false })
    .limit(40);
  if (error) throw error;
  return metKoppelingen((data ?? []) as Rij[]);
}

/** De bijschrijvingen uit een gelezen bestand naar de database. */
export async function bankInlezen(bestand: BankBestand, naam: string): Promise<BankUitkomst> {
  const { data, error } = await supabase.rpc("bank_inlezen", {
    bron: bestand.bron,
    bestand: naam,
    regels: bestand.regels as unknown as Json,
  });
  if (error) throw error;
  const u = (data ?? {}) as Partial<BankUitkomst>;
  return {
    nieuw: Number(u.nieuw ?? 0),
    al_bekend: Number(u.al_bekend ?? 0),
    gekoppeld: Number(u.gekoppeld ?? 0),
    genegeerd: Number(u.genegeerd ?? 0),
    te_controleren: Number(u.te_controleren ?? 0),
  };
}

/** Met de hand boeken op één of meer facturen. De rest gaat op de laatste. */
export async function bankKoppelen(transactie: string, facturen: string[]) {
  const { error } = await supabase.rpc("bank_koppelen", { transactie, facturen });
  if (error) throw error;
}

/** Geen betaling voor een factuur. */
export async function bankNegeren(transactie: string) {
  const { error } = await supabase.rpc("bank_negeren", { transactie });
  if (error) throw error;
}

/** Een koppeling of negeren ongedaan maken: hij komt weer op het lijstje. */
export async function bankTerugzetten(transactie: string) {
  const { error } = await supabase.rpc("bank_terugzetten", { transactie });
  if (error) throw error;
}
