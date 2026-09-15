import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { Zijbalk } from "@/components/Zijbalk";
import { useAuth } from "@/lib/auth";
import { heeftRecht, rechtenVoorPad } from "@/lib/rechten";

/** De koptekst van een pagina. Ook bruikbaar buiten AppLayout, zodat een
 *  klikbare titel — de wijkkiezer — er precies zo uitziet. */
export const TITEL_KLASSEN =
  "truncate font-display text-[25px] font-semibold leading-tight tracking-[-0.02em]";

type Props = {
  /** Meestal gewoon tekst. Een node mag ook: de wijkenpagina zet er de
   *  wijkkiezer neer, zodat je de wijk wisselt door op de titel te klikken. */
  titel: ReactNode;
  /** Klein kruimelpad boven de titel, bijvoorbeeld "Overzicht / Klanten". */
  kruimel?: ReactNode;
  onderschrift?: ReactNode;
  /** Knoppen rechtsboven: de besturing van deze pagina. */
  acties?: ReactNode;
  /** Waar die knoppen staan: naast de titel, of als eigen balk boven of
   *  onder de cijferkaarten. Lager staat dichter bij de muis. */
  actiePositie?: "titelbalk" | "boven" | "onder";
  /** Optionele rij onder de titelbalk, bijvoorbeeld cijferkaarten. */
  kop?: ReactNode;
  children: ReactNode;
};

export function AppLayout({
  titel,
  kruimel,
  onderschrift,
  acties,
  actiePositie = "titelbalk",
  kop,
  children,
}: Props) {
  // De knoppenbalk plakt onder de titelbalk vast. Hoe hoog die is hangt af
  // van kruimel en onderschrift, dus we meten hem in plaats van te gokken.
  // Mag je deze pagina zien? Zolang je gegevens nog laden niet blokkeren: dan
  // flitst er "geen toegang" bij de eigenaar.
  const { employee } = useAuth();
  const pad = useRouterState({ select: (st) => st.location.pathname });
  const nodig = rechtenVoorPad(pad);
  const mag = !employee || !nodig || nodig.some((r) => heeftRecht(employee, r));

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
      className="sticky z-10 flex flex-wrap items-center gap-2 bg-background/95 px-6 pb-2 pt-3.5 backdrop-blur print:hidden"
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
        className="flex min-w-0 flex-1 flex-col"
        style={{ "--plakrand": `${kopHoogte + balkHoogte}px` } as CSSProperties}
      >
        <header
          ref={kopRef}
          className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur print:hidden"
        >
          <div className="flex flex-wrap items-center gap-3 px-6 py-3.5">
            <div className="mr-auto min-w-0">
              {kruimel &&
                (typeof kruimel === "string" ? (
                  <p className="text-[11.5px] leading-tight text-muted-foreground">{kruimel}</p>
                ) : (
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">{kruimel}</div>
                ))}
              {typeof titel === "string" ? (
                <h1 className={TITEL_KLASSEN}>{titel}</h1>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-2">{titel}</div>
              )}
              {onderschrift && <p className="text-xs text-muted-foreground">{onderschrift}</p>}
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
          <div className={`px-6 pt-4 ${acties && actiePositie === "onder" ? "" : "pb-4"}`}>
            {kop}
          </div>
        )}
        {actiePositie === "onder" && balk}
        <main className="min-w-0 flex-1 px-6 pb-4">
          {mag ? (
            children
          ) : (
            <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <Lock className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="font-display text-lg font-semibold">Geen toegang</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Je rol geeft je geen toegang tot deze pagina. Vraag de eigenaar om je rechten aan te passen.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
