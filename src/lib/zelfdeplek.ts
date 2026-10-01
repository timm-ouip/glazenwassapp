import { useEffect, useRef } from "react";

/**
 * Terug op dezelfde plek (de dag, het geldlopen): ga je naar een klant, een
 * wijk of een andere pagina en kom je terug (met een link, de knop of de
 * terugknop), dan sta je weer bij dezelfde straat of hetzelfde adres. Wat als
 * anker telt, zegt `anker`: elk element met `data-<anker>="<id>"`. Bewaard
 * wordt welk anker bovenin stond en hoe ver van de bovenrand; dat blijft
 * kloppen als er intussen een adres bij of af kwam. Een andere `sleutel` (een andere dag of avond) heeft zijn
 * eigen plek en begint bovenaan.
 *
 * De lijst scrolt met de pagina zelf mee (er is geen eigen scrollvak). Wat
 * erboven staat (bij de dag: Dag klaar, de vergeten-strook) laadt soms later
 * en duwt de lijst omlaag; daarom houden we het anker op zijn plek tot je zelf de
 * pagina aanraakt, of tot er anderhalve tel niets meer verschoven is.
 */
export function useZelfdePlek(
  sleutel: string,
  klaar: boolean,
  anker = "dagstraat",
  /** Stond het bewaarde anker er niet meer (en ook niet na even wachten)? */
  nietGevonden?: () => void,
) {
  const nietGevondenRef = useRef(nietGevonden);
  useEffect(() => {
    nietGevondenRef.current = nietGevonden;
  });
  useEffect(() => {
    if (!klaar) return;
    let plek: { straat: string; boven: number } | null = null;
    try {
      plek = JSON.parse(sessionStorage.getItem(sleutel) ?? "null");
    } catch {
      // Geen opslag of iets onleesbaars: dan gewoon bovenaan.
    }

    let herstellen = plek !== null;
    const begin = performance.now();
    // Rust: na de laatste verschuiving. Hoe dan ook: na tien tellen stoppen.
    let rust = begin + 2500;
    let frame = 0;
    let gevonden = false;
    const zet = () => {
      const nu = performance.now();
      if (!herstellen || nu > rust || nu > begin + 10_000) {
        // Nooit gevonden en niet door jou onderbroken: dan mag de pagina
        // zelf iets kiezen, in plaats van je bovenaan te laten staan.
        if (herstellen && !gevonden) nietGevondenRef.current?.();
        herstellen = false;
        return;
      }
      const el = document.querySelector(`[data-${anker}="${CSS.escape(plek!.straat)}"]`);
      if (!el) {
        // Nog niet te zien (de keuze "alleen mijn team" komt net terug), of
        // hij staat er niet meer op: even blijven kijken, dan met rust laten.
        frame = requestAnimationFrame(zet);
        return;
      }
      gevonden = true;
      const verschil = el.getBoundingClientRect().top - plek!.boven;
      if (Math.abs(verschil) > 1) {
        const was = window.scrollY;
        window.scrollBy(0, verschil);
        // Kon hij niet verder (de pagina is te kort), dan telt het niet als
        // verschuiving: anders blijft hij het tot de tien tellen proberen.
        if (window.scrollY !== was) rust = nu + 1500;
      }
      frame = requestAnimationFrame(zet);
    };
    if (herstellen) frame = requestAnimationFrame(zet);
    const stop = () => {
      herstellen = false;
    };

    let bewaarFrame = 0;
    const bewaar = () => {
      if (herstellen) return;
      cancelAnimationFrame(bewaarFrame);
      bewaarFrame = requestAnimationFrame(() => {
        // De eerste straat die nog (deels) in beeld is.
        for (const el of document.querySelectorAll<HTMLElement>(`[data-${anker}]`)) {
          const { top, bottom } = el.getBoundingClientRect();
          if (bottom <= 0) continue;
          try {
            sessionStorage.setItem(
              sleutel,
              JSON.stringify({ straat: el.getAttribute(`data-${anker}`), boven: Math.round(top) }),
            );
          } catch {
            // Niet te bewaren; dan begin je de volgende keer bovenaan.
          }
          return;
        }
      });
    };

    const invoer = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const soort of invoer) window.addEventListener(soort, stop, { passive: true });
    window.addEventListener("scroll", bewaar, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(bewaarFrame);
      for (const soort of invoer) window.removeEventListener(soort, stop);
      window.removeEventListener("scroll", bewaar);
    };
  }, [sleutel, klaar, anker]);
}

/** Is er voor deze sleutel een plek bewaard (dan zet de hook hem terug)? */
export function heeftPlek(sleutel: string): boolean {
  try {
    return sessionStorage.getItem(sleutel) !== null;
  } catch {
    return false;
  }
}
