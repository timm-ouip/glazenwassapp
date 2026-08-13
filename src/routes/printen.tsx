import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  maand: "even" | "oneven" | "alles";
  prijzen: boolean;
  liggend: boolean;
  kolommen: number;
  paginas?: number;
}

export const Route = createFileRoute("/printen")({
  validateSearch: (search: Record<string, unknown>): PrintSearch => ({
    wijk: typeof search["wijk"] === "string" ? search["wijk"] : "",
    maand:
      search["maand"] === "oneven" ? "oneven" : search["maand"] === "alles" ? "alles" : "even",
    prijzen: search["prijzen"] === true || search["prijzen"] === "true",
    liggend: search["liggend"] !== false && search["liggend"] !== "false",
    kolommen: [2, 3, 4, 5].includes(Number(search["kolommen"])) ? Number(search["kolommen"]) : 4,
    paginas: Number(search["paginas"]) === 2 ? 2 : 1,
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
  const { wijk, maand, prijzen, liggend, kolommen, paginas: paginasRaw } = Route.useSearch();
  const paginas = paginasRaw === 2 ? 2 : 1;
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
      return { street: s, ...splitEvenOdd(klanten, s.sort_desc ? "desc" : "asc"), aantal: klanten.length };
    })
    .filter((g) => g.aantal > 0);

  const totaal = groepen.reduce(
    (sum, g) => sum + [...g.even, ...g.oneven].reduce((s, c) => s + c.price, 0),
    0,
  );

  // --- automatisch passend maken op 1 of 2 A4's ---
  const MM = 96 / 25.4;
  const paginaB = (liggend ? 297 : 210) - 16;
  const paginaH = (liggend ? 210 : 297) - 16;
  const breedtePx = Math.round(paginaB * MM);
  const hoogtePx = Math.round(paginaH * MM);
  const maxHoogtePx = hoogtePx * paginas;

  const inhoudRef = useRef<HTMLDivElement>(null);
  const [schaal, setSchaal] = useState(1);

  useLayoutEffect(() => {
    setSchaal(1);
  }, [groepen.length, kolommen, liggend, prijzen, maand, wijk, paginas]);

  useEffect(() => {
    const el = inhoudRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      const node = inhoudRef.current;
      if (!node) return;
      const gerenderd = node.getBoundingClientRect().height;
      if (gerenderd <= 0) return;
      const gewenst = Math.min(1, (schaal * maxHoogtePx) / gerenderd);
      if (Math.abs(gewenst - schaal) > 0.004) setSchaal(gewenst);
    });
    return () => cancelAnimationFrame(id);
  }, [schaal, maxHoogtePx, groepen.length, kolommen, prijzen, maand, wijk, liggend]);




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
            <Button size="sm" variant={maand === "alles" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ wijk, maand: "alles", prijzen, liggend, kolommen }}>
                Alle klanten
              </Link>
            </Button>

            <Button size="sm" variant="outline" asChild>
              <Link to="/printen" search={{ wijk, maand, prijzen, liggend: !liggend, kolommen, paginas }}>
                {liggend ? "Liggend" : "Staand"}
              </Link>
            </Button>
            <Button size="sm" variant={prijzen ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ wijk, maand, prijzen: !prijzen, liggend, kolommen, paginas }}>
                Prijzen {prijzen ? "aan" : "uit"}
              </Link>
            </Button>
            {[1, 2].map((p) => (
              <Button key={p} size="sm" variant={paginas === p ? "default" : "outline"} asChild>
                <Link to="/printen" search={{ wijk, maand, prijzen, liggend, kolommen, paginas: p }}>
                  {p} A4
                </Link>
              </Button>
            ))}
            {[2, 3, 4, 5].map((k) => (
              <Button key={k} size="sm" variant={kolommen === k ? "default" : "outline"} asChild>
                <Link to="/printen" search={{ wijk, maand, prijzen, liggend, kolommen: k, paginas }}>
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

      <main className="mx-auto w-fit px-4 py-5 print:p-0">
        {groepen.length === 0 && (
          <p className="text-sm text-muted-foreground print:hidden">Geen klanten voor deze maand.</p>
        )}
        <div
          ref={inhoudRef}
          className="origin-top-left overflow-hidden print:overflow-visible"
          style={{ zoom: schaal, width: Math.round(breedtePx / schaal) }}
        >
        <div className="mb-2 flex items-baseline justify-between border-b-2 border-foreground pb-1">
          <h1 className="text-[13px] font-bold uppercase tracking-wide">
            Waslijst {actieveWijk ? `${actieveWijk.name} ` : ""}—{" "}
            {maand === "alles" ? "alle klanten" : `${maand} maand`}
          </h1>

          {prijzen && <span className="text-[11px] tabular-nums">Totaal {formatPrice(totaal)}</span>}
        </div>

        <div style={{ columnCount: kolommen, columnGap: "2mm" }} className="[column-fill:_balance]">

          {groepen.map((g) => (
            <div key={g.street.id} className="-mt-px break-inside-avoid border border-foreground/70">
              <h2 className="border-b border-foreground/70 bg-muted px-1 text-[9px] font-bold uppercase leading-[1.25] tracking-wide">
                {g.street.name}
              </h2>
              <div className={`grid ${g.even.length > 0 && g.oneven.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
                {([
                  g.even.length > 0 ? "even" : null,
                  g.oneven.length > 0 ? "oneven" : null,
                ].filter(Boolean) as ("even" | "oneven")[]).map((kant, i, arr) => (
                  <table
                    key={kant}
                    className={`w-full table-fixed border-collapse ${i < arr.length - 1 ? "border-r border-foreground/40" : ""}`}
                  >
                    <thead>
                      <tr className="border-b border-foreground/40 text-[7px] uppercase leading-[1.2] tracking-wide text-foreground/70">
                        <th className="w-6 px-[2px] text-left">nr</th>
                        <th className="px-[2px] text-left">note</th>
                        {maand === "alles" && <th className="w-8 px-[2px] text-left">freq</th>}
                        {prijzen && <th className="w-10 px-[2px] text-right">€</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g[kant].map((c) => (
                        <tr key={c.id} className="border-b border-foreground/20 align-top last:border-0">
                          <td className="w-6 px-[2px] text-[8.5px] font-semibold leading-[1.2] tabular-nums">
                            {formatNumber(c)}
                          </td>
                          <td className="px-[2px] text-[8.5px] leading-[1.2] break-words hyphens-auto">
                            {c.note}
                          </td>
                          {maand === "alles" && (
                            <td className="w-8 px-[2px] text-[8.5px] leading-[1.2]">{c.frequency}</td>
                          )}
                          {prijzen && (
                            <td className={`w-10 px-[2px] text-right text-[8.5px] leading-[1.2] tabular-nums ${c.price === 0 ? "text-red-600" : ""}`}>
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
        </div>
      </main>

    </div>
  );
}
