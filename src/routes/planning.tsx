import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { nl } from "date-fns/locale";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Eraser,
  Euro,
  Milestone as Route2,
} from "lucide-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { pushUndo, undoLaatste } from "@/lib/undo";
import {
  fetchCustomers,
  fetchStreets,
  formatPrice,
  type Customer,
} from "@/lib/klanten";
import {
  fetchWasdagen,
  maakWasdagLeeg,
  toonDatum,
  vandaag,
  voegToeAanWasdag,
} from "@/lib/wasdag";

interface PlanningSearch {
  /** De dag die openstaat, bijvoorbeeld vanaf de wijkenpagina. */
  dag?: string;
}

export const Route = createFileRoute("/planning")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): PlanningSearch =>
    typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {},
  head: () => ({
    meta: [
      { title: "Planning — Klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Wat er per dag gewassen wordt, en wat een maand heeft opgeleverd.",
      },
    ],
  }),
  component: Planning,
});

/** `jjjj-mm-dd` zoals de database het bewaart, in lokale tijd. */
function sleutel(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function Planning() {
  useRequireAuth();
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const navigate = useNavigate();
  const { dag } = Route.useSearch();

  const gekozenDag = dag ?? vandaag();
  const [maand, setMaand] = useState(() => startOfMonth(new Date(`${gekozenDag}T12:00:00`)));

  // De kalender toont hele weken, dus lopen de randen buiten de maand door.
  const van = startOfWeek(startOfMonth(maand), { locale: nl });
  const tot = endOfWeek(endOfMonth(maand), { locale: nl });
  const dagen = eachDayOfInterval({ start: van, end: tot });

  const wasdagenQuery = useQuery({
    queryKey: ["wasdagen", sleutel(van), sleutel(tot)],
    queryFn: () => fetchWasdagen(sleutel(van), sleutel(tot)),
  });
  // Deze twee staan meestal al in de cache van de wijkenpagina; ze zijn hier
  // alleen nodig om te laten zien wélke straten er op een dag staan.
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });

  const regels = useMemo(() => wasdagenQuery.data ?? [], [wasdagenQuery.data]);

  const perDag = useMemo(() => {
    const kaart = new Map<string, { bedrag: number; aantal: number }>();
    for (const r of regels) {
      const bij = kaart.get(r.datum) ?? { bedrag: 0, aantal: 0 };
      bij.bedrag += Number(r.prijs);
      bij.aantal += 1;
      kaart.set(r.datum, bij);
    }
    return kaart;
  }, [regels]);

  const nu = vandaag();
  // Wat er gedaan is telt t/m vandaag; wat daarna staat is nog een plan. Dat
  // onderscheid is de reden dat deze pagina bestaat.
  const maandRegels = regels.filter((r) => isSameMonth(new Date(`${r.datum}T12:00:00`), maand));
  const gedaan = maandRegels
    .filter((r) => r.datum <= nu)
    .reduce((sum, r) => sum + Number(r.prijs), 0);
  const gepland = maandRegels
    .filter((r) => r.datum > nu)
    .reduce((sum, r) => sum + Number(r.prijs), 0);
  const werkdagen = new Set(maandRegels.map((r) => r.datum)).size;

  // --- De gekozen dag, uitgesplitst per straat -----------------------------
  const dagRegels = regels.filter((r) => r.datum === gekozenDag);
  const dagBedrag = dagRegels.reduce((sum, r) => sum + Number(r.prijs), 0);

  const perStraat = useMemo(() => {
    const customers = customersQuery.data ?? [];
    const streets = streetsQuery.data ?? [];
    const adres = new Map(customers.map((c) => [c.id, c]));
    const straatNaam = new Map(streets.map((s) => [s.id, s.name]));

    const groepen = new Map<
      string,
      { id: string; naam: string; adressen: Customer[]; bedrag: number }
    >();
    let kwijt = { aantal: 0, bedrag: 0 };
    for (const r of dagRegels) {
      const c = r.customer_id ? adres.get(r.customer_id) : undefined;
      if (!c) {
        // Adres is intussen definitief weggegooid. Wel meetellen, anders klopt
        // de optelling niet meer met het dagtotaal.
        kwijt = { aantal: kwijt.aantal + 1, bedrag: kwijt.bedrag + Number(r.prijs) };
        continue;
      }
      const naam = straatNaam.get(c.street_id) ?? "Onbekende straat";
      const g = groepen.get(c.street_id) ?? { id: c.street_id, naam, adressen: [], bedrag: 0 };
      g.adressen.push(c);
      g.bedrag += Number(r.prijs);
      groepen.set(c.street_id, g);
    }
    return {
      straten: [...groepen.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
      kwijt,
    };
  }, [dagRegels, customersQuery.data, streetsQuery.data]);

  function kiesDag(d: Date) {
    void navigate({ to: "/planning", search: { dag: sleutel(d) }, replace: true });
  }

  async function maakDagLeeg() {
    const ja = await bevestig({
      titel: `${toonDatum(gekozenDag)} leegmaken?`,
      tekst: `Alle ${dagRegels.length} adressen gaan van deze dag af. Je kunt dit direct daarna nog ongedaan maken.`,
      gevaarlijk: true,
    });
    if (!ja) return;

    const terug = dagRegels
      .filter((r) => r.customer_id)
      .map((r) => ({ customer_id: r.customer_id!, prijs: Number(r.prijs) }));
    try {
      await maakWasdagLeeg(gekozenDag);
    } catch {
      toast.error("Leegmaken mislukt.");
      return;
    }
    pushUndo({
      label: `Dag ${toonDatum(gekozenDag)}`,
      undo: async () => {
        await voegToeAanWasdag(gekozenDag, terug);
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        qc.invalidateQueries({ queryKey: ["wasdag", gekozenDag] });
      },
    });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    qc.invalidateQueries({ queryKey: ["wasdag", gekozenDag] });

    // Deze pagina heeft geen Ongedaan-knop in de balk zoals de wijkenpagina,
    // dus zonder deze melding is het terugdraaien nergens te vinden. Ruim
    // langer in beeld dan standaard: vier seconden is te kort om te beslissen.
    toast(`${terug.length} adressen van ${toonDatum(gekozenDag)} gehaald`, {
      duration: 12000,
      action: {
        label: "Ongedaan maken",
        onClick: () => {
          void undoLaatste().then((label) => {
            if (label) toast.success("Teruggedraaid: " + label);
          });
        },
      },
    });
  }

  const weekdagen = eachDayOfInterval({ start: van, end: endOfWeek(van, { locale: nl }) });

  return (
    <AppLayout
      titel="Planning"
      kruimel="Overzicht / Planning"
      onderschrift="Wat er per dag gewassen wordt — vooruit gepland en achteraf geteld."
      kop={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            {
              label: `Gewassen in ${format(maand, "MMMM", { locale: nl })}`,
              waarde: formatPrice(gedaan),
              icon: Droplets,
              tegel: "bg-tint-groen text-tint-groen-ink",
            },
            {
              label: "Nog gepland",
              waarde: formatPrice(gepland),
              icon: CalendarCheck,
              tegel: "bg-accent text-accent-foreground",
            },
            {
              label: "Dagen met werk",
              waarde: String(werkdagen),
              icon: Route2,
              tegel: "bg-tint-amber text-tint-amber-ink",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3.5"
            >
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-[11px] ${s.tegel}`}
              >
                <s.icon className="size-[17px]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
                  {s.waarde}
                </p>
              </div>
            </div>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* --- maandkalender --- */}
        <div className="rounded-[14px] border border-border bg-card p-3">
          <div className="mb-3 flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="size-8 rounded-full"
              onClick={() => setMaand((m) => addMonths(m, -1))}
              aria-label="Vorige maand"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <h2 className="font-display text-[17px] font-semibold capitalize tracking-[-0.01em]">
              {format(maand, "LLLL yyyy", { locale: nl })}
            </h2>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 rounded-full"
              onClick={() => setMaand((m) => addMonths(m, 1))}
              aria-label="Volgende maand"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto rounded-full"
              onClick={() => {
                setMaand(startOfMonth(new Date()));
                void navigate({ to: "/planning", search: { dag: vandaag() }, replace: true });
              }}
            >
              Vandaag
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {weekdagen.map((d) => (
              <div
                key={d.toISOString()}
                className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              >
                {format(d, "EEEEEE", { locale: nl })}
              </div>
            ))}

            {dagen.map((d) => {
              const k = sleutel(d);
              const info = perDag.get(k);
              const buitenMaand = !isSameMonth(d, maand);
              const isVandaag = k === nu;
              const isGekozen = k === gekozenDag;
              return (
                <button
                  key={k}
                  onClick={() => kiesDag(d)}
                  aria-current={isVandaag ? "date" : undefined}
                  aria-pressed={isGekozen}
                  className={`flex min-h-[3.9rem] flex-col items-start gap-0.5 rounded-[10px] border p-1.5 text-left transition-colors ${
                    isGekozen
                      ? "border-brand bg-brand/10"
                      : "border-transparent hover:border-border hover:bg-muted/60"
                  } ${buitenMaand ? "opacity-40" : ""}`}
                >
                  <span
                    className={`text-[12px] tabular-nums ${
                      isVandaag
                        ? "flex size-5 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground"
                        : "font-medium text-foreground"
                    }`}
                  >
                    {format(d, "d")}
                  </span>
                  {info && (
                    <span className="text-[11px] font-semibold leading-tight tabular-nums text-brand-ink">
                      {formatPrice(info.bedrag)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* --- de gekozen dag --- */}
        <div className="rounded-[14px] border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            {gekozenDag > nu ? "Gepland voor" : "Gewassen op"}
          </p>
          <h2 className="font-display text-[19px] font-semibold capitalize leading-tight tracking-[-0.02em]">
            {toonDatum(gekozenDag)}
          </h2>
          <p className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
            {formatPrice(dagBedrag)}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            {dagRegels.length} {dagRegels.length === 1 ? "adres" : "adressen"}
          </p>

          <div className="mt-4 space-y-1.5">
            {perStraat.straten.map((s) => (
              <div key={s.id} className="flex items-baseline gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{s.naam}</span>
                <span className="tabular-nums text-muted-foreground">
                  {s.adressen.length}×
                </span>
                <span className="w-16 text-right tabular-nums">{formatPrice(s.bedrag)}</span>
              </div>
            ))}
            {perStraat.kwijt.aantal > 0 && (
              <div className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">Verwijderde adressen</span>
                <span className="tabular-nums">{perStraat.kwijt.aantal}×</span>
                <span className="w-16 text-right tabular-nums">
                  {formatPrice(perStraat.kwijt.bedrag)}
                </span>
              </div>
            )}
            {dagRegels.length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                Nog niets op deze dag. Vink in de wijken aan wat je gaat doen.
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" className="rounded-full" asChild>
              <Link to="/" search={{ dag: gekozenDag }}>
                <Euro className="size-4" /> Aanvinken in de wijken
              </Link>
            </Button>
            {dagRegels.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => void maakDagLeeg()}
              >
                <Eraser className="size-4" /> Dag leegmaken
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
