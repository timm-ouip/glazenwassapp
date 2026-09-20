import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { haalAllePaginas } from "@/lib/pagineren";
import { requireSession, useRequireAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconArrowLeft as ArrowLeft,
  IconCheck as Check,
  IconEye as Eye,
  IconFileSpreadsheet as FileSpreadsheet,
  IconSparkles as Sparkles,
  IconTrash as Trash2,
  IconArrowBackUp as Undo2,
  IconUpload as Upload,
} from "@tabler/icons-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { PopupBody, PopupHint, PopupKader, PopupKop } from "@/components/Popup";

import { AppLayout } from "@/components/AppLayout";
import { InlineCel } from "@/components/InlineCel";
import { NotitieCel } from "@/components/NotitieCel";
import type { Json } from "@/integrations/supabase/types";
import {
  addDistrict,
  addQuickNote,
  fetchCustomers,
  fetchDistricts,
  fetchQuickNotes,
  fetchStreets,
  BASISRITMES,
  maandwerkVanEvenOneven,
  ritmeVelden,
  formatPrice,
  noteTokens,
  straatSleutel,
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
import { nummerSleutel, zoekStraatPostcodes, zoekWoonplaatsen } from "@/lib/postcode";
import {
  type ImportCel,
  type ImportStraat,
  vraagPaaltje,
  zoekHuisnummers,
  zoekRegisternamen,
} from "@/lib/import-paaltje";
import { isGeenRecht } from "@/lib/klanten";

export const Route = createFileRoute("/importeren")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({
    meta: [
      { title: "Excel importeren — Wooshy" },
      {
        name: "description",
        content:
          "Zet je bestaande Excel-lijst met straten, huisnummers, notities en prijzen om in de app.",
      },
      { property: "og:title", content: "Excel importeren" },
      {
        property: "og:description",
        content: "Straten, huisnummers, notities en prijzen uit Excel inlezen.",
      },
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

function parseNummer(
  value: unknown,
): { nummer: number; toevoeging: string; markering: string } | null {
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
  const style = (cell as { s?: { patternType?: string; fgColor?: { rgb?: string } } } | undefined)
    ?.s;
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

/** Wat Paaltje (of jij) over een tekstvakje besloot, op cel-id. */
type CelKeuze = Record<string, "straat" | "notitie">;

/** Een tekstvakje uit het blad, met waar het staat. */
interface Kandidaat extends ImportCel {
  bron: Bron;
}

function celId(tabIndex: number, r: number, c: number) {
  return `t${tabIndex}_${r}_${c}`;
}

function leesTabblad(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  tabIndex: number,
  keuze: CelKeuze,
): {
  rijen: RijPreview[];
  bronnen: Record<string, Bron>;
  grid: SheetGrid;
  kandidaten: Kandidaat[];
} {
  const leeg: SheetGrid = { cellen: [], breedtes: [] };
  const ref = sheet["!ref"];
  if (!ref) return { rijen: [], bronnen: {}, grid: leeg, kandidaten: [] };
  const range = XLSX.utils.decode_range(ref);
  const cel = (r: number, c: number) =>
    sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // Volledige weergave van het tabblad (om later te kunnen "bekijken in origineel")
  const kolInfo = (sheet["!cols"] ?? []) as { wch?: number; width?: number }[];
  const grid: SheetGrid = {
    cellen: [],
    breedtes: Array.from({ length: range.e.c + 1 }, (_, c) =>
      Math.round((kolInfo[c]?.wch ?? kolInfo[c]?.width ?? 9) * 7.5),
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
  const grijsBekend = kopKolommen.size > 0;
  // Een vakje dat als straat is aangewezen telt mee, ook zonder grijs.
  const aangewezen = new Set<number>();
  for (const [id, wordt] of Object.entries(keuze)) {
    const m = id.match(/^t(\d+)_(\d+)_(\d+)$/);
    if (wordt === "straat" && m && Number(m[1]) === tabIndex) aangewezen.add(Number(m[3]));
  }
  // Terugval: geen kleuren gevonden → eerste kolom met tekst + nummers
  const kolommen = [...new Set([...(grijsBekend ? kopKolommen : [range.s.c]), ...aangewezen])].sort(
    (a, b) => a - b,
  );

  const rijen: RijPreview[] = [];
  const bronnen: Record<string, Bron> = {};
  const kandidaten: Kandidaat[] = [];
  const kandidaat = (r: number, c: number, nu: "straat" | "notitie", straatErboven: string) => {
    const cell = cel(r, c);
    const s = (cell as { s?: CelStijl } | undefined)?.s;
    const vul = s?.patternType && s.patternType !== "none" ? s.fgColor?.rgb : undefined;
    kandidaten.push({
      id: celId(tabIndex, r, c),
      tabblad: sheetName,
      cel: `${XLSX.utils.encode_col(c)}${r + 1}`,
      tekst: tekst(cell),
      grijs: isGrijs(cell),
      vulkleur: vul ?? "",
      vet: Boolean(s?.font?.bold),
      nummers_eronder: nummersHieronder(r, c),
      nu,
      straat_erboven: straatErboven,
      bron: { tabblad: sheetName, rij: r, kolom: c },
    });
  };

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
        // Straatkop: als het bestand grijze koppen heeft, telt alleen grijs.
        // Anders vallen we terug op "er beginnen hieronder huisnummers".
        // Wat Paaltje of jij besliste gaat voor.
        const gekozen = keuze[celId(tabIndex, r, c)];
        const isKop = gekozen
          ? gekozen === "straat"
          : grijsBekend
            ? isGrijs(cell)
            : volgt >= 1 || !laatste;
        kandidaat(r, c, isKop ? "straat" : "notitie", straat);

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
          typeof prijsCel === "number"
            ? prijsCel
            : Number(String(prijsCel ?? "").replace(",", ".")) || 0,
        bron: { tabblad: sheetName, rij: r, kolom: c },
      };

      rijen.push(rij);
      laatste = rij;
    }
  }

  // Tekst met huisnummers eronder in een kolom die we niet lazen: misschien
  // een straat zonder grijs. Niet in de notitie- en prijskolom ernaast, want
  // onder een "€" staan ook getallen.
  const naastKop = new Set(kolommen.flatMap((c) => [c + 1, c + 2]));
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (kolommen.includes(c) || naastKop.has(c)) continue;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = cel(r, c);
      if (!tekst(cell) || parseNummer(cell?.v)) continue;
      if (nummersHieronder(r, c) >= 2) kandidaat(r, c, "notitie", "");
    }
  }

  return { rijen, bronnen, grid, kandidaten };
}

/** Het hele werkboek inlezen, met wat er over losse vakjes besloten is. */
function leesWerkboek(wb: XLSX.WorkBook, keuze: CelKeuze) {
  const rijen: RijPreview[] = [];
  const bronnen: Record<string, Bron> = {};
  const grids: Record<string, SheetGrid> = {};
  const kandidaten: Kandidaat[] = [];
  wb.SheetNames.forEach((naam, i) => {
    const sheet = wb.Sheets[naam];
    if (!sheet) return;
    const res = leesTabblad(sheet, naam, i, keuze);
    rijen.push(...res.rijen);
    grids[naam] = res.grid;
    kandidaten.push(...res.kandidaten);
    for (const [straat, bron] of Object.entries(res.bronnen)) {
      if (!bronnen[straat]) bronnen[straat] = bron;
    }
  });
  return { rijen, bronnen, grids, kandidaten };
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

/** Iets wat Paaltje voorstelt. Zeker = meteen toegepast (geel), anders jouw keuze. */
type PaaltjeVoorstel = { id: string; zeker: boolean; reden: string; toegepast: boolean } & (
  | { soort: "cel"; celId: string; tekst: string; wordt: "straat" | "notitie"; bron: Bron }
  | { soort: "zelfde"; namen: string[]; naam: string }
  | { soort: "officieel"; straat: string; naam: string }
);

/** De officiële naam van een straat, en wie hem koos. Lege naam = bewust geen. */
interface Officieel {
  naam: string;
  hoe: "register" | "paaltje" | "jij";
}

interface Meekijken {
  stap: "register" | "paaltje" | "huisnummers" | "klaar";
  gedaan: number;
  totaal: number;
  /** Wat er misging, als zin; het scherm werkt dan gewoon zonder. */
  fout: string;
}

/** Iets om na te kijken in de lijst zelf: een rare prijs of een huisnummer dat niet bestaat. */
interface Nakijkpunt {
  rijId: string;
  label: string;
  reden: string;
  /** Bij een prijs: wat het waarschijnlijk had moeten zijn. */
  prijs?: number;
  bronnen: Bron[];
}

function mediaan(getallen: number[]): number {
  const g = [...getallen].sort((a, b) => a - b);
  if (g.length === 0) return 0;
  const m = Math.floor(g.length / 2);
  return g.length % 2 ? g[m]! : (g[m - 1]! + g[m]!) / 2;
}

function nakijkpunten(
  lijst: ImportRij[],
  officieel: Record<string, Officieel>,
  kaarten: Record<string, Map<string, string>>,
): Nakijkpunt[] {
  const uit: Nakijkpunt[] = [];
  const prijzenPerStraat = new Map<string, number[]>();
  for (const r of lijst) {
    if (r.prijs <= 0) continue;
    const k = straatSleutel(r.straat);
    prijzenPerStraat.set(k, [...(prijzenPerStraat.get(k) ?? []), r.prijs]);
  }
  for (const r of lijst) {
    const k = straatSleutel(r.straat);
    const label = `${r.straat} ${r.huisnummer}${r.toevoeging}`;
    const straatPrijzen = prijzenPerStraat.get(k) ?? [];
    const midden = mediaan(straatPrijzen);
    // Een tikfout als 250 voor 25,0 valt pas op tussen genoeg buren.
    if (straatPrijzen.length >= 4 && r.prijs >= 50 && r.prijs >= midden * 4) {
      const tiende = Math.round((r.prijs / 10) * 100) / 100;
      const lijktOp = tiende >= midden / 2 && tiende <= midden * 2;
      uit.push({
        rijId: r.id,
        label,
        reden: `${formatPrice(r.prijs)} is veel meer dan de rest van de straat (meestal ${formatPrice(midden)}).`,
        ...(lijktOp ? { prijs: tiende } : {}),
        bronnen: r.bronnen,
      });
    }
    const naam = officieel[k]?.naam;
    const kaart = naam ? kaarten[naam] : undefined;
    // Een lege kaart zegt niets: sommige straten staan er zonder adressen in.
    if (naam && kaart && kaart.size > 0) {
      const bestaat =
        kaart.has(nummerSleutel(r.huisnummer, r.toevoeging)) ||
        kaart.has(nummerSleutel(r.huisnummer));
      if (!bestaat) {
        uit.push({
          rijId: r.id,
          label,
          reden: `Nummer ${r.huisnummer}${r.toevoeging} staat niet in het adressenregister bij ${naam}.`,
          bronnen: r.bronnen,
        });
      }
    }
  }
  return uit;
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
  const [werkboek, setWerkboek] = useState<XLSX.WorkBook | null>(null);
  // Wat Paaltje of jij over losse vakjes, straatnamen en officiële namen besliste.
  const [keuze, setKeuze] = useState<CelKeuze>({});
  const [vervang, setVervang] = useState<Record<string, string>>({});
  const [officieel, setOfficieel] = useState<Record<string, Officieel>>({});
  const [register, setRegister] = useState<Record<string, string[]>>({});
  const [kaarten, setKaarten] = useState<Record<string, Map<string, string>>>({});
  const [voorstellen, setVoorstellen] = useState<PaaltjeVoorstel[]>([]);
  const [meekijk, setMeekijk] = useState<Meekijken | null>(null);
  const [nietMelden, setNietMelden] = useState<Set<string>>(new Set());
  /** Bij welke plaats de opgezochte namen en postcodes horen. */
  const [meekijkPlaats, setMeekijkPlaats] = useState("");
  // Wat je zelf in de lijst veranderde. Apart bewaard, zodat het blijft staan
  // als het bestand opnieuw ingelezen wordt omdat Paaltje iets aanpaste.
  const [bewerkt, setBewerkt] = useState<Record<string, Partial<ImportRij>>>({});
  const [wegRijen, setWegRijen] = useState<Set<string>>(new Set());
  const [wegStraten, setWegStraten] = useState<Set<string>>(new Set());
  const [hernoemd, setHernoemd] = useState<Record<string, string>>({});
  // Laadt iemand intussen een ander bestand, dan hoort een oud antwoord nergens meer bij.
  const ronde = useRef(0);

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
    fetchQuickNotes()
      .then(setQuickNotes)
      .catch(() => undefined);
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

  const nakijken = useMemo(
    () =>
      nakijkpunten(lijst, officieel, kaarten).filter(
        (p) => !nietMelden.has(`${p.rijId}|${p.reden}`),
      ),
    [lijst, officieel, kaarten, nietMelden],
  );
  const nakijkRijen = useMemo(() => new Set(nakijken.map((p) => p.rijId)), [nakijken]);

  /** Per straat in de lijst: hoeveel adressen, en welke officiële naam. */
  const straatOverzicht = useMemo(() => {
    const aantal = new Map<string, { naam: string; adressen: number }>();
    for (const r of lijst) {
      const k = straatSleutel(r.straat);
      const s = aantal.get(k) ?? { naam: r.straat, adressen: 0 };
      s.adressen++;
      aantal.set(k, s);
    }
    return [...aantal.entries()].map(([k, s]) => ({
      ...s,
      sleutel: k,
      opties: register[k] ?? [],
      gekozen: officieel[k] ?? null,
    }));
  }, [lijst, register, officieel]);

  // Opnieuw inlezen zodra er over een vakje iets besloten is.
  useEffect(() => {
    if (!werkboek) {
      setRijen([]);
      return;
    }
    const res = leesWerkboek(werkboek, keuze);
    setBronnen(res.bronnen);
    setGrids(res.grids);
    setRijen(res.rijen);
  }, [werkboek, keuze]);

  /** Adressen die in meerdere tabbladen staan worden samengevoegd tot "elke maand". */
  useEffect(() => {
    type Verzamel = { rij: ImportRij; delen: { freq: Frequency; notitie: string }[] };
    const map = new Map<string, Verzamel>();

    for (const origineel of rijen) {
      if (skipTabbladen.has(origineel.tabblad)) continue;
      // Anders gespelde namen van dezelfde straat onder één naam: eerst wat
      // Paaltje samenvoegde, dan wat je zelf hernoemde.
      const naPaaltje = vervang[straatSleutel(origineel.straat)] ?? origineel.straat;
      const r = { ...origineel, straat: hernoemd[straatSleutel(naPaaltje)] ?? naPaaltje };
      // Dezelfde sleutel als bij het opslaan: een dubbele of harde spatie uit
      // Excel ("Kz  Max") maakte anders twee adressen van één huis.
      const sleutel = `${straatSleutel(r.straat)}|${r.huisnummer}|${r.toevoeging.toLowerCase()}`;
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

    setLijst(
      [...map.values()]
        .map(({ rij, delen }) => ({ ...rij, ...verdeelNotities(delen), ...bewerkt[rij.id] }))
        .filter((r) => !wegRijen.has(r.id) && !wegStraten.has(straatSleutel(r.straat))),
    );
    setHernoemen({});
  }, [rijen, freqPerTabblad, skipTabbladen, vervang, hernoemd, bewerkt, wegRijen, wegStraten]);

  function wijzig(id: string, patch: Partial<ImportRij>) {
    setBewerkt((b) => ({ ...b, [id]: { ...b[id], ...patch } }));
  }

  function verwijderRij(id: string) {
    setWegRijen((s) => new Set(s).add(id));
  }

  function verwijderStraat(straat: string) {
    setWegStraten((s) => new Set(s).add(straatSleutel(straat)));
  }

  function hernoemStraat(oud: string, nieuw: string) {
    const naam = nieuw.trim();
    if (!naam) return;
    const van = straatSleutel(oud);
    setHernoemd((h) => {
      // Wat eerder al naar de oude naam hernoemd was, gaat mee.
      const uit: Record<string, string> = {};
      for (const [k, v] of Object.entries(h)) uit[k] = straatSleutel(v) === van ? naam : v;
      uit[van] = naam;
      return uit;
    });
    // De gekozen officiële naam verhuist mee, tenzij de nieuwe naam er al een heeft.
    setOfficieel((o) => {
      const naar = straatSleutel(naam);
      if (!o[van] || o[naar]) return o;
      const { [van]: gekozen, ...rest } = o;
      return { ...rest, [naar]: gekozen! };
    });
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
      const freq: Record<string, Frequency> = {};
      for (const sheetName of wb.SheetNames) freq[sheetName] = raadFrequentie(sheetName);
      const gevonden = leesWerkboek(wb, {}).rijen;
      setBestandsnaam(file.name);
      setFreqPerTabblad(freq);
      setSkipTabbladen(new Set());
      setGoedgekeurd(new Set());
      setNietMelden(new Set());
      setBewerkt({});
      setWegRijen(new Set());
      setWegStraten(new Set());
      setHernoemd({});
      wisPaaltje();
      setWerkboek(wb);
      if (gevonden.length === 0) {
        toast.error("Geen klanten herkend in dit bestand.");
        return;
      }
      void meekijken(wb);
    } catch (e) {
      toast.error("Bestand kon niet gelezen worden.");
      console.error(e);
    }
  }

  /** Alles wat Paaltje en het register deden weer weg. */
  function wisPaaltje() {
    ronde.current++;
    setKeuze((k) => (Object.keys(k).length ? {} : k));
    setVervang((v) => (Object.keys(v).length ? {} : v));
    setOfficieel({});
    setRegister({});
    setKaarten({});
    setVoorstellen([]);
    setMeekijk(null);
  }

  function pasToe(v: PaaltjeVoorstel, aan: boolean) {
    if (v.soort === "cel") {
      setKeuze((k) => {
        const nieuw = { ...k };
        if (aan) nieuw[v.celId] = v.wordt;
        else delete nieuw[v.celId];
        return nieuw;
      });
    } else if (v.soort === "zelfde") {
      setVervang((m) => {
        const nieuw = { ...m };
        for (const naam of v.namen) {
          if (straatSleutel(naam) === straatSleutel(v.naam)) continue;
          if (aan) nieuw[straatSleutel(naam)] = v.naam;
          else delete nieuw[straatSleutel(naam)];
        }
        return nieuw;
      });
    } else {
      setOfficieel((o) => {
        const nieuw = { ...o };
        if (aan) nieuw[straatSleutel(v.straat)] = { naam: v.naam, hoe: "paaltje" };
        else delete nieuw[straatSleutel(v.straat)];
        return nieuw;
      });
      if (aan) void haalKaart(v.naam);
    }
    setVoorstellen((l) => l.map((x) => (x.id === v.id ? { ...x, toegepast: aan } : x)));
  }

  /** "Klopt niet": weg uit de lijst, en als hij toegepast was ook terugdraaien. */
  function wijsAf(v: PaaltjeVoorstel) {
    if (v.toegepast) pasToe(v, false);
    setVoorstellen((l) => l.filter((x) => x.id !== v.id));
  }

  /** Zelf een officiële naam kiezen; leeg = deze straat heeft er geen. */
  function kiesOfficieel(straat: string, naam: string) {
    setOfficieel((o) => ({ ...o, [straatSleutel(straat)]: { naam, hoe: "jij" } }));
    if (naam) void haalKaart(naam);
  }

  async function haalKaart(naam: string) {
    if (!werkPlaats || werkPlaats !== meekijkPlaats || kaarten[naam]) return;
    const deze = ronde.current;
    const kaart = await zoekStraatPostcodes(naam, werkPlaats);
    if (kaart && ronde.current === deze) setKaarten((k) => ({ ...k, [naam]: kaart }));
  }

  /**
   * Paaltje laten meekijken: eerst bij het adressenregister opzoeken welke
   * straten er in de plaats zijn, dan Paaltje vragen wat er anders moet, en
   * daarna de huisnummers nakijken. Zekere dingen worden meteen (geel)
   * toegepast, de rest blijft een voorstel. Gaat er iets mis, dan werkt het
   * scherm gewoon zoals zonder Paaltje.
   */
  async function meekijken(wb: XLSX.WorkBook) {
    wisPaaltje();
    const deze = ronde.current;
    const actueel = () => ronde.current === deze;
    const plaatsNu = werkPlaats;
    setMeekijkPlaats(plaatsNu);
    const basis = leesWerkboek(wb, {});

    // Straten zoals de app ze las, plus teksten met huisnummers eronder die
    // misschien ook een straat zijn.
    const perStraat = new Map<string, { naam: string; nummers: number[] }>();
    for (const r of basis.rijen) {
      const k = straatSleutel(r.straat);
      const s = perStraat.get(k) ?? { naam: r.straat, nummers: [] };
      s.nummers.push(r.huisnummer);
      perStraat.set(k, s);
    }
    const misschien = basis.kandidaten
      .filter((c) => c.nu === "notitie" && c.nummers_eronder >= 2 && c.tekst.length <= 40)
      .map((c) => c.tekst);
    const opTeZoeken = [
      ...new Map(
        [...[...perStraat.values()].map((s) => s.naam), ...misschien].map((n) => [
          straatSleutel(n),
          n,
        ]),
      ).values(),
    ];

    let opties = new Map<string, string[]>();
    let fout = "";
    if (plaatsNu) {
      setMeekijk({ stap: "register", gedaan: 0, totaal: opTeZoeken.length, fout: "" });
      const uitkomst = await zoekRegisternamen(opTeZoeken, plaatsNu, (gedaan, totaal) => {
        if (actueel()) setMeekijk((m) => (m ? { ...m, gedaan, totaal } : m));
      });
      if (!actueel()) return;
      opties = uitkomst.opties;
      if (uitkomst.afgebroken)
        fout = "Het adressenregister deed niet mee; de straatnamen kun je later nog opzoeken.";
    }
    const registerNu: Record<string, string[]> = {};
    for (const [naam, lijst] of opties) registerNu[straatSleutel(naam)] = lijst;
    setRegister(registerNu);

    // Precies één naam in het register: die vullen we meteen in, zoals na het importeren.
    const officieelNu: Record<string, Officieel> = {};
    for (const [k, lijst] of Object.entries(registerNu)) {
      if (lijst.length === 1) officieelNu[k] = { naam: lijst[0]!, hoe: "register" };
    }

    setMeekijk({ stap: "paaltje", gedaan: 0, totaal: 0, fout });
    const straten: ImportStraat[] = [...perStraat.values()].map((s) => {
      const nummers = [...s.nummers].sort((a, b) => a - b);
      return {
        naam: s.naam,
        adressen: s.nummers.length,
        huisnummers: nummers.length ? `${nummers[0]} t/m ${nummers[nummers.length - 1]}` : "",
        register: registerNu[straatSleutel(s.naam)] ?? [],
      };
    });
    const nieuweKeuze: CelKeuze = {};
    const nieuwVervang: Record<string, string> = {};
    const nieuw: PaaltjeVoorstel[] = [];
    try {
      const antwoord = await vraagPaaltje({
        plaats: plaatsNu,
        cellen: basis.kandidaten.slice(0, 800).map(({ bron: _bron, ...c }) => c),
        straten,
      });
      if (!actueel()) return;
      const kandidaatVan = new Map(basis.kandidaten.map((c) => [c.id, c]));
      for (const c of antwoord.cellen) {
        const k = kandidaatVan.get(c.id);
        if (!k) continue;
        if (c.zeker) nieuweKeuze[c.id] = c.wordt;
        nieuw.push({
          id: `cel-${c.id}`,
          soort: "cel",
          celId: c.id,
          tekst: k.tekst,
          wordt: c.wordt,
          bron: k.bron,
          zeker: c.zeker,
          reden: c.reden,
          toegepast: c.zeker,
        });
      }
      antwoord.zelfde_straat.forEach((g, i) => {
        if (g.zeker) {
          for (const n of g.namen) {
            if (straatSleutel(n) !== straatSleutel(g.naam)) nieuwVervang[straatSleutel(n)] = g.naam;
          }
        }
        nieuw.push({
          id: `zelfde-${i}`,
          soort: "zelfde",
          namen: g.namen,
          naam: g.naam,
          zeker: g.zeker,
          reden: g.reden,
          toegepast: g.zeker,
        });
      });
      antwoord.officieel.forEach((o, i) => {
        const k = straatSleutel(o.straat);
        if (o.zeker) officieelNu[k] = { naam: o.naam, hoe: "paaltje" };
        // Twijfelt Paaltje, dan vullen we ook de enige registernaam niet vanzelf in.
        else delete officieelNu[k];
        // "Zwaanwijck heet officieel Zwaanwijck" is geen nieuws.
        if (o.zeker && straatSleutel(o.naam) === k) return;
        nieuw.push({
          id: `officieel-${i}`,
          soort: "officieel",
          straat: o.straat,
          naam: o.naam,
          zeker: o.zeker,
          reden: o.reden,
          toegepast: o.zeker,
        });
      });
    } catch (e) {
      if (!actueel()) return;
      fout = [fout, (e as Error).message].filter(Boolean).join(" ");
    }
    // Een samengevoegde straat krijgt de officiële naam van de naam die blijft.
    for (const [van, naar] of Object.entries(nieuwVervang)) {
      if (!officieelNu[straatSleutel(naar)] && officieelNu[van]) {
        officieelNu[straatSleutel(naar)] = officieelNu[van]!;
      }
    }
    if (Object.keys(nieuweKeuze).length > 0) setKeuze(nieuweKeuze);
    if (Object.keys(nieuwVervang).length > 0) setVervang(nieuwVervang);
    // Wat je intussen zelf koos, blijft staan.
    setOfficieel((o) => ({
      ...officieelNu,
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => v.hoe === "jij")),
    }));
    setVoorstellen(nieuw);

    // Tot slot de huisnummers: welke bestaan er, en met welke postcode.
    const namen = [
      ...new Set(
        Object.values(officieelNu)
          .map((o) => o.naam)
          .filter(Boolean),
      ),
    ];
    if (plaatsNu && namen.length > 0) {
      setMeekijk({ stap: "huisnummers", gedaan: 0, totaal: namen.length, fout });
      const uitkomst = await zoekHuisnummers(namen, plaatsNu, (gedaan, totaal) => {
        if (actueel()) setMeekijk((m) => (m ? { ...m, gedaan, totaal } : m));
      });
      if (!actueel()) return;
      setKaarten((k) => ({ ...k, ...Object.fromEntries(uitkomst.kaarten) }));
    }
    setMeekijk({ stap: "klaar", gedaan: 0, totaal: 0, fout });
  }

  /**
   * Zoekt na het importeren meteen de officiële straatnamen en de postcodes
   * op. Alleen straten met precies één treffer worden vanzelf ingevuld: de
   * naamzoekopdracht is fuzzy, en een gok opslaan levert straks een
   * verkeerde postcode op. De rest laten we staan om na te kijken.
   */
  async function vulAan(districtId: string, woonplaats: string, overslaan = new Set<string>()) {
    const straten = (await fetchStreets()).filter((s) => s.district_id === districtId);
    const teDoen = stratenZonderNaam(straten).filter((s) => !overslaan.has(s.id));
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
        // Niet een uit de prullenbak (dan zijn de adressen nergens te zien), en
        // bij meerdere gewoon de eerste in plaats van een fout.
        const { data: bestaand, error: geenWijkFout } = await supabase
          .from("districts")
          .select("id")
          .eq("name", "Geen wijk")
          .is("deleted_at", null)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (geenWijkFout) throw geenWijkFout;
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

      // Alleen straten die er nog zijn. Zonder dit filter matcht een straat
      // die in de prullenbak ligt, en hangen de nieuwe adressen aan een
      // weggegooide straat — nergens meer te zien.
      const { data: bestaandeStraten, error: straatFout } = await supabase
        .from("streets")
        .select("id,name,volledige_naam")
        .eq("district_id", districtId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (straatFout) throw straatFout;

      const map = new Map<string, string>();
      const heeftNaam = new Set(
        (bestaandeStraten ?? []).filter((s) => s.volledige_naam.trim()).map((s) => s.id),
      );
      // Eerste treffer wint: staan er al twee straten met dezelfde naam, dan
      // is dat de bovenste in de lijst, en niet een willekeurige.
      for (const s of bestaandeStraten ?? []) {
        const sleutel = straatSleutel(s.name);
        if (!map.has(sleutel)) map.set(sleutel, s.id);
      }

      // Namen die alleen in hoofdletters of spaties verschillen zijn dezelfde
      // straat. Zonder deze ontdubbeling maakt de import er twee, wint de
      // laatste in de map, en blijft de eerste leeg achter.
      const nieuweNamen: string[] = [];
      const gezien = new Set<string>();
      for (const naam of straten) {
        const sleutel = straatSleutel(naam);
        // De eerste schrijfwijze in het bestand wint: dat is de bovenste in
        // de lijst, en die herkent de gebruiker.
        if (map.has(sleutel) || gezien.has(sleutel)) continue;
        gezien.add(sleutel);
        nieuweNamen.push(naam);
      }

      if (nieuweNamen.length > 0) {
        const startOrder = map.size;
        const { data: nieuw, error } = await supabase
          .from("streets")
          .insert(
            nieuweNamen.map((name, i) => ({
              name,
              sort_order: startOrder + i,
              district_id: districtId!,
            })),
          )
          .select("id,name");
        if (error) throw error;
        (nieuw ?? []).forEach((s) => map.set(straatSleutel(s.name), s.id));
      }

      const zonderStraat = lijst.filter((r) => !map.has(straatSleutel(r.straat)));
      if (zonderStraat.length > 0) {
        // Kan niet gebeuren, maar als het toch gebeurt hoort het hard te
        // stoppen: half importeren is erger dan niet importeren.
        throw new Error(
          `Geen straat gevonden voor ${zonderStraat.length} adressen (${zonderStraat[0]!.straat}).`,
        );
      }

      // De officiële namen die bij het inlezen gekozen zijn meteen bij de
      // straat. Een straat die er al een had houdt de zijne.
      // Alleen als ze bij deze plaats opgezocht zijn.
      const opgezocht = meekijkPlaats === werkPlaats ? officieel : {};
      const namen = [...map.entries()].flatMap(([sleutel, id]) => {
        const naam = opgezocht[sleutel]?.naam.trim();
        return naam && !heeftNaam.has(id) ? [{ id, volledige_naam: naam }] : [];
      });
      if (namen.length > 0) await persistVolledigeNamen(namen);

      // Straten waar je bewust geen officiële naam koos: die niet alsnog invullen.
      const bewustLeeg = new Set(
        [...map.entries()]
          .filter(([sleutel, id]) => opgezocht[sleutel]?.naam === "" && !heeftNaam.has(id))
          .map(([, id]) => id),
      );

      const postcodeVan = (r: ImportRij) => {
        const naam = opgezocht[straatSleutel(r.straat)]?.naam;
        const kaart = naam ? kaarten[naam] : undefined;
        return kaart?.get(nummerSleutel(r.huisnummer, r.toevoeging)) ?? "";
      };

      // Adressen die al in deze straten staan (ook gestopte; niet die in de
      // prullenbak) slaan we over. Zo maakt dezelfde lijst nog eens importeren
      // — per ongeluk twee keer klikken, of opnieuw na een halve mislukking —
      // geen dubbele adressen.
      const adresSleutel = (straatId: string, nummer: number, toevoeging: string | null) =>
        `${straatId}|${nummer}|${(toevoeging ?? "").trim().toLowerCase()}`;
      const straatIds = [...new Set(lijst.map((r) => map.get(straatSleutel(r.straat))!))];
      /** Sleutel → id van het adres dat er al staat. */
      const bestaat = new Map<string, string>();
      for (let i = 0; i < straatIds.length; i += 100) {
        // In stukken: de server geeft er per keer hooguit 1000.
        const al = await haalAllePaginas((van, tot) =>
          supabase
            .from("customers")
            .select("id,street_id,house_number,addition")
            .in("street_id", straatIds.slice(i, i + 100))
            .is("deleted_at", null)
            .order("id")
            .range(van, tot),
        );
        for (const c of al)
          bestaat.set(adresSleutel(c.street_id, c.house_number, c.addition), c.id);
      }
      const nieuwInLijst = lijst.filter(
        (r) =>
          !bestaat.has(adresSleutel(map.get(straatSleutel(r.straat))!, r.huisnummer, r.toevoeging)),
      );
      const overgeslagen = lijst.length - nieuwInLijst.length;

      const payload = nieuwInLijst.map((r) => ({
        street_id: map.get(straatSleutel(r.straat))!,
        house_number: r.huisnummer,
        addition: r.toevoeging,
        // Al opgezocht bij het inlezen; wat er niet is, zoekt het aanvullen hierna.
        postcode: postcodeVan(r),
        note: r.notitie,
        // Het tabblad zegt of een notitie in de even of de oneven helft van
        // het jaar meegaat; dat is precies wat maandwerk beschrijft.
        maandwerk: maandwerkVanEvenOneven(r.notitieEven, r.notitieOneven) as unknown as Json,
        ...ritmeVelden(r.frequency),
        // Zo weet het dossier straks dat deze klant er vóór deze datum al was.
        geimporteerd: true,
      }));
      const { data: ingevoegd, error } =
        payload.length > 0
          ? await supabase
              .from("customers")
              .insert(payload)
              .select("id,street_id,house_number,addition")
          : { data: [], error: null };
      if (error) throw error;

      // De prijzen in hun eigen tabel. Op adres gekoppeld en niet op volgorde:
      // dan kan een prijs nooit bij het verkeerde huis terechtkomen.
      const sleutelVan = (straat: string, nummer: number, toevoeging: string | null) =>
        `${straat}|${nummer}|${(toevoeging ?? "").trim().toLowerCase()}`;
      const prijsVan = new Map(
        lijst.map((r) => [
          sleutelVan(map.get(straatSleutel(r.straat))!, r.huisnummer, r.toevoeging),
          r.prijs,
        ]),
      );
      const prijzen = (ingevoegd ?? []).map((c) => ({
        customer_id: c.id,
        prijs: prijsVan.get(sleutelVan(c.street_id, c.house_number, c.addition)) ?? 0,
      }));
      if (prijzen.length > 0) {
        const { error: prijsFout } = await supabase
          .from("adres_prijzen")
          .upsert(prijzen, { onConflict: "customer_id" });
        // Wie geen prijzen mag zien, importeert de adressen zonder bedragen.
        if (prijsFout && !isGeenRecht(prijsFout)) throw prijsFout;
      }
      // Overgeslagen adressen die nog géén prijs hebben (een vorige poging
      // mislukte net bij de prijzen) krijgen hem alsnog. Een bestaande prijs
      // blijft staan: ignoreDuplicates overschrijft niets.
      const ontbrekend = lijst.flatMap((r) => {
        const straatId = map.get(straatSleutel(r.straat))!;
        const id = bestaat.get(adresSleutel(straatId, r.huisnummer, r.toevoeging));
        return id ? [{ customer_id: id, prijs: r.prijs }] : [];
      });
      if (ontbrekend.length > 0) {
        const { error: aanvulFout } = await supabase
          .from("adres_prijzen")
          .upsert(ontbrekend, { onConflict: "customer_id", ignoreDuplicates: true });
        if (aanvulFout && !isGeenRecht(aanvulFout)) throw aanvulFout;
      }
      toast.success(
        `${payload.length} klanten geïmporteerd` +
          (overgeslagen > 0
            ? `; ${overgeslagen} ${overgeslagen === 1 ? "stond" : "stonden"} er al en ${overgeslagen === 1 ? "is" : "zijn"} overgeslagen`
            : ""),
      );

      if (!werkPlaats) {
        // Zonder plaats valt er niets op te zoeken; dan is het klaar.
        navigate({ to: "/" });
        return;
      }
      // Een fout vanaf hier is geen mislukte import: de adressen staan er al.
      // Zei de melding "Importeren mislukt", dan probeerde je opnieuw.
      try {
        await vulAan(districtId, werkPlaats, bewustLeeg);
      } catch (e) {
        toast.error(
          "De adressen zijn geïmporteerd, maar straatnamen en postcodes aanvullen lukte niet: " +
            (e as Error).message,
        );
      }
    } catch (e) {
      toast.error("Importeren mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <AppLayout titel="Importeren" onderschrift="Klanten uit een Excel-bestand inlezen">
      <div className="space-y-6">
        <div className="space-y-3 rounded-[18px] border border-border bg-card shadow-card p-4">
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
          className={`space-y-2 rounded-[18px] border-2 border-dashed p-4 transition-colors ${
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
          {/* Het kale bestandsveld van de browser ("Choose file — no file
              chosen") valt buiten elk thema; hier is het een gewone knop, met
              het echte veld eronder verstopt. */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="bestand"
              className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              <Upload className="size-4" /> Bestand kiezen
            </label>
            <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
              {bestandsnaam || "nog geen bestand gekozen"}
            </span>
          </div>
          <input
            id="bestand"
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void lees(file);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Straatnamen herkent hij aan de grijze vakjes; andere kleuren (zoals roze) worden
            genegeerd. Onder een straatnaam staan de huisnummers, met daarnaast de notitie en de
            prijs. Meerdere tabellen naast elkaar op één tabblad worden allemaal ingelezen. Staat
            een adres in beide tabbladen, dan wordt het automatisch "elke maand". Daarna kijkt
            Paaltje mee: hij zoekt de echte straatnamen op en ziet wat er verkeerd gelezen is.
          </p>
        </div>

        {lijst.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-[18px] border border-border bg-card shadow-card p-4">
              <p className="text-sm">
                <span className="font-medium">{bestandsnaam}</span> — {lijst.length} klanten in{" "}
                {straten.length} {straten.length === 1 ? "straat" : "straten"}
                {skipTabbladen.size > 0 &&
                  `, ${skipTabbladen.size} tabblad${skipTabbladen.size === 1 ? "" : "en"} overgeslagen`}
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
                      <span
                        className={`w-40 truncate text-sm ${skipped ? "text-muted-foreground line-through" : "text-foreground"}`}
                      >
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
                          {BASISRITMES.map((b) => (
                            <SelectItem key={b.waarde} value={b.waarde}>
                              {b.label}
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

            {werkboek && (
              <PaaltjePaneel
                stand={meekijk}
                plaats={werkPlaats}
                plaatsVeranderd={meekijk !== null && meekijkPlaats !== werkPlaats}
                voorstellen={voorstellen}
                straten={straatOverzicht}
                nakijken={nakijken}
                onOpnieuw={() => void meekijken(werkboek)}
                onToepassen={pasToe}
                onAfwijzen={wijsAf}
                onKiesNaam={kiesOfficieel}
                onBekijk={(label, b) => setBekijk({ label, bronnen: b })}
                onPrijs={(rijId, prijs) => wijzig(rijId, { prijs })}
                onNietMelden={(p) => setNietMelden((s) => new Set(s).add(`${p.rijId}|${p.reden}`))}
              />
            )}

            {verdacht.length > 0 && (
              <div className="space-y-3 rounded-[18px] bg-tint-geel p-4 text-tint-geel-ink shadow-card">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="size-4" />
                  Dit lijkt geen straatnaam — klopt dit?
                </div>
                {verdacht.map((v) => (
                  <div
                    key={v.straat}
                    className="space-y-2 rounded-[14px] bg-card/70 p-3 text-card-foreground"
                  >
                    <p className="text-sm">
                      <span className="font-semibold">“{v.straat}”</span>{" "}
                      <span className="opacity-80">({v.redenen.join(", ")})</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-8 max-w-56 bg-background text-foreground"
                        placeholder="Juiste straatnaam"
                        value={hernoemen[v.straat] ?? ""}
                        onChange={(e) =>
                          setHernoemen((h) => ({ ...h, [v.straat]: e.target.value }))
                        }
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setBekijk({ label: v.straat, bronnen: [bronnen[v.straat]!] })
                          }
                        >
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
                <span className="size-3 shrink-0 rounded-[4px] bg-tint-amber ring-1 ring-inset ring-tint-amber-ink/20" />
                {samengevoegd} {samengevoegd === 1 ? "adres staat" : "adressen staan"} in meer dan
                één tabblad. Hun notities zijn samengevoegd — ook als er maar in één maand iets
                stond. Kijk die even na.
              </p>
            )}

            <div className="rounded-[18px] border border-border bg-card shadow-card">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-card-header text-left text-[11px] font-medium text-muted-foreground/80">
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
                    <tr
                      key={r.id}
                      className={nakijkRijen.has(r.id) ? "bg-tint-roze/60" : undefined}
                      title={
                        nakijkRijen.has(r.id) ? "Kijk dit adres even na, zie hierboven" : undefined
                      }
                    >
                      <td className="px-2 py-1">
                        <InlineCel
                          value={r.straat}
                          onCommit={(v) => wijzig(r.id, { straat: v.trim() })}
                        />
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
                            wijzig(r.id, {
                              huisnummer: parseInt(m[1]!, 10),
                              toevoeging: m[2] ?? "",
                            });
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
                        {/* Bij het inlezen typ je gewoon de notitie; werk dat
                            maar in bepaalde maanden meegaat zet je daarna in
                            de wijklijst, waar je de maanden erbij ziet. */}
                        <NotitieCel
                          value={r.notitie}
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
                            {BASISRITMES.map((b) => (
                              <SelectItem key={b.waarde} value={b.waarde}>
                                {b.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td
                        className={`px-2 py-1 text-right ${r.prijs === 0 ? "text-destructive" : ""}`}
                      >
                        <InlineCel
                          align="right"
                          inputMode="decimal"
                          value={formatPrice(r.prijs)}
                          placeholder={formatPrice(0)}
                          onCommit={(v) =>
                            wijzig(r.id, {
                              prijs: Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0,
                            })
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
              <Button
                variant="outline"
                onClick={() => {
                  wisPaaltje();
                  setWerkboek(null);
                  setBestandsnaam("");
                }}
                disabled={bezig}
              >
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

const GEEL = "bg-tint-amber text-tint-amber-ink ring-1 ring-inset ring-tint-amber-ink/20";

/**
 * Wat Paaltje zag. Geel = al toegepast, met Ongedaan maken; wit = een
 * voorstel waar je zelf over beslist. Daaronder de straten met hun officiële
 * naam en de adressen om na te kijken.
 */
function PaaltjePaneel({
  stand,
  plaats,
  plaatsVeranderd,
  voorstellen,
  straten,
  nakijken,
  onOpnieuw,
  onToepassen,
  onAfwijzen,
  onKiesNaam,
  onBekijk,
  onPrijs,
  onNietMelden,
}: {
  stand: Meekijken | null;
  plaats: string;
  plaatsVeranderd: boolean;
  voorstellen: PaaltjeVoorstel[];
  straten: {
    naam: string;
    sleutel: string;
    adressen: number;
    opties: string[];
    gekozen: Officieel | null;
  }[];
  nakijken: Nakijkpunt[];
  onOpnieuw: () => void;
  onToepassen: (v: PaaltjeVoorstel, aan: boolean) => void;
  onAfwijzen: (v: PaaltjeVoorstel) => void;
  onKiesNaam: (straat: string, naam: string) => void;
  onBekijk: (label: string, bronnen: Bron[]) => void;
  onPrijs: (rijId: string, prijs: number) => void;
  onNietMelden: (p: Nakijkpunt) => void;
}) {
  const bezig = stand !== null && stand.stap !== "klaar";
  const toegepast = voorstellen.filter((v) => v.toegepast);
  const open = voorstellen.filter((v) => !v.toegepast);
  const zonderNaam = straten.filter((s) => !s.gekozen?.naam).length;

  const zin = (v: PaaltjeVoorstel) => {
    if (v.soort === "cel") {
      return v.wordt === "straat"
        ? `“${v.tekst}” is een straat`
        : `“${v.tekst}” is geen straat maar een notitie`;
    }
    if (v.soort === "zelfde") {
      return `${v.namen.map((n) => `“${n}”`).join(" en ")} zijn dezelfde straat: “${v.naam}”`;
    }
    return `“${v.straat}” heet officieel ${v.naam}`;
  };

  const kaart = (v: PaaltjeVoorstel) => (
    <div
      key={v.id}
      className={`flex flex-wrap items-center gap-2 rounded-[14px] p-3 text-sm ${
        v.toegepast ? GEEL : "bg-card/70 text-card-foreground ring-1 ring-inset ring-border"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{zin(v)}</p>
        {v.reden && <p className="text-[12.5px] opacity-80">{v.reden}</p>}
      </div>
      {v.soort === "cel" && (
        <Button size="sm" variant="ghost" onClick={() => onBekijk(v.tekst, [v.bron])}>
          <Eye className="size-4" /> Bekijken
        </Button>
      )}
      {v.toegepast ? (
        <Button size="sm" variant="outline" onClick={() => onToepassen(v, false)}>
          <Undo2 className="size-4" /> Ongedaan maken
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => onToepassen(v, true)}>
            <Check className="size-4" /> Toepassen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAfwijzen(v)}>
            Klopt niet
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4 rounded-[18px] border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-tint-paars-ink" />
        <p className="flex-1 text-sm font-medium">
          {stand === null
            ? "Paaltje kijkt mee"
            : stand.stap === "register"
              ? `Straatnamen opzoeken in ${plaats} — ${stand.gedaan}/${stand.totaal}`
              : stand.stap === "paaltje"
                ? "Paaltje kijkt het bestand na…"
                : stand.stap === "huisnummers"
                  ? `Huisnummers nakijken — ${stand.gedaan}/${stand.totaal}`
                  : toegepast.length + open.length === 0
                    ? "Paaltje keek mee en zag niets geks in hoe het bestand gelezen is"
                    : `Paaltje keek mee: ${toegepast.length} al aangepast, ${open.length} om zelf te kiezen`}
        </p>
        <Button size="sm" variant="outline" disabled={bezig} onClick={onOpnieuw}>
          {stand === null ? "Laten meekijken" : "Opnieuw"}
        </Button>
      </div>

      {stand?.fout && <p className="text-[12.5px] text-tint-amber-ink">{stand.fout}</p>}
      {plaats && plaatsVeranderd && !bezig && (
        <p className="rounded-[12px] bg-tint-amber p-2 text-[12.5px] text-tint-amber-ink">
          De plaats is veranderd. De straatnamen en postcodes hieronder horen nog bij de vorige
          plaats en worden niet opgeslagen. Druk op Opnieuw om ze in {plaats} op te zoeken.
        </p>
      )}
      {!plaats && (
        <p className="text-[12.5px] text-muted-foreground">
          Vul bovenaan de plaats in en druk op Opnieuw, dan zoekt hij ook de echte straatnamen en
          postcodes op.
        </p>
      )}

      {toegepast.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            Dit wist Paaltje zeker en heeft hij al aangepast
          </p>
          {toegepast.map(kaart)}
        </div>
      )}
      {open.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            Hier twijfelt hij — kies zelf
          </p>
          {open.map(kaart)}
        </div>
      )}

      {plaats && straten.some((s) => s.opties.length > 0 || s.gekozen) && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            Echte straatnamen — worden bij het importeren meteen opgeslagen
            {zonderNaam > 0 && `, ${zonderNaam} nog zonder`}
          </p>
          <div className="divide-y divide-border rounded-[14px] ring-1 ring-inset ring-border">
            {straten.map((s) => {
              const auto = s.gekozen && s.gekozen.hoe !== "jij" && s.gekozen.naam;
              const opties = [
                ...new Set([...s.opties, ...(s.gekozen?.naam ? [s.gekozen.naam] : [])]),
              ];
              return (
                <div
                  key={s.sleutel}
                  className={`flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm ${auto ? GEEL : ""}`}
                >
                  <span className="w-40 truncate font-medium" title={s.naam}>
                    {s.naam}
                  </span>
                  <span className="w-20 text-[12px] opacity-70">
                    {s.adressen} {s.adressen === 1 ? "adres" : "adressen"}
                  </span>
                  {opties.length === 0 ? (
                    <span className="flex-1 text-[12.5px] text-muted-foreground">
                      niet gevonden in {plaats}
                    </span>
                  ) : (
                    <Select
                      value={s.gekozen?.naam || "__geen__"}
                      onValueChange={(v) => onKiesNaam(s.naam, v === "__geen__" ? "" : v)}
                    >
                      <SelectTrigger className="h-8 w-64 bg-background text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__geen__">Geen van deze</SelectItem>
                        {opties.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {auto && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => onKiesNaam(s.naam, "")}
                    >
                      <Undo2 className="size-3.5" /> Ongedaan maken
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {nakijken.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            Kijk deze {nakijken.length === 1 ? "regel" : `${nakijken.length} regels`} even na
          </p>
          {nakijken.map((p) => (
            <div
              key={`${p.rijId}|${p.reden}`}
              className="flex flex-wrap items-center gap-2 rounded-[14px] bg-tint-roze p-3 text-sm text-tint-roze-ink"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.label}</p>
                <p className="text-[12.5px] opacity-80">{p.reden}</p>
              </div>
              {p.bronnen.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => onBekijk(p.label, p.bronnen)}>
                  <Eye className="size-4" /> Bekijken
                </Button>
              )}
              {p.prijs !== undefined && (
                <Button size="sm" variant="outline" onClick={() => onPrijs(p.rijId, p.prijs!)}>
                  Maak er {formatPrice(p.prijs)} van
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onNietMelden(p)}>
                Klopt wel
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
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
      <div className="max-h-[60vh] overflow-auto rounded-[14px] border border-border bg-card">
        <table
          className="border-collapse font-sans text-[11px] text-foreground"
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
                          ...(isDoel
                            ? { outline: "3px solid #f59e0b", outlineOffset: "-3px" }
                            : {}),
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
      <PopupKader className="max-h-[85vh] sm:max-w-6xl">
        <PopupKop
          kleur="paars"
          icoon={<FileSpreadsheet className="size-[22px]" />}
          titel={`“${straat}” in het originele bestand`}
          subtitel={`${bestandsnaam} — ${
            bruikbaar.length > 1
              ? `staat in ${bruikbaar.length} tabbladen`
              : `tabblad “${bruikbaar[0]?.tabblad ?? ""}”`
          }`}
        />
        <PopupBody>
          {bruikbaar.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={naast ? "default" : "outline"}
                onClick={() => setNaast(true)}
              >
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
            {(bruikbaar.length > 1 && naast ? bruikbaar : bruikbaar.slice(index, index + 1)).map(
              (b) => (
                <BronRaster key={b.tabblad} bron={b} grid={grids[b.tabblad]!} />
              ),
            )}
          </div>

          <PopupHint>
            Zo staat het in je Excel-bestand, met de originele kleuren. Het oranje omlijnde vakje is
            wat de app heeft ingelezen.
          </PopupHint>
        </PopupBody>
      </PopupKader>
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
    <div className="max-w-lg space-y-2 rounded-[18px] border border-border bg-card shadow-card p-4">
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
