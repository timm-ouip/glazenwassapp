/**
 * Ja aan de deur: van een BAG-adres een klant maken, met prijs en frequentie.
 *
 * De prijs staat al ingevuld: de prijs die bij het lopen genoteerd is, anders
 * het prijsvoorstel (dan staat erbij dat het een voorstel is).
 *
 * De uitkomst "ja" is dan al bewaard (zie LoopAdresRij), zodat een collega
 * het meteen ziet. Hier komen de prijs (verplicht), naam en telefoon (mag
 * leeg) en de frequentie bij, en de straat in een wijk:
 *
 * - hoort het adres al bij een wijkstraat, dan die, zonder te vragen;
 * - anders eerst de wijk, en dan de straat in die wijk (de straat met
 *   dezelfde naam staat al gekozen), of een nieuwe straat met de BAG-naam.
 *
 * Was het adres al klant, dan verandert er aan die klant niets: het venster
 * zegt dat in geel, met de prijs die je intikte.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCurrencyEuro as Euro,
  IconMap as Kaart,
  IconPhone as Phone,
  IconRepeat as Herhaal,
  IconRoad as Weg,
  IconUser as User,
  IconUserPlus as UserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { FrequentieKeuze } from "@/components/FrequentieKiezer";
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
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchDistricts, fetchStreets, formatPrice, leesRitmeWaarde } from "@/lib/klanten";
import {
  LOOP_TELLINGEN,
  foutTekst,
  leesPrijs,
  LOOP_VOORSTELLEN,
  loopNummer,
  maakKlantVanAdres,
  officieleNaam,
  prijsTekst,
  voorstelUitleg,
  woningtypeVan,
  zetLoopAdres,
  type LoopAdres,
  type LoopVoorstel,
} from "@/lib/lopen";
import { startMaandVoorNieuw } from "@/lib/nieuwAdres";

/** De keuze "Nieuwe straat" in de straatkiezer. Een lege string kan niet:
 *  Radix gebruikt die voor "nog niets gekozen". */
const NIEUW = "nieuw";

const KIES_STIJL = "h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0";

export function JaDialog({
  rij,
  voorstel,
  gebiedWijk,
  onOpenChange,
}: {
  /** Het adres; leeg = dicht. */
  rij: LoopAdres | null;
  /** Het prijsvoorstel voor dit adres, als er een is. */
  voorstel: LoopVoorstel | null;
  /** De wijk van het gebied, of leeg bij een los gebied. */
  gebiedWijk: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = rij !== null;
  const qc = useQueryClient();
  const wijken = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts, enabled: open });
  const straten = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, enabled: open });

  const [prijs, setPrijs] = useState("");
  /** De prijs komt uit het voorstel (en is nog niet aangepast). */
  const [uitVoorstel, setUitVoorstel] = useState(false);
  const [naam, setNaam] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [frequentie, setFrequentie] = useState("");
  const [wijk, setWijk] = useState("");
  const [straat, setStraat] = useState(NIEUW);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  /** Was het adres al klant: de prijs die je intikte, voor de gele melding. */
  const [bestond, setBestond] = useState<number | null>(null);

  // Bij elk nieuw adres opnieuw beginnen.
  useEffect(() => {
    if (!rij) return;
    const metVoorstel = rij.prijs === null && voorstel !== null;
    setPrijs(prijsTekst(metVoorstel ? voorstel.voorstel : rij.prijs));
    setUitVoorstel(metVoorstel);
    setNaam("");
    setTelefoon("");
    setFrequentie("");
    setWijk(gebiedWijk ?? "");
    setStraat(NIEUW);
    setFout(null);
    setBestond(null);
    // Alleen bij een ander adres; een verversing van de lijst laat je invoer staan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rij?.id]);

  /** De wijkstraat waar het adres al bij hoort, als die er (nog) is. */
  const vasteStraat = useMemo(
    () =>
      rij?.street_id ? ((straten.data ?? []).find((s) => s.id === rij.street_id) ?? null) : null,
    [rij?.street_id, straten.data],
  );

  const stratenInWijk = useMemo(
    () => (straten.data ?? []).filter((s) => s.district_id === wijk),
    [straten.data, wijk],
  );

  // Een andere wijk: de straat met dezelfde naam alvast kiezen.
  const bagStraat = rij?.straat ?? "";
  useEffect(() => {
    if (vasteStraat) return;
    const n = bagStraat.trim().toLowerCase();
    const zelfde = stratenInWijk.find(
      (s) => s.volledige_naam.trim().toLowerCase() === n || s.name.trim().toLowerCase() === n,
    );
    setStraat(zelfde?.id ?? NIEUW);
  }, [rij?.id, bagStraat, vasteStraat, stratenInWijk]);

  // Eén wijk in het bedrijf: die hoeft niemand te kiezen.
  useEffect(() => {
    if (open && !wijk && wijken.data?.length === 1) setWijk(wijken.data[0]!.id);
  }, [open, wijk, wijken.data]);

  async function opslaan() {
    if (!rij) return;
    setFout(null);
    const bedrag = leesPrijs(prijs);
    if (bedrag === null || bedrag === undefined) {
      setFout("Vul een prijs in, bijvoorbeeld 14,50.");
      return;
    }
    const ritme = leesRitmeWaarde(frequentie);
    if (!ritme) {
      setFout("Kies een frequentie.");
      return;
    }
    const doelWijk = vasteStraat ? vasteStraat.district_id : wijk;
    if (!doelWijk) {
      setFout("Kies een wijk.");
      return;
    }
    setBezig(true);
    try {
      // De prijs eerst bij het lopen bewaren: ook als het klant maken
      // mislukt, of het adres al klant blijkt, is hij niet weg.
      if (bedrag !== rij.prijs) await zetLoopAdres(rij.id, { prijs: bedrag });
      const uit = await maakKlantVanAdres({
        adres: rij.id,
        wijk: doelWijk,
        straat: vasteStraat ? vasteStraat.id : straat === NIEUW ? null : straat,
        prijs: bedrag,
        interval_maanden: ritme.interval_maanden,
        ritme: ritme.ritme,
        start_maand: startMaandVoorNieuw(ritme),
        naam: naam.trim(),
        telefoon: telefoon.trim(),
      });
      if (uit.bestond) {
        setBestond(bedrag);
      } else {
        toast.success(`Klant gemaakt: ${rij.straat} ${loopNummer(rij)}`);
        onOpenChange(false);
      }
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
      // In elk geval verversen: ook "net al klant gemaakt" (een collega was
      // je voor) moet de rij grijs maken.
      void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["klanten"] });
      void qc.invalidateQueries({ queryKey: ["streets"] });
    }
  }

  const adres = rij ? `${rij.straat} ${loopNummer(rij)}` : "";
  const wijkNaam = (id: string) => (wijken.data ?? []).find((w) => w.id === id)?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-md">
        <PopupKop
          kleur="groen"
          icoon={<UserPlus className="size-[22px]" />}
          titel="Nieuwe klant"
          subtitel={adres}
        />
        <PopupBody>
          {bestond !== null ? (
            <div className="rounded-xl bg-tint-geel px-4 py-3 text-[13.5px] leading-relaxed text-tint-geel-ink">
              Dit adres was al klant. Je prijs ({formatPrice(bestond)}) is niet bij de klant gezet;
              geef hem door aan wie de prijzen beheert, of pas hem aan in het dossier.
            </div>
          ) : (
            <>
              <PopupBlok label="Prijs per beurt">
                <PopupVeld icoon={<Euro className="size-4" />}>
                  <Input
                    inputMode="decimal"
                    className={popupInvoer}
                    placeholder="14,50"
                    value={prijs}
                    onChange={(e) => {
                      setPrijs(e.target.value);
                      setUitVoorstel(false);
                    }}
                    aria-label="Prijs per beurt"
                  />
                </PopupVeld>
                {uitVoorstel && voorstel && rij && (
                  <PopupHint>
                    Voorstel, uit {voorstelUitleg(voorstel, woningtypeVan(rij))}. Pas het aan als je
                    iets anders afspreekt.
                  </PopupHint>
                )}
              </PopupBlok>

              <PopupBlok label="Frequentie">
                <PopupVeld icoon={<Herhaal className="size-4" />}>
                  <FrequentieKeuze value={frequentie} onChange={setFrequentie} />
                </PopupVeld>
              </PopupBlok>

              <PopupBlok label="Klant (mag leeg)">
                <PopupPaar>
                  <PopupVeld icoon={<User className="size-4" />}>
                    <Input
                      className={popupInvoer}
                      placeholder="Naam"
                      autoComplete="off"
                      value={naam}
                      onChange={(e) => setNaam(e.target.value)}
                      aria-label="Naam"
                    />
                  </PopupVeld>
                  <PopupVeld icoon={<Phone className="size-4" />}>
                    <Input
                      type="tel"
                      className={popupInvoer}
                      placeholder="Telefoon"
                      autoComplete="off"
                      value={telefoon}
                      onChange={(e) => setTelefoon(e.target.value)}
                      aria-label="Telefoon"
                    />
                  </PopupVeld>
                </PopupPaar>
              </PopupBlok>

              {vasteStraat ? (
                <PopupHint>
                  Komt in {officieleNaam(vasteStraat)}
                  {wijkNaam(vasteStraat.district_id) &&
                    `, wijk ${wijkNaam(vasteStraat.district_id)}`}
                  .
                </PopupHint>
              ) : (
                <>
                  <PopupBlok label="In welke wijk?">
                    <PopupVeld icoon={<Kaart className="size-4" />}>
                      <Select value={wijk} onValueChange={setWijk}>
                        <SelectTrigger className={KIES_STIJL} aria-label="Wijk">
                          <SelectValue placeholder="Kies een wijk…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(wijken.data ?? []).map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </PopupVeld>
                  </PopupBlok>
                  {wijk && rij && (
                    <PopupBlok label="Straat">
                      <PopupVeld icoon={<Weg className="size-4" />}>
                        <Select value={straat} onValueChange={setStraat}>
                          <SelectTrigger className={KIES_STIJL} aria-label="Straat">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {stratenInWijk.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {officieleNaam(s)}
                                {s.volledige_naam.trim() &&
                                s.name.trim() !== s.volledige_naam.trim()
                                  ? ` (${s.name})`
                                  : ""}
                              </SelectItem>
                            ))}
                            <SelectItem value={NIEUW}>Nieuwe straat: {rij.straat}</SelectItem>
                          </SelectContent>
                        </Select>
                      </PopupVeld>
                    </PopupBlok>
                  )}
                </>
              )}

              {fout && (
                <p
                  role="alert"
                  className="rounded-xl bg-tint-rood px-3 py-2 text-[13px] text-tint-rood-ink"
                >
                  {fout}
                </p>
              )}
            </>
          )}
        </PopupBody>
        <PopupVoet>
          {bestond !== null ? (
            <Button className="rounded-full" onClick={() => onOpenChange(false)}>
              Sluiten
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => onOpenChange(false)}
              >
                Later
              </Button>
              <Button className="rounded-full" disabled={bezig} onClick={() => void opslaan()}>
                {bezig ? "Bezig…" : "Klant maken"}
              </Button>
            </>
          )}
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
