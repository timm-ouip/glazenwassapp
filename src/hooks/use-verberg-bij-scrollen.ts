import { useEffect, useState } from "react";

/**
 * Of balken bovenin even weg mogen: scroll je omlaag, dan wil je de lijst
 * zien; scroll je een stukje omhoog, dan zoek je de knoppen weer. Zoals de
 * adresbalk van Safari. Alleen als `aan` waar is — op de computer is er
 * ruimte genoeg en blijft alles staan.
 */
export function useVerbergBijScrollen(aan: boolean): boolean {
  const [weg, setWeg] = useState(false);

  useEffect(() => {
    if (!aan) {
      setWeg(false);
      return;
    }
    let vorige = window.scrollY;
    const opScroll = () => {
      const y = window.scrollY;
      // Bovenaan altijd tonen, en kleine trillingen van de vinger negeren.
      if (y < 80) setWeg(false);
      else if (y > vorige + 10) setWeg(true);
      else if (y < vorige - 10) setWeg(false);
      else return;
      vorige = y;
    };
    window.addEventListener("scroll", opScroll, { passive: true });
    return () => window.removeEventListener("scroll", opScroll);
  }, [aan]);

  return weg;
}
