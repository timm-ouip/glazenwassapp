import { useEffect, useState } from "react";
import { Folder, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { StraatGroep } from "@/lib/klanten";
import { opslaanBijEnter } from "@/lib/dialoog";
import {
  PopupBlok,
  PopupBody,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** De groep die hernoemd wordt; leeg betekent: er komt een nieuwe. */
  groep: StraatGroep | null;
  onOpslaan: (naam: string) => void;
}

/**
 * De naam van een subgroep: hernoemen als er een groep meekomt, en anders een
 * nieuwe maken. Wie hem opent, weet zelf wat er daarna met die naam gebeurt.
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
      <PopupKader className="sm:max-w-sm" onKeyDown={opslaanBijEnter(save)}>
        <PopupKop
          icoon={<Folder className="size-[22px]" />}
          titel={groep ? "Groep hernoemen" : "Nieuwe groep"}
          subtitel="Een stuk van de wijk dat je in één keer inplant"
        />
        <PopupBody>
          <PopupBlok label="Naam">
            <PopupVeld icoon={<Type className="size-4" />}>
              <Input
                id="groepnaam"
                autoFocus
                className={popupInvoer}
                placeholder="bijv. Noordkant"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={save}>
            Opslaan
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
