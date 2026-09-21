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
  useGeldloopLive,
  type GeldloopAdres,
  type GeldloopLijst,
  type Vrijgave,
} from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";
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
  acties,
}: {
  vrijgave: Vrijgave;
  titel?: string;
  /** Iets boven de lijst, zoals de keuze tussen twee avonden. */
  bovenaan?: ReactNode;
  /** De knoppen rechtsboven (bij de eigenaar: de tabbladen). */
  acties?: ReactNode;
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

  return (
    <AppLayout titel={titel} onderbalk={onderbalk} acties={acties}>
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
              <div className="divide-y divide-border/60">
                {zichtbaar.map((a) => (
                  <AdresRij key={a.id} a={a} onKies={() => setGekozen(a.id)} />
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
                  rust.map((a) => <AdresRij key={a.id} a={a} onKies={() => setGekozen(a.id)} />)}
              </div>
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

function AdresRij({ a, onKies }: { a: GeldloopAdres; onKies: () => void }) {
  const rood = a.open_wassen >= ROOD_VANAF && heeftIetsOpen(a);
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
