/**
 * De stand van een gebied boven de looplijst op de telefoon: hoeveel deuren
 * je gehad hebt, een balk in de kleuren van de uitkomsten, en per uitkomst
 * een tabje. Een tik op een tabje laat alleen die adressen zien (handig voor
 * een tweede ronde langs "niet thuis"); nog een tik en je ziet alles weer.
 *
 * De computer heeft dezelfde tabjes en getallen in het witte vak van de
 * pagina, in de vorm van de Wijken-pagina (LOOP_TABS).
 */
import { LOOP_TABS } from "@/components/lopen/loopTabs";
import { type LoopFilter, type LoopGebied } from "@/lib/lopen";
import { cn } from "@/lib/utils";

export function LoopStand({
  gebied,
  filter,
  onFilter,
}: {
  gebied: LoopGebied;
  filter: LoopFilter | null;
  /** Hetzelfde tabje nog eens geeft null: alles weer zien. */
  onFilter: (filter: LoopFilter | null) => void;
}) {
  // Dezelfde getallen als de tabjes: een "ja" die klant werd telt mee als gehad.
  const gehad = gebied.niet_thuis + gebied.interesse + gebied.ja + gebied.nee;
  const teDoen = gehad + gebied.te_lopen;
  const deel = (n: number) => `${teDoen > 0 ? (n / teDoen) * 100 : 0}%`;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[24px] font-semibold leading-none tracking-[-0.01em] tabular-nums">
          {gehad} van {teDoen}
        </span>
        <span className="text-[12.5px] text-muted-foreground">
          deuren gehad
          {gebied.klanten > 0 && ` · ${gebied.klanten} al klant`}
          {gebied.plaats && ` · ${gebied.plaats}`}
        </span>
      </div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={`${gehad} van ${teDoen} deuren gehad`}
      >
        {LOOP_TABS.filter((t) => t.filter !== "open").map((t) => (
          <span
            key={t.filter}
            className={cn("h-full", t.kleur)}
            style={{ width: deel(t.tel(gebied)) }}
          />
        ))}
      </div>
      <div className="flex">
        {LOOP_TABS.map((t) => {
          const aan = filter === t.filter;
          return (
            <button
              key={t.filter}
              type="button"
              aria-pressed={aan}
              title={aan ? "Alles weer zien" : `Alleen ${t.label.toLowerCase()} zien`}
              onClick={() => onFilter(aan ? null : t.filter)}
              className={cn(
                "min-h-11 min-w-0 flex-1 border-b-[3px] border-transparent pb-1.5 pt-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
                aan && "border-primary",
              )}
            >
              <span className="block font-display text-[19px] font-semibold leading-tight tabular-nums">
                {t.tel(gebied)}
              </span>
              <span
                className={cn(
                  "block text-[11px] text-muted-foreground",
                  aan && "font-semibold text-foreground",
                )}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
