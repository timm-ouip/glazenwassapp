/**
 * Een rijtje pillen waarvan er één (of meer) aan staat.
 *
 * Stond eerst alleen in BetaalwijzeKiezer; sindsdien kiest de app op meer
 * plekken zo: het klanttype, hoe vaak een klant een factuur krijgt, en contant/overmaken op
 * het dashboard. Eén vorm, zodat het overal hetzelfde aanvoelt.
 */
export function Pillen<T>({
  keuzes,
  waarde,
  onChange,
  disabled,
  label,
  groot = false,
}: {
  keuzes: { waarde: T; label: string }[];
  waarde: T;
  onChange: (w: T) => void;
  disabled?: boolean | undefined;
  label: string;
  /** De maat van het klantdossier: iets groter, en wat uit staat in gewone tekst. */
  groot?: boolean | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
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
            className={
              groot
                ? `rounded-full border px-3 py-[5px] text-[13px] transition-colors disabled:opacity-60 ${
                    aan
                      ? "border-transparent bg-tint-amber font-semibold text-tint-amber-ink"
                      : "border-border bg-transparent text-foreground hover:bg-accent"
                  }`
                : `rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                    aan
                      ? "border-transparent bg-tint-amber text-tint-amber-ink"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  }`
            }
          >
            {k.label}
          </button>
        );
      })}
    </div>
  );
}
