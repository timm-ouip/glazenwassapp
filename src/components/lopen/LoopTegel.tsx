/**
 * Eén adres als tegel, voor de looplijst op de telefoon: links de even
 * kant, rechts de oneven kant, zoals op de Wijken-pagina. Groot het huisnummer,
 * ernaast de prijs (of het voorstel, grijs), en de kleur zegt wat er aan de
 * deur gezegd is. Een tik opent het adres onderin het scherm.
 *
 * Een klant staat er gestippeld en grijs bij: daar valt niets te lopen.
 */
import { memo } from "react";
import { IconNote as Notitie } from "@tabler/icons-react";

import { UITKOMST_VLAK } from "@/components/lopen/useLoopRij";
import { formatPrice } from "@/lib/klanten";
import {
  adresOmschrijving,
  loopNummer,
  uitkomstLabel,
  woningtypeTekst,
  type LoopAdres,
  type LoopVoorstel,
} from "@/lib/lopen";
import { cn } from "@/lib/utils";

interface Props {
  rij: LoopAdres;
  voorstel: LoopVoorstel | null;
  gekozen: boolean;
  onKies: (id: string) => void;
}

export const LoopTegel = memo(function LoopTegel({ rij, voorstel, gekozen, onKies }: Props) {
  const nummer = (
    <span className="min-w-[30px] font-display text-[21px] font-semibold leading-none tabular-nums">
      {loopNummer(rij)}
    </span>
  );

  if (rij.klant_status) {
    return (
      <div
        id={`looptegel-${rij.id}`}
        className="flex min-h-14 items-center gap-2 rounded-[14px] border border-dashed border-border px-3 text-muted-foreground"
      >
        {nummer}
        <span className="text-[11.5px]">
          {rij.klant_status === "inactief" ? "inactief" : "klant"}
        </span>
      </div>
    );
  }

  // De prijs die er staat, anders het voorstel, anders wat voor pand het is.
  const onder =
    rij.prijs !== null ? (
      <span className="text-[13.5px] font-semibold tabular-nums">{formatPrice(rij.prijs)}</span>
    ) : voorstel ? (
      <span className="text-[12px] tabular-nums opacity-70">
        voorstel {formatPrice(voorstel.voorstel)}
      </span>
    ) : (
      <span className="truncate text-[11.5px] opacity-70">
        {woningtypeTekst(rij).replace(" (geschat)", "") || adresOmschrijving(rij)}
      </span>
    );

  return (
    <button
      id={`looptegel-${rij.id}`}
      type="button"
      aria-pressed={gekozen}
      aria-label={[
        `${rij.straat} ${loopNummer(rij)}`,
        rij.prijs !== null
          ? formatPrice(rij.prijs)
          : voorstel && `voorstel ${formatPrice(voorstel.voorstel)}`,
        rij.uitkomst && uitkomstLabel(rij.uitkomst),
        rij.notitie && "met notitie",
      ]
        .filter(Boolean)
        .join(", ")}
      onClick={() => onKies(rij.id)}
      className={cn(
        "flex min-h-14 w-full items-center gap-2 rounded-[14px] border px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        rij.uitkomst
          ? cn("border-transparent", UITKOMST_VLAK[rij.uitkomst])
          : "border-border bg-card",
        gekozen && "ring-[3px] ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {nummer}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        {onder}
        {rij.uitkomst && (
          <span className="text-[11px] lowercase opacity-80">{uitkomstLabel(rij.uitkomst)}</span>
        )}
      </span>
      {rij.notitie && <Notitie className="size-3.5 shrink-0 opacity-60" aria-hidden />}
    </button>
  );
});
