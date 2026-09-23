import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, getISOWeek } from "date-fns";
import { nl } from "date-fns/locale";
import {
  IconArrowUpRight as NaarRechtsBoven,
  IconChevronRight as ChevronRight,
  IconHistory as History,
  IconMail as Mail,
  IconPlus as Plus,
  IconSearch as Search,
  IconSettings as Settings,
  IconUpload as Upload,
  type TablerIcon,
} from "@tabler/icons-react";

import { AppLayout } from "@/components/AppLayout";
import { TelBedrag, TelGetal } from "@/components/TelBedrag";
import { Vorm } from "@/components/Vorm";
import {
  TEGEL_GEWOON,
  TEGEL_KLEUR,
  TEGEL_KLIKBAAR,
  TEGEL_VAK,
  TegelGetal,
  TegelKop,
  TegelOnder,
} from "@/components/Tegel";
import { aantalOpenAanmeldingen } from "@/lib/aanmeldingen";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { fetchAfmeldstatus } from "@/lib/dagklaar";
import { naarDagBijOpstarten } from "@/lib/dagslot";
import {
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  formatPrice,
} from "@/lib/klanten";
import { fetchKlussen, telDagVan } from "@/lib/klussen";
import { fetchMappen } from "@/lib/mailbox";
import { fetchPof } from "@/lib/overzichten";
import { useRecht } from "@/lib/rechten";
import { cn } from "@/lib/utils";
import { fetchWasdag, fetchWasdagen, vandaag } from "@/lib/wasdag";

export const Route = createFileRoute("/home")({
  beforeLoad: async () => {
    await requireSession();
    // Dagplanning vastgezet op dit toestel: de app opent meteen op vandaag.
    if (typeof window !== "undefined" && naarDagBijOpstarten()) throw redirect({ to: "/dag" });
  },
  head: () => ({ meta: [{ title: "Home — Paaltje Systems" }] }),
  component: Home,
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

const KLEUR = TEGEL_KLEUR;
const VAK = `${TEGEL_VAK} ${TEGEL_KLIKBAAR}`;
const GEWOON = TEGEL_GEWOON;

function groetVoor(uur: number) {
  if (uur < 6) return "Goedenacht";
  if (uur < 12) return "Goedemorgen";
  if (uur < 18) return "Goedemiddag";
  return "Goedenavond";
}

/**
 * Het startscherm: een vak per onderdeel, elk met het getal waar je voor
 * komt, en de omzet per maand als staafjes. Wat je niet mag zien, staat er
 * ook niet — een geldloper krijgt alleen Betalingen en Instellingen.
 */
function Home() {
  useRequireAuth();
  const { employee } = useAuth();
  const navigate = useNavigate();
  const magPlannen = useRecht("planning");
  const prijzenZien = useRecht("prijzen_zien");
  const magKlantenZien = useRecht("klanten_bekijken");
  const magKlanten = useRecht("klanten_bewerken");
  const magMailLezen = useRecht("mail_lezen");
  const magMail = useRecht("mail_lezen", "mail_versturen");
  const magGeld = useRecht("geldlopen", "prijzen_zien");
  // De omzet komt uit de planning: zonder dat recht geeft de database niets
  // terug (en is de planningspagina achter het vak dicht).
  const magOmzet = prijzenZien && magPlannen;
  // Nieuwe klant maken gebeurt op de klantenpagina, en die moet je kunnen zien.
  const magNieuw = magKlanten && magKlantenZien;

  // Vangnet voor het slot op de dag: kwam de eerste pagina van de server,
  // dan zag beforeLoad geen localStorage en gebeurt het hier alsnog.
  useEffect(() => {
    if (naarDagBijOpstarten()) void navigate({ to: "/dag", replace: true });
    // Alleen bij het openen van de pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hoe lang wat Home ophaalt goed blijft voordat hij het opnieuw vraagt. Home
  // open je vaak even tussendoor; dan hoeft niet elke keer het hele jaar en
  // het hele adressenbestand opnieuw binnen te komen.
  const MINUUT = 60_000;

  const nu = vandaag();
  const jaarBegin = `${nu.slice(0, 4)}-01-01`;

  // Vandaag: wat er gepland staat, en hoeveel adressen de teams al afmeldden.
  const dagQuery = useQuery({
    queryKey: ["wasdag", nu],
    queryFn: () => fetchWasdag(nu),
    enabled: magPlannen,
    staleTime: MINUUT,
  });
  const dagKlussenQuery = useQuery({
    queryKey: ["klussen", nu, nu],
    queryFn: () => fetchKlussen(nu, nu),
    enabled: magPlannen,
    staleTime: MINUUT,
  });
  const afmeldQuery = useQuery({
    queryKey: ["wasdagen", "afmeldstatus", nu, nu],
    queryFn: () => fetchAfmeldstatus(nu, nu),
    enabled: magPlannen,
    staleTime: MINUUT,
  });

  // De omzet van dit jaar tot en met vandaag, voor de staafjes. Dezelfde
  // som als "Gewassen in …" op de planning: regels plus extra opdrachten.
  const jaarQuery = useQuery({
    queryKey: ["wasdagen", jaarBegin, nu],
    queryFn: () => fetchWasdagen(jaarBegin, nu),
    enabled: magOmzet,
    staleTime: 10 * MINUUT,
  });
  const jaarKlussenQuery = useQuery({
    queryKey: ["klussen", jaarBegin, nu],
    queryFn: () => fetchKlussen(jaarBegin, nu),
    enabled: magOmzet,
    staleTime: 10 * MINUUT,
  });

  const wijkenNodig = magKlantenZien || magPlannen;
  const districtsQuery = useQuery({
    queryKey: ["districts"],
    queryFn: fetchDistricts,
    enabled: wijkenNodig,
    staleTime: 5 * MINUUT,
  });
  const streetsQuery = useQuery({
    queryKey: ["streets"],
    queryFn: fetchStreets,
    enabled: wijkenNodig,
    staleTime: 5 * MINUUT,
  });
  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
    enabled: magKlantenZien,
    staleTime: 5 * MINUUT,
  });
  const klantenQuery = useQuery({
    queryKey: ["klanten"],
    queryFn: fetchKlanten,
    enabled: magKlantenZien,
    staleTime: 5 * MINUUT,
  });
  const pofQuery = useQuery({
    queryKey: ["geld-pof", null],
    queryFn: () => fetchPof(null),
    enabled: prijzenZien,
    staleTime: 2 * MINUUT,
  });
  const mappenQuery = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: magMailLezen,
  });
  const aanmeldQuery = useQuery({
    queryKey: ["aanmeldingen-open"],
    queryFn: aantalOpenAanmeldingen,
    enabled: magKlanten,
  });

  // --- Vandaag -------------------------------------------------------------
  const dag = useMemo(() => {
    if (!dagQuery.data || !dagKlussenQuery.data) return null;
    const klussen = dagKlussenQuery.data.filter((k) => telDagVan(k, nu) === nu);
    const bedrag =
      dagQuery.data.reduce((som, r) => som + r.prijs, 0) +
      klussen.reduce((som, k) => som + k.prijs, 0);
    const adressen = dagQuery.data.filter((r) => r.customer_id).length;
    const status = afmeldQuery.data ?? [];
    const totaal = status.reduce((som, s) => som + s.regels, 0);
    const gedaan = status.reduce((som, s) => som + Math.min(s.gedaan, s.regels), 0);
    return { bedrag, adressen, totaal, gedaan, klussen: klussen.length };
  }, [dagQuery.data, dagKlussenQuery.data, afmeldQuery.data, nu]);

  // --- Omzet per maand -----------------------------------------------------
  const maanden = useMemo(() => {
    if (!jaarQuery.data || !jaarKlussenQuery.data) return null;
    const aantal = Number(nu.slice(5, 7));
    const bedragen = Array.from({ length: aantal }, () => 0);
    for (const r of jaarQuery.data) {
      if (r.datum > nu) continue;
      const m = Number(r.datum.slice(5, 7)) - 1;
      if (m >= 0 && m < aantal) bedragen[m] = (bedragen[m] ?? 0) + r.prijs;
    }
    for (const k of jaarKlussenQuery.data) {
      const d = telDagVan(k, nu);
      if (!d || d < jaarBegin || d > nu) continue;
      const m = Number(d.slice(5, 7)) - 1;
      if (m >= 0 && m < aantal) bedragen[m] = (bedragen[m] ?? 0) + k.prijs;
    }
    return bedragen.map((bedrag, i) => ({
      naam: MAANDEN[i]![0],
      kort: MAANDEN[i]![1],
      bedrag,
    }));
  }, [jaarQuery.data, jaarKlussenQuery.data, nu, jaarBegin]);
  const dezeMaand = maanden?.[maanden.length - 1];

  // --- Klanten en wijken -----------------------------------------------------
  // Een wijk of straat in de prullenbak neemt zijn adressen niet mee in de
  // database; die vallen hier weg doordat hun straat of wijk ontbreekt.
  const bestand = useMemo(() => {
    const districts = districtsQuery.data;
    const streets = streetsQuery.data;
    if (!districts || !streets) return null;
    const wijkIds = new Set(districts.map((d) => d.id));
    const straten = streets.filter((s) => wijkIds.has(s.district_id));
    const straatOp = new Map(straten.map((s) => [s.id, s]));
    const wijkNaam = new Map(districts.map((d) => [d.id, d.name]));
    const naamOp = new Map((klantenQuery.data ?? []).map((k) => [k.id, k.naam.trim()]));
    const adressen = (customersQuery.data ?? []).flatMap((c) => {
      const s = straatOp.get(c.street_id);
      if (!s) return [];
      const straat = s.volledige_naam.trim() || s.name;
      const adres = `${straat} ${c.house_number}${c.addition ?? ""}`;
      const naam = c.klant_id ? (naamOp.get(c.klant_id) ?? "") : "";
      const wijk = wijkNaam.get(s.district_id) ?? "";
      return [
        {
          id: c.id,
          wijkId: s.district_id,
          adres,
          naam,
          wijk,
          zoek: `${adres} ${s.name} ${naam} ${wijk}`.toLowerCase(),
        },
      ];
    });
    return {
      wijken: districts.length,
      straten: straten.length,
      adressen,
      zonderNaam: adressen.filter((a) => !a.naam).length,
      klaar: customersQuery.isSuccess && klantenQuery.isSuccess,
    };
  }, [
    districtsQuery.data,
    streetsQuery.data,
    customersQuery.data,
    klantenQuery.data,
    customersQuery.isSuccess,
    klantenQuery.isSuccess,
  ]);

  // --- Geld, mail en aanmeldingen ---------------------------------------------
  const pof = useMemo(() => {
    if (!pofQuery.data) return null;
    const open = pofQuery.data.filter((r) => r.open > 0.005);
    return { bedrag: open.reduce((som, r) => som + r.open, 0), adressen: open.length };
  }, [pofQuery.data]);
  const postvak = mappenQuery.data?.find((m) => m.rol === "postvak");
  const ongelezen = postvak?.ongelezen ?? 0;

  // --- Kop -------------------------------------------------------------------
  // De tijd van de dag hoort bij de telefoon, niet bij de server (die draait in
  // UTC): pas na het laden invullen, anders botsen hun twee begroetingen.
  const [moment, setMoment] = useState<Date | null>(null);
  useEffect(() => setMoment(new Date()), []);
  const voornaam = (employee?.naam || "").trim().split(/\s+/)[0] ?? "";
  const groet = moment ? groetVoor(moment.getHours()) : "";
  const aanhef = !moment ? " " : voornaam ? `${groet}, ${voornaam}` : groet;
  const dagTekst = moment ? format(moment, "EEEE d MMMM", { locale: nl }) : " ";
  const letter = (employee?.naam || employee?.email || "?").charAt(0).toUpperCase();

  const leeg = <span className="opacity-40">—</span>;

  return (
    <AppLayout titel="Home" zonderTitelbalk>
      <div className="mx-auto max-w-[1180px]">
        <header className="flex flex-col gap-1 pb-4 pt-4 md:flex-row md:items-center md:gap-3 md:pb-5 md:pt-6">
          {/* Op de telefoon: het merk en je account, zoals een app opent. */}
          <div className="flex items-center justify-between pb-1 md:hidden">
            <span className="font-display text-[22px] font-semibold tracking-[-0.02em]">
              Paaltje Systems
            </span>
            <Link
              to="/instellingen"
              search={{ tab: "account" }}
              aria-label="Account en instellingen"
              className="flex size-9 items-center justify-center rounded-full bg-foreground text-[14px] font-semibold text-background"
            >
              {letter}
            </Link>
          </div>
          <div className="min-w-0 md:mr-auto">
            {/* Op de telefoon staat de begroeting klein in de regel eronder;
                een schermlezer krijgt daar deze kop. */}
            <h1 className="sr-only md:hidden">Home</h1>
            <h1 className="hidden font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] md:block">
              {aanhef}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {moment && <span className="md:hidden">{aanhef} · </span>}
              {dagTekst}
              {moment && <span className="hidden md:inline"> · week {getISOWeek(moment)}</span>}
            </p>
          </div>
          {magKlantenZien && (
            <div className="hidden md:block">
              <ZoekOpHome adressen={bestand?.adressen ?? []} laden={!bestand?.klaar} />
            </div>
          )}
          {magNieuw && (
            <Link
              to="/klanten"
              search={{ nieuw: "klant" }}
              title="Nieuwe klant"
              className="hidden h-10 items-center gap-1.5 rounded-full bg-primary pl-3.5 pr-[18px] text-[14px] font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:flex"
            >
              <Plus className="size-4" stroke={2.4} aria-hidden="true" />
              Nieuw
            </Link>
          )}
        </header>

        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
          {magPlannen && (
            <Link
              to="/dag"
              className={cn(
                VAK,
                KLEUR.oranje,
                "col-span-2 h-[156px] rounded-[28px] px-5 py-4 md:h-[270px] md:px-[26px] md:py-[22px] zak:h-[136px] zak:md:h-[200px] zak:md:px-5 zak:md:py-4",
              )}
            >
              <Vorm
                naam="vlek"
                plek="-bottom-14 -right-8 size-[170px] md:-bottom-[70px] md:-right-10 md:size-[300px]"
              />
              <span className="flex items-center justify-between text-[13px] font-semibold md:text-[14px] zak:text-[10.5px] zak:font-bold zak:uppercase zak:tracking-[0.08em] zak:text-muted-foreground">
                Planning vandaag
                <ChevronRight className="size-[18px] md:size-5" aria-hidden="true" />
              </span>
              <span className="mt-2.5 whitespace-nowrap font-display text-[60px] font-semibold leading-none tracking-[-0.05em] tabular-nums md:mt-[18px] md:text-[96px] zak:mt-2 zak:text-[32px] zak:tracking-[-0.02em] zak:md:mt-3 zak:md:text-[44px]">
                {!dag ? (
                  leeg
                ) : prijzenZien ? (
                  <TelBedrag bedrag={dag.bedrag} onthoud="home-dag-bedrag" />
                ) : (
                  <TelGetal waarde={dag.adressen} onthoud="home-dag-adressen" />
                )}
              </span>
              <span className="mt-auto flex flex-col gap-[7px] md:gap-2.5">
                <span className="truncate text-[13.5px] opacity-80 md:text-[15px] zak:text-[12px] zak:text-muted-foreground zak:opacity-100 zak:md:text-[12.5px]">
                  {!dag
                    ? " "
                    : dag.adressen === 0 && dag.klussen === 0
                      ? "Niets gepland voor vandaag"
                      : [
                          prijzenZien ? `${dag.adressen} adressen` : "adressen",
                          dag.klussen > 0
                            ? `${dag.klussen} extra ${dag.klussen === 1 ? "opdracht" : "opdrachten"}`
                            : "",
                          dag.totaal > 0
                            ? dag.gedaan >= dag.totaal
                              ? "alles afgemeld"
                              : `nog ${dag.totaal - dag.gedaan} te gaan`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                </span>
                {dag && dag.totaal > 0 && (
                  <span
                    role="img"
                    aria-label={`${Math.round((dag.gedaan / dag.totaal) * 100)} procent van vandaag afgemeld`}
                    className="block h-1.5 overflow-hidden rounded-full bg-current/20 md:h-2"
                  >
                    <span
                      className="block h-full rounded-full bg-current"
                      style={{ width: `${(dag.gedaan / dag.totaal) * 100}%` }}
                    />
                  </span>
                )}
              </span>
            </Link>
          )}

          {magOmzet && (
            <Link
              to="/dashboard"
              className={cn(
                VAK,
                KLEUR.donker,
                "col-span-2 hidden h-[270px] rounded-[28px] px-6 pb-4 pt-5 md:flex zak:h-[200px] zak:px-5 zak:pt-4",
              )}
            >
              <Vorm naam="blad" plek="-left-8 -top-10 size-[230px]" />
              <span className="flex items-start justify-between gap-3">
                <span className="flex flex-col gap-1">
                  <span className="text-[14px] font-semibold zak:text-[10.5px] zak:font-bold zak:uppercase zak:tracking-[0.08em] zak:text-muted-foreground">
                    Omzet per maand
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-display text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums zak:text-[28px] zak:tracking-[-0.02em]">
                      {dezeMaand ? (
                        <TelBedrag bedrag={dezeMaand.bedrag} onthoud="home-omzet" />
                      ) : (
                        leeg
                      )}
                    </span>
                    {dezeMaand && (
                      <span className="text-[13px] text-tegel-donker-ink/70">
                        in {dezeMaand.naam}
                      </span>
                    )}
                  </span>
                </span>
                <NaarRechtsBoven className="size-[18px]" aria-hidden="true" />
              </span>
              {maanden && <Staafjes maanden={maanden} soort="groot" />}
            </Link>
          )}

          {magKlantenZien && (
            <Link to="/klanten" className={cn(VAK, KLEUR.paars, GEWOON)}>
              <Vorm
                naam="palmblad"
                plek="-bottom-8 -right-9 size-[130px] md:-bottom-10 md:-right-11 md:size-[200px]"
              />
              <TegelKop label="Klanten" />
              <TegelGetal>
                {bestand?.klaar ? (
                  <TelGetal waarde={bestand.adressen.length} onthoud="home-klanten" />
                ) : (
                  leeg
                )}
              </TegelGetal>
              <TegelOnder>
                {!bestand?.klaar ? (
                  " "
                ) : bestand.zonderNaam > 0 ? (
                  <>
                    {/* Op de telefoon is het vak te smal voor de hele zin. */}
                    <span className="hidden md:inline">adressen · </span>
                    {bestand.zonderNaam} nog zonder naam
                  </>
                ) : (
                  "adressen, allemaal met naam"
                )}
              </TegelOnder>
            </Link>
          )}

          {magGeld && (
            <Link
              to="/betalingen"
              search={{ tab: prijzenZien ? "pof" : "lopen" }}
              className={cn(VAK, KLEUR.geel, GEWOON)}
            >
              <Vorm naam="golven" plek="inset-x-0 bottom-0 h-[60px] md:h-[110px]" />
              <TegelKop label="Betalingen" />
              {prijzenZien ? (
                <>
                  <TegelGetal knippen={false}>
                    {pof ? <TelBedrag bedrag={pof.bedrag} onthoud="home-pof" /> : leeg}
                  </TegelGetal>
                  <TegelOnder>
                    {!pof
                      ? " "
                      : pof.adressen > 0
                        ? `pof open bij ${pof.adressen} ${pof.adressen === 1 ? "adres" : "adressen"}`
                        : "geen pof open"}
                  </TegelOnder>
                </>
              ) : (
                <>
                  <span className="mt-auto text-[17px] font-semibold md:text-[20px]">
                    Geld lopen
                  </span>
                  <TegelOnder>naar je looplijst</TegelOnder>
                </>
              )}
            </Link>
          )}

          {magPlannen && (
            <Link to="/" className={cn(VAK, KLEUR.aqua, GEWOON)}>
              <Vorm
                naam="slinger"
                plek="-right-5 -top-6 h-[130px] w-[95px] md:-right-6 md:-top-8 md:h-[210px] md:w-[155px]"
              />
              <TegelKop label="Wijken" />
              <TegelGetal>
                {bestand ? <TelGetal waarde={bestand.wijken} onthoud="home-wijken" /> : leeg}
              </TegelGetal>
              <TegelOnder>{bestand ? `${bestand.straten} straten` : " "}</TegelOnder>
            </Link>
          )}

          {magMail && (
            <Link to="/mailing" className={cn(VAK, KLEUR.petrol, GEWOON)}>
              <Vorm
                naam="bloem"
                plek="-right-8 -top-8 size-[120px] md:-right-10 md:-top-10 md:size-[180px]"
              />
              <span className="flex items-center justify-between">
                <span className="flex size-7 items-center justify-center rounded-[8px] bg-tegel-petrol-ink text-tegel-petrol md:size-8 md:rounded-[9px]">
                  <Mail className="size-[17px] md:size-[18px]" stroke={2.2} aria-hidden="true" />
                </span>
                {ongelezen > 0 && (
                  <span className="rounded-full bg-tegel-petrol-ink px-2 py-0.5 text-[11px] font-semibold text-tegel-petrol md:text-[12px]">
                    {ongelezen} nieuw
                  </span>
                )}
              </span>
              <span className="mt-auto text-[17px] font-semibold tracking-[-0.01em] md:text-[20px]">
                Mail
              </span>
              <span className="mt-0.5 truncate text-[12px] text-current/80 md:mt-1 md:text-[13px]">
                {!magMailLezen
                  ? "berichten opstellen"
                  : !mappenQuery.data
                    ? " "
                    : !postvak
                      ? "koppel eerst je mailbox"
                      : ongelezen > 0
                        ? `${ongelezen} ongelezen in je postvak`
                        : "alles gelezen"}
              </span>
            </Link>
          )}

          {magKlanten && (
            <Link
              to="/aanmeldingen"
              className={cn(
                VAK,
                KLEUR.perzik,
                "h-[116px] px-4 py-3.5 md:h-[128px] md:px-5 md:py-4",
              )}
            >
              <Vorm
                naam="schelpen"
                plek="-bottom-5 -right-5 h-[85px] w-[110px] md:-bottom-6 md:-right-6 md:h-[110px] md:w-[140px]"
              />
              <TegelKop label="Aanmeldingen" />
              <span className="mt-auto flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-2">
                <span className="font-display text-[38px] font-semibold leading-none tracking-[-0.04em] tabular-nums md:text-[40px]">
                  {aanmeldQuery.data === undefined ? (
                    leeg
                  ) : (
                    <TelGetal waarde={aanmeldQuery.data} onthoud="home-aanmeldingen" />
                  )}
                </span>
                <span className="mt-1 truncate text-[12px] opacity-80 md:mt-0 md:text-[13px]">
                  {aanmeldQuery.data === undefined
                    ? " "
                    : aanmeldQuery.data > 0
                      ? "nog na te kijken"
                      : "alles nagekeken"}
                </span>
              </span>
            </Link>
          )}

          {magOmzet && (
            <Link
              to="/dashboard"
              className={cn(VAK, KLEUR.groen, "h-[116px] px-4 pb-3 pt-3.5 md:hidden")}
            >
              <span className="flex items-center justify-between text-[13px] font-semibold">
                Omzet
                {dezeMaand && (
                  <span className="rounded-full bg-tegel-groen-ink/15 px-2 py-0.5 text-[10.5px] font-semibold">
                    {dezeMaand.kort}
                  </span>
                )}
              </span>
              <span className="mt-1.5 whitespace-nowrap font-display text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {dezeMaand ? <TelBedrag bedrag={dezeMaand.bedrag} onthoud="home-omzet" /> : leeg}
              </span>
              {maanden && <Staafjes maanden={maanden} soort="klein" />}
            </Link>
          )}

          {/* Op de telefoon een rij kleine knoppen, op de computer drie vakken
              in het rooster (contents: dan tellen ze mee als gewone vakken). */}
          <div className="col-span-2 flex gap-2 md:contents">
            {magKlanten && (
              <Link to="/importeren" className={cn(VAK, KLEUR.donker, KLEIN)}>
                <KleinVak icon={Upload} label="Importeren" onder="een Excel-lijst inlezen" />
              </Link>
            )}
            <Link
              to="/instellingen"
              search={{ tab: "account" }}
              className={cn(VAK, KLEUR.donker, KLEIN)}
            >
              <KleinVak icon={Settings} label="Instellingen" onder="team, wijken en mail" />
            </Link>
            {magKlanten && (
              <Link to="/prullenbak" className={cn(VAK, KLEUR.donker, KLEIN)}>
                <KleinVak icon={History} label="Geschiedenis" onder="weggelegd, terug te zetten" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

/** De kleine vakken: een knop op de telefoon, een vak op de computer. */
const KLEIN =
  "h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-[16px] text-[13px] font-medium md:h-[128px] md:flex-col md:items-start md:justify-start md:gap-0 md:rounded-[24px] md:px-5 md:py-4";

function KleinVak({
  icon: Icoon,
  label,
  onder,
}: {
  icon: TablerIcon;
  label: string;
  onder: string;
}) {
  return (
    <>
      <Icoon className="size-4 shrink-0 md:size-[22px]" stroke={1.8} aria-hidden="true" />
      <span className="md:mt-auto md:text-[17px] md:font-semibold">{label}</span>
      <span className="hidden text-[13px] font-normal text-tegel-donker-ink/70 md:mt-0.5 md:block">
        {onder}
      </span>
    </>
  );
}

/**
 * De omzet per maand als staafjes: één reeks, dus geen legenda; de huidige
 * maand in kleur, de rest rustig. Onder de muis staat het bedrag, en een
 * schermlezer krijgt alle maanden voorgelezen.
 */
function Staafjes({
  maanden,
  soort,
}: {
  maanden: { naam: string; kort: string; bedrag: number }[];
  soort: "groot" | "klein";
}) {
  const hoogste = Math.max(1, ...maanden.map((m) => m.bedrag));
  const laatste = maanden.length - 1;
  const groot = soort === "groot";
  const maxHoogte = groot ? 118 : 34;
  const voorlezen = `Omzet per maand: ${maanden
    .map((m) => `${m.naam} ${formatPrice(m.bedrag)}`)
    .join(", ")}`;
  return (
    <>
      <span
        role="img"
        aria-label={voorlezen}
        className={cn(
          "mt-auto flex items-end",
          groot ? "h-[136px] gap-0.5 border-b border-tegel-donker-ink/15" : "h-[34px] gap-[3px]",
        )}
      >
        {maanden.map((m, i) => (
          <span
            key={m.kort}
            title={`${m.naam}: ${formatPrice(m.bedrag)}`}
            className={cn("flex h-full flex-1 flex-col justify-end", groot && "px-1.5")}
          >
            <span
              className={cn(
                "block rounded-t-[4px]",
                i === laatste
                  ? groot
                    ? "bg-grafiek-accent"
                    : "bg-grafiek-klein-accent"
                  : groot
                    ? "bg-grafiek-rustig"
                    : "bg-grafiek-klein-rustig",
              )}
              style={{ height: Math.max(2, Math.round((m.bedrag / hoogste) * maxHoogte)) }}
            />
          </span>
        ))}
      </span>
      {groot && (
        <span aria-hidden="true" className="flex gap-0.5 pt-1.5">
          {maanden.map((m, i) => (
            <span
              key={m.kort}
              className={cn(
                "flex-1 basis-0 text-center text-[11px]",
                i !== laatste && "text-tegel-donker-ink/65",
              )}
            >
              {m.kort}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

interface Zoekadres {
  id: string;
  wijkId: string;
  adres: string;
  naam: string;
  wijk: string;
  zoek: string;
}

/**
 * Zoeken in alle wijken tegelijk, op adres, straat, naam of wijk. Een
 * treffer opent het dossier van dat adres op de klantenpagina.
 */
function ZoekOpHome({ adressen, laden }: { adressen: Zoekadres[]; laden: boolean }) {
  const navigate = useNavigate();
  const [tekst, setTekst] = useState("");
  const [open, setOpen] = useState(false);
  const [gekozen, setGekozen] = useState(0);

  const termen = useMemo(() => tekst.trim().toLowerCase().split(/\s+/).filter(Boolean), [tekst]);
  const treffers = useMemo(
    () =>
      termen.length === 0
        ? []
        : adressen.filter((a) => termen.every((t) => a.zoek.includes(t))).slice(0, 8),
    [adressen, termen],
  );

  function kies(a: Zoekadres) {
    setOpen(false);
    void navigate({ to: "/klanten", search: { wijk: a.wijkId, adres: a.id } });
  }

  function opToets(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setGekozen((g) => Math.min(g + 1, Math.max(0, treffers.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setGekozen((g) => Math.max(g - 1, 0));
    } else if (e.key === "Enter") {
      const a = treffers[gekozen];
      if (a) {
        e.preventDefault();
        kies(a);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const lijstOpen = open && termen.length > 0 && treffers.length > 0;
  // Wat een schermlezer hoort, en wat je ziet als er (nog) niets is.
  const melding =
    termen.length === 0
      ? ""
      : laden
        ? "Adressen laden…"
        : treffers.length === 0
          ? "Niets gevonden"
          : `${treffers.length} ${treffers.length === 1 ? "adres" : "adressen"} gevonden`;

  return (
    <div className="relative w-[280px]">
      <label className="flex h-10 items-center gap-2 rounded-full bg-surface px-3.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">Zoek een klant of adres</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={lijstOpen}
          aria-controls="home-zoektreffers"
          aria-autocomplete="list"
          aria-activedescendant={
            lijstOpen && treffers[gekozen] ? `home-treffer-${treffers[gekozen]!.id}` : undefined
          }
          value={tekst}
          onChange={(e) => {
            setTekst(e.target.value);
            setGekozen(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={opToets}
          placeholder="Zoek klant, adres of straat"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {lijstOpen && (
        <ul
          id="home-zoektreffers"
          role="listbox"
          aria-label="Gevonden adressen"
          className="absolute right-0 top-12 z-30 w-[360px] overflow-hidden rounded-[16px] border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {treffers.map((a, i) => (
            <li
              key={a.id}
              id={`home-treffer-${a.id}`}
              role="option"
              aria-selected={i === gekozen}
              // mousedown en niet click: anders sluit de blur de lijst eerst.
              onMouseDown={(e) => {
                e.preventDefault();
                kies(a);
              }}
              onMouseEnter={() => setGekozen(i)}
              className={cn(
                "flex cursor-pointer flex-col rounded-[11px] px-3 py-2",
                i === gekozen && "bg-accent text-accent-foreground",
              )}
            >
              <span className="truncate text-[13.5px] font-medium">{a.adres}</span>
              <span className="truncate text-[12px] text-muted-foreground">
                {[a.naam || "nog geen naam", a.wijk].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && termen.length > 0 && treffers.length === 0 && (
        <div className="absolute right-0 top-12 z-30 w-[360px] rounded-[16px] border border-border bg-popover px-4 py-3 text-[13px] text-muted-foreground shadow-lg">
          {melding}
        </div>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {melding}
      </span>
    </div>
  );
}
