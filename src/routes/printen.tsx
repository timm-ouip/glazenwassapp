import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Printer } from "lucide-react";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  splitEvenOdd,
  type Customer,
  type Street,
} from "@/lib/klanten";

interface PrintSearch {
  wijk: string;
  maand: "even" | "oneven" | "alles";
  prijzen: boolean;
  liggend: boolean;
  kolommen: number;
  paginas?: number;
  vouwen?: boolean;
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
    vouwen: search["vouwen"] === true || search["vouwen"] === "true",
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

type Groep = { street: Street; even: Customer[]; oneven: Customer[]; aantal: number };

function StraatBlok({
  g,
  prijzen,
  maand,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
}) {
  return (
    <div className="-mt-px break-inside-avoid border border-foreground/70">
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
            <tbody>

              {g[kant].map((c) => (
                <tr key={c.id} className="border-b border-foreground/20 align-top last:border-0">
                  <td className="w-6 px-[2px] text-[8.5px] font-semibold leading-[1.2] tabular-nums">
                    {formatNumber(c)}
                  </td>
                  <td className="px-[2px] text-[8.5px] leading-[1.2] break-words hyphens-auto">{c.note}</td>
                  {maand === "alles" && (
                    <td className="w-8 px-[2px] text-[8.5px] leading-[1.2]">{c.frequency}</td>
                  )}
                  {prijzen && (
                    <td
                      className={`w-10 px-[2px] text-right text-[8.5px] leading-[1.2] tabular-nums ${c.price === 0 ? "text-red-600" : ""}`}
                    >
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
  );
}

/** Verdeelt de straten in 4 kwarten, in routevolgorde, zo gelijk mogelijk verdeeld. */
function verdeelInKwarten(groepen: Groep[]): Groep[][] {
  const gewicht = (g: Groep) => 1.6 + Math.max(g.even.length, g.oneven.length);
  const totaal = groepen.reduce((s, g) => s + gewicht(g), 0);
  const doel = totaal / 4;
  const kwarten: Groep[][] = [[], [], [], []];
  let i = 0;
  let som = 0;
  for (const g of groepen) {
    const w = gewicht(g);
    if (i < 3 && som > 0 && som + w / 2 > doel) {
      i += 1;
      som = 0;
    }
    kwarten[i]!.push(g);
    som += w;
  }
  return kwarten;
}

function PrintPagina() {
  const { wijk, maand, prijzen, liggend, kolommen, paginas: paginasRaw, vouwen: vouwenRaw } = Route.useSearch();
  const navigate = Route.useNavigate();
  const vouwen = vouwenRaw === true;
  const paginas = vouwen ? 1 : paginasRaw === 2 ? 2 : 1;
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const districts = districtsQuery.data ?? [];
  const actieveWijk = districts.find((d) => d.id === wijk) ?? districts[0] ?? null;
  const streets = (streetsQuery.data ?? []).filter((s) => !actieveWijk || s.district_id === actieveWijk.id);
  const customers = customersQuery.data ?? [];

  const groepen: Groep[] = streets
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
  const kopRef = useRef<HTMLDivElement>(null);
  const kwartRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [schaal, setSchaal] = useState(1);
  const [kopHoogte, setKopHoogte] = useState(26);


  useLayoutEffect(() => {
    setSchaal(1);
  }, [groepen.length, kolommen, liggend, prijzen, maand, wijk, paginas, vouwen]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (vouwen) {
        const kop = kopRef.current;
        if (kop) {
          const h = Math.ceil(kop.getBoundingClientRect().height / schaal);
          if (h > 0 && Math.abs(h - kopHoogte) > 1) setKopHoogte(h);
        }
        let ratio = 0;
        for (const el of kwartRefs.current) {
          if (!el || el.clientHeight <= 0) continue;
          ratio = Math.max(ratio, el.scrollHeight / el.clientHeight);
        }
        if (ratio > 1.004) setSchaal((s) => Math.max(0.25, s / ratio));
        return;
      }

      const node = inhoudRef.current;
      if (!node) return;
      const gerenderd = node.getBoundingClientRect().height;
      if (gerenderd <= 0) return;
      const gewenst = Math.min(1, (schaal * maxHoogtePx) / gerenderd);
      if (Math.abs(gewenst - schaal) > 0.004) setSchaal(gewenst);
    });
    return () => cancelAnimationFrame(id);
  }, [schaal, kopHoogte, maxHoogtePx, groepen.length, kolommen, prijzen, maand, wijk, liggend, vouwen]);

  const kwarten = vouwen ? verdeelInKwarten(groepen) : [];
  // hoogte per kwart, in niet-geschaalde px (titelbalk wordt gemeten)
  const kwartHoogte = Math.floor((hoogtePx / schaal - kopHoogte - 4) / 2);
  const kwartKolommen = Math.max(1, Math.round(kolommen / 2));


  const zoek = { wijk, maand, prijzen, liggend, kolommen, paginas, vouwen };

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
              <Link to="/printen" search={{ ...zoek, maand: "even" }}>
                Even maand
              </Link>
            </Button>
            <Button size="sm" variant={maand === "oneven" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ ...zoek, maand: "oneven" }}>
                Oneven maand
              </Link>
            </Button>
            <Button size="sm" variant={maand === "alles" ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ ...zoek, maand: "alles" }}>
                Alle klanten
              </Link>
            </Button>

            <Button size="sm" variant="outline" asChild>
              <Link to="/printen" search={{ ...zoek, liggend: !liggend }}>
                {liggend ? "Liggend" : "Staand"}
              </Link>
            </Button>
            <Button size="sm" variant={prijzen ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ ...zoek, prijzen: !prijzen }}>
                Prijzen {prijzen ? "aan" : "uit"}
              </Link>
            </Button>
            <Button size="sm" variant={vouwen ? "default" : "outline"} asChild>
              <Link to="/printen" search={{ ...zoek, vouwen: !vouwen, paginas: 1 }}>
                Vouwen in 4
              </Link>
            </Button>
            <Select
              value={String(paginas)}
              disabled={vouwen}
              onValueChange={(v) => {
                const p = Number(v) as 1 | 2;
                void navigate({ to: "/printen", search: { ...zoek, paginas: p } });
              }}
            >
              <SelectTrigger className="h-8 w-[88px] text-xs">
                <SelectValue placeholder="A4's" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 A4</SelectItem>
                <SelectItem value="2">2 A4</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(kolommen)}
              onValueChange={(v) => {
                const k = Number(v) as 2 | 3 | 4 | 5;
                void navigate({ to: "/printen", search: { ...zoek, kolommen: k } });
              }}
            >
              <SelectTrigger className="h-8 w-[92px] text-xs">
                <SelectValue placeholder="Kolommen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 kol.</SelectItem>
                <SelectItem value="3">3 kol.</SelectItem>
                <SelectItem value="4">4 kol.</SelectItem>
                <SelectItem value="5">5 kol.</SelectItem>
              </SelectContent>
            </Select>

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
          <div
            ref={kopRef}
            className="mb-1 flex items-baseline justify-between border-b-2 border-foreground pb-[1px]"
          >
            <h1 className="text-[13px] font-bold uppercase tracking-wide">
              Waslijst {actieveWijk ? `${actieveWijk.name} ` : ""}—{" "}
              {maand === "alles" ? "alle klanten" : `${maand} maand`}
            </h1>

            {prijzen && <span className="text-[11px] tabular-nums">Totaal {formatPrice(totaal)}</span>}
          </div>

          {vouwen ? (
            <div className="grid grid-cols-2">
              {kwarten.map((kwart, i) => (
                <div
                  key={i}
                  className={`overflow-hidden px-[1mm] pb-[1mm] ${i % 2 === 0 ? "border-r border-dashed border-foreground/40" : ""} ${i < 2 ? "border-b border-dashed border-foreground/40" : ""}`}
                  style={{ height: kwartHoogte }}
                >
                  <div
                    ref={(el) => {
                      kwartRefs.current[i] = el;
                    }}
                    className="h-full overflow-hidden"
                  >
                    <div style={{ columnCount: kwartKolommen, columnGap: "1mm" }} className="[column-fill:_balance]">
                      {kwart.map((g) => (
                        <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ columnCount: kolommen, columnGap: "1mm" }} className="[column-fill:_balance]">

              {groepen.map((g) => (
                <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
