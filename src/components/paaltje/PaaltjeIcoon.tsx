/**
 * Paaltje zelf: een paaltje met een matje.
 *
 * Getekend met `currentColor`, zodat hij het net zo goed doet als lichte
 * tekening op de donkere knop als donker in de kop van het paneel. Bewust
 * weinig lijnen: op 24 pixels moeten de paal en het matje het verhaal
 * vertellen, niet de details.
 */
export function PaaltjeIcoon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="5 3 14 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* De paal, met de voet waar hij op staat. */}
      <path d="M8.5 20V9.5a3.5 3.5 0 0 1 7 0V20" />
      <path d="M6 20h12" />
      {/* De kuif bovenop en het matje in de nek. */}
      <path
        d="M8.5 10.4a3.5 3.5 0 0 1 7 0c-.9-.9-2.1-1.4-3.5-1.4s-2.6.5-3.5 1.4z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M8.6 10.8c-1.2 1.9-1.7 4-1.6 6.3.9-.4 1.6-1.1 2-2M15.4 10.8c1.2 1.9 1.7 4 1.6 6.3-.9-.4-1.6-1.1-2-2"
        fill="currentColor"
        stroke="none"
      />
      {/* Ogen en een tevreden mond. */}
      <path d="M10.6 13.2h.01M13.4 13.2h.01" strokeWidth="2.6" />
      <path d="M10.6 16c.8.6 2 .6 2.8 0" />
    </svg>
  );
}
