import { useState } from "react";
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { addDistrict, deleteDistrict, renameDistrict, type District } from "@/lib/klanten";
import { useBevestig } from "@/components/Bevestig";

interface Props {
  districts: District[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}

export function WijkKiezer({ districts, activeId, onSelect, onChanged }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; mode: "nieuw" | "hernoem" }>({
    open: false,
    mode: "nieuw",
  });
  const [naam, setNaam] = useState("");
  const [bezig, setBezig] = useState(false);
  const bevestig = useBevestig();

  const actief = districts.find((d) => d.id === activeId) ?? null;

  function openNieuw() {
    setNaam("");
    setDialog({ open: true, mode: "nieuw" });
  }

  function openHernoem() {
    if (!actief) return;
    setNaam(actief.name);
    setDialog({ open: true, mode: "hernoem" });
  }

  async function opslaan() {
    if (!naam.trim()) {
      toast.error("Vul een naam in.");
      return;
    }
    setBezig(true);
    try {
      if (dialog.mode === "nieuw") {
        const wijk = await addDistrict(naam.trim());
        onChanged();
        onSelect(wijk.id);
        toast.success("Wijk toegevoegd");
      } else if (actief) {
        await renameDistrict(actief.id, naam.trim());
        onChanged();
        toast.success("Wijk hernoemd");
      }
      setDialog((s) => ({ ...s, open: false }));
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function verwijder() {
    if (!actief) return;
    const ja = await bevestig({
      titel: `Wijk "${actief.name}" verwijderen?`,
      tekst: "Alle straten en klanten in deze wijk gaan mee. Dit kan niet ongedaan gemaakt worden.",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await deleteDistrict(actief.id);
      const rest = districts.filter((d) => d.id !== actief.id);
      onChanged();
      if (rest[0]) onSelect(rest[0].id);
      toast.success("Wijk verwijderd");
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={activeId ?? ""} onValueChange={onSelect}>
        <SelectTrigger className="h-9 w-52 rounded-full bg-card">
          <SelectValue placeholder="Kies een wijk" />
        </SelectTrigger>
        <SelectContent>
          {districts.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="rounded-full" onClick={openNieuw}>
        <Plus className="size-4" /> Wijk
      </Button>
      {actief && (
        <>
          <Button size="icon" variant="ghost" className="size-9 rounded-full" onClick={openHernoem} aria-label="Wijk hernoemen">
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-9 rounded-full" onClick={verwijder} aria-label="Wijk verwijderen">
            <Trash2 className="size-4" />
          </Button>
        </>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialog.mode === "nieuw" ? "Wijk toevoegen" : "Wijk hernoemen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wijknaam">Naam van de wijk</Label>
            <Input
              id="wijknaam"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void opslaan();
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialog((s) => ({ ...s, open: false }))}>
              Annuleren
            </Button>
            <Button onClick={opslaan} disabled={bezig}>
              {bezig ? "Bezig…" : "Opslaan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
