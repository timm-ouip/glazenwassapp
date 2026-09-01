import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Search,
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
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { AppLayout } from "@/components/AppLayout";
import { KlantDialog } from "@/components/KlantDialog";
import { StraatDialog } from "@/components/StraatDialog";
import { StratenAanvullen } from "@/components/StratenAanvullen";
import { DubbeleStraten } from "@/components/DubbeleStraten";

import { WijkKiezer } from "@/components/WijkKiezer";
import { useBevestig } from "@/components/Bevestig";
import { InlineCel } from "@/components/InlineCel";
import { pushUndo, undoLaatste, useLaatsteUndoLabel } from "@/lib/undo";
import { NotitieCel } from "@/components/NotitieCel";
import { KlantMenu } from "@/components/KlantMenu";
import { Overgeslagen } from "@/components/Overgeslagen";
import { WassenVanaf } from "@/components/WassenVanaf";
import { useActieveWijk } from "@/lib/wijkgeheugen";
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
  addQuickNote,
  haalTerug,
  legWeg,
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchQuickNotes,
  fetchStreets,
  formatNumber,
  formatPrice,
  maandSleutel,
  regelKleur,
  matchesMaand,
  persistCustomerOrder,
  persistStreetOrder,
  setStreetSortDesc,
  sortCustomers,
  splitEvenOdd,
  type Customer,
  type District,
  type QuickNote,
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

type MaandFilter = "alles" | "even" | "oneven";

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
  const [filter, setFilter] = useState<MaandFilter>("alles");
  const [zoek, setZoek] = useState("");
  const [prijzenTonen, setPrijzenTonen] = useState(true);
  const [selectie, setSelectie] = useState<string[]>([]);
  /** De dag waar je nu aan plant; `null` betekent dat de planmodus uitstaat. */
  const [planDatum, setPlanDatum] = useState<string | null>(null);
  const [ingeklapt, setIngeklapt] = useState<Set<string>>(new Set());
  const [sleep, setSleep] = useState<string | null>(null);
  const [klantDialog, setKlantDialog] = useState<{
    open: boolean;
    customer: Customer | null;
    streetId?: string;
  }>({
    open: false,
    customer: null,
  });
  const [straatDialog, setStraatDialog] = useState<{ open: boolean; street: Street | null }>({
    open: false,
    street: null,
  });

  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const quickNotesQuery = useQuery({ queryKey: ["quick_notes"], queryFn: fetchQuickNotes });
  const klantenQuery = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });

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

  const alleStraten = streetsQuery.data ?? [];
  const streets = alleStraten.filter((s) => s.district_id === actieveWijk);
  const customers = customersQuery.data ?? [];
  const quickNotes = quickNotesQuery.data ?? [];
  const undoLabel = useLaatsteUndoLabel();

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["districts"] });
    qc.invalidateQueries({ queryKey: ["streets"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
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
    const term = zoek.trim().toLowerCase();
    return streets
      .filter((s) => !term || s.name.toLowerCase().includes(term))
      .map((s) => {
        const order: "asc" | "desc" = s.sort_desc ? "desc" : "asc";
        const klanten = customers.filter(
          (c) => c.street_id === s.id && matchesMaand(c.frequency, filter),
        );
        return {
          street: s,
          ...splitEvenOdd(klanten, order),
          aantal: klanten.length,
          totaal: klanten.reduce((sum, c) => sum + c.price, 0),
        };
      });
  }, [streets, customers, filter, zoek]);

  const totaal = groepen.reduce((sum, g) => sum + g.aantal, 0);
  const omzet = groepen.reduce((sum, g) => sum + g.totaal, 0);

  // --- Dagplanning -------------------------------------------------------
  // Wat er 's ochtends aanstaat is de planning, wat er 's avonds aanstaat is
  // wat er gedaan is. Zie src/lib/wasdag.ts.
  const wasdagQuery = useQuery({
    queryKey: ["wasdag", planDatum],
    queryFn: () => fetchWasdag(planDatum!),
    enabled: planDatum !== null,
  });
  const dagRegels = useMemo(() => wasdagQuery.data ?? [], [wasdagQuery.data]);
  const opDeDag = useMemo(
    () => new Set(dagRegels.map((r) => r.customer_id).filter(Boolean) as string[]),
    [dagRegels],
  );
  // Het bedrag van de hele dag, dus ook straten uit andere wijken: het gaat
  // om wat de dag opbrengt, niet om deze ene wijk.
  const dagBedrag = dagRegels.reduce((sum, r) => sum + Number(r.prijs), 0);
  const dagKlaar = planDatum === null || wasdagQuery.isSuccess;

  // Wat er deze maand al op een ándere dag staat. Plan je morgen, dan zie je
  // zo welke adressen vandaag al gedaan zijn — je wil ze niet twee keer in
  // dezelfde maand. Verder dan de maand van de dag die je plant kijken we
  // nooit, dus op de eerste van de maand staat de teller vanzelf weer op nul.
  const maand = planDatum ? maandGrenzen(planDatum) : null;
  const maandQuery = useQuery({
    queryKey: ["wasdagen", maand?.vanaf, maand?.tot],
    queryFn: () => fetchWasdagen(maand!.vanaf, maand!.tot),
    enabled: maand !== null,
  });
  const nu = vandaag();
  // Twee losse verzamelingen, want ze betekenen iets anders: wat achter je
  // ligt is gedaan, wat voor je ligt staat al ergens anders ingepland.
  const { eerderGewassen, elderGepland } = useMemo(() => {
    const gewassen = new Set<string>();
    const gepland = new Set<string>();
    for (const r of maandQuery.data ?? []) {
      if (r.datum === planDatum || !r.customer_id) continue;
      if (r.datum <= nu) gewassen.add(r.customer_id);
      else gepland.add(r.customer_id);
    }
    // Al gewassen weegt zwaarder: dat adres is deze maand klaar, ook als er
    // verderop nog een dag voor openstaat.
    for (const id of gewassen) gepland.delete(id);
    return { eerderGewassen: gewassen, elderGepland: gepland };
  }, [maandQuery.data, planDatum, nu]);

  function planmodus(aan: boolean) {
    setPlanDatum(aan ? vandaag() : null);
    // Bij het verlaten alles weer open: dan ga je weer regels bijwerken.
    if (!aan) setIngeklapt(new Set());
    try {
      if (aan) localStorage.setItem(PLANMODUS_OPSLAG, "ja");
      else localStorage.removeItem(PLANMODUS_OPSLAG);
    } catch {
      // Privémodus of geblokkeerde opslag: dan begin je gewoon buiten de modus.
    }
  }

  useEffect(() => {
    // Kom je van de kalender, dan bepaalt de URL de dag. Anders val je terug
    // op de onthouden modus, en die begint altijd bij vandaag.
    if (dag) {
      setPlanDatum(dag);
      try {
        localStorage.setItem(PLANMODUS_OPSLAG, "ja");
      } catch {
        /* zie planmodus() */
      }
      return;
    }
    try {
      if (localStorage.getItem(PLANMODUS_OPSLAG) === "ja") setPlanDatum(vandaag());
    } catch {
      /* zie planmodus() */
    }
  }, [dag]);

  // Ingeklapt zie je veel straten tegelijk, en dat is precies wat je wil als je
  // een dag samenstelt. Dit gebeurt zodra de modus aangaat én bij elke wijk die
  // je daarna opent — maar niet opnieuw bij zoeken of een andere datum, want
  // dan zou het openklappen dat je zelf deed telkens ongedaan gemaakt worden.
  const geklaptVoor = useRef<string | null>(null);
  useEffect(() => {
    if (planDatum === null) {
      geklaptVoor.current = null;
      return;
    }
    if (groepen.length === 0 || geklaptVoor.current === actieveWijk) return;
    geklaptVoor.current = actieveWijk;
    setIngeklapt(new Set(groepen.map((g) => g.street.id)));
  }, [planDatum, actieveWijk, groepen]);

  const allesIngeklapt = groepen.length > 0 && groepen.every((g) => ingeklapt.has(g.street.id));

  function klapAlles() {
    setIngeklapt(allesIngeklapt ? new Set() : new Set(groepen.map((g) => g.street.id)));
  }

  function klapStraat(id: string) {
    setIngeklapt((was) => {
      const nu = new Set(was);
      if (!nu.delete(id)) nu.add(id);
      return nu;
    });
  }

  type DagWijziging = { toegevoegd: DagRegel[]; weggehaald: DagRegel[] };
  type DagRegel = { customer_id: string; prijs: number };

  /**
   * Zet adressen op de dag of haalt ze eraf, met één optimistische stap en
   * daarna de opslag. `label` is leeg voor losse regels: die zet je met
   * hetzelfde vinkje net zo snel terug, en ze zouden de ongedaan-knop
   * verstoppen voor de grotere ingrepen. Tijdens het slepen blijft het label
   * ook leeg; dan maakt `rondVerfAf` er aan het eind één stap van.
   *
   * Geeft terug wat er werkelijk veranderd is, zodat de aanroeper dat kan
   * verzamelen.
   */
  function pasDagAan(erbij: Customer[], eraf: string[], label?: string): DagWijziging {
    const niets: DagWijziging = { toegevoegd: [], weggehaald: [] };
    // Nog niet opgehaald? Dan weten we niet wat er al op de dag staat, en zou
    // de optimistische schrijfactie hieronder het antwoord dat onderweg is
    // overschrijven. De vinkjes staan in dat venster ook uit.
    if (!planDatum || !wasdagQuery.isSuccess) return niets;
    const datum = planDatum;
    const bestaand = qc.getQueryData<WasdagRegel[]>(["wasdag", datum]) ?? [];
    const alOpDeDag = new Set(bestaand.map((r) => r.customer_id));
    const toevoegen = erbij
      .filter((c) => !alOpDeDag.has(c.id))
      .map((c) => ({ customer_id: c.id, prijs: c.price }));
    // Alleen wat er echt af gaat, met de prijs zoals die op de dag stond —
    // die kan afwijken van de huidige prijs van het adres.
    const weghalen = bestaand
      .filter((r) => r.customer_id && eraf.includes(r.customer_id))
      .map((r) => ({ customer_id: r.customer_id!, prijs: Number(r.prijs) }));
    if (toevoegen.length === 0 && weghalen.length === 0) return niets;

    const wegIds = new Set<string | null>(weghalen.map((r) => r.customer_id));
    const nieuweIds = new Set(toevoegen.map((r) => r.customer_id));
    // Bijwerken vanaf wat er op dát moment staat, niet vanaf de momentopname
    // hierboven: tijdens een sleepstreek volgen de stappen elkaar sneller op
    // dan react-query kan bijhouden.
    qc.setQueryData<WasdagRegel[]>(["wasdag", datum], (oud) => [
      ...(oud ?? bestaand).filter(
        (r) => !wegIds.has(r.customer_id) && !nieuweIds.has(r.customer_id ?? ""),
      ),
      ...toevoegen,
    ]);

    if (label) draaiTerug(label, { toegevoegd: toevoegen, weggehaald: weghalen });

    void Promise.all([
      voegToeAanWasdag(datum, toevoegen),
      haalUitWasdag(datum, weghalen.map((r) => r.customer_id)),
    ])
      .catch(() => toast.error("Dagplanning opslaan mislukt."))
      .finally(() => {
        qc.invalidateQueries({ queryKey: ["wasdag", datum] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      });

    return { toegevoegd: toevoegen, weggehaald: weghalen };
  }

  /** Zet één ongedaan-stap klaar voor een wijziging aan de dag. */
  function draaiTerug(label: string, w: DagWijziging) {
    if (!planDatum) return;
    const datum = planDatum;
    if (w.toegevoegd.length === 0 && w.weggehaald.length === 0) return;
    pushUndo({
      label,
      undo: async () => {
        await Promise.all([
          haalUitWasdag(datum, w.toegevoegd.map((r) => r.customer_id)),
          voegToeAanWasdag(datum, w.weggehaald),
        ]);
        qc.invalidateQueries({ queryKey: ["wasdag", datum] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      },
    });
  }

  function zetStraatOpDag(g: (typeof groepen)[number], aan: boolean) {
    const zichtbaar = [...g.even, ...g.oneven];
    if (aan) pasDagAan(zichtbaar, [], `${g.street.name} op de dag`);
    else pasDagAan([], zichtbaar.map((c) => c.id), `${g.street.name} van de dag af`);
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
    toegevoegd: DagRegel[];
    weggehaald: DagRegel[];
  };
  const verf = useRef<Verf | null>(null);
  const [verfBezig, setVerfBezig] = useState(false);
  /** Een streek eindigt met een klik; die mag niet nóg eens omschakelen. */
  const negeerKlik = useRef(false);

  function tekenBij(w: DagWijziging) {
    const v = verf.current;
    if (!v) return;
    v.toegevoegd.push(...w.toegevoegd);
    v.weggehaald.push(...w.weggehaald);
  }

  /** Past de streek toe op wat er onder de muis of vinger ligt. */
  function verfOpPunt(x: number, y: number) {
    const v = verf.current;
    if (!v) return;
    const el = document.elementFromPoint(x, y);
    const straatEl = el?.closest<HTMLElement>("[data-verf-straat]");
    const klantEl = el?.closest<HTMLElement>("[data-verf-klant]");
    const id = straatEl?.dataset["verfStraat"] ?? klantEl?.dataset["verfKlant"];
    if (!id || id === v.laatste) return;
    v.laatste = id;
    negeerKlik.current = true;

    if (straatEl) {
      const g = groepen.find((x) => x.street.id === id);
      if (!g) return;
      const zichtbaar = [...g.even, ...g.oneven];
      tekenBij(v.aan ? pasDagAan(zichtbaar, []) : pasDagAan([], zichtbaar.map((c) => c.id)));
      return;
    }
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    tekenBij(v.aan ? pasDagAan([c], []) : pasDagAan([], [c.id]));
  }

  /**
   * Begint een streek en past hem meteen toe op het vakje waar je indrukt.
   * Anders zou het beginpunt overgeslagen worden als je in één beweging
   * doorsleept naar een volgende straat.
   */
  function startVerf(aan: boolean, x: number, y: number) {
    verf.current = { aan, laatste: null, vorig: { x, y }, toegevoegd: [], weggehaald: [] };
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
    if (!v) return;
    const raakte = new Set([
      ...v.toegevoegd.map((r) => r.customer_id),
      ...v.weggehaald.map((r) => r.customer_id),
    ]).size;
    if (raakte === 0) return;
    draaiTerug(`${raakte} ${raakte === 1 ? "adres" : "adressen"} ${v.aan ? "op de dag" : "van de dag af"}`, {
      toegevoegd: v.toegevoegd,
      weggehaald: v.weggehaald,
    });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verfBezig]);

  function maakDagLeeg() {
    if (!planDatum) return;
    const datum = planDatum;
    const terug = (qc.getQueryData<WasdagRegel[]>(["wasdag", datum]) ?? [])
      .filter((r) => r.customer_id)
      .map((r) => ({ customer_id: r.customer_id!, prijs: Number(r.prijs) }));
    if (terug.length === 0) return;
    qc.setQueryData<WasdagRegel[]>(["wasdag", datum], []);
    pushUndo({
      label: "Dag leeggemaakt",
      undo: async () => {
        await voegToeAanWasdag(datum, terug);
        qc.invalidateQueries({ queryKey: ["wasdag", datum] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      },
    });
    // Op datum, niet op een lijst met id's: dat blijft ook bij een hele wijk
    // één kort verzoek.
    void maakWasdagLeeg(datum)
      .catch(() => toast.error("Leegmaken mislukt."))
      .finally(() => {
        qc.invalidateQueries({ queryKey: ["wasdag", datum] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      });
  }

  async function patchKlant(c: Customer, patch: Partial<Customer>) {
    const vorige: Partial<Customer> = {};
    for (const key of Object.keys(patch) as (keyof Customer)[]) {
      (vorige as Record<string, unknown>)[key] = c[key];
    }
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
    );
    const { error } = await supabase.from("customers").update(patch).eq("id", c.id);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      qc.invalidateQueries({ queryKey: ["customers"] });
      return;
    }
    pushUndo({
      label: `Wijziging ${formatNumber(c)}`,
      undo: async () => {
        await supabase.from("customers").update(vorige).eq("id", c.id);
        herlaad();
      },
    });
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
    const ja = await bevestig({
      titel: `Klant ${formatNumber(c)} verwijderen?`,
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
      label: `Verwijderen ${formatNumber(c)}`,
      undo: async () => {
        await haalTerug("customers", [c.id]);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`Klant ${formatNumber(c)} verwijderd`);
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

  async function nieuweRegel(streetId: string, nummer: string) {
    const huisnummer = parseInt(nummer, 10);
    if (Number.isNaN(huisnummer)) return;
    const max = Math.max(
      0,
      ...customers.filter((c) => c.street_id === streetId).map((c) => c.sort_order),
    );
    const { data, error } = await supabase
      .from("customers")
      .insert({ street_id: streetId, house_number: huisnummer, sort_order: max + 1 })
      .select("id")
      .single();
    if (error) {
      toast.error("Toevoegen mislukt: " + error.message);
      return;
    }
    const nieuwId = (data as { id: string } | null)?.id;
    if (nieuwId) {
      pushUndo({
        label: `Toevoegen nr ${huisnummer}`,
        undo: async () => {
          await supabase.from("customers").delete().eq("id", nieuwId);
          herlaad();
        },
      });
    }
    qc.invalidateQueries({ queryKey: ["customers"] });
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

    if (activeId.startsWith("s:")) {
      if (!overId.startsWith("s:")) return;
      const ids = streets.map((s) => s.id);
      const from = ids.indexOf(activeId.slice(2));
      const to = ids.indexOf(overId.slice(2));
      if (from < 0 || to < 0) return;
      const next = [...streets];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      const vorigeVolgorde = streets.map((s) => ({ ...s }));
      qc.setQueryData<Street[]>(
        ["streets"],
        next.map((s, i) => ({ ...s, sort_order: i + 1 })),
      );
      await persistStreetOrder(next);
      pushUndo({
        label: "Straatvolgorde",
        undo: async () => {
          await persistStreetOrder(vorigeVolgorde);
          herlaad();
        },
      });
      qc.invalidateQueries({ queryKey: ["streets"] });
      return;
    }

    if (!activeId.startsWith("c:")) return;
    const dragged = customers.find((c) => c.id === activeId.slice(2));
    if (!dragged) return;

    let doelStraat: string | null = null;
    let overKlant: Customer | null = null;
    if (overId.startsWith("c:")) {
      overKlant = customers.find((c) => c.id === overId.slice(2)) ?? null;
      doelStraat = overKlant?.street_id ?? null;
    } else if (overId.startsWith("z:")) {
      doelStraat = overId.slice(2);
    }
    if (!doelStraat) return;

    const verplaatst = selectie.includes(dragged.id)
      ? sortCustomers(customers.filter((c) => selectie.includes(c.id)))
      : [dragged];
    const verplaatstIds = new Set(verplaatst.map((c) => c.id));

    const doelLijst = sortCustomers(
      customers.filter((c) => c.street_id === doelStraat && !verplaatstIds.has(c.id)),
    );
    const index = overKlant ? doelLijst.findIndex((c) => c.id === overKlant!.id) : doelLijst.length;
    const nieuw = [...doelLijst];
    nieuw.splice(index < 0 ? doelLijst.length : index, 0, ...verplaatst);

    const updates = nieuw.map((c, i) => ({ id: c.id, street_id: doelStraat!, sort_order: i + 1 }));
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((c) => {
        const u = updates.find((x) => x.id === c.id);
        return u ? { ...c, street_id: u.street_id, sort_order: u.sort_order } : c;
      }),
    );
    const vorigePlek = [...verplaatst, ...doelLijst].map((c) => ({
      id: c.id,
      street_id: c.street_id,
      sort_order: c.sort_order,
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

  return (
    <AppLayout
      // De titel ís de wijkkiezer: je wisselt van wijk door op de naam te
      // klikken. Dat scheelt een keuzevak in de knoppenbalk eronder.
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
      acties={
        <>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 rounded-full bg-card pl-9"
              placeholder="Zoek straat"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
            />
          </div>
          <StratenAanvullen
            streets={streets.filter((s) => s.district_id === actieveWijk)}
            plaats={wijkPlaats}
            onSaved={() => qc.invalidateQueries({ queryKey: ["streets"] })}
          />
          <Button
            size="sm"
            variant={planDatum ? "default" : "outline"}
            className="rounded-full"
            onClick={() => planmodus(!planDatum)}
            title="Aanvinken wat er op een dag gewassen wordt"
          >
            <CalendarCheck className="size-4" /> Dagplanning
          </Button>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Adressen in beeld",
              waarde: String(totaal),
              icon: Users,
              tegel: "bg-accent text-accent-foreground",
            },
            {
              label: "Straten",
              waarde: String(groepen.length),
              icon: Route2,
              tegel: "bg-tint-amber text-tint-amber-ink",
            },
            {
              label: "Omzet per ronde",
              waarde: formatPrice(omzet),
              icon: Euro,
              tegel: "bg-tint-groen text-tint-groen-ink",
              verberg: !prijzenTonen,
            },
          ]
            .filter((s) => !s.verberg)
            .map((s) => (
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
      <div className="space-y-3">
        <div className="sticky top-[var(--plakrand)] z-[9] -mx-6 flex flex-wrap items-center gap-3 border-b border-border/70 bg-background/85 px-6 py-2 backdrop-blur">
          <div className="inline-flex gap-0.5 rounded-full border border-border bg-card p-[3px]">
            {(["alles", "even", "oneven"] as MaandFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                  filter === f
                    ? "bg-brand font-semibold text-brand-foreground"
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
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {groepen.length} straten · {totaal} klanten
          </span>

          {planDatum && (
            // Blijft in beeld terwijl je naar beneden vinkt: het bedrag is
            // waar je op stuurt bij het samenstellen van een dag.
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/70 pt-2">
              <CalendarCheck className="size-4 text-brand-ink" />
              <Link
                to="/planning"
                search={{ dag: planDatum }}
                className="text-[13px] font-medium underline-offset-2 hover:underline"
                title="Andere dag kiezen op de kalender"
              >
                Dagplanning {toonDatum(planDatum)}
              </Link>
              <span className="font-display text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
                {formatPrice(dagBedrag)}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {opDeDag.size} {opDeDag.size === 1 ? "adres" : "adressen"}
              </span>
              {opDeDag.size > 0 && (
                <button
                  className="text-[12.5px] text-muted-foreground underline"
                  onClick={maakDagLeeg}
                >
                  leegmaken
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
          <SortableContext
            items={groepen.map((g) => `s:${g.street.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div
              className={`gap-3.5 md:columns-1 xl:columns-2 ${
                // Tijdens een streek niets selecteren: anders sleep je een
                // blauwe tekstselectie over de halve wijk.
                verfBezig ? "select-none" : ""
              }`}
            >
              {groepen.map((g) => (
                <StraatBlok
                  key={g.street.id}
                  street={g.street}
                  even={g.even}
                  oneven={g.oneven}
                  aantal={g.aantal}
                  totaal={g.totaal}
                  sort={g.street.sort_desc ? "desc" : "asc"}
                  prijzenTonen={prijzenTonen}
                  quickNotes={quickNotes}
                  klantNamen={klantNamen}
                  rowText={rowText}
                  rowPad={rowPad}
                  selectie={selectie}
                  onSelect={klikSelectie}
                  onPatch={patchKlant}
                  onAddQuickNote={nieuweSnelkeuze}
                  onDelete={verwijderKlant}
                  onNieuweRegel={nieuweRegel}
                  onEditStreet={() => setStraatDialog({ open: true, street: g.street })}
                  onDeleteStreet={() => verwijderStraat(g.street)}
                  onAddKlant={() =>
                    setKlantDialog({ open: true, customer: null, streetId: g.street.id })
                  }
                  onToggleSort={() => void wisselSort(g.street)}
                  ingeklapt={ingeklapt.has(g.street.id)}
                  onKlap={() => klapStraat(g.street.id)}
                  planmodus={planDatum !== null}
                  dagKlaar={dagKlaar}
                  opDeDag={opDeDag}
                  eerderGewassen={eerderGewassen}
                  elderGepland={elderGepland}
                  onStraatOpDag={(aan) => zetStraatOpDag(g, aan)}
                  onKlantOpDag={(c, aan) => {
                    pasDagAan(aan ? [c] : [], aan ? [] : [c.id]);
                  }}
                  onVerfStart={startVerf}
                  negeerKlik={negeerKlik}
                />
              ))}
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
        quickNotes={quickNotes}
        onAddQuickNote={nieuweSnelkeuze}
        onSaved={herlaad}
      />
      <StraatDialog
        districtId={actieveWijk ?? undefined}
        plaats={wijkPlaats}
        open={straatDialog.open}
        onOpenChange={(open) => setStraatDialog((s) => ({ ...s, open }))}
        street={straatDialog.street}
        onSaved={herlaad}
      />
    </AppLayout>
  );
}

interface BlokProps {
  street: Street;
  even: Customer[];
  oneven: Customer[];
  aantal: number;
  totaal: number;
  sort: "asc" | "desc";
  prijzenTonen: boolean;
  quickNotes: QuickNote[];
  /** Naam per klant-id, voor het personen-icoontje op een gekoppelde regel. */
  klantNamen: Map<string, string>;
  rowText: string;
  rowPad: string;
  selectie: string[];
  onSelect: (c: Customer, shift: boolean) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  onNieuweRegel: (streetId: string, nummer: string) => void;
  onEditStreet: () => void;
  onDeleteStreet: () => void;
  onAddKlant: () => void;
  onToggleSort: () => void;
  ingeklapt: boolean;
  onKlap: () => void;
  /** In planmodus tel je adressen voor een dag; bewerken doe je dan niet. */
  planmodus: boolean;
  /** Vals zolang de dag nog opgehaald wordt: dan weten we van niets. */
  dagKlaar: boolean;
  opDeDag: Set<string>;
  /** Adressen die deze maand al op een andere dag gewassen zijn. */
  eerderGewassen: Set<string>;
  /** Adressen die deze maand al op een latere dag ingepland staan. */
  elderGepland: Set<string>;
  onStraatOpDag: (aan: boolean) => void;
  onKlantOpDag: (c: Customer, aan: boolean) => void;
  /** Begint een sleepselectie; `aan` is de kant die de hele streek opgaat. */
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  /** Staat op waar als de streek al iets deed — dan telt de klik erna niet. */
  negeerKlik: { current: boolean };
}

function StraatBlok(p: BlokProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `s:${p.street.id}`,
  });
  const { setNodeRef: setZoneRef } = useDroppable({ id: `z:${p.street.id}` });

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
      className={`mb-3 break-inside-avoid-column overflow-hidden rounded-[14px] border border-border bg-card transition-shadow ${isDragging ? "opacity-50" : ""}`}
    >
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
                if (zichtbaar.length > 0 && p.dagKlaar) p.onStraatOpDag(straatVink !== true);
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
        className={`flex items-center gap-1 border-b border-border px-2.5 py-2 ${kopKleur} ${
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
              p.onStraatOpDag(v === true);
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
            p.onKlap();
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
        <h2 className="flex-1 truncate font-display text-[14.5px] font-semibold uppercase tracking-[0.01em] text-foreground">
          {p.street.name}
        </h2>
        <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {p.planmodus && erop > 0 && erop < p.aantal ? `${erop}/${p.aantal}` : p.aantal}
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
          <span className="text-[11px] font-medium tabular-nums text-brand-ink">
            {formatPrice(p.totaal)}
          </span>
        )}

        {!p.planmodus && (
          <>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={p.onToggleSort}
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
          onClick={p.onAddKlant}
          aria-label="Klant toevoegen"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={p.onEditStreet}
          aria-label="Straat bewerken"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={p.onDeleteStreet}
          aria-label="Straat verwijderen"
        >
          <Trash2 className="size-3.5" />
        </button>
          </>
        )}
      </div>

      <div
        ref={setZoneRef}
        className={`grid grid-cols-2 gap-px bg-border ${p.ingeklapt ? "hidden" : ""}`}
      >
        {(["even", "oneven"] as const).map((kant) => (
          <div key={kant} className="bg-card">
            <div className="flex items-center gap-0.5 border-b border-border/60 px-1 py-1 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
              <span className="w-4" />
              <span className="w-9">NR</span>
              <span className="min-w-0 flex-1 truncate">NOTITIE</span>
              {p.prijzenTonen && <span className="w-12 text-right">PRIJS</span>}
              <span className="min-w-[3.25rem] max-w-[4rem] text-center">FREQ</span>
              <span className="w-4" />
            </div>
            <SortableContext
              items={p[kant].map((c) => `c:${c.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {p[kant].map((c) => (
                <KlantRij
                  key={c.id}
                  customer={c}
                  prijzenTonen={p.prijzenTonen}
                  quickNotes={p.quickNotes}
                  klantNaam={c.klant_id ? p.klantNamen.get(c.klant_id) : undefined}
                  rowText={p.rowText}
                  rowPad={p.rowPad}
                  geselecteerd={p.selectie.includes(c.id)}
                  planmodus={p.planmodus}
                  opDeDag={p.opDeDag.has(c.id)}
                  eerderGewassen={p.eerderGewassen.has(c.id)}
                  elderGepland={p.elderGepland.has(c.id)}
                  dagKlaar={p.dagKlaar}
                  onOpDag={(aan) => p.onKlantOpDag(c, aan)}
                  onVerfStart={p.onVerfStart}
                  negeerKlik={p.negeerKlik}
                  onSelect={p.onSelect}
                  onPatch={p.onPatch}
                  onAddQuickNote={p.onAddQuickNote}
                  onDelete={p.onDelete}
                />
              ))}
            </SortableContext>
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
}

interface RijProps {
  customer: Customer;
  prijzenTonen: boolean;
  quickNotes: QuickNote[];
  klantNaam?: string | undefined;
  rowText: string;
  rowPad: string;
  geselecteerd: boolean;
  planmodus: boolean;
  opDeDag: boolean;
  /** Deze maand al op een andere dag gewassen. */
  eerderGewassen: boolean;
  /** Deze maand al op een latere dag ingepland. */
  elderGepland: boolean;
  dagKlaar: boolean;
  onOpDag: (aan: boolean) => void;
  onVerfStart: (aan: boolean, x: number, y: number) => void;
  negeerKlik: { current: boolean };
  onSelect: (c: Customer, shift: boolean) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
}

/** Kleur per frequentie: blauw is het accent, amber de even maanden, grijs de oneven.
 *  Het amber badge krijgt een randje: een aangevinkte rij is zelf ook amber,
 *  en zonder rand valt het badge daar helemaal in weg. */
const FREQ_KLEUR: Record<Customer["frequency"], string> = {
  elke: "bg-accent text-accent-foreground",
  even: "bg-tint-amber text-tint-amber-ink ring-1 ring-inset ring-tint-amber-ink/25",
  oneven: "bg-muted text-muted-foreground",
};

function KlantRij({
  customer: c,
  prijzenTonen,
  quickNotes,
  klantNaam,
  rowText,
  rowPad,
  geselecteerd,
  planmodus,
  opDeDag,
  eerderGewassen,
  elderGepland,
  dagKlaar,
  onOpDag,
  onVerfStart,
  negeerKlik,
  onSelect,
  onPatch,
  onAddQuickNote,
  onDelete,
}: RijProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `c:${c.id}`,
  });
  const dezeMaand = maandSleutel(new Date());

  // In planmodus vertelt de kleur waar je die dag staat; daarbuiten waar je
  // op moet letten. Twee kleursystemen tegelijk zou niet te lezen zijn.
  const kleur = regelKleur(c, dezeMaand);
  const achtergrond = planmodus
    ? opDeDag
      ? "bg-tint-amber"
      : eerderGewassen
        ? "bg-tint-groen"
        : elderGepland
          ? "bg-tint-paars"
          : ""
    : kleur === "geel"
      ? "bg-tint-amber"
      : kleur === "groen"
        ? "bg-tint-groen"
        : kleur === "rood"
          ? "bg-tint-rood"
          : "";

  const rij = (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group flex items-center gap-0.5 border-b border-border/60 px-0.5 ${rowPad} ${rowText} ${
        isDragging ? "opacity-40" : ""
      } ${geselecteerd ? "bg-accent" : ""} ${achtergrond}`}
      {...(planmodus ? { "data-verf-klant": c.id } : {})}
    >
      {planmodus ? (
        <Checkbox
          className="size-3.5 shrink-0 touch-none"
          checked={opDeDag}
          disabled={!dagKlaar}
          onCheckedChange={(v) => {
            if (negeerKlik.current) {
              negeerKlik.current = false;
              return;
            }
            onOpDag(v === true);
          }}
          onPointerDown={(e) => onVerfStart(!opDeDag, e.clientX, e.clientY)}
          aria-label={`${formatNumber(c)} op de dag`}
        />
      ) : (
        <button
          className="cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          aria-label="Regel verslepen"
          onClick={(e) => onSelect(c, e.shiftKey)}
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
      <div className="w-9 shrink-0">
        <InlineCel
          value={`${c.house_number}${c.addition ?? ""}`}
          align="left"
          className="font-medium"
          onCommit={(v) => {
            const m = /^(\d+)\s*(.*)$/.exec(v.trim());
            if (!m) return;
            onPatch(c, { house_number: parseInt(m[1]!, 10), addition: (m[2] ?? "").trim() });
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <NotitieCel
          value={c.note}
          even={c.note_even}
          oneven={c.note_oneven}
          onChangeEven={(v) => onPatch(c, { note_even: v })}
          onChangeOneven={(v) => onPatch(c, { note_oneven: v })}
          frequency={c.frequency}
          quickNotes={quickNotes}
          onChange={(v) => onPatch(c, { note: v })}
          onAddQuickNote={onAddQuickNote}
        />
      </div>
      {!planmodus && (
        <>
          <Overgeslagen customer={c} />
          <WassenVanaf customer={c} onPatch={(patch) => onPatch(c, patch)} />
        </>
      )}
      {prijzenTonen && (
        <div className={`w-16 shrink-0 ${c.price === 0 ? "text-red-600" : ""}`}>
          <InlineCel
            value={formatPrice(c.price)}
            align="right"
            inputMode="decimal"
            placeholder={formatPrice(0)}
            onCommit={(v) =>
              onPatch(c, { price: Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })
            }
          />
        </div>
      )}
      <select
        value={c.frequency}
        onChange={(e) => onPatch(c, { frequency: e.target.value as Customer["frequency"] })}
        className={`min-w-[3.25rem] max-w-[4rem] shrink-0 cursor-pointer appearance-none rounded-full py-[2px] text-center text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-ring ${FREQ_KLEUR[c.frequency]}`}
        aria-label="Frequentie"
      >
        <option value="elke">Elke</option>
        <option value="even">Even</option>
        <option value="oneven">Oneven</option>
      </select>
      {/* Vaste breedte, ook zonder klant: anders krimpt de notitiekolom van
          precies die ene rij en lopen de kolommen uit de pas. */}
      <span className="w-3 shrink-0">
        {klantNaam && (
          <Link
            to="/klanten"
            tabIndex={-1}
            search={{ klant: c.klant_id ?? "" }}
            title={klantNaam}
            aria-label={`Klantgegevens van ${klantNaam}`}
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <User className="size-3" />
          </Link>
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
    </div>
  );

  // De rechtermuisknop hangt om de hele regel: kleur, overslaan en het
  // dossier zitten daarin, want in de regel zelf is er geen plek voor.
  return (
    <KlantMenu customer={c} onPatch={(patch) => onPatch(c, patch)}>
      {rij}
    </KlantMenu>
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
      className={`w-full bg-transparent px-1.5 py-1 ${rowText} text-muted-foreground placeholder:text-muted-foreground/50 focus:bg-accent/40 focus:outline-none`}
      placeholder="+ nummer"
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
