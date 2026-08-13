import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  splitEvenOdd,
} from "@/lib/klanten";

interface PrintSearch {
  wijk: string;
  maand: "even" | "oneven";
  prijzen: boolean;
  liggend: boolean;
  kolommen: number;
}

export const Route = createFileRoute("/printen")({
  validateSearch: (search: Record<string, unknown>): PrintSearch => ({
    wijk: typeof search["wijk"] === "string" ? search["wijk"] : "",
    maand: search["maand"] === "oneven" ? "oneven" : "even",
    prijzen: search["prijzen"] === true || search["prijzen"] === "true",
    liggend: search["liggend"] !== false && search["liggend"] !== "false",
    kolommen: [2, 3, 4, 5].includes(Number(search["kolommen"])) ? Number(search["kolommen"]) : 4,
  }),
  head: () => ({
    meta: [
      { title: "Printlijst maken — klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Maak een compacte A4-printlijst (staand of liggend) met de klanten van de even of oneven maand.",
      },
      { property: "og:title", content: "Printlijst glazenwasser" },
      { property: "og:description", content: "Compacte A4-lijst per straat voor even of oneven maanden." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrintPagina,
});

function PrintPagina() {
  const { wijk, maand, prijzen, liggend, kolommen } = Route.useSearch();
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const districts = districtsQuery.data ?? [];
  const actieveWijk = districts.find((d) => d.id === wijk) ?? districts[0] ?? null;
  const streets = (streetsQuery.data ?? []).filter((s) => !actieveWijk || s.district_id === actieveWijk.id);
  const customers = customersQuery.data ?? [];

  const groepen = streets
    .map((s) => {
      const klanten = customers.filter((c) => c.street_id === s.id && matchesMaand(c.frequency, maand));
      return { street: s, ...splitEvenOdd(klanten), aantal: klanten.length };
    })
    .filter((g) => g.aantal > 0);

  const totaal = groepen.reduce(
    (sum, g) => sum + [...g.even, ...g.oneven].reduce((s, c) => s + c.price, 0),
    0,
  );

  return (
    <div className="min-h-screen bg-background">
      <style>{`@page { size: A4 ${liggend ? "landscape" : "portrait"}; margin: 8mm; }
@media print { html, body { background: #fff; } }`}</style>

      <div className="border-b border-border bg-card print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-4">
          <Button size="sm" variant="ghost" asChild>
            <Link to="/" search={{ wijk }}>
              <ArrowLeft className="size-4" /> Terug
            </Link>
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant={maand === "even" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ wijk, maand: "even", prijzen, liggend, kolommen }}>
                Even maand
              </Link>
            </Button>
            <Button size="sm" variant={maand === "oneven" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ wijk, maand: "oneven", prijzen, liggend, kolommen }}>
                Oneven maand
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/printen" search={{ wijk, maand, prijzen, liggend: !liggend, kolommen }}>
                {liggend ? "Liggend" : "Staand"}
              </Link>
            </Button>
            <Button size="sm" variant={prijzen ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ wijk, maand, prijzen: !prijzen, liggend, kolommen }}>
                Prijzen {prijzen ? "aan" : "uit"}
              </Link>
            </Button>
            {[2, 3, 4, 5].map((k) => (
              <Button key={k} size="sm" variant={kolommen === k ? "default" : "outline"} asChild>
                <Link to="/printen" search={{ wijk, maand, prijzen, liggend, kolommen: k }}>
                  {k} kol.
                </Link>
              </Button>
            ))}
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="size-4" /> Afdrukken
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-4 py-5 print:max-w-none print:px-0 print:py-0">
        <div className="mb-2 flex items-baseline justify-between border-b-2 border-foreground pb-1">
          <h1 className="text-[13px] font-bold uppercase tracking-wide">
            Waslijst {actieveWijk ? `${actieveWijk.name} ` : ""}— {maand === "even" ? "even" : "oneven"} maand
          </h1>
          {prijzen && <span className="text-[11px] tabular-nums">Totaal {formatPrice(totaal)}</span>}
        </div>

        {groepen.length === 0 && (
          <p className="text-sm text-muted-foreground print:hidden">Geen klanten voor deze maand.</p>
        )}

        <div style={{ columnCount: kolommen, columnGap: "5mm" }} className="[column-fill:_balance]">
          {groepen.map((g) => (
            <div key={g.street.id} className="mb-1.5 break-inside-avoid border border-foreground/70">
              <h2 className="border-b border-foreground/70 bg-muted px-1 py-[1px] text-[10px] font-bold uppercase tracking-wide">
                {g.street.name}
              </h2>
              <div className="grid grid-cols-2">
                {(["even", "oneven"] as const).map((kant, i) => (
                  <table
                    key={kant}
                    className={`w-full table-fixed border-collapse ${i === 0 ? "border-r border-foreground/40" : ""}`}
                  >
                    <thead>
                      <tr className="border-b border-foreground/40 text-[8px] uppercase tracking-wide text-foreground/70">
                        <th className="w-7 px-1 text-left">nr</th>
                        <th className="px-1 text-left">note</th>
                        {prijzen && <th className="w-9 px-1 text-right">prijs</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g[kant].map((c) => (
                        <tr key={c.id} className="border-b border-foreground/20 last:border-0">
                          <td className="w-7 px-1 text-[9.5px] font-semibold leading-[1.35] tabular-nums">
                            {formatNumber(c)}
                          </td>
                          <td className="truncate px-1 text-[9.5px] leading-[1.35]">{c.note}</td>
                          {prijzen && (
                            <td className="w-9 px-1 text-right text-[9.5px] leading-[1.35] tabular-nums">
                              {formatPrice(c.price)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
