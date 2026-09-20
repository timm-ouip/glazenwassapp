import { useEffect, useState } from "react";
import { IconUsers as Users } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PopupBlok, PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import type { Ploeg } from "@/lib/dagplanning";
import type { Teamlid } from "@/lib/ploegen";
import { toonDatum } from "@/lib/wasdag";

const MAX_PLOEGEN = 4;

/**
 * Wie er die dag werken, en hoe ze verdeeld zijn.
 *
 * Per dag opnieuw: de ene dag gaan Jan en Piet samen, de andere dag splitsen
 * ze. Kies je niemand, dan rekent de app met één persoon — dan hoef je niets
 * in te delen om toch te zien of een dag past.
 */
export function PloegenDialog({
  open,
  onOpenChange,
  datum,
  teamleden,
  ploegen,
  onOpslaan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datum: string;
  teamleden: Teamlid[];
  ploegen: Ploeg[];
  onOpslaan: (ploegen: Ploeg[]) => void;
}) {
  /** Per teamlid het ploegnummer, of 0 als hij die dag niet werkt. */
  const [keuze, setKeuze] = useState<Map<string, number>>(new Map());
  const [aantal, setAantal] = useState(1);

  useEffect(() => {
    if (!open) return;
    const kaart = new Map<string, number>();
    for (const p of ploegen) for (const l of p.leden) kaart.set(l.teamlid_id, p.nr);
    setKeuze(kaart);
    setAantal(Math.max(1, ploegen.length));
  }, [open, ploegen]);

  function zet(teamlidId: string, nr: number) {
    setKeuze((was) => {
      const nieuw = new Map(was);
      if (nr === 0) nieuw.delete(teamlidId);
      else nieuw.set(teamlidId, nr);
      return nieuw;
    });
  }

  function opslaan() {
    const uit: Ploeg[] = [];
    for (let nr = 1; nr <= aantal; nr++) {
      const leden = teamleden
        .filter((t) => keuze.get(t.id) === nr)
        .map((t) => ({ teamlid_id: t.id, naam: t.naam, employee_id: t.employee_id }));
      // Een ploeg zonder mensen bewaren we alleen als er verder niets is:
      // anders staan er lege kolommen op de dag.
      if (leden.length === 0) continue;
      // De werktijd die deze ploeg vandaag al had, blijft staan: anders
      // springt een ploeg die tot 14:00 werkt terug naar de standaardtijd
      // zodra je iemand wisselt.
      const was = ploegen.find((pl) => pl.nr === nr);
      uit.push({
        nr,
        leden,
        ...(was?.begin ? { begin: was.begin } : {}),
        ...(was?.eind ? { eind: was.eind } : {}),
        ...(was?.pauzeVan ? { pauzeVan: was.pauzeVan } : {}),
        ...(was?.pauzeMin !== null && was?.pauzeMin !== undefined
          ? { pauzeMin: was.pauzeMin }
          : {}),
      });
    }
    onOpslaan(uit);
    onOpenChange(false);
  }

  const nummers = Array.from({ length: aantal }, (_, i) => i + 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-md">
        <PopupKop
          kleur="blauw"
          icoon={<Users className="size-[22px]" />}
          titel="Wie werken er?"
          subtitel={toonDatum(datum)}
        />
        <PopupBody>
          <PopupBlok label="Aantal ploegen">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: MAX_PLOEGEN }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAantal(n)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                    aantal === n
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </PopupBlok>

          <PopupBlok label="Wie waar">
            {teamleden.length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                Nog geen teamleden. Voeg ze toe bij Instellingen → Team.
              </p>
            )}
            <ul className="space-y-1.5">
              {teamleden.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{t.naam}</span>
                  <button
                    type="button"
                    onClick={() => zet(t.id, 0)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      !keuze.has(t.id)
                        ? "border-transparent bg-muted text-muted-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    vrij
                  </button>
                  {nummers.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => zet(t.id, n)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        keuze.get(t.id) === n
                          ? "border-transparent bg-tint-blauw text-tint-blauw-ink"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      Ploeg {n}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={opslaan}>Opslaan</Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
