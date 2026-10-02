import { vakWoorden, type Vak } from "@/lib/geldkaart";
import { cn } from "@/lib/utils";

/**
 * Wat er in een vakje van de geldkaart staat: een los teken (1, 0, x) of korte
 * tekst op hooguit twee regels ("Voorkant" en "€ 8"), zodat het ook in een
 * smal vakje past. Gedeeld
 * door de straatkaart, de kaart van één klant en het dossier. `leeg`: wat er
 * in een leeg vakje staat (bijvoorbeeld een stip voor de volgende beurt).
 */
export function VakTekst({
  vak,
  leeg = "",
  className,
}: {
  vak: Vak;
  leeg?: string;
  className?: string;
}) {
  const { kort } = vakWoorden(vak);
  if (kort.length === 0) return <>{leeg}</>;
  // Een los teken (0, 1, 2, x) groot, zoals op de papieren kaart.
  if (kort.length === 1 && kort[0]!.length <= 2) {
    return (
      <span className={cn("text-[15px] font-semibold tabular-nums leading-none", className)}>
        {kort[0]}
      </span>
    );
  }
  return (
    <span
      className={cn("flex min-w-0 flex-col items-center text-center leading-[1.15]", className)}
    >
      <span className="max-w-full truncate font-semibold">{kort[0]}</span>
      {kort[1] && <span className="max-w-full truncate font-normal tabular-nums">{kort[1]}</span>}
    </span>
  );
}
