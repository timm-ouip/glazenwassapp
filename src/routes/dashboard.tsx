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
import { btwIn, btwInclusief, fetchBtwProcent, fetchKlanttypen } from "@/lib/facturen";
import { fetchKlachtenPeriode } from "@/lib/klachten";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchStreets,
  formatPrice,
} from "@/lib/klanten";
import { fetchKlussen, telDagVan } from "@/lib/klussen";
import { fetchPof } from "@/lib/overzichten";
import { useRecht } from "@/lib/rechten";
import { cn } from "@/lib/utils";
import { GeldfilterPillen } from "@/components/Geldfilter";
import { adresgeldMap, contantVan, teltMee, useGeldfilter } from "@/lib/geldfilter";
import { datumSleutel, fetchWasdagen, vandaag } from "@/lib/wasdag";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({ meta: [{ title: "Dashboard — Paaltje Systems" }] }),
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
  // Voor de btw-regel: het klanttype bepaalt of de prijs van een adres
  // inclusief of exclusief btw genoteerd staat. Alleen het type, niet het hele
  // klantenbestand: hier hoeven geen mailadressen en notities voor over de
  // lijn.
  const klantenQuery = useQuery({
    queryKey: ["klanttypen"],
    queryFn: fetchKlanttypen,
    enabled: mag,
    staleTime: 5 * MINUUT,
  });
  const btwQuery = useQuery({
    queryKey: ["btw-procent"],
    queryFn: fetchBtwProcent,
    enabled: mag,
    staleTime: 30 * MINUUT,
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
    return { info: adresgeldMap(customers, streets, districts), wijken: districts };
  }, [districtsQuery.data, streetsQuery.data, customersQuery.data]);

  /**
   * Van elk adres: staat zijn prijs inclusief btw? Een particulier noteert
   * inclusief, een bedrijf en een VvE exclusief. Kennen we de klant niet (geen
   * klant aan het adres, of weggegooid), dan gaan we uit van particulier —
   * zoals de database dat ook doet.
   *
   * Alleen het klanttype dus, en het tarief van het bedrijf. Een klant kan in
   * de database een eigen `btw_inclusief` of `btw_procent` hebben (de
   * nooduitgang), maar geen enkel scherm vult die, en ze horen ook niet bij
   * `fetchKlanttypen`. Komt die nooduitgang ooit in gebruik, dan moeten ze
   * hier mee.
   */
  const inclusiefVan = useMemo(() => {
    const customers = customersQuery.data;
    const klanten = klantenQuery.data;
    if (!customers || !klanten) return null;
    return new Map(
      customers.map((c) => [c.id, btwInclusief(c.klant_id ? klanten.get(c.klant_id) : null, null)]),
    );
  }, [customersQuery.data, klantenQuery.data]);

  const [geldkeuze, zetGeldkeuze] = useGeldfilter();

  /** Alle bedragen van dit jaar, op één hoop: wasbeurten plus extra opdrachten. */
  const posten = useMemo(() => {
    const regels = wasdagenQuery.data;
    const klussen = klussenQuery.data;
    if (!regels || !klussen) return null;
    const uit: {
      datum: string;
      prijs: number;
      customer_id: string | null;
      wasbeurt: boolean;
      /** Zoals het bij het afmelden vastgelegd is; leeg = kijk naar nu. */
      methode: "contant" | "overmaken" | null;
    }[] = regels
      .filter((r) => r.datum >= vanaf && r.datum <= tot)
      .map((r) => ({
        datum: r.datum,
        prijs: r.prijs,
        customer_id: r.customer_id,
        wasbeurt: true,
        methode: r.betaalmethode ?? null,
      }));
    for (const k of klussen) {
      const d = telDagVan(k, nu);
      if (!d || d < vanaf || d > tot) continue;
      uit.push({
        datum: d,
        prijs: k.prijs,
        customer_id: k.customer_id,
        wasbeurt: false,
        methode: null,
      });
    }
    return uit;
  }, [wasdagenQuery.data, klussenQuery.data, vanaf, tot, nu]);

  /**
   * Wat je nu wilt zien. Alles hieronder rekent met deze lijst, dus de
   * grafieken per maand, per wijk en per werkdag bewegen vanzelf mee.
   */
  const zichtbaar = useMemo(() => {
    if (!posten) return null;
    if (geldkeuze === "allebei") return posten;
    return posten.filter((p) => teltMee(geldkeuze, contantVan(p, adresInfo?.info)));
  }, [posten, geldkeuze, adresInfo]);

  const btwProcent = btwQuery.data ?? 21;

  const cijfers = useMemo(() => {
    if (!zichtbaar) return null;
    const maandOmzet = Array.from({ length: aantalMaanden }, () => 0);
    const maandAdressen = Array.from({ length: aantalMaanden }, () => 0);
    const maandContant = Array.from({ length: aantalMaanden }, () => 0);
    const maandOvermaken = Array.from({ length: aantalMaanden }, () => 0);
    const perWijk = new Map<string, number>();
    /** De dagen waarop echt gewerkt is, per maand; een dag telt één keer. */
    const werkdagen = Array.from({ length: aantalMaanden }, () => new Set<string>());
    /** Bedragen van adressen die we niet meer kennen (weggegooid). */
    let onbekend = 0;
    /** De btw die in de omzet hierboven zit, of er bij een bedrijf nog bij komt. */
    let btw = 0;
    for (const p of zichtbaar) {
      const m = Number(p.datum.slice(5, 7)) - 1;
      if (m < 0 || m >= aantalMaanden) continue;
      maandOmzet[m] = (maandOmzet[m] ?? 0) + p.prijs;
      btw += btwIn(
        p.prijs,
        (p.customer_id ? inclusiefVan?.get(p.customer_id) : undefined) ?? true,
        btwProcent,
      );
      // Alleen wasbeurten tellen als gewassen adres; een extra opdracht is werk
      // bij een adres dat je vaak diezelfde dag al waste.
      if (p.wasbeurt) maandAdressen[m] = (maandAdressen[m] ?? 0) + 1;
      werkdagen[m]?.add(p.datum);
      const info = p.customer_id ? adresInfo?.info.get(p.customer_id) : undefined;
      // Een adres dat intussen weggegooid is, kennen we niet meer: dat telt
      // hier bij geen van beide, anders zou het stilletjes contant worden.
      // De vastgelegde methode wint: anders zou een klant die in november op
      // overmaken gezet wordt, zijn werk van juni met terugwerkende kracht
      // van de ene kolom naar de andere laten springen.
      const contant = contantVan(p, adresInfo?.info);
      if (contant === true) maandContant[m] = (maandContant[m] ?? 0) + p.prijs;
      else if (contant === false) maandOvermaken[m] = (maandOvermaken[m] ?? 0) + p.prijs;
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
      btw,
      btwBekend: inclusiefVan !== null && btwQuery.isSuccess,
    };
  }, [
    zichtbaar,
    adresInfo,
    klachtenQuery.data,
    customersQuery.data,
    aantalMaanden,
    jaar,
    vanaf,
    tot,
    inclusiefVan,
    btwProcent,
    btwQuery.isSuccess,
  ]);

  /**
   * Btw per kwartaal, voor de aangifte.
   *
   * Met opzet uit `posten` en niet uit `zichtbaar`: dit is het hele bedrijf.
   * Zou hij de keuze contant/overmaken volgen, dan stond er een bedrag onder
   * "btw" dat je zo over kunt nemen en dat niet klopt.
   */
  const kwartalen = useMemo(() => {
    if (!posten || !inclusiefVan || !btwQuery.isSuccess) return null;
    const omzet = [0, 0, 0, 0];
    const btw = [0, 0, 0, 0];
    for (const p of posten) {
      const k = Math.floor((Number(p.datum.slice(5, 7)) - 1) / 3);
      if (k < 0 || k > 3) continue;
      omzet[k] = (omzet[k] ?? 0) + p.prijs;
      btw[k] =
        (btw[k] ?? 0) +
        btwIn(
          p.prijs,
          (p.customer_id ? inclusiefVan.get(p.customer_id) : undefined) ?? true,
          btwProcent,
        );
    }
    // Van het lopende jaar alleen de kwartalen die al begonnen zijn; een leeg
    // Q4 in maart zegt niets en leest als "nog niets verdiend".
    return [0, 1, 2, 3]
      .filter((k) => k * 3 < aantalMaanden)
      .map((k) => ({
        nr: k + 1,
        periode: `${MAANDEN[k * 3]?.[0]} t/m ${MAANDEN[k * 3 + 2]?.[0]}`,
        omzet: omzet[k] ?? 0,
        btw: btw[k] ?? 0,
        // Het kwartaal waar we nu in zitten is nog niet af.
        lopend: lopend && k === Math.floor((aantalMaanden - 1) / 3),
      }));
  }, [posten, inclusiefVan, btwProcent, btwQuery.isSuccess, aantalMaanden, lopend]);

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
  // klantenQuery en btwQuery staan er met opzet niet bij: die zijn alleen voor
  // de btw-regel. Mislukken ze, dan blijft die regel leeg (btwBekend) en
  // kloppen alle grafieken gewoon — daar hoort geen melding over het hele
  // dashboard bij.
  const fout = vragen.some((q) => q.isError);
  const laadt = !fout && vragen.some((q) => q.isLoading);

  const leeg = <span className="opacity-40">—</span>;
  const euro = (n: number) => formatPrice(n);
  /** Hele euro's, voor de regels waar geen centen bij horen. */
  const rondEuro = (n: number) =>
    n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
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
        <div className="flex flex-wrap items-center gap-2">
          {/* Contant en overmaken uit elkaar: standaard allebei, zodat je
              binnenkomt op je hele omzet. */}
          <GeldfilterPillen keuze={geldkeuze} onChange={zetGeldkeuze} />
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
              {/* Wat er over dit bedrag naar de Belastingdienst gaat. Niet
                  "waarvan": bij een particulier zit de btw in de prijs, bij een
                  bedrijf komt hij er juist bovenop, en dan zou "waarvan" een
                  bedrag noemen dat niet in het getal erboven zit. Zonder
                  centen, anders past de regel van een heel jaar niet meer op
                  een telefoon. Het gemiddelde per maand staat in de grafiek
                  hieronder. */}
              <TegelOnder>
                {cijfers?.btwBekend ? `btw hierover ${rondEuro(cijfers.btw)}` : " "}
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
              className="md:col-span-7 fel:[--grafiek-rustig:var(--tint-blauw-mid)]"
              extra={
                cijfers && hoogsteMaand >= 0 ? (
                  <PaneelExtra>
                    gemiddeld {rondEuro(cijfers.totaal / Math.max(1, aantalMaanden))} · hoogste:{" "}
                    {MAANDEN[hoogsteMaand]?.[0]}, {euro(cijfers.maandOmzet[hoogsteMaand] ?? 0)}
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
                  kleur="bg-tint-blauw-mid fel:bg-tint-paars-mid"
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
                  kleur="fel:text-tint-roze-mid"
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
              className="md:col-span-6 fel:[--grafiek-rustig:var(--tint-blauw-mid)]"
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
              titel="Btw per kwartaal"
              className="md:col-span-12"
              extra={
                kwartalen ? (
                  <PaneelExtra>
                    {euro(kwartalen.reduce((t, k) => t + k.btw, 0))} over{" "}
                    {lopend ? "dit jaar" : jaar}
                  </PaneelExtra>
                ) : undefined
              }
            >
              {!kwartalen && !laadt && (
                <p className="text-[12.5px] text-muted-foreground">
                  Het btw-tarief of het klanttype kon niet opgehaald worden, dus hier zou een
                  verkeerd bedrag staan. Ververs de pagina om het opnieuw te proberen.
                </p>
              )}
              {kwartalen && (
                <>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[12px] text-muted-foreground">
                        <th className="pb-1 font-medium">Kwartaal</th>
                        <th className="pb-1 font-medium">Periode</th>
                        <th className="pb-1 text-right font-medium">Omzet</th>
                        <th className="pb-1 text-right font-medium">Btw</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kwartalen.map((k) => (
                        <tr key={k.nr} className="border-t border-border/60">
                          <td className="py-1.5 font-medium">
                            Q{k.nr}
                            {k.lopend && (
                              <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">
                                loopt nog
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-muted-foreground">{k.periode}</td>
                          <td className="py-1.5 text-right tabular-nums">{euro(k.omzet)}</td>
                          <td className="py-1.5 text-right font-semibold tabular-nums">
                            {euro(k.btw)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11.5px] opacity-70">
                    Hier staat altijd het hele bedrijf, ook als je bovenaan op contant of overmaken
                    filtert: over contant werk draag je net zo goed btw af. Bij een particulier zit
                    de btw in de prijs, bij een bedrijf komt hij erbovenop. Geteld uit het werk in
                    de planning, met het klanttype zoals het nu staat — een hulpmiddel voor de
                    aangifte, niet de optelsom van de verstuurde facturen.
                  </p>
                </>
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
