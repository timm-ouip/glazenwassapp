import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * De uitgeknipte vormen op de vakken van Fel: een vlek, een blad, een
 * palmblad, golven, een slinger, een bloem, schelpen en een wig. Ze liggen
 * áchter de tekst van het vak, lopen van de rand af (je ziet er een stuk van)
 * en hebben zelf geen betekenis — vandaar aria-hidden.
 *
 * De kleur komt uit --vorm-kleur, die elk vak meekrijgt via TEGEL_KLEUR in
 * Tegel.tsx (--tegel-*-vorm in styles.css). Staat die er niet, dan is de vorm
 * doorzichtig en zie je niets: zo kan een vak nooit per ongeluk een kleur
 * krijgen die de tekst erop onleesbaar maakt.
 *
 * In het thema Zakelijk zijn ze er niet, en je kunt ze in Instellingen
 * helemaal uitzetten; beide regelt styles.css met een klasse op de pagina.
 */
export type VormNaam =
  "vlek" | "blad" | "palmblad" | "golven" | "slinger" | "bloem" | "schelpen" | "wig";

type Tekening = {
  doos: string;
  /** Een vorm die over de volle breedte meerekt in plaats van zijn maat te houden. */
  rekt?: boolean;
  teken: ReactNode;
};

const VORMEN: Record<VormNaam, Tekening> = {
  vlek: {
    doos: "0 0 200 200",
    teken: (
      <path
        fill="currentColor"
        d="M104 6c46-6 92 28 94 74s-32 94-78 106S22 172 14 126 58 12 104 6Z"
      />
    ),
  },
  blad: {
    doos: "0 0 200 200",
    teken: <path fill="currentColor" d="M10 190C10 96 96 10 190 10c0 94-86 180-180 180Z" />,
  },
  palmblad: {
    doos: "0 0 200 200",
    teken: (
      <g fill="currentColor" transform="translate(186,196)">
        <ellipse cx="0" cy="-80" rx="15" ry="82" transform="rotate(-8)" />
        <ellipse cx="0" cy="-80" rx="15" ry="82" transform="rotate(-32)" />
        <ellipse cx="0" cy="-80" rx="15" ry="82" transform="rotate(-56)" />
        <ellipse cx="0" cy="-80" rx="15" ry="82" transform="rotate(-80)" />
      </g>
    ),
  },
  golven: {
    doos: "0 0 240 120",
    rekt: true,
    teken: (
      <g fill="none" stroke="currentColor" strokeWidth="22" strokeLinecap="round">
        <path d="M-20 42C20 2 60 82 100 42S180 2 260 42" />
        <path d="M-20 92C20 52 60 132 100 92S180 52 260 92" />
      </g>
    ),
  },
  slinger: {
    doos: "0 0 170 230",
    teken: (
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="40"
        strokeLinecap="round"
        d="M40 210C40 150 150 160 150 110S40 80 40 20"
      />
    ),
  },
  bloem: {
    doos: "0 0 200 200",
    teken: (
      <g fill="currentColor">
        <ellipse cx="100" cy="56" rx="25" ry="56" />
        <ellipse cx="100" cy="56" rx="25" ry="56" transform="rotate(60 100 100)" />
        <ellipse cx="100" cy="56" rx="25" ry="56" transform="rotate(120 100 100)" />
        <ellipse cx="100" cy="56" rx="25" ry="56" transform="rotate(180 100 100)" />
        <ellipse cx="100" cy="56" rx="25" ry="56" transform="rotate(240 100 100)" />
        <ellipse cx="100" cy="56" rx="25" ry="56" transform="rotate(300 100 100)" />
      </g>
    ),
  },
  schelpen: {
    doos: "0 0 190 150",
    teken: (
      <g fill="currentColor">
        <circle cx="30" cy="120" r="34" />
        <circle cx="76" cy="96" r="34" />
        <circle cx="122" cy="72" r="34" />
        <circle cx="168" cy="48" r="34" />
      </g>
    ),
  },
  wig: {
    doos: "0 0 240 130",
    rekt: true,
    teken: <path fill="currentColor" d="M0 130V52C80-14 240 16 240 130Z" />,
  },
};

/**
 * Zet een vorm op een vak. Het vak eromheen moet zijn randen afknippen
 * (overflow-hidden) — dat doen de vakken van Home al.
 *
 * `plek` zijn de plaatsklassen: waar hij hangt en hoe groot hij is. Per vak
 * een andere hoek, anders wordt het een stempel.
 */
export function Vorm({ naam, plek }: { naam: VormNaam; plek: string }) {
  const vorm = VORMEN[naam];
  return (
    <span aria-hidden="true" className={cn("vak-vorm", plek)}>
      <svg
        viewBox={vorm.doos}
        preserveAspectRatio={vorm.rekt ? "none" : undefined}
        className="block size-full"
      >
        {vorm.teken}
      </svg>
    </span>
  );
}
