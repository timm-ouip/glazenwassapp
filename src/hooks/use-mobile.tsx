import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/** Pas na de eerste keer tekenen in de browser mogen we de breedte meteen
 *  gebruiken. Daarvoor moet het eerste beeld gelijk zijn aan dat van de
 *  server (die geen scherm heeft), anders klaagt React en tekent hij alles
 *  opnieuw. */
let gehydrateerd = false;

export function useIsMobile() {
  // Na het laden meteen de echte breedte, zodat een pagina waar je naartoe
  // navigeert op de telefoon niet eerst de computerweergave tekent.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined" || !gehydrateerd
      ? undefined
      : window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    gehydrateerd = true;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
