import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconCash as Cash,
  IconDiscount as Discount,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { klachtAanDeDeur, maakVasteKorting, type GeldloopAdres } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";

/** De redenen die aan de deur het vaakst voorkomen. */
const REDENEN = ["Horren", "Luiken dicht", "Raam vergeten", "Niet goed schoon"];

function leesBedrag(tekst: string): number | null {
  const n = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const groteInvoer =
  "h-14 rounded-[14px] text-center font-display text-[26px] font-semibold tabular-nums";

/**
 * Korting aan de deur: een bedrag en een reden. Daarna de vraag of het
 * voortaan vast bij dit adres hoort, zoals horren die er altijd voor zitten.
 */
export function KortingDialoog({
  open,
  adres,
  onSluit,
  onKorting,
  onVeranderd,
}: {
  open: boolean;
  adres: GeldloopAdres;
  onSluit: () => void;
  onKorting: (bedrag: number, reden: string) => Promise<boolean>;
  onVeranderd: () => void;
}) {
  const [bedrag, setBedrag] = useState("");
  const [reden, setReden] = useState("");
  const [stap, setStap] = useState<"invullen" | "onthouden">("invullen");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBedrag("");
    setReden("");
    setStap("invullen");
  }, [open]);

  const waarde = leesBedrag(bedrag);
  const alVast = adres.vaste_kortingen.some(
    (k) => k.naam.toLowerCase() === reden.trim().toLowerCase(),
  );

  async function geef() {
    if (!waarde) {
      toast.error("Vul een bedrag in.");
      return;
    }
    if (!reden.trim()) {
      toast.error("Zet erbij waarom.");
      return;
    }
    if (waarde > adres.open + 0.005) {
      toast.error(`Meer korting dan er open staat (${formatPrice(adres.open)}).`);
      return;
    }
    setBezig(true);
    try {
      if (!(await onKorting(waarde, reden.trim()))) return;
      if (alVast) onSluit();
      else setStap("onthouden");
    } finally {
      setBezig(false);
    }
  }

  async function onthoud() {
    if (!waarde) return;
    setBezig(true);
    try {
      // Een knop heeft een korte naam; een lange reden past daar niet op.
      await maakVasteKorting(adres.id, reden.trim().slice(0, 40), waarde);
      onVeranderd();
      toast.success(`${reden.trim()} −${formatPrice(waarde)} staat voortaan klaar bij dit adres`);
      onSluit();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="amber"
          icoon={<Discount className="size-[22px]" />}
          titel="Korting"
          subtitel={`Nr ${adres.house_number}${adres.addition} · open ${formatPrice(adres.open)}`}
        />
        {stap === "invullen" ? (
          <>
            <PopupBody className="gap-3">
              <Input
                autoFocus
                inputMode="decimal"
                aria-label="Bedrag korting"
                className={groteInvoer}
                placeholder="€ 0"
                value={bedrag}
                onChange={(e) => setBedrag(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {REDENEN.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReden(r)}
                    className={`min-h-10 rounded-full border px-3.5 text-[13.5px] font-medium ${
                      reden === r
                        ? "border-transparent bg-tint-amber text-tint-amber-ink"
                        : "border-border bg-card"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                aria-label="Reden"
                className="h-11 rounded-[12px]"
                placeholder="Of schrijf zelf waarom"
                maxLength={200}
                value={reden}
                onChange={(e) => setReden(e.target.value)}
              />
            </PopupBody>
            <PopupVoet>
              <Button variant="outline" className="rounded-full" onClick={onSluit}>
                Annuleren
              </Button>
              <Button className="rounded-full" disabled={bezig} onClick={() => void geef()}>
                Korting geven
              </Button>
            </PopupVoet>
          </>
        ) : (
          <>
            <PopupBody>
              <p className="text-[15px]">
                Voortaan <b>{reden.trim()}</b> −{formatPrice(waarde ?? 0)} bij dit adres?
              </p>
              <p className="text-[13px] text-muted-foreground">
                Dan staat er de volgende keer een knop voor klaar, en hoef je het niet opnieuw in te
                typen.
              </p>
            </PopupBody>
            <PopupVoet>
              <Button variant="outline" className="rounded-full" onClick={onSluit}>
                Nee, alleen nu
              </Button>
              <Button className="rounded-full" disabled={bezig} onClick={() => void onthoud()}>
                Ja, onthouden
              </Button>
            </PopupVoet>
          </>
        )}
      </PopupKader>
    </Dialog>
  );
}

/** Iemand betaalt een deel, of juist meer (dat wordt tegoed). */
export function BedragDialoog({
  open,
  adres,
  onSluit,
  onBedrag,
}: {
  open: boolean;
  adres: GeldloopAdres;
  onSluit: () => void;
  onBedrag: (bedrag: number) => Promise<boolean>;
}) {
  const [bedrag, setBedrag] = useState("");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (open) setBedrag("");
  }, [open]);
  const waarde = leesBedrag(bedrag);
  const rest = waarde !== null ? adres.open - waarde : null;

  async function boek() {
    if (!waarde) {
      toast.error("Vul een bedrag in.");
      return;
    }
    setBezig(true);
    try {
      if (await onBedrag(waarde)) onSluit();
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="groen"
          icoon={<Cash className="size-[22px]" />}
          titel="Ander bedrag"
          subtitel={`Nr ${adres.house_number}${adres.addition} · open ${formatPrice(adres.open)}`}
        />
        <PopupBody className="gap-2">
          <Input
            autoFocus
            inputMode="decimal"
            aria-label="Betaald bedrag"
            className={groteInvoer}
            placeholder="€ 0"
            value={bedrag}
            onChange={(e) => setBedrag(e.target.value)}
          />
          {rest !== null && (
            <p className="text-center text-[13px] text-muted-foreground">
              {rest > 0.005
                ? `Er blijft ${formatPrice(rest)} open`
                : rest < -0.005
                  ? `${formatPrice(-rest)} gaat als tegoed naar de volgende keer`
                  : "Daarmee is alles betaald"}
            </p>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig || !waarde} onClick={() => void boek()}>
            Betaald {waarde ? formatPrice(waarde) : ""}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

/** Een klacht aan de deur: komt in het dossier van de klant, rood. */
export function KlachtDialoog({
  open,
  adres,
  onSluit,
  onVeranderd,
}: {
  open: boolean;
  adres: GeldloopAdres;
  onSluit: () => void;
  onVeranderd: () => void;
}) {
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (open) setTekst("");
  }, [open]);

  async function bewaar() {
    if (!tekst.trim()) {
      toast.error("Schrijf op wat de klacht is.");
      return;
    }
    setBezig(true);
    try {
      await klachtAanDeDeur(adres.id, tekst.trim());
      onVeranderd();
      toast.success(`Klacht genoteerd · nr ${adres.house_number}${adres.addition}`);
      onSluit();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="rood"
          icoon={<AlertTriangle className="size-[22px]" />}
          titel="Klacht"
          subtitel={`Nr ${adres.house_number}${adres.addition}${adres.naam ? ` · ${adres.naam}` : ""}`}
        />
        <PopupBody>
          <Textarea
            autoFocus
            rows={4}
            maxLength={500}
            className="rounded-[14px] text-[15px]"
            placeholder="Wat is er mis? Bijvoorbeeld: raam boven niet gedaan"
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
          />
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
            Klacht opslaan
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
