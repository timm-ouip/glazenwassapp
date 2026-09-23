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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
  IconBrandWhatsapp as WhatsApp,
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
import { WhatsAppGesprekken } from "@/components/whatsapp/WhatsAppGesprekken";
import { fetchMappen } from "@/lib/mailbox";
import { fetchGesprekken } from "@/lib/whatsapp";
import { datumVoluit, fetchSjablonen, fetchWhatsAppKoppeling } from "@/lib/whatsapp";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  toonMaand,
} from "@/lib/klanten";
import { datumSleutel, fetchWasdag, fetchWasdagen, toonDatum, vandaag } from "@/lib/wasdag";
import { fetchKlussen } from "@/lib/klussen";
import { fetchDagPloegen } from "@/lib/ploegen";
import { usePlanningInstellingen } from "@/lib/planninginstellingen";
import { klussenVanDag, maakBouwstenen, maandVan, tijdvakkenVoorDag } from "@/lib/dagbouwstenen";
import { fetchSjablonen as fetchBerichtSjablonen, standaardVan } from "@/lib/sjablonen";
import {
  bewaarAfzender,
  controleerVerbinding,
  fetchAfzender,
  draaiWijzigingTerug,
  fetchWijzigingen,
  type Wijziging,
  fetchMailingen,
  telOntvangers,
  telWijziging,
  verstuurAankondiging,
  verstuurWijziging,
  AlVerstuurdFout,
  type AankondigKanaal,
  type Controle,
} from "@/lib/mailing";
import { MAIL_BLADEN, MAIL_BLADNAAM, type MailBlad, type MailKanaal } from "@/lib/mailbladen";
import { heeftRecht } from "@/lib/rechten";
import { kwamAan, perAdres, useAankondigingen } from "@/lib/aankondigingen";
import { telAdressen } from "@/lib/overslaan-keuze";

interface MailingSearch {
  /** De dag die al gekozen is, bijvoorbeeld vanaf de planningspagina. */
  dag?: string;
  /** Welk blad je bekijkt; het menu zet hem in het webadres. */
  blad?: MailBlad;
}

export const Route = createFileRoute("/mailing")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): MailingSearch => {
    const blad = String(search["blad"] ?? "");
    return {
      ...(typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
        ? { dag: search["dag"] }
        : {}),
      ...((MAIL_BLADEN as readonly string[]).includes(blad) ? { blad: blad as MailBlad } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Mailing — Paaltje Systems" },
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

/** Welk kanaal je het laatst koos. Wie per klant werkt, wil dat morgen weer. */
const KANAAL_OPSLAG = "wooshy.mail-kanaal";

function leesKanaal(): MailKanaal {
  try {
    const k = typeof window === "undefined" ? null : localStorage.getItem(KANAAL_OPSLAG);
    return k === "postvak" || k === "whatsapp" || k === "samen" ? k : "samen";
  } catch {
    return "samen";
  }
}

function Mailing() {
  useRequireAuth();
  const { dag, blad: gevraagd } = Route.useSearch();
  const navigate = useNavigate();
  const { employee } = useAuth();
  // Lezen: het postvak. Versturen: aankondigen en wat er verstuurd is. Het
  // rapport en het dagrapport blijven bij de eigenaar.
  const toonPostvak = heeftRecht(employee, "mail_lezen");
  const toonVersturen = heeftRecht(employee, "mail_versturen");
  const toonRapport = employee?.rol === "eigenaar";
  const mag: Record<MailBlad, boolean> = {
    postvak: toonPostvak,
    opstellen: toonVersturen,
    verstuurd: toonVersturen,
    dagrapport: toonRapport,
    rapport: toonRapport,
  };
  // Kom je vanaf de planning met een dag mee, dan wil je aankondigen.
  const startBlad: MailBlad = (dag && toonVersturen) || !toonPostvak ? "opstellen" : "postvak";
  // Het blad staat in het webadres, want het menu zet de tabbladen neer. Mag
  // je een blad niet zien, dan kijk je naar je eigen startblad.
  const blad: MailBlad = gevraagd && mag[gevraagd] ? gevraagd : startBlad;
  const naarBlad = (b: MailBlad) =>
    void navigate({
      to: "/mailing",
      search: (oud: MailingSearch) => ({ ...oud, blad: b }),
      replace: true,
    });

  const mobiel = useIsMobile();
  // Gesprekken zijn per klant; wie geen klanten mag zien, heeft daar niets aan.
  const toonGesprekken = ["klanten_bekijken", "klanten_bewerken", "planning"].some((r) =>
    heeftRecht(employee, r as Parameters<typeof heeftRecht>[1]),
  );
  // Meteen bij het aanmaken lezen: anders haalt Gesprekken eerst al zijn
  // lijsten op en springt hij daarna pas naar het postvak.
  const [gekozenKanaal, setKanaal] = useState<MailKanaal>(leesKanaal);
  const kanaal: MailKanaal = toonGesprekken ? gekozenKanaal : "postvak";
  function kiesKanaal(k: MailKanaal) {
    setKanaal(k);
    if (blad !== "postvak") naarBlad("postvak");
    try {
      localStorage.setItem(KANAAL_OPSLAG, k);
    } catch {
      // Niet kunnen onthouden is geen reden om niet te wisselen.
    }
  }

  // De tellertjes achter de kanalen. Allebei dezelfde sleutel als de lijsten
  // zelf gebruiken, dus dit kost geen extra verkeer.
  const mappen = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: toonPostvak,
    staleTime: 60_000,
  });
  const waGesprekken = useQuery({
    queryKey: ["wa-gesprekken"],
    queryFn: fetchGesprekken,
    enabled: toonPostvak && toonGesprekken,
    staleTime: 30_000,
  });
  const ongelezenMail = (mappen.data ?? []).find((m) => m.rol === "postvak")?.ongelezen ?? 0;
  const ongelezenWa = (waGesprekken.data ?? []).reduce((t, g) => t + g.ongelezen, 0);

  const kiezer = (richting: "kolom" | "rij") =>
    toonGesprekken ? (
      <KanaalKiezer
        kanaal={kanaal}
        richting={richting}
        ongelezenMail={ongelezenMail}
        ongelezenWa={ongelezenWa}
        onKies={kiesKanaal}
      />
    ) : null;

  /** Wat er onder het gekozen kanaal hoort te staan. */
  const postvakInhoud = (kanaalKiezer: ReactNode) =>
    kanaal === "postvak" ? (
      <Postvak
        kanaalKiezer={kanaalKiezer}
        onAankondigen={toonVersturen ? () => naarBlad("opstellen") : undefined}
      />
    ) : (
      <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
        {/* Ook op een tablet in de lengte: daar telt de app je niet als
            telefoon, en zonder dit blokje kom je niet meer terug bij je mail. */}
        {kanaalKiezer}
        {kanaal === "whatsapp" ? <WhatsAppGesprekken /> : <Gesprekken />}
      </div>
    );

  if (mobiel && toonPostvak) {
    const extra = blad !== "postvak";
    return (
      <AppLayout titel="Mail">
        {extra ? (
          <>
            <button
              type="button"
              onClick={() => naarBlad("postvak")}
              className="mb-3 flex items-center gap-1.5 text-[14px] font-medium"
            >
              <ArrowLeft className="size-5" /> {MAIL_BLADNAAM[blad]}
            </button>
            {blad === "opstellen" && <Opstellen beginDag={dag} />}
            {blad === "verstuurd" && <Verstuurd />}
            {blad === "dagrapport" && <Dagrapporten />}
            {blad === "rapport" && <Rapport />}
          </>
        ) : (
          <>
            <div className="mb-3">{kiezer("rij")}</div>
            {postvakInhoud(null)}
          </>
        )}
      </AppLayout>
    );
  }

  return (
    <AppLayout
      titel={`Mail · ${MAIL_BLADNAAM[blad]}`}
      onderschrift="Je mail, de aankondigingen per wasdag, en wat er terugkomt."
    >
      {blad === "postvak" && toonPostvak && postvakInhoud(kiezer("kolom"))}
      {blad === "opstellen" && toonVersturen && <Opstellen beginDag={dag} />}
      {blad === "verstuurd" && toonVersturen && <Verstuurd />}
      {blad === "dagrapport" && toonRapport && <Dagrapporten />}
      {blad === "rapport" && toonRapport && <Rapport />}
    </AppLayout>
  );
}

/**
 * De kanalen: gewone mail, appjes, of allebei door elkaar per klant.
 *
 * Op de computer een blokje bovenin de mappenkolom, op de telefoon dezelfde
 * drie als een pil boven de lijst. Achter Postvak en Appjes staat hoeveel er
 * ongelezen is; bij Samen niet, want dat is die twee bij elkaar.
 */
function KanaalKiezer({
  kanaal,
  richting,
  ongelezenMail,
  ongelezenWa,
  onKies,
}: {
  kanaal: MailKanaal;
  richting: "kolom" | "rij";
  ongelezenMail: number;
  ongelezenWa: number;
  onKies: (k: MailKanaal) => void;
}) {
  const kanalen = [
    { k: "postvak" as const, icoon: Inbox, label: "Postvak", aantal: ongelezenMail },
    { k: "whatsapp" as const, icoon: WhatsApp, label: "Appjes", aantal: ongelezenWa },
    { k: "samen" as const, icoon: Messages, label: "Samen", aantal: 0 },
  ];
  const kolom = richting === "kolom";
  return (
    <div
      className={`flex bg-card shadow-card ${
        kolom ? "flex-col gap-0.5 rounded-[18px] p-1.5" : "gap-0.5 rounded-full p-[3px]"
      }`}
    >
      {kanalen.map(({ k, icoon: Icoon, label, aantal }) => {
        const aan = kanaal === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={aan}
            onClick={() => onKies(k)}
            className={`flex items-center transition-colors ${
              kolom
                ? "gap-2.5 rounded-[12px] px-2.5 py-2 text-[13.5px]"
                : "flex-1 justify-center gap-1.5 rounded-full py-1.5 text-[14px]"
            } ${
              aan
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icoon
              className={`size-[18px] shrink-0 ${
                k === "whatsapp" && !aan ? "text-tint-groen-mid" : ""
              }`}
            />
            {label}
            {aantal > 0 && (
              <span
                className={`${kolom ? "ml-auto" : ""} rounded-full px-1.5 text-[11px] font-semibold ${
                  aan ? "bg-primary-foreground/20" : "bg-tint-rood text-tint-rood-ink"
                }`}
              >
                {aantal}
              </span>
            )}
          </button>
        );
      })}
    </div>
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
  /** Welk sjabloon je gekozen hebt; leeg tot ze geladen zijn. */
  const [berichtSjabloon, setBerichtSjabloon] = useState("");
  const berichtSjablonen = useQuery({
    queryKey: ["bericht-sjablonen"],
    queryFn: fetchBerichtSjablonen,
  });
  const aankondigingen = useMemo(
    () => (berichtSjablonen.data ?? []).filter((x) => x.soort === "aankondiging"),
    [berichtSjablonen.data],
  );
  // De standaardtekst staat er meteen in; kies je een ander sjabloon, dan
  // vervangt dat wat je nog niet zelf hebt aangepast.
  const [zelfGetypt, setZelfGetypt] = useState(false);
  useEffect(() => {
    if (zelfGetypt || aankondigingen.length === 0) return;
    const standaard = standaardVan(berichtSjablonen.data ?? [], "aankondiging");
    if (!standaard) return;
    setBerichtSjabloon(standaard.id);
    setOnderwerp(standaard.onderwerp || "Morgen wassen wij uw ramen");
    setTekst(standaard.tekst);
  }, [aankondigingen.length, berichtSjablonen.data, zelfGetypt]);
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

  // Het tijdvak dat grote panden beloofd krijgen: alleen als die instelling
  // aanstaat, en met dezelfde rekenkern als de dagweergave.
  const planInstellingen = usePlanningInstellingen();
  const metTijdvak = planInstellingen.tijdlijn && planInstellingen.tijdvakMailen;
  const adressenVoorTijd = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
    enabled: metTijdvak,
  });
  const stratenVoorTijd = useQuery({
    queryKey: ["streets"],
    queryFn: fetchStreets,
    enabled: metTijdvak,
  });
  const wijkenVoorTijd = useQuery({
    queryKey: ["districts"],
    queryFn: fetchDistricts,
    enabled: metTijdvak,
  });
  const wasdagVoorTijd = useQuery({
    queryKey: ["wasdag", datum],
    queryFn: () => fetchWasdag(datum),
    enabled: metTijdvak,
  });
  const klussenVoorTijd = useQuery({
    queryKey: ["klussen", datum, datum],
    queryFn: () => fetchKlussen(datum, datum),
    enabled: metTijdvak,
  });
  const ploegenVoorTijd = useQuery({
    queryKey: ["dag-ploegen", datum, datum],
    queryFn: () => fetchDagPloegen(datum, datum),
    enabled: metTijdvak,
  });

  const tijdvakken = useMemo(() => {
    if (!metTijdvak) return {};
    const bouwstenen = maakBouwstenen(
      adressenVoorTijd.data ?? [],
      stratenVoorTijd.data ?? [],
      wijkenVoorTijd.data ?? [],
      maandVan(datum),
      planInstellingen,
    );
    const regels = (wasdagVoorTijd.data ?? [])
      .filter((r) => r.customer_id)
      .map((r) => ({
        customer_id: r.customer_id!,
        ploeg_nr: r.ploeg_nr ?? null,
        volgorde: r.volgorde ?? null,
        rest: r.rest ?? false,
        vaste_start: r.vaste_start ?? null,
      }));
    return tijdvakkenVoorDag(
      regels,
      klussenVanDag(klussenVoorTijd.data ?? [], datum),
      bouwstenen,
      ploegenVoorTijd.data?.get(datum) ?? [],
      planInstellingen,
    );
  }, [
    metTijdvak,
    adressenVoorTijd.data,
    stratenVoorTijd.data,
    wijkenVoorTijd.data,
    wasdagVoorTijd.data,
    klussenVoorTijd.data,
    ploegenVoorTijd.data,
    datum,
    planInstellingen,
  ]);
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
  // Ligt de gekozen dag (bijvoorbeeld vanuit de planning) verder weg, dan
  // kijken we tot en met die dag: anders zien we niet wie er op staat.
  const bereik = datum > tot ? datum : tot;
  const dagen = useQuery({
    queryKey: ["wasdagen-vooruit", bereik],
    queryFn: () => fetchWasdagen(vandaag(), bereik),
    // Bij een andere periode de oude lijst laten staan tot de nieuwe er is.
    placeholderData: keepPreviousData,
  });

  const perDag = useMemo(() => {
    const telling = new Map<string, number>();
    for (const r of dagen.data ?? []) {
      telling.set(r.datum, (telling.get(r.datum) ?? 0) + 1);
    }
    return [...telling.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [dagen.data]);

  /**
   * Wie op deze dag al iets weet. Nieuwe adressen krijgen de planningsmail;
   * wie in een eerdere mail op een andere dag stond (die nog moet komen, en
   * waar hij niet meer op staat), krijgt een wijziging; en wie de mail voor
   * deze dag al had, krijgt hem niet nog eens — tenzij je dat aanvinkt.
   */
  const qc = useQueryClient();
  const eerdereMails = useAankondigingen(vandaag(), bereik);
  const [opnieuw, setOpnieuw] = useState(false);
  const indeling = useMemo(() => {
    const dagenVan = new Map<string, Set<string>>();
    for (const r of dagen.data ?? []) {
      if (!r.customer_id) continue;
      const lijst = dagenVan.get(r.customer_id) ?? new Set<string>();
      lijst.add(r.datum);
      dagenVan.set(r.customer_id, lijst);
    }
    // Alleen wat aankwam telt: wie een mislukte mail kreeg, weet van niets.
    const mails = perAdres((eerdereMails.data ?? []).filter(kwamAan));
    const nu = vandaag();
    const al: string[] = [];
    const verplaatst: string[] = [];
    for (const [id, opDagen] of dagenVan) {
      if (!opDagen.has(datum)) continue;
      const rijen = mails.get(id) ?? [];
      // Had hij hem voor deze dag al, met hetzelfde tijdvak (als er een beloofd
      // is)? Is dat tijdvak veranderd, dan krijgt hij de mail opnieuw, met de
      // nieuwe tijd.
      const voorDezeDag = rijen.filter((r) => r.aangekondigd_voor === datum);
      const nieuwVak = tijdvakken[id];
      const klopt = voorDezeDag.some(
        (r) =>
          !r.tijdvak_van ||
          !nieuwVak ||
          (r.tijdvak_van === nieuwVak.van && r.tijdvak_tot === nieuwVak.tot),
      );
      if (voorDezeDag.length > 0) {
        if (klopt) al.push(id);
        continue;
      }
      // Een belofte voor een dag die nog komt (en binnen wat we kunnen zien),
      // waar hij niet meer op staat: verplaatst.
      if (
        rijen.some(
          (r) =>
            r.aangekondigd_voor >= nu &&
            r.aangekondigd_voor <= bereik &&
            !opDagen.has(r.aangekondigd_voor),
        )
      )
        verplaatst.push(id);
    }
    return { al, verplaatst };
  }, [dagen.data, eerdereMails.data, datum, bereik, tijdvakken]);
  const wijzigingSjabloon = standaardVan(berichtSjablonen.data ?? [], "wijziging");

  // Wie een wijziging kan krijgen: dat zegt de server, die ze straks ook
  // verstuurt (mail, of WhatsApp als er een goedgekeurd sjabloon bij de tekst
  // hoort). Wie hij niet kan bereiken, houdt gewoon de planningsmail. Zonder
  // tekst voor een wijziging krijgt iedereen de planningsmail, zoals vroeger.
  const wijzigingTelling = useQuery({
    queryKey: [
      "wijziging-tellen",
      "wijziging",
      wijzigingSjabloon?.wa_sjabloon_id ?? "",
      indeling.verplaatst.join(","),
    ],
    queryFn: () =>
      telWijziging(indeling.verplaatst, "wijziging", wijzigingSjabloon?.wa_sjabloon_id),
    enabled: !!wijzigingSjabloon && indeling.verplaatst.length > 0,
  });
  const wijzigingen = useMemo(() => {
    if (!wijzigingSjabloon || indeling.verplaatst.length === 0) return [];
    const bereikbaar = new Set(wijzigingTelling.data?.bereikbaar ?? []);
    return indeling.verplaatst.filter((id) => bereikbaar.has(id));
  }, [wijzigingSjabloon, indeling.verplaatst, wijzigingTelling.data]);
  const aantalWijzigingen =
    wijzigingen.length > 0 && wijzigingTelling.data
      ? wijzigingTelling.data.aantal + wijzigingTelling.data.aantalWhatsApp
      : 0;
  // De tijdvakken moeten er zijn voordat we zeggen wie de mail "al had": een
  // veranderd tijdvak betekent opnieuw sturen.
  const tijdKlaar =
    !metTijdvak ||
    [
      adressenVoorTijd,
      stratenVoorTijd,
      wijkenVoorTijd,
      wasdagVoorTijd,
      klussenVoorTijd,
      ploegenVoorTijd,
    ].every((q) => q.isSuccess);
  const tijdFout =
    metTijdvak &&
    [
      adressenVoorTijd,
      stratenVoorTijd,
      wijkenVoorTijd,
      wasdagVoorTijd,
      klussenVoorTijd,
      ploegenVoorTijd,
    ].some((q) => q.isError);
  const uitsluiten = useMemo(
    () => [...wijzigingen, ...(opnieuw ? [] : indeling.al)].sort(),
    [wijzigingen, opnieuw, indeling.al],
  );

  // De telling komt van de server, want die bouwt straks ook de echte lijst.
  // Pas tellen als bekend is wie er uitvalt, anders springt het getal.
  const telling = useQuery({
    queryKey: ["mail-telling", datum, kanaal, sjabloonId, uitsluiten.join(",")],
    queryFn: () => telOntvangers(datum, kanaal, sjabloonId, uitsluiten),
    enabled:
      !!datum &&
      dagen.isSuccess &&
      eerdereMails.isSuccess &&
      tijdKlaar &&
      (!wijzigingSjabloon || indeling.verplaatst.length === 0 || wijzigingTelling.isSuccess),
  });

  const aantal = telling.data?.aantal ?? 0;
  const aantalWa = telling.data?.aantalWhatsApp ?? 0;
  const metMail = kanaal !== "whatsapp";
  const metWa = kanaal !== "mail";
  const mailKlaar = !metMail || (onderwerp.trim().length > 0 && tekst.trim().length > 0);
  const waKlaar = !metWa || !!sjabloon || aantalWa === 0;
  const klaar = mailKlaar && waKlaar;
  const planningsmails = aantal + (sjabloon ? aantalWa : 0);
  const totaal = planningsmails + aantalWijzigingen;
  // Pas versturen als vaststaat wie wat krijgt: anders gaat bij een halve
  // telling misschien alleen de helft de deur uit.
  const geteld =
    telling.isSuccess &&
    !telling.isPlaceholderData &&
    eerdereMails.isSuccess &&
    tijdKlaar &&
    (!wijzigingSjabloon || indeling.verplaatst.length === 0 || wijzigingTelling.isSuccess);

  /** De verplaatste klanten een wijziging, met de standaardtekst daarvoor. */
  async function stuurWijzigingen(toch = false): Promise<void> {
    if (!wijzigingSjabloon || wijzigingen.length === 0) return;
    try {
      const uit = await verstuurWijziging({
        customerIds: wijzigingen,
        soort: "wijziging",
        reden: "",
        onderwerp: wijzigingSjabloon.onderwerp,
        tekst: wijzigingSjabloon.tekst,
        // Het WhatsApp-sjabloon dat bij deze tekst hoort; zonder gaat hij per mail.
        ...(wijzigingSjabloon.wa_sjabloon_id
          ? { sjabloonId: wijzigingSjabloon.wa_sjabloon_id }
          : {}),
        ...(toch ? { toch: true } : {}),
      });
      const n = uit.verstuurd + uit.verstuurdWhatsApp;
      toast.success(
        `${n} ${n === 1 ? "klant kreeg" : "klanten kregen"} een wijziging${
          uit.mislukt > 0 ? `, ${uit.mislukt} mislukt` : ""
        }.`,
      );
    } catch (e) {
      if (e instanceof AlVerstuurdFout && !toch) {
        const ja = await bevestig({
          titel: "Deze klanten kregen net al een wijziging",
          tekst: "Het afgelopen uur ging er al zo'n bericht naar deze adressen. Toch nog een keer?",
          bevestigLabel: "Toch versturen",
          annuleerLabel: "Niet versturen",
          gevaarlijk: true,
        });
        if (ja) await stuurWijzigingen(true);
        return;
      }
      toast.error(
        "Wijzigingen versturen mislukte: " + (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async function verstuur(test: boolean, toch = false) {
    if (!klaar) {
      toast.error(
        !mailKlaar
          ? "Vul een onderwerp en een tekst in."
          : "Kies een goedgekeurde WhatsApp-template.",
      );
      return;
    }
    if (!test && !toch) {
      const delen = [
        aantal > 0 ? `${aantal} ${aantal === 1 ? "mail" : "mails"}` : "",
        sjabloon && aantalWa > 0
          ? `${aantalWa} ${aantalWa === 1 ? "WhatsApp-bericht" : "WhatsApp-berichten"}`
          : "",
        aantalWijzigingen > 0
          ? `${aantalWijzigingen} ${aantalWijzigingen === 1 ? "wijziging" : "wijzigingen"}`
          : "",
      ].filter(Boolean);
      const ja = await bevestig({
        titel: `${delen.join(" en ")} versturen?`,
        tekst:
          wijzigingen.length > 0
            ? `De planningsmail voor ${toonDatum(datum)} gaat naar wie nieuw is, en wie eerst op een andere dag stond krijgt een wijziging. Dit kun je niet terugnemen.`
            : `De aankondiging voor ${toonDatum(datum)} gaat de deur uit. Dit kun je niet terugnemen.`,
        bevestigLabel: "Versturen",
      });
      if (!ja) return;
    }
    // Alleen wijzigingen, geen planningsmail: dan niet de dag versturen (daar
    // staat dan niemand meer op om hem te krijgen).
    if (!test && !geteld) {
      toast("Even wachten: de telling is nog niet klaar.");
      return;
    }
    if (!test && planningsmails === 0) {
      setBezig(true);
      try {
        await stuurWijzigingen(toch);
      } finally {
        setBezig(false);
        void qc.invalidateQueries({ queryKey: ["aankondigingen"] });
        void qc.invalidateQueries({ queryKey: ["mail-telling"] });
      }
      return;
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
        ...(toch ? { toch: true } : {}),
        ...(Object.keys(tijdvakken).length > 0 ? { tijdvakken } : {}),
        // Een proef laat zien hoe de planningsmail eruitziet; die hoeft
        // niemand over te slaan.
        ...(!test && uitsluiten.length > 0 ? { uitsluiten } : {}),
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
      // Daarna de wijzigingen, met hun eigen vraag als ze net al verstuurd zijn.
      if (!test) await stuurWijzigingen();
      void qc.invalidateQueries({ queryKey: ["aankondigingen"] });
      void qc.invalidateQueries({ queryKey: ["mail-telling"] });
    } catch (e) {
      if (e instanceof AlVerstuurdFout) {
        setBezig(false);
        const nogEens = await bevestig({
          titel: "Deze dag is net al verstuurd",
          tekst: `De aankondiging voor ${toonDatum(datum)} ging het afgelopen uur al de deur uit. Nog een keer versturen betekent dat iedereen hem twee keer krijgt. Kijk eerst bij Verstuurd.`,
          bevestigLabel: "Toch nog een keer",
          annuleerLabel: "Niet versturen",
          gevaarlijk: true,
        });
        if (nogEens) await verstuur(false, true);
        // De wijzigingen hebben hun eigen controle; die gaan gewoon.
        else if (!test) await stuurWijzigingen();
        return;
      }
      const tekst = e instanceof Error ? e.message : String(e);
      // "Misschien toch verstuurd" is geen mislukking; dan niet zo noemen.
      toast.error(
        tekst.includes("misschien toch verstuurd") ? tekst : "Versturen mislukte: " + tekst,
        {
          duration: 15000,
        },
      );
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
                Er is nog geen goedgekeurde template. Maak er een bij{" "}
                <Link to="/instellingen" search={{ tab: "mail" }} className="underline">
                  Instellingen → mail → WhatsApp
                </Link>
                .
              </p>
            ) : (
              <>
                <select
                  aria-label="WhatsApp-template"
                  value={sjabloonId}
                  onChange={(e) => setSjabloonId(e.target.value)}
                  className="h-9 w-full rounded-[10px] border border-input bg-background px-2 text-[13px]"
                >
                  <option value="">Kies een template…</option>
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
                  {"{naam}"}, {"{adres}"} en {"{datum}"} vult Paaltje Systems per klant in.
                  {sjabloon?.categorie === "marketing" &&
                    " Nieuws en acties gaan alleen naar klanten die daar apart ja op zeiden."}
                </p>
              </>
            )}
          </Kaart>
        )}

        {metMail && (
          <Kaart titel="Het bericht">
            {aankondigingen.length > 1 && (
              <>
                <label
                  htmlFor="sjabloonkeuze"
                  className="block text-[12px] font-medium text-muted-foreground"
                >
                  Template
                </label>
                <select
                  id="sjabloonkeuze"
                  value={berichtSjabloon}
                  className="mt-1 mb-3 h-9 w-full rounded-[10px] border border-border bg-card px-2.5 text-sm"
                  onChange={(e) => {
                    const gekozen = aankondigingen.find((x) => x.id === e.target.value);
                    if (!gekozen) return;
                    setBerichtSjabloon(gekozen.id);
                    setOnderwerp(gekozen.onderwerp);
                    setTekst(gekozen.tekst);
                    // Een gekozen sjabloon telt niet als zelf getypt: kies je
                    // er zo nog een, dan wisselt hij gewoon mee.
                    setZelfGetypt(false);
                  }}
                >
                  {aankondigingen.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.naam}
                      {x.standaard ? " (standaard)" : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className="block text-[12px] font-medium text-muted-foreground">Onderwerp</label>
            <Input
              value={onderwerp}
              onChange={(e) => {
                setOnderwerp(e.target.value);
                setZelfGetypt(true);
              }}
              maxLength={200}
              className="mt-1"
            />
            <label className="mt-3 block text-[12px] font-medium text-muted-foreground">
              Tekst
            </label>
            <Textarea
              value={tekst}
              onChange={(e) => {
                setTekst(e.target.value);
                setZelfGetypt(true);
              }}
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
              {(dagen.isError || tijdFout) && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-tint-oranje-ink">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Kon de planning van deze dag niet ophalen, dus nog niet tellen. Ververs de pagina
                  of probeer het straks nog eens.
                </p>
              )}
              {wijzigingTelling.isError && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-tint-oranje-ink">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Kon niet uitrekenen wie een wijziging krijgt. Probeer het straks nog eens.
                </p>
              )}
              {eerdereMails.isError && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-tint-oranje-ink">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Kon niet ophalen wie al een planningsmail kreeg. Probeer het straks nog eens,
                  anders krijgt iedereen hem opnieuw.
                </p>
              )}
              {(indeling.verplaatst.length > 0 || indeling.al.length > 0) && (
                <div className="mt-3 space-y-2 border-t border-border pt-3 text-[12.5px]">
                  {indeling.verplaatst.length > 0 && (
                    <p className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tint-oranje-ink" />
                      <span>
                        {telAdressen(indeling.verplaatst.length)}{" "}
                        {indeling.verplaatst.length === 1 ? "stond" : "stonden"} in een eerdere
                        planningsmail op een andere dag.{" "}
                        {!wijzigingSjabloon
                          ? "Er is nog geen tekst voor een wijziging, dus die krijgen deze mail. Maak er een bij Instellingen → mail."
                          : wijzigingen.length === indeling.verplaatst.length
                            ? `Die krijgen een wijziging ("${wijzigingSjabloon.naam}") in plaats van deze mail${
                                aantalWijzigingen > 0
                                  ? `: ${aantalWijzigingen} ${aantalWijzigingen === 1 ? "bericht" : "berichten"}`
                                  : ""
                              }.`
                            : wijzigingTelling.isSuccess
                              ? `${wijzigingen.length} daarvan krijgen een wijziging ("${wijzigingSjabloon.naam}"); de rest is zo niet te bereiken en krijgt deze mail.`
                              : "Even kijken wie een wijziging kan krijgen…"}
                      </span>
                    </p>
                  )}
                  {indeling.al.length > 0 && (
                    <label className="flex cursor-pointer items-start gap-1.5 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={opnieuw}
                        onChange={(e) => setOpnieuw(e.target.checked)}
                        className="mt-0.5 size-3.5 shrink-0 accent-foreground"
                      />
                      <span>
                        {telAdressen(indeling.al.length)}{" "}
                        {indeling.al.length === 1 ? "had" : "hadden"} de planningsmail voor deze dag
                        al. Ook opnieuw sturen
                      </span>
                    </label>
                  )}
                </div>
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
            disabled={bezig || !klaar || !geteld || totaal === 0}
            onClick={() => void verstuur(false)}
          >
            <Send className="size-4" />
            {!geteld
              ? "Bezig met tellen…"
              : totaal === 0
                ? "Niemand om te bereiken"
                : `Versturen naar ${totaal}`}
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
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] bg-card px-4 py-3 shadow-card ${
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
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] bg-card px-4 py-3 shadow-card"
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
    <section className="rounded-[24px] bg-card p-4 shadow-card">
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
