import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { requireSession, useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, Eye, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import { AppLayout } from "@/components/AppLayout";
import { InlineCel } from "@/components/InlineCel";
import { NotitieCel } from "@/components/NotitieCel";
import {
  addDistrict,
  addQuickNote,
  fetchCustomers,
  fetchDistricts,
  fetchQuickNotes,
  fetchStreets,
  frequencyLabels,
  formatPrice,
  noteTokens,
  persistPostcodes,
  persistVolledigeNamen,
  renameDistrict,
  type District,
  type Frequency,
  type QuickNote,
} from "@/lib/klanten";
import {
  haalPostcodesOp,
  haalStraatnamenOp,
  stratenZonderNaam,
  stratenZonderPostcode,
} from "@/lib/aanvullen";
import { zoekWoonplaatsen } from "@/lib/postcode";


export const Route = createFileRoute("/importeren")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({
    meta: [
      { title: "Excel importeren — klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Zet je bestaande Excel-lijst met straten, huisnummers, notities en prijzen om in de app.",
      },
      { property: "og:title", content: "Excel importeren" },
      { property: "og:description", content: "Straten, huisnummers, notities en prijzen uit Excel inlezen." },
    ],
  }),
  component: ImportPagina,
});

interface RijPreview {
  tabblad: string;
  straat: string;
  huisnummer: number;
  toevoeging: string;
  notitie: string;
  prijs: number;
  bron?: { tabblad: string; rij: number; kolom: number };
}


function parseNummer(value: unknown): { nummer: number; toevoeging: string; markering: string } | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { nummer: Math.trunc(value), toevoeging: "", markering: "" };
  }
  if (typeof value === "string") {
    // Ook "61!!", "61 *", "12a!" tellen als huisnummer; de tekens erna zijn een markering.
    const match = value.trim().match(/^(\d+)\s*([a-zA-Z-]*)\s*([!*?+]*)$/);
    if (match) {
      return {
        nummer: parseInt(match[1]!, 10),
        toevoeging: (match[2] ?? "").trim(),
        markering: (match[3] ?? "").trim(),
      };
    }
  }
  return null;
}


function raadFrequentie(tabblad: string): Frequency {
  const naam = tabblad.toLowerCase();
  if (naam.includes("oneven")) return "oneven";
  if (naam.includes("even")) return "even";
  return "elke";
}

/** Grijs = straatkop. Roze/blauw/geel e.d. worden genegeerd. */
function isGrijs(cell: XLSX.CellObject | undefined): boolean {
  const style = (cell as { s?: { patternType?: string; fgColor?: { rgb?: string } } } | undefined)?.s;
  if (!style || !style.patternType || style.patternType === "none") return false;
  const rgb = style.fgColor?.rgb;
  if (!rgb) return false;
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min > 24) return false; // gekleurd, geen grijs
  return max < 246 && max > 24; // niet wit, niet zwart
}

function tekst(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  return String(cell.v).trim();
}

/** Weergavetekst zoals Excel het toont (inclusief opmaak zoals € en decimalen). */
function weergave(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  const w = (cell as { w?: string }).w;
  if (w !== undefined) return String(w).trim();
  return tekst(cell);
}

interface CelStijl {
  patternType?: string;
  fgColor?: { rgb?: string };
  font?: { color?: { rgb?: string }; bold?: boolean; sz?: number };
  alignment?: { horizontal?: string };
}

function hex6(rgb?: string): string | undefined {
  if (!rgb) return undefined;
  const hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  return hex.length === 6 ? `#${hex}` : undefined;
}

/**
 * Leest een tabblad met één of meerdere naast elkaar staande tabellen.
 * Elk blok: kolom met huisnummers (grijze straatkop erboven), daarnaast notitie en prijs.
 */
interface Bron {
  tabblad: string;
  rij: number;
  kolom: number;
}

interface GridCel {
  t: string;
  vul?: string;
  kleur?: string;
  vet?: boolean;
  rechts?: boolean;
  grijs?: boolean;
}

interface SheetGrid {
  cellen: GridCel[][];
  breedtes: number[];
}

function leesTabblad(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): { rijen: RijPreview[]; bronnen: Record<string, Bron>; grid: SheetGrid } {
  const leeg: SheetGrid = { cellen: [], breedtes: [] };
  const ref = sheet["!ref"];
  if (!ref) return { rijen: [], bronnen: {}, grid: leeg };
  const range = XLSX.utils.decode_range(ref);
  const cel = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // Volledige weergave van het tabblad (om later te kunnen "bekijken in origineel")
  const kolInfo = (sheet["!cols"] ?? []) as { wch?: number; width?: number }[];
  const grid: SheetGrid = {
    cellen: [],
    breedtes: Array.from(
      { length: range.e.c + 1 },
      (_, c) => Math.round((kolInfo[c]?.wch ?? kolInfo[c]?.width ?? 9) * 7.5),
    ),
  };
  for (let r = 0; r <= range.e.r; r++) {
    const rij: GridCel[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = cel(r, c);
      const s = (cell as { s?: CelStijl } | undefined)?.s;
      const vul = s?.patternType && s.patternType !== "none" ? hex6(s.fgColor?.rgb) : undefined;
      const item: GridCel = { t: weergave(cell) };
      if (vul) item.vul = vul;
      const kleur = hex6(s?.font?.color?.rgb);
      if (kleur) item.kleur = kleur;
      if (s?.font?.bold) item.vet = true;
      if (s?.alignment?.horizontal === "right" || typeof cell?.v === "number") item.rechts = true;
      if (isGrijs(cell)) item.grijs = true;
      rij.push(item);
    }
    grid.cellen.push(rij);
  }


  // Kolommen waar een grijze straatkop in staat
  const kopKolommen = new Set<number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = cel(r, c);
      if (cell && tekst(cell) && !parseNummer(cell.v) && isGrijs(cell)) {
        kopKolommen.add(c);
        break;
      }
    }
  }
  // Terugval: geen kleuren gevonden → eerste kolom met tekst + nummers
  const kolommen =
    kopKolommen.size > 0
      ? [...kopKolommen].sort((a, b) => a - b)
      : [range.s.c];

  const rijen: RijPreview[] = [];
  const bronnen: Record<string, Bron> = {};

  /** Telt hoeveel huisnummers er direct onder deze rij staan (tot de volgende tekstcel). */
  const nummersHieronder = (vanaf: number, c: number) => {
    let aantal = 0;
    for (let r = vanaf + 1; r <= range.e.r; r++) {
      const v = cel(r, c)?.v;
      if (v === undefined || v === null || String(v).trim() === "") continue;
      if (parseNummer(v)) aantal++;
      else break;
    }
    return aantal;
  };

  for (const c of kolommen) {
    let straat = "";
    let laatste: RijPreview | null = null;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = cel(r, c);
      const waarde = cell?.v;
      if (waarde === undefined || waarde === null || String(waarde).trim() === "") continue;
      const nummer = parseNummer(waarde);
      if (!nummer) {
        const volgt = nummersHieronder(r, c);
        const grijsBekend = kopKolommen.size > 0;
        // Straatkop: als het bestand grijze koppen heeft, telt alleen grijs.
        // Anders vallen we terug op "er beginnen hieronder huisnummers".
        const isKop = grijsBekend
          ? isGrijs(cell)
          : volgt >= 1 || !laatste;

        if (isKop) {
          straat = String(waarde).trim();
          laatste = null;
          if (!bronnen[straat]) bronnen[straat] = { tabblad: sheetName, rij: r, kolom: c };
        } else if (laatste) {
          // Tekst onder een huisnummer = vervolg van de notitie van dat adres
          const extra = String(waarde).trim();
          laatste.notitie = laatste.notitie ? `${laatste.notitie} ${extra}` : extra;
        }

        continue;
      }
      if (!straat) continue;
      const prijsCel = cel(r, c + 2)?.v;
      const basisNotitie = tekst(cel(r, c + 1));
      const rij: RijPreview = {
        tabblad: sheetName,
        straat,
        huisnummer: nummer.nummer,
        toevoeging: nummer.toevoeging,
        notitie: nummer.markering
          ? basisNotitie
            ? `${nummer.markering} ${basisNotitie}`
            : nummer.markering
          : basisNotitie,
        prijs:
          typeof prijsCel === "number" ? prijsCel : Number(String(prijsCel ?? "").replace(",", ".")) || 0,
        bron: { tabblad: sheetName, rij: r, kolom: c },
      };

      rijen.push(rij);
      laatste = rij;
    }
  }


  return { rijen, bronnen, grid };
}



interface ImportRij {
  id: string;
  straat: string;
  huisnummer: number;
  toevoeging: string;
  notitie: string;
  /** Werk dat alleen in de even maand meegaat — de serre, bijvoorbeeld. */
  notitieEven: string;
  notitieOneven: string;
  prijs: number;
  frequency: Frequency;
  bron?: Bron | undefined;
  bronnen: Bron[];
}

/**
 * Verdeelt de notities van een adres dat in meerdere tabbladen staat over de
 * drie velden: wat in beide maanden staat geldt altijd, de rest hoort bij de
 * maand waar het vandaan komt. Zo blijft "elke maand, maar in de even maand
 * ook de serre" overeind in plaats van "T / serre" te worden.
 *
 * Splitsen doen we alleen als er écht een even- én een oneven-tabblad is.
 * Twee tabellen naast elkaar op hetzelfde tabblad zijn dezelfde maand.
 */
function verdeelNotities(delen: { freq: Frequency; notitie: string }[]): {
  notitie: string;
  notitieEven: string;
  notitieOneven: string;
} {
  const alles = (freq: Frequency | "alle") =>
    delen.filter((d) => freq === "alle" || d.freq === freq).flatMap((d) => noteTokens(d.notitie));

  const splitsen = delen.some((d) => d.freq === "even") && delen.some((d) => d.freq === "oneven");
  if (!splitsen) {
    return { notitie: uniek(alles("alle")).join(", "), notitieEven: "", notitieOneven: "" };
  }

  const even = alles("even");
  const oneven = alles("oneven");
  const elke = alles("elke");
  const inBeide = (t: string, lijst: string[]) =>
    lijst.some((x) => x.toLowerCase() === t.toLowerCase());

  return {
    // Wat in beide maanden staat — plus alles uit een "elke maand"-tabblad.
    notitie: uniek([...even.filter((t) => inBeide(t, oneven)), ...elke]).join(", "),
    notitieEven: uniek(even.filter((t) => !inBeide(t, oneven))).join(", "),
    notitieOneven: uniek(oneven.filter((t) => !inBeide(t, even))).join(", "),
  };
}

/** Dubbele labels eruit, hoofdletterongevoelig, in de volgorde van binnenkomst. */
function uniek(tokens: string[]): string[] {
  const uit: string[] = [];
  for (const t of tokens) {
    if (!uit.some((u) => u.toLowerCase() === t.toLowerCase())) uit.push(t);
  }
  return uit;
}

/** Staat dit adres in twee tabbladen én is er een notitie? Dan is die tekst
 *  uit twee maanden samengeraapt, of stond hij maar in één van de twee. */
function uitTweeMaanden(r: ImportRij): boolean {
  const iets = (r.notitie + r.notitieEven + r.notitieOneven).trim().length > 0;
  return r.bronnen.length > 1 && iets;
}

/** Wat er na het importeren automatisch is opgezocht. */
interface NaImport {
  stap: "straten" | "postcodes" | "klaar";
  districtId: string;
  gedaan: number;
  totaal: number;
  /** Straatnamen die eenduidig waren en dus meteen ingevuld zijn. */
  straatnamen: number;
  /** Straten met meerdere kandidaten: die moet je zelf nakijken. */
  twijfel: number;
  postcodes: number;
  /** De adressendienst hield ermee op. */
  afgebroken: boolean;
}

/** Straatnamen die waarschijnlijk per ongeluk als straat zijn gelezen. */
function verdachteStraten(lijst: ImportRij[], quickNotes: QuickNote[]) {
  const perStraat = new Map<string, number>();
  for (const r of lijst) perStraat.set(r.straat, (perStraat.get(r.straat) ?? 0) + 1);
  const notities = new Set(quickNotes.map((q) => q.label.toLowerCase()));
  const uitkomst: { straat: string; aantal: number; redenen: string[] }[] = [];
  for (const [straat, aantal] of perStraat) {
    const redenen: string[] = [];
    const schoon = straat.trim();
    if (schoon.length < 3) redenen.push("erg korte naam");
    if (!/[a-zA-Z]{3}/.test(schoon)) redenen.push("bevat nauwelijks letters");
    if (/^[^a-zA-Z]+$/.test(schoon)) redenen.push("alleen cijfers of tekens");
    if (notities.has(schoon.toLowerCase())) redenen.push("lijkt op een notitie");
    if (aantal <= 2) redenen.push(`maar ${aantal} ${aantal === 1 ? "adres" : "adressen"} eronder`);
    if (redenen.length > 0) uitkomst.push({ straat, aantal, redenen: [...new Set(redenen)] });
  }
  return uitkomst;
}

function ImportPagina() {
  useRequireAuth();
  const navigate = useNavigate();
  const [rijen, setRijen] = useState<RijPreview[]>([]);
  const [lijst, setLijst] = useState<ImportRij[]>([]);
  const [bestandsnaam, setBestandsnaam] = useState("");
  const [freqPerTabblad, setFreqPerTabblad] = useState<Record<string, Frequency>>({});
  const [skipTabbladen, setSkipTabbladen] = useState<Set<string>>(new Set());
  const [bezig, setBezig] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [wijken, setWijken] = useState<District[]>([]);
  const [wijkId, setWijkId] = useState<string>("");
  const [nieuweWijk, setNieuweWijk] = useState("");
  // Zonder woonplaats is geen postcode op te zoeken, dus die vragen we hier
  // meteen — een wijknaam als "Madestein" zegt niets over de plaats.
  const [plaats, setPlaats] = useState("");
  const [plaatsOpties, setPlaatsOpties] = useState<string[]>([]);
  const [naImport, setNaImport] = useState<NaImport | null>(null);
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [hernoemen, setHernoemen] = useState<Record<string, string>>({});
  const [bronnen, setBronnen] = useState<Record<string, Bron>>({});
  const [grids, setGrids] = useState<Record<string, SheetGrid>>({});
  const [goedgekeurd, setGoedgekeurd] = useState<Set<string>>(new Set());
  const [bekijk, setBekijk] = useState<{ label: string; bronnen: Bron[] } | null>(null);

  const gekozenWijk = wijken.find((w) => w.id === wijkId) ?? null;
  // De plaats van de gekozen wijk als die er al is; anders wat je hier typt.
  const werkPlaats = (gekozenWijk?.plaats.trim() || plaats.trim()).trim();
  // Vragen we de plaats? Bij een nieuwe wijk altijd, bij een bestaande alleen
  // als hij er nog geen heeft.
  const plaatsVragen =
    wijkId === "__nieuw__" || (gekozenWijk !== null && !gekozenWijk.plaats.trim());

  // Woonplaatsen voorstellen terwijl je typt, zodat de naam precies zo
  // geschreven staat als de adressendienst hem kent.
  useEffect(() => {
    if (!plaatsVragen || plaats.trim().length < 2) {
      setPlaatsOpties([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekWoonplaatsen(plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setPlaatsOpties(namen);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [plaats, plaatsVragen]);

  useEffect(() => {
    fetchDistricts()
      .then((d) => {
        setWijken(d);
        setWijkId((huidig) => huidig || "__geen__");
      })
      .catch(() => toast.error("Wijken laden mislukt"));
    fetchQuickNotes().then(setQuickNotes).catch(() => undefined);
  }, []);

  const tabbladen = useMemo(() => [...new Set(rijen.map((r) => r.tabblad))], [rijen]);
  const straten = useMemo(() => [...new Set(lijst.map((r) => r.straat))], [lijst]);
  const verdacht = useMemo(
    () => verdachteStraten(lijst, quickNotes).filter((v) => !goedgekeurd.has(v.straat)),
    [lijst, quickNotes, goedgekeurd],
  );


  /**
   * Adressen uit meer dan één tabblad mét een notitie: die tekst komt uit
   * twee maanden, of stond maar in één van de twee. Staat er in geen van
   * beide iets, dan valt er ook niets na te kijken.
   */
  const samengevoegd = useMemo(() => lijst.filter(uitTweeMaanden).length, [lijst]);

  /** Adressen die in meerdere tabbladen staan worden samengevoegd tot "elke maand". */
  useEffect(() => {
    type Verzamel = { rij: ImportRij; delen: { freq: Frequency; notitie: string }[] };
    const map = new Map<string, Verzamel>();

    for (const r of rijen) {
      if (skipTabbladen.has(r.tabblad)) continue;
      const sleutel = `${r.straat.toLowerCase()}|${r.huisnummer}|${r.toevoeging.toLowerCase()}`;
      const freq = freqPerTabblad[r.tabblad] ?? "elke";
      const bestaand = map.get(sleutel);

      if (!bestaand) {
        map.set(sleutel, {
          rij: {
            id: sleutel,
            straat: r.straat,
            huisnummer: r.huisnummer,
            toevoeging: r.toevoeging,
            notitie: r.notitie,
            notitieEven: "",
            notitieOneven: "",
            prijs: r.prijs,
            frequency: freq,
            bron: r.bron,
            bronnen: r.bron ? [r.bron] : [],
          },
          delen: [{ freq, notitie: r.notitie }],
        });
        continue;
      }

      bestaand.delen.push({ freq, notitie: r.notitie });
      bestaand.rij = {
        ...bestaand.rij,
        bronnen:
          r.bron && !bestaand.rij.bronnen.some((b) => b.tabblad === r.bron!.tabblad)
            ? [...bestaand.rij.bronnen, r.bron]
            : bestaand.rij.bronnen,
        // Hoogste prijs winnen: een verhoging staat meestal maar in één tabblad.
        prijs: Math.max(bestaand.rij.prijs, r.prijs),
        frequency: bestaand.rij.frequency !== freq ? "elke" : bestaand.rij.frequency,
      };
    }

    setLijst([...map.values()].map(({ rij, delen }) => ({ ...rij, ...verdeelNotities(delen) })));
    setHernoemen({});
  }, [rijen, freqPerTabblad, skipTabbladen]);

  function wijzig(id: string, patch: Partial<ImportRij>) {
    setLijst((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function verwijderRij(id: string) {
    setLijst((l) => l.filter((r) => r.id !== id));
  }

  function verwijderStraat(straat: string) {
    setLijst((l) => l.filter((r) => r.straat !== straat));
  }

  function hernoemStraat(oud: string, nieuw: string) {
    const naam = nieuw.trim();
    if (!naam) return;
    setLijst((l) => l.map((r) => (r.straat === oud ? { ...r, straat: naam } : r)));
    setHernoemen((h) => ({ ...h, [oud]: "" }));
    toast.success(`"${oud}" heet nu "${naam}"`);
  }

  async function nieuweSnelkeuze(label: string) {
    try {
      await addQuickNote(label);
      setQuickNotes(await fetchQuickNotes());
    } catch {
      toast.error("Snelkeuze toevoegen mislukt");
    }
  }

  async function lees(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellStyles: true });
      const gevonden: RijPreview[] = [];
      const freq: Record<string, Frequency> = {};
      const alleBronnen: Record<string, Bron> = {};
      const alleGrids: Record<string, SheetGrid> = {};
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        freq[sheetName] = raadFrequentie(sheetName);
        const res = leesTabblad(sheet, sheetName);
        gevonden.push(...res.rijen);
        alleGrids[sheetName] = res.grid;
        for (const [naam, bron] of Object.entries(res.bronnen)) {
          if (!alleBronnen[naam]) alleBronnen[naam] = bron;
        }
      }
      setBestandsnaam(file.name);
      setFreqPerTabblad(freq);
      setBronnen(alleBronnen);
      setGrids(alleGrids);
      setGoedgekeurd(new Set());
      setRijen(gevonden);
      if (gevonden.length === 0) toast.error("Geen klanten herkend in dit bestand.");

    } catch (e) {
      toast.error("Bestand kon niet gelezen worden.");
      console.error(e);
    }
  }


  /**
   * Zoekt na het importeren meteen de officiële straatnamen en de postcodes
   * op. Alleen straten met precies één treffer worden vanzelf ingevuld: de
   * naamzoekopdracht is fuzzy, en een gok opslaan levert straks een
   * verkeerde postcode op. De rest laten we staan om na te kijken.
   */
  async function vulAan(districtId: string, woonplaats: string) {
    const straten = (await fetchStreets()).filter((s) => s.district_id === districtId);
    const teDoen = stratenZonderNaam(straten);
    setNaImport({
      stap: "straten",
      districtId,
      gedaan: 0,
      totaal: teDoen.length,
      straatnamen: 0,
      twijfel: 0,
      postcodes: 0,
      afgebroken: false,
    });

    let afgebroken = false;
    let zeker: { id: string; volledige_naam: string }[] = [];
    let twijfel = 0;

    if (teDoen.length > 0) {
      const uitkomst = await haalStraatnamenOp(teDoen, woonplaats, (v) =>
        setNaImport((n) => (n ? { ...n, gedaan: v.gedaan, totaal: v.totaal } : n)),
      );
      afgebroken = uitkomst.afgebroken;
      zeker = uitkomst.voorstellen
        .filter((v) => v.aan && v.waarde.trim())
        .map((v) => ({ id: v.street.id, volledige_naam: v.waarde.trim() }));
      twijfel = uitkomst.voorstellen.filter((v) => !v.aan).length;
      if (zeker.length > 0) await persistVolledigeNamen(zeker);
    }

    // De namen die we net opgeslagen hebben meteen meenemen, anders slaat de
    // postcode-ronde precies de straten over die we net compleet maakten.
    const bijgewerkt = straten.map((s) => {
      const nieuw = zeker.find((z) => z.id === s.id);
      return nieuw ? { ...s, volledige_naam: nieuw.volledige_naam } : s;
    });
    const adressen = (await fetchCustomers()).filter((c) =>
      bijgewerkt.some((s) => s.id === c.street_id),
    );
    const metNaam = stratenZonderPostcode(bijgewerkt, adressen);

    setNaImport((n) =>
      n
        ? {
            ...n,
            stap: "postcodes",
            gedaan: 0,
            totaal: metNaam.length,
            straatnamen: zeker.length,
            twijfel,
            afgebroken,
          }
        : n,
    );

    let postcodes = 0;
    if (!afgebroken && metNaam.length > 0) {
      const uitkomst = await haalPostcodesOp(metNaam, adressen, woonplaats, (v) =>
        setNaImport((n) => (n ? { ...n, gedaan: v.gedaan, totaal: v.totaal } : n)),
      );
      afgebroken = uitkomst.afgebroken;
      postcodes = uitkomst.wijzigingen.length;
      if (postcodes > 0) await persistPostcodes(uitkomst.wijzigingen);
    }

    setNaImport((n) => (n ? { ...n, stap: "klaar", postcodes, afgebroken } : n));
  }

  async function importeer() {
    if (lijst.length === 0) return;
    setBezig(true);
    try {
      let districtId = wijkId;
      if (districtId === "__geen__") {
        const { data: bestaand } = await supabase
          .from("districts")
          .select("id")
          .eq("name", "Geen wijk")
          .single();
        if (bestaand) {
          districtId = bestaand.id;
        } else {
          const { data: nieuw, error: wijkFout } = await supabase
            .from("districts")
            .insert({ name: "Geen wijk", sort_order: 0 })
            .select("id")
            .single();
          if (wijkFout) throw wijkFout;
          districtId = nieuw!.id;
        }
      } else if (districtId === "__nieuw__") {
        if (!nieuweWijk.trim()) throw new Error("Vul een naam voor de nieuwe wijk in.");
        const wijk = await addDistrict(nieuweWijk.trim(), plaats.trim());
        districtId = wijk.id;
      } else if (gekozenWijk && !gekozenWijk.plaats.trim() && plaats.trim()) {
        // Bestaande wijk die nog geen plaats had: die vullen we hier meteen,
        // anders is het aanvullen hierna kansloos.
        await renameDistrict(gekozenWijk.id, gekozenWijk.name, plaats.trim());
      }
      if (!districtId) throw new Error("Kies eerst een wijk.");

      const { data: bestaandeStraten, error: straatFout } = await supabase
        .from("streets")
        .select("id,name")
        .eq("district_id", districtId);
      if (straatFout) throw straatFout;
      const map = new Map<string, string>();
      (bestaandeStraten ?? []).forEach((s) => map.set(s.name.toLowerCase(), s.id));

      const nieuweNamen = straten.filter((n) => !map.has(n.toLowerCase()));
      if (nieuweNamen.length > 0) {
        const startOrder = map.size;
        const { data: nieuw, error } = await supabase
          .from("streets")
          .insert(nieuweNamen.map((name, i) => ({ name, sort_order: startOrder + i, district_id: districtId! })))
          .select("id,name");
        if (error) throw error;
        (nieuw ?? []).forEach((s) => map.set(s.name.toLowerCase(), s.id));
      }


      const payload = lijst.map((r) => ({
        street_id: map.get(r.straat.toLowerCase())!,
        house_number: r.huisnummer,
        addition: r.toevoeging,
        note: r.notitie,
        note_even: r.notitieEven,
        note_oneven: r.notitieOneven,
        price: r.prijs,
        frequency: r.frequency,
      }));
      const { error } = await supabase.from("customers").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} klanten geïmporteerd`);

      if (!werkPlaats) {
        // Zonder plaats valt er niets op te zoeken; dan is het klaar.
        navigate({ to: "/" });
        return;
      }
      await vulAan(districtId, werkPlaats);
    } catch (e) {
      toast.error("Importeren mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }


  return (
    <AppLayout titel="Importeren" onderschrift="Klanten uit een Excel-bestand inlezen">
      <div className="space-y-6">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <Label>In welke wijk komt dit bestand?</Label>
          <Select value={wijkId} onValueChange={setWijkId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Kies een wijk" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__geen__">Geen wijk</SelectItem>
              {wijken.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
              <SelectItem value="__nieuw__">+ Nieuwe wijk…</SelectItem>
            </SelectContent>
          </Select>
          {wijkId === "__nieuw__" && (
            <Input
              className="max-w-sm"
              placeholder="Naam van de nieuwe wijk"
              value={nieuweWijk}
              onChange={(e) => setNieuweWijk(e.target.value)}
            />
          )}
          {plaatsVragen && (
            <div className="max-w-sm space-y-1.5">
              <Input
                list="import-plaats-opties"
                placeholder="In welke plaats ligt deze wijk?"
                value={plaats}
                onChange={(e) => setPlaats(e.target.value)}
              />
              <datalist id="import-plaats-opties">
                {plaatsOpties.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Hiermee zoeken we na het importeren de straatnamen en postcodes op. Laat je hem
                leeg, dan kan dat later alsnog vanaf de wijkenpagina.
              </p>
            </div>
          )}
          {!plaatsVragen && gekozenWijk && (
            <p className="text-xs text-muted-foreground">
              Deze wijk ligt in {gekozenWijk.plaats}. Na het importeren zoeken we de straatnamen en
              postcodes erbij.
            </p>
          )}
        </div>

        <div
          className={`space-y-2 rounded-lg border-2 border-dashed p-4 transition-colors ${
            sleep ? "border-primary bg-accent/50" : "border-border bg-card"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setSleep(true);
          }}
          onDragLeave={() => setSleep(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSleep(false);
            const file = e.dataTransfer.files?.[0];
            if (!file) return;
            if (!/\.xlsx?$/i.test(file.name)) {
              toast.error("Sleep een Excel-bestand (.xlsx of .xls) hierheen.");
              return;
            }
            void lees(file);
          }}
        >
          <Label htmlFor="bestand">Kies je Excel-bestand (.xlsx) of sleep het hierheen</Label>
          <Input
            id="bestand"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void lees(file);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Straatnamen herkent hij aan de grijze vakjes; andere kleuren (zoals roze) worden genegeerd.
            Onder een straatnaam staan de huisnummers, met daarnaast de notitie en de prijs. Meerdere
            tabellen naast elkaar op één tabblad worden allemaal ingelezen. Staat een adres in beide
            tabbladen, dan wordt het automatisch "elke maand".
          </p>

        </div>


        {lijst.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm">
                <span className="font-medium">{bestandsnaam}</span> — {lijst.length} klanten in{" "}
                {straten.length} {straten.length === 1 ? "straat" : "straten"}
                {skipTabbladen.size > 0 && `, ${skipTabbladen.size} tabblad${skipTabbladen.size === 1 ? "" : "en"} overgeslagen`}
                {rijen.length !== lijst.length && skipTabbladen.size === 0
                  ? ` (${rijen.length - lijst.length} regels samengevoegd of verwijderd)`
                  : ""}
                .
              </p>
              <div className="mt-4 space-y-3">
                <Label>Frequentie per tabblad</Label>
                {tabbladen.map((t) => {
                  const skipped = skipTabbladen.has(t);
                  return (
                    <div key={t} className="flex items-center gap-3">
                      <span className={`w-40 truncate text-sm ${skipped ? "text-muted-foreground line-through" : "text-foreground"}`}>
                        {t}
                      </span>
                      <Select
                        value={freqPerTabblad[t] ?? "elke"}
                        disabled={skipped}
                        onValueChange={(v) =>
                          setFreqPerTabblad((s) => ({ ...s, [t]: v as Frequency }))
                        }
                      >
                        <SelectTrigger className="max-w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(frequencyLabels) as Frequency[]).map((f) => (
                            <SelectItem key={f} value={f}>
                              {frequencyLabels[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`skip-${t}`}
                          checked={skipped}
                          onCheckedChange={(checked) => {
                            setSkipTabbladen((s) => {
                              const next = new Set(s);
                              if (checked) next.add(t);
                              else next.delete(t);
                              return next;
                            });
                          }}
                        />
                        <Label htmlFor={`skip-${t}`} className="text-xs font-normal cursor-pointer">
                          Niet importeren
                        </Label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {verdacht.length > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-400/60 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="size-4" />
                  Dit lijkt geen straatnaam — klopt dit?
                </div>
                {verdacht.map((v) => (
                  <div key={v.straat} className="space-y-2 rounded-md border border-amber-400/40 p-3">
                    <p className="text-sm">
                      <span className="font-semibold">“{v.straat}”</span>{" "}
                      <span className="opacity-80">({v.redenen.join(", ")})</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-8 max-w-56 bg-background text-foreground"
                        placeholder="Juiste straatnaam"
                        value={hernoemen[v.straat] ?? ""}
                        onChange={(e) => setHernoemen((h) => ({ ...h, [v.straat]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") hernoemStraat(v.straat, hernoemen[v.straat] ?? "");
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => hernoemStraat(v.straat, hernoemen[v.straat] ?? "")}
                      >
                        Hernoemen
                      </Button>
                      <Select value="" onValueChange={(naam) => hernoemStraat(v.straat, naam)}>
                        <SelectTrigger className="h-8 w-56 bg-background text-foreground">
                          <SelectValue placeholder="Samenvoegen met…" />
                        </SelectTrigger>
                        <SelectContent>
                          {straten
                            .filter((s) => s !== v.straat)
                            .map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setGoedgekeurd((s) => new Set(s).add(v.straat))}
                      >
                        <Check className="size-4" /> Klopt wel
                      </Button>
                      {bronnen[v.straat] && (
                        <Button size="sm" variant="outline" onClick={() => setBekijk({ label: v.straat, bronnen: [bronnen[v.straat]!] })}>
                          <Eye className="size-4" /> Bekijken in bestand
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => verwijderStraat(v.straat)}>
                        <Trash2 className="size-4" /> {v.aantal} regels weggooien
                      </Button>

                    </div>
                  </div>
                ))}
              </div>
            )}

            {samengevoegd > 0 && (
              <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <span className="size-3 shrink-0 rounded-sm bg-tint-amber ring-1 ring-inset ring-tint-amber-ink/20" />
                {samengevoegd} {samengevoegd === 1 ? "adres staat" : "adressen staan"} in meer dan
                één tabblad. Hun notities zijn samengevoegd — ook als er maar in één maand iets
                stond. Kijk die even na.
              </p>
            )}

            <div className="rounded-lg border border-border bg-card">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-[15%] px-3 py-2">Straat</th>
                    <th className="w-20 px-3 py-2">Nr.</th>
                    <th className="w-[55%] px-3 py-2">Notitie</th>
                    <th className="w-40 px-3 py-2">Frequentie</th>
                    <th className="w-24 px-3 py-2 text-right">Prijs</th>
                    <th className="w-20 px-2 py-2" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {lijst.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-1">
                        <InlineCel value={r.straat} onCommit={(v) => wijzig(r.id, { straat: v.trim() })} />
                      </td>
                      <td className="px-2 py-1">
                        <InlineCel
                          value={`${r.huisnummer}${r.toevoeging}`}
                          inputMode="text"
                          onCommit={(v) => {
                            const m = v.trim().match(/^(\d+)\s*([a-zA-Z-]*)$/);
                            if (!m) {
                              toast.error("Ongeldig huisnummer");
                              return;
                            }
                            wijzig(r.id, { huisnummer: parseInt(m[1]!, 10), toevoeging: m[2] ?? "" });
                          }}
                        />
                      </td>
                      <td
                        className={`px-2 py-1 ${
                          uitTweeMaanden(r)
                            ? "bg-tint-amber text-tint-amber-ink ring-1 ring-inset ring-tint-amber-ink/20"
                            : ""
                        }`}
                        title={
                          uitTweeMaanden(r)
                            ? `Dit adres staat in ${r.bronnen.length} tabbladen (${r.bronnen
                                .map((b) => b.tabblad)
                                .join(", ")}). De notitie komt daaruit samen — kijk hem even na.`
                            : undefined
                        }
                      >
                        <NotitieCel
                          value={r.notitie}
                          even={r.notitieEven}
                          oneven={r.notitieOneven}
                          onChangeEven={(v) => wijzig(r.id, { notitieEven: v })}
                          onChangeOneven={(v) => wijzig(r.id, { notitieOneven: v })}
                          quickNotes={quickNotes}
                          onChange={(v) => wijzig(r.id, { notitie: v })}
                          onAddQuickNote={(l) => void nieuweSnelkeuze(l)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={r.frequency}
                          onValueChange={(v) => wijzig(r.id, { frequency: v as Frequency })}
                        >
                          <SelectTrigger className="h-7 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(frequencyLabels) as Frequency[]).map((f) => (
                              <SelectItem key={f} value={f}>
                                {frequencyLabels[f]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`px-2 py-1 text-right ${r.prijs === 0 ? "text-red-600" : ""}`}>
                        <InlineCel
                          align="right"
                          inputMode="decimal"
                          value={formatPrice(r.prijs)}
                          placeholder={formatPrice(0)}
                          onCommit={(v) =>
                            wijzig(r.id, { prijs: Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })
                          }
                        />
                      </td>
                      <td className="px-1 py-1">
                        {r.bronnen.length > 0 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Bekijken in origineel bestand"
                            title={
                              r.bronnen.length > 1
                                ? `Bekijken in origineel bestand (${r.bronnen.length} tabbladen)`
                                : "Bekijken in origineel bestand"
                            }
                            onClick={() =>
                              setBekijk({
                                label: `${r.straat} ${r.huisnummer}${r.toevoeging}`,
                                bronnen: r.bronnen,
                              })
                            }
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Regel verwijderen"
                          onClick={() => verwijderRij(r.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button onClick={importeer} disabled={bezig}>
                {bezig ? "Bezig…" : `${lijst.length} klanten importeren`}
              </Button>
              <Button variant="outline" onClick={() => setRijen([])} disabled={bezig}>
                Annuleren
              </Button>
            </div>

            {naImport && <NaImportVerslag stand={naImport} />}
          </div>
        )}


        <BronVenster
          straat={bekijk?.label ?? null}
          bronnen={bekijk?.bronnen ?? []}
          grids={grids}
          bestandsnaam={bestandsnaam}
          onClose={() => setBekijk(null)}
        />

      </div>
    </AppLayout>
  );
}

function kolomLetter(index: number) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function BronRaster({ bron, grid }: { bron: Bron; grid: SheetGrid }) {
  const rStart = Math.max(0, bron.rij - 6);
  const rEnd = Math.min(grid.cellen.length - 1, bron.rij + 16);
  const cStart = Math.max(0, bron.kolom - 3);
  const cEnd = Math.min((grid.cellen[0]?.length ?? 1) - 1, bron.kolom + 6);

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium">
        Tabblad “{bron.tabblad}” — cel {kolomLetter(bron.kolom)}
        {bron.rij + 1}
      </p>
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-white">
        <table
          className="border-collapse font-sans text-[11px] text-black"
          style={{ fontFamily: "Calibri, Arial, sans-serif" }}
        >
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border border-[#c6c6c6] bg-[#f0f0f0] px-1 py-0.5 text-[10px] font-normal text-[#555]" />
              {Array.from({ length: cEnd - cStart + 1 }, (_, i) => (
                <th
                  key={i}
                  className="sticky top-0 z-10 border border-[#c6c6c6] bg-[#f0f0f0] px-1 py-0.5 text-[10px] font-normal text-[#555]"
                  style={{ minWidth: Math.min(220, Math.max(40, grid.breedtes[cStart + i] ?? 70)) }}
                >
                  {kolomLetter(cStart + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rEnd - rStart + 1 }, (_, ri) => {
              const r = rStart + ri;
              return (
                <tr key={r}>
                  <td className="sticky left-0 z-10 border border-[#c6c6c6] bg-[#f0f0f0] px-1 py-0.5 text-center text-[10px] text-[#555]">
                    {r + 1}
                  </td>
                  {Array.from({ length: cEnd - cStart + 1 }, (_, ci) => {
                    const c = cStart + ci;
                    const cel = grid.cellen[r]?.[c];
                    const isDoel = r === bron.rij && c === bron.kolom;
                    return (
                      <td
                        key={c}
                        className="whitespace-nowrap border border-[#d4d4d4] px-1.5 py-0.5"
                        style={{
                          backgroundColor: cel?.vul ?? "#ffffff",
                          color: cel?.kleur ?? "#000000",
                          fontWeight: cel?.vet ? 700 : 400,
                          textAlign: cel?.rechts ? "right" : "left",
                          ...(isDoel ? { outline: "3px solid #f59e0b", outlineOffset: "-3px" } : {}),
                        }}
                      >
                        {cel?.t ?? ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BronVenster({
  straat,
  bronnen,
  grids,
  bestandsnaam,
  onClose,
}: {
  straat: string | null;
  bronnen: Bron[];
  grids: Record<string, SheetGrid>;
  bestandsnaam: string;
  onClose: () => void;
}) {
  const bruikbaar = bronnen.filter((b) => grids[b.tabblad]);
  const open = Boolean(straat) && bruikbaar.length > 0;
  const [actief, setActief] = useState(0);
  const [naast, setNaast] = useState(true);
  const index = Math.min(actief, Math.max(0, bruikbaar.length - 1));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>“{straat}” in het originele bestand</DialogTitle>
          <DialogDescription>
            {bestandsnaam} —{" "}
            {bruikbaar.length > 1
              ? `staat in ${bruikbaar.length} tabbladen`
              : `tabblad “${bruikbaar[0]?.tabblad ?? ""}”`}
          </DialogDescription>
        </DialogHeader>

        {bruikbaar.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={naast ? "default" : "outline"} onClick={() => setNaast(true)}>
              Naast elkaar
            </Button>
            {bruikbaar.map((b, i) => (
              <Button
                key={b.tabblad}
                size="sm"
                variant={!naast && i === index ? "default" : "outline"}
                onClick={() => {
                  setNaast(false);
                  setActief(i);
                }}
              >
                {b.tabblad}
              </Button>
            ))}
          </div>
        )}

        <div className="flex gap-3 overflow-x-auto">
          {(bruikbaar.length > 1 && naast ? bruikbaar : bruikbaar.slice(index, index + 1)).map((b) => (
            <BronRaster key={b.tabblad} bron={b} grid={grids[b.tabblad]!} />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Zo staat het in je Excel-bestand, met de originele kleuren. Het oranje omlijnde vakje is wat
          de app heeft ingelezen.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wat er na het importeren gebeurt: eerst de straatnamen, dan de postcodes.
 * Blijft in beeld staan, want het duurt bij een grote wijk een minuut of wat
 * en je wil kunnen zien waar het op vastloopt.
 */
function NaImportVerslag({ stand }: { stand: NaImport }) {
  const bezig = stand.stap !== "klaar";
  return (
    <div className="max-w-lg space-y-2 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium">
        {stand.stap === "straten"
          ? `Straatnamen opzoeken — ${stand.gedaan}/${stand.totaal}`
          : stand.stap === "postcodes"
            ? `Postcodes ophalen — ${stand.gedaan}/${stand.totaal}`
            : "Klaar"}
      </p>

      {!bezig && (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          <li>{stand.straatnamen} straatnamen aangevuld</li>
          <li>{stand.postcodes} postcodes ingevuld</li>
          {stand.twijfel > 0 && (
            <li className="text-tint-amber-ink">
              {stand.twijfel}{" "}
              {stand.twijfel === 1 ? "straat had meerdere" : "straten hadden meerdere"} mogelijke
              namen — die hebben we laten staan. Vul ze na met de knop Straatnamen op de
              wijkenpagina.
            </li>
          )}
          {stand.afgebroken && (
            <li className="text-tint-amber-ink">
              De adressendienst hield ermee op. Draai de rest over een paar minuten met de knoppen
              Straatnamen en Postcodes op de wijkenpagina.
            </li>
          )}
        </ul>
      )}

      {!bezig && (
        <Button asChild size="sm" className="mt-1">
          <Link to="/" search={{ wijk: stand.districtId }}>
            Naar de wijk
          </Link>
        </Button>
      )}
    </div>
  );
}
