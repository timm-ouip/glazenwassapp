// Het merk van de app: de naam op het inlogscherm en op een uitnodiging.
// Alleen voor schermen van de app zelf; wat klanten zien draagt de naam van
// het bedrijf.

/**
 * De naam, in de letter van de app. Dit was een plaatje
 * (`/wooshy-woordmerk.png`), maar dat plaatje zegt nog "Wooshy" en er is nog
 * geen nieuw logo. Tot dat er is, zetten we de naam gewoon als tekst — dan
 * klopt hij in elk geval, en schaalt hij mee met het thema.
 */
export function Woordmerk({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center font-display text-[26px] font-semibold leading-none tracking-[-0.03em] ${className}`}
    >
      Paaltje Systems
    </span>
  );
}
