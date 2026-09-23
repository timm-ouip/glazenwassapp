import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconRoute as Route } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { useAuth } from "@/lib/auth";
import { verdeelStraat, type Vrijgave } from "@/lib/geldlopen";

/**
 * Wie loopt deze straat? Vink aan wie hem doet; niemand aanvinken betekent
 * dat hij van iedereen is, zoals het vóór het verdelen ging. Meerdere mensen
 * op één straat mag — samen een straat doen is normaal, en dubbel afrekenen
 * kan niet omdat een tik meteen bij de ander in de lijst verschijnt.
 *
 * Zowel de eigenaar als de lopers zelf mogen dit, zodat de een de ander kan
 * afhelpen zonder eerst te bellen. Wat er verandert komt in het overzicht van
 * de eigenaar te staan, met een knop om het terug te zetten.
 */
export function StraatVerdelen({
  open,
  vrijgave,
  straat,
  huidige,
  onSluit,
  onVeranderd,
}: {
  open: boolean;
  vrijgave: Vrijgave;
  straat: { id: string; naam: string } | null;
  /** Wie de straat nu loopt; leeg is: iedereen. */
  huidige: { id: string; naam: string }[];
  onSluit: () => void;
  onVeranderd: () => void;
}) {
  const { employee } = useAuth();
  const lopers = vrijgave.lopers ?? [];
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (open) setGekozen(new Set(huidige.map((l) => l.id)));
    // De huidige verdeling verandert live mee; hem hier opnieuw inlezen zou
    // je aanvinken onder je handen weghalen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, straat?.id]);

  function wissel(id: string) {
    setGekozen((was) => {
      const nu = new Set(was);
      if (nu.has(id)) nu.delete(id);
      else nu.add(id);
      return nu;
    });
  }

  async function bewaar() {
    if (!straat) return;
    setBezig(true);
    try {
      await verdeelStraat(vrijgave.id, straat.id, [...gekozen]);
      onVeranderd();
      toast.success(
        gekozen.size === 0
          ? `${straat.naam} is weer van iedereen`
          : `${straat.naam} is voor ${lopers
              .filter((l) => gekozen.has(l.id))
              .map((l) => l.naam)
              .join(" en ")}`,
      );
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
          kleur="blauw"
          icoon={<Route className="size-[22px]" />}
          titel={straat ? `Wie loopt de ${straat.naam}?` : "Wie loopt deze straat?"}
          subtitel="Niemand aanvinken: dan is hij van iedereen"
        />
        <PopupBody className="gap-3">
          {lopers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Er is niemand aan deze avond gekoppeld.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {lopers.map((l) => {
                const aan = gekozen.has(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={aan}
                    onClick={() => wissel(l.id)}
                    className={`min-h-11 rounded-full border px-4 text-[14px] font-medium ${
                      aan
                        ? "border-transparent bg-tint-blauw text-tint-blauw-ink"
                        : "border-border bg-card"
                    }`}
                  >
                    {l.naam}
                    {l.id === employee?.id && " (jij)"}
                  </button>
                );
              })}
            </div>
          )}
          {employee && lopers.some((l) => l.id === employee.id) && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => setGekozen(new Set([employee.id]))}
              >
                Ik doe hem alleen
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => setGekozen((was) => new Set([...was, employee.id]))}
              >
                Ik doe hem erbij
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  setGekozen((was) => {
                    const nu = new Set(was);
                    nu.delete(employee.id);
                    return nu;
                  })
                }
              >
                Ik doe hem niet meer
              </Button>
            </div>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
            Bewaren
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
