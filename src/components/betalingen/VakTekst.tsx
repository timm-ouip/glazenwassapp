import { vakWoorden, type Vak } from "@/lib/geldkaart";
import { cn } from "@/lib/utils";

/**
 * Wat er in een vakje van de geldkaart staat, in woorden en op hooguit twee
 * regels ("Open" en "€ 30"), zodat het ook in een smal vakje past. Gedeeld
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
  return (
    <span
      className={cn("flex min-w-0 flex-col items-center text-center leading-[1.15]", className)}
    >
      <span className="max-w-full truncate font-semibold">{kort[0]}</span>
      {kort[1] && <span className="max-w-full truncate font-normal tabular-nums">{kort[1]}</span>}
    </span>
  );
}
