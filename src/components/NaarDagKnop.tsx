import { Link } from "@tanstack/react-router";
import { IconCash as Cash, IconListCheck as ListChecks } from "@tabler/icons-react";

/**
 * Staat de dagplanning op slot, dan zweeft rechtsonder een knop die in één
 * tik terug gaat naar de route van vandaag — op de plek waar je was. Wanneer
 * hij er staat, beslist AppLayout (die houdt er onderaan ook ruimte voor).
 *
 * Hij staat recht boven de Paaltje-knop, die al rechtsonder zit; op de
 * telefoon dus ook boven de tabs en de duimbalk (samen --onderrand).
 */
export function NaarDagKnop() {
  return (
    <Link
      to="/dag"
      aria-label="Naar de dag van vandaag"
      title="Naar de dag van vandaag"
      className={ZWEVEND}
    >
      <ListChecks className="size-6" stroke={2.2} aria-hidden="true" />
    </Link>
  );
}

/**
 * Hetzelfde voor het geldlopen: staat dat op slot, dan brengt deze knop je in
 * één tik terug in de straat waar je was (het loopscherm onthoudt die).
 */
export function NaarLopenKnop() {
  return (
    <Link
      to="/betalingen"
      search={{ tab: "lopen" }}
      aria-label="Terug naar het geldlopen"
      title="Terug naar het geldlopen"
      className={ZWEVEND}
    >
      <Cash className="size-6" stroke={2.2} aria-hidden="true" />
    </Link>
  );
}

// Paaltje is 4rem breed en staat 1rem van de rand; deze is 3.5rem, dus 0.25rem
// verder naar binnen om er netjes midden boven te staan.
const ZWEVEND =
  "fixed bottom-[calc(var(--onderrand,0px)+5.5rem)] right-[calc(1.25rem+env(safe-area-inset-right))] z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_14px_oklch(0.4_0.02_70/25%)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 md:bottom-[calc(6rem+env(safe-area-inset-bottom))] md:right-[calc(1.5rem+env(safe-area-inset-right))] print:hidden";
