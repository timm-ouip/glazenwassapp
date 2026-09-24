import { useCallback, useState } from "react";

import { effectieveMethode } from "@/lib/betalingen";
import type { Customer, District, Street } from "@/lib/klanten";

/**
 * Contant, overmaken of allebei — de scheiding tussen het geld dat je aan de
 * deur ophaalt en het geld dat op een factuur binnenkomt.
 *
 * De keuze hoort bij het toestel, niet bij het account: het is een manier van
 * kijken, geen instelling van het bedrijf. Standaard staat alles aan, zodat je
 * binnenkomt op je hele omzet en niet schrikt van een half getal.
 */
export type Geldkeuze = "allebei" | "contant" | "overmaken";

const SLEUTEL = "wooshy.geldfilter";

export function useGeldfilter(): [Geldkeuze, (k: Geldkeuze) => void] {
  const [keuze, setKeuze] = useState<Geldkeuze>(() => {
    try {
      const x = localStorage.getItem(SLEUTEL);
      return x === "contant" || x === "overmaken" ? x : "allebei";
    } catch {
      // Privémodus of geblokkeerde opslag: dan gewoon alles tonen.
      return "allebei";
    }
  });
  const zet = useCallback((k: Geldkeuze) => {
    setKeuze(k);
    try {
      if (k === "allebei") localStorage.removeItem(SLEUTEL);
      else localStorage.setItem(SLEUTEL, k);
    } catch {
      // Niet kunnen onthouden is geen reden om niet te kunnen kiezen.
    }
  }, []);
  return [keuze, zet];
}

/**
 * Hoort dit bedrag bij wat je nu wilt zien? `contant` is null bij een adres
 * dat we niet meer kennen (weggegooid); dat telt alleen mee bij "allebei",
 * want anders zou het stilletjes bij één van de twee opgeteld worden.
 */
export function teltMee(keuze: Geldkeuze, contant: boolean | null | undefined): boolean {
  if (keuze === "allebei") return true;
  if (contant === true) return keuze === "contant";
  if (contant === false) return keuze === "overmaken";
  return false;
}

/** Wat we van één adres moeten weten om de omzet te kunnen verdelen. */
export interface Adresgeld {
  /** In welke wijk het adres ligt; leeg als die wijk er niet meer is. */
  wijkId: string | null;
  /** Betaalt dit adres contant? Zijn eigen keuze, anders die van de wijk. */
  contant: boolean;
}

/**
 * Van elk adres: waar het ligt en hoe het betaalt. Een adres dat hier niet in
 * staat, kennen we niet meer — dat is iets anders dan "contant", en daarom
 * telt het verderop bij geen van beide mee.
 */
export function adresgeldMap(
  customers: Pick<Customer, "id" | "street_id" | "betaalmethode">[],
  streets: Pick<Street, "id" | "district_id">[],
  districts: Pick<District, "id" | "betaalmethode">[],
): Map<string, Adresgeld> {
  const wijkVan = new Map(districts.map((d) => [d.id, d]));
  const straatVan = new Map(streets.map((s) => [s.id, s]));
  const info = new Map<string, Adresgeld>();
  for (const c of customers) {
    const wijk = wijkVan.get(straatVan.get(c.street_id)?.district_id ?? "");
    info.set(c.id, {
      wijkId: wijk?.id ?? null,
      contant: effectieveMethode(c, wijk) === "contant",
    });
  }
  return info;
}

/**
 * Betaalde dit werk contant? De bij het afmelden vastgelegde methode gaat
 * voor; alleen als die er niet is (oude regels, en extra opdrachten) kijken
 * we naar hoe het adres nu staat. Null = niet te zeggen, bijvoorbeeld bij een
 * adres dat intussen weggegooid is.
 */
export function contantVan(
  p: { customer_id: string | null; methode: "contant" | "overmaken" | null },
  adresgeld: Map<string, Adresgeld> | null | undefined,
): boolean | null {
  if (p.methode) return p.methode === "contant";
  const info = p.customer_id ? adresgeld?.get(p.customer_id) : undefined;
  return info?.contant ?? null;
}
