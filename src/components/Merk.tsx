import { useEffect, useState, type ReactNode } from "react";

import { MERKPLATEN, WOORDMERK_DONKER, WOORDMERK_LICHT, type Merkplaat } from "@/lib/merk";

// Het merk van de app: de naam en de plaat op het inlogscherm en op een
// uitnodiging. Alleen voor schermen van de app zelf; wat klanten zien draagt
// de naam van het bedrijf.

/**
 * Elke keer dat je het inlogscherm opent een andere plaat.
 *
 * De keuze valt pas ná het opbouwen van de pagina: de server weet niet welke
 * het wordt, en zou hij zelf gokken dan zou de browser hem meteen weer
 * omgooien. Tot die tijd is er alleen de effen grondkleur; plaat en naam
 * komen er samen invloeien.
 */
function useMerkplaat(): Merkplaat | null {
  const [plaat, setPlaat] = useState<Merkplaat | null>(null);
  useEffect(() => {
    setPlaat(MERKPLATEN[Math.floor(Math.random() * MERKPLATEN.length)] ?? null);
  }, []);
  return plaat;
}

/**
 * De naam van de app, in de letter van het merk.
 *
 * Ligt hij op een merkplaat, dan zegt die plaat welke letters erbij horen.
 * Staat hij op een gewone kaart, dan hangt het van het thema af: zwarte
 * letters op een lichte kaart, crème op een donkere. Dat zijn twee bestanden
 * en geen omgekleurd plaatje, en de keuze valt in CSS — de server weet nog
 * niet of het licht of donker wordt.
 */
export function Woordmerk({ bron, className = "" }: { bron?: string; className?: string }) {
  if (bron !== undefined) {
    return <img src={bron} alt="Paaltje Systems" className={`w-auto ${className}`} />;
  }
  // De naam hangt aan het omhulsel en niet aan een van de twee plaatjes: het
  // plaatje dat hem zou dragen is juist het plaatje dat in het donker
  // verborgen is, en dan hoort een schermlezer de naam helemaal niet.
  return (
    <span role="img" aria-label="Paaltje Systems" className="contents">
      <img src={WOORDMERK_DONKER} alt="" className={`w-auto dark:hidden ${className}`} />
      <img src={WOORDMERK_LICHT} alt="" className={`hidden w-auto dark:block ${className}`} />
    </span>
  );
}

/**
 * Het hele scherm als merkplaat, met de naam erboven en een witte kaart
 * erop: het inlogscherm, en straks alles wat daarop lijkt.
 *
 * De kaart is wit in elk thema, ook in het donker — de plaat is dat immers
 * ook. Dat staat bij `.merkvlak` in src/styles.css.
 */
export function Merkvlak({ children }: { children: ReactNode }) {
  const plaat = useMerkplaat();
  const zichtbaar = plaat !== null;
  return (
    <div
      className="merkvlak relative flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10 transition-colors duration-700"
      style={{ backgroundColor: plaat?.grond ?? MERKPLATEN[0]?.grond }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700"
        style={{
          backgroundImage: plaat ? `url(${plaat.plaat})` : undefined,
          opacity: zichtbaar ? 1 : 0,
        }}
      />
      {/* Alleen waar de plaat erom vraagt een zachte waas in zijn eigen
          grondkleur achter de naam — zie `waas` in src/lib/merk.ts. */}
      <div
        className="relative flex items-center justify-center px-[72px] py-10 transition-opacity duration-700"
        style={{
          opacity: zichtbaar ? 1 : 0,
          ...(plaat?.waas
            ? {
                backgroundImage: `radial-gradient(58% 150% at 50% 50%, ${plaat.grond} 24%, transparent 80%)`,
              }
            : {}),
        }}
      >
        <Woordmerk {...(plaat ? { bron: plaat.woordmerk } : {})} className="h-14 md:h-20" />
      </div>
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
