import { useMemo, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";

import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  NIET_INGEDEELD,
  opzetVan,
  volPercentage,
  type Blok,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type Voorstel,
} from "@/lib/dagplanning";
import type { Bouwstenen } from "@/lib/dagbouwstenen";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice } from "@/lib/klanten";

/** Eén dag in de week, met wat er die dag te doen is. */
export interface WeekDag {
  datum: string;
  regels: DagRegel[];
  klussen: DagKlus[];
  ploegen: Ploeg[];
}

/**
 * De week: een kolom per werkdag, met de ploegen als rijen.
 *
 * Elke ploeg heeft zijn eigen vol-balk, zodat je ziet waar nog ruimte is. Wat
 * er gestippeld staat is een voorstel — de app zet zelf niets neer.
 */
export function WeekWeergave({
  dagen,
  instellingen,
  bouwstenen,
  voorstellen,
  prijzenZien,
  sleepbaar,
  onOpenDag,
}: {
  dagen: WeekDag[];
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  /** Gestippelde schets van wat er nog bij zou kunnen. */
  voorstellen: Voorstel[];
  prijzenZien: boolean;
  sleepbaar: boolean;
  onOpenDag: (datum: string) => void;
}) {
  /** Hoeveel rijen: het hoogste aantal ploegen van de week, minstens één. */
  const rijen = useMemo(() => Math.max(1, ...dagen.map((d) => d.ploegen.length)), [dagen]);

  const perDag = useMemo(
    () =>
      dagen.map((d) => ({
        ...d,
        blokken: maakBlokken({
          regels: d.regels,
          klussen: d.klussen,
          adressen: bouwstenen.adressen,
          straten: bouwstenen.straten,
          wijken: bouwstenen.wijken,
        }),
      })),
    [dagen, bouwstenen],
  );

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[52rem] gap-2"
        style={{ gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))` }}
      >
        {perDag.map((d) => (
          <div key={d.datum} className="text-center">
            <button
              type="button"
              onClick={() => onOpenDag(d.datum)}
              className="w-full rounded-[10px] px-1 py-1 text-[12.5px] font-medium hover:bg-accent"
            >
              {new Date(`${d.datum}T12:00:00`).toLocaleDateString("nl-NL", {
                weekday: "short",
                day: "numeric",
              })}
            </button>
          </div>
        ))}

        {Array.from({ length: rijen }, (_, rij) => rij).map((rij) =>
          perDag.map((d) => {
            const ploeg = d.ploegen[rij] ?? null;
            const nr = ploeg?.nr ?? NIET_INGEDEELD;
            // Werk zonder ploeg, én werk met een ploegnummer dat deze dag niet
            // kent (bijvoorbeeld na opschuiven), hoort in de eerste rij: anders
            // lijkt de dag leeg terwijl er wel werk staat.
            const bekend = new Set(d.ploegen.map((pl) => pl.nr));
            const zwervend = [...d.blokken.entries()]
              .filter(([x]) => !bekend.has(x))
              .flatMap(([, b]) => b);
            const blokken = rij === 0 && !ploeg ? zwervend : (d.blokken.get(nr) ?? []);
            const losOok = rij === 0 && ploeg ? zwervend : [];
            const tijdlijn = berekenTijden([...blokken, ...losOok], opzetVan(instellingen, ploeg));
            const vol = volPercentage(tijdlijn);
            const voorstel = voorstellen.find(
              (v) => v.datum === d.datum && (v.ploeg_nr === nr || (!ploeg && v.ploeg_nr === 1)),
            );
            return (
              <Plek
                key={`${d.datum}:${rij}`}
                datum={d.datum}
                ploegNr={ploeg?.nr ?? null}
                actief={sleepbaar}
              >
                {(setRef, erboven) => (
                  <div
                    ref={setRef}
                    className={`min-h-24 rounded-[14px] border p-1.5 text-left transition-colors ${
                      erboven ? "border-primary bg-accent/60" : "border-border bg-card"
                    }`}
                  >
                    {ploeg && (
                      <p className="mb-1 truncate text-[11.5px] font-medium text-muted-foreground">
                        {ploegNaam(ploeg)}
                      </p>
                    )}
                    <ul className="space-y-0.5">
                      {[...blokken, ...losOok].map((b) => (
                        <BlokRegel key={b.sleutel} blok={b} prijzenZien={prijzenZien} />
                      ))}
                      {voorstel?.blokken.map((b) => (
                        <li
                          key={`voorstel:${b.sleutel}`}
                          className="truncate rounded-[8px] border border-dashed border-border px-1.5 py-0.5 text-[11.5px] text-muted-foreground"
                          title="Voorstel: dit zou hier passen"
                        >
                          {b.titel} · {duurTekst(b.duur)}
                        </li>
                      ))}
                    </ul>
                    {(blokken.length > 0 || losOok.length > 0) && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${tijdlijn.teVol ? "bg-destructive" : "bg-tint-blauw-ink/70"}`}
                            style={{ width: `${Math.min(100, vol)}%` }}
                          />
                        </div>
                        <span
                          className={`shrink-0 text-[10.5px] tabular-nums ${tijdlijn.teVol ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {duurTekst(tijdlijn.werkMin)}/{duurTekst(tijdlijn.capaciteitMin)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Plek>
            );
          }),
        )}
      </div>
    </div>
  );
}

function BlokRegel({ blok, prijzenZien }: { blok: Blok; prijzenZien: boolean }) {
  return (
    <li className="flex items-center gap-1 truncate rounded-[8px] bg-muted/50 px-1.5 py-0.5 text-[11.5px]">
      <span className="min-w-0 flex-1 truncate">{blok.titel}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{duurTekst(blok.duur)}</span>
      {prijzenZien && <span className="shrink-0 tabular-nums">{formatPrice(blok.bedrag)}</span>}
    </li>
  );
}

/**
 * Een plek om een straat op los te laten: een dag, en als er ploegen zijn ook
 * welke ploeg. Eigen component omdat een hook niet in een lus mag staan.
 */
function Plek({
  datum,
  ploegNr,
  actief,
  children,
}: {
  datum: string;
  ploegNr: number | null;
  actief: boolean;
  children: (setRef: (el: HTMLElement | null) => void, erboven: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `plek:${datum}:${ploegNr ?? 0}`,
    disabled: !actief,
  });
  return <>{children(setNodeRef, isOver)}</>;
}
