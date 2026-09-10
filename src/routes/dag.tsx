import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Folder,
  Euro,
  Hammer,
  MapPin,
  Printer,
  Square,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { Cijferkaarten } from "@/components/Cijferkaarten";
import { Button } from "@/components/ui/button";
import { VerplaatsNaarKnop } from "@/components/VerplaatsNaarKnop";
import { OverslaanKnop } from "@/components/OverslaanKnop";
import { DagAdresDialog } from "@/components/DagAdresDialog";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStraatGroepen,
  fetchStreets,
  formatNumber,
  formatPrice,
  noteVoorMaand,
  prijsVoorMaand,
  sortCustomers,
  wijkKleur,
  type Customer,
} from "@/lib/klanten";
import {
  datumSleutel,
  fetchWasdag,
  fetchWasdagen,
  haalUitWasdag,
  toonDatum,
  vandaag,
  voegToeAanWasdag,
  werkWasdagRegelBij,
} from "@/lib/wasdag";
import { fetchKlussen, telDagVan, vinkKlusAf, zetKlusOpDag, type Klus } from "@/lib/klussen";
import { Checkbox } from "@/components/ui/checkbox";
import { pushUndo, undoLaatste, useLaatsteUndoLabel } from "@/lib/undo";
import { slaSelectieOver, wisOverslaanVanSelectie } from "@/lib/overslaan-keuze";

interface DagSearch {
  datum?: string;
}

export const Route = createFileRoute("/dag")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): DagSearch =>
    typeof search["datum"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["datum"])
      ? { datum: search["datum"] }
      : {},
  head: () => ({
    meta: [
      { title: "De dag — Klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Alle adressen die op één dag ingepland staan, per wijk en per straat.",
      },
    ],
  }),
  component: DagPagina,
});

/**
 * De banen van het staafje "waar het geld zit". Uit hetzelfde palet als de
 * kaarten, maar dieper: een baan van drie pixels moet je nog zien liggen.
 */
const GELDKLEUREN = [
  "bg-tint-paars-ink/60",
  "bg-tint-oranje-ink/60",
  "bg-tint-groen-ink/60",
  "bg-brand-ink/60",
  "bg-tint-roze-ink/60",
  "bg-tint-turkoois-ink/60",
];

/** Aan, uit, of half — een kop waarvan maar een deel aanstaat. */
function vinkStand(erop: number, totaal: number): boolean | "indeterminate" {
  if (erop === 0) return false;
  return erop === totaal ? true : "indeterminate";
}

/**
 * Hoeveel van een kop aangevinkt is, als percentage voor de vulling. Minstens
 * 10%, anders is één adres van de zestig niet te zien. Zelfde streepje als op
 * de wijkenpagina.
 */
function vulling(erop: number, totaal: number): number {
  if (erop === 0 || totaal === 0) return 0;
  return Math.max(10, Math.round((erop / totaal) * 100));
}

function vulStijl(erop: number, totaal: number) {
  const gevuld = vulling(erop, totaal);
  return gevuld > 0
    ? {
        backgroundImage: `linear-gradient(to right, var(--accent) ${gevuld}%, transparent ${gevuld}%)`,
      }
    : undefined;
}

interface Straat {
  id: string;
  naam: string;
  klanten: Customer[];
  bedrag: number;
  klantIds: string[];
}

/** Wat er op de regel van deze dag staat: het bedrag en wat er anders ging. */
interface DagRegel {
  prijs: number;
  notitie: string | null;
}

/**
 * Een blok onder een wijkkop: een losse straat, of een subgroep met de straten
 * die erbij horen. Zie `perWijk` voor wanneer het een groep wordt.
 */
type Blok =
  | { soort: "straat"; id: string; straat: Straat }
  | { soort: "groep"; id: string; naam: string; straten: Straat[]; klantIds: string[] };

/**
 * Wat er op één dag te doen staat, straat voor straat.
 *
 * De planningpagina toont een maand en telt per dag een bedrag op; dit is de
 * andere kant van die kaart: welke huisnummers je langsgaat, in de volgorde
 * van de wijklijst, met de notitie erbij. Vanaf hier print je de daglijst, en
 * vanaf hier verzet je wat er niet af gekomen is naar een andere dag.
 */
function DagPagina() {
  useRequireAuth();
  const navigate = useNavigate();
  const { datum: datumUitUrl } = Route.useSearch();
  const datum = datumUitUrl ?? vandaag();

  const wasdagQuery = useQuery({
    queryKey: ["wasdag", datum],
    queryFn: () => fetchWasdag(datum),
  });
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const groepenQuery = useQuery({ queryKey: ["straat_groepen"], queryFn: fetchStraatGroepen });
  const qc = useQueryClient();
  const undoLabel = useLaatsteUndoLabel();
  // Openstaand werk plus wat er op deze dag afgevinkt is.
  const klussenQuery = useQuery({
    queryKey: ["klussen", datum, datum],
    queryFn: () => fetchKlussen(datum, datum),
  });

  /**
   * Een half jaar terug, om te zien wat dezelfde wijk de vorige ronde opbracht.
   * Dat is het getal waar je onderweg aan afmeet of je goed zit.
   */
  const terugblikQuery = useQuery({
    queryKey: ["wasdagen", "terugblik", datum],
    queryFn: () => {
      const d = new Date(`${datum}T12:00:00`);
      d.setDate(d.getDate() - 180);
      return fetchWasdagen(datumSleutel(d), datum);
    },
  });

  const maand = datum.slice(0, 7);

  /**
   * De selecteermodus. Uit is de pagina een lijst om af te lezen en te printen;
   * aan komen de vakjes tevoorschijn en kun je werk naar een andere dag zetten.
   * Adressen en losse opdrachten verhuizen langs verschillende wegen, dus ze
   * hebben elk hun eigen mandje.
   */
  const [selecteren, setSelecteren] = useState(false);
  const [keuze, setKeuze] = useState<Set<string>>(new Set());
  const [klusKeuze, setKlusKeuze] = useState<Set<string>>(new Set());
  const [bezig, setBezig] = useState(false);

  // Ga je naar een andere dag, dan is een selectie van de vorige dag niet meer
  // van jou: die adressen staan hier niet eens.
  useEffect(() => {
    setKeuze(new Set());
    setKlusKeuze(new Set());
  }, [datum]);

  function pasKeuzeAan(erbij: string[], eraf: string[]) {
    setKeuze((was) => {
      const nu = new Set(was);
      for (const id of erbij) nu.add(id);
      for (const id of eraf) nu.delete(id);
      return nu;
    });
  }

  /**
   * De extra opdrachten die op deze dag horen. Niet afgevinkt en de dag is
   * geweest? Dan staat hij hier niet meer: die is van de dag af en wacht weer
   * op de planning. Zie telDagVan in src/lib/klussen.ts.
   */
  const klussen = useMemo(
    () => (klussenQuery.data ?? []).filter((k) => telDagVan(k) === datum),
    [klussenQuery.data, datum],
  );

  /** "Kerkstraat 12" bij een opdracht. */
  const adresVan = useMemo(() => {
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straten = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    return (k: Klus) => {
      const c = adres.get(k.customer_id);
      const s = c ? straten.get(c.street_id) : undefined;
      return c ? `${s?.name ?? "?"} ${formatNumber(c)}` : "Verwijderd adres";
    };
  }, [customersQuery.data, streetsQuery.data]);

  async function vinkAf(k: Klus, aan: boolean) {
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

  /**
   * De dag uitgesplitst per wijk en daarbinnen per straat. Het bedrag komt van
   * de wasdag-regel en niet van het adres: een prijsverhoging van later hoort
   * een dag van vorige week niet duurder te maken.
   *
   * Straten die bij een subgroep horen komen alleen onder een eigen kop te
   * staan als die groep die dag compleet is: alle straten ervan staan op de
   * dag. Dan is die kop iets waars om op te klikken — je verzet de groep zoals
   * je hem ook ingepland hebt. Staat er maar een deel van op, dan zou zo'n kop
   * doen alsof je de hele groep verplaatst terwijl de rest ergens anders
   * staat, en dus blijven die straten los.
   */
  const perWijk = useMemo(() => {
    const regels = wasdagQuery.data ?? [];
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    const wijkIndex = new Map((districtsQuery.data ?? []).map((d, i) => [d.id, i]));
    const wijkNaam = new Map((districtsQuery.data ?? []).map((d) => [d.id, d.name]));
    const regelVan = new Map<string | null, DagRegel>(
      regels.map((r) => [r.customer_id, { prijs: Number(r.prijs), notitie: r.notitie ?? null }]),
    );

    // Hoeveel straten telt een subgroep in totaal? Daar meten we "compleet"
    // aan af, dus dat komt van de stratenlijst en niet van de dag.
    const groepGroot = new Map<string, number>();
    for (const s of streetsQuery.data ?? []) {
      if (s.groep_id) groepGroot.set(s.groep_id, (groepGroot.get(s.groep_id) ?? 0) + 1);
    }
    const groepNaam = new Map((groepenQuery.data ?? []).map((g) => [g.id, g.naam]));
    const groepIndex = new Map((groepenQuery.data ?? []).map((g, i) => [g.id, i]));

    interface Wijk {
      id: string;
      naam: string;
      kleur: string;
      bedrag: number;
      aantal: number;
      straten: Map<string, Straat>;
      groepVan: Map<string, string | null>;
    }

    const wijken = new Map<string, Wijk>();
    let kwijt = 0;

    for (const r of regels) {
      const c = r.customer_id ? adres.get(r.customer_id) : undefined;
      const s = c ? straat.get(c.street_id) : undefined;
      if (!c || !s) {
        // Adres of straat is intussen definitief weggegooid.
        kwijt += 1;
        continue;
      }
      const index = wijkIndex.get(s.district_id) ?? 0;
      const wijk = wijken.get(s.district_id) ?? {
        id: s.district_id,
        naam: wijkNaam.get(s.district_id) ?? "Onbekende wijk",
        kleur: wijkKleur(index),
        bedrag: 0,
        aantal: 0,
        straten: new Map<string, Straat>(),
        groepVan: new Map<string, string | null>(),
      };
      wijk.bedrag += Number(r.prijs);
      wijk.aantal += 1;

      const rij = wijk.straten.get(s.id) ?? {
        id: s.id,
        naam: s.name,
        klanten: [],
        bedrag: 0,
        klantIds: [],
      };
      rij.klanten.push(c);
      rij.bedrag += Number(r.prijs);
      wijk.straten.set(s.id, rij);
      wijk.groepVan.set(s.id, s.groep_id ?? null);
      wijken.set(s.district_id, wijk);
    }

    // Van kop naar adressen: waar de streek en de klik hun id's vandaan halen.
    const idsVan = new Map<string, string[]>();

    const wijkenUit = [...wijken.values()]
      .sort((a, b) => (wijkIndex.get(a.id) ?? 0) - (wijkIndex.get(b.id) ?? 0))
      .map((w) => {
        const straten = [...w.straten.values()]
          .sort((a, b) => a.naam.localeCompare(b.naam, "nl"))
          // Huisnummers in dezelfde volgorde als op de wijklijst.
          .map((s) => {
            const klanten = sortCustomers(s.klanten);
            const klantIds = klanten.map((c) => c.id);
            idsVan.set(`s:${s.id}`, klantIds);
            return { ...s, klanten, klantIds };
          });

        // Welke subgroepen staan er die dag compleet op? Alleen die krijgen
        // een kop; één straat in z'n eentje is al een kop, dus daar voegt een
        // groep eromheen niets aan toe.
        const perGroep = new Map<string, Straat[]>();
        for (const s of straten) {
          const gid = w.groepVan.get(s.id);
          if (!gid) continue;
          perGroep.set(gid, [...(perGroep.get(gid) ?? []), s]);
        }
        const compleet = new Set(
          [...perGroep.entries()]
            .filter(([gid, lijst]) => lijst.length >= 2 && lijst.length === groepGroot.get(gid))
            .map(([gid]) => gid),
        );

        const groepen: Blok[] = [...compleet]
          .sort((a, b) => (groepIndex.get(a) ?? 0) - (groepIndex.get(b) ?? 0))
          .map((gid) => {
            const lijst = perGroep.get(gid) ?? [];
            const klantIds = lijst.flatMap((s) => s.klantIds);
            idsVan.set(`g:${gid}`, klantIds);
            return {
              soort: "groep" as const,
              id: gid,
              naam: groepNaam.get(gid) ?? "Groep",
              straten: lijst,
              klantIds,
            };
          });
        const los: Blok[] = straten
          .filter((s) => {
            const gid = w.groepVan.get(s.id);
            return !gid || !compleet.has(gid);
          })
          .map((s) => ({ soort: "straat" as const, id: s.id, straat: s }));

        const klantIds = straten.flatMap((s) => s.klantIds);
        idsVan.set(`w:${w.id}`, klantIds);
        return {
          ...w,
          // Groepen bovenaan, net als op de wijkenpagina; wat er los bij hoort
          // staat eronder.
          blokken: [...groepen, ...los],
          klantIds,
        };
      });

    return { wijken: wijkenUit, kwijt, regelVan, idsVan };
  }, [
    wasdagQuery.data,
    customersQuery.data,
    streetsQuery.data,
    districtsQuery.data,
    groepenQuery.data,
  ]);

  const regels = wasdagQuery.data ?? [];
  const bedrag =
    regels.reduce((sum, r) => sum + Number(r.prijs), 0) +
    klussen.reduce((sum, k) => sum + k.prijs, 0);
  const straten = perWijk.wijken.reduce(
    (sum, w) =>
      sum + w.blokken.reduce((n, b) => n + (b.soort === "groep" ? b.straten.length : 1), 0),
    0,
  );
  const gekozen = keuze.size + klusKeuze.size;
  /** Alles wat je op deze dag zou kúnnen aanvinken. */
  const alleKlantIds = useMemo(() => perWijk.wijken.flatMap((w) => w.klantIds), [perWijk.wijken]);
  const openKlussen = klussen.filter((k) => !k.gedaan_op);
  const teKiezen = alleKlantIds.length + openKlussen.length;
  const allesGekozen = gekozen > 0 && gekozen === teKiezen;

  function wisselAlles() {
    if (allesGekozen) {
      setKeuze(new Set());
      setKlusKeuze(new Set());
    } else {
      setKeuze(new Set(alleKlantIds));
      setKlusKeuze(new Set(openKlussen.map((k) => k.id)));
    }
  }

  // --- Slepen om te selecteren -------------------------------------------
  // Precies zoals op de wijkenpagina: het eerste vakje bepaalt of je aan- of
  // uitzet, alles wat je daarna aanraakt volgt diezelfde kant op. Zou elk
  // vakje omschakelen, dan vink je bij het terugslepen je eigen werk weer uit.
  type Punt = { x: number; y: number };
  const verf = useRef<{ aan: boolean; laatste: string | null; vorig: Punt | null } | null>(null);
  const [verfBezig, setVerfBezig] = useState(false);
  /** Een streek eindigt met een klik; die mag niet nóg eens omschakelen. */
  const negeerKlik = useRef(false);

  /** Staat dit vak (adres, straat, groep, wijk of opdracht) helemaal aan? */
  function staatAan(vak: string): boolean {
    if (vak.startsWith("k:")) return klusKeuze.has(vak.slice(2));
    if (vak.startsWith("c:")) return keuze.has(vak.slice(2));
    const ids = perWijk.idsVan.get(vak) ?? [];
    return ids.length > 0 && ids.every((id) => keuze.has(id));
  }

  /** Zet een vak aan of uit. Een kop neemt alles wat eronder hangt mee. */
  function zetVak(vak: string, aan: boolean) {
    if (vak.startsWith("k:")) {
      const id = vak.slice(2);
      setKlusKeuze((was) => {
        const nu = new Set(was);
        if (aan) nu.add(id);
        else nu.delete(id);
        return nu;
      });
      return;
    }
    const ids = vak.startsWith("c:") ? [vak.slice(2)] : (perWijk.idsVan.get(vak) ?? []);
    pasKeuzeAan(aan ? ids : [], aan ? [] : ids);
  }

  /** Past de streek toe op wat er onder de muis of vinger ligt. */
  function verfOpPunt(x: number, y: number) {
    const v = verf.current;
    if (!v) return;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-verf]");
    const vak = el?.dataset["verf"];
    if (!vak || vak === v.laatste) return;
    v.laatste = vak;
    negeerKlik.current = true;
    zetVak(vak, v.aan);
  }

  /**
   * Begint een streek en past hem meteen toe op het vak waar je indrukt.
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
   * muis zo over hele regels heen; dan zou je ze overslaan.
   */
  function verfOpLijn(naar: Punt) {
    const v = verf.current;
    if (!v) return;
    const van = v.vorig ?? naar;
    v.vorig = naar;
    const dx = naar.x - van.x;
    const dy = naar.y - van.y;
    // Om de ~8 px kijken: dat is fijner dan de kleinste regel hoog is.
    const stappen = Math.min(80, Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)));
    for (let i = 1; i <= stappen; i++) {
      verfOpPunt(van.x + (dx * i) / stappen, van.y + (dy * i) / stappen);
    }
  }

  // De streek loopt door buiten het vak waar hij begon, dus hangen deze
  // luisteraars aan het venster. `elementFromPoint` in plaats van
  // pointerenter: bij aanraken vangt het startvak alle verdere events.
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
    const stop = () => {
      verf.current = null;
      setVerfBezig(false);
      // Eindigt een streek buiten een regel, dan volgt er geen klik meer en
      // zou de vlag blijven staan — en de eerstvolgende gewone klik opslokken.
      setTimeout(() => {
        negeerKlik.current = false;
      }, 0);
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

  /**
   * De hele regel is de knop, niet alleen het vakje: op een huisnummer mikken
   * met de muis is priegelwerk. Met de muis doet het indrukken het al (dat is
   * ook het begin van een streek); de klik erna is er voor aanraken.
   */
  function vakKnop(vak: string) {
    if (!selecteren) return {};
    return {
      "data-verf": vak,
      onClick: () => {
        if (negeerKlik.current) {
          negeerKlik.current = false;
          return;
        }
        zetVak(vak, !staatAan(vak));
      },
      onPointerDown: (e: React.PointerEvent) => {
        // Bij aanraken niet: dan is een veeg over de lijst bedoeld om te
        // scrollen.
        if (e.pointerType !== "touch") startVerf(!staatAan(vak), e.clientX, e.clientY);
      },
      className: "cursor-pointer select-none",
    };
  }

  /**
   * Zet de selectie op een andere dag.
   *
   * Adressen verhuizen als wasdag-regel: eraf op vandaag, erop bij de nieuwe
   * dag, met de prijs die op de regel stond — dat is de prijs waarvoor het
   * werk verkocht is. Stond een adres daar al, dan laten we die regel met rust
   * in plaats van er onze prijs overheen te zetten.
   *
   * Losse opdrachten hebben geen wasdag-regel; die krijgen gewoon een andere
   * dag mee. Vandaar twee wegen in één knop.
   */
  async function verplaatsNaar(nieuw: string) {
    const ids = [...keuze];
    const teVerzetten = klussen.filter((k) => klusKeuze.has(k.id));
    if (ids.length === 0 && teVerzetten.length === 0) return;

    const regelsMee = ids.map((id) => ({
      customer_id: id,
      prijs: perWijk.regelVan.get(id)?.prijs ?? 0,
      notitie: perWijk.regelVan.get(id)?.notitie ?? null,
    }));

    setBezig(true);
    let toevoegen = regelsMee;
    try {
      // Wat er al op de doeldag staat blijft staan zoals het staat; alleen de
      // rest zetten we erop. Zo weet "ongedaan maken" straks ook precies wat
      // het daar mag weghalen.
      const bestaand = await fetchWasdag(nieuw);
      const alErop = new Set(bestaand.map((r) => r.customer_id).filter(Boolean) as string[]);
      toevoegen = regelsMee.filter((r) => !alErop.has(r.customer_id));

      await voegToeAanWasdag(nieuw, toevoegen);
      await haalUitWasdag(datum, ids);
      for (const k of teVerzetten) await zetKlusOpDag(k.id, nieuw);
    } catch (e) {
      toast.error("Verplaatsen mislukt: " + (e as Error).message);
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      qc.invalidateQueries({ queryKey: ["klussen"] });
      setBezig(false);
      return;
    }
    setBezig(false);

    const terug = toevoegen;
    pushUndo({
      label: `Verplaatst naar ${toonDatum(nieuw)}`,
      undo: async () => {
        await haalUitWasdag(
          nieuw,
          terug.map((r) => r.customer_id),
        );
        await voegToeAanWasdag(datum, regelsMee);
        for (const k of teVerzetten) await zetKlusOpDag(k.id, k.gepland_op);
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });

    qc.invalidateQueries({ queryKey: ["wasdag"] });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    qc.invalidateQueries({ queryKey: ["klussen"] });
    setKeuze(new Set());
    setKlusKeuze(new Set());

    const delen: string[] = [];
    if (ids.length) delen.push(`${ids.length} ${ids.length === 1 ? "adres" : "adressen"}`);
    if (teVerzetten.length)
      delen.push(`${teVerzetten.length} ${teVerzetten.length === 1 ? "opdracht" : "opdrachten"}`);
    toast.success(`${delen.join(" en ")} verplaatst naar ${toonDatum(nieuw)}`, {
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

  /** Eén regel die zegt waar je vandaag heen gaat. */
  const samenvatting = useMemo(() => {
    if (perWijk.wijken.length === 0 && klussen.length === 0) {
      return "Alles wat er deze dag te doen staat, straat voor straat.";
    }
    const namen = perWijk.wijken.map((w) => w.naam);
    const wijk =
      namen.length === 0
        ? ""
        : namen.length === 1
          ? namen[0]!
          : `${namen.slice(0, -1).join(", ")} en ${namen.at(-1)}`;
    const delen = [`${straten} ${straten === 1 ? "straat" : "straten"}`];
    if (klussen.length > 0) {
      delen.push(`${klussen.length} extra ${klussen.length === 1 ? "opdracht" : "opdrachten"}`);
    }
    return [wijk, delen.join(", ")].filter(Boolean).join(" · ");
  }, [perWijk.wijken, straten, klussen.length]);

  /** De straat waar de meeste adressen van deze dag liggen. */
  const drukstestraat = useMemo(() => {
    const alle = perWijk.wijken.flatMap((w) =>
      w.blokken.flatMap((b) => (b.soort === "groep" ? b.straten : [b.straat])),
    );
    const grootste = alle.reduce<(typeof alle)[number] | null>(
      (a, b) => (a && a.klanten.length >= b.klanten.length ? a : b),
      null,
    );
    return grootste ? `${grootste.klanten.length} op ${grootste.naam}` : "nog niets ingepland";
  }, [perWijk.wijken]);

  /**
   * Wat dezelfde wijk de vorige keer opbracht. De laatste dag vóór vandaag
   * waarop je in een van deze wijken was — niet zomaar de vorige werkdag,
   * want dan vergelijk je Gouda met Madestein.
   */
  const vorigeRonde = useMemo(() => {
    const rijen = terugblikQuery.data ?? [];
    if (rijen.length === 0) return null;
    const adres = new Map((customersQuery.data ?? []).map((c) => [c.id, c]));
    const straat = new Map((streetsQuery.data ?? []).map((st) => [st.id, st]));
    const hier = new Set(perWijk.wijken.map((w) => w.id));
    if (hier.size === 0) return null;

    const perDatum = new Map<string, { bedrag: number; wijken: Set<string> }>();
    for (const r of rijen) {
      if (r.datum >= datum) continue;
      const dag = perDatum.get(r.datum) ?? { bedrag: 0, wijken: new Set<string>() };
      dag.bedrag += Number(r.prijs);
      const c = r.customer_id ? adres.get(r.customer_id) : undefined;
      const st = c ? straat.get(c.street_id) : undefined;
      if (st) dag.wijken.add(st.district_id);
      perDatum.set(r.datum, dag);
    }
    const zelfdeWijk = [...perDatum.entries()]
      .filter(([, d]) => [...d.wijken].some((id) => hier.has(id)))
      .sort((a, b) => b[0].localeCompare(a[0]));
    const laatste = zelfdeWijk[0];
    return laatste ? { datum: laatste[0], bedrag: laatste[1].bedrag } : null;
  }, [terugblikQuery.data, customersQuery.data, streetsQuery.data, perWijk.wijken, datum]);

  /**
   * Waar het geld van de dag zit, per straat. Twee straten kunnen evenveel
   * adressen hebben en toch het dubbele opleveren; dat zie je aan een lijst
   * met bedragen niet, en aan een balk wel.
   */
  const geldVerdeling = useMemo(() => {
    const straatjes = perWijk.wijken
      .flatMap((w) => w.blokken.flatMap((b) => (b.soort === "groep" ? b.straten : [b.straat])))
      .map((st) => ({ naam: st.naam, bedrag: st.bedrag }));
    const klusGeld = klussen.reduce((sum, k) => sum + k.prijs, 0);
    if (klusGeld > 0) straatjes.push({ naam: "Extra opdrachten", bedrag: klusGeld });
    const gesorteerd = straatjes.sort((a, b) => b.bedrag - a.bedrag);
    const top = gesorteerd.slice(0, 5);
    const rest = gesorteerd.slice(5).reduce((sum, g) => sum + g.bedrag, 0);
    if (rest > 0) top.push({ naam: "overige straten", bedrag: rest });
    return top.map((g, i) => ({
      ...g,
      kleur: g.naam === "Extra opdrachten" ? "bg-tint-geel-ink/60" : (GELDKLEUREN[i] ?? "bg-muted"),
    }));
  }, [perWijk.wijken, klussen]);

  /**
   * De aangevinkte adressen als adres en niet als id: overslaan werkt op het
   * adres zelf (zijn ritme), en heeft dus het hele ding nodig.
   */
  const gekozenAdressen = useMemo(
    () => (customersQuery.data ?? []).filter((c) => keuze.has(c.id)),
    [customersQuery.data, keuze],
  );

  /**
   * Het adres waar je op klikte. Buiten de selecteerstand opent dat het
   * schermpje van die dag: wat er vast bij het adres hoort, en wat er die
   * keer anders ging.
   */
  const [bewerkt, setBewerkt] = useState<{ customer: Customer; straat: string } | null>(null);

  /**
   * Het bedrag en de notitie van deze ene dag opslaan. De vaste prijs van het
   * adres blijft staan: een keer alleen de voorkant hoort de volgende ronde
   * niet goedkoper te maken.
   */
  async function bewaarDag(c: Customer, prijs: number, notitie: string | null) {
    const oud = perWijk.regelVan.get(c.id);
    if (!oud) return;
    if (oud.prijs === prijs && (oud.notitie ?? null) === notitie) return;
    try {
      await werkWasdagRegelBij(datum, c.id, { prijs, notitie });
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `${formatNumber(c)} op ${toonDatum(datum)}`,
      undo: async () => {
        await werkWasdagRegelBij(datum, c.id, { prijs: oud.prijs, notitie: oud.notitie });
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["wasdag"] });
    qc.invalidateQueries({ queryKey: ["wasdagen"] });
    toast.success(`Bijgewerkt voor ${toonDatum(datum)}`, {
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

  async function doeUndo() {
    const label = await undoLaatste();
    if (label) toast.success("Teruggedraaid: " + label);
    else toast("Niets om terug te draaien");
  }

  /** De dag ervoor en erna, om met de pijltjes langs de week te lopen. */
  function schuifDag(stappen: number) {
    const d = new Date(`${datum}T12:00:00`);
    d.setDate(d.getDate() + stappen);
    void navigate({ to: "/dag", search: { datum: datumSleutel(d) } });
  }

  return (
    <AppLayout
      titel={datum === vandaag() ? "Vandaag op de route" : `De route van ${toonDatum(datum)}`}
      kruimel="Overzicht / Planning / Dag"
      onderschrift={samenvatting}
      actiePositie="onder"
      acties={
        <>
          {/* De dag is één pil met de pijltjes erin: zo loop je met twee
              klikken langs de week zonder terug naar de kalender te gaan. */}
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-card py-1 pl-1 pr-1 shadow-card">
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
              onClick={() => schuifDag(-1)}
              aria-label="Dag ervoor"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-1.5 text-[13px] font-medium first-letter:uppercase">
              {toonDatum(datum)}
            </span>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
              onClick={() => schuifDag(1)}
              aria-label="Dag erna"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {selecteren && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={wisselAlles}
                title={allesGekozen ? "Alles uitvinken" : `Alle ${teKiezen} regels aanvinken`}
              >
                {allesGekozen ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
                {allesGekozen ? "Niets" : "Alles"}
              </Button>
              <VerplaatsNaarKnop
                aantal={bezig ? 0 : gekozen}
                huidigeDag={datum}
                onKies={(d) => void verplaatsNaar(d)}
              />
              {/* Verplaatsen is voor deze week; overslaan is voor de maanden
                  erna. Allebei dingen die je bedenkt terwijl je naar de dag
                  kijkt, dus staan ze naast elkaar — net als op de wijkenpagina. */}
              <OverslaanKnop
                aantal={keuze.size}
                onOverslaan={(m) => void slaSelectieOver(gekozenAdressen, m, qc)}
                onNietsOverslaan={() => void wisOverslaanVanSelectie(gekozenAdressen, qc)}
              />
            </>
          )}

          {/* Rechts alleen ronde knoppen en één donkere pil: printen is wat je
              hier komt doen, de rest is er als je hem nodig hebt. */}
          <span className="ml-auto flex items-center gap-2">
            <RondeKnop
              actief={selecteren}
              label="Aanvinken wat er niet af gekomen is"
              onClick={() => {
                setSelecteren((v) => !v);
                setKeuze(new Set());
                setKlusKeuze(new Set());
              }}
              uit={teKiezen === 0}
            >
              <CheckSquare className="size-4" />
            </RondeKnop>
            <RondeKnop label="Ongedaan maken" onClick={() => void doeUndo()} uit={!undoLabel}>
              <Undo2 className="size-4" />
            </RondeKnop>
            <RondeKnop label="Naar de kalender" naar={{ to: "/planning", search: { dag: datum } }}>
              <CalendarDays className="size-4" />
            </RondeKnop>
            <RondeKnop label="Werk inplannen" naar={{ to: "/", search: { dag: datum } }}>
              <Euro className="size-4" />
            </RondeKnop>
            <Button size="sm" className="rounded-full" asChild disabled={regels.length === 0}>
              <Link
                to="/printen"
                search={{ wijk: "", maand, prijzen: false, liggend: true, dag: datum }}
              >
                <Printer className="size-4" /> Printlijst
              </Link>
            </Button>
          </span>
        </>
      }
      kop={
        <Cijferkaarten
          cijfers={[
            {
              label: "Adressen",
              waarde: String(regels.length),
              onder: drukstestraat,
              icon: Users,
              kleur: "paars",
            },
            {
              label: "Straten",
              waarde: String(straten),
              onder:
                perWijk.wijken.length === 1 ? "in één wijk" : `in ${perWijk.wijken.length} wijken`,
              icon: MapPin,
              kleur: "amber",
            },
            {
              label: "Opbrengst",
              waarde: formatPrice(bedrag),
              onder: vorigeRonde
                ? `laatst hier ${formatPrice(vorigeRonde.bedrag)} · ${toonDatum(vorigeRonde.datum)}`
                : "eerste keer in deze wijk",
              icon: Euro,
              kleur: "groen",
            },
          ]}
        />
      }
    >
      {wasdagQuery.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Laden…</p>
      ) : regels.length === 0 && klussen.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="font-display text-[17px] font-semibold">Nog niets op deze dag</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Vink in de wijken aan wat je gaat doen, of zet er met de rechtermuisknop op de kalender
            een hele wijk op.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-3">
            {perWijk.wijken.map((w) => {
              const eropWijk = w.klantIds.filter((id) => keuze.has(id)).length;
              const { className: wijkKnop, ...wijkRest } = vakKnop(`w:${w.id}`) as {
                className?: string;
              } & Record<string, unknown>;
              return (
                <section
                  key={w.id}
                  className="rounded-[18px] border border-border bg-card p-2.5 shadow-card"
                >
                  <div
                    {...wijkRest}
                    style={vulStijl(eropWijk, w.klantIds.length)}
                    className={`mb-1 flex items-center gap-2 rounded-[12px] px-2 py-1.5 ${wijkKnop ?? ""}`}
                  >
                    {selecteren && (
                      <Checkbox
                        className="pointer-events-none size-3.5 shrink-0"
                        checked={vinkStand(eropWijk, w.klantIds.length)}
                        tabIndex={-1}
                        aria-label={`Hele wijk ${w.naam}`}
                      />
                    )}
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: w.kleur }}
                    />
                    <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                      {w.naam}
                    </h2>
                    <span className="rounded-full bg-surface px-2 py-[1px] text-[10.5px] tabular-nums text-muted-foreground">
                      {w.aantal} adressen
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums">
                      {formatPrice(w.bedrag)}
                    </span>
                  </div>

                  {w.blokken.map((b) =>
                    b.soort === "groep" ? (
                      <div key={`g:${b.id}`}>
                        {/* Deze groep staat er compleet op, dus je verzet hem in
                            één klik — zoals je hem ook in één klik ingepland hebt. */}
                        <GroepKop
                          naam={b.naam}
                          erop={b.klantIds.filter((id) => keuze.has(id)).length}
                          totaal={b.klantIds.length}
                          selecteren={selecteren}
                          knop={vakKnop(`g:${b.id}`)}
                        />
                        {b.straten.map((s) => (
                          <StraatRij
                            key={s.id}
                            straat={s}
                            maand={maand}
                            regelVan={perWijk.regelVan}
                            selecteren={selecteren}
                            keuze={keuze}
                            vakKnop={vakKnop}
                            onAdres={setBewerkt}
                          />
                        ))}
                      </div>
                    ) : (
                      <StraatRij
                        key={`s:${b.id}`}
                        straat={b.straat}
                        maand={maand}
                        regelVan={perWijk.regelVan}
                        selecteren={selecteren}
                        keuze={keuze}
                        vakKnop={vakKnop}
                        onAdres={setBewerkt}
                      />
                    ),
                  )}
                </section>
              );
            })}

            {perWijk.kwijt > 0 && (
              <p className="text-[12.5px] text-muted-foreground">
                {perWijk.kwijt} {perWijk.kwijt === 1 ? "adres is" : "adressen zijn"} intussen
                verwijderd; ze tellen wel mee in het bedrag.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {/* Extra werk dat niet aan een maand vastzit. Naast de route, want
                het hoort niet bij de ronde van een straat — je pikt het mee als
                je er toch bent. Afvinken doe je hier: gebeurt dat niet, dan is
                hij morgen weer van deze dag af en wacht hij op de planning. */}
            {klussen.length > 0 && (
              <section className="rounded-[18px] bg-tint-geel p-3 text-tint-geel-ink shadow-card">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-tint-geel-ink/15">
                    <Hammer className="size-[15px]" />
                  </span>
                  <h2 className="min-w-0 flex-1 truncate font-display text-[14.5px] font-semibold">
                    Extra opdrachten
                  </h2>
                  <span className="text-[12.5px] font-semibold tabular-nums">
                    {formatPrice(klussen.reduce((sum, k) => sum + k.prijs, 0))}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {klussen.map((k) => {
                    // Afgevinkt werk verplaats je niet: dat is gedaan, en het
                    // hoort bij de omzet van deze dag.
                    const kiesbaar = selecteren && !k.gedaan_op;
                    const { className: klusKnop, ...klusRest } = (
                      kiesbaar ? vakKnop(`k:${k.id}`) : {}
                    ) as { className?: string } & Record<string, unknown>;
                    return (
                      <li
                        key={k.id}
                        {...klusRest}
                        className={`flex items-center gap-2 rounded-[11px] px-2.5 py-1.5 text-[12.5px] ${klusKnop ?? ""} ${
                          klusKeuze.has(k.id)
                            ? "bg-accent text-accent-foreground"
                            : "bg-card/70 text-card-foreground"
                        } ${k.gedaan_op ? "opacity-60" : ""}`}
                      >
                        {/* Afvinken blijft afvinken, ook in de selecteerstand:
                            dat vakje mag niet in de klik van de regel opgaan. */}
                        <span
                          className="flex shrink-0 items-center"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            className="size-4"
                            checked={!!k.gedaan_op}
                            onCheckedChange={(v) => void vinkAf(k, v === true)}
                            aria-label={`${k.omschrijving} gedaan`}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate font-medium ${k.gedaan_op ? "line-through" : ""}`}
                          >
                            {adresVan(k)}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {k.omschrijving}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{formatPrice(k.prijs)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Waar het geld van de dag zit. Twee straten kunnen evenveel
                adressen hebben en toch het dubbele opleveren; dat zie je aan
                een lijst met bedragen niet, en aan een balk wel. */}
            {geldVerdeling.length > 1 && (
              <section className="rounded-[18px] border border-border bg-card p-3 shadow-card">
                <h2 className="mb-2 font-display text-[14px] font-semibold">Waar het geld zit</h2>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-surface">
                  {geldVerdeling.map((g) => (
                    <span
                      key={g.naam}
                      className={g.kleur}
                      style={{ width: `${(g.bedrag / bedrag) * 100}%` }}
                    />
                  ))}
                </span>
                <ul className="mt-2 space-y-0.5">
                  {geldVerdeling.map((g) => (
                    <li key={g.naam} className="flex items-center gap-2 text-[12px]">
                      <span className={`size-2 shrink-0 rounded-[3px] ${g.kleur}`} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {g.naam}
                      </span>
                      <span className="tabular-nums">{formatPrice(g.bedrag)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Wat je hier komt doen als de dag niet af kwam. Staat er alleen
                als je nog niet aan het aanvinken bent. */}
            {!selecteren && teKiezen > 0 && (
              <button
                type="button"
                onClick={() => setSelecteren(true)}
                className="flex w-full items-center gap-2.5 rounded-[18px] border border-border bg-card p-3 text-left shadow-card hover:bg-card-header"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-foreground">
                  <ArrowRight className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">Niet af gekomen?</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    Vink aan en zet het op een andere dag
                  </span>
                </span>
              </button>
            )}
          </div>

          <DagAdresDialog
            open={bewerkt !== null}
            onOpenChange={(v) => {
              if (!v) setBewerkt(null);
            }}
            customer={bewerkt?.customer ?? null}
            straat={bewerkt?.straat ?? ""}
            datum={datum}
            prijs={bewerkt ? (perWijk.regelVan.get(bewerkt.customer.id)?.prijs ?? 0) : 0}
            notitie={bewerkt ? (perWijk.regelVan.get(bewerkt.customer.id)?.notitie ?? null) : null}
            onOpslaan={(prijs, notitie) => {
              if (bewerkt) void bewaarDag(bewerkt.customer, prijs, notitie);
            }}
          />
        </div>
      )}
    </AppLayout>
  );
}

/**
 * Een ronde knop met alleen een icoon. Rechtsboven staan er een paar naast
 * elkaar; met tekst erbij zou die balk twee regels lang worden en zou niets er
 * meer uitspringen. De naam zit in `aria-label` en in de tooltip, dus hij is
 * te vinden voor wie hem niet herkent.
 */
function RondeKnop({
  label,
  onClick,
  naar,
  actief = false,
  uit = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  /** Een link in plaats van een knop, bijvoorbeeld naar de kalender. */
  naar?: { to: string; search: Record<string, unknown> };
  actief?: boolean;
  uit?: boolean;
  children: ReactNode;
}) {
  const klassen = `flex size-9 items-center justify-center rounded-full border transition-colors ${
    actief
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:text-foreground"
  } ${uit ? "pointer-events-none opacity-40" : ""}`;
  if (naar) {
    return (
      <Link to={naar.to} search={naar.search} className={klassen} title={label} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={klassen} title={label} aria-label={label}>
      {children}
    </button>
  );
}

/** Wat `vakKnop` teruggeeft: de klik, de streek en de aanwijzer. */
type Knop = { className?: string } & Record<string, unknown>;

/** De kop van een subgroep die die dag compleet ingepland staat. */
function GroepKop({
  naam,
  erop,
  totaal,
  selecteren,
  knop,
}: {
  naam: string;
  erop: number;
  totaal: number;
  selecteren: boolean;
  knop: Knop;
}) {
  const { className, ...rest } = knop;
  return (
    <div
      {...rest}
      className={`mt-2 flex items-center gap-1.5 px-2 pb-0.5 text-[11.5px] text-muted-foreground ${className ?? ""}`}
    >
      {selecteren && (
        <Checkbox
          className="pointer-events-none size-3.5 shrink-0"
          checked={vinkStand(erop, totaal)}
          tabIndex={-1}
          aria-label={`Groep ${naam}`}
        />
      )}
      <Folder className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{naam}</span>
    </div>
  );
}

/** Eén straat met zijn huisnummers eronder. */
function StraatRij({
  straat,
  maand,
  regelVan,
  selecteren,
  keuze,
  vakKnop,
  onAdres,
}: {
  straat: Straat;
  maand: string;
  regelVan: Map<string | null, DagRegel>;
  selecteren: boolean;
  keuze: Set<string>;
  vakKnop: (vak: string) => Knop;
  /** Klikken buiten de selecteerstand opent het schermpje van dit adres. */
  onAdres: (keuze: { customer: Customer; straat: string }) => void;
}) {
  const erop = straat.klantIds.filter((id) => keuze.has(id)).length;
  const { className: kopKnop, ...kopRest } = vakKnop(`s:${straat.id}`);
  return (
    <div>
      {/* De straatnaam ligt als een strookje in de kaart: hij hoort erbij,
          maar hij is niet zelf een kaart. */}
      <div
        {...kopRest}
        style={vulStijl(erop, straat.klantIds.length)}
        className={`mt-1.5 flex items-center gap-2 rounded-[11px] bg-card-header px-2.5 py-1.5 ${kopKnop ?? ""}`}
      >
        {selecteren && (
          <Checkbox
            className="pointer-events-none size-3.5 shrink-0"
            checked={vinkStand(erop, straat.klantIds.length)}
            tabIndex={-1}
            aria-label={`Hele straat ${straat.naam}`}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium">{straat.naam}</h3>
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {straat.klanten.length}×
        </span>
        <span className="text-[12px] font-semibold tabular-nums">{formatPrice(straat.bedrag)}</span>
      </div>
      <ul className="mt-0.5">
        {straat.klanten.map((c) => {
          // De notitie zoals hij die maand geldt, dus inclusief het werk dat er
          // alleen in bepaalde maanden bij komt.
          const notitie = noteVoorMaand(c, maand);
          const regel = regelVan.get(c.id);
          // Wat er die dag anders ging gaat vóór de vaste notitie: dát is wat
          // je onderweg moet weten, en het bedrag ernaast hoort erbij.
          const anders = regel?.notitie?.trim() ?? "";
          const aangepast = anders !== "" || (regel && regel.prijs !== prijsVoorMaand(c, maand));
          const gekozen = keuze.has(c.id);
          const { className: rijKnop, ...rijRest } = selecteren
            ? vakKnop(`c:${c.id}`)
            : {
                onClick: () => onAdres({ customer: c, straat: straat.naam }),
                className: "cursor-pointer hover:bg-card-header",
              };
          return (
            <li
              key={c.id}
              {...rijRest}
              className={`flex items-center gap-2 rounded-[9px] px-2.5 py-[3px] text-[12.5px] ${rijKnop ?? ""} ${
                gekozen
                  ? "bg-accent text-accent-foreground"
                  : anders
                    ? "bg-tint-oranje text-tint-oranje-ink"
                    : ""
              }`}
            >
              {selecteren && (
                <Checkbox
                  className="pointer-events-none size-3.5 shrink-0"
                  checked={gekozen}
                  tabIndex={-1}
                  aria-label={`${straat.naam} ${formatNumber(c)}`}
                />
              )}
              <span className="w-9 shrink-0 font-medium tabular-nums">{formatNumber(c)}</span>
              <span
                className={`min-w-0 flex-1 truncate ${
                  anders ? "italic" : gekozen ? "" : "text-muted-foreground"
                }`}
              >
                {anders || notitie}
              </span>
              <span className={`shrink-0 tabular-nums ${aangepast ? "font-medium" : ""}`}>
                {formatPrice(regel?.prijs ?? c.price)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
