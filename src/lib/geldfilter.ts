import { useCallback, useState } from "react";

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
