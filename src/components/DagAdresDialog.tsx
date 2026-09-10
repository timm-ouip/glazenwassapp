import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { opslaanBijEnter } from "@/lib/dialoog";
import {
  formatNumber,
  formatPrice,
  noteVoorMaand,
  prijsVoorMaand,
  ritmeLabel,
  type Customer,
} from "@/lib/klanten";
import { toonDatum } from "@/lib/wasdag";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null zolang er niets aangeklikt is. */
  customer: Customer | null;
  straat: string;
  datum: string;
  /** Wat er nu op de regel van deze dag staat. */
  prijs: number;
  notitie: string | null;
  onOpslaan: (prijs: number, notitie: string | null) => void;
}

/** "12,50" en "€ 12.50" leveren allebei 12.5 op. */
function bedragVan(waarde: string): number {
  return Number(waarde.replace(",", ".").replace(/[^\d.]/g, "")) || 0;
}

/**
 * Eén adres op één dag.
 *
 * Wat je hier verandert geldt alléén voor deze dag. Is er die keer alleen de
 * voorkant gewassen omdat de steiger stond, dan zet je hier het bedrag van
 * die keer en waarom — en blijft de vaste prijs van het adres staan voor de
 * volgende ronde. Zonder dit onderscheid zou één regenachtige dag de prijs
 * van een klant voorgoed verlagen.
 *
 * Bovenin staat wat er vast bij het adres hoort, want dat is waar je het mee
 * vergelijkt: pas als je ziet dat er "hele huis, serre" staat, weet je wat
 * "alleen de voorkant" waard is.
 */
export function DagAdresDialog({
  open,
  onOpenChange,
  customer: c,
  straat,
  datum,
  prijs,
  notitie,
  onOpslaan,
}: Props) {
  const [bedrag, setBedrag] = useState("");
  const [tekst, setTekst] = useState("");

  // Overnemen wat er in de database staat, elke keer als het schermpje
  // opengaat. Niet bij elke hervalidatie van de lijst: dan zou wat je net
  // intypte onder je handen weggepoetst worden.
  useEffect(() => {
    if (!open) return;
    setBedrag(String(prijs).replace(".", ","));
    setTekst(notitie ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!c) return null;

  const maand = datum.slice(0, 7);
  const standaard = prijsVoorMaand(c, maand);
  const vast = noteVoorMaand(c, maand);
  const afwijkend = bedragVan(bedrag) !== standaard || tekst.trim() !== "";

  function bewaar() {
    const schoon = tekst.trim();
    onOpslaan(bedragVan(bedrag), schoon === "" ? null : schoon);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={opslaanBijEnter(bewaar)}>
        <DialogHeader>
          <DialogTitle>
            {straat} {formatNumber(c)}
          </DialogTitle>
          <DialogDescription>Alleen voor {toonDatum(datum)}</DialogDescription>
        </DialogHeader>

        {/* Wat er vast bij dit adres hoort. Niet te wijzigen: dat doe je op de
            wijkenpagina, want daar geldt het voor elke ronde. */}
        <dl className="rounded-[12px] border border-border bg-muted/40 px-3 py-2 text-[13px]">
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-muted-foreground">Vaste prijs</dt>
            <dd className="tabular-nums">{formatPrice(standaard)}</dd>
          </div>
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-muted-foreground">Frequentie</dt>
            <dd>{ritmeLabel(c)}</dd>
          </div>
          <div className="flex gap-2 py-0.5">
            <dt className="w-24 shrink-0 text-muted-foreground">Notitie</dt>
            <dd className="min-w-0 flex-1">
              {vast || <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        </dl>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dagprijs">Prijs deze dag</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">€</span>
              <Input
                id="dagprijs"
                inputMode="decimal"
                value={bedrag}
                onChange={(e) => setBedrag(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dagnotitie">Wat ging er anders?</Label>
            <Textarea
              id="dagnotitie"
              rows={2}
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              placeholder="bijvoorbeeld: alleen de voorkant gewassen"
            />
            <p className="text-[12px] text-muted-foreground">
              Komt straks zo op de factuur te staan.
            </p>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full"
            disabled={!afwijkend}
            onClick={() => {
              setBedrag(String(standaard).replace(".", ","));
              setTekst("");
            }}
          >
            <RotateCcw className="size-4" /> Terug naar gewoon
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuleren
            </Button>
            <Button type="button" onClick={bewaar}>
              Opslaan
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
