import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckSquare,
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
import { Button } from "@/components/ui/button";
import { VerplaatsNaarKnop } from "@/components/VerplaatsNaarKnop";
import { OverslaanKnop } from "@/components/OverslaanKnop";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStraatGroepen,
  fetchStreets,
  formatNumber,
  formatPrice,
  noteVoorMaand,
  sortCustomers,
  wijkKleur,
  type Customer,
} from "@/lib/klanten";
import { fetchWasdag, haalUitWasdag, toonDatum, vandaag, voegToeAanWasdag } from "@/lib/wasdag";
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
        backgroundImage: `linear-gradient(to right, var(--tint-amber) ${gevuld}%, transparent ${gevuld}%)`,
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
    const prijsVan = new Map(regels.map((r) => [r.customer_id, Number(r.prijs)]));

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

    return { wijken: wijkenUit, kwijt, prijsVan, idsVan };
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
      prijs: perWijk.prijsVan.get(id) ?? 0,
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

  /**
   * De aangevinkte adressen als adres en niet als id: overslaan werkt op het
   * adres zelf (zijn ritme), en heeft dus het hele ding nodig.
   */
  const gekozenAdressen = useMemo(
    () => (customersQuery.data ?? []).filter((c) => keuze.has(c.id)),
    [customersQuery.data, keuze],
  );

  async function doeUndo() {
    const label = await undoLaatste();
    if (label) toast.success("Teruggedraaid: " + label);
    else toast("Niets om terug te draaien");
  }

  return (
    <AppLayout
      titel={toonDatum(datum)}
      kruimel="Overzicht / Planning / Dag"
      onderschrift="Alles wat er deze dag te doen staat, straat voor straat."
      actiePositie="onder"
      acties={
        <>
          <Button
            size="sm"
            variant={selecteren ? "default" : "outline"}
            className="rounded-full"
            onClick={() => {
              setSelecteren((v) => !v);
              setKeuze(new Set());
              setKlusKeuze(new Set());
            }}
            disabled={teKiezen === 0}
            title="Aanvinken wat er niet af gekomen is, om het te verplaatsen"
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
          <Button size="sm" variant="outline" className="rounded-full" asChild>
            <Link to="/planning" search={{ dag: datum }}>
              <CalendarDays className="size-4" /> Naar de kalender
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="rounded-full" asChild>
            <Link to="/" search={{ dag: datum }}>
              <Euro className="size-4" /> Werk inplannen
            </Link>
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
          <Button size="sm" className="rounded-full" asChild disabled={regels.length === 0}>
            <Link
              to="/printen"
              search={{ wijk: "", maand, prijzen: false, liggend: true, dag: datum }}
            >
              <Printer className="size-4" /> Printlijst van deze dag
            </Link>
          </Button>
        </>
      }
      kop={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Adressen",
              waarde: String(regels.length),
              icon: Users,
              tegel: "bg-accent text-accent-foreground",
            },
            {
              label: "Straten",
              waarde: String(straten),
              icon: MapPin,
              tegel: "bg-tint-amber text-tint-amber-ink",
            },
            {
              label: "Opbrengst",
              waarde: formatPrice(bedrag),
              icon: Euro,
              tegel: "bg-tint-groen text-tint-groen-ink",
            },
          ].map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3"
            >
              <span className={`flex size-9 items-center justify-center rounded-full ${t.tegel}`}>
                <t.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-muted-foreground">
                  {t.label}
                </span>
                <span className="block font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">
                  {t.waarde}
                </span>
              </span>
            </div>
          ))}
        </div>
      }
    >
      {wasdagQuery.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Laden…</p>
      ) : regels.length === 0 && klussen.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border bg-card/50 p-8 text-center">
          <p className="font-display text-[17px] font-semibold">Nog niets op deze dag</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Vink in de wijken aan wat je gaat doen, of zet er met de rechtermuisknop op de kalender
            een hele wijk op.
          </p>
        </div>
      ) : (
        <div className="gap-3.5 md:columns-1 xl:columns-2">
          {perWijk.wijken.map((w) => {
            const eropWijk = w.klantIds.filter((id) => keuze.has(id)).length;
            const { className: wijkKnop, ...wijkRest } = vakKnop(`w:${w.id}`) as {
              className?: string;
            } & Record<string, unknown>;
            return (
              <section
                key={w.id}
                className="mb-3.5 break-inside-avoid-column overflow-hidden rounded-[14px] border border-border bg-card"
              >
                <div
                  {...wijkRest}
                  style={vulStijl(eropWijk, w.klantIds.length)}
                  className={`flex items-baseline gap-2 border-b border-border bg-card-header px-3 py-2 ${wijkKnop ?? ""}`}
                >
                  {selecteren && (
                    <Checkbox
                      className="pointer-events-none size-3.5 shrink-0 translate-y-[2px]"
                      checked={vinkStand(eropWijk, w.klantIds.length)}
                      tabIndex={-1}
                      aria-label={`Hele wijk ${w.naam}`}
                    />
                  )}
                  <span
                    className="size-2.5 shrink-0 translate-y-[-1px] rounded-full"
                    style={{ background: w.kleur }}
                  />
                  <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                    {w.naam}
                  </h2>
                  <span className="text-[12px] text-muted-foreground">{w.aantal}×</span>
                  <span className="text-[13px] font-semibold tabular-nums">
                    {formatPrice(w.bedrag)}
                  </span>
                </div>

                {w.blokken.map((b) =>
                  b.soort === "groep" ? (
                    <div key={`g:${b.id}`} className="border-b border-border/60 last:border-b-0">
                      {/* Deze groep staat er compleet op, dus je verzet hem in
                          één klik — zoals je hem ook in één klik ingepland hebt. */}
                      <GroepKop
                        naam={b.naam}
                        bedrag={b.straten.reduce((sum, s) => sum + s.bedrag, 0)}
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
                          prijsVan={perWijk.prijsVan}
                          selecteren={selecteren}
                          keuze={keuze}
                          vakKnop={vakKnop}
                          inspringen
                        />
                      ))}
                    </div>
                  ) : (
                    <div key={`s:${b.id}`} className="border-b border-border/60 last:border-b-0">
                      <StraatRij
                        straat={b.straat}
                        maand={maand}
                        prijsVan={perWijk.prijsVan}
                        selecteren={selecteren}
                        keuze={keuze}
                        vakKnop={vakKnop}
                      />
                    </div>
                  ),
                )}
              </section>
            );
          })}

          {/* Extra werk dat niet aan een maand vastzit. Onderaan, want het
              hoort niet bij de ronde van een straat — je pikt het mee als je
              er toch bent. Afvinken doe je hier: gebeurt dat niet, dan is hij
              morgen weer van deze dag af en wacht hij op de planning. */}
          {klussen.length > 0 && (
            <section className="mb-3.5 break-inside-avoid-column overflow-hidden rounded-[14px] border border-border bg-card">
              <div className="flex items-baseline gap-2 border-b border-border bg-card-header px-3 py-2">
                <Hammer className="size-3.5 shrink-0 translate-y-[2px] text-muted-foreground" />
                <h2 className="min-w-0 flex-1 truncate font-display text-[14.5px] font-semibold">
                  Extra opdrachten
                </h2>
                <span className="tabular-nums text-[12.5px] text-muted-foreground">
                  {formatPrice(klussen.reduce((sum, k) => sum + k.prijs, 0))}
                </span>
              </div>
              <ul className="py-1.5">
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
                      className={`flex items-center gap-2 px-3 py-[3px] text-[13px] ${klusKnop ?? ""} ${klusKeuze.has(k.id) ? "bg-tint-amber" : ""}`}
                    >
                      {selecteren && (
                        <Checkbox
                          className="pointer-events-none size-3.5 shrink-0"
                          checked={klusKeuze.has(k.id)}
                          disabled={!!k.gedaan_op}
                          tabIndex={-1}
                          aria-label={`${k.omschrijving} selecteren`}
                        />
                      )}
                      {/* Afvinken blijft afvinken, ook in de selecteerstand:
                          dat vakje mag niet in de klik van de regel opgaan. */}
                      <span
                        className="flex shrink-0 items-center"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          className="size-3.5"
                          checked={!!k.gedaan_op}
                          onCheckedChange={(v) => void vinkAf(k, v === true)}
                          aria-label={`${k.omschrijving} gedaan`}
                        />
                      </span>
                      <span className="w-24 shrink-0 truncate font-medium">{adresVan(k)}</span>
                      <span
                        className={`min-w-0 flex-1 truncate ${k.gedaan_op ? "text-muted-foreground line-through" : "text-muted-foreground"}`}
                      >
                        {k.omschrijving}
                      </span>
                      <span className="tabular-nums">{formatPrice(k.prijs)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {perWijk.kwijt > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {perWijk.kwijt} {perWijk.kwijt === 1 ? "adres is" : "adressen zijn"} intussen
              verwijderd; ze tellen wel mee in het bedrag.
            </p>
          )}
        </div>
      )}
    </AppLayout>
  );
}

/** Wat `vakKnop` teruggeeft: de klik, de streek en de aanwijzer. */
type Knop = { className?: string } & Record<string, unknown>;

/** De kop van een subgroep die die dag compleet ingepland staat. */
function GroepKop({
  naam,
  bedrag,
  erop,
  totaal,
  selecteren,
  knop,
}: {
  naam: string;
  bedrag: number;
  erop: number;
  totaal: number;
  selecteren: boolean;
  knop: Knop;
}) {
  const { className, ...rest } = knop;
  return (
    <div
      {...rest}
      style={vulStijl(erop, totaal)}
      className={`flex items-baseline gap-2 bg-muted/40 px-3 py-1.5 ${className ?? ""}`}
    >
      {selecteren && (
        <Checkbox
          className="pointer-events-none size-3.5 shrink-0 translate-y-[2px]"
          checked={vinkStand(erop, totaal)}
          tabIndex={-1}
          aria-label={`Groep ${naam}`}
        />
      )}
      <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{naam}</h3>
      <span className="text-[12px] tabular-nums text-muted-foreground">{formatPrice(bedrag)}</span>
    </div>
  );
}

/** Eén straat met zijn huisnummers eronder. */
function StraatRij({
  straat,
  maand,
  prijsVan,
  selecteren,
  keuze,
  vakKnop,
  inspringen = false,
}: {
  straat: Straat;
  maand: string;
  prijsVan: Map<string | null, number>;
  selecteren: boolean;
  keuze: Set<string>;
  vakKnop: (vak: string) => Knop;
  /** Staat hij onder een groepskop? Dan een streepje naar binnen. */
  inspringen?: boolean;
}) {
  const erop = straat.klantIds.filter((id) => keuze.has(id)).length;
  const { className: kopKnop, ...kopRest } = vakKnop(`s:${straat.id}`);
  return (
    <div className={inspringen ? "pl-3" : undefined}>
      <div
        {...kopRest}
        style={vulStijl(erop, straat.klantIds.length)}
        className={`flex items-baseline gap-2 px-3 pb-1 pt-2 ${kopKnop ?? ""}`}
      >
        {selecteren && (
          <Checkbox
            className="pointer-events-none size-3.5 shrink-0 translate-y-[2px]"
            checked={vinkStand(erop, straat.klantIds.length)}
            tabIndex={-1}
            aria-label={`Hele straat ${straat.naam}`}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {straat.naam}
        </h3>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {formatPrice(straat.bedrag)}
        </span>
      </div>
      <ul className="pb-2">
        {straat.klanten.map((c) => {
          // De notitie zoals hij die maand geldt, dus inclusief het werk dat er
          // alleen in bepaalde maanden bij komt.
          const notitie = noteVoorMaand(c, maand);
          const { className: rijKnop, ...rijRest } = vakKnop(`c:${c.id}`);
          return (
            <li
              key={c.id}
              {...rijRest}
              className={`flex items-baseline gap-2 px-3 py-[2px] text-[13px] ${rijKnop ?? ""} ${keuze.has(c.id) ? "bg-tint-amber" : ""}`}
            >
              {selecteren && (
                <Checkbox
                  className="pointer-events-none size-3.5 shrink-0 translate-y-[1px]"
                  checked={keuze.has(c.id)}
                  tabIndex={-1}
                  aria-label={`${straat.naam} ${formatNumber(c)}`}
                />
              )}
              <span className="w-10 shrink-0 font-medium tabular-nums">{formatNumber(c)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{notitie}</span>
              <span className="tabular-nums">{formatPrice(prijsVan.get(c.id) ?? c.price)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
