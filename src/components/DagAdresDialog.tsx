import { useEffect, useRef, useState } from "react";
import {
  IconCalendarCheck as CalendarCheck,
  IconCash as Cash,
  IconMessage as MessageSquare,
  IconRotate as RotateCcw,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  ritmeMaanden,
  type Customer,
  type QuickNote,
} from "@/lib/klanten";
import { toonDatum, vandaag } from "@/lib/wasdag";
import { PrijsCel } from "@/components/PrijsCel";
import { NotitieCel } from "@/components/NotitieCel";
import { FrequentieKiezer } from "@/components/FrequentieKiezer";
import { useRecht } from "@/lib/rechten";
import { useIsMobile } from "@/hooks/use-mobile";

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
  /** De ronde van deze beurt; weglaten = de maand van de dag. */
  ronde?: string | undefined;
  onOpslaan: (prijs: number, notitie: string | null) => void;
  /** Wat er vast bij het adres hoort bijwerken (prijs, notitie, frequentie).
   *  Laat weg om dat blok alleen te laten lezen. */
  onPatch?: ((patch: Partial<Customer>) => void | boolean | Promise<boolean>) | undefined;
  quickNotes?: QuickNote[] | undefined;
  onAddQuickNote?: ((label: string) => void) | undefined;
  /** Opent het betaalmenu; alleen bij een contant adres waar je mag betalen. */
  onBetalen?: (() => void) | undefined;
  /** Zet de prijs van de beurt op deze dag meteen op dit bedrag (het vinkje
   *  "Ook voor vandaag" bij een nieuwe vaste prijs). */
  onDagPrijs?: ((prijs: number) => void) | undefined;
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
  ronde,
  onOpslaan,
  onPatch,
  quickNotes,
  onAddQuickNote,
  onBetalen,
  onDagPrijs,
}: Props) {
  const [bedrag, setBedrag] = useState("");
  const [tekst, setTekst] = useState("");
  /** Een nieuwe vaste prijs ook voor de beurt van deze dag; standaard uit. */
  const [ookDezeDag, setOokDezeDag] = useState(false);
  /** De vaste prijs van de ronde zoals je hem in dit venster net zette: vink
   *  je daarna pas aan, dan geldt het vinkje daar ook voor. */
  const nieuweVast = useRef<number | null>(null);
  const prijzenZien = useRecht("prijzen_zien");
  const magPlannen = useRecht("planning");
  const magKlanten = useRecht("klanten_bewerken");
  // Op de telefoon schuift hij van onderen omhoog, zoals het betaalpaneel.
  const mobiel = useIsMobile();

  // Overnemen wat er in de database staat, elke keer als het schermpje
  // opengaat. Niet bij elke hervalidatie van de lijst: dan zou wat je net
  // intypte onder je handen weggepoetst worden.
  useEffect(() => {
    if (!open) return;
    setBedrag(String(prijs).replace(".", ","));
    setTekst(notitie ?? "");
    setOokDezeDag(false);
    nieuweVast.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!c) return null;

  // De ronde van de beurt: op 1 oktober kan dat september zijn.
  const maand = ronde ?? datum.slice(0, 7);
  const standaard = prijsVoorMaand(c, maand);
  const vast = noteVoorMaand(c, maand);
  const afwijkend = bedragVan(bedrag) !== standaard || tekst.trim() !== "";
  const ookLabel = datum === vandaag() ? "Ook voor vandaag" : "Ook voor deze dag";
  // Het vinkje kan alleen waar je zowel de vaste prijs als de dagprijs mag
  // zien en de vaste prijs mag wijzigen.
  const ookKan = !!onPatch && !!onDagPrijs && prijzenZien && magKlanten;

  /**
   * Een nieuwe vaste prijs. Staat "Ook voor vandaag" aan, dan krijgt de beurt
   * van deze dag dezelfde prijs (die van de ronde, met het extra werk erbij):
   * het veld hieronder loopt mee, en het wordt meteen bewaard, langs dezelfde
   * weg als "Prijs deze dag".
   */
  async function patchPrijs(patch: Partial<Customer>) {
    // Eerst de vaste prijs; lukt dat niet, dan ook de dag niet aanraken.
    if ((await onPatch?.(patch)) === false || !c) return;
    const nieuw = prijsVoorMaand({ ...c, ...patch }, maand);
    nieuweVast.current = nieuw;
    if (ookKan && ookDezeDag) zetDagPrijs(nieuw);
  }

  function zetDagPrijs(nieuw: number) {
    setBedrag(String(nieuw).replace(".", ","));
    onDagPrijs?.(nieuw);
  }

  function bewaar() {
    const schoon = tekst.trim();
    onOpslaan(bedragVan(bedrag), schoon === "" ? null : schoon);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader
        blad={mobiel}
        onSluit={() => onOpenChange(false)}
        onKeyDown={opslaanBijEnter(bewaar)}
      >
        <PopupKop
          // Groen: dit gaat over het bedrag van één dag.
          kleur="groen"
          icoon={<CalendarCheck className="size-[22px]" />}
          titel={`${straat} ${formatNumber(c)}`}
          subtitel={`Alleen voor ${toonDatum(datum)}`}
        />
        <PopupBody>
          {/* Wat er vast bij dit adres hoort, voor elke ronde. Met de rechten
              ervoor pas je het hier aan, net als in de wijken; de prijs van
              deze dag (hieronder) verandert daar niet door. Enter in een
              vakje bewaart alleen dat vakje: dit venster blijft open. */}
          <PopupBlok label="Vast bij dit adres">
            <dl
              className="divide-y divide-border/60 rounded-xl border border-input text-[13px]"
              onKeyDown={(e) => {
                // Alleen in een invulvak; Enter op een knop opent die gewoon.
                if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                  e.preventDefault();
                }
              }}
            >
              {prijzenZien && (
                <div className="flex min-h-9 items-center gap-2 px-3 py-1">
                  <dt className="w-24 shrink-0 text-muted-foreground">Vaste prijs</dt>
                  <dd className="w-28 min-w-0">
                    {onPatch ? (
                      <PrijsCel
                        customer={c}
                        ronde={maand}
                        onPatch={(patch) => void patchPrijs(patch)}
                        alleenLezen={!magKlanten}
                      />
                    ) : (
                      <span className="tabular-nums">{formatPrice(standaard)}</span>
                    )}
                  </dd>
                </div>
              )}
              <div className="flex min-h-9 items-center gap-2 px-3 py-1">
                <dt className="w-24 shrink-0 text-muted-foreground">Frequentie</dt>
                <dd className="flex min-w-0 flex-1">
                  {onPatch ? (
                    <FrequentieKiezer customer={c} onPatch={onPatch} alleenLezen={!magPlannen} />
                  ) : (
                    ritmeLabel(c)
                  )}
                </dd>
              </div>
              <div className="flex min-h-9 items-center gap-2 px-3 py-1">
                <dt className="w-24 shrink-0 text-muted-foreground">Notitie</dt>
                <dd className="min-w-0 flex-1">
                  {onPatch ? (
                    <NotitieCel
                      value={c.note}
                      maandwerk={c.maandwerk}
                      onChangeMaandwerk={(werk) => onPatch({ maandwerk: werk })}
                      beurtMaanden={ritmeMaanden(c).map((m) => String(m).padStart(2, "0"))}
                      quickNotes={quickNotes ?? []}
                      onChange={(v) => onPatch({ note: v })}
                      onAddQuickNote={(label) => onAddQuickNote?.(label)}
                      alleenLezen={!magPlannen}
                    />
                  ) : (
                    vast || <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            </dl>
            {ookKan && (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={ookDezeDag}
                    onCheckedChange={(v) => {
                      setOokDezeDag(v === true);
                      // Eerst de prijs veranderd en dan pas aangevinkt.
                      if (v === true && nieuweVast.current !== null) {
                        zetDagPrijs(nieuweVast.current);
                      }
                    }}
                  />
                  {ookLabel}
                </label>
                <PopupHint>
                  Een nieuwe vaste prijs geldt vanaf de volgende beurt, tenzij je '{ookLabel}'
                  aanvinkt.
                </PopupHint>
              </>
            )}
          </PopupBlok>

          {prijzenZien && (
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
          )}

          {/* Contant betaald? Dat tik je in het betaalmenu, hetzelfde als
              achter "Betalen…" in het menu van de regel. */}
          {onBetalen && (
            <PopupBlok label="Contant">
              <Button
                type="button"
                variant="outline"
                className="self-start rounded-full"
                onClick={() => {
                  // Wat je hierboven al typte eerst bewaren; daarna het betaalmenu.
                  bewaar();
                  onBetalen();
                }}
              >
                <Cash className="size-4" /> Betalen…
              </Button>
            </PopupBlok>
          )}

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
