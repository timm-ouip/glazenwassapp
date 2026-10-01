import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconCalendarDollar as CalendarDollar,
  IconCheck as Check,
  IconCoin as Coin,
  IconDiscount as Discount,
  IconDoorOff as DoorOff,
  IconFolder as Folder,
  IconLoader2 as Loader2,
  IconWalletOff as WalletOff,
  IconX as Kruis,
} from "@tabler/icons-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  KortingDialoog,
  BedragDialoog,
  KlachtDialoog,
  VooruitDialoog,
} from "@/components/betalingen/DeurDialogen";
import { GeldloopDossier } from "@/components/betalingen/GeldloopDossier";
import { useBevestig } from "@/components/Bevestig";
import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  beurtenTekst,
  frequentieZin,
  keerOpen,
  maandVanNu,
  rekening,
  volgendeMaand,
  vooruitNieuweMaanden,
} from "@/lib/betalingen";
import { useAuth } from "@/lib/auth";
import {
  geldloopNietGewassen,
  heeftIetsOpen,
  nieuweTik,
  vooruitTotVan,
  type GeldloopAdres,
  type Tik,
  type Vrijgave,
} from "@/lib/geldlopen";
import { zetInWachtrij } from "@/lib/geldloop-wachtrij";
import {
  addQuickNote,
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchQuickNotes,
  fetchStreets,
  formatPrice,
  type Customer,
  type District,
  type Klant,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { vooruitLabel } from "@/lib/overzichten";

type Venster = "korting" | "bedrag" | "klacht" | "dossier" | "vooruit" | null;

/** Wat het volledige klantdossier nodig heeft, vers opgehaald bij het openen. */
interface VolDossier {
  klant: Klant | null;
  adres: Customer;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
}

/**
 * Wat je ziet als je een adres aantikt: bovenin wat je leest (wie, wat er
 * open staat en waarvoor), onderin wat je aantikt — eerst de rij van vier
 * (Korting, Deel betaald, Klacht en Dossier), dan Niet thuis, Geen geld en
 * Niet gewassen, dan Vooruit betalen, en helemaal onderaan de grote
 * saliegroene Betaald.
 *
 * Op de telefoon schuift het van onderen omhoog, zodat alles onder je duim
 * zit. Op de computer is dat onhandig: daar staat hetzelfde als een venster
 * midden in beeld, met Esc om te sluiten, Enter voor Betaald en de pijltjes
 * naar het vorige of volgende adres.
 */
export function BetaalPaneel({
  adres,
  vrijgave,
  voorbij,
  onSluit,
  onVeranderd,
  onVorige,
  onVolgende,
}: {
  adres: GeldloopAdres | null;
  vrijgave: Vrijgave;
  voorbij: boolean;
  onSluit: () => void;
  /** Voor wat niet via de wachtrij gaat (klacht, vaste korting). */
  onVeranderd: () => void;
  /** Met de pijltjes door de lijst, zonder het venster te sluiten. */
  onVorige?: (() => void) | undefined;
  onVolgende?: (() => void) | undefined;
}) {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const mobiel = useIsMobile();
  const bevestig = useBevestig();
  const isEigenaar = employee?.rol === "eigenaar";
  const [venster, setVenster] = useState<Venster>(null);
  // Het volledige dossier (alleen de eigenaar): eerst laden, dan openen.
  const [dossierLaden, setDossierLaden] = useState(false);
  const [volDossier, setVolDossier] = useState<VolDossier | null>(null);
  // Het laatst gekozen adres vasthouden terwijl het paneel dichtschuift.
  const [a, setA] = useState<GeldloopAdres | null>(adres);
  useEffect(() => {
    if (adres) setA(adres);
  }, [adres]);

  /**
   * Eén tik: meteen zichtbaar in de lijst, en op de achtergrond naar de
   * database. Het paneel wacht er niet op: met slecht bereik loop je gewoon
   * door naar het volgende huis. Weigert de database hem, dan meldt de app
   * dat (en staat hij bij "Niet verwerkt").
   */
  function stuur(t: Omit<Tik, "id" | "op" | "adres" | "getoond_open">): string | null {
    if (!a || !employee) return null;
    const nieuw = {
      ...nieuweTik({ ...t, adres: a.id, getoond_open: a.open }),
      vrijgave: vrijgave.id,
      door: employee.id,
      door_naam: employee.naam || employee.email || "",
      adres_tekst: `${a.straat} ${a.house_number}${a.addition}`,
    };
    zetInWachtrij(nieuw);
    return nieuw.id;
  }

  async function tik(
    t: Omit<Tik, "id" | "op" | "adres" | "getoond_open">,
    melding: string,
    sluiten: boolean,
  ): Promise<boolean> {
    if (!a) return false;
    const id = stuur(t);
    if (!id) return false;
    if (sluiten) onSluit();
    const nummer = `${a.house_number}${a.addition}`;
    toast.success(`${melding} · nr ${nummer}`, {
      duration: 8000,
      action: {
        label: "Ongedaan maken",
        onClick: () => {
          stuur({ soort: "ongedaan", herroept: id });
          toast(`Teruggedraaid · nr ${nummer}`);
        },
      },
    });
    return true;
  }

  function herstel(id: string) {
    stuur({ soort: "ongedaan", herroept: id });
    toast("Teruggedraaid");
  }

  const regels = a ? rekening(a.delen) : [];
  const open = a && heeftIetsOpen(a);
  const kanTikken = !!a && (!voorbij || isEigenaar);
  const vanMij = a?.vanavond && (a.vanavond.door === employee?.id || isEigenaar);
  // Vooruit betaald en nog niet op: de vaste korting zit dan al in de prijs
  // per beurt (de database weigert hem ook).
  const vooruitOver = a && !a.gestopt ? a.vooruit_over : 0;
  const vooruitGedekt =
    vooruitOver > 0 || !!a?.delen.some((d) => d.soort === "wassen" && (d.vooruit ?? 0) > 0.005);
  // Vooruit betalen kan alleen bij een contant adres dat nog loopt en een prijs
  // heeft, en niet zolang de beurten van een vorige bewoner nog terug moeten.
  const vooruitKan =
    !!a && a.vooruit_p !== null && a.methode === "contant" && !a.gestopt && a.vooruit_vast === 0;

  /**
   * De dossierknop. Een geldloper krijgt het kleine dossier (zonder
   * betaalwijze); de eigenaar het volledige klantdossier, zodat hij aan de
   * deur ook contant of overmaken kan omzetten. Klanten en adressen vers
   * ophalen: het dossier schrijft bij opslaan alles terug, en met een oude
   * versie zou je een net toegevoegd nummer stil weer wissen (zie DossierKnop).
   */
  async function openDossier() {
    if (!a) return;
    if (!isEigenaar) {
      setVenster("dossier");
      return;
    }
    setDossierLaden(true);
    try {
      const vers = <T,>(queryKey: string[], queryFn: () => Promise<T>) =>
        qc.fetchQuery({ queryKey, queryFn, staleTime: 0 });
      const [districts, streets, customers, klanten, quickNotes] = await Promise.all([
        vers(["districts"], fetchDistricts),
        vers(["streets"], fetchStreets),
        vers(["customers"], fetchCustomers),
        vers(["klanten"], fetchKlanten),
        vers(["quick_notes"], fetchQuickNotes),
      ]);
      const pand = customers.find((c) => c.id === a.id);
      if (!pand) {
        toast.error("Dit adres staat er niet (meer).");
        return;
      }
      const klant = klanten.find((k) => k.id === pand.klant_id) ?? null;
      setVolDossier({ klant, adres: pand, districts, streets, customers, klanten, quickNotes });
    } catch {
      toast.error("Het dossier kon niet geladen worden. Probeer het zo nog eens.");
    } finally {
      setDossierLaden(false);
    }
  }

  /** Na het dossier: een andere betaalwijze of prijs meteen in de lijst. */
  function ververs() {
    void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] });
  }

  function betaalAlles() {
    if (!a || !open || !kanTikken) return;
    void tik({ soort: "betaald", bedrag: a.open }, `Betaald ${formatPrice(a.open)}`, true);
  }

  /**
   * Er is hier helemaal niet gewassen — vergeten, of er kon niemand bij. De
   * beurt blijft op de dag staan, maar telt niet meer mee: het bedrag vervalt
   * en het adres telt weer als niet gewassen.
   */
  async function meldNietGewassen() {
    if (!a) return;
    const nummer = `${a.house_number}${a.addition}`;
    const ja = await bevestig({
      titel: `Nummer ${nummer} niet gewassen?`,
      tekst:
        "De beurt blijft op de dag staan, maar telt niet meer mee: het bedrag vervalt en hij kleurt rood. Het adres telt weer als niet gewassen, zodat je hem opnieuw kunt inplannen.",
      bevestigLabel: "Niet gewassen",
    });
    if (!ja) return;
    try {
      await geldloopNietGewassen(a.id, vrijgave.datum);
      onVeranderd();
      onSluit();
      toast.success(`Niet gewassen · nr ${nummer}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Het toetsenbord in het venster op de computer. */
  function opToets(e: KeyboardEvent) {
    if (mobiel || venster !== null || e.metaKey || e.ctrlKey || e.altKey) return;
    // Staat de aandacht op een knop, dan doet Enter of de spatie die knop al.
    const doel = e.target as HTMLElement | null;
    if (e.key === "Enter" && doel?.tagName === "BUTTON") return;
    if (e.key === "Enter") {
      e.preventDefault();
      betaalAlles();
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      if (!onVolgende) return;
      e.preventDefault();
      onVolgende();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      if (!onVorige) return;
      e.preventDefault();
      onVorige();
    }
  }

  const Titel = mobiel ? DrawerTitle : DialogTitle;

  const inhoud = a ? (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-5 md:pb-5 md:pt-4">
      {/* Wat je leest */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-baseline justify-between gap-3 pr-6">
          <Titel className="min-w-0 truncate font-display text-[24px] font-semibold tracking-[-0.02em]">
            {a.house_number}
            {a.addition}
            {a.naam && <span className="font-normal"> · {a.naam}</span>}
          </Titel>
          <span className="shrink-0 text-[12.5px] text-muted-foreground">{frequentieZin(a)}</span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {a.straat}
          {a.note && ` · ${a.note}`}
        </p>
        {a.klachten.length > 0 && (
          <div className="mt-3 space-y-1 rounded-[14px] bg-tint-kastanje px-3 py-2 text-[13px] text-tint-kastanje-ink">
            {a.klachten.map((k, i) => (
              <p key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {k}
              </p>
            ))}
          </div>
        )}

        {a.methode === "overmaken" && (
          <p className="mt-3 rounded-[14px] bg-tint-blauw px-3 py-2 text-[13px] text-tint-blauw-ink">
            Deze klant maakt over.
            {open
              ? " Er staat nog iets contant open van eerder."
              : " Hier hoef je niet aan te bellen."}
          </p>
        )}

        {a.vanavond && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-[14px] px-3 py-2 text-[13px] ${
              a.vanavond.soort === "betaald" || a.vanavond.soort === "vooruit"
                ? "bg-tint-salie text-tint-salie-ink"
                : "bg-surface text-foreground"
            }`}
          >
            <span className="min-w-0 flex-1">
              {a.vanavond.soort === "betaald"
                ? `Betaald ${formatPrice(a.vanavond.bedrag)}`
                : a.vanavond.soort === "vooruit"
                  ? `${vooruitLabel(a.vanavond.aantal)} ${formatPrice(a.vanavond.bedrag)}`
                  : a.vanavond.soort === "niet_thuis"
                    ? "Niet thuis"
                    : "Geen geld"}{" "}
              · {a.vanavond.door_naam || "?"} om{" "}
              {new Date(a.vanavond.op).toLocaleTimeString("nl-NL", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {vanMij && kanTikken && (
              <button
                type="button"

                className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline"
                onClick={() => herstel(a.vanavond!.id)}
              >
                Ongedaan maken
              </button>
            )}
          </div>
        )}

        {a.kortingen_vanavond.length > 0 && (
          <div className="mt-3 space-y-1">
            {a.kortingen_vanavond.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-2 rounded-[14px] bg-tint-paars px-3 py-2 text-[13px] text-tint-paars-ink"
              >
                <span className="min-w-0 flex-1">
                  Korting −{formatPrice(k.bedrag)}
                  {k.reden && ` (${k.reden})`} · {k.door_naam || "?"}
                </span>
                {(k.door === employee?.id || isEigenaar) && kanTikken && (
                  <button
                    type="button"

                    className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline"
                    onClick={() => herstel(k.id)}
                  >
                    Ongedaan maken
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* De rekening */}
        <div className="mt-3 rounded-[14px] bg-surface px-3.5 py-2.5">
          {regels.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {a.open < -0.005
                ? `Tegoed: ${formatPrice(-a.open)}. Er staat niets open.`
                : "Er staat niets open."}
            </p>
          ) : (
            <>
              {regels.map((r, i) => (
                <div key={i} className="flex items-baseline gap-3 py-0.5 text-[14px]">
                  <span className="min-w-0 flex-1">
                    {r.label}{" "}
                    <span className="text-[12.5px] text-muted-foreground">{r.wanneer}</span>
                    {r.uitleg && (
                      <span className="block text-[12px] text-muted-foreground">{r.uitleg}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag)}</span>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1.5 text-[15px] font-semibold">
                <span>Totaal</span>
                <span className="tabular-nums">
                  {keerOpen(a.open_wassen) && (
                    <span className="mr-1.5 text-[12.5px] font-medium text-muted-foreground">
                      {keerOpen(a.open_wassen)}
                    </span>
                  )}
                  {formatPrice(a.open)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Vooruit: wat er nog staat. De knop om te boeken staat onderin. */}
        {vooruitOver > 0 && (
          <p className="mt-2 rounded-[14px] bg-tint-groen px-3 py-2 text-[13px] text-tint-groen-ink">
            Nog {beurtenTekst(vooruitOver)} vooruit betaald, t/m ongeveer {vooruitTotVan(a)}.
          </p>
        )}
      </div>

      {/* Wat je aantikt: onderin, bij je duim */}
      {kanTikken ? (
        <div className="shrink-0 pt-3">
          {open && !vooruitGedekt && a.vaste_kortingen.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {a.vaste_kortingen.map((k) => (
                <Chip
                  key={k.id}

                  onClick={() =>
                    void tik(
                      {
                        soort: "korting",
                        bedrag: Math.min(k.bedrag, a.open),
                        vaste_korting: k.id,
                        reden: k.naam,
                      },
                      `${k.naam} −${formatPrice(Math.min(k.bedrag, a.open))}`,
                      false,
                    )
                  }
                >
                  {k.naam} −{formatPrice(k.bedrag)}
                </Chip>
              ))}
            </div>
          )}
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            <DeurKnop
              kleur="amber"
              smal
              icoon={<Discount className="size-[18px]" />}
              disabled={!open}
              onClick={() => setVenster("korting")}
            >
              Korting
            </DeurKnop>
            <DeurKnop
              kleur="groen"
              smal
              icoon={<Coin className="size-[18px]" />}
              disabled={!open}
              onClick={() => setVenster("bedrag")}
            >
              Deel betaald
            </DeurKnop>
            <DeurKnop
              kleur="kastanje"
              smal
              icoon={<AlertTriangle className="size-[18px]" />}
              onClick={() => setVenster("klacht")}
            >
              Klacht
            </DeurKnop>
            <DeurKnop
              kleur="amber"
              smal
              icoon={
                dossierLaden ? (
                  <Loader2 className="size-[18px] animate-spin" />
                ) : (
                  <Folder className="size-[18px]" />
                )
              }
              disabled={dossierLaden}
              onClick={() => void openDossier()}
            >
              Dossier
            </DeurKnop>
          </div>
          {open && (
            <div className="mb-2 grid grid-cols-3 gap-2">
              <DeurKnop
                kleur="rood"
                icoon={<DoorOff className="size-[18px]" />}
                onClick={() => void tik({ soort: "niet_thuis" }, "Niet thuis", true)}
              >
                Niet thuis
              </DeurKnop>
              <DeurKnop
                kleur="rood"
                icoon={<WalletOff className="size-[18px]" />}
                onClick={() => void tik({ soort: "geen_geld" }, "Geen geld", true)}
              >
                Geen geld
              </DeurKnop>
              <DeurKnop
                kleur="grafiet"
                icoon={<Kruis className="size-[18px]" />}
                onClick={() => void meldNietGewassen()}
              >
                Niet gewassen
              </DeurKnop>
            </div>
          )}
          {/* Vooruit opent eerst een venster om het aantal beurten te kiezen:
              een verkeerde tik boekt dus nog niets. Ook als er niets open
              staat: dan zijn het allemaal komende beurten. */}
          {a.methode === "contant" && !a.gestopt && (
            <div className={open ? "mb-2" : ""}>
              <DeurKnop
                kleur="paars"
                icoon={<CalendarDollar className="size-[18px]" />}
                disabled={!vooruitKan}
                onClick={() => setVenster("vooruit")}
              >
                Vooruit betalen
              </DeurKnop>
              {!vooruitKan && (
                <p className="pt-1 text-center text-[12px] text-muted-foreground">
                  {a.vooruit_vast > 0
                    ? "Eerst de beurten van de vorige bewoner teruggeven (kantoor)"
                    : "Geen prijs bekend"}
                </p>
              )}
            </div>
          )}
          {open && (
            <>
              <DeurKnop
                kleur="salie"
                icoon={<Check className="size-[22px]" />}

                onClick={betaalAlles}
              >
                Betaald {formatPrice(a.open)}
              </DeurKnop>
              {!mobiel && (
                <p className="pt-2 text-center text-[12px] text-muted-foreground">
                  Esc sluit · Enter is Betaald · pijltjes naar het volgende adres
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="shrink-0 pt-3 text-center text-[13px] text-muted-foreground">
          De avond is voorbij; je kunt hier niets meer intikken.
        </p>
      )}
    </div>
  ) : null;

  return (
    <>
      {mobiel ? (
        <Drawer open={!!adres} onOpenChange={(o) => !o && onSluit()}>
          <DrawerContent className="max-h-[94dvh] rounded-t-[24px] border-0 bg-card">
            {inhoud}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={!!adres} onOpenChange={(o) => !o && onSluit()}>
          <DialogContent
            onKeyDown={opToets}
            className="flex max-h-[90dvh] w-[min(440px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden border-0 bg-card p-0 sm:rounded-[24px]"
          >
            {inhoud}
          </DialogContent>
        </Dialog>
      )}

      {a && (
        <>
          <KortingDialoog
            open={venster === "korting"}
            adres={a}
            onSluit={() => setVenster(null)}
            onKorting={(bedrag, reden) =>
              tik({ soort: "korting", bedrag, reden }, `Korting −${formatPrice(bedrag)}`, false)
            }
            onVeranderd={onVeranderd}
          />
          <BedragDialoog
            open={venster === "bedrag"}
            adres={a}
            onSluit={() => setVenster(null)}
            onBedrag={(bedrag) =>
              tik({ soort: "betaald", bedrag }, `Betaald ${formatPrice(bedrag)}`, true)
            }
          />
          <VooruitDialoog
            open={venster === "vooruit"}
            subtitel={`Nr ${a.house_number}${a.addition}${a.naam ? ` · ${a.naam}` : ""}`}
            delen={a.delen}
            vanaf={a.vooruit_vanaf}
            maandenVoor={(aantal) => {
              // Zoals vooruitTotVan: wacht er geen beurt meer, dan is die van
              // deze maand al gedaan en tellen nieuwe beurten vanaf volgende maand.
              const hier = maandVanNu();
              const start = a.wacht_op_wasbeurt ? hier : volgendeMaand(hier);
              return vooruitNieuweMaanden(a, aantal, a.delen, a.vooruit_vanaf, vooruitOver, start);
            }}
            prijs={a.vooruit_p ?? 0}
            prijsAanpassen={isEigenaar}
            onSluit={() => setVenster(null)}
            onVooruit={(aantal, prijs) => {
              const bedrag = Math.round(aantal * prijs * 100) / 100;
              return tik(
                { soort: "vooruit", aantal, prijs_per_beurt: prijs, bedrag },
                `${vooruitLabel(aantal)} ${formatPrice(bedrag)}`,
                true,
              );
            }}
          />
          <KlachtDialoog
            open={venster === "klacht"}
            adres={a}
            onSluit={() => setVenster(null)}
            onVeranderd={onVeranderd}
          />
          <GeldloopDossier
            open={venster === "dossier"}
            adres={a}
            onSluit={() => setVenster(null)}
            onVeranderd={onVeranderd}
          />
        </>
      )}
      {volDossier && (
        <KlantgegevensDialog
          open
          onOpenChange={(o) => {
            if (o) return;
            setVolDossier(null);
            ververs();
          }}
          klant={volDossier.klant}
          voorstelCustomer={volDossier.adres}
          districts={volDossier.districts}
          streets={volDossier.streets}
          customers={volDossier.customers}
          klanten={volDossier.klanten}
          quickNotes={volDossier.quickNotes}
          onAddQuickNote={(label) => {
            void addQuickNote(label).then(() =>
              qc.invalidateQueries({ queryKey: ["quick_notes"] }),
            );
          }}
          standaardWijkId={a?.wijk_id ?? null}
          onSaved={() => {
            ververs();
            void qc.invalidateQueries({ queryKey: ["klanten"] });
            void qc.invalidateQueries({ queryKey: ["customers"] });
          }}
        />
      )}
    </>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-10 rounded-full border border-border bg-card px-3.5 text-[13.5px] font-medium shadow-card active:bg-surface disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * De knoppen aan de deur. Dezelfde vorm voor alle kleuren, zodat het één rij
 * knoppen lijkt die alleen in betekenis verschilt. De kleur zegt wat er
 * gebeurt: amber is opzoeken of aanpassen, groen is er komt een deel binnen,
 * kastanje is een klacht, rood is er kwam geen geld, grafiet is de wasbeurt
 * gaat eraf, paars is vooruit betalen, en salie is helemaal betaald. De vier bovenste staan op een rij
 * en zijn daarom half zo breed.
 */
const SMAL = "min-h-14 flex-col gap-1 px-1 text-[11.5px] leading-tight";

const DEURKLEUR = {
  amber: `${SMAL} bg-tint-amber text-tint-amber-ink`,
  // Deel betaald groen: er komt geld binnen, alleen niet alles.
  groen: `${SMAL} bg-tint-groen text-tint-groen-ink`,
  // Een klacht blijft rood, maar niet hetzelfde rood als de pof hieronder:
  // kastanje is de diepe kant van dezelfde familie.
  kastanje: `${SMAL} bg-tint-kastanje text-tint-kastanje-ink`,
  rood: "min-h-14 text-[13.5px] bg-tint-rood text-tint-rood-ink",
  // Grafiet valt buiten het hele geldverhaal, en dat klopt: dit gaat niet over
  // de centen maar over het werk. De wasbeurt gaat eraf en het adres komt
  // terug in de planning.
  grafiet: "min-h-14 text-[13.5px] bg-tint-grafiet text-tint-grafiet-ink",
  // Paars voor vooruit: geld voor beurten die nog moeten komen. Een eigen
  // kleur, los van het groen en salie van nu betalen en het lichtblauw van
  // overmaken.
  paars: "min-h-14 text-[13.5px] bg-tint-paars text-tint-paars-ink",
  // Salie met bijna zwarte tekst. Het lichte groen haalde met witte letters de
  // leesnorm niet; deze kleur staat in elk thema hetzelfde op het scherm.
  salie: "min-h-16 text-[19px] bg-tint-salie text-tint-salie-ink",
} as const;

function DeurKnop({
  children,
  onClick,
  kleur,
  icoon,
  smal,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  kleur: keyof typeof DEURKLEUR;
  icoon?: ReactNode;
  /** Vier op een rij: de tekst mag dan afgekapt worden. */
  smal?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-1.5 rounded-[16px] font-display font-semibold tracking-[-0.01em] transition-transform active:scale-[0.98] disabled:opacity-40 ${DEURKLEUR[kleur]}`}
    >
      {icoon}
      <span className={smal ? "w-full truncate text-center" : ""}>{children}</span>
    </button>
  );
}
