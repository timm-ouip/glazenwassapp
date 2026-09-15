/**
 * Een klant laten stoppen: waarom, en wat er met de planning moet.
 *
 * Het schermpje voert zelf niets uit. De pagina die het opent bepaalt hoe
 * (vanuit de klantenlijst via de database, vanuit een mail via Paaltje), zodat
 * het er overal hetzelfde uitziet en dezelfde vragen stelt.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { STOP_REDENEN, type StopReden } from "@/lib/stoppen";
import { toonDatum } from "@/lib/wasdag";
import { cn } from "@/lib/utils";

export interface GeplandeDagen {
  /** De datums (jjjj-mm-dd), oplopend; mag een eerste stuk van alle dagen zijn. */
  dagen: string[];
  /** Hoeveel dagen het er in totaal zijn. */
  aantal: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wie of wat er stopt: de naam van de klant, of het adres. */
  titel: string;
  /** De adressen, op één regel. */
  omschrijving: string;
  /** De wasdagen vanaf morgen waarop deze adressen nog staan. */
  telDagen: () => Promise<GeplandeDagen>;
  /** Uitvoeren. Gooit bij een fout; het schermpje meldt die dan. */
  onBevestig: (reden: StopReden, planningWeg: boolean) => Promise<void>;
}

export function StopDialog({ open, onOpenChange, titel, omschrijving, telDagen, onBevestig }: Props) {
  const [reden, setReden] = useState<StopReden | null>(null);
  const [planningWeg, setPlanningWeg] = useState<boolean | null>(null);
  const [telling, setTelling] = useState<GeplandeDagen | null>(null);
  const [telFout, setTelFout] = useState(false);
  const [bezig, setBezig] = useState(false);

  // Bij elke keer openen opnieuw beginnen, en de planning vers tellen.
  useEffect(() => {
    if (!open) return;
    setReden(null);
    setPlanningWeg(null);
    setTelling(null);
    setTelFout(false);
    let actief = true;
    telDagen()
      .then((t) => actief && setTelling(t))
      // Niet stil "niets op de planning" zeggen: dan blijft de planning
      // ongemerkt staan. Liever niet verder tot het tellen gelukt is.
      .catch(() => actief && setTelFout(true));
    return () => {
      actief = false;
    };
    // telDagen verandert per render; alleen het openen telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const heeftPlanning = (telling?.aantal ?? 0) > 0;
  const klaar = reden !== null && telling !== null && (!heeftPlanning || planningWeg !== null);

  async function bevestig() {
    if (!klaar || !reden || bezig) return;
    setBezig(true);
    try {
      await onBevestig(reden, heeftPlanning ? planningWeg === true : false);
      onOpenChange(false);
    } catch (e) {
      toast.error("Stoppen lukte niet: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  const getoond = telling?.dagen.slice(0, 4) ?? [];
  const rest = (telling?.aantal ?? 0) - getoond.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !bezig && onOpenChange(o)}>
      <PopupKader>
        <PopupKop kleur="amber" icoon={<UserMinus className="size-5" />} titel={titel} subtitel={omschrijving} />
        <PopupBody className="space-y-4">
          <div className="space-y-2">
            <p className="text-[12.5px] font-medium text-muted-foreground">Waarom stopt deze klant?</p>
            {STOP_REDENEN.map((r) => (
              <Keuze
                key={r.waarde}
                gekozen={reden === r.waarde}
                titel={r.label}
                uitleg={r.uitleg}
                onKies={() => setReden(r.waarde)}
              />
            ))}
          </div>

          {telFout ? (
            <p className="flex items-start gap-1.5 rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              De planning kon niet nagekeken worden. Sluit dit schermpje en probeer het zo nog eens.
            </p>
          ) : telling === null ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Planning nakijken…
            </p>
          ) : heeftPlanning ? (
            <div className="space-y-2">
              <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-muted-foreground">
                <CalendarDays className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Staat nog op de planning: {getoond.map(toonDatum).join(", ")}
                  {rest > 0 ? ` en nog ${rest} ${rest === 1 ? "dag" : "dagen"}` : ""}. Wat moet daarmee?
                </span>
              </p>
              <Keuze
                gekozen={planningWeg === true}
                titel="Van de planning halen"
                uitleg="Deze dagen verdwijnen. Vandaag en wat al geweest is blijft staan."
                onKies={() => setPlanningWeg(true)}
              />
              <Keuze
                gekozen={planningWeg === false}
                titel="Laten staan"
                uitleg="Je haalt ze later zelf van de planning af."
                onKies={() => setPlanningWeg(false)}
              />
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Na vandaag staat er niets meer op de planning.</p>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="ghost" className="rounded-full" disabled={bezig} onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={!klaar || bezig} onClick={() => void bevestig()}>
            {bezig && <Loader2 className="size-4 animate-spin" />}
            Laten stoppen
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

function Keuze({
  gekozen,
  titel,
  uitleg,
  onKies,
}: {
  gekozen: boolean;
  titel: string;
  uitleg: string;
  onKies: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={gekozen}
      onClick={onKies}
      className={cn(
        "flex w-full items-start gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition-colors",
        gekozen ? "border-foreground bg-accent/40" : "border-border hover:bg-accent/30",
      )}
    >
      <span
        className={cn(
          "mt-1 size-3.5 shrink-0 rounded-full border",
          gekozen ? "border-foreground bg-foreground ring-2 ring-inset ring-card" : "border-muted-foreground/50",
        )}
      />
      <span>
        <span className="block text-[13.5px] font-medium leading-tight">{titel}</span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">{uitleg}</span>
      </span>
    </button>
  );
}
