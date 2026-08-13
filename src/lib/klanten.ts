import { supabase } from "@/integrations/supabase/client";

export type Frequency = "elke" | "even" | "oneven";

export interface Street {
  id: string;
  name: string;
  sort_order: number;
}

export interface Customer {
  id: string;
  street_id: string;
  house_number: number;
  addition: string;
  note: string;
  price: number;
  frequency: Frequency;
}

export const frequencyLabels: Record<Frequency, string> = {
  elke: "Elke maand",
  even: "Even maand",
  oneven: "Oneven maand",
};

export const veelgebruikteNotities = ["H", "HD", "balkon", "achter", "kozijnen"];

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
    .select("id,street_id,house_number,addition,note,price,frequency")
    .order("house_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({ ...c, price: Number(c.price) })) as Customer[];
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

/** Splits klanten in even en oneven huisnummers, elk oplopend gesorteerd. */
export function splitEvenOdd(customers: Customer[]) {
  const sorted = [...customers].sort(
    (a, b) => a.house_number - b.house_number || a.addition.localeCompare(b.addition),
  );
  return {
    even: sorted.filter((c) => c.house_number % 2 === 0),
    oneven: sorted.filter((c) => c.house_number % 2 !== 0),
  };
}
