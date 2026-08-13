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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  street: Street | null;
  onSaved: () => void;
}

export function StraatDialog({ open, onOpenChange, street, onSaved }: Props) {
  const [name, setName] = useState("");
  const [order, setOrder] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(street?.name ?? "");
    setOrder(String(street?.sort_order ?? 0));
  }, [open, street]);

  async function save() {
    if (!name.trim()) {
      toast.error("Vul een straatnaam in.");
      return;
    }
    setSaving(true);
    const payload = { name: name.trim(), sort_order: parseInt(order, 10) || 0 };
    const { error } = street
      ? await supabase.from("streets").update(payload).eq("id", street.id)
      : await supabase.from("streets").insert(payload);
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{street ? "Straat bewerken" : "Straat toevoegen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="straat">Straatnaam</Label>
            <Input id="straat" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="volgorde">Volgorde in je route</Label>
            <Input id="volgorde" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
            <p className="text-xs text-muted-foreground">Lager getal = eerder in de lijst.</p>
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
