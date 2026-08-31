import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AccountMenu } from "@/components/AccountMenu";
import { ArrowLeft, ArrowUpToLine, GripVertical, Printer } from "lucide-react";
import { toast } from "sonner";
import { pushUndo } from "@/lib/undo";
import { requireSession, useRequireAuth } from "@/lib/auth";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  noteVoorMaand,
  persistKolomStart,
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

const StraatBlok = memo(function StraatBlok({
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
        <span className="flex shrink-0 items-center">{sleepHandle}</span>
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
                  <td className="px-[2px] text-[9px] leading-[1.1] break-words hyphens-auto">
                    {noteVoorMaand(c, maand)}
                  </td>
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
});

/** Straatblok met sleepgreep (greep alleen op het scherm zichtbaar). */
function SleepbaarBlok({
  g,
  prijzen,
  maand,
  kolomKop,
  onKolomKopUit,
}: {
  g: Groep;
  prijzen: boolean;
  maand: "even" | "oneven" | "alles";
  kolomKop?: boolean;
  onKolomKopUit?: () => void;
}) {
  // Geen CSS-transform: de straten wisselen tijdens het slepen echt van plek
  // in de lijst (zie `bepaalPlek`), zodat de hele indeling meteen meeloopt.
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: g.street.id,
    // De printindeling meet en schaalt zichzelf. Een ResizeObserver per straat
    // zou daardoor alle dropzones tijdens elke schaalstap opnieuw registreren.
    resizeObserverConfig: { disabled: true },
  });

  return (
    <div
      ref={setNodeRef}
      data-straat={g.street.id}
      className={`break-inside-avoid ${isDragging ? "opacity-40" : ""}`}
    >
      <StraatBlok
        g={g}
        prijzen={prijzen}
        maand={maand}
        sleepHandle={
          <>
          {kolomKop && (
            <button
              type="button"
              onClick={onKolomKopUit}
              title="Begint bovenaan een kolom — klik om los te laten"
              aria-label={`${g.street.name} begint bovenaan een kolom`}
              className="shrink-0 rounded p-0.5 text-brand-ink hover:bg-background print:hidden"
            >
              <ArrowUpToLine className="size-3" />
            </button>
          )}
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sleep ${g.street.name}`}
            className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground active:cursor-grabbing print:hidden"
          >
            <GripVertical className="size-3" />
          </button>
          </>
        }
      />
    </div>
  );
}

/** Een hele printkolom als doelgebied: laat je een straat los in de lege
 * ruimte onder de laatste straat, dan hoort hij onderaan die kolom. */
function KolomVak({ slot, children }: { slot: number; children: ReactNode }) {
  return <div data-kolom={slot}>{children}</div>;
}

/** Eén straat zoals de indeling hem ziet: hoe hoog, en of hij een nieuwe
 * kolom afdwingt. */
type Blok = { hoogte: number; breek: boolean };

/** Aantal kolommen dat nodig is als je elke kolom tot `cap` volstopt. */
function kolommenNodig(blokken: Blok[], cap: number): number {
  let kolommen = 1;
  let som = 0;
  for (const b of blokken) {
    if (som > 0 && (b.breek || som + b.hoogte > cap)) {
      kolommen += 1;
      som = 0;
    }
    som += b.hoogte;
  }
  return kolommen;
}

/** Kleinste kolomhoogte waarbij alles nog in `k` kolommen past. */
function minCapaciteit(blokken: Blok[], k: number): number {
  if (blokken.length === 0) return 1;
  const h = blokken.map((b) => b.hoogte);
  let laag = Math.max(...h);
  let hoog = Math.max(
    h.reduce((s, x) => s + x, 0),
    laag,
  );
  for (let i = 0; i < 40; i++) {
    const mid = (laag + hoog) / 2;
    if (kolommenNodig(blokken, mid) <= k) hoog = mid;
    else laag = mid;
  }
  return hoog;
}

/**
 * Vult kolommen tot `cap` vol (routevolgorde blijft behouden); wat niet meer
 * past schuift door naar de volgende kolom. Overloop komt in de laatste kolom.
 */
function verdeelVullend(
  groepen: Groep[],
  meet: (g: Groep) => Blok,
  cap: number,
  k: number,
): Groep[][] {
  const blokken: Groep[][] = Array.from({ length: k }, () => []);
  let i = 0;
  let som = 0;
  for (const g of groepen) {
    const b = meet(g);
    if (i < k - 1 && som > 0 && (b.breek || som + b.hoogte > cap)) {
      i += 1;
      som = 0;
    }
    blokken[i]!.push(g);
    som += b.hoogte;
  }
  return blokken;
}


const MAX_SCHAAL = 1.6;
const MIN_SCHAAL = 0.25;
const KOLOMMEN = 6;
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
  const wijkId = actieveWijk?.id ?? null;
  const streets = useMemo(
    () => alleStreets.filter((s) => !wijkId || s.district_id === wijkId),
    [alleStreets, wijkId],
  );
  const customers = customersQuery.data ?? [];

  // Live volgorde tijdens het slepen (ids van straten in deze wijk).
  const [sleepVolgorde, setSleepVolgorde] = useState<string[] | null>(null);
  const [sleepId, setSleepId] = useState<string | null>(null);
  // Welke straten tijdens het slepen (tijdelijk) wél of juist niet bovenaan
  // een kolom beginnen.
  const [sleepVlaggen, setSleepVlaggen] = useState<Record<string, boolean> | null>(null);

  // Eenmalig groeperen: tijdens het slepen rendert deze pagina vaak, en de
  // klantenlijst per straat opnieuw uitfilteren maakte dat merkbaar traag.
  const zichtbaar = useMemo(() => {
    const perStraat = new Map<string, Customer[]>();
    for (const c of customers) {
      if (!matchesMaand(c.frequency, maand)) continue;
      const rij = perStraat.get(c.street_id);
      if (rij) rij.push(c);
      else perStraat.set(c.street_id, [c]);
    }
    return streets
      .map((s) => {
        const klanten = perStraat.get(s.id) ?? [];
        return { street: s, ...splitEvenOdd(klanten, s.sort_desc ? "desc" : "asc"), aantal: klanten.length };
      })
      .filter((g) => g.aantal > 0);
  }, [streets, customers, maand]);

  const groepen: Groep[] = useMemo(() => {
    if (!sleepVolgorde) return zichtbaar;
    const perId = new Map(zichtbaar.map((g) => [g.street.id, g]));
    return sleepVolgorde.map((id) => perId.get(id)).filter(Boolean) as Groep[];
  }, [zichtbaar, sleepVolgorde]);

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
  // Tijdens het slepen tellen de vlaggen zoals ze op dat moment zouden worden.
  const kolomStart = (s: Street) => sleepVlaggen?.[s.id] ?? s.kolom_start;
  const meetBlok = (g: Groep): Blok => ({
    hoogte: blokHoogte(g),
    breek: kolomStart(g.street),
  });
  // hoogte per kwart, in niet-geschaalde px (titelbalk wordt gemeten)
  const kwartHoogte = Math.floor((hoogtePx / schaal - kopHoogte - 10) / 2);
  const kolomCap = Math.max(20, kwartHoogte - 4);
  const totaalKolommen = 4 * kwartKolommen;
  // Vul elke kolom tot aan de vouwlijn; overloop schuift door naar rechts.
  const kolomBlokken = vouwen
    ? verdeelVullend(groepen, meetBlok, kolomCap, totaalKolommen)
    : [];
  const kwarten = vouwen
    ? Array.from({ length: 4 }, (_, i) =>
        kolomBlokken.slice(i * kwartKolommen, (i + 1) * kwartKolommen).flat(),
      )
    : [];
  // Kleinst mogelijke kolomhoogte waarbij alles nog past -> grootste schaal.
  const capMin = vouwen ? minCapaciteit(groepen.map(meetBlok), totaalKolommen) : 0;
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
  const printBlokken = groepen.map(meetBlok);
  const printKolommenNodig = vouwen ? 0 : kolommenNodig(printBlokken, printCap);
  const printPaginasNodig = vouwen ? 0 : Math.max(1, Math.ceil(printKolommenNodig / KOLOMMEN));
  const printTotaalSlots = printPaginasNodig * KOLOMMEN;
  // Een kolomhoogte-cap die precies alle straten evenredig over alle
  // beschikbare kolommen verspreidt (i.p.v. te stoppen zodra het past,
  // wat de laatste kolommen leeg zou laten).
  const printTightCap =
    !vouwen && printBlokken.length > 0 ? minCapaciteit(printBlokken, printTotaalSlots) : printCap;
  const printKolomBlokken = vouwen
    ? []
    : verdeelVullend(groepen, meetBlok, printTightCap, printTotaalSlots);
  const printPaginas = vouwen
    ? []
    : Array.from({ length: printPaginasNodig }, (_, i) =>
        printKolomBlokken.slice(i * KOLOMMEN, (i + 1) * KOLOMMEN),
      );

  // Waar de muis staat tijdens het slepen. dnd-kit meldt alleen een nieuw
  // doel zodra je een ánder blok raakt; schuif je binnen hetzelfde blok van
  // het midden naar de onderste derde, dan kwam er geen enkel signaal. Daarom
  // bepalen we de plek zelf, bij elke muisbeweging.
  const muis = useRef<{ x: number; y: number } | null>(null);
  const plekRef = useRef<(activeId: string, punt: { x: number; y: number }) => void>(() => {});

  useEffect(() => {
    if (!sleepId) return;
    let frame = 0;
    const volg = (e: PointerEvent) => {
      muis.current = { x: e.clientX, y: e.clientY };
      if (frame) return;
      // Hooguit één herberekening per beeldopbouw.
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (muis.current) plekRef.current(sleepId, muis.current);
      });
    };
    window.addEventListener("pointermove", volg);
    return () => {
      window.removeEventListener("pointermove", volg);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sleepId]);

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

  /** Zet `activeId` vlak voor of vlak na `overId` in de sleepvolgorde. */
  function verplaatsNaast(activeId: string, overId: string, ervoor: boolean) {
    setSleepVolgorde((vorig) => {
      const volgorde = vorig ?? huidigeVolgorde();
      const van = volgorde.indexOf(activeId);
      if (van < 0 || !volgorde.includes(overId)) return vorig;
      const nieuw = [...volgorde];
      nieuw.splice(van, 1);
      const doel = nieuw.indexOf(overId);
      if (doel < 0) return vorig;
      nieuw.splice(ervoor ? doel : doel + 1, 0, activeId);
      return nieuw.join(",") === volgorde.join(",") ? vorig : nieuw;
    });
  }

  /** Zet de tijdelijke kolomstart-vlaggen; laat de staat met rust als er
   * niets verandert, anders zou elke muisbeweging opnieuw tekenen. */
  function zetVlaggen(nieuw: Record<string, boolean>) {
    setSleepVlaggen((vorig) => {
      const sleutels = Object.keys(nieuw);
      const gelijk =
        vorig !== null &&
        Object.keys(vorig).length === sleutels.length &&
        sleutels.every((k) => vorig[k] === nieuw[k]);
      return gelijk ? vorig : nieuw;
    });
  }

  /** Schuift de straten al tijdens het slepen op, zodat de indeling meteen
   * meeloopt en het blok op zijn plek "vastklikt".
   *
   * Zweef je over de bovenste derde van een straat, dan kom je erboven; over
   * de onderste derde, dan eronder. Het middenstuk verandert niets: dat is de
   * rustzone die voorkomt dat twee blokken elkaar eindeloos verdringen.
   *
   * Land je boven de bovenste straat van een kolom, dan neem je die kolomkop
   * over: de volgorde alleen kan dat niet uitdrukken, want in de rij stond je
   * daar mogelijk al vlak voor.
   */
  function bepaalPlek(activeId: string, punt: { x: number; y: number }) {
    const raakt = (r: DOMRect) =>
      punt.x >= r.left && punt.x <= r.right && punt.y >= r.top && punt.y <= r.bottom;

    for (const el of document.querySelectorAll<HTMLElement>("[data-straat]")) {
      const r = el.getBoundingClientRect();
      if (!raakt(r)) continue;
      const id = el.dataset["straat"];
      if (!id || id === activeId) return;
      const deel = (punt.y - r.top) / Math.max(1, r.height);
      if (deel > 1 / 3 && deel < 2 / 3) return;
      const ervoor = deel <= 1 / 3;
      const kolom = el.closest("[data-kolom]");
      const isKop = !!kolom && kolom.querySelector("[data-straat]") === el;
      verplaatsNaast(activeId, id, ervoor);
      zetVlaggen(ervoor && isKop ? { [activeId]: true, [id]: false } : { [activeId]: false });
      return;
    }

    // Geen straat onder de muis: dan de lege ruimte onderaan een kolom.
    for (const el of document.querySelectorAll<HTMLElement>("[data-kolom]")) {
      if (!raakt(el.getBoundingClientRect())) continue;
      zetOnderaanKolom(activeId, Number(el.dataset["kolom"]));
      zetVlaggen({ [activeId]: false });
      return;
    }
  }
  plekRef.current = bepaalPlek;

  /** Zet een straat achter de laatste straat van kolom `slot`. Is die kolom
   * (nog) leeg, dan telt de dichtstbijzijnde gevulde kolom ervoor. */
  function zetOnderaanKolom(activeId: string, slot: number) {
    setSleepVolgorde((vorig) => {
      const volgorde = vorig ?? huidigeVolgorde();
      const van = volgorde.indexOf(activeId);
      if (van < 0) return vorig;
      let laatste: string | null = null;
      for (let i = Math.min(slot, printKolomBlokken.length - 1); i >= 0 && !laatste; i--) {
        for (const g of printKolomBlokken[i] ?? []) {
          if (g.street.id !== activeId) laatste = g.street.id;
        }
      }
      if (!laatste) return vorig;
      const naar = volgorde.indexOf(laatste);
      if (naar < 0 || naar === van) return vorig;
      const nieuw = [...volgorde];
      const [verplaatst] = nieuw.splice(van, 1);
      if (!verplaatst) return vorig;
      nieuw.splice((naar < van ? naar : naar - 1) + 1, 0, verplaatst);
      return nieuw.join(",") === volgorde.join(",") ? vorig : nieuw;
    });
  }

  /** Legt vast wat er tijdens het slepen al te zien was: de volgorde, en
   * welke straten bovenaan een kolom beginnen. */
  function bewaarVolgorde(nieuweVolgorde: string[], vlaggen: Record<string, boolean> | null) {
    const gesorteerd = nieuweVolgorde
      .map((id) => alleStreets.find((s) => s.id === id))
      .filter(Boolean) as Street[];
    if (gesorteerd.length === 0) return;

    const vlagWijzigingen = Object.entries(vlaggen ?? {})
      .map(([id, aan]) => ({ id, kolom_start: aan }))
      .filter((v) => {
        const straat = alleStreets.find((s) => s.id === v.id);
        return !!straat && straat.kolom_start !== v.kolom_start;
      });
    const volgordeGelijk =
      zichtbaar.map((g) => g.street.id).join(",") === nieuweVolgorde.join(",");
    if (volgordeGelijk && vlagWijzigingen.length === 0) return;

    const vorige = alleStreets.map((s) => ({ ...s }));
    // Straten buiten deze selectie behouden hun plek t.o.v. de rest.
    const gesorteerdIds = new Set(gesorteerd.map((s) => s.id));
    const rest = alleStreets.filter((s) => !gesorteerdIds.has(s.id));
    const compleet = [...gesorteerd, ...rest];

    // Eerst de lijst zelf bijwerken: daarna mag de sleepvolgorde losgelaten
    // worden zonder dat het blok terugspringt. Het opslaan gebeurt erachteraan.
    qc.setQueryData<Street[]>(
      ["streets"],
      compleet.map((s, i) => {
        const vlag = vlagWijzigingen.find((v) => v.id === s.id);
        return { ...s, sort_order: i + 1, ...(vlag ? { kolom_start: vlag.kolom_start } : {}) };
      }),
    );
    pushUndo({
      label: "Straatvolgorde",
      undo: async () => {
        await Promise.all([
          persistStreetOrder(vorige),
          persistKolomStart(
            vlagWijzigingen.map((v) => ({
              id: v.id,
              kolom_start: vorige.find((s) => s.id === v.id)?.kolom_start ?? false,
            })),
          ),
        ]);
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    void Promise.all([
      volgordeGelijk ? Promise.resolve() : persistStreetOrder(compleet),
      persistKolomStart(vlagWijzigingen),
    ])
      .catch(() => toast.error("Volgorde opslaan mislukt."))
      .finally(() => qc.invalidateQueries({ queryKey: ["streets"] }));
  }

  function onDragEnd(_e: DragEndEvent) {
    const volgorde = sleepVolgorde;
    const vlaggen = sleepVlaggen;
    setSleepId(null);
    // `e.over` is bij het loslaten meestal de gesleepte straat zelf — die
    // ligt immers al op zijn nieuwe plek. Wat tijdens het slepen ontstond is
    // dus de bedoelde uitkomst.
    if (volgorde) bewaarVolgorde(volgorde, vlaggen);
    setSleepVolgorde(null);
    setSleepVlaggen(null);
  }

  /** Laat een straat de kolomkop weer los. */
  function kolomStartUit(id: string) {
    const straat = alleStreets.find((s) => s.id === id);
    if (!straat?.kolom_start) return;
    qc.setQueryData<Street[]>(
      ["streets"],
      alleStreets.map((s) => (s.id === id ? { ...s, kolom_start: false } : s)),
    );
    pushUndo({
      label: "Kolomstart",
      undo: async () => {
        await persistKolomStart([{ id, kolom_start: true }]);
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    void persistKolomStart([{ id, kolom_start: false }])
      .catch(() => toast.error("Opslaan mislukt."))
      .finally(() => qc.invalidateQueries({ queryKey: ["streets"] }));
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

          </div>
        </div>
      </div>

      <main className="mx-auto w-fit px-4 py-5 print:p-0">
        {groepen.length === 0 && (
          <p className="text-sm text-muted-foreground print:hidden">Geen klanten voor deze maand.</p>
        )}
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setSleepId(null);
            setSleepVolgorde(null);
            setSleepVlaggen(null);
          }}
        >
          <SortableContext items={groepen.map((g) => g.street.id)}>
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
                            <SleepbaarBlok
                              key={g.street.id}
                              g={g}
                              prijzen={prijzen}
                              maand={maand}
                              kolomKop={kolomStart(g.street)}
                              onKolomKopUit={() => kolomStartUit(g.street.id)}
                            />
                          ) : (
                            <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ),
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              ) : (
                printPaginas.map((paginaKolommen, i) => (
                  <div
                    key={i}
                    className={`grid gap-[1mm] ${i < printPaginas.length - 1 ? "mb-6 break-after-page print:mb-0" : ""}`}
                    style={{ gridTemplateColumns: `repeat(${KOLOMMEN}, minmax(0, 1fr))` }}
                  >
                    {paginaKolommen.map((kolom, k) => (
                      <KolomVak key={k} slot={i * KOLOMMEN + k}>
                        {kolom.map((g) =>
                          indelingKlaar ? (
                            <SleepbaarBlok
                              key={g.street.id}
                              g={g}
                              prijzen={prijzen}
                              maand={maand}
                              kolomKop={kolomStart(g.street)}
                              onKolomKopUit={() => kolomStartUit(g.street.id)}
                            />
                          ) : (
                            <StraatBlok key={g.street.id} g={g} prijzen={prijzen} maand={maand} />
                          ),
                        )}
                      </KolomVak>
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
                {zichtbaar.map((g) => (
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
