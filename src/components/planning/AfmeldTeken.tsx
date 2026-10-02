import { IconCheck as Check } from "@tabler/icons-react";

import { afgemeldTekst, afmeldstandTekst, type DagAfmeldstand } from "@/lib/dagklaar";

/**
 * Het vinkje bij een datum in de kalender: groen rondje als de hele dag met
 * "Dag klaar" is afgemeld, een klein pilletje "1/2" als een deel van de teams
 * al klaar is. Nog niemand klaar: niets (het oranje stipje van een voorbije
 * dag staat los hiervan in de maand).
 *
 * Lichtgroen vlak met donkere inkt, net als de strook "Afgemeld" op de dag:
 * in Fel is binnen zo'n vlak altijd de donkere inkt actief, ook in het donker,
 * en in Zakelijk zijn het de eigen groene tinten. Het pilletje krijgt de kleur
 * van een kaart: het hangt soms over een gekleurd vlak (het gekozen
 * dagkaartje), en dan moet de groene inkt nog steeds te lezen zijn.
 */
export function AfmeldTeken({
  stand,
  datum,
  className = "",
  kortOpTelefoon = false,
}: {
  stand: DagAfmeldstand | undefined;
  datum: string;
  className?: string;
  /** Op de telefoon zonder "1/2": in een smal maandvakje past dat niet. */
  kortOpTelefoon?: boolean;
}) {
  if (!stand || stand.klaar === 0) return null;
  const titel = [
    afmeldstandTekst(stand),
    ...stand.afmeldingen.map((a) => afgemeldTekst(a, datum)),
  ].join("\n");

  if (stand.klaar >= stand.teams) {
    return (
      <span
        role="img"
        aria-label={afmeldstandTekst(stand)}
        title={titel}
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-tint-groen text-tint-groen-ink ring-1 ring-tint-groen-ink/25 ${className}`}
      >
        <Check className="size-3" stroke={3} />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={afmeldstandTekst(stand)}
      title={titel}
      className={`inline-flex h-4 shrink-0 items-center gap-px rounded-full border border-tint-groen-ink/50 bg-card px-1 text-[10px] font-semibold leading-none tabular-nums text-tint-groen-ink ${className}`}
    >
      <Check className="size-2.5" stroke={3} />
      <span className={kortOpTelefoon ? "max-md:hidden" : ""}>
        {stand.klaar}/{stand.teams}
      </span>
    </span>
  );
}
