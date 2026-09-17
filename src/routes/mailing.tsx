/**
 * De aankondigingsmail: "morgen komen we langs".
 *
 * De bladen horen in deze volgorde bij elkaar: je leest je mail, je stelt een
 * bericht op voor een ingeplande dag, en je kijkt wat eruit ging. Antwoorden
 * van klanten komen gewoon in het Postvak binnen, en Paaltje leest ze mee.
 *
 * Het aantal ontvangers komt van de server, niet uit deze pagina. Wat er op de
 * knop staat is precies wat de Edge Function straks gaat versturen; een
 * telling die de browser zelf maakt kan er net naast zitten, en dan klopt de
 * bevestiging niet met de werkelijkheid.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle as AlertTriangle,
  IconCheck as Check,
  IconMail as Mail,
  IconMailCheck as MailCheck,
  IconSend as Send,
  IconShieldCheck as ShieldCheck,
  IconArrowBackUp as Undo2,
  IconUsers as Users,
  IconX as X,
  IconArrowLeft as ArrowLeft,
  IconDots as MoreHorizontal,
  IconInbox as Inbox,
  IconMessages as Messages,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { Postvak } from "@/components/mail/Postvak";
import { Gesprekken } from "@/components/mail/Gesprekken";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dagrapporten } from "@/components/mail/Dagrapporten";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppGesprekken } from "@/components/whatsapp/WhatsAppGesprekken";
import { datumVoluit, fetchSjablonen, fetchWhatsAppKoppeling } from "@/lib/whatsapp";
import { toonMaand } from "@/lib/klanten";
import { datumSleutel, fetchWasdagen, toonDatum, vandaag } from "@/lib/wasdag";
import {
  bewaarAfzender,
  controleerVerbinding,
  fetchAfzender,
  draaiWijzigingTerug,
  fetchWijzigingen,
  type Wijziging,
  fetchMailingen,
  telOntvangers,
  verstuurAankondiging,
  type AankondigKanaal,
  type Controle,
} from "@/lib/mailing";
import { heeftRecht } from "@/lib/rechten";

interface MailingSearch {
  /** De dag die al gekozen is, bijvoorbeeld vanaf de planningspagina. */
  dag?: string;
}

export const Route = createFileRoute("/mailing")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): MailingSearch =>
    typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {},
  head: () => ({
    meta: [
      { title: "Mailing — Wooshy" },
      {
        name: "description",
        content: "Een aankondiging sturen naar alle klanten van een ingeplande dag.",
      },
    ],
  }),
  component: Mailing,
});

/** Waar een nieuw bericht mee begint. Je past het aan, maar niet vanaf nul. */
const VOORBEELDTEKST = `Beste {{naam}},

Morgen komen wij langs om de ramen van {{adres}} te wassen.

Komt het niet uit? Antwoord dan gewoon even op deze mail, dan slaan we deze keer over.

Met vriendelijke groet,
De Ramensopperij`;

const WEERGAVE_OPSLAG = "wooshy.mail-weergave";

function Mailing() {
  useRequireAuth();
  const { dag } = Route.useSearch();
  // Het postvak is voor wie mail mag lezen; het rapport en het dagrapport
  // blijven bij de eigenaar. Kom je vanaf de planning met een dag, dan wil je
  // aankondigen.
  const { employee } = useAuth();
  // Lezen: het postvak. Versturen: opstellen en wat er verstuurd is.
  const toonPostvak = heeftRecht(employee, "mail_lezen");
  const toonVersturen = heeftRecht(employee, "mail_versturen");
  const toonRapport = employee?.rol === "eigenaar";
  type Blad = "postvak" | "whatsapp" | "opstellen" | "verstuurd" | "rapport" | "dagrapport";
  const mag: Record<Blad, boolean> = {
    postvak: toonPostvak,
    whatsapp: toonPostvak,
    opstellen: toonVersturen,
    verstuurd: toonVersturen,
    rapport: toonRapport,
    dagrapport: toonRapport,
  };
  const startBlad: Blad = (dag && toonVersturen) || !toonPostvak ? "opstellen" : "postvak";
  const [blad, setBlad] = useState<Blad>(startBlad);

  // De rol is er soms pas na het eerste renderen. Dan het startblad alsnog
  // één keer kiezen (de eigenaar hoort op Postvak te beginnen), en daarna
  // alleen terugzetten als je op een blad staat dat je niet mag zien.
  const startGekozen = useRef(false);
  useEffect(() => {
    if (!employee) return;
    if (!startGekozen.current) {
      startGekozen.current = true;
      if (blad !== startBlad) setBlad(startBlad);
      return;
    }
    if (!mag[blad]) setBlad(startBlad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, toonPostvak, toonVersturen, toonRapport, blad]);

  // Op de telefoon: bovenin wissel je tussen gesprekken per klant en het hele
  // postvak. Die keuze onthouden we, want wie per klant werkt, wil dat morgen weer.
  const mobiel = useIsMobile();
  // Gesprekken zijn per klant; wie geen klanten mag zien, heeft daar niets aan.
  const toonGesprekken = ["klanten_bekijken", "klanten_bewerken", "planning"].some((r) =>
    heeftRecht(employee, r as Parameters<typeof heeftRecht>[1]),
  );
  // Meteen bij het aanmaken lezen: anders haalt Gesprekken eerst al zijn lijsten op
  // en springt hij daarna pas naar het postvak. De telefoonweergave tekent de
  // server niet, dus localStorage is er hier altijd.
  const [gekozenWeergave, setWeergave] = useState<"gesprekken" | "postvak">(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(WEERGAVE_OPSLAG) === "postvak"
        ? "postvak"
        : "gesprekken";
    } catch {
      return "gesprekken";
    }
  });
  const weergave = toonGesprekken ? gekozenWeergave : "postvak";
  function kiesWeergave(w: "gesprekken" | "postvak") {
    setWeergave(w);
    setBlad("postvak");
    try {
      localStorage.setItem(WEERGAVE_OPSLAG, w);
    } catch {
      // Niet kunnen onthouden is geen reden om niet te wisselen.
    }
  }

  if (mobiel && toonPostvak) {
    const extra = blad !== "postvak" && blad !== "whatsapp";
    const extraNaam: Record<Blad, string> = {
      postvak: "",
      whatsapp: "",
      opstellen: "Aankondigen",
      verstuurd: "Verstuurd",
      rapport: "Rapport",
      dagrapport: "Dagrapport",
    };
    return (
      <AppLayout titel="Mail">
        {extra ? (
          <>
            <button
              type="button"
              onClick={() => setBlad("postvak")}
              className="mb-3 flex items-center gap-1.5 text-[14px] font-medium"
            >
              <ArrowLeft className="size-5" /> {extraNaam[blad]}
            </button>
            {blad === "opstellen" && <Opstellen beginDag={dag} />}
            {blad === "verstuurd" && <Verstuurd />}
            {blad === "dagrapport" && <Dagrapporten />}
            {blad === "rapport" && <Rapport />}
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              {toonGesprekken ? (
              <div className="flex flex-1 rounded-full bg-card p-[3px] shadow-card">
                {(
                  [
                    ["gesprekken", Messages, "Gesprekken"],
                    ["postvak", Inbox, "Postvak"],
                  ] as const
                ).map(([w, Icoon, label]) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => kiesWeergave(w)}
                    aria-pressed={weergave === w}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[14px] ${
                      weergave === w ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Icoon className="size-4" /> {label}
                  </button>
                ))}
              </div>
              ) : (
                <div className="flex-1" />
              )}
              {(toonVersturen || toonRapport) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0 rounded-full bg-card"
                      aria-label="Meer mail"
                    >
                      <MoreHorizontal className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {toonVersturen && (
                      <>
                        <DropdownMenuItem onSelect={() => setBlad("opstellen")}>
                          <Send className="size-4" /> Aankondigen
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setBlad("verstuurd")}>
                          <MailCheck className="size-4" /> Verstuurd
                        </DropdownMenuItem>
                      </>
                    )}
                    {toonRapport && (
                      <>
                        <DropdownMenuItem onSelect={() => setBlad("dagrapport")}>
                          <Check className="size-4" /> Dagrapport
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setBlad("rapport")}>
                          <Users className="size-4" /> Rapport
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {weergave === "gesprekken" ? (
              <Gesprekken />
            ) : (
              <Postvak onAankondigen={toonVersturen ? () => setBlad("opstellen") : undefined} />
            )}
          </>
        )}
      </AppLayout>
    );
  }

  return (
    <AppLayout
      titel="Mailing"
      kruimel="Overzicht / Mailing"
      onderschrift="Je mail, de aankondigingen per wasdag, en wat er terugkomt."
    >
      <Tabs value={blad} onValueChange={(v) => setBlad(v as typeof blad)}>
        <TabsList className="mb-4">
          {toonPostvak && <TabsTrigger value="postvak">Postvak</TabsTrigger>}
          {toonPostvak && <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>}
          {toonVersturen && <TabsTrigger value="opstellen">Opstellen</TabsTrigger>}
          {toonVersturen && <TabsTrigger value="verstuurd">Verstuurd</TabsTrigger>}
          {/* Het rapport ziet alleen de eigenaar (RLS); een medewerker zou hier
              een altijd lege lijst zien. */}
          {toonRapport && <TabsTrigger value="rapport">Rapport</TabsTrigger>}
          {toonRapport && <TabsTrigger value="dagrapport">Dagrapport</TabsTrigger>}
        </TabsList>

        {toonPostvak && (
          <TabsContent value="postvak">
            <Postvak onAankondigen={toonVersturen ? () => setBlad("opstellen") : undefined} />
          </TabsContent>
        )}
        {toonPostvak && (
          <TabsContent value="whatsapp">
            <WhatsAppGesprekken />
          </TabsContent>
        )}
        {toonVersturen && (
          <TabsContent value="opstellen">
            <Opstellen beginDag={dag} />
          </TabsContent>
        )}
        {toonVersturen && (
          <TabsContent value="verstuurd">
            <Verstuurd />
          </TabsContent>
        )}
        {toonRapport && (
          <TabsContent value="dagrapport">
            <Dagrapporten />
          </TabsContent>
        )}
        {toonRapport && (
          <TabsContent value="rapport">
            <Rapport />
          </TabsContent>
        )}
      </Tabs>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------
// Opstellen
// ---------------------------------------------------------------------

function Opstellen({ beginDag }: { beginDag?: string | undefined }) {
  const bevestig = useBevestig();
  const [datum, setDatum] = useState(beginDag ?? vandaag());
  const [onderwerp, setOnderwerp] = useState("Morgen wassen wij uw ramen");
  const [tekst, setTekst] = useState(VOORBEELDTEKST);
  const [bezig, setBezig] = useState(false);
  const { employee: ik } = useAuth();
  // WhatsApp erbij, als het gekoppeld is.
  const koppeling = useQuery({ queryKey: ["whatsapp-koppeling"], queryFn: fetchWhatsAppKoppeling });
  const waAan = !!koppeling.data && koppeling.data.status !== "uit";
  const [kanaalKeuze, setKanaal] = useState<AankondigKanaal>("voorkeur");
  const kanaal: AankondigKanaal = waAan ? kanaalKeuze : "mail";
  const sjablonen = useQuery({
    queryKey: ["wa-sjablonen"],
    queryFn: fetchSjablonen,
    enabled: waAan,
  });
  const goedgekeurd = (sjablonen.data ?? []).filter((x) => x.status === "goedgekeurd");
  const [sjabloonId, setSjabloonId] = useState("");
  const sjabloon = goedgekeurd.find((x) => x.id === sjabloonId) ?? null;
  const [proefTelefoon, setProefTelefoon] = useState("");
  // Naar welk adres een proef gaat. Onthouden in deze browser: wie een keer
  // zijn Hotmail invult, wil daar de volgende keer weer naartoe.
  const [proefNaar, setProefNaar] = useState("");
  useEffect(() => {
    try {
      setProefNaar(localStorage.getItem("proef-naar") ?? "");
      setProefTelefoon(localStorage.getItem("proef-telefoon") ?? "");
    } catch {
      // Geen opslag: dan gaat de proef gewoon naar jezelf.
    }
  }, []);

  // De ingeplande dagen van de komende weken, om uit te kiezen. Achteruit
  // kijken heeft hier geen zin: een aankondiging voor gisteren bestaat niet.
  const tot = useMemo(() => {
    const d = new Date(`${vandaag()}T12:00:00`);
    d.setDate(d.getDate() + 45);
    return datumSleutel(d);
  }, []);
  const dagen = useQuery({
    queryKey: ["wasdagen-vooruit", tot],
    queryFn: () => fetchWasdagen(vandaag(), tot),
  });

  const perDag = useMemo(() => {
    const telling = new Map<string, number>();
    for (const r of dagen.data ?? []) {
      telling.set(r.datum, (telling.get(r.datum) ?? 0) + 1);
    }
    return [...telling.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [dagen.data]);

  // De telling komt van de server, want die bouwt straks ook de echte lijst.
  const telling = useQuery({
    queryKey: ["mail-telling", datum, kanaal, sjabloonId],
    queryFn: () => telOntvangers(datum, kanaal, sjabloonId),
    enabled: !!datum,
  });

  const aantal = telling.data?.aantal ?? 0;
  const aantalWa = telling.data?.aantalWhatsApp ?? 0;
  const metMail = kanaal !== "whatsapp";
  const metWa = kanaal !== "mail";
  const mailKlaar = !metMail || (onderwerp.trim().length > 0 && tekst.trim().length > 0);
  const waKlaar = !metWa || !!sjabloon || aantalWa === 0;
  const klaar = mailKlaar && waKlaar;
  const totaal = aantal + (sjabloon ? aantalWa : 0);

  async function verstuur(test: boolean) {
    if (!klaar) {
      toast.error(
        !mailKlaar
          ? "Vul een onderwerp en een tekst in."
          : "Kies een goedgekeurd WhatsApp-sjabloon.",
      );
      return;
    }
    if (!test) {
      const delen = [
        aantal > 0 ? `${aantal} ${aantal === 1 ? "mail" : "mails"}` : "",
        sjabloon && aantalWa > 0
          ? `${aantalWa} ${aantalWa === 1 ? "WhatsApp-bericht" : "WhatsApp-berichten"}`
          : "",
      ].filter(Boolean);
      const ja = await bevestig({
        titel: `${delen.join(" en ")} versturen?`,
        tekst: `De aankondiging voor ${toonDatum(datum)} gaat de deur uit. Dit kun je niet terugnemen.`,
        bevestigLabel: "Versturen",
      });
      if (!ja) return;
    }
    setBezig(true);
    try {
      const naar = proefNaar.trim();
      const uit = await verstuurAankondiging({
        datum,
        onderwerp,
        tekst,
        test,
        kanaal,
        ...(sjabloon ? { sjabloonId: sjabloon.id } : {}),
        ...(test && naar ? { proefNaar: naar } : {}),
        ...(test && sjabloon && proefTelefoon.trim()
          ? { proefTelefoon: proefTelefoon.trim() }
          : {}),
      });
      const samen = [
        uit.verstuurd > 0 ? `${uit.verstuurd} ${uit.verstuurd === 1 ? "mail" : "mails"}` : "",
        uit.verstuurdWhatsApp > 0 ? `${uit.verstuurdWhatsApp} WhatsApp` : "",
      ]
        .filter(Boolean)
        .join(" en ");
      if (test && uit.mislukt > 0) {
        toast.error(`Proef lukte niet. ${uit.eersteFout}`.trim());
      } else if (test) {
        toast.success(`Proef verstuurd: ${samen || "niets"}.`);
      } else if (uit.mislukt > 0) {
        toast.warning(
          `${samen || "Niets"} verstuurd, ${uit.mislukt} mislukt. ${uit.eersteFout}`.trim(),
        );
      } else {
        toast.success(`${samen} onderweg.`);
      }
    } catch (e) {
      toast.error("Versturen mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Kaart titel="Welke dag">
          {perDag.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Er staat de komende weken nog niets ingepland.{" "}
              <Link to="/planning" className="underline">
                Naar de planning
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {perDag.map(([d, n]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDatum(d)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                    d === datum
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card hover:bg-card/70"
                  }`}
                >
                  {toonDatum(d)}
                  <span className="ml-1.5 opacity-60 tabular-nums">{n}</span>
                </button>
              ))}
            </div>
          )}
        </Kaart>

        {waAan && (
          <Kaart titel="Waarlangs">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["voorkeur", "Zoals bij elke klant ingesteld"],
                  ["mail", "Mail"],
                  ["whatsapp", "WhatsApp"],
                  ["beide", "Mail én WhatsApp"],
                ] as [AankondigKanaal, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKanaal(k)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                    k === kanaal
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card hover:bg-card/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Bij "zoals ingesteld" krijgt een klant die WhatsApp wil maar het niet kan krijgen
              (geen 06-nummer, geen toestemming) gewoon een mail.
            </p>
          </Kaart>
        )}

        {metWa && (
          <Kaart titel="WhatsApp-bericht">
            {goedgekeurd.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Er is nog geen goedgekeurd sjabloon. Maak er een bij{" "}
                <Link to="/instellingen" search={{ tab: "mail" }} className="underline">
                  Instellingen → mail → WhatsApp
                </Link>
                .
              </p>
            ) : (
              <>
                <select
                  aria-label="WhatsApp-sjabloon"
                  value={sjabloonId}
                  onChange={(e) => setSjabloonId(e.target.value)}
                  className="h-9 w-full rounded-[10px] border border-input bg-background px-2 text-[13px]"
                >
                  <option value="">Kies een sjabloon…</option>
                  {goedgekeurd.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.titel}
                      {x.categorie === "marketing" ? " (nieuws en acties)" : ""}
                    </option>
                  ))}
                </select>
                {sjabloon && (
                  <p className="mt-2 whitespace-pre-wrap rounded-[12px] bg-muted/60 px-3 py-2 text-[13px]">
                    {sjabloon.tekst.replaceAll("{datum}", datumVoluit(datum))}
                  </p>
                )}
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {"{naam}"}, {"{adres}"} en {"{datum}"} vult Wooshy per klant in.
                  {sjabloon?.categorie === "marketing" &&
                    " Nieuws en acties gaan alleen naar klanten die daar apart ja op zeiden."}
                </p>
              </>
            )}
          </Kaart>
        )}

        {metMail && (
          <Kaart titel="Het bericht">
            <label className="block text-[12px] font-medium text-muted-foreground">Onderwerp</label>
            <Input
              value={onderwerp}
              onChange={(e) => setOnderwerp(e.target.value)}
              maxLength={200}
              className="mt-1"
            />
            <label className="mt-3 block text-[12px] font-medium text-muted-foreground">
              Tekst
            </label>
            <Textarea
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              rows={14}
              className="mt-1 font-[inherit] text-[13.5px] leading-relaxed"
            />
            <p className="mt-2 text-[12px] text-muted-foreground">
              <code className="rounded bg-muted px-1">{"{{naam}}"}</code> wordt de naam van de
              klant, <code className="rounded bg-muted px-1">{"{{adres}}"}</code> zijn adres — of
              zijn adressen, als hij er die dag meer heeft.
            </p>
          </Kaart>
        )}
      </div>

      <div className="space-y-4">
        <Afzenderkaart />

        <Kaart titel="Naar wie">
          {telling.isLoading ? (
            <p className="text-[13px] text-muted-foreground">Bezig met tellen…</p>
          ) : telling.isError ? (
            <p className="text-[13px] text-tint-oranje-ink">
              Tellen lukte niet. Staat de Edge Function er al op?
            </p>
          ) : (
            <>
              {metMail && (
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-[28px] font-bold tabular-nums">{aantal}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {aantal === 1 ? "mail" : "mails"}
                  </span>
                </p>
              )}
              {metWa && (
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-[28px] font-bold tabular-nums">
                    {aantalWa}
                  </span>
                  <span className="text-[13px] text-muted-foreground">via WhatsApp</span>
                </p>
              )}
              {metWa && (telling.data?.zonderWhatsApp ?? 0) > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tint-amber-ink" />
                  {telling.data?.zonderWhatsApp} klanten willen WhatsApp maar kunnen het niet
                  krijgen (geen 06-nummer, geen toestemming of afgemeld)
                  {kanaal === "voorkeur" ? "; die krijgen een mail als dat kan" : ""}.
                </p>
              )}
              {metMail && (telling.data?.zonderEmail ?? 0) > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tint-amber-ink" />
                  {telling.data?.zonderEmail} adressen op deze dag hebben geen e-mailadres.
                </p>
              )}
              {(telling.data?.voorbeeld.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
                  {telling.data?.voorbeeld.map((v) => (
                    <li key={v.email} className="truncate">
                      {v.naam || v.email} · {v.adressen.join(", ")}
                    </li>
                  ))}
                  {aantal > (telling.data?.voorbeeld.length ?? 0) && (
                    <li className="opacity-70">
                      en nog {aantal - (telling.data?.voorbeeld.length ?? 0)}…
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </Kaart>

        <div className="space-y-2">
          <label
            className="block text-[12px] font-medium text-muted-foreground"
            htmlFor="proef-naar"
          >
            Proef naar
          </label>
          <Input
            id="proef-naar"
            type="email"
            inputMode="email"
            value={proefNaar}
            onChange={(e) => {
              setProefNaar(e.target.value);
              // Meteen onthouden: ook als je even een ander tabblad opent.
              try {
                localStorage.setItem("proef-naar", e.target.value.trim());
              } catch {
                // Niet kunnen onthouden is geen probleem.
              }
            }}
            placeholder={ik?.email ?? "jouw mailadres"}
            maxLength={254}
          />
          {metWa && (
            <>
              <label
                className="block text-[12px] font-medium text-muted-foreground"
                htmlFor="proef-telefoon"
              >
                WhatsApp-proef naar
              </label>
              <Input
                id="proef-telefoon"
                type="tel"
                inputMode="tel"
                value={proefTelefoon}
                onChange={(e) => {
                  setProefTelefoon(e.target.value);
                  try {
                    localStorage.setItem("proef-telefoon", e.target.value.trim());
                  } catch {
                    // Niet kunnen onthouden is geen probleem.
                  }
                }}
                placeholder="06-nummer (bij het testnummer: een testontvanger)"
                maxLength={20}
              />
            </>
          )}
          <Button
            variant="outline"
            className="w-full rounded-full"
            disabled={bezig || !klaar}
            onClick={() => void verstuur(true)}
          >
            <MailCheck className="size-4" /> Proef versturen
          </Button>
          <Button
            className="w-full rounded-full"
            disabled={bezig || !klaar || totaal === 0}
            onClick={() => void verstuur(false)}
          >
            <Send className="size-4" />
            {totaal === 0 ? "Niemand om te bereiken" : `Versturen naar ${totaal}`}
          </Button>
          <p className="text-center text-[11.5px] text-muted-foreground">
            Stuur eerst een proef. Die gaat alleen naar het adres{metWa ? " en het nummer" : ""}{" "}
            hierboven
            {metMail ? ", of leeg naar jezelf" : ""}.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Van wie de mail komt. Staat op deze pagina en niet bij Instellingen: je ziet
 * het hier op het moment dat het ertoe doet, vlak voor je op versturen klikt.
 */
function Afzenderkaart() {
  const { company } = useAuth();
  const qc = useQueryClient();
  const afzender = useQuery({ queryKey: ["mail-afzender"], queryFn: fetchAfzender });
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!afzender.data) return;
    setNaam(afzender.data.naam);
    setEmail(afzender.data.email);
  }, [afzender.data]);

  async function bewaar() {
    if (!company?.id) return;
    try {
      await bewaarAfzender(company.id, { naam, email });
      await qc.invalidateQueries({ queryKey: ["mail-afzender"] });
      setOpen(false);
      toast.success("Afzender opgeslagen.");
    } catch (e) {
      toast.error("Opslaan mislukte: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const ingesteld = (afzender.data?.email ?? "").trim();

  return (
    <Kaart titel="Afzender">
      {open ? (
        <div className="space-y-2">
          <Input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="De Ramensopperij"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="info@deramensopperij.nl"
            inputMode="email"
          />
          <div className="flex gap-2">
            <Button size="sm" className="rounded-full" onClick={() => void bewaar()}>
              Opslaan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Annuleren
            </Button>
          </div>
        </div>
      ) : ingesteld ? (
        <p className="text-[13px]">
          {afzender.data?.naam}
          <br />
          <span className="text-muted-foreground">{ingesteld}</span>
          <button
            type="button"
            className="ml-2 text-[12px] underline"
            onClick={() => setOpen(true)}
          >
            wijzigen
          </button>
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Nog geen afzender.{" "}
          <button type="button" className="underline" onClick={() => setOpen(true)}>
            Instellen
          </button>
        </p>
      )}
      <Verbindingscontrole />
    </Kaart>
  );
}

/**
 * "Kan ik versturen?" — in gewone taal, en gevraagd aan Brevo zelf.
 *
 * Staat hier en niet in een handleiding, want dit is precies de plek waar je
 * het je afvraagt. Elke regel is een ding dat kapot kan zijn, met erbij wat
 * je eraan doet; een enkel groen vinkje zou niet zeggen wélk deel klopt.
 */
function Verbindingscontrole() {
  const [uitslag, setUitslag] = useState<Controle | null>(null);
  const [bezig, setBezig] = useState(false);

  async function kijk() {
    setBezig(true);
    try {
      setUitslag(await controleerVerbinding());
    } catch (e) {
      toast.error("Controleren lukte niet: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <Button
        size="sm"
        variant="outline"
        className="w-full rounded-full"
        disabled={bezig}
        onClick={() => void kijk()}
      >
        <ShieldCheck className="size-4" /> {bezig ? "Bezig…" : "Controleer verbinding"}
      </Button>

      {uitslag && (
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          <Regel
            goed={uitslag.sleutel}
            goedTekst={`Brevo werkt${uitslag.account ? ` (${uitslag.account})` : ""}`}
            foutTekst={uitslag.melding || "Brevo herkent de sleutel niet"}
          />
          <Regel
            goed={uitslag.afzenderBekend && uitslag.afzenderActief}
            goedTekst={`${uitslag.afzenderIngevuld} mag versturen`}
            foutTekst={
              !uitslag.sleutel
                ? "Afzender nog niet te controleren"
                : uitslag.afzenderBekend
                  ? `${uitslag.afzenderIngevuld} is bij Brevo nog niet goedgekeurd`
                  : `${uitslag.afzenderIngevuld} staat niet bij Brevo als afzender`
            }
          />
          <Regel
            goed={uitslag.afzenderPastBijMailbox}
            goedTekst={`${uitslag.afzenderIngevuld} hoort bij je gekoppelde mailbox`}
            foutTekst={
              uitslag.mailboxDomein
                ? `De afzender moet eindigen op @${uitslag.mailboxDomein}, het domein van je gekoppelde mailbox`
                : "Koppel eerst je mailbox bij Instellingen → mail; pas dan mag je versturen"
            }
          />
          {uitslag.sleutel &&
            !uitslag.afzenderBekend &&
            (uitslag.bekendeAfzenders?.length ?? 0) > 0 && (
              <li className="pt-1 text-[12px] text-muted-foreground">
                Brevo kent wel: {uitslag.bekendeAfzenders?.join(", ")}
              </li>
            )}
        </ul>
      )}
    </div>
  );
}

/** Eén regel van de controle: een vinkje als het klopt, anders een kruis. */
function Regel({
  goed,
  goedTekst,
  foutTekst,
}: {
  goed: boolean;
  goedTekst: string;
  foutTekst: string;
}) {
  return (
    <li className="flex items-start gap-1.5">
      {goed ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-tint-groen-ink" />
      ) : (
        <X className="mt-0.5 size-3.5 shrink-0 text-tint-oranje-ink" />
      )}
      <span className={goed ? "" : "text-muted-foreground"}>{goed ? goedTekst : foutTekst}</span>
    </li>
  );
}

/**
 * Alles wat er op grond van een mail is aangepast, automatisch of met de hand.
 * Elke regel is terug te draaien, en een teruggedraaide regel blijft staan:
 * een rapport waar dingen uit verdwijnen is geen rapport.
 */
function Rapport() {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const lijst = useQuery({ queryKey: ["mail-wijzigingen"], queryFn: fetchWijzigingen });
  const [bezig, setBezig] = useState<string | null>(null);

  async function terug(w: Wijziging) {
    const ja = await bevestig({
      titel: "Terugdraaien?",
      tekst:
        w.soort === "whatsapp_afgemeld"
          ? `${w.klant} krijgt dan weer WhatsApp-berichten.`
          : w.soort === "stoppen"
            ? `${w.adres} komt terug uit de prullenbak en staat weer op de planning.`
            : `${w.adres} slaat ${w.maanden.map(toonMaand).join(" en ")} dan niet meer over, en staat weer op de planning.`,
      bevestigLabel: "Terugdraaien",
    });
    if (!ja) return;
    setBezig(w.id);
    try {
      await draaiWijzigingTerug(w.id);
      toast.success("Teruggedraaid.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mail-wijzigingen"] }),
        qc.invalidateQueries({ queryKey: ["customers"] }),
        qc.invalidateQueries({ queryKey: ["bericht"] }),
        qc.invalidateQueries({ queryKey: ["berichten"] }),
        qc.invalidateQueries({ queryKey: ["prullenbak"] }),
      ]);
    } catch (e) {
      toast.error("Terugdraaien mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(null);
    }
  }

  if (lijst.isLoading) return <Leeg tekst="Bezig met ophalen…" />;
  const rijen = lijst.data ?? [];
  if (rijen.length === 0) {
    return (
      <Leeg tekst="Nog niets aangepast. Zodra de assistent of jij een voorstel doorvoert, staat het hier." />
    );
  }

  return (
    <div className="space-y-2">
      {rijen.map((w) => (
        <article
          key={w.id}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] border border-border bg-card px-4 py-3 shadow-card ${
            w.teruggedraaid_op ? "opacity-60" : ""
          }`}
        >
          <span className="text-[13.5px] font-semibold">{w.adres || w.klant || "Adres"}</span>
          {w.klant && <span className="text-[12.5px] text-muted-foreground">{w.klant}</span>}
          <span className="text-[13px]">
            {w.soort === "stoppen"
              ? "gestopt als klant"
              : w.soort === "aanmelding"
                ? "aanmelding klaargezet"
                : w.soort === "klant_email"
                  ? "mailadres gekoppeld"
                  : w.soort === "whatsapp_afgemeld"
                    ? "wil geen WhatsApp meer"
                    : `slaat ${w.maanden.map(toonMaand).join(" en ")} over`}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              w.automatisch ? "bg-tint-blauw text-tint-blauw-ink" : "bg-muted text-muted-foreground"
            }`}
          >
            {w.automatisch
              ? `automatisch${w.zekerheid != null ? ` · ${Math.round(w.zekerheid * 100)}% zeker` : ""}`
              : "met de hand"}
          </span>
          <span className="ml-auto">
            {w.teruggedraaid_op ? (
              <span className="text-[12px] text-muted-foreground">teruggedraaid</span>
            ) : w.soort !== "overslaan" &&
              w.soort !== "stoppen" &&
              w.soort !== "whatsapp_afgemeld" ? null : (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={bezig === w.id}
                onClick={() => void terug(w)}
              >
                <Undo2 className="size-4" /> Terugdraaien
              </Button>
            )}
          </span>
          <span className="w-full text-[12px] text-muted-foreground">
            {new Date(w.created_at).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </article>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Verstuurd
// ---------------------------------------------------------------------

function Verstuurd() {
  const mailingen = useQuery({ queryKey: ["mailingen"], queryFn: fetchMailingen });
  const lijst = mailingen.data ?? [];

  if (mailingen.isLoading) return <Leeg tekst="Bezig met ophalen…" />;
  if (lijst.length === 0) return <Leeg tekst="Er is nog niets verstuurd." />;

  return (
    <div className="space-y-2">
      {lijst.map((m) => (
        <article
          key={m.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] border border-border bg-card px-4 py-3 shadow-card"
        >
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[13.5px] font-semibold">{m.onderwerp}</span>
          {m.test && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              proef
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <Users className="size-3.5" />
            <span className="tabular-nums">{m.aantal}</span>
            {m.mislukt > 0 && <span className="text-tint-oranje-ink">({m.mislukt} mislukt)</span>}
          </span>
          <span className="w-full text-[12px] text-muted-foreground">
            {m.datum ? `voor ${toonDatum(m.datum)} · ` : ""}
            verstuurd op{" "}
            {new Date(m.created_at).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </article>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------

function Kaart({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {titel}
      </h2>
      {children}
    </section>
  );
}

function Leeg({ tekst }: { tekst: string }) {
  return (
    <p className="rounded-[18px] border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
      {tekst}
    </p>
  );
}
