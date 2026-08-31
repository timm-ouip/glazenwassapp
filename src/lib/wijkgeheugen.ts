import { useEffect } from "react";

import type { District } from "@/lib/klanten";

/**
 * Welke wijk je het laatst open had staan. Werk je een paar dagen in
 * Madestein, dan hoor je daar bij elke paginawissel én bij de volgende keer
 * inloggen weer te landen — niet in de eerste wijk van de lijst.
 */
const SLEUTEL = "glazenwasapp.laatste-wijk";

export function laatsteWijk(): string | null {
  try {
    return localStorage.getItem(SLEUTEL);
  } catch {
    // Privémodus of geblokkeerde opslag: dan valt de app terug op de eerste wijk.
    return null;
  }
}

export function onthoudWijk(id: string) {
  try {
    localStorage.setItem(SLEUTEL, id);
  } catch {
    /* zie laatsteWijk() */
  }
}

/**
 * De wijk die de pagina moet tonen: die uit de URL, anders de onthouden
 * wijk, anders de eerste. Zet hem ook meteen in de URL — zo blijft een
 * gedeelde link kloppen — en onthoudt hem voor de volgende pagina.
 *
 * `naarWijk` doet de omleiding; elke pagina heeft eigen zoekparameters om
 * te bewaren, dus die stap blijft bij de aanroeper.
 */
export function useActieveWijk(
  districts: District[],
  wijkUitUrl: string | undefined,
  naarWijk: (id: string) => void,
): string | null {
  const bewaard = laatsteWijk();
  const actief =
    districts.find((d) => d.id === wijkUitUrl)?.id ??
    districts.find((d) => d.id === bewaard)?.id ??
    districts[0]?.id ??
    null;

  useEffect(() => {
    if (!actief) return;
    onthoudWijk(actief);
    if (wijkUitUrl !== actief) naarWijk(actief);
    // naarWijk wordt bij elke render opnieuw gemaakt; alleen de wijk telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief, wijkUitUrl]);

  return actief;
}
