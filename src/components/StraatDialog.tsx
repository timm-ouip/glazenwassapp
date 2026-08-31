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
import { toast } from "sonner";
import type { Street } from "@/lib/klanten";
import { zoekStraten } from "@/lib/postcode";
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  street: Street | null;
  districtId?: string | undefined;
  /** Woonplaats van de wijk; nodig om straatnamen te kunnen voorstellen. */
  plaats?: string | undefined;
  onSaved: () => void;
}

export function StraatDialog({ open, onOpenChange, street, districtId, plaats, onSaved }: Props) {
  const [name, setName] = useState("");
  const [volledig, setVolledig] = useState("");
  const [suggesties, setSuggesties] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(street?.name ?? "");
    setVolledig(street?.volledige_naam ?? "");
    setSuggesties([]);
  }, [open, street]);

  // Officiële straatnamen voorstellen op basis van wat er in het korte veld
  // staat: "Ameland" leidt zo naar Amelandstraat.
  useEffect(() => {
    if (!open || !plaats?.trim()) return;
    const zoekterm = volledig.trim() || name.trim();
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(zoekterm, plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setSuggesties(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, plaats, name, volledig]);

  async function save() {
    if (!name.trim()) {
      toast.error("Vul een straatnaam in.");
      return;
    }
    setSaving(true);
    const payload = { name: name.trim(), volledige_naam: volledig.trim() };
    const { error } = street
      ? await supabase.from("streets").update(payload).eq("id", street.id)
      : await supabase
          .from("streets")
          .insert({ ...payload, sort_order: 0, district_id: districtId! });
    setSaving(false);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      return;
    }
    toast.success(street ? "Straat bijgewerkt" : "Straat toegevoegd");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={opslaanBijEnter(save)}>
        <DialogHeader>
          <DialogTitle>{street ? "Straat bewerken" : "Straat toevoegen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="straat">Naam op de lijst</Label>
            <Input id="straat" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Kort houden — zo staat hij op de printlijst.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="volledig">Volledige straatnaam</Label>
            <Input
              id="volledig"
              list="straat-suggesties"
              placeholder={name.trim() ? `bijv. ${name.trim()}straat` : "Amelandstraat"}
              value={volledig}
              onChange={(e) => setVolledig(e.target.value)}
            />
            <datalist id="straat-suggesties">
              {suggesties.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              De officiële naam, waarmee postcodes opgezocht worden. Mag leeg blijven als dit geen
              echte straat is, zoals een blok of complex.
            </p>
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
