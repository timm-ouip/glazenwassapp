import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

import { VrijgeefVenster } from "@/components/betalingen/Vrijgeven";

import { TelBedrag, TelGetal } from "@/components/TelBedrag";
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
  draaiStraatWijzigingTerug,
  fetchGeldloopLijst,
  fetchGeldloopWijzigingen,
  fetchStraatWijzigingen,
  nieuweTik,
  straatWijzigingTekst,
  wijzigingTekst,
} from "@/lib/geldlopen";
import { fetchDistricts, fetchStreets, formatPrice } from "@/lib/klanten";
import { zetKlachtStatus } from "@/lib/klachten";
import { fetchAvond, fetchPof, perLoper, soortLabel, type Gebeurtenis } from "@/lib/overzichten";
import { cn } from "@/lib/utils";
import { toonDatum, vandaag } from "@/lib/wasdag";

/** De vorm van de twee brede vakken bovenaan, zoals de vakken op Home. */
const GROOT_VAK =
  "col-span-2 h-[156px] rounded-[28px] px-5 py-4 md:h-[240px] md:px-[26px] md:py-[22px] zak:h-[136px] zak:md:h-[180px] zak:md:px-5 zak:md:py-4";

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
export function Avondoverzicht({
  onPof,
  onLopen,
  onKaarten,
  vrijgeefVenster,
  onVrijgeefVenster,
}: {
  onPof: () => void;
  onLopen: () => void;
  onKaarten: () => void;
  /** Open het vrijgeefvenster, bijvoorbeeld vanuit het loopscherm. */
  vrijgeefVenster?: boolean;
  onVrijgeefVenster?: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const [datum, setDatum] = useState(vandaag());
  const [eigenVenster, setEigenVenster] = useState(false);
  const vrijgeven = vrijgeefVenster ?? eigenVenster;
  const zetVrijgeven = (open: boolean) => {
    setEigenVenster(open);
    onVrijgeefVenster?.(open);
  };
  // Zolang er niets binnen is staat er een streepje: een bedrag van € 0,00
  // dat alleen "nog niet geladen" betekent, leest als "alles is binnen".
  const streep = <span className="opacity-40">—</span>;
  const avond = useQuery({
    queryKey: ["geld-avond", datum],
    queryFn: () => fetchAvond(datum),
    refetchInterval: datum === vandaag() ? 30_000 : false,
  });
  // Wie er straten omgooide vanavond.
  const straatWijzigingen = useQuery({
    queryKey: ["geld-avond", datum, "straten"],
    queryFn: () => fetchStraatWijzigingen(datum),
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
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, staleTime: 5 * 60_000 });
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
  const lopendeVrijgaven = (a?.vrijgaven ?? []).filter((v) => !v.ingetrokken_op);
  // Hoe ver is de avond? Aangebeld is aangebeld: wie niet thuis was of geen
  // geld had telt net zo goed als gelopen — je hoeft er niet nog eens heen.
  // Alleen tikken van een vrijgave van deze avond tellen mee, zodat werk in
  // een andere wijk de balk niet scheeftrekt.
  const avondIds = new Set(lopendeVrijgaven.map((v) => v.id));
  const gelopenIds = new Set(
    geldig
      .filter(
        (g) =>
          g.vrijgave_id !== null &&
          avondIds.has(g.vrijgave_id) &&
          (g.soort === "betaald" || g.soort === "niet_thuis" || g.soort === "geen_geld"),
      )
      .map((g) => g.customer_id),
  );
  const gelopen = gelopenIds.size;
  // Wat er nog open staat in de wijken van vanavond en waar nog niemand
  // geweest is. Wie betaald heeft staat niet meer in de poflijst.
  const nogTeGaan = vanavond.filter((r) => !gelopenIds.has(r.id)).length;
  const samenAdressen = gelopen + nogTeGaan;
  const procentGelopen = samenAdressen > 0 ? Math.round((gelopen / samenAdressen) * 100) : 0;
  const eindTijd = lopendeVrijgaven[0] ? tijd(lopendeVrijgaven[0].eind_op) : "";
  const lopersVanavond = [...new Set(lopendeVrijgaven.flatMap((v) => v.lopers.map((l) => l.naam)))];

  // De avond zoals de geldlopers hem zien. De cijfers komen uit dezelfde
  // lijst als het loopscherm, zodat er op beide schermen hetzelfde staat —
  // dus ook dezelfde regel voor wat "loopt nu" is: begonnen, en van vandaag.
  // Loopt er meer dan één team, dan is het jouw avond die telt.
  const nu = Date.now();
  const begonnenAvonden =
    datum === vandaag() ? lopendeVrijgaven.filter((v) => Date.parse(v.begin_op) <= nu) : [];
  const mijnAvond = begonnenAvonden.find((v) => v.lopers.some((l) => l.id === employee?.id));
  const ikLoopMee = Boolean(mijnAvond);
  const loopId = (mijnAvond ?? begonnenAvonden[0])?.id;
  // De database geeft deze lijst alleen aan de eigenaar en aan wie die avond
  // zelf loopt; een ander zou er een geweigerde vraag per minuut aan
  // overhouden, dus die vragen we niet eens.
  const loop = useQuery({
    queryKey: ["geldloop-lijst", loopId],
    queryFn: () => fetchGeldloopLijst(loopId as string),
    enabled: Boolean(loopId) && (isEigenaar || ikLoopMee),
    refetchInterval: 60_000,
  });
  const o = loop.data?.opgehaald;
  const samenTotaal = (o?.samen_open ?? 0) + (o?.samen_gedaan ?? 0);
  const samenProcent =
    samenTotaal > 0 ? Math.round(((o?.samen_gedaan ?? 0) / samenTotaal) * 100) : 0;
  // Wat de eigenaar moet zien: korting, mogelijk dubbel, laat binnengekomen,
  // en wat teruggedraaid is.
  const opvallend = (a?.gebeurtenissen ?? []).filter(
    (g) => g.soort === "korting" || g.botsing_met || g.ongedaan || g.later_binnen,
  );

  async function draaiStraatTerug(id: string) {
    try {
      await draaiStraatWijzigingTerug(id);
      toast.success("Teruggezet");
      void qc.invalidateQueries({ queryKey: ["geld-avond", datum, "straten"] });
      void qc.invalidateQueries({ queryKey: ["straat-verdeling"] });
      void qc.invalidateQueries({ queryKey: ["geldloop-lijst"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function draaiWijzigingTerug(id: string) {
    try {
      await draaiGeldloopWijzigingTerug(id);
      toast.success("Teruggedraaid");
      void qc.invalidateQueries({ queryKey: ["geld-avond", datum] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["klanten"] });
      // Een teruggezette wasbeurt staat weer in de planning en telt weer mee
      // in wat er open staat.
      void qc.invalidateQueries({ queryKey: ["vergeten"] });
      void qc.invalidateQueries({ queryKey: ["geldloop-lijst"] });
      void qc.invalidateQueries({ queryKey: ["wasdag"] });
      void qc.invalidateQueries({ queryKey: ["wasdagen"] });
      void qc.invalidateQueries({ queryKey: ["geld-pof"] });
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
      void qc.invalidateQueries({ queryKey: ["geldloop-lijst"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3 pb-4">
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

      {(avond.isError || pofQuery.isError || loop.isError) && (
        <p role="status" className="text-[13px] text-tint-rood-ink">
          De cijfers konden niet opgehaald worden. Ververs de pagina om het opnieuw te proberen.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {/* De twee vakken die er het meest toe doen zijn breed, in de vorm
            van Home: het bedrag groot, en eronder hoe ver de avond is. */}
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.groen, GROOT_VAK)}>
          <TegelKop label="Opgehaald" pijl={false} />
          <span className="mt-2.5 whitespace-nowrap font-display text-[44px] font-semibold leading-none tracking-[-0.05em] tabular-nums md:mt-[18px] md:text-[72px] zak:mt-2 zak:text-[30px] zak:tracking-[-0.02em] zak:md:mt-3 zak:md:text-[42px]">
            {avond.data ? <TelBedrag key={datum} bedrag={opgehaald} /> : streep}
          </span>
          <div className="mt-auto flex flex-col gap-[7px] md:gap-2.5">
            <span className="truncate text-[13px] opacity-80 md:text-[14.5px] zak:text-[12px] zak:text-muted-foreground zak:opacity-100 zak:md:text-[12.5px]">
              {geldig.filter((g) => g.soort === "betaald").length} keer betaald
              {samenAdressen > 0 &&
                ` · ${gelopen} van de ${samenAdressen} adressen gelopen (${procentGelopen}%)`}
            </span>
            {samenAdressen > 0 && (
              <span
                role="img"
                aria-label={`${procentGelopen} procent van de adressen gelopen`}
                className="block h-1.5 overflow-hidden rounded-full bg-current/20 md:h-2"
              >
                <span
                  className="block h-full rounded-full bg-current"
                  style={{ width: `${procentGelopen}%` }}
                />
              </span>
            )}
          </div>
        </div>
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.oranje, GROOT_VAK)}>
          <TegelKop label="Nog op te halen" pijl={false} />
          <span className="mt-2.5 whitespace-nowrap font-display text-[44px] font-semibold leading-none tracking-[-0.05em] tabular-nums md:mt-[18px] md:text-[72px] zak:mt-2 zak:text-[30px] zak:tracking-[-0.02em] zak:md:mt-3 zak:md:text-[42px]">
            {pofQuery.data && districts.data ? (
              <TelBedrag key={datum} bedrag={som(vanavond)} />
            ) : (
              streep
            )}
          </span>
          <div className="mt-auto flex flex-col gap-[7px] md:gap-2.5">
            <span className="truncate text-[13px] opacity-80 md:text-[14.5px] zak:text-[12px] zak:text-muted-foreground zak:opacity-100 zak:md:text-[12.5px]">
              {idsVanavond.size === 0
                ? "geen wijk vrijgegeven"
                : `${vanavond.length} ${vanavond.length === 1 ? "adres" : "adressen"} · ${wijkenVanavond
                    .map((d) => d.name)
                    .join(", ")}${datum === vandaag() ? "" : " (stand van nu)"}`}
            </span>
            {nogTeGaan > 0 && (
              <span className="truncate text-[13px] opacity-80 md:text-[14.5px] zak:text-[12px] zak:text-muted-foreground zak:opacity-100 zak:md:text-[12.5px]">
                bij {nogTeGaan} {nogTeGaan === 1 ? "adres is" : "adressen is"} nog niemand geweest
              </span>
            )}
          </div>
        </div>
        {/* De avond in adressen, zoals de geldlopers hem zien. Alleen vandaag,
            en de vakken over jezelf alleen als je zelf loopt. */}
        {ikLoopMee && (
          <div className={cn(TEGEL_VAK, TEGEL_KLEUR.aqua, TEGEL_GEWOON, "md:h-[150px]")}>
            <TegelKop label="Jij nog te doen" pijl={false} />
            <TegelGetal klein>{o ? <TelGetal waarde={o.mijn_open} /> : streep}</TegelGetal>
            <TegelOnder>
              {o
                ? `${o.mijn_open === 1 ? "adres" : "adressen"} in ${o.mijn_straten_open} ${
                    o.mijn_straten_open === 1 ? "straat" : "straten"
                  } · ${o.mijn_gedaan} gelopen`
                : "\u00a0"}
            </TegelOnder>
          </div>
        )}
        {(isEigenaar || ikLoopMee) && (
          <div
            className={cn(
              TEGEL_VAK,
              TEGEL_KLEUR.creme,
              TEGEL_GEWOON,
              "md:h-[150px]",
              // Loopt er niemand naast je, dan vult dit vak de plek van het
              // vak ernaast op, zodat de rij niet half leeg blijft.
              !ikLoopMee && "col-span-2",
            )}
          >
            <TegelKop label="Samen nog te gaan" pijl={false} />
            <TegelGetal klein>{o ? <TelGetal waarde={o.samen_open} /> : streep}</TegelGetal>
            <TegelOnder>
              {o
                ? `${o.samen_open === 1 ? "adres" : "adressen"} in de hele wijk · ${samenProcent}% gelopen`
                : loopId
                  ? "\u00a0"
                  : "er loopt nu niemand"}
            </TegelOnder>
          </div>
        )}
        {/* Het vak waarmee je de straat in gaat: Lopen staat niet meer in
            het menu, je gaat er hiervandaan heen. */}
        {ikLoopMee && (
          <button
            type="button"
            onClick={onLopen}
            className={cn(
              TEGEL_VAK,
              TEGEL_KLIKBAAR,
              TEGEL_KLEUR.petrol,
              TEGEL_GEWOON,
              "col-span-2 text-left md:h-[150px]",
            )}
          >
            <TegelKop label="Jouw avond" />
            <TegelGetal klein knippen={false}>
              {o ? <TelBedrag key={loopId} bedrag={o.mij} /> : streep}
            </TegelGetal>
            <TegelOnder>
              {o
                ? `${o.mij_aantal} keer afgerekend · ${o.mijn_gedaan > 0 ? "verder lopen" : "beginnen"}`
                : "\u00a0"}
            </TegelOnder>
          </button>
        )}
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
          <TegelGetal klein knippen={false}>
            {pofQuery.data && districts.data ? (
              <TelBedrag key={datum} bedrag={som(eerder)} />
            ) : (
              streep
            )}
          </TegelGetal>
          <TegelOnder>
            {pofQuery.isLoading
              ? "\u00a0"
              : `${eerder.length} ${eerder.length === 1 ? "adres" : "adressen"} · ${
                  idsVanavond.size === 0 ? "alle wijken" : "andere wijken"
                }`}
          </TegelOnder>
        </button>
        <VrijgaveTegel
          wijken={wijkenVanavond.map((d) => d.name)}
          tot={eindTijd}
          lopers={lopersVanavond}
          magVrijgeven={isEigenaar}
          onOpen={() => zetVrijgeven(true)}
        />
        <button
          type="button"
          onClick={onKaarten}
          className={cn(
            TEGEL_VAK,
            TEGEL_KLIKBAAR,
            TEGEL_KLEUR.perzik,
            TEGEL_GEWOON,
            "text-left md:h-[150px]",
          )}
        >
          <TegelKop label="Wijkkaarten" />
          <TegelGetal klein>
            {districts.data ? <TelGetal waarde={districts.data.length} /> : "—"}
          </TegelGetal>
          <TegelOnder>
            {/* Alleen de straten die je op de kaart kunt kiezen: straten van een
                weggelegde wijk staan er niet tussen. */}
            {streets.data && districts.data
              ? `${streets.data.filter((s) => districts.data.some((d) => d.id === s.district_id)).length} straten op de kaart`
              : "\u00a0"}
          </TegelOnder>
        </button>
        <div className={cn(TEGEL_VAK, TEGEL_KLEUR.paars, TEGEL_GEWOON, "md:h-[150px]")}>
          <TegelKop label="Korting" pijl={false} />
          <TegelGetal klein knippen={false}>
            {avond.data ? <TelBedrag key={datum} bedrag={korting} /> : streep}
          </TegelGetal>
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
          (straatWijzigingen.data ?? []).length === 0 &&
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
              {(straatWijzigingen.data ?? []).map((w) => (
                <div key={w.id} className="flex items-start gap-3 py-2">
                  <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                    {tijd(w.op)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 ${w.teruggedraaid_op ? "line-through opacity-60" : ""}`}
                  >
                    <b className="font-medium">{w.door_naam}</b> · {straatWijzigingTekst(w)}
                    {w.voor_naam && (
                      <span className="text-muted-foreground"> (was {w.voor_naam})</span>
                    )}
                    {w.teruggedraaid_op && (
                      <span className="block text-[12px] no-underline">
                        teruggezet door {w.teruggedraaid_naam}
                      </span>
                    )}
                  </span>
                  {!w.teruggedraaid_op && isEigenaar && (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => void draaiStraatTerug(w.id)}
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

      <VrijgeefVenster
        open={vrijgeven}
        onSluit={() => zetVrijgeven(false)}
        onLopen={() => {
          zetVrijgeven(false);
          onLopen();
        }}
      />
    </div>
  );
}

/**
 * Wie er vanavond loopt, en waar. De eigenaar opent er het venster mee waarin
 * hij een wijk vrijgeeft; een ander leest alleen wat er open staat.
 */
function VrijgaveTegel({
  wijken,
  tot,
  lopers,
  magVrijgeven,
  onOpen,
}: {
  wijken: string[];
  tot: string;
  lopers: string[];
  magVrijgeven: boolean;
  onOpen: () => void;
}) {
  const inhoud = (
    <>
      <TegelKop label="Vrijgegeven" pijl={magVrijgeven} />
      {/* Namen, geen getal: bij één wijk zegt "1" niets. */}
      <span className="mt-auto truncate text-[17px] font-semibold md:text-[20px]">
        {wijken.length === 0 ? "Niemand" : wijken.join(", ")}
      </span>
      <TegelOnder>
        {wijken.length === 0
          ? magVrijgeven
            ? "niemand loopt · vrijgeven"
            : "niemand loopt vanavond"
          : `${lopers.join(", ") || "niemand"} · tot ${tot}`}
      </TegelOnder>
    </>
  );
  const vorm = cn(TEGEL_VAK, TEGEL_KLEUR.ijsblauw, TEGEL_GEWOON, "md:h-[150px]");
  return magVrijgeven ? (
    <button type="button" onClick={onOpen} className={cn(vorm, TEGEL_KLIKBAAR, "text-left")}>
      {inhoud}
    </button>
  ) : (
    <div className={vorm}>{inhoud}</div>
  );
}
