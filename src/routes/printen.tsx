import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AccountMenu } from "@/components/AccountMenu";
import { ArrowLeft, GripVertical, LayoutGrid, Printer } from "lucide-react";
import { pushUndo } from "@/lib/undo";
import { requireSession, useRequireAuth } from "@/lib/auth";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  persistPrintPosities,
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
  vouwen?: boolean;
}

export const Route = createFileRoute("/printen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): PrintSearch => ({
    wijk: typeof search["wijk"] === "string" ? search["wijk"] : "",
    maand:
      search["maand"] === "oneven" ? "oneven" : search["maand"] === "alles" ? "alles" : "even",
    prijzen: search["prijzen"] === true || search["prijzen"] === "true",
    liggend: search["liggend"] !== false && search["liggend"] !== "false",
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
  sleepHandle,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
  sleepHandle?: ReactNode;
}) {
  return (
    <div className="-mt-px break-inside-avoid border border-foreground/70">
      <h2 className="flex items-center justify-between gap-1 border-b border-foreground/70 bg-muted py-px pl-1 pr-px text-[9px] font-bold uppercase leading-[1.15] tracking-wide">
        <span className="truncate">{g.street.name}</span>
        {sleepHandle}
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
                  <td className="w-6 px-[2px] text-[9px] font-semibold leading-[1.1] tabular-nums">
                    {formatNumber(c)}
                  </td>
                  <td className="px-[2px] text-[9px] leading-[1.1] break-words hyphens-auto">{c.note}</td>
                  {maand === "alles" && (
                    <td className="w-8 px-[2px] text-[9px] leading-[1.1]">{c.frequency}</td>
                  )}
                  {prijzen && (
                    <td
                      className={`w-10 px-[2px] text-right text-[9px] leading-[1.1] tabular-nums ${c.price === 0 ? "text-red-600" : ""}`}
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
  const { attributes, listeners, setNodeRef: setSleepRef, transform, isDragging } = useDraggable({
    id: g.street.id,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: g.street.id,
    // De printindeling meet en schaalt zichzelf. Een ResizeObserver per straat
    // zou daardoor alle dropzones tijdens elke schaalstap opnieuw registreren.
    resizeObserverConfig: { disabled: true },
  });
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setSleepRef(node);
      setDropRef(node);
    },
    [setSleepRef, setDropRef],
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`break-inside-avoid ${isDragging ? "z-10 opacity-40" : ""}`}
    >
      <StraatBlok
        g={g}
        prijzen={prijzen}
        maand={maand}
        sleepHandle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sleep ${g.street.name}`}
            className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground active:cursor-grabbing print:hidden"
          >
            <GripVertical className="size-3" />
          </button>
        }
      />
    </div>
  );
}

/** Aantal kolommen dat nodig is als je elke kolom tot `cap` volstopt. */
function kolommenNodig(h: number[], cap: number): number {
  let kolommen = 1;
  let som = 0;
  for (const x of h) {
    if (som > 0 && som + x > cap) {
      kolommen += 1;
      som = 0;
    }
    som += x;
  }
  return kolommen;
}

/** Kleinste kolomhoogte waarbij alles nog in `k` kolommen past. */
function minCapaciteit(h: number[], k: number): number {
  if (h.length === 0) return 1;
  let laag = Math.max(...h);
  let hoog = Math.max(
    h.reduce((s, x) => s + x, 0),
    laag,
  );
  for (let i = 0; i < 40; i++) {
    const mid = (laag + hoog) / 2;
    if (kolommenNodig(h, mid) <= k) hoog = mid;
    else laag = mid;
  }
  return hoog;
}

/**
 * Vult kolommen tot `cap` vol (routevolgorde blijft behouden); wat niet meer
 * past schuift door naar de volgende kolom. Overloop komt in de laatste kolom.
 */
function verdeelVullend(groepen: Groep[], hoogte: (g: Groep) => number, cap: number, k: number): Groep[][] {
  const blokken: Groep[][] = Array.from({ length: k }, () => []);
  let i = 0;
  let som = 0;
  for (const g of groepen) {
    const x = hoogte(g);
    if (i < k - 1 && som > 0 && som + x > cap) {
      i += 1;
      som = 0;
    }
    blokken[i]!.push(g);
    som += x;
  }
  return blokken;
}


const MAX_SCHAAL = 1.6;
const MIN_SCHAAL = 0.25;
const KOLOMMEN = 6;
/** Hoogte (px) van één rasterrij bij het vrij slepen — straatblokken klikken hierop vast. */
const RIJ_EENHEID = 11;

type Positie = { col: number; row: number };

function PrintPagina() {
  useRequireAuth();
  const { wijk, maand, prijzen, liggend, vouwen: vouwenRaw } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const vouwen = vouwenRaw === true;
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

  // --- A4-afmetingen; vaste lettergrootte (geen automatisch schalen meer) ---
  const MM = 96 / 25.4;
  const paginaB = (liggend ? 297 : 210) - 16;
  const paginaH = (liggend ? 210 : 297) - 16;
  const breedtePx = Math.round(paginaB * MM);
  const hoogtePx = Math.round(paginaH * MM);

  const inhoudRef = useRef<HTMLDivElement>(null);
  const kopRef = useRef<HTMLDivElement>(null);
  const kwartRefs = useRef<(HTMLDivElement | null)[]>([]);
  const meetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [schaal, setSchaal] = useState(1);
  const [kopHoogte, setKopHoogte] = useState(26);
  const [hoogtes, setHoogtes] = useState<Record<string, number>>({});
  const [indelingKlaar, setIndelingKlaar] = useState(false);
  const stappen = useRef(0);
  const plafond = useRef(MAX_SCHAAL);

  const sleutel = `${wijk}|${maand}|${prijzen}|${liggend}|${vouwen}|${groepen.length}`;

  useLayoutEffect(() => {
    setIndelingKlaar(vouwen ? false : true);
    setSchaal(1);
    stappen.current = 0;
    plafond.current = MAX_SCHAAL;
  }, [sleutel, vouwen]);

  // Meet de hoogte van elk straatblok op kolombreedte.
  const meetSleutel = groepen
    .map((g) => `${g.street.id}:${g.even.length}:${g.oneven.length}`)
    .sort()
    .join("|");

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const nieuw: Record<string, number> = {};
      for (const g of groepen) {
        const el = meetRefs.current[g.street.id];
        if (!el) continue;
        nieuw[g.street.id] = el.getBoundingClientRect().height / (schaal || 1);
      }
      setHoogtes((oud) => {
        const sleutels = Object.keys(nieuw);
        if (
          sleutels.length === Object.keys(oud).length &&
          sleutels.every((k) => Math.abs((oud[k] ?? -1) - (nieuw[k] ?? 0)) <= 1)
        ) {
          return oud;
        }
        return nieuw;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [meetSleutel, schaal, vouwen, breedtePx]);



  const kwartKolommen = Math.max(1, Math.round(KOLOMMEN / 2));
  const schatting = (g: Groep) => 14 + 11 * Math.max(g.even.length, g.oneven.length);
  const blokHoogte = (g: Groep) => hoogtes[g.street.id] ?? schatting(g);
  // hoogte per kwart, in niet-geschaalde px (titelbalk wordt gemeten)
  const kwartHoogte = Math.floor((hoogtePx / schaal - kopHoogte - 10) / 2);
  const kolomCap = Math.max(20, kwartHoogte - 4);
  const totaalKolommen = 4 * kwartKolommen;
  // Vul elke kolom tot aan de vouwlijn; overloop schuift door naar rechts.
  const kolomBlokken = vouwen
    ? verdeelVullend(groepen, blokHoogte, kolomCap, totaalKolommen)
    : [];
  const kwarten = vouwen
    ? Array.from({ length: 4 }, (_, i) =>
        kolomBlokken.slice(i * kwartKolommen, (i + 1) * kwartKolommen).flat(),
      )
    : [];
  // Kleinst mogelijke kolomhoogte waarbij alles nog past -> grootste schaal.
  const capMin = vouwen ? minCapaciteit(groepen.map(blokHoogte), totaalKolommen) : 0;
  const meetBreedte = Math.round(breedtePx / schaal / (vouwen ? 2 * kwartKolommen : KOLOMMEN)) - 6;

  // Buiten vouwmodus staat de lettergrootte vast en is er niets te schalen;
  // alleen "Vouwen in 4" moet zich naar een vast vouwvak persen.
  useEffect(() => {
    if (!vouwen) return;
    const id = requestAnimationFrame(() => {
      if (stappen.current > 18) {
        setIndelingKlaar(true);
        return;
      }
      const kop = kopRef.current;
      if (kop) {
        const h = Math.ceil(kop.getBoundingClientRect().height / schaal);
        if (h > 0 && Math.abs(h - kopHoogte) > 1) {
          setKopHoogte(h);
          return;
        }
      }
      if (capMin <= 0) return;

      // Schaal waarbij de kolomhoogte exact gelijk wordt aan de minimale
      // benodigde hoogte: kwartHoogte(schaal) == capMin.
      let gewenst = hoogtePx / (2 * (capMin * 1.04 + 4) + kopHoogte + 10);
      // Veiligheidscheck: loopt een kwart in de praktijk toch over (extra
      // kolom buiten beeld), dan een tandje kleiner en dit als plafond
      // onthouden, zodat we niet heen en weer blijven springen.
      let over = 1;
      for (const el of kwartRefs.current) {
        if (!el || el.clientWidth <= 0) continue;
        over = Math.max(over, el.scrollWidth / el.clientWidth);
      }
      if (over > 1.02) plafond.current = Math.min(plafond.current, schaal * 0.96);
      gewenst = Math.min(gewenst, plafond.current);

      gewenst = Math.min(MAX_SCHAAL, Math.max(MIN_SCHAAL, gewenst));
      if (Math.abs(gewenst - schaal) > 0.008) {
        stappen.current += 1;
        setSchaal(gewenst);
      } else {
        setIndelingKlaar(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [schaal, kopHoogte, sleutel, vouwen, capMin, hoogtePx]);

  // Buiten vouwmodus: verdeel de straten (zoals gemeten in de meetlaag)
  // over zoveel volle A4-pagina's van vaste KOLOMMEN kolommen als nodig.
  const printCap = Math.max(20, hoogtePx - kopHoogte - 10);
  const printHoogtes = groepen.map(blokHoogte);
  const printKolommenNodig = vouwen ? 0 : kolommenNodig(printHoogtes, printCap);
  const printPaginasNodig = vouwen ? 0 : Math.max(1, Math.ceil(printKolommenNodig / KOLOMMEN));
  const printTotaalSlots = printPaginasNodig * KOLOMMEN;
  // Een kolomhoogte-cap die precies alle straten evenredig over alle
  // beschikbare kolommen verspreidt (i.p.v. te stoppen zodra het past,
  // wat de laatste kolommen leeg zou laten).
  const printTightCap =
    !vouwen && printHoogtes.length > 0 ? minCapaciteit(printHoogtes, printTotaalSlots) : printCap;
  const printKolomBlokken = vouwen
    ? []
    : verdeelVullend(groepen, blokHoogte, printTightCap, printTotaalSlots);
  const printPaginas = vouwen
    ? []
    : Array.from({ length: printPaginasNodig }, (_, i) =>
        printKolomBlokken.slice(i * KOLOMMEN, (i + 1) * KOLOMMEN),
      );

  // Rasterpositie (kolom/rij) waarop elk blok zou staan als het nog nooit
  // met de hand versleept is — dient als startpunt zodra je gaat slepen.
  const rijSpan = (g: Groep) => Math.max(1, Math.ceil(blokHoogte(g) / RIJ_EENHEID));
  const rijenPerPagina = Math.max(1, Math.round(hoogtePx / RIJ_EENHEID));
  const seedPosities: Record<string, Positie> = {};
  if (!vouwen) {
    printKolomBlokken.forEach((kolom, slot) => {
      const col = slot % KOLOMMEN;
      const pagina = Math.floor(slot / KOLOMMEN);
      let rij = pagina * rijenPerPagina;
      for (const g of kolom) {
        seedPosities[g.street.id] = { col, row: rij };
        rij += rijSpan(g);
      }
    });
  }
  const effectievePositie = (s: Street): Positie =>
    s.print_col != null && s.print_row != null
      ? { col: s.print_col, row: s.print_row }
      : (seedPosities[s.id] ?? { col: 0, row: 0 });
  const vrijeIndeling = !vouwen && groepen.length > 0 && groepen.every((g) => g.street.print_col != null && g.street.print_row != null);



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

  /** "Vouwen in 4": straten wisselen van plek in de lijst (bestaand gedrag). */
  async function onDragEndVouwen(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const nieuweVolgorde = [...(sleepVolgorde ?? huidigeVolgorde())];
    if (!overId || overId === activeId) return;
    const van = nieuweVolgorde.indexOf(activeId);
    const naar = nieuweVolgorde.indexOf(overId);
    if (van < 0 || naar < 0) return;
    const [verplaatst] = nieuweVolgorde.splice(van, 1);
    if (!verplaatst) return;
    nieuweVolgorde.splice(naar, 0, verplaatst);

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

  /**
   * Normale weergave: straat verplaatst naar een vrije rastercel (kolom/rij),
   * los van de andere straten. Bij de eerste keer slepen wordt de huidige
   * (automatische) indeling van de hele wijk "bevroren" naar vaste posities.
   */
  async function onDragEndVrij(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const kolomBreedte = breedtePx / KOLOMMEN;
    const deltaCol = Math.round(e.delta.x / kolomBreedte);
    const deltaRow = Math.round(e.delta.y / RIJ_EENHEID);
    if (deltaCol === 0 && deltaRow === 0) return;

    const vorige = alleStreets.map((s) => ({ ...s }));
    const updates = groepen.map((g) => {
      const pos = effectievePositie(g.street);
      if (g.street.id === activeId) {
        return {
          id: g.street.id,
          print_col: Math.min(KOLOMMEN - 1, Math.max(0, pos.col + deltaCol)),
          print_row: Math.max(0, pos.row + deltaRow),
        };
      }
      return { id: g.street.id, print_col: pos.col, print_row: pos.row };
    });

    qc.setQueryData<Street[]>(
      ["streets"],
      alleStreets.map((s) => {
        const u = updates.find((u) => u.id === s.id);
        return u ? { ...s, print_col: u.print_col, print_row: u.print_row } : s;
      }),
    );
    await persistPrintPosities(updates);
    pushUndo({
      label: "Straat verplaatst",
      undo: async () => {
        await persistPrintPosities(
          updates.map((u) => {
            const orig = vorige.find((s) => s.id === u.id)!;
            return { id: u.id, print_col: orig.print_col, print_row: orig.print_row };
          }),
        );
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["streets"] });
  }

  async function onDragEnd(e: DragEndEvent) {
    setSleepId(null);
    setSleepVolgorde(null);
    if (vouwen) await onDragEndVouwen(e);
    else await onDragEndVrij(e);
  }

  async function indelingResetten() {
    const ids = groepen.map((g) => g.street.id);
    const vorige = alleStreets.map((s) => ({ ...s }));
    qc.setQueryData<Street[]>(
      ["streets"],
      alleStreets.map((s) => (ids.includes(s.id) ? { ...s, print_col: null, print_row: null } : s)),
    );
    await persistPrintPosities(ids.map((id) => ({ id, print_col: null, print_row: null })));
    pushUndo({
      label: "Indeling teruggezet",
      undo: async () => {
        await persistPrintPosities(
          vorige
            .filter((s) => ids.includes(s.id))
            .map((s) => ({ id: s.id, print_col: s.print_col, print_row: s.print_row })),
        );
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["streets"] });
  }

  const zoek = { wijk, maand, prijzen, liggend, vouwen };
  const sleepGroep = groepen.find((g) => g.street.id === sleepId) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <style>{`@page { size: A4 ${liggend ? "landscape" : "portrait"}; margin: 8mm; }
@media print { html, body { background: #fff; } main { overflow: hidden; } }`}</style>

      <div className="border-b border-border bg-card print:hidden">
        <div className="mx-auto max-w-[1600px] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" asChild>
              <Link to="/" search={{ wijk }}>
                <ArrowLeft className="size-4" /> Terug
              </Link>
            </Button>
            <div className="mr-auto min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-foreground">Printlijst</h1>
              <p className="text-xs text-muted-foreground">
                {actieveWijk ? actieveWijk.name : "Alle wijken"} · {groepen.length} straten
              </p>
            </div>
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => window.print()}>
              <Printer className="size-4" /> Afdrukken
            </Button>
            <span className="print:hidden">
              <AccountMenu />
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-card">
              {(["alles", "even", "oneven"] as const).map((f) => (
                <Link
                  key={f}
                  to="/printen"
                  search={{ ...zoek, maand: f }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    maand === f
                      ? "bg-brand text-brand-foreground shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "alles" ? "Alle klanten" : f === "even" ? "Even maand" : "Oneven maand"}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="liggend"
                checked={liggend}
                onCheckedChange={(v) => void navigate({ to: "/printen", search: { ...zoek, liggend: v } })}
              />
              <Label htmlFor="liggend" className="text-sm text-muted-foreground">
                Liggend
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="prijzen"
                checked={prijzen}
                onCheckedChange={(v) => void navigate({ to: "/printen", search: { ...zoek, prijzen: v } })}
              />
              <Label htmlFor="prijzen" className="text-sm text-muted-foreground">
                Prijzen
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="vouwen"
                checked={vouwen}
                onCheckedChange={(v) => void navigate({ to: "/printen", search: { ...zoek, vouwen: v } })}
              />
              <Label htmlFor="vouwen" className="text-sm text-muted-foreground">
                Vouwen in 4
              </Label>
            </div>

            {vrijeIndeling && (
              <Button size="sm" variant="outline" onClick={() => void indelingResetten()}>
                <LayoutGrid className="size-4" /> Automatisch indelen
              </Button>
            )}
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
          onDragEnd={(e) => void onDragEnd(e)}
          onDragCancel={() => {
            setSleepId(null);
            setSleepVolgorde(null);
          }}
        >
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
                        style={{ columnCount: kwartKolommen, columnGap: "1mm", height: kolomCap }}
                        className="[column-fill:_auto]"
                      >
                        {kwart.map((g) =>
                          indelingKlaar ? (
                            <SleepbaarBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ) : (
                            <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ),
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              ) : vrijeIndeling ? (
                <div
                  className="grid gap-[1mm]"
                  style={{
                    gridTemplateColumns: `repeat(${KOLOMMEN}, minmax(0, 1fr))`,
                    gridAutoRows: `${RIJ_EENHEID}px`,
                  }}
                >
                  {groepen.map((g) => {
                    const pos = effectievePositie(g.street);
                    return (
                      <div
                        key={g.street.id}
                        style={{ gridColumn: pos.col + 1, gridRow: `${pos.row + 1} / span ${rijSpan(g)}` }}
                      >
                        <SleepbaarBlok g={g} prijzen={prijzen} maand={maand} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                printPaginas.map((paginaKolommen, i) => (
                  <div
                    key={i}
                    className={`grid gap-[1mm] ${i < printPaginas.length - 1 ? "mb-6 break-after-page print:mb-0" : ""}`}
                    style={{ gridTemplateColumns: `repeat(${KOLOMMEN}, minmax(0, 1fr))` }}
                  >
                    {paginaKolommen.map((kolom, k) => (
                      <div key={k}>
                        {kolom.map((g) =>
                          indelingKlaar ? (
                            <SleepbaarBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ) : (
                            <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* verborgen meetlaag: bepaalt de echte hoogte per straat */}
              <div
                aria-hidden
                className="pointer-events-none invisible absolute -left-[9999px] top-0 print:hidden"
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
