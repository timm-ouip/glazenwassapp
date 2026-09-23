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
        className={cn(
          "size-4",
          // Dezelfde twee kleuren als de grafiek "Contant en overmaken" op het
          // dashboard, in elk thema: anders springt contant van kleur als je
          // van de lijst naar het dashboard kijkt. De kleur zelf staat in
          // styles.css (--serie-contant en --serie-overmaken).
          contant
            ? "text-amber-500 fel:text-serie-contant zak:text-serie-contant"
            : "text-teal-600 fel:text-serie-overmaken zak:text-serie-overmaken",
        )}
      />
    </span>
  );
}
