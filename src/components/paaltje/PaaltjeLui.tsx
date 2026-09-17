/**
 * Paaltje-plaatje dat pas geladen wordt als het scherm er al staat.
 *
 * De tekening en de animaties zitten in een apart stukje code
 * (`PaaltjeFiguur.tsx`). Dat halen we pas op als de pagina klaar is met laden
 * en de browser even niets te doen heeft, zodat Paaltje het openen van een
 * scherm nooit vertraagt. Tot die tijd staat er een rustig groen vlak.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const PaaltjeFiguur = lazy(() => import("@/components/paaltje/PaaltjeFiguur"));

// Eén keer voor de hele app: is er al eens gewacht, dan tonen plaatjes die
// later verschijnen (het paneel opent opnieuw) de tekening meteen. Bij de
// eerste render na de server is dit altijd nog `false`, dus dat botst niet.
let alGeladen = false;

/** Wordt `true` zodra de pagina geladen is en de browser even vrij is. */
function useNaHetLaden(): boolean {
  const [klaar, setKlaar] = useState(alGeladen);
  useEffect(() => {
    if (alGeladen) return;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gereed = () => {
      alGeladen = true;
      setKlaar(true);
    };
    const start = () => {
      if ("requestIdleCallback" in window) {
        idle = window.requestIdleCallback(gereed, { timeout: 2000 });
      } else {
        timer = setTimeout(gereed, 300);
      }
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return klaar;
}

export function PaaltjeLui({
  beweegt = false,
  className,
}: {
  beweegt?: boolean;
  className?: string;
}) {
  const klaar = useNaHetLaden();
  const vlak = <span className={cn("block bg-[#2f6b56]", className)} aria-hidden="true" />;
  if (!klaar) return vlak;
  return (
    <Suspense fallback={vlak}>
      <PaaltjeFiguur beweegt={beweegt} className={cn("block", className)} />
    </Suspense>
  );
}
