import { supabase } from "@/integrations/supabase/client";
import { eenVan } from "@/lib/embed";
import { haalAllePaginas } from "@/lib/pagineren";
import { isWerkdag, STANDAARD_WERKDAGEN } from "@/lib/werkdagen";

/**
 * Een wasdag is niets meer dan een selectie adressen bij een datum. Wat er
 * 's ochtends aanstaat is de planning, wat er 's avonds aanstaat is wat er
 * werkelijk gedaan is — dezelfde vinkjes, dus geen aparte administratie.
 *
 * Het bedrag staat op de regel zelf en niet op de klant: een prijsverhoging
 * van volgend jaar hoort een dag van vorige week niet duurder te maken.
 */
export interface WasdagRegel {
  /** Leeg als het adres later definitief uit de prullenbak gewist is. */
  customer_id: string | null;
  prijs: number;
  /** Bij welke ploeg van die dag dit adres hoort; leeg = nog niet ingedeeld. */
  ploeg_nr?: number | null;
  /** Waar het blok in de rij staat; alle adressen van een blok delen dit. */
  volgorde?: number | null;
  /** Dit is de rest van een straat die op een andere dag begon. */
  rest?: boolean;
  /** Vastgezet op een tijd; anders rekent de app hem uit. */
  vaste_start?: string | null;
  /**
   * Wat er die dag anders ging dan anders — "alleen de voorkant", "kon er
   * niet bij". Leeg is: gewoon zoals altijd. Hoort bij de dag en niet bij het
   * adres, net als het bedrag hierboven.
   */
  notitie?: string | null;
}

/**
 * Vandaag als `jjjj-mm-dd` in lokale tijd. Bewust niet via `toISOString()`:
 * die rekent in UTC en zet een Nederlandse zomeravond na 22:00 al op morgen.
 */
export function vandaag(): string {
  return datumSleutel(new Date());
}

/**
 * Een `Date` als `jjjj-mm-dd` in lokale tijd. Zelfde reden als hierboven: de
 * kalender geeft een `Date` terug op middernacht, en `toISOString()` maakt daar
 * in de zomer de dag ervoor van.
 */
export function datumSleutel(d: Date): string {
  const maand = String(d.getMonth() + 1).padStart(2, "0");
  const dag = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${maand}-${dag}`;
}

/** Toont een datum als "31 augustus", of "vandaag" als dat vandaag is. */
export function toonDatum(datum: string): string {
  if (datum === vandaag()) return "vandaag";
  const d = new Date(`${datum}T12:00:00`);
  if (Number.isNaN(d.getTime())) return datum;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/** Alle regels van één dag, over alle wijken heen. */
export async function fetchWasdag(datum: string): Promise<WasdagRegel[]> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("customer_id,notitie,ploeg_nr,volgorde,rest,vaste_start,wasdag_prijzen(prijs)")
    .eq("datum", datum);
  if (error) throw error;
  // Het bedrag staat in wasdag_prijzen; zonder het recht "prijzen zien" is dat 0.
  return (
    (data ?? []) as unknown as {
      customer_id: string | null;
      notitie: string | null;
      ploeg_nr: number | null;
      volgorde: number | null;
      rest: boolean | null;
      vaste_start: string | null;
      wasdag_prijzen: { prijs: number } | { prijs: number }[] | null;
    }[]
  ).map((r) => ({
    customer_id: r.customer_id,
    notitie: r.notitie,
    prijs: Number(eenVan(r.wasdag_prijzen)?.prijs ?? 0),
    ploeg_nr: r.ploeg_nr,
    volgorde: r.volgorde,
    rest: r.rest ?? false,
    vaste_start: r.vaste_start ? r.vaste_start.slice(0, 5) : null,
  }));
}

/** Eén regel met de dag erbij, voor het maandoverzicht. */
export interface WasdagDagRegel extends WasdagRegel {
  datum: string;
}

/** Alle regels tussen twee datums (beide meegerekend), voor de kalender. */
export async function fetchWasdagen(vanaf: string, tot: string): Promise<WasdagDagRegel[]> {
  // In stukken: een paar maanden planning is al snel meer dan 1000 regels,
  // en dan viel de rest stil weg.
  const data = await haalAllePaginas((van, totRij) =>
    supabase
      .from("wasdag_regels")
      .select("id,datum,customer_id,ploeg_nr,volgorde,rest,vaste_start,wasdag_prijzen(prijs)")
      .gte("datum", vanaf)
      .lte("datum", tot)
      .order("datum", { ascending: true })
      .order("id", { ascending: true })
      .range(van, totRij),
  );
  return (
    data as unknown as {
      datum: string;
      customer_id: string | null;
      ploeg_nr: number | null;
      volgorde: number | null;
      rest: boolean | null;
      vaste_start: string | null;
      wasdag_prijzen: { prijs: number } | { prijs: number }[] | null;
    }[]
  ).map((r) => ({
    datum: r.datum,
    customer_id: r.customer_id,
    prijs: Number(eenVan(r.wasdag_prijzen)?.prijs ?? 0),
    ploeg_nr: r.ploeg_nr,
    volgorde: r.volgorde,
    rest: r.rest ?? false,
    vaste_start: r.vaste_start ? r.vaste_start.slice(0, 5) : null,
  }));
}

/**
 * Zet adressen op de dag. Upsert op (company_id, datum, customer_id), zodat
 * een adres dat er al op staat geen tweede regel oplevert — je vinkt in de
 * praktijk zo een hele straat aan waar de helft al op stond.
 */
export async function voegToeAanWasdag(
  datum: string,
  regels: { customer_id: string; prijs: number; notitie?: string | null }[],
  /** Bij welke ploeg en waar in de rij; weglaten = nog niet ingedeeld. */
  plek?: { ploeg_nr?: number | null; volgorde?: number | null; rest?: boolean },
) {
  if (regels.length === 0) return;
  const { data, error } = await supabase
    .from("wasdag_regels")
    .upsert(
      regels.map((r) => ({
        datum,
        customer_id: r.customer_id,
        // Verhuist een adres naar een andere dag, dan gaat wat er die keer
        // anders ging mee. Anders zou het bij het opschuiven verdwijnen.
        notitie: r.notitie ?? null,
        ...(plek?.ploeg_nr !== undefined ? { ploeg_nr: plek.ploeg_nr } : {}),
        ...(plek?.volgorde !== undefined ? { volgorde: plek.volgorde } : {}),
        ...(plek?.rest !== undefined ? { rest: plek.rest } : {}),
      })),
      { onConflict: "company_id,datum,customer_id" },
    )
    .select("id,customer_id");
  if (error) throw error;

  // Het bedrag in zijn eigen tabel. Een nieuwe regel krijgt van de database al
  // de prijs van dat moment; wie prijzen mag zien, zet hier het bedrag dat hij
  // meegaf. Zonder dat recht weigert de database, en blijft de momentopname.
  const prijsVan = new Map(regels.map((r) => [r.customer_id, r.prijs]));
  const prijzen = (data ?? []).map((d) => ({
    regel_id: d.id,
    prijs: prijsVan.get(d.customer_id ?? "") ?? 0,
  }));
  if (prijzen.length > 0) {
    const { error: prijsFout } = await supabase
      .from("wasdag_prijzen")
      .upsert(prijzen, { onConflict: "regel_id" });
    if (prijsFout && prijsFout.code !== "42501") throw prijsFout;
  }
}

/**
 * Haalt adressen van de dag af. In stukjes, want de id's gaan als filter mee
 * in de URL: een hele wijk in één keer (honderden adressen) maakt die te lang.
 */
export async function haalUitWasdag(datum: string, customerIds: string[]) {
  const PER_KEER = 80;
  for (let i = 0; i < customerIds.length; i += PER_KEER) {
    const { error } = await supabase
      .from("wasdag_regels")
      .delete()
      .eq("datum", datum)
      .in("customer_id", customerIds.slice(i, i + PER_KEER));
    if (error) throw error;
  }
}

/**
 * Past één regel aan: het bedrag van deze dag, de notitie van deze dag, of
 * allebei. Bewust een `update` en geen upsert — de regel bestáát, je bent hem
 * aan het bijstellen. Stond hij er niet, dan valt er ook niets bij te stellen.
 */
export async function werkWasdagRegelBij(
  datum: string,
  customerId: string,
  patch: { prijs?: number; notitie?: string | null },
) {
  const { prijs, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    const { error } = await supabase
      .from("wasdag_regels")
      .update(rest)
      .eq("datum", datum)
      .eq("customer_id", customerId);
    if (error) throw error;
  }
  if (prijs !== undefined) {
    // Het bedrag van deze dag staat in wasdag_prijzen, bij de regel.
    const { data: regel, error: leesFout } = await supabase
      .from("wasdag_regels")
      .select("id")
      .eq("datum", datum)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (leesFout) throw leesFout;
    if (regel) {
      const { error: prijsFout } = await supabase
        .from("wasdag_prijzen")
        .upsert({ regel_id: regel.id, prijs }, { onConflict: "regel_id" });
      if (prijsFout) throw prijsFout;
    }
  }
}

/**
 * Zet van een paar adressen op een dag bij welke ploeg ze horen, en of ze de
 * rest van een straat zijn. Gebruikt na "Verplaats naar…": op de nieuwe dag
 * staan ze dan als eigen blok "(rest)" bij de goede ploeg.
 */
export async function zetPloegEnRest(
  datum: string,
  customerIds: string[],
  plek: {
    ploeg_nr?: number | null;
    rest?: boolean;
    volgorde?: number | null;
    vaste_start?: string | null;
  },
) {
  if (customerIds.length === 0) return;
  const patch = {
    ...(plek.ploeg_nr !== undefined ? { ploeg_nr: plek.ploeg_nr } : {}),
    ...(plek.rest !== undefined ? { rest: plek.rest } : {}),
    ...(plek.volgorde !== undefined ? { volgorde: plek.volgorde } : {}),
    ...(plek.vaste_start !== undefined ? { vaste_start: plek.vaste_start } : {}),
  };
  if (Object.keys(patch).length === 0) return;
  const PER_KEER = 80;
  for (let i = 0; i < customerIds.length; i += PER_KEER) {
    const { error } = await supabase
      .from("wasdag_regels")
      .update(patch)
      .eq("datum", datum)
      .in("customer_id", customerIds.slice(i, i + PER_KEER));
    if (error) throw error;
  }
}

/**
 * Verplaatst adressen van de ene dag naar de andere. Het blijft dezelfde
 * regel: alleen de datum verandert, dus het bedrag van die keer (en de
 * notitie) gaat mee. Ook als wie verschuift geen prijzen mag zien: een
 * aangepaste prijs ("alleen de voorkant, € 15") blijft zo staan.
 *
 * Staat een adres op de nieuwe dag al, dan blijft die regel zoals hij is en
 * verdwijnt alleen de oude.
 *
 * Geeft terug welke adressen echt verhuisd zijn (alleen die horen bij
 * ongedaan maken terug) en de kenmerken van wat alleen wegging.
 */
export async function verplaatsWasdag(
  van: string,
  naar: string,
  customerIds: string[],
): Promise<{ verplaatst: string[]; kenmerken: string[] }> {
  const kenmerken: string[] = [];
  const verplaatst: string[] = [];
  if (van === naar || customerIds.length === 0) return { verplaatst, kenmerken };
  try {
    await verplaatsInStukken(van, naar, customerIds, verplaatst, kenmerken);
  } catch (e) {
    // Een eerder stukje kan al verhuisd zijn: zeg wat, zodat terugdraaien
    // ook dat deel meeneemt.
    throw new HalfVerplaatst(e, verplaatst, kenmerken);
  }
  return { verplaatst, kenmerken };
}

/**
 * De fout van `verplaatsWasdag`, met wat er vóór de fout al wel verhuisd (of
 * bewaard weggehaald) was. Dezelfde melding als de oorspronkelijke fout.
 */
export class HalfVerplaatst extends Error {
  constructor(
    oorzaak: unknown,
    readonly verplaatst: string[],
    readonly kenmerken: string[],
  ) {
    super(
      oorzaak instanceof Error
        ? oorzaak.message
        : String((oorzaak as { message?: string })?.message ?? oorzaak),
    );
  }
}

async function verplaatsInStukken(
  van: string,
  naar: string,
  customerIds: string[],
  verplaatst: string[],
  kenmerken: string[],
) {
  const PER_KEER = 80;
  for (let i = 0; i < customerIds.length; i += PER_KEER) {
    const stuk = customerIds.slice(i, i + PER_KEER);
    const { data: alDaar, error: leesFout } = await supabase
      .from("wasdag_regels")
      .select("customer_id")
      .eq("datum", naar)
      .in("customer_id", stuk);
    if (leesFout) throw leesFout;
    const bezet = new Set((alDaar ?? []).map((r) => r.customer_id));
    const vrij = stuk.filter((id) => !bezet.has(id));
    if (vrij.length > 0) {
      const { data: verzet, error } = await supabase
        .from("wasdag_regels")
        // De indeling van de oude dag geldt daar niet: die ploeg bestaat op de
        // nieuwe dag misschien niet eens, en een vastgezette tijd van dinsdag
        // zegt niets over donderdag. Het werk komt dus binnen als "nog niet
        // ingedeeld".
        .update({ datum: naar, ploeg_nr: null, volgorde: null, vaste_start: null })
        .eq("datum", van)
        .in("customer_id", vrij)
        .select("customer_id");
      if (error) throw error;
      // Een geweigerde wijziging geeft geen fout, maar raakt nul regels. Dan
      // eerlijk zeggen, in plaats van "verplaatst" terwijl er niets gebeurde.
      if ((verzet ?? []).length === 0) {
        throw new Error("Je rol mag de planning niet verschuiven.");
      }
      for (const r of verzet ?? []) if (r.customer_id) verplaatst.push(r.customer_id);
    }
    // Stond het adres al op de doeldag, dan gaat alleen de oude regel weg. De
    // database bewaart die (met zijn bedrag), zodat ongedaan maken hem kan
    // terugzetten met zijn eigen prijs.
    const dubbel = stuk.filter((id) => bezet.has(id));
    if (dubbel.length > 0) {
      const kenmerk = await haalUitWasdagBewaard(van, dubbel);
      if (kenmerk) kenmerken.push(kenmerk);
    }
  }
}

/** Binnen hoeveel dagen twee beurten van hetzelfde adres "dubbel" heten. */
export const DUBBEL_BINNEN_DAGEN = 14;

/**
 * Welke van deze adressen staan al ingepland binnen twee weken voor of na
 * `datum` (niet op `behalve`), en op welke dag.
 *
 * Bewust niet per kalendermaand: twee keer in een maand kan kloppen. Loopt
 * een ronde uit, dan komt een adres op 1 september én eind september; is een
 * ronde vroeg klaar, dan begint november al op 30 oktober. Twee keer in
 * dezelfde twee weken is daarentegen bijna altijd een vergissing, zoals een
 * wijk die op twee dagen wordt ingepland.
 */
/** Van twee dagen: de eerstvolgende toekomstige, anders de laatste. */
function belangrijksteDag(a: string, b: string): string {
  const nu = vandaag();
  const aKomt = a > nu;
  const bKomt = b > nu;
  if (aKomt && bKomt) return a < b ? a : b;
  if (aKomt !== bKomt) return aKomt ? a : b;
  return a > b ? a : b;
}

export async function alDichtbij(
  datum: string,
  customerIds: string[],
  behalve?: string,
): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  const d = new Date(`${datum}T12:00:00`);
  const vanaf = datumSleutel(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - DUBBEL_BINNEN_DAGEN),
  );
  const tot = datumSleutel(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + DUBBEL_BINNEN_DAGEN),
  );
  // In stukjes, om dezelfde reden als bij haalUitWasdag: de id's gaan in de URL.
  const PER_KEER = 80;
  for (let i = 0; i < customerIds.length; i += PER_KEER) {
    const { data, error } = await supabase
      .from("wasdag_regels")
      .select("customer_id,datum")
      .gte("datum", vanaf)
      .lte("datum", tot)
      .in("customer_id", customerIds.slice(i, i + PER_KEER));
    if (error) throw error;
    for (const r of data ?? []) {
      if (!r.customer_id || r.datum === behalve) continue;
      // Staat hij op meer dagen, dan de dag die ertoe doet: de eerstvolgende
      // die nog moet komen (die kun je verplaatsen), anders de laatst
      // gewassen. Zo gedraagt hetzelfde adres zich elke keer hetzelfde.
      const was = uit.get(r.customer_id);
      uit.set(r.customer_id, was ? belangrijksteDag(was, r.datum) : r.datum);
    }
  }
  return uit;
}

/**
 * De vraag die de schermen stellen als alDichtbij iets vond: toch inplannen,
 * of die adressen overslaan. Overslaan is het veilige antwoord (ook Escape).
 */
export function dubbelVraag(dichtbij: Map<string, string>) {
  const n = dichtbij.size;
  const dagen = [...new Set(dichtbij.values())].sort().map(toonDatum);
  const opDagen =
    dagen.length <= 3
      ? dagen.join(", ")
      : `${dagen.slice(0, 3).join(", ")} en nog ${dagen.length - 3} ${dagen.length - 3 === 1 ? "dag" : "dagen"}`;
  return {
    titel: `${n} ${n === 1 ? "adres staat" : "adressen staan"} kort ervoor of erna al ingepland`,
    tekst: `Op ${opDagen}. Twee beurten binnen twee weken is meestal dubbel. Wil je ${
      n === 1 ? "dit adres" : "deze adressen"
    } toch nog een keer inplannen?`,
    bevestigLabel: "Toch inplannen",
    annuleerLabel: "Overslaan",
  };
}

/**
 * Haalt adressen van een dag (of zonder lijst: de hele dag) en laat de
 * database bewaren wat er wegging, mét het bedrag van die keer. Geeft het
 * kenmerk om het terug te zetten, of null als er niets weg hoefde.
 */
export async function haalUitWasdagBewaard(
  datum: string,
  customerIds?: string[],
): Promise<string | null> {
  if (customerIds && customerIds.length === 0) return null;
  const { data, error } = await supabase.rpc(
    "wasdag_weghalen",
    customerIds ? { dag: datum, adressen: customerIds } : { dag: datum },
  );
  if (error) throw error;
  return data ?? null;
}

/**
 * Zet wat haalUitWasdagBewaard weghaalde terug, met het eigen bedrag. Ook voor
 * wie geen prijzen mag zien: het bedrag komt uit de database, niet uit de
 * browser. Een adres dat intussen weer op die dag staat blijft zoals het is.
 */
export async function zetWasdagTerug(kenmerk: string | null): Promise<void> {
  if (!kenmerk) return;
  const { error } = await supabase.rpc("wasdag_terugzetten", { kenmerk });
  if (error) throw error;
}

/** Veegt een hele dag leeg — op datum, dus zonder lijst met id's. */
export async function maakWasdagLeeg(datum: string) {
  const { error } = await supabase.from("wasdag_regels").delete().eq("datum", datum);
  if (error) throw error;
}

/**
 * `n` werkdagen verder. Dagen waarop je niet werkt (Instellingen → Wijken)
 * tellen niet mee: werk je maandag t/m vrijdag, dan is vrijdag plus één
 * maandag. Schuif je een dag op omdat het regent, dan hoort dat werk niet op
 * een vrije dag te belanden.
 */
export function werkdagenVerder(
  datum: string,
  n: number,
  werkdagen: readonly number[] = STANDAARD_WERKDAGEN,
): string {
  const d = new Date(`${datum}T12:00:00`);
  let over = n;
  while (over > 0) {
    d.setDate(d.getDate() + 1);
    if (isWerkdag(d, werkdagen)) over -= 1;
  }
  const maand = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${maand}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * De eerste en laatste dag van de maand waarin `datum` valt. Gebruikt om te
 * zien wat er die maand al gewassen is: bij een nieuwe maand begint die
 * telling vanzelf weer op nul.
 */
export function maandGrenzen(datum: string): { vanaf: string; tot: string } {
  const d = new Date(`${datum}T12:00:00`);
  const laatste = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const maand = String(d.getMonth() + 1).padStart(2, "0");
  return {
    vanaf: `${d.getFullYear()}-${maand}-01`,
    tot: `${laatste.getFullYear()}-${maand}-${String(laatste.getDate()).padStart(2, "0")}`,
  };
}
