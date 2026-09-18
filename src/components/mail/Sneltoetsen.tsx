/** Het overzicht van de sneltoetsen (toets ?). Standaard die van het
 *  postvak; de wijkenpagina geeft zijn eigen lijst mee. */
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import { PopupBody, PopupKader, PopupKop } from "@/components/Popup";
import { IconKeyboard as Keyboard } from "@tabler/icons-react";

export const SNELTOETSEN: [string, string][] = [
  ["k / ↓", "Volgende mail"],
  ["j / ↑", "Vorige mail"],
  ["Enter / o", "Mail openen"],
  ["e", "Afgehandeld"],
  ["r", "Beantwoorden"],
  ["a", "Allen beantwoorden"],
  ["f", "Doorsturen"],
  ["# / Delete", "Weggooien"],
  ["u", "Gelezen / ongelezen"],
  ["s", "Vlag erop / eraf"],
  ["x", "Selecteren"],
  ["c", "Nieuwe mail"],
  ["/", "Zoeken"],
  ["Esc", "Selectie wissen"],
  ["?", "Dit overzicht"],
];

export function SneltoetsenHulp({
  open,
  onSluit,
  toetsen = SNELTOETSEN,
  waarvoor = "Toetsen om sneller met je mail te werken",
}: {
  open: boolean;
  onSluit: () => void;
  toetsen?: [string, string][];
  waarvoor?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm" aria-describedby="sneltoetsen-uitleg">
        <DialogDescription id="sneltoetsen-uitleg" className="sr-only">
          {waarvoor}
        </DialogDescription>
        <PopupKop
          icoon={<Keyboard className="size-5" />}
          titel="Sneltoetsen"
          subtitel="Werkt als je niet in een tekstvak typt"
        />
        <PopupBody className="gap-1.5">
          {toetsen.map(([toets, wat]) => (
            <div key={toets} className="flex items-center justify-between gap-3 text-[13px]">
              <span>{wat}</span>
              <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">
                {toets}
              </kbd>
            </div>
          ))}
        </PopupBody>
      </PopupKader>
    </Dialog>
  );
}
