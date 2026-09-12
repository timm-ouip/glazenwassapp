/**
 * "Adres toevoegen" in het postvak: een inzending van een adres dat nog niet
 * op de lijst staat, omzetten in een echte adresregel met een klant eraan.
 *
 * Dit is met opzet geen automaat. Bij een nieuw adres hoort een wijk (waar
 * loopt het in de route mee?) en een prijs, en dat zijn twee dingen die de
 * klant niet kan weten. Daarom vult de glazenwasser ze hier zelf in, met wat
 * de klant opgaf al voorgedrukt.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleDollarSign, Hash, House, MapPin, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FrequentieOpties } from "@/components/FrequentieKiezer";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupPaar,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import { opslaanBijEnter } from "@/lib/dialoog";
import {
  bewaarKlant,
  koppelKlant,
  patchCustomer,
  leesRitmeWaarde,
  vulPostcodeAan,
  zorgVoorAdresRegel,
  type District,
} from "@/lib/klanten";
import { aanmeldNummer, zetVerwerkt, type Aanmelding } from "@/lib/aanmeldingen";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aanmelding: Aanmelding | null;
  districts: District[];
  /** Alles opnieuw ophalen: er is een adres én een klant bijgekomen. */
  onKlaar: () => void;
}

export function AanmeldingDialog({ open, onOpenChange, aanmelding, districts, onKlaar }: Props) {
  const [wijkId, setWijkId] = useState("");
  const [straat, setStraat] = useState("");
  const [nummer, setNummer] = useState("");
  const [prijs, setPrijs] = useState("");
  const [ritme, setRitme] = useState<string>("");
  const [bezig, setBezig] = useState(false);

  // Bij het openen alles terugzetten naar wat de klant opgaf. De wijk raden we
  // niet: als de plaats bij precies één wijk hoort is dat een goede gok, maar
  // bij meer dan één is elke keuze een halve, en dan kiest de mens.
  useEffect(() => {
    if (!open || !aanmelding) return;
    setStraat(aanmelding.straat);
    setNummer(aanmeldNummer(aanmelding));
    setPrijs("");
    setRitme("");
    const plaats = aanmelding.plaats.trim().toLowerCase();
    const passend = districts.filter((d) => (d.plaats ?? "").trim().toLowerCase() === plaats);
    setWijkId(passend.length === 1 ? passend[0]!.id : "");
  }, [open, aanmelding, districts]);

  if (!aanmelding) return null;

  async function opslaan() {
    if (!wijkId) {
      toast.error("Kies een wijk.");
      return;
    }
    if (!straat.trim() || !nummer.trim()) {
      toast.error("Vul een straat en een huisnummer in.");
      return;
    }
    const bedrag = Number(prijs.trim().replace(",", "."));
    if (!prijs.trim() || Number.isNaN(bedrag)) {
      toast.error("Vul een prijs in.");
      return;
    }
    const gekozen = leesRitmeWaarde(ritme);
    if (!gekozen) {
      toast.error("Kies een frequentie.");
      return;
    }

    setBezig(true);
    try {
      // Dezelfde weg als een klant die je zelf invoert: de straat wordt
      // aangemaakt als hij nog niet bestaat, en een adres dat er al staat
      // wordt hergebruikt in plaats van verdubbeld.
      const customerId = await zorgVoorAdresRegel(wijkId, straat, nummer);
      if (!customerId) {
        toast.error("Dat huisnummer begrijp ik niet.");
        return;
      }
      await patchCustomer(customerId, {
        price: bedrag,
        aangemeld_op: new Date().toISOString(),
        ...gekozen,
      });
      // De postcode hoort bij het pand en niet bij de bewoner, dus die gaat op
      // de adresregel — tenzij er al een staat.
      await vulPostcodeAan(customerId, aanmelding!.postcode);
      const klant = await bewaarKlant(null, {
        naam: aanmelding!.naam,
        email: aanmelding!.email,
        telefoon: aanmelding!.telefoon,
        straat: straat.trim(),
        huisnummer: nummer.trim(),
        postcode: aanmelding!.postcode,
        plaats: aanmelding!.plaats,
        notitie: "",
      });
      await koppelKlant([customerId], klant.id);
      await zetVerwerkt(aanmelding!.id, customerId, klant.id);
      toast.success(`${aanmelding!.naam || "De klant"} staat nu op de lijst.`);
      onOpenChange(false);
      onKlaar();
    } catch (err) {
      toast.error("Opslaan mislukt: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader onKeyDown={opslaanBijEnter(() => void opslaan())}>
        <PopupKop
          kleur="groen"
          icoon={<UserPlus className="size-5" />}
          titel={aanmelding.naam || "Nieuwe aanmelding"}
          subtitel={[aanmelding.telefoon, aanmelding.email].filter(Boolean).join(" · ")}
        />
        <PopupBody>
          <PopupBlok label="Wijk">
            <PopupVeld icoon={<MapPin className="size-4" />}>
              <Select value={wijkId} onValueChange={setWijkId}>
                <SelectTrigger className={popupInvoer}>
                  <SelectValue placeholder="Kies een wijk" />
                </SelectTrigger>
                <SelectContent>
                  {districts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      {d.plaats ? ` · ${d.plaats}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PopupVeld>
            <PopupHint>
              Hier loopt dit adres mee in de route. Staat de straat er nog niet, dan maken we hem
              aan.
            </PopupHint>
          </PopupBlok>

          <PopupBlok label="Adres">
            <PopupPaar smal>
              <PopupVeld icoon={<House className="size-4" />}>
                <Input
                  className={popupInvoer}
                  value={straat}
                  onChange={(e) => setStraat(e.target.value)}
                  placeholder="Straat"
                />
              </PopupVeld>
              <PopupVeld icoon={<Hash className="size-4" />}>
                <Input
                  className={popupInvoer}
                  value={nummer}
                  onChange={(e) => setNummer(e.target.value)}
                  placeholder="12"
                />
              </PopupVeld>
            </PopupPaar>
          </PopupBlok>

          <PopupBlok label="Prijs en frequentie">
            <PopupPaar>
              <PopupVeld icoon={<CircleDollarSign className="size-4" />} achter="per beurt">
                <Input
                  className={popupInvoer}
                  value={prijs}
                  onChange={(e) => setPrijs(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </PopupVeld>
              <PopupVeld>
                <Select value={ritme} onValueChange={setRitme}>
                  <SelectTrigger className={popupInvoer}>
                    <SelectValue placeholder="Kies…" />
                  </SelectTrigger>
                  <SelectContent>
                    <FrequentieOpties />
                  </SelectContent>
                </Select>
              </PopupVeld>
            </PopupPaar>
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void opslaan()}>
            {bezig ? "Bezig…" : "Toevoegen"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
