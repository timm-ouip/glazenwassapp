import {
  duurVoorMaand,
  isEigenBlok,
  maandSleutel,
  prijsVoorMaand,
  toonMaand,
  type Customer,
  type District,
  type Street,
} from "@/lib/klanten";
import {
  berekenTijden,
  maakBlokken,
  opzetVan,
  tijdvakVan,
  type AdresInfo,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type StraatInfo,
  type WijkInfo,
} from "@/lib/dagplanning";
import type { Klus } from "@/lib/klussen";

/**
 * De lijsten van de wijkenpagina omzetten naar wat de rekenkern
 * (`dagplanning.ts`) nodig heeft: per adres de duur en de prijs van die
 * maand, en de straat- en wijkvolgorde.
 *
 * Dit staat apart omdat de weekweergave, de dagweergave en de dagpagina het
 * alle drie doen, en het anders drie keer net iets anders zou gebeuren.
 */
export interface Bouwstenen {
  adressen: Map<string, AdresInfo>;
  straten: Map<string, StraatInfo>;
  wijken: Map<string, WijkInfo>;
}

export function maakBouwstenen(
  customers: Customer[],
  streets: Street[],
  districts: District[],
  maand: string,
  instellingen: PlanInstellingen,
): Bouwstenen {
  const wijken = new Map<string, WijkInfo>(
    districts.map((d, i) => [
      d.id,
      { id: d.id, naam: d.name, sort_order: d.sort_order ?? i, index: i },
    ]),
  );
  const straten = new Map<string, StraatInfo>(
    streets.map((s, i) => [
      s.id,
      { id: s.id, naam: s.name, wijk_id: s.district_id, sort_order: s.sort_order ?? i },
    ]),
  );
  const adressen = new Map<string, AdresInfo>(
    customers.map((c) => [
      c.id,
      {
        id: c.id,
        street_id: c.street_id,
        sort_order: c.sort_order,
        house_number: c.house_number,
        addition: c.addition ?? "",
        naam: `${straten.get(c.street_id)?.naam ?? ""} ${c.house_number}${c.addition ?? ""}`.trim(),
        duur: duurVoorMaand(c, maand),
        bedrag: prijsVoorMaand(c, maand),
        eigenBlok: isEigenBlok(c, maand, instellingen.grootPandMin),
      },
    ]),
  );
  return { adressen, straten, wijken };
}

/** De maand waar een dag in valt, zoals maandwerk en prijzen hem lezen. */
export function maandVan(datum: string): string {
  return maandSleutel(new Date(`${datum}T12:00:00`));
}

/**
 * De ronde van een dag: die van de beurten die erop staan. Loopt september
 * uit tot 1 oktober, dan is 1 oktober een septemberdag, met het extra werk
 * en de prijzen van september. Staat er nog niets op, dan de eigen maand.
 */
export function rondeVanDag(
  regels: { datum: string; ronde?: string | undefined }[],
  datum: string,
): string {
  const tel = new Map<string, number>();
  for (const r of regels)
    if (r.datum === datum && r.ronde) tel.set(r.ronde, (tel.get(r.ronde) ?? 0) + 1);
  return [...tel].sort((a, b) => b[1] - a[1])[0]?.[0] ?? maandVan(datum);
}

/**
 * "Overslaan in september" voor deze adressen op die dag: de ronde van hun
 * eigen beurt, want dat is wat er overgeslagen wordt. Horen ze bij
 * verschillende rondes, dan zeggen we dat.
 */
export function overslaanLabel(
  regels: { customer_id: string | null; ronde?: string | undefined }[],
  ids: string[],
  datum: string,
): string {
  const wie = new Set(ids);
  const rondes = new Set(
    regels
      .filter((r) => r.customer_id && wie.has(r.customer_id))
      .map((r) => r.ronde ?? maandVan(datum)),
  );
  if (rondes.size > 1) return "Overslaan, elk in zijn eigen ronde";
  return `Overslaan in ${toonMaand([...rondes][0] ?? maandVan(datum))}`;
}

/**
 * De extra opdrachten van één dag, met hun duur. Een klus zonder eigen duur
 * telt als een kwartier: dan staat hij er wel, en zie je dat je hem een duur
 * kunt geven.
 */
export function klussenVanDag(klussen: Klus[], datum: string): DagKlus[] {
  return klussen
    .filter((k) => k.gepland_op === datum && !k.gedaan_op)
    .map((k) => ({
      id: k.id,
      customer_id: k.customer_id,
      omschrijving: k.omschrijving,
      duur: k.duur_min ?? 15,
      bedrag: k.prijs,
      ploeg_nr: k.ploeg_nr ?? null,
      volgorde: k.volgorde ?? null,
      vaste_start: k.vaste_start ?? null,
    }));
}

/**
 * Het tijdvak dat je een klant kunt beloven, per adres met een eigen blok.
 * Alleen die: bij een straat vol rijtjeshuizen is een venster van twee uur
 * een belofte die je niet waar kunt maken.
 *
 * Dezelfde rekenkern als de dagweergave, zodat wat de klant leest klopt met
 * wat er op je scherm staat.
 */
export function tijdvakkenVoorDag(
  regels: DagRegel[],
  klussen: DagKlus[],
  bouwstenen: Bouwstenen,
  ploegen: Ploeg[],
  instellingen: PlanInstellingen,
): Record<string, { van: string; tot: string }> {
  const uit: Record<string, { van: string; tot: string }> = {};
  if (!instellingen.tijdlijn || !instellingen.tijdvakMailen) return uit;
  const perPloeg = maakBlokken({
    regels,
    klussen,
    adressen: bouwstenen.adressen,
    straten: bouwstenen.straten,
    wijken: bouwstenen.wijken,
  });
  for (const [nr, blokken] of perPloeg) {
    const ploeg = ploegen.find((p) => p.nr === nr) ?? null;
    const opzet = opzetVan(instellingen, ploeg);
    const tijdlijn = berekenTijden(blokken, opzet);
    for (const item of tijdlijn.items) {
      if (item.soort !== "pand" || !item.blok) continue;
      const venster = tijdvakVan(item.start, opzet.begin);
      for (const id of item.blok.adressen) uit[id] = venster;
    }
  }
  return uit;
}
