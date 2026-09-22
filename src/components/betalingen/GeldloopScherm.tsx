import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconCircleCheck as CircleCheck,
  IconCloudOff as CloudOff,
  IconCloudUpload as CloudUpload,
  IconSearch as Search,
  IconX as X,
} from "@tabler/icons-react";

import { AppLayout } from "@/components/AppLayout";
import { BetaalPaneel } from "@/components/betalingen/BetaalPaneel";
import { frequentieKort, maandKort } from "@/lib/betalingen";
import {
  fetchGeldloopLijst,
  heeftIetsOpen,
  looprichting,
  nietGewassen,
  useGeldloopLive,
  type GeldloopAdres,
  type GeldloopLijst,
  type Vrijgave,
} from "@/lib/geldlopen";
import { formatPrice, kantVan, type Kant } from "@/lib/klanten";
import { useAuth } from "@/lib/auth";
import {
  bijVerstuurd,
  metWachtende,
  probeerOpnieuw,
  useWachtrij,
  vergeetMislukt,
  type Wachtend,
} from "@/lib/geldloop-wachtrij";

/** Vanaf zoveel open wasbeurten kleurt een adres rood. */
export const ROOD_VANAF = 3;

interface Straat {
  id: string;
  naam: string;
  wijk: string;
  adressen: GeldloopAdres[];
}

/** "jul, sep" en " + klus": waar het open bedrag vandaan komt. */
export function maandenVan(a: GeldloopAdres): string {
  const maanden = a.delen
    .filter((d) => d.soort === "wassen")
    .map((d) => maandKort(d.datum))
    .filter((m, i, lijst) => lijst.indexOf(m) === i);
  const extra = [
    ...(a.delen.some((d) => d.soort === "beginstand") ? ["kaart"] : []),
    ...(a.delen.some((d) => d.soort === "klus") ? ["klus"] : []),
  ];
  return [...(maanden.length ? [maanden.join(", ")] : []), ...extra].join(" + ");
}

/**
 * De lijst van één avond: per straat de adressen waar geld opgehaald moet
 * worden. Tik een adres en er schuift een paneel omhoog met de grote knoppen.
 * Alles wat je vaak aantikt zit onderin, bij je duim.
 */
export function GeldloopScherm({
  vrijgave,
  titel = "Geldlopen",
  bovenaan,
}: {
  vrijgave: Vrijgave;
  titel?: string;
  /** Iets boven de lijst, zoals de keuze tussen twee avonden. */
  bovenaan?: ReactNode;
}) {
  const qc = useQueryClient();
  const lijst = useQuery({
    queryKey: ["geldloop-lijst", vrijgave.id],
    queryFn: () => fetchGeldloopLijst(vrijgave.id),
    // Realtime houdt hem bij; dit is de vangrail als dat even hapert.
    refetchInterval: 60_000,
  });
  useGeldloopLive(vrijgave.id);
  const { employee } = useAuth();
  const wachtrij = useWachtrij(employee?.id);

  // Een tik die binnen is, blijft in de lijst staan tot de verse lijst van
  // de server er is (die komt via het live meekijken).
  useEffect(
    () =>
      bijVerstuurd((t) => {
        if (t.vrijgave !== vrijgave.id) return;
        const sleutel = ["geldloop-lijst", vrijgave.id];
        // Een oudere lijst die nog onderweg is, mag deze tik niet overschrijven.
        void qc
          .cancelQueries({ queryKey: sleutel })
          .then(() =>
            qc.setQueryData<GeldloopLijst>(sleutel, (oud) => (oud ? metWachtende(oud, [t]) : oud)),
          );
      }),
    [qc, vrijgave.id],
  );
  const data = useMemo(
    () => (lijst.data ? metWachtende(lijst.data, wachtrij.wachtend) : undefined),
    [lijst.data, wachtrij.wachtend],
  );

  const [gekozen, setGekozen] = useState<string | null>(null);
  const [zoeken, setZoeken] = useState<string | null>(null);
  // Loop je met z'n tweeën, of zigzag je zelf de straat over? Dan zet deze
  // knop de even en de oneven kant naast elkaar.
  const [kanten, setKanten] = useState(false);
  const [uitgeklapt, setUitgeklapt] = useState<Set<string>>(new Set());
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const voorbij = nu >= Date.parse(vrijgave.eind_op);

  const straten = useMemo<Straat[]>(() => {
    const perStraat = new Map<string, GeldloopAdres[]>();
    for (const a of data?.adressen ?? []) {
      perStraat.set(a.straat_id, [...(perStraat.get(a.straat_id) ?? []), a]);
    }
    return [...perStraat.values()]
      .sort(
        (x, y) =>
          x[0]!.wijk_sort - y[0]!.wijk_sort ||
          x[0]!.straat_sort - y[0]!.straat_sort ||
          x[0]!.straat.localeCompare(y[0]!.straat),
      )
      .map((adressen) => ({
        id: adressen[0]!.straat_id,
        naam: adressen[0]!.straat,
        wijk: adressen[0]!.wijk,
        adressen: looprichting(adressen),
      }));
  }, [data]);

  const zoekTerm = (zoeken ?? "").trim().toLowerCase();
  const wijken = new Set(straten.map((s) => s.wijk));
  const adres = (data?.adressen ?? []).find((a) => a.id === gekozen) ?? null;
  const openTotaal = (data?.adressen ?? [])
    .filter((a) => a.methode === "contant" || a.open > 0)
    .reduce((t, a) => t + Math.max(0, a.open), 0);

  function naarStraat(id: string) {
    document.getElementById(`straat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const onderbalk = (
    <Onderbalk
      straten={straten}
      opgehaald={data?.opgehaald}
      wachtend={wachtrij.wachtend.length}
      online={wachtrij.online}
      zoeken={zoeken}
      onZoeken={setZoeken}
      onStraat={naarStraat}
    />
  );

  // In een useMemo, want AppLayout meet zijn balk opnieuw zodra `acties` een
  // ander blokje is — dat hoeft alleen als je de schakelaar echt omzet.
  const schakelaar = useMemo(
    () => (
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-card">
        {[
          { aan: false, naam: "Lijst" },
          { aan: true, naam: "Beide kanten" },
        ].map((k) => (
          <button
            key={k.naam}
            type="button"
            aria-pressed={kanten === k.aan}
            onClick={() => setKanten(k.aan)}
            className={`min-h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
              kanten === k.aan
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-surface hover:text-foreground"
            }`}
          >
            {k.naam}
          </button>
        ))}
      </div>
    ),
    [kanten],
  );

  return (
    <AppLayout titel={titel} onderbalk={onderbalk} acties={schakelaar}>
      <div className="mx-auto max-w-2xl space-y-3 pb-6">
        {bovenaan}
        <div className="flex items-baseline justify-between gap-3 px-1 text-[13px] text-muted-foreground">
          <span>
            {[...wijken].join(", ")} · tot{" "}
            {new Date(vrijgave.eind_op).toLocaleTimeString("nl-NL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="tabular-nums">nog {formatPrice(openTotaal)} open</span>
        </div>

        {wachtrij.mislukt.length > 0 && (
          <div className="space-y-1.5 rounded-[14px] bg-tint-rood px-4 py-3 text-[13px] text-tint-rood-ink">
            <p className="font-medium">Niet verwerkt</p>
            {wachtrij.mislukt.map((w: Wachtend) => (
              <div key={w.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  {w.adres_tekst ? `${w.adres_tekst} · ` : ""}
                  {w.soort.replace("_", " ")}
                  {w.bedrag ? ` ${formatPrice(w.bedrag)}` : ""} · {w.fout}
                </span>
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={() => probeerOpnieuw(w.id)}
                >
                  Opnieuw
                </button>
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={() => vergeetMislukt(w.id)}
                >
                  Weghalen
                </button>
              </div>
            ))}
          </div>
        )}

        {voorbij && (
          <div className="rounded-[14px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
            De avond is voorbij. Wat je hebt ingetikt is bewaard.
          </div>
        )}

        {lijst.isLoading && <p className="px-1 text-[13px] text-muted-foreground">Laden…</p>}
        {lijst.isError && (
          <p className="px-1 text-[13px] text-tint-rood-ink">{(lijst.error as Error).message}</p>
        )}

        {straten.map((s) => {
          const passend = zoekTerm
            ? s.adressen.filter(
                (a) =>
                  `${a.house_number}${a.addition}`.toLowerCase().startsWith(zoekTerm) ||
                  a.naam.toLowerCase().includes(zoekTerm),
              )
            : s.adressen;
          if (passend.length === 0) return null;
          // Wat vanavond aandacht vraagt; de rest klapt in.
          const zichtbaar = zoekTerm
            ? passend
            : passend.filter((a) => heeftIetsOpen(a) || a.vanavond || a.methode === "overmaken");
          const rust = passend.filter((a) => !zichtbaar.includes(a));
          const open = uitgeklapt.has(s.id);
          return (
            <section
              key={s.id}
              id={`straat-${s.id}`}
              className="scroll-mt-24 rounded-[18px] border border-border bg-card p-1.5 shadow-card"
            >
              <h2 className="flex items-baseline justify-between px-2.5 pb-1 pt-1.5">
                <span className="font-display text-[15px] font-semibold">{s.naam}</span>
                {wijken.size > 1 && (
                  <span className="text-[11.5px] text-muted-foreground">{s.wijk}</span>
                )}
              </h2>
              {kanten ? (
                <BeideKanten adressen={passend} onKies={setGekozen} />
              ) : (
                <div className="divide-y divide-border/60">
                  {zichtbaar.map((a) => (
                    <AdresRij
                      key={a.id}
                      a={a}
                      datum={vrijgave.datum}
                      onKies={() => setGekozen(a.id)}
                    />
                  ))}
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
                        className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                      />
                      {rust.length} {rust.length === 1 ? "adres" : "adressen"} zonder iets open
                    </button>
                  )}
                  {open &&
                    rust.map((a) => (
                      <AdresRij
                        key={a.id}
                        a={a}
                        datum={vrijgave.datum}
                        onKies={() => setGekozen(a.id)}
                      />
                    ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Op de telefoon zit de balk boven de tabs (AppLayout zet hem daar);
            op een groter scherm plakt hij onderaan de lijst. */}
        <div className="sticky bottom-4 z-30 hidden md:block">{onderbalk}</div>
      </div>

      <BetaalPaneel
        adres={adres}
        vrijgave={vrijgave}
        voorbij={voorbij}
        onSluit={() => setGekozen(null)}
        onVeranderd={() => void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] })}
      />
    </AppLayout>
  );
}

/**
 * De even en de oneven kant naast elkaar, voor als je de straat overzigzagt
 * of met z'n tweeën loopt. Er is dan ongeveer 150 px per kant, dus alleen het
 * huisnummer en het bedrag passen; de naam zie je zodra je een adres aantikt.
 *
 * De verdeling is dezelfde als op de printlijst — even links, oneven rechts,
 * en een hoekhuis in de kolom die de wijklijst hem met de hand gaf — zodat
 * papier en telefoon naast elkaar hetzelfde beeld geven. Loopt de straat per
 * 1 op, dan is er geen overkant en knippen we de lijst doormidden.
 */
function BeideKanten({
  adressen,
  onKies,
}: {
  adressen: GeldloopAdres[];
  onKies: (id: string) => void;
}) {
  const doorlopend = adressen[0]?.doorlopend ?? false;
  const helft = Math.ceil(adressen.length / 2);
  const kant = (a: GeldloopAdres) =>
    kantVan({ house_number: a.house_number, hoek_kant: a.hoek_kant as Kant | "" });
  return (
    <div className="flex gap-1.5 px-1 pb-1">
      <Kolom
        naam={doorlopend ? "eerste helft" : "even"}
        lijst={doorlopend ? adressen.slice(0, helft) : adressen.filter((a) => kant(a) === "even")}
        onKies={onKies}
      />
      <Kolom
        naam={doorlopend ? "tweede helft" : "oneven"}
        lijst={doorlopend ? adressen.slice(helft) : adressen.filter((a) => kant(a) === "oneven")}
        onKies={onKies}
      />
    </div>
  );
}

function Kolom({
  naam,
  lijst,
  onKies,
}: {
  naam: string;
  lijst: GeldloopAdres[];
  onKies: (id: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {naam}
      </p>
      {/* Een eigen scrollvak per kant: de nummers lopen links en rechts zelden
          gelijk op, dus je moet de ene kant vooruit kunnen schuiven terwijl de
          andere blijft staan. Wat er niet is, staat er niet tussen. */}
      <div className="max-h-[52vh] space-y-1 overflow-y-auto overscroll-contain">
        {lijst.map((a) => (
          <Tegel key={a.id} a={a} onKies={() => onKies(a.id)} />
        ))}
      </div>
    </div>
  );
}

/** Eén adres als tegeltje: het nummer en wat er nog moet gebeuren. */
function Tegel({ a, onKies }: { a: GeldloopAdres; onKies: () => void }) {
  const betaald = a.vanavond?.soort === "betaald";
  const mislukt = a.vanavond && !betaald;
  const rood = a.open_wassen >= ROOD_VANAF && heeftIetsOpen(a);
  const stil = !heeftIetsOpen(a) && !a.vanavond;
  return (
    <button
      type="button"
      onClick={onKies}
      className={`flex min-h-11 w-full items-center justify-between gap-1.5 rounded-[11px] px-2 py-1.5 text-left transition-colors ${
        betaald
          ? "bg-tint-groen text-tint-groen-ink"
          : mislukt || rood
            ? "bg-tint-rood text-tint-rood-ink"
            : stil
              ? "text-muted-foreground"
              : "bg-surface"
      }`}
    >
      <span className="font-display text-[15px] font-semibold tabular-nums">
        {a.house_number}
        {a.addition}
      </span>
      {a.klachten.length > 0 && <span className="size-1.5 rounded-full bg-tint-rood-ink" />}
      <span className="truncate text-[12.5px] font-semibold tabular-nums">
        {betaald ? (
          <Check className="size-4" />
        ) : mislukt ? (
          <X className="size-4" />
        ) : heeftIetsOpen(a) ? (
          formatPrice(a.open)
        ) : (
          "—"
        )}
      </span>
    </button>
  );
}

function AdresRij({
  a,
  datum,
  onKies,
}: {
  a: GeldloopAdres;
  /** De dag van de avond, voor "sep niet aan de beurt". */
  datum: string;
  onKies: () => void;
}) {
  const rood = a.open_wassen >= ROOD_VANAF && heeftIetsOpen(a);
  const nietDezeMaand = nietGewassen(a, datum);
  const betaald = a.vanavond?.soort === "betaald";
  const overmaken = a.methode === "overmaken";
  const nummer = `${a.house_number}${a.addition}`;
  return (
    <button
      type="button"
      onClick={onKies}
      className={`flex min-h-14 w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors active:bg-surface ${
        rood ? "bg-tint-rood/60" : ""
      } ${betaald && !heeftIetsOpen(a) ? "opacity-60" : ""}`}
    >
      <span
        className={`w-11 shrink-0 font-display text-[18px] font-semibold tabular-nums ${
          rood
            ? "text-tint-rood-ink"
            : overmaken && !heeftIetsOpen(a)
              ? "text-muted-foreground"
              : ""
        }`}
      >
        {nummer}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`flex items-center gap-1.5 truncate text-[14px] ${
            rood ? "text-tint-rood-ink" : ""
          }`}
        >
          <span className="truncate">{a.naam || (overmaken ? "" : " ")}</span>
          {a.klachten.length > 0 && (
            <span
              className="size-2 shrink-0 rounded-full bg-tint-rood-ink"
              aria-label="Open klacht"
            />
          )}
          {a.gestopt && (
            <span className="shrink-0 rounded-full bg-surface px-1.5 text-[10.5px] text-muted-foreground">
              gestopt
            </span>
          )}
          {nietDezeMaand && !a.vanavond && (
            <span className="shrink-0 rounded-full bg-tint-geel px-1.5 text-[10.5px] text-tint-geel-ink">
              {nietDezeMaand}
            </span>
          )}
        </span>
        <span
          className={`block truncate text-[12px] ${rood ? "text-tint-rood-ink/80" : "text-muted-foreground"}`}
        >
          {overmaken
            ? heeftIetsOpen(a)
              ? "maakt over · nog contant open"
              : "maakt over"
            : [frequentieKort(a), maandenVan(a), rood ? `${a.open_wassen}× open` : ""]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {a.vanavond ? (
          <Status a={a} />
        ) : heeftIetsOpen(a) ? (
          <span
            className={`font-display text-[16px] font-semibold tabular-nums ${rood ? "text-tint-rood-ink" : ""}`}
          >
            {formatPrice(a.open)}
          </span>
        ) : a.open < -0.005 ? (
          <span className="text-[12px] text-tint-groen-ink">tegoed {formatPrice(-a.open)}</span>
        ) : null}
      </span>
    </button>
  );
}

function Status({ a }: { a: GeldloopAdres }) {
  const v = a.vanavond!;
  const door = v.door_naam.split(" ")[0] ?? "";
  if (v.soort === "betaald") {
    return (
      <span className="flex flex-col items-end">
        <span className="flex items-center gap-1 rounded-full bg-tint-groen px-2 py-0.5 text-[12px] font-medium text-tint-groen-ink">
          <Check className="size-3.5" /> {formatPrice(v.bedrag)}
        </span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">{door}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      {heeftIetsOpen(a) && (
        <span className="font-display text-[15px] font-semibold tabular-nums">
          {formatPrice(a.open)}
        </span>
      )}
      <span className="rounded-full bg-tint-rood px-2 py-0.5 text-[11px] font-medium text-tint-rood-ink">
        {v.soort === "niet_thuis" ? "Niet thuis" : "Geen geld"} · {door}
      </span>
    </span>
  );
}

/** Onderin, bij je duim: de straten, wat je opgehaald hebt, en zoeken. */
function Onderbalk({
  straten,
  opgehaald,
  wachtend,
  online,
  zoeken,
  onZoeken,
  onStraat,
}: {
  straten: Straat[];
  opgehaald: { mij: number; mij_aantal: number; totaal: number } | undefined;
  /** Hoeveel tikken er nog op de telefoon staan. */
  wachtend: number;
  online: boolean;
  zoeken: string | null;
  onZoeken: (z: string | null) => void;
  onStraat: (id: string) => void;
}) {
  const inhoud = (
    <div className="space-y-2">
      {zoeken !== null ? (
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 shadow-card">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            inputMode="search"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            placeholder="Huisnummer of naam"
            value={zoeken}
            onChange={(e) => onZoeken(e.target.value)}
          />
          <button
            type="button"
            aria-label="Zoeken sluiten"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
            onClick={() => onZoeken(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        straten.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {straten.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStraat(s.id)}
                className="h-9 shrink-0 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium shadow-card"
              >
                {s.naam}
              </button>
            ))}
          </div>
        )
      )}
      <div className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-2.5 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-muted-foreground">Jij opgehaald</p>
          <p className="font-display text-[17px] font-semibold tabular-nums">
            {formatPrice(opgehaald?.mij ?? 0)}
            <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">
              · {opgehaald?.mij_aantal ?? 0} {opgehaald?.mij_aantal === 1 ? "adres" : "adressen"}
            </span>
          </p>
        </div>
        {opgehaald && opgehaald.totaal > opgehaald.mij && (
          <div className="text-right">
            <p className="text-[11.5px] text-muted-foreground">Samen</p>
            <p className="text-[13px] font-medium tabular-nums">{formatPrice(opgehaald.totaal)}</p>
          </div>
        )}
        {wachtend > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-tint-amber-ink"
            title="Nog niet verstuurd: gaat zodra er bereik is"
          >
            {online ? <CloudUpload className="size-5" /> : <CloudOff className="size-5" />}
            {wachtend}
          </span>
        ) : online ? (
          <CircleCheck
            className="size-5 shrink-0 text-tint-groen-ink"
            aria-label="Alles verstuurd"
          />
        ) : (
          <CloudOff className="size-5 shrink-0 text-muted-foreground" aria-label="Geen bereik" />
        )}
        {zoeken === null && (
          <button
            type="button"
            aria-label="Zoeken"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface"
            onClick={() => onZoeken("")}
          >
            <Search className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
  return inhoud;
}
