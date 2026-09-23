import type { ReactNode } from "react";

import { TEGEL_KLEUR, TEGEL_VAK, type TegelKleur } from "@/components/Tegel";
import { cn } from "@/lib/utils";

/**
 * De grafieken van het dashboard: staven, balken, een lijn en twee reeksen op
 * elkaar. Allemaal dezelfde afspraken:
 *
 * - één reeks heeft geen legenda; de titel zegt al wat je ziet.
 * - elk vak heeft één kleur voor de reeks en oranje voor de maand van nu; de
 *   pagina zet die kleuren met --grafiek-rustig en --grafiek-accent.
 * - onder de muis staat het bedrag of het aantal (title), en een schermlezer
 *   krijgt de hele reeks als één zin voorgelezen.
 * - de lijn onderaan is de nullijn; er staan geen hulplijnen te veel.
 */
export interface Punt {
  /** Wat eronder staat: "jan". */
  kort: string;
  /** Wat je ziet als je erover gaat: "januari: € 7.240". */
  tip: string;
  /** Hoe hoog of hoe breed, van 0 tot 1. */
  deel: number;
  /** De laatste maand (of de grootste) krijgt de kleur. */
  accent?: boolean;
}

/**
 * Het vak waar een grafiek in ligt. Het heeft dezelfde kleuren als de vakken
 * op Home: in Fel een kleurvlak, in Zakelijk een witte kaart met een randje.
 * De kleur van de staven zet de pagina er zelf bij, met --grafiek-rustig en
 * --grafiek-accent in de className.
 */
export function Paneel({
  titel,
  extra,
  kleur = "donker",
  className,
  children,
}: {
  titel: string;
  /** Rechtsboven: een totaal, een uitschieter of een legenda. */
  extra?: ReactNode;
  /** Welk kleurvlak dit vak is; standaard het donkere. */
  kleur?: TegelKleur;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={titel}
      className={cn(
        TEGEL_VAK,
        TEGEL_KLEUR[kleur],
        // De schaduw hoort bij het vak en niet bij de kleur: anders zweven op
        // dezelfde pagina twee panelen wel en de rest niet.
        "shadow-card gap-3 p-4 md:rounded-[26px] md:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13.5px] font-semibold md:text-[14px]">{titel}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** Kleine grijze tekst in de kop van een paneel. */
export function PaneelExtra({ children }: { children: ReactNode }) {
  return <span className="text-[12px] opacity-70 md:text-[12.5px]">{children}</span>;
}

function Maandlabels({ punten }: { punten: Punt[] }) {
  return (
    <div aria-hidden="true" className="flex gap-[2px] pt-1.5">
      {punten.map((p) => (
        <span
          key={p.kort}
          className={cn(
            "flex-1 basis-0 text-center text-[10.5px] md:text-[11px]",
            !p.accent && "opacity-70",
          )}
        >
          {p.kort}
        </span>
      ))}
    </div>
  );
}

/** Staven naast elkaar, bijvoorbeeld de omzet per maand. */
export function Staven({
  punten,
  beschrijving,
  asLabels,
  hoogte = "h-[130px] md:h-[150px]",
  kleur = "bg-grafiek-rustig",
}: {
  punten: Punt[];
  /** De hele reeks in één zin, voor wie de grafiek niet ziet. */
  beschrijving: string;
  /** Drie bedragen langs de zijkant: bovenaan, in het midden, onderaan. */
  asLabels?: [string, string, string];
  hoogte?: string;
  /** De kleur van de staven; klachten krijgen bijvoorbeeld rood. */
  kleur?: string;
}) {
  return (
    <div className="flex gap-2.5">
      {asLabels && (
        <div
          aria-hidden="true"
          className={cn(
            "hidden flex-col justify-between pb-5 text-right text-[10.5px] opacity-70 sm:flex",
            hoogte,
          )}
        >
          {asLabels.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("relative", hoogte)}>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 border-t border-current opacity-10"
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-1/2 border-t border-current opacity-10"
          />
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 border-t border-current opacity-25"
          />
          <div
            role="img"
            aria-label={beschrijving}
            className="absolute inset-0 flex items-end gap-[2px]"
          >
            {punten.map((p) => (
              <span
                key={p.kort}
                title={p.tip}
                className="flex h-full flex-1 flex-col justify-end px-[3px] md:px-1.5"
              >
                <span
                  className={cn("block rounded-t-[4px]", p.accent ? "bg-grafiek-accent" : kleur)}
                  style={{ height: p.deel > 0 ? `${Math.max(2, p.deel * 100)}%` : "0" }}
                />
              </span>
            ))}
          </div>
        </div>
        <Maandlabels punten={punten} />
      </div>
    </div>
  );
}

/** Balken onder elkaar met hun naam en bedrag, bijvoorbeeld per wijk. */
export function Balken({
  rijen,
  beschrijving,
  kleur = "bg-tint-blauw-mid",
}: {
  rijen: { naam: string; waarde: string; deel: number; tip: string }[];
  beschrijving: string;
  /** De kleur van de balken. */
  kleur?: string;
}) {
  return (
    <div role="img" aria-label={beschrijving} className="flex flex-col justify-center gap-3">
      {rijen.map((r) => (
        <span key={r.naam} title={r.tip} className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2 text-[12.5px] md:text-[13px]">
            <span className="truncate">{r.naam}</span>
            <span className="font-display text-[13px] font-semibold tabular-nums md:text-[14px]">
              {r.waarde}
            </span>
          </span>
          <span className="block h-2.5 rounded-full bg-muted">
            <span
              className={cn("block h-2.5 rounded-full", kleur)}
              style={{ width: `${Math.max(2, r.deel * 100)}%` }}
            />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Een lijn met een bolletje per maand, bijvoorbeeld hoeveel adressen je deed. */
export function Lijn({
  punten,
  beschrijving,
  hoogte = "h-[120px] md:h-[140px]",
  kleur,
}: {
  punten: Punt[];
  beschrijving: string;
  hoogte?: string;
  /** De kleur van de lijn, als tekstklasse; zonder is het de inkt van het vak. */
  kleur?: string;
}) {
  const stap = 100 / Math.max(1, punten.length);
  const lijn = punten
    .map((p, i) => `${(stap * (i + 0.5)).toFixed(2)},${(100 - p.deel * 88 - 6).toFixed(2)}`)
    .join(" ");
  return (
    <div className="min-w-0">
      <div className={cn("relative", hoogte, kleur)}>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 border-t border-current opacity-25"
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          <polyline
            points={lijn}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div role="img" aria-label={beschrijving} className="absolute inset-0">
          {punten.map((p, i) => (
            <span
              key={p.kort}
              title={p.tip}
              className="absolute flex size-5 -translate-x-1/2 translate-y-1/2 items-center justify-center"
              style={{ left: `${stap * (i + 0.5)}%`, bottom: `${p.deel * 88 + 6}%` }}
            >
              <span
                className={cn(
                  "block size-2 rounded-full ring-2 ring-[color:var(--vak)]",
                  p.accent ? "bg-grafiek-accent" : "bg-current",
                )}
              />
            </span>
          ))}
        </div>
      </div>
      <Maandlabels punten={punten} />
    </div>
  );
}

/** Twee reeksen op elkaar per maand, met een legenda erboven. */
export function Gestapeld({
  punten,
  beschrijving,
  hoogte = "h-[120px] md:h-[140px]",
}: {
  punten: (Punt & { tweede: number })[];
  beschrijving: string;
  hoogte?: string;
}) {
  return (
    <div className="min-w-0">
      <div
        role="img"
        aria-label={beschrijving}
        className={cn("flex items-end gap-[2px] border-b border-current/25", hoogte)}
      >
        {punten.map((p) => (
          <span
            key={p.kort}
            title={p.tip}
            className="flex h-full flex-1 flex-col justify-end gap-[2px] px-[3px]"
          >
            <span
              className="block rounded-t-[4px] bg-serie-overmaken"
              style={{ height: `${p.tweede * 100}%` }}
            />
            <span className="block bg-serie-contant" style={{ height: `${p.deel * 100}%` }} />
          </span>
        ))}
      </div>
      <Maandlabels punten={punten} />
    </div>
  );
}

/**
 * Staven die omhoog en omlaag gaan vanaf een middenlijn: erbij gekomen boven,
 * gestopt onder. Zo zie je in één blik of je groeit of krimpt.
 */
export function Verloop({
  punten,
  beschrijving,
  hoogte = "h-[120px] md:h-[140px]",
}: {
  punten: { kort: string; tip: string; op: number; neer: number; accent?: boolean }[];
  beschrijving: string;
  hoogte?: string;
}) {
  return (
    <div className="min-w-0">
      <div role="img" aria-label={beschrijving} className={cn("relative flex gap-[2px]", hoogte)}>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 border-t border-current opacity-25"
        />
        {punten.map((p) => (
          <span key={p.kort} title={p.tip} className="flex h-full flex-1 flex-col px-[3px]">
            <span className="flex flex-1 flex-col justify-end">
              <span
                className={cn(
                  "block rounded-t-[4px]",
                  p.accent ? "bg-grafiek-accent" : "bg-tint-groen-mid",
                )}
                style={{ height: p.op > 0 ? `${Math.max(2, p.op * 100)}%` : "0" }}
              />
            </span>
            <span className="flex flex-1 flex-col justify-start">
              <span
                className={cn(
                  "block rounded-b-[4px]",
                  p.accent ? "bg-grafiek-accent" : "bg-tint-rood-mid",
                )}
                style={{ height: p.neer > 0 ? `${Math.max(2, p.neer * 100)}%` : "0" }}
              />
            </span>
          </span>
        ))}
      </div>
      <Maandlabels
        punten={punten.map((p) => ({
          kort: p.kort,
          tip: p.tip,
          deel: 0,
          ...(p.accent !== undefined ? { accent: p.accent } : {}),
        }))}
      />
    </div>
  );
}

/** Het blokje kleur met zijn naam, boven een grafiek met twee reeksen. */
export function Legenda({ items }: { items: { naam: string; klasse: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] opacity-70">
      {items.map((i) => (
        <span key={i.naam} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2.5 rounded-[3px]", i.klasse)} />
          {i.naam}
        </span>
      ))}
    </span>
  );
}
