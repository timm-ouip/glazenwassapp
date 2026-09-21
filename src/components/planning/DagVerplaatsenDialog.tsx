import { IconArrowsExchange as Wissel } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { toonDatum } from "@/lib/wasdag";

/**
 * De vraag als je een hele dag op een dag laat vallen waar al werk staat:
 * alles erbij zetten, of de twee dagen omwisselen. Annuleren (ook met Escape
 * of buiten het venster klikken) laat alles staan zoals het was.
 */
export function DagVerplaatsenDialog({
  vraag,
  onKies,
}: {
  /** Van welke dag naar welke, en wat er op elk staat ("3 adressen"); null = dicht. */
  vraag: { van: string; naar: string; opVan: string; opNaar: string } | null;
  onKies: (keuze: "samen" | "wissel" | null) => void;
}) {
  return (
    <Dialog open={vraag !== null} onOpenChange={(open) => !open && onKies(null)}>
      <PopupKader className="sm:max-w-md">
        <PopupKop
          kleur="blauw"
          icoon={<Wissel className="size-[22px]" />}
          titel="Daar staat al werk"
          subtitel={vraag ? `${toonDatum(vraag.van)} → ${toonDatum(vraag.naar)}` : undefined}
        />
        <PopupBody>
          {vraag && (
            <div className="space-y-2 text-[13px] leading-relaxed">
              <p>
                Op {toonDatum(vraag.naar)} staat al werk gepland ({vraag.opNaar}). Wat wil je met
                het werk van {toonDatum(vraag.van)} ({vraag.opVan})?
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Samenvoegen</span>: alles komt op{" "}
                  {toonDatum(vraag.naar)} te staan; wat er al stond blijft staan.
                </li>
                <li>
                  <span className="font-medium text-foreground">Omwisselen</span>: de twee dagen
                  ruilen van plek, met hun teams.
                </li>
              </ul>
            </div>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" onClick={() => onKies(null)}>
            Annuleren
          </Button>
          <Button variant="outline" onClick={() => onKies("wissel")}>
            Omwisselen
          </Button>
          <Button onClick={() => onKies("samen")}>Samenvoegen</Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
