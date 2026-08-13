import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineCel } from "@/components/InlineCel";
import { NotitieCel } from "@/components/NotitieCel";
import {
  addDistrict,
  addQuickNote,
  fetchDistricts,
  fetchQuickNotes,
  frequencyLabels,
  formatPrice,
  type District,
  type Frequency,
  type QuickNote,
} from "@/lib/klanten";


export const Route = createFileRoute("/importeren")({
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
}

function parseNummer(value: unknown): { nummer: number; toevoeging: string } | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { nummer: Math.trunc(value), toevoeging: "" };
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*([a-zA-Z-]*)$/);
    if (match) return { nummer: parseInt(match[1]!, 10), toevoeging: (match[2] ?? "").trim() };
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

/**
 * Leest een tabblad met één of meerdere naast elkaar staande tabellen.
 * Elk blok: kolom met huisnummers (grijze straatkop erboven), daarnaast notitie en prijs.
 */
function leesTabblad(sheet: XLSX.WorkSheet, sheetName: string): RijPreview[] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const cel = (r: number, c: number) => sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

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
  for (const c of kolommen) {
    let straat = "";
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = cel(r, c);
      const waarde = cell?.v;
      if (waarde === undefined || waarde === null || String(waarde).trim() === "") continue;
      const nummer = parseNummer(waarde);
      if (!nummer) {
        if (kopKolommen.size === 0 || isGrijs(cell)) straat = String(waarde).trim();
        continue;
      }
      if (!straat) continue;
      const prijsCel = cel(r, c + 2)?.v;
      rijen.push({
        tabblad: sheetName,
        straat,
        huisnummer: nummer.nummer,
        toevoeging: nummer.toevoeging,
        notitie: tekst(cel(r, c + 1)),
        prijs:
          typeof prijsCel === "number" ? prijsCel : Number(String(prijsCel ?? "").replace(",", ".")) || 0,
      });
    }
  }
  return rijen;
}


interface ImportRij {
  id: string;
  straat: string;
  huisnummer: number;
  toevoeging: string;
  notitie: string;
  prijs: number;
  frequency: Frequency;
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
  const navigate = useNavigate();
  const [rijen, setRijen] = useState<RijPreview[]>([]);
  const [lijst, setLijst] = useState<ImportRij[]>([]);
  const [bestandsnaam, setBestandsnaam] = useState("");
  const [freqPerTabblad, setFreqPerTabblad] = useState<Record<string, Frequency>>({});
  const [bezig, setBezig] = useState(false);
  const [wijken, setWijken] = useState<District[]>([]);
  const [wijkId, setWijkId] = useState<string>("");
  const [nieuweWijk, setNieuweWijk] = useState("");
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([]);
  const [hernoemen, setHernoemen] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchDistricts()
      .then((d) => {
        setWijken(d);
        setWijkId((huidig) => huidig || d[0]?.id || "__nieuw__");
      })
      .catch(() => toast.error("Wijken laden mislukt"));
    fetchQuickNotes().then(setQuickNotes).catch(() => undefined);
  }, []);

  const tabbladen = useMemo(() => [...new Set(rijen.map((r) => r.tabblad))], [rijen]);
  const straten = useMemo(() => [...new Set(lijst.map((r) => r.straat))], [lijst]);
  const verdacht = useMemo(() => verdachteStraten(lijst, quickNotes), [lijst, quickNotes]);

  /** Adressen die in meerdere tabbladen staan worden samengevoegd tot "elke maand". */
  useEffect(() => {
    const map = new Map<string, ImportRij>();
    for (const r of rijen) {
      const sleutel = `${r.straat.toLowerCase()}|${r.huisnummer}|${r.toevoeging.toLowerCase()}`;
      const freq = freqPerTabblad[r.tabblad] ?? "elke";
      const bestaand = map.get(sleutel);
      if (!bestaand) {
        map.set(sleutel, {
          id: sleutel,
          straat: r.straat,
          huisnummer: r.huisnummer,
          toevoeging: r.toevoeging,
          notitie: r.notitie,
          prijs: r.prijs,
          frequency: freq,
        });
      } else if (bestaand.frequency !== freq) {
        map.set(sleutel, { ...bestaand, frequency: "elke" });
      }
    }
    setLijst([...map.values()]);
    setHernoemen({});
  }, [rijen, freqPerTabblad]);

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
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        freq[sheetName] = raadFrequentie(sheetName);
        gevonden.push(...leesTabblad(sheet, sheetName));
      }
      setBestandsnaam(file.name);
      setFreqPerTabblad(freq);
      setRijen(gevonden);
      if (gevonden.length === 0) toast.error("Geen klanten herkend in dit bestand.");
    } catch (e) {
      toast.error("Bestand kon niet gelezen worden.");
      console.error(e);
    }
  }


  async function importeer() {
    if (lijst.length === 0) return;
    setBezig(true);
    try {
      let districtId = wijkId;
      if (districtId === "__nieuw__") {
        if (!nieuweWijk.trim()) throw new Error("Vul een naam voor de nieuwe wijk in.");
        const wijk = await addDistrict(nieuweWijk.trim());
        districtId = wijk.id;
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
        price: r.prijs,
        frequency: r.frequency,
      }));
      const { error } = await supabase.from("customers").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} klanten geïmporteerd`);
      navigate({ to: "/" });
    } catch (e) {
      toast.error("Importeren mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }


  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4">
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" /> Terug
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Excel importeren</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <Label>In welke wijk komt dit bestand?</Label>
          <Select value={wijkId} onValueChange={setWijkId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Kies een wijk" />
            </SelectTrigger>
            <SelectContent>
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
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <Label htmlFor="bestand">Kies je Excel-bestand (.xlsx)</Label>
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
                {rijen.length !== lijst.length
                  ? ` (${rijen.length - lijst.length} regels samengevoegd of verwijderd)`
                  : ""}
                .
              </p>
              <div className="mt-4 space-y-3">
                <Label>Frequentie per tabblad</Label>
                {tabbladen.map((t) => (
                  <div key={t} className="flex items-center gap-3">
                    <span className="w-40 truncate text-sm text-muted-foreground">{t}</span>
                    <Select
                      value={freqPerTabblad[t] ?? "elke"}
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
                  </div>
                ))}
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
                      <Button size="sm" variant="ghost" onClick={() => verwijderStraat(v.straat)}>
                        <Trash2 className="size-4" /> {v.aantal} regels weggooien
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Straat</th>
                    <th className="px-3 py-2">Nr.</th>
                    <th className="px-3 py-2">Notitie</th>
                    <th className="px-3 py-2">Frequentie</th>
                    <th className="px-3 py-2 text-right">Prijs</th>
                    <th className="w-10 px-2 py-2" />
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
                      <td className="px-2 py-1">
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
                          <SelectTrigger className="h-7 w-36 text-xs">
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
                      <td className="px-2 py-1 text-right">
                        <InlineCel
                          align="right"
                          inputMode="decimal"
                          value={r.prijs ? String(r.prijs).replace(".", ",") : ""}
                          placeholder={formatPrice(0)}
                          onCommit={(v) =>
                            wijzig(r.id, { prijs: Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })
                          }
                        />
                      </td>
                      <td className="px-1 py-1">
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
          </div>
        )}

      </main>
    </div>
  );
}
