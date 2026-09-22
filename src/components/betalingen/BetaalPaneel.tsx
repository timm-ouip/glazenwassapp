import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { KortingDialoog, BedragDialoog, KlachtDialoog } from "@/components/betalingen/DeurDialogen";
import { GeldloopDossier } from "@/components/betalingen/GeldloopDossier";
import { frequentieKort, rekening } from "@/lib/betalingen";
import { useAuth } from "@/lib/auth";
import {
  heeftIetsOpen,
  nieuweTik,
  nietGewassen,
  type GeldloopAdres,
  type Tik,
  type Vrijgave,
} from "@/lib/geldlopen";
import { zetInWachtrij } from "@/lib/geldloop-wachtrij";
import { formatPrice } from "@/lib/klanten";

type Venster = "korting" | "bedrag" | "klacht" | "dossier" | null;

/**
 * Het paneel dat omhoog schuift als je een adres aantikt. Bovenin wat je
 * leest (wie, wat er open staat en waarvoor), onderin wat je aantikt: de
 * chips, dan Niet thuis en Geen geld, en helemaal onderaan de grote groene
 * Betaald. Zo kun je alles met één duim.
 */
export function BetaalPaneel({
  adres,
  vrijgave,
  voorbij,
  onSluit,
  onVeranderd,
}: {
  adres: GeldloopAdres | null;
  vrijgave: Vrijgave;
  voorbij: boolean;
  onSluit: () => void;
  /** Voor wat niet via de wachtrij gaat (klacht, vaste korting). */
  onVeranderd: () => void;
}) {
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const [bezig, setBezig] = useState(false);
  const [venster, setVenster] = useState<Venster>(null);
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
  const nietDezeMaand = a ? nietGewassen(a, vrijgave.datum) : null;
  const open = a && heeftIetsOpen(a);
  const kanTikken = !!a && (!voorbij || isEigenaar);
  const vanMij = a?.vanavond && (a.vanavond.door === employee?.id || isEigenaar);

  return (
    <>
      <Drawer open={!!adres} onOpenChange={(o) => !o && onSluit()}>
        <DrawerContent className="max-h-[94dvh] rounded-t-[24px] border-0 bg-card">
          {a && (
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              {/* Wat je leest */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex items-baseline justify-between gap-3">
                  <DrawerTitle className="min-w-0 truncate font-display text-[24px] font-semibold tracking-[-0.02em]">
                    {a.house_number}
                    {a.addition}
                    {a.naam && <span className="font-normal"> · {a.naam}</span>}
                  </DrawerTitle>
                  <span className="shrink-0 text-[12.5px] text-muted-foreground">
                    {frequentieKort(a)}
                  </span>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {a.straat}
                  {a.note && ` · ${a.note}`}
                </p>
                {nietDezeMaand && (
                  <p className="mt-2 w-fit rounded-full bg-tint-geel px-2.5 py-0.5 text-[12.5px] text-tint-geel-ink">
                    {nietDezeMaand}: ze rekenen misschien niet op je
                  </p>
                )}

                {a.klachten.length > 0 && (
                  <div className="mt-3 space-y-1 rounded-[14px] bg-tint-rood px-3 py-2 text-[13px] text-tint-rood-ink">
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
                      a.vanavond.soort === "betaald"
                        ? "bg-tint-groen text-tint-groen-ink"
                        : "bg-surface text-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      {a.vanavond.soort === "betaald"
                        ? `Betaald ${formatPrice(a.vanavond.bedrag)}`
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
                        disabled={bezig}
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
                            disabled={bezig}
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
                              <span className="block text-[12px] text-muted-foreground">
                                {r.uitleg}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag)}</span>
                        </div>
                      ))}
                      <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1.5 text-[15px] font-semibold">
                        <span>Totaal</span>
                        <span className="tabular-nums">{formatPrice(a.open)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Wat je aantikt: onderin, bij je duim */}
              {kanTikken ? (
                <div className="shrink-0 pt-3">
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {open &&
                      a.vaste_kortingen.map((k) => (
                        <Chip
                          key={k.id}
                          disabled={bezig}
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
                    {open && (
                      <Chip disabled={bezig} onClick={() => setVenster("korting")}>
                        Korting
                      </Chip>
                    )}
                    <Chip disabled={bezig} onClick={() => setVenster("bedrag")}>
                      Ander bedrag
                    </Chip>
                    <Chip disabled={bezig} onClick={() => setVenster("klacht")}>
                      Klacht
                    </Chip>
                    <Chip disabled={bezig} onClick={() => setVenster("dossier")}>
                      Dossier
                    </Chip>
                  </div>
                  {open && (
                    <>
                      <div className="mb-2 grid grid-cols-2 gap-2">
                        <GroteKnop
                          kleur="rood"
                          disabled={bezig}
                          onClick={() => void tik({ soort: "niet_thuis" }, "Niet thuis", true)}
                        >
                          Niet thuis
                        </GroteKnop>
                        <GroteKnop
                          kleur="rood"
                          disabled={bezig}
                          onClick={() => void tik({ soort: "geen_geld" }, "Geen geld", true)}
                        >
                          Geen geld
                        </GroteKnop>
                      </div>
                      <GroteKnop
                        kleur="groen"
                        disabled={bezig}
                        onClick={() =>
                          void tik(
                            { soort: "betaald", bedrag: a.open },
                            `Betaald ${formatPrice(a.open)}`,
                            true,
                          )
                        }
                      >
                        Betaald {formatPrice(a.open)}
                      </GroteKnop>
                    </>
                  )}
                </div>
              ) : (
                <p className="shrink-0 pt-3 text-center text-[13px] text-muted-foreground">
                  De avond is voorbij; je kunt hier niets meer intikken.
                </p>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

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
    </>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
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

function GroteKnop({
  children,
  onClick,
  kleur,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  kleur: "groen" | "rood";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-[16px] font-display font-semibold tracking-[-0.01em] transition-transform active:scale-[0.98] disabled:opacity-60 ${
        kleur === "groen"
          ? "min-h-16 bg-tint-groen-ink text-[19px] text-white"
          : "min-h-14 bg-tint-rood text-[15px] text-tint-rood-ink"
      }`}
    >
      {children}
    </button>
  );
}
