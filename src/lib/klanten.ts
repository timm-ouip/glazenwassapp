import { supabase } from "@/integrations/supabase/client";

export type Frequency = "elke" | "even" | "oneven";

export interface District {
  id: string;
  name: string;
  sort_order: number;
}

export interface Street {
  id: string;
  name: string;
  sort_order: number;
  district_id: string;
}

export interface Customer {
  id: string;
  street_id: string;
  house_number: number;
  addition: string;
  note: string;
  price: number;
  frequency: Frequency;
  sort_order: number;
}

export interface QuickNote {
  id: string;
  label: string;
  sort_order: number;
}

export const frequencyLabels: Record<Frequency, string> = {
  elke: "Elke maand",
  even: "Even maand",
  oneven: "Oneven maand",
};

export async function fetchStreets(): Promise<Street[]> {
  const { data, error } = await supabase
    .from("streets")
    .select("id,name,sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Street[];
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id,street_id,house_number,addition,note,price,frequency,sort_order")
    .order("sort_order", { ascending: true })
    .order("house_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, price: Number(c.price) })) as Customer[];
}

export async function fetchQuickNotes(): Promise<QuickNote[]> {
  const { data, error } = await supabase
    .from("quick_notes")
    .select("id,label,sort_order")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []) as QuickNote[];
}

export async function addQuickNote(label: string) {
  const { error } = await supabase.from("quick_notes").insert({ label: label.trim(), sort_order: 100 });
  if (error) throw error;
}

/** Notities zijn komma-gescheiden losse labels. */
export function noteTokens(note: string): string[] {
  return note
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function toggleNoteToken(note: string, token: string): string {
  const tokens = noteTokens(note);
  const i = tokens.findIndex((t) => t.toLowerCase() === token.toLowerCase());
  if (i >= 0) tokens.splice(i, 1);
  else tokens.push(token);
  return tokens.join(", ");
}

export function matchesMaand(freq: Frequency, filter: "alles" | "even" | "oneven") {
  if (filter === "alles") return true;
  return freq === "elke" || freq === filter;
}

export function formatNumber(c: Customer) {
  return `${c.house_number}${c.addition ?? ""}`;
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
}

export function sortCustomers(customers: Customer[]) {
  return [...customers].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.house_number - b.house_number ||
      (a.addition ?? "").localeCompare(b.addition ?? ""),
  );
}

/** Splits klanten in even en oneven huisnummers, elk in de ingestelde volgorde. */
export function splitEvenOdd(customers: Customer[]) {
  const sorted = sortCustomers(customers);
  return {
    even: sorted.filter((c) => c.house_number % 2 === 0),
    oneven: sorted.filter((c) => c.house_number % 2 !== 0),
  };
}

export async function persistCustomerOrder(items: { id: string; street_id: string; sort_order: number }[]) {
  await Promise.all(
    items.map((i) =>
      supabase.from("customers").update({ street_id: i.street_id, sort_order: i.sort_order }).eq("id", i.id),
    ),
  );
}

export async function persistStreetOrder(streets: Street[]) {
  await Promise.all(
    streets.map((s, i) => supabase.from("streets").update({ sort_order: i + 1 }).eq("id", s.id)),
  );
}
