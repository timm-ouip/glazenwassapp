import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  IconCalendarCheck as CalendarCheck,
  IconCalendarPlus as CalendarPlus,
  IconChevronLeft as ChevronLeft,
  IconChevronsRight as ChevronsRight,
  IconChevronRight as ChevronRight,
  IconDroplet as Droplet,
  IconEraser as Eraser,
  IconHammer as Hammer,
  IconListCheck as ListChecks,
  IconSquareCheck as CheckSquare,
  IconDots as MoreHorizontal,
  IconMail as Mail,
  IconRoute as Route2,
  IconCheck as Check,
  IconPlus as Plus,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { Cijferkaarten } from "@/components/Cijferkaarten";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { pushUndo, undoKnop } from "@/lib/undo";
import {
  aanDeBeurt,
  fetchCustomers,
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  formatPrice,
  prijsVoorMaand,
  wijkKleur,
  wijkInkt,
  wijkVlak,
  type Customer,
  type District,
} from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";
import { meetTempo, stelVoor, werkPerWijk, type Voorstel } from "@/lib/wijkritme";
import { laatsteWijk } from "@/lib/wijkgeheugen";
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
  zetAfvinkTerug,
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
import { alDichtbij, dubbelVraag, verplaatsWasdag } from "@/lib/wasdag";
import { isWerkdag, useWerkdagen } from "@/lib/werkdagen";
import { usePlanningInstellingen } from "@/lib/planninginstellingen";
import {
  fetchDagPloegen,
  fetchTeamleden,
  zetDagPloegen,
  zetDagVolgorde,
  type VolgordeBlok,
} from "@/lib/ploegen";
import { maakBouwstenen, klussenVanDag, maandVan } from "@/lib/dagbouwstenen";
import { ploegNaam } from "@/lib/ploegen";
import {
  duurTekst,
  maakBlokken,
  type OpenBlok,
  NIET_INGEDEELD,
  opzetVan,
  berekenTijden,
  type Blok,
  type Ploeg,
} from "@/lib/dagplanning";
import { perAdres, useAankondigingen } from "@/lib/aankondigingen";
import { supabase } from "@/integrations/supabase/client";
import { fetchKlanten, duurVoorMaand, patchCustomer } from "@/lib/klanten";
import { zetPloegEnRest } from "@/lib/wasdag";
import { DagWeergave } from "@/components/planning/DagWeergave";
import { WeekWeergave, type WeekDag } from "@/components/planning/WeekWeergave";
import { OverslaanKnop } from "@/components/OverslaanKnop";
import { VerplaatsNaarKnop } from "@/components/VerplaatsNaarKnop";
import { slaSelectieOver, wisOverslaanVanSelectie } from "@/lib/overslaan-keuze";
import { SneltoetsenHulp } from "@/components/mail/Sneltoetsen";
import { PloegenDialog } from "@/components/planning/PloegenDialog";
import { WijzigingsberichtDialog } from "@/components/WijzigingsberichtDialog";
import { haalUitWasdagBewaard, zetWasdagTerug } from "@/lib/wasdag";

type Weergave = "maand" | "week" | "dag";

const PLANNING_SNELTOETSEN: [string, string][] = [
  ["← →", "Een stap terug of vooruit — maand, week of dag"],
  ["t", "Vandaag"],
  ["m / w / d", "Maand, week of dag"],
  ["x", "Selecteren aan / uit"],
  ["a", "Alles op het scherm aanwijzen / niets"],
  ["Esc", "Selectie wissen; nog eens is stoppen met selecteren"],
  ["p", "De selectie naar een ploeg"],
  ["v", "De selectie naar een andere dag"],
  ["o", "De selectie overslaan"],
  ["u", "Adressen uitklappen / inklappen (dagweergave)"],
  ["i", "Ploegen indelen"],
  ["r", "Naar de route van die dag"],
  ["?", "Dit lijstje"],
];

interface PlanningSearch {
  /** De dag die openstaat, bijvoorbeeld vanaf de wijkenpagina. */
  dag?: string;
  /** Maandkalender (zoals altijd), de week met ploegen, of één dag met tijden. */
  weergave?: Weergave;
}

export const Route = createFileRoute("/planning")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): PlanningSearch => ({
    ...(typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {}),
    ...(search["weergave"] === "week" || search["weergave"] === "dag"
      ? { weergave: search["weergave"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Planning — Wooshy" },
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
  const prijzenZien = useRecht("prijzen_zien");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `k:${klus.id}`,
    disabled: !sleepbaar,
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 rounded-[11px] px-2.5 py-1.5 text-[13px] ${
        blijvenLiggen(klus)
          ? "bg-tint-oranje text-tint-oranje-ink"
          : "bg-card/70 text-card-foreground"
      } ${isDragging ? "opacity-40" : ""} ${
        sleepbaar ? "cursor-grab touch-none active:cursor-grabbing" : ""
      }`}
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
        <span className="opacity-70"> — {klus.omschrijving}</span>
      </span>
      {klus.gepland_op && !blijvenLiggen(klus) && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {toonDatum(klus.gepland_op)}
        </span>
      )}
      {blijvenLiggen(klus) && (
        <span className="shrink-0 text-[11px] opacity-80">
          bleef liggen op {toonDatum(klus.gepland_op!)}
        </span>
      )}
      {prijzenZien && <span className="shrink-0 tabular-nums">{formatPrice(klus.prijs)}</span>}
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
  const { dag, weergave: weergaveUitUrl } = Route.useSearch();
  const weergave: Weergave = weergaveUitUrl ?? "maand";

  const gekozenDag = dag ?? vandaag();
  const [maand, setMaand] = useState(() => startOfMonth(new Date(`${gekozenDag}T12:00:00`)));
  /** Een maand verder of terug. De gekozen dag gaat mee (vandaag als die in
   *  de nieuwe maand valt, anders de 1e): bleef hij staan, dan toonde het
   *  dagpaneel een dag die niet geladen is, als "€ 0, nog niets op deze dag". */
  function bladerMaand(stap: number) {
    const nieuw = addMonths(maand, stap);
    setMaand(nieuw);
    const dagNu = vandaag();
    const dagNieuw = isSameMonth(new Date(`${dagNu}T12:00:00`), nieuw) ? dagNu : sleutel(nieuw);
    void navigate({ to: "/planning", search: { dag: dagNieuw }, replace: true });
  }

  /**
   * De pijltjes naast de titel sturen je langs wat je voor je ziet: per maand
   * in de maandweergave, per week in de week, per dag in de dag. Een maand
   * verder springen terwijl je naar één dag kijkt is een sprong die niemand
   * vroeg.
   *
   * Loopt de nieuwe dag de maand uit, dan schuift `maand` mee: de gegevens
   * worden per maandraster opgehaald, en bleef hij staan dan keek je naar een
   * dag die niet geladen is.
   */
  function blader(stap: number) {
    if (weergave === "maand") return bladerMaand(stap);
    const d = new Date(`${gekozenDag}T12:00:00`);
    d.setDate(d.getDate() + stap * (weergave === "week" ? 7 : 1));
    if (!isSameMonth(d, maand)) setMaand(startOfMonth(d));
    void navigate({ to: "/planning", search: { dag: sleutel(d), weergave }, replace: true });
  }

  /** Waar de pijltjes je langs sturen, als tekst in de pil ertussen. */
  function bladerTekst(): string {
    if (weergave === "maand") return format(maand, "LLLL yyyy", { locale: nl });
    const d = new Date(`${gekozenDag}T12:00:00`);
    if (weergave === "dag") return format(d, "EEE d MMM", { locale: nl });
    const begin = startOfWeek(d, { locale: nl });
    const eind = endOfWeek(d, { locale: nl });
    // Loopt de week de maand uit, dan staat de maand er twee keer bij:
    // "28 sep – 4 okt" is anders niet te lezen.
    return isSameMonth(begin, eind)
      ? `${format(begin, "d", { locale: nl })} – ${format(eind, "d MMM", { locale: nl })}`
      : `${format(begin, "d MMM", { locale: nl })} – ${format(eind, "d MMM", { locale: nl })}`;
  }

  /** "maand", "week" of "dag", voor de voorleesnaam van de pijltjes. */
  const bladerNaam = weergave === "maand" ? "maand" : weergave === "week" ? "week" : "dag";

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
  // Voor wat er al op een dag staat of gedaan is: ook gestopte en verhuisde
  // adressen, anders vallen hun regels uit de wijken, de bedragen en het
  // tempo. Nieuw werk kiezen (voorstel, wijk inplannen) blijft op de actieve
  // lijst hierboven.
  const adressenQuery = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
  });
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
  // Zonder dit recht zijn alle bedragen 0; dan tonen we ze nergens en meet
  // het balkje in een dagvak het aantal adressen in plaats van het geld.
  const prijzenZien = useRecht("prijzen_zien");

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
    const straatVan = new Map((adressenQuery.data ?? []).map((c) => [c.id, c.street_id]));
    const wijkVan = new Map((streetsQuery.data ?? []).map((s) => [s.id, s.district_id]));
    const kaart = new Map<string, string>();
    for (const [klantId, straatId] of straatVan) {
      const wijkId = wijkVan.get(straatId);
      if (wijkId) kaart.set(klantId, wijkId);
    }
    return kaart;
  }, [adressenQuery.data, streetsQuery.data]);

  const perDag = useMemo(() => {
    const straatVan = new Map((adressenQuery.data ?? []).map((c) => [c.id, c.street_id]));
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
  }, [regels, klussen, wijkVanKlant, adressenQuery.data, streetsQuery.data, wijkInfo]);

  // Het balkje in een dagvak is relatief aan de drukste dag van deze maand.
  const drukste = useMemo(
    () => Math.max(1, ...[...perDag.values()].map((v) => (prijzenZien ? v.bedrag : v.aantal))),
    [perDag, prijzenZien],
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

  /** Op welke dagen van de week je werkt (Instellingen → Wijken). */
  const vasteWerkdagen = useWerkdagen();

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
    // Het tempo komt uit gedaan werk, dus mét gestopte adressen; wat er nog
    // moet alleen uit de actieve.
    const gemeten = meetTempo(historieQuery.data ?? [], adressenQuery.data ?? [], streets);
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
    return new Map(stelVoor(beginDag, werk, bezet, vasteWerkdagen).map((v) => [v.datum, v]));
  }, [
    districtsQuery.data,
    streetsQuery.data,
    customersQuery.data,
    adressenQuery.data,
    regels,
    historieQuery.data,
    maand,
    vasteWerkdagen,
  ]);

  const nu = vandaag();
  // Wat er gedaan is telt t/m vandaag; wat daarna staat is nog een plan. Dat
  // onderscheid is de reden dat deze pagina bestaat.
  const inMaand = (datum: string) => isSameMonth(new Date(`${datum}T12:00:00`), maand);
  // De dagregels én het extra werk, op de dag waar het meetelt (telDagVan):
  // hetzelfde als in de vakjes, anders klopte de optelling niet met de dagen.
  const maandPosten = [
    ...regels
      .filter((r) => inMaand(r.datum))
      .map((r) => ({ datum: r.datum, prijs: Number(r.prijs) })),
    ...klussen.flatMap((k) => {
      const d = telDagVan(k);
      return d && inMaand(d) ? [{ datum: d, prijs: k.prijs }] : [];
    }),
  ];
  const gedaan = maandPosten.filter((p) => p.datum <= nu).reduce((sum, p) => sum + p.prijs, 0);
  const gepland = maandPosten.filter((p) => p.datum > nu).reduce((sum, p) => sum + p.prijs, 0);
  const werkdagen = new Set(maandPosten.map((p) => p.datum)).size;

  // --- De gekozen dag, uitgesplitst per straat -----------------------------
  const dagRegels = regels.filter((r) => r.datum === gekozenDag);
  /** Het extra werk dat op déze dag meetelt; zie telDagVan. */
  const dagKlussen = klussen.filter((k) => telDagVan(k) === gekozenDag);
  const dagBedrag =
    dagRegels.reduce((sum, r) => sum + Number(r.prijs), 0) +
    dagKlussen.reduce((sum, k) => sum + k.prijs, 0);

  const [sleep, setSleep] = useState<Klus | null>(null);
  const [klusOpen, setKlusOpen] = useState(false);
  const mobiel = useIsMobile();

  // --- week- en dagweergave -------------------------------------------
  // Alles wat met tijd te maken heeft: de instellingen, wie er die dagen
  // werken, en wat er aan de klanten verstuurd is.
  const magPlannen = useRecht("planning");
  const magVersturen = useRecht("mail_versturen");
  const instellingen = usePlanningInstellingen();
  const teamledenQuery = useQuery({ queryKey: ["teamleden"], queryFn: fetchTeamleden });
  const ploegenQuery = useQuery({
    queryKey: ["dag-ploegen", sleutel(van), sleutel(tot)],
    queryFn: () => fetchDagPloegen(sleutel(van), sleutel(tot)),
  });
  const klantenQuery = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const aankondigingenQuery = useAankondigingen(sleutel(van), sleutel(tot), weergave === "dag");
  /** Voor welke dag je de ploegen indeelt; leeg = dicht. */
  const [ploegenVoor, setPloegenVoor] = useState<string | null>(null);
  const [hulpOpen, setHulpOpen] = useState(false);
  /** Wat er aangewezen is. Van de pagina, want je selecteert in de dag én in
   *  de week, en de knoppen erboven gelden voor allebei. */
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [selecteren, setSelecteren] = useState(false);
  /** Een blok dat je in de dagweergave naar een andere ploeg sleept. */
  const [sleepBlok, setSleepBlok] = useState<{
    titel: string;
    adressen: string[];
    klusId?: string;
    datum?: string;
  } | null>(null);
  /** Het venster "de planning is veranderd", met de adressen die het betreft. */
  const [wijziging, setWijziging] = useState<{
    customerIds: string[];
    soort: "wijziging" | "niet_af";
  } | null>(null);

  const bouwstenen = useMemo(
    () =>
      maakBouwstenen(
        adressenQuery.data ?? [],
        streetsQuery.data ?? [],
        districtsQuery.data ?? [],
        maandVan(gekozenDag),
        instellingen,
      ),
    [adressenQuery.data, streetsQuery.data, districtsQuery.data, gekozenDag, instellingen],
  );

  /** De regels per dag, met hun ploeg en volgorde. */
  const regelsPerDag = useMemo(() => {
    const kaart = new Map<string, typeof regels>();
    for (const r of regels) {
      const lijst = kaart.get(r.datum) ?? [];
      lijst.push(r);
      kaart.set(r.datum, lijst);
    }
    return kaart;
  }, [regels]);

  /** Heeft de klant van dit adres een mailadres of een 06? */
  const heeftContact = useMemo(() => {
    const klantVan = new Map((adressenQuery.data ?? []).map((c) => [c.id, c.klant_id]));
    const bereikbaar = new Map(
      (klantenQuery.data ?? []).map((k) => [
        k.id,
        !!(k.email.trim() || k.email2.trim() || k.telefoon.trim() || k.telefoon2.trim()),
      ]),
    );
    return (customerId: string) => {
      const klantId = klantVan.get(customerId);
      return klantId ? (bereikbaar.get(klantId) ?? false) : false;
    };
  }, [adressenQuery.data, klantenQuery.data]);

  const aankondigingen = useMemo(
    () => perAdres(aankondigingenQuery.data ?? []),
    [aankondigingenQuery.data],
  );

  /** De regels van één dag, in de vorm die de rekenkern wil. */
  function dagRegelsVan(datum: string) {
    return (regelsPerDag.get(datum) ?? [])
      .filter((r) => r.customer_id)
      .map((r) => ({
        customer_id: r.customer_id!,
        ploeg_nr: r.ploeg_nr ?? null,
        volgorde: r.volgorde ?? null,
        rest: r.rest ?? false,
        vaste_start: r.vaste_start ?? null,
      }));
  }

  /**
   * Wat de dagweergave krijgt. In een `useMemo`, want anders is het bij elke
   * toets een nieuwe lijst en rekent hij al zijn blokken en tijden opnieuw uit
   * — merkbaar op een tablet bij een volle dag.
   */
  const dagWeergaveRegels = useMemo(
    () => dagRegelsVan(gekozenDag),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regelsPerDag, gekozenDag],
  );
  const dagWeergaveKlussen = useMemo(
    () => klussenVanDag(klussen, gekozenDag),
    [klussen, gekozenDag],
  );

  /**
   * Sneltoetsen. Een toets die een menu opent drukt de knop in in plaats van
   * zelf een open-stand bij te houden: zo kan het menu nooit uit de pas lopen
   * met de knop waar het bij hoort.
   */
  const sneltoets = useRef<(e: KeyboardEvent) => void>(() => {});
  sneltoets.current = (e: KeyboardEvent) => {
    const doel = e.target as HTMLElement | null;
    if (doel && (doel.tagName === "INPUT" || doel.tagName === "TEXTAREA" || doel.isContentEditable))
      return;
    if (
      document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"]',
      )
    )
      return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const doe = (actie: () => void) => {
      e.preventDefault();
      actie();
    };
    const druk = (naam: string) =>
      doe(() => document.querySelector<HTMLElement>(`[data-sneltoets="${naam}"]`)?.click());
    const naarWeergave = (keuze: Weergave) =>
      doe(() =>
        navigate({
          to: "/planning",
          search: { dag: gekozenDag, ...(keuze === "maand" ? {} : { weergave: keuze }) },
          replace: true,
        }),
      );
    switch (e.key) {
      case "ArrowLeft":
        return doe(() => blader(-1));
      case "ArrowRight":
        return doe(() => blader(1));
      case "t":
        return doe(() => {
          setMaand(startOfMonth(new Date()));
          void navigate({
            to: "/planning",
            search: { dag: vandaag(), ...(weergave === "maand" ? {} : { weergave }) },
            replace: true,
          });
        });
      case "m":
        return naarWeergave("maand");
      case "w":
        return naarWeergave("week");
      case "d":
        return naarWeergave("dag");
      case "x":
        if (magPlannen && weergave !== "maand") druk("selecteren");
        return;
      case "a":
        // Alles van wat er nu op het scherm staat.
        if (selecteren && magPlannen) {
          doe(() => {
            const vakken = document.querySelectorAll<HTMLElement>("[data-kies]");
            const alles = new Map<string, string>();
            for (const vak of vakken) {
              const dag = vak.dataset["kiesDag"] ?? "";
              for (const id of (vak.dataset["kies"] ?? "").split(",").filter(Boolean)) {
                alles.set(id, dag);
              }
            }
            const compleet = [...alles.keys()].every((id) => gekozen.has(id));
            for (const [id, dag] of alles) kiesIds([id], !compleet, dag);
          });
        }
        return;
      case "Escape":
        if (gekozen.size > 0) return doe(() => setGekozen(new Set()));
        if (selecteren) return doe(() => setSelecteren(false));
        return;
      case "p":
        if (gekozen.size > 0) druk("ploeg");
        return;
      case "v":
        if (gekozen.size > 0) druk("verplaats");
        return;
      case "o":
        if (gekozen.size > 0) druk("overslaan");
        return;
      case "u":
        if (weergave === "dag") druk("uitklappen");
        return;
      case "i":
        if (magPlannen) druk("ploegen");
        return;
      case "r":
        if (weergave === "dag") druk("route");
        return;
      case "?":
        return doe(() => setHulpOpen(true));
    }
  };
  useEffect(() => {
    const opToets = (e: KeyboardEvent) => sneltoets.current(e);
    window.addEventListener("keydown", opToets);
    return () => window.removeEventListener("keydown", opToets);
  }, []);

  /** De werkdagen van de week waar de gekozen dag in valt. */
  const weekDagen = useMemo(() => {
    const d = new Date(`${gekozenDag}T12:00:00`);
    const begin = startOfWeek(d, { locale: nl });
    return eachDayOfInterval({ start: begin, end: endOfWeek(d, { locale: nl }) })
      .map((x) => sleutel(x))
      .filter((k) => isWerkdag(k, vasteWerkdagen));
  }, [gekozenDag, vasteWerkdagen]);

  const weekGegevens: WeekDag[] = useMemo(
    () =>
      weekDagen.map((datum) => ({
        datum,
        regels: dagRegelsVan(datum),
        klussen: klussenVanDag(klussen, datum),
        ploegen: ploegenQuery.data?.get(datum) ?? [],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekDagen, regelsPerDag, klussen, ploegenQuery.data],
  );

  /** Op de telefoon staan de extra opdrachten eerst ingeklapt tot één regel. */
  const [opdrachtenOpen, setOpdrachtenOpen] = useState(false);
  /** Waar een veeg over de kalender begon. */
  const veeg = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  /**
   * De wijk waar je nu zit: die van de laatste werkdag t/m vandaag. Rijd je
   * die dag twee wijken, dan telt die met de meeste adressen. Is er nog niets
   * gewassen, dan de wijk die je het laatst open had, anders de eerste.
   */
  const wijkNu = useMemo(() => {
    const alles = [...(historieQuery.data ?? []), ...regels].filter((r) => r.datum <= nu);
    const laatsteDag = alles.reduce((max, r) => (r.datum > max ? r.datum : max), "");
    const telling = new Map<string, number>();
    for (const r of alles) {
      if (r.datum !== laatsteDag || !r.customer_id) continue;
      const w = wijkVanKlant.get(r.customer_id);
      if (w) telling.set(w, (telling.get(w) ?? 0) + 1);
    }
    const drukste = [...telling].sort((a, b) => b[1] - a[1])[0]?.[0];
    const bewaard = laatsteWijk();
    return (
      drukste ??
      (bewaard && wijkInfo.has(bewaard) ? bewaard : null) ??
      districtsQuery.data?.[0]?.id ??
      null
    );
  }, [historieQuery.data, regels, nu, wijkVanKlant, wijkInfo, districtsQuery.data]);

  /**
   * De opdrachten die nog openstaan, per wijk: eerst de wijk waar je nu zit,
   * dan de wijken die daarna komen in de ronde — na de laatste wijk begint het
   * weer vooraan.
   *
   * Wat nog op een dag in die wijk wacht, staat apart en ingeklapt.
   */
  const strook = useMemo(() => {
    const wijkenMetDag = new Set<string>();
    for (const [datum, dag] of perDag) {
      if (datum < sleutel(startOfMonth(maand)) || datum > sleutel(endOfMonth(maand))) continue;
      for (const w of dag.wijken) wijkenMetDag.add(w);
    }

    const aantalWijken = Math.max(1, wijkInfo.size);
    const startIndex = wijkNu ? (wijkInfo.get(wijkNu)?.index ?? 0) : 0;
    /** Hoeveel wijken verderop in de ronde; onbekend achteraan. */
    const plekInRonde = (k: Klus) => {
      const index = wijkInfo.get(wijkVanKlant.get(k.customer_id) ?? "")?.index;
      return index === undefined
        ? aantalWijken
        : (index - startIndex + aantalWijken) % aantalWijken;
    };
    // Binnen een wijk komen ze op adres; dat doet perWijkGroep hieronder.
    const opVolgorde = (a: Klus, b: Klus) => plekInRonde(a) - plekInRonde(b);

    const lijst: Klus[] = [];
    const wachten: Klus[] = [];
    for (const k of klussen) {
      if (!staatOpen(k)) continue;
      const wijkId = wijkVanKlant.get(k.customer_id);
      const heeftDag = telDagVan(k) !== null || (wijkId && wijkenMetDag.has(wijkId));
      (heeftDag ? lijst : wachten).push(k);
    }
    return { lijst: lijst.sort(opVolgorde), wachten: wachten.sort(opVolgorde) };
  }, [klussen, perDag, wijkVanKlant, wijkInfo, wijkNu, maand]);

  async function zetOpDag(k: Klus, datum: string | null, ploegNr?: number | null) {
    const vorige = k.gepland_op;
    try {
      await zetKlusOpDag(k.id, datum, ploegNr ?? null);
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
        await zetAfvinkTerug(k);
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
              // Op de telefoon niet slepen: dan kun je niet meer over de
              // kaartjes heen scrollen. Lang indrukken → "Zet op…" doet het daar.
              sleepbaar={!mobiel}
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
    const id = String(e.active.id);
    if (id.startsWith("blok:")) {
      // Een blok uit de dagweergave. Wat we nodig hebben komt mee in de
      // sleep zelf: de blokken worden daar gemaakt en staan hier niet.
      const gegevens = e.active.data.current as
        { titel?: string; adressen?: string[]; klusId?: string; datum?: string } | undefined;
      setSleepBlok({
        titel: gegevens?.titel ?? "",
        adressen: gegevens?.adressen ?? [],
        ...(gegevens?.klusId ? { klusId: gegevens.klusId } : {}),
        ...(gegevens?.datum ? { datum: gegevens.datum } : {}),
      });
      setSleep(null);
      return;
    }
    setSleep(klussen.find((k) => k.id === id.slice(2)) ?? null);
  }

  function opSleepEinde(e: DragEndEvent) {
    const bezig = sleep;
    const blok = sleepBlok;
    setSleep(null);
    setSleepBlok(null);
    if (!e.over) return;
    const doel = String(e.over.id);
    // Op een straat laten vallen: hij komt daarvóór te staan en de rest
    // schuift op. Geen vaste tijd, alleen de volgorde.
    if (doel.startsWith("voor|")) {
      const stukken = doel.split("|");
      const datum = stukken[1] ?? "";
      const nr = Number(stukken[2] ?? 0);
      const ploegNr = nr > 0 ? nr : null;
      const voorSleutel = stukken.slice(3).join("|");
      if (!datum) return;
      // Een opdracht uit de strook die precies op een straat landt: ook die
      // hoort gewoon op die dag te komen.
      if (bezig) {
        void zetOpDag(bezig, datum, ploegNr);
        return;
      }
      if (!blok) return;
      if (blok.klusId) {
        void zetKlusOpDag(blok.klusId, datum, ploegNr)
          .then(ververs)
          .catch((f: unknown) =>
            toast.error("Verplaatsen mislukt: " + (f instanceof Error ? f.message : String(f))),
          );
        return;
      }
      // Van een andere dag: die verhuist eerst; de volgorde volgt daar vanzelf.
      if (blok.datum && blok.datum !== datum) {
        void verplaatsNaarDag(blok.adressen, datum, ploegNr, blok.datum);
        return;
      }
      herorden(datum, ploegNr, blok.adressen, voorSleutel);
      return;
    }
    // Een kolom in de dagweergave: hetzelfde als "Naar Ploeg 2" in het menu.
    if (doel.startsWith("ploegkolom:")) {
      const nr = Number(doel.slice("ploegkolom:".length));
      if (bezig) {
        // Een opdracht uit de strook, net naast een straatregel losgelaten.
        void zetOpDag(bezig, gekozenDag, nr > 0 ? nr : null);
        return;
      }
      if (!blok || (blok.adressen.length === 0 && !blok.klusId)) return;
      void naarPloeg(blok.adressen, nr > 0 ? nr : null, blok.klusId);
      return;
    }
    // Een plek in de weekweergave: een dag, en eventueel een ploeg.
    if (doel.startsWith("plek:")) {
      const [, datum, nr] = doel.split(":");
      if (!datum) return;
      const ploegNr = Number(nr) > 0 ? Number(nr) : null;
      if (bezig) {
        // Een opdracht uit de strook. Laat je hem op het vakje van een ploeg
        // vallen, dan hoort hij daar ook bij.
        void zetOpDag(bezig, datum, ploegNr);
        return;
      }
      if (!blok) return;
      if (blok.klusId) {
        // Een extra opdracht verhuist als opdracht; zijn adressen zijn het
        // adres waar hij bij staat en dat hoort niet mee te gaan.
        void zetKlusOpDag(blok.klusId, datum, ploegNr)
          .then(ververs)
          .catch((f: unknown) =>
            toast.error("Verplaatsen mislukt: " + (f instanceof Error ? f.message : String(f))),
          );
        return;
      }
      if (blok.adressen.length === 0) return;
      if (blok.datum === datum) {
        // Binnen dezelfde dag: alleen een andere ploeg, niet opnieuw inplannen
        // — dat zou het dagbedrag en de notitie van die dag overschrijven.
        void weekNaarPloeg(datum, blok.adressen, ploegNr);
      } else if (blok.datum) {
        void verplaatsNaarDag(blok.adressen, datum, ploegNr, blok.datum);
      } else {
        void zetStraatOpDag(blok.adressen, datum, ploegNr);
      }
      return;
    }
    if (!bezig || !doel.startsWith("d:")) return;
    void zetOpDag(bezig, doel.slice(2));
  }

  /** "Kerkstraat 12" bij een opdracht; de wijk staat er met een kleurstip bij. */
  const adresVan = useMemo(() => {
    const adres = new Map((adressenQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    return (k: Klus) => {
      const c = adres.get(k.customer_id);
      const s = c ? straat.get(c.street_id) : undefined;
      if (!c) return "Verwijderd adres";
      return `${s?.name ?? "?"} ${formatNumber(c)}`;
    };
  }, [adressenQuery.data, streetsQuery.data]);

  /** Een lijst die al op wijk staat in groepjes, met een kopje per wijk.
   *  Binnen een wijk eerst wat al op een dag staat (op datum), dan wat bleef
   *  liggen, dan de rest — steeds op straat en huisnummer. */
  function perWijkGroep(lijst: Klus[]) {
    const groepen: { wijkId: string; naam: string; kleur: string; klussen: Klus[] }[] = [];
    for (const k of lijst) {
      const wijkId = wijkVanKlant.get(k.customer_id) ?? "";
      let groep = groepen[groepen.length - 1];
      if (!groep || groep.wijkId !== wijkId) {
        const info = wijkInfo.get(wijkId);
        groep = {
          wijkId,
          naam: info?.naam ?? "Onbekende wijk",
          kleur: info?.kleur ?? "transparent",
          klussen: [],
        };
        groepen.push(groep);
      }
      groep.klussen.push(k);
    }
    const rang = (k: Klus) => (telDagVan(k) !== null ? 0 : blijvenLiggen(k) ? 1 : 2);
    for (const g of groepen) {
      g.klussen.sort(
        (a, b) =>
          rang(a) - rang(b) ||
          (rang(a) === 0 ? (a.gepland_op ?? "").localeCompare(b.gepland_op ?? "") : 0) ||
          adresVan(a).localeCompare(adresVan(b), "nl", { numeric: true }),
      );
    }
    return groepen;
  }

  /** Kopje met de wijknaam en daaronder zijn opdrachten. */
  function klussenPerWijk(lijst: Klus[]) {
    return perWijkGroep(lijst).map((g, i) => (
      <div key={g.wijkId || "onbekend"} className={`space-y-1.5 ${i > 0 ? "mt-3" : ""}`}>
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium opacity-70">
          <span className="size-2 rounded-full" style={{ background: g.kleur }} />
          {g.naam}
        </p>
        {g.klussen.map((k) => klusRegel(k))}
      </div>
    ));
  }

  /** De dag uitgesplitst per wijk, en daarbinnen per straat. */
  const perWijk = useMemo(() => {
    const adres = new Map((adressenQuery.data ?? []).map((c) => [c.id, c]));
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
  }, [dagRegels, adressenQuery.data, streetsQuery.data, wijkInfo]);

  /**
   * Schuift alles wat er vanaf deze dag t/m het eind van de maand staat een
   * paar werkdagen op. Voor als het regent of een klus uitloopt: dan verzet je
   * niet één dag maar de hele rits die erachteraan komt.
   *
   * Werkdagen uit de instellingen, dus met een vrij weekend is vrijdag plus
   * één maandag. Werk dat over de maandgrens
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

    // Per dag verzetten. Het blijft dezelfde regel met een andere datum, dus
    // een aangepaste prijs van die keer gaat mee (ook als wie verschuift geen
    // prijzen mag zien). Stond het adres op de doeldag al, dan blijft dat staan.
    const perDagOud = new Map<string, { customer_id: string; prijs: number }[]>();
    for (const r of teVerzetten) {
      const rij = perDagOud.get(r.datum) ?? [];
      rij.push({ customer_id: r.customer_id, prijs: Number(r.prijs) });
      perDagOud.set(r.datum, rij);
    }
    const stappen = [...perDagOud.entries()].map(([oud, regels]) => ({
      oud,
      nieuw: werkdagenVerder(oud, dagen, vasteWerkdagen),
      regels,
    }));

    type Stap = { oud: string; nieuw: string; regels: DagRegels };
    // Wat van een dag moest omdat het adres al op de doeldag stond, bewaart
    // de database; ongedaan maken zet het met zijn eigen prijs terug.
    const bewaard: string[] = [];
    async function verplaats(lijst: Stap[], richting: "vooruit" | "terug", gedaan?: Stap[]) {
      // Vooruit van achter naar voren, terug van voren naar achteren: altijd
      // eerst de dag die ergens heen gaat waar niets meer hoeft te vertrekken.
      // Anders valt een adres dat op twee opeenvolgende dagen staat weg.
      const volgorde = [...lijst].sort((a, b) =>
        richting === "vooruit" ? b.oud.localeCompare(a.oud) : a.oud.localeCompare(b.oud),
      );
      for (const stap of volgorde) {
        const uitkomst = await verplaatsWasdag(
          stap.oud,
          stap.nieuw,
          stap.regels.map((r) => r.customer_id),
        );
        if (richting === "vooruit") bewaard.push(...uitkomst.kenmerken);
        // Onthoud alleen wat echt verhuisde. Wat al op de doeldag stond ging
        // alleen weg en komt terug via het bewaarde kenmerk; dat nog eens
        // "terugverplaatsen" raakt niets en zou het ongedaan maken stoppen.
        const verhuisd = new Set(uitkomst.verplaatst);
        gedaan?.push({ ...stap, regels: stap.regels.filter((r) => verhuisd.has(r.customer_id)) });
      }
    }

    const gelukt: Stap[] = [];
    try {
      await verplaats(stappen, "vooruit", gelukt);
    } catch (e) {
      toast.error("Opschuiven mislukt: " + (e instanceof Error ? e.message : String(e)));
      // Wat al verschoven was, kun je nog terugzetten.
      if (gelukt.length > 0) {
        pushUndo({
          label: `Half opgeschoven planning (${gelukt.length} ${gelukt.length === 1 ? "dag" : "dagen"})`,
          undo: async () => {
            await verplaats(
              gelukt.map((x) => ({ oud: x.nieuw, nieuw: x.oud, regels: x.regels })),
              "terug",
            );
            for (const kenmerk of bewaard) await zetWasdagTerug(kenmerk);
            qc.invalidateQueries({ queryKey: ["wasdagen"] });
            qc.invalidateQueries({ queryKey: ["wasdag"] });
          },
        });
      }
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      return;
    }

    pushUndo({
      label: `Planning ${dagen} ${dagen === 1 ? "dag" : "dagen"} opgeschoven`,
      undo: async () => {
        // Terug is dezelfde beweging andersom, en dan van voren naar achteren.
        await verplaats(
          gelukt.map((x) => ({ oud: x.nieuw, nieuw: x.oud, regels: x.regels })),
          "terug",
        );
        for (const kenmerk of bewaard) await zetWasdagTerug(kenmerk);
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
        action: undoKnop(),
      },
    );

    // Klanten die al een aankondiging kregen, staan nu op een andere dag. Dat
    // hoort niet stil te blijven: vraag of ze bericht krijgen.
    if (magVersturen) {
      const verzet = gelukt.flatMap((x) => x.regels.map((r) => r.customer_id));
      const aangekondigd = await aangekondigdVan(verzet);
      if (aangekondigd.length > 0) {
        const ja = await bevestig({
          titel: `${aangekondigd.length} ${aangekondigd.length === 1 ? "klant kreeg" : "klanten kregen"} al een aankondiging`,
          tekst: "Hun dag is nu verschoven. Wil je ze een bericht sturen met de nieuwe dag erin?",
          bevestigLabel: "Bericht opstellen",
          annuleerLabel: "Niet nu",
        });
        if (ja) setWijziging({ customerIds: aangekondigd, soort: "wijziging" });
      }
    }
  }

  /** Van deze adressen: wie kreeg er al een aankondiging voor een andere dag? */
  async function aangekondigdVan(customerIds: string[]): Promise<string[]> {
    if (customerIds.length === 0) return [];
    try {
      const { data, error } = await supabase.rpc("aankondigingen_voor", {
        vanaf: sleutel(van),
        tot: sleutel(tot),
      });
      if (error) throw error;
      const bekend = new Set(customerIds);
      return [...new Set((data ?? []).map((r) => r.customer_id).filter((id) => bekend.has(id)))];
    } catch {
      // Lukt het opzoeken niet, dan vragen we het niet: liever geen vraag dan
      // een vraag over de verkeerde klanten.
      return [];
    }
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
    let dichtbij: Map<string, string>;
    try {
      const bestaand = await fetchWasdag(datum);
      alErop = new Set(bestaand.map((r) => r.customer_id).filter(Boolean) as string[]);
      // Een grote wijk over twee dagen: wat gisteren al ingepland is, hoort er
      // vandaag meestal niet nóg eens bij. Meestal, dus we vragen het.
      dichtbij = await alDichtbij(
        datum,
        kandidaten.filter((c) => !alErop.has(c.id)).map((c) => c.id),
        datum,
      );
    } catch {
      toast.error("Kon niet ophalen wat er rond die dag al ingepland staat.");
      return;
    }
    const overslaan = dichtbij.size > 0 && !(await bevestig(dubbelVraag(dichtbij)));

    const erbij = kandidaten
      .filter((c) => !alErop.has(c.id) && !(overslaan && dichtbij.has(c.id)))
      .map((c) => ({ customer_id: c.id, prijs: prijsVoorMaand(c, maandVanDag) }));

    if (erbij.length === 0) {
      toast(
        kandidaten.length === 0
          ? `${wijk.name} is deze maand niet aan de beurt.`
          : overslaan
            ? `${wijk.name}: niets ingepland, alles stond er kort ervoor of erna al op.`
            : `${wijk.name} staat al helemaal op ${toonDatum(datum)}.`,
      );
      return;
    }

    try {
      await voegToeAanWasdag(datum, erbij);
    } catch (e) {
      toast.error("Inplannen mislukt: " + (e instanceof Error ? e.message : String(e)));
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

    const eldersTekst = overslaan ? ` (${dichtbij.size} overgeslagen)` : "";
    toast.success(`${wijk.name}: ${erbij.length} adressen op ${toonDatum(datum)}${eldersTekst}`, {
      duration: 10000,
      action: undoKnop(),
    });
  }

  // --- handelingen in de week- en dagweergave --------------------------

  async function ververs() {
    await qc.invalidateQueries({ queryKey: ["wasdagen"] });
    await qc.invalidateQueries({ queryKey: ["wasdag"] });
    await qc.invalidateQueries({ queryKey: ["klussen"] });
  }

  /** De volgorde (en vaste tijden) van de blokken op een dag vastleggen. */
  async function bewaarVolgorde(
    datum: string,
    lijst: { ploeg_nr: number | null; vasteStart: string | null; blok: Blok }[],
  ) {
    try {
      await zetDagVolgorde(
        datum,
        lijst.map((b): VolgordeBlok => ({
          ploeg_nr: b.ploeg_nr,
          vaste_start: b.vasteStart,
          adressen: b.blok.klusId ? [] : b.blok.adressen,
          klussen: b.blok.klusId ? [b.blok.klusId] : [],
        })),
      );
      await ververs();
    } catch (e) {
      toast.error("Volgorde opslaan mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function bewaarPloegen(ploegen: Ploeg[], datum = gekozenDag) {
    try {
      await zetDagPloegen(datum, ploegen);
      await qc.invalidateQueries({ queryKey: ["dag-ploegen"] });
      await ververs();
      toast.success("Ploegen opgeslagen");
    } catch (e) {
      toast.error("Ploegen opslaan mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** De werktijd van één ploeg op één dag. */
  async function zetWerktijd(ploegNr: number, begin: string, eind: string) {
    const van = ploegenQuery.data?.get(gekozenDag) ?? [];
    await bewaarPloegen(van.map((pl) => (pl.nr === ploegNr ? { ...pl, begin, eind } : pl)));
  }

  /**
   * Een straat vóór een andere zetten. De blokken van die dag worden opnieuw
   * opgebouwd, de meeverhuizers eruit gehaald en op de nieuwe plek gezet; de
   * rest sluit gewoon weer aan. Een vaste tijd zetten we niet: die houdt de
   * app apart bij, via "Vastzetten op".
   */
  function herorden(datum: string, ploegNr: number | null, ids: string[], voorSleutel: string) {
    const blokken = maakBlokken({
      regels: dagRegelsVan(datum),
      klussen: klussenVanDag(klussen, datum),
      adressen: bouwstenen.adressen,
      straten: bouwstenen.straten,
      wijken: bouwstenen.wijken,
    });
    const bekend = new Set((ploegenQuery.data?.get(datum) ?? []).map((pl) => pl.nr));
    // Het vak "Nog niet ingedeeld" bevat ook werk met een ploegnummer dat deze
    // dag niet bestaat; dat hoort bij dezelfde kolom.
    const kolom =
      ploegNr === null
        ? [...blokken.entries()].filter(([nr]) => !bekend.has(nr)).flatMap(([, b]) => b)
        : (blokken.get(ploegNr) ?? []);
    const mee = new Set(ids);
    // Ook blokken die nu nog bij een andere ploeg van die dag staan: die
    // verhuizen mee naar deze kolom. Een extra opdracht telt niet mee: zijn
    // adres hoort ook bij de straat die je die dag wast, en dan zou die hele
    // straat meeverhuizen.
    const verhuizers = [...blokken.values()]
      .flat()
      .filter((b) => b.soort !== "klus" && b.adressen.some((id) => mee.has(id)));
    if (verhuizers.length === 0) return;
    const sleutels = new Set(verhuizers.map((b) => b.sleutel));
    // Op zichzelf laten vallen verandert niets; zonder dit springt het blok
    // naar het eind van de dag omdat het in `rest` niet meer te vinden is.
    if (sleutels.has(voorSleutel)) return;
    const rest = kolom.filter((b) => !sleutels.has(b.sleutel));
    const i = rest.findIndex((b) => b.sleutel === voorSleutel);
    const nieuw =
      i < 0 ? [...rest, ...verhuizers] : [...rest.slice(0, i), ...verhuizers, ...rest.slice(i)];
    // In "Nog niet ingedeeld" staat ook werk van een ploeg die deze dag niet
    // bestaat; dat nummer hoort te blijven staan, net als in de dagweergave.
    const herkomst = new Map<string, number>();
    if (ploegNr === null) {
      for (const [nr, lijst] of blokken) {
        // Nummer 0 is "geen ploeg"; dat hoort als leeg terug, niet als 0 — de
        // database kent alleen 1 t/m 9 of leeg.
        if (nr !== NIET_INGEDEELD && !bekend.has(nr)) {
          for (const b of lijst) herkomst.set(b.sleutel, nr);
        }
      }
    }
    void bewaarVolgorde(
      datum,
      nieuw.map((b) => ({
        ploeg_nr: ploegNr ?? herkomst.get(b.sleutel) ?? null,
        vasteStart: b.vasteStart,
        blok: b,
      })),
    );
  }

  /**
   * Werk naar een andere dag verplaatsen. Erbij zetten is niet hetzelfde als
   * verplaatsen: dan staat het op allebei de dagen en telt het bedrag dubbel.
   * De prijs en de notitie van die keer gaan mee.
   */
  async function verplaatsNaarDag(
    ids: string[],
    naar: string,
    ploegNr: number | null,
    vanDag?: string,
  ) {
    const perDag = groepeerPerDag(ids, vanDag);
    perDag.delete(naar);
    if (perDag.size === 0) {
      toast("Daar staat het al.");
      return;
    }
    const heen: { van: string; ids: string[] }[] = [];
    const kenmerken: string[] = [];
    let aantal = 0;
    try {
      for (const [van, lijst] of perDag) {
        const uit = await verplaatsWasdag(van, naar, lijst);
        if (uit.verplaatst.length > 0) heen.push({ van, ids: uit.verplaatst });
        kenmerken.push(...uit.kenmerken);
        aantal += uit.verplaatst.length;
      }
      if (ploegNr !== null && aantal > 0) {
        await zetPloegEnRest(naar, ids, { ploeg_nr: ploegNr });
      }
      if (aantal > 0) {
        pushUndo({
          label: `${aantal} naar ${toonDatum(naar)}`,
          undo: async () => {
            for (const stuk of heen) await verplaatsWasdag(naar, stuk.van, stuk.ids);
            for (const kenmerk of kenmerken) await zetWasdagTerug(kenmerk);
            await ververs();
          },
        });
      }
      await ververs();
      setGekozen(new Set());
      if (aantal > 0) {
        toast.success(`${aantal} naar ${toonDatum(naar)}`, {
          duration: 10000,
          action: undoKnop(),
        });
      }
    } catch (e) {
      // Ook bij een halve verhuizing opnieuw ophalen: anders staat op het
      // scherm nog wat er al verhuisd is.
      await ververs();
      toast.error("Verplaatsen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Werk van één dag bij een andere ploeg van díe dag zetten. */
  async function weekNaarPloeg(
    datum: string,
    ids: string[],
    ploegNr: number | null,
    klusId?: string,
  ) {
    try {
      // Een extra opdracht verhuist als opdracht; zijn adressen zijn het adres
      // waar hij bij staat en dat hoort hier niet te verhuizen.
      if (klusId) await zetKlusOpDag(klusId, datum, ploegNr);
      else await zetPloegEnRest(datum, ids, { ploeg_nr: ploegNr });
      await ververs();
    } catch (e) {
      toast.error("Indelen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Op welke dag een adres aangewezen is. Een adres kan deze maand op meer
   *  dan één dag staan; verplaatsen mag alleen de dag raken die je aanwees. */
  const gekozenOp = useRef(new Map<string, string>());

  function kiesIds(ids: string[], aan: boolean, dag: string) {
    setGekozen((was) => {
      const nieuw = new Set(was);
      for (const id of ids) {
        if (aan) {
          nieuw.add(id);
          if (dag) gekozenOp.current.set(id, dag);
        } else {
          nieuw.delete(id);
          gekozenOp.current.delete(id);
        }
      }
      return nieuw;
    });
  }

  /**
   * Op welke dag een adres nu staat. "Naar ploeg" hoort bij de dag waar dat
   * adres op staat en niet bij de dag die je toevallig open hebt — anders
   * verhuis je iets op een heel andere dag.
   */
  const dagenVanAdres = useMemo(() => {
    const kaart = new Map<string, string[]>();
    for (const r of regels) {
      if (!r.customer_id) continue;
      kaart.set(r.customer_id, [...(kaart.get(r.customer_id) ?? []), r.datum]);
    }
    return kaart;
  }, [regels]);

  /**
   * De adressen op een hoop per dag. De dag die je aanwees telt; anders de dag
   * van het blok dat je sleepte, anders de enige dag waarop hij staat. Nooit
   * álle dagen tegelijk: een adres kan deze maand twee keer aan de beurt zijn,
   * en dan zou je die tweede beurt stilletjes kwijtraken.
   */
  function groepeerPerDag(ids: string[], vanDag?: string): Map<string, string[]> {
    const uit = new Map<string, string[]>();
    for (const id of ids) {
      const datum = gekozenOp.current.get(id) ?? vanDag ?? (dagenVanAdres.get(id) ?? [])[0];
      if (!datum) continue;
      uit.set(datum, [...(uit.get(datum) ?? []), id]);
    }
    return uit;
  }

  /** De dagen waarop de selectie staat. */
  function dagenVanSelectie(ids: string[]): string[] {
    const uit = new Set<string>();
    for (const id of ids) for (const d of dagenVanAdres.get(id) ?? []) uit.add(d);
    return [...uit];
  }

  /**
   * De ploegen die je aan een selectie kunt geven: alleen nummers die op élke
   * dag van die selectie bestaan. Anders krijgt werk een ploegnummer dat op
   * zijn dag niet bestaat, en verdwijnt het in "Nog niet ingedeeld".
   */
  function ploegenVoorSelectie(ids: string[]): Ploeg[] {
    const dagen = dagenVanSelectie(ids);
    if (dagen.length === 0) return [];
    const eerste = ploegenQuery.data?.get(dagen[0]!) ?? [];
    return eerste.filter((pl) =>
      dagen.every((d) => (ploegenQuery.data?.get(d) ?? []).some((x) => x.nr === pl.nr)),
    );
  }

  /** De hele selectie naar een ploeg, per dag waar ze op staan. */
  async function selectieNaarPloeg(ids: string[], ploegNr: number | null) {
    const perDag = groepeerPerDag(ids);
    try {
      for (const [datum, lijst] of perDag) {
        await zetPloegEnRest(datum, lijst, { ploeg_nr: ploegNr });
      }
      await ververs();
      setGekozen(new Set());
    } catch (e) {
      toast.error("Indelen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** De hele selectie deze maand overslaan, of die pauzes juist weghalen. */
  async function selectieOverslaan(maanden: string[]) {
    const lijst = (customersQuery.data ?? []).filter((c) => gekozen.has(c.id));
    if (lijst.length === 0) return;
    if (maanden.length === 0) await wisOverslaanVanSelectie(lijst, qc);
    else await slaSelectieOver(lijst, maanden, qc);
    setGekozen(new Set());
  }

  /** Wat er in het rechtermuismenu bij komt als je op de selectie klikt. */
  function selectieActies(ids: string[]) {
    if (gekozen.size === 0 || !ids.some((id) => gekozen.has(id))) return [];
    const lijst = [...gekozen];
    return [
      ...ploegenVoorSelectie(lijst).map((pl) => ({
        sleutel: `sel-ploeg:${pl.nr}`,
        label: `${lijst.length} naar ${ploegNaam(pl)}`,
        doe: () => void selectieNaarPloeg(lijst, pl.nr),
      })),
      {
        sleutel: "sel-uitploeg",
        label: `${lijst.length} uit de ploeg halen`,
        doe: () => void selectieNaarPloeg(lijst, null),
      },
      {
        sleutel: "sel-overslaan",
        label: `${lijst.length} deze maand overslaan`,
        doe: () => void selectieOverslaan([maandVan(gekozenDag)]),
      },
      { sleutel: "sel-wis", label: "Selectie wissen", doe: () => setGekozen(new Set()) },
    ];
  }

  /**
   * Adressen bij een andere ploeg zetten (of eruit halen). Bij een blok dat
   * een extra opdracht is telt `klusId`: de adressen van zo'n blok zijn het
   * adres waar de opdracht bij hoort, en dat adres hoort hier niet te
   * verhuizen.
   */
  async function naarPloeg(customerIds: string[], ploegNr: number | null, klusId?: string) {
    try {
      if (klusId) await zetKlusOpDag(klusId, gekozenDag, ploegNr);
      else await zetPloegEnRest(gekozenDag, customerIds, { ploeg_nr: ploegNr });
      await ververs();
    } catch (e) {
      toast.error("Indelen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Een restblok weer bij zijn straat schuiven. */
  async function voegSamen(blok: Blok) {
    try {
      await zetPloegEnRest(gekozenDag, blok.adressen, { rest: false });
      await ververs();
    } catch (e) {
      toast.error("Samenvoegen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Dit pand als eigen blok, of juist niet. */
  async function zetEigenBlok(customerId: string, waarde: boolean | null) {
    try {
      await patchCustomer(customerId, { eigen_blok: waarde });
      await qc.invalidateQueries({ queryKey: ["customers"] });
      await ververs();
    } catch (e) {
      toast.error("Aanpassen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Losse adressen naar een andere dag; ze komen daar als "(rest)" te staan. */
  async function verplaatsAdressen(customerIds: string[], naar: string) {
    try {
      const { verplaatst, kenmerken } = await verplaatsWasdag(gekozenDag, naar, customerIds);
      if (verplaatst.length > 0) {
        await zetPloegEnRest(naar, verplaatst, { rest: true, ploeg_nr: null, volgorde: null });
      }
      pushUndo({
        label: `${verplaatst.length} naar ${toonDatum(naar)}`,
        undo: async () => {
          await verplaatsWasdag(naar, gekozenDag, verplaatst);
          for (const k of kenmerken) await zetWasdagTerug(k);
          await ververs();
        },
      });
      await ververs();
      toast.success(
        `${verplaatst.length} ${verplaatst.length === 1 ? "adres" : "adressen"} naar ${toonDatum(naar)}`,
        {
          duration: 10000,
          action: undoKnop(),
        },
      );
    } catch (e) {
      toast.error("Verplaatsen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Een straat uit de strook op een dag (en eventueel een ploeg) zetten. */
  async function zetStraatOpDag(adressen: string[], datum: string, ploegNr: number | null) {
    const maandNu = maandVan(datum);
    const regelsErbij = adressen
      .map((id) => (customersQuery.data ?? []).find((c) => c.id === id))
      .filter((c): c is Customer => !!c)
      .map((c) => ({ customer_id: c.id, prijs: prijsVoorMaand(c, maandNu) }));
    if (regelsErbij.length === 0) return;
    try {
      const dichtbij = await alDichtbij(datum, adressen, datum);
      if (dichtbij.size > 0 && !(await bevestig(dubbelVraag(dichtbij)))) return;
      await voegToeAanWasdag(datum, regelsErbij, { ploeg_nr: ploegNr });
      pushUndo({
        label: `${regelsErbij.length} op ${toonDatum(datum)}`,
        undo: async () => {
          await haalUitWasdag(datum, adressen);
          await ververs();
        },
      });
      await ververs();
      toast.success(`${regelsErbij.length} adressen op ${toonDatum(datum)}`, {
        duration: 10000,
        action: undoKnop(),
      });
    } catch (e) {
      toast.error("Inplannen mislukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function maakDagLeeg() {
    const ja = await bevestig({
      titel: `${toonDatum(gekozenDag)} leegmaken?`,
      tekst: `Alle ${dagRegels.length} adressen gaan van deze dag af. Je kunt dit direct daarna nog ongedaan maken.`,
      gevaarlijk: true,
    });
    if (!ja) return;

    const terug = dagRegels.filter((r) => r.customer_id);
    // De database bewaart wat er weggaat, met het bedrag: zo krijgt ongedaan
    // maken ook een aangepaste dagprijs terug.
    let kenmerk: string | null;
    try {
      kenmerk = await haalUitWasdagBewaard(gekozenDag);
    } catch (e) {
      toast.error(
        "Leegmaken mislukt: " +
          (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
      );
      return;
    }
    pushUndo({
      label: `Dag ${toonDatum(gekozenDag)}`,
      undo: async () => {
        await zetWasdagTerug(kenmerk);
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
      action: undoKnop(),
    });
  }

  const weekdagen = eachDayOfInterval({ start: van, end: endOfWeek(van, { locale: nl }) });
  // Op de telefoon alleen de dagen waarop je werkt (Instellingen → Wijken):
  // dan worden de vakjes breed genoeg om te lezen. Een weekdag waar deze
  // maand tóch werk op staat blijft zichtbaar, anders verdwijnt dat werk.
  const weekdagNr = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());
  const kolommen = mobiel
    ? weekdagen.filter(
        (w) =>
          isWerkdag(w, vasteWerkdagen) ||
          dagen.some(
            (d) =>
              weekdagNr(d) === weekdagNr(w) &&
              isSameMonth(d, maand) &&
              // Werk op die dag, of het is de dag die je bekijkt: die moet je
              // in de kalender terugzien, ook op een zaterdag.
              (perDag.has(sleutel(d)) || sleutel(d) === gekozenDag),
          ),
      )
    : weekdagen;
  const zichtbareNrs = new Set(kolommen.map(weekdagNr));
  const toonDagen = mobiel ? dagen.filter((d) => zichtbareNrs.has(weekdagNr(d))) : dagen;
  const raster = mobiel
    ? { gridTemplateColumns: `repeat(${kolommen.length}, minmax(0, 1fr))` }
    : undefined;
  const aantalOpdrachten = strook.lijst.length + strook.wachten.length;

  return (
    <AppLayout
      titel="Planning"
      kruimel="Overzicht / Planning"
      onderbalk={
        mobiel ? (
          <div className="flex items-center gap-2">
            <Button
              className="h-11 flex-1 rounded-full shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
              asChild
            >
              <Link to="/dag" search={{ datum: gekozenDag }}>
                <ListChecks className="size-4" /> Dagplanning
              </Link>
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-full bg-card shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
              asChild
            >
              <Link to="/" search={{ dag: gekozenDag }}>
                <CalendarPlus className="size-4" /> Inplannen
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 shrink-0 rounded-full bg-card shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
                  aria-label="Meer voor deze dag"
                >
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {dagRegels.length > 0 && (
                  <DropdownMenuItem asChild>
                    <Link to="/mailing" search={{ dag: gekozenDag }}>
                      <Mail className="size-4" /> Deze dag aankondigen
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setKlusOpen(true)}>
                  <Plus className="size-4" /> Extra opdracht
                </DropdownMenuItem>
                {dagRegels.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void maakDagLeeg()}>
                      <Eraser className="size-4" /> Dag leegmaken
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : undefined
      }
      onderschrift="Wat er per dag gewassen wordt — vooruit gepland en achteraf geteld."
      kop={
        <Cijferkaarten
          cijfers={[
            {
              label: `Gewassen in ${format(maand, "MMMM", { locale: nl })}`,
              waarde: formatPrice(gedaan),
              onder: "achteraf geteld",
              icon: Droplet,
              kleur: "groen",
              verberg: !prijzenZien,
            },
            {
              label: "Nog gepland",
              waarde: formatPrice(gepland),
              onder: "staat nog voor je",
              icon: CalendarCheck,
              kleur: "paars",
              verberg: !prijzenZien,
            },
            {
              label: "Dagen met werk",
              waarde: String(werkdagen),
              onder: `in ${format(maand, "MMMM", { locale: nl })}`,
              icon: Route2,
              kleur: "amber",
            },
          ]}
        />
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
        onDragCancel={() => {
          setSleep(null);
          setSleepBlok(null);
        }}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* --- maandkalender ---
              Op de telefoon veeg je naar links of rechts voor de volgende of
              vorige maand. */}
          <div
            className="overflow-hidden rounded-[18px] border border-border bg-card shadow-card max-md:order-1"
            onTouchStart={(e) => {
              const t = e.touches[0];
              // Alleen op de telefoon, en niet vanuit het menu onder lang
              // indrukken: dat hangt los op de pagina, maar zijn aanrakingen
              // komen in React toch hier binnen.
              veeg.current =
                mobiel && t && e.touches.length === 1 && e.currentTarget.contains(e.target as Node)
                  ? { x: t.clientX, y: t.clientY }
                  : null;
            }}
            onTouchEnd={(e) => {
              const start = veeg.current;
              veeg.current = null;
              const t = e.changedTouches[0];
              if (!start || !t || sleep) return;
              const dx = t.clientX - start.x;
              const dy = t.clientY - start.y;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                blader(dx < 0 ? 1 : -1);
              }
            }}
          >
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              {/* De periode is één pil met de pijltjes erin: samen één ding om
                  te bedienen, in plaats van drie losse knoppen naast elkaar.
                  Wat erin staat volgt de weergave, net als waar de pijltjes
                  je heen brengen. */}
              <div className="flex items-center gap-0.5 rounded-full border border-border bg-card py-1 pl-1 pr-1 shadow-card">
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
                  onClick={() => blader(-1)}
                  aria-label={`Vorige ${bladerNaam}`}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <h2 className="px-1.5 font-display text-[15.5px] font-semibold tracking-[-0.01em] first-letter:uppercase">
                  {bladerTekst()}
                </h2>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
                  onClick={() => blader(1)}
                  aria-label={`Volgende ${bladerNaam}`}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <button
                type="button"
                className="rounded-full bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-foreground/80 hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setMaand(startOfMonth(new Date()));
                  void navigate({
                    to: "/planning",
                    search: { dag: vandaag(), ...(weergave === "maand" ? {} : { weergave }) },
                    replace: true,
                  });
                }}
              >
                Vandaag
              </button>

              {/* Aanwijzen in de week én in de dag: dezelfde selectie, dus ook
                  dezelfde knop. In de maandweergave valt er niets aan te
                  wijzen. */}
              {magPlannen && weergave !== "maand" && (
                <Button
                  size="sm"
                  variant={selecteren ? "default" : "outline"}
                  className="rounded-full"
                  data-sneltoets="selecteren"
                  onClick={() => {
                    setSelecteren((aan) => !aan);
                    setGekozen(new Set());
                  }}
                  title="Slepen over het werk om het aan te wijzen"
                >
                  <CheckSquare className="size-4" /> Selecteren
                </Button>
              )}

              {/* Maand, week of dag. De maand blijft wat hij was; week en dag
                  gaan over de gekozen dag. */}
              <div className="ml-auto flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-card">
                {(["maand", "week", "dag"] as const).map((keuze) => (
                  <button
                    key={keuze}
                    type="button"
                    aria-pressed={weergave === keuze}
                    onClick={() =>
                      void navigate({
                        to: "/planning",
                        search: {
                          dag: gekozenDag,
                          ...(keuze === "maand" ? {} : { weergave: keuze }),
                        },
                        replace: true,
                      })
                    }
                    className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium capitalize transition-colors sm:px-3 ${
                      weergave === keuze
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-surface hover:text-foreground"
                    }`}
                  >
                    {/* Op een smal scherm alleen de eerste letter: anders past
                        de rij niet en valt "Dag" buiten beeld. */}
                    <span className="sm:hidden">{keuze[0]}</span>
                    <span className="hidden sm:inline">{keuze}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Wat je met de selectie kunt. Staat hier en niet in de dag- of
                weekweergave: je wijst in allebei dezelfde adressen aan. */}
            {selecteren && magPlannen && gekozen.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
                <span className="text-[12.5px] font-medium tabular-nums">
                  {gekozen.size} {gekozen.size === 1 ? "adres" : "adressen"}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      data-sneltoets="ploeg"
                    >
                      Naar ploeg…
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {ploegenVoorSelectie([...gekozen]).length === 0 && (
                      <DropdownMenuLabel className="text-[11.5px] font-normal text-muted-foreground">
                        Deze dagen hebben geen ploeg gemeen
                      </DropdownMenuLabel>
                    )}
                    {ploegenVoorSelectie([...gekozen]).map((pl) => (
                      <DropdownMenuItem
                        key={pl.nr}
                        onSelect={() => void selectieNaarPloeg([...gekozen], pl.nr)}
                      >
                        {ploegNaam(pl)}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onSelect={() => void selectieNaarPloeg([...gekozen], null)}>
                      Uit de ploeg halen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <VerplaatsNaarKnop
                  aantal={gekozen.size}
                  huidigeDag={gekozenDag}
                  onKies={(naar) => void verplaatsNaarDag([...gekozen], naar, null)}
                />
                <OverslaanKnop
                  aantal={gekozen.size}
                  onOverslaan={(maanden) => void selectieOverslaan(maanden)}
                  onNietsOverslaan={() => void selectieOverslaan([])}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setGekozen(new Set())}
                >
                  Selectie wissen
                </Button>
              </div>
            )}

            {weergave === "maand" && (
              <>
                <div className="grid grid-cols-7 px-1.5 pt-1.5" style={raster}>
                  {kolommen.map((d) => (
                    <div
                      key={d.toISOString()}
                      className="py-2 text-center text-[11px] font-medium text-muted-foreground/80"
                    >
                      {format(d, "EEEEEE", { locale: nl })}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1.5 p-1.5 max-md:gap-1" style={raster}>
                  {toonDagen.map((d) => {
                    const k = sleutel(d);
                    const info = perDag.get(k);
                    const buitenMaand = !isSameMonth(d, maand);
                    const isVandaag = k === nu;
                    const isGekozen = k === gekozenDag;
                    // Voorbij vandaag is het nog een plan; t/m vandaag is het gedaan.
                    const isGedaan = k <= nu;
                    // Staan er meerdere wijken op één dag, dan krijgt het vak een
                    // baan per wijk in plaats van één kleur.
                    const indexen = (info?.wijken ?? [])
                      .map((id) => wijkInfo.get(id)?.index)
                      .filter((i): i is number => i !== undefined);
                    const vlak = buitenMaand || indexen.length === 0 ? "" : wijkVlak(indexen);
                    // Bij twee wijken op één dag de kleur van de eerste: één inkt
                    // voor één bedrag, anders wordt het een regenboog.
                    const inkt =
                      vlak && indexen[0] !== undefined ? wijkInkt(indexen[0]) : undefined;
                    return (
                      <DagDrop key={k} datum={k}>
                        {(setDropRef, erboven) => (
                          // Het knopje naar inplannen ligt naast de dag en niet erin:
                          // een knop in een knop kan niet, en zo vangt hij geen
                          // klikken of dubbelklikken van de dag zelf af.
                          <div className="group/dag relative">
                            <ContextMenu>
                              <ContextMenuTrigger asChild>
                                <button
                                  // De ref van dnd-kit erbij; het contextmenu hangt via
                                  // `asChild` zijn eigen ref aan dezelfde knop en Radix
                                  // voegt die twee samen.
                                  ref={setDropRef}
                                  onClick={() => kiesDag(d)}
                                  // Dubbelklikken opent de dagplanning: de route van die dag.
                                  // Aanvinken in de wijken zit onder het knopje rechtsboven.
                                  onDoubleClick={() =>
                                    void navigate({ to: "/dag", search: { datum: k } })
                                  }
                                  title="Klik om te bekijken, dubbelklik voor de dagplanning"
                                  aria-current={isVandaag ? "date" : undefined}
                                  aria-pressed={isGekozen}
                                  // Het hele vakje krijgt de pastelkleur van de wijk die er
                                  // die dag aan de beurt is; zo zie je een maand aan de
                                  // kleuren, zonder namen te lezen.
                                  style={vlak ? { background: vlak } : undefined}
                                  className={`relative flex h-full min-h-[4.5rem] w-full flex-col rounded-[12px] p-1.5 text-left transition-colors max-md:min-h-[3.25rem] max-md:select-none max-md:[-webkit-touch-callout:none] md:min-h-[6.25rem] ${
                                    buitenMaand
                                      ? "bg-transparent"
                                      : vlak
                                        ? ""
                                        : "bg-surface/70 hover:bg-surface"
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
                                        <span
                                          style={inkt ? { color: inkt } : undefined}
                                          // Op de telefoon zegt de kleur van het vakje al welke wijk het is.
                                          className="mt-auto flex w-full items-center gap-1 truncate text-[10.5px] font-medium max-md:hidden"
                                        >
                                          <span
                                            className="size-1.5 shrink-0 rounded-full"
                                            style={{
                                              background: wijkInfo.get(info.wijken[0]!)?.kleur,
                                            }}
                                          />
                                          <span className="truncate">
                                            {wijkInfo.get(info.wijken[0]!)?.naam ??
                                              "Onbekende wijk"}
                                            {info.wijken.length > 1 &&
                                              ` +${info.wijken.length - 1}`}
                                          </span>
                                        </span>
                                      )}
                                      {prijzenZien && (
                                        <span
                                          style={inkt ? { color: inkt } : undefined}
                                          className={`w-full truncate font-display text-[12px] font-semibold leading-none tracking-[-0.03em] tabular-nums max-md:mt-auto md:text-[15px] ${
                                            info.wijken.length > 0 ? "mt-0.5" : "mt-auto"
                                          }`}
                                        >
                                          {/* Op de telefoon zonder centen: "€ 593,50" past niet. */}
                                          {mobiel
                                            ? `€${Math.round(info.bedrag)}`
                                            : formatPrice(info.bedrag)}
                                        </span>
                                      )}
                                      <span className="mt-1 hidden truncate text-[10.5px] text-muted-foreground md:block">
                                        {info.straten.size > 0
                                          ? `${info.straten.size} ${info.straten.size === 1 ? "straat" : "straten"} · ${info.aantal}×`
                                          : `${info.aantal}×`}
                                      </span>
                                      <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                                        <span
                                          className={`block h-full rounded-full ${
                                            inkt ? "" : isGedaan ? "bg-tint-groen-ink" : "bg-brand"
                                          }`}
                                          style={{
                                            width: `${Math.round(((prijzenZien ? info.bedrag : info.aantal) / drukste) * 100)}%`,
                                            ...(inkt
                                              ? { background: inkt, opacity: isGedaan ? 1 : 0.5 }
                                              : {}),
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
                                <ContextMenuLabel className="capitalize">
                                  {toonDatum(k)}
                                </ContextMenuLabel>
                                <ContextMenuSub>
                                  <ContextMenuSubTrigger>
                                    <CalendarPlus className="size-4" /> Hele wijk inplannen
                                  </ContextMenuSubTrigger>
                                  <ContextMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                                    {(districtsQuery.data ?? []).map((w) => (
                                      <ContextMenuItem
                                        key={w.id}
                                        onSelect={() => void planWijk(k, w)}
                                      >
                                        <span
                                          className="size-2 shrink-0 rounded-full"
                                          style={{ background: wijkInfo.get(w.id)?.kleur }}
                                        />
                                        <span className="truncate">{w.name}</span>
                                        {/* De wijk die volgens de ronde aan de beurt is
                                  staat gewoon op zijn plek in de lijst, met een
                                  merkje — verspringen zou je laten misklikken. */}
                                        {voorstel.get(k)?.wijkId === w.id && (
                                          <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
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
                                    <ChevronsRight className="size-4" /> Planning vanaf hier
                                    opschuiven
                                  </ContextMenuSubTrigger>
                                  <ContextMenuSubContent className="w-56">
                                    {[1, 2, 3].map((n) => (
                                      <ContextMenuItem key={n} onSelect={() => void schuifOp(k, n)}>
                                        {n} {n === 1 ? "werkdag" : "werkdagen"} later
                                      </ContextMenuItem>
                                    ))}
                                    <ContextMenuSeparator />
                                    <ContextMenuLabel className="font-normal text-muted-foreground">
                                      Alles t/m het eind van de maand schuift mee. Dagen waarop je
                                      niet werkt slaan we over.
                                    </ContextMenuLabel>
                                  </ContextMenuSubContent>
                                </ContextMenuSub>

                                <ContextMenuSeparator />
                                <ContextMenuItem onSelect={() => kiesDag(d)}>
                                  <CalendarCheck className="size-4" /> Deze dag bekijken
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() =>
                                    void navigate({ to: "/dag", search: { datum: k } })
                                  }
                                >
                                  <ListChecks className="size-4" /> Dagplanning
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => void navigate({ to: "/", search: { dag: k } })}
                                >
                                  <CalendarPlus className="size-4" /> Werk inplannen
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() =>
                                    void navigate({ to: "/mailing", search: { dag: k } })
                                  }
                                >
                                  <Mail className="size-4" /> Deze dag aankondigen
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                            {/* Rechtsboven: meteen naar de wijken om voor deze dag aan
                            te vinken. Alleen met een muis, en pas zichtbaar als je
                            over de dag beweegt. Op een telefoon of tablet zou een
                            onzichtbaar knopje tikken op de dag afvangen en over het
                            dagnummer vallen; daar staat "Werk inplannen" in het
                            menu onder lang indrukken. Buiten de Tab-volgorde om
                            dezelfde reden: het menu heeft het al. */}
                            {!buitenMaand && (
                              <Link
                                to="/"
                                search={{ dag: k }}
                                tabIndex={-1}
                                title="Inplannen voor deze dag"
                                aria-label={`Inplannen voor ${format(d, "d MMMM", { locale: nl })}`}
                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded-[8px] text-foreground/45 opacity-0 transition-[opacity,color,background-color] hover:bg-card hover:text-foreground hover:shadow-card group-hover/dag:opacity-100 [@media(hover:hover)]:flex"
                              >
                                <CalendarPlus className="size-3.5" />
                              </Link>
                            )}
                          </div>
                        )}
                      </DagDrop>
                    );
                  })}
                </div>
              </>
            )}

            {weergave === "week" && (
              <div className="p-2">
                <WeekWeergave
                  selecteren={selecteren}
                  gekozen={gekozen}
                  onKies={kiesIds}
                  selectieActies={selectieActies}
                  onPloegen={(datum) => setPloegenVoor(datum)}
                  onNaarPloeg={(datum, ids, nr, klusId) =>
                    void weekNaarPloeg(datum, ids, nr, klusId)
                  }
                  dagen={weekGegevens}
                  instellingen={instellingen}
                  bouwstenen={bouwstenen}
                  prijzenZien={prijzenZien}
                  sleepbaar={magPlannen && !mobiel}
                  onOpenDag={(datum) =>
                    void navigate({
                      to: "/planning",
                      search: { dag: datum, weergave: "dag" },
                      replace: true,
                    })
                  }
                />
              </div>
            )}

            {weergave === "dag" && (
              <div className="p-2">
                <DagWeergave
                  selecteren={selecteren}
                  gekozen={gekozen}
                  onKies={kiesIds}
                  selectieActies={selectieActies}
                  datum={gekozenDag}
                  naarDagpagina={
                    <Link
                      to="/dag"
                      search={{ datum: gekozenDag }}
                      data-sneltoets="route"
                      className="rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground/80 hover:bg-muted"
                    >
                      Naar de dagpagina
                    </Link>
                  }
                  instellingen={instellingen}
                  bouwstenen={bouwstenen}
                  regels={dagWeergaveRegels}
                  klussen={dagWeergaveKlussen}
                  ploegen={ploegenQuery.data?.get(gekozenDag) ?? []}
                  aankondigingen={aankondigingen}
                  heeftContact={heeftContact}
                  magPlannen={magPlannen}
                  prijzenZien={prijzenZien}
                  onVolgorde={(lijst) => void bewaarVolgorde(gekozenDag, lijst)}
                  onPloegen={() => setPloegenVoor(gekozenDag)}
                  onWerktijd={(nr, begin, eind) => void zetWerktijd(nr, begin, eind)}
                  onEigenBlok={(id, waarde) => void zetEigenBlok(id, waarde)}
                  onSamenvoegen={(blok) => void voegSamen(blok)}
                  onVerplaats={(ids, naar) => void verplaatsAdressen(ids, naar)}
                  onNaarPloeg={(ids, nr, klusId) => void naarPloeg(ids, nr, klusId)}
                  onWijziging={(ids) => setWijziging({ customerIds: ids, soort: "wijziging" })}
                />
              </div>
            )}
          </div>

          {/* --- extra opdrachten: werk zonder maand --- */}
          <div className="rounded-[18px] bg-tint-geel p-3 text-tint-geel-ink shadow-card max-md:order-3 lg:col-start-1 lg:row-start-2">
            <div className={`flex items-center gap-2 ${mobiel && !opdrachtenOpen ? "" : "mb-2.5"}`}>
              {/* Op de telefoon is de kop een knop die de lijst open- en
                  dichtklapt. */}
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left md:pointer-events-none"
                onClick={() => setOpdrachtenOpen((o) => !o)}
                aria-expanded={!mobiel || opdrachtenOpen}
                tabIndex={mobiel ? 0 : -1}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-tint-geel-ink/15">
                  <Hammer className="size-[15px]" />
                </span>
                <h2 className="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                  Extra opdrachten
                  {mobiel && aantalOpdrachten > 0 && (
                    <span className="ml-1 tabular-nums opacity-75">({aantalOpdrachten})</span>
                  )}
                </h2>
                <ChevronRight
                  className={`size-4 shrink-0 transition-transform md:hidden ${opdrachtenOpen ? "rotate-90" : ""}`}
                />
              </button>
              <span className="text-[12px] opacity-75 max-md:hidden">
                sleep ze op een dag in die wijk
              </span>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 rounded-full bg-tint-geel-ink/12 px-3 py-1.5 text-[12.5px] font-medium hover:bg-tint-geel-ink/20"
                onClick={() => setKlusOpen(true)}
              >
                <Plus className="size-4" /> Opdracht
              </button>
            </div>

            <div className={mobiel && !opdrachtenOpen ? "hidden" : ""}>
              {mobiel && aantalOpdrachten > 0 && (
                <p className="mb-2 text-[12px] opacity-75">
                  Hou een opdracht ingedrukt om hem op een dag te zetten.
                </p>
              )}
              {strook.lijst.length === 0 && strook.wachten.length === 0 && (
                <p className="text-[12.5px] opacity-75">
                  Niets openstaand. Werk dat niet aan een maand vastzit — een dakrand, een goot —
                  noteer je bij het adres, en het komt hier terug zodra die wijk een dag heeft.
                </p>
              )}

              {strook.lijst.length > 0 && <div>{klussenPerWijk(strook.lijst)}</div>}

              {strook.wachten.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11.5px] font-medium opacity-70">
                    Wacht op een dag in die wijk ({strook.wachten.length})
                  </summary>
                  <div className="mt-1.5">{klussenPerWijk(strook.wachten)}</div>
                </details>
              )}
            </div>
          </div>

          {/* --- de gekozen dag ---
              Rechts naast de kalender en bovenaan beginnen: zonder row-start
              schuift hij onder de strook met opdrachten door, en dan staat
              het belangrijkste van de pagina onderin. */}
          <div className="rounded-[18px] border border-border bg-card shadow-card p-4 max-md:order-2 lg:col-start-2 lg:row-start-1">
            <p className="text-xs text-muted-foreground">
              {gekozenDag > nu ? "Gepland voor" : "Gewassen op"}
            </p>
            <h2 className="font-display text-[19px] font-semibold capitalize leading-tight tracking-[-0.02em]">
              {toonDatum(gekozenDag)}
            </h2>
            {prijzenZien && (
              <p className="mt-1 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
                {formatPrice(dagBedrag)}
              </p>
            )}
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
                    {prijzenZien && (
                      <span className="text-[12px] tabular-nums text-muted-foreground">
                        {formatPrice(w.bedrag)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {w.straten.map((s) => (
                      <div key={s.id} className="flex items-baseline gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">{s.naam}</span>
                        <span className="tabular-nums text-muted-foreground">{s.aantal}×</span>
                        {prijzenZien && (
                          <span className="w-16 text-right tabular-nums">
                            {formatPrice(s.bedrag)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {perWijk.kwijt.aantal > 0 && (
                <div className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">Verwijderde adressen</span>
                  <span className="tabular-nums">{perWijk.kwijt.aantal}×</span>
                  {prijzenZien && (
                    <span className="w-16 text-right tabular-nums">
                      {formatPrice(perWijk.kwijt.bedrag)}
                    </span>
                  )}
                </div>
              )}
              {dagKlussen.length > 0 && (
                <div>
                  <div className="mb-1 flex items-baseline gap-1.5 border-b border-border pb-1">
                    <Hammer className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                      Extra opdrachten
                    </span>
                    {prijzenZien && (
                      <span className="text-[12px] tabular-nums text-muted-foreground">
                        {formatPrice(dagKlussen.reduce((sum, k) => sum + k.prijs, 0))}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {dagKlussen.map((k) => (
                      <div key={k.id} className="flex items-baseline gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">
                          {adresVan(k)} — {k.omschrijving}
                        </span>
                        {prijzenZien && (
                          <span className="w-16 text-right tabular-nums">
                            {formatPrice(k.prijs)}
                          </span>
                        )}
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

            {/* Op de telefoon staan deze knoppen onderin, bij je duim. */}
            <div className="mt-5 flex flex-col gap-2 max-md:hidden">
              {/* De dag zelf: welke huisnummers je langsgaat, en de printlijst
                van precies dat deel van de wijk. */}
              <Button size="sm" className="w-full justify-start rounded-full" asChild>
                <Link to="/dag" search={{ datum: gekozenDag }}>
                  <ListChecks className="size-4" /> Dagplanning
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start rounded-full"
                asChild
              >
                <Link to="/" search={{ dag: gekozenDag }}>
                  <CalendarPlus className="size-4" /> Werk inplannen
                </Link>
              </Button>
              {/* De aankondiging hoort bij de dag: je kijkt naar wie er morgen
                  aan de beurt is, en stuurt ze vanaf hier een bericht. */}
              {dagRegels.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start rounded-full"
                  asChild
                >
                  <Link to="/mailing" search={{ dag: gekozenDag }}>
                    <Mail className="size-4" /> Deze dag aankondigen
                  </Link>
                </Button>
              )}
              {dagRegels.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start rounded-full"
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
          ) : sleepBlok ? (
            <div className="rounded-[11px] border border-brand bg-card px-2.5 py-1.5 text-[13px] shadow-lg">
              {sleepBlok.titel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <SneltoetsenHulp
        open={hulpOpen}
        onSluit={() => setHulpOpen(false)}
        toetsen={PLANNING_SNELTOETSEN}
        waarvoor="Toetsen om sneller in te delen"
      />
      <PloegenDialog
        open={ploegenVoor !== null}
        onOpenChange={(open) => !open && setPloegenVoor(null)}
        datum={ploegenVoor ?? gekozenDag}
        teamleden={teamledenQuery.data ?? []}
        ploegen={ploegenQuery.data?.get(ploegenVoor ?? gekozenDag) ?? []}
        onOpslaan={(nieuwePloegen) => void bewaarPloegen(nieuwePloegen, ploegenVoor ?? gekozenDag)}
      />

      {wijziging && (
        <WijzigingsberichtDialog
          open
          onOpenChange={(o) => !o && setWijziging(null)}
          customerIds={wijziging.customerIds}
          soort={wijziging.soort}
          onVerstuurd={() => void qc.invalidateQueries({ queryKey: ["aankondigingen"] })}
        />
      )}

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
