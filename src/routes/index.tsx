import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { netjesStraat } from "@/lib/schoonschrift";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { naarDagBijOpstarten } from "@/lib/dagslot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  IconPlus as Plus,
  IconPrinter as Printer,
  IconUpload as Upload,
  IconPencil as Pencil,
  IconTrash as Trash2,
  IconSquare as Square,
  IconGripVertical as GripVertical,
  IconSortAscending as ArrowUpNarrowWide,
  IconSortDescending as ArrowDownNarrowWide,
  IconArrowBackUp as Undo2,
  IconUsers as Users,
  IconUser as User,
  IconCurrencyEuro as Euro,
  IconRoute as Route2,
  IconCalendarPlus as CalendarPlus,
  IconCheck as Check,
  IconSquareCheck as CheckSquare,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconFold as ChevronsDownUp,
  IconSelector as ChevronsUpDown,
  IconCircleOff as CircleSlash,
  IconCornerDownRight as CornerDownRight,
  IconFolder as Folder,
  IconStack2 as Layers,
  IconListNumbers as ListOrdered,
  IconDots as MoreHorizontal,
  IconX as X,
  IconKeyboard as Keyboard,
} from "@tabler/icons-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLangIndrukken } from "@/hooks/use-lang-indrukken";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
import { Checkbox } from "@/components/ui/checkbox";
import { AppLayout } from "@/components/AppLayout";
import { Cijferkaarten } from "@/components/Cijferkaarten";
import { KlantDialog } from "@/components/KlantDialog";
import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import { SneltoetsenHulp } from "@/components/mail/Sneltoetsen";
import { WeekStrook } from "@/components/WeekStrook";
import {
  DubbelDialoog,
  type DubbelKeuze,
  type DubbelRij,
  type DubbelVraag,
} from "@/components/DubbelDialoog";
import { StraatDialog } from "@/components/StraatDialog";
import { SplitsStraatDialog } from "@/components/SplitsStraatDialog";
import { GroepDialog } from "@/components/GroepDialog";
import { StratenAanvullen } from "@/components/StratenAanvullen";
import { stratenZonderNaam } from "@/lib/aanvullen";
import { DubbeleStraten } from "@/components/DubbeleStraten";

import { WijkKiezer } from "@/components/WijkKiezer";
import { useBevestig } from "@/components/Bevestig";
import { DuurCel } from "@/components/DuurCel";
import { InlineCel } from "@/components/InlineCel";
import { laatsteUndo, pushUndo, undoKnop, undoMetMelding, useLaatsteUndoLabel } from "@/lib/undo";
import { OverslaanKnop } from "@/components/OverslaanKnop";
import { slaSelectieOver, wisOverslaanVanSelectie } from "@/lib/overslaan-keuze";
import { NotitieCel } from "@/components/NotitieCel";
import { ZoekBalk } from "@/components/ZoekBalk";
import { HoekadresDialog } from "@/components/HoekadresDialog";
import { KlusDialog } from "@/components/KlusDialog";
import { KlantMenu } from "@/components/KlantMenu";
import { Overgeslagen } from "@/components/Overgeslagen";
import { PrijsCel } from "@/components/PrijsCel";
import { FrequentieKiezer } from "@/components/FrequentieKiezer";
import { WassenVanaf } from "@/components/WassenVanaf";
import { useActieveWijk } from "@/lib/wijkgeheugen";
import { useStabiel } from "@/hooks/use-stabiel";
import { nieuweKlus, verwijderKlus } from "@/lib/klussen";
import {
  fetchWasdag,
  fetchNietGewassen,
  fetchWasdagen,
  haalUitWasdag,
  maakWasdagLeeg,
  maandGrenzen,
  toonDatum,
  vandaag,
  voegToeAanWasdag,
  type WasdagRegel,
} from "@/lib/wasdag";
import {
  aanDeBeurt,
  addQuickNote,
  alsRij,
  haalTerug,
  legWeg,
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchQuickNotes,
  fetchStraatGroepen,
  fetchStreets,
  nieuweStraatGroep,
  formatNumber,
  formatPrice,
  isHoekadres,
  isKalendermaand,
  kantVan,
  komendeMaanden,
  volgendeMaand,
  patchCustomer,
  schuifStartOp,
  maandSleutel,
  prijsVoorMaand,
  toonMaand,
  regelKleur,
  tintAchtergrond,
  fetchMarkeringen,
  ritmeMaanden,
  matchesMaand,
  natuurlijkeKant,
  herstelStraatGroep,
  hernoemStraatGroep,
  persistCustomerOrder,
  persistGroepOrder,
  persistStreetOrder,
  setStreetDoorlopend,
  setStreetSortDesc,
  sortCustomers,
  splitEvenOdd,
  type Customer,
  type Kant,
  type District,
  verwijderStraatGroep,
  zetStratenInGroep,
  type MarkeringRij,
  type QuickNote,
  type StraatGroep,
  type Street,
} from "@/lib/klanten";
import { heeftRecht, useRecht } from "@/lib/rechten";
import { StopDialog } from "@/components/StopDialog";
import {
  draaiStoppenTerug,
  geplandeDagen,
  haalVanPlanning,
  zetInactief,
  zetPlanningTerug,
  type StopReden,
} from "@/lib/stoppen";
import { alDichtbij, datumSleutel, haalUitWasdagBewaard, zetWasdagTerug } from "@/lib/wasdag";
import { isWerkdag, useWerkdagenStatus } from "@/lib/werkdagen";

interface IndexSearch {
  wijk?: string;
  /** De dag die je aan het vullen bent, gekozen op /planning. */
  dag?: string;
}

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    await requireSession();
    // Dagplanning vastgezet op dit toestel: de app opent meteen op vandaag.
    if (typeof window !== "undefined" && naarDagBijOpstarten()) throw redirect({ to: "/dag" });
  },
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    ...(typeof search["wijk"] === "string" && search["wijk"] ? { wijk: search["wijk"] } : {}),
    ...(typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Wooshy — straten, prijzen en maandplanning" },
      {
        name: "description",
        content:
          "Beheer je glazenwasklanten per straat in een compacte tabel, met prijzen, notities en een filter voor even of oneven maanden.",
      },
      { property: "og:title", content: "Wooshy" },
      {
        property: "og:description",
        content:
          "Klanten per straat, prijzen, notities en printlijsten voor even of oneven maanden.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

/** De ronde die je bekijkt: een echte maand ("2026-09"), of een van de oude
 *  keuzes "alles" / "even" / "oneven". */
type MaandFilter = string;

/** Sta je midden in een dag te plannen, dan hoort een herlaadslag — of een
 *  telefoon die de pagina weggooit — je niet uit die modus te gooien. De
 *  datum onthouden we niet: dat is bijna altijd vandaag. */
const PLANMODUS_OPSLAG = "glazenwasapp.dagplanning-aan";

/** Wat er in het sneltoetsen-venster staat (toets ?). */
const WIJK_SNELTOETSEN: [string, string][] = [
  ["/", "Zoek straat"],
  ["Esc (in de zoekbalk)", "Zoekbalk loslaten, zoekopdracht blijft"],
  ["x", "Selecteren aan / uit"],
  ["⌘ / Ctrl + klik", "Adres of straat selecteren, slepen voor meer"],
  ["a", "Alles aanvinken / niets"],
  ["s", "Opslaan op de gekozen dag"],
  ["Esc", "Stoppen met selecteren"],
  ["m", "Maand kiezen"],
  ["← en →", "Vorige / volgende werkdag (tijdens selecteren)"],
  ["[ en ]", "Vorige / volgende maand"],
  ["e / o / 0", "Even / oneven / alles"],
  ["p", "Prijzen tonen / verbergen"],
  ["w", "Andere wijk"],
  ["n", "Nieuwe klant"],
  ["⌘ / Ctrl + P", "Printlijst"],
  ["⌘ / Ctrl + Z", "Ongedaan maken"],
  ["?", "Dit overzicht"],
];

function Index() {
  useRequireAuth();
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const navigate = useNavigate();
  const { wijk, dag } = Route.useSearch();
  const mobiel = useIsMobile();
  // Vangnet voor het slot op de dag: kwam de eerste pagina van de server,
  // dan zag beforeLoad geen localStorage en gebeurt het hier alsnog.
  useEffect(() => {
    if (naarDagBijOpstarten()) void navigate({ to: "/dag", replace: true });
    // Alleen bij het openen van de pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Een geldloper heeft hier niets te zoeken (geen planning): meteen naar
  // zijn lijst in Betalingen, in plaats van "Geen toegang".
  const { employee: ik } = useAuth();
  useEffect(() => {
    if (ik && !heeftRecht(ik, "planning") && heeftRecht(ik, "geldlopen")) {
      void navigate({ to: "/betalingen", search: { tab: "lopen" }, replace: true });
    }
  }, [ik, navigate]);
  // Telefoon en computer hebben elk hun eigen zoekbalk. Wissel je (tablet
  // draaien), dan begint de nieuwe leeg — dan hoort de lijst ook niet meer
  // op het oude woord gefilterd te staan.
  useEffect(() => {
    setZoektermen([]);
  }, [mobiel]);
  // Standaard de maand die je nu loopt, net als op de printlijst.
  const [filter, setFilter] = useState<MaandFilter>(() => maandSleutel(new Date()));
  const ronde = isKalendermaand(filter) ? filter : maandSleutel(new Date());
  const [zoektermen, setZoektermen] = useState<string[]>([]);
  const [prijzenTonen, setPrijzenTonen] = useState(true);
  // Standaard uit: de kolom kost ruimte van de notitie, en je zet hem aan
  // als je met de planning bezig bent.
  const [duurTonen, setDuurTonen] = useState(false);
  // Wat je ziet en wat je mag, per recht. De database dwingt het af; dit
  // zorgt dat er geen velden of knoppen staan die toch niets opslaan.
  const prijzenZien = useRecht("prijzen_zien");
  const magKlanten = useRecht("klanten_bewerken");
  const magPlannen = useRecht("planning");
  const toonPrijzen = prijzenTonen && prijzenZien;
  const [selectie, setSelectie] = useState<string[]>([]);
  /** Staat de selecteermodus aan? Dan vink je adressen aan zonder dat er al
   *  iets vastligt; met "Opslaan op …" zet je ze in één keer op de gekozen dag. */
  const [selecteren, setSelecteren] = useState(false);
  /** Wat je nu aangevinkt hebt. Los van `selectie`, dat over het slepen en
   *  herschikken van regels gaat. */
  const [keuze, setKeuze] = useState<Set<string>>(new Set());
  /** Kom je van de kalender, dan bewerk je een bestaande dag: dan hoort
   *  uitvinken dat adres er ook echt af te halen. Anders is dit leeg en voeg
   *  je alleen maar toe. */
  const [bewerktDag, setBewerktDag] = useState<string | null>(null);
  const [ingeklapt, setIngeklapt] = useState<Set<string>>(new Set());
  /** Op de telefoon: welke straten open staan. Andersom dan `ingeklapt`,
   *  want daar begint alles dicht. Hier en niet in de straat zelf, zodat een
   *  straat open blijft als hij even uit beeld is (zoeken, groep dicht). */
  const [openRegels, setOpenRegels] = useState<Set<string>>(new Set());
  const [sleep, setSleep] = useState<string | null>(null);
  const [klantDialog, setKlantDialog] = useState<{
    open: boolean;
    customer: Customer | null;
    streetId?: string;
    /** Getypt in "+ adres". */
    nummer?: string;
    sortOrder?: number;
  }>({
    open: false,
    customer: null,
  });
  /** Het schermpje "Straatnamen aanvullen"; het wijkmenu zet hem open. */
  const [straatnamenOpen, setStraatnamenOpen] = useState(false);
  const [straatDialog, setStraatDialog] = useState<{ open: boolean; street: Street | null }>({
    open: false,
    street: null,
  });
  /** Een stuk straat afsplitsen: wat je in de selecteermodus aangevinkt hebt
   *  gaat naar een nieuwe straat. Het schermpje vraagt alleen nog de naam. */
  const [splits, setSplits] = useState<{
    open: boolean;
    street: Street | null;
    adressen: Customer[];
  }>({ open: false, street: null, adressen: [] });
  /** Hernoemen als er een groep in staat; is die leeg en staat er een straat
   *  in, dan maakt het dialoogje een nieuwe groep met die straat erin. */
  const [groepDialog, setGroepDialog] = useState<{
    open: boolean;
    groep: StraatGroep | null;
    street?: Street | null;
  }>({
    open: false,
    groep: null,
  });
  // Het dossier is een schermpje op déze pagina. Eerder sprong de rechter-
  // muisknop naar /klanten met het klant-id in de url; bij een adres zonder
  // klant was dat id leeg en gebeurde er niets.
  const [dossier, setDossier] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [hoek, setHoek] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  /** Extra opdracht bij een adres: werk zonder maand. */
  const [stop, setStop] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });
  const [klus, setKlus] = useState<{ open: boolean; customer: Customer | null }>({
    open: false,
    customer: null,
  });

  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const quickNotesQuery = useQuery({ queryKey: ["quick_notes"], queryFn: fetchQuickNotes });
  const klantenQuery = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const groepenQuery = useQuery({ queryKey: ["straat_groepen"], queryFn: fetchStraatGroepen });
  const markeringQuery = useQuery({ queryKey: ["markeringen"], queryFn: fetchMarkeringen });

  // Alleen om de naam bij een gekoppelde regel te kunnen tonen; de
  // contactgegevens zelf horen op /klanten.
  const klantNamen = useMemo(
    () => new Map((klantenQuery.data ?? []).map((k) => [k.id, k.naam])),
    [klantenQuery.data],
  );

  const districts: District[] = districtsQuery.data ?? [];
  // De wijk waar je mee bezig bent blijft staan bij een paginawissel én bij
  // een volgende inlog — zie useActieveWijk.
  const actieveWijk = useActieveWijk(
    districts,
    wijk,
    // Zoekparameters meenemen: anders gooit deze omleiding de dag weg die je
    // net op de kalender koos.
    (id) => void navigate({ to: "/", search: (oud) => ({ ...oud, wijk: id }), replace: true }),
  );
  const wijkPlaats = districts.find((d) => d.id === actieveWijk)?.plaats ?? "";

  const alleStraten = useMemo(() => streetsQuery.data ?? [], [streetsQuery.data]);
  // Ook deze twee met een vaste identiteit: ze zijn de invoer van `groepen`,
  // en die levert de even/oneven-lijsten waar `memo` op StraatBlok op let.
  const streets = useMemo(
    () => alleStraten.filter((s) => s.district_id === actieveWijk),
    [alleStraten, actieveWijk],
  );
  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data]);
  const alleKlanten = klantenQuery.data ?? [];
  // Vaste identiteit, ook zolang de query nog laadt: elke verse lege array
  // zou `memo` op de regels breken.
  const quickNotes = useMemo(() => quickNotesQuery.data ?? [], [quickNotesQuery.data]);
  const alleGroepen = useMemo(() => groepenQuery.data ?? [], [groepenQuery.data]);
  /** Vaste identiteit, want elke regel krijgt deze lijst mee. */
  const markeringen = useMemo(() => markeringQuery.data ?? [], [markeringQuery.data]);
  /** De subgroepen van de wijk die je bekijkt, op volgorde. */
  const subgroepen = useMemo(
    () => alleGroepen.filter((g) => g.district_id === actieveWijk),
    [alleGroepen, actieveWijk],
  );
  const undoLabel = useLaatsteUndoLabel();

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["districts"] });
    qc.invalidateQueries({ queryKey: ["streets"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["straat_groepen"] });
  }

  function doeUndo() {
    return undoMetMelding(laatsteUndo(), "Niets om terug te draaien");
  }

  function meldUndo(bericht: string) {
    // Standaard verdwijnt een melding na ~4 seconden. Dat is te kort om te beslissen
    // of je een verwijdering terugdraait — de knop is weg voor je hem kunt raken.
    toast(bericht, {
      duration: 12000,
      action: undoKnop(),
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const doel = e.target as HTMLElement | null;
      const tikt =
        doel && (doel.tagName === "INPUT" || doel.tagName === "TEXTAREA" || doel.isContentEditable);
      // Staat er een vraag open (zoals "toch inplannen?"), dan wacht die op
      // een antwoord over de dag zoals hij nú is; terugdraaien zou dat
      // onder zijn voeten wegtrekken.
      // Alleen echte vensters (Radix zet data-state): het Paaltje-paneel is
      // ook een "dialog", maar staat vaak open terwijl je gewoon doorwerkt.
      const vraagOpen = document.querySelector(
        '[role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]',
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !tikt && !vraagOpen) {
        e.preventDefault();
        void doeUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groepen = useMemo(() => {
    // Meerdere zoektermen naast elkaar: een straat hoeft maar op één ervan te
    // passen, anders zou een tweede straat de eerste juist wegfilteren.
    const termen = zoektermen.map((t) => t.toLowerCase());
    return streets
      .filter((s) => !termen.length || termen.some((t) => s.name.toLowerCase().includes(t)))
      .map((s) => {
        const order: "asc" | "desc" = s.sort_desc ? "desc" : "asc";
        const klanten = customers.filter(
          (c) =>
            c.street_id === s.id &&
            (isKalendermaand(filter)
              ? aanDeBeurt(c, filter)
              : matchesMaand(c, filter as "alles" | "even" | "oneven")),
        );
        return {
          street: s,
          ...splitEvenOdd(klanten, order, s.doorlopend),
          aantal: klanten.length,
          totaal: klanten.reduce((sum, c) => sum + prijsVoorMaand(c, filter), 0),
        };
      });
  }, [streets, customers, filter, zoektermen]);

  const totaal = groepen.reduce((sum, g) => sum + g.aantal, 0);
  const omzet = groepen.reduce((sum, g) => sum + g.totaal, 0);

  /**
   * De straatblokken verdeeld over de subgroepen van deze wijk. Straten
   * zonder groep — en straten waarvan de groep net verwijderd is — komen in
   * `losseBlokken` en staan straks gewoon onder de groepen.
   *
   * De optelling per groep (aantal adressen, bedrag, de id's van de klanten
   * erin) gebeurt hier en niet in de kop zelf: die kop hangt aan de
   * sleepcontext en hertekent bij elke muisbeweging, en dan zou hij ook bij
   * elke muisbeweging opnieuw staan te rekenen.
   */
  const { secties, losseBlokken } = useMemo(() => {
    const perGroep = new Map<string, typeof groepen>();
    const los: typeof groepen = [];
    const bestaat = new Set(subgroepen.map((g) => g.id));
    for (const blok of groepen) {
      const id = blok.street.groep_id;
      if (!id || !bestaat.has(id)) {
        los.push(blok);
        continue;
      }
      const lijst = perGroep.get(id);
      if (lijst) lijst.push(blok);
      else perGroep.set(id, [blok]);
    }
    const lijsten = subgroepen.map((groep) => {
      const blokken = perGroep.get(groep.id) ?? [];
      return {
        groep,
        blokken,
        klantIds: blokken.flatMap((b) => [...b.even, ...b.oneven].map((c) => c.id)),
        aantal: blokken.reduce((sum, b) => sum + b.aantal, 0),
        totaal: blokken.reduce((sum, b) => sum + b.totaal, 0),
      };
    });
    return { secties: lijsten, losseBlokken: los };
  }, [groepen, subgroepen]);

  /** Zoek je, dan gaat een dichtgeklapte groep open: anders vind je iets en
   *  zie je het niet staan. */
  const zoekt = zoektermen.length > 0;
  /** Groepen waar de zoekterm niets van overlaat verdwijnen helemaal. */
  const zichtbareSecties = zoekt ? secties.filter((s) => s.blokken.length > 0) : secties;

  // --- Selecteren en inplannen -------------------------------------------
  // Je vinkt eerst aan wát je gaat doen, en zegt daarna pas wannéér. Wat er
  // op een dag staat is de planning; is die dag geweest, dan is het wat er
  // gedaan is. Zie src/lib/wasdag.ts.
  const wasdagQuery = useQuery({
    queryKey: ["wasdag", bewerktDag],
    queryFn: () => fetchWasdag(bewerktDag!),
    enabled: bewerktDag !== null,
  });
  const dagRegels = useMemo(() => wasdagQuery.data ?? [], [wasdagQuery.data]);

  // Bewerk je een bestaande dag, dan staat die eerst aangevinkt. Eén keer,
  // bij het binnenkomen: daarna is de selectie van jou.
  const gevuldVoor = useRef<string | null>(null);
  /** Wat er volgens de database op de dag stond toen we de vinkjes voor het
   *  laatst bijwerkten. Daartegen zien we wat er elders veranderde. */
  const vorigeStand = useRef<Set<string>>(new Set());
  // De dag zoals hij binnenkwam; ook een oude stand die op de achtergrond
  // opnieuw opgehaald wordt telt, anders zet een haperende verbinding de
  // dag op slot.
  const dagData = wasdagQuery.data;
  useEffect(() => {
    // Pas met verse gegevens: een oude stand uit de cache zou een adres dat
    // intussen (op de telefoon) op de dag gezet is als "eraf" tonen.
    if (!bewerktDag || !dagData || wasdagQuery.isFetching) return;
    const opDag = new Set(dagRegels.map((r) => r.customer_id).filter(Boolean) as string[]);
    if (gevuldVoor.current !== bewerktDag) {
      gevuldVoor.current = bewerktDag;
      vorigeStand.current = opDag;
      // Samen met wat je al aanvinkte: begon je met een veeg of Cmd-klik,
      // dan stond de dag nog niet klaar, en die vinkjes horen te blijven.
      setKeuze((huidig) => new Set([...huidig, ...opDag]));
      return;
    }
    // Veranderde de dag elders — op de telefoon, door Ongedaan maken — dan
    // lopen de vinkjes mee. Anders telt dat als "eraf" of "erbij", en haalt
    // Opslaan iets weg wat je nooit zelf uitvinkte.
    const oud = vorigeStand.current;
    const bij = [...opDag].filter((id) => !oud.has(id));
    const af = [...oud].filter((id) => !opDag.has(id));
    vorigeStand.current = opDag;
    if (bij.length === 0 && af.length === 0) return;
    setKeuze((huidig) => {
      const nu = new Set(huidig);
      for (const id of bij) nu.add(id);
      for (const id of af) nu.delete(id);
      return nu;
    });
  }, [bewerktDag, dagData, wasdagQuery.isFetching, dagRegels]);

  // Er is altijd precies één dag gekozen zolang je selecteert: standaard
  // vandaag, of de eerstvolgende werkdag. Eén dag en één knop "Opslaan op …",
  // zodat het nooit op een andere dag belandt dan je ziet.
  // Pas als de werkdagen echt binnen zijn: tot dan zijn het ma–vr, en dan
  // zou een zaterdagwerker op zaterdag bij maandag beginnen.
  const { werkdagen: werkdagenLijst, geladen: werkdagenGeladen } = useWerkdagenStatus();
  const standaardDag = komendeDagen(werkdagenLijst)[0]?.datum ?? vandaag();
  useEffect(() => {
    if (selecteren && !bewerktDag && werkdagenGeladen) setBewerktDag(standaardDag);
  }, [selecteren, bewerktDag, standaardDag, werkdagenGeladen]);

  /** Wat er verandert als je nu opslaat. Zolang de dag laadt: niets. */
  const dagGevuld = bewerktDag !== null && gevuldVoor.current === bewerktDag;
  const { erbij, eraf } = useMemo(() => {
    if (!bewerktDag || !dagData || !dagGevuld) return { erbij: 0, eraf: 0 };
    const opDag = new Set(dagRegels.map((r) => r.customer_id).filter(Boolean) as string[]);
    return {
      erbij: [...keuze].filter((id) => !opDag.has(id)).length,
      eraf: [...opDag].filter((id) => !keuze.has(id)).length,
    };
  }, [bewerktDag, dagData, dagGevuld, dagRegels, keuze]);
  const nietOpgeslagen = erbij + eraf > 0;

  /** Wat je aangevinkt hebt kost bij elkaar dit; daar stuur je op als je een
   *  dag samenstelt. Over alle wijken heen, want je kunt van wijk wisselen. */
  const keuzeBedrag = useMemo(() => {
    const perId = new Map(customers.map((c) => [c.id, c]));
    let som = 0;
    for (const id of keuze) {
      const c = perId.get(id);
      if (c) som += prijsVoorMaand(c, ronde);
    }
    return som;
  }, [keuze, customers, ronde]);

  // Zolang een bestaande dag nog binnenkomt weten we niet wat er al op staat;
  // de vinkjes staan dan uit, anders vink je tegen een leeg antwoord aan.
  const dagKlaar = bewerktDag === null || (dagData !== undefined && dagGevuld);

  // Wat er deze maand al op een ándere dag staat. Plan je morgen, dan zie je
  // zo welke adressen vandaag al gedaan zijn — je wil ze niet twee keer in
  // dezelfde maand. Verder dan de maand van de dag die je plant kijken we
  // nooit, dus op de eerste van de maand staat de teller vanzelf weer op nul.
  // Zonder gekozen dag kijken we naar de maand die je bekijkt; bewerk je een
  // bestaande dag, dan naar die van die dag.
  const maand = maandGrenzen(bewerktDag ?? `${ronde}-01`);
  const maandQuery = useQuery({
    queryKey: ["wasdagen", maand.vanaf, maand.tot],
    queryFn: () => fetchWasdagen(maand.vanaf, maand.tot),
    enabled: selecteren,
  });
  const nu = vandaag();
  // Los van de maandplanning, want dit moet ook buiten de selecteermodus te
  // zien zijn: het zijn er hooguit een handvol per maand.
  const nietGewassenQuery = useQuery({
    queryKey: ["niet-gewassen", maand.vanaf, maand.tot],
    queryFn: () => fetchNietGewassen(maand.vanaf, maand.tot),
    staleTime: 60_000,
  });
  const nietGewassen = useMemo(() => {
    const uit = new Map<string, string>();
    for (const r of nietGewassenQuery.data ?? []) {
      const was = uit.get(r.customer_id);
      if (!was || r.datum > was) uit.set(r.customer_id, r.datum);
    }
    return uit;
  }, [nietGewassenQuery.data]);
  // Twee losse verzamelingen, want ze betekenen iets anders: wat achter je
  // ligt is gedaan, wat voor je ligt staat al ergens anders ingepland.
  // Per adres ook de dag, zodat de regel kan zeggen wánneer: bij gewassen de
  // laatste keer, bij gepland de eerstvolgende.
  const { eerderGewassen, elderGepland } = useMemo(() => {
    const gewassen = new Map<string, string>();
    const gepland = new Map<string, string>();
    for (const r of maandQuery.data ?? []) {
      if (r.datum === bewerktDag || !r.customer_id) continue;
      // Aan de deur teruggemeld: de dag staat er nog, maar er is niets
      // gedaan. Die telt dus niet als gewassen en ook niet als ingepland —
      // het adres moet juist nog een beurt krijgen.
      if (r.niet_gewassen) {
        continue;
      } else if (r.datum <= nu) {
        const was = gewassen.get(r.customer_id);
        if (!was || r.datum > was) gewassen.set(r.customer_id, r.datum);
      } else {
        const was = gepland.get(r.customer_id);
        if (!was || r.datum < was) gepland.set(r.customer_id, r.datum);
      }
    }
    // Al gewassen weegt zwaarder: dat adres is deze maand klaar, ook als er
    // verderop nog een dag voor openstaat.
    for (const id of gewassen.keys()) gepland.delete(id);
    return { eerderGewassen: gewassen, elderGepland: gepland };
  }, [maandQuery.data, bewerktDag, nu]);

  function selecteermodus(aan: boolean) {
    setSelecteren(aan);
    if (!aan) {
      // Bij het verlaten alleen de selectie leeg: dan ga je weer regels
      // bijwerken in plaats van een dag samenstellen. Wat je zelf in- of
      // uitgeklapt hebt blijft staan; dat is jouw keuze, niet die van de modus.
      setKeuze(new Set());
      setBewerktDag(null);
      gevuldVoor.current = null;
    }
    try {
      if (aan) localStorage.setItem(PLANMODUS_OPSLAG, "ja");
      else localStorage.removeItem(PLANMODUS_OPSLAG);
    } catch {
      // Privémodus of geblokkeerde opslag: dan begin je gewoon buiten de modus.
    }
  }

  useEffect(() => {
    // Kom je van de kalender, dan bewerk je die dag en staat wat erop staat
    // alvast aangevinkt. Anders val je terug op de onthouden modus.
    if (dag) {
      setSelecteren(true);
      setBewerktDag(dag);
      try {
        localStorage.setItem(PLANMODUS_OPSLAG, "ja");
      } catch {
        /* zie selecteermodus() */
      }
      return;
    }
    try {
      if (localStorage.getItem(PLANMODUS_OPSLAG) === "ja") setSelecteren(true);
    } catch {
      /* zie selecteermodus() */
    }
  }, [dag]);

  /** Het in- en uitklappen loopt voor straten en groepen door dezelfde `Set`.
   *  Een groep staat erin als "groep:<id>", een straat gewoon als zijn eigen
   *  id — zo hoeft er maar één ding onthouden en omgezet te worden. */
  function groepSleutel(id: string) {
    return `groep:${id}`;
  }

  const allesIngeklapt =
    groepen.length > 0 &&
    groepen.every((g) => ingeklapt.has(g.street.id)) &&
    secties.every((s) => ingeklapt.has(groepSleutel(s.groep.id)));

  function klapAlles() {
    setIngeklapt(
      allesIngeklapt
        ? new Set()
        : new Set([
            ...groepen.map((g) => g.street.id),
            ...secties.map((s) => groepSleutel(s.groep.id)),
          ]),
    );
  }

  function klapRegel(id: string, open?: boolean) {
    setOpenRegels((was) => {
      const nu = new Set(was);
      if (open ?? !nu.has(id)) nu.add(id);
      else nu.delete(id);
      return nu;
    });
  }

  function klapStraat(id: string) {
    setIngeklapt((was) => {
      const nu = new Set(was);
      if (!nu.delete(id)) nu.add(id);
      return nu;
    });
  }

  /**
   * Zet adressen in of uit de selectie. Puur lokaal: er gaat pas iets naar de
   * database als je op "Opslaan op …" klikt. Dat is het hele punt van de
   * selecteermodus — je kunt vrij aanvinken zonder dat er een dag vastligt.
   */
  function pasKeuzeAan(erbij: string[], eraf: string[]) {
    if (!dagKlaar) return;
    setKeuze((was) => {
      const nu = new Set(was);
      for (const id of erbij) nu.add(id);
      for (const id of eraf) nu.delete(id);
      return nu;
    });
  }

  /**
   * Zet de selectie op een dag. Bewerk je een bestaande dag, dan gaat wat je
   * uitvinkte er ook echt af; kwam je hier zonder dag, dan voeg je alleen toe
   * — anders zou inplannen op donderdag je dinsdag stilletjes leegvegen.
   */
  /** Loopt er al een inplanning? Een dubbelklik op "Vandaag" zou anders
   *  alles twee keer doen: twee vragen, twee meldingen, twee keer ongedaan. */
  const inplanBezig = useRef(false);
  /** Geeft terug of het gelukt is (of er niets te doen was). */
  async function planIn(datum: string): Promise<boolean> {
    if (inplanBezig.current) return false;
    inplanBezig.current = true;
    try {
      return await planInWerk(datum);
    } finally {
      inplanBezig.current = false;
    }
  }

  /**
   * Naar een andere dag vanuit de weekstrook. Staat er nog iets aangevinkt
   * dat niet op de dag staat, dan eerst vragen: anders ben je dat kwijt.
   */
  async function naarDag(datum: string) {
    if (datum === bewerktDag) return;
    const gewijzigd = bewerktDag ? nietOpgeslagen : keuze.size > 0;
    if (gewijzigd && bewerktDag) {
      const opslaan = await bevestig({
        titel: `Eerst ${toonDatum(bewerktDag)} opslaan?`,
        tekst: "Wat je aan- of uitvinkte staat nog niet op die dag.",
        bevestigLabel: "Opslaan",
        annuleerLabel: "Terug",
      });
      if (!opslaan || !(await planIn(bewerktDag))) return;
    } else if (gewijzigd) {
      const loslaten = await bevestig({
        titel: "Selectie loslaten?",
        tekst: `Je hebt ${keuze.size} ${keuze.size === 1 ? "adres" : "adressen"} aangevinkt die nog op geen dag staan. Zet ze eerst op een dag met de knoppen onderin.`,
        bevestigLabel: "Loslaten",
        annuleerLabel: "Terug",
        gevaarlijk: true,
      });
      if (!loslaten) return;
    }
    setKeuze(new Set());
    gevuldVoor.current = null;
    setBewerktDag(datum);
    // Kwam je van de kalender, dan staat de dag in de adresbalk; die gaat
    // mee, anders zet herladen je terug op de oude dag.
    if (dag) void navigate({ to: "/", search: (oud) => ({ ...oud, dag: datum }), replace: true });
  }

  /** Stoppen met selecteren; met iets wat nog niet opgeslagen is eerst vragen. */
  async function stopSelecteren() {
    if (nietOpgeslagen && bewerktDag) {
      const weg = await bevestig({
        titel: `Wijzigingen op ${toonDatum(bewerktDag)} niet opgeslagen`,
        tekst: "Stop je nu, dan gaan ze verloren. Tik op Terug om ze nog op te slaan.",
        bevestigLabel: "Weggooien",
        annuleerLabel: "Terug",
        gevaarlijk: true,
      });
      if (!weg) return;
    }
    selecteermodus(false);
  }
  function wisselSelecteren() {
    if (selecteren) void stopSelecteren();
    else selecteermodus(true);
  }

  // De vraag bij adressen die al kort ervoor of erna staan: per adres
  // verplaatsen, allebei of niet. Als belofte, zodat planInWerk erop wacht.
  const [dubbelOpen, setDubbelVraag] = useState<DubbelVraag | null>(null);
  const dubbelAntwoord = useRef<((k: Map<string, DubbelKeuze> | null) => void) | null>(null);
  function vraagDubbel(rijen: DubbelRij[], datum: string) {
    return new Promise<Map<string, DubbelKeuze> | null>((klaar) => {
      dubbelAntwoord.current = klaar;
      setDubbelVraag({ rijen, datum });
    });
  }
  function beantwoordDubbel(k: Map<string, DubbelKeuze> | null) {
    setDubbelVraag(null);
    dubbelAntwoord.current?.(k);
    dubbelAntwoord.current = null;
  }
  function adresLabel(id: string) {
    const c = customers.find((x) => x.id === id);
    if (!c) return "Onbekend adres";
    const straat = streets.find((x) => x.id === c.street_id)?.name ?? "";
    return `${straat} ${formatNumber(c)}`.trim();
  }

  async function planInWerk(datum: string): Promise<boolean> {
    const perId = new Map(customers.map((c) => [c.id, c]));
    const bestaand = datum === bewerktDag ? dagRegels : await fetchWasdag(datum);
    const alErop = new Set(bestaand.map((r) => r.customer_id).filter(Boolean) as string[]);
    const nieuweIds = [...keuze].filter((id) => !alErop.has(id) && perId.has(id));

    // Staat een adres binnen twee weken al op een andere dag, dan is het
    // meestal dubbel (een straat twee keer aangevinkt). Twee keer in een
    // maand kan wel kloppen, dus we vragen het in plaats van te weigeren.
    let dichtbij: Map<string, string>;
    try {
      dichtbij = await alDichtbij(datum, nieuweIds, datum);
    } catch {
      toast.error("Kon niet ophalen wat er rond die dag al ingepland staat.");
      return false;
    }
    let keuzes = new Map<string, DubbelKeuze>();
    if (dichtbij.size > 0) {
      const nu = vandaag();
      const antwoord = await vraagDubbel(
        [...dichtbij].map(([id, oud]) => ({
          id,
          label: adresLabel(id),
          oudeDatum: oud,
          gewassen: oud <= nu,
        })),
        datum,
      );
      // Annuleren: niets opslaan, ook de rest niet.
      if (!antwoord) return false;
      keuzes = antwoord;
    }
    const nietIds = [...keuzes].filter(([, k]) => k === "niet").map(([id]) => id);
    const overslaan = nietIds.length > 0;
    // Wat niet op deze dag komt niet aangevinkt laten staan: dan lijkt het
    // alsof het toch op de dag staat.
    if (overslaan) pasKeuzeAan([], nietIds);
    // Verplaatsen: per oude dag de adressen die daar af moeten.
    const verplaatsPerDag = new Map<string, string[]>();
    for (const [id, k] of keuzes) {
      if (k !== "verplaatsen") continue;
      const oud = dichtbij.get(id)!;
      verplaatsPerDag.set(oud, [...(verplaatsPerDag.get(oud) ?? []), id]);
    }

    const toevoegen = nieuweIds
      .filter((id) => keuzes.get(id) !== "niet")
      .map((id) => ({ customer_id: id, prijs: prijsVoorMaand(perId.get(id)!, ronde) }));

    // Alleen bij het bewerken van een dag: wat je uitvinkte hoort eraf.
    const weghalen =
      datum === bewerktDag
        ? bestaand
            .filter((r) => r.customer_id && !keuze.has(r.customer_id))
            .map((r) => ({ customer_id: r.customer_id!, prijs: Number(r.prijs) }))
        : [];

    if (toevoegen.length === 0 && weghalen.length === 0) {
      toast(overslaan ? "Niets ingepland." : `${toonDatum(datum)} stond al zo ingepland.`);
      return true;
    }
    let verplaatst = 0;
    const verplaatsKenmerken: string[] = [];

    // Wat eraf gaat bewaart de database, met het bedrag van die keer: zo zet
    // ongedaan maken ook een aangepaste dagprijs terug.
    let kenmerk: string | null = null;
    try {
      // Eerst weghalen (dat levert het kenmerk op), dan toevoegen: zo is er
      // altijd iets om terug te zetten, ook als het toevoegen misgaat.
      if (weghalen.length > 0) {
        kenmerk = await haalUitWasdagBewaard(
          datum,
          weghalen.map((r) => r.customer_id),
        );
      }
      await voegToeAanWasdag(datum, toevoegen);
    } catch (e) {
      toast.error(
        "Inplannen mislukt: " +
          (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
      );
      const terug = [kenmerk, ...verplaatsKenmerken].filter(Boolean) as string[];
      if (terug.length > 0) {
        pushUndo({
          label: `Uitvinken ${toonDatum(datum)}`,
          undo: async () => {
            for (const k of terug) await zetWasdagTerug(k);
            qc.invalidateQueries({ queryKey: ["wasdag"] });
            qc.invalidateQueries({ queryKey: ["wasdagen"] });
          },
        });
      }
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
      return false;
    }

    // Pas ná het toevoegen van de oude dag af: mislukt het toevoegen, dan
    // staat het adres tenminste nog ergens. Mislukt dít, dan is de nieuwe dag
    // wél gelukt; dat zeggen we dan ook, in plaats van "mislukt".
    for (const [oud, ids] of verplaatsPerDag) {
      try {
        const k = await haalUitWasdagBewaard(oud, ids);
        if (k) verplaatsKenmerken.push(k);
        verplaatst += ids.length;
      } catch {
        toast.error(
          `Ingepland op ${toonDatum(datum)}, maar van ${toonDatum(oud)} halen lukte niet. Die staan nu op beide dagen.`,
        );
      }
    }

    pushUndo({
      label: `Inplannen ${toonDatum(datum)}`,
      undo: async () => {
        await Promise.all([
          haalUitWasdag(
            datum,
            toevoegen.map((r) => r.customer_id),
          ),
          zetWasdagTerug(kenmerk),
          // Wat verplaatst werd staat weer op zijn oude dag.
          ...verplaatsKenmerken.map((k) => zetWasdagTerug(k)),
        ]);
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        qc.invalidateQueries({ queryKey: ["niet-gewassen"] });
      },
    });

    qc.invalidateQueries({ queryKey: ["wasdag"] });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    // Een adres dat weer op een dag staat, is ingehaald: het rode labeltje
    // "nog wassen" hoort er dan meteen af te gaan.
    qc.invalidateQueries({ queryKey: ["niet-gewassen"] });
    // Je bewerkt vanaf nu díe dag: vink je daarna nog iets uit, dan gaat het
    // er ook af in plaats van dat er niets gebeurt.
    setBewerktDag(datum);
    gevuldVoor.current = datum;
    // Aangevinkt is voortaan precies wat er op de dag staat: wat er al stond
    // plus wat erbij kwam. Stonden er al adressen op een andere dag dan die
    // je bewerkte, dan waren die niet aangevinkt, en zou een volgende keer
    // opslaan ze eraf halen alsof je ze uitgevinkt had.
    const erafIds = new Set(weghalen.map((r) => r.customer_id));
    // Meteen de nieuwe stand van de dag in de cache: anders vergelijkt de
    // teller nog even met de oude, staat er weer "Opslaan", en sla je met
    // een tweede tik alles nog eens op.
    vorigeStand.current = new Set([
      ...[...alErop].filter((id) => !erafIds.has(id)),
      ...toevoegen.map((r) => r.customer_id),
    ]);
    qc.setQueryData<WasdagRegel[]>(
      ["wasdag", datum],
      [
        ...bestaand.filter((r) => !r.customer_id || !erafIds.has(r.customer_id)),
        ...toevoegen.map((r) => ({ customer_id: r.customer_id, prijs: r.prijs, notitie: null })),
      ],
    );
    setKeuze(
      new Set([
        ...[...alErop].filter((id) => !erafIds.has(id)),
        ...toevoegen.map((r) => r.customer_id),
      ]),
    );

    const erbij = toevoegen.length;
    const eraf = weghalen.length;
    toast.success(
      eraf === 0
        ? `${erbij} ${erbij === 1 ? "adres" : "adressen"} ingepland op ${toonDatum(datum)}${
            verplaatst ? ` (${verplaatst} verplaatst)` : ""
          }${overslaan ? ` (${nietIds.length} niet)` : ""}`
        : `${toonDatum(datum)} bijgewerkt: ${erbij} erbij, ${eraf} eraf`,
      {
        duration: 10000,
        action: undoKnop(),
      },
    );
    return true;
  }

  function zetStraatOpDag(g: (typeof groepen)[number], aan: boolean) {
    const ids = [...g.even, ...g.oneven].map((c) => c.id);
    pasKeuzeAan(aan ? ids : [], aan ? [] : ids);
  }

  /** Alles in beeld aan- of uitvinken. Kijkt naar de wijk die je bekijkt en
   *  naar je zoekfilter: wat je niet ziet, vink je ook niet aan. */
  const alleZichtbare = useMemo(
    () => groepen.flatMap((g) => [...g.even, ...g.oneven].map((c) => c.id)),
    [groepen],
  );
  const allesGekozen = alleZichtbare.length > 0 && alleZichtbare.every((id) => keuze.has(id));

  function wisselAlles() {
    pasKeuzeAan(allesGekozen ? [] : alleZichtbare, allesGekozen ? alleZichtbare : []);
  }

  /**
   * Maanden overslaan voor alles wat je aangevinkt hebt. Elk adres krijgt
   * dezelfde maanden erbij; `schuifStartOp` blijft per adres gelden, want een
   * adres dat nog moet beginnen schuift op in plaats van een pauze te krijgen.
   */
  async function slaKeuzeOver(maanden: string[]) {
    await slaSelectieOver(
      customers.filter((c) => keuze.has(c.id)),
      maanden,
      qc,
    );
  }

  /** De pauzes weghalen bij alles wat aangevinkt staat. */
  async function wisOverslaanVanKeuze() {
    await wisOverslaanVanSelectie(
      customers.filter((c) => keuze.has(c.id)),
      qc,
    );
  }

  // --- Slepen om te selecteren -------------------------------------------
  // Eén streek: het eerste vakje bepaalt of je aan- of uitzet, alles wat je
  // daarna aanraakt volgt diezelfde kant op. Zou elk vakje omschakelen, dan
  // zou je bij het terugslepen je eigen werk weer uitvinken.
  type Punt = { x: number; y: number };
  type Verf = {
    aan: boolean;
    laatste: string | null;
    /** Waar de vorige stap eindigde, om de lijn ertussen af te lopen. */
    vorig: Punt | null;
  };
  const verf = useRef<Verf | null>(null);
  const [verfBezig, setVerfBezig] = useState(false);
  /** Een streek eindigt met een klik; die mag niet nóg eens omschakelen. */
  const negeerKlik = useRef(false);
  /** Telt de streken, zodat een late opruimactie de volgende niet raakt. */
  const streekNr = useRef(0);
  /** Loopt er een streek met twee vingers? Dan volgen we alleen de eerste. */
  const tweeVingers = useRef(false);

  /** Past de streek toe op wat er onder de muis of vinger ligt. */
  function verfOpPunt(x: number, y: number) {
    const v = verf.current;
    if (!v) return;
    const el = document.elementFromPoint(x, y);
    const groepEl = el?.closest<HTMLElement>("[data-verf-groep]");
    const straatEl = el?.closest<HTMLElement>("[data-verf-straat]");
    const klantEl = el?.closest<HTMLElement>("[data-verf-klant]");
    const id =
      groepEl?.dataset["verfGroep"] ??
      straatEl?.dataset["verfStraat"] ??
      klantEl?.dataset["verfKlant"];
    if (!id || id === v.laatste) return;
    v.laatste = id;
    negeerKlik.current = true;

    // Een groepkop staat voor alles wat eronder hangt, een straatkop voor die
    // ene straat, en anders is het het adres zelf.
    const ids = groepEl
      ? (secties.find((x) => x.groep.id === id)?.klantIds ?? [])
      : straatEl
        ? (groepen.find((x) => x.street.id === id)?.even ?? [])
            .concat(groepen.find((x) => x.street.id === id)?.oneven ?? [])
            .map((c) => c.id)
        : [id];
    pasKeuzeAan(v.aan ? ids : [], v.aan ? [] : ids);
  }

  /**
   * Begint een streek en past hem meteen toe op het vakje waar je indrukt.
   * Anders zou het beginpunt overgeslagen worden als je in één beweging
   * doorsleept naar een volgende straat.
   */
  function startVerf(aan: boolean, x: number, y: number) {
    streekNr.current++;
    verf.current = { aan, laatste: null, vorig: { x, y } };
    negeerKlik.current = false;
    setVerfBezig(true);
    verfOpPunt(x, y);
  }

  /**
   * Loopt de lijn af tussen de vorige en de nieuwe muispositie. Beweeg je
   * snel, dan liggen de meetpunten tientallen pixels uit elkaar en springt de
   * muis zo over hele straten heen; dan zou je ze overslaan.
   */
  function verfOpLijn(naar: Punt) {
    const v = verf.current;
    if (!v) return;
    const van = v.vorig ?? naar;
    v.vorig = naar;
    const dx = naar.x - van.x;
    const dy = naar.y - van.y;
    // Om de ~8 px kijken: dat is fijner dan de kleinste straatkop hoog is.
    const stappen = Math.min(80, Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)));
    for (let i = 1; i <= stappen; i++) {
      verfOpPunt(van.x + (dx * i) / stappen, van.y + (dy * i) / stappen);
    }
  }

  function rondVerfAf(aanraking = false) {
    const v = verf.current;
    verf.current = null;
    setVerfBezig(false);
    // Eindigt een streek buiten een straatkop, dan volgt er geen klik meer en
    // zou de vlag blijven staan — en de eerstvolgende gewone klik opslokken.
    // Op een iPhone komt de klik soms pas ná een timeout van 0 binnen; dan
    // zou hij het vakje terugzetten. Daarom even wachten, maar alleen voor
    // déze streek: begint er intussen een nieuwe, dan laten we die met rust.
    // Met de muis komt de klik wél meteen, dus daar gewoon direct.
    const nr = streekNr.current;
    setTimeout(
      () => {
        if (streekNr.current === nr) negeerKlik.current = false;
      },
      aanraking ? 500 : 0,
    );
  }

  /** Staat alles onder dit punt al op de dag? Dan haalt een streek die hier
   *  begint het eraf, anders zet hij het erop. */
  function alGekozenOp(x: number, y: number) {
    const el = document.elementFromPoint(x, y);
    const groep = el?.closest<HTMLElement>("[data-verf-groep]")?.dataset["verfGroep"];
    const straat = el?.closest<HTMLElement>("[data-verf-straat]")?.dataset["verfStraat"];
    const klant = el?.closest<HTMLElement>("[data-verf-klant]")?.dataset["verfKlant"];
    const ids = groep
      ? (secties.find((x) => x.groep.id === groep)?.klantIds ?? [])
      : straat
        ? [
            ...(groepen.find((x) => x.street.id === straat)?.even ?? []),
            ...(groepen.find((x) => x.street.id === straat)?.oneven ?? []),
          ].map((c) => c.id)
        : klant
          ? [klant]
          : null;
    if (!ids) return null;
    return ids.length > 0 && ids.every((id) => keuze.has(id));
  }

  // De streek loopt door buiten het vakje waar hij begon, dus hangen deze
  // luisteraars aan het venster. `elementFromPoint` in plaats van
  // pointerenter: bij aanraken vangt het startvakje alle verdere events.
  const verfRef = useRef<(naar: Punt) => void>(() => {});
  verfRef.current = verfOpLijn;
  useEffect(() => {
    if (!verfBezig) return;
    let frame = 0;
    let punt: Punt | null = null;
    const beweeg = (e: PointerEvent) => {
      // Bij twee vingers stuurt elke vinger zijn eigen events; dan zou de
      // streek heen en weer springen. Die volgen we via de touch-events.
      if (tweeVingers.current && e.pointerType === "touch") return;
      punt = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (punt) verfRef.current(punt);
      });
    };
    const stop = (e: PointerEvent) => {
      if (tweeVingers.current && e.pointerType === "touch") return;
      rondVerfAf(e.pointerType === "touch");
    };
    window.addEventListener("pointermove", beweeg);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", beweeg);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [verfBezig]);

  // Met twee vingers vegen selecteert op de telefoon: met één vinger scroll
  // je, dus daar kan een streek niet op. Begint de streek op iets wat al
  // aangevinkt is, dan vinkt hij juist uit — net als met de muis.
  //
  // Staat de selecteermodus nog uit, dan zet de streek hem aan: vegen ís
  // selecteren, daar hoef je niet eerst het ⋯-menu voor in.
  const streekStart = (aan: boolean, x: number, y: number) => {
    if (!selecteren) {
      // Met de modus verschijnt er bovenin een balk en schuift de lijst
      // omlaag. Dan zou de streek verderlopen over de regel erboven — of
      // de straatkop, en dan pakt hij de hele straat. Onthoud waar het vakje
      // stond, zodat we het na het tekenen weer onder de vinger zetten.
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-verf-klant], [data-verf-straat], [data-verf-groep]");
      if (el) anker.current = { el, top: el.getBoundingClientRect().top };
      selecteermodus(true);
    }
    startVerf(aan, x, y);
  };
  const anker = useRef<{ el: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anker.current;
    anker.current = null;
    if (!a || !a.el.isConnected) return;
    const verschil = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(verschil) < 1) return;
    // Het dichtstbijzijnde vlak dat scrollt, anders het venster zelf.
    let ouder = a.el.parentElement;
    while (ouder && !/(auto|scroll)/.test(getComputedStyle(ouder).overflowY)) {
      ouder = ouder.parentElement;
    }
    (ouder ?? window).scrollBy(0, verschil);
  }, [selecteren]);
  const tweeVingerRef = useRef({ streekStart, rondVerfAf, alGekozenOp, dagKlaar });
  tweeVingerRef.current = { streekStart, rondVerfAf, alGekozenOp, dagKlaar };
  useEffect(() => {
    if (!magPlannen) return;
    let frame = 0;
    let wachtend: Punt | null = null;
    const eerste = (e: TouchEvent) => {
      const t = e.touches[0]!;
      return { x: t.clientX, y: t.clientY };
    };
    const begin = (e: TouchEvent) => {
      // Een nieuwe eerste vinger: is een vorige streek nooit netjes geëindigd
      // (het vakje onder je vinger verdween), ruim hem dan nu op.
      if (e.touches.length === 1 && tweeVingers.current) einde();
      if (e.touches.length !== 2 || tweeVingers.current || !tweeVingerRef.current.dagKlaar) return;
      const { x, y } = eerste(e);
      // Lag de eerste vinger al op een kopvinkje, dan loopt er al een streek
      // die dat vinkje heeft omgezet. Die kant houden we aan; anders ziet
      // de veeg het net aangevinkte en gaat hij juist uitvinken.
      const lopend = verf.current?.aan;
      const gekozen = tweeVingerRef.current.alGekozenOp(x, y);
      if (lopend === undefined && gekozen === null) return;
      // Geen scrollen en geen inzoomen zolang de streek loopt.
      e.preventDefault();
      tweeVingers.current = true;
      tweeVingerRef.current.streekStart(lopend ?? !gekozen, x, y);
    };
    const beweeg = (e: TouchEvent) => {
      if (!tweeVingers.current) return;
      e.preventDefault();
      wachtend = eerste(e);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (wachtend) verfRef.current(wachtend);
        wachtend = null;
      });
    };
    const einde = () => {
      if (!tweeVingers.current) return;
      tweeVingers.current = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // De laatste beweging nog meenemen, anders mist de streek het vakje
      // waar je je vingers optilt.
      if (wachtend) verfRef.current(wachtend);
      wachtend = null;
      tweeVingerRef.current.rondVerfAf();
      // Na twee vingers volgt er geen klik die opgevangen moet worden; een
      // tik die er meteen op volgt is gewoon een nieuwe tik.
      negeerKlik.current = false;
    };
    // Safari heeft voor knijpen een eigen event; ook dat mag niet zoomen.
    const geenZoom = (e: Event) => {
      if (tweeVingers.current) e.preventDefault();
    };
    document.addEventListener("touchstart", begin, { passive: false });
    document.addEventListener("touchmove", beweeg, { passive: false });
    document.addEventListener("touchend", einde);
    document.addEventListener("touchcancel", einde);
    document.addEventListener("gesturestart", geenZoom);
    return () => {
      document.removeEventListener("touchstart", begin);
      document.removeEventListener("touchmove", beweeg);
      document.removeEventListener("touchend", einde);
      document.removeEventListener("touchcancel", einde);
      document.removeEventListener("gesturestart", geenZoom);
      if (frame) cancelAnimationFrame(frame);
      einde();
    };
  }, [magPlannen]);

  // Op de computer hetzelfde met Cmd-klik (Mac) of Ctrl-klik (Windows): klik
  // of sleep over adressen, straten of groepen. Op een Mac blijft Ctrl-klik
  // het rechtermuismenu, zoals overal op de Mac.
  useEffect(() => {
    if (!magPlannen) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    let slikKlik = false;
    const druk = (e: PointerEvent) => {
      // Kwam er na de vorige streek geen klik, dan mag die deze niet opeten.
      slikKlik = false;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (!(mac ? e.metaKey : e.ctrlKey)) return;
      const r = tweeVingerRef.current;
      if (!r.dagKlaar) return;
      const gekozen = r.alGekozenOp(e.clientX, e.clientY);
      if (gekozen === null) return;
      // Vóór React: geen notitie die opengaat, geen regel die gaat slepen.
      e.preventDefault();
      e.stopPropagation();
      slikKlik = true;
      // Stond je nog in een notitie of prijs te typen, dan eruit: anders
      // gaat wat je typt nog naar dat veld terwijl de regel op slot gaat.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      r.streekStart(!gekozen, e.clientX, e.clientY);
    };
    // De mousedown die erbij hoort ook: die zou anders een veld de cursor
    // geven of een sleep beginnen.
    const muisOmlaag = (e: MouseEvent) => {
      if (!slikKlik) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Laat je buiten het venster los, dan komt er geen klik; ruim de vlag
    // dan na het loslaten op, zodat hij niets anders opslokt.
    const los = () => {
      if (slikKlik) setTimeout(() => (slikKlik = false), 0);
    };
    const klik = (e: MouseEvent) => {
      if (!slikKlik) return;
      slikKlik = false;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", druk, true);
    document.addEventListener("mousedown", muisOmlaag, true);
    document.addEventListener("click", klik, true);
    window.addEventListener("pointerup", los, true);
    return () => {
      document.removeEventListener("pointerdown", druk, true);
      document.removeEventListener("mousedown", muisOmlaag, true);
      document.removeEventListener("click", klik, true);
      window.removeEventListener("pointerup", los, true);
    };
  }, [magPlannen]);

  async function patchKlant(c: Customer, patch: Partial<Customer>) {
    const vorige: Partial<Customer> = {};
    for (const key of Object.keys(patch) as (keyof Customer)[]) {
      (vorige as Record<string, unknown>)[key] = c[key];
    }
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
    );
    // Via patchCustomer: een prijs of meerprijs gaat dan naar zijn eigen tabel.
    try {
      await patchCustomer(c.id, patch);
    } catch (error) {
      toast.error(
        "Opslaan mislukt: " +
          (error instanceof Error
            ? error.message
            : String((error as { message?: string })?.message ?? error)),
      );
      qc.invalidateQueries({ queryKey: ["customers"] });
      return;
    }
    pushUndo({
      label: `Wijziging ${formatNumber(c)}`,
      undo: async () => {
        await patchCustomer(c.id, vorige);
        herlaad();
      },
    });
  }

  /**
   * Een extra opdracht bij een adres. Hij komt zonder dag binnen: waar en
   * wanneer je hem doet beslis je op de planning, als die wijk aan de beurt
   * is.
   */
  async function maakKlus(customerId: string, omschrijving: string, prijs: number) {
    let id: string;
    try {
      id = await nieuweKlus(customerId, omschrijving, prijs);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Opdracht ${omschrijving}`,
      undo: async () => {
        await verwijderKlus(id);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
    toast.success(`Opdracht genoteerd: ${omschrijving}`);
  }

  async function nieuweSnelkeuze(label: string) {
    try {
      await addQuickNote(label);
      qc.invalidateQueries({ queryKey: ["quick_notes"] });
      toast.success("Snelkeuze toegevoegd");
    } catch (e) {
      toast.error("Toevoegen mislukt: " + (e as Error).message);
    }
  }

  /** Een klant laat stoppen: het adres wordt inactief, met alles bewaard. */
  async function stopKlant(c: Customer, reden: StopReden, planningWeg: boolean) {
    const straat = streets.find((s) => s.id === c.street_id)?.name;
    const adres = straat ? `${straat} ${formatNumber(c)}` : `Klant ${formatNumber(c)}`;
    const u = await zetInactief([c.id], reden, planningWeg);
    if (u.adressen.length === 0) {
      toast.info(`${adres} was al inactief of weg.`);
      herlaad();
      return;
    }
    pushUndo({
      label: `Stoppen ${adres}`,
      undo: async () => {
        await draaiStoppenTerug(u);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`${adres} staat nu bij Inactief (klantenpagina)`);
  }

  async function verwijderKlant(c: Customer, planningWeg: boolean) {
    // Met de straat erbij: "Klant 8" zegt niet welke 8, en elke straat heeft er een.
    const straat = streets.find((s) => s.id === c.street_id)?.name;
    const adres = straat ? `${straat} ${formatNumber(c)}` : `Klant ${formatNumber(c)}`;
    // Geen aparte vraag meer: je koos "Verwijderen" in het stopschermpje, en
    // daar ook wat er met de planning moet.
    let kenmerken: string[] = [];
    // Zonder het recht op de planning kan dat deel niet; het verwijderen zelf
    // wel. Dan blijft de planning staan, en dat zeggen we.
    const planningMag = planningWeg && magPlannen;
    if (planningWeg && !magPlannen) {
      toast.info("De planning bleef staan: je rol mag de planning niet aanpassen.");
    }
    try {
      if (planningMag) kenmerken = await haalVanPlanning([c.id]);
      await legWeg("customers", [c.id]);
    } catch (e) {
      // Stond hij al van de planning af, dan dat terug: half is erger dan niets.
      await zetPlanningTerug(kenmerken).catch(() => {});
      toast.error("Verwijderen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${adres}`,
      undo: async () => {
        // Eerst het adres terug, dan de planning: een weggegooid adres komt
        // niet terug op een dag in de toekomst.
        await haalTerug("customers", [c.id]);
        await zetPlanningTerug(kenmerken);
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        herlaad();
      },
    });
    if (kenmerken.length) {
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
    }
    herlaad();
    meldUndo(
      kenmerken.length
        ? `${adres} verwijderd en van ${kenmerken.length} ${kenmerken.length === 1 ? "dag" : "dagen"} op de planning gehaald`
        : `${adres} verwijderd`,
    );
  }

  async function verwijderStraat(s: Street) {
    const ja = await bevestig({
      titel: `Straat "${s.name}" verwijderen?`,
      tekst: "Alle klanten in deze straat gaan mee. Je kunt dit direct daarna nog ongedaan maken.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await legWeg("streets", [s.id]);
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${s.name}`,
      undo: async () => {
        await haalTerug("streets", [s.id]);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`Straat "${s.name}" verwijderd`);
  }

  /**
   * Een stuk van een straat afsplitsen: wat je geselecteerd hebt gaat naar
   * een nieuwe straat, direct onder de oude en in dezelfde groep. De
   * tegenhanger van twee straten samenvoegen (zie DubbeleStraten) — voor een
   * lange straat die je in twee stukken loopt, of een rij huizen die
   * eigenlijk bij het zijstraatje hoort.
   *
   * De adressen verhuizen zoals ze zijn: prijs, notitie, ritme en de kant van
   * de straat blijven staan, alleen de straat eronder verandert.
   *
   * Het verzetten gaat hier adres voor adres en niet via
   * `persistCustomerOrder`: die slikt een mislukte update in, en dan zou de
   * melding zeggen dat het gelukt is terwijl de helft nog in de oude straat
   * staat — met een nieuwe straat ernaast die de gebruiker nooit gevraagd
   * heeft.
   */
  async function splitsStraat(bron: Street, adressen: Customer[], naam: string, volledig: string) {
    if (adressen.length === 0) return;
    const { data, error } = await supabase
      .from("streets")
      .insert({
        name: netjesStraat(naam),
        volledige_naam: netjesStraat(volledig),
        district_id: bron.district_id,
        groep_id: bron.groep_id,
        // Hetzelfde stuk straat: dan hoort het ook op dezelfde manier
        // geteld en gesorteerd te worden.
        doorlopend: bron.doorlopend,
        sort_desc: bron.sort_desc,
        sort_order: bron.sort_order,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Splitsen mislukt: " + (error?.message ?? "de straat werd niet aangemaakt"));
      return;
    }
    const nieuwId = (data as { id: string }).id;
    // Op de telefoon meteen open: anders lijken de afgesplitste adressen weg.
    klapRegel(nieuwId, true);

    // Wat er al verhuisd is, om het terug te kunnen zetten als het halverwege
    // misgaat.
    const verzet: Customer[] = [];
    try {
      for (const [i, c] of adressen.entries()) {
        const { error: zetFout } = await supabase
          .from("customers")
          .update({ street_id: nieuwId, sort_order: i + 1 })
          .eq("id", c.id);
        if (zetFout) throw zetFout;
        verzet.push(c);
      }
    } catch (e) {
      await zetAdressenTerug(verzet);
      const opgeruimd = await gooiLegeStraatWeg(nieuwId);
      toast.error(
        `Splitsen mislukt: ${(e as Error).message}` +
          (opgeruimd ? "" : ` — kijk of "${naam}" nog leeg in de wijk staat.`),
      );
      herlaad();
      return;
    }

    // Waar hij in de rij komt te staan: direct onder de straat waar hij uit
    // komt. Dit is het cosmetische deel — gaat het mis, dan staat de straat
    // ergens anders in de lijst, maar er raakt niets kwijt.
    const nieuweStraat: Street = {
      ...bron,
      id: nieuwId,
      name: naam,
      volledige_naam: volledig,
      // De plek op de printlijst hoort bij de oude straat; de nieuwe zoekt
      // zelf een plekje.
      kolom_start: false,
      print_col: null,
      print_row: null,
    };
    const vorigeVolgorde = streets.map((s) => ({ ...s }));
    const plek = streets.findIndex((s) => s.id === bron.id);
    const volgorde = [...streets];
    volgorde.splice(plek < 0 ? streets.length : plek + 1, 0, nieuweStraat);
    await persistStreetOrder(volgorde);

    pushUndo({
      label: `Splitsen ${bron.name}`,
      undo: async () => {
        // Eerst de adressen terug, en alleen verder als dat ook echt gelukt
        // is: aan een straat die je weggooit hangen zijn adressen met on
        // delete cascade, en dan zijn ze voorgoed weg.
        for (const c of adressen) {
          const { error: terugFout } = await supabase
            .from("customers")
            .update({ street_id: c.street_id, sort_order: c.sort_order })
            .eq("id", c.id);
          if (terugFout) {
            toast.error("Terugdraaien mislukt: " + terugFout.message);
            herlaad();
            return;
          }
        }
        if (!(await gooiLegeStraatWeg(nieuwId))) {
          toast.error(
            `De adressen staan terug, maar "${naam}" kon niet weg. Gooi hem zelf weg als hij leeg is.`,
          );
        }
        await persistStreetOrder(vorigeVolgorde);
        herlaad();
      },
    });
    // Wat aangevinkt was blijft aangevinkt: dezelfde adressen, alleen in een
    // andere straat. Zo kun je ze daarna meteen inplannen.
    herlaad();
    meldUndo(
      `${adressen.length} ${adressen.length === 1 ? "adres staat" : "adressen staan"} nu in "${naam}"`,
    );
  }

  /** Een straat in een groep zetten of eruit halen, vanaf de rechtermuisknop
   *  op de straatkop. */
  async function zetStraatInGroep(street: Street, groepId: string | null) {
    const vorige = street.groep_id;
    if (vorige === groepId) return;
    qc.setQueryData<Street[]>(["streets"], (oud) =>
      (oud ?? []).map((s) => (s.id === street.id ? { ...s, groep_id: groepId } : s)),
    );
    try {
      await zetStratenInGroep([street.id], groepId);
    } catch (e) {
      toast.error("Verplaatsen mislukt: " + (e as Error).message);
      qc.invalidateQueries({ queryKey: ["streets"] });
      return;
    }
    const naar = subgroepen.find((g) => g.id === groepId)?.naam;
    pushUndo({
      label: `Straat ${street.name} verplaatst`,
      undo: async () => {
        await zetStratenInGroep([street.id], vorige);
        qc.invalidateQueries({ queryKey: ["streets"] });
      },
    });
    toast.success(naar ? `${street.name} zit nu in ${naar}` : `${street.name} zit in geen groep`);
  }

  /** Een nieuwe groep met deze straat er meteen in. De naam vraagt het
   *  dialoogje; het aanmaken gebeurt hier, bij het opslaan. */
  async function maakGroepMetStraat(street: Street, naam: string) {
    if (!actieveWijk) return;
    try {
      const volgende = Math.max(0, ...subgroepen.map((g) => g.sort_order)) + 1;
      const id = await nieuweStraatGroep(actieveWijk, naam, volgende);
      await zetStratenInGroep([street.id], id);
      pushUndo({
        label: `Groep ${naam}`,
        undo: async () => {
          await zetStratenInGroep([street.id], street.groep_id);
          await verwijderStraatGroep(id);
          herlaad();
        },
      });
    } catch (e) {
      toast.error("Groep maken mislukt: " + (e as Error).message);
      return;
    }
    herlaad();
    toast.success(`Groep "${naam}" gemaakt, met ${street.name} erin`);
  }

  async function hernoemGroep(groep: StraatGroep, naam: string) {
    qc.setQueryData<StraatGroep[]>(["straat_groepen"], (oud) =>
      (oud ?? []).map((g) => (g.id === groep.id ? { ...g, naam } : g)),
    );
    try {
      await hernoemStraatGroep(groep.id, naam);
    } catch (e) {
      toast.error("Hernoemen mislukt: " + (e as Error).message);
      qc.invalidateQueries({ queryKey: ["straat_groepen"] });
      return;
    }
    pushUndo({
      label: `Groepnaam ${groep.naam}`,
      undo: async () => {
        await hernoemStraatGroep(groep.id, groep.naam);
        qc.invalidateQueries({ queryKey: ["straat_groepen"] });
      },
    });
  }

  /**
   * Een groep weghalen. Weg is weg — een groep heeft geen prullenbak, want er
   * gaat niets verloren: de straten en al hun adressen blijven staan en komen
   * los onder de groepen terug.
   *
   * Het terugdraaien moet zélf onthouden welke straten erin zaten: de
   * database heeft hun `groep_id` op dat moment al leeggemaakt.
   */
  async function verwijderGroep(groep: StraatGroep) {
    const erin = streets.filter((s) => s.groep_id === groep.id).map((s) => s.id);
    const ja = await bevestig({
      titel: `Groep "${groep.naam}" verwijderen?`,
      tekst:
        erin.length === 0
          ? "Deze groep is leeg. Je kunt dit direct daarna nog ongedaan maken."
          : `De ${erin.length} ${erin.length === 1 ? "straat" : "straten"} erin blijven gewoon staan, los onder de groepen. Je kunt dit direct daarna nog ongedaan maken.`,
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await verwijderStraatGroep(groep.id);
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen groep ${groep.naam}`,
      undo: async () => {
        await herstelStraatGroep(groep);
        await zetStratenInGroep(erin, groep.id);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`Groep "${groep.naam}" verwijderd`);
  }

  /**
   * "+ adres": niet meteen een kaal nummer wegschrijven, maar het schermpje
   * openen met straat en nummer al ingevuld. Een adres zonder prijs en
   * frequentie is niet af — en een oneven nummer springt naar de andere
   * kolom, dus dan ben je hem kwijt voor je hem kon aanvullen.
   */
  function nieuweRegel(streetId: string, nummer: string) {
    if (Number.isNaN(parseInt(nummer, 10))) return;
    const max = Math.max(
      0,
      ...customers.filter((c) => c.street_id === streetId).map((c) => c.sort_order),
    );
    setKlantDialog({ open: true, customer: null, streetId, nummer, sortOrder: max + 1 });
  }

  async function nieuweStraat(naam: string) {
    if (!actieveWijk) {
      toast.error("Maak eerst een wijk aan.");
      return;
    }
    const max = Math.max(0, ...streets.map((s) => s.sort_order));
    const { data, error } = await supabase
      .from("streets")
      .insert({ name: netjesStraat(naam), sort_order: max + 1, district_id: actieveWijk })
      .select("id")
      .single();
    if (error) {
      toast.error("Toevoegen mislukt: " + error.message);
      return;
    }
    const nieuwId = (data as { id: string } | null)?.id;
    if (nieuwId) {
      pushUndo({
        label: `Toevoegen straat ${naam.trim()}`,
        undo: async () => {
          // Nooit hard weggooien als er intussen adressen in staan: die gaan
          // met de straat mee (cascade). Dan naar de prullenbak, terug te halen.
          if (!(await gooiLegeStraatWeg(nieuwId))) {
            await legWeg("streets", [nieuwId]);
            toast(
              `"${naam.trim()}" had al adressen: de straat staat met die adressen in de prullenbak.`,
            );
          }
          herlaad();
        },
      });
    }
    qc.invalidateQueries({ queryKey: ["streets"] });
  }

  /** Lopen de nummers van deze straat per 1 op, of is het even en oneven?
   *  Zie splitEvenOdd: dit verandert alleen hoe de straat verdeeld wordt. */
  async function wisselDoorlopend(s: Street) {
    const nieuw = !s.doorlopend;
    qc.setQueryData<Street[]>(["streets"], (old) =>
      (old ?? []).map((x) => (x.id === s.id ? { ...x, doorlopend: nieuw } : x)),
    );
    try {
      await setStreetDoorlopend(s.id, nieuw);
      pushUndo({
        label: `Nummering ${s.name}`,
        undo: async () => {
          await setStreetDoorlopend(s.id, s.doorlopend);
          herlaad();
        },
      });
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      herlaad();
    }
  }

  async function wisselSort(s: Street) {
    const nieuw = !s.sort_desc;
    qc.setQueryData<Street[]>(["streets"], (old) =>
      (old ?? []).map((x) => (x.id === s.id ? { ...x, sort_desc: nieuw } : x)),
    );
    try {
      await setStreetSortDesc(s.id, nieuw);
      pushUndo({
        label: `Sortering ${s.name}`,
        undo: async () => {
          await setStreetSortDesc(s.id, s.sort_desc);
          herlaad();
        },
      });
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      herlaad();
    }
  }

  function klikSelectie(c: Customer, shift: boolean) {
    const lijst = sortCustomers(customers.filter((x) => x.street_id === c.street_id)).map(
      (x) => x.id,
    );
    setSelectie((huidig) => {
      if (!shift) return huidig.includes(c.id) && huidig.length === 1 ? [] : [c.id];
      const anker = huidig.find((id) => lijst.includes(id));
      if (!anker) return [c.id];
      const a = lijst.indexOf(anker);
      const b = lijst.indexOf(c.id);
      return lijst.slice(Math.min(a, b), Math.max(a, b) + 1);
    });
  }

  // De handlers die elke regel meekrijgt, met een vaste identiteit. Zonder dit
  // ziet `memo` op KlantRij bij elke render nieuwe functies en tekent hij de
  // hele wijk opnieuw; zie useStabiel.
  const opSelect = useStabiel(klikSelectie);
  const opPatch = useStabiel(patchKlant);
  // Het prullenbakje vraagt eerst waarom: verhuisd, gestopt, of echt weg.
  const opDelete = useStabiel((c: Customer) => setStop({ open: true, customer: c }));
  const opDossier = useStabiel((c: Customer) => setDossier({ open: true, customer: c }));
  const opHoekadres = useStabiel((c: Customer) => setHoek({ open: true, customer: c }));
  const opKlus = useStabiel((c: Customer) => setKlus({ open: true, customer: c }));
  const opStoppen = useStabiel((c: Customer) => setStop({ open: true, customer: c }));
  const opAddQuickNote = useStabiel(nieuweSnelkeuze);
  const opVerfStart = useStabiel(startVerf);
  const opKlantOpDag = useStabiel((c: Customer, aan: boolean) => {
    pasKeuzeAan(aan ? [c.id] : [], aan ? [] : [c.id]);
  });
  const opNieuweRegel = useStabiel(nieuweRegel);
  /** In de selecteermodus, rechtermuisknop op een aangevinkt adres: wat er in
   *  díe straat aangevinkt staat uit de straat lichten. Wat er precies
   *  meegaat, zoekt hij hier op — de regel zelf weet alleen dát hij
   *  aangevinkt is. */
  const opSplitsen = useStabiel((c: Customer) => {
    const street = streets.find((s) => s.id === c.street_id);
    if (!street) return;
    // Aanvinken mag over meerdere straten heen; alleen deze straat gaat mee.
    const adressen = sortCustomers(
      customers.filter((x) => keuze.has(x.id) && x.street_id === street.id),
    );
    if (adressen.length === 0) return;
    setSplits({ open: true, street, adressen });
  });
  const opEditStreet = useStabiel((street: Street) => setStraatDialog({ open: true, street }));
  const opDeleteStreet = useStabiel((street: Street) => verwijderStraat(street));
  const opAddKlant = useStabiel((streetId: string) =>
    setKlantDialog({ open: true, customer: null, streetId }),
  );
  const opToggleSort = useStabiel((street: Street) => void wisselSort(street));
  const opToggleDoorlopend = useStabiel((street: Street) => void wisselDoorlopend(street));
  const opKlap = useStabiel((streetId: string) => klapStraat(streetId));
  const opKlapRegel = useStabiel((streetId: string) => klapRegel(streetId));
  const opStraatOpDag = useStabiel((streetId: string, aan: boolean) => {
    const g = groepen.find((x) => x.street.id === streetId);
    if (g) zetStraatOpDag(g, aan);
  });
  /** De hele groep op de dag, in één keer. Loopt langs dezelfde `pasKeuzeAan`
   *  als een losse straat, dus het bedrag, het ongedaan maken en het opslaan
   *  van de dag doen vanzelf mee. */
  const opGroepOpDag = useStabiel((groepId: string, aan: boolean) => {
    const ids = secties.find((x) => x.groep.id === groepId)?.klantIds ?? [];
    if (ids.length) pasKeuzeAan(aan ? ids : [], aan ? [] : ids);
  });
  const opKlapGroep = useStabiel((groepId: string) => klapStraat(groepSleutel(groepId)));
  const opZetGroep = useStabiel(
    (street: Street, groepId: string | null) => void zetStraatInGroep(street, groepId),
  );
  const opNieuweGroep = useStabiel((street: Street) =>
    setGroepDialog({ open: true, groep: null, street }),
  );
  const opEditGroep = useStabiel((groep: StraatGroep) => setGroepDialog({ open: true, groep }));
  const opDeleteGroep = useStabiel((groep: StraatGroep) => void verwijderGroep(groep));

  /** Lang indrukken op een adres: de selecteermodus aan, met dit adres al
   *  aangevinkt. Zoals je op je telefoon foto's gaat selecteren. */
  const opLangIngedrukt = useStabiel((c: Customer) => {
    selecteermodus(true);
    pasKeuzeAan([c.id], []);
  });

  // De id-lijsten voor dnd-kit. Zonder useMemo krijgt SortableContext bij elke
  // render een verse array, verandert zijn context, en hertekent React álle
  // regels die `useSortable` gebruiken — `memo` kan daar niets tegen doen.
  // Een ingeklapte groep staat er wel in, maar zijn straten niet: die zijn
  // niet getekend, en dan valt er ook niets aan te wijzen om iets naast te
  // laten vallen.
  const straatIds = useMemo(
    () => [
      ...zichtbareSecties.flatMap((sec) => [
        `g:${sec.groep.id}`,
        ...(!zoekt && ingeklapt.has(groepSleutel(sec.groep.id))
          ? []
          : sec.blokken.map((b) => `s:${b.street.id}`)),
      ]),
      ...losseBlokken.map((b) => `s:${b.street.id}`),
    ],
    [zichtbareSecties, losseBlokken, ingeklapt, zoekt],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setSleep(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setSleep(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;

    // Een groep verslepen: alleen ten opzichte van een andere groep. De
    // straten erin verhuizen mee doordat ze aan de groep hangen.
    if (activeId.startsWith("g:")) {
      if (!overId.startsWith("g:")) return;
      const ids = subgroepen.map((g) => g.id);
      const from = ids.indexOf(activeId.slice(2));
      const to = ids.indexOf(overId.slice(2));
      if (from < 0 || to < 0) return;
      const next = [...subgroepen];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      const vorigeVolgorde = subgroepen.map((g) => ({ ...g }));
      // De query bevat de groepen van álle wijken; alleen die van deze wijk
      // krijgen een nieuw nummer.
      const nieuweNummers = new Map(next.map((g, i) => [g.id, i + 1]));
      qc.setQueryData<StraatGroep[]>(["straat_groepen"], (oud) =>
        (oud ?? []).map((g) => ({ ...g, sort_order: nieuweNummers.get(g.id) ?? g.sort_order })),
      );
      await persistGroepOrder(next);
      pushUndo({
        label: "Groepvolgorde",
        undo: async () => {
          await persistGroepOrder(vorigeVolgorde);
          qc.invalidateQueries({ queryKey: ["straat_groepen"] });
        },
      });
      qc.invalidateQueries({ queryKey: ["straat_groepen"] });
      return;
    }

    if (activeId.startsWith("s:")) {
      const bron = streets.find((s) => s.id === activeId.slice(2));
      if (!bron) return;

      // Waar je loslaat bepaalt twee dingen tegelijk: de plek in de rij, én
      // in welke groep de straat voortaan zit. Laat je hem op een straat uit
      // een andere groep los, dan verhuist hij mee — dezelfde beweging als
      // altijd, hij doet alleen iets meer. Op een groepkop loslaten zet hem
      // bovenaan in die groep.
      let overStraat: Street | null = null;
      let doelGroep: string | null;
      if (overId.startsWith("s:")) {
        overStraat = streets.find((s) => s.id === overId.slice(2)) ?? null;
        if (!overStraat) return;
        doelGroep = overStraat.groep_id;
      } else if (overId.startsWith("g:")) {
        doelGroep = overId.slice(2);
      } else return;

      const zonder = streets.filter((s) => s.id !== bron.id);
      const index = overStraat
        ? zonder.findIndex((s) => s.id === overStraat!.id)
        : zonder.findIndex((s) => s.groep_id === doelGroep);
      const verhuist = (bron.groep_id ?? null) !== (doelGroep ?? null);
      const next = [...zonder];
      next.splice(index < 0 ? zonder.length : index, 0, { ...bron, groep_id: doelGroep });

      const vorigeVolgorde = streets.map((s) => ({ ...s }));
      const vorigeGroep = bron.groep_id;
      qc.setQueryData<Street[]>(
        ["streets"],
        next.map((s, i) => ({ ...s, sort_order: i + 1 })),
      );
      await persistStreetOrder(next);
      if (verhuist) await zetStratenInGroep([bron.id], doelGroep);
      pushUndo({
        label: verhuist ? `Straat ${bron.name} verplaatst` : "Straatvolgorde",
        undo: async () => {
          await persistStreetOrder(vorigeVolgorde);
          if (verhuist) await zetStratenInGroep([bron.id], vorigeGroep);
          herlaad();
        },
      });
      qc.invalidateQueries({ queryKey: ["streets"] });
      return;
    }

    if (!activeId.startsWith("c:")) return;
    const dragged = customers.find((c) => c.id === activeId.slice(2));
    if (!dragged) return;

    // Wélke kolom je loslaat telt net zo goed als waar in de rij: een nummer
    // op de hoek hoort soms aan de andere kant van de straat.
    let doelStraat: string | null = null;
    let doelKant: Kant | null = null;
    let overKlant: Customer | null = null;
    if (overId.startsWith("c:")) {
      overKlant = customers.find((c) => c.id === overId.slice(2)) ?? null;
      doelStraat = overKlant?.street_id ?? null;
      doelKant = overKlant ? kantVan(overKlant) : null;
    } else if (overId.startsWith("z:")) {
      const [, straatId, kant] = overId.split(":");
      doelStraat = straatId ?? null;
      doelKant = (kant as Kant | undefined) ?? null;
    }
    if (!doelStraat) return;

    const verplaatst = selectie.includes(dragged.id)
      ? sortCustomers(customers.filter((c) => selectie.includes(c.id)))
      : [dragged];
    const verplaatstIds = new Set(verplaatst.map((c) => c.id));

    /** Sta je aan de kant die je huisnummer aanwijst, dan hoef je niets vast
     *  te leggen; sta je ergens anders, dan is dat een hoekadres.
     *
     *  In een straat die per 1 oploopt zegt de kolom niets over de kant van
     *  de straat — daar is het gewoon de eerste of de tweede helft van één
     *  doorlopende rij — dus dan blijft de hoekkant zoals hij was. */
    const doorlopendeStraat = streets.find((s) => s.id === doelStraat)?.doorlopend ?? false;
    function kantVoor(c: Customer): Kant | "" {
      if (doorlopendeStraat || !doelKant || !verplaatstIds.has(c.id)) return c.hoek_kant;
      return doelKant === natuurlijkeKant(c) ? "" : doelKant;
    }

    const doelLijst = sortCustomers(
      customers.filter((c) => c.street_id === doelStraat && !verplaatstIds.has(c.id)),
    );
    const index = overKlant ? doelLijst.findIndex((c) => c.id === overKlant!.id) : doelLijst.length;
    const nieuw = [...doelLijst];
    nieuw.splice(index < 0 ? doelLijst.length : index, 0, ...verplaatst);

    const updates = nieuw.map((c, i) => ({
      id: c.id,
      street_id: doelStraat!,
      sort_order: i + 1,
      hoek_kant: kantVoor(c),
    }));
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((c) => {
        const u = updates.find((x) => x.id === c.id);
        return u
          ? { ...c, street_id: u.street_id, sort_order: u.sort_order, hoek_kant: u.hoek_kant }
          : c;
      }),
    );
    const vorigePlek = [...verplaatst, ...doelLijst].map((c) => ({
      id: c.id,
      street_id: c.street_id,
      sort_order: c.sort_order,
      hoek_kant: c.hoek_kant,
    }));
    await persistCustomerOrder(updates);
    pushUndo({
      label: "Verplaatsing",
      undo: async () => {
        await persistCustomerOrder(vorigePlek);
        herlaad();
      },
    });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  // --- Sneltoetsen, zoals in het postvak ----------------------------------
  // Niet als je in een tekstvak typt, en niet als er een venster of menu
  // openstaat: dan horen de toetsen daarbij.
  const [hulpOpen, setHulpOpen] = useState(false);
  const [maandOpen, setMaandOpen] = useState(false);
  const [wijkOpen, setWijkOpen] = useState(false);
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
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === "p") {
      // De printlijst van wat je nu ziet, in plaats van de pagina zelf.
      e.preventDefault();
      void navigate({
        to: "/printen",
        search: {
          wijk: actieveWijk ?? "",
          maand: filter === "alles" ? "even" : filter,
          prijzen: false,
          liggend: true,
        },
      });
      return;
    }
    if (cmd || e.altKey) return;
    const doe = (actie: () => void) => {
      e.preventDefault();
      actie();
    };
    switch (e.key) {
      case "/":
        return doe(() => document.querySelector<HTMLInputElement>("input[data-zoekbalk]")?.focus());
      case "x":
        if (magPlannen) doe(wisselSelecteren);
        return;
      case "a":
        if (selecteren && alleZichtbare.length > 0) doe(wisselAlles);
        return;
      case "Escape":
        if (selecteren) doe(() => void stopSelecteren());
        return;
      case "s":
        if (selecteren && bewerktDag && nietOpgeslagen) doe(() => void planIn(bewerktDag));
        return;
      case "m":
        return doe(() => setMaandOpen(true));
      case "e":
        return doe(() => setFilter("even"));
      case "o":
        return doe(() => setFilter("oneven"));
      case "0":
        return doe(() => setFilter("alles"));
      case "ArrowLeft":
      case "ArrowRight":
        // Vorige of volgende werkdag, alleen tijdens het selecteren.
        if (selecteren && bewerktDag) {
          const stap = e.key === "ArrowLeft" ? -1 : 1;
          const d = new Date(`${bewerktDag}T12:00:00`);
          for (let i = 0; i < 14; i++) {
            d.setDate(d.getDate() + stap);
            if (isWerkdag(d, werkdagenLijst)) break;
          }
          doe(() => void naarDag(datumSleutel(d)));
        }
        return;
      case "[":
        // Net als ]: stond er even/oneven/alles, dan eerst de maand van nu.
        return doe(() => {
          if (!isKalendermaand(filter)) return setFilter(ronde);
          const [jaar, maand] = ronde.split("-").map(Number);
          setFilter(maandSleutel(new Date(jaar!, maand! - 2, 1)));
        });
      case "]":
        // Stond er even/oneven/alles, dan eerst naar de maand van nu.
        return doe(() => setFilter(isKalendermaand(filter) ? volgendeMaand(ronde) : ronde));
      case "p":
        if (prijzenZien) doe(() => setPrijzenTonen((v) => !v));
        return;
      case "w":
        if (districts.length > 0) doe(() => setWijkOpen(true));
        return;
      case "n":
        if (magKlanten) doe(() => setKlantDialog({ open: true, customer: null }));
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

  /** "vandaag" of "ma 21": de dag waar Opslaan naartoe gaat. */
  const dagNaam = bewerktDag ? (bewerktDag === nu ? "vandaag" : kortDag(bewerktDag)) : "";
  /** Onder het bedrag: wat opslaan gaat doen. */
  const wijzigingTekst =
    !dagKlaar && wasdagQuery.isError
      ? "dag kon niet laden"
      : !dagKlaar
        ? "dag laden…"
        : nietOpgeslagen
          ? `${erbij} erbij, ${eraf} eraf`
          : "alles opgeslagen";
  const opslaanKnop = () => (
    <Button
      size="sm"
      className="rounded-full"
      disabled={!bewerktDag || !dagKlaar || !nietOpgeslagen}
      onClick={() => bewerktDag && void planIn(bewerktDag)}
      title={nietOpgeslagen ? `Opslaan op ${toonDatum(bewerktDag ?? "")} (s)` : "Niets te bewaren"}
    >
      <CalendarPlus className="size-4" />
      {nietOpgeslagen ? `Opslaan op ${dagNaam}` : "Opgeslagen"}
    </Button>
  );

  /** De balk onderin tijdens het selecteren, op de telefoon. */
  const selectieBalk = () => (
    <div className="rounded-[20px] border border-border bg-card p-2 shadow-[0_8px_30px_oklch(0.3_0.02_70/22%)] md:hidden">
      <div className="flex items-center gap-2 pl-1.5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold tabular-nums">
            {keuze.size} {keuze.size === 1 ? "adres" : "adressen"}
            {prijzenZien && <span className="font-display"> · {formatPrice(keuzeBedrag)}</span>}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {bewerktDag ? `${toonDatum(bewerktDag)} · ${wijzigingTekst}` : "Tik adressen aan"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void stopSelecteren()}
          aria-label="Stoppen met selecteren"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={wisselAlles}
          disabled={alleZichtbare.length === 0}
        >
          {allesGekozen ? "Niets" : "Alles"}
        </Button>
        <OverslaanKnop
          compact
          aantal={keuze.size}
          onOverslaan={(m) => void slaKeuzeOver(m)}
          onNietsOverslaan={() => void wisOverslaanVanKeuze()}
        />
        <div className="ml-auto">{opslaanKnop()}</div>
      </div>
    </div>
  );

  // De lijst staat altijd in de compacte weergave: zo passen er meer regels
  // op het scherm, en dat is waar je op de ronde naar kijkt.
  const rowText = "text-[12px]";
  const rowPad = "py-[2px]";

  /** Eén straatblok. Staat hier als functie omdat hij op twee plekken nodig
   *  is: binnen een groep, en los eronder. */
  const straatBlok = (
    g: (typeof groepen)[number],
    weergave: BlokProps["weergave"] = mobiel ? "regel" : "blok",
  ) => (
    <StraatBlok
      key={g.street.id}
      weergave={weergave}
      onLangIngedrukt={mobiel && magPlannen ? opLangIngedrukt : null}
      street={g.street}
      ronde={ronde}
      even={g.even}
      oneven={g.oneven}
      aantal={g.aantal}
      totaal={g.totaal}
      sort={g.street.sort_desc ? "desc" : "asc"}
      prijzenTonen={toonPrijzen}
      duurTonen={duurTonen}
      magKlanten={magKlanten}
      magPlannen={magPlannen}
      quickNotes={quickNotes}
      markeringen={markeringen}
      klantNamen={klantNamen}
      rowText={weergave === "regel" ? "text-[14px]" : rowText}
      rowPad={weergave === "regel" ? "py-1.5" : rowPad}
      selectie={selectie}
      onSelect={opSelect}
      onSplitsen={opSplitsen}
      onPatch={opPatch}
      onAddQuickNote={opAddQuickNote}
      onDelete={opDelete}
      onDossier={opDossier}
      onHoekadres={opHoekadres}
      onKlus={opKlus}
      onStoppen={opStoppen}
      onNieuweRegel={opNieuweRegel}
      onEditStreet={opEditStreet}
      onDeleteStreet={opDeleteStreet}
      onAddKlant={opAddKlant}
      onToggleSort={opToggleSort}
      onToggleDoorlopend={opToggleDoorlopend}
      ingeklapt={ingeklapt.has(g.street.id)}
      onKlap={opKlap}
      regelOpen={openRegels.has(g.street.id)}
      onKlapRegel={opKlapRegel}
      groepen={subgroepen}
      onZetGroep={opZetGroep}
      onNieuweGroep={opNieuweGroep}
      planmodus={selecteren}
      dagKlaar={dagKlaar}
      opDeDag={keuze}
      eerderGewassen={eerderGewassen}
      elderGepland={elderGepland}
      nietGewassen={nietGewassen}
      onStraatOpDag={opStraatOpDag}
      onKlantOpDag={opKlantOpDag}
      onVerfStart={opVerfStart}
      negeerKlik={negeerKlik}
    />
  );

  return (
    <AppLayout
      // De titel ís de wijkkiezer: de naam groot, met het pijltje erachter om
      // te wisselen en de wijkknopjes ernaast.
      titel={
        <WijkKiezer
          variant="titel"
          districts={districts}
          activeId={actieveWijk}
          onSelect={(id) =>
            void navigate({
              to: "/",
              search: (oud) => ({ ...oud, wijk: id }),
            })
          }
          onChanged={() => qc.invalidateQueries({ queryKey: ["districts"] })}
          // Straatnamen aanvullen doe je één keer per wijk; die hoort bij de
          // wijk zelf en niet in de knoppenbalk die je elke dag gebruikt.
          straatnamenNodig={
            wijkPlaats.trim()
              ? stratenZonderNaam(streets.filter((s) => s.district_id === actieveWijk)).length
              : 0
          }
          onStraatnamen={() => setStraatnamenOpen(true)}
          kiezerOpen={wijkOpen}
          onKiezerOpen={setWijkOpen}
        />
      }
      naastTitel={
        actieveWijk
          ? wijkPlaats && wijkPlaats !== districts.find((d) => d.id === actieveWijk)?.name
            ? wijkPlaats
            : undefined
          : "Kies een wijk om zijn straten te zien."
      }
      actiePositie="onder"
      verbergBijScrollen
      kruimel="Overzicht / Wijken"
      onderschrift={
        actieveWijk
          ? // Aantallen staan al in de gekleurde tegels. De plaats alleen als
            // hij iets toevoegt: "Gouda · Gouda" zegt twee keer hetzelfde.
            wijkPlaats && wijkPlaats !== districts.find((d) => d.id === actieveWijk)?.name
            ? wijkPlaats
            : undefined
          : "Kies een wijk om zijn straten te zien."
      }
      // Op de telefoon staan zoeken en ⋯ onderin (zie onderbalk), en de rest
      // van deze knoppen zit in dat ⋯-menu.
      acties={
        mobiel ? undefined : (
          <>
            <ZoekBalk placeholder="Zoek straat" onTermen={setZoektermen} />
            <div className="contents">
              {magPlannen && (
                <Button
                  size="sm"
                  variant={selecteren ? "default" : "outline"}
                  className="rounded-full"
                  onClick={wisselSelecteren}
                  title="Adressen aanvinken om daarna in te plannen"
                >
                  <CheckSquare className="size-4" /> Selecteren
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={klapAlles}
                disabled={groepen.length === 0}
                title={allesIngeklapt ? "Alle straten uitklappen" : "Alle straten inklappen"}
              >
                {allesIngeklapt ? (
                  <ChevronsUpDown className="size-4" />
                ) : (
                  <ChevronsDownUp className="size-4" />
                )}
                {allesIngeklapt ? "Uitklappen" : "Inklappen"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={!undoLabel}
                onClick={() => void doeUndo()}
                title={undoLabel ? `Ongedaan maken: ${undoLabel}` : "Niets om terug te draaien"}
              >
                <Undo2 className="size-4" /> Ongedaan
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" asChild>
                <Link
                  to="/printen"
                  search={{
                    wijk: actieveWijk ?? "",
                    maand: filter === "alles" ? "even" : filter,
                    prijzen: false,
                    liggend: true,
                  }}
                >
                  <Printer className="size-4" /> Printlijst
                </Link>
              </Button>
              {magKlanten && (
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => setKlantDialog({ open: true, customer: null })}
                >
                  <Plus className="size-4" /> Klant
                </Button>
              )}
              <button
                type="button"
                onClick={() => setHulpOpen(true)}
                aria-label="Sneltoetsen"
                title="Sneltoetsen (?)"
                className="hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
              >
                <Keyboard className="size-4" />
              </button>
            </div>
          </>
        )
      }
      onderbalk={
        mobiel ? (
          <>
            {selecteren && selectieBalk()}
            <div className="flex items-center gap-2">
              <ZoekBalk
                placeholder="Zoek straat"
                onTermen={setZoektermen}
                className="w-0 flex-1 shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
              />
              {/* Op de telefoon zit de rest achter ⋯, en staan de knoppen van de
              selecteermodus in de balk onderin. */}
              <MeerKnoppen
                magPlannen={magPlannen}
                magKlanten={magKlanten}
                selecteren={selecteren}
                onSelecteren={wisselSelecteren}
                prijzenZien={prijzenZien}
                prijzenTonen={prijzenTonen}
                onPrijzenTonen={setPrijzenTonen}
                duurTonen={duurTonen}
                onDuurTonen={setDuurTonen}
                undoLabel={undoLabel}
                onUndo={() => void doeUndo()}
                printSearch={{
                  wijk: actieveWijk ?? "",
                  maand: filter === "alles" ? "even" : filter,
                  prijzen: false,
                  liggend: true,
                }}
                onNieuweKlant={() => setKlantDialog({ open: true, customer: null })}
              />
            </div>
          </>
        ) : undefined
      }
      kop={
        <Cijferkaarten
          cijfers={[
            {
              label: "Adressen in beeld",
              waarde: String(totaal),
              onder: `van ${customers.length} in de kaartenbak`,
              icon: Users,
              kleur: "blauw",
            },
            {
              label: "Straten",
              waarde: String(groepen.length),
              onder: `${secties.length} in een groep`,
              icon: Route2,
              kleur: "amber",
            },
            {
              label: "Omzet per ronde",
              waarde: formatPrice(omzet),
              onder: isKalendermaand(filter) ? toonMaand(filter) : "alle maanden",
              icon: Euro,
              kleur: "groen",
              verberg: !toonPrijzen,
            },
          ]}
        />
      }
    >
      {/* @container: of er twee straten naast elkaar passen hangt af van de
          ruimte voor de lijst, niet van het scherm — met de zijbalk open is
          dat op een 13-inch MacBook een stuk minder. */}
      <div className="@container space-y-3">
        <div className="sticky top-[var(--plakrand)] z-[9] -mx-3 flex flex-wrap items-center gap-2 border-b border-border/70 bg-background/85 px-3 py-2 backdrop-blur transition-transform duration-200 group-data-[weg]/layout:translate-y-[calc(-100%-var(--balkhoogte))] md:-mx-6 md:gap-3 md:px-6">
          {/* Op de telefoon veeg je deze rij opzij als hij niet past. */}
          <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-card p-[3px] shadow-card [scrollbar-width:none]">
            {/* Dezelfde keuze als op de printlijst: wat je hier ziet is wat je
                straks meeneemt. */}
            <DropdownMenu open={maandOpen} onOpenChange={setMaandOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] capitalize transition-colors md:px-4 ${
                    isKalendermaand(filter)
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-foreground/80 hover:text-foreground"
                  }`}
                >
                  {isKalendermaand(filter) ? toonMaand(filter) : "Maand"}
                  <ChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-48 overflow-y-auto">
                {komendeMaanden().map((m, i) => (
                  <Fragment key={m}>
                    {i > 0 && m.endsWith("-01") && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => setFilter(m)}>
                      <span className="capitalize">{toonMaand(m)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {(["alles", "even", "oneven"] as MaandFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors md:px-4 ${
                  filter === f
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-foreground/80 hover:text-foreground"
                }`}
              >
                {f === "alles" ? (
                  "Alles"
                ) : (
                  <>
                    {f === "even" ? "Even" : "Oneven"}
                    <span className="hidden md:inline"> maand</span>
                  </>
                )}
              </button>
            ))}
          </div>
          {/* Zolang je selecteert: de week, om naar een andere dag te gaan
              zonder eerst terug naar de planning. Naast het maandfilter. */}
          {selecteren && magPlannen && (
            <WeekStrook
              gekozen={bewerktDag}
              onKies={(d) => void naarDag(d)}
              prijzenZien={prijzenZien}
            />
          )}
          {prijzenZien && (
            // Op de telefoon staat dit in het ⋯-menu: zo past het maandfilter
            // op één regel.
            <div className="hidden items-center gap-2 md:flex">
              <Switch id="prijzen" checked={prijzenTonen} onCheckedChange={setPrijzenTonen} />
              <Label htmlFor="prijzen" className="text-sm text-muted-foreground">
                Prijzen
              </Label>
            </div>
          )}
          <div className="hidden items-center gap-2 md:flex">
            <Switch id="duur" checked={duurTonen} onCheckedChange={setDuurTonen} />
            <Label htmlFor="duur" className="text-sm text-muted-foreground">
              Duur
            </Label>
          </div>
        </div>

        {selectie.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {selectie.length} regels geselecteerd — sleep er één om ze samen te verplaatsen.{" "}
            <button className="underline" onClick={() => setSelectie([])}>
              selectie wissen
            </button>
          </p>
        )}

        <DubbeleStraten streets={streets} customers={customers} onDone={herlaad} />

        {(streetsQuery.isLoading || customersQuery.isLoading) && (
          <p className="text-sm text-muted-foreground">Laden…</p>
        )}

        {!streetsQuery.isLoading && districts.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen wijken. Importeer je Excel-bestand, of voeg een wijk toe bij Instellingen →
              Wijken.
            </p>
          </div>
        )}

        {!streetsQuery.isLoading && districts.length > 0 && streets.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen straten in deze wijk. Typ hieronder een straatnaam of importeer je
              Excel-bestand.
            </p>
            <div className="mt-4 flex justify-center">
              <Button size="sm" variant="outline" asChild>
                <Link to="/importeren">Excel importeren</Link>
              </Button>
            </div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={straatIds} strategy={verticalListSortingStrategy}>
            <div
              data-selecteren={selecteren ? "" : undefined}
              // Pas twee straten naast elkaar als elke adresregel dan nog
              // ruimte voor de notitie heeft; daaronder werd die 15px breed.
              className={`gap-3.5 md:columns-1 @min-[88rem]:columns-2 ${
                // Tijdens een streek niets selecteren: anders sleep je een
                // blauwe tekstselectie over de halve wijk.
                verfBezig ? "select-none" : ""
              }`}
            >
              {zichtbareSecties.map((sec) => (
                <GroepSectie
                  key={sec.groep.id}
                  groep={sec.groep}
                  aantal={sec.aantal}
                  totaal={sec.totaal}
                  klantIds={sec.klantIds}
                  ingeklapt={!zoekt && ingeklapt.has(groepSleutel(sec.groep.id))}
                  prijzenTonen={toonPrijzen}
                  duurTonen={duurTonen}
                  magPlannen={magPlannen}
                  planmodus={selecteren}
                  dagKlaar={dagKlaar}
                  opDeDag={keuze}
                  eerderGewassen={eerderGewassen}
                  elderGepland={elderGepland}
                  nietGewassen={nietGewassen}
                  onKlap={opKlapGroep}
                  onGroepOpDag={opGroepOpDag}
                  onEdit={opEditGroep}
                  onDelete={opDeleteGroep}
                  onVerfStart={opVerfStart}
                  negeerKlik={negeerKlik}
                >
                  {sec.blokken.map((g) => straatBlok(g))}
                </GroepSectie>
              ))}
              {losseBlokken.map((g) => straatBlok(g))}
              {districts.length > 0 && magPlannen && <NieuweStraat onSubmit={nieuweStraat} />}
            </div>
          </SortableContext>
          <DragOverlay>
            {sleep ? (
              <div className="rounded border border-primary bg-card px-2 py-1 text-xs shadow-lg">
                {sleep.startsWith("s:")
                  ? "Straat verplaatsen"
                  : `${selectie.length > 1 ? selectie.length : 1} regel(s)`}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Op de computer: de balk van de selecteermodus zweeft onderin,
            net als op de telefoon. Bovenin zou hij de lijst omlaag duwen
            zodra de modus aangaat. Sticky en niet fixed, zodat hij midden
            boven de lijst staat en niet onder de zijbalk. */}
        {selecteren && !mobiel && (
          // Rechts ruimte voor Paaltje: die staat vast rechtsonder, en op een
          // smaller scherm zou hij anders het kruisje afdekken.
          <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center pt-2 pr-16">
            <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-[20px] border border-border bg-card py-2 pl-4 pr-2 shadow-[0_8px_30px_oklch(0.3_0.02_70/22%)]">
              <div className="min-w-0 overflow-hidden leading-tight">
                <p className="flex items-baseline gap-1.5 whitespace-nowrap">
                  {prijzenZien && (
                    <span className="font-display text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
                      {formatPrice(keuzeBedrag)}
                    </span>
                  )}
                  <span className="text-[12.5px] text-muted-foreground">
                    {prijzenZien ? "· " : ""}
                    {keuze.size} {keuze.size === 1 ? "adres" : "adressen"}
                  </span>
                </p>
                <div className="mt-0.5 flex items-center gap-3 whitespace-nowrap text-[11.5px] text-muted-foreground">
                  {bewerktDag && (
                    <Link
                      to="/planning"
                      search={{ dag: bewerktDag }}
                      className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
                      title="Deze dag op de kalender bekijken"
                    >
                      {toonDatum(bewerktDag)}
                    </Link>
                  )}
                  <span className={nietOpgeslagen ? "font-medium text-foreground" : ""}>
                    {wijzigingTekst}
                  </span>
                  {/* Drie kleuren zonder uitleg is raden. */}
                  {[
                    { stip: "bg-tint-amber ring-tint-amber-ink/30", tekst: "op de dag" },
                    { stip: "bg-tint-groen ring-tint-groen-ink/30", tekst: "gewassen" },
                    { stip: "bg-tint-paars ring-tint-paars-ink/30", tekst: "gepland" },
                    { stip: "bg-tint-rood ring-tint-rood-ink/30", tekst: "niet gewassen" },
                  ].map((l) => (
                    <span key={l.tekst} className="flex items-center gap-1.5">
                      <span
                        className={`size-2.5 shrink-0 rounded-full ring-1 ring-inset ${l.stip}`}
                      />
                      <span className="max-lg:hidden">{l.tekst}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={wisselAlles}
                  disabled={alleZichtbare.length === 0}
                  title={
                    allesGekozen
                      ? "Alles in beeld uitvinken (a)"
                      : `Alle ${alleZichtbare.length} adressen in beeld aanvinken (a)`
                  }
                >
                  {allesGekozen ? (
                    <Square className="size-4" />
                  ) : (
                    <CheckSquare className="size-4" />
                  )}
                  {allesGekozen ? "Niets" : "Alles"}
                </Button>
                <OverslaanKnop
                  aantal={keuze.size}
                  onOverslaan={(m) => void slaKeuzeOver(m)}
                  onNietsOverslaan={() => void wisOverslaanVanKeuze()}
                />
                {opslaanKnop()}
                <button
                  type="button"
                  onClick={() => void stopSelecteren()}
                  aria-label="Stoppen met selecteren"
                  title="Stoppen met selecteren (x)"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <KlantDialog
        open={klantDialog.open}
        onOpenChange={(open) => setKlantDialog((s) => ({ ...s, open }))}
        streets={streets}
        customer={klantDialog.customer}
        defaultStreetId={klantDialog.streetId}
        defaultNumber={klantDialog.nummer}
        nieuweSortOrder={klantDialog.sortOrder}
        quickNotes={quickNotes}
        onAddQuickNote={nieuweSnelkeuze}
        onSaved={herlaad}
      />
      <StopDialog
        open={stop.open}
        onOpenChange={(open) => setStop((s) => ({ ...s, open }))}
        titel={stop.customer?.klant_id ? "Klant stopt" : "Adres weghalen"}
        metKlant={Boolean(stop.customer?.klant_id)}
        omschrijving={
          stop.customer
            ? `${streets.find((s) => s.id === stop.customer?.street_id)?.name ?? ""} ${formatNumber(stop.customer)}`.trim()
            : ""
        }
        telDagen={() => geplandeDagen(stop.customer ? [stop.customer.id] : [])}
        onBevestig={(reden, planningWeg) =>
          stop.customer ? stopKlant(stop.customer, reden, planningWeg) : Promise.resolve()
        }
        onVerwijder={(planningWeg) =>
          stop.customer ? verwijderKlant(stop.customer, planningWeg) : Promise.resolve()
        }
      />
      <KlusDialog
        open={klus.open}
        onOpenChange={(open) => setKlus((k) => ({ ...k, open }))}
        customer={klus.customer}
        klus={null}
        onOpslaan={(customerId, omschrijving, prijs) =>
          void maakKlus(customerId, omschrijving, prijs)
        }
      />
      <HoekadresDialog
        open={hoek.open}
        onOpenChange={(open) => setHoek((h) => ({ ...h, open }))}
        customer={hoek.customer}
        straten={streets.filter((s) => s.district_id === actieveWijk)}
        onOpslaan={(patch) => hoek.customer && void patchKlant(hoek.customer, patch)}
      />
      <DubbelDialoog vraag={dubbelOpen} onKlaar={beantwoordDubbel} />
      <SneltoetsenHulp
        open={hulpOpen}
        onSluit={() => setHulpOpen(false)}
        toetsen={WIJK_SNELTOETSEN}
        waarvoor="Toetsen om sneller door je wijken te werken"
      />
      <KlantgegevensDialog
        open={dossier.open}
        onOpenChange={(open) => setDossier((d) => ({ ...d, open }))}
        klant={alleKlanten.find((k) => k.id === dossier.customer?.klant_id) ?? null}
        voorstelCustomer={dossier.customer}
        districts={districts}
        streets={alleStraten}
        customers={customers}
        klanten={alleKlanten}
        quickNotes={quickNotes}
        onAddQuickNote={nieuweSnelkeuze}
        standaardWijkId={actieveWijk}
        onSaved={() => {
          herlaad();
          qc.invalidateQueries({ queryKey: ["klanten"] });
        }}
      />
      <StratenAanvullen
        open={straatnamenOpen}
        onOpenChange={setStraatnamenOpen}
        streets={streets.filter((s) => s.district_id === actieveWijk)}
        plaats={wijkPlaats}
        onSaved={() => qc.invalidateQueries({ queryKey: ["streets"] })}
      />
      <StraatDialog
        districtId={actieveWijk ?? undefined}
        plaats={wijkPlaats}
        open={straatDialog.open}
        onOpenChange={(open) => setStraatDialog((s) => ({ ...s, open }))}
        street={straatDialog.street}
        groepen={subgroepen}
        onSaved={herlaad}
      />
      <SplitsStraatDialog
        open={splits.open}
        onOpenChange={(open) => setSplits((s) => ({ ...s, open }))}
        street={splits.street}
        adressen={splits.adressen}
        straatAantal={
          splits.open ? customers.filter((c) => c.street_id === splits.street?.id).length : 0
        }
        bestaandeNamen={streets.map((s) => s.name)}
        onSplitsen={(naam, volledig) => {
          if (splits.street) void splitsStraat(splits.street, splits.adressen, naam, volledig);
        }}
      />
      <GroepDialog
        open={groepDialog.open}
        onOpenChange={(open) => setGroepDialog((g) => ({ ...g, open }))}
        groep={groepDialog.groep}
        onOpslaan={(naam) => {
          if (groepDialog.groep) void hernoemGroep(groepDialog.groep, naam);
          else if (groepDialog.street) void maakGroepMetStraat(groepDialog.street, naam);
        }}
      />
    </AppLayout>
  );
}

interface SectieProps {
  groep: StraatGroep;
  /** De adressen die in deze groep zitten, over alle straten heen. */
  klantIds: string[];
  aantal: number;
  totaal: number;
  ingeklapt: boolean;
  prijzenTonen: boolean;
  duurTonen: boolean;
  /** Zonder planning: alleen kijken, niets verslepen, hernoemen of weggooien. */
  magPlannen: boolean;
  planmodus: boolean;
  dagKlaar: boolean;
  opDeDag: Set<string>;
  eerderGewassen: Map<string, string>;
  elderGepland: Map<string, string>;
  /** Deze maand aan de deur teruggemeld als niet gewassen: de dag. */
  nietGewassen: Map<string, string>;
  onKlap: (groepId: string) => void;
  onGroepOpDag: (groepId: string, aan: boolean) => void;
  onEdit: (groep: StraatGroep) => void;
  onDelete: (groep: StraatGroep) => void;
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  negeerKlik: React.MutableRefObject<boolean>;
  children: ReactNode;
}

/**
 * Een stuk van de wijk met een eigen naam. De kop werkt als de straatkop
 * eronder — vinkje, streek, in- en uitklappen — maar dan voor alles wat
 * eronder hangt.
 *
 * Ingeklapt tekent hij zijn straten niet; ze staan er dan werkelijk niet, en
 * daarmee ook geen van hun regels. Dat is het goedkoopste dat er is: je hebt
 * gezegd dat je deze kant van de wijk nu niet nodig hebt.
 */
const GroepSectie = memo(function GroepSectie(p: SectieProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `g:${p.groep.id}`,
    disabled: !p.magPlannen,
  });

  // Precies dezelfde optelling als in de straatkop, maar dan over de hele
  // groep. Zie StraatBlok voor waarom het zo geteld wordt.
  const erop = p.klantIds.filter((id) => p.opDeDag.has(id)).length;
  const alGedaan = p.klantIds.filter((id) => !p.opDeDag.has(id) && p.eerderGewassen.has(id)).length;
  const alGepland = p.klantIds.filter((id) => !p.opDeDag.has(id) && p.elderGepland.has(id)).length;
  const rond = p.klantIds.length > 0 && erop === 0 && alGedaan + alGepland === p.klantIds.length;
  const kopKleur =
    !p.planmodus || !rond
      ? "bg-transparent"
      : alGedaan >= alGepland
        ? "bg-tint-groen"
        : "bg-tint-paars";
  const vink: boolean | "indeterminate" =
    erop === 0 ? false : erop === p.klantIds.length ? true : "indeterminate";
  const gevuld =
    erop === 0 || p.klantIds.length === 0
      ? 0
      : Math.max(10, Math.round((erop / p.klantIds.length) * 100));
  const bruikbaar = p.klantIds.length > 0 && p.dagKlaar;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // [column-span:all] laat de groep over beide kolommen lopen, zodat de
      // straten die er niet in zitten er gewoon onder verder gaan in plaats
      // van ernaast. Binnen de groep staan de straten zelf weer in twee
      // kolommen, net als daarbuiten.
      className={`mb-3 break-inside-avoid-column rounded-[22px] border border-dashed border-border bg-surface/70 p-2 [column-span:all] ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div
        // Ook buiten de selecteermodus: met twee vingers of Cmd/Ctrl-klik
        // begin je hier een streek, en dan gaat de modus pas aan.
        data-verf-groep={p.groep.id}
        {...(p.planmodus
          ? {
              onClick: () => {
                if (p.negeerKlik.current) {
                  p.negeerKlik.current = false;
                  return;
                }
                if (bruikbaar) p.onGroepOpDag(p.groep.id, vink !== true);
              },
              onPointerDown: (e: React.PointerEvent) => {
                // Alleen de linkerknop zonder Ctrl: rechts (of Ctrl-klik op de Mac) opent het menu, en vinkt niets om.
                if (e.pointerType !== "touch" && e.button === 0 && !e.ctrlKey && bruikbaar) {
                  p.onVerfStart(vink !== true, e.clientX, e.clientY);
                }
              },
            }
          : {})}
        style={
          gevuld > 0
            ? {
                backgroundImage: `linear-gradient(to right, var(--voortgang, var(--tint-amber)) ${gevuld}%, transparent ${gevuld}%)`,
              }
            : undefined
        }
        className={`mb-1.5 flex items-center gap-1 rounded-[11px] px-2 py-1.5 ${kopKleur} ${
          p.planmodus && bruikbaar ? "cursor-pointer select-none" : ""
        }`}
      >
        {p.planmodus ? (
          <Checkbox
            className="mr-1 touch-none"
            checked={vink}
            disabled={!bruikbaar}
            onCheckedChange={(v) => {
              if (p.negeerKlik.current) {
                p.negeerKlik.current = false;
                return;
              }
              p.onGroepOpDag(p.groep.id, v === true);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button === 0 && !e.ctrlKey) p.onVerfStart(vink !== true, e.clientX, e.clientY);
            }}
            aria-label={`Hele groep ${p.groep.naam} op de dag`}
          />
        ) : (
          <button
            className={`cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing max-md:hidden ${
              p.magPlannen ? "" : "invisible"
            }`}
            aria-label="Groep verslepen"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        <button
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            p.onKlap(p.groep.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={p.ingeklapt ? "Groep uitklappen" : "Groep inklappen"}
          aria-expanded={!p.ingeklapt}
        >
          {p.ingeklapt ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <h2 className="flex-1 truncate font-display text-[13.5px] font-semibold tracking-[-0.01em] text-foreground/70">
          {p.groep.naam}
        </h2>
        <span className="rounded-full bg-card px-2 py-[1px] text-[10.5px] tabular-nums text-muted-foreground">
          {p.planmodus && erop > 0 && erop < p.aantal ? `${erop}/${p.aantal}` : `${p.aantal}×`}
        </span>
        {p.planmodus && alGedaan > 0 && (
          <span
            className="rounded-full bg-tint-groen px-1.5 text-[11px] tabular-nums text-tint-groen-ink"
            title={`${alGedaan} deze maand al gewassen`}
          >
            {alGedaan} gedaan
          </span>
        )}
        {p.planmodus && alGepland > 0 && (
          <span
            className="rounded-full bg-tint-paars px-1.5 text-[11px] tabular-nums text-tint-paars-ink"
            title={`${alGepland} staat al op een andere dag`}
          >
            {alGepland} gepland
          </span>
        )}
        {p.prijzenTonen && (
          <span className="text-[12.5px] font-semibold tabular-nums">{formatPrice(p.totaal)}</span>
        )}
        {!p.planmodus && p.magPlannen && (
          <>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              onClick={() => p.onEdit(p.groep)}
              aria-label="Groep hernoemen"
              title="Groep hernoemen"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => p.onDelete(p.groep)}
              aria-label="Groep verwijderen"
              title="Groep verwijderen — de straten blijven staan"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>
      {p.ingeklapt ? (
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">
          {p.aantal} {p.aantal === 1 ? "adres" : "adressen"} ingeklapt
        </p>
      ) : (
        <div className="gap-3.5 md:columns-1 @min-[88rem]:columns-2">{p.children}</div>
      )}
    </section>
  );
});

interface BlokProps {
  /** "blok" is de kaart op de computer. Op de telefoon staat een straat als
   *  "regel" in de lijst: tik erop en de adressen klappen eronder open. */
  weergave: "blok" | "regel";
  /** Op de telefoon: staat de straat open? Er mogen er meer tegelijk open. */
  regelOpen: boolean;
  onKlapRegel: (streetId: string) => void;
  /** Op de telefoon: lang indrukken op een adres start het selecteren. */
  onLangIngedrukt: ((c: Customer) => void) | null;
  street: Street;
  even: Customer[];
  oneven: Customer[];
  aantal: number;
  totaal: number;
  sort: "asc" | "desc";
  prijzenTonen: boolean;
  duurTonen: boolean;
  /** Adressen toevoegen, stoppen en weggooien; huisnummer en prijs wijzigen. */
  magKlanten: boolean;
  /** Kleur, overslaan, notitie, frequentie en volgorde bijwerken. */
  magPlannen: boolean;
  quickNotes: QuickNote[];
  markeringen: MarkeringRij[];
  /** Naam per klant-id, voor het personen-icoontje op een gekoppelde regel. */
  klantNamen: Map<string, string>;
  /** De maand die je bekijkt; kleurt de regels. */
  ronde: string;
  rowText: string;
  rowPad: string;
  selectie: string[];
  onSelect: (c: Customer, shift: boolean) => void;
  /** De aangevinkte adressen uit deze straat lichten, in een nieuwe straat
   *  ernaast. Staat alleen in het menu in de selecteermodus, op een
   *  aangevinkt adres. */
  onSplitsen: (c: Customer) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  /** Opent het dossier van dit adres, hier op de pagina zelf. */
  onDossier: (c: Customer) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
  onStoppen: (c: Customer) => void;
  onNieuweRegel: (streetId: string, nummer: string) => void;
  onEditStreet: (street: Street) => void;
  onDeleteStreet: (street: Street) => void;
  onAddKlant: (streetId: string) => void;
  onToggleSort: (street: Street) => void;
  /** Zet de straat om van even/oneven naar doorlopend genummerd, en terug. */
  onToggleDoorlopend: (street: Street) => void;
  ingeklapt: boolean;
  onKlap: (streetId: string) => void;
  /** De subgroepen van deze wijk, voor het menu onder de rechtermuisknop. */
  groepen: StraatGroep[];
  onZetGroep: (street: Street, groepId: string | null) => void;
  onNieuweGroep: (street: Street) => void;
  /** In planmodus tel je adressen voor een dag; bewerken doe je dan niet. */
  planmodus: boolean;
  /** Vals zolang de dag nog opgehaald wordt: dan weten we van niets. */
  dagKlaar: boolean;
  opDeDag: Set<string>;
  /** Adressen die deze maand al op een andere dag gewassen zijn, met de dag. */
  eerderGewassen: Map<string, string>;
  /** Adressen die deze maand al op een latere dag ingepland staan, met de dag. */
  elderGepland: Map<string, string>;
  /** Deze maand aan de deur teruggemeld als niet gewassen: de dag. */
  nietGewassen: Map<string, string>;
  onStraatOpDag: (streetId: string, aan: boolean) => void;
  onKlantOpDag: (c: Customer, aan: boolean) => void;
  /** Begint een sleepselectie; `aan` is de kant die de hele streek opgaat. */
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  /** Staat op waar als de streek al iets deed — dan telt de klik erna niet. */
  negeerKlik: { current: boolean };
}

const StraatBlok = memo(function StraatBlok(p: BlokProps) {
  const regelOpen = p.regelOpen;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `s:${p.street.id}`,
    // Straten verslepen doe je op de computer. Op de telefoon zou je bij
    // het scrollen steeds per ongeluk een straat oppakken.
    disabled: !p.magPlannen || p.weergave !== "blok",
  });

  const zichtbaar = [...p.even, ...p.oneven];
  const erop = zichtbaar.filter((c) => p.opDeDag.has(c.id)).length;
  // Al deze maand gedaan, op een andere dag dan die je nu plant.
  const alGedaan = zichtbaar.filter(
    (c) => !p.opDeDag.has(c.id) && p.eerderGewassen.has(c.id),
  ).length;
  const alGepland = zichtbaar.filter(
    (c) => !p.opDeDag.has(c.id) && p.elderGepland.has(c.id),
  ).length;
  // De kop kleurt pas als de héle straat al rond is: dat is het signaal om
  // hem over te slaan. Staat er iets van op déze dag, dan wint het groen.
  const straatRond =
    zichtbaar.length > 0 && erop === 0 && alGedaan + alGepland === zichtbaar.length;
  const kopKleur =
    !p.planmodus || !straatRond
      ? "bg-card-header"
      : alGedaan >= alGepland
        ? "bg-tint-groen"
        : "bg-tint-paars";
  // "Half" zodra een deel van de zichtbare adressen op de dag staat — zo zie
  // je ingeklapt meteen in welke straat je iets hebt overgeslagen.
  const straatVink: boolean | "indeterminate" =
    erop === 0 ? false : erop === zichtbaar.length ? true : "indeterminate";
  // Hoeveel van de straat op de dag staat, als groene vulling in de kop.
  // Minstens 10%, anders is één adres van de zestig niet te zien.
  const gevuld =
    erop === 0 || zichtbaar.length === 0
      ? 0
      : Math.max(10, Math.round((erop / zichtbaar.length) * 100));

  if (p.weergave === "regel") {
    const bruikbaar = zichtbaar.length > 0 && p.dagKlaar;
    return (
      <section className="mb-2 overflow-hidden rounded-[16px] bg-card shadow-card">
        <div
          data-verf-straat={p.street.id}
          style={
            gevuld > 0
              ? {
                  backgroundImage: `linear-gradient(to right, var(--voortgang, var(--tint-amber)) ${gevuld}%, transparent ${gevuld}%)`,
                }
              : undefined
          }
          className={`flex min-h-[3.25rem] items-center gap-2.5 px-3 py-1.5 ${
            p.planmodus && straatRond ? kopKleur : ""
          }`}
        >
          {p.planmodus && (
            // Een streek over de vinkjes heen vinkt meerdere straten in één
            // keer aan, net als op de computer.
            <Checkbox
              className="size-5 shrink-0 touch-none"
              checked={straatVink}
              disabled={!bruikbaar}
              onCheckedChange={(v) => {
                if (p.negeerKlik.current) {
                  p.negeerKlik.current = false;
                  return;
                }
                p.onStraatOpDag(p.street.id, v === true);
              }}
              onPointerDown={(e) => {
                if (bruikbaar && e.button === 0) {
                  p.onVerfStart(straatVink !== true, e.clientX, e.clientY);
                }
              }}
              aria-label={`Hele ${p.street.name} op de dag`}
            />
          )}
          <button
            type="button"
            onClick={() => p.onKlapRegel(p.street.id)}
            aria-expanded={regelOpen}
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
          >
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-display text-[15.5px] font-semibold tracking-[-0.01em]">
                {p.street.name}
              </span>
              <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
                {p.planmodus && erop > 0 ? `${erop} van ${p.aantal}` : p.aantal}{" "}
                {p.aantal === 1 ? "adres" : "adressen"}
                {p.prijzenTonen ? ` · ${formatPrice(p.totaal)}` : ""}
              </span>
            </span>
            {p.planmodus && alGedaan > 0 && (
              <span className="shrink-0 rounded-full bg-tint-groen px-2 py-0.5 text-[11px] tabular-nums text-tint-groen-ink">
                {alGedaan} gedaan
              </span>
            )}
            {p.planmodus && alGepland > 0 && (
              <span className="shrink-0 rounded-full bg-tint-paars px-2 py-0.5 text-[11px] tabular-nums text-tint-paars-ink">
                {alGepland} gepland
              </span>
            )}
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                regelOpen ? "" : "-rotate-90"
              }`}
            />
          </button>
          {regelOpen && !p.planmodus && (p.magPlannen || p.magKlanten) && (
            <StraatMenu
              street={p.street}
              groepen={p.groepen}
              magPlannen={p.magPlannen}
              magKlanten={p.magKlanten}
              onAddKlant={p.onAddKlant}
              onToggleSort={p.onToggleSort}
              onToggleDoorlopend={p.onToggleDoorlopend}
              onEdit={p.onEditStreet}
              onDelete={p.onDeleteStreet}
              onZetGroep={p.onZetGroep}
              onNieuweGroep={p.onNieuweGroep}
            />
          )}
        </div>
        {regelOpen && (
          <div className="border-t border-border/70 px-2 pb-1">
            {zichtbaar.length === 0 && (
              <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">
                Met dit filter staan er geen adressen van deze straat in beeld.
              </p>
            )}
            {(["even", "oneven"] as const)
              .filter((kant) => p[kant].length > 0)
              .map((kant) => (
                <div key={kant} className="mb-1">
                  {/* Doorlopend genummerd is één reeks: dan alleen boven de
                      eerste helft een kopje. */}
                  {(!p.street.doorlopend || kant === "even" || p.even.length === 0) && (
                    <div className="px-2 pb-0.5 pt-2 text-[12px] font-medium text-muted-foreground">
                      {p.street.doorlopend
                        ? `Alle nummers · ${p.aantal}`
                        : `${kant === "even" ? "Even" : "Oneven"} kant · ${p[kant].length}`}
                    </div>
                  )}
                  <StraatKolom regels={p[kant]} blok={p} kant={kant} />
                </div>
              ))}
            {/* Onderaan de straat, niet tussen de even en oneven kant: is
                de even kant leeg, dan stond hij anders bovenaan. */}
            {p.magKlanten && (
              <NieuweRegel
                onSubmit={(nr) => p.onNieuweRegel(p.street.id, nr)}
                rowText={p.rowText}
              />
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`mb-3 break-inside-avoid-column overflow-hidden rounded-[18px] bg-card p-1.5 shadow-card transition-shadow ${isDragging ? "opacity-50" : ""}`}
    >
      {/* Rechtermuisknop op de straatkop: hierin zit alles wat met
          groepen te maken heeft. Dat hoort niet in de kop zelf — die is al
          vol, en dit doe je een paar keer per jaar. */}
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!p.magPlannen}>
          <div
            data-verf-straat={p.street.id}
            {...(p.planmodus
              ? {
                  // De hele kop is de knop; alleen het pijltje klapt in of uit.
                  onClick: () => {
                    // Met de muis heeft het indrukken het al gedaan; dit is het
                    // pad voor aanraken en toetsenbord.
                    if (p.negeerKlik.current) {
                      p.negeerKlik.current = false;
                      return;
                    }
                    if (zichtbaar.length > 0 && p.dagKlaar)
                      p.onStraatOpDag(p.street.id, straatVink !== true);
                  },
                  onPointerDown: (e: React.PointerEvent) => {
                    // Bij aanraken niet: dan is een veeg over de kop bedoeld om te
                    // scrollen. Op de telefoon begin je een streek op het vinkje.
                    if (
                      e.pointerType !== "touch" &&
                      e.button === 0 &&
                      !e.ctrlKey &&
                      zichtbaar.length > 0 &&
                      p.dagKlaar
                    ) {
                      p.onVerfStart(straatVink !== true, e.clientX, e.clientY);
                    }
                  },
                }
              : {})}
            style={
              gevuld > 0
                ? {
                    backgroundImage: `linear-gradient(to right, var(--voortgang, var(--tint-amber)) ${gevuld}%, transparent ${gevuld}%)`,
                  }
                : undefined
            }
            className={`flex items-center gap-1 rounded-[12px] px-2.5 py-2 ${kopKleur} ${
              p.planmodus && zichtbaar.length > 0 && p.dagKlaar ? "cursor-pointer select-none" : ""
            }`}
          >
            {p.planmodus ? (
              <Checkbox
                className="mr-1 touch-none"
                checked={straatVink}
                disabled={zichtbaar.length === 0 || !p.dagKlaar}
                onCheckedChange={(v) => {
                  if (p.negeerKlik.current) {
                    p.negeerKlik.current = false;
                    return;
                  }
                  p.onStraatOpDag(p.street.id, v === true);
                }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button === 0 && !e.ctrlKey)
                    p.onVerfStart(straatVink !== true, e.clientX, e.clientY);
                }}
                aria-label={`Hele ${p.street.name} op de dag`}
              />
            ) : (
              <button
                className={`cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing ${
                  p.magPlannen ? "" : "invisible"
                }`}
                aria-label="Straat verslepen"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="size-3.5" />
              </button>
            )}
            <button
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                p.onKlap(p.street.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={p.ingeklapt ? "Straat uitklappen" : "Straat inklappen"}
              aria-expanded={!p.ingeklapt}
            >
              {p.ingeklapt ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            <h2 className="flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {p.street.name}
            </h2>
            <span className="rounded-full bg-surface px-2 py-[1px] text-[10.5px] tabular-nums text-muted-foreground">
              {p.planmodus && erop > 0 && erop < p.aantal ? `${erop}/${p.aantal}` : `${p.aantal}×`}
            </span>
            {p.planmodus && alGedaan > 0 && (
              <span
                className="rounded-full bg-tint-groen px-1.5 text-[11px] tabular-nums text-tint-groen-ink"
                title={`${alGedaan} deze maand al gewassen`}
              >
                {alGedaan} gedaan
              </span>
            )}
            {p.planmodus && alGepland > 0 && (
              <span
                className="rounded-full bg-tint-paars px-1.5 text-[11px] tabular-nums text-tint-paars-ink"
                title={`${alGepland} staat al op een andere dag`}
              >
                {alGepland} gepland
              </span>
            )}
            {p.prijzenTonen && (
              <span className="text-[12.5px] font-semibold tabular-nums">
                {formatPrice(p.totaal)}
              </span>
            )}

            {!p.planmodus && (
              <>
                {p.magPlannen && (
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-accent"
                    onClick={() => p.onToggleSort(p.street)}
                    aria-label={
                      p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"
                    }
                    title={p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"}
                  >
                    {p.sort === "asc" ? (
                      <ArrowUpNarrowWide className="size-3.5" />
                    ) : (
                      <ArrowDownNarrowWide className="size-3.5" />
                    )}
                  </button>
                )}
                {p.magKlanten && (
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-accent"
                    onClick={() => p.onAddKlant(p.street.id)}
                    aria-label="Klant toevoegen"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
                {p.magPlannen && (
                  <>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                      onClick={() => p.onEditStreet(p.street)}
                      aria-label="Straat bewerken"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                      onClick={() => p.onDeleteStreet(p.street)}
                      aria-label="Straat verwijderen"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{p.street.name}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Layers className="size-4" /> Toevoegen aan groep
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
              <ContextMenuItem onSelect={() => p.onNieuweGroep(p.street)}>
                <Plus className="size-4" /> Nieuwe groep…
              </ContextMenuItem>
              {p.groepen.length > 0 && <ContextMenuSeparator />}
              {p.groepen.map((groep) => (
                <ContextMenuItem key={groep.id} onSelect={() => p.onZetGroep(p.street, groep.id)}>
                  {groep.naam}
                  {p.street.groep_id === groep.id && <Check className="ml-auto size-4" />}
                </ContextMenuItem>
              ))}
              {p.street.groep_id && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => p.onZetGroep(p.street, null)}>
                    <CircleSlash className="size-4" /> Uit de groep halen
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          {/* Niet elke straat is even links en oneven rechts: soms staan alle
              nummers aan dezelfde kant en loop je ze op volgorde af. */}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => p.onToggleDoorlopend(p.street)}>
            <ListOrdered className="size-4" /> Nummers lopen per 1 op
            {p.street.doorlopend && <Check className="ml-auto size-4" />}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div className={`grid grid-cols-2 gap-2 px-1 pt-1 ${p.ingeklapt ? "hidden" : ""}`}>
        {(["even", "oneven"] as const).map((kant) => (
          <div key={kant} className="min-w-0">
            <div className="flex items-center gap-0.5 px-1 pb-0.5 text-[10.5px] font-medium text-muted-foreground/60">
              <span className="w-4" />
              <span className="w-11">nr</span>
              <span className="min-w-0 flex-1 truncate">notitie</span>
              {p.prijzenTonen && <span className="w-12 text-right">prijs</span>}
              {p.duurTonen && <span className="w-12 text-right">duur</span>}
              <span className="min-w-[3.25rem] max-w-[5.5rem] pl-1 text-center">freq.</span>
              <span className="w-4" />
            </div>
            <StraatKolom regels={p[kant]} blok={p} kant={kant} />
            {kant === "even" && p.magKlanten && (
              <NieuweRegel
                onSubmit={(nr) => p.onNieuweRegel(p.street.id, nr)}
                rowText={p.rowText}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
});

/**
 * Eén helft van een straat: de even of de oneven kant.
 *
 * Dit is een eigen component omdat de id-lijst voor dnd-kit een vaste
 * identiteit moet houden — en een `useMemo` kan niet in de lus over de twee
 * helften staan. Krijgt SortableContext elke render een verse array, dan
 * wisselt zijn context en hertekent React alle regels eronder, hoeveel `memo`
 * je er ook omheen zet.
 */
const StraatKolom = memo(function StraatKolom({
  regels,
  blok: p,
  kant,
}: {
  regels: Customer[];
  blok: BlokProps;
  kant: Kant;
}) {
  // Een losplek per kolom, niet één voor de hele straat: waar je loslaat
  // bepaalt de kant, en in een lege kolom moet je ook kunnen mikken.
  const { setNodeRef: setZoneRef } = useDroppable({ id: `z:${p.street.id}:${kant}` });
  // Op de sleutel en niet op `regels`: die array is na elke wijziging nieuw,
  // ook als er alleen een prijs in één regel veranderde. De id-lijst is dan
  // inhoudelijk hetzelfde, en dnd-kit hoort daar niet wakker van te worden.
  const sleutel = regels.map((c) => c.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => regels.map((c) => `c:${c.id}`), [sleutel]);
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div ref={setZoneRef} className="min-h-6">
        {regels.map((c) => (
          <KlantRij
            key={c.id}
            customer={c}
            prijzenTonen={p.prijzenTonen}
            duurTonen={p.duurTonen}
            magKlanten={p.magKlanten}
            magPlannen={p.magPlannen}
            quickNotes={p.quickNotes}
            markeringen={p.markeringen}
            klantNaam={c.klant_id ? p.klantNamen.get(c.klant_id) : undefined}
            rowText={p.rowText}
            rowPad={p.rowPad}
            geselecteerd={p.selectie.includes(c.id)}
            magSplitsen={p.planmodus && p.opDeDag.has(c.id)}
            ronde={p.ronde}
            opDeDag={p.opDeDag.has(c.id)}
            eerderGewassen={p.eerderGewassen.get(c.id)}
            elderGepland={p.elderGepland.get(c.id)}
            nietGewassen={p.nietGewassen.get(c.id)}
            dagKlaar={p.dagKlaar}
            onOpDag={p.onKlantOpDag}
            onVerfStart={p.onVerfStart}
            negeerKlik={p.negeerKlik}
            onLangIngedrukt={p.onLangIngedrukt}
            onSelect={p.onSelect}
            onSplitsen={p.onSplitsen}
            onPatch={p.onPatch}
            onAddQuickNote={p.onAddQuickNote}
            onDelete={p.onDelete}
            onDossier={p.onDossier}
            onHoekadres={p.onHoekadres}
            onKlus={p.onKlus}
            onStoppen={p.onStoppen}
          />
        ))}
      </div>
    </SortableContext>
  );
});

interface RijProps {
  customer: Customer;
  prijzenTonen: boolean;
  duurTonen: boolean;
  magKlanten: boolean;
  magPlannen: boolean;
  quickNotes: QuickNote[];
  markeringen: MarkeringRij[];
  klantNaam?: string | undefined;
  rowText: string;
  rowPad: string;
  geselecteerd: boolean;
  /** Selecteermodus aan en dit adres aangevinkt? Dan kan het menu de
   *  aangevinkte adressen van deze straat afsplitsen. */
  magSplitsen: boolean;
  /** De maand die je bekijkt: die bepaalt de kleur van de regel. */
  ronde: string;
  opDeDag: boolean;
  /** Deze maand al op een andere dag gewassen: de dag ("2026-09-15"). */
  eerderGewassen: string | undefined;
  /** Deze maand al op een latere dag ingepland: de dag. */
  elderGepland: string | undefined;
  /** Deze maand aan de deur teruggemeld als niet gewassen: de dag. */
  nietGewassen: string | undefined;
  dagKlaar: boolean;
  onOpDag: (c: Customer, aan: boolean) => void;
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  negeerKlik: { current: boolean };
  /** Op de telefoon: lang indrukken start het selecteren met dit adres. */
  onLangIngedrukt: ((c: Customer) => void) | null;
  onSelect: (c: Customer, shift: boolean) => void;
  onSplitsen: (c: Customer) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  onDossier: (c: Customer) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
  onStoppen: (c: Customer) => void;
}

/**
 * Kleur per frequentie: blauw is het accent, amber de even maanden, grijs de oneven.
 * Het amber badge krijgt een randje: een aangevinkte rij is zelf ook amber,
 * en zonder rand valt het badge daar helemaal in weg.
 *
 * Gememoïseerd, want een wijk telt honderden regels en elke wijziging schrijft
 * er maar één van om. De optimistische update in `patchKlant` laat de andere
 * regels bij hun oude object, dus die slaan hier over.
 */
/**
 * De dunne schil die aan de sleepbeweging hangt.
 *
 * Alles wat `useSortable` aanroept, hertekent bij élke muisbeweging tijdens
 * een sleep: die hook volgt de DndContext, en die werkt continu bij. Dat is
 * niet te vermijden — maar wel goedkoop te houden. Daarom staat hier niet
 * meer dan de buitenste laag en het greepje, en komt de eigenlijke regel als
 * `children` binnen. Die elementen maakt `KlantRij` aan, en zolang díe niet
 * hertekent blijven het dezelfde objecten, dus laat React de hele inhoud met
 * rust. Zie docs/performance-notes.md.
 */
function KlantRijSleep({
  id,
  className,
  verfKlant,
  onGreep,
  children,
  // Het contextmenu eromheen gebruikt `asChild` en hangt zijn eigen ref en
  // onContextMenu aan wat het binnenkrijgt. Vroeger was dat de div hieronder
  // en ging dat vanzelf goed; nu zit deze component ertussen, en moet alles
  // wat hij niet zelf kent doorgegeven worden — anders doet de rechtermuis-
  // knop op een regel niets meer.
  ref: buitenRef,
  ...rest
}: {
  id: string;
  className: string;
  /** In de selecteerstand hangt de streek-afhandeling aan dit attribuut. */
  verfKlant?: string | undefined;
  /** Null in de selecteerstand: dan is er geen greepje om aan te trekken. */
  onGreep: ((e: React.MouseEvent) => void) | null;
  children: ReactNode;
  ref?: React.Ref<HTMLDivElement>;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        if (typeof buitenRef === "function") buitenRef(node);
        else if (buitenRef) buitenRef.current = node;
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${className} ${isDragging ? "opacity-40" : ""}`}
      {...(verfKlant ? { "data-verf-klant": verfKlant } : {})}
      {...rest}
    >
      {onGreep && (
        <button
          // In de selecteermodus sleep je niet: dan ben je een dag aan het
          // samenstellen. Via CSS, zodat de regel niet hertekend hoeft.
          className="cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing in-data-[selecteren]:hidden"
          aria-label="Regel verslepen"
          data-sleepgreep=""
          onClick={onGreep}
          {...attributes}
          {...listeners}
          // Ná attributes, want dnd-kit zet er zelf tabIndex 0 op. Tab hoort
          // van vakje naar vakje te springen, niet langs de sleepgreepjes;
          // er is geen toetsenbordsensor, dus hier gaat niets verloren.
          tabIndex={-1}
        >
          <GripVertical className="size-3" />
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * De regel zelf: nummer, notitie, prijs, ritme en de knoppen erachter.
 *
 * Apart van de schil hierboven, en gememoïseerd, want dit is het dure deel.
 * Zolang er aan dit adres niets verandert hoeft het tijdens een sleep geen
 * enkele keer opnieuw getekend te worden.
 */
/**
 * Het vinkje en het kliklaagje van de selecteermodus. Los van de rest van de
 * regel: aan- en uitzetten van de modus hertekent dan alleen dit kleine
 * stukje, niet de notitie, prijs en menu's van honderden regels.
 */
const SelecteerVakje = memo(function SelecteerVakje({
  customer: c,
  uitleg,
  opDeDag,
  dagKlaar,
  onOpDag,
  onVerfStart,
  negeerKlik,
}: Pick<
  RijProps,
  "customer" | "opDeDag" | "dagKlaar" | "onOpDag" | "onVerfStart" | "negeerKlik"
> & {
  /** Waarom de regel groen of paars is; het laagje ligt boven het label. */
  uitleg?: string | undefined;
}) {
  // Staat er altijd, maar alleen zichtbaar binnen [data-selecteren]: zo
  // hoeft de modus aan- of uitzetten geen enkele regel te hertekenen.
  return (
    <>
      {/* In de selecteerstand ligt de hele regel op slot: je bent een dag
              aan het samenstellen, niet aan het bijwerken. Eén doorzichtig
              laagje vangt alle klikken, zodat je overal op de regel kunt
              aanvinken en nergens per ongeluk een notitie openklikt. */}
      <div
        role="checkbox"
        aria-checked={opDeDag}
        aria-disabled={!dagKlaar}
        aria-label={`${formatNumber(c)} op de dag`}
        title={uitleg}
        // Buiten de modus is het laagje verborgen en dus ook niet te bereiken
        // met Tab; erin spring je van vakje naar vakje.
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          if (dagKlaar) onOpDag(c, !opDeDag);
        }}
        className={`absolute inset-0 z-10 hidden rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring in-data-[selecteren]:block ${dagKlaar ? "cursor-pointer" : "cursor-not-allowed"}`}
        onPointerDown={(e) => {
          // Alleen de linkerknop zonder Ctrl: met rechts of Ctrl-klik open je het menu (en kun je
          // splitsen), dan hoort het vinkje te blijven staan.
          // Met een vinger niet: dan zou je bij het scrollen adressen
          // aanvinken, en op een iPhone schakelt de tik erna hem terug.
          // Een tik doet het via onClick; vegen gaat met twee vingers.
          if (e.pointerType === "touch") negeerKlik.current = false;
          else if (dagKlaar && e.button === 0 && !e.ctrlKey)
            onVerfStart(!opDeDag, e.clientX, e.clientY);
        }}
        onClick={() => {
          // Kwam je hier via een streek, dan is het vakje al om.
          if (negeerKlik.current) {
            negeerKlik.current = false;
            return;
          }
          if (dagKlaar) onOpDag(c, !opDeDag);
        }}
      />
      {/* Alleen het plaatje van een vinkje; het laagje hierboven vangt de
          klik. Een echte Checkbox per regel is voor honderden regels te
          zwaar om steeds klaar te hebben staan. */}
      <span
        aria-hidden="true"
        className={`hidden size-3.5 shrink-0 place-content-center rounded-sm border border-primary shadow in-data-[selecteren]:grid ${
          opDeDag ? "bg-primary text-primary-foreground" : ""
        } ${dagKlaar ? "" : "opacity-50"}`}
      >
        {opDeDag && <Check className="size-3.5" />}
      </span>
    </>
  );
});

type InhoudProps = Pick<
  RijProps,
  | "customer"
  | "prijzenTonen"
  | "duurTonen"
  | "magKlanten"
  | "magPlannen"
  | "quickNotes"
  | "klantNaam"
  | "ronde"
  | "onPatch"
  | "onAddQuickNote"
  | "onDelete"
  | "onDossier"
> & {
  /** Alleen in de selecteermodus te zien: de dag van "al gewassen" of "al
   *  ingepland". Leeg bij de meeste regels, dus die hertekenen niet. */
  gewassenOp?: string | undefined;
  geplandOp?: string | undefined;
  /** De dag waarop een geldloper terugmeldde dat er niet gewassen is. */
  overgeslagenOp?: string | undefined;
};

const KlantRijInhoud = memo(function KlantRijInhoud({
  customer: c,
  prijzenTonen,
  duurTonen,
  magKlanten,
  magPlannen,
  quickNotes,
  klantNaam,
  ronde: dezeMaand,
  onPatch,
  onAddQuickNote,
  onDelete,
  onDossier,
  gewassenOp,
  geplandOp,
  overgeslagenOp,
}: InhoudProps) {
  return (
    <>
      {/* Het greepje om aan te slepen staat in KlantRijSleep hierboven: dat
          hangt aan de sleepbeweging, de rest hieronder niet. Het vinkje van
          de selecteermodus staat in SelecteerVakje. */}
      <div className="flex w-11 shrink-0 items-center gap-px">
        {isHoekadres(c) && (
          <CornerDownRight
            className="size-2.5 shrink-0 text-muted-foreground"
            aria-label={c.hoek_straat ? `hoek ${c.hoek_straat}` : "hoekadres"}
          />
        )}
        <InlineCel
          value={`${c.house_number}${c.addition ?? ""}`}
          align="left"
          className="min-w-0 font-medium"
          alleenLezen={!magKlanten}
          onCommit={(v) => {
            const m = /^(\d+)\s*(.*)$/.exec(v.trim());
            if (!m) return;
            onPatch(c, { house_number: parseInt(m[1]!, 10), addition: (m[2] ?? "").trim() });
          }}
        />
      </div>
      {c.hoek_straat && (
        <span
          className="shrink-0 text-[10px] uppercase text-muted-foreground"
          title={`Hoort bij ${c.hoek_straat}`}
        >
          {c.hoek_straat}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <NotitieCel
          value={c.note}
          maandwerk={c.maandwerk}
          onChangeMaandwerk={(werk) => onPatch(c, { maandwerk: werk })}
          beurtMaanden={ritmeMaanden(c).map((m) => String(m).padStart(2, "0"))}
          quickNotes={quickNotes}
          onChange={(v) => onPatch(c, { note: v })}
          onAddQuickNote={onAddQuickNote}
          alleenLezen={!magPlannen}
        />
      </div>
      {/* Alleen in de selecteermodus, op de plek waar daarbuiten de
          overslaan-tegels staan. Vaste breedte, ook leeg, zodat prijs en
          frequentie in de pas blijven. */}
      <span className="hidden w-12 shrink-0 justify-end in-data-[selecteren]:flex">
        {(gewassenOp || geplandOp || overgeslagenOp) && (
          <span
            title={
              overgeslagenOp
                ? "Aan de deur teruggemeld: hier is deze maand niet gewassen"
                : undefined
            }
            className={`whitespace-nowrap rounded-full px-1.5 text-[10.5px] tabular-nums ${
              overgeslagenOp
                ? "bg-tint-rood-ink/15 text-tint-rood-ink"
                : gewassenOp
                  ? "bg-tint-groen-ink/15 text-tint-groen-ink"
                  : "bg-tint-paars-ink/15 text-tint-paars-ink"
            }`}
          >
            {overgeslagenOp ? "✗ " : gewassenOp ? "✓ " : ""}
            {kortDag((overgeslagenOp ?? gewassenOp ?? geplandOp)!)}
          </span>
        )}
      </span>
      {/* In de selecteermodus weg, via CSS: zo hoeft de regel niet opnieuw
          getekend te worden als je de modus aan- of uitzet. */}
      <span className="contents in-data-[selecteren]:hidden">
        <>
          {/* Aan de deur teruggemeld: hier is deze maand niet gewassen, dus
              dit adres moet nog een beurt. Verdwijnt vanzelf zodra hij weer
              ergens op een dag staat. */}
          {overgeslagenOp && (
            <span
              title={`Op ${toonKorteDag(overgeslagenOp)} teruggemeld: hier is niet gewassen. Dit adres moet nog een beurt.`}
              className="shrink-0 whitespace-nowrap rounded-full bg-tint-rood px-1.5 py-[2px] text-[10px] font-semibold text-tint-rood-ink ring-1 ring-inset ring-tint-rood-ink/25"
            >
              nog wassen
            </span>
          )}
          <Overgeslagen customer={c} />
          <WassenVanaf
            customer={c}
            ronde={dezeMaand}
            onPatch={(patch) => onPatch(c, patch)}
            alleenLezen={!magPlannen}
          />
        </>
      </span>
      {prijzenTonen && (
        <div className="w-16 shrink-0">
          <PrijsCel
            customer={c}
            ronde={dezeMaand}
            onPatch={(patch) => onPatch(c, patch)}
            alleenLezen={!magKlanten}
          />
        </div>
      )}
      {duurTonen && (
        <div className="w-12 shrink-0">
          <DuurCel
            customer={c}
            ronde={dezeMaand}
            onPatch={(patch) => onPatch(c, patch)}
            alleenLezen={!magKlanten && !magPlannen}
          />
        </div>
      )}
      <FrequentieKiezer
        customer={c}
        onPatch={(patch) => onPatch(c, patch)}
        alleenLezen={!magPlannen}
      />
      {/* Vaste breedte, ook zonder klant: anders krimpt de notitiekolom van
          precies die ene rij en lopen de kolommen uit de pas. */}
      <span className="w-3 shrink-0">
        {klantNaam && (
          // Hetzelfde dossier als achter de rechtermuisknop. Dit was een link
          // naar de klantenpagina, maar dan zoek je je gegevens twee keer op.
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onDossier(c)}
            title={klantNaam}
            aria-label={`Dossier van ${klantNaam}`}
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <User className="size-3" />
          </button>
        )}
      </span>
      {/* Op de telefoon is er geen hover en geen rechtermuisknop: dit knopje
          opent hetzelfde menu als rechts klikken. Stoppen of verwijderen
          staat daar ook in. */}
      <button
        type="button"
        tabIndex={-1}
        className="relative z-20 -my-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground md:hidden"
        aria-label="Meer voor dit adres"
        onClick={(e) => {
          const knop = e.currentTarget.getBoundingClientRect();
          e.currentTarget.closest("[data-klantrij]")?.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: knop.right,
              clientY: knop.bottom,
            }),
          );
        }}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {magKlanten ? (
        <button
          tabIndex={-1}
          // Boven het kliklaagje van de selecteerstand (z-10): de regel ligt
          // dan op slot, maar het prullenbakje vraagt eerst wat je wilt, dus
          // per ongeluk gaat er niets weg.
          className="relative z-20 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive max-md:hidden"
          onClick={() => onDelete(c)}
          aria-label="Stoppen of verwijderen"
          title="Stoppen of verwijderen"
        >
          <Trash2 className="size-3" />
        </button>
      ) : (
        // Dezelfde breedte, zodat de kolommen in de pas blijven.
        <span className="w-3 shrink-0 max-md:hidden" />
      )}
    </>
  );
});

/**
 * Kleur per frequentie: blauw is het accent, amber de even maanden, grijs de oneven.
 * Het amber badge krijgt een randje: een aangevinkte rij is zelf ook amber,
 * en zonder rand valt het badge daar helemaal in weg.
 *
 * Gememoïseerd, want een wijk telt honderden regels en elke wijziging schrijft
 * er maar één van om. De optimistische update in `patchKlant` laat de andere
 * regels bij hun oude object, dus die slaan hier over.
 */
const KlantRij = memo(function KlantRij(p: RijProps) {
  const c = p.customer;
  // Alleen buiten de selecteermodus: daarin is een tik al aanvinken, en lang
  // indrukken opent het menu (om af te splitsen).
  // (De hook kijkt zelf of de regel in [data-selecteren] staat.)
  const langIndrukken = useLangIndrukken(p.onLangIngedrukt ? () => p.onLangIngedrukt?.(c) : null);

  // In planmodus vertelt de kleur waar je die dag staat; daarbuiten waar je
  // op moet letten. Twee kleursystemen tegelijk zou niet te lezen zijn.
  // Beide staan klaar; CSS kiest via [data-selecteren] welke je ziet, zodat
  // de modus wisselen de regel niet hoeft te hertekenen.
  const kleur = regelKleur(c, p.ronde, p.markeringen);
  const dagKleur = p.opDeDag
    ? "in-data-[selecteren]:bg-tint-amber"
    : p.nietGewassen
      ? "in-data-[selecteren]:bg-tint-rood"
      : p.eerderGewassen
        ? "in-data-[selecteren]:bg-tint-groen"
        : p.elderGepland
          ? "in-data-[selecteren]:bg-tint-paars"
          : "in-data-[selecteren]:bg-transparent";
  // Onder de muis in de modus: de dagkleur blijft staan (anders zie je niet
  // of hij aangevinkt is), en een regel zonder dagkleur wordt grijs — ook als
  // hij buiten de modus een printlijstkleur heeft. Met ! zodat hij wint van
  // de gewone hover hieronder.
  const dagHover = p.opDeDag
    ? "in-data-[selecteren]:hover:bg-tint-amber!"
    : p.nietGewassen
      ? "in-data-[selecteren]:hover:bg-tint-rood!"
      : p.eerderGewassen
        ? "in-data-[selecteren]:hover:bg-tint-groen!"
        : p.elderGepland
          ? "in-data-[selecteren]:hover:bg-tint-paars!"
          : "in-data-[selecteren]:hover:bg-muted/70!";
  const achtergrond = `${kleur ? tintAchtergrond[kleur] : ""} ${dagKleur} ${dagHover}`;
  // Wánneer, niet alleen dát. Staat hij op de dag die je nu maakt, dan
  // zegt de amber kleur al genoeg.
  const overgeslagenOp = p.opDeDag ? undefined : p.nietGewassen;
  const gewassenOp = p.opDeDag || overgeslagenOp ? undefined : p.eerderGewassen;
  const geplandOp = p.opDeDag || overgeslagenOp || gewassenOp ? undefined : p.elderGepland;

  // De rechtermuisknop hangt om de hele regel: kleur, overslaan en het
  // dossier zitten daarin, want in de regel zelf is er geen plek voor.
  // Zolang het menu open is krijgt de regel een rand (het menu zet daarvoor
  // data-state="open" op de regel): anders zie je niet over welk adres het
  // menu gaat. Een rand en geen vlak, want het vlak is al de kleur van de regel.
  return (
    <KlantMenu
      customer={c}
      onPatch={(patch) => p.onPatch(c, patch)}
      onDossier={() => p.onDossier(c)}
      onHoekadres={() => p.onHoekadres(c)}
      onKlus={() => p.onKlus(c)}
      onStoppen={p.magKlanten ? () => p.onStoppen(c) : undefined}
      onSplitsen={p.magPlannen && p.magSplitsen ? () => p.onSplitsen(c) : undefined}
      alleenLezen={!p.magPlannen}
      markeringen={p.markeringen}
    >
      <KlantRijSleep
        id={`c:${c.id}`}
        className={`group relative flex items-center gap-0.5 rounded-[9px] px-0.5 max-md:select-none max-md:[-webkit-touch-callout:none] ${p.rowPad} ${p.rowText} ${p.geselecteerd ? "bg-accent" : ""} ${achtergrond} ${!p.geselecteerd && !kleur ? "hover:bg-muted/70" : ""} data-[state=open]:ring-2 data-[state=open]:ring-inset data-[state=open]:ring-foreground/60`}
        verfKlant={c.id}
        onGreep={p.magPlannen ? (e) => p.onSelect(c, e.shiftKey) : null}
        data-klantrij=""
        {...langIndrukken}
      >
        <SelecteerVakje
          customer={c}
          uitleg={
            overgeslagenOp
              ? `Op ${toonKorteDag(overgeslagenOp)} niet gewassen; staat nog open`
              : gewassenOp
                ? `Deze maand al gewassen op ${toonKorteDag(gewassenOp)}`
                : geplandOp
                  ? `Al ingepland op ${toonKorteDag(geplandOp)}`
                  : undefined
          }
          opDeDag={p.opDeDag}
          dagKlaar={p.dagKlaar}
          onOpDag={p.onOpDag}
          onVerfStart={p.onVerfStart}
          negeerKlik={p.negeerKlik}
        />
        <KlantRijInhoud
          customer={c}
          prijzenTonen={p.prijzenTonen}
          duurTonen={p.duurTonen}
          magKlanten={p.magKlanten}
          magPlannen={p.magPlannen}
          quickNotes={p.quickNotes}
          klantNaam={p.klantNaam}
          ronde={p.ronde}
          onPatch={p.onPatch}
          onAddQuickNote={p.onAddQuickNote}
          onDelete={p.onDelete}
          onDossier={p.onDossier}
          gewassenOp={gewassenOp}
          geplandOp={geplandOp}
          overgeslagenOp={overgeslagenOp}
        />
      </KlantRijSleep>
    </KlantMenu>
  );
});

/**
 * De adressen terugzetten waar ze stonden. Zo goed als het gaat: dit loopt in
 * het opruimen van een mislukking, en dan helpt een tweede foutmelding niet.
 */
async function zetAdressenTerug(adressen: Customer[]) {
  for (const c of adressen) {
    await supabase
      .from("customers")
      .update({ street_id: c.street_id, sort_order: c.sort_order })
      .eq("id", c.id);
  }
}

/**
 * Een zojuist gemaakte straat opruimen — maar alleen als er werkelijk niets
 * meer aan hangt: adressen gaan met `on delete cascade` mee, ook de gestopte
 * en die in de prullenbak. Kan de telling niet opgehaald worden, dan blijft
 * hij liever leeg in de wijk staan. Geeft terug of hij weg is.
 */
async function gooiLegeStraatWeg(id: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("street_id", id);
  if (error || count !== 0) return false;
  const { error: wegFout } = await supabase.from("streets").delete().eq("id", id);
  return !wegFout;
}

/** De eerstvolgende werkdagen om uit te kiezen (Instellingen → Wijken), met
 *  vandaag en morgen bij hun naam. Ongeveer twee weken vooruit. */
function komendeDagen(
  werkdagen: readonly number[],
  aantal = 10,
): { datum: string; naam: "vandaag" | "morgen" | null }[] {
  const uit: { datum: string; naam: "vandaag" | "morgen" | null }[] = [];
  const nu = new Date();
  for (let i = 0; uit.length < aantal && i < 60; i++) {
    const d = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + i);
    if (!isWerkdag(d, werkdagen)) continue;
    uit.push({
      datum: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      naam: i === 0 ? "vandaag" : i === 1 ? "morgen" : null,
    });
  }
  return uit;
}

/** "ma 8" — past in een adresregel. Het gaat altijd om deze maand, dus de
 *  maand erachter zegt niets. */
function kortDag(datum: string): string {
  const d = new Date(`${datum}T12:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" });
}

/** "ma 8 sep" — kort genoeg voor een menuregel, met de weekdag voorop omdat
 *  je daarop plant. */
function toonKorteDag(datum: string): string {
  const d = new Date(`${datum}T12:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Op de telefoon: de knoppen van de wijkenpagina achter één ⋯. Op de computer
 * staan ze gewoon los in de balk en is dit knopje er niet.
 */
function MeerKnoppen({
  magPlannen,
  magKlanten,
  selecteren,
  onSelecteren,
  prijzenZien,
  prijzenTonen,
  onPrijzenTonen,
  duurTonen,
  onDuurTonen,
  undoLabel,
  onUndo,
  printSearch,
  onNieuweKlant,
}: {
  magPlannen: boolean;
  magKlanten: boolean;
  selecteren: boolean;
  onSelecteren: () => void;
  prijzenZien: boolean;
  prijzenTonen: boolean;
  onPrijzenTonen: (aan: boolean) => void;
  duurTonen: boolean;
  onDuurTonen: (aan: boolean) => void;
  undoLabel: string | null;
  onUndo: () => void;
  printSearch: { wijk: string; maand: string; prijzen: boolean; liggend: boolean };
  onNieuweKlant: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          className="size-9 shrink-0 rounded-full md:hidden"
          aria-label="Meer knoppen"
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {magPlannen && (
          <DropdownMenuItem onSelect={onSelecteren}>
            <CheckSquare className="size-4" />
            {selecteren ? "Stoppen met selecteren" : "Selecteren"}
          </DropdownMenuItem>
        )}
        {prijzenZien && (
          <DropdownMenuCheckboxItem checked={prijzenTonen} onCheckedChange={onPrijzenTonen}>
            Prijzen tonen
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuCheckboxItem checked={duurTonen} onCheckedChange={onDuurTonen}>
          Duur tonen
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem disabled={!undoLabel} onSelect={onUndo}>
          <Undo2 className="size-4" />
          <span className="truncate">
            {undoLabel ? `Ongedaan: ${undoLabel}` : "Ongedaan maken"}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/printen" search={printSearch}>
            <Printer className="size-4" /> Printlijst
          </Link>
        </DropdownMenuItem>
        {magKlanten && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onNieuweKlant}>
              <Plus className="size-4" /> Klant toevoegen
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Het ⋯-menu in een opengeklapte straat op de telefoon: alles wat op de
 * computer als knopjes in de straatkop en onder de rechtermuisknop zit.
 */
function StraatMenu({
  street,
  groepen,
  magPlannen,
  magKlanten,
  onAddKlant,
  onToggleSort,
  onToggleDoorlopend,
  onEdit,
  onDelete,
  onZetGroep,
  onNieuweGroep,
}: {
  street: Street;
  groepen: StraatGroep[];
  magPlannen: boolean;
  magKlanten: boolean;
  onAddKlant: (streetId: string) => void;
  onToggleSort: (street: Street) => void;
  onToggleDoorlopend: (street: Street) => void;
  onEdit: (street: Street) => void;
  onDelete: (street: Street) => void;
  onZetGroep: (street: Street, groepId: string | null) => void;
  onNieuweGroep: (street: Street) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label={`Meer voor ${street.name}`}
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {magKlanten && (
          <DropdownMenuItem onSelect={() => onAddKlant(street.id)}>
            <Plus className="size-4" /> Adres toevoegen
          </DropdownMenuItem>
        )}
        {magPlannen && (
          <>
            <DropdownMenuItem onSelect={() => onToggleSort(street)}>
              {street.sort_desc ? (
                <ArrowUpNarrowWide className="size-4" />
              ) : (
                <ArrowDownNarrowWide className="size-4" />
              )}
              {street.sort_desc ? "Lage nummers bovenaan" : "Hoge nummers bovenaan"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleDoorlopend(street)}>
              <ListOrdered className="size-4" /> Nummers lopen per 1 op
              {street.doorlopend && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Layers className="size-4" /> Groep
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
                <DropdownMenuItem onSelect={() => onNieuweGroep(street)}>
                  <Plus className="size-4" /> Nieuwe groep…
                </DropdownMenuItem>
                {groepen.length > 0 && <DropdownMenuSeparator />}
                {groepen.map((groep) => (
                  <DropdownMenuItem key={groep.id} onSelect={() => onZetGroep(street, groep.id)}>
                    {groep.naam}
                    {street.groep_id === groep.id && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
                {street.groep_id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onZetGroep(street, null)}>
                      <CircleSlash className="size-4" /> Uit de groep halen
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onEdit(street)}>
              <Pencil className="size-4" /> Straat bewerken
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(street)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" /> Straat verwijderen
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NieuweStraat({ onSubmit }: { onSubmit: (naam: string) => void }) {
  const [waarde, setWaarde] = useState("");
  return (
    <div className="mb-3 break-inside-avoid-column rounded border border-dashed border-border bg-card/50">
      <input
        // Geen uppercase meer: je typt "Kerkstraat" en dan hoort er ook
        // "Kerkstraat" te staan. Dat het veld je invoer in hoofdletters
        // toonde was alleen opmaak, maar het leest als caps lock.
        className="w-full bg-transparent px-2 py-2 text-[13px] tracking-wide text-muted-foreground placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:bg-accent/40 focus:outline-none"
        placeholder="+ nieuwe straat"
        value={waarde}
        onChange={(e) => setWaarde(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && waarde.trim()) {
            onSubmit(waarde.trim());
            setWaarde("");
          }
        }}
        onBlur={() => {
          if (waarde.trim()) {
            onSubmit(waarde.trim());
            setWaarde("");
          }
        }}
      />
    </div>
  );
}

function NieuweRegel({ onSubmit, rowText }: { onSubmit: (nr: string) => void; rowText: string }) {
  const [waarde, setWaarde] = useState("");
  return (
    <input
      className={`mt-1 w-full rounded-[9px] border border-dashed border-border bg-transparent px-1.5 py-1.5 text-center ${rowText} text-muted-foreground placeholder:text-muted-foreground/60 focus:border-solid focus:bg-accent/40 focus:outline-none`}
      placeholder="+ adres"
      inputMode="numeric"
      value={waarde}
      onChange={(e) => setWaarde(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && waarde.trim()) {
          onSubmit(waarde.trim());
          setWaarde("");
        }
      }}
      onBlur={() => {
        if (waarde.trim()) {
          onSubmit(waarde.trim());
          setWaarde("");
        }
      }}
    />
  );
}
