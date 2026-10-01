/**
 * De bouwstenen van het klantdossier, in de maten van het ontwerp: een
 * kolomkop in hoofdletters, witte kaarten met een ronding van 18px, en
 * invulvelden van 40px hoog op de achtergrondkleur.
 *
 * Een veld bewaart zichzelf als je het verlaat (of op Enter drukt). Zolang je
 * erin staat, laat het de waarde uit de database met rust: een verversing
 * mag niet wissen wat je aan het typen bent. Escape zet terug wat er stond.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** De kop boven een kolom: "DE KLANT", "HET WASSEN", "HET GELD". */
export function KolomKop({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {children}
    </div>
  );
}

/** Een witte kaart in een kolom. */
export function DossierKaart({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-[18px] bg-card px-[18px] py-4", className)}>
      {children}
    </div>
  );
}

/** Het grijze opschrift in een kaart, zoals "Ook van deze klant". */
export function KaartLabel({ children }: { children: ReactNode }) {
  return <div className="text-[12px] text-muted-foreground">{children}</div>;
}

/** Een link in het oranje van het ontwerp: onderstreept, en bij aanwijzen iets dieper. */
export const dossierLink =
  "text-left text-tint-oranje-mid underline underline-offset-2 hover:text-tint-oranje-ink";

/** Het vakje zelf: 40px hoog, afgerond, op de achtergrondkleur. */
export const dossierInvoer =
  "h-10 w-full min-w-0 rounded-[12px] border border-border bg-background px-3 text-[15px] text-foreground outline-none transition-[box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

/** Opschrift boven een veld, met het veld eronder. */
export function VeldLabel({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <label
      className={cn("flex min-w-0 flex-col gap-1 text-[12px] text-muted-foreground", className)}
    >
      {label}
      {children}
    </label>
  );
}

/**
 * Een tekstveld dat bij het verlaten bewaart. `onBewaar` krijgt alleen een
 * waarde die afwijkt van wat er stond toen je erin ging.
 */
export function DossierVeld({
  label,
  waarde,
  onBewaar,
  placeholder,
  type = "text",
  inputMode,
  disabled,
  voor,
  className,
  autoFocus,
  list,
}: {
  label: ReactNode;
  waarde: string;
  onBewaar: (tekst: string) => void | Promise<void>;
  placeholder?: string | undefined;
  type?: "text" | "email" | "tel" | "number";
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  disabled?: boolean | undefined;
  /** Iets vóór de tekst in het vakje, zoals "€". */
  voor?: ReactNode;
  className?: string | undefined;
  autoFocus?: boolean | undefined;
  list?: string | undefined;
}) {
  const [tekst, setTekst] = useState(waarde);
  const erin = useRef(false);
  const terug = useRef(false);
  /** Wat er stond toen je erin ging: alleen als je daarvan afwijkt, is het
   *  een wijziging. Kwam er intussen een nieuwe waarde binnen (een collega,
   *  of de app zelf) en typte je niets, dan blijft die staan. */
  const begin = useRef(waarde);
  // Voor het opruimen: als het veld verdwijnt terwijl je erin staat (een
  // ander tabblad), dan nog bewaren wat je typte.
  const laatste = useRef({ tekst, onBewaar });
  laatste.current = { tekst, onBewaar };

  useEffect(() => {
    if (!erin.current) setTekst(waarde);
  }, [waarde]);

  useEffect(
    () => () => {
      const l = laatste.current;
      if (erin.current && !terug.current && l.tekst !== begin.current) void l.onBewaar(l.tekst);
    },
    [],
  );

  function verlaat() {
    erin.current = false;
    if (terug.current || tekst === begin.current) {
      terug.current = false;
      setTekst(waarde);
      return;
    }
    void onBewaar(tekst);
  }

  const veld = (
    <input
      type={type}
      inputMode={inputMode}
      value={tekst}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      list={list}
      data-dossierveld=""
      onFocus={() => {
        erin.current = true;
        terug.current = false;
        // Wat je ziet is het begin: ook als de opslag van je vorige invoer
        // nog onderweg is, springt die tekst niet terug.
        begin.current = tekst;
      }}
      onChange={(e) => setTekst(e.target.value)}
      onBlur={verlaat}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // Terugzetten en het veld uit; het dossier blijft open (zie de
          // schil, die Escape in een veld niet laat sluiten).
          terug.current = true;
          setTekst(waarde);
          e.currentTarget.blur();
        }
      }}
      className={cn(dossierInvoer, voor ? "border-0 bg-transparent px-0 focus-visible:ring-0" : "")}
    />
  );

  return (
    <VeldLabel label={label} className={className}>
      {voor ? (
        <span
          className={cn(
            dossierInvoer,
            "flex items-center gap-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
            disabled && "opacity-60",
          )}
        >
          <span className="text-muted-foreground">{voor}</span>
          {veld}
        </span>
      ) : (
        veld
      )}
    </VeldLabel>
  );
}
