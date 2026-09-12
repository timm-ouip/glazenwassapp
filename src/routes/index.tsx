import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { requireSession, useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Printer,
  Upload,
  Pencil,
  Trash2,
  Square,
  GripVertical,
  ArrowUpNarrowWide,
  ArrowDownNarrowWide,
  Undo2,
  Droplets,
  Users,
  User,
  Euro,
  Milestone as Route2,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleSlash,
  CornerDownRight,
  Folder,
  Layers,
  ListOrdered,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { StraatDialog } from "@/components/StraatDialog";
import { GroepDialog } from "@/components/GroepDialog";
import { StratenAanvullen } from "@/components/StratenAanvullen";
import { DubbeleStraten } from "@/components/DubbeleStraten";

import { WijkKiezer } from "@/components/WijkKiezer";
import { useBevestig } from "@/components/Bevestig";
import { InlineCel } from "@/components/InlineCel";
import { pushUndo, undoLaatste, useLaatsteUndoLabel } from "@/lib/undo";
import { OverslaanKnop } from "@/components/OverslaanKnop";
import { slaSelectieOver, wisOverslaanVanSelectie } from "@/lib/overslaan-keuze";
import { NotitieCel } from "@/components/NotitieCel";
import { ZoekBalk } from "@/components/ZoekBalk";
import { HoekadresDialog } from "@/components/HoekadresDialog";
import { KlusDialog } from "@/components/KlusDialog";
import { KlantMenu } from "@/components/KlantMenu";
import { Overgeslagen } from "@/components/Overgeslagen";
import { PrijsCel } from "@/components/PrijsCel";
import { RitmeKiezer } from "@/components/RitmeKiezer";
import { WassenVanaf } from "@/components/WassenVanaf";
import { useActieveWijk } from "@/lib/wijkgeheugen";
import { useStabiel } from "@/hooks/use-stabiel";
import { nieuweKlus, verwijderKlus } from "@/lib/klussen";
import {
  fetchWasdag,
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

interface IndexSearch {
  wijk?: string;
  /** De dag die je aan het vullen bent, gekozen op /planning. */
  dag?: string;
}

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    ...(typeof search["wijk"] === "string" && search["wijk"] ? { wijk: search["wijk"] } : {}),
    ...(typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Klantenlijst glazenwasser — straten, prijzen en maandplanning" },
      {
        name: "description",
        content:
          "Beheer je glazenwasklanten per straat in een compacte tabel, met prijzen, notities en een filter voor even of oneven maanden.",
      },
      { property: "og:title", content: "Klantenlijst glazenwasser" },
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

function Index() {
  useRequireAuth();
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const navigate = useNavigate();
  const { wijk, dag } = Route.useSearch();
  // Standaard de maand die je nu loopt, net als op de printlijst.
  const [filter, setFilter] = useState<MaandFilter>(() => maandSleutel(new Date()));
  const ronde = isKalendermaand(filter) ? filter : maandSleutel(new Date());
  const [zoektermen, setZoektermen] = useState<string[]>([]);
  const [prijzenTonen, setPrijzenTonen] = useState(true);
  const [selectie, setSelectie] = useState<string[]>([]);
  /** Staat de selecteermodus aan? Dan vink je adressen aan zonder dat er al
   *  iets vastligt; met "Inplannen voor" zet je ze in één keer op een dag. */
  const [selecteren, setSelecteren] = useState(false);
  /** Wat je nu aangevinkt hebt. Los van `selectie`, dat over het slepen en
   *  herschikken van regels gaat. */
  const [keuze, setKeuze] = useState<Set<string>>(new Set());
  /** Kom je van de kalender, dan bewerk je een bestaande dag: dan hoort
   *  uitvinken dat adres er ook echt af te halen. Anders is dit leeg en voeg
   *  je alleen maar toe. */
  const [bewerktDag, setBewerktDag] = useState<string | null>(null);
  const [ingeklapt, setIngeklapt] = useState<Set<string>>(new Set());
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
  const [straatDialog, setStraatDialog] = useState<{ open: boolean; street: Street | null }>({
    open: false,
    street: null,
  });
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

  async function doeUndo() {
    const label = await undoLaatste();
    if (label) toast.success("Teruggedraaid: " + label);
    else toast("Niets om terug te draaien");
  }

  function meldUndo(bericht: string) {
    // Standaard verdwijnt een melding na ~4 seconden. Dat is te kort om te beslissen
    // of je een verwijdering terugdraait — de knop is weg voor je hem kunt raken.
    toast(bericht, {
      duration: 12000,
      action: { label: "Ongedaan maken", onClick: () => void doeUndo() },
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const doel = e.target as HTMLElement | null;
      const tikt =
        doel && (doel.tagName === "INPUT" || doel.tagName === "TEXTAREA" || doel.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !tikt) {
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
  useEffect(() => {
    if (!bewerktDag || !wasdagQuery.isSuccess) return;
    if (gevuldVoor.current === bewerktDag) return;
    gevuldVoor.current = bewerktDag;
    setKeuze(new Set(dagRegels.map((r) => r.customer_id).filter(Boolean) as string[]));
  }, [bewerktDag, wasdagQuery.isSuccess, dagRegels]);

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
  const dagKlaar = bewerktDag === null || wasdagQuery.isSuccess;

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
  // Twee losse verzamelingen, want ze betekenen iets anders: wat achter je
  // ligt is gedaan, wat voor je ligt staat al ergens anders ingepland.
  const { eerderGewassen, elderGepland } = useMemo(() => {
    const gewassen = new Set<string>();
    const gepland = new Set<string>();
    for (const r of maandQuery.data ?? []) {
      if (r.datum === bewerktDag || !r.customer_id) continue;
      if (r.datum <= nu) gewassen.add(r.customer_id);
      else gepland.add(r.customer_id);
    }
    // Al gewassen weegt zwaarder: dat adres is deze maand klaar, ook als er
    // verderop nog een dag voor openstaat.
    for (const id of gewassen) gepland.delete(id);
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

  function klapStraat(id: string) {
    setIngeklapt((was) => {
      const nu = new Set(was);
      if (!nu.delete(id)) nu.add(id);
      return nu;
    });
  }

  /**
   * Zet adressen in of uit de selectie. Puur lokaal: er gaat pas iets naar de
   * database als je op "Inplannen voor" klikt. Dat is het hele punt van de
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
  async function planIn(datum: string) {
    const perId = new Map(customers.map((c) => [c.id, c]));
    const bestaand = datum === bewerktDag ? dagRegels : await fetchWasdag(datum);
    const alErop = new Set(bestaand.map((r) => r.customer_id).filter(Boolean) as string[]);

    const toevoegen = [...keuze]
      .filter((id) => !alErop.has(id))
      .map((id) => ({ customer_id: id, prijs: prijsVoorMaand(perId.get(id)!, ronde) }))
      .filter((r) => perId.has(r.customer_id));

    // Alleen bij het bewerken van een dag: wat je uitvinkte hoort eraf.
    const weghalen =
      datum === bewerktDag
        ? bestaand
            .filter((r) => r.customer_id && !keuze.has(r.customer_id))
            .map((r) => ({ customer_id: r.customer_id!, prijs: Number(r.prijs) }))
        : [];

    if (toevoegen.length === 0 && weghalen.length === 0) {
      toast(`${toonDatum(datum)} stond al zo ingepland.`);
      return;
    }

    try {
      await Promise.all([
        voegToeAanWasdag(datum, toevoegen),
        haalUitWasdag(
          datum,
          weghalen.map((r) => r.customer_id),
        ),
      ]);
    } catch {
      toast.error("Inplannen mislukt.");
      return;
    }

    pushUndo({
      label: `Inplannen ${toonDatum(datum)}`,
      undo: async () => {
        await Promise.all([
          haalUitWasdag(
            datum,
            toevoegen.map((r) => r.customer_id),
          ),
          voegToeAanWasdag(datum, weghalen),
        ]);
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      },
    });

    qc.invalidateQueries({ queryKey: ["wasdag"] });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    // Je bewerkt vanaf nu díe dag: vink je daarna nog iets uit, dan gaat het
    // er ook af in plaats van dat er niets gebeurt.
    setBewerktDag(datum);
    gevuldVoor.current = datum;

    const erbij = toevoegen.length;
    const eraf = weghalen.length;
    toast.success(
      eraf === 0
        ? `${erbij} ${erbij === 1 ? "adres" : "adressen"} ingepland op ${toonDatum(datum)}`
        : `${toonDatum(datum)} bijgewerkt: ${erbij} erbij, ${eraf} eraf`,
      {
        duration: 10000,
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

  function rondVerfAf() {
    const v = verf.current;
    verf.current = null;
    setVerfBezig(false);
    // Eindigt een streek buiten een straatkop, dan volgt er geen klik meer en
    // zou de vlag blijven staan — en de eerstvolgende gewone klik opslokken.
    // De klik van déze streek komt nog vóór deze timeout.
    setTimeout(() => {
      negeerKlik.current = false;
    }, 0);
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
      punt = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (punt) verfRef.current(punt);
      });
    };
    const stop = () => rondVerfAf();
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

  /** De selectie leegvegen. Raakt de database niet: wat er al ingepland
   *  staat blijft staan, dat maak je leeg op de planningpagina. */
  function wisKeuze() {
    setKeuze(new Set());
  }

  async function patchKlant(c: Customer, patch: Partial<Customer>) {
    const vorige: Partial<Customer> = {};
    for (const key of Object.keys(patch) as (keyof Customer)[]) {
      (vorige as Record<string, unknown>)[key] = c[key];
    }
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
    );
    const { error } = await supabase.from("customers").update(alsRij(patch)).eq("id", c.id);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      qc.invalidateQueries({ queryKey: ["customers"] });
      return;
    }
    pushUndo({
      label: `Wijziging ${formatNumber(c)}`,
      undo: async () => {
        await supabase.from("customers").update(alsRij(vorige)).eq("id", c.id);
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

  async function verwijderKlant(c: Customer) {
    // Met de straat erbij: "Klant 8" zegt niet welke 8, en elke straat heeft er een.
    const straat = streets.find((s) => s.id === c.street_id)?.name;
    const adres = straat ? `${straat} ${formatNumber(c)}` : `Klant ${formatNumber(c)}`;
    const ja = await bevestig({
      titel: `${adres} verwijderen?`,
      tekst: "Je kunt dit direct daarna nog ongedaan maken.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await legWeg("customers", [c.id]);
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${adres}`,
      undo: async () => {
        await haalTerug("customers", [c.id]);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`${adres} verwijderd`);
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
      .insert({ name: naam.trim(), sort_order: max + 1, district_id: actieveWijk })
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
          await supabase.from("streets").delete().eq("id", nieuwId);
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
  const opDelete = useStabiel(verwijderKlant);
  const opDossier = useStabiel((c: Customer) => setDossier({ open: true, customer: c }));
  const opHoekadres = useStabiel((c: Customer) => setHoek({ open: true, customer: c }));
  const opKlus = useStabiel((c: Customer) => setKlus({ open: true, customer: c }));
  const opAddQuickNote = useStabiel(nieuweSnelkeuze);
  const opVerfStart = useStabiel(startVerf);
  const opKlantOpDag = useStabiel((c: Customer, aan: boolean) => {
    pasKeuzeAan(aan ? [c.id] : [], aan ? [] : [c.id]);
  });
  const opNieuweRegel = useStabiel(nieuweRegel);
  const opEditStreet = useStabiel((street: Street) => setStraatDialog({ open: true, street }));
  const opDeleteStreet = useStabiel((street: Street) => verwijderStraat(street));
  const opAddKlant = useStabiel((streetId: string) =>
    setKlantDialog({ open: true, customer: null, streetId }),
  );
  const opToggleSort = useStabiel((street: Street) => void wisselSort(street));
  const opToggleDoorlopend = useStabiel((street: Street) => void wisselDoorlopend(street));
  const opKlap = useStabiel((streetId: string) => klapStraat(streetId));
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

  // De lijst staat altijd in de compacte weergave: zo passen er meer regels
  // op het scherm, en dat is waar je op de ronde naar kijkt.
  const rowText = "text-[12px]";
  const rowPad = "py-[2px]";

  /** Eén straatblok. Staat hier als functie omdat hij op twee plekken nodig
   *  is: binnen een groep, en los eronder. */
  const straatBlok = (g: (typeof groepen)[number]) => (
    <StraatBlok
      key={g.street.id}
      street={g.street}
      ronde={ronde}
      even={g.even}
      oneven={g.oneven}
      aantal={g.aantal}
      totaal={g.totaal}
      sort={g.street.sort_desc ? "desc" : "asc"}
      prijzenTonen={prijzenTonen}
      quickNotes={quickNotes}
      markeringen={markeringen}
      klantNamen={klantNamen}
      rowText={rowText}
      rowPad={rowPad}
      selectie={selectie}
      onSelect={opSelect}
      onPatch={opPatch}
      onAddQuickNote={opAddQuickNote}
      onDelete={opDelete}
      onDossier={opDossier}
      onHoekadres={opHoekadres}
      onKlus={opKlus}
      onNieuweRegel={opNieuweRegel}
      onEditStreet={opEditStreet}
      onDeleteStreet={opDeleteStreet}
      onAddKlant={opAddKlant}
      onToggleSort={opToggleSort}
      onToggleDoorlopend={opToggleDoorlopend}
      ingeklapt={ingeklapt.has(g.street.id)}
      onKlap={opKlap}
      groepen={subgroepen}
      onZetGroep={opZetGroep}
      onNieuweGroep={opNieuweGroep}
      planmodus={selecteren}
      dagKlaar={dagKlaar}
      opDeDag={keuze}
      eerderGewassen={eerderGewassen}
      elderGepland={elderGepland}
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
          onSelect={(id) => void navigate({ to: "/", search: (oud) => ({ ...oud, wijk: id }) })}
          onChanged={() => qc.invalidateQueries({ queryKey: ["districts"] })}
        />
      }
      actiePositie="onder"
      kruimel="Overzicht / Wijken"
      onderschrift={
        actieveWijk
          ? [
              `${groepen.length} ${groepen.length === 1 ? "straat" : "straten"}`,
              `${totaal} ${totaal === 1 ? "klant" : "klanten"}`,
              // De plaats alleen als hij iets toevoegt: "Gouda · Gouda"
              // zegt twee keer hetzelfde.
              wijkPlaats && wijkPlaats !== districts.find((d) => d.id === actieveWijk)?.name
                ? wijkPlaats
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "Kies links een wijk om zijn straten te zien."
      }
      acties={
        <>
          <ZoekBalk placeholder="Zoek straat" onTermen={setZoektermen} />
          {/* Straatnamen aanvullen is werk aan de wijklijst zelf; in de
              selecteerstand ben je een dag aan het samenstellen en staat die
              knop alleen in de weg. */}
          {!selecteren && (
            <StratenAanvullen
              streets={streets.filter((s) => s.district_id === actieveWijk)}
              plaats={wijkPlaats}
              onSaved={() => qc.invalidateQueries({ queryKey: ["streets"] })}
            />
          )}
          <Button
            size="sm"
            variant={selecteren ? "default" : "outline"}
            className="rounded-full"
            onClick={() => selecteermodus(!selecteren)}
            title="Adressen aanvinken om daarna in te plannen"
          >
            <CheckSquare className="size-4" /> Selecteren
          </Button>
          {selecteren && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={wisselAlles}
                disabled={alleZichtbare.length === 0}
                title={
                  allesGekozen
                    ? "Alles in beeld uitvinken"
                    : `Alle ${alleZichtbare.length} adressen in beeld aanvinken`
                }
              >
                {allesGekozen ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
                {allesGekozen ? "Niets" : "Alles"}
              </Button>
              <OverslaanKnop
                aantal={keuze.size}
                onOverslaan={(m) => void slaKeuzeOver(m)}
                onNietsOverslaan={() => void wisOverslaanVanKeuze()}
              />
              <InplannenKnop
                aantal={keuze.size}
                bewerktDag={bewerktDag}
                onKies={(d) => void planIn(d)}
              />
            </>
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
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => setKlantDialog({ open: true, customer: null })}
          >
            <Plus className="size-4" /> Klant
          </Button>
        </>
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
              verberg: !prijzenTonen,
            },
          ]}
        />
      }
    >
      <div className="space-y-3">
        <div className="sticky top-[var(--plakrand)] z-[9] -mx-6 flex flex-wrap items-center gap-3 border-b border-border/70 bg-background/85 px-6 py-2 backdrop-blur">
          <div className="inline-flex gap-0.5 rounded-full bg-card p-[3px] shadow-card">
            {/* Dezelfde keuze als op de printlijst: wat je hier ziet is wat je
                straks meeneemt. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] capitalize transition-colors ${
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
                className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                  filter === f
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-foreground/80 hover:text-foreground"
                }`}
              >
                {f === "alles" ? "Alles" : f === "even" ? "Even maand" : "Oneven maand"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="prijzen" checked={prijzenTonen} onCheckedChange={setPrijzenTonen} />
            <Label htmlFor="prijzen" className="text-sm text-muted-foreground">
              Prijzen
            </Label>
          </div>

          {selecteren && (
            // Blijft in beeld terwijl je naar beneden vinkt: het bedrag is
            // waar je op stuurt bij het samenstellen van een dag.
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/70 pt-2">
              <CalendarCheck className="size-4 text-brand-ink" />
              {bewerktDag ? (
                <Link
                  to="/planning"
                  search={{ dag: bewerktDag }}
                  className="text-[13px] font-medium underline-offset-2 hover:underline"
                  title="Deze dag op de kalender bekijken"
                >
                  Je bewerkt {toonDatum(bewerktDag)}
                </Link>
              ) : (
                <span className="text-[13px] font-medium">Geselecteerd</span>
              )}
              <span className="font-display text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
                {formatPrice(keuzeBedrag)}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {keuze.size} {keuze.size === 1 ? "adres" : "adressen"}
              </span>
              {keuze.size > 0 && (
                <button
                  className="text-[12.5px] text-muted-foreground underline"
                  onClick={wisKeuze}
                >
                  selectie wissen
                </button>
              )}

              {/* Drie kleuren zonder uitleg is raden. Onder sm alleen de
                  bolletjes: de bedragen hiernaast zijn belangrijker. */}
              <div className="ml-auto flex items-center gap-3">
                {[
                  { stip: "bg-tint-amber ring-tint-amber-ink/30", tekst: "op deze dag" },
                  { stip: "bg-tint-groen ring-tint-groen-ink/30", tekst: "al gewassen" },
                  { stip: "bg-tint-paars ring-tint-paars-ink/30", tekst: "al ingepland" },
                ].map((l) => (
                  <span
                    key={l.tekst}
                    className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
                    title={l.tekst}
                  >
                    <span
                      className={`size-2.5 shrink-0 rounded-full ring-1 ring-inset ${l.stip}`}
                    />
                    <span className="hidden sm:inline">{l.tekst}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
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
              Nog geen wijken. Maak hierboven eerst een wijk aan.
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
              className={`gap-3.5 md:columns-1 xl:columns-2 ${
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
                  prijzenTonen={prijzenTonen}
                  planmodus={selecteren}
                  dagKlaar={dagKlaar}
                  opDeDag={keuze}
                  eerderGewassen={eerderGewassen}
                  elderGepland={elderGepland}
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
              {districts.length > 0 && <NieuweStraat onSubmit={nieuweStraat} />}
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
      <StraatDialog
        districtId={actieveWijk ?? undefined}
        plaats={wijkPlaats}
        open={straatDialog.open}
        onOpenChange={(open) => setStraatDialog((s) => ({ ...s, open }))}
        street={straatDialog.street}
        groepen={subgroepen}
        onSaved={herlaad}
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
  planmodus: boolean;
  dagKlaar: boolean;
  opDeDag: Set<string>;
  eerderGewassen: Set<string>;
  elderGepland: Set<string>;
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
        {...(p.planmodus
          ? {
              "data-verf-groep": p.groep.id,
              onClick: () => {
                if (p.negeerKlik.current) {
                  p.negeerKlik.current = false;
                  return;
                }
                if (bruikbaar) p.onGroepOpDag(p.groep.id, vink !== true);
              },
              onPointerDown: (e: React.PointerEvent) => {
                if (e.pointerType !== "touch" && bruikbaar) {
                  p.onVerfStart(vink !== true, e.clientX, e.clientY);
                }
              },
            }
          : {})}
        style={
          gevuld > 0
            ? {
                backgroundImage: `linear-gradient(to right, var(--tint-amber) ${gevuld}%, transparent ${gevuld}%)`,
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
              p.onVerfStart(vink !== true, e.clientX, e.clientY);
            }}
            aria-label={`Hele groep ${p.groep.naam} op de dag`}
          />
        ) : (
          <button
            className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
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
        {!p.planmodus && (
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
        <div className="gap-3.5 md:columns-1 xl:columns-2">{p.children}</div>
      )}
    </section>
  );
});

interface BlokProps {
  street: Street;
  even: Customer[];
  oneven: Customer[];
  aantal: number;
  totaal: number;
  sort: "asc" | "desc";
  prijzenTonen: boolean;
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
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  /** Opent het dossier van dit adres, hier op de pagina zelf. */
  onDossier: (c: Customer) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
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
  /** Adressen die deze maand al op een andere dag gewassen zijn. */
  eerderGewassen: Set<string>;
  /** Adressen die deze maand al op een latere dag ingepland staan. */
  elderGepland: Set<string>;
  onStraatOpDag: (streetId: string, aan: boolean) => void;
  onKlantOpDag: (c: Customer, aan: boolean) => void;
  /** Begint een sleepselectie; `aan` is de kant die de hele streek opgaat. */
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  /** Staat op waar als de streek al iets deed — dan telt de klik erna niet. */
  negeerKlik: { current: boolean };
}

const StraatBlok = memo(function StraatBlok(p: BlokProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `s:${p.street.id}`,
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
        <ContextMenuTrigger asChild>
          <div
            {...(p.planmodus
              ? {
                  "data-verf-straat": p.street.id,
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
                    if (e.pointerType !== "touch" && zichtbaar.length > 0 && p.dagKlaar) {
                      p.onVerfStart(straatVink !== true, e.clientX, e.clientY);
                    }
                  },
                }
              : {})}
            style={
              gevuld > 0
                ? {
                    backgroundImage: `linear-gradient(to right, var(--tint-amber) ${gevuld}%, transparent ${gevuld}%)`,
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
                  p.onVerfStart(straatVink !== true, e.clientX, e.clientY);
                }}
                aria-label={`Hele ${p.street.name} op de dag`}
              />
            ) : (
              <button
                className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
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
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                  onClick={() => p.onToggleSort(p.street)}
                  aria-label={p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"}
                  title={p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"}
                >
                  {p.sort === "asc" ? (
                    <ArrowUpNarrowWide className="size-3.5" />
                  ) : (
                    <ArrowDownNarrowWide className="size-3.5" />
                  )}
                </button>
                <button
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                  onClick={() => p.onAddKlant(p.street.id)}
                  aria-label="Klant toevoegen"
                >
                  <Plus className="size-3.5" />
                </button>
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
              <span className="min-w-[3.25rem] max-w-[5.5rem] pl-1 text-center">freq.</span>
              <span className="w-4" />
            </div>
            <StraatKolom regels={p[kant]} blok={p} kant={kant} />
            {kant === "even" && (
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
            quickNotes={p.quickNotes}
            markeringen={p.markeringen}
            klantNaam={c.klant_id ? p.klantNamen.get(c.klant_id) : undefined}
            rowText={p.rowText}
            rowPad={p.rowPad}
            geselecteerd={p.selectie.includes(c.id)}
            ronde={p.ronde}
            planmodus={p.planmodus}
            opDeDag={p.opDeDag.has(c.id)}
            eerderGewassen={p.eerderGewassen.has(c.id)}
            elderGepland={p.elderGepland.has(c.id)}
            dagKlaar={p.dagKlaar}
            onOpDag={p.onKlantOpDag}
            onVerfStart={p.onVerfStart}
            negeerKlik={p.negeerKlik}
            onSelect={p.onSelect}
            onPatch={p.onPatch}
            onAddQuickNote={p.onAddQuickNote}
            onDelete={p.onDelete}
            onDossier={p.onDossier}
            onHoekadres={p.onHoekadres}
            onKlus={p.onKlus}
          />
        ))}
      </div>
    </SortableContext>
  );
});

interface RijProps {
  customer: Customer;
  prijzenTonen: boolean;
  quickNotes: QuickNote[];
  markeringen: MarkeringRij[];
  klantNaam?: string | undefined;
  rowText: string;
  rowPad: string;
  geselecteerd: boolean;
  /** De maand die je bekijkt: die bepaalt de kleur van de regel. */
  ronde: string;
  planmodus: boolean;
  opDeDag: boolean;
  /** Deze maand al op een andere dag gewassen. */
  eerderGewassen: boolean;
  /** Deze maand al op een latere dag ingepland. */
  elderGepland: boolean;
  dagKlaar: boolean;
  onOpDag: (c: Customer, aan: boolean) => void;
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  negeerKlik: { current: boolean };
  onSelect: (c: Customer, shift: boolean) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  onDossier: (c: Customer) => void;
  onHoekadres: (c: Customer) => void;
  onKlus: (c: Customer) => void;
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
          className="cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          aria-label="Regel verslepen"
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
const KlantRijInhoud = memo(function KlantRijInhoud({
  customer: c,
  prijzenTonen,
  quickNotes,
  klantNaam,
  ronde: dezeMaand,
  planmodus,
  opDeDag,
  dagKlaar,
  onOpDag,
  onVerfStart,
  negeerKlik,
  onPatch,
  onAddQuickNote,
  onDelete,
  onDossier,
}: RijProps) {
  return (
    <>
      {/* Het greepje om aan te slepen staat in KlantRijSleep hierboven: dat
          hangt aan de sleepbeweging, de rest hieronder niet. */}
      {planmodus && (
        <>
          {/* In de selecteerstand ligt de hele regel op slot: je bent een dag
              aan het samenstellen, niet aan het bijwerken. Eén doorzichtig
              laagje vangt alle klikken, zodat je overal op de regel kunt
              aanvinken en nergens per ongeluk een notitie openklikt. */}
          <div
            className={`absolute inset-0 z-10 ${dagKlaar ? "cursor-pointer" : "cursor-not-allowed"}`}
            aria-hidden="true"
            onPointerDown={(e) => {
              if (dagKlaar) onVerfStart(!opDeDag, e.clientX, e.clientY);
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
          <Checkbox
            className="size-3.5 shrink-0 touch-none"
            checked={opDeDag}
            disabled={!dagKlaar}
            onCheckedChange={(v) => onOpDag(c, v === true)}
            aria-label={`${formatNumber(c)} op de dag`}
          />
        </>
      )}
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
        />
      </div>
      {!planmodus && (
        <>
          <Overgeslagen customer={c} />
          <WassenVanaf customer={c} ronde={dezeMaand} onPatch={(patch) => onPatch(c, patch)} />
        </>
      )}
      {prijzenTonen && (
        <div className="w-16 shrink-0">
          <PrijsCel customer={c} ronde={dezeMaand} onPatch={(patch) => onPatch(c, patch)} />
        </div>
      )}
      <RitmeKiezer customer={c} onPatch={(patch) => onPatch(c, patch)} />
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
      <button
        tabIndex={-1}
        className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive"
        onClick={() => onDelete(c)}
        aria-label="Klant verwijderen"
      >
        <Trash2 className="size-3" />
      </button>
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

  // In planmodus vertelt de kleur waar je die dag staat; daarbuiten waar je
  // op moet letten. Twee kleursystemen tegelijk zou niet te lezen zijn.
  const kleur = regelKleur(c, p.ronde, p.markeringen);
  const achtergrond = p.planmodus
    ? p.opDeDag
      ? "bg-tint-amber"
      : p.eerderGewassen
        ? "bg-tint-groen"
        : p.elderGepland
          ? "bg-tint-paars"
          : ""
    : kleur
      ? tintAchtergrond[kleur]
      : "";

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
      markeringen={p.markeringen}
    >
      <KlantRijSleep
        id={`c:${c.id}`}
        className={`group relative flex items-center gap-0.5 rounded-[9px] px-0.5 ${p.rowPad} ${p.rowText} ${p.geselecteerd ? "bg-accent" : ""} ${achtergrond} ${!p.geselecteerd && !achtergrond ? "hover:bg-muted/70" : ""} data-[state=open]:ring-2 data-[state=open]:ring-inset data-[state=open]:ring-foreground/60`}
        verfKlant={p.planmodus ? c.id : undefined}
        onGreep={p.planmodus ? null : (e) => p.onSelect(c, e.shiftKey)}
      >
        <KlantRijInhoud {...p} />
      </KlantRijSleep>
    </KlantMenu>
  );
});

/** De eerstvolgende dagen om uit te kiezen, met de weekdag erbij. Zondagen
 *  laten we staan — die werk je zelden, maar het is niet aan ons om dat te
 *  verbieden. */
function komendeDagen(aantal = 14): string[] {
  const uit: string[] = [];
  const nu = new Date();
  for (let i = 0; i < aantal; i++) {
    const d = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() + i);
    uit.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return uit;
}

/** "ma 8 sep" — kort genoeg voor een menuregel, met de weekdag voorop omdat
 *  je daarop plant. */
function toonKorteDag(datum: string): string {
  const d = new Date(`${datum}T12:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * "Inplannen voor…" — zet wat je aangevinkt hebt op een dag. Staat alleen in
 * de selecteermodus, want zonder selectie valt er niets in te plannen.
 */
function InplannenKnop({
  aantal,
  bewerktDag,
  onKies,
}: {
  aantal: number;
  bewerktDag: string | null;
  onKies: (datum: string) => void;
}) {
  const dagen = komendeDagen();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          className="rounded-full"
          disabled={aantal === 0}
          title={aantal === 0 ? "Vink eerst adressen aan" : `${aantal} adressen inplannen`}
        >
          <CalendarPlus className="size-4" /> Inplannen voor
          {aantal > 0 && <span className="tabular-nums opacity-80">({aantal})</span>}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-52 overflow-y-auto">
        <DropdownMenuLabel>
          {aantal} {aantal === 1 ? "adres" : "adressen"} inplannen op
        </DropdownMenuLabel>
        {dagen.map((d, i) => (
          <DropdownMenuItem key={d} onSelect={() => onKies(d)}>
            {/* Vandaag en morgen bij hun naam, met de datum erachter; verder
                is de datum zelf het duidelijkst. */}
            <span className="capitalize">
              {i < 2 ? (i === 0 ? "vandaag" : "morgen") : toonKorteDag(d)}
            </span>
            {i < 2 && (
              <span className="ml-auto text-xs text-muted-foreground">{toonKorteDag(d)}</span>
            )}
            {d === bewerktDag && <Check className={`size-4 ${i < 2 ? "ml-1" : "ml-auto"}`} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NieuweStraat({ onSubmit }: { onSubmit: (naam: string) => void }) {
  const [waarde, setWaarde] = useState("");
  return (
    <div className="mb-3 break-inside-avoid-column rounded border border-dashed border-border bg-card/50">
      <input
        className="w-full bg-transparent px-2 py-2 text-[13px] uppercase tracking-wide text-muted-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:bg-accent/40 focus:outline-none"
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
