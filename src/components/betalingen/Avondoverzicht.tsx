import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconCash as Cash,
  IconDiscount as Discount,
  IconHourglass as Hourglass,
} from "@tabler/icons-react";

import { Cijferkaarten } from "@/components/Cijferkaarten";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  boek,
  draaiGeldloopWijzigingTerug,
  fetchGeldloopWijzigingen,
  nieuweTik,
  wijzigingTekst,
} from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";
import { zetKlachtStatus } from "@/lib/klachten";
import { fetchAvond, perLoper, soortLabel, type Gebeurtenis } from "@/lib/overzichten";
import { toonDatum, vandaag } from "@/lib/wasdag";

function tijd(iso: string): string {
  return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Wat er op een avond is opgehaald: in totaal, per geldloper, en elke korting,
 * klacht en correctie op een rij. Bij elke regel kan de eigenaar het ongedaan
 * maken; er wordt nooit iets gewist, alleen tegengeboekt.
 */
export function Avondoverzicht() {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const [datum, setDatum] = useState(vandaag());
  const avond = useQuery({
    queryKey: ["geld-avond", datum],
    queryFn: () => fetchAvond(datum),
    refetchInterval: datum === vandaag() ? 30_000 : false,
  });
  // Wat geldlopers in dossiers veranderden.
  const wijzigingen = useQuery({
    queryKey: ["geld-avond", datum, "wijzigingen"],
    queryFn: () => fetchGeldloopWijzigingen({ datum }),
    refetchInterval: datum === vandaag() ? 30_000 : false,
  });
  const a = avond.data;
  const geldig = (a?.gebeurtenissen ?? []).filter((g) => !g.ongedaan);
  const opgehaald = geldig.filter((g) => g.soort === "betaald").reduce((t, g) => t + g.bedrag, 0);
  const korting = geldig.filter((g) => g.soort === "korting").reduce((t, g) => t + g.bedrag, 0);
  const lopers = perLoper(a?.gebeurtenissen ?? []);
  // Wat de eigenaar moet zien: korting, mogelijk dubbel, laat binnengekomen,
  // en wat teruggedraaid is.
  const opvallend = (a?.gebeurtenissen ?? []).filter(
    (g) => g.soort === "korting" || g.botsing_met || g.ongedaan || g.later_binnen,
  );

  async function draaiWijzigingTerug(id: string) {
    try {
      await draaiGeldloopWijzigingTerug(id);
      toast.success("Teruggedraaid");
      void qc.invalidateQueries({ queryKey: ["geld-avond", datum] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["klanten"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handelAf(id: string) {
    try {
      await zetKlachtStatus(id, "afgehandeld");
      void qc.invalidateQueries({ queryKey: ["geld-avond", datum] });
      void qc.invalidateQueries({ queryKey: ["open-klachten"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function draaiTerug(g: Gebeurtenis) {
    try {
      await boek(
        nieuweTik({ adres: g.customer_id, soort: "ongedaan", herroept: g.id, bron: "kantoor" }),
      );
      toast.success(`Teruggedraaid: ${soortLabel(g.soort).toLowerCase()} bij ${g.adres}`);
      void qc.invalidateQueries({ queryKey: ["geld-avond", datum] });
      void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="date"
          className="w-44 rounded-full"
          max={vandaag()}
          value={datum}
          onChange={(e) => e.target.value && setDatum(e.target.value)}
        />
        <span className="text-[13px] text-muted-foreground">
          {a?.vrijgaven.length
            ? a.vrijgaven
                .map(
                  (v) =>
                    `${v.wijken.join(", ")} (${v.lopers.map((l) => l.naam).join(", ")}, tot ${tijd(v.eind_op)})`,
                )
                .join(" · ")
            : `Geen wijk vrijgegeven op ${toonDatum(datum)}`}
        </span>
      </div>

      <Cijferkaarten
        cijfers={[
          {
            label: "Opgehaald",
            waarde: formatPrice(opgehaald),
            onder: `${geldig.filter((g) => g.soort === "betaald").length} keer betaald`,
            icon: Cash,
            kleur: "groen",
          },
          {
            label: "Nog pof",
            waarde: formatPrice(a?.pof ?? 0),
            onder: `${a?.pof_adressen ?? 0} adressen in deze wijken`,
            icon: Hourglass,
            kleur: "amber",
          },
          {
            label: "Korting",
            waarde: formatPrice(korting),
            onder: `${geldig.filter((g) => g.soort === "korting").length} keer`,
            icon: Discount,
            kleur: "paars",
          },
        ]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
          <h2 className="mb-2 font-display text-[15px] font-semibold">Per geldloper</h2>
          {lopers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nog niets ingetikt.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {lopers.map((l) => (
                <div key={l.door ?? l.naam} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{l.naam}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {l.betaald} betaald · {l.nietThuis} niet thuis · {l.geenGeld} geen geld
                      {l.korting > 0 && ` · ${formatPrice(l.korting)} korting`}
                    </span>
                  </span>
                  <span className="font-display text-[17px] font-semibold tabular-nums">
                    {formatPrice(l.opgehaald)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
          <h2 className="mb-2 font-display text-[15px] font-semibold">Korting en wijzigingen</h2>
          {opvallend.length === 0 &&
          (a?.klachten ?? []).length === 0 &&
          (a?.vaste_kortingen ?? []).length === 0 &&
          (wijzigingen.data ?? []).length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Niets bijzonders.</p>
          ) : (
            <div className="divide-y divide-border/70 text-[13px]">
              {opvallend.map((g) => (
                <div key={g.id} className="flex items-start gap-3 py-2">
                  <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                    {tijd(g.op)}
                  </span>
                  <span className={`min-w-0 flex-1 ${g.ongedaan ? "line-through opacity-60" : ""}`}>
                    <b className="font-medium">{g.door_naam}</b> · {g.adres} ·{" "}
                    {soortLabel(g.soort).toLowerCase()}
                    {g.bedrag > 0 && ` ${g.soort === "korting" ? "−" : ""}${formatPrice(g.bedrag)}`}
                    {g.reden && ` (${g.reden})`}
                    {g.botsing_met && !g.ongedaan && (
                      <span className="ml-1.5 rounded-full bg-tint-amber px-1.5 text-[11px] text-tint-amber-ink">
                        mogelijk dubbel
                      </span>
                    )}
                    {g.later_binnen && (
                      <span
                        className="ml-1.5 rounded-full bg-surface px-1.5 text-[11px] text-muted-foreground"
                        title="Getikt zonder bereik en pas later verstuurd"
                      >
                        later binnengekomen
                      </span>
                    )}
                    {g.ongedaan && (
                      <span className="block text-[12px] no-underline">
                        teruggedraaid door {g.ongedaan.door_naam} om {tijd(g.ongedaan.op)}
                      </span>
                    )}
                  </span>
                  {!g.ongedaan && isEigenaar && (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => void draaiTerug(g)}
                    >
                      Ongedaan
                    </button>
                  )}
                </div>
              ))}
              {(wijzigingen.data ?? []).map((w) => (
                <div key={w.id} className="flex items-start gap-3 py-2">
                  <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                    {tijd(w.op)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${w.teruggedraaid_op ? "line-through opacity-60" : ""}`}
                  >
                    <b className="font-medium">{w.door_naam}</b> · {w.adres} · {wijzigingTekst(w)}
                    {w.teruggedraaid_op && (
                      <span className="block text-[12px]">
                        teruggedraaid door {w.teruggedraaid_naam}
                      </span>
                    )}
                  </span>
                  {!w.teruggedraaid_op && isEigenaar && (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => void draaiWijzigingTerug(w.id)}
                    >
                      Ongedaan
                    </button>
                  )}
                </div>
              ))}
              {(a?.vaste_kortingen ?? []).map((k) => (
                <div key={k.id} className="flex items-start gap-3 py-2">
                  <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                    {tijd(k.op)}
                  </span>
                  <span className={`min-w-0 flex-1 ${k.weg ? "line-through opacity-60" : ""}`}>
                    <b className="font-medium">{k.door_naam}</b> · {k.adres} · vaste korting{" "}
                    {k.naam} −{formatPrice(k.bedrag)}
                  </span>
                </div>
              ))}
              {(a?.klachten ?? []).map((k) => (
                <div key={k.id} className="flex items-start gap-3 py-2">
                  <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                    {tijd(k.op)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <AlertTriangle className="mr-1 inline size-3.5 text-tint-rood-ink" />
                    <b className="font-medium">{k.door_naam ?? "?"}</b> · {k.adres ?? "?"} ·{" "}
                    <span className={k.status === "open" ? "text-tint-rood-ink" : "line-through"}>
                      klacht: {k.omschrijving}
                    </span>
                  </span>
                  {k.status === "open" && isEigenaar && (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => void handelAf(k.id)}
                    >
                      Afgehandeld
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
