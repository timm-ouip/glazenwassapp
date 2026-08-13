import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, GripVertical, Printer } from "lucide-react";
import { pushUndo } from "@/lib/undo";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  persistStreetOrder,
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

/** Straatblok met sleepgreep (greep alleen op het scherm zichtbaar). */
function SleepbaarBlok({
  g,
  prijzen,
  maand,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: g.street.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative break-inside-avoid ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Sleep ${g.street.name}`}
        className="absolute right-0 top-0 z-10 cursor-grab rounded-bl bg-background/80 p-[1px] text-muted-foreground hover:text-foreground active:cursor-grabbing print:hidden"
      >
        <GripVertical className="size-3" />
      </button>
      <StraatBlok g={g} prijzen={prijzen} maand={maand} />
    </div>
  );
}

/**
 * Verdeelt de straten in `k` blokken op basis van gemeten hoogtes, met behoud
 * van de routevolgorde. Binair zoeken naar de kleinst mogelijke blokhoogte.
 */
function verdeelInBlokken(groepen: Groep[], hoogte: (g: Groep) => number, k = 4): Groep[][] {
  if (groepen.length === 0) return Array.from({ length: k }, () => []);
  const h = groepen.map(hoogte);
  const totaal = h.reduce((s, x) => s + x, 0);

  const past = (cap: number) => {
    let bins = 1;
    let som = 0;
    for (const x of h) {
      if (som + x > cap && som > 0) {
        bins += 1;
        som = 0;
      }
      som += x;
    }
    return bins <= k;
  };

  let laag = Math.max(...h);
  let hoog = Math.max(totaal, laag);
  for (let i = 0; i < 40; i++) {
    const mid = (laag + hoog) / 2;
    if (past(mid)) hoog = mid;
    else laag = mid;
  }

  const cap = hoog;
  const blokken: Groep[][] = Array.from({ length: k }, () => []);
  let i = 0;
  let som = 0;
  groepen.forEach((g, idx) => {
    const x = h[idx]!;
    if (i < k - 1 && som > 0 && som + x > cap) {
      i += 1;
      som = 0;
    }
    blokken[i]!.push(g);
    som += x;
  });
  return blokken;
}

const MAX_SCHAAL = 1.6;
const MIN_SCHAAL = 0.25;

function PrintPagina() {
  const { wijk, maand, prijzen, liggend, kolommen, paginas: paginasRaw, vouwen: vouwenRaw } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const vouwen = vouwenRaw === true;
  const paginas = vouwen ? 1 : paginasRaw === 2 ? 2 : 1;
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const districts = districtsQuery.data ?? [];
  const actieveWijk = districts.find((d) => d.id === wijk) ?? districts[0] ?? null;
  const alleStreets = streetsQuery.data ?? [];
  const streets = alleStreets.filter((s) => !actieveWijk || s.district_id === actieveWijk.id);
  const customers = customersQuery.data ?? [];

  // Live volgorde tijdens het slepen (ids van straten in deze wijk).
  const [sleepVolgorde, setSleepVolgorde] = useState<string[] | null>(null);
  const [sleepId, setSleepId] = useState<string | null>(null);

  const zichtbaar = streets
    .map((s) => {
      const klanten = customers.filter((c) => c.street_id === s.id && matchesMaand(c.frequency, maand));
      return { street: s, ...splitEvenOdd(klanten, s.sort_desc ? "desc" : "asc"), aantal: klanten.length };
    })
    .filter((g) => g.aantal > 0);

  const groepen: Groep[] = sleepVolgorde
    ? (sleepVolgorde
        .map((id) => zichtbaar.find((g) => g.street.id === id))
        .filter(Boolean) as Groep[])
    : zichtbaar;

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
  const meetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [schaal, setSchaal] = useState(1);
  const [kopHoogte, setKopHoogte] = useState(26);
  const [hoogtes, setHoogtes] = useState<Record<string, number>>({});
  const stappen = useRef(0);

  const sleutel = `${wijk}|${maand}|${prijzen}|${liggend}|${kolommen}|${paginas}|${vouwen}|${groepen.length}`;

  useLayoutEffect(() => {
    setSchaal(1);
    stappen.current = 0;
  }, [sleutel]);

  // Meet de hoogte van elk straatblok op kolombreedte.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const nieuw: Record<string, number> = {};
      let anders = false;
      for (const g of groepen) {
        const el = meetRefs.current[g.street.id];
        if (!el) continue;
        const h = el.getBoundingClientRect().height;
        nieuw[g.street.id] = h;
        if (Math.abs((hoogtes[g.street.id] ?? 0) - h) > 0.5) anders = true;
      }
      if (anders || Object.keys(nieuw).length !== Object.keys(hoogtes).length) setHoogtes(nieuw);
    });
    return () => cancelAnimationFrame(id);
  }, [groepen, hoogtes]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (stappen.current > 14) return;
      if (vouwen) {
        const kop = kopRef.current;
        if (kop) {
          const h = Math.ceil(kop.getBoundingClientRect().height / schaal);
          if (h > 0 && Math.abs(h - kopHoogte) > 1) setKopHoogte(h);
        }
        let ratio = 0;
        for (const el of kwartRefs.current) {
          if (!el || !el.parentElement) continue;
          const beschikbaar = el.parentElement.getBoundingClientRect().height;
          if (beschikbaar <= 0) continue;
          ratio = Math.max(ratio, el.getBoundingClientRect().height / beschikbaar);
        }
        if (ratio <= 0) return;
        const gewenst = Math.min(MAX_SCHAAL, Math.max(MIN_SCHAAL, schaal / ratio));
        if (Math.abs(gewenst - schaal) > 0.006) {
          stappen.current += 1;
          setSchaal(gewenst);
        }
        return;
      }

      const node = inhoudRef.current;
      if (!node) return;
      const gerenderd = node.getBoundingClientRect().height;
      if (gerenderd <= 0) return;
      const gewenst = Math.min(MAX_SCHAAL, Math.max(MIN_SCHAAL, (schaal * maxHoogtePx) / gerenderd));
      if (Math.abs(gewenst - schaal) > 0.006) {
        stappen.current += 1;
        setSchaal(gewenst);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [schaal, kopHoogte, maxHoogtePx, hoogtes, sleutel, vouwen]);

  const kwartKolommen = Math.max(1, Math.round(kolommen / 2));
  const schatting = (g: Groep) => 14 + 11 * Math.max(g.even.length, g.oneven.length);
  const kwarten = vouwen
    ? verdeelInBlokken(groepen, (g) => hoogtes[g.street.id] ?? schatting(g), 4)
    : [];
  // hoogte per kwart, in niet-geschaalde px (titelbalk wordt gemeten)
  const kwartHoogte = Math.floor((hoogtePx / schaal - kopHoogte - 10) / 2);
  const meetBreedte = Math.round(breedtePx / schaal / (vouwen ? 2 * kwartKolommen : kolommen)) - 6;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function huidigeVolgorde() {
    return groepen.map((g) => g.street.id);
  }

  function onDragStart(e: DragStartEvent) {
    setSleepId(String(e.active.id));
    setSleepVolgorde(huidigeVolgorde());
  }

  function onDragOver(e: DragOverEvent) {
    const overId = e.over ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || overId === activeId) return;
    setSleepVolgorde((huidig) => {
      const lijst = huidig ?? huidigeVolgorde();
      const from = lijst.indexOf(activeId);
      const to = lijst.indexOf(overId);
      if (from < 0 || to < 0) return lijst;
      const next = [...lijst];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    setSleepId(null);
    const nieuweVolgorde = sleepVolgorde;
    setSleepVolgorde(null);
    if (!nieuweVolgorde || !e.over) return;

    const vorige = alleStreets.map((s) => ({ ...s }));
    const gesorteerd = nieuweVolgorde
      .map((id) => alleStreets.find((s) => s.id === id))
      .filter(Boolean) as Street[];
    if (gesorteerd.length === 0) return;
    // Ongewijzigd? niets doen.
    const oudeVolgorde = zichtbaar.map((g) => g.street.id).join(",");
    if (oudeVolgorde === nieuweVolgorde.join(",")) return;

    // Straten buiten deze selectie behouden hun plek t.o.v. de rest.
    const gesorteerdIds = new Set(gesorteerd.map((s) => s.id));
    const rest = alleStreets.filter((s) => !gesorteerdIds.has(s.id));
    const compleet = [...gesorteerd, ...rest];

    qc.setQueryData<Street[]>(
      ["streets"],
      compleet.map((s, i) => ({ ...s, sort_order: i + 1 })),
    );
    await persistStreetOrder(compleet);
    pushUndo({
      label: "Straatvolgorde",
      undo: async () => {
        await persistStreetOrder(vorige);
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["streets"] });
  }

  const zoek = { wijk, maand, prijzen, liggend, kolommen, paginas, vouwen };
  const sleepGroep = groepen.find((g) => g.street.id === sleepId) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <style>{`@page { size: A4 ${liggend ? "landscape" : "portrait"}; margin: 8mm; }
@media print { html, body { background: #fff; } main { overflow: hidden; } }`}</style>

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={() => {
            setSleepId(null);
            setSleepVolgorde(null);
          }}
        >
          <SortableContext items={groepen.map((g) => g.street.id)} strategy={rectSortingStrategy}>
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
                      >
                        <div
                          style={{ columnCount: kwartKolommen, columnGap: "1mm" }}
                          className="[column-fill:_balance]"
                        >
                          {kwart.map((g) => (
                            <SleepbaarBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ columnCount: kolommen, columnGap: "1mm" }} className="[column-fill:_balance]">
                  {groepen.map((g) => (
                    <SleepbaarBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                  ))}
                </div>
              )}

              {/* verborgen meetlaag: bepaalt de echte hoogte per straat */}
              <div
                aria-hidden
                className="pointer-events-none invisible absolute -left-[9999px] top-0"
                style={{ width: meetBreedte }}
              >
                {groepen.map((g) => (
                  <div
                    key={g.street.id}
                    ref={(el) => {
                      meetRefs.current[g.street.id] = el;
                    }}
                  >
                    <StraatBlok g={g} prijzen={prijzen} maand={maand} />
                  </div>
                ))}
              </div>
            </div>
          </SortableContext>
          <DragOverlay>
            {sleepGroep ? (
              <div className="w-[200px] rounded bg-card px-2 py-1 text-xs font-semibold shadow-lg">
                {sleepGroep.street.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
}
