/**
 * "Klant toevoegen" naast een mail van iemand die nog geen klant is.
 *
 * Net als AanmeldingDialog: wijk, prijs en frequentie vult de glazenwasser zelf
 * in, want die staan niet in een mail. Wat Paaltje uit de mail haalde staat al
 * voorgedrukt, en is hier nog aan te passen: Paaltje kan zich vergissen.
 *
 * Na opslaan hoort de mail bij de nieuwe klant, en leest Paaltje hem opnieuw.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconCoinEuro as CircleDollarSign,
  IconHash as Hash,
  IconHome as House,
  IconMail as Mail,
  IconMapPin as MapPin,
  IconPhone as Phone,
  IconUser as User,
  IconUserPlus as UserPlus,
} from "@tabler/icons-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FrequentieKeuze } from "@/components/FrequentieKiezer";
import {
  PopupBlok,
  PopupBody,
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
  fetchDistricts,
  koppelKlant as hangKlantAanAdres,
  leesRitmeWaarde,
  patchCustomer,
  vulPostcodeAan,
  zorgVoorAdresRegel,
} from "@/lib/klanten";
import { klantVanAdres, type Bericht } from "@/lib/berichten";
import { koppelKlant } from "@/lib/mailacties";
import { zetVerwerkt } from "@/lib/aanmeldingen";
import { useRecht } from "@/lib/rechten";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  b: Bericht;
  onKlaar: () => void;
}

export function KlantUitMailDialog({ open, onOpenChange, b, onKlaar }: Props) {
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [telefoon2, setTelefoon2] = useState("");
  const [wijkId, setWijkId] = useState("");
  const [straat, setStraat] = useState("");
  const [nummer, setNummer] = useState("");
  const [postcode, setPostcode] = useState("");
  const [plaats, setPlaats] = useState("");
  const [prijs, setPrijs] = useState("");
  const [ritme, setRitme] = useState("");
  const [bezig, setBezig] = useState(false);
  const prijzenZien = useRecht("prijzen_zien");
  const wijken = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts, enabled: open });

  // Bij het openen alles terug naar wat in de mail stond.
  useEffect(() => {
    if (!open) return;
    const g = b.klantgegevens.gevonden;
    setNaam(g?.naam || b.van_naam);
    setEmail(b.van_email);
    setEmail2("");
    setTelefoon(g?.telefoon ?? "");
    setTelefoon2("");
    setStraat(g?.straat ?? "");
    setNummer(g?.huisnummer ?? "");
    setPostcode(g?.postcode ?? "");
    setPlaats(g?.plaats ?? "");
    setPrijs("");
    setRitme("");
    setWijkId("");
  }, [open, b]);

  // De wijk raden als de plaats bij precies één wijk hoort; anders kiest de mens.
  useEffect(() => {
    if (!open || wijkId || !wijken.data) return;
    const p = plaats.trim().toLowerCase();
    if (!p) return;
    const passend = wijken.data.filter((d) => (d.plaats ?? "").trim().toLowerCase() === p);
    if (passend.length === 1) setWijkId(passend[0]!.id);
    // Alleen bij het laden van de wijken: daarna is de keuze aan de gebruiker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wijken.data]);

  async function opslaan() {
    if (!naam.trim() && !email.trim() && !telefoon.trim()) {
      toast.error("Vul een naam, e-mail of telefoon in.");
      return;
    }
    if (!wijkId) {
      toast.error("Kies een wijk.");
      return;
    }
    if (!straat.trim() || !nummer.trim()) {
      toast.error("Vul een straat en een huisnummer in.");
      return;
    }
    const bedrag = Number(prijs.trim().replace(",", "."));
    if (prijzenZien && (!prijs.trim() || Number.isNaN(bedrag))) {
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
      const customerId = await zorgVoorAdresRegel(wijkId, straat, nummer);
      if (!customerId) {
        toast.error("Dat huisnummer begrijp ik niet.");
        return;
      }
      // Hoort het adres al bij iemand, dan geen tweede klant erop zetten.
      const bestaande = await klantVanAdres(customerId);
      if (bestaande) {
        toast.error(`Dit adres hoort al bij ${bestaande.naam || "een klant"}. Gebruik "Koppelen aan adres".`);
        return;
      }
      await patchCustomer(customerId, {
        // Zonder prijsrecht blijft de prijs op nul; het stempel laat zien dat
        // iemand er nog naar moet kijken.
        ...(prijzenZien ? { price: bedrag } : { aangemeld_op: new Date().toISOString() }),
        ...gekozen,
      });
      await vulPostcodeAan(customerId, postcode);
      const klant = await bewaarKlant(null, {
        naam,
        email,
        email2,
        telefoon,
        telefoon2,
        straat,
        huisnummer: nummer,
        postcode,
        plaats,
        notitie: "",
      });
      await hangKlantAanAdres([customerId], klant.id);
      // Zette Paaltje er al een aanmelding voor klaar, dan is die nu verwerkt.
      if (b.voorstel.aanmelding_id) {
        await zetVerwerkt(b.voorstel.aanmelding_id, customerId, klant.id).catch(() => undefined);
      }
      try {
        await koppelKlant(b.id, klant.id);
        toast.success(`${klant.naam || "De klant"} staat in het klantenbestand en hoort bij deze mail.`);
      } catch (e) {
        toast.error(
          `De klant is toegevoegd, maar aan de mail koppelen lukte niet: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
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
          titel="Klant toevoegen"
          subtitel={b.van_naam || b.van_email}
        />
        <PopupBody>
          <PopupBlok label="De klant">
            <PopupVeld icoon={<User className="size-4" />}>
              <Input className={popupInvoer} value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam" />
            </PopupVeld>
            <PopupPaar>
              <PopupVeld icoon={<Mail className="size-4" />}>
                <Input
                  className={popupInvoer}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-mail"
                />
              </PopupVeld>
              <PopupVeld icoon={<Phone className="size-4" />}>
                <Input
                  className={popupInvoer}
                  type="tel"
                  value={telefoon}
                  onChange={(e) => setTelefoon(e.target.value)}
                  placeholder="Telefoon"
                />
              </PopupVeld>
            </PopupPaar>
            <PopupPaar>
              <PopupVeld icoon={<Mail className="size-4" />}>
                <Input
                  className={popupInvoer}
                  type="email"
                  value={email2}
                  onChange={(e) => setEmail2(e.target.value)}
                  placeholder="Tweede e-mail"
                />
              </PopupVeld>
              <PopupVeld icoon={<Phone className="size-4" />}>
                <Input
                  className={popupInvoer}
                  type="tel"
                  value={telefoon2}
                  onChange={(e) => setTelefoon2(e.target.value)}
                  placeholder="Tweede telefoon"
                />
              </PopupVeld>
            </PopupPaar>
          </PopupBlok>

          <PopupBlok label="Wijk">
            <PopupVeld icoon={<MapPin className="size-4" />}>
              <Select value={wijkId} onValueChange={setWijkId}>
                <SelectTrigger className={popupInvoer}>
                  <SelectValue placeholder="Kies een wijk" />
                </SelectTrigger>
                <SelectContent>
                  {(wijken.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      {d.plaats ? ` · ${d.plaats}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PopupVeld>
          </PopupBlok>

          <PopupBlok label="Adres">
            <PopupPaar smal>
              <PopupVeld icoon={<House className="size-4" />}>
                <Input className={popupInvoer} value={straat} onChange={(e) => setStraat(e.target.value)} placeholder="Straat" />
              </PopupVeld>
              <PopupVeld icoon={<Hash className="size-4" />}>
                <Input className={popupInvoer} value={nummer} onChange={(e) => setNummer(e.target.value)} placeholder="12" />
              </PopupVeld>
            </PopupPaar>
            <PopupPaar>
              <PopupVeld>
                <Input
                  className={popupInvoer}
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="Postcode"
                />
              </PopupVeld>
              <PopupVeld>
                <Input className={popupInvoer} value={plaats} onChange={(e) => setPlaats(e.target.value)} placeholder="Plaats" />
              </PopupVeld>
            </PopupPaar>
          </PopupBlok>

          <PopupBlok label={prijzenZien ? "Prijs en frequentie" : "Frequentie"}>
            <PopupPaar>
              {prijzenZien && (
                <PopupVeld icoon={<CircleDollarSign className="size-4" />} achter="per beurt">
                  <Input
                    className={popupInvoer}
                    value={prijs}
                    onChange={(e) => setPrijs(e.target.value)}
                    placeholder="0,00"
                    inputMode="decimal"
                  />
                </PopupVeld>
              )}
              <PopupVeld>
                <FrequentieKeuze value={ritme} onChange={setRitme} />
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
