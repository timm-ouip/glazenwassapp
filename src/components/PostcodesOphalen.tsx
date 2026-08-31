import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { formatNumber, persistPostcodes, type Customer, type Street } from "@/lib/klanten";
import { nummerSleutel, zoekStraatPostcodes } from "@/lib/postcode";
import { pushUndo, undoLaatste } from "@/lib/undo";

interface Props {
  /** De straten van de actieve wijk. */
  streets: Street[];
  /** Alle adressen; er wordt zelf op straat gefilterd. */
  customers: Customer[];
  plaats: string;
  onSaved: () => void;
}

/**
 * Haalt de postcodes van een hele wijk op.
 *
 * Per straat één verzoek, want de Locatieserver geeft alle huisnummers van
 * een straat in één antwoord terug. Een wijk van veertig straten kost dus
 * veertig verzoeken in plaats van vierhonderd, en is in een paar minuten
 * klaar.
 */
export function PostcodesOphalen({ streets, customers, plaats, onSaved }: Props) {
  const [bezig, setBezig] = useState(false);
  const [voortgang, setVoortgang] = useState({ straat: 0, gevonden: 0 });

  // Alleen straten met een officiële naam kunnen opgezocht worden, en alleen
  // adressen die nog geen postcode hebben zijn werk.
  const teDoen = streets.filter(
    (s) =>
      s.volledige_naam.trim() && customers.some((c) => c.street_id === s.id && !c.postcode.trim()),
  );
  const zonderPostcode = customers.filter(
    (c) => !c.postcode.trim() && streets.some((s) => s.id === c.street_id),
  ).length;

  async function haalOp() {
    setBezig(true);
    setVoortgang({ straat: 0, gevonden: 0 });

    const wijzigingen: { id: string; postcode: string }[] = [];
    const vorig: { id: string; postcode: string }[] = [];
    let misluktAchtereen = 0;
    let afgeknepen = false;

    for (const [i, street] of teDoen.entries()) {
      const kaart = await zoekStraatPostcodes(street.volledige_naam, plaats);

      if (kaart === null) {
        if (++misluktAchtereen >= 3) {
          afgeknepen = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      misluktAchtereen = 0;

      for (const c of customers) {
        if (c.street_id !== street.id || c.postcode.trim()) continue;
        const gevonden = kaart.get(nummerSleutel(c.house_number, c.addition));
        if (gevonden) {
          wijzigingen.push({ id: c.id, postcode: gevonden });
          vorig.push({ id: c.id, postcode: c.postcode });
        }
      }

      setVoortgang({ straat: i + 1, gevonden: wijzigingen.length });
      await new Promise((r) => setTimeout(r, 350));
    }

    if (wijzigingen.length > 0) {
      try {
        await persistPostcodes(wijzigingen);
        onSaved();
        pushUndo({
          label: `Postcodes ophalen (${wijzigingen.length})`,
          undo: async () => {
            await persistPostcodes(vorig);
            onSaved();
          },
        });
      } catch (e) {
        toast.error("Opslaan mislukt: " + (e as Error).message);
        setBezig(false);
        return;
      }
    }

    setBezig(false);
    const staart = afgeknepen
      ? " De adressendienst hield ermee op — druk over een paar minuten nog eens voor de rest."
      : "";
    if (wijzigingen.length === 0) {
      toast(`Geen postcodes gevonden.${staart}`);
      return;
    }
    toast(`${wijzigingen.length} postcodes ingevuld.${staart}`, {
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
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="rounded-full"
      disabled={bezig || !plaats.trim() || teDoen.length === 0}
      title={
        !plaats.trim()
          ? "Vul eerst de plaats van deze wijk in"
          : teDoen.length === 0
            ? zonderPostcode > 0
              ? `${zonderPostcode} adressen missen een postcode, maar hun straat heeft nog geen volledige naam`
              : "Alle adressen hebben al een postcode"
            : `${zonderPostcode} adressen zonder postcode, in ${teDoen.length} straten`
      }
      onClick={() => void haalOp()}
    >
      <MapPin className="size-4" />
      {bezig
        ? `Bezig — ${voortgang.straat}/${teDoen.length}, ${voortgang.gevonden} gevonden`
        : "Postcodes"}
    </Button>
  );
}
