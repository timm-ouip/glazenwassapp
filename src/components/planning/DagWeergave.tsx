import { useMemo, useState } from "react";
import {
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconClock as Clock,
  IconCoffee as Coffee,
  IconDots as MoreHorizontal,
  IconTruck as Truck,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VerplaatsNaarKnop } from "@/components/VerplaatsNaarKnop";
import { MailStatus } from "@/components/planning/MailStatus";
import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  NIET_INGEDEELD,
  opzetVan,
  tijdVan,
  tijdvakVan,
  volPercentage,
  type Blok,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type Tijdlijn,
} from "@/lib/dagplanning";
import type { Bouwstenen } from "@/lib/dagbouwstenen";
import { statusVan, type AankondigingRij } from "@/lib/aankondigingen";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice } from "@/lib/klanten";

export interface DagWeergaveProps {
  datum: string;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  regels: DagRegel[];
  klussen: DagKlus[];
  ploegen: Ploeg[];
  /** Per adres wat er aan de klant verstuurd is. */
  aankondigingen: Map<string, AankondigingRij[]>;
  /** Heeft de klant van dit adres een mailadres of 06? */
  heeftContact: (customerId: string) => boolean;
  magPlannen: boolean;
  prijzenZien: boolean;
  /** Blokken opnieuw ordenen; de lijst is de nieuwe volgorde per ploeg. */
  onVolgorde: (
    blokken: { ploeg_nr: number | null; vasteStart: string | null; blok: Blok }[],
  ) => void;
  onPloegen: () => void;
  onWerktijd: (ploegNr: number, begin: string, eind: string) => void;
  onEigenBlok: (customerId: string, waarde: boolean | null) => void;
  onSamenvoegen: (blok: Blok) => void;
  onVerplaats: (customerIds: string[], naar: string) => void;
  onNaarPloeg: (customerIds: string[], ploegNr: number | null) => void;
  onWijziging: (customerIds: string[]) => void;
}

/**
 * De dag in blokken: per ploeg wat er te doen is, in welke volgorde, en —
 * als de tijdlijn aanstaat — hoe laat.
 *
 * Een straat is één blok, een groot pand staat apart, en een extra opdracht
 * ook. Klap een blok open om losse adressen aan te vinken en te verplaatsen,
 * bijvoorbeeld als een straat niet af kwam.
 */
export function DagWeergave(p: DagWeergaveProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());

  const perPloeg = useMemo(
    () =>
      maakBlokken({
        regels: p.regels,
        klussen: p.klussen,
        adressen: p.bouwstenen.adressen,
        straten: p.bouwstenen.straten,
        wijken: p.bouwstenen.wijken,
      }),
    [p.regels, p.klussen, p.bouwstenen],
  );

  /** Welke kolommen er staan: de ploegen van die dag, plus wat nog niet is ingedeeld. */
  const kolommen: { ploeg: Ploeg | null; blokken: Blok[] }[] = useMemo(() => {
    const uit: { ploeg: Ploeg | null; blokken: Blok[] }[] = p.ploegen.map((pl) => ({
      ploeg: pl,
      blokken: perPloeg.get(pl.nr) ?? [],
    }));
    // Werk kan een ploegnummer dragen dat op deze dag niet bestaat: het is
    // bijvoorbeeld opgeschoven van een dag waar wél twee ploegen waren. Dat
    // hoort zichtbaar te zijn, anders lijkt de dag leeg.
    const bekend = new Set(p.ploegen.map((pl) => pl.nr));
    const los = [...perPloeg.entries()]
      .filter(([nr]) => !bekend.has(nr))
      .flatMap(([, blokken]) => blokken);
    // Zonder ploegen is er één kolom; die heet dan niet "nog niet ingedeeld".
    if (los.length > 0 || uit.length === 0) uit.unshift({ ploeg: null, blokken: los });
    return uit;
  }, [p.ploegen, perPloeg]);

  const tijdlijnen = useMemo(() => {
    const kaart = new Map<number, Tijdlijn>();
    for (const k of kolommen) {
      kaart.set(
        k.ploeg?.nr ?? NIET_INGEDEELD,
        berekenTijden(k.blokken, opzetVan(p.instellingen, k.ploeg)),
      );
    }
    return kaart;
  }, [kolommen, p.instellingen]);

  function wissel(sleutel: string) {
    setOpen((was) => {
      const nieuw = new Set(was);
      if (nieuw.has(sleutel)) nieuw.delete(sleutel);
      else nieuw.add(sleutel);
      return nieuw;
    });
  }

  function kies(id: string, aan: boolean) {
    setGekozen((was) => {
      const nieuw = new Set(was);
      if (aan) nieuw.add(id);
      else nieuw.delete(id);
      return nieuw;
    });
  }

  /** Alle blokken op volgorde, om er eentje mee te verschuiven. */
  function verschuif(ploegNr: number, blok: Blok, richting: -1 | 1) {
    const lijst = [...(perPloeg.get(ploegNr) ?? [])];
    const i = lijst.findIndex((b) => b.sleutel === blok.sleutel);
    const j = i + richting;
    if (i < 0 || j < 0 || j >= lijst.length) return;
    const verwisseld = [...lijst];
    verwisseld[i] = lijst[j]!;
    verwisseld[j] = lijst[i]!;
    p.onVolgorde(
      verwisseld.map((b) => ({
        ploeg_nr: ploegNr === NIET_INGEDEELD ? null : ploegNr,
        vasteStart: b.vasteStart,
        blok: b,
      })),
    );
  }

  /** Een blok op een vaste tijd zetten (of weer loslaten). */
  function zetVast(ploegNr: number, blok: Blok, tijd: string | null) {
    const lijst = perPloeg.get(ploegNr) ?? [];
    p.onVolgorde(
      lijst.map((b) => ({
        ploeg_nr: ploegNr === NIET_INGEDEELD ? null : ploegNr,
        vasteStart: b.sleutel === blok.sleutel ? tijd : b.vasteStart,
        blok: b,
      })),
    );
  }

  const gekozenLijst = [...gekozen];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.magPlannen && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={p.onPloegen}>
            Ploegen indelen…
          </Button>
        )}
        {gekozenLijst.length > 0 && p.magPlannen && (
          <>
            <VerplaatsNaarKnop
              aantal={gekozenLijst.length}
              huidigeDag={p.datum}
              onKies={(naar) => {
                p.onVerplaats(gekozenLijst, naar);
                setGekozen(new Set());
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setGekozen(new Set())}
            >
              Selectie wissen ({gekozenLijst.length})
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {kolommen.map(({ ploeg, blokken }) => {
          const nr = ploeg?.nr ?? NIET_INGEDEELD;
          const tijdlijn = tijdlijnen.get(nr)!;
          const opzet = opzetVan(p.instellingen, ploeg);
          const vol = volPercentage(tijdlijn);
          return (
            <section
              key={nr}
              className="rounded-[18px] border border-border bg-card p-3 shadow-card"
            >
              <header className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[14px] font-semibold">
                  {ploeg
                    ? ploegNaam(ploeg)
                    : p.ploegen.length > 0
                      ? "Nog niet ingedeeld"
                      : "Deze dag"}
                </h3>
                {ploeg && ploeg.leden.length > 1 && (
                  <span className="text-[12px] text-muted-foreground">
                    {ploeg.leden.length} man
                  </span>
                )}
                {p.instellingen.tijdlijn && ploeg && p.magPlannen && (
                  <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
                    <Input
                      type="time"
                      value={opzet.begin}
                      aria-label="Begintijd"
                      className="h-7 w-[5.5rem] px-2 text-[12px]"
                      onChange={(e) => p.onWerktijd(ploeg.nr, e.target.value, opzet.eind)}
                    />
                    –
                    <Input
                      type="time"
                      value={opzet.eind}
                      aria-label="Eindtijd"
                      className="h-7 w-[5.5rem] px-2 text-[12px]"
                      onChange={(e) => p.onWerktijd(ploeg.nr, opzet.begin, e.target.value)}
                    />
                  </span>
                )}
              </header>

              <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${tijdlijn.teVol ? "bg-destructive" : "bg-tint-blauw-ink/70"}`}
                    style={{ width: `${Math.min(100, vol)}%` }}
                  />
                </div>
                <span className={`tabular-nums ${tijdlijn.teVol ? "text-destructive" : ""}`}>
                  {duurTekst(tijdlijn.werkMin)} / {duurTekst(tijdlijn.capaciteitMin)}
                </span>
                {p.instellingen.tijdlijn && (
                  <span className="tabular-nums">klaar {tijdVan(tijdlijn.klaarOm)}</span>
                )}
              </div>

              {tijdlijn.items.length === 0 && (
                <p className="py-3 text-center text-[13px] text-muted-foreground">
                  Nog niets op deze dag.
                </p>
              )}

              <ol className="space-y-1">
                {tijdlijn.items.map((item, i) => {
                  if (item.soort === "pauze" || item.soort === "rijtijd") {
                    return (
                      <li
                        key={item.sleutel}
                        className="flex items-center gap-2 px-1 py-0.5 text-[12px] text-muted-foreground"
                      >
                        {p.instellingen.tijdlijn && (
                          <span className="w-11 shrink-0 tabular-nums">{tijdVan(item.start)}</span>
                        )}
                        {item.soort === "pauze" ? (
                          <Coffee className="size-3.5" />
                        ) : (
                          <Truck className="size-3.5" />
                        )}
                        <span className="truncate">{item.titel}</span>
                        <span className="ml-auto tabular-nums">{duurTekst(item.minuten)}</span>
                      </li>
                    );
                  }
                  const blok = item.blok!;
                  const uitgeklapt = open.has(blok.sleutel);
                  const tijdvak = p.instellingen.tijdlijn
                    ? tijdvakVan(item.start, opzet.begin)
                    : null;
                  return (
                    <li key={blok.sleutel} className="rounded-[12px] border border-border/70">
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        {p.instellingen.tijdlijn && (
                          <span className="w-11 shrink-0 text-[12px] tabular-nums text-muted-foreground">
                            {tijdVan(item.start)}
                          </span>
                        )}
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                          onClick={() => wissel(blok.sleutel)}
                        >
                          {uitgeklapt ? (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-[13px] font-medium">{blok.titel}</span>
                          {blok.soort === "straat" && (
                            <span className="shrink-0 text-[12px] text-muted-foreground">
                              ({blok.adressen.length})
                            </span>
                          )}
                          {blok.vasteStart && (
                            <Clock
                              className="size-3 shrink-0 text-tint-amber-ink"
                              aria-label="Vastgezet"
                            />
                          )}
                        </button>
                        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                          {duurTekst(item.minuten)}
                        </span>
                        {p.prijzenZien && (
                          <span className="shrink-0 text-[12px] tabular-nums">
                            {formatPrice(blok.bedrag)}
                          </span>
                        )}
                        {p.magPlannen && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Menu voor ${blok.titel}`}
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                              >
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem
                                disabled={i === 0}
                                onSelect={() => verschuif(nr, blok, -1)}
                              >
                                Eerder op de dag
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => verschuif(nr, blok, 1)}>
                                Later op de dag
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {p.instellingen.tijdlijn && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    zetVast(nr, blok, blok.vasteStart ? null : tijdVan(item.start))
                                  }
                                >
                                  {blok.vasteStart
                                    ? "Tijd loslaten"
                                    : `Vastzetten op ${tijdVan(item.start)}`}
                                </DropdownMenuItem>
                              )}
                              {blok.soort !== "klus" && blok.adressen.length === 1 && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    p.onEigenBlok(blok.adressen[0]!, blok.soort !== "pand")
                                  }
                                >
                                  {blok.soort === "pand"
                                    ? "Terug bij de straat"
                                    : "Als eigen blok zetten"}
                                </DropdownMenuItem>
                              )}
                              {blok.rest && (
                                <DropdownMenuItem onSelect={() => p.onSamenvoegen(blok)}>
                                  Samenvoegen met de straat
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {p.ploegen.map((pl) => (
                                <DropdownMenuItem
                                  key={pl.nr}
                                  disabled={pl.nr === nr}
                                  onSelect={() => p.onNaarPloeg(blok.adressen, pl.nr)}
                                >
                                  Naar {ploegNaam(pl)}
                                </DropdownMenuItem>
                              ))}
                              {nr !== NIET_INGEDEELD && (
                                <DropdownMenuItem
                                  onSelect={() => p.onNaarPloeg(blok.adressen, null)}
                                >
                                  Uit de ploeg halen
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {uitgeklapt && (
                        <ul className="border-t border-border/60 px-2 py-1">
                          {blok.adressen.map((id) => {
                            const adres = p.bouwstenen.adressen.get(id);
                            const status = statusVan(p.aankondigingen.get(id), p.datum, {
                              heeftContact: p.heeftContact(id),
                              tijdvak,
                            });
                            return (
                              <li key={id} className="flex items-center gap-2 py-0.5 text-[13px]">
                                {p.magPlannen && (
                                  <input
                                    type="checkbox"
                                    aria-label={`${adres?.naam ?? id} aanvinken`}
                                    checked={gekozen.has(id)}
                                    onChange={(e) => kies(id, e.target.checked)}
                                    className="size-3.5 accent-primary"
                                  />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  {adres?.naam ?? "—"}
                                </span>
                                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                  {duurTekst(adres?.duur ?? 0)}
                                </span>
                                <MailStatus status={status} klein />
                              </li>
                            );
                          })}
                          {(() => {
                            // Alleen de adressen waarvan de klant iets anders
                            // te horen kreeg: de rest van de straat hoeft geen
                            // bericht over een wijziging die hen niet raakt.
                            const anders = blok.adressen.filter(
                              (id) =>
                                statusVan(p.aankondigingen.get(id), p.datum, {
                                  heeftContact: p.heeftContact(id),
                                  tijdvak,
                                }).stand === "verplaatst",
                            );
                            if (anders.length === 0) return null;
                            return (
                              <li className="py-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full text-[12px]"
                                  onClick={() => p.onWijziging(anders)}
                                >
                                  Wijziging sturen ({anders.length})
                                </Button>
                              </li>
                            );
                          })()}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
