import { Fragment } from "react";
import { Check, CircleSlash } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  eersteMaand,
  komendeMaanden,
  maandSleutel,
  schuifStartOp,
  toonMaand,
  toonMaandKort,
  vorigeMaand,
} from "@/lib/klanten";
import type { Customer } from "@/lib/klanten";

interface Props {
  customer: Customer;
  onPatch: (patch: Partial<Customer>) => void;
}

/**
 * De maand waarin dit adres voor het eerst meegaat, als hij nog niet begonnen
 * is. Een adres dat deze maand start kleurt in de lijst groen; zonder dit
 * badge is nergens te zien waaróm, of vanaf wanneer hij meedoet.
 *
 * Niets te melden zodra de startmaand achter ons ligt: dan doet hij gewoon
 * mee en zou het badge alleen ruimte kosten.
 */
export function WassenVanaf({ customer: c, onPatch: ruwePatch }: Props) {
  const onPatch = (p: Partial<Customer>) => ruwePatch(schuifStartOp(c, p));
  const dezeMaand = maandSleutel(new Date());
  const start = eersteMaand(c);
  if (start < dezeMaand) return null;

  const maanden = komendeMaanden();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          title={`Wassen vanaf ${toonMaand(start)}`}
          aria-label="Wassen vanaf"
          className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-[2px] text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            start === dezeMaand
              ? "bg-tint-groen text-tint-groen-ink ring-1 ring-inset ring-tint-groen-ink/25"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {/* Zonder eigen startmaand begint hij in zijn aanmaakmaand — en dat
              is, waar dit badge te zien is, altijd deze maand. */}
          {c.start_maand ? `vanaf ${toonMaandKort(start)}` : "nieuw"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-48 overflow-y-auto">
        {maanden.map((m, i) => (
          <Fragment key={m}>
            {/* Streepje bij elke jaarwisseling: anders lopen december en
                januari in elkaar over. */}
            {i > 0 && m.endsWith("-01") && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onPatch({ start_maand: m })}>
              <span className="capitalize">{toonMaand(m)}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
              {c.start_maand === m && <Check className="size-4" />}
            </DropdownMenuItem>
          </Fragment>
        ))}
        <DropdownMenuSeparator />
        {/* Een adres dat je nu invoert maar dat allang klant is: een
            startmaand in het verleden houdt hem uit het groen. */}
        <DropdownMenuItem onSelect={() => onPatch({ start_maand: vorigeMaand() })}>
          <CircleSlash className="size-4" /> Niet nieuw, al langer klant
        </DropdownMenuItem>
        {c.start_maand && (
          <DropdownMenuItem onSelect={() => onPatch({ start_maand: "" })}>
            <CircleSlash className="size-4" /> Meteen (aanmaakmaand)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
