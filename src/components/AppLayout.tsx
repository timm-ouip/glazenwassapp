import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { WachtrijVerzender } from "@/components/betalingen/WachtrijVerzender";
import { useRouterState } from "@tanstack/react-router";
import { IconLock as Lock } from "@tabler/icons-react";

import { Tabbalk } from "@/components/Tabbalk";
import { Zijbalk } from "@/components/Zijbalk";
import { PaaltjeKnop } from "@/components/paaltje/PaaltjeKnop";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVerbergBijScrollen } from "@/hooks/use-verberg-bij-scrollen";
import { useAuth } from "@/lib/auth";
import { heeftRecht, rechtenVoorPad } from "@/lib/rechten";

/** De koptekst van een pagina. Ook bruikbaar buiten AppLayout, zodat een
 *  klikbare titel — de wijkkiezer — er precies zo uitziet. */
export const TITEL_KLASSEN =
  "truncate font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]";

type Props = {
  /** Meestal gewoon tekst. Een node mag ook: de wijkenpagina zet er de
   *  wijkkiezer neer, zodat je de wijk wisselt door op de titel te klikken. */
  titel: ReactNode;
  /** Niet meer getoond; blijft staan zodat de pagina's niet allemaal tegelijk
   *  aangepast hoeven te worden. */
  kruimel?: ReactNode;
  /** Niet meer getoond, zie `kruimel`. */
  onderschrift?: ReactNode;
  /** Klein regeltje náást de naam, voor wat nergens anders staat: de plaats
   *  van een wijk, of waar een dag uit bestaat. Past het niet, dan valt het
   *  weg in plaats van de kop hoger te maken. */
  naastTitel?: ReactNode;
  /** Knoppen rechtsboven: de besturing van deze pagina. */
  acties?: ReactNode;
  /** Waar die knoppen staan: naast de titel, of als eigen balk boven of
   *  onder de cijferkaarten. Lager staat dichter bij de muis. */
  actiePositie?: "titelbalk" | "boven" | "onder";
  /** Optionele rij onder de titelbalk, bijvoorbeeld cijferkaarten. */
  kop?: ReactNode;
  /** Op de telefoon de knoppenbalk wegschuiven als je omlaag scrolt. Een
   *  eigen plakbalk op de pagina doet mee met de klasse
   *  `group-data-[weg]/layout:…` en de variabele --balkhoogte. */
  verbergBijScrollen?: boolean;
  /** Op de telefoon: een balk onderin, vlak boven de tabs. Daar zet je wat
   *  je met je duim moet kunnen bereiken, zoals de zoekbalk. */
  onderbalk?: ReactNode;
  /** Geen titelbalk bovenaan: de pagina zet zelf een kop neer (Home, met
   *  de begroeting). `titel` blijft nodig, maar wordt dan niet getoond. */
  zonderTitelbalk?: boolean;
  children: ReactNode;
};

export function AppLayout({
  titel,
  naastTitel,
  acties,
  actiePositie = "titelbalk",
  kop,
  verbergBijScrollen = false,
  onderbalk,
  zonderTitelbalk = false,
  children,
}: Props) {
  // De knoppenbalk plakt onder de titelbalk vast. Hoe hoog die is hangt af
  // van de titel, dus we meten hem in plaats van te gokken.
  // Mag je deze pagina zien? Zolang je gegevens nog laden niet blokkeren: dan
  // flitst er "geen toegang" bij de eigenaar.
  const { employee } = useAuth();
  const pad = useRouterState({ select: (st) => st.location.pathname });
  const nodig = rechtenVoorPad(pad);
  const mag = !employee || !nodig || nodig.some((r) => heeftRecht(employee, r));

  const mobiel = useIsMobile();
  const weg = useVerbergBijScrollen(verbergBijScrollen && mobiel);

  const kopRef = useRef<HTMLElement>(null);
  const balkRef = useRef<HTMLDivElement>(null);
  const [kopHoogte, setKopHoogte] = useState(0);
  const [balkHoogte, setBalkHoogte] = useState(0);

  useEffect(() => {
    const meet = () => {
      if (kopRef.current) setKopHoogte(kopRef.current.offsetHeight);
      setBalkHoogte(balkRef.current?.offsetHeight ?? 0);
    };
    meet();
    const ro = new ResizeObserver(meet);
    if (kopRef.current) ro.observe(kopRef.current);
    if (balkRef.current) ro.observe(balkRef.current);
    return () => ro.disconnect();
  }, [acties, actiePositie]);

  // De cijferkaarten scrollen gewoon weg — dat zijn getallen om even naar te
  // kijken. De besturing blijft staan, want die heb je onderweg nodig.
  const balk = mag && acties && (
    <div
      ref={balkRef}
      className="sticky z-10 flex flex-wrap items-center gap-2 bg-background/95 px-3 pb-2 pt-3 backdrop-blur transition-transform duration-200 group-data-[weg]/layout:-translate-y-full md:px-6 md:pt-3.5 print:hidden"
      style={{ top: kopHoogte }}
    >
      {acties}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <Zijbalk />
      {/* Alles wat blijft plakken eindigt op --plakrand. Een lijst met een
          eigen vastgeplakte kolomkop hangt zichzelf daaraan op, in plaats van
          een hoogte te gokken die na elke wijziging weer niet klopt. */}
      <div
        className="group/layout flex min-w-0 flex-1 flex-col"
        data-weg={weg ? "" : undefined}
        style={
          {
            "--plakrand": `${kopHoogte + balkHoogte}px`,
            "--balkhoogte": `${balkHoogte}px`,
          } as CSSProperties
        }
      >
        <header
          ref={kopRef}
          hidden={zonderTitelbalk}
          className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur print:hidden"
        >
          <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 md:px-6 md:py-3.5">
            <div className="mr-auto min-w-0">
              {/* Een kruimelpad dat zegt wat het menu links al aanwijst, en een
                  onderschrift dat vertelt wat je op het scherm ziet: samen
                  kostten die een halve balk op elke pagina. Alleen de naam dus.
                  Een titel die geen tekst is (de wijkkiezer) blijft staan. */}
              <div className="flex min-w-0 items-baseline gap-2">
                {typeof titel === "string" ? (
                  <h1 className={TITEL_KLASSEN}>{titel}</h1>
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">{titel}</div>
                )}
                {naastTitel && (
                  <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground md:block">
                    {naastTitel}
                  </span>
                )}
              </div>
            </div>
            {acties && actiePositie === "titelbalk" && (
              <div className="flex flex-wrap items-center gap-2">{acties}</div>
            )}
          </div>
        </header>
        {actiePositie === "boven" && balk}
        {/* Komt er een knoppenbalk onder de cijferkaarten, dan zorgt die voor
            de ruimte eronder. Anders zouden de kaarten tegen de inhoud aan
            plakken: erboven lucht, eronder niets. */}
        {kop && (
          <div
            className={`px-3 pt-3 md:px-6 md:pt-4 ${acties && actiePositie === "onder" ? "" : "pb-4"}`}
          >
            {kop}
          </div>
        )}
        {actiePositie === "onder" && balk}
        {/* Onderaan ruimte voor wat er op de telefoon onderin zweeft: de tabs, de
            balk erboven en de Paaltje-knop, zodat je de laatste regel vrij kunt scrollen. */}
        <main className="min-w-0 flex-1 px-3 pb-[calc(var(--onderrand,0px)+5rem)] md:px-6 md:pb-4">
          {mag ? (
            children
          ) : (
            <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Lock className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="font-display text-lg font-semibold">Geen toegang</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Je rol geeft je geen toegang tot deze pagina. Vraag de eigenaar om je rechten aan te
                passen.
              </p>
            </div>
          )}
        </main>
      </div>
      <Tabbalk boven={mag ? onderbalk : undefined} />
      {employee && <PaaltjeKnop />}
      {/* Tikken van een geldloper die nog op de telefoon staan: overal versturen. */}
      {employee && <WachtrijVerzender />}
    </div>
  );
}
