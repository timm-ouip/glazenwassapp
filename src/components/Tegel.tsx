import type { ReactNode } from "react";
import { IconArrowUpRight as NaarRechtsBoven } from "@tabler/icons-react";

/**
 * De vakken van Home en het dashboard: een kleurvlak met een label, een groot
 * getal en een regel eronder.
 *
 * De kleuren komen uit --tegel-* in styles.css: in het thema Fel de felle
 * kleuren van het ontwerp, in crème de zachte tinten en witte kaarten. In
 * Zakelijk zijn alle vakken wit met een randje; de kleur van het vak zit daar
 * nog in één vierkantje naast het label (--tegel-*-accent, zie TegelKop).
 */
export const TEGEL_KLEUR = {
  oranje: "bg-tegel-oranje text-tegel-oranje-ink [--tegel-accent:var(--tegel-oranje-accent)]",
  creme:
    "bg-tegel-creme text-tegel-creme-ink [--tegel-accent:var(--tegel-creme-accent)] shadow-card",
  geel: "bg-tegel-geel text-tegel-geel-ink [--tegel-accent:var(--tegel-geel-accent)]",
  aqua: "bg-tegel-aqua text-tegel-aqua-ink [--tegel-accent:var(--tegel-aqua-accent)]",
  perzik: "bg-tegel-perzik text-tegel-perzik-ink [--tegel-accent:var(--tegel-perzik-accent)]",
  groen: "bg-tegel-groen text-tegel-groen-ink [--tegel-accent:var(--tegel-groen-accent)]",
  donker:
    "bg-tegel-donker text-tegel-donker-ink [--tegel-accent:var(--tegel-donker-accent)] shadow-card",
  goud: "bg-tegel-goud text-tegel-goud-ink [--tegel-accent:var(--tegel-goud-accent)]",
  paars: "bg-tegel-paars text-tegel-paars-ink [--tegel-accent:var(--tegel-paars-accent)]",
  petrol: "bg-tegel-petrol text-tegel-petrol-ink [--tegel-accent:var(--tegel-petrol-accent)]",
  ijsblauw:
    "bg-tegel-ijsblauw text-tegel-ijsblauw-ink [--tegel-accent:var(--tegel-ijsblauw-accent)]",
} as const;

export type TegelKleur = keyof typeof TEGEL_KLEUR;

/** De vorm van elk vak. Een vak dat ergens heen gaat, krijgt ook de hover. */
export const TEGEL_VAK = "flex min-w-0 flex-col rounded-[24px] zak:border zak:border-border";

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
  "h-[116px] px-4 py-3.5 md:h-[180px] md:rounded-[26px] md:px-5 md:py-[18px] zak:h-[104px] zak:px-4 zak:py-3 zak:md:h-[136px] zak:md:px-[18px] zak:md:py-4";

/** Het label bovenaan een vak. Met een pijltje als het vak ergens heen gaat.
 *  In Zakelijk staat er een gekleurd vierkantje voor: de vakken zijn daar wit,
 *  en dit is wat er van de kleur van het vak overblijft. */
export function TegelKop({ label, pijl = true }: { label: string; pijl?: boolean }) {
  return (
    <span className="flex items-center justify-between gap-2 text-[13px] font-semibold md:text-[14px] zak:text-[10.5px] zak:font-bold zak:uppercase zak:tracking-[0.08em] zak:text-muted-foreground zak:md:text-[11px]">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="hidden size-[9px] shrink-0 rounded-[3px] bg-[var(--tegel-accent)] zak:block"
        />
        <span className="truncate">{label}</span>
      </span>
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
      } ${klein ? "text-[30px] md:text-[40px] zak:text-[22px] zak:md:text-[26px]" : "text-[38px] md:text-[56px] zak:text-[26px] zak:md:text-[32px]"} zak:tracking-[-0.02em]`}
    >
      {children}
    </span>
  );
}

export function TegelOnder({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 truncate text-[12px] opacity-90 md:mt-1.5 md:text-[13px] zak:text-[11.5px] zak:text-muted-foreground zak:opacity-100 zak:md:text-[12px]">
      {children}
    </span>
  );
}
