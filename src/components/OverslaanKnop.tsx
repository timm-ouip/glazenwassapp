import { Fragment } from "react";
import { CalendarOff, ChevronDown, CircleSlash } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { komendeMaanden, toonMaand } from "@/lib/klanten";

/**
 * Overslaan voor alles wat je aangevinkt hebt.
 *
 * Dezelfde keuzes als achter de rechtermuisknop op één regel, maar dan in één
 * klap: een straat waar de steiger staat, of een rijtje dat op vakantie is.
 * Per adres los gaan zou hier tientallen klikken kosten.
 */
export function OverslaanKnop({
  aantal,
  onOverslaan,
  onNietsOverslaan,
}: {
  aantal: number;
  /** `tot` is waar bij "t/m" alles ervoor ook meegaat. */
  onOverslaan: (maanden: string[]) => void;
  onNietsOverslaan: () => void;
}) {
  const maanden = komendeMaanden();
  const komende = maanden[0]!;
  /** Streepje bij de jaarwissel, anders lopen december en januari in elkaar. */
  const jaarwissel = (m: string, i: number) => i > 0 && m.endsWith("-01");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={aantal === 0}
          title={aantal === 0 ? "Vink eerst adressen aan" : `${aantal} adressen overslaan`}
        >
          <CalendarOff className="size-4" /> Overslaan
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {aantal} {aantal === 1 ? "adres" : "adressen"}
        </DropdownMenuLabel>

        <DropdownMenuItem onSelect={() => onOverslaan([komende])}>
          <CalendarOff className="size-4" /> Overslaan
          <span className="ml-auto text-xs capitalize text-muted-foreground">
            {toonMaand(komende)}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CalendarOff className="size-4" /> Overslaan in…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {maanden.map((m, i) => (
              <Fragment key={m}>
                {jaarwissel(m, i) && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onSelect={(e) => {
                    // Openhouden: meestal kies je er meer dan één.
                    e.preventDefault();
                    onOverslaan([m]);
                  }}
                >
                  <span className="capitalize">{toonMaand(m)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CalendarOff className="size-4" /> Overslaan t/m…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {maanden.map((m, i) => (
              <Fragment key={`tot-${m}`}>
                {jaarwissel(m, i) && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => onOverslaan(maanden.filter((x) => x <= m))}>
                  <span className="capitalize">{toonMaand(m)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={onNietsOverslaan}>
          <CircleSlash className="size-4" /> Niets meer overslaan
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
