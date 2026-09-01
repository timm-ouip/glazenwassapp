import { eersteMaand, komendeMaanden, maandSleutel, toonMaand, toonMaandKort } from "@/lib/klanten";
import type { Customer } from "@/lib/klanten";

/** "vanaf sep", en met jaartal zodra het over de jaargrens gaat. */
function vanafLabel(maand: string, dezeMaand: string): string {
  const jaar = maand.slice(0, 4);
  return jaar === dezeMaand.slice(0, 4)
    ? `vanaf ${toonMaandKort(maand)}`
    : `vanaf ${toonMaandKort(maand)} '${jaar.slice(2)}`;
}

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
export function WassenVanaf({ customer: c, onPatch }: Props) {
  const dezeMaand = maandSleutel(new Date());
  const start = eersteMaand(c);
  if (start < dezeMaand) return null;

  return (
    <select
      value={c.start_maand}
      onChange={(e) => onPatch({ start_maand: e.target.value })}
      title={`Wassen vanaf ${toonMaand(start)}`}
      className={`max-w-[5.25rem] shrink-0 cursor-pointer appearance-none rounded-full px-1 py-[2px] text-center text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-ring ${
        start === dezeMaand
          ? "bg-tint-groen text-tint-groen-ink ring-1 ring-inset ring-tint-groen-ink/25"
          : "bg-muted text-muted-foreground"
      }`}
      aria-label="Wassen vanaf"
    >
      {/* Zonder startmaand begint hij in zijn aanmaakmaand — en dat is, waar
          dit badge te zien is, altijd deze maand. */}
      <option value="">nieuw</option>
      {komendeMaanden().map((m) => (
        <option key={m} value={m}>
          {vanafLabel(m, dezeMaand)}
        </option>
      ))}
    </select>
  );
}
