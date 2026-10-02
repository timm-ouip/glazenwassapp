import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useDndContext, useDndMonitor, useDraggable, useDroppable } from "@dnd-kit/core";
import { format, getISOWeek, isSameMonth } from "date-fns";
import { nl } from "date-fns/locale";
import {
  IconAlertTriangle as AlertTriangle,
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconGripVertical as Greep,
} from "@tabler/icons-react";

import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  opzetVan,
  tijdVan,
  volPercentage,
  type Blok,
  type PlanInstellingen,
  type Ploeg,
  type Tijdlijn,
} from "@/lib/dagplanning";
import type { Bouwstenen } from "@/lib/dagbouwstenen";
import { afmeldstandTekst, type DagAfmeldstand } from "@/lib/dagklaar";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice, wijkInkt, wijkKleur, wijkVlak } from "@/lib/klanten";
import type { WeekDag } from "@/components/planning/WeekWeergave";
import { AfmeldTeken } from "@/components/planning/AfmeldTeken";

/** Wat een dag oplevert en welke wijken erop staan, zoals de maandkalender het telt. */
export interface DagOmzet {
  bedrag: number;
  /** Op volgorde van de wijkenlijst. */
  wijken: string[];
}

/** Eén team op één dag, of wat er nog bij geen team hoort. */
interface TeamKaart {
  sleutel: string;
  ploeg: Ploeg | null;
  /** "Deze dag" als er geen teams zijn, anders "Nog niet ingedeeld". */
  titel: string;
  blokken: Blok[];
  tijdlijn: Tijdlijn;
  /** Staat het op de klok? Werk dat bij niemand hoort heeft geen begintijd. */
  metKlok: boolean;
}

/** Eén wijk op de gekozen dag, om in één keer te verslepen. */
interface WijkGroep {
  id: string;
  naam: string;
  index: number;
  adressen: string[];
  straten: number;
  bedrag: number;
}

const KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];

const datumVan = (datum: string) => new Date(`${datum}T12:00:00`);

/**
 * De week op de telefoon. Bovenin een rij dagkaartjes (de dag, wat hij
 * oplevert en een bolletje per wijk), daaronder de gekozen dag per team, met
 * begintijden zoals op de computer.
 *
 * Een straat of een hele wijk sleep je naar een dagkaartje: aan het greepje
 * meteen, of na even vasthouden. Gewoon vegen blijft scrollen. Wat er bij
 * loslaten gebeurt, regelt de pagina — precies zoals in de weekweergave op de
 * computer.
 */
export function WeekTelefoon({
  dagen,
  afmeldstand,
  omzet,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  gekozenDag,
  onKiesDag,
  onBlader,
}: {
  dagen: WeekDag[];
  /** Hoe ver elke dag is met "Dag klaar": het vinkje op het dagkaartje. */
  afmeldstand: Map<string, DagAfmeldstand>;
  omzet: ReadonlyMap<string, DagOmzet>;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  gekozenDag: string;
  onKiesDag: (datum: string) => void;
  /** Een week terug (-1) of vooruit (1). */
  onBlader: (stap: number) => void;
}) {
  const rijRef = useRef<HTMLDivElement>(null);
  // Alleen of er gesleept wordt, niet waar je vinger is: dat verandert bij
  // elke beweging, en dan tekende de hele week steeds opnieuw. Wat de vinger
  // volgt zit in SleepHulp.
  const [sleept, setSleept] = useState(false);
  useDndMonitor({
    onDragStart: () => setSleept(true),
    onDragEnd: () => setSleept(false),
    onDragCancel: () => setSleept(false),
  });

  // Dezelfde blokken en tijden als de weekweergave op de computer: werk met
  // een team dat deze dag niet kent hoort bij "nog niet ingedeeld", en zonder
  // teams is er één kaart, en dan is dat de dag zelf — mét klok.
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
        const bekend = new Set(d.ploegen.map((pl) => pl.nr));
        const los = [...blokken.entries()].filter(([nr]) => !bekend.has(nr)).flatMap(([, b]) => b);
        const kaarten: TeamKaart[] =
          d.ploegen.length === 0
            ? [
                {
                  sleutel: "dag",
                  ploeg: null,
                  titel: "Deze dag",
                  blokken: los,
                  tijdlijn: berekenTijden(los, opzetVan(instellingen, null)),
                  metKlok: true,
                },
              ]
            : [
                ...d.ploegen.map((pl) => {
                  const eigen = blokken.get(pl.nr) ?? [];
                  return {
                    sleutel: `team:${pl.nr}`,
                    ploeg: pl,
                    titel: `Team ${pl.nr}`,
                    blokken: eigen,
                    tijdlijn: berekenTijden(eigen, opzetVan(instellingen, pl)),
                    metKlok: true,
                  };
                }),
                ...(los.length > 0
                  ? [
                      {
                        sleutel: "los",
                        ploeg: null,
                        titel: "Nog niet ingedeeld",
                        blokken: los,
                        tijdlijn: berekenTijden(los, opzetVan(instellingen, null)),
                        metKlok: false,
                      },
                    ]
                  : []),
              ];
        return {
          ...d,
          kaarten,
          leeg: d.regels.length === 0 && d.klussen.length === 0,
          teVol: kaarten.some((k) => k.metKlok && k.blokken.length > 0 && k.tijdlijn.teVol),
          werkMin: kaarten.reduce((som, k) => som + k.tijdlijn.werkMin, 0),
        };
      }),
    [dagen, bouwstenen, instellingen],
  );

  const dag = perDag.find((d) => d.datum === gekozenDag) ?? null;

  /** De wijken van de gekozen dag: alle straten van die wijk, over alle teams. */
  const wijkGroepen = useMemo(() => {
    const kaart = new Map<string, WijkGroep>();
    for (const k of dag?.kaarten ?? []) {
      for (const b of k.blokken) {
        // Een extra opdracht verhuist als opdracht, niet met zijn wijk mee.
        if (b.soort === "klus" || !b.wijk_id) continue;
        const groep = kaart.get(b.wijk_id) ?? {
          id: b.wijk_id,
          naam: b.wijknaam || "Onbekende wijk",
          index: bouwstenen.wijken.get(b.wijk_id)?.index ?? 0,
          adressen: [],
          straten: 0,
          bedrag: 0,
        };
        groep.adressen.push(...b.adressen);
        groep.straten += 1;
        groep.bedrag += b.bedrag;
        kaart.set(b.wijk_id, groep);
      }
    }
    return [...kaart.values()].sort((a, b) => a.index - b.index);
  }, [dag, bouwstenen.wijken]);

  // De gekozen dag in beeld schuiven, ook als hij aan het eind van de rij staat.
  useEffect(() => {
    const rij = rijRef.current;
    const kaartje = rij?.querySelector<HTMLElement>(`[data-datum="${gekozenDag}"]`);
    if (!rij || !kaartje) return;
    const links = kaartje.offsetLeft;
    const rechts = links + kaartje.offsetWidth;
    if (links >= rij.scrollLeft && rechts <= rij.scrollLeft + rij.clientWidth) return;
    rij.scrollTo({ left: links - (rij.clientWidth - kaartje.offsetWidth) / 2, behavior: "smooth" });
  }, [gekozenDag]);

  const plekken = useMemo(() => dagen.map((d) => `plek:${d.datum}:0`), [dagen]);

  const eerste = dagen[0]?.datum ?? gekozenDag;
  const laatste = dagen[dagen.length - 1]?.datum ?? gekozenDag;
  const maandTekst = isSameMonth(datumVan(eerste), datumVan(laatste))
    ? format(datumVan(eerste), "LLLL yyyy", { locale: nl })
    : `${format(datumVan(eerste), "LLLL", { locale: nl })} – ${format(datumVan(laatste), "LLLL yyyy", { locale: nl })}`;
  const weekTotaal = dagen.reduce((som, d) => som + (omzet.get(d.datum)?.bedrag ?? 0), 0);

  return (
    // Vegen hoort hier bij de rij dagkaartjes en bij het slepen, niet bij
    // "volgende week": daar zijn de pijltjes voor.
    <div className="flex flex-col gap-3" onTouchStart={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2.5 px-1">
        <button
          type="button"
          onClick={() => onBlader(-1)}
          aria-label="Vorige week"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card shadow-card"
        >
          <ChevronLeft className="size-[18px]" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] first-letter:uppercase">
            {maandTekst}
          </p>
          <p className="text-[12.5px] text-muted-foreground tabular-nums">
            week {getISOWeek(datumVan(gekozenDag))}
            {prijzenZien && ` · ${formatPrice(weekTotaal)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onBlader(1)}
          aria-label="Volgende week"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card shadow-card"
        >
          <ChevronRight className="size-[18px]" />
        </button>
      </div>

      {/* De rij plakt bovenin vast: zo staan de dagen er nog als je een straat
          van onderaan de lijst omhoog sleept. */}
      <div className="sticky z-10 -mx-2 bg-card" style={{ top: "var(--plakrand, 0px)" }}>
        <div
          ref={rijRef}
          className="relative flex items-end gap-2 overflow-x-auto px-3 pb-[18px] pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {perDag.map((d) => (
            <DagKaartje
              key={d.datum}
              datum={d.datum}
              gekozen={d.datum === gekozenDag}
              leeg={d.leeg}
              teVol={d.teVol}
              werkMin={d.werkMin}
              omzet={omzet.get(d.datum)}
              afmeldstand={afmeldstand.get(d.datum)}
              klussen={d.klussen.length > 0}
              bouwstenen={bouwstenen}
              prijzenZien={prijzenZien}
              sleepbaar={sleepbaar}
              sleept={sleept}
              onKies={() => onKiesDag(d.datum)}
            />
          ))}
        </div>
        {sleept && <SleepHulp rijRef={rijRef} plekken={plekken} />}
      </div>

      {dag && (
        <div className="flex flex-col gap-3">
          <DagKop
            datum={dag.datum}
            adressen={dag.regels.length}
            opdrachten={dag.klussen.length}
            werkMin={dag.werkMin}
            ploegen={dag.ploegen}
            bedrag={omzet.get(dag.datum)?.bedrag ?? 0}
            teVol={dag.teVol}
            prijzenZien={prijzenZien}
          />

          {dag.leeg ? (
            <div className="flex flex-col items-center gap-1 rounded-[22px] border-2 border-dashed border-border px-5 py-8 text-center text-[13px] text-muted-foreground">
              <b className="font-display text-[19px] font-semibold text-foreground">
                Nog niets gepland
              </b>
              {sleepbaar && (
                <span>Tik een andere dag aan en sleep een straat of wijk naar dit dagkaartje.</span>
              )}
            </div>
          ) : (
            <>
              {sleepbaar && wijkGroepen.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {wijkGroepen.map((w) => (
                    <WijkChip key={w.id} datum={dag.datum} wijk={w} prijzenZien={prijzenZien} />
                  ))}
                </div>
              )}
              {dag.kaarten.map((k) => (
                <TeamKaartBlok
                  key={k.sleutel}
                  kaart={k}
                  datum={dag.datum}
                  instellingen={instellingen}
                  bouwstenen={bouwstenen}
                  prijzenZien={prijzenZien}
                  sleepbaar={sleepbaar}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Alleen tijdens het slepen: de rij dagkaartjes schuift vanzelf mee als je
 * vinger bij de rand ervan komt, en een pilletje zegt waar het heen gaat.
 * Een eigen onderdeel, want het leest waar je vinger is, en dat verandert bij
 * elke beweging.
 */
function SleepHulp({
  rijRef,
  plekken,
}: {
  rijRef: RefObject<HTMLDivElement | null>;
  plekken: string[];
}) {
  const { over, measureDroppableContainers } = useDndContext();

  useEffect(() => {
    const rij = rijRef.current;
    if (!rij) return;
    let x = -1;
    let y = -1;
    let raf = 0;
    const volg = (e: TouchEvent | MouseEvent) => {
      const punt = "touches" in e ? e.touches[0] : e;
      if (!punt) return;
      x = punt.clientX;
      y = punt.clientY;
    };
    const tik = () => {
      const r = rij.getBoundingClientRect();
      if (x >= 0 && y > r.top - 20 && y < r.bottom + 10) {
        const stap = x < r.left + 44 ? -7 : x > r.right - 44 ? 7 : 0;
        if (stap !== 0) {
          const was = rij.scrollLeft;
          rij.scrollLeft += stap;
          // De kaartjes opnieuw opmeten, anders denkt het slepen dat ze nog
          // op hun oude plek staan.
          if (rij.scrollLeft !== was) measureDroppableContainers(plekken);
        }
      }
      raf = requestAnimationFrame(tik);
    };
    window.addEventListener("touchmove", volg, { passive: true });
    window.addEventListener("mousemove", volg);
    raf = requestAnimationFrame(tik);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("touchmove", volg);
      window.removeEventListener("mousemove", volg);
    };
  }, [rijRef, plekken, measureDroppableContainers]);

  const naar =
    over && String(over.id).startsWith("plek:") ? String(over.id).split(":")[1] : undefined;
  return (
    <p
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-2 text-[13.5px] font-semibold shadow-card ${
        naar ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
      }`}
    >
      {naar
        ? `Loslaten = naar ${format(datumVan(naar), "EEEEEE d MMM", { locale: nl })}`
        : "Sleep naar een dag hierboven"}
    </p>
  );
}

/** Eén dag bovenin: tikken kiest hem, en je kunt er werk op loslaten. */
function DagKaartje({
  datum,
  gekozen,
  leeg,
  teVol,
  werkMin,
  omzet,
  afmeldstand,
  klussen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  sleept,
  onKies,
}: {
  datum: string;
  gekozen: boolean;
  leeg: boolean;
  teVol: boolean;
  werkMin: number;
  omzet: DagOmzet | undefined;
  afmeldstand: DagAfmeldstand | undefined;
  klussen: boolean;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  sleept: boolean;
  onKies: () => void;
}) {
  // Het werk komt altijd van de gekozen dag: daar loslaten zou het alleen
  // uit zijn team halen. Dus is die dag geen plek om te landen.
  const { setNodeRef, isOver } = useDroppable({
    id: `plek:${datum}:0`,
    disabled: !sleepbaar || gekozen,
  });
  const d = datumVan(datum);
  // Zonder "prijzen zien" zijn alle bedragen 0; dan de tijd die het kost.
  const waarde = leeg ? "—" : prijzenZien ? formatPrice(omzet?.bedrag ?? 0) : duurTekst(werkMin);
  const indexen = (omzet?.wijken ?? []).flatMap((id) => {
    const i = bouwstenen.wijken.get(id)?.index;
    return i === undefined ? [] : [i];
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-datum={datum}
      onClick={onKies}
      aria-pressed={gekozen}
      aria-label={`${format(d, "EEEE d MMMM", { locale: nl })}, ${leeg ? "niets gepland" : waarde}${teVol ? ", te vol" : ""}${
        afmeldstand && afmeldstand.klaar > 0
          ? `, ${afmeldstandTekst(afmeldstand).toLowerCase()}`
          : ""
      }`}
      className={`relative flex shrink-0 select-none flex-col items-center gap-[3px] rounded-[22px] px-1 pb-2.5 pt-[11px] transition-[transform,width,height] duration-150 motion-reduce:transition-none ${
        gekozen
          ? "h-[122px] w-[74px] bg-primary text-primary-foreground"
          : leeg
            ? "h-[108px] w-16 border-2 border-dashed border-border"
            : "h-[108px] w-16 bg-card shadow-card"
      } ${sleept && !gekozen && sleepbaar ? "outline-dashed outline-2 -outline-offset-2 outline-primary" : ""} ${
        isOver
          ? "-translate-y-1.5 scale-[1.08] outline-solid outline-[3px] outline-offset-2 outline-foreground"
          : ""
      }`}
    >
      {/* Rechtsboven op de hoek, zodat het niet botst met "vol" in het midden. */}
      <AfmeldTeken stand={afmeldstand} datum={datum} className="absolute -right-1 -top-1" />
      {teVol && (
        <span className="absolute -top-[7px] left-1/2 -translate-x-1/2 rounded-full bg-tint-amber px-[7px] py-px text-[10px] font-bold tracking-[0.02em] text-tint-amber-ink">
          vol
        </span>
      )}
      <span
        className={`text-[12px] font-medium ${gekozen ? "opacity-75" : "text-muted-foreground"}`}
      >
        {KORT[d.getDay()]}
      </span>
      <span className="font-display text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        {String(d.getDate()).padStart(2, "0")}
      </span>
      <span className="mt-[3px] flex min-h-[7px] justify-center gap-[3px]" aria-hidden>
        {indexen.slice(0, 4).map((i) => (
          <i
            key={i}
            className="block size-[7px] rounded-full"
            style={{ background: wijkKleur(i) }}
          />
        ))}
        {klussen && <i className="block size-[7px] rounded-full bg-tint-amber" />}
      </span>
      <span className="mt-auto whitespace-nowrap text-[11.5px] font-semibold tabular-nums tracking-[-0.01em]">
        {waarde}
      </span>
      {gekozen && (
        <span
          aria-hidden
          className="absolute -bottom-[11px] left-1/2 h-1 w-[26px] -translate-x-1/2 rounded-full bg-primary"
        />
      )}
    </button>
  );
}

/** "Woensdag 7 oktober", wat er die dag staat, en wat hij oplevert. */
function DagKop({
  datum,
  adressen,
  opdrachten,
  werkMin,
  ploegen,
  bedrag,
  teVol,
  prijzenZien,
}: {
  datum: string;
  adressen: number;
  opdrachten: number;
  werkMin: number;
  ploegen: Ploeg[];
  bedrag: number;
  teVol: boolean;
  prijzenZien: boolean;
}) {
  const teams =
    ploegen.length === 0
      ? "geen team"
      : ploegen.length === 1
        ? `Team ${ploegen[0]!.nr}`
        : `${ploegen.length} teams`;
  const delen = [
    adressen > 0 && `${adressen} ${adressen === 1 ? "adres" : "adressen"}`,
    opdrachten > 0 && `${opdrachten} extra ${opdrachten === 1 ? "opdracht" : "opdrachten"}`,
    `${duurTekst(werkMin)} werk`,
    teams,
  ].filter(Boolean);
  const niets = adressen === 0 && opdrachten === 0;
  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.015em] first-letter:uppercase">
            {format(datumVan(datum), "EEEE d MMMM", { locale: nl })}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {niets ? "Nog niets gepland" : delen.join(" · ")}
          </p>
        </div>
        {prijzenZien && (
          <span className="whitespace-nowrap font-display text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {formatPrice(bedrag)}
          </span>
        )}
      </div>
      {teVol && (
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-tint-amber px-2.5 py-1 text-[12px] font-semibold text-tint-amber-ink">
          <AlertTriangle className="size-[15px]" /> Te vol
        </span>
      )}
    </div>
  );
}

/** Eén team op de gekozen dag: hoe vol het is, de straten op de klok, en hoe laat het klaar is. */
function TeamKaartBlok({
  kaart,
  datum,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
}: {
  kaart: TeamKaart;
  datum: string;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
}) {
  const { ploeg, tijdlijn, metKlok } = kaart;
  const teVol = metKlok && tijdlijn.teVol;
  const namen = ploeg && ploeg.leden.length > 0 ? ploegNaam(ploeg) : null;
  return (
    <div
      className={`flex flex-col gap-2 rounded-[22px] p-3 ${
        metKlok ? "bg-card shadow-card" : "border-2 border-dashed border-border"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <p className="min-w-0 truncate text-[14.5px] font-semibold">
          {kaart.titel}
          {namen && <span className="font-normal text-muted-foreground"> · {namen}</span>}
        </p>
        <span
          className={`shrink-0 text-[12px] tabular-nums ${teVol ? "font-semibold text-tint-amber-ink" : "text-muted-foreground"}`}
        >
          {metKlok
            ? `${duurTekst(tijdlijn.werkMin)} / ${duurTekst(tijdlijn.capaciteitMin)}`
            : `${duurTekst(tijdlijn.werkMin)} werk`}
        </span>
      </div>
      {metKlok && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${teVol ? "bg-tint-amber-ink/70" : "bg-tint-blauw-ink/70"}`}
            style={{ width: `${Math.min(100, volPercentage(tijdlijn))}%` }}
          />
        </div>
      )}
      {kaart.blokken.length === 0 ? (
        <p className="px-0.5 text-[12px] text-muted-foreground">Nog niets voor dit team</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {/* Uit de tijdlijn, zodat de begintijd erbij staat. Pauze en rijtijd
              laten we weg, net als in de week op de computer. */}
          {tijdlijn.items.map((item) =>
            item.blok ? (
              <BlokRij
                key={item.sleutel}
                blok={item.blok}
                datum={datum}
                tijd={metKlok && instellingen.tijdlijn ? tijdVan(item.start) : null}
                minuten={item.minuten}
                wijkIndex={bouwstenen.wijken.get(item.blok.wijk_id)?.index ?? null}
                prijzenZien={prijzenZien}
                sleepbaar={sleepbaar}
              />
            ) : null,
          )}
        </ul>
      )}
      {metKlok && instellingen.tijdlijn && kaart.blokken.length > 0 && (
        <div className="flex justify-between px-0.5 text-[12px] text-muted-foreground">
          <span>{teVol ? "loopt tot" : "klaar om"}</span>
          <span
            className={`tabular-nums ${teVol ? "font-bold text-tint-amber-ink" : "font-medium text-foreground"}`}
          >
            {tijdVan(tijdlijn.klaarOm)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Het greepje: hier pak je een straat of wijk meteen vast, zonder te wachten. */
function GreepJe() {
  return (
    <span
      data-greep
      aria-hidden
      className="-my-1.5 -mr-1.5 flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-[10px] opacity-60"
    >
      <Greep className="size-[18px]" />
    </span>
  );
}

/**
 * Eén straat (of groot pand, of extra opdracht) in de kleur van zijn wijk.
 * De sleep draagt hetzelfde mee als in de week op de computer, zodat de
 * pagina hem op dezelfde manier verplaatst.
 */
function BlokRij({
  blok,
  datum,
  tijd,
  minuten,
  wijkIndex,
  prijzenZien,
  sleepbaar,
}: {
  blok: Blok;
  datum: string;
  tijd: string | null;
  minuten: number;
  wijkIndex: number | null;
  prijzenZien: boolean;
  sleepbaar: boolean;
}) {
  const klus = blok.soort === "klus";
  // Een extra opdracht zet je op een andere dag met lang indrukken in de
  // lijst met extra opdrachten ("Zet op…"); hier sleep je straten.
  const kanSlepen = sleepbaar && !klus && blok.adressen.length > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${datum}:${blok.sleutel}`,
    disabled: !kanSlepen,
    data: { soort: "blok", adressen: blok.adressen, titel: blok.titel, datum },
  });
  const aantal = blok.adressen.length;
  return (
    <li
      ref={setNodeRef}
      {...(kanSlepen ? attributes : {})}
      {...(kanSlepen ? listeners : {})}
      // bg-tint-geel naast de kleur: daaraan ziet het thema Fel dat hier een
      // fel vlak ligt, en zet het de tekst erop donker.
      className={`flex select-none items-center gap-2 rounded-[14px] py-2 pl-2.5 pr-2 [-webkit-touch-callout:none] ${
        klus ? "bg-tint-geel text-tint-geel-ink" : ""
      } ${kanSlepen ? "cursor-grab" : ""} ${isDragging ? "opacity-30" : ""}`}
      style={
        klus
          ? undefined
          : {
              background: wijkIndex === null ? "var(--muted)" : wijkVlak([wijkIndex]),
              color: wijkIndex === null ? undefined : wijkInkt(wijkIndex),
            }
      }
    >
      {tijd && (
        <span className="w-10 shrink-0 text-[12px] font-semibold tabular-nums opacity-80">
          {tijd}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-tight">{blok.titel}</span>
        <span className="text-[11.5px] tabular-nums opacity-80">
          {duurTekst(minuten)} ·{" "}
          {klus ? "extra opdracht" : `${aantal} ${aantal === 1 ? "adres" : "adressen"}`}
        </span>
      </span>
      {prijzenZien && (
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums">
          {formatPrice(blok.bedrag)}
        </span>
      )}
      {kanSlepen && <GreepJe />}
    </li>
  );
}

/** Een hele wijk van de gekozen dag, om in één keer naar een andere dag te slepen. */
function WijkChip({
  datum,
  wijk,
  prijzenZien,
}: {
  datum: string;
  wijk: WijkGroep;
  prijzenZien: boolean;
}) {
  const titel = `${wijk.naam} (${wijk.straten} ${wijk.straten === 1 ? "straat" : "straten"})`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${datum}:wijk:${wijk.id}`,
    data: { soort: "blok", adressen: wijk.adressen, titel, datum },
  });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${titel} verslepen`}
      className={`inline-flex cursor-grab select-none items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-[12.5px] font-semibold [-webkit-touch-callout:none] ${
        isDragging ? "opacity-30" : ""
      }`}
      style={{ background: wijkVlak([wijk.index]), color: wijkInkt(wijk.index) }}
    >
      {wijk.naam}
      {prijzenZien && <span className="tabular-nums">· {formatPrice(wijk.bedrag)}</span>}
      <span
        data-greep
        aria-hidden
        className="flex size-[30px] touch-none items-center justify-center rounded-full opacity-60"
      >
        <Greep className="size-4" />
      </span>
    </span>
  );
}
