import { useEffect, useState } from "react";
import { CornerDownRight } from "lucide-react";
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
import { formatNumber, isHoekadres, type Customer, type Street } from "@/lib/klanten";
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  /** De straten van de wijk — de suggesties in het straatveld. */
  straten: Street[];
  onOpslaan: (patch: Partial<Customer>) => void;
}

/**
 * Een huisnummer op de hoek hoort officieel bij een andere straat.
 *
 * Hier zeg je welke dat is; naar welke kant van de straat hij moet, zeg je
 * door hem daarheen te slepen. Twee manieren om hetzelfde te vertellen zou
 * alleen maar verwarren, en slepen zie je meteen kloppen.
 */
export function HoekadresDialog({ open, onOpenChange, customer, straten, onOpslaan }: Props) {
  const [straat, setStraat] = useState("");
  const [volledig, setVolledig] = useState("");

  useEffect(() => {
    if (!open) return;
    const kort = customer?.hoek_straat ?? "";
    setStraat(kort);
    // Staat de volledige naam nog leeg, dan kennen we hem misschien al uit je
    // eigen wijklijst; dan hoef je hem niet nog eens in te typen.
    const bekend = straten.find((s) => s.name.toLowerCase() === kort.trim().toLowerCase());
    setVolledig(customer?.hoek_straat_volledig || bekend?.volledige_naam || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer]);

  if (!customer) return null;

  /** Ken je de straat al uit je wijk, dan vult hij de andere helft zelf in —
   *  je hebt daar allebei de namen ooit ingevuld. */
  function vulAan(waarde: string, veld: "kort" | "volledig") {
    const gevonden = straten.find((s) =>
      veld === "kort"
        ? s.name.toLowerCase() === waarde.trim().toLowerCase()
        : s.volledige_naam.toLowerCase() === waarde.trim().toLowerCase(),
    );
    if (!gevonden) return;
    if (veld === "kort" && !volledig.trim()) setVolledig(gevonden.volledige_naam);
    if (veld === "volledig" && !straat.trim()) setStraat(gevonden.name);
  }

  function opslaan() {
    bewaar({ hoek_straat: straat.trim(), hoek_straat_volledig: volledig.trim() });
  }

  function bewaar(patch: Partial<Customer>) {
    onOpslaan(patch);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={opslaanBijEnter(opslaan)}>
        <DialogHeader>
          <DialogTitle>Hoekadres — {formatNumber(customer)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hoekstraat">Straat waar dit pand echt aan ligt</Label>
            <Input
              id="hoekstraat"
              list="hoek-straten"
              placeholder="bijv. Aleid"
              value={straat}
              onChange={(e) => {
                setStraat(e.target.value);
                vulAan(e.target.value, "kort");
              }}
            />
            <datalist id="hoek-straten">
              {straten.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Zoals hij op de lijst staat — kort, want hij komt op de printlijst.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hoekvolledig">Volledige straatnaam</Label>
            <Input
              id="hoekvolledig"
              list="hoek-straten-vol"
              placeholder={straat.trim() ? `bijv. ${straat.trim()}straat` : "Aleidisstraat"}
              value={volledig}
              onChange={(e) => {
                setVolledig(e.target.value);
                vulAan(e.target.value, "volledig");
              }}
            />
            <datalist id="hoek-straten-vol">
              {straten
                .filter((s) => s.volledige_naam.trim())
                .map((s) => (
                  <option key={s.id} value={s.volledige_naam} />
                ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Dít is het adres van de klant, en de naam waarmee de postcode wordt opgezocht.
            </p>
          </div>
          <p className="flex items-start gap-1 pt-2 text-xs text-muted-foreground">
            <CornerDownRight className="mt-px size-3.5 shrink-0" />
            <span>
              Staat hij aan de verkeerde kant van de straat? Sleep hem naar de andere kolom, op de
              plek waar je hem tegenkomt. Daar blijft hij staan.
            </span>
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {isHoekadres(customer) && (
            <Button
              variant="outline"
              className="sm:mr-auto"
              onClick={() => bewaar({ hoek_straat: "", hoek_straat_volledig: "", hoek_kant: "" })}
            >
              Hoekadres weghalen
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={opslaan}>Opslaan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
