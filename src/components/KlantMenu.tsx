import { useNavigate } from "@tanstack/react-router";
import { CalendarOff, Check, CircleSlash, FileText, Flag } from "lucide-react";
import type { ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  eersteMaand,
  komendeMaanden,
  maandSleutel,
  markeringLabels,
  toonMaand,
  type Customer,
  type Markering,
} from "@/lib/klanten";

interface Props {
  customer: Customer;
  onPatch: (patch: Partial<Customer>) => void;
  children: ReactNode;
}

const KLEUR_STIP: Record<Exclude<Markering, "">, string> = {
  geel: "bg-tint-amber ring-tint-amber-ink/40",
  groen: "bg-tint-groen ring-tint-groen-ink/40",
};

/**
 * Rechtermuisknop op een adresregel: naar het dossier, een kleur meegeven
 * voor de printlijst, en maanden overslaan.
 *
 * Dit zit bewust achter de rechtermuisknop en niet in de regel zelf: de
 * wijklijst is al dicht bezet, en dit zijn dingen die je een paar keer per
 * jaar doet, niet elke ronde.
 */
export function KlantMenu({ customer: c, onPatch, children }: Props) {
  const navigate = useNavigate();
  const maanden = komendeMaanden();
  const komende = maanden[0]!;
  const start = eersteMaand(c);
  const nieuwDezeMaand = start === maandSleutel(new Date());

  function zetKleur(kleur: Markering) {
    onPatch({ markering: c.markering === kleur ? "" : kleur });
  }

  function wisselMaand(maand: string) {
    const aan = c.overslaan.includes(maand);
    onPatch({
      overslaan: aan ? c.overslaan.filter((m) => m !== maand) : [...c.overslaan, maand].sort(),
    });
  }

  /** Alles t/m deze maand overslaan — voor een langere pauze in één klik. */
  function slaOverTot(maand: string) {
    const tot = maanden.filter((m) => m <= maand);
    onPatch({ overslaan: [...new Set([...c.overslaan, ...tot])].sort() });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem
          onSelect={() => void navigate({ to: "/klanten", search: { klant: c.klant_id ?? "" } })}
        >
          <FileText className="size-4" /> Dossier
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuLabel>Kleur op de printlijst</ContextMenuLabel>
        {(Object.keys(markeringLabels) as Exclude<Markering, "">[]).map((kleur) => (
          <ContextMenuItem key={kleur} onSelect={() => zetKleur(kleur)}>
            <span className={`size-3 rounded-full ring-1 ring-inset ${KLEUR_STIP[kleur]}`} />
            {markeringLabels[kleur]}
            {c.markering === kleur && <Check className="ml-auto size-4" />}
          </ContextMenuItem>
        ))}
        {c.markering ? (
          <ContextMenuItem onSelect={() => onPatch({ markering: "" })}>
            <CircleSlash className="size-4" /> Kleur weghalen
          </ContextMenuItem>
        ) : (
          nieuwDezeMaand && (
            // Anders zoek je je scheel naar de kleur die je nooit gezet hebt.
            <ContextMenuLabel className="font-normal text-muted-foreground">
              Al groen: nieuw vanaf {toonMaand(start)}
            </ContextMenuLabel>
          )
        )}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => wisselMaand(komende)}>
          <CalendarOff className="size-4" />
          {c.overslaan.includes(komende)
            ? `${toonMaand(komende)} toch doen`
            : "Overslaan"}
        </ContextMenuItem>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CalendarOff className="size-4" /> Overslaan in…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {maanden.map((m) => (
              <ContextMenuCheckboxItem
                key={m}
                checked={c.overslaan.includes(m)}
                onSelect={(e) => {
                  // Openhouden: meestal vink je er meer dan één aan.
                  e.preventDefault();
                  wisselMaand(m);
                }}
              >
                <span className="capitalize">{toonMaand(m)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
              </ContextMenuCheckboxItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CalendarOff className="size-4" /> Overslaan t/m…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {maanden.map((m) => (
              <ContextMenuItem key={m} onSelect={() => slaOverTot(m)}>
                <span className="capitalize">{toonMaand(m)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {c.overslaan.length > 0 && (
          <ContextMenuItem onSelect={() => onPatch({ overslaan: [] })}>
            <CircleSlash className="size-4" /> Niets meer overslaan ({c.overslaan.length})
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Flag className="size-4" /> Wassen vanaf {toonMaand(start)}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {maanden.map((m) => (
              <ContextMenuItem key={m} onSelect={() => onPatch({ start_maand: m })}>
                <span className="capitalize">{toonMaand(m)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
              </ContextMenuItem>
            ))}
            {c.start_maand && (
              <ContextMenuItem onSelect={() => onPatch({ start_maand: "" })}>
                <CircleSlash className="size-4" /> Meteen (aanmaakmaand)
              </ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
