import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRight as Pijl } from "@tabler/icons-react";

import { AppLayout } from "@/components/AppLayout";
import { TelBedrag, TelGetal } from "@/components/TelBedrag";
import { TEGEL_KLEUR, TEGEL_VAK, TegelKop } from "@/components/Tegel";
import { useAuth } from "@/lib/auth";
import { fetchGeldloopLijst, useGeldloopLive, type Vrijgave } from "@/lib/geldlopen";
import { cn } from "@/lib/utils";

/** De vorm van de twee brede vakken, zoals de vakken op Home. */
const GROOT_VAK =
  "col-span-2 flex flex-col h-[156px] rounded-[28px] px-5 py-4 md:h-[240px] md:px-[26px] md:py-[22px]";

/** Een balkje in de kleur van het vak zelf. */
function Balk({ procent, label }: { procent: number; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="block h-1.5 overflow-hidden rounded-full bg-current/20 md:h-2"
    >
      <span
        className="block h-full rounded-full bg-current transition-[width] duration-500"
        style={{ width: `${procent}%` }}
      />
    </span>
  );
}

/**
 * Wat een geldloper ziet als hij binnenkomt: hoeveel adressen hij nog moet,
 * hoeveel er samen nog te gaan zijn, en hoe ver de avond is. Aantallen, geen
 * bedragen — wie geen prijzen mag zien, hoeft de omzet niet te weten. Wat hij
 * zelf ophaalde ziet hij wél; dat heeft hij op zak.
 *
 * Aangebeld is aangebeld: wie niet thuis was of geen geld had telt net zo
 * goed als gelopen. Alleen adressen waar iets open staat tellen mee, want bij
 * de rest hoef je niet aan te bellen.
 */
export function LoperStart({
  vrijgave,
  titel,
  onBeginnen,
  bovenaan,
}: {
  vrijgave: Vrijgave;
  titel: string;
  onBeginnen: () => void;
  bovenaan?: ReactNode;
}) {
  const { employee } = useAuth();
  const lijst = useQuery({
    queryKey: ["geldloop-lijst", vrijgave.id],
    queryFn: () => fetchGeldloopLijst(vrijgave.id),
    refetchInterval: 60_000,
  });
  useGeldloopLive(vrijgave.id);
  const o = lijst.data?.opgehaald;

  // Wat jij vanavond aan de deur hebt meegemaakt, geteld over je eigen tikken.
  const mijnTikken = useMemo(() => {
    const uit = { betaald: 0, nietThuis: 0, geenGeld: 0 };
    for (const a of lijst.data?.adressen ?? []) {
      if (!a.vanavond || a.vanavond.door !== employee?.id) continue;
      if (a.vanavond.soort === "betaald") uit.betaald += 1;
      else if (a.vanavond.soort === "niet_thuis") uit.nietThuis += 1;
      else uit.geenGeld += 1;
    }
    return uit;
  }, [lijst.data, employee?.id]);

  const mijnTotaal = (o?.mijn_open ?? 0) + (o?.mijn_gedaan ?? 0);
  const mijnProcent = mijnTotaal > 0 ? Math.round(((o?.mijn_gedaan ?? 0) / mijnTotaal) * 100) : 0;
  const samenTotaal = (o?.samen_open ?? 0) + (o?.samen_gedaan ?? 0);
  const samenProcent =
    samenTotaal > 0 ? Math.round(((o?.samen_gedaan ?? 0) / samenTotaal) * 100) : 0;
  const leeg = <span className="opacity-40">—</span>;

  return (
    <AppLayout titel={titel}>
      <div className="mx-auto max-w-2xl space-y-3 pb-6">
        {bovenaan}
        <p className="px-1 text-[13px] text-muted-foreground">
          {vrijgave.wijken.map((w) => w.naam).join(", ")} · tot{" "}
          {new Date(vrijgave.eind_op).toLocaleTimeString("nl-NL", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {(vrijgave.lopers ?? []).length > 1 &&
            ` · samen met ${(vrijgave.lopers ?? [])
              .filter((l) => l.id !== employee?.id)
              .map((l) => l.naam.split(" ")[0])
              .join(", ")}`}
        </p>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
          <div className={cn(TEGEL_VAK, TEGEL_KLEUR.groen, GROOT_VAK)}>
            <TegelKop label="Jij nog te doen" pijl={false} />
            <span className="mt-2.5 whitespace-nowrap font-display text-[52px] font-semibold leading-none tracking-[-0.05em] tabular-nums md:mt-[18px] md:text-[80px]">
              {o ? <TelGetal waarde={o.mijn_open} /> : leeg}
            </span>
            <div className="mt-auto flex flex-col gap-[7px] md:gap-2.5">
              <span className="truncate text-[13px] opacity-80 md:text-[14.5px]">
                {o
                  ? `${o.mijn_open === 1 ? "adres" : "adressen"} in ${o.mijn_straten_open} ${
                      o.mijn_straten_open === 1 ? "straat" : "straten"
                    } · ${o.mijn_gedaan} al gelopen`
                  : " "}
              </span>
              {mijnTotaal > 0 && (
                <Balk procent={mijnProcent} label={`${mijnProcent} procent van jouw adressen`} />
              )}
            </div>
          </div>

          <div className={cn(TEGEL_VAK, TEGEL_KLEUR.oranje, GROOT_VAK)}>
            <TegelKop label="Samen nog te gaan" pijl={false} />
            <span className="mt-2.5 whitespace-nowrap font-display text-[52px] font-semibold leading-none tracking-[-0.05em] tabular-nums md:mt-[18px] md:text-[80px]">
              {o ? <TelGetal waarde={o.samen_open} /> : leeg}
            </span>
            <div className="mt-auto flex flex-col gap-[7px] md:gap-2.5">
              <span className="truncate text-[13px] opacity-80 md:text-[14.5px]">
                {o
                  ? `${o.samen_open === 1 ? "adres" : "adressen"} in de hele wijk · ${samenProcent}% gelopen`
                  : " "}
              </span>
              {samenTotaal > 0 && (
                <Balk procent={samenProcent} label={`${samenProcent} procent van de hele avond`} />
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[20px] bg-card px-4 py-3 shadow-card">
          <p className="text-[13px] text-muted-foreground">
            Jij afgerekend: <b className="font-semibold text-foreground">{mijnTikken.betaald}</b> ·
            niet thuis <b className="font-semibold text-foreground">{mijnTikken.nietThuis}</b> ·
            geen geld <b className="font-semibold text-foreground">{mijnTikken.geenGeld}</b>
          </p>
          {/* Wat hij zelf ophaalde mag hij zien; het teamtotaal blijft bij
              de eigenaar. */}
          {o && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Opgehaald:{" "}
              <b className="font-semibold text-foreground">
                <TelBedrag key={vrijgave.id} bedrag={o.mij} />
              </b>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onBeginnen}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
        >
          {o && o.mijn_gedaan > 0 ? "Verder lopen" : "Beginnen"}
          <Pijl className="size-5" />
        </button>

        {lijst.isError && (
          <p className="px-1 text-[13px] text-tint-rood-ink">{(lijst.error as Error).message}</p>
        )}
      </div>
    </AppLayout>
  );
}
