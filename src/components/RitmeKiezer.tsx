import { Fragment } from "react";
import { Check } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  INTERVALLEN,
  intervalLabels,
  ritmeLabel,
  ritmeOmschrijving,
  ritmeVarianten,
  zelfdeRitme,
  type Customer,
} from "@/lib/klanten";

interface Props {
  customer: Customer;
  onPatch: (patch: Partial<Customer>) => void;
}

/** Even en oneven houden hun eigen kleur: zo blijft de lijst eruitzien zoals
 *  hij eruitzag, en vallen de andere ritmes juist op. */
function kleur(c: Pick<Customer, "interval_maanden" | "ritme">): string {
  if (c.interval_maanden <= 1) return "bg-accent text-accent-foreground";
  if (c.interval_maanden === 2) {
    return c.ritme % 2 === 0
      ? "bg-tint-amber text-tint-amber-ink ring-1 ring-inset ring-tint-amber-ink/25"
      : "bg-muted text-muted-foreground";
  }
  return "bg-tint-paars text-tint-paars-ink ring-1 ring-inset ring-tint-paars-ink/25";
}

/**
 * Hoe vaak een adres gewassen wordt, en in welke maanden dat uitkomt. Twee
 * vragen in één menu, want de tweede volgt uit de eerste: bij om de 2 kies je
 * even of oneven, bij om de 3 kies je welk van de drie kwartaalritmes.
 *
 * Het badge zegt de maanden en niet het interval, want dat is wat je wilt
 * weten als je langs de lijst gaat.
 */
export function RitmeKiezer({ customer: c, onPatch }: Props) {
  const varianten = ritmeVarianten(c.interval_maanden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          title={ritmeOmschrijving(c)}
          aria-label="Hoe vaak"
          className={`min-w-[3.25rem] max-w-[5.5rem] shrink-0 truncate rounded-full px-1.5 py-[2px] text-center text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kleur(c)}`}
        >
          {ritmeLabel(c)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Hoe vaak</DropdownMenuLabel>
        {INTERVALLEN.map((n) => (
          <DropdownMenuItem key={n} onSelect={() => onPatch({ interval_maanden: n })}>
            {intervalLabels[n]}
            {c.interval_maanden === n && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}

        {varianten.length > 1 && (
          <Fragment>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>In welke maanden</DropdownMenuLabel>
            {varianten.map((r) => (
              <DropdownMenuItem key={r} onSelect={() => onPatch({ ritme: r })}>
                {ritmeLabel({ interval_maanden: c.interval_maanden, ritme: r })}
                {zelfdeRitme(c.ritme, r, c.interval_maanden) && (
                  <Check className="ml-auto size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </Fragment>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
