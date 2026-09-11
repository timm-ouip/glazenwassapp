import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  BASISRITMES,
  basisRitmeVan,
  ritmeLabel,
  type BasisRitme,
  noteTokens,
  toggleNoteToken,
  type Customer,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { Plus } from "lucide-react";
import { opslaanBijEnter } from "@/lib/dialoog";
import { eersteBeurtVanaf, maandSleutel } from "@/lib/klanten";

function startMaandVoorNieuw(ritme: {
  interval_maanden: number;
  ritme: number;
}): { start_maand?: string } {
  const dezeMaand = maandSleutel(new Date());
  const start = eersteBeurtVanaf(dezeMaand, ritme);
  return start === dezeMaand ? {} : { start_maand: start };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streets: Street[];
  customer: Customer | null;
  defaultStreetId?: string | undefined;
  /** Het nummer dat je al in "+ adres" typte; dan staat de cursor meteen bij de prijs. */
  defaultNumber?: string | undefined;
  /** Plek in de straat voor een nieuw adres: achteraan, zoals je hem intypt. */
  nieuweSortOrder?: number | undefined;
  quickNotes: QuickNote[];
  onAddQuickNote: (label: string) => void;
  onSaved: () => void;
}

export function KlantDialog({
  open,
  onOpenChange,
  streets,
  customer,
  defaultStreetId,
  defaultNumber,
  nieuweSortOrder,
  quickNotes,
  onAddQuickNote,
  onSaved,
}: Props) {
  const [nieuweSnelkeuze, setNieuweSnelkeuze] = useState("");
  const [streetId, setStreetId] = useState("");
  const [number, setNumber] = useState("");
  const [addition, setAddition] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  // Leeg bij een nieuw adres: de frequentie kies je zelf, anders staat er
  // ongemerkt "elke maand" op een adres dat om de twee moet.
  const [ritme, setRitme] = useState<BasisRitme | "anders" | "">("");
  const [saving, setSaving] = useState(false);
  const prijsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStreetId(customer?.street_id ?? defaultStreetId ?? streets[0]?.id ?? "");
    setNumber(customer ? String(customer.house_number) : (defaultNumber ?? ""));
    setAddition(customer?.addition ?? "");
    setNote(customer?.note ?? "");
    setPrice(customer ? String(customer.price) : "");
    setRitme(customer ? basisRitmeVan(customer) : "");
  }, [open, customer, defaultStreetId, defaultNumber, streets]);

  async function save() {
    const huisnummer = parseInt(number, 10);
    if (!streetId || Number.isNaN(huisnummer)) {
      toast.error("Kies een straat en vul een huisnummer in.");
      return;
    }
    const prijs = Number(price.trim().replace(",", "."));
    if (price.trim() === "" || Number.isNaN(prijs)) {
      toast.error("Vul een prijs in.");
      prijsRef.current?.focus();
      return;
    }
    if (ritme === "") {
      toast.error("Kies een frequentie.");
      return;
    }
    setSaving(true);
    const basis = BASISRITMES.find((b) => b.waarde === ritme);
    const payload = {
      street_id: streetId,
      house_number: huisnummer,
      addition: addition.trim(),
      note: note.trim(),
      price: prijs,
      // Bij "anders" laten we het ritme staan: dat stel je in de wijklijst in,
      // waar de maanden erbij staan.
      ...(basis ? { interval_maanden: basis.interval_maanden, ritme: basis.ritme } : {}),
      ...(!customer && nieuweSortOrder !== undefined ? { sort_order: nieuweSortOrder } : {}),
      // Een nieuw adres begint in de eerste maand van zijn ritme: maak je in
      // september een adres voor de even maanden, dan is hij pas in oktober
      // nieuw. Valt deze maand al in het ritme, dan hoeft er niets vast.
      ...(!customer && basis ? startMaandVoorNieuw(basis) : {}),
    };
    const { error } = customer
      ? await supabase.from("customers").update(payload).eq("id", customer.id)
      : await supabase.from("customers").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      return;
    }
    toast.success(customer ? "Klant bijgewerkt" : "Klant toegevoegd");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-md"
        onKeyDown={opslaanBijEnter(save)}
        onOpenAutoFocus={(e) => {
          // Kwam je via "+ adres", dan staan straat en nummer er al: begin bij de prijs.
          if (!customer && defaultNumber) {
            e.preventDefault();
            prijsRef.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{customer ? "Klant bewerken" : "Klant toevoegen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Straat</Label>
            <Select value={streetId} onValueChange={setStreetId}>
              <SelectTrigger>
                <SelectValue placeholder="Kies een straat" />
              </SelectTrigger>
              <SelectContent>
                {streets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nr">Huisnummer</Label>
              <Input
                id="nr"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toev">Toevoeging</Label>
              <Input
                id="toev"
                placeholder="a, bis…"
                value={addition}
                onChange={(e) => setAddition(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notitie">Notitie</Label>
            <Input id="notitie" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {quickNotes.map((q) => {
                const aan = noteTokens(note).some((t) => t.toLowerCase() === q.label.toLowerCase());
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setNote(toggleNoteToken(note, q.label))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      aan
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 pt-1">
              <Input
                value={nieuweSnelkeuze}
                placeholder="Nieuwe snelkeuze"
                className="h-8 text-xs"
                onChange={(e) => setNieuweSnelkeuze(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nieuweSnelkeuze.trim()) {
                    e.preventDefault();
                    onAddQuickNote(nieuweSnelkeuze.trim());
                    setNieuweSnelkeuze("");
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => {
                  if (!nieuweSnelkeuze.trim()) return;
                  onAddQuickNote(nieuweSnelkeuze.trim());
                  setNieuweSnelkeuze("");
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="prijs">Prijs (€)</Label>
              <Input
                id="prijs"
                ref={prijsRef}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Frequentie</Label>
              <Select value={ritme} onValueChange={(v) => setRitme(v as BasisRitme)}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies…" />
                </SelectTrigger>
                <SelectContent>
                  {BASISRITMES.map((b) => (
                    <SelectItem key={b.waarde} value={b.waarde}>
                      {b.label}
                    </SelectItem>
                  ))}
                  {ritme === "anders" && customer && (
                    <SelectItem value="anders" disabled>
                      {ritmeLabel(customer)} (stel je in de lijst in)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
