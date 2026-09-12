import { Check } from "lucide-react";

import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
 * Achter elke frequentie zit daarom een pijltje met de maanden die erbij
 * kunnen horen: zo zet één keuze allebei tegelijk, in plaats van eerst de
 * frequentie te kiezen en dan het menu opnieuw te openen voor de maanden.
 *
 * Het badge zegt de maanden en niet het interval, want dat is wat je wilt
 * weten als je langs de lijst gaat.
 */
export function FrequentieKiezer({ customer: c, onPatch }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          title={ritmeOmschrijving(c)}
          aria-label="Frequentie"
          className={`min-w-[3.25rem] max-w-[5.5rem] shrink-0 truncate rounded-full px-1.5 py-[2px] text-center text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${kleur(c)}`}
        >
          {ritmeLabel(c)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Frequentie</DropdownMenuLabel>
        {INTERVALLEN.map((n) => {
          const varianten = ritmeVarianten(n);
          const gekozen = c.interval_maanden === n;

          // Elke maand kan maar op één manier: dan is er niets te kiezen en
          // hoort er geen pijltje bij.
          if (varianten.length <= 1) {
            return (
              <DropdownMenuItem key={n} onSelect={() => onPatch({ interval_maanden: n })}>
                {intervalLabels[n]}
                {gekozen && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuSub key={n}>
              <DropdownMenuSubTrigger>
                {intervalLabels[n]}
                {gekozen && <Check className="ml-1 size-4" />}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-44 overflow-y-auto">
                <DropdownMenuLabel>In welke maanden</DropdownMenuLabel>
                {varianten.map((r) => (
                  <DropdownMenuItem
                    key={r}
                    // Allebei tegelijk: kies je hier de maanden van een andere
                    // frequentie, dan moet het interval mee, anders komt het
                    // ritme op een maandenrijtje uit dat er niet bij hoort.
                    onSelect={() => onPatch({ interval_maanden: n, ritme: r })}
                  >
                    {ritmeLabel({ interval_maanden: n, ritme: r })}
                    {gekozen && zelfdeRitme(c.ritme, r, n) && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Dezelfde keuzes, maar als inhoud van een keuzelijst in een invulschermpje:
 * per interval een groepje met de maanden die erbij kunnen horen.
 *
 * Op de lijst is de frequentie een badge waar een menu achter zit (hierboven);
 * in een schermpje waar je een adres invult is het een veld tussen de andere
 * velden. Twee vormen, maar één set keuzes — anders kun je bij het aanmaken van
 * een adres minder kiezen dan bij het wijzigen ervan, en dat was precies het
 * gat dat hier zat.
 *
 * De waarde die eruit komt is die van `ritmeWaarde`; met `leesRitmeWaarde`
 * maak je er weer interval en ritme van.
 */
export function FrequentieOpties() {
  return (
    <>
      {INTERVALLEN.map((n) =>
        // Om de 1 heeft maar één mogelijkheid, dus daar zou een kopje boven
        // één keuze met dezelfde woorden staan.
        n <= 1 ? (
          <SelectItem key={n} value={`${n}-1`}>
            {intervalLabels[n]}
          </SelectItem>
        ) : (
          <SelectGroup key={n}>
            <SelectLabel>{intervalLabels[n]}</SelectLabel>
            {ritmeVarianten(n).map((v) => (
              <SelectItem key={v} value={`${n}-${v}`}>
                {ritmeLabel({ interval_maanden: n, ritme: v })}
              </SelectItem>
            ))}
          </SelectGroup>
        ),
      )}
    </>
  );
}
