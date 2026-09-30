import { useEffect, useState } from "react";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
} from "@tabler/icons-react";

import { formatPrice } from "@/lib/klanten";

/** Eén straat (of "Extra opdrachten") met zijn deel van het geld. */
export interface VerdelingDeel {
  naam: string;
  bedrag: number;
  /** Tailwind-klasse voor het vierkantje, bijv. "bg-tint-paars-mid". */
  kleur: string;
  /** Dezelfde kleur als CSS-waarde, voor de donut en de blokjes. */
  vul: string;
}

const WEERGAVEN = ["donut", "balk", "staven", "blokjes"] as const;
type Weergave = (typeof WEERGAVEN)[number];
const NAMEN: Record<Weergave, string> = {
  donut: "Donut",
  balk: "Balk",
  staven: "Per straat",
  blokjes: "Honderd blokjes",
};
const OPSLAG = "wooshy.verdeling-weergave";

/**
 * Hoe het geld van de dag over de straten verdeeld is, op vier manieren: je
 * bladert er met de pijltjes doorheen. Welke je het laatst bekeek onthoudt
 * dit toestel. Bij alle vier staat het percentage én het bedrag.
 */
export function Verdeling({ delen }: { delen: VerdelingDeel[] }) {
  const [weergave, setWeergave] = useState<Weergave>("donut");
  // Pas na het laden lezen: de server kent de opslag van dit toestel niet.
  useEffect(() => {
    try {
      const was = localStorage.getItem(OPSLAG);
      if (was && (WEERGAVEN as readonly string[]).includes(was)) setWeergave(was as Weergave);
    } catch {
      // Privémodus of geblokkeerde opslag: dan gewoon de donut.
    }
  }, []);
  function blader(stap: number) {
    const i = WEERGAVEN.indexOf(weergave);
    const volgende = WEERGAVEN[(i + stap + WEERGAVEN.length) % WEERGAVEN.length]!;
    setWeergave(volgende);
    try {
      localStorage.setItem(OPSLAG, volgende);
    } catch {
      /* zie hierboven */
    }
  }

  const totaal = delen.reduce((som, d) => som + d.bedrag, 0);
  // Eén keer uitgerekend en overal hetzelfde: samen precies 100, zodat het
  // aantal blokjes altijd klopt met het getal ernaast.
  const procenten = verdeelHonderd(delen.map((d) => d.bedrag));
  const pctVan = new Map(delen.map((d, i) => [d.naam, procenten[i] ?? 0]));
  const pct = (d: VerdelingDeel) => pctVan.get(d.naam) ?? 0;

  const legenda = (
    // Minstens zo breed dat een straatnaam leesbaar blijft; past dat niet
    // naast de grafiek (de smalle zijkolom), dan komt de lijst eronder.
    <ul className="min-w-[13rem] flex-1 space-y-0.5">
      {delen.map((d) => (
        <li key={d.naam} className="flex items-center gap-2 text-[12px]">
          <span className={`size-2 shrink-0 rounded-[3px] ${d.kleur}`} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.naam}</span>
          <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
            {pct(d)}%
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums">{formatPrice(d.bedrag)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="rounded-[18px] border border-border bg-card p-3 shadow-card">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="font-display text-[14px] font-semibold">Verdeling</h2>
        <span
          aria-live="polite"
          className="ml-1 min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground"
        >
          {NAMEN[weergave]}
        </span>
        <button
          type="button"
          onClick={() => blader(-1)}
          aria-label="Vorige weergave"
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground max-md:size-9"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => blader(1)}
          aria-label="Volgende weergave"
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground max-md:size-9"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {weergave === "donut" && (
        <div className="flex flex-wrap items-center justify-center gap-3.5">
          <Donut delen={delen} midden={formatPrice(totaal)} />
          {legenda}
        </div>
      )}

      {weergave === "balk" && (
        <>
          <span className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-surface">
            {delen.map((d) => (
              <span
                key={d.naam}
                className={d.kleur}
                style={{ width: `${totaal > 0 ? (d.bedrag / totaal) * 100 : 0}%` }}
              />
            ))}
          </span>
          <div className="mt-2 flex">{legenda}</div>
        </>
      )}

      {weergave === "staven" && (
        <ul className="space-y-1.5">
          {delen.map((d) => {
            const grootste = Math.max(...delen.map((x) => x.bedrag));
            return (
              <li key={d.naam} className="text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.naam}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{pct(d)}%</span>
                  <span className="w-14 shrink-0 text-right tabular-nums">
                    {formatPrice(d.bedrag)}
                  </span>
                </div>
                <span className="mt-0.5 block h-2 overflow-hidden rounded-[3px] bg-surface">
                  <span
                    className={`block h-full rounded-r-[3px] ${d.kleur}`}
                    style={{ width: `${grootste > 0 ? (d.bedrag / grootste) * 100 : 0}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {weergave === "blokjes" && (
        <div className="flex flex-wrap items-start justify-center gap-3.5">
          <Blokjes delen={delen} procenten={procenten} />
          {legenda}
        </div>
      )}
    </section>
  );
}

/**
 * Een donut: elk deel een stuk van de ring, met een smal naadje ertussen in
 * de kleur van het vak, en in het midden het totaal.
 */
function Donut({ delen, midden }: { delen: VerdelingDeel[]; midden: string }) {
  const totaal = delen.reduce((som, d) => som + d.bedrag, 0);
  let tot = 0;
  const stukken = delen.map((d) => {
    const van = tot;
    tot += totaal > 0 ? (d.bedrag / totaal) * 360 : 0;
    // Een naadje van een graad, behalve bij een piepklein stukje: dan zou
    // het naadje het hele stukje opeten.
    const naad = tot - van > 3 ? 1 : 0;
    return `${d.vul} ${van}deg ${tot - naad}deg, var(--card) ${tot - naad}deg ${tot}deg`;
  });
  return (
    <div
      className="relative size-[104px] shrink-0 rounded-full"
      style={{ background: `conic-gradient(${stukken.join(", ")})` }}
      aria-hidden="true"
    >
      <div className="absolute inset-[16px] flex flex-col items-center justify-center rounded-full bg-card">
        <span className="text-[14px] font-semibold tabular-nums">{midden}</span>
        <span className="text-[10.5px] text-muted-foreground">totaal</span>
      </div>
    </div>
  );
}

/** Honderd blokjes, elk blokje één procent: zoveel als het percentage ernaast. */
function Blokjes({ delen, procenten }: { delen: VerdelingDeel[]; procenten: number[] }) {
  const vakjes = delen.flatMap((d, i) => Array.from({ length: procenten[i] ?? 0 }, () => d.vul));
  return (
    <div className="grid shrink-0 grid-cols-10 gap-[2px]" aria-hidden="true">
      {vakjes.map((vul, i) => (
        <span key={i} className="size-[9px] rounded-[2px]" style={{ background: vul }} />
      ))}
    </div>
  );
}

/**
 * Hele procenten die samen precies 100 zijn ("grootste rest"): eerst
 * afronden naar beneden, dan krijgen de delen met de grootste rest er één
 * bij tot het 100 is. Zo staat er nooit 33 + 33 + 33 = 99. Is er niets te
 * verdelen, dan overal 0.
 */
function verdeelHonderd(bedragen: number[]): number[] {
  const totaal = bedragen.reduce((som, b) => som + b, 0);
  if (totaal <= 0) return bedragen.map(() => 0);
  const ruw = bedragen.map((b) => (b / totaal) * 100);
  const uit = ruw.map(Math.floor);
  let over = 100 - uit.reduce((som, p) => som + p, 0);
  const opRest = ruw
    .map((p, i) => ({ i, rest: p - Math.floor(p) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { i } of opRest) {
    if (over <= 0) break;
    uit[i]! += 1;
    over -= 1;
  }
  return uit;
}
