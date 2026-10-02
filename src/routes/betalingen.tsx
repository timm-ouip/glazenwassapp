import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconCash as Cash,
  IconChevronLeft as ChevronLeft,
  IconLock as Lock,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { Afrekenen } from "@/components/betalingen/Afrekenen";
import { Avondoverzicht } from "@/components/betalingen/Avondoverzicht";
import { GeldKaart } from "@/components/betalingen/GeldKaart";
import { PofLijst } from "@/components/betalingen/PofLijst";
import { FacturenLijst } from "@/components/betalingen/FacturenLijst";
import { GeldloopScherm } from "@/components/betalingen/GeldloopScherm";
import { LoperStart } from "@/components/betalingen/LoperStart";
import { Button } from "@/components/ui/button";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { useGeldloopVast, zetGeldloopVast } from "@/lib/dagslot";
import { TABBLADEN, TABNAAM, type BetalingenTab as Tab } from "@/lib/betalingen";
import { fetchMijnGeldloop, type Vrijgave } from "@/lib/geldlopen";
import { probeerOpnieuw, useWachtrij, vergeetMislukt } from "@/lib/geldloop-wachtrij";
import { heeftRecht, magAfrekenen } from "@/lib/rechten";

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
  const magFacturen = heeftRecht(employee, "facturen");
  const kanAfrekenen = magAfrekenen(employee);
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

  // Een geldloper (zonder "prijzen zien") ziet alleen zijn avond. Wie
  // uitsluitend het recht "facturen" heeft, hoort juist niet de straat in:
  // die krijgt meteen de facturen.
  if (employee && !ziedBedragen) {
    if (magFacturen) {
      return (
        <AppLayout titel="Betalingen · Facturen">
          <FacturenLijst />
        </AppLayout>
      );
    }
    return <Lopen />;
  }

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
          // Zonder wijk: de tegel hier telt alle wijken samen, dus de lijst ook.
          onPof={() => void navigate({ to: "/betalingen", search: { tab: "pof" }, replace: true })}
          onLopen={() => naarTab("lopen")}
          onKaarten={() => naarTab("kaart")}
          onFacturen={magFacturen ? () => naarTab("facturen") : undefined}
          onAfrekenen={kanAfrekenen ? () => naarTab("afrekenen") : undefined}
          vrijgeefVenster={vrijgeefVenster}
          onVrijgeefVenster={setVrijgeefVenster}
        />
      )}
      {tab === "pof" && (
        <PofLijst onKaart={kiesStraat} onTerug={() => naarTab("vanavond")} beginWijk={wijk} />
      )}
      {tab === "kaart" && <GeldKaart straatId={straat} wijkId={wijk} onStraat={kiesStraat} />}
      {tab === "facturen" &&
        (magFacturen ? (
          <FacturenLijst onTerug={() => naarTab("vanavond")} />
        ) : (
          <p className="text-[13px] text-muted-foreground">Je rol mag de facturen niet zien.</p>
        ))}
      {tab === "afrekenen" &&
        (kanAfrekenen ? (
          <Afrekenen
            wijkId={wijk}
            onWijk={(id) =>
              void navigate({
                to: "/betalingen",
                search: { tab: "afrekenen", wijk: id },
                replace: true,
              })
            }
            onTerug={() => naarTab("vanavond")}
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Je rol mag hier geen betalingen intikken.
          </p>
        ))}
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
  // knop linksboven brengt je er weer terug. Staat het geldlopen vast op dit
  // toestel, dan sla je die cijfers over en sta je meteen in de straat.
  const vast = useGeldloopVast();
  const [gekozenBegonnen, setBegonnen] = useState<boolean | null>(null);
  const begonnen = gekozenBegonnen ?? vast;
  // Maak je het slot onderweg los, dan blijf je gewoon in de straat staan:
  // losmaken geldt pas voor de volgende keer dat de app opent.
  useEffect(() => {
    if (vast) setBegonnen((was) => was ?? true);
  }, [vast]);
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
      // Een andere avond is een ander scherm: met zijn eigen open straat,
      // die dan ook weer in beeld schuift.
      key={vrijgave.id}
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
  // Staat het geldlopen vast, dan opent de app ook overdag hier. Het
  // loopscherm met de slotknop is er dan niet, dus losmaken kan hier.
  const vast = useGeldloopVast();
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
      {vast && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[12.5px] text-muted-foreground">
            De app opent op deze telefoon op het geldlopen.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 rounded-full"
            onClick={() => {
              zetGeldloopVast(false);
              toast.success("Losgemaakt: de app opent weer op Home.");
            }}
          >
            <Lock className="size-4" />
            Losmaken
          </Button>
        </div>
      )}
    </div>
  );
}
