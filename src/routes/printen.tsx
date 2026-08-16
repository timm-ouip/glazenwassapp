import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  /** Handmatige tekstgrootte in % bovenop het automatisch passend maken. */
  grootte?: number;
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
    grootte: Math.min(300, Math.max(50, Math.round(Number(search["grootte"]) || 100))),
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
  smal = false,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
  /** Te weinig breedte voor twee kanten naast elkaar: onder elkaar zetten. */
  smal?: boolean;
}) {
  const kanten = ([
    g.even.length > 0 ? "even" : null,
    g.oneven.length > 0 ? "oneven" : null,
  ].filter(Boolean) as ("even" | "oneven")[]);
  const naast = kanten.length === 2 && !smal;
  // Kolombreedtes in procenten: zo houdt de notitie altijd genoeg ruimte en
  // kunnen prijs/frequentie nooit over de tekst heen vallen.
  const nrPct = 16;
  const freqPct = maand === "alles" ? 16 : 0;
  const prijsPct = prijzen ? 20 : 0;
  const notePct = 100 - nrPct - freqPct - prijsPct;

  return (
    <div className="-mt-px break-inside-avoid border border-foreground/70">
      <h2 className="border-b border-foreground/70 bg-muted px-1 text-[9px] font-bold uppercase leading-[1.15] tracking-wide">
        {g.street.name}
      </h2>
      <div className={naast ? "grid grid-cols-2" : "grid grid-cols-1"}>
        {kanten.map((kant, i, arr) => (
          <table
            key={kant}
            className={`w-full table-fixed border-collapse ${
              i < arr.length - 1
                ? naast
                  ? "border-r border-foreground/40"
                  : "border-b border-foreground/40"
                : ""
            }`}
          >
            <colgroup>
              <col style={{ width: `${nrPct}%` }} />
              <col style={{ width: `${notePct}%` }} />
              {maand === "alles" && <col style={{ width: `${freqPct}%` }} />}
              {prijzen && <col style={{ width: `${prijsPct}%` }} />}
            </colgroup>
            <tbody>
              {g[kant].map((c) => (
                <tr key={c.id} className="border-b border-foreground/20 align-top last:border-0">
                  <td className="px-[2px] text-[8.5px] font-semibold leading-[1.1] tabular-nums whitespace-nowrap">
                    {formatNumber(c)}
                  </td>
                  <td className="px-[2px] text-[8.5px] leading-[1.1] break-words hyphens-auto">{c.note}</td>
                  {maand === "alles" && (
                    <td className="px-[2px] text-[8.5px] leading-[1.1] whitespace-nowrap">{c.frequency}</td>
                  )}
                  {prijzen && (
                    <td
                      className={`px-[2px] text-right text-[8.5px] leading-[1.1] tabular-nums whitespace-nowrap ${c.price === 0 ? "text-red-600" : ""}`}
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
  smal = false,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
  smal?: boolean;
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
      <StraatBlok g={g} prijzen={prijzen} maand={maand} smal={smal} />

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


const MAX_SCHAAL = 3;
const MIN_SCHAAL = 0.25;

function PrintPagina() {
  const {
    wijk,
    maand,
    prijzen,
    liggend,
    kolommen,
    paginas: paginasRaw,
    vouwen: vouwenRaw,
    grootte: grootteRaw,
  } = Route.useSearch();

  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const vouwen = vouwenRaw === true;
  const paginas = vouwen ? 1 : paginasRaw === 2 ? 2 : 1;
  const grootte = Math.min(300, Math.max(50, grootteRaw ?? 100));
  // In vouwmodus moet alles binnen de vier kwarten blijven; daar geldt de
  // automatische schaal en heeft handmatig vergroten geen zin.
  const f = vouwen ? 1 : grootte / 100;

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
  const [indelingKlaar, setIndelingKlaar] = useState(false);
  const stappen = useRef(0);
  const plafond = useRef(MAX_SCHAAL);

  const sleutel = `${wijk}|${maand}|${prijzen}|${liggend}|${kolommen}|${paginas}|${vouwen}|${grootte}|${groepen.length}`;
  // Werkelijke zoomfactor: automatische pasvorm × handmatige tekstgrootte.
  const eff = schaal * f;


  useLayoutEffect(() => {
    setIndelingKlaar(false);
    setSchaal(1);
    stappen.current = 0;
    plafond.current = MAX_SCHAAL;
  }, [sleutel]);

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
        nieuw[g.street.id] = el.getBoundingClientRect().height / (eff || 1);
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
  }, [meetSleutel, eff, kolommen, vouwen, breedtePx, prijzen, maand]);



  const kwartKolommen = Math.max(1, Math.round(kolommen / 2));
  const schatting = (g: Groep) => 14 + 11 * Math.max(g.even.length, g.oneven.length);
  const blokHoogte = (g: Groep) => hoogtes[g.street.id] ?? schatting(g);
  // hoogte per kwart, in niet-geschaalde px (titelbalk wordt gemeten)
  const kwartHoogte = Math.floor((hoogtePx / eff - kopHoogte - 10) / 2);
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
  const kolomBreedte = breedtePx / eff / (vouwen ? 2 * kwartKolommen : kolommen);
  const meetBreedte = Math.round(kolomBreedte) - 6;
  // Te smal voor even/oneven naast elkaar? Dan onder elkaar, anders krijg je
  // één letter per regel of tekst die tegen de prijs aan loopt.
  const nodigPerKant = 52 + (prijzen ? 34 : 0) + (maand === "alles" ? 26 : 0);
  const smal = meetBreedte < 2 * nodigPerKant;


  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (stappen.current > 18) {
        setIndelingKlaar(true);
        return;
      }
      if (vouwen) {
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
        return;
      }

      const node = inhoudRef.current;
      if (!node) return;
      const gerenderd = node.getBoundingClientRect().height;
      if (gerenderd <= 0) return;
      // gerenderd is gemeten op zoom = schaal * f; corrigeer daarvoor zodat de
      // handmatige tekstgrootte niet meteen wordt weggeschaald.
      const gewenst = Math.min(
        MAX_SCHAAL,
        Math.max(MIN_SCHAAL, (schaal * maxHoogtePx * f) / gerenderd),
      );
      if (Math.abs(gewenst - schaal) > 0.006) {
        stappen.current += 1;
        setSchaal(gewenst);
      } else {
        setIndelingKlaar(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [schaal, kopHoogte, maxHoogtePx, hoogtes, sleutel, vouwen, capMin, hoogtePx, f]);




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

  async function onDragEnd(e: DragEndEvent) {
    setSleepId(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const nieuweVolgorde = [...(sleepVolgorde ?? huidigeVolgorde())];
    setSleepVolgorde(null);
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
              ) : (
                <div style={{ columnCount: kolommen, columnGap: "1mm" }} className="[column-fill:_balance]">
                  {groepen.map((g) =>
                    indelingKlaar ? (
                      <SleepbaarBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                    ) : (
                      <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                    ),
                  )}
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
