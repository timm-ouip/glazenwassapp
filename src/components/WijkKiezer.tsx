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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  addDistrict,
  deleteDistrict,
  haalTerug,
  renameDistrict,
  wijkKleur,
  type District,
} from "@/lib/klanten";
import { pushUndo, undoLaatste } from "@/lib/undo";
import { zoekWoonplaatsen } from "@/lib/postcode";
import { useBevestig } from "@/components/Bevestig";
import { TITEL_KLASSEN } from "@/components/AppLayout";
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  districts: District[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** "balk" is de gewone keuzelijst tussen de knoppen. "titel" maakt de
   *  paginakop zelf aanklikbaar: je wisselt van wijk door op de naam te
   *  klikken, wat een keuzevak in de knoppenbalk scheelt. */
  variant?: "balk" | "titel";
}

export function WijkKiezer({ districts, activeId, onSelect, onChanged, variant = "balk" }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; mode: "nieuw" | "hernoem" }>({
    open: false,
    mode: "nieuw",
  });
  const [naam, setNaam] = useState("");
  const [plaats, setPlaats] = useState("");
  const [plaatsSuggesties, setPlaatsSuggesties] = useState<string[]>([]);
  const [bezig, setBezig] = useState(false);
  const bevestig = useBevestig();

  const actief = districts.find((d) => d.id === activeId) ?? null;

  // Woonplaatsen voorstellen zodra er iets getypt is.
  useEffect(() => {
    if (!dialog.open || plaats.trim().length < 2) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekWoonplaatsen(plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setPlaatsSuggesties(namen);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [dialog.open, plaats]);

  function openNieuw() {
    setNaam("");
    // Een nieuwe wijk ligt bijna altijd in dezelfde plaats als de vorige.
    setPlaats(actief?.plaats ?? "");
    setDialog({ open: true, mode: "nieuw" });
  }

  function openHernoem() {
    if (!actief) return;
    setNaam(actief.name);
    setPlaats(actief.plaats);
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
        const wijk = await addDistrict(naam.trim(), plaats);
        onChanged();
        onSelect(wijk.id);
        toast.success("Wijk toegevoegd");
      } else if (actief) {
        await renameDistrict(actief.id, naam.trim(), plaats);
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
      tekst:
        "Alle straten en klanten in deze wijk gaan mee naar de prullenbak. Je kunt ze daar terughalen.",
      gevaarlijk: true,
    });
    if (!ja) return;
    const weg = actief;
    try {
      await deleteDistrict(weg.id);
      const rest = districts.filter((d) => d.id !== weg.id);
      onChanged();
      if (rest[0]) onSelect(rest[0].id);
      pushUndo({
        label: `Verwijderen wijk ${weg.name}`,
        undo: async () => {
          await haalTerug("districts", [weg.id]);
          onChanged();
          onSelect(weg.id);
        },
      });
      toast(`Wijk "${weg.name}" verwijderd`, {
        duration: 12000,
        action: {
          label: "Ongedaan maken",
          onClick: () => {
            void undoLaatste().then((label) => {
              if (label) toast.success("Teruggedraaid: " + label);
            });
          },
        },
      });
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
    }
  }

  const alsTitel = variant === "titel";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select value={activeId ?? ""} onValueChange={onSelect}>
        <SelectTrigger
          className={
            alsTitel
              ? `${TITEL_KLASSEN} h-auto w-auto gap-1.5 border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:size-5 [&>svg]:opacity-40`
              : "h-9 w-52 rounded-full bg-card"
          }
          aria-label="Wijk kiezen"
        >
          <SelectValue placeholder="Kies een wijk" />
        </SelectTrigger>
        <SelectContent>
          {districts.map((d, i) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="flex items-center gap-2">
                {/* Dezelfde kleur als op de planningskalender, zodat je daar
                    aan de stip ziet welke wijk er die dag aan de beurt is. */}
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: wijkKleur(i) }}
                />
                {d.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="rounded-full" onClick={openNieuw}>
        <Plus className="size-4" /> Wijk
      </Button>
      {actief && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-9 rounded-full"
            onClick={openHernoem}
            aria-label="Wijk hernoemen"
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-9 rounded-full"
            onClick={verwijder}
            aria-label="Wijk verwijderen"
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}>
        <DialogContent className="sm:max-w-sm" onKeyDown={opslaanBijEnter(opslaan)}>
          <DialogHeader>
            <DialogTitle>
              {dialog.mode === "nieuw" ? "Wijk toevoegen" : "Wijk hernoemen"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wijknaam">Naam van de wijk</Label>
              <Input id="wijknaam" value={naam} onChange={(e) => setNaam(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wijkplaats">Plaats</Label>
              <Input
                id="wijkplaats"
                list="wijk-plaatsen"
                placeholder="Gouda"
                value={plaats}
                onChange={(e) => setPlaats(e.target.value)}
              />
              <datalist id="wijk-plaatsen">
                {plaatsSuggesties.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                De echte woonplaats, ook als de wijk anders heet — "Madestein" ligt in
                &apos;s-Gravenhage. Hiermee worden straatnamen en postcodes opgezocht.
              </p>
            </div>
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
