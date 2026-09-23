import type { ReactNode } from "react";
import { IconArrowUpRight as NaarRechtsBoven } from "@tabler/icons-react";

/**
 * De vakken van Home en het dashboard: een kleurvlak met een label, een groot
 * getal en een regel eronder.
 *
 * De kleuren komen uit --tegel-* in styles.css: in het thema Fel de felle
 * kleuren van het ontwerp, in crème de zachte tinten en witte kaarten.
 */
export const TEGEL_KLEUR = {
  oranje: "bg-tegel-oranje text-tegel-oranje-ink",
  creme: "bg-tegel-creme text-tegel-creme-ink shadow-card",
  geel: "bg-tegel-geel text-tegel-geel-ink",
  aqua: "bg-tegel-aqua text-tegel-aqua-ink",
  perzik: "bg-tegel-perzik text-tegel-perzik-ink",
  groen: "bg-tegel-groen text-tegel-groen-ink",
  donker: "bg-tegel-donker text-tegel-donker-ink shadow-card",
  goud: "bg-tegel-goud text-tegel-goud-ink",
  paars: "bg-tegel-paars text-tegel-paars-ink",
  petrol: "bg-tegel-petrol text-tegel-petrol-ink",
  ijsblauw: "bg-tegel-ijsblauw text-tegel-ijsblauw-ink",
} as const;

export type TegelKleur = keyof typeof TEGEL_KLEUR;

/** De vorm van elk vak. Een vak dat ergens heen gaat, krijgt ook de hover. */
export const TEGEL_VAK = "flex min-w-0 flex-col rounded-[24px]";

/**
 * Wat een vak doet als je het kunt aanklikken: hij tilt op als je eroverheen
 * gaat, en er loopt een golf weg vanaf de plek waar je hem indrukt (die zet
 * src/lib/golf.ts neer, aan de klasse `tegel-golf`). Een vak dat alleen een
 * getal laat zien krijgt dit niet: dat zou beloven dat er iets gebeurt.
 */
export const TEGEL_KLIKBAAR =
  "tegel-golf relative overflow-hidden outline-none transition-[translate,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-tegel active:translate-y-0 active:duration-75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Een gewoon vak in het rooster: klein op de telefoon, hoog op de computer. */
export const TEGEL_GEWOON =
  "h-[116px] px-4 py-3.5 md:h-[180px] md:rounded-[26px] md:px-5 md:py-[18px]";

/** Het label bovenaan een vak. Met een pijltje als het vak ergens heen gaat. */
export function TegelKop({ label, pijl = true }: { label: string; pijl?: boolean }) {
  return (
    <span className="flex items-center justify-between gap-2 text-[13px] font-semibold md:text-[14px]">
      {label}
      {pijl && <NaarRechtsBoven className="size-4 shrink-0 md:size-[18px]" aria-hidden="true" />}
    </span>
  );
}

export function TegelGetal({
  children,
  klein,
  knippen = true,
}: {
  children: ReactNode;
  klein?: boolean;
  /** Uit voor een bedrag met iets wat erboven zweeft: afknippen verbergt dat. */
  knippen?: boolean;
}) {
  return (
    <span
      className={`mt-auto font-display font-semibold leading-none tracking-[-0.045em] tabular-nums ${
        knippen ? "truncate" : "whitespace-nowrap"
      } ${klein ? "text-[30px] md:text-[40px]" : "text-[38px] md:text-[56px]"}`}
    >
      {children}
    </span>
  );
}

export function TegelOnder({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 truncate text-[12px] opacity-90 md:mt-1.5 md:text-[13px]">
      {children}
    </span>
  );
}
