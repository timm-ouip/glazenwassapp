import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Het onderste stuk van het witte vak (Wijken, Klanten lopen): het bakje met
 * de zoekbalk en de knoppen. Zolang de tegels
 * erboven staan, sluit het daar recht op aan; blijft het bij het scrollen
 * plakken, dan valt het witte vak weg en zweeft alleen het bakje, wit, onder
 * de kop. Anders hangt er een recht afgesneden stuk vak tegen de kop aan.
 */
export function PlakVak({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [plakt, setPlakt] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const balk = el?.parentElement;
    if (!el || !balk) return;
    const meet = () => {
      const rand = parseFloat(getComputedStyle(balk).top) || 0;
      setPlakt(window.scrollY > 0 && balk.getBoundingClientRect().top <= rand + 0.5);
    };
    meet();
    window.addEventListener("scroll", meet, { passive: true });
    window.addEventListener("resize", meet);
    return () => {
      window.removeEventListener("scroll", meet);
      window.removeEventListener("resize", meet);
    };
  }, []);
  return (
    // Plakt hij, dan valt de witte rand onder het bakje weg, en ook bijna
    // alle lucht eronder: anders ligt er een brede strook over de lijst. Dat
    // kan geen heen-en-weer geven: waar hij gaat plakken hangt af van wat
    // erboven staat, niet van zijn eigen hoogte.
    <div
      ref={ref}
      data-plakt={plakt ? "" : undefined}
      className={`group/plak rounded-b-[24px] px-4 md:px-[22px] ${
        plakt ? "-mb-2 pb-0" : "bg-card pb-4 md:pb-[22px]"
      }`}
    >
      {children}
    </div>
  );
}
