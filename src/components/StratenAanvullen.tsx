import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { persistVolledigeNamen, type Street } from "@/lib/klanten";
import { zoekStraten } from "@/lib/postcode";
import { pushUndo, undoLaatste } from "@/lib/undo";

interface Props {
  /** De straten van de actieve wijk. */
  streets: Street[];
  plaats: string;
  onSaved: () => void;
}

interface Voorstel {
  street: Street;
  /** Wat er opgeslagen wordt; leeg betekent overslaan. */
  waarde: string;
  /** Andere kandidaten, als PDOK er meer teruggaf. */
  opties: string[];
  aan: boolean;
}

/**
 * Vult in één keer de officiële straatnamen van een wijk aan.
 *
 * De namen op de wijklijst zijn werknamen ("Ameland" voor Amelandstraat).
 * Ze stuk voor stuk in de straat-dialog nalopen is bij 43 straten geen doen,
 * dus dit scherm haalt de voorstellen op en laat je ze in één keer bevestigen.
 */
export function StratenAanvullen({ streets, plaats, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [voortgang, setVoortgang] = useState(0);
  const [voorstellen, setVoorstellen] = useState<Voorstel[]>([]);
  const [opslaan, setOpslaan] = useState(false);
  const [afgebroken, setAfgebroken] = useState(false);

  const teDoen = streets.filter((s) => !s.volledige_naam.trim());

  async function zoek() {
    setOpen(true);
    setBezig(true);
    setVoorstellen([]);
    setVoortgang(0);
    setAfgebroken(false);

    const gevonden: Voorstel[] = [];
    let misluktAchtereen = 0;

    for (const [i, street] of teDoen.entries()) {
      const namen = await zoekStraten(street.name, plaats);

      if (namen === null) {
        // De dienst antwoordde niet. Bij een paar keer achter elkaar zijn we
        // afgeknepen; dan heeft doorgaan geen zin en houden we wat we hebben.
        if (++misluktAchtereen >= 3) {
          setAfgebroken(true);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      misluktAchtereen = 0;

      gevonden.push({
        street,
        waarde: namen.length === 1 ? namen[0]! : "",
        opties: namen,
        // Alleen een eenduidige treffer staat vast aan; de rest kijk je na.
        aan: namen.length === 1,
      });
      setVoorstellen([...gevonden]);
      setVoortgang(i + 1);
      // De Locatieserver knijpt af bij tientallen verzoeken achter elkaar,
      // dus rustig aan.
      await new Promise((r) => setTimeout(r, 350));
    }
    setBezig(false);
  }

  function zet(id: string, patch: Partial<Voorstel>) {
    setVoorstellen((lijst) => lijst.map((v) => (v.street.id === id ? { ...v, ...patch } : v)));
  }

  async function bewaar() {
    const wijzigingen = voorstellen
      .filter((v) => v.aan && v.waarde.trim())
      .map((v) => ({ id: v.street.id, volledige_naam: v.waarde.trim() }));
    if (wijzigingen.length === 0) {
      toast.error("Niets aangevinkt om op te slaan.");
      return;
    }
    setOpslaan(true);
    try {
      await persistVolledigeNamen(wijzigingen);
      onSaved();
      pushUndo({
        label: `Straatnamen aanvullen (${wijzigingen.length})`,
        undo: async () => {
          await persistVolledigeNamen(wijzigingen.map((w) => ({ ...w, volledige_naam: "" })));
          onSaved();
        },
      });
      toast(`${wijzigingen.length} straatnamen aangevuld`, {
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
      setOpen(false);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setOpslaan(false);
    }
  }

  const aantalAan = voorstellen.filter((v) => v.aan && v.waarde.trim()).length;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={!plaats.trim() || teDoen.length === 0}
        title={
          !plaats.trim()
            ? "Vul eerst de plaats van deze wijk in"
            : teDoen.length === 0
              ? "Alle straten hebben al een volledige naam"
              : `${teDoen.length} straten zonder volledige naam`
        }
        onClick={() => void zoek()}
      >
        <Wand2 className="size-4" /> Straatnamen
      </Button>

      <Dialog open={open} onOpenChange={(o) => !bezig && setOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Straatnamen aanvullen</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {bezig
              ? `Bezig met opzoeken — ${voortgang} van ${teDoen.length}…`
              : `Voorstellen voor ${plaats}. Vink aan wat klopt; wat je leeg laat blijft ongewijzigd.`}
          </p>

          {afgebroken && (
            <p className="rounded-[10px] border border-border bg-tint-amber/40 px-3 py-2 text-[13px]">
              De adressendienst gaf geen antwoord meer — waarschijnlijk te veel opvragingen kort na
              elkaar. Sla op wat hier staat en draai dit over een paar minuten nog eens voor de
              rest.
            </p>
          )}

          <div className="space-y-1">
            {voorstellen.map((v) => (
              <div
                key={v.street.id}
                className="grid grid-cols-[1.5rem_9rem_1fr] items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/40"
              >
                <Checkbox
                  checked={v.aan}
                  disabled={!v.waarde.trim()}
                  onCheckedChange={(c) => zet(v.street.id, { aan: c === true })}
                  aria-label={`${v.street.name} aanvullen`}
                />
                <span className="truncate text-[13px] text-muted-foreground">{v.street.name}</span>
                {v.opties.length > 1 ? (
                  <select
                    className="h-8 rounded-md border border-border bg-card px-2 text-[13px]"
                    value={v.waarde}
                    onChange={(e) =>
                      zet(v.street.id, { waarde: e.target.value, aan: Boolean(e.target.value) })
                    }
                  >
                    <option value="">— kies —</option>
                    {v.opties.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="h-8 text-[13px]"
                    placeholder="geen voorstel — zelf invullen"
                    value={v.waarde}
                    onChange={(e) =>
                      zet(v.street.id, { waarde: e.target.value, aan: Boolean(e.target.value) })
                    }
                  />
                )}
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={bezig}>
              Annuleren
            </Button>
            <Button onClick={() => void bewaar()} disabled={bezig || opslaan || aantalAan === 0}>
              {opslaan ? "Bezig…" : `${aantalAan} opslaan`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
