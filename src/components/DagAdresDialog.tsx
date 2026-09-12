import { useEffect, useState } from "react";
import { CalendarCheck, MessageSquare, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { opslaanBijEnter } from "@/lib/dialoog";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
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
      <PopupKader onKeyDown={opslaanBijEnter(bewaar)}>
        <PopupKop
          // Groen: dit gaat over het bedrag van één dag.
          kleur="groen"
          icoon={<CalendarCheck className="size-[22px]" />}
          titel={`${straat} ${formatNumber(c)}`}
          subtitel={`Alleen voor ${toonDatum(datum)}`}
        />
        <PopupBody>
          {/* Wat er vast bij dit adres hoort. Niet te wijzigen: dat doe je op
              de wijkenpagina, want daar geldt het voor elke ronde. */}
          <PopupBlok label="Vast bij dit adres">
            <dl className="divide-y divide-border/60 rounded-xl border border-input text-[13px]">
              <div className="flex gap-2 px-3 py-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Vaste prijs</dt>
                <dd className="tabular-nums">{formatPrice(standaard)}</dd>
              </div>
              <div className="flex gap-2 px-3 py-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Frequentie</dt>
                <dd>{ritmeLabel(c)}</dd>
              </div>
              <div className="flex gap-2 px-3 py-2">
                <dt className="w-24 shrink-0 text-muted-foreground">Notitie</dt>
                <dd className="min-w-0 flex-1">
                  {vast || <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            </dl>
          </PopupBlok>

          <PopupBlok label="Prijs deze dag">
            <PopupVeld icoon={<span className="text-sm">€</span>}>
              <Input
                id="dagprijs"
                inputMode="decimal"
                className={`${popupInvoer} tabular-nums`}
                value={bedrag}
                onChange={(e) => setBedrag(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>

          <PopupBlok label="Wat ging er anders?">
            <PopupVeld className="items-start py-2.5" icoon={<MessageSquare className="size-4" />}>
              <Textarea
                id="dagnotitie"
                rows={2}
                className={`${popupInvoer} resize-none`}
                value={tekst}
                onChange={(e) => setTekst(e.target.value)}
                placeholder="bijvoorbeeld: alleen de voorkant gewassen"
              />
            </PopupVeld>
            <PopupHint>Komt straks zo op de factuur te staan.</PopupHint>
          </PopupBlok>
        </PopupBody>
        <PopupVoet
          links={
            <Button
              type="button"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              disabled={!afwijkend}
              onClick={() => {
                setBedrag(String(standaard).replace(".", ","));
                setTekst("");
              }}
            >
              <RotateCcw className="size-4" /> Terug naar gewoon
            </Button>
          }
        >
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Annuleren
          </Button>
          <Button type="button" className="rounded-full" onClick={bewaar}>
            Opslaan
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
