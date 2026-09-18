import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
} from "@tabler/icons-react";
import { formatPrice } from "@/lib/klanten";
import { datumSleutel, fetchWasdagen, vandaag } from "@/lib/wasdag";
import { isWerkdag, useWerkdagen } from "@/lib/werkdagen";
import { cn } from "@/lib/utils";

/** De maandag van de week waarin deze dag valt. */
function maandagVan(datum: string): Date {
  const d = new Date(`${datum}T12:00:00`);
  const stap = (d.getDay() + 6) % 7; // maandag = 0
  d.setDate(d.getDate() - stap);
  return d;
}

/**
 * De werkdagen van één week naast elkaar, met wat er per dag al op staat.
 * Staat bovenaan de wijkenpagina zolang je selecteert: tik een dag aan en je
 * bewerkt die, zonder eerst terug naar de planning.
 *
 * Dezelfde sleutel als het maandoverzicht (["wasdagen", van, tot]), zodat
 * inplannen deze strook vanzelf bijwerkt.
 */
export function WeekStrook({
  gekozen,
  onKies,
  prijzenZien,
}: {
  /** De dag die je bewerkt; leeg als je nog niets op een dag gezet hebt. */
  gekozen: string | null;
  onKies: (datum: string) => void;
  prijzenZien: boolean;
}) {
  const werkdagen = useWerkdagen();
  const nu = vandaag();
  // Welke week in beeld is. Kies je elders een dag, dan springt hij mee.
  const [anker, setAnker] = useState(() => gekozen ?? nu);
  useEffect(() => {
    if (gekozen) setAnker(gekozen);
  }, [gekozen]);

  const maandag = maandagVan(anker);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(maandag);
    d.setDate(maandag.getDate() + i);
    return datumSleutel(d);
  });
  // Zonder ingestelde werkdagen telt elke dag; dan alleen ma–vr, anders
  // passen ze op de telefoon niet naast elkaar.
  // De dag die je bewerkt staat er altijd in, ook als het geen werkdag is.
  const dagen = werkdagen.length
    ? week.filter((d) => isWerkdag(d, werkdagen) || d === gekozen)
    : week.filter((d, i) => i < 5 || d === gekozen);
  const van = week[0]!;
  const tot = week[6]!;

  const { data, isSuccess } = useQuery({
    queryKey: ["wasdagen", van, tot],
    queryFn: () => fetchWasdagen(van, tot),
  });
  const perDag = useMemo(() => {
    const m = new Map<string, { aantal: number; bedrag: number }>();
    for (const r of data ?? []) {
      const was = m.get(r.datum) ?? { aantal: 0, bedrag: 0 };
      m.set(r.datum, { aantal: was.aantal + 1, bedrag: was.bedrag + r.prijs });
    }
    return m;
  }, [data]);

  function schuif(weken: number) {
    const d = new Date(maandag);
    d.setDate(d.getDate() + weken * 7);
    setAnker(datumSleutel(d));
  }

  const pijl =
    "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";

  // Zelfde vorm als het maandfilter ernaast: één pil met knopjes erin, zodat
  // hij op dezelfde regel past en geen ruimte boven de straten kost.
  return (
    <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-card p-[3px] shadow-card [scrollbar-width:none]">
      <button type="button" className={pijl} onClick={() => schuif(-1)} aria-label="Vorige week">
        <ChevronLeft className="size-4" />
      </button>
      {dagen.map((d) => {
        const dag = perDag.get(d);
        const actief = d === gekozen;
        const datum = new Date(`${d}T12:00:00`);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onKies(d)}
            aria-pressed={actief}
            title={
              dag
                ? `${dag.aantal} ${dag.aantal === 1 ? "adres" : "adressen"} op deze dag`
                : "Nog niets op deze dag"
            }
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-center leading-[1.15] transition-colors",
              actief ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted",
            )}
          >
            <span
              className={cn(
                "block whitespace-nowrap text-[12px] font-medium",
                d === nu && !actief && "underline decoration-2 underline-offset-2",
              )}
            >
              {datum.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" })}
            </span>
            <span
              className={cn(
                "block whitespace-nowrap text-[10px] tabular-nums",
                actief ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {/* Tijdens laden of na een fout een streepje: "leeg" zou liegen. */}
              {!isSuccess
                ? "–"
                : !dag
                  ? "leeg"
                  : prijzenZien
                    ? formatPrice(dag.bedrag)
                    : `${dag.aantal} adr.`}
            </span>
          </button>
        );
      })}
      <button type="button" className={pijl} onClick={() => schuif(1)} aria-label="Volgende week">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
