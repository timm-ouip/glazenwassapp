import { useCallback, useEffect, useRef } from "react";

/**
 * Een callback die zijn identiteit houdt, maar wel altijd de nieuwste waarden
 * ziet.
 *
 * Waarom dit bestaat: de wijklijst telt honderden regels, en elke regel krijgt
 * een handvol handlers mee. Zijn dat elke render nieuwe functies, dan kan
 * `memo` op een regel niets uitrichten en tekent de browser bij elke wijziging
 * de héle wijk opnieuw — seconden werk voor het verzetten van één prijs.
 *
 * De functie wordt na de commit in de ref gezet. Handlers vuren daarna, dus
 * ze zien nooit een verouderde versie. Gebruik dit dan ook alleen voor
 * gebeurtenissen, niet voor iets dat tijdens het renderen aangeroepen wordt.
 */
export function useStabiel<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
