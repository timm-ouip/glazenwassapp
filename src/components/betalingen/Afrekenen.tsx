import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft as ArrowLeft,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconSearch as Search,
} from "@tabler/icons-react";

import { AdresRij } from "@/components/betalingen/GeldloopScherm";
import { DagBetalen } from "@/components/betalingen/DagBetalen";
import { fetchAfrekenlijst, heeftIetsOpen, looprichting, type Afrekenlijst } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";

type Adres = Afrekenlijst["adressen"][number];

interface Straat {
  id: string;
  naam: string;
  adressen: Adres[];
  /** Adressen waar iets openstaat. */
  open: number;
  openBedrag: number;
}

/** Wat er bij een open straat in beeld staat: iets open, vandaag getikt, of een overmaker. */
function telt(a: Adres): boolean {
  return heeftIetsOpen(a) || !!a.vanavond || a.methode === "overmaken";
}

/**
 * Afrekenen zonder vrijgave: de eigenaar, of wie het recht "afrekenen" heeft,
 * kiest een wijk en tikt een betaling in, zonder dat er een avond loopt. De
 * straten staan als uitklaplijst, zoals op het loopscherm, met dezelfde rijen
 * en kleuren; een adres aantikken opent het betaalvenster van de dag, dat op
 * kantoor boekt. Wat er openstaat komt uit de database (geld_afrekenlijst).
 */
export function Afrekenen({
  wijkId,
  onWijk,
  onTerug,
}: {
  wijkId?: string | undefined;
  onWijk: (id: string) => void;
  onTerug: () => void;
}) {
  const lijst = useQuery({
    queryKey: ["geld-afrekenen", wijkId ?? null],
    queryFn: () => fetchAfrekenlijst(wijkId ?? null),
    // Bij een andere wijk blijven de wijkknoppen staan tot de nieuwe lijst er is.
    placeholderData: keepPreviousData,
  });
  const [openStraat, setOpenStraat] = useState<string | null>(null);
  const [uitgeklapt, setUitgeklapt] = useState<Set<string>>(new Set());
  const [zoeken, setZoeken] = useState("");
  const [gekozen, setGekozen] = useState<Adres | null>(null);
  const [betalenOpen, setBetalenOpen] = useState(false);

  const wijken = lijst.data?.wijken ?? [];
  const gestart = wijken.filter((w) => w.peildatum);
  const nietGestart = wijken.filter((w) => !w.peildatum);
  const wijk = gestart.find((w) => w.id === wijkId);
  // Zolang de lijst van een andere wijk nog onderweg is, niet de oude tonen.
  const adressen = useMemo(
    () => (wijk && !lijst.isPlaceholderData ? (lijst.data?.adressen ?? []) : []),
    [wijk, lijst.isPlaceholderData, lijst.data],
  );

  const straten = useMemo<Straat[]>(() => {
    const perStraat = new Map<string, Adres[]>();
    for (const a of adressen)
      perStraat.set(a.straat_id, [...(perStraat.get(a.straat_id) ?? []), a]);
    return [...perStraat.values()]
      .sort(
        (x, y) => x[0]!.straat_sort - y[0]!.straat_sort || x[0]!.straat.localeCompare(y[0]!.straat),
      )
      .map((groep) => ({
        id: groep[0]!.straat_id,
        naam: groep[0]!.straat,
        adressen: looprichting(groep) as Adres[],
        open: groep.filter(heeftIetsOpen).length,
        openBedrag: groep.reduce((t, a) => t + Math.max(0, a.open), 0),
      }));
  }, [adressen]);
  const openTotaal = straten.reduce((t, s) => t + s.openBedrag, 0);
  const zoekTerm = zoeken.trim().toLowerCase();

  function kies(a: Adres) {
    setGekozen(a);
    setBetalenOpen(true);
  }

  const rijen = (groep: Adres[]) =>
    groep.map((a) => <AdresRij key={a.id} a={a} onKies={() => kies(a)} />);

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onTerug}
          className="mr-1 flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground shadow-card hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Overzicht
        </button>
        {gestart.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={w.id === wijkId}
            onClick={() => {
              setOpenStraat(null);
              setZoeken("");
              onWijk(w.id);
            }}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              w.id === wijkId
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {w.naam}
          </button>
        ))}
      </div>

      {lijst.isLoading && <p className="px-1 text-[13px] text-muted-foreground">Laden…</p>}
      {lijst.isError && (
        <p className="px-1 text-[13px] text-tint-rood-ink">{(lijst.error as Error).message}</p>
      )}
      {nietGestart.length > 0 && (
        <p className="px-1 text-[12.5px] text-muted-foreground">
          Telt nog niet mee bij Betalingen: {nietGestart.map((w) => w.naam).join(", ")}. Een wijk
          start je op Wijkkaarten.
        </p>
      )}

      {lijst.data && !wijk ? (
        <p className="rounded-[18px] border border-border bg-card px-4 py-6 text-center text-[13.5px] text-muted-foreground shadow-card">
          {gestart.length > 0
            ? "Kies een wijk. Je ziet per adres wat er openstaat; tik een adres aan om een betaling in te tikken, ook als de wijk niet is vrijgegeven."
            : "Er telt nog geen wijk mee bij Betalingen."}
        </p>
      ) : wijk ? (
        <>
          <div className="flex items-center gap-2 rounded-full bg-card px-3 shadow-card">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              inputMode="search"
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              placeholder="Huisnummer of naam"
              value={zoeken}
              onChange={(e) => setZoeken(e.target.value)}
            />
          </div>
          <div className="flex items-baseline justify-between gap-3 px-1 text-[13px] text-muted-foreground">
            <span>
              {wijk.naam} · {straten.length} {straten.length === 1 ? "straat" : "straten"}
            </span>
            <span className="tabular-nums">nog {formatPrice(openTotaal)} open</span>
          </div>

          {lijst.isFetching && adressen.length === 0 && (
            <p className="px-1 text-[13px] text-muted-foreground">Laden…</p>
          )}

          {zoekTerm
            ? // Zoeken kijkt in alle straten, ook bij adressen zonder iets open.
              straten.map((s) => {
                const passend = s.adressen.filter(
                  (a) =>
                    `${a.house_number}${a.addition}`.toLowerCase().startsWith(zoekTerm) ||
                    a.naam.toLowerCase().includes(zoekTerm),
                );
                if (passend.length === 0) return null;
                return (
                  <section key={s.id} className="rounded-[24px] bg-card p-1.5 shadow-card">
                    <h2 className="px-2.5 pb-1 pt-1.5 font-display text-[15px] font-semibold">
                      {s.naam}
                    </h2>
                    <div className="divide-y divide-border/60">{rijen(passend)}</div>
                  </section>
                );
              })
            : straten.map((s) => {
                if (s.id !== openStraat) {
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-expanded={false}
                      onClick={() => setOpenStraat(s.id)}
                      className={`flex w-full items-center gap-2 rounded-[16px] px-3.5 py-2.5 text-left ${
                        s.open > 0
                          ? "bg-card shadow-card"
                          : "border border-dashed border-border text-muted-foreground"
                      }`}
                    >
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      <span
                        className={`min-w-0 flex-1 truncate font-display font-semibold ${s.open > 0 ? "text-[15px]" : "text-[13.5px]"}`}
                      >
                        {s.naam}
                      </span>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                        {s.open > 0
                          ? `${s.open} open · ${formatPrice(s.openBedrag)}`
                          : "niets open"}
                      </span>
                    </button>
                  );
                }
                const zichtbaar = s.adressen.filter(telt);
                const rust = s.adressen.filter((a) => !telt(a));
                const rustOpen = uitgeklapt.has(s.id);
                return (
                  <section key={s.id} className="rounded-[24px] bg-card p-1.5 shadow-card">
                    <h2 className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
                      <button
                        type="button"
                        aria-expanded
                        title={`${s.naam} dichtklappen`}
                        onClick={() => setOpenStraat(null)}
                        className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate font-display text-[15px] font-semibold">
                          {s.naam}
                        </span>
                      </button>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                        {s.open} open · {formatPrice(s.openBedrag)}
                      </span>
                    </h2>
                    <div className="divide-y divide-border/60">
                      {rijen(zichtbaar)}
                      {rust.length > 0 && (
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center gap-2 px-2.5 text-[12.5px] text-muted-foreground"
                          onClick={() =>
                            setUitgeklapt((was) => {
                              const nu = new Set(was);
                              if (nu.has(s.id)) nu.delete(s.id);
                              else nu.add(s.id);
                              return nu;
                            })
                          }
                        >
                          <ChevronDown
                            className={`size-4 transition-transform ${rustOpen ? "rotate-180" : ""}`}
                          />
                          {rust.length} {rust.length === 1 ? "adres" : "adressen"} zonder iets open
                        </button>
                      )}
                      {rustOpen && rijen(rust)}
                    </div>
                  </section>
                );
              })}
          {!lijst.isFetching && straten.length === 0 && (
            <p className="px-1 text-[13px] text-muted-foreground">
              In deze wijk staan geen adressen.
            </p>
          )}
        </>
      ) : null}

      <DagBetalen
        open={betalenOpen}
        onOpenChange={setBetalenOpen}
        customer={gekozen}
        adresTekst={gekozen ? `${gekozen.straat} ${gekozen.house_number}${gekozen.addition}` : ""}
        wijk={wijk ? { id: wijk.id, geld_peildatum: wijk.peildatum } : undefined}
        // Wat de lijst laat zien (geld_stand), zonder de beurt van vandaag: die
        // hangt af van het team van wie kijkt, en hoort bij de dag.
        vandaag={false}
      />
    </div>
  );
}
