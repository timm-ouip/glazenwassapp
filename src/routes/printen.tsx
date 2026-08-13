import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import {
  fetchCustomers,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  splitEvenOdd,
} from "@/lib/klanten";

interface PrintSearch {
  maand: "even" | "oneven";
  prijzen: boolean;
}

export const Route = createFileRoute("/printen")({
  validateSearch: (search: Record<string, unknown>): PrintSearch => ({
    maand: search["maand"] === "oneven" ? "oneven" : "even",
    prijzen: search["prijzen"] === true || search["prijzen"] === "true",
  }),
  head: () => ({
    meta: [
      { title: "Printlijst maken — klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Maak een compacte A4-printlijst met de klanten van de even of oneven maand.",
      },
      { property: "og:title", content: "Printlijst glazenwasser" },
      { property: "og:description", content: "Compacte A4-lijst per straat voor even of oneven maanden." },
    ],
  }),
  component: PrintPagina,
});

function PrintPagina() {
  const { maand, prijzen } = Route.useSearch();
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const streets = streetsQuery.data ?? [];
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
      <div className="border-b border-border bg-card print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-4">
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" /> Terug
            </Link>
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant={maand === "even" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ maand: "even", prijzen }}>
                Even maand
              </Link>
            </Button>
            <Button size="sm" variant={maand === "oneven" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ maand: "oneven", prijzen }}>
                Oneven maand
              </Link>
            </Button>
            <Button size="sm" variant={prijzen ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ maand, prijzen: !prijzen }}>
                Prijzen {prijzen ? "aan" : "uit"}
              </Link>
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="size-4" /> Afdrukken
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-4 flex items-baseline justify-between border-b border-border pb-2">
          <h1 className="text-lg font-semibold">
            Waslijst — {maand === "even" ? "even" : "oneven"} maand
          </h1>
          {prijzen && <span className="text-sm tabular-nums">Totaal {formatPrice(totaal)}</span>}
        </div>

        {groepen.length === 0 && (
          <p className="text-sm text-muted-foreground print:hidden">
            Geen klanten voor deze maand.
          </p>
        )}

        <div className="columns-2 gap-6 [column-fill:_balance] print:columns-2 print:gap-4">
          {groepen.map((g) => (
            <div key={g.street.id} className="mb-3 break-inside-avoid">
              <h2 className="bg-secondary px-2 py-1 text-[13px] font-semibold uppercase tracking-wide text-secondary-foreground">
                {g.street.name}
              </h2>
              <div className="grid grid-cols-2 gap-x-3">
                {(["even", "oneven"] as const).map((kant) => (
                  <ul key={kant} className="pt-1">
                    {g[kant].map((c) => (
                      <li
                        key={c.id}
                        className="flex items-baseline gap-1.5 border-b border-border/60 py-[3px] text-[12px] leading-tight"
                      >
                        <span className="w-8 font-medium tabular-nums">{formatNumber(c)}</span>
                        <span className="flex-1 truncate text-muted-foreground">{c.note}</span>
                        {prijzen && <span className="tabular-nums">{formatPrice(c.price)}</span>}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
