import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconCash as Cash,
  IconCheck as Check,
  IconCoin as Coin,
  IconDiscount as Discount,
  IconCalendarDollar as CalendarDollar,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PopupBlok, PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { DagContant, fetchDagStand } from "@/components/betalingen/DagContant";
import {
  BedragDialoog,
  KortingDialoog,
  VooruitDialoog,
} from "@/components/betalingen/DeurDialogen";
import { Eerder } from "@/components/betalingen/Eerder";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { beurtenTekst, rekening } from "@/lib/betalingen";
import { boek, nieuweTik, type Tik } from "@/lib/geldlopen";
import { formatPrice, type Customer, type District } from "@/lib/klanten";
import { useMagAfrekenen } from "@/lib/rechten";
import { pushUndo, undoKnop } from "@/lib/undo";
import { fetchGeldAdres, vooruitLabel } from "@/lib/overzichten";

/** Wat dit venster van een adres nodig heeft; ook bij Afrekenen, zonder hele klantregel. */
type Adres = Pick<Customer, "id" | "house_number" | "addition" | "inactief_op">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Adres | null;
  /** "Kerkstraat 12", voor in de kop. */
  adresTekst: string;
  /** De wijk van het adres: is die al gestart bij Betalingen? */
  wijk: Pick<District, "id" | "geld_peildatum"> | undefined;
  /** Staat het adres vandaag op de route? Dan telt de beurt van vandaag mee. */
  vandaag: boolean;
}

/**
 * Betalen vanaf de dag, bij een contant adres. Dezelfde knoppen als aan de
 * deur bij geldlopen, maar alleen wat jouw rol hier mag:
 *
 * - De eigenaar, en wie mag afrekenen, boekt op kantoor: betaald, een ander
 *   bedrag, korting en vooruit betalen (een andere prijs per beurt alleen de
 *   eigenaar). Is de wijk nog niet gestart bij Betalingen, dan weet de app
 *   niet wat er openstaat; dan staat hier de weg erheen.
 * - Een medewerker tikt overdag alleen in wat hij vandaag kreeg (betaald of
 *   een ander bedrag, en dat weer ongedaan maken), op zijn eigen route.
 *
 * Niet thuis en Geen geld horen bij de avond aan de deur; die staan hier niet.
 */
export function DagBetalen({ open, onOpenChange, customer: c, adresTekst, wijk, vandaag }: Props) {
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const kantoor = useMagAfrekenen();
  const mobiel = useIsMobile();
  if (!c) return null;
  const gestart = !!wijk?.geld_peildatum;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader blad={mobiel} onSluit={() => onOpenChange(false)}>
        <PopupKop
          kleur="groen"
          icoon={<Cash className="size-[22px]" />}
          titel={adresTekst}
          subtitel={kantoor ? "Betalen · geboekt op kantoor" : "Contant betaald vandaag"}
        />
        <PopupBody>
          {kantoor && !gestart ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-[12px] bg-tint-amber px-3 py-2 text-[13px] text-tint-amber-ink">
                Deze wijk telt nog niet mee bij Betalingen: de app weet nog niet wat er openstaat.
              </p>
              {/* Een wijk starten doet de eigenaar. */}
              {wijk && isEigenaar && (
                <Button asChild className="self-start rounded-full">
                  <Link
                    to="/betalingen"
                    search={{ tab: "kaart", wijk: wijk.id }}
                    onClick={() => onOpenChange(false)}
                  >
                    Wijk starten
                  </Link>
                </Button>
              )}
            </div>
          ) : kantoor ? (
            <KantoorBetalen
              customer={c}
              adresTekst={adresTekst}
              vandaag={vandaag}
              prijsAanpassen={isEigenaar}
              onKlaar={() => onOpenChange(false)}
            />
          ) : (
            <DagContant
              adres={c.id}
              leeg={
                <p className="text-[13px] text-muted-foreground">
                  Hier kun je nu niets intikken: het adres staat vandaag niet op jouw route, of
                  betaalt niet contant.
                </p>
              }
            />
          )}
        </PopupBody>
        <PopupVoet>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Sluiten
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

type Venster = "korting" | "bedrag" | "vooruit" | null;

/** Op kantoor: wat er openstaat en alles wat je kunt boeken. */
function KantoorBetalen({
  customer: c,
  adresTekst,
  vandaag,
  prijsAanpassen,
  onKlaar,
}: {
  customer: Adres;
  adresTekst: string;
  vandaag: boolean;
  /** Een andere prijs per beurt bij vooruit betalen: alleen de eigenaar. */
  prijsAanpassen: boolean;
  /** Alles betaald: het venster mag dicht. */
  onKlaar: () => void;
}) {
  const qc = useQueryClient();
  const geld = useQuery({
    queryKey: ["geld-adres", c.id],
    queryFn: () => fetchGeldAdres(c.id),
  });
  // Op de route van vandaag: de beurt van vandaag is nog niet afgemeld en
  // staat dus nog niet in de gewone stand. De stand van overdag telt hem
  // wel mee (dezelfde als die de medewerker ziet), anders zou er "niets
  // open" staan terwijl de klant voor vandaag betaalt.
  const dag = useQuery({
    queryKey: ["dag-geld", c.id],
    queryFn: () => fetchDagStand(c.id),
    enabled: vandaag,
  });
  const [venster, setVenster] = useState<Venster>(null);
  const [bezig, setBezig] = useState(false);
  const g = geld.data;
  // Wat er openstaat: met de beurt van vandaag erbij als die er is.
  const stand = dag.data ? { open: dag.data.open, delen: dag.data.delen } : g;

  function vernieuw() {
    void qc.invalidateQueries({ queryKey: ["geld-adres", c.id] });
    void qc.invalidateQueries({ queryKey: ["dag-geld", c.id] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
    void qc.invalidateQueries({ queryKey: ["geld-afrekenen"] });
    void qc.invalidateQueries({ queryKey: ["geld-eerder", c.id] });
    void qc.invalidateQueries({ queryKey: ["laatste-ronde", c.id] });
  }

  /**
   * Na "Klopt niet": terugdraaien kan een geplande wissel naar overmaken laten
   * doorgaan of terugzetten, en dan verandert de betaalwijze van het adres
   * zelf. Alleen dan de (grote) adressenlijst opnieuw ophalen.
   */
  function naTerugdraaien() {
    vernieuw();
    void qc.invalidateQueries({ queryKey: ["customers"] });
  }

  /** Een boeking terugdraaien; een fout gaat door naar de Ongedaan-melding. */
  async function herstel(id: string) {
    await boek(nieuweTik({ adres: c.id, soort: "ongedaan", herroept: id, bron: "kantoor" }));
    vernieuw();
  }

  /** Eén boeking op kantoor, met Ongedaan maken in de melding. */
  async function tik(
    t: Omit<Tik, "id" | "op" | "adres" | "bron" | "getoond_open">,
    melding: string,
  ): Promise<boolean> {
    const nieuw = nieuweTik({
      ...t,
      adres: c.id,
      bron: "kantoor",
      getoond_open: stand?.open ?? null,
    });
    setBezig(true);
    try {
      await boek(nieuw);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBezig(false);
    }
    vernieuw();
    // Ook in de Ongedaan-rij van de pagina, zodat de knop bovenaan dit
    // terugdraait en niet iets van daarvoor.
    pushUndo({ label: melding, undo: () => herstel(nieuw.id) });
    toast.success(`${melding} · ${adresTekst}`, { duration: 10000, action: undoKnop() });
    return true;
  }

  if (geld.isLoading || (vandaag && dag.isLoading))
    return <p className="text-[13px] text-muted-foreground">Laden…</p>;
  if (geld.isError || !g || !stand) {
    return (
      <p className="text-[13px] text-tint-rood-ink">
        {geld.error instanceof Error
          ? geld.error.message
          : "Het geld van dit adres kwam niet binnen."}
      </p>
    );
  }

  const regels = rekening(stand.delen, g.vooruit_p);
  const open = stand.open > 0.005;
  const gestopt = !!c.inactief_op;
  // Beurten die nog gebruikt worden; die van een vorige bewoner niet.
  const vooruitOver = Math.max(0, g.vooruit_over - g.vooruit_vast);
  // Vooruit betalen kan alleen bij een adres dat nog loopt en een prijs
  // heeft, en niet zolang de beurten van een vorige bewoner nog terug moeten.
  const vooruitKan = g.vooruit_p !== null && !gestopt && g.vooruit_vast === 0;
  const adres = {
    id: c.id,
    open: stand.open,
    delen: stand.delen,
    house_number: c.house_number,
    addition: c.addition ?? "",
    vaste_kortingen: g.vaste_kortingen,
  };

  return (
    <>
      <PopupBlok label="Wat er openstaat">
        <div className="rounded-[14px] bg-surface px-3.5 py-2.5">
          {regels.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {stand.open < -0.005
                ? `Tegoed: ${formatPrice(-stand.open)}. Er staat niets open.`
                : "Er staat niets open."}
            </p>
          ) : (
            <>
              {regels.map((r, i) => (
                <div key={i} className="flex items-baseline gap-3 py-0.5 text-[13.5px]">
                  <span className="min-w-0 flex-1">
                    {r.label} <span className="text-[12px] text-muted-foreground">{r.wanneer}</span>
                    {r.uitleg && (
                      <span className="block text-[12px] text-muted-foreground">{r.uitleg}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag)}</span>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1.5 text-[14.5px] font-semibold">
                <span>Totaal</span>
                <span className="tabular-nums">{formatPrice(stand.open)}</span>
              </div>
            </>
          )}
        </div>
        {vooruitOver > 0 && (
          <p className="rounded-[12px] bg-tint-groen px-3 py-2 text-[13px] text-tint-groen-ink">
            Nog {beurtenTekst(vooruitOver)} vooruit betaald.
          </p>
        )}
      </PopupBlok>

      <div className="grid grid-cols-3 gap-1.5">
        <KleineKnop
          icoon={<Discount className="size-[18px]" />}
          kleur="bg-tint-amber text-tint-amber-ink"
          disabled={!open || bezig}
          onClick={() => setVenster("korting")}
        >
          Korting
        </KleineKnop>
        <KleineKnop
          icoon={<Coin className="size-[18px]" />}
          kleur="bg-tint-groen text-tint-groen-ink"
          disabled={!open || bezig}
          onClick={() => setVenster("bedrag")}
        >
          Ander bedrag
        </KleineKnop>
        <KleineKnop
          icoon={<CalendarDollar className="size-[18px]" />}
          kleur="bg-tint-blauw text-tint-blauw-ink"
          disabled={!vooruitKan || bezig}
          onClick={() => setVenster("vooruit")}
        >
          Vooruit
        </KleineKnop>
      </div>
      {!vooruitKan && !gestopt && g.vooruit_vast > 0 && (
        <p className="-mt-2 text-[12px] text-muted-foreground">
          Vooruit betalen kan pas als de beurten van de vorige bewoner terug zijn (dossier, Geld).
        </p>
      )}

      {open && (
        <button
          type="button"
          disabled={bezig}
          onClick={() =>
            void tik(
              { soort: "betaald", bedrag: stand.open },
              `Betaald ${formatPrice(stand.open)}`,
            ).then((ok) => ok && onKlaar())
          }
          className="flex min-h-14 w-full items-center justify-center gap-1.5 rounded-[16px] bg-tint-salie font-display text-[17px] font-semibold tracking-[-0.01em] text-tint-salie-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          <Check className="size-5" /> Betaald {formatPrice(stand.open)}
        </button>
      )}

      {/* Wat er eerder geboekt is, met wie; wat niet klopt draai je hier terug. */}
      <Eerder key={c.id} adres={c.id} onTeruggedraaid={naTerugdraaien} />

      <KortingDialoog
        open={venster === "korting"}
        adres={adres}
        onSluit={() => setVenster(null)}
        onKorting={(bedrag, reden) =>
          tik({ soort: "korting", bedrag, reden }, `Korting −${formatPrice(bedrag)}`)
        }
        onVeranderd={vernieuw}
      />
      <BedragDialoog
        open={venster === "bedrag"}
        adres={adres}
        onSluit={() => setVenster(null)}
        onBedrag={(bedrag) => tik({ soort: "betaald", bedrag }, `Betaald ${formatPrice(bedrag)}`)}
      />
      <VooruitDialoog
        open={venster === "vooruit"}
        subtitel={adresTekst}
        delen={stand.delen}
        vanaf={g.vooruit_vanaf}
        prijs={g.vooruit_p}
        prijsAanpassen={prijsAanpassen}
        onSluit={() => setVenster(null)}
        onVooruit={(aantal, prijs) => {
          const bedrag = Math.round(aantal * prijs * 100) / 100;
          return tik(
            { soort: "vooruit", aantal, prijs_per_beurt: prijs, bedrag },
            `${vooruitLabel(aantal)} ${formatPrice(bedrag)}`,
          );
        }}
      />
    </>
  );
}

function KleineKnop({
  children,
  icoon,
  kleur,
  disabled,
  onClick,
}: {
  children: string;
  icoon: ReactNode;
  kleur: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-[16px] px-1 font-display text-[12px] font-semibold leading-tight transition-transform active:scale-[0.98] disabled:opacity-40 ${kleur}`}
    >
      {icoon}
      <span className="w-full truncate text-center">{children}</span>
    </button>
  );
}
