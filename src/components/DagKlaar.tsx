import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconCircleCheck as CircleCheck, IconFlagCheck as FlagCheck } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import {
  afgemeldTekst,
  dagAfmelden,
  dagAfmeldenTerugdraaien,
  dagHeropenen,
  fetchAfmeldstatus,
  isAfgemeld,
  type Afmeldstatus,
} from "@/lib/dagklaar";
import { formatNumber, sortCustomers, type Customer, type Street } from "@/lib/klanten";
import { zetOverslaan } from "@/lib/overslaan-keuze";
import type { Ploeg } from "@/lib/dagplanning";
import { ploegNaam } from "@/lib/ploegen";
import { pushUndo, undoKnop } from "@/lib/undo";
import { toonDatum, vandaag, type WasdagRegel } from "@/lib/wasdag";

type Keuze = "terug" | "overslaan";

/** Hoe het team heet op het scherm: "Kees & Sanne", "Team 2", of "de dag". */
function groepNaam(ploeg: number | null, ploegen: Ploeg[]): string {
  if (ploeg === null) return ploegen.length > 0 ? "Zonder team" : "De dag";
  const p = ploegen.find((x) => x.nr === ploeg);
  return p ? ploegNaam(p) : `Team ${ploeg}`;
}

/**
 * "Dag klaar" boven de dagroute: per team de knop om af te melden, of wie
 * het al afmeldde. Pas een afgemelde wasbeurt staat open bij de klant, dus
 * dit is ook wat de geldloper straks mag ophalen.
 */
export function DagKlaar({
  datum,
  groepen,
  regels,
  adressen,
  straten,
  ploegen,
}: {
  datum: string;
  /** Welke teams je hier ziet (null = zonder team). */
  groepen: (number | null)[];
  /** Alle regels van de dag. */
  regels: WasdagRegel[];
  adressen: Map<string, Customer>;
  straten: Map<string, Street>;
  ploegen: Ploeg[];
}) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const magPlannen = useRecht("planning");
  const status = useQuery({
    // Onder "wasdagen": elke wijziging in de planning ververst deze mee.
    queryKey: ["wasdagen", "afmeldstatus", datum, datum],
    queryFn: () => fetchAfmeldstatus(datum, datum),
    enabled: datum <= vandaag() && magPlannen,
  });
  const [open, setOpen] = useState<number | null | undefined>(undefined);

  if (datum > vandaag() || !magPlannen || !status.data) return null;

  const zichtbaar = groepen
    .map((g) => status.data.find((s) => s.ploeg_nr === g))
    .filter((s): s is Afmeldstatus => !!s && s.regels > 0);
  if (zichtbaar.length === 0) return null;

  const vernieuw = () => {
    void qc.invalidateQueries({ queryKey: ["wasdag", datum] });
    void qc.invalidateQueries({ queryKey: ["wasdagen"] });
  };

  async function heropen(s: Afmeldstatus) {
    try {
      await dagHeropenen(datum, s.ploeg_nr);
      vernieuw();
      toast.success("Weer opengezet: je kunt deze dag opnieuw afmelden.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const meer = zichtbaar.length > 1;

  return (
    <div className="space-y-2">
      {zichtbaar.map((s) => {
        const naam = groepNaam(s.ploeg_nr, ploegen);
        if (isAfgemeld(s)) {
          const magOpen = s.afmelding?.mag_open ?? isEigenaar;
          return (
            <div
              key={String(s.ploeg_nr)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-tint-groen px-3.5 py-2.5 text-[13px] text-tint-groen-ink"
            >
              <CircleCheck className="size-[18px] shrink-0" />
              <span className="min-w-0 flex-1">
                {meer && <span className="font-semibold">{naam}: </span>}
                {s.afmelding ? afgemeldTekst(s.afmelding) : "Gedaan"}
              </span>
              {magOpen && (
                <button
                  type="button"
                  className="text-[12.5px] font-medium underline-offset-2 hover:underline"
                  onClick={() => void heropen(s)}
                >
                  Weer openzetten
                </button>
              )}
            </div>
          );
        }
        return (
          <div
            key={String(s.ploeg_nr)}
            className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-2.5 shadow-card"
          >
            <FlagCheck className="size-[18px] shrink-0 text-tint-groen-ink" />
            <span className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">
                {meer ? `${naam}: klaar met de dag?` : "Klaar met de dag?"}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                Vink af wat niet gelukt is. De rest staat daarna open bij de klant.
              </span>
            </span>
            <Button className="h-11 shrink-0 rounded-full px-5" onClick={() => setOpen(s.ploeg_nr)}>
              Dag klaar
            </Button>
          </div>
        );
      })}

      {open !== undefined && (
        <DagKlaarDialog
          datum={datum}
          ploeg={open}
          naam={groepNaam(open, ploegen)}
          adressen={regels
            .filter((r) => (r.ploeg_nr ?? null) === open && r.customer_id)
            .map((r) => adressen.get(r.customer_id!))
            .filter((c): c is Customer => !!c)}
          straten={straten}
          volgorde={
            new Map(
              regels
                .filter((r) => r.customer_id && r.volgorde !== null && r.volgorde !== undefined)
                .map((r) => [r.customer_id!, r.volgorde!]),
            )
          }
          onSluit={() => setOpen(undefined)}
          onKlaar={vernieuw}
        />
      )}
    </div>
  );
}

function DagKlaarDialog({
  datum,
  ploeg,
  naam,
  adressen,
  straten,
  volgorde,
  onSluit,
  onKlaar,
}: {
  datum: string;
  ploeg: number | null;
  naam: string;
  adressen: Customer[];
  straten: Map<string, Street>;
  /** Waar een adres in de rij van de dag staat, om de straten net zo te
   *  ordenen als op de dagpagina. */
  volgorde: Map<string, number>;
  onSluit: () => void;
  onKlaar: () => void;
}) {
  const qc = useQueryClient();
  /** Wat niet gedaan is, en waar het heen gaat. Leeg = alles gedaan. */
  const [nietGedaan, setNietGedaan] = useState<Map<string, Keuze>>(new Map());
  const [bezig, setBezig] = useState(false);
  useEffect(() => setNietGedaan(new Map()), [datum, ploeg]);

  const perStraat = useMemo(() => {
    const groepen = new Map<string, Customer[]>();
    for (const c of adressen) groepen.set(c.street_id, [...(groepen.get(c.street_id) ?? []), c]);
    // Net als op de dagpagina: in de volgorde van de dag, en wat nog geen
    // plek heeft achteraan op alfabet.
    const plek = (lijst: Customer[]) =>
      Math.min(...lijst.map((c) => volgorde.get(c.id) ?? Number.POSITIVE_INFINITY));
    return [...groepen.entries()]
      .map(([id, lijst]) => ({ straat: straten.get(id), lijst: sortCustomers(lijst) }))
      .sort(
        (a, b) =>
          plek(a.lijst) - plek(b.lijst) ||
          (a.straat?.name ?? "").localeCompare(b.straat?.name ?? ""),
      );
  }, [adressen, straten, volgorde]);

  const maand = datum.slice(0, 7);
  const aantalTerug = [...nietGedaan.values()].filter((k) => k === "terug").length;
  const aantalOver = [...nietGedaan.values()].filter((k) => k === "overslaan").length;
  const gedaan = adressen.length - nietGedaan.size;

  function wissel(c: Customer, aan: boolean) {
    setNietGedaan((was) => {
      const nu = new Map(was);
      if (aan) nu.delete(c.id);
      else nu.set(c.id, "terug");
      return nu;
    });
  }

  async function bevestig() {
    setBezig(true);
    try {
      // Eerst de maand overslaan, met dezelfde code als in de planning (de
      // startmaand schuift mee). Mislukt dat, dan meldt die het zelf.
      const overslaan = adressen.filter((c) => nietGedaan.get(c.id) === "overslaan");
      const overslaanTerug =
        overslaan.length > 0
          ? await zetOverslaan(
              overslaan.map((c) => ({ c, maanden: [maand] })),
              qc,
            )
          : null;
      if (overslaan.length > 0 && !overslaanTerug) return;

      let uitkomst: Awaited<ReturnType<typeof dagAfmelden>>;
      try {
        uitkomst = await dagAfmelden(datum, ploeg, [...nietGedaan.keys()]);
      } catch (e) {
        // Het overslaan hoorde bij deze stap: dan ook terug.
        if (overslaanTerug) await overslaanTerug().catch(() => undefined);
        throw e;
      }
      pushUndo({
        label: `Dag klaar ${toonDatum(datum)}`,
        undo: async () => {
          await dagAfmeldenTerugdraaien(uitkomst.id);
          if (overslaanTerug) await overslaanTerug();
          onKlaar();
          void qc.invalidateQueries({ queryKey: ["customers"] });
        },
      });
      onKlaar();
      onSluit();
      const delen = [
        `${uitkomst.gedaan} gedaan`,
        ...(aantalTerug > 0 ? [`${aantalTerug} terug naar de planning`] : []),
        ...(aantalOver > 0 ? [`${aantalOver} slaan ${maandNaam(maand).toLowerCase()} over`] : []),
      ];
      toast.success(`Dag afgemeld: ${delen.join(", ")}`, { duration: 10000, action: undoKnop() });
    } catch (e) {
      toast.error("Afmelden mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-lg">
        <PopupKop
          kleur="groen"
          icoon={<FlagCheck className="size-[22px]" />}
          titel="Dag klaar"
          subtitel={`${naam} · ${toonDatum(datum)}`}
        />
        <PopupBody className="gap-3">
          <p className="text-[13px] text-muted-foreground">
            Alles staat aangevinkt. Vink uit wat niet gelukt is: dat gaat terug naar de planning, of
            slaat deze maand over.
          </p>
          {perStraat.map(({ straat, lijst }) => (
            <div key={straat?.id ?? "?"}>
              <p className="mb-1 text-[12px] font-medium text-muted-foreground">
                {straat?.name ?? "Onbekende straat"}
              </p>
              <div className="divide-y divide-border/70 rounded-[14px] border border-border">
                {lijst.map((c) => {
                  const keuze = nietGedaan.get(c.id);
                  const aan = keuze === undefined;
                  return (
                    <div key={c.id} className="px-3 py-2">
                      <label className="flex min-h-9 cursor-pointer items-center gap-3">
                        <Checkbox
                          className="size-5"
                          checked={aan}
                          onCheckedChange={(v) => wissel(c, v === true)}
                        />
                        <span
                          className={`font-display text-[15px] font-semibold tabular-nums ${
                            aan ? "" : "text-muted-foreground line-through"
                          }`}
                        >
                          {formatNumber(c)}
                        </span>
                      </label>
                      {!aan && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-8">
                          {(
                            [
                              ["terug", "Terug naar de planning"],
                              ["overslaan", `${maandNaam(maand)} overslaan`],
                            ] as const
                          ).map(([waarde, label]) => (
                            <button
                              key={waarde}
                              type="button"
                              onClick={() => setNietGedaan((was) => new Map(was).set(c.id, waarde))}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                keuze === waarde
                                  ? "border-transparent bg-tint-amber text-tint-amber-ink"
                                  : "border-border bg-card text-muted-foreground hover:bg-accent"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </PopupBody>
        <PopupVoet>
          <span className="mr-auto text-[12.5px] text-muted-foreground">
            {gedaan} gedaan
            {nietGedaan.size > 0 && ` · ${nietGedaan.size} niet`}
          </span>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void bevestig()}>
            {bezig ? "Bezig…" : "Dag klaar"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

function maandNaam(sleutel: string): string {
  const [jaar, maand] = sleutel.split("-").map(Number);
  if (!jaar || !maand) return sleutel;
  const naam = new Date(jaar, maand - 1, 1).toLocaleDateString("nl-NL", { month: "long" });
  return naam.charAt(0).toUpperCase() + naam.slice(1);
}
