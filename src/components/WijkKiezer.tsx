import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import {
  PopupBlok,
  PopupBody,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Check, Map, MapPin, MoreHorizontal, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  districts: District[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** "balk" is de gewone keuzelijst tussen de knoppen. "titel" maakt de
   *  naam van de wijk zelf de kop: groot, met een pijltje erachter om te
   *  wisselen, en de knopjes voor maken, hernoemen en weggooien klein ernaast. */
  variant?: "balk" | "titel";
  /** Hoeveel straten van deze wijk nog geen volledige naam hebben. Alleen de
   *  wijkenpagina weet dat; zonder onStraatnamen staat het item er niet. */
  straatnamenNodig?: number;
  /** Opent "Straatnamen aanvullen". Dat hoort bij de wijk en niet in de
   *  knoppenbalk: je doet het één keer per wijk en daarna nooit meer. */
  onStraatnamen?: () => void;
}

export function WijkKiezer({
  districts,
  activeId,
  onSelect,
  onChanged,
  variant = "balk",
  straatnamenNodig = 0,
  onStraatnamen,
}: Props) {
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
        "Alle straten en klanten in deze wijk gaan mee naar de geschiedenis. Je kunt ze daar terughalen.",
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

  // Als kop: de knopjes klein naast de naam, zodat de naam het grootst blijft.
  const klein = variant === "titel";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select value={activeId ?? ""} onValueChange={onSelect}>
        <SelectTrigger
          className={
            klein
              ? // Het gewone lettertype, niet het koplettertype: de wijk is geen
                // paginanaam maar de inhoud zelf.
                "mr-1 h-auto w-auto gap-1.5 border-0 bg-transparent p-0 font-sans text-[26px] font-medium leading-tight tracking-[-0.02em] shadow-none focus:ring-0 [&>svg]:size-5 [&>svg]:opacity-40"
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
      <Button
        size="sm"
        variant="outline"
        className={klein ? "h-7 rounded-full px-2.5 text-[12px]" : "rounded-full"}
        onClick={openNieuw}
      >
        <Plus className={klein ? "size-3.5" : "size-4"} /> Wijk
      </Button>
      {actief && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={`relative ${klein ? "size-7 rounded-full" : "size-9 rounded-full"}`}
              aria-label="Wijkopties"
            >
              <MoreHorizontal className={klein ? "size-4" : "size-5"} />
              {/* Een stipje zolang er nog straatnamen aan te vullen zijn:
                  anders zit dat werk verstopt in een menu dat je nooit opent. */}
              {straatnamenNodig > 0 && onStraatnamen && (
                <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-tint-amber-ink" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={openHernoem}>
              <Pencil className="size-4" /> Wijk hernoemen…
            </DropdownMenuItem>
            {onStraatnamen &&
              (straatnamenNodig > 0 ? (
                <DropdownMenuItem onSelect={onStraatnamen}>
                  <Wand2 className="size-4" /> Straatnamen aanvullen
                  <span className="ml-auto text-xs text-muted-foreground">
                    {straatnamenNodig}
                  </span>
                </DropdownMenuItem>
              ) : (
                // Niet weghalen als het klaar is: dan lijkt de app iets kwijt
                // te zijn. Een vinkje zegt dat er niets meer te doen is.
                <DropdownMenuItem disabled>
                  <Check className="size-4" /> Straatnamen zijn compleet
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={verwijder}>
              <Trash2 className="size-4" /> Wijk verwijderen…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}>
        <PopupKader className="sm:max-w-sm" onKeyDown={opslaanBijEnter(opslaan)}>
          <PopupKop
            icoon={<Map className="size-[22px]" />}
            titel={dialog.mode === "nieuw" ? "Wijk toevoegen" : "Wijk hernoemen"}
            subtitel={plaats.trim() || "Een ronde die je in één keer rijdt"}
          />
          <PopupBody>
            <PopupBlok label="Naam van de wijk">
              <PopupVeld icoon={<Map className="size-4" />}>
                <Input
                  id="wijknaam"
                  className={popupInvoer}
                  placeholder="bijv. Madestein"
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                />
              </PopupVeld>
            </PopupBlok>
            <PopupBlok
              label="Plaats"
              info="Hiermee worden straatnamen en postcodes automatisch opgehaald. Gebruik de echte woonplaats, ook als de wijk anders heet — Madestein ligt in 's-Gravenhage."
            >
              <PopupVeld icoon={<MapPin className="size-4" />}>
                <Input
                  id="wijkplaats"
                  list="wijk-plaatsen"
                  className={popupInvoer}
                  placeholder="Gouda"
                  value={plaats}
                  onChange={(e) => setPlaats(e.target.value)}
                />
              </PopupVeld>
              <datalist id="wijk-plaatsen">
                {plaatsSuggesties.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </PopupBlok>
          </PopupBody>
          <PopupVoet>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setDialog((s) => ({ ...s, open: false }))}
            >
              Annuleren
            </Button>
            <Button className="rounded-full" onClick={opslaan} disabled={bezig}>
              {bezig ? "Bezig…" : "Opslaan"}
            </Button>
          </PopupVoet>
        </PopupKader>
      </Dialog>
    </div>
  );
}
