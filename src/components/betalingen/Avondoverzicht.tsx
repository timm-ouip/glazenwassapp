import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

import { TelBedrag } from "@/components/TelBedrag";
import {
  TEGEL_GEWOON,
  TEGEL_KLEUR,
  TEGEL_KLIKBAAR,
  TEGEL_VAK,
  TegelGetal,
  TegelKop,
  TegelOnder,
} from "@/components/Tegel";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  boek,
  draaiGeldloopWijzigingTerug,
  fetchGeldloopWijzigingen,
  nieuweTik,
  wijzigingTekst,
} from "@/lib/geldlopen";
import { fetchDistricts, formatPrice } from "@/lib/klanten";
import { zetKlachtStatus } from "@/lib/klachten";
import { fetchAvond, fetchPof, perLoper, soortLabel, type Gebeurtenis } from "@/lib/overzichten";
import { cn } from "@/lib/utils";
import { toonDatum, vandaag } from "@/lib/wasdag";

function tijd(iso: string): string {
  return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Het overzicht van Betalingen: bovenaan de vakken met de cijfers van een
 * avond, daaronder wat er per geldloper binnenkwam en elke korting, klacht en
 * correctie op een rij. Bij elke regel kan de eigenaar het ongedaan maken; er
 * wordt nooit iets gewist, alleen tegengeboekt.
 *
 * De vakken houden twee dingen uit elkaar: wat er in de wijken van deze avond
 * nog op te halen is (daar loopt iemand, dus dat komt vanzelf binnen), en de
 * pof in alle andere wijken — dat is wat er van vóór vanavond blijft staan.
 */
export function Avondoverzicht({ onPof }: { onPof: () => void }) {
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
  // Wat er nu nog open staat, in alle wijken. De wijken waar deze avond
  // iemand loopt tellen apart: dat is "nog op te halen", de rest is pof.
  // Dit is altijd de stand van nu; bij een oudere dag zegt de tegel dat erbij.
  const pofQuery = useQuery({
    queryKey: ["geld-pof", null],
    queryFn: () => fetchPof(null),
    staleTime: 2 * 60_000,
    refetchInterval: datum === vandaag() ? 30_000 : false,
  });
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const openPosten = (pofQuery.data ?? []).filter((r) => r.open > 0.005);
  // Een ingetrokken vrijgave telt niet mee: daar loopt niemand, dus dat is pof.
  // De avond kent alleen de namen van de wijken, dus die zoeken we hier op.
  const namenVanavond = new Set(
    (a?.vrijgaven ?? []).filter((v) => !v.ingetrokken_op).flatMap((v) => v.wijken),
  );
  const wijkenVanavond = (districts.data ?? []).filter((d) => namenVanavond.has(d.name));
  const idsVanavond = new Set(wijkenVanavond.map((d) => d.id));
  const vanavond = openPosten.filter((r) => idsVanavond.has(r.wijk_id));
  const eerder = openPosten.filter((r) => !idsVanavond.has(r.wijk_id));
  const som = (lijst: typeof openPosten) => lijst.reduce((t, r) => t + r.open, 0);
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
    <div className="space-y-3 pb-4 pt-1">
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

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.groen, TEGEL_GEWOON, "md:h-[150px]")}>
          <TegelKop label="Opgehaald" pijl={false} />
          <TegelGetal klein knippen={false}>
            <TelBedrag key={datum} bedrag={avond.data ? opgehaald : undefined} />
          </TegelGetal>
          <TegelOnder>{geldig.filter((g) => g.soort === "betaald").length} keer betaald</TegelOnder>
        </div>
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.oranje, TEGEL_GEWOON, "md:h-[150px]")}>
          <TegelKop label="Nog op te halen" pijl={false} />
          <TegelGetal klein knippen={false}>
            <TelBedrag
              key={datum}
              bedrag={pofQuery.data && districts.data ? som(vanavond) : undefined}
            />
          </TegelGetal>
          <TegelOnder>
            {idsVanavond.size === 0
              ? "geen wijk vrijgegeven"
              : `${vanavond.length} ${vanavond.length === 1 ? "adres" : "adressen"} · ${wijkenVanavond
                  .map((d) => d.name)
                  .join(", ")}${datum === vandaag() ? "" : " (stand van nu)"}`}
          </TegelOnder>
        </div>
        <button
          type="button"
          onClick={onPof}
          className={cn(
            TEGEL_VAK,
            TEGEL_KLIKBAAR,
            TEGEL_KLEUR.geel,
            TEGEL_GEWOON,
            "text-left md:h-[150px]",
          )}
        >
          <TegelKop label="Pof" />
          <TegelGetal klein>{formatPrice(som(eerder))}</TegelGetal>
          <TegelOnder>
            {pofQuery.isLoading
              ? "\u00a0"
              : `${eerder.length} ${eerder.length === 1 ? "adres" : "adressen"} · ${
                  idsVanavond.size === 0 ? "alle wijken" : "andere wijken"
                }`}
          </TegelOnder>
        </button>
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.paars, TEGEL_GEWOON, "md:h-[150px]")}>
          <TegelKop label="Korting" pijl={false} />
          <TegelGetal klein>{formatPrice(korting)}</TegelGetal>
          <TegelOnder>{geldig.filter((g) => g.soort === "korting").length} keer</TegelOnder>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="rounded-[24px] border border-border bg-card p-4 shadow-card">
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

        <section className="rounded-[24px] border border-border bg-card p-4 shadow-card">
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
