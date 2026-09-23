import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AppLayout } from "@/components/AppLayout";
import {
  Balken,
  Gestapeld,
  Legenda,
  Lijn,
  Paneel,
  PaneelExtra,
  Staven,
  Verloop,
  type Punt,
} from "@/components/dashboard/Grafieken";
import {
  TEGEL_GEWOON,
  TEGEL_KLEUR,
  TEGEL_KLIKBAAR,
  TEGEL_VAK,
  TegelGetal,
  TegelKop,
  TegelOnder,
} from "@/components/Tegel";
import { TelBedrag, TelGetal } from "@/components/TelBedrag";
import { Button } from "@/components/ui/button";
import { requireSession, useRequireAuth } from "@/lib/auth";
import { effectieveMethode } from "@/lib/betalingen";
import { fetchKlachtenPeriode } from "@/lib/klachten";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchStreets,
  formatPrice,
  type Customer,
} from "@/lib/klanten";
import { fetchKlussen, telDagVan } from "@/lib/klussen";
import { fetchPof } from "@/lib/overzichten";
import { useRecht } from "@/lib/rechten";
import { cn } from "@/lib/utils";
import { datumSleutel, fetchWasdagen, vandaag } from "@/lib/wasdag";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({ meta: [{ title: "Dashboard — Wooshy" }] }),
  component: Dashboard,
});

const MAANDEN = [
  ["januari", "jan"],
  ["februari", "feb"],
  ["maart", "mrt"],
  ["april", "apr"],
  ["mei", "mei"],
  ["juni", "jun"],
  ["juli", "jul"],
  ["augustus", "aug"],
  ["september", "sep"],
  ["oktober", "okt"],
  ["november", "nov"],
  ["december", "dec"],
] as const;

const MINUUT = 60_000;

/** Een dag erbij (of eraf, met een min), als jjjj-mm-dd. */
function dagErbij(datum: string, dagen: number): string {
  const d = new Date(`${datum}T12:00:00`);
  d.setDate(d.getDate() + dagen);
  return datumSleutel(d);
}

/**
 * Het dashboard: hoe het jaar loopt, in cijfers en grafieken.
 *
 * Alles wordt hier uitgerekend uit de wasdagen, de extra opdrachten en de
 * adressen — de database heeft geen kant-en-klare totalen per maand. Daarom
 * blijven de opgehaalde gegevens tien minuten goed staan: je komt hier om te
 * kijken, niet om te werken.
 */
function Dashboard() {
  useRequireAuth();
  const prijzenZien = useRecht("prijzen_zien");
  const magPlannen = useRecht("planning");
  const nu = vandaag();
  const ditJaar = Number(nu.slice(0, 4));
  const [jaar, setJaar] = useState(ditJaar);
  const lopend = jaar === ditJaar;
  const vanaf = `${jaar}-01-01`;
  const tot = lopend ? nu : `${jaar}-12-31`;
  /** Zoveel maanden hebben we van dit jaar gezien. */
  const aantalMaanden = lopend ? Number(nu.slice(5, 7)) : 12;
  const mag = prijzenZien && magPlannen;

  const wasdagenQuery = useQuery({
    queryKey: ["wasdagen", vanaf, tot],
    queryFn: () => fetchWasdagen(vanaf, tot),
    enabled: mag,
    staleTime: 10 * MINUUT,
  });
  const klussenQuery = useQuery({
    queryKey: ["klussen", vanaf, tot],
    queryFn: () => fetchKlussen(vanaf, tot),
    enabled: mag,
    staleTime: 10 * MINUUT,
  });
  // Met inactief: een adres dat later stopte hoort nog wel bij de omzet van de
  // maanden dat het gewassen werd.
  const customersQuery = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
    enabled: mag,
    staleTime: 5 * MINUUT,
  });
  const streetsQuery = useQuery({
    queryKey: ["streets"],
    queryFn: fetchStreets,
    enabled: mag,
    staleTime: 5 * MINUUT,
  });
  const districtsQuery = useQuery({
    queryKey: ["districts"],
    queryFn: fetchDistricts,
    enabled: mag,
    staleTime: 5 * MINUUT,
  });
  const pofQuery = useQuery({
    queryKey: ["geld-pof", null],
    queryFn: () => fetchPof(null),
    enabled: mag,
    staleTime: 2 * MINUUT,
  });
  // Een dag ruimer ophalen en daarna op de Nederlandse datum filteren: de
  // database rekent in UTC, en een klacht van half één 's nachts hoort hier.
  const klachtenQuery = useQuery({
    queryKey: ["klachten", "periode", vanaf, tot],
    queryFn: () => fetchKlachtenPeriode(dagErbij(vanaf, -1), dagErbij(tot, 1)),
    enabled: mag,
    staleTime: 10 * MINUUT,
  });

  /** Van elk adres: in welke wijk het ligt en hoe het betaalt. */
  const adresInfo = useMemo(() => {
    const districts = districtsQuery.data;
    const streets = streetsQuery.data;
    const customers = customersQuery.data;
    if (!districts || !streets || !customers) return null;
    const wijkVan = new Map(districts.map((d) => [d.id, d]));
    const straatVan = new Map(streets.map((s) => [s.id, s]));
    const info = new Map<string, { wijkId: string | null; contant: boolean }>();
    for (const c of customers as Customer[]) {
      const wijk = wijkVan.get(straatVan.get(c.street_id)?.district_id ?? "");
      info.set(c.id, {
        wijkId: wijk?.id ?? null,
        contant: effectieveMethode(c, wijk) === "contant",
      });
    }
    return { info, wijken: districts };
  }, [districtsQuery.data, streetsQuery.data, customersQuery.data]);

  /** Alle bedragen van dit jaar, op één hoop: wasbeurten plus extra opdrachten. */
  const posten = useMemo(() => {
    const regels = wasdagenQuery.data;
    const klussen = klussenQuery.data;
    if (!regels || !klussen) return null;
    const uit: { datum: string; prijs: number; customer_id: string | null; wasbeurt: boolean }[] =
      regels
        .filter((r) => r.datum >= vanaf && r.datum <= tot)
        .map((r) => ({
          datum: r.datum,
          prijs: r.prijs,
          customer_id: r.customer_id,
          wasbeurt: true,
        }));
    for (const k of klussen) {
      const d = telDagVan(k, nu);
      if (!d || d < vanaf || d > tot) continue;
      uit.push({ datum: d, prijs: k.prijs, customer_id: k.customer_id, wasbeurt: false });
    }
    return uit;
  }, [wasdagenQuery.data, klussenQuery.data, vanaf, tot, nu]);

  const cijfers = useMemo(() => {
    if (!posten) return null;
    const maandOmzet = Array.from({ length: aantalMaanden }, () => 0);
    const maandAdressen = Array.from({ length: aantalMaanden }, () => 0);
    const maandContant = Array.from({ length: aantalMaanden }, () => 0);
    const maandOvermaken = Array.from({ length: aantalMaanden }, () => 0);
    const perWijk = new Map<string, number>();
    /** De dagen waarop echt gewerkt is, per maand; een dag telt één keer. */
    const werkdagen = Array.from({ length: aantalMaanden }, () => new Set<string>());
    /** Bedragen van adressen die we niet meer kennen (weggegooid). */
    let onbekend = 0;
    for (const p of posten) {
      const m = Number(p.datum.slice(5, 7)) - 1;
      if (m < 0 || m >= aantalMaanden) continue;
      maandOmzet[m] = (maandOmzet[m] ?? 0) + p.prijs;
      // Alleen wasbeurten tellen als gewassen adres; een extra opdracht is werk
      // bij een adres dat je vaak diezelfde dag al waste.
      if (p.wasbeurt) maandAdressen[m] = (maandAdressen[m] ?? 0) + 1;
      werkdagen[m]?.add(p.datum);
      const info = p.customer_id ? adresInfo?.info.get(p.customer_id) : undefined;
      // Een adres dat intussen weggegooid is, kennen we niet meer: dat telt
      // hier bij geen van beide, anders zou het stilletjes contant worden.
      if (info?.contant === true) maandContant[m] = (maandContant[m] ?? 0) + p.prijs;
      else if (info?.contant === false) maandOvermaken[m] = (maandOvermaken[m] ?? 0) + p.prijs;
      else onbekend += p.prijs;
      if (info?.wijkId) perWijk.set(info.wijkId, (perWijk.get(info.wijkId) ?? 0) + p.prijs);
    }
    const klachtenPerMaand = Array.from({ length: aantalMaanden }, () => 0);
    for (const k of klachtenQuery.data ?? []) {
      // ontvangen_op is een tijdstip; de maand hoort bij de Nederlandse dag.
      const dag = datumSleutel(new Date(k.ontvangen_op));
      if (dag < vanaf || dag > tot) continue;
      const m = Number(dag.slice(5, 7)) - 1;
      if (m >= 0 && m < aantalMaanden) klachtenPerMaand[m] = (klachtenPerMaand[m] ?? 0) + 1;
    }
    // Nieuwe adressen: wat je zelf toevoegde of wat zich aanmeldde. Een import
    // zegt alleen wanneer de import draaide, dus die telt niet mee.
    // Erbij en eraf per maand: wat je zelf toevoegde of wat zich aanmeldde, en
    // wat stopte of verhuisde. Een import zegt alleen wanneer de import draaide,
    // dus die telt niet als aanwas.
    const aanwas = Array.from({ length: aantalMaanden }, () => 0);
    const verloop = Array.from({ length: aantalMaanden }, () => 0);
    for (const c of customersQuery.data ?? []) {
      if (!c.geimporteerd && c.created_at) {
        const d = datumSleutel(new Date(c.created_at));
        const m = Number(d.slice(5, 7)) - 1;
        if (d.slice(0, 4) === String(jaar) && m < aantalMaanden) aanwas[m] = (aanwas[m] ?? 0) + 1;
      }
      if (c.inactief_op) {
        const d = datumSleutel(new Date(c.inactief_op));
        const m = Number(d.slice(5, 7)) - 1;
        if (d.slice(0, 4) === String(jaar) && m < aantalMaanden) verloop[m] = (verloop[m] ?? 0) + 1;
      }
    }
    const nieuweAdressen = aanwas.reduce((s, a) => s + a, 0);
    const totaal = maandOmzet.reduce((s, b) => s + b, 0);
    return {
      maandOmzet,
      maandAdressen,
      maandContant,
      maandOvermaken,
      klachten: klachtenPerMaand,
      klachtenTotaal: klachtenPerMaand.reduce((s, k) => s + k, 0),
      perWijk,
      totaal,
      adressen: maandAdressen.reduce((s, a) => s + a, 0),
      nieuweAdressen,
      gestopt: verloop.reduce((s, v) => s + v, 0),
      aanwas,
      verloop,
      werkdagen: werkdagen.map((d) => d.size),
      onbekend,
    };
  }, [posten, adresInfo, klachtenQuery.data, customersQuery.data, aantalMaanden, jaar, vanaf, tot]);

  const pof = useMemo(() => {
    const open = (pofQuery.data ?? []).filter((r) => r.open > 0.005);
    return pofQuery.data
      ? { bedrag: open.reduce((s, r) => s + r.open, 0), adressen: open.length }
      : null;
  }, [pofQuery.data]);

  // Eén regel als er iets misging of als het nog binnenkomt: een leeg
  // dashboard lijkt anders op een jaar waarin niets gebeurde.
  const vragen = [
    wasdagenQuery,
    klussenQuery,
    customersQuery,
    streetsQuery,
    districtsQuery,
    pofQuery,
    klachtenQuery,
  ];
  const fout = vragen.some((q) => q.isError);
  const laadt = !fout && vragen.some((q) => q.isLoading);

  const leeg = <span className="opacity-40">—</span>;
  const euro = (n: number) => formatPrice(n);
  const punten = (waarden: number[], vorm: (n: number) => string): Punt[] => {
    const hoogste = Math.max(1, ...waarden);
    return waarden.map((w, i) => ({
      kort: MAANDEN[i]?.[1] ?? "",
      tip: `${MAANDEN[i]?.[0] ?? ""}: ${vorm(w)}`,
      deel: w / hoogste,
      accent: i === waarden.length - 1 && lopend,
    }));
  };
  const hoogsteMaand = cijfers ? cijfers.maandOmzet.indexOf(Math.max(...cijfers.maandOmzet)) : -1;
  const omzetTop = cijfers ? Math.max(1, ...cijfers.maandOmzet) : 1;
  // De hoogste maand van contant plus overmaken samen: daar schaalt de
  // gestapelde grafiek op.
  const geldTop = cijfers
    ? Math.max(1, ...cijfers.maandContant.map((c, i) => c + (cijfers.maandOvermaken[i] ?? 0)))
    : 1;

  return (
    <AppLayout
      titel="Dashboard"
      naastTitel={lopend ? `januari tot en met vandaag` : `heel ${jaar}`}
      acties={
        <div className="flex items-center gap-2">
          <Button
            variant={lopend ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setJaar(ditJaar)}
            aria-pressed={lopend}
          >
            {ditJaar}
          </Button>
          <Button
            variant={!lopend ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setJaar(ditJaar - 1)}
            aria-pressed={!lopend}
          >
            {ditJaar - 1}
          </Button>
        </div>
      }
    >
      {!mag ? (
        <p className="mt-6 text-[14px] text-muted-foreground">
          Het dashboard telt de planning en de prijzen bij elkaar op. Daarvoor heb je allebei die
          rechten nodig; vraag de eigenaar om ze aan te zetten.
        </p>
      ) : (
        <div className="flex flex-col gap-3 pb-4 md:gap-4">
          {(fout || laadt) && (
            <p role="status" className="text-[13px] text-muted-foreground">
              {fout
                ? "De cijfers konden niet opgehaald worden. Ververs de pagina om het opnieuw te proberen."
                : "Bezig met optellen…"}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
            <div className={cn(TEGEL_VAK, TEGEL_KLEUR.oranje, TEGEL_GEWOON, "md:h-[150px]")}>
              <TegelKop label={lopend ? "Omzet dit jaar" : `Omzet ${jaar}`} pijl={false} />
              <TegelGetal klein knippen={false}>
                {cijfers ? (
                  // Een ander jaar is een ander getal, geen verandering: met
                  // een eigen key begint de teller opnieuw in plaats van
                  // ernaartoe te lopen.
                  <TelBedrag key={jaar} bedrag={cijfers.totaal} onthoud={`dash-omzet-${jaar}`} />
                ) : (
                  leeg
                )}
              </TegelGetal>
              <TegelOnder>
                {cijfers
                  ? `${(cijfers.totaal / Math.max(1, aantalMaanden) || 0).toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })} per maand`
                  : " "}
              </TegelOnder>
            </div>
            <div className={cn(TEGEL_VAK, TEGEL_KLEUR.creme, TEGEL_GEWOON, "md:h-[150px]")}>
              <TegelKop label="Gewassen adressen" pijl={false} />
              <TegelGetal klein>
                {cijfers ? (
                  <TelGetal
                    key={jaar}
                    waarde={cijfers.adressen}
                    onthoud={`dash-gewassen-${jaar}`}
                  />
                ) : (
                  leeg
                )}
              </TegelGetal>
              <TegelOnder>
                {cijfers
                  ? `${Math.round(cijfers.adressen / Math.max(1, aantalMaanden))} per maand`
                  : " "}
              </TegelOnder>
            </div>
            <Link
              to="/betalingen"
              search={{ tab: "pof" }}
              className={cn(
                TEGEL_VAK,
                TEGEL_KLIKBAAR,
                TEGEL_KLEUR.geel,
                TEGEL_GEWOON,
                "md:h-[150px]",
              )}
            >
              <TegelKop label="Nog open" />
              <TegelGetal klein knippen={false}>
                {pof ? <TelBedrag bedrag={pof.bedrag} onthoud="dash-pof" /> : leeg}
              </TegelGetal>
              <TegelOnder>
                {pof ? `pof bij ${pof.adressen} ${pof.adressen === 1 ? "adres" : "adressen"}` : " "}
              </TegelOnder>
            </Link>
            <div className={cn(TEGEL_VAK, TEGEL_KLEUR.aqua, TEGEL_GEWOON, "md:h-[150px]")}>
              <TegelKop label="Nieuwe adressen" pijl={false} />
              <TegelGetal klein>
                {cijfers ? (
                  <TelGetal
                    key={jaar}
                    waarde={cijfers.nieuweAdressen}
                    onthoud={`dash-nieuw-${jaar}`}
                  />
                ) : (
                  leeg
                )}
              </TegelGetal>
              <TegelOnder>{cijfers ? `erbij, ${cijfers.gestopt} eraf` : "\u00a0"}</TegelOnder>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-12 md:gap-4">
            <Paneel
              titel="Omzet per maand"
              className="md:col-span-7"
              extra={
                cijfers && hoogsteMaand >= 0 ? (
                  <PaneelExtra>
                    hoogste: {MAANDEN[hoogsteMaand]?.[0]},{" "}
                    {euro(cijfers.maandOmzet[hoogsteMaand] ?? 0)}
                  </PaneelExtra>
                ) : undefined
              }
            >
              {cijfers && (
                <Staven
                  punten={punten(cijfers.maandOmzet, euro)}
                  asLabels={[euro(omzetTop), euro(omzetTop / 2), "€ 0"]}
                  beschrijving={`Omzet per maand: ${cijfers.maandOmzet
                    .map((b, i) => `${MAANDEN[i]?.[0]} ${euro(b)}`)
                    .join(", ")}`}
                />
              )}
            </Paneel>

            <Paneel titel="Omzet per wijk" className="md:col-span-5">
              {cijfers && adresInfo && (
                <Balken
                  rijen={[...adresInfo.wijken]
                    .map((w) => ({ naam: w.name, bedrag: cijfers.perWijk.get(w.id) ?? 0 }))
                    .sort((a, b) => b.bedrag - a.bedrag)
                    .slice(0, 6)
                    .map((w, _, alles) => ({
                      naam: w.naam,
                      waarde: euro(w.bedrag),
                      tip: `${w.naam}: ${euro(w.bedrag)}`,
                      deel: w.bedrag / Math.max(1, alles[0]?.bedrag ?? 1),
                    }))}
                  beschrijving={`Omzet per wijk: ${adresInfo.wijken
                    .map((w) => `${w.name} ${euro(cijfers.perWijk.get(w.id) ?? 0)}`)
                    .join(", ")}`}
                />
              )}
            </Paneel>

            <Paneel
              titel="Gewassen adressen per maand"
              className="md:col-span-5"
              extra={
                cijfers ? (
                  <PaneelExtra>{cijfers.adressen.toLocaleString("nl-NL")} totaal</PaneelExtra>
                ) : undefined
              }
            >
              {cijfers && (
                <Lijn
                  punten={punten(cijfers.maandAdressen, (n) => `${n} adressen`)}
                  beschrijving={`Gewassen adressen per maand: ${cijfers.maandAdressen
                    .map((a, i) => `${MAANDEN[i]?.[0]} ${a}`)
                    .join(", ")}`}
                />
              )}
            </Paneel>

            <Paneel
              titel="Contant en overmaken"
              className="md:col-span-4"
              extra={
                <Legenda
                  items={[
                    { naam: "contant", klasse: "bg-serie-contant" },
                    { naam: "overmaken", klasse: "bg-serie-overmaken" },
                  ]}
                />
              }
            >
              {cijfers && (
                <>
                  <Gestapeld
                    punten={cijfers.maandContant.map((c, i) => {
                      const o = cijfers.maandOvermaken[i] ?? 0;
                      return {
                        kort: MAANDEN[i]?.[1] ?? "",
                        tip: `${MAANDEN[i]?.[0]}: contant ${euro(c)}, overmaken ${euro(o)}`,
                        deel: c / geldTop,
                        tweede: o / geldTop,
                        accent: i === cijfers.maandContant.length - 1 && lopend,
                      };
                    })}
                    beschrijving={`Contant en overmaken per maand: ${cijfers.maandContant
                      .map(
                        (c, i) =>
                          `${MAANDEN[i]?.[0]} contant ${euro(c)}, overmaken ${euro(cijfers.maandOvermaken[i] ?? 0)}`,
                      )
                      .join(", ")}`}
                  />
                  <p className="text-[11.5px] opacity-70">
                    Verdeeld zoals het adres nu betaalt; wisselde dat later, dan telt het hier mee
                    als nu.
                  </p>
                </>
              )}
            </Paneel>

            <Paneel
              titel="Klachten"
              className="md:col-span-3"
              extra={
                cijfers ? <PaneelExtra>{cijfers.klachtenTotaal} totaal</PaneelExtra> : undefined
              }
            >
              {cijfers && (
                <Staven
                  punten={punten(
                    cijfers.klachten,
                    (n) => `${n} ${n === 1 ? "klacht" : "klachten"}`,
                  )}
                  hoogte="h-[120px] md:h-[140px]"
                  kleur="bg-tint-rood-mid"
                  beschrijving={`Klachten per maand: ${cijfers.klachten
                    .map((k, i) => `${MAANDEN[i]?.[0]} ${k}`)
                    .join(", ")}`}
                />
              )}
            </Paneel>

            <Paneel
              titel="Omzet per werkdag"
              className="md:col-span-6"
              extra={
                cijfers && cijfers.werkdagen.some((d) => d > 0) ? (
                  <PaneelExtra>
                    {cijfers.werkdagen.reduce((a, d) => a + d, 0)} werkdagen
                  </PaneelExtra>
                ) : undefined
              }
            >
              {cijfers && (
                <Staven
                  punten={cijfers.maandOmzet.map((bedrag, i) => {
                    const dagen = cijfers.werkdagen[i] ?? 0;
                    const perDag = dagen > 0 ? bedrag / dagen : 0;
                    const hoogste = Math.max(
                      1,
                      ...cijfers.maandOmzet.map((b, n) =>
                        (cijfers.werkdagen[n] ?? 0) > 0 ? b / (cijfers.werkdagen[n] ?? 1) : 0,
                      ),
                    );
                    return {
                      kort: MAANDEN[i]?.[1] ?? "",
                      tip:
                        dagen > 0
                          ? `${MAANDEN[i]?.[0]}: ${euro(perDag)} per dag (${dagen} ${dagen === 1 ? "werkdag" : "werkdagen"})`
                          : `${MAANDEN[i]?.[0]}: niet gewerkt`,
                      deel: perDag / hoogste,
                      accent: i === cijfers.maandOmzet.length - 1 && lopend,
                    };
                  })}
                  beschrijving={`Omzet per werkdag: ${cijfers.maandOmzet
                    .map((b, i) => {
                      const dagen = cijfers.werkdagen[i] ?? 0;
                      return `${MAANDEN[i]?.[0]} ${dagen > 0 ? euro(b / dagen) : "niet gewerkt"}`;
                    })
                    .join(", ")}`}
                />
              )}
            </Paneel>

            <Paneel
              titel="Erbij en eraf"
              className="md:col-span-6"
              extra={
                <Legenda
                  items={[
                    { naam: "erbij", klasse: "bg-tint-groen-mid" },
                    { naam: "gestopt of verhuisd", klasse: "bg-tint-rood-mid" },
                  ]}
                />
              }
            >
              {cijfers && (
                <Verloop
                  punten={cijfers.aanwas.map((erbij, i) => {
                    const eraf = cijfers.verloop[i] ?? 0;
                    const hoogste = Math.max(1, ...cijfers.aanwas, ...cijfers.verloop);
                    return {
                      kort: MAANDEN[i]?.[1] ?? "",
                      tip: `${MAANDEN[i]?.[0]}: ${erbij} erbij, ${eraf} gestopt of verhuisd`,
                      op: erbij / hoogste,
                      neer: eraf / hoogste,
                      accent: i === cijfers.aanwas.length - 1 && lopend,
                    };
                  })}
                  beschrijving={`Erbij en eraf per maand: ${cijfers.aanwas
                    .map(
                      (a, i) =>
                        `${MAANDEN[i]?.[0]} ${a} erbij, ${cijfers.verloop[i] ?? 0} gestopt of verhuisd`,
                    )
                    .join(", ")}`}
                />
              )}
            </Paneel>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
