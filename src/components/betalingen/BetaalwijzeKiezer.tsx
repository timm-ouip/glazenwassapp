import { betaalmethodeLabel, BETAALMETHODEN, type Betaalmethode } from "@/lib/betalingen";

/**
 * Contant of overmaken, als pillen. Bij een adres komt er een derde keuze
 * bij: "zoals de wijk" (null), met wat de wijk doet erachter.
 */
export function BetaalwijzeKiezer({
  waarde,
  onChange,
  wijk,
  disabled,
}: {
  waarde: Betaalmethode | null;
  onChange: (m: Betaalmethode | null) => void;
  /** Wat de wijk doet. Alleen bij een adres: dan kun je die ook volgen. */
  wijk?: Betaalmethode | undefined;
  disabled?: boolean | undefined;
}) {
  const keuzes: { waarde: Betaalmethode | null; label: string }[] = [
    ...(wijk
      ? [{ waarde: null, label: `Zoals de wijk (${betaalmethodeLabel(wijk).toLowerCase()})` }]
      : []),
    ...BETAALMETHODEN,
  ];
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Betaalmethode">
      {keuzes.map((k) => {
        const aan = waarde === k.waarde;
        return (
          <button
            key={k.label}
            type="button"
            role="radio"
            aria-checked={aan}
            disabled={disabled}
            onClick={() => onChange(k.waarde)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              aan
                ? "border-transparent bg-tint-amber text-tint-amber-ink"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {k.label}
          </button>
        );
      })}
    </div>
  );
}
