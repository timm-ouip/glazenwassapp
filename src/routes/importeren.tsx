import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  addDistrict,
  fetchDistricts,
  frequencyLabels,
  formatPrice,
  type District,
  type Frequency,
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

function ImportPagina() {
  const navigate = useNavigate();
  const [rijen, setRijen] = useState<RijPreview[]>([]);
  const [bestandsnaam, setBestandsnaam] = useState("");
  const [freqPerTabblad, setFreqPerTabblad] = useState<Record<string, Frequency>>({});
  const [bezig, setBezig] = useState(false);
  const [wijken, setWijken] = useState<District[]>([]);
  const [wijkId, setWijkId] = useState<string>("");
  const [nieuweWijk, setNieuweWijk] = useState("");

  useEffect(() => {
    fetchDistricts()
      .then((d) => {
        setWijken(d);
        setWijkId((huidig) => huidig || d[0]?.id || "__nieuw__");
      })
      .catch(() => toast.error("Wijken laden mislukt"));
  }, []);

  const tabbladen = useMemo(() => [...new Set(rijen.map((r) => r.tabblad))], [rijen]);
  const straten = useMemo(() => [...new Set(rijen.map((r) => r.straat))], [rijen]);

  /** Adressen die in meerdere tabbladen staan worden samengevoegd tot "elke maand". */
  const teImporteren = useMemo(() => {
    const map = new Map<string, RijPreview & { frequency: Frequency }>();
    for (const r of rijen) {
      const sleutel = `${r.straat.toLowerCase()}|${r.huisnummer}|${r.toevoeging.toLowerCase()}`;
      const freq = freqPerTabblad[r.tabblad] ?? "elke";
      const bestaand = map.get(sleutel);
      if (!bestaand) {
        map.set(sleutel, { ...r, frequency: freq });
      } else if (bestaand.frequency !== freq) {
        map.set(sleutel, { ...bestaand, frequency: "elke" });
      }
    }
    return [...map.values()];
  }, [rijen, freqPerTabblad]);

  async function lees(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const gevonden: RijPreview[] = [];
      const freq: Record<string, Frequency> = {};
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        freq[sheetName] = raadFrequentie(sheetName);
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
        let straat = "";
        for (const row of rows) {
          const a = row?.[0];
          if (a === undefined || a === null || String(a).trim() === "") continue;
          const nummer = parseNummer(a);
          if (!nummer) {
            straat = String(a).trim();
            continue;
          }
          if (!straat) continue;
          const prijsCel = row?.[2];
          gevonden.push({
            tabblad: sheetName,
            straat,
            huisnummer: nummer.nummer,
            toevoeging: nummer.toevoeging,
            notitie: row?.[1] === undefined || row?.[1] === null ? "" : String(row[1]).trim(),
            prijs:
              typeof prijsCel === "number"
                ? prijsCel
                : Number(String(prijsCel ?? "").replace(",", ".")) || 0,
          });
        }
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
    if (teImporteren.length === 0) return;
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


      const payload = teImporteren.map((r) => ({
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
            Verwacht per tabblad: straatnaam in kolom A, daaronder huisnummers in kolom A, notitie in kolom B
            en prijs in kolom C. Staat een adres in beide tabbladen, dan wordt het automatisch "elke maand".
          </p>
        </div>

        {rijen.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm">
                <span className="font-medium">{bestandsnaam}</span> — {teImporteren.length} klanten in{" "}
                {straten.length} {straten.length === 1 ? "straat" : "straten"}
                {rijen.length !== teImporteren.length
                  ? ` (${rijen.length - teImporteren.length} dubbele adressen samengevoegd)`
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

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Straat</th>
                    <th className="px-3 py-2">Nr.</th>
                    <th className="px-3 py-2">Notitie</th>
                    <th className="px-3 py-2">Frequentie</th>
                    <th className="px-3 py-2 text-right">Prijs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {teImporteren.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5">{r.straat}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {r.huisnummer}
                        {r.toevoeging}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.notitie}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{frequencyLabels[r.frequency]}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatPrice(r.prijs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {teImporteren.length > 100 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Eerste 100 rijen getoond, alle {teImporteren.length} worden geïmporteerd.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={importeer} disabled={bezig}>
                {bezig ? "Bezig…" : `${teImporteren.length} klanten importeren`}
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
