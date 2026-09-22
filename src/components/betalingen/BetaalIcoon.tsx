import { IconCoin as Munt, IconCreditCard as Pinpas } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { Betaalmethode } from "@/lib/betalingen";

/**
 * Hoe een adres betaalt, als icoontje naast het adres: een geel muntje voor
 * contant, een oranje pinpasje voor overmaken. Alleen de omtrek, zodat het
 * rustig blijft in een lange lijst.
 */
export function BetaalIcoon({
  methode,
  className,
}: {
  methode: Betaalmethode;
  className?: string | undefined;
}) {
  const contant = methode === "contant";
  const tekst = contant ? "Betaalt contant" : "Maakt over";
  const Icoon = contant ? Munt : Pinpas;
  return (
    <span
      title={tekst}
      aria-label={tekst}
      role="img"
      className={cn("inline-flex shrink-0 align-[-2px]", className)}
    >
      <Icoon
        aria-hidden="true"
        className={cn("size-4", contant ? "text-amber-500" : "text-orange-600")}
      />
    </span>
  );
}
