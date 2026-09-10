import type { LucideIcon } from "lucide-react";

/**
 * De rij cijfers boven aan een pagina.
 *
 * Elke kaart is één kleurfamilie: het vlak is de lichte tint, het icoonvakje
 * een stap dieper, de tekst de donkere kant ervan. Zwart op pastel zou de
 * kaart in tweeën trekken, en een witte kaart met een gekleurd rondje ervoor
 * laat de kleur niets betekenen.
 *
 * Vier pagina's tekenden deze rij eerst zelf, elk net iets anders. Nu staat
 * hij hier: verandert de vorm, dan verandert hij overal mee.
 */
export type Kaartkleur = "blauw" | "amber" | "groen" | "paars" | "roze";

const KLEUREN: Record<Kaartkleur, { vlak: string; chip: string }> = {
  blauw: { vlak: "bg-accent text-accent-foreground", chip: "bg-accent-foreground/15" },
  amber: { vlak: "bg-tint-amber text-tint-amber-ink", chip: "bg-tint-amber-ink/15" },
  groen: { vlak: "bg-tint-groen text-tint-groen-ink", chip: "bg-tint-groen-ink/15" },
  paars: { vlak: "bg-tint-paars text-tint-paars-ink", chip: "bg-tint-paars-ink/15" },
  roze: { vlak: "bg-tint-roze text-tint-roze-ink", chip: "bg-tint-roze-ink/15" },
};

export interface Cijfer {
  label: string;
  waarde: string;
  /** Eén regel context onder het getal — waar het vandaan komt, of waarover. */
  onder?: string;
  icon: LucideIcon;
  kleur: Kaartkleur;
  verberg?: boolean;
}

export function Cijferkaarten({ cijfers }: { cijfers: Cijfer[] }) {
  const zichtbaar = cijfers.filter((c) => !c.verberg);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {zichtbaar.map((c) => {
        const kleur = KLEUREN[c.kleur];
        return (
          <div key={c.label} className={`rounded-[18px] px-4 py-3.5 ${kleur.vlak}`}>
            <div
              className={`mb-2.5 flex size-8 items-center justify-center rounded-[10px] ${kleur.chip}`}
            >
              <c.icon className="size-[16px]" />
            </div>
            <p className="truncate text-[12.5px] opacity-80">{c.label}</p>
            <p className="font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
              {c.waarde}
            </p>
            {c.onder && <p className="mt-0.5 truncate text-[11px] opacity-70">{c.onder}</p>}
          </div>
        );
      })}
    </div>
  );
}
