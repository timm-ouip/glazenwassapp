import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  frequencyLabels,
  veelgebruikteNotities,
  type Customer,
  type Frequency,
  type Street,
} from "@/lib/klanten";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streets: Street[];
  customer: Customer | null;
  defaultStreetId?: string | undefined;
  onSaved: () => void;
}

export function KlantDialog({ open, onOpenChange, streets, customer, defaultStreetId, onSaved }: Props) {
  const [streetId, setStreetId] = useState("");
  const [number, setNumber] = useState("");
  const [addition, setAddition] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("elke");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStreetId(customer?.street_id ?? defaultStreetId ?? streets[0]?.id ?? "");
    setNumber(customer ? String(customer.house_number) : "");
    setAddition(customer?.addition ?? "");
    setNote(customer?.note ?? "");
    setPrice(customer ? String(customer.price) : "");
    setFrequency(customer?.frequency ?? "elke");
  }, [open, customer, defaultStreetId, streets]);

  async function save() {
    const huisnummer = parseInt(number, 10);
    if (!streetId || Number.isNaN(huisnummer)) {
      toast.error("Kies een straat en vul een huisnummer in.");
      return;
    }
    setSaving(true);
    const payload = {
      street_id: streetId,
      house_number: huisnummer,
      addition: addition.trim(),
      note: note.trim(),
      price: price.trim() === "" ? 0 : Number(price.replace(",", ".")),
      frequency,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
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
              <Input id="nr" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toev">Toevoeging</Label>
              <Input id="toev" placeholder="a, bis…" value={addition} onChange={(e) => setAddition(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notitie">Notitie</Label>
            <Input id="notitie" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {veelgebruikteNotities.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNote(n)}
                  className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="prijs">Prijs (€)</Label>
              <Input id="prijs" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Frequentie</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger>
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
