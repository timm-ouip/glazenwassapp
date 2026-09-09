import { useEffect, useState } from "react";
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
import type { StraatGroep } from "@/lib/klanten";
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groep: StraatGroep | null;
  onOpslaan: (naam: string) => void;
}

/**
 * Alleen de naam van een subgroep veranderen. Aanmaken gebeurt in
 * StraatDialog, bij de straat die je erin zet — dat scheelt een tweede plek
 * waar je aan groepen kunt beginnen.
 */
export function GroepDialog({ open, onOpenChange, groep, onOpslaan }: Props) {
  const [naam, setNaam] = useState("");

  useEffect(() => {
    if (open) setNaam(groep?.naam ?? "");
  }, [open, groep]);

  function save() {
    if (!naam.trim()) {
      toast.error("Vul een naam in.");
      return;
    }
    onOpslaan(naam.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={opslaanBijEnter(save)}>
        <DialogHeader>
          <DialogTitle>Groep hernoemen</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="groepnaam">Naam</Label>
          <Input id="groepnaam" autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Waar dit stuk van de wijk voor jou naar heet: Noordkant, Achter het park.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={save}>Opslaan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
