import { maandSleutel, toonMaand, toonMaandKort } from "@/lib/klanten";
import type { Customer } from "@/lib/klanten";

interface Props {
  customer: Customer;
}

/**
 * De maanden die dit adres overslaat, voor zover ze nog moeten komen. Rood
 * zodra het om deze maand gaat: dan staat hij niet op de printlijst en is
 * het goed om dat te zien zonder het menu open te klappen.
 *
 * Voorbij liggende maanden laten we weg — die zeggen niets meer over wat er
 * nu gebeurt en zouden het badge nooit meer laten verdwijnen.
 */
export function Overgeslagen({ customer: c }: Props) {
  const dezeMaand = maandSleutel(new Date());
  const komend = c.overslaan.filter((m) => m >= dezeMaand);
  if (komend.length === 0) return null;

  const nu = komend[0] === dezeMaand;
  const rest = komend.length - 1;

  return (
    <span
      title={`Overgeslagen: ${komend.map(toonMaand).join(", ")}`}
      className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-[2px] text-[10px] font-semibold ${
        nu
          ? "bg-tint-rood text-tint-rood-ink ring-1 ring-inset ring-tint-rood-ink/25"
          : "bg-muted text-muted-foreground"
      }`}
    >
      niet {toonMaandKort(komend[0]!)}
      {rest > 0 && ` +${rest}`}
    </span>
  );
}
