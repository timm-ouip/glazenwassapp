import { supabase } from "@/integrations/supabase/client";

export type Frequency = "elke" | "even" | "oneven";

export interface District {
  id: string;
  name: string;
  sort_order: number;
  /** Woonplaats van de wijk. Een wijknaam zegt daar niets over: "Madestein"
   *  ligt in 's-Gravenhage. Zonder plaats is geen postcode op te zoeken. */
  plaats: string;
}

export interface Street {
  id: string;
  name: string;
  /** Officiële straatnaam, als `name` een werknaam is: "Ameland" is
   *  Amelandstraat. Mag leeg zijn — niet elke regel is een echte straat. */
  volledige_naam: string;
  sort_order: number;
  district_id: string;
  sort_desc: boolean;
  kolom_start: boolean;
  print_col: number | null;
  print_row: number | null;
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
  /** De persoon achter dit adres, als die bekend is. Zie {@link Klant}. */
  klant_id: string | null;
  /** Hoort bij het pand, niet bij de bewoner — en staat er dus ook als we
   *  nog niet weten wie er woont. */
  postcode: string;
}

/**
 * De persoon achter een of meer adressen. Een `Customer` is een adres-regel
 * op de wijklijst; een `Klant` is degene die we bellen of mailen.
 */
export interface Klant {
  id: string;
  naam: string;
  email: string;
  telefoon: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  plaats: string;
  notitie: string;
}

/** De velden die je in de klantendialog invult — id en company_id niet. */
export type KlantVelden = Omit<Klant, "id">;

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

export async function fetchDistricts(): Promise<District[]> {
  const { data, error } = await supabase
    .from("districts")
    .select("id,name,sort_order,plaats")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  // plaats kan null zijn bij rijen van vóór de migratie; de rest van de app
  // gaat uit van een string.
  return (data ?? []).map((d) => ({ ...d, plaats: d.plaats ?? "" })) as District[];
}

export async function addDistrict(name: string, plaats = ""): Promise<District> {
  const { data, error } = await supabase
    .from("districts")
    .insert({ name: name.trim(), plaats: plaats.trim(), sort_order: 100 })
    .select("id,name,sort_order,plaats")
    .single();
  if (error) throw error;
  return data as District;
}

export async function renameDistrict(id: string, name: string, plaats = "") {
  const { error } = await supabase
    .from("districts")
    .update({ name: name.trim(), plaats: plaats.trim() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Verwijderen is wegleggen: de rij krijgt een stempel en verdwijnt uit de
 * lijsten, maar blijft in de database staan. Terughalen kan via de
 * prullenbak, of meteen met de ongedaan-knop.
 */
export async function legWeg(
  tabel: "districts" | "streets" | "customers" | "klanten",
  ids: string[],
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from(tabel)
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function haalTerug(
  tabel: "districts" | "streets" | "customers" | "klanten",
  ids: string[],
) {
  if (ids.length === 0) return;
  const { error } = await supabase.from(tabel).update({ deleted_at: null }).in("id", ids);
  if (error) throw error;
}

/** Definitief weg — alleen vanuit de prullenbak, en onomkeerbaar. */
export async function gooiEchtWeg(
  tabel: "districts" | "streets" | "customers" | "klanten",
  ids: string[],
) {
  if (ids.length === 0) return;
  const { error } = await supabase.from(tabel).delete().in("id", ids);
  if (error) throw error;
}

export async function deleteDistrict(id: string) {
  await legWeg("districts", [id]);
}

export async function fetchStreets(): Promise<Street[]> {
  const { data, error } = await supabase
    .from("streets")
    .select("id,name,volledige_naam,sort_order,district_id,sort_desc,kolom_start,print_col,print_row")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((s) => ({ ...s, volledige_naam: s.volledige_naam ?? "" })) as Street[];
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id,street_id,house_number,addition,note,price,frequency,sort_order,klant_id,postcode")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("house_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    ...c,
    price: Number(c.price),
    postcode: c.postcode ?? "",
  })) as Customer[];
}

const KLANT_VELDEN = "id,naam,email,telefoon,straat,huisnummer,postcode,plaats,notitie";

export async function fetchKlanten(): Promise<Klant[]> {
  const { data, error } = await supabase
    .from("klanten")
    .select(KLANT_VELDEN)
    .is("deleted_at", null)
    .order("naam", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Klant[];
}

/** Nieuwe klant bij `id === null`, anders bijwerken. Geeft de rij terug. */
export async function bewaarKlant(id: string | null, velden: KlantVelden): Promise<Klant> {
  const payload = {
    naam: velden.naam.trim(),
    email: velden.email.trim(),
    telefoon: velden.telefoon.trim(),
    straat: velden.straat.trim(),
    huisnummer: velden.huisnummer.trim(),
    postcode: velden.postcode.trim(),
    plaats: velden.plaats.trim(),
    notitie: velden.notitie.trim(),
  };
  const query = id
    ? supabase.from("klanten").update(payload).eq("id", id)
    : supabase.from("klanten").insert(payload);
  const { data, error } = await query.select(KLANT_VELDEN).single();
  if (error) throw error;
  return data as Klant;
}

/** Eén of enkele velden bijwerken — wat de klantenlijst doet bij inline typen. */
export async function updateKlant(id: string, patch: Partial<KlantVelden>): Promise<void> {
  const schoon: Partial<KlantVelden> = {};
  for (const veld of Object.keys(patch) as (keyof KlantVelden)[]) {
    schoon[veld] = (patch[veld] ?? "").trim();
  }
  const { error } = await supabase.from("klanten").update(schoon).eq("id", id);
  if (error) throw error;
}

export async function deleteKlant(id: string) {
  await legWeg("klanten", [id]);
}

/** De gegevens van het pand zelf: wat het kost, hoe vaak en wat erbij hoort. */
export type PandVelden = Pick<Customer, "note" | "price" | "frequency">;

/** Werkt prijs, frequentie of notitie van een adresregel bij. */
export async function updateCustomer(id: string, patch: Partial<PandVelden>): Promise<void> {
  const { error } = await supabase.from("customers").update(patch).eq("id", id);
  if (error) throw error;
}

/** Splitst "12a" in het nummer en de toevoeging. Zonder cijfer: niets. */
export function splitsHuisnummer(tekst: string): { house_number: number; addition: string } | null {
  const m = tekst.trim().match(/^(\d+)\s*(.*)$/);
  if (!m) return null;
  return { house_number: Number(m[1]), addition: (m[2] ?? "").trim() };
}

/**
 * Zorgt dat het adres van een klant ook op de wijklijst staat: de straat
 * wordt aangemaakt als hij er nog niet is, en het huisnummer eronder gehangen.
 * Zo zijn de klantenpagina en de wijkenlijst kruislings verbonden — wie je
 * bij de klanten invoert, staat meteen in de juiste straat.
 *
 * Geeft het id van de adresregel terug, of null als het huisnummer onleesbaar is.
 */
export async function zorgVoorAdresRegel(
  districtId: string,
  straat: string,
  huisnummer: string,
): Promise<string | null> {
  const naam = straat.trim();
  const nummer = splitsHuisnummer(huisnummer);
  if (!naam || !nummer) return null;

  // De wijklijst gebruikt werknamen ("Ameland" voor Amelandstraat), dus kijk
  // naar beide kolommen voordat we een dubbele straat aanmaken.
  const { data: bestaande, error: zoekFout } = await supabase
    .from("streets")
    .select("id,name,volledige_naam")
    .eq("district_id", districtId)
    .is("deleted_at", null);
  if (zoekFout) throw zoekFout;

  const gelijk = (a: string | null) => (a ?? "").trim().toLowerCase() === naam.toLowerCase();
  let streetId = (bestaande ?? []).find((s) => gelijk(s.name) || gelijk(s.volledige_naam))?.id;

  if (!streetId) {
    const { data, error } = await supabase
      .from("streets")
      .insert({ name: naam, volledige_naam: naam, district_id: districtId, sort_order: 100 })
      .select("id")
      .single();
    if (error) throw error;
    streetId = data.id;
  }

  const { data: nummers, error: nummerFout } = await supabase
    .from("customers")
    .select("id,house_number,addition")
    .eq("street_id", streetId)
    .is("deleted_at", null);
  if (nummerFout) throw nummerFout;

  const bestaand = (nummers ?? []).find(
    (c) =>
      c.house_number === nummer.house_number &&
      (c.addition ?? "").trim().toLowerCase() === nummer.addition.toLowerCase(),
  );
  if (bestaand) return bestaand.id;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      street_id: streetId,
      house_number: nummer.house_number,
      addition: nummer.addition,
      note: "",
      price: 0,
      frequency: "elke",
      sort_order: 100,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Slaat opgehaalde postcodes op voor een groep adressen tegelijk. */
export async function persistPostcodes(adressen: { id: string; postcode: string }[]) {
  await Promise.all(
    adressen.map((a) => supabase.from("customers").update({ postcode: a.postcode }).eq("id", a.id)),
  );
}

/** Slaat de officiële straatnamen op voor een groep straten tegelijk. */
export async function persistVolledigeNamen(namen: { id: string; volledige_naam: string }[]) {
  await Promise.all(
    namen.map((n) =>
      supabase.from("streets").update({ volledige_naam: n.volledige_naam.trim() }).eq("id", n.id),
    ),
  );
}

/**
 * Hangt adres-regels aan een klant, of maakt ze los met `null`. De regels
 * zelf blijven bestaan — losmaken haalt alleen de naam eraf.
 */
export async function koppelKlant(customerIds: string[], klantId: string | null) {
  if (customerIds.length === 0) return;
  const { error } = await supabase
    .from("customers")
    .update({ klant_id: klantId })
    .in("id", customerIds);
  if (error) throw error;
}

/**
 * Het postadres van een regel op de wijklijst. De officiële straatnaam wint,
 * met de werknaam als terugval — zo werkt de postcode-opzoeking ook voor
 * straten waarvan de volledige naam nog niet is ingevuld.
 */
export function adresVanRegel(c: Customer, s: Street, d: District | undefined) {
  return {
    straat: s.volledige_naam.trim() || s.name.trim(),
    huisnummer: formatNumber(c),
    plaats: d?.plaats.trim() ?? "",
  };
}

/** Eén regel adres voor in een lijst: "Kerkstraat 12, 3811 CV Amersfoort". */
export function klantAdres(k: Pick<Klant, "straat" | "huisnummer" | "postcode" | "plaats">) {
  const straat = [k.straat, k.huisnummer].filter(Boolean).join(" ");
  const plaats = [k.postcode, k.plaats].filter(Boolean).join(" ");
  return [straat, plaats].filter(Boolean).join(", ");
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
  const { error } = await supabase
    .from("quick_notes")
    .insert({ label: label.trim(), sort_order: 100 });
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
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
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
export function splitEvenOdd(customers: Customer[], order: "asc" | "desc" = "asc") {
  const sorted = sortCustomers(customers);
  const lijst = order === "desc" ? [...sorted].reverse() : sorted;
  return {
    even: lijst.filter((c) => c.house_number % 2 === 0),
    oneven: lijst.filter((c) => c.house_number % 2 !== 0),
  };
}

export async function persistCustomerOrder(
  items: { id: string; street_id: string; sort_order: number }[],
) {
  await Promise.all(
    items.map((i) =>
      supabase
        .from("customers")
        .update({ street_id: i.street_id, sort_order: i.sort_order })
        .eq("id", i.id),
    ),
  );
}

export async function persistStreetOrder(streets: Street[]) {
  await Promise.all(
    streets.map((s, i) =>
      supabase
        .from("streets")
        .update({ sort_order: i + 1 })
        .eq("id", s.id),
    ),
  );
}

/** Legt vast welke straten bovenaan een printkolom beginnen. */
export async function persistKolomStart(vlaggen: { id: string; kolom_start: boolean }[]) {
  await Promise.all(
    vlaggen.map((v) =>
      supabase.from("streets").update({ kolom_start: v.kolom_start }).eq("id", v.id),
    ),
  );
}

export async function setStreetSortDesc(id: string, desc: boolean) {
  const { error } = await supabase.from("streets").update({ sort_desc: desc }).eq("id", id);
  if (error) throw error;
}

/** Slaat de vrije rasterpositie (kolom/rij) op de printlijst op voor een groep straten tegelijk. */
export async function persistPrintPosities(
  posities: { id: string; print_col: number | null; print_row: number | null }[],
) {
  await Promise.all(
    posities.map((p) =>
      supabase
        .from("streets")
        .update({ print_col: p.print_col, print_row: p.print_row })
        .eq("id", p.id),
    ),
  );
}

/** Zet de printlijst van deze straten terug naar automatische indeling. */
export async function resetPrintPosities(streetIds: string[]) {
  await Promise.all(
    streetIds.map((id) =>
      supabase.from("streets").update({ print_col: null, print_row: null }).eq("id", id),
    ),
  );
}
