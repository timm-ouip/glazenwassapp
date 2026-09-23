import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCash as Cash, IconChevronLeft as ChevronLeft } from "@tabler/icons-react";

import { AppLayout } from "@/components/AppLayout";
import { Avondoverzicht } from "@/components/betalingen/Avondoverzicht";
import { GeldKaart } from "@/components/betalingen/GeldKaart";
import { PofLijst } from "@/components/betalingen/PofLijst";
import { GeldloopScherm } from "@/components/betalingen/GeldloopScherm";
import { LoperStart } from "@/components/betalingen/LoperStart";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { TABBLADEN, TABNAAM, type BetalingenTab as Tab } from "@/lib/betalingen";
import { fetchMijnGeldloop, type Vrijgave } from "@/lib/geldlopen";
import { probeerOpnieuw, useWachtrij, vergeetMislukt } from "@/lib/geldloop-wachtrij";
import { heeftRecht } from "@/lib/rechten";

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
  head: () => ({ meta: [{ title: "Betalingen — Paaltje Systems" }] }),
  component: Betalingen,
});

function Betalingen() {
  useRequireAuth();
  const { tab: gevraagd, wijk, straat } = Route.useSearch();
  const navigate = useNavigate();
  // Het venster om een wijk vrij te geven hoort bij het overzicht, maar de
  // knop ernaartoe staat ook in het loopscherm. Deze pagina blijft bij het
  // wisselen van tabblad staan, dus die stand kan hier bewaard worden.
  const [vrijgeefVenster, setVrijgeefVenster] = useState(false);
  const { employee } = useAuth();
  const ziedBedragen = heeftRecht(employee, "prijzen_zien");
  const isEigenaar = employee?.rol === "eigenaar";
  const tab: Tab = gevraagd;

  // De wijk en de straat gaan mee naar het volgende tabblad: kom je van de
  // kaart terug, dan sta je weer in dezelfde straat.
  const naarTab = useCallback(
    (t: Tab) =>
      void navigate({
        to: "/betalingen",
        search: { tab: t, ...(wijk ? { wijk } : {}), ...(straat ? { straat } : {}) },
        replace: true,
      }),
    [navigate, wijk, straat],
  );
  const kiesStraat = useCallback(
    (id: string) =>
      void navigate({ to: "/betalingen", search: { tab: "kaart", straat: id }, replace: true }),
    [navigate],
  );

  // Een geldloper (zonder "prijzen zien") ziet alleen zijn avond.
  if (employee && !ziedBedragen) return <Lopen />;

  // De tabbladen staan in het menu (de zijbalk, en op de telefoon de balk
  // onderin), niet meer als pillenrij boven de pagina. De kop zegt daarom
  // zelf waar je bent.
  const titel = `Betalingen · ${TABNAAM[tab]}`;

  // Een wijk vrijgeven is van de eigenaar, en gebeurt in een venster op het
  // overzicht: daar stuurt de knop hem dus heen. Wie bedragen mag zien heeft
  // zijn loopcijfers al op het overzicht staan, dus die gaat hier meteen de
  // straat in; de knop linksboven brengt hem terug naar dat overzicht.
  if (tab === "lopen")
    return (
      <Lopen
        titel={titel}
        onVrijgeven={isEigenaar ? () => naarTab("vanavond") : undefined}
        naarOverzicht={() => naarTab("vanavond")}
      />
    );

  return (
    <AppLayout titel={titel}>
      {tab === "vanavond" && (
        <Avondoverzicht
          onPof={() => naarTab("pof")}
          onLopen={() => naarTab("lopen")}
          onKaarten={() => naarTab("kaart")}
          vrijgeefVenster={vrijgeefVenster}
          onVrijgeefVenster={setVrijgeefVenster}
        />
      )}
      {tab === "pof" && <PofLijst onKaart={kiesStraat} onTerug={() => naarTab("vanavond")} />}
      {tab === "kaart" && <GeldKaart straatId={straat} wijkId={wijk} onStraat={kiesStraat} />}
    </AppLayout>
  );
}

/** De avond(en) die nu voor jou open staan, met de lijst van de eerste. */
function Lopen({
  titel = "Geldlopen",
  onVrijgeven,
  naarOverzicht,
}: {
  titel?: string;
  onVrijgeven?: (() => void) | undefined;
  /** Er is elders al een overzicht: sla het startscherm over en ga daarheen terug. */
  naarOverzicht?: (() => void) | undefined;
}) {
  const avonden = useQuery({
    queryKey: ["mijn-geldloop"],
    queryFn: fetchMijnGeldloop,
    refetchInterval: 60_000,
  });
  const [gekozen, setGekozen] = useState<string | null>(null);
  // Je komt binnen op je eigen cijfers en gaat van daaruit de straat in; de
  // knop linksboven brengt je er weer terug.
  const [begonnen, setBegonnen] = useState(false);
  const lijst = avonden.data ?? [];
  const nu = Date.now();
  // Wat nu loopt, niet wat pas later begint.
  const lopend = lijst.filter((v) => Date.parse(v.begin_op) <= nu);
  const vrijgave: Vrijgave | undefined = lopend.find((v) => v.id === gekozen) ?? lopend[0];

  if (!vrijgave) {
    return (
      <AppLayout titel={titel}>
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

  // Loop je meer dan één wijk vanavond, dan kies je hier welke.
  const avondKeuze =
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
    ) : undefined;

  if (!begonnen && !naarOverzicht) {
    return (
      <LoperStart
        vrijgave={vrijgave}
        titel={titel}
        onBeginnen={() => setBegonnen(true)}
        bovenaan={avondKeuze}
      />
    );
  }

  return (
    <GeldloopScherm
      vrijgave={vrijgave}
      titel={titel}
      bovenaan={
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={naarOverzicht ?? (() => setBegonnen(false))}
            className="flex min-h-10 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-medium shadow-card"
          >
            <ChevronLeft className="size-4" />
            Overzicht
          </button>
          {avondKeuze}
        </div>
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
