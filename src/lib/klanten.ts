import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Frequency = "elke" | "even" | "oneven";

/** Leeg is het gewone geval; geel is opletten, groen is een nieuwe klant. */
export type Markering = "" | "geel" | "groen";

/** Wat een regel kan kleuren: de kleuren die je zelf kiest, plus rood van
 *  een overgeslagen maand — dat laatste kies je niet, dat volgt eruit. */
export type RegelKleur = Markering | "rood";

export const markeringLabels: Record<Exclude<Markering, "">, string> = {
  geel: "Extra opletten",
  groen: "Nieuwe klant",
};

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
  /** Werk dat er alleen in even maanden bij komt, bovenop `note`. */
  note_even: string;
  /** Idem voor oneven maanden. */
  note_oneven: string;
  price: number;
  frequency: Frequency;
  /** Om de hoeveel maanden dit adres gewassen wordt: 1, 2, 3, 6 of 12. */
  interval_maanden: number;
  /** De ankermaand binnen het jaar (1-12): in welke maanden het uitkomt.
   *  Om de 2 met ritme 2 zijn de even maanden, met ritme 1 de oneven. */
  ritme: number;
  /** Werk dat er alleen in bepaalde maanden bij komt, met eventueel een
   *  eigen prijs voor die ronde. */
  maandwerk: Maandwerk[];
  sort_order: number;
  /** De persoon achter dit adres, als die bekend is. Zie {@link Klant}. */
  klant_id: string | null;
  /** Hoort bij het pand, niet bij de bewoner — en staat er dus ook als we
   *  nog niet weten wie er woont. */
  postcode: string;
  /** Waar je op moet letten: "geel" is opletten, "groen" is nieuw, leeg is
   *  het gewone geval. Kleurt de regel in de app én op de printlijst. */
  markering: Markering;
  /** Maanden ("jjjj-mm") waarin dit adres niet meegaat. */
  overslaan: string[];
  /** Pas wassen vanaf deze maand ("jjjj-mm"); leeg is meteen. */
  start_maand: string;
  /** Wanneer het adres is aangemaakt — waar "nieuw in mei" op steunt. */
  created_at: string;
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

/**
 * Werk dat er alleen in bepaalde maanden bij komt. De maanden zijn
 * kalendermaanden ("01"-"12"), dus het herhaalt zich elk jaar: "in maart en
 * september komt de serre erbij, en dan is het € 25".
 */
export interface Maandwerk {
  maanden: string[];
  notitie: string;
  /** De hele prijs voor die ronde, niet de meerkosten. Leeg (null) betekent
   *  gewoon de vaste prijs van het adres. */
  prijs: number | null;
}

/** Wat er uit de database komt is losse json; hier maken we er iets van
 *  waar de rest van de app op kan rekenen. */
export function leesMaandwerk(waarde: unknown): Maandwerk[] {
  if (!Array.isArray(waarde)) return [];
  return waarde.flatMap((rij) => {
    if (!rij || typeof rij !== "object") return [];
    const r = rij as Record<string, unknown>;
    const maanden = Array.isArray(r["maanden"])
      ? r["maanden"].filter((m): m is string => typeof m === "string")
      : [];
    // Zonder maanden slaat een uitzondering nergens op.
    if (maanden.length === 0) return [];
    return [
      {
        maanden,
        notitie: typeof r["notitie"] === "string" ? r["notitie"] : "",
        prijs: typeof r["prijs"] === "number" ? r["prijs"] : null,
      },
    ];
  });
}

/** Om de hoeveel maanden een adres gewassen kan worden. */
export const INTERVALLEN = [1, 2, 3, 6, 12] as const;

export const intervalLabels: Record<number, string> = {
  1: "Elke maand",
  2: "Om de 2 maanden",
  3: "Om de 3 maanden",
  6: "Om de 6 maanden",
  12: "Eén keer per jaar",
};

export const frequencyLabels: Record<Frequency, string> = {
  elke: "Elke maand",
  even: "Even maand",
  oneven: "Oneven maand",
};

/**
 * Vaste kleur per wijk, afgeleid van zijn plek in de lijst — dus zonder dat
 * je hem ergens hoeft te kiezen. De gulden hoek (137,5°) zorgt dat
 * opeenvolgende wijken ver uit elkaar liggen op de kleurencirkel, ook als het
 * er tien zijn.
 *
 * `wijkKleur` is het bolletje: verzadigd genoeg om op zes pixels te zien, en
 * middenlicht zodat het in licht én donker werkt. Voor een heel vlak is dat
 * te fel; daarvoor geeft `wijkHoek` alleen de kleurhoek, en bepaalt de klasse
 * `.wijkvak` in styles.css hoe zacht hij is — dat verschilt per thema.
 */
export function wijkHoek(index: number): string {
  return ((index * 137.5) % 360).toFixed(1);
}

export function wijkKleur(index: number): string {
  return `oklch(0.62 0.14 ${wijkHoek(index)})`;
}

/**
 * Achtergrond voor een vlak dat bij een of meer wijken hoort — een dag op de
 * kalender. Bij meerdere wijken wordt het even brede banen naast elkaar, met
 * harde overgangen: een verloop zou de kleuren juist onherkenbaar maken.
 *
 * De lichtheid komt uit `--wijk-l` en `--wijk-c` in styles.css, want die
 * hoort bij het thema en niet bij de code.
 */
export function wijkVlak(indexen: number[]): string {
  const kleur = (i: number) => `oklch(var(--wijk-l) var(--wijk-c) ${wijkHoek(i)})`;
  if (indexen.length === 0) return "";
  if (indexen.length === 1) return kleur(indexen[0]!);

  const breedte = 100 / indexen.length;
  const banen = indexen.map(
    (i, n) => `${kleur(i)} ${(n * breedte).toFixed(2)}% ${((n + 1) * breedte).toFixed(2)}%`,
  );
  return `linear-gradient(to right, ${banen.join(", ")})`;
}

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
    // Eén letterlijke string: supabase-js leidt de rijtypes hieruit af, en
    // met een samengestelde string lukt dat niet meer.
    .select(
      "id,street_id,house_number,addition,note,note_even,note_oneven,price,frequency,interval_maanden,ritme,maandwerk,sort_order,klant_id,postcode,markering,overslaan,start_maand,created_at",
    )
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("house_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    ...c,
    price: Number(c.price),
    postcode: c.postcode ?? "",
    note_even: c.note_even ?? "",
    note_oneven: c.note_oneven ?? "",
    markering: (c.markering ?? "") as Markering,
    overslaan: c.overslaan ?? [],
    start_maand: c.start_maand ?? "",
    interval_maanden: c.interval_maanden ?? 1,
    ritme: c.ritme ?? 1,
    maandwerk: leesMaandwerk(c.maandwerk),
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

/**
 * Een patch zoals de database hem wil. `maandwerk` is bij ons een echte lijst
 * en in de database losse json; TypeScript ziet die twee niet als hetzelfde,
 * en die vertaling hoort op één plek te staan in plaats van bij elke update.
 */
export function alsRij(
  patch: Partial<Customer>,
): Database["public"]["Tables"]["customers"]["Update"] {
  return patch as unknown as Database["public"]["Tables"]["customers"]["Update"];
}

/** Losse velden van één adres bijwerken — kleur, overslaan, startmaand. */
export async function patchCustomer(id: string, patch: Partial<Customer>) {
  const { error } = await supabase.from("customers").update(alsRij(patch)).eq("id", id);
  if (error) throw error;
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

/**
 * Weggooien kan alleen vanaf de instellingen, niet vanuit het notitieveld:
 * daar zit je snel te klikken en is een snelkeuze zo weg. De notities die de
 * snelkeuze al gebruiken blijven gewoon staan — het is maar een knopje.
 */
export async function deleteQuickNote(id: string) {
  const { error } = await supabase.from("quick_notes").delete().eq("id", id);
  if (error) throw error;
}

/**
 * De notitie zoals hij op de printlijst van één ronde hoort te staan: wat er
 * altijd geldt, plus het werk dat alleen in die maand meegaat. `maand` is een
 * kalendermaand ("jjjj-mm"), of een van de oude keuzes even/oneven/alles.
 */
export function noteVoorMaand(c: Pick<Customer, "note" | "maandwerk">, maand: string): string {
  const extra = maandwerkVoor(c, maand)
    .map((w) => {
      const tekst = w.notitie.trim();
      if (!tekst) return "";
      // Print je alle klanten tegelijk, dan is er geen maand om op te kiezen
      // en moet erbij staan wanneer dit werk meegaat.
      if (maand !== "alles") return tekst;
      const maanden = w.maanden
        .map((m) => toonMaandKort(`2000-${m}`))
        .join("/");
      return `${tekst} (${maanden})`;
    })
    .filter(Boolean);
  return [c.note, ...extra]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Sleutel waarop twee straatnamen dezelfde straat zijn: hoofdletters, spaties
 * aan de rand en dubbele spaties tellen niet mee. "Kerkstraat", "KERKSTRAAT"
 * en "Kerk  straat " horen bij één straat.
 *
 * Gebruik deze overal waar straatnamen vergeleken worden. Doet de ene plek
 * het anders dan de andere, dan maakt de import twee straten waar het
 * samenvoegscherm er één van maakt — en blijft er eentje leeg achter.
 */
export function straatSleutel(naam: string): string {
  return naam.trim().toLowerCase().replace(/\s+/g, " ");
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

/** Een maand als "jjjj-mm" — waarop overslaan en startmaand vergelijken. */
export function maandSleutel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function toonMaand(sleutel: string): string {
  const [jaar, maand] = sleutel.split("-").map(Number);
  if (!jaar || !maand) return sleutel;
  return new Date(jaar, maand - 1, 1).toLocaleDateString("nl-NL", { month: "long" });
}

/** Korte maandnaam, voor plekken waar "september" niet past. */
export function toonMaandKort(sleutel: string): string {
  const [jaar, maand] = sleutel.split("-").map(Number);
  if (!jaar || !maand) return sleutel;
  return new Date(jaar, maand - 1, 1).toLocaleDateString("nl-NL", { month: "short" });
}

/**
 * De maand vóór deze. Als startmaand betekent hij: al langer klant, dus niet
 * nieuw — hij doet gewoon mee en kleurt nergens groen.
 */
export function vorigeMaand(): string {
  const nu = new Date();
  return maandSleutel(new Date(nu.getFullYear(), nu.getMonth() - 1, 1));
}

/** De twaalf maanden vanaf nu: waaruit je een startmaand of een pauze kiest. */
export function komendeMaanden(aantal = 12): string[] {
  const nu = new Date();
  return Array.from({ length: aantal }, (_, i) =>
    maandSleutel(new Date(nu.getFullYear(), nu.getMonth() + i, 1)),
  );
}

/** De maand na deze sleutel. */
export function volgendeMaand(sleutel: string): string {
  const [jaar, maand] = sleutel.split("-").map(Number);
  return maandSleutel(new Date(jaar!, maand!, 1));
}

/**
 * Een adres dat nog moet beginnen en dat je zijn eigen startmaand laat
 * overslaan, begint gewoon later. Dat is één ding om te zien — "vanaf
 * oktober" — in plaats van twee badges die hetzelfde zeggen.
 *
 * Alleen voor adressen die nog niet begonnen zijn: bij een vaste klant is
 * een maand overslaan een pauze, en die hoort niet zijn startmaand te
 * verzetten.
 */
export function schuifStartOp(
  c: Pick<Customer, "start_maand" | "created_at" | "overslaan">,
  patch: Partial<Customer>,
): Partial<Customer> {
  const overslaan = patch.overslaan ?? c.overslaan;
  const dezeMaand = maandSleutel(new Date());
  let start = eersteMaand({ ...c, start_maand: patch.start_maand ?? c.start_maand });
  if (start < dezeMaand) return patch;

  const rest = [...overslaan];
  let verschoven = false;
  while (rest.includes(start)) {
    rest.splice(rest.indexOf(start), 1);
    start = volgendeMaand(start);
    verschoven = true;
  }
  return verschoven ? { ...patch, start_maand: start, overslaan: rest } : patch;
}

/** De maand waarin dit adres voor het eerst aan de beurt is. */
export function eersteMaand(c: Pick<Customer, "start_maand" | "created_at">): string {
  return c.start_maand || maandSleutel(new Date(c.created_at));
}

/**
 * Hoort dit adres in deze ronde op de lijst? Nee als hij nog niet begonnen
 * is, en nee als je die maand hebt overgeslagen.
 */
export function doetMee(
  c: Pick<Customer, "start_maand" | "created_at" | "overslaan">,
  maand: string,
): boolean {
  if (c.overslaan.includes(maand)) return false;
  return maand >= eersteMaand(c);
}

/** Nieuw deze ronde: de eerste maand dat hij meegaat. */
export function isNieuw(c: Pick<Customer, "start_maand" | "created_at">, maand: string): boolean {
  return maand === eersteMaand(c);
}

/**
 * De kleur van een regel: rood als hij deze maand wordt overgeslagen,
 * anders de kleur die je zelf gaf, anders groen omdat hij deze maand nieuw
 * is. Leeg betekent geen kleur.
 *
 * Overgeslagen gaat voor: dat hij deze ronde niet meedoet is het eerste wat
 * je wilt zien, ook als je hem een kleur had gegeven.
 */
export function regelKleur(
  c: Pick<Customer, "markering" | "start_maand" | "created_at" | "overslaan">,
  maand: string,
): RegelKleur {
  if (c.overslaan.includes(maand)) return "rood";
  if (c.markering) return c.markering;
  return isNieuw(c, maand) ? "groen" : "";
}

/**
 * De kalendermaanden (1-12) waarin dit adres aan de beurt is. Om de 2 met
 * ritme 2 zijn de even maanden, om de 3 met ritme 3 is maart/juni/september/
 * december. Bij elke maand doet het ritme niet mee.
 */
export function ritmeMaanden(c: Pick<Customer, "interval_maanden" | "ritme">): number[] {
  const stap = c.interval_maanden || 1;
  const alle = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (stap <= 1) return alle;
  // Twee keer modulo: in JavaScript is -2 % 3 gelijk aan -2, niet aan 1.
  return alle.filter((m) => (((m - c.ritme) % stap) + stap) % stap === 0);
}

/**
 * Wat er in het badge van de regel komt te staan. Even en oneven blijven bij
 * hun naam — daar kun je in één oogopslag mee zien waar een adres valt — en
 * bij de andere ritmes zeggen de maandnummers dat.
 */
export function ritmeLabel(c: Pick<Customer, "interval_maanden" | "ritme">): string {
  const stap = c.interval_maanden || 1;
  if (stap <= 1) return "Elke";
  if (stap === 2) return c.ritme % 2 === 0 ? "Even" : "Oneven";
  const maanden = ritmeMaanden(c);
  if (stap === 12) return toonMaandKort(`2000-${String(maanden[0]).padStart(2, "0")}`);
  return maanden.join("·");
}

/**
 * De ankermaanden die bij een interval horen: om de 3 zijn dat er drie
 * (1·4·7·10, 2·5·8·11, 3·6·9·12), om de 12 twaalf. Waar je uit kiest als je
 * zegt in welke maanden een adres valt.
 */
export function ritmeVarianten(interval: number): number[] {
  const stap = interval || 1;
  return Array.from({ length: stap }, (_, i) => i + 1);
}

/** Komen deze twee ankers op dezelfde maanden uit? Ritme 9 en ritme 3 doen
 *  dat bij om de 3, want ze schelen precies een hele cyclus. */
export function zelfdeRitme(a: number, b: number, interval: number): boolean {
  const stap = interval || 1;
  return (((a - b) % stap) + stap) % stap === 0;
}

/** Is dit een echte maand ("2026-09") of een van de keuzes even/oneven/alles? */
export function isKalendermaand(maand: string): boolean {
  return /^\d{4}-\d{2}$/.test(maand);
}

/** Hoort dit adres op de lijst van deze kalendermaand? */
export function aanDeBeurt(
  c: Pick<Customer, "interval_maanden" | "ritme" | "start_maand" | "created_at" | "overslaan">,
  maand: string,
): boolean {
  if (!doetMee(c, maand)) return false;
  return ritmeMaanden(c).includes(Number(maand.slice(5, 7)));
}

/**
 * Het maandwerk dat in deze ronde meegaat. `maand` is een kalendermaand
 * ("jjjj-mm"), of een van de oude keuzes even/oneven/alles — die blijven
 * bestaan als printoptie.
 */
export function maandwerkVoor(c: Pick<Customer, "maandwerk">, maand: string): Maandwerk[] {
  if (maand === "alles") return c.maandwerk;
  if (maand === "even" || maand === "oneven") {
    const even = maand === "even";
    return c.maandwerk.filter((w) => w.maanden.some((m) => (Number(m) % 2 === 0) === even));
  }
  const nr = maand.slice(5, 7);
  return c.maandwerk.filter((w) => w.maanden.includes(nr));
}

/** De prijs voor deze ronde: die van het maandwerk, anders de vaste prijs. */
export function prijsVoorMaand(c: Pick<Customer, "price" | "maandwerk">, maand: string): number {
  const metPrijs = maandwerkVoor(c, maand).find((w) => w.prijs !== null);
  return metPrijs?.prijs ?? c.price;
}

/**
 * Valt dit adres in de even of de oneven helft van het jaar? Alleen voor de
 * even/oneven-printoptie; de gewone weg is `aanDeBeurt` met een echte maand.
 */
export function matchesMaand(
  c: Pick<Customer, "interval_maanden" | "ritme">,
  filter: "alles" | "even" | "oneven",
) {
  if (filter === "alles") return true;
  const even = filter === "even";
  return ritmeMaanden(c).some((m) => (m % 2 === 0) === even);
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
