import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCash as Cash } from "@tabler/icons-react";

import { AppLayout } from "@/components/AppLayout";
import { Avondoverzicht } from "@/components/betalingen/Avondoverzicht";
import { Beginstand } from "@/components/betalingen/Beginstand";
import { GeldKaart } from "@/components/betalingen/GeldKaart";
import { PofLijst } from "@/components/betalingen/PofLijst";
import { GeldloopScherm } from "@/components/betalingen/GeldloopScherm";
import { Vrijgeven } from "@/components/betalingen/Vrijgeven";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { fetchMijnGeldloop, type Vrijgave } from "@/lib/geldlopen";
import { probeerOpnieuw, useWachtrij, vergeetMislukt } from "@/lib/geldloop-wachtrij";
import { heeftRecht } from "@/lib/rechten";

/** De tabbladen voor wie bedragen mag zien. Een geldloper ziet alleen de
 *  lijst van de wijk die voor hem is vrijgegeven. */
const TABBLADEN = ["vanavond", "vrijgeven", "lopen", "pof", "kaart", "beginstand"] as const;
type Tab = (typeof TABBLADEN)[number];

const TABNAAM: Record<Tab, string> = {
  vanavond: "Vanavond",
  vrijgeven: "Vrijgeven",
  lopen: "Lopen",
  pof: "Pof",
  kaart: "Kaart",
  beginstand: "Beginstand",
};

interface BetalingenSearch {
  tab: Tab;
  wijk?: string;
  straat?: string;
}

export const Route = createFileRoute("/betalingen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): BetalingenSearch => {
    const tab = String(search["tab"] ?? "");
    const wijk = String(search["wijk"] ?? "");
    const straat = String(search["straat"] ?? "");
    return {
      tab: (TABBLADEN as readonly string[]).includes(tab) ? (tab as Tab) : "vanavond",
      ...(/^[0-9a-f-]{36}$/.test(wijk) ? { wijk } : {}),
      ...(/^[0-9a-f-]{36}$/.test(straat) ? { straat } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Betalingen — Wooshy" }] }),
  component: Betalingen,
});

function Betalingen() {
  useRequireAuth();
  const { tab: gevraagd, wijk, straat } = Route.useSearch();
  const navigate = useNavigate();
  const { employee } = useAuth();
  const ziedBedragen = heeftRecht(employee, "prijzen_zien");
  const isEigenaar = employee?.rol === "eigenaar";
  // Vrijgeven is van de eigenaar; wie alleen bedragen ziet, kijkt mee.
  const tab: Tab = gevraagd === "vrijgeven" && !isEigenaar ? "vanavond" : gevraagd;

  const naarTab = useCallback(
    (t: Tab) =>
      void navigate({
        to: "/betalingen",
        search: { tab: t, ...(wijk ? { wijk } : {}) },
        replace: true,
      }),
    [navigate, wijk],
  );
  const kiesWijk = useCallback(
    (id: string) => void navigate({ to: "/betalingen", search: { tab, wijk: id }, replace: true }),
    [navigate, tab],
  );
  const kiesStraat = useCallback(
    (id: string) =>
      void navigate({ to: "/betalingen", search: { tab: "kaart", straat: id }, replace: true }),
    [navigate],
  );

  // Een geldloper (zonder "prijzen zien") ziet alleen zijn avond.
  if (employee && !ziedBedragen) return <Lopen />;

  const zichtbaar = TABBLADEN.filter((t) => t !== "vrijgeven" || isEigenaar);
  const tabs = (
    <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-card [scrollbar-width:none]">
      {zichtbaar.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={tab === t}
          onClick={() => naarTab(t)}
          className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
            tab === t
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-surface hover:text-foreground"
          }`}
        >
          {TABNAAM[t]}
        </button>
      ))}
    </div>
  );

  if (tab === "lopen") return <Lopen acties={tabs} onVrijgeven={() => naarTab("vrijgeven")} />;

  return (
    <AppLayout titel="Betalingen" acties={tabs}>
      {tab === "vanavond" && <Avondoverzicht />}
      {tab === "vrijgeven" && isEigenaar && <Vrijgeven onLopen={() => naarTab("lopen")} />}
      {tab === "pof" && <PofLijst onKaart={kiesStraat} />}
      {tab === "kaart" && <GeldKaart straatId={straat} onStraat={kiesStraat} />}
      {tab === "beginstand" && <Beginstand wijkId={wijk} onWijk={kiesWijk} />}
    </AppLayout>
  );
}

/** De avond(en) die nu voor jou open staan, met de lijst van de eerste. */
function Lopen({
  acties,
  onVrijgeven,
}: {
  acties?: ReactNode;
  onVrijgeven?: (() => void) | undefined;
}) {
  const avonden = useQuery({
    queryKey: ["mijn-geldloop"],
    queryFn: fetchMijnGeldloop,
    refetchInterval: 60_000,
  });
  const [gekozen, setGekozen] = useState<string | null>(null);
  const lijst = avonden.data ?? [];
  const nu = Date.now();
  // Wat nu loopt, niet wat pas later begint.
  const lopend = lijst.filter((v) => Date.parse(v.begin_op) <= nu);
  const vrijgave: Vrijgave | undefined = lopend.find((v) => v.id === gekozen) ?? lopend[0];

  if (!vrijgave) {
    return (
      <AppLayout titel="Geldlopen" acties={acties}>
        {avonden.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Laden…</p>
        ) : (
          <>
            <GeenVrijgave komt={lijst[0]} onVrijgeven={onVrijgeven} />
            <WachtrijNaDeAvond />
          </>
        )}
      </AppLayout>
    );
  }

  return (
    <GeldloopScherm
      vrijgave={vrijgave}
      acties={acties}
      bovenaan={
        lopend.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {lopend.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setGekozen(v.id)}
                className={`min-h-10 rounded-full border px-3.5 text-[13px] font-medium ${
                  v.id === vrijgave.id
                    ? "border-transparent bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {v.wijken.map((w) => w.naam).join(", ")}
              </button>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}

/** Wat een geldloper ziet als er voor hem (nog) niets open staat. */
/** Wat er nog op de telefoon staat, ook als de avond voorbij is. */
function WachtrijNaDeAvond() {
  const { employee } = useAuth();
  const { wachtend, mislukt } = useWachtrij(employee?.id);
  if (wachtend.length === 0 && mislukt.length === 0) return null;
  return (
    <div className="mx-auto mt-4 max-w-sm space-y-1.5 rounded-[14px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
      {wachtend.length > 0 && (
        <p>
          {wachtend.length} {wachtend.length === 1 ? "tik staat" : "tikken staan"} nog op je
          telefoon en {wachtend.length === 1 ? "gaat" : "gaan"} zodra er bereik is. Laat de app even
          open.
        </p>
      )}
      {mislukt.map((w) => (
        <div key={w.id} className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            Niet verwerkt: {w.adres_tekst ?? ""} · {w.fout}
          </span>
          <button
            type="button"
            className="shrink-0 font-medium"
            onClick={() => probeerOpnieuw(w.id)}
          >
            Opnieuw
          </button>
          <button
            type="button"
            className="shrink-0 font-medium"
            onClick={() => vergeetMislukt(w.id)}
          >
            Weghalen
          </button>
        </div>
      ))}
    </div>
  );
}

function GeenVrijgave({
  komt,
  onVrijgeven,
}: {
  komt?: Vrijgave | undefined;
  onVrijgeven?: (() => void) | undefined;
}) {
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-[18px] border border-border bg-card p-6 text-center shadow-card">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-[14px] bg-tint-groen text-tint-groen-ink">
        <Cash className="size-5" />
      </div>
      <h2 className="font-display text-[17px] font-semibold">Er is nu geen wijk vrijgegeven</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {komt
          ? `${komt.wijken.map((w) => w.naam).join(", ")} gaat open om ${new Date(komt.begin_op).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}.`
          : "Zodra de eigenaar een wijk voor vanavond vrijgeeft, staan de adressen en bedragen hier."}
      </p>
      {onVrijgeven && (
        <button
          type="button"
          className="mt-3 text-[13px] font-medium underline-offset-2 hover:underline"
          onClick={onVrijgeven}
        >
          Een wijk vrijgeven
        </button>
      )}
    </div>
  );
}
