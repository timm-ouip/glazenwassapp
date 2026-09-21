import { useMemo, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { IconUsers as Users } from "@tabler/icons-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useVerfSelectie } from "@/components/planning/verfselectie";
import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  NIET_INGEDEELD,
  opzetVan,
  tijdVan,
  volPercentage,
  type Blok,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type Tijdlijn,
} from "@/lib/dagplanning";
import type { Bouwstenen } from "@/lib/dagbouwstenen";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice, wijkInkt, wijkVlak } from "@/lib/klanten";

/** Eén dag in de week, met wat er die dag te doen is. */
export interface WeekDag {
  datum: string;
  regels: DagRegel[];
  klussen: DagKlus[];
  ploegen: Ploeg[];
}

/** Eén regel in het menu van een blok. */
interface Actie {
  sleutel: string;
  label: string;
  kop?: boolean;
  doe: () => void;
}

/**
 * De week: een kolom per werkdag. Bovenaan staat wat er die dag nog bij geen
 * ploeg hoort, daaronder een kaartje per ploeg.
 *
 * Elk kaartje heeft zijn eigen vol-balk, zodat je ziet waar nog ruimte is, en
 * de begintijd staat bij elke straat. Je sleept werk naar een andere dag of
 * ploeg, en met "Selecteren" wijs je met een streek aan wat er tegelijk mee
 * moet.
 */
export function WeekWeergave({
  dagen,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  onKies,
  selectieActies,
  onOpenDag,
  onPloegen,
  onNaarPloeg,
}: {
  dagen: WeekDag[];
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  onKies: (ids: string[], aan: boolean, dag: string) => void;
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
  onOpenDag: (datum: string) => void;
  onPloegen: (datum: string) => void;
  onNaarPloeg: (datum: string, ids: string[], ploegNr: number | null, klusId?: string) => void;
}) {
  const verf = useVerfSelectie({
    actief: selecteren && sleepbaar,
    isGekozen: (id) => gekozen.has(id),
    onKies,
  });

  const perDag = useMemo(
    () =>
      dagen.map((d) => {
        const blokken = maakBlokken({
          regels: d.regels,
          klussen: d.klussen,
          adressen: bouwstenen.adressen,
          straten: bouwstenen.straten,
          wijken: bouwstenen.wijken,
        });
        // Werk zonder ploeg, én werk met een ploegnummer dat deze dag niet
        // kent (na opschuiven bijvoorbeeld), hoort bovenaan de kolom: daar kun
        // je het vandaan slepen naar een ploeg.
        const bekend = new Set(d.ploegen.map((pl) => pl.nr));
        const los = [...blokken.entries()].filter(([nr]) => !bekend.has(nr)).flatMap(([, b]) => b);
        return { ...d, blokken, los };
      }),
    [dagen, bouwstenen],
  );

  return (
    <div className="overflow-x-auto">
      <div
        className={`grid min-w-[52rem] gap-2 ${selecteren ? "select-none" : ""}`}
        style={{ gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))` }}
        {...verf}
      >
        {perDag.map((d) => (
          <div key={d.datum} className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onOpenDag(d.datum)}
                className="min-w-0 flex-1 truncate rounded-[10px] px-1 py-1 text-[12.5px] font-medium hover:bg-accent"
              >
                {new Date(`${d.datum}T12:00:00`).toLocaleDateString("nl-NL", {
                  weekday: "short",
                  day: "numeric",
                })}
              </button>
              {sleepbaar && (
                <button
                  type="button"
                  onClick={() => onPloegen(d.datum)}
                  aria-label={`Ploegen indelen voor ${d.datum}`}
                  title="Ploegen indelen"
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Users className="size-3.5" />
                </button>
              )}
            </div>

            {/* Nog niet ingedeeld staat bovenaan, ook als het leeg is zolang er
                ploegen zijn: dan is er een plek om iets naartoe te slepen. */}
            {(d.los.length > 0 || d.ploegen.length > 0) && (
              <Plek datum={d.datum} ploegNr={null} actief={sleepbaar}>
                {(setRef, erboven) => (
                  <Kaart
                    setRef={setRef}
                    erboven={erboven}
                    ploeg={null}
                    datum={d.datum}
                    ploegenVanDag={d.ploegen}
                    blokken={d.los}
                    tijdlijn={berekenTijden(d.los, opzetVan(instellingen, null))}
                    instellingen={instellingen}
                    bouwstenen={bouwstenen}
                    prijzenZien={prijzenZien}
                    sleepbaar={sleepbaar}
                    selecteren={selecteren}
                    gekozen={gekozen}
                    selectieActies={selectieActies}
                    onNaarPloeg={onNaarPloeg}
                  />
                )}
              </Plek>
            )}

            {d.ploegen.map((pl) => {
              const blokken = d.blokken.get(pl.nr) ?? [];
              return (
                <Plek key={pl.nr} datum={d.datum} ploegNr={pl.nr} actief={sleepbaar}>
                  {(setRef, erboven) => (
                    <Kaart
                      setRef={setRef}
                      erboven={erboven}
                      ploeg={pl}
                      datum={d.datum}
                      ploegenVanDag={d.ploegen}
                      blokken={blokken}
                      tijdlijn={berekenTijden(blokken, opzetVan(instellingen, pl))}
                      instellingen={instellingen}
                      bouwstenen={bouwstenen}
                      prijzenZien={prijzenZien}
                      sleepbaar={sleepbaar}
                      selecteren={selecteren}
                      gekozen={gekozen}
                      selectieActies={selectieActies}
                      onNaarPloeg={onNaarPloeg}
                    />
                  )}
                </Plek>
              );
            })}

            {/* Een dag zonder ploegen: één vak waar alles op valt. */}
            {d.ploegen.length === 0 && d.los.length === 0 && (
              <Plek datum={d.datum} ploegNr={null} actief={sleepbaar}>
                {(setRef, erboven) => (
                  <div
                    ref={setRef}
                    className={`min-h-20 rounded-[14px] border border-dashed p-1.5 text-center text-[11px] text-muted-foreground ${
                      erboven ? "border-primary bg-accent/60" : "border-border"
                    }`}
                  >
                    niets gepland
                  </div>
                )}
              </Plek>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Eén ploeg op één dag, of wat er nog niet ingedeeld is. */
function Kaart({
  setRef,
  erboven,
  ploeg,
  datum,
  ploegenVanDag,
  blokken,
  tijdlijn,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  selectieActies,
  onNaarPloeg,
}: {
  setRef: (el: HTMLElement | null) => void;
  erboven: boolean;
  ploeg: Ploeg | null;
  datum: string;
  ploegenVanDag: Ploeg[];
  blokken: Blok[];
  tijdlijn: Tijdlijn;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
  onNaarPloeg: (datum: string, ids: string[], ploegNr: number | null, klusId?: string) => void;
}) {
  const vol = volPercentage(tijdlijn);
  const leeg = blokken.length === 0;
  return (
    <div
      ref={setRef}
      className={`rounded-[14px] border p-1.5 text-left transition-colors ${
        ploeg ? "min-h-24" : "min-h-14 border-dashed"
      } ${erboven ? "border-primary bg-accent/60" : "border-border bg-card"}`}
    >
      <p className="mb-1 truncate text-[11.5px] font-medium text-muted-foreground">
        {ploeg ? ploegNaam(ploeg) : "Nog niet ingedeeld"}
      </p>

      {leeg && !ploeg && (
        <p className="px-1 text-[10.5px] text-muted-foreground">sleep hier werk naartoe</p>
      )}

      <ul className="space-y-0.5">
        {/* Uit de tijdlijn, zodat de begintijd er meteen bij staat. Pauze en
            rijtijd laten we hier weg: in een kolom van deze breedte zeggen ze
            weinig, en in de dagweergave staan ze wel. */}
        {tijdlijn.items
          .filter((item) => item.blok)
          .map((item) => (
            <BlokRegel
              key={item.sleutel}
              blok={item.blok!}
              datum={datum}
              huidigePloeg={ploeg?.nr ?? NIET_INGEDEELD}
              ploegenVanDag={ploegenVanDag}
              bouwstenen={bouwstenen}
              prijzenZien={prijzenZien}
              sleepbaar={sleepbaar}
              selecteren={selecteren}
              gekozen={gekozen}
              selectieActies={selectieActies}
              onNaarPloeg={onNaarPloeg}
              tijd={instellingen.tijdlijn && ploeg ? tijdVan(item.start) : null}
              minuten={item.minuten}
            />
          ))}
      </ul>

      {!leeg && ploeg && (
        <>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${tijdlijn.teVol ? "bg-tint-amber-ink/70" : "bg-tint-blauw-ink/70"}`}
                style={{ width: `${Math.min(100, vol)}%` }}
              />
            </div>
            <span
              className={`shrink-0 text-[10.5px] tabular-nums ${tijdlijn.teVol ? "text-tint-amber-ink" : "text-muted-foreground"}`}
            >
              {duurTekst(tijdlijn.werkMin)}/{duurTekst(tijdlijn.capaciteitMin)}
            </span>
          </div>
          {instellingen.tijdlijn && (
            <div className="mt-1 flex items-baseline justify-between border-t border-border/60 pt-1 text-[10.5px]">
              <span className="text-muted-foreground">
                {tijdlijn.teVol ? "loopt tot" : "klaar om"}
              </span>
              <span
                className={`tabular-nums ${tijdlijn.teVol ? "text-tint-amber-ink" : "font-medium"}`}
              >
                {tijdVan(tijdlijn.klaarOm)}
              </span>
            </div>
          )}
        </>
      )}

      {!leeg && !ploeg && (
        <p className="mt-1 px-1 text-[10.5px] text-muted-foreground">
          {duurTekst(tijdlijn.werkMin)} werk
        </p>
      )}
    </div>
  );
}

/** Eén straat of opdracht, in de kleur van zijn wijk. */
function BlokRegel({
  blok,
  datum,
  huidigePloeg,
  ploegenVanDag,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  selectieActies,
  onNaarPloeg,
  tijd,
  minuten,
}: {
  blok: Blok;
  datum: string;
  huidigePloeg: number;
  ploegenVanDag: Ploeg[];
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
  onNaarPloeg: (datum: string, ids: string[], ploegNr: number | null, klusId?: string) => void;
  /** Hoe laat hij begint, of niets als er geen klok is. */
  tijd: string | null;
  minuten: number;
}) {
  const klus = blok.soort === "klus";
  // Hoort hij bij de selectie, dan gaat die hele selectie mee als je sleept.
  const aangewezen = !klus && blok.adressen.some((id) => gekozen.has(id));
  const mee = aangewezen ? [...gekozen] : blok.adressen;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${datum}:${blok.sleutel}`,
    // Tijdens het selecteren is een streek een selectie, geen sleep.
    disabled: !sleepbaar || selecteren,
    data: {
      soort: "blok",
      adressen: mee,
      titel: blok.titel,
      datum,
      ...(blok.klusId ? { klusId: blok.klusId } : {}),
    },
  });
  // Laat je iets op deze straat vallen, dan komt het hiervóór te staan en
  // schuift de rest gewoon op.
  const { setNodeRef: setPlekRef, isOver } = useDroppable({
    id: `voor|${datum}|${huidigePloeg}|${blok.sleutel}`,
    disabled: !sleepbaar || selecteren,
  });
  const zetRef = (el: HTMLElement | null) => {
    setNodeRef(el);
    setPlekRef(el);
  };

  const index = bouwstenen.wijken.get(blok.wijk_id)?.index ?? null;
  const vlak = klus ? "var(--tint-geel)" : index === null ? undefined : wijkVlak([index]);
  const inkt = klus ? "var(--tint-geel-ink)" : index === null ? undefined : wijkInkt(index);

  const acties: Actie[] = [];
  if (sleepbaar) {
    const bulk = selectieActies(blok.adressen);
    if (bulk.length > 0) {
      acties.push({
        sleutel: "selkop",
        label: `Selectie (${gekozen.size})`,
        kop: true,
        doe: () => {},
      });
      for (const a of bulk) acties.push({ ...a });
      acties.push({ sleutel: "eigenkop", label: blok.titel, kop: true, doe: () => {} });
    }
    for (const pl of ploegenVanDag) {
      if (pl.nr === huidigePloeg) continue;
      acties.push({
        sleutel: `ploeg:${pl.nr}`,
        label: `Naar ${ploegNaam(pl)}`,
        doe: () => onNaarPloeg(datum, blok.adressen, pl.nr, blok.klusId),
      });
    }
    if (huidigePloeg !== NIET_INGEDEELD) {
      acties.push({
        sleutel: "uitploeg",
        label: "Uit de ploeg halen",
        doe: () => onNaarPloeg(datum, blok.adressen, null, blok.klusId),
      });
    }
  }

  const regel = (
    <li
      ref={zetRef}
      {...attributes}
      {...listeners}
      {...(klus
        ? {}
        : {
            "data-kies": blok.adressen.join(","),
            "data-kies-sleutel": `${datum}:${blok.sleutel}`,
            "data-kies-dag": datum,
          })}
      className={`rounded-[8px] px-1.5 py-0.5 text-[11.5px] ${isDragging ? "opacity-40" : ""} ${
        aangewezen ? "outline outline-2 -outline-offset-2 outline-primary" : ""
      } ${isOver ? "border-t-2 border-primary" : ""}`}
      style={{ background: vlak ?? "var(--muted)", color: inkt }}
    >
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-medium">{blok.titel}</span>
        {prijzenZien && <span className="shrink-0 tabular-nums">{formatPrice(blok.bedrag)}</span>}
      </div>
      <div className="flex items-center gap-1 text-[10.5px] opacity-80">
        {tijd && <span className="tabular-nums">{tijd}</span>}
        <span className="tabular-nums">{duurTekst(minuten)}</span>
        {blok.soort === "straat" && <span>· {blok.adressen.length}</span>}
      </div>
    </li>
  );

  if (acties.length === 0) return regel;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{regel}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {acties.map((a) =>
          a.kop ? (
            <div key={a.sleutel}>
              <ContextMenuSeparator />
              <ContextMenuLabel className="text-[11.5px] text-muted-foreground">
                {a.label}
              </ContextMenuLabel>
            </div>
          ) : (
            <ContextMenuItem key={a.sleutel} onSelect={a.doe}>
              {a.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Een plek om werk op los te laten: een dag, en als er ploegen zijn ook welke
 * ploeg. Eigen component omdat een hook niet in een lus mag staan.
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
