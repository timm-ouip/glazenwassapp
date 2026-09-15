// Het Wooshy-merk: de druppel (app-icoon) en het woordlogo. Alleen voor
// schermen van de app zelf; wat klanten zien draagt de naam van het bedrijf.

export function Druppel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <path
        fill="#3551E0"
        d="M50 12 C44 21 38 28 33 35 C28 42 27 48 27 55 A23 23 0 0 0 73 55 C73 48 72 42 67 35 C62 28 56 21 50 12 Z"
      />
    </svg>
  );
}

export function Woordmerk({ className = "" }: { className?: string }) {
  return (
    // In het donker wit: het merkblauw verzuipt op een donkere kaart.
    <img
      src="/wooshy-woordmerk.png"
      alt="Wooshy"
      className={`w-auto dark:brightness-0 dark:invert ${className}`}
    />
  );
}
