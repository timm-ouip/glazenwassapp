import { aanDeBeurt, type Customer, type District, type Street } from "@/lib/klanten";
import type { WasdagDagRegel } from "@/lib/wasdag";

/**
 * Hoe lang doe je over een wijk, en welke wijk is wanneer aan de beurt?
 *
 * De app weet dat niet van tevoren, dus ze leert het van de dagen die je hebt
 * afgevinkt: hoeveel adressen krijg je gemiddeld op één dag rond. Zolang er
 * nog weinig dagen zijn gaan we uit van een aanname, en dat zeggen we er
 * eerlijk bij — een suggestie die doet alsof ze het weet is erger dan geen
 * suggestie.
 */

/** Waar we van uitgaan zolang er te weinig dagen zijn om iets te meten. */
export const AANNAME_PER_DAG = 50;

/**
 * Zoveel dagen willen we minstens gezien hebben voor we een gemiddelde
 * durven noemen. Met één of twee dagen zegt het niets: een halve dag
 * natrekken telt dan even zwaar als een volle ronde, en dan zou de app
 * doodleuk voorstellen om zeven weken over één wijk te doen.
 */
export const MINIMUM_DAGEN = 3;

export interface Tempo {
  /** Gemiddeld aantal adressen op één werkdag. */
  perDag: number;
  /** Op hoeveel gemeten dagen dat gemiddelde steunt. */
  dagen: number;
  /** "wijk" is gemeten in deze wijk zelf, "alles" over alle wijken samen,
   *  "aanname" betekent dat er nog niets te meten viel. */
  bron: "wijk" | "alles" | "aanname";
}

/** De wijk waar een adres bij hoort, via zijn straat. */
function wijkVanAdres(streets: Street[]): Map<string, string> {
  const wijkVanStraat = new Map(streets.map((s) => [s.id, s.district_id]));
  return wijkVanStraat;
}

/**
 * Hoeveel adressen per dag, per wijk, uit de dagen die je hebt gedraaid.
 *
 * Een dag telt alleen mee voor de wijk waar het merendeel van dat werk lag:
 * rijd je 's ochtends de laatste tien van Gouda en 's middags heel Madestein,
 * dan zegt die dag iets over Madestein en niets over Gouda.
 */
export function meetTempo(
  regels: WasdagDagRegel[],
  customers: Customer[],
  streets: Street[],
): { perWijk: Map<string, Tempo>; algemeen: Tempo } {
  const straatVan = new Map(customers.map((c) => [c.id, c.street_id]));
  const wijkVanStraat = wijkVanAdres(streets);

  // Per dag: hoeveel adressen per wijk.
  const perDag = new Map<string, Map<string, number>>();
  for (const r of regels) {
    if (!r.customer_id) continue;
    const straat = straatVan.get(r.customer_id);
    const wijk = straat ? wijkVanStraat.get(straat) : undefined;
    if (!wijk) continue;
    const dag = perDag.get(r.datum) ?? new Map<string, number>();
    dag.set(wijk, (dag.get(wijk) ?? 0) + 1);
    perDag.set(r.datum, dag);
  }

  // Elke dag toegewezen aan zijn zwaartepunt.
  const tellingen = new Map<string, number[]>();
  const alleAantallen: number[] = [];
  for (const dag of perDag.values()) {
    let besteWijk = "";
    let besteAantal = 0;
    let totaal = 0;
    for (const [wijk, aantal] of dag) {
      totaal += aantal;
      if (aantal > besteAantal) {
        besteAantal = aantal;
        besteWijk = wijk;
      }
    }
    if (!besteWijk) continue;
    tellingen.set(besteWijk, [...(tellingen.get(besteWijk) ?? []), totaal]);
    alleAantallen.push(totaal);
  }

  // De middelste dag en niet het gemiddelde: één uitschieter — een ochtendje
  // natrekken, of een dag waarop je twee wijken combineerde — hoort het beeld
  // niet te bepalen.
  const mediaan = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const op = [...xs].sort((a, b) => a - b);
    const m = Math.floor(op.length / 2);
    return op.length % 2 === 1 ? op[m]! : Math.round((op[m - 1]! + op[m]!) / 2);
  };

  const algemeen: Tempo =
    alleAantallen.length >= MINIMUM_DAGEN
      ? { perDag: mediaan(alleAantallen), dagen: alleAantallen.length, bron: "alles" }
      : { perDag: AANNAME_PER_DAG, dagen: alleAantallen.length, bron: "aanname" };

  const perWijk = new Map<string, Tempo>();
  for (const [wijk, xs] of tellingen) {
    // Een wijk krijgt pas een eigen cijfer als er genoeg dagen van zijn;
    // daaronder valt hij terug op het algemene beeld.
    if (xs.length < MINIMUM_DAGEN) continue;
    perWijk.set(wijk, { perDag: mediaan(xs), dagen: xs.length, bron: "wijk" });
  }
  return { perWijk, algemeen };
}

/** Het tempo van één wijk, met terugval op het algemene gemiddelde. */
export function tempoVan(
  wijkId: string,
  gemeten: { perWijk: Map<string, Tempo>; algemeen: Tempo },
): Tempo {
  return gemeten.perWijk.get(wijkId) ?? gemeten.algemeen;
}

export interface WijkWerk {
  wijk: District;
  /** Adressen die deze maand aan de beurt zijn. */
  teDoen: number;
  /** Daarvan al op een dag gezet. */
  gepland: number;
  /** Wat er nog over is. */
  resteert: number;
  tempo: Tempo;
  /** Hoeveel werkdagen daar naar verwachting nog voor nodig zijn. */
  dagenNodig: number;
}

/** Wat er deze maand per wijk nog te doen staat. */
export function werkPerWijk(
  maand: string,
  districts: District[],
  streets: Street[],
  customers: Customer[],
  maandRegels: WasdagDagRegel[],
  gemeten: { perWijk: Map<string, Tempo>; algemeen: Tempo },
): WijkWerk[] {
  const alGepland = new Set(maandRegels.map((r) => r.customer_id).filter(Boolean) as string[]);
  const stratenVan = new Map<string, Set<string>>();
  for (const s of streets) {
    const set = stratenVan.get(s.district_id) ?? new Set<string>();
    set.add(s.id);
    stratenVan.set(s.district_id, set);
  }

  return districts.map((wijk) => {
    const straten = stratenVan.get(wijk.id) ?? new Set<string>();
    const beurt = customers.filter((c) => straten.has(c.street_id) && aanDeBeurt(c, maand));
    const gepland = beurt.filter((c) => alGepland.has(c.id)).length;
    const resteert = beurt.length - gepland;
    const tempo = tempoVan(wijk.id, gemeten);
    return {
      wijk,
      teDoen: beurt.length,
      gepland,
      resteert,
      tempo,
      dagenNodig: resteert === 0 ? 0 : Math.max(1, Math.ceil(resteert / Math.max(1, tempo.perDag))),
    };
  });
}

/** `jjjj-mm-dd` in lokale tijd. */
function sleutel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Voorstel {
  datum: string;
  wijkId: string;
  naam: string;
  /** Hoeveelste dag van deze wijk dit is, en hoeveel het er in totaal zijn. */
  deel: number;
  van: number;
}

/**
 * Een voorstel voor de rest van de maand: welke wijk op welke dag.
 *
 * De wijken komen langs in de volgorde die je in de instellingen hebt gezet —
 * dat is de ronde die je rijdt. Wijken die deze maand al rond zijn slaan we
 * over, net als weekenddagen en dagen waar al werk op staat: die heb je zelf
 * al ingedeeld en daar hoort de app niet overheen te praten.
 */
export function stelVoor(vanaf: string, werk: WijkWerk[], bezetteDagen: Set<string>): Voorstel[] {
  const begin = new Date(`${vanaf}T12:00:00`);
  const maand = begin.getMonth();
  const uit: Voorstel[] = [];

  // De wijken die nog iets te doen hebben, in de ingestelde volgorde.
  const rij = werk.filter((w) => w.resteert > 0);
  if (rij.length === 0) return uit;

  let i = 0;
  let gedaanVoorDezeWijk = 0;
  const d = new Date(begin);

  // Niet verder dan het einde van de maand: verder vooruit is raden.
  while (d.getMonth() === maand && i < rij.length) {
    const dag = sleutel(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (!weekend && !bezetteDagen.has(dag)) {
      const w = rij[i]!;
      gedaanVoorDezeWijk += 1;
      uit.push({
        datum: dag,
        wijkId: w.wijk.id,
        naam: w.wijk.name,
        deel: gedaanVoorDezeWijk,
        van: w.dagenNodig,
      });
      if (gedaanVoorDezeWijk >= w.dagenNodig) {
        i += 1;
        gedaanVoorDezeWijk = 0;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return uit;
}
