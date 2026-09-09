import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
  CalendarPlus,
  ChevronLeft,
  ChevronsRight,
  ChevronRight,
  Droplets,
  Eraser,
  Euro,
  Hammer,
  ListChecks,
  Milestone as Route2,
  Check,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { pushUndo, undoLaatste } from "@/lib/undo";
import {
  aanDeBeurt,
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  prijsVoorMaand,
  wijkKleur,
  wijkVlak,
  type Customer,
  type District,
} from "@/lib/klanten";
import { meetTempo, stelVoor, werkPerWijk, type Voorstel } from "@/lib/wijkritme";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { KlusDialog } from "@/components/KlusDialog";
import {
  blijvenLiggen,
  fetchKlussen,
  staatOpen,
  telDagVan,
  verwijderKlus,
  vinkKlusAf,
  zetKlusOpDag,
  haalKlusTerug,
  nieuweKlus,
  type Klus,
} from "@/lib/klussen";
import {
  fetchWasdag,
  fetchWasdagen,
  haalUitWasdag,
  maakWasdagLeeg,
  maandGrenzen,
  toonDatum,
  vandaag,
  voegToeAanWasdag,
  werkdagenVerder,
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

/**
 * Eén dagvakje als doel om een opdracht op los te laten.
 *
 * Waarom een eigen component en geen `useDroppable` in de lus: een hook mag
 * niet in een lus staan. Het vakje zelf blijft wat het was — deze schil geeft
 * alleen de ref en of je erboven hangt door.
 */
function DagDrop({
  datum,
  children,
}: {
  datum: string;
  children: (setRef: (el: HTMLElement | null) => void, erboven: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `d:${datum}` });
  return <>{children(setNodeRef, isOver)}</>;
}

/** Een opdracht in de strook: vastpakken om hem op een dag te zetten. */
function KlusKaart({
  klus,
  adres,
  wijkKleurtje,
  wijkNaam,
  sleepbaar,
}: {
  klus: Klus;
  adres: string;
  wijkKleurtje: string;
  wijkNaam: string;
  sleepbaar: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `k:${klus.id}`,
    disabled: !sleepbaar,
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 rounded-[11px] border border-border bg-card px-2.5 py-1.5 text-[13px] ${
        isDragging ? "opacity-40" : ""
      } ${sleepbaar ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
      {...(sleepbaar ? attributes : {})}
      {...(sleepbaar ? listeners : {})}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: wijkKleurtje }}
        title={wijkNaam}
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{adres}</span>
        <span className="text-muted-foreground"> — {klus.omschrijving}</span>
      </span>
      {klus.gepland_op && !blijvenLiggen(klus) && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {toonDatum(klus.gepland_op)}
        </span>
      )}
      {blijvenLiggen(klus) && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          stond op {toonDatum(klus.gepland_op!)}
        </span>
      )}
      <span className="shrink-0 tabular-nums">{formatPrice(klus.prijs)}</span>
    </div>
  );
}

/** De regels van één dag, klaar om te verplaatsen. */
type DagRegels = { customer_id: string; prijs: number }[];

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

  // Openstaand werk, plus wat er in deze maand afgevinkt is — dat laatste
  // voor de bedragen als je terugkijkt.
  const klussenQuery = useQuery({
    queryKey: ["klussen", sleutel(van), sleutel(tot)],
    queryFn: () => fetchKlussen(sleutel(van), sleutel(tot)),
  });
  const klussen = useMemo(() => klussenQuery.data ?? [], [klussenQuery.data]);

  /** Kleur en naam per wijk, op volgorde van de wijkenlijst. */
  const wijkInfo = useMemo(() => {
    const kaart = new Map<string, { naam: string; kleur: string; index: number }>();
    (districtsQuery.data ?? []).forEach((d, i) =>
      kaart.set(d.id, { naam: d.name, kleur: wijkKleur(i), index: i }),
    );
    return kaart;
  }, [districtsQuery.data]);

  /** Van adres naar wijk, in twee stappen: adres → straat → wijk. Zowel de
   *  kalender als de strook met opdrachten heeft dit nodig. */
  const wijkVanKlant = useMemo(() => {
    const straatVan = new Map((customersQuery.data ?? []).map((c) => [c.id, c.street_id]));
    const wijkVan = new Map((streetsQuery.data ?? []).map((s) => [s.id, s.district_id]));
    const kaart = new Map<string, string>();
    for (const [klantId, straatId] of straatVan) {
      const wijkId = wijkVan.get(straatId);
      if (wijkId) kaart.set(klantId, wijkId);
    }
    return kaart;
  }, [customersQuery.data, streetsQuery.data]);

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

    // En het extra werk. Op welke dag een klus meetelt — of nergens — staat in
    // telDagVan; zie src/lib/klussen.ts. Een klus die op een dag stond die
    // geweest is en niet afgevinkt werd, telt dus nergens: die heb je niet
    // gedaan, en dan hoort gisteren er niet duurder uit te zien.
    for (const k of klussen) {
      const dagSleutel = telDagVan(k);
      if (!dagSleutel) continue;
      const bij = kaart.get(dagSleutel) ?? {
        bedrag: 0,
        aantal: 0,
        straten: new Set<string>(),
        wijken: [],
      };
      bij.bedrag += k.prijs;
      const wijkId = wijkVanKlant.get(k.customer_id);
      if (wijkId && !bij.wijken.includes(wijkId)) bij.wijken.push(wijkId);
      kaart.set(dagSleutel, bij);
    }

    // Op volgorde van de wijkenlijst, niet op wie er toevallig als eerste in
    // de regels stond: zo staan de banen in het vakje en de kopjes in het
    // dagpaneel in dezelfde volgorde.
    for (const dag of kaart.values()) {
      dag.wijken.sort((a, b) => (wijkInfo.get(a)?.index ?? 0) - (wijkInfo.get(b)?.index ?? 0));
    }
    return kaart;
  }, [regels, klussen, wijkVanKlant, customersQuery.data, streetsQuery.data, wijkInfo]);

  // Het balkje in een dagvak is relatief aan de drukste dag van deze maand.
  const drukste = useMemo(
    () => Math.max(1, ...[...perDag.values()].map((v) => v.bedrag)),
    [perDag],
  );

  // --- Suggestie: welke wijk is wanneer aan de beurt? ---------------------
  // Een half jaar terugkijken om een tempo af te leiden: genoeg om iets te
  // zeggen, kort genoeg dat een oude werkwijze het niet blijft vertekenen.
  const halfJaar = useMemo(() => {
    const n = new Date();
    return { vanaf: sleutel(new Date(n.getFullYear(), n.getMonth() - 6, 1)), tot: sleutel(n) };
  }, []);
  const historieQuery = useQuery({
    queryKey: ["wasdagen", halfJaar.vanaf, halfJaar.tot],
    queryFn: () => fetchWasdagen(halfJaar.vanaf, halfJaar.tot),
  });

  const voorstel = useMemo(() => {
    const districts = districtsQuery.data ?? [];
    const streets = streetsQuery.data ?? [];
    const customers = customersQuery.data ?? [];
    if (districts.length === 0 || customers.length === 0) return new Map<string, Voorstel>();

    // Alleen vooruitkijken: een voorstel voor een maand die geweest is zegt
    // niets, en over een dag die al voorbij is heb je niets meer te beslissen.
    const nuDatum = vandaag();
    const eersteVanMaand = sleutel(startOfMonth(maand));
    const beginDag = eersteVanMaand > nuDatum ? eersteVanMaand : nuDatum;
    if (sleutel(endOfMonth(maand)) < nuDatum) return new Map<string, Voorstel>();

    const maandSleutelVanBlad = format(maand, "yyyy-MM");
    const regelsDezeMaand = regels.filter((r) => r.datum.startsWith(maandSleutelVanBlad));
    const gemeten = meetTempo(historieQuery.data ?? [], customers, streets);
    const werk = werkPerWijk(
      maandSleutelVanBlad,
      districts,
      streets,
      customers,
      regelsDezeMaand,
      gemeten,
    );
    // Dagen waar al iets op staat laten we met rust: die heb je zelf ingedeeld.
    const bezet = new Set(regelsDezeMaand.map((r) => r.datum));
    return new Map(stelVoor(beginDag, werk, bezet).map((v) => [v.datum, v]));
  }, [
    districtsQuery.data,
    streetsQuery.data,
    customersQuery.data,
    regels,
    historieQuery.data,
    maand,
  ]);

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
  /** Het extra werk dat op déze dag meetelt; zie telDagVan. */
  const dagKlussen = klussen.filter((k) => telDagVan(k) === gekozenDag);
  const dagBedrag =
    dagRegels.reduce((sum, r) => sum + Number(r.prijs), 0) +
    dagKlussen.reduce((sum, k) => sum + k.prijs, 0);

  const [sleep, setSleep] = useState<Klus | null>(null);
  const [klusOpen, setKlusOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  /**
   * De opdrachten die nog openstaan, in twee groepjes: wat aan de beurt is
   * omdat die wijk deze maand een dag heeft, en wat nog op zo'n dag wacht.
   *
   * Een opdracht die op een dag staat die geweest is zonder dat je hem
   * afvinkte, staat weer bovenaan: die is van die dag af.
   */
  const strook = useMemo(() => {
    const wijkenMetDag = new Set<string>();
    for (const [datum, dag] of perDag) {
      if (datum < sleutel(startOfMonth(maand)) || datum > sleutel(endOfMonth(maand))) continue;
      for (const w of dag.wijken) wijkenMetDag.add(w);
    }
    const open = klussen.filter((k) => staatOpen(k) && telDagVan(k) === null);
    const opDagen = klussen.filter((k) => staatOpen(k) && telDagVan(k) !== null);
    const aanDeBeurt: Klus[] = [];
    const wachten: Klus[] = [];
    for (const k of open) {
      const wijkId = wijkVanKlant.get(k.customer_id);
      (wijkId && wijkenMetDag.has(wijkId) ? aanDeBeurt : wachten).push(k);
    }
    // Blijven liggen staat vooraan: dat is het werk dat je bijna vergat.
    aanDeBeurt.sort((a, b) => Number(blijvenLiggen(b)) - Number(blijvenLiggen(a)));
    return { aanDeBeurt, wachten, ingedeeld: opDagen };
  }, [klussen, perDag, wijkVanKlant, maand]);

  async function zetOpDag(k: Klus, datum: string | null) {
    const vorige = k.gepland_op;
    try {
      await zetKlusOpDag(k.id, datum);
    } catch (e) {
      toast.error("Verplaatsen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Opdracht ${k.omschrijving}`,
      undo: async () => {
        await zetKlusOpDag(k.id, vorige);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
    toast.success(
      datum
        ? `${k.omschrijving} staat op ${toonDatum(datum)}`
        : `${k.omschrijving} staat weer open`,
    );
  }

  async function zetKlusAf(k: Klus, aan: boolean) {
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

  async function gooiKlusWeg(k: Klus) {
    const ja = await bevestig({
      titel: `Opdracht "${k.omschrijving}" weggooien?`,
      tekst: "Je kunt dit direct daarna nog ongedaan maken.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await verwijderKlus(k.id);
    } catch (e) {
      toast.error("Weggooien mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen opdracht ${k.omschrijving}`,
      undo: async () => {
        await haalKlusTerug(k.id);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
  }

  /**
   * Eén opdracht in de strook, met alles wat je ermee kunt onder de
   * rechtermuisknop. Dat menu is meteen de weg zonder slepen: op een telefoon
   * is een kalendervakje raken met een kaartje in je hand geen doen.
   *
   * Een functie en geen component: een component dat híerbinnen gedefinieerd
   * wordt is bij elke render een nieuw type, en dan bouwt React de kaartjes
   * telkens opnieuw op — precies tijdens het slepen, dus dan laat je hem
   * halverwege vallen.
   */
  function klusRegel(k: Klus) {
    const wijkId = wijkVanKlant.get(k.customer_id);
    const info = wijkId ? wijkInfo.get(wijkId) : undefined;
    // Eerst de dagen waarop je in díe wijk bent: daar gaat het hele idee over.
    // Staat die wijk niet meer op de agenda, dan liever alle dagen met werk
    // dan een leeg menu — je kunt er dan alsnog een keer langs.
    const komend = [...perDag.entries()].filter(([datum]) => datum >= nu);
    const inDeWijk = komend.filter(([, dag]) => !wijkId || dag.wijken.includes(wijkId));
    const dagen = (inDeWijk.length > 0 ? inDeWijk : komend)
      .map(([datum, dag]) => ({
        datum,
        // Bij de terugval erbij zetten waar je die dag heen gaat; anders staat
        // er een datum zonder dat je weet wat je er doet.
        wijk: inDeWijk.length > 0 ? "" : (wijkInfo.get(dag.wijken[0] ?? "")?.naam ?? ""),
      }))
      .sort((a, b) => a.datum.localeCompare(b.datum));
    return (
      <ContextMenu key={k.id}>
        <ContextMenuTrigger asChild>
          <div>
            <KlusKaart
              klus={k}
              adres={adresVan(k)}
              wijkKleurtje={info?.kleur ?? "transparent"}
              wijkNaam={info?.naam ?? "Onbekende wijk"}
              sleepbaar
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="truncate">{k.omschrijving}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void zetKlusAf(k, true)}>
            <Check className="size-4" /> Gedaan
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CalendarPlus className="size-4" /> Zet op…
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              {dagen.length === 0 && (
                <ContextMenuLabel className="font-normal text-muted-foreground">
                  Er staat nog geen dag gepland
                </ContextMenuLabel>
              )}
              {dagen.map((d) => (
                <ContextMenuItem key={d.datum} onSelect={() => void zetOpDag(k, d.datum)}>
                  <span className="capitalize">{toonDatum(d.datum)}</span>
                  {d.wijk && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{d.wijk}</span>
                  )}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {k.gepland_op && (
            <ContextMenuItem onSelect={() => void zetOpDag(k, null)}>
              <Eraser className="size-4" /> Van de dag halen
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void gooiKlusWeg(k)}>
            <Trash2 className="size-4" /> Weggooien
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  function opSleepStart(e: DragStartEvent) {
    const id = String(e.active.id).slice(2);
    setSleep(klussen.find((k) => k.id === id) ?? null);
  }

  function opSleepEinde(e: DragEndEvent) {
    const bezig = sleep;
    setSleep(null);
    if (!bezig || !e.over) return;
    const doel = String(e.over.id);
    if (!doel.startsWith("d:")) return;
    void zetOpDag(bezig, doel.slice(2));
  }

  /** "Kerkstraat 12" bij een opdracht; de wijk staat er met een kleurstip bij. */
  const adresVan = useMemo(() => {
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    return (k: Klus) => {
      const c = adres.get(k.customer_id);
      const s = c ? straat.get(c.street_id) : undefined;
      if (!c) return "Verwijderd adres";
      return `${s?.name ?? "?"} ${formatNumber(c)}`;
    };
  }, [customersQuery.data, streetsQuery.data]);

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

  /**
   * Schuift alles wat er vanaf deze dag t/m het eind van de maand staat een
   * paar werkdagen op. Voor als het regent of een klus uitloopt: dan verzet je
   * niet één dag maar de hele rits die erachteraan komt.
   *
   * Werkdagen, dus vrijdag plus één is maandag. Werk dat over de maandgrens
   * heen schuift belandt gewoon in de volgende maand; dat is waar het hoort.
   */
  async function schuifOp(vanaf: string, dagen: number) {
    const eindMaand = maandGrenzen(vanaf).tot;
    let inMaand: Awaited<ReturnType<typeof fetchWasdagen>>;
    try {
      inMaand = await fetchWasdagen(vanaf, eindMaand);
    } catch {
      toast.error("Kon de planning niet ophalen.");
      return;
    }

    // Regels zonder adres horen bij een pand dat definitief weg is; die laten
    // we staan, want ze zijn niet op id te verplaatsen.
    const teVerzetten = inMaand.filter((r): r is typeof r & { customer_id: string } =>
      Boolean(r.customer_id),
    );
    if (teVerzetten.length === 0) {
      toast(`Vanaf ${toonDatum(vanaf)} staat er niets ingepland.`);
      return;
    }

    // Per dag verzetten: eerst eraf op de oude datum, dan erop bij de nieuwe.
    // De upsert daar vangt het geval af dat er op de doeldag al iets stond.
    const perDagOud = new Map<string, { customer_id: string; prijs: number }[]>();
    for (const r of teVerzetten) {
      const rij = perDagOud.get(r.datum) ?? [];
      rij.push({ customer_id: r.customer_id, prijs: Number(r.prijs) });
      perDagOud.set(r.datum, rij);
    }
    const stappen = [...perDagOud.entries()].map(([oud, regels]) => ({
      oud,
      nieuw: werkdagenVerder(oud, dagen),
      regels,
    }));

    async function verplaats(lijst: { oud: string; nieuw: string; regels: DagRegels }[]) {
      // Van achter naar voren, anders schuift een dag op een dag die zelf nog
      // moet vertrekken.
      for (const stap of [...lijst].sort((a, b) => b.oud.localeCompare(a.oud))) {
        await haalUitWasdag(
          stap.oud,
          stap.regels.map((r) => r.customer_id),
        );
        await voegToeAanWasdag(stap.nieuw, stap.regels);
      }
    }

    try {
      await verplaats(stappen);
    } catch {
      toast.error("Opschuiven mislukt.");
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
      return;
    }

    pushUndo({
      label: `Planning ${dagen} ${dagen === 1 ? "dag" : "dagen"} opgeschoven`,
      undo: async () => {
        // Terug is dezelfde beweging andersom, en dan van voren naar achteren.
        await verplaats(
          stappen.map((x) => ({ oud: x.nieuw, nieuw: x.oud, regels: x.regels })).reverse(),
        );
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        qc.invalidateQueries({ queryKey: ["wasdag"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    qc.invalidateQueries({ queryKey: ["wasdag"] });

    const laatste = stappen.reduce((a, b) => (a.nieuw > b.nieuw ? a : b));
    toast.success(
      `${stappen.length} ${stappen.length === 1 ? "dag" : "dagen"} opgeschoven; de laatste staat nu op ${toonDatum(laatste.nieuw)}`,
      {
        duration: 12000,
        action: {
          label: "Ongedaan maken",
          onClick: () => {
            void undoLaatste().then((label) => {
              if (label) toast.success("Teruggedraaid: " + label);
            });
          },
        },
      },
    );
  }

  function kiesDag(d: Date) {
    void navigate({ to: "/planning", search: { dag: sleutel(d) }, replace: true });
  }

  /**
   * Zet een hele wijk op een dag: alle adressen die die maand aan de beurt
   * zijn en er nog niet op staan. Niet de hele wijk klakkeloos — een adres
   * dat om de drie maanden gaat hoort er in de tussenmaanden niet bij.
   */
  async function planWijk(datum: string, wijk: District) {
    const straten = new Set(
      (streetsQuery.data ?? []).filter((s) => s.district_id === wijk.id).map((s) => s.id),
    );
    const maandVanDag = datum.slice(0, 7);
    const kandidaten = (customersQuery.data ?? []).filter(
      (c) => straten.has(c.street_id) && aanDeBeurt(c, maandVanDag),
    );

    let alErop: Set<string>;
    try {
      const bestaand = await fetchWasdag(datum);
      alErop = new Set(bestaand.map((r) => r.customer_id).filter(Boolean) as string[]);
    } catch {
      toast.error("Kon niet ophalen wat er al op die dag staat.");
      return;
    }

    const erbij = kandidaten
      .filter((c) => !alErop.has(c.id))
      .map((c) => ({ customer_id: c.id, prijs: prijsVoorMaand(c, maandVanDag) }));

    if (erbij.length === 0) {
      toast(
        kandidaten.length === 0
          ? `${wijk.name} is deze maand niet aan de beurt.`
          : `${wijk.name} staat al helemaal op ${toonDatum(datum)}.`,
      );
      return;
    }

    try {
      await voegToeAanWasdag(datum, erbij);
    } catch {
      toast.error("Inplannen mislukt.");
      return;
    }

    pushUndo({
      label: `${wijk.name} op ${toonDatum(datum)}`,
      undo: async () => {
        await haalUitWasdag(
          datum,
          erbij.map((r) => r.customer_id),
        );
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        qc.invalidateQueries({ queryKey: ["wasdag"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    qc.invalidateQueries({ queryKey: ["wasdag"] });

    toast.success(`${wijk.name}: ${erbij.length} adressen op ${toonDatum(datum)}`, {
      duration: 10000,
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
      <DndContext
        sensors={sensors}
        // Waar je muis is, telt — niet waar het kaartje toevallig het meest
        // overlapt. Standaard kijkt dnd-kit naar de rechthoek van wat je
        // sleept, en dan land je zomaar een vakje naast de dag die je aanwees.
        collisionDetection={pointerWithin}
        onDragStart={opSleepStart}
        onDragEnd={opSleepEinde}
        onDragCancel={() => setSleep(null)}
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
                  <DagDrop key={k} datum={k}>
                    {(setDropRef, erboven) => (
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <button
                            // De ref van dnd-kit erbij; het contextmenu hangt via
                            // `asChild` zijn eigen ref aan dezelfde knop en Radix
                            // voegt die twee samen.
                            ref={setDropRef}
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
                            } ${erboven ? "outline outline-2 -outline-offset-2 outline-brand ring-2 ring-brand/30" : ""}`}
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
                                    style={{
                                      width: `${Math.round((info.bedrag / drukste) * 100)}%`,
                                    }}
                                  />
                                </span>
                              </>
                            )}

                            {/* Staat er nog niets op deze dag, dan zegt de app welke
                          wijk er volgens de ronde aan de beurt is. Zacht en
                          cursief, want het is een voorstel en geen planning. */}
                            {!info && !buitenMaand && voorstel.get(k) && (
                              <span className="mt-auto flex w-full items-center gap-1 truncate text-[10.5px] italic text-muted-foreground/70">
                                <span
                                  className="size-1.5 shrink-0 rounded-full opacity-60"
                                  style={{
                                    background: wijkInfo.get(voorstel.get(k)!.wijkId)?.kleur,
                                  }}
                                />
                                <span className="truncate">
                                  {voorstel.get(k)!.naam}
                                  {voorstel.get(k)!.van > 1 &&
                                    ` ${voorstel.get(k)!.deel}/${voorstel.get(k)!.van}`}
                                </span>
                              </span>
                            )}
                          </button>
                        </ContextMenuTrigger>
                        {/* Rechtermuisknop op een dag: een hele wijk erop zetten
                      zonder eerst naar de wijklijst te gaan. De wijken staan
                      in de volgorde die je in de instellingen hebt gezet. */}
                        <ContextMenuContent className="w-56">
                          <ContextMenuLabel className="capitalize">{toonDatum(k)}</ContextMenuLabel>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <CalendarPlus className="size-4" /> Hele wijk inplannen
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                              {(districtsQuery.data ?? []).map((w) => (
                                <ContextMenuItem key={w.id} onSelect={() => void planWijk(k, w)}>
                                  <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ background: wijkInfo.get(w.id)?.kleur }}
                                  />
                                  <span className="truncate">{w.name}</span>
                                  {/* De wijk die volgens de ronde aan de beurt is
                                staat gewoon op zijn plek in de lijst, met een
                                merkje — verspringen zou je laten misklikken. */}
                                  {voorstel.get(k)?.wijkId === w.id && (
                                    <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                      aan de beurt
                                    </span>
                                  )}
                                </ContextMenuItem>
                              ))}
                              {(districtsQuery.data ?? []).length === 0 && (
                                <ContextMenuLabel className="font-normal text-muted-foreground">
                                  Nog geen wijken
                                </ContextMenuLabel>
                              )}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger>
                              <ChevronsRight className="size-4" /> Planning vanaf hier opschuiven
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent className="w-56">
                              {[1, 2, 3].map((n) => (
                                <ContextMenuItem key={n} onSelect={() => void schuifOp(k, n)}>
                                  {n} {n === 1 ? "werkdag" : "werkdagen"} later
                                </ContextMenuItem>
                              ))}
                              <ContextMenuSeparator />
                              <ContextMenuLabel className="font-normal text-muted-foreground">
                                Alles t/m het eind van de maand schuift mee. Weekenden slaan we
                                over.
                              </ContextMenuLabel>
                            </ContextMenuSubContent>
                          </ContextMenuSub>

                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => kiesDag(d)}>
                            <CalendarCheck className="size-4" /> Deze dag bekijken
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => void navigate({ to: "/dag", search: { datum: k } })}
                          >
                            <ListChecks className="size-4" /> Adressen van deze dag
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => void navigate({ to: "/", search: { dag: k } })}
                          >
                            <Euro className="size-4" /> Aanvinken in de wijken
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )}
                  </DagDrop>
                );
              })}
            </div>
          </div>

          {/* --- extra opdrachten: werk zonder maand --- */}
          <div className="rounded-[14px] border border-border bg-card p-3 lg:col-start-1">
            <div className="mb-2 flex items-center gap-2">
              <Hammer className="size-4 shrink-0 text-muted-foreground" />
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">
                Extra opdrachten
              </h2>
              <span className="text-[12.5px] text-muted-foreground">
                sleep ze op een dag waarop je in die wijk bent
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto rounded-full"
                onClick={() => setKlusOpen(true)}
              >
                <Plus className="size-4" /> Opdracht
              </Button>
            </div>

            {strook.aanDeBeurt.length === 0 &&
              strook.wachten.length === 0 &&
              strook.ingedeeld.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Niets openstaand. Werk dat niet aan een maand vastzit — een dakrand, een goot —
                  noteer je bij het adres, en het komt hier terug zodra die wijk een dag heeft.
                </p>
              )}

            {strook.aanDeBeurt.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Nu aan de beurt
                </p>
                {strook.aanDeBeurt.map((k) => klusRegel(k))}
              </div>
            )}

            {strook.ingedeeld.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Staat op een dag
                </p>
                {strook.ingedeeld.map((k) => klusRegel(k))}
              </div>
            )}

            {strook.wachten.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Wacht op een dag in die wijk ({strook.wachten.length})
                </summary>
                <div className="mt-1.5 space-y-1.5">{strook.wachten.map((k) => klusRegel(k))}</div>
              </details>
            )}
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
                        <span className="w-16 text-right tabular-nums">
                          {formatPrice(s.bedrag)}
                        </span>
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
              {dagKlussen.length > 0 && (
                <div>
                  <div className="mb-1 flex items-baseline gap-1.5 border-b border-border pb-1">
                    <Hammer className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                      Extra opdrachten
                    </span>
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      {formatPrice(dagKlussen.reduce((sum, k) => sum + k.prijs, 0))}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {dagKlussen.map((k) => (
                      <div key={k.id} className="flex items-baseline gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">
                          {adresVan(k)} — {k.omschrijving}
                        </span>
                        <span className="w-16 text-right tabular-nums">{formatPrice(k.prijs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {dagRegels.length === 0 && dagKlussen.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Nog niets op deze dag. Vink in de wijken aan wat je gaat doen.
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {/* De dag zelf: welke huisnummers je langsgaat, en de printlijst
                van precies dat deel van de wijk. */}
              <Button size="sm" className="rounded-full" asChild>
                <Link to="/dag" search={{ datum: gekozenDag }}>
                  <ListChecks className="size-4" /> Naar deze dag
                </Link>
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" asChild>
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
        <DragOverlay>
          {sleep ? (
            <div className="rounded-[11px] border border-brand bg-card px-2.5 py-1.5 text-[13px] shadow-lg">
              {adresVan(sleep)} — {sleep.omschrijving}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <KlusDialog
        open={klusOpen}
        onOpenChange={setKlusOpen}
        customer={null}
        klus={null}
        onOpslaan={(customerId, omschrijving, prijs) => {
          void nieuweKlus(customerId, omschrijving, prijs)
            .then(() => {
              qc.invalidateQueries({ queryKey: ["klussen"] });
              toast.success(`Opdracht genoteerd: ${omschrijving}`);
            })
            .catch((e: Error) => toast.error("Opslaan mislukt: " + e.message));
        }}
      />
    </AppLayout>
  );
}
