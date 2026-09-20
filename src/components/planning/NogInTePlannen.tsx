import { useDraggable } from "@dnd-kit/core";
import { IconGripVertical as Grip } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { duurTekst, type OpenBlok } from "@/lib/dagplanning";
import { formatPrice } from "@/lib/klanten";
import { toonDatum } from "@/lib/wasdag";

/**
 * De strook naast de weekweergave: straten die deze maand nog aan de beurt
 * zijn en nog nergens staan, in de volgorde van de ronde.
 *
 * Op de computer sleep je een blok naar een dag; op de telefoon kies je
 * "Zet op…". De app zet zelf niets neer — het voorstel in de week is een
 * schets, dit is de voorraad.
 */
export function NogInTePlannen({
  blokken,
  plekken,
  prijzenZien,
  sleepbaar,
  onZetOp,
}: {
  blokken: OpenBlok[];
  /** Waar je hem neer kunt zetten: dag + ploeg, met hoe vol die is. */
  plekken: { datum: string; ploeg_nr: number | null; label: string; vol: string }[];
  prijzenZien: boolean;
  sleepbaar: boolean;
  onZetOp: (blok: OpenBlok, datum: string, ploegNr: number | null) => void;
}) {
  if (blokken.length === 0) {
    return (
      <p className="rounded-[14px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
        Alles van deze maand staat ingepland.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {blokken.map((b) => (
        <OpenBlokKaart
          key={b.sleutel}
          blok={b}
          plekken={plekken}
          prijzenZien={prijzenZien}
          sleepbaar={sleepbaar}
          onZetOp={onZetOp}
        />
      ))}
    </ul>
  );
}

function OpenBlokKaart({
  blok,
  plekken,
  prijzenZien,
  sleepbaar,
  onZetOp,
}: {
  blok: OpenBlok;
  plekken: { datum: string; ploeg_nr: number | null; label: string; vol: string }[];
  prijzenZien: boolean;
  sleepbaar: boolean;
  onZetOp: (blok: OpenBlok, datum: string, ploegNr: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `open:${blok.street_id}`,
    disabled: !sleepbaar,
  });

  return (
    <li
      ref={setNodeRef}
      className={`flex items-center gap-1.5 rounded-[11px] bg-card/70 px-2 py-1.5 text-[13px] ${
        isDragging ? "opacity-40" : ""
      } ${sleepbaar ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
      {...(sleepbaar ? attributes : {})}
      {...(sleepbaar ? listeners : {})}
    >
      {sleepbaar && <Grip className="size-3.5 shrink-0 text-muted-foreground/50" />}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{blok.titel}</span>
        <span className="text-muted-foreground"> · {blok.adressen.length}</span>
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{duurTekst(blok.duur)}</span>
      {prijzenZien && <span className="shrink-0 tabular-nums">{formatPrice(blok.bedrag)}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shrink-0 rounded px-1 text-[12px] text-muted-foreground hover:bg-accent"
          >
            Zet op…
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
          <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
            {blok.titel} — {duurTekst(blok.duur)}
          </DropdownMenuLabel>
          {plekken.map((p) => (
            <DropdownMenuItem
              key={`${p.datum}:${p.ploeg_nr ?? 0}`}
              onSelect={() => onZetOp(blok, p.datum, p.ploeg_nr)}
            >
              <span className="min-w-0 flex-1 truncate">
                {toonDatum(p.datum)}
                {p.label ? ` · ${p.label}` : ""}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">{p.vol}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
