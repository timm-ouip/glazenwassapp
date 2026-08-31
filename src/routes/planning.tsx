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
  fetchDistricts,
  fetchStreets,
  formatPrice,
  wijkKleur,
  wijkVlak,
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
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });

  const regels = useMemo(() => wasdagenQuery.data ?? [], [wasdagenQuery.data]);

  /** Kleur en naam per wijk, op volgorde van de wijkenlijst. */
  const wijkInfo = useMemo(() => {
    const kaart = new Map<string, { naam: string; kleur: string; index: number }>();
    (districtsQuery.data ?? []).forEach((d, i) =>
      kaart.set(d.id, { naam: d.name, kleur: wijkKleur(i), index: i }),
    );
    return kaart;
  }, [districtsQuery.data]);

  const perDag = useMemo(() => {
    const straatVan = new Map((customersQuery.data ?? []).map((c) => [c.id, c.street_id]));
    const wijkVan = new Map((streetsQuery.data ?? []).map((s) => [s.id, s.district_id]));

    interface Dag {
      bedrag: number;
      aantal: number;
      straten: Set<string>;
      /** Op volgorde van de wijkenlijst; de eerste is de wijk van die dag. */
      wijken: string[];
    }
    const kaart = new Map<string, Dag>();

    for (const r of regels) {
      const bij = kaart.get(r.datum) ?? {
        bedrag: 0,
        aantal: 0,
        straten: new Set<string>(),
        wijken: [],
      };
      bij.bedrag += Number(r.prijs);
      bij.aantal += 1;

      const straatId = r.customer_id ? straatVan.get(r.customer_id) : undefined;
      if (straatId) {
        bij.straten.add(straatId);
        const wijkId = wijkVan.get(straatId);
        if (wijkId && !bij.wijken.includes(wijkId)) bij.wijken.push(wijkId);
      }
      kaart.set(r.datum, bij);
    }

    // Op volgorde van de wijkenlijst, niet op wie er toevallig als eerste in
    // de regels stond: zo staan de banen in het vakje en de kopjes in het
    // dagpaneel in dezelfde volgorde.
    for (const dag of kaart.values()) {
      dag.wijken.sort((a, b) => (wijkInfo.get(a)?.index ?? 0) - (wijkInfo.get(b)?.index ?? 0));
    }
    return kaart;
  }, [regels, customersQuery.data, streetsQuery.data, wijkInfo]);

  // Het balkje in een dagvak is relatief aan de drukste dag van deze maand.
  const drukste = useMemo(
    () => Math.max(1, ...[...perDag.values()].map((v) => v.bedrag)),
    [perDag],
  );

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

  /** De dag uitgesplitst per wijk, en daarbinnen per straat. */
  const perWijk = useMemo(() => {
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));

    interface Straat {
      id: string;
      naam: string;
      aantal: number;
      bedrag: number;
    }
    interface Wijk {
      id: string;
      naam: string;
      kleur: string;
      bedrag: number;
      straten: Map<string, Straat>;
    }

    const wijken = new Map<string, Wijk>();
    let kwijt = { aantal: 0, bedrag: 0 };

    for (const r of dagRegels) {
      const c = r.customer_id ? adres.get(r.customer_id) : undefined;
      const s = c ? straat.get(c.street_id) : undefined;
      if (!c || !s) {
        // Adres of straat is intussen definitief weggegooid. Wel meetellen,
        // anders klopt de optelling niet meer met het dagtotaal.
        kwijt = { aantal: kwijt.aantal + 1, bedrag: kwijt.bedrag + Number(r.prijs) };
        continue;
      }

      const info = wijkInfo.get(s.district_id);
      const wijk = wijken.get(s.district_id) ?? {
        id: s.district_id,
        naam: info?.naam ?? "Onbekende wijk",
        kleur: info?.kleur ?? "transparent",
        bedrag: 0,
        straten: new Map<string, Straat>(),
      };
      wijk.bedrag += Number(r.prijs);

      const rij = wijk.straten.get(s.id) ?? { id: s.id, naam: s.name, aantal: 0, bedrag: 0 };
      rij.aantal += 1;
      rij.bedrag += Number(r.prijs);
      wijk.straten.set(s.id, rij);
      wijken.set(s.district_id, wijk);
    }

    return {
      // Wijken op volgorde van de wijkenlijst, straten daarbinnen op naam.
      wijken: [...wijken.values()]
        .sort((a, b) => (wijkInfo.get(a.id)?.index ?? 0) - (wijkInfo.get(b.id)?.index ?? 0))
        .map((w) => ({
          ...w,
          straten: [...w.straten.values()].sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
        })),
      kwijt,
    };
  }, [dagRegels, customersQuery.data, streetsQuery.data, wijkInfo]);

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
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-card-header px-3 py-2.5">
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

          <div className="grid grid-cols-7 border-b border-border bg-card-header">
            {weekdagen.map((d) => (
              <div
                key={d.toISOString()}
                className="border-l border-border py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground first:border-l-0"
              >
                {format(d, "EEEEEE", { locale: nl })}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {dagen.map((d) => {
              const k = sleutel(d);
              const info = perDag.get(k);
              const buitenMaand = !isSameMonth(d, maand);
              const isVandaag = k === nu;
              const isGekozen = k === gekozenDag;
              // Voorbij vandaag is het nog een plan; t/m vandaag is het gedaan.
              const isGedaan = k <= nu;
              // Staan er meerdere wijken op één dag, dan krijgt het vak een
              // baan per wijk in plaats van één kleur.
              const vlak =
                buitenMaand || !info?.wijken.length
                  ? ""
                  : wijkVlak(
                      info.wijken
                        .map((id) => wijkInfo.get(id)?.index)
                        .filter((i): i is number => i !== undefined),
                    );
              return (
                <button
                  key={k}
                  onClick={() => kiesDag(d)}
                  // Dubbelklikken slaat de tussenstap over en zet je meteen
                  // in de wijken met die dag aan het aanvinken.
                  onDoubleClick={() => void navigate({ to: "/", search: { dag: k } })}
                  title="Klik om te bekijken, dubbelklik om aan te vinken in de wijken"
                  aria-current={isVandaag ? "date" : undefined}
                  aria-pressed={isGekozen}
                  // Het hele vakje krijgt de pastelkleur van de wijk die er
                  // die dag aan de beurt is; zo zie je een maand aan de
                  // kleuren, zonder namen te lezen.
                  style={vlak ? { background: vlak } : undefined}
                  className={`relative flex min-h-[4.5rem] flex-col border-b border-r border-border p-1.5 text-left transition-colors [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0 sm:min-h-[6.25rem] ${
                    buitenMaand ? "bg-card-header" : vlak ? "" : "hover:bg-muted/50"
                  } ${isGekozen ? "outline outline-2 -outline-offset-2 outline-brand" : ""} ${
                    isGekozen && !vlak ? "bg-brand/10" : ""
                  }`}
                >
                  <span
                    className={`self-start rounded-md px-1 text-[12px] font-semibold leading-5 tabular-nums ${
                      isVandaag
                        ? "bg-brand text-brand-foreground"
                        : buitenMaand
                          ? "text-muted-foreground/70"
                          : "text-foreground"
                    }`}
                  >
                    {format(d, "d")}
                  </span>

                  {info && (
                    <>
                      {/* De wijk staat boven het bedrag: dat is waar je heen
                          rijdt. Elke wijk heeft zijn eigen kleur, zodat je
                          een maand in één oogopslag ziet. */}
                      {info.wijken.length > 0 && (
                        <span className="mt-auto flex w-full items-center gap-1 truncate text-[10.5px] font-medium">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: wijkInfo.get(info.wijken[0]!)?.kleur }}
                          />
                          <span className="truncate">
                            {wijkInfo.get(info.wijken[0]!)?.naam ?? "Onbekende wijk"}
                            {info.wijken.length > 1 && ` +${info.wijken.length - 1}`}
                          </span>
                        </span>
                      )}
                      <span
                        className={`w-full truncate font-display text-[12px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:text-[16px] ${
                          info.wijken.length > 0 ? "mt-0.5" : "mt-auto"
                        }`}
                      >
                        {formatPrice(info.bedrag)}
                      </span>
                      <span className="mt-1 hidden truncate text-[10.5px] text-muted-foreground sm:block">
                        {info.straten.size > 0
                          ? `${info.straten.size} ${info.straten.size === 1 ? "straat" : "straten"} · ${info.aantal}×`
                          : `${info.aantal}×`}
                      </span>
                      <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${
                            isGedaan ? "bg-tint-groen-ink" : "bg-brand"
                          }`}
                          style={{ width: `${Math.round((info.bedrag / drukste) * 100)}%` }}
                        />
                      </span>
                    </>
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

          <div className="mt-4 space-y-3.5">
            {perWijk.wijken.map((w) => (
              <div key={w.id}>
                {/* De wijk erboven, met zijn kleur: rijd je op één dag twee
                    wijken, dan zie je meteen welke straten bij welke horen. */}
                <div className="mb-1 flex items-baseline gap-1.5 border-b border-border pb-1">
                  <span
                    className="size-2 shrink-0 translate-y-[-1px] rounded-full"
                    style={{ background: w.kleur }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                    {w.naam}
                  </span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {formatPrice(w.bedrag)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {w.straten.map((s) => (
                    <div key={s.id} className="flex items-baseline gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{s.naam}</span>
                      <span className="tabular-nums text-muted-foreground">{s.aantal}×</span>
                      <span className="w-16 text-right tabular-nums">{formatPrice(s.bedrag)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {perWijk.kwijt.aantal > 0 && (
              <div className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">Verwijderde adressen</span>
                <span className="tabular-nums">{perWijk.kwijt.aantal}×</span>
                <span className="w-16 text-right tabular-nums">
                  {formatPrice(perWijk.kwijt.bedrag)}
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
