import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Euro, Hammer, MapPin, Printer, Users } from "lucide-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  noteVoorMaand,
  sortCustomers,
  wijkKleur,
  type Customer,
} from "@/lib/klanten";
import { fetchWasdag, toonDatum, vandaag } from "@/lib/wasdag";
import { fetchKlussen, telDagVan, vinkKlusAf, type Klus } from "@/lib/klussen";
import { Checkbox } from "@/components/ui/checkbox";
import { pushUndo } from "@/lib/undo";

interface DagSearch {
  datum?: string;
}

export const Route = createFileRoute("/dag")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): DagSearch =>
    typeof search["datum"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["datum"])
      ? { datum: search["datum"] }
      : {},
  head: () => ({
    meta: [
      { title: "De dag — Klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Alle adressen die op één dag ingepland staan, per wijk en per straat.",
      },
    ],
  }),
  component: DagPagina,
});

/**
 * Wat er op één dag te doen staat, straat voor straat.
 *
 * De planningpagina toont een maand en telt per dag een bedrag op; dit is de
 * andere kant van die kaart: welke huisnummers je langsgaat, in de volgorde
 * van de wijklijst, met de notitie erbij. Vanaf hier print je de daglijst.
 */
function DagPagina() {
  useRequireAuth();
  const { datum: datumUitUrl } = Route.useSearch();
  const datum = datumUitUrl ?? vandaag();

  const wasdagQuery = useQuery({
    queryKey: ["wasdag", datum],
    queryFn: () => fetchWasdag(datum),
  });
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const qc = useQueryClient();
  // Openstaand werk plus wat er op deze dag afgevinkt is.
  const klussenQuery = useQuery({
    queryKey: ["klussen", datum, datum],
    queryFn: () => fetchKlussen(datum, datum),
  });

  const maand = datum.slice(0, 7);

  /**
   * De extra opdrachten die op deze dag horen. Niet afgevinkt en de dag is
   * geweest? Dan staat hij hier niet meer: die is van de dag af en wacht weer
   * op de planning. Zie telDagVan in src/lib/klussen.ts.
   */
  const klussen = useMemo(
    () => (klussenQuery.data ?? []).filter((k) => telDagVan(k) === datum),
    [klussenQuery.data, datum],
  );

  /** "Kerkstraat 12" bij een opdracht. */
  const adresVan = useMemo(() => {
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straten = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    return (k: Klus) => {
      const c = adres.get(k.customer_id);
      const s = c ? straten.get(c.street_id) : undefined;
      return c ? `${s?.name ?? "?"} ${formatNumber(c)}` : "Verwijderd adres";
    };
  }, [customersQuery.data, streetsQuery.data]);

  async function vinkAf(k: Klus, aan: boolean) {
    try {
      await vinkKlusAf(k, aan);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Opdracht ${k.omschrijving}`,
      undo: async () => {
        await vinkKlusAf(k, !aan);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
  }

  /**
   * De dag uitgesplitst per wijk en daarbinnen per straat. Het bedrag komt van
   * de wasdag-regel en niet van het adres: een prijsverhoging van later hoort
   * een dag van vorige week niet duurder te maken.
   */
  const perWijk = useMemo(() => {
    const regels = wasdagQuery.data ?? [];
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    const wijkIndex = new Map((districtsQuery.data ?? []).map((d, i) => [d.id, i]));
    const wijkNaam = new Map((districtsQuery.data ?? []).map((d) => [d.id, d.name]));
    const prijsVan = new Map(regels.map((r) => [r.customer_id, Number(r.prijs)]));

    interface Straat {
      id: string;
      naam: string;
      klanten: Customer[];
      bedrag: number;
    }
    interface Wijk {
      id: string;
      naam: string;
      kleur: string;
      bedrag: number;
      aantal: number;
      straten: Map<string, Straat>;
    }

    const wijken = new Map<string, Wijk>();
    let kwijt = 0;

    for (const r of regels) {
      const c = r.customer_id ? adres.get(r.customer_id) : undefined;
      const s = c ? straat.get(c.street_id) : undefined;
      if (!c || !s) {
        // Adres of straat is intussen definitief weggegooid.
        kwijt += 1;
        continue;
      }
      const index = wijkIndex.get(s.district_id) ?? 0;
      const wijk = wijken.get(s.district_id) ?? {
        id: s.district_id,
        naam: wijkNaam.get(s.district_id) ?? "Onbekende wijk",
        kleur: wijkKleur(index),
        bedrag: 0,
        aantal: 0,
        straten: new Map<string, Straat>(),
      };
      wijk.bedrag += Number(r.prijs);
      wijk.aantal += 1;

      const rij = wijk.straten.get(s.id) ?? { id: s.id, naam: s.name, klanten: [], bedrag: 0 };
      rij.klanten.push(c);
      rij.bedrag += Number(r.prijs);
      wijk.straten.set(s.id, rij);
      wijken.set(s.district_id, wijk);
    }

    return {
      wijken: [...wijken.values()]
        .sort((a, b) => (wijkIndex.get(a.id) ?? 0) - (wijkIndex.get(b.id) ?? 0))
        .map((w) => ({
          ...w,
          straten: [...w.straten.values()]
            .sort((a, b) => a.naam.localeCompare(b.naam, "nl"))
            // Huisnummers in dezelfde volgorde als op de wijklijst.
            .map((s) => ({ ...s, klanten: sortCustomers(s.klanten) })),
        })),
      kwijt,
      prijsVan,
    };
  }, [wasdagQuery.data, customersQuery.data, streetsQuery.data, districtsQuery.data]);

  const regels = wasdagQuery.data ?? [];
  const bedrag =
    regels.reduce((sum, r) => sum + Number(r.prijs), 0) +
    klussen.reduce((sum, k) => sum + k.prijs, 0);
  const straten = perWijk.wijken.reduce((sum, w) => sum + w.straten.length, 0);

  return (
    <AppLayout
      titel={toonDatum(datum)}
      kruimel="Overzicht / Planning / Dag"
      onderschrift="Alles wat er deze dag te doen staat, straat voor straat."
      acties={
        <>
          <Button size="sm" variant="outline" className="rounded-full" asChild>
            <Link to="/planning" search={{ dag: datum }}>
              <CalendarDays className="size-4" /> Naar de kalender
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="rounded-full" asChild>
            <Link to="/" search={{ dag: datum }}>
              <Euro className="size-4" /> Werk inplannen
            </Link>
          </Button>
          <Button size="sm" className="rounded-full" asChild disabled={regels.length === 0}>
            <Link
              to="/printen"
              search={{ wijk: "", maand, prijzen: false, liggend: true, dag: datum }}
            >
              <Printer className="size-4" /> Printlijst van deze dag
            </Link>
          </Button>
        </>
      }
      kop={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Adressen",
              waarde: String(regels.length),
              icon: Users,
              tegel: "bg-accent text-accent-foreground",
            },
            {
              label: "Straten",
              waarde: String(straten),
              icon: MapPin,
              tegel: "bg-tint-amber text-tint-amber-ink",
            },
            {
              label: "Opbrengst",
              waarde: formatPrice(bedrag),
              icon: Euro,
              tegel: "bg-tint-groen text-tint-groen-ink",
            },
          ].map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3"
            >
              <span className={`flex size-9 items-center justify-center rounded-full ${t.tegel}`}>
                <t.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-muted-foreground">
                  {t.label}
                </span>
                <span className="block font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
                  {t.waarde}
                </span>
              </span>
            </div>
          ))}
        </div>
      }
    >
      {wasdagQuery.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Laden…</p>
      ) : regels.length === 0 && klussen.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="font-display text-[17px] font-semibold">Nog niets op deze dag</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Vink in de wijken aan wat je gaat doen, of zet er met de rechtermuisknop op de kalender
            een hele wijk op.
          </p>
        </div>
      ) : (
        <div className="gap-3.5 md:columns-1 xl:columns-2">
          {perWijk.wijken.map((w) => (
            <section
              key={w.id}
              className="mb-3.5 break-inside-avoid-column overflow-hidden rounded-[14px] border border-border bg-card"
            >
              <div className="flex items-baseline gap-2 border-b border-border bg-card-header px-3 py-2">
                <span
                  className="size-2.5 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: w.kleur }}
                />
                <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                  {w.naam}
                </h2>
                <span className="text-[12px] text-muted-foreground">{w.aantal}×</span>
                <span className="text-[13px] font-semibold tabular-nums">
                  {formatPrice(w.bedrag)}
                </span>
              </div>

              {w.straten.map((s) => (
                <div key={s.id} className="border-b border-border/60 last:border-b-0">
                  <div className="flex items-baseline gap-2 px-3 pb-1 pt-2">
                    <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {s.naam}
                    </h3>
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      {formatPrice(s.bedrag)}
                    </span>
                  </div>
                  <ul className="pb-2">
                    {s.klanten.map((c) => {
                      // De notitie zoals hij die maand geldt, dus inclusief het
                      // werk dat er alleen in bepaalde maanden bij komt.
                      const notitie = noteVoorMaand(c, maand);
                      return (
                        <li
                          key={c.id}
                          className="flex items-baseline gap-2 px-3 py-[2px] text-[13px]"
                        >
                          <span className="w-10 shrink-0 font-medium tabular-nums">
                            {formatNumber(c)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {notitie}
                          </span>
                          <span className="tabular-nums">
                            {formatPrice(perWijk.prijsVan.get(c.id) ?? c.price)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          {/* Extra werk dat niet aan een maand vastzit. Onderaan, want het
              hoort niet bij de ronde van een straat — je pikt het mee als je
              er toch bent. Afvinken doe je hier: gebeurt dat niet, dan is hij
              morgen weer van deze dag af en wacht hij op de planning. */}
          {klussen.length > 0 && (
            <section className="mb-3.5 break-inside-avoid-column overflow-hidden rounded-[14px] border border-border bg-card">
              <div className="flex items-baseline gap-2 border-b border-border bg-card-header px-3 py-2">
                <Hammer className="size-3.5 shrink-0 translate-y-[2px] text-muted-foreground" />
                <h2 className="min-w-0 flex-1 truncate font-display text-[14.5px] font-semibold">
                  Extra opdrachten
                </h2>
                <span className="tabular-nums text-[12.5px] text-muted-foreground">
                  {formatPrice(klussen.reduce((sum, k) => sum + k.prijs, 0))}
                </span>
              </div>
              <ul className="py-1.5">
                {klussen.map((k) => (
                  <li key={k.id} className="flex items-center gap-2 px-3 py-[3px] text-[13px]">
                    <Checkbox
                      className="size-3.5 shrink-0"
                      checked={!!k.gedaan_op}
                      onCheckedChange={(v) => void vinkAf(k, v === true)}
                      aria-label={`${k.omschrijving} gedaan`}
                    />
                    <span className="w-24 shrink-0 truncate font-medium">{adresVan(k)}</span>
                    <span
                      className={`min-w-0 flex-1 truncate ${k.gedaan_op ? "text-muted-foreground line-through" : "text-muted-foreground"}`}
                    >
                      {k.omschrijving}
                    </span>
                    <span className="tabular-nums">{formatPrice(k.prijs)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {perWijk.kwijt > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {perWijk.kwijt} {perWijk.kwijt === 1 ? "adres is" : "adressen zijn"} intussen
              verwijderd; ze tellen wel mee in het bedrag.
            </p>
          )}
        </div>
      )}
    </AppLayout>
  );
}
