/**
 * Het hart van het klantdossier: welk adres en welke klant je bekijkt (live
 * uit de cache, zodat een wijziging elders meteen zichtbaar is), de rechten,
 * wat er opgevraagd wordt voor het menu en het Overzicht, en het bewaren.
 *
 * Alles wordt meteen bewaard: elk veld bij het verlaten, elke keuze bij het
 * tikken. Dat loopt hier door één rij, zodat twee snelle wijzigingen elkaar
 * niet inhalen en een klant die bij het eerste veld wordt aangemaakt er maar
 * één keer komt. Zolang het adres nog niet bestaat (de nieuw-stand) blijft
 * alles een concept tot "Toevoegen".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { beurtenTekst, effectieveMethode, fetchWisselStatus, omrekenen } from "@/lib/betalingen";
import {
  fetchGewassenRondes,
  fetchLaatsteMail,
  fetchVolgendeBeurt,
  telOngelezen,
} from "@/lib/dossier";
import { boek, nieuweTik } from "@/lib/geldlopen";
import { fetchKlachtenVanKlant } from "@/lib/klachten";
import {
  adresVanRegel,
  bewaarKlant,
  deleteKlant,
  fetchCustomer,
  fetchCustomers,
  fetchCustomersMetInactief,
  fetchKlanten,
  fetchMarkeringen,
  fetchStreets,
  formatNumber,
  formatPrice,
  koppelKlant,
  LEEG_KLANT,
  maandSleutel,
  schuifStartOp,
  splitsHuisnummer,
  updateKlant,
  type Customer,
  type District,
  type Klant,
  type KlantVelden,
  type Maandwerk,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { fetchKlussen, staatOpen } from "@/lib/klussen";
import { fetchMailbox } from "@/lib/mailbox";
import {
  AdresBestaatAl,
  heeftKlantGegevens,
  maakNieuwAdres,
  plekAchteraan,
} from "@/lib/nieuwAdres";
import { fetchGeldAdres } from "@/lib/overzichten";
import { zoekAdres, zoekStraten } from "@/lib/postcode";
import { useRecht } from "@/lib/rechten";
import { geplandeDagen, zetActief, type StopReden } from "@/lib/stoppen";
import { pushUndo } from "@/lib/undo";
import { useKlantActies } from "@/lib/useKlantActies";
import { vandaag as vandaagSleutel } from "@/lib/wasdag";
import { fetchDagStand } from "@/components/betalingen/DagContant";

/**
 * Het dossier in de stand "nieuw": een adres dat nog niet bestaat, met een
 * straat uit de lijst (of een nieuwe straat), huisnummer, prijs en frequentie
 * verplicht, en de klantgegevens erbij als je die al weet.
 */
export interface NieuwAdres {
  /** De straat die al gekozen is, bijvoorbeeld via "+ adres" in een straat. */
  streetId?: string | undefined;
  nummer?: string | undefined;
  toevoeging?: string | undefined;
  /** Plek in de straat (achteraan), als die al bekend is. */
  sortOrder?: number | undefined;
  /** Plek in de straat die je uiteindelijk kiest; gaat vóór `sortOrder`. */
  plekVoor?: ((streetId: string) => number) | undefined;
  /** De straten in de keuzelijst; zonder dit alle straten op naam. */
  straten?: Street[] | undefined;
}

export type DossierTab = "overzicht" | "berichten" | "geld" | "facturen" | "geschiedenis";

export const TAB_NAMEN: Record<DossierTab, string> = {
  overzicht: "Overzicht",
  berichten: "Mail en klachten",
  geld: "Geld",
  facturen: "Facturen",
  geschiedenis: "Geschiedenis",
};

/** De keuze "Nieuwe straat…" in de straatlijst; geen echt id. */
export const NIEUWE_STRAAT = "__nieuwe_straat";

/** Straat, nummer en toevoeging zoals je ze in de nieuw-stand kiest. */
export interface AdresKeuze {
  /** Id van de straat, NIEUWE_STRAAT, of leeg. */
  straat: string;
  /** De naam van de nieuwe straat. */
  naam: string;
  nummer: string;
  toevoeging: string;
  /** De postcode van het pand; de app zoekt hem op tot je hem zelf typt. */
  postcode: string;
}

const LEGE_KEUZE: AdresKeuze = { straat: "", naam: "", nummer: "", toevoeging: "", postcode: "" };

/** Wat er bij het pand hoort en wat het Overzicht ervan laat zien. */
export type PandWaarden = Pick<
  Customer,
  | "price"
  | "duur_min"
  | "duur_zelf"
  | "eigen_blok"
  | "interval_maanden"
  | "ritme"
  | "note"
  | "maandwerk"
  | "overslaan"
  | "start_maand"
  | "markering"
  | "betaalmethode"
  | "created_at"
  | "geimporteerd"
  | "postcode"
> & { inactief_op?: string | null; inactief_reden?: string | null };

function leegPand(): PandWaarden {
  return {
    price: 0,
    duur_min: null,
    duur_zelf: false,
    eigen_blok: null,
    // Een nieuw adres heeft nog geen frequentie (0): die kies je zelf, anders
    // staat er ongemerkt "elke maand" op een adres dat om de twee moet.
    interval_maanden: 0,
    ritme: 1,
    note: "",
    maandwerk: [],
    overslaan: [],
    start_maand: "",
    markering: "",
    betaalmethode: null,
    created_at: new Date().toISOString(),
    geimporteerd: false,
    // De postcode van een nieuw adres staat in de keuze (zie AdresKeuze).
    postcode: "",
  };
}

/** De echte straatnaam, met de werknaam van de wijklijst als terugval. */
export const volledigeNaam = (s: Street) => s.volledige_naam.trim() || s.name;

/** Wat een tik bij overslaan bedoelt, vastgelegd vanaf het scherm: geen
 *  schakelaar, zodat een tweede tik voordat het scherm bij is niets terugdraait. */
export interface OverslaanBedoeling {
  aan?: string[];
  uit?: string[];
}

/** Velden die als hele lijst teruggaan: die rekent het dossier met de verse stand. */
const LIJST_VELDEN = new Set<string>(["overslaan", "maandwerk"]);

/** Het extra werk zonder wat de database zelf aanvult (ids, duur), om te vergelijken. */
function kernVan(werk: Maandwerk[]): string {
  return JSON.stringify(
    werk.map((w) => ({
      m: [...w.maanden].sort(),
      j: w.jaar ?? null,
      n: w.notitie.trim(),
      e: w.extra ?? null,
    })),
  );
}

/** Velden die alleen over het werk gaan: ook wie plant mag ze zetten. */
const PLAN_VELDEN = new Set<string>(["overslaan", "markering", "start_maand"]);

export interface DossierInvoer {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  klant: Klant | null;
  voorstelCustomer?: Customer | null | undefined;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
  onAddQuickNote: (label: string) => void;
  standaardWijkId?: string | null | undefined;
  nieuw?: NieuwAdres | undefined;
  onSaved: (adresId?: string) => void;
}

const fout = (e: unknown) =>
  e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);

export function useDossier(invoer: DossierInvoer) {
  const { open, klant: klantProp, voorstelCustomer, districts, nieuw, standaardWijkId } = invoer;
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const mobiel = useIsMobile() ?? false;
  const { patchKlant, maakKlus, stopKlant, herlaad } = useKlantActies();

  // --- Rechten (zie het bouwplan) ---------------------------------------------
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const magBewerken = useRecht("klanten_bewerken");
  const magPlanOfBewerken = useRecht("planning", "klanten_bewerken");
  const magPlannen = useRecht("planning");
  const prijzenZien = useRecht("prijzen_zien");
  const magMailLezen = useRecht("mail_lezen");
  const magMailVersturen = useRecht("mail_versturen");
  const magKlachten = useRecht("klanten_bekijken", "klanten_bewerken", "planning");

  // --- Welk adres, welke klant ------------------------------------------------
  const [adresId, zetAdresIdState] = useState<string | null>(voorstelCustomer?.id ?? null);
  const [klantId, zetKlantIdState] = useState<string | null>(
    klantProp?.id ?? voorstelCustomer?.klant_id ?? null,
  );
  // Ook in een ref: het bewaren loopt asynchroon, en moet het id van nú zien,
  // niet dat van de render waarin het begon.
  const adresIdRef = useRef(adresId);
  const klantIdRef = useRef(klantId);
  const zetAdresId = (id: string | null) => {
    adresIdRef.current = id;
    zetAdresIdState(id);
  };
  const zetKlantId = (id: string | null) => {
    klantIdRef.current = id;
    zetKlantIdState(id);
  };

  // Alleen meeluisteren: de pagina's halen deze lijsten zelf op. Zo staat een
  // wijziging (hier of elders) meteen in het dossier, zonder extra opvraging.
  const actieveAdressen = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
    enabled: false,
  }).data;
  const alleAdressen = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
    enabled: false,
  }).data;
  const klantenCache = useQuery({
    queryKey: ["klanten"],
    queryFn: fetchKlanten,
    enabled: false,
  }).data;
  const stratenCache = useQuery({
    queryKey: ["streets"],
    queryFn: fetchStreets,
    enabled: false,
  }).data;
  const streets = stratenCache ?? invoer.streets;
  const customers = actieveAdressen ?? invoer.customers;
  const klanten = klantenCache ?? invoer.klanten;

  /** Wat er hier net veranderde maar nog niet terug is uit de database
   *  (stoppen en weer actief maken). */
  const [adresExtra, setAdresExtra] = useState<Partial<Customer>>({});
  const adresExtraRef = useRef(adresExtra);
  adresExtraRef.current = adresExtra;
  /** De laatst geziene stand van het adres, voor als het uit de lijsten
   *  verdwijnt (gestopt, terwijl de lijst met inactieve adressen er niet is). */
  const laatstBekend = useRef<Customer | null>(null);
  const [, ververs] = useState(0);
  const uitCache = adresId
    ? (actieveAdressen?.find((c) => c.id === adresId) ??
      alleAdressen?.find((c) => c.id === adresId))
    : undefined;
  if (uitCache) laatstBekend.current = uitCache;
  const gevonden = adresId
    ? (uitCache ??
      (laatstBekend.current?.id === adresId ? laatstBekend.current : null) ??
      (voorstelCustomer?.id === adresId ? voorstelCustomer : null))
    : null;
  const adres: Customer | null = useMemo(
    () => (gevonden ? { ...gevonden, ...adresExtra } : null),
    [gevonden, adresExtra],
  );

  /** Het adres met dit id zoals het nú is, ook binnen de rij (waar de render
   *  nog niet bij is): eerst de cache, dan de laatst geziene stand. */
  function adresOp(id: string): Customer | null {
    const c =
      qc.getQueryData<Customer[]>(["customers"])?.find((x) => x.id === id) ??
      qc.getQueryData<Customer[]>(["customers", "met-inactief"])?.find((x) => x.id === id) ??
      (laatstBekend.current?.id === id ? laatstBekend.current : null) ??
      (voorstelCustomer?.id === id ? voorstelCustomer : null);
    if (!c) return null;
    return id === adresIdRef.current ? { ...c, ...adresExtraRef.current } : c;
  }

  /** Een klant die hier net is aangemaakt, voor als de klantenlijst nog niet in de cache staat. */
  const [gemaakteKlant, setGemaakteKlant] = useState<Klant | null>(null);
  const gemaakteKlantRef = useRef(gemaakteKlant);
  gemaakteKlantRef.current = gemaakteKlant;
  // Met een adres volgt de klant het adres. Wordt de klant elders gewisseld
  // (Ongedaan in de Geschiedenis, een collega die koppelt), dan gaat invoer
  // daarna naar de klant die er nu echt aan hangt.
  // Alleen als de klant van het adres verándert, niet zolang hij afwijkt: na
  // een verhuizing of Ongedaan van een nieuwe klant zet het dossier de klant
  // zelf op leeg, en dat moet zo blijven.
  const adresKlant = adres ? { adres: adres.id, klant: adres.klant_id ?? null } : null;
  const [gezienAdresKlant, setGezienAdresKlant] = useState(adresKlant);
  /** Wanneer hier een klant is aangemaakt (ms), voor de uitzondering hieronder. */
  const klantGemaaktOp = useRef(0);
  // Een oude stand die vlak na het aanmaken binnenkomt, maakt de nieuwe klant
  // niet weer leeg (dan kwam er bij het volgende veld een tweede). Alleen in
  // de eerste halve minuut, en zonder hem als "gezien" te tellen: blijft het
  // adres daarna zonder klant (Ongedaan in de Geschiedenis, een collega),
  // dan volgt het dossier alsnog.
  const ouderDanNieuweKlant =
    adresKlant?.klant === null &&
    gemaakteKlantRef.current?.id === klantId &&
    Date.now() - klantGemaaktOp.current < 30_000;
  if (
    !ouderDanNieuweKlant &&
    (adresKlant?.adres !== gezienAdresKlant?.adres || adresKlant?.klant !== gezienAdresKlant?.klant)
  ) {
    setGezienAdresKlant(adresKlant);
    if (
      adresKlant &&
      gezienAdresKlant?.adres === adresKlant.adres &&
      adresKlant.klant !== klantId
    ) {
      zetKlantId(adresKlant.klant);
      if (gemaakteKlantRef.current?.id !== adresKlant.klant) setGemaakteKlant(null);
    }
  }
  // Staat de klantenlijst er, dan is die de waarheid: een klant die daar
  // niet (meer) in staat, ligt in de prullenbak (zie klantBestaat).
  const gemaakt = gemaakteKlant?.id === klantId ? gemaakteKlant : null;
  const klant: Klant | null = !klantId
    ? null
    : klantenCache
      ? (klantenCache.find((k) => k.id === klantId) ?? gemaakt)
      : ((klantProp?.id === klantId ? klantProp : null) ??
        gemaakt ??
        invoer.klanten.find((k) => k.id === klantId) ??
        null);

  /** Bestaat deze klant nog? Na een verhuizing ligt hij in de prullenbak
   *  (dan staat hij niet meer in de klantenlijst), maar wijst het adres er nog
   *  naar. Is de lijst er niet, dan gaan we ervan uit van wel. */
  function klantBestaat(id: string): boolean {
    if (gemaakteKlantRef.current?.id === id) return true;
    const lijst = qc.getQueryData<Klant[]>(["klanten"]);
    return lijst ? lijst.some((k) => k.id === id) : true;
  }

  /**
   * De klant waar een opslag naartoe moet, of null als er (nog) geen is.
   * Staat de klant waar het adres naar wijst niet in de klantenlijst, dan
   * eerst één keer de lijst vers ophalen: hij kan net door een collega zijn
   * aangemaakt, en dan hoort er geen tweede klant bij te komen.
   */
  async function echteKlant(kandidaat: string | null | undefined): Promise<string | null> {
    if (!kandidaat) return null;
    if (klantBestaat(kandidaat)) return kandidaat;
    await qc.fetchQuery({ queryKey: ["klanten"], queryFn: fetchKlanten, staleTime: 0 });
    return klantBestaat(kandidaat) ? kandidaat : null;
  }

  /** De klant met dit id zoals hij nú is (zie adresOp). */
  function klantOp(id: string): Klant | null {
    return (
      qc.getQueryData<Klant[]>(["klanten"])?.find((k) => k.id === id) ??
      (gemaakteKlantRef.current?.id === id ? gemaakteKlantRef.current : null) ??
      (klantProp?.id === id ? klantProp : null) ??
      invoer.klanten.find((k) => k.id === id) ??
      null
    );
  }

  // --- Nieuw-stand: alles een concept tot "Toevoegen" -----------------------
  /** Klantgegevens zolang er nog geen klant is (en geen adres om hem aan te hangen). */
  const [concept, setConcept] = useState<KlantVelden>(LEEG_KLANT);
  const [pandConcept, setPandConcept] = useState<PandWaarden>(leegPand);
  const [keuze, setKeuze] = useState<AdresKeuze>(LEGE_KEUZE);
  const [wijkId, setWijkId] = useState("");
  const [postcodeZelf, setPostcodeZelf] = useState(false);
  const [straatSuggesties, setStraatSuggesties] = useState<string[]>([]);
  // --- Het postadres: postcode opzoeken en officiële straatnamen -------------
  /** De postcode die de app zelf bij het postadres opzocht (geel, met Ongedaan). */
  const [postcodeOpgezocht, setPostcodeOpgezocht] = useState<string | null>(null);
  /** Na Ongedaan of zelf typen zoekt de app de postcode niet meer op. */
  const [postcodeNietZoeken, setPostcodeNietZoeken] = useState(false);
  /** Pas zoeken als je hier straat, nummer of plaats wijzigde: alleen kijken
   *  in een dossier schrijft niets weg. */
  const [postadresGewijzigd, setPostadresGewijzigd] = useState(false);
  /** Wat je nu in het straatveld van het postadres typt (voor de voorstellen). */
  const [klantStraatTyp, setKlantStraatTyp] = useState("");
  const [klantStraatSuggesties, setKlantStraatSuggesties] = useState<string[]>([]);
  const [toevoegenBezig, setToevoegenBezig] = useState(false);
  const toevoegenBezigRef = useRef(false);
  const beginConcept = useRef<string>("");

  // --- Navigatie -------------------------------------------------------------
  const [tab, setTab] = useState<DossierTab>("overzicht");
  /** Op de telefoon: het menu (het eerste scherm) of één onderdeel. */
  const [stap, setStap] = useState<"menu" | "tab">("menu");
  /** Welk los schermpje er boven het dossier open is. */
  const [dialoog, setDialoog] = useState<"mail" | "betalen" | "stop" | "klus" | null>(null);

  // Alles wat er bewaard is: zo weet de pagina bij het sluiten dat ze moet verversen.
  const bewaard = useRef(false);
  /** Per adres de laatste stand die de database echt had (zie bewaarPand). */
  const bevestigd = useRef(new Map<string, Customer>());
  /** Per adres hoeveel lijsttikken er nog wachten of bezig zijn. */
  const bezigMet = useRef(new Map<string, number>());
  /** Lijstwijzigingen die al op het scherm staan maar nog in de rij wachten. */
  const openstaand = useRef<{ adres: string; reken: (p: PandWaarden) => Partial<PandWaarden> }[]>(
    [],
  );
  /** De rij waar elke opslag doorheen gaat, in volgorde. */
  const rij = useRef<Promise<unknown>>(Promise.resolve());

  // Bij openen (of een ander adres of een andere klant van buiten) alles
  // terug naar het begin. Tijdens het tekenen en niet in een effect: anders
  // staat er bij openen even het dossier van de vorige keer, of een leeg.
  // Met een adres telt alleen het adres: de klant die de pagina meegeeft kan
  // tussendoor wisselen (verversen, een verhuizing), en dat mag het open
  // dossier niet terugzetten. Zonder adres is de klant het dossier.
  const sleutel = open
    ? voorstelCustomer
      ? `a:${voorstelCustomer.id}`
      : `k:${klantProp?.id ?? ""}`
    : null;
  const [vorigeSleutel, setVorigeSleutel] = useState<string | null>(null);
  if (sleutel !== vorigeSleutel) {
    setVorigeSleutel(sleutel);
    if (sleutel !== null) {
      zetAdresId(voorstelCustomer?.id ?? null);
      // Ook als de pagina de klant (nog) niet meegaf: het adres weet bij wie
      // het hoort. Anders kwam er bij het eerste veld een tweede klant bij.
      zetKlantId(klantProp?.id ?? voorstelCustomer?.klant_id ?? null);
      setAdresExtra({});
      setGemaakteKlant(null);
      laatstBekend.current = voorstelCustomer ?? null;
      // Een stand van een vorige keer openen telt niet meer (zie bewaarPand);
      // wat nog loopt, zet bij het mislukken zijn eigen vastgelegde stand terug.
      for (const id of [...bevestigd.current.keys()]) {
        if (!(bezigMet.current.get(id) ?? 0)) bevestigd.current.delete(id);
      }
      bewaard.current = false;
      const k: AdresKeuze = {
        ...LEGE_KEUZE,
        straat: nieuw?.streetId ?? "",
        nummer: nieuw?.nummer ?? "",
        toevoeging: nieuw?.toevoeging ?? "",
      };
      const beginStraat = invoer.streets.find((s) => s.id === k.straat);
      setKeuze(k);
      setWijkId(
        beginStraat?.district_id ??
          standaardWijkId ??
          (districts.length === 1 ? (districts[0]?.id ?? "") : ""),
      );
      setConcept(LEEG_KLANT);
      const p = leegPand();
      setPandConcept(p);
      beginConcept.current = JSON.stringify({ c: LEEG_KLANT, p: { ...p, created_at: "" }, k });
      setPostcodeZelf(false);
      setPostcodeOpgezocht(null);
      setPostcodeNietZoeken(false);
      setPostadresGewijzigd(false);
      setKlantStraatTyp("");
      setKlantStraatSuggesties([]);
      setTab("overzicht");
      setDialoog(null);
      // Een nieuw adres heeft nog niets om door te bladeren: op de telefoon
      // meteen het Overzicht om in te vullen.
      setStap(voorstelCustomer ? "menu" : "tab");
    }
  }

  /** Bestaat het adres al? Anders is dit de nieuw-stand. */
  const zonderAdres = !adresId;
  const pand: PandWaarden = adres ?? pandConcept;
  const velden: KlantVelden = klant ? stripId(klant) : concept;

  const straatVan = (c: Pick<Customer, "street_id"> | null | undefined) =>
    c ? streets.find((s) => s.id === c.street_id) : undefined;
  const wijkVanStraat = (s: Street | undefined) => districts.find((d) => d.id === s?.district_id);
  const adresStraat = straatVan(adres);
  const wijk = adres ? wijkVanStraat(adresStraat) : districts.find((d) => d.id === wijkId);
  const adresTekst = (c: Customer) =>
    `${streets.find((s) => s.id === c.street_id)?.name ?? ""} ${formatNumber(c)}`.trim();
  const methode = effectieveMethode(pand, wijk);
  /** Het pand voluit, voor de kaart: de echte straatnaam (niet de werknaam
   *  van de wijklijst), het nummer, de postcode en de plaats. */
  const routeAdres = (() => {
    if (!adres || !adresStraat) return "";
    const r = adresVanRegel(adres, adresStraat, wijk);
    return [
      `${r.straat} ${r.huisnummer}`.trim(),
      [adres.postcode.trim(), r.plaats].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
  })();

  // --- Opvragen voor menu en Overzicht --------------------------------------
  const vandaag = vandaagSleutel();
  const dezeMaand = maandSleutel(new Date());
  const jaar = new Date().getFullYear();

  const markeringen =
    useQuery({ queryKey: ["markeringen"], queryFn: fetchMarkeringen, enabled: open }).data ?? [];
  // Alleen het openstaande werk van dit adres; onder ["klussen", …], zodat
  // een nieuwe opdracht (die ["klussen"] ververst) hier ook verschijnt.
  const klussen =
    useQuery({
      queryKey: ["klussen", "adres", adresId],
      queryFn: () => fetchKlussen(undefined, undefined, adresId!),
      enabled: open && !!adresId,
    }).data ?? [];
  const openKlussen = adresId ? klussen.filter((k) => staatOpen(k)) : [];
  const klachten = useQuery({
    queryKey: ["klachten", klantId],
    queryFn: () => fetchKlachtenVanKlant(klantId!),
    enabled: open && !!klantId && magKlachten,
  });
  const openKlachten = (klachten.data ?? []).filter((k) => k.status === "open").length;
  const ongelezen =
    useQuery({
      queryKey: ["dossier-ongelezen", klantId],
      queryFn: () => telOngelezen(klantId!),
      enabled: open && !!klantId && magMailLezen,
    }).data ?? 0;
  const laatsteMail = useQuery({
    queryKey: ["dossier-laatste-mail", klantId],
    queryFn: () => fetchLaatsteMail(klantId!),
    enabled: open && !!klantId && magMailLezen,
  });
  const geld = useQuery({
    queryKey: ["geld-adres", adresId],
    // Geld en planning veranderen elders (de geldloop, de planning) zonder dat
    // dit wordt ververst: bij elk openen vers, niet pas na een minuut.
    staleTime: 0,
    queryFn: () => fetchGeldAdres(adresId!),
    enabled: open && !!adresId && prijzenZien,
  });
  // De planning mag niet iedereen lezen; lukt het niet, dan is er gewoon niets.
  const volgendeBeurt = useQuery({
    queryKey: ["dossier-volgende", adresId, vandaag],
    // Geld en planning veranderen elders (de geldloop, de planning) zonder dat
    // dit wordt ververst: bij elk openen vers, niet pas na een minuut.
    staleTime: 0,
    queryFn: () => fetchVolgendeBeurt(adresId!, vandaag).catch(() => null),
    enabled: open && !!adresId,
  });
  const gewassen =
    useQuery({
      queryKey: ["dossier-jaar", adresId, jaar],
      // Geld en planning veranderen elders (de geldloop, de planning) zonder dat
      // dit wordt ververst: bij elk openen vers, niet pas na een minuut.
      staleTime: 0,
      queryFn: () => fetchGewassenRondes(adresId!, jaar).catch(() => [] as string[]),
      enabled: open && !!adresId,
    }).data ?? [];
  // Een medewerker mag alleen betalen als het adres vandaag op zijn route
  // staat; de database zegt dat (leeg = niet).
  const dagStand = useQuery({
    queryKey: ["dag-geld", adresId],
    // Geld en planning veranderen elders (de geldloop, de planning) zonder dat
    // dit wordt ververst: bij elk openen vers, niet pas na een minuut.
    staleTime: 0,
    queryFn: () => fetchDagStand(adresId!),
    enabled: open && !!adresId && !isEigenaar,
  });
  const mailbox = useQuery({
    queryKey: ["mailbox"],
    queryFn: fetchMailbox,
    enabled: open && magMailVersturen,
  });

  const telefoon = velden.telefoon.trim() || velden.telefoon2.trim();
  const email = velden.email.trim() || velden.email2.trim();
  // wa.me wil het nummer internationaal en zonder tekens: 06… wordt 316….
  // Alleen een mobiel nummer: een vast nummer (070…) heeft geen WhatsApp.
  const whatsappNummer =
    [velden.telefoon, velden.telefoon2]
      .map((t) =>
        t
          .replace(/[^\d+]/g, "")
          .replace(/^(\+|00)/, "")
          .replace(/^0(?=6)/, "31"),
      )
      .find((t) => t.startsWith("316")) ?? "";
  const kanMailen =
    Boolean(klant && email) && magMailVersturen && mailbox.data?.status === "actief";
  const kanBetalen = Boolean(adres) && (isEigenaar || Boolean(dagStand.data));

  // --- Bewaren -----------------------------------------------------------------
  /** Zet werk achteraan in de rij en onthoud dat er iets bewaard is. */
  function inRij<T>(werk: () => Promise<T>): Promise<T> {
    bewaard.current = true;
    const p = rij.current.then(werk, werk);
    rij.current = p.catch(() => undefined);
    return p;
  }

  /**
   * Een klant aanmaken bij een bestaand adres zonder klant, met wat je net
   * invulde. Zijn postadres is dat van het pand. Lukt het koppelen niet, dan
   * gaat de klant weer weg: een losse klant zonder adres helpt niemand.
   */
  async function maakKlant(adresId: string, patch: Partial<KlantVelden>): Promise<string | null> {
    const a = adresOp(adresId);
    if (!a) return null;
    const s = straatVan(a);
    const postadres = s ? adresVanRegel(a, s, wijkVanStraat(s)) : {};
    let nieuweKlant: Klant;
    try {
      nieuweKlant = await bewaarKlant(null, {
        ...LEEG_KLANT,
        ...postadres,
        postcode: a.postcode ?? "",
        ...patch,
      });
    } catch (e) {
      toast.error("Opslaan mislukt: " + fout(e));
      return null;
    }
    try {
      await koppelKlant([a.id], nieuweKlant.id);
    } catch (e) {
      await deleteKlant(nieuweKlant.id).catch(() => undefined);
      toast.error("Opslaan mislukt: " + fout(e));
      return null;
    }
    // Ook in de laatst geziene stand: staat het adres in geen lijst, dan weet
    // een volgende opslag zo toch dat er nu een klant is.
    if (laatstBekend.current?.id === a.id) {
      laatstBekend.current = { ...laatstBekend.current, klant_id: nieuweKlant.id };
    }
    // Alleen als je nog naar dit adres kijkt; anders hoort de klant bij een
    // dossier dat al dicht is of bij een ander adres.
    if (adresIdRef.current === a.id && (!klantIdRef.current || !klantBestaat(klantIdRef.current))) {
      zetKlantId(nieuweKlant.id);
      setGemaakteKlant(nieuweKlant);
      klantGemaaktOp.current = Date.now();
    }
    qc.setQueryData<Klant[]>(["klanten"], (old) => (old ? [...old, nieuweKlant] : old));
    const metKlant = (old: Customer[] | undefined) =>
      old?.map((c) => (c.id === a.id ? { ...c, klant_id: nieuweKlant.id } : c));
    qc.setQueryData<Customer[]>(["customers"], metKlant);
    qc.setQueryData<Customer[]>(["customers", "met-inactief"], metKlant);
    pushUndo({
      label: `Klant bij ${adresTekst(a)}`,
      undo: async () => {
        await koppelKlant([a.id], null);
        await deleteKlant(nieuweKlant.id);
        // Kijk je nog naar deze klant, dan is het weer een adres zonder klant.
        if (klantIdRef.current === nieuweKlant.id) {
          zetKlantId(null);
          setGemaakteKlant(null);
        }
        void qc.invalidateQueries({ queryKey: ["klanten"] });
        herlaad();
      },
    });
    toast.success(`Klant aangemaakt bij ${adresTekst(a)}`);
    return nieuweKlant.id;
  }

  /** Klantgegevens wijzigen. Bestaat de klant nog niet, dan komt hij er nu bij. */
  function zetKlant(patch: Partial<KlantVelden>): Promise<void> {
    if (!magBewerken) return Promise.resolve();
    if ("straat" in patch || "huisnummer" in patch || "plaats" in patch) {
      setPostadresGewijzigd(true);
    }
    // Welke klant en welk adres: die van nú, niet die van als de rij aan de
    // beurt is (dan kan er al een ander adres open staan).
    const bijKlant = klantIdRef.current;
    const bijAdres = adresIdRef.current;
    // Nog geen adres en geen klant: een concept, dat bij Toevoegen meegaat.
    if (!bijKlant && !bijAdres) {
      if (toevoegenBezigRef.current) return Promise.resolve();
      setConcept((c) => ({ ...c, ...patch }));
      return Promise.resolve();
    }
    return inRij(async () => {
      // Kwam er intussen (eerder in de rij) een klant bij dit adres, dan die;
      // een klant die in de prullenbak ligt telt niet.
      let id: string | null;
      try {
        id = await echteKlant(bijKlant ?? (bijAdres ? adresOp(bijAdres)?.klant_id : null));
      } catch (e) {
        toast.error("Opslaan mislukt: " + fout(e));
        return;
      }
      if (!id) {
        // Pas een klant maken als er echt iets ingevuld is; een keuze die
        // op zijn beginstand staat telt niet (zoals bij Toevoegen).
        if (!heeftKlantGegevens({ ...LEEG_KLANT, ...patch })) return;
        await maakKlant(bijAdres!, patch);
        return;
      }
      const huidig = klantOp(id);
      const vorige: Partial<KlantVelden> = {};
      for (const veld of Object.keys(patch) as (keyof KlantVelden)[]) {
        if (huidig && huidig[veld] !== patch[veld]) {
          (vorige as Record<string, unknown>)[veld] = huidig[veld];
        }
      }
      if (huidig && Object.keys(vorige).length === 0) return;
      qc.setQueryData<Klant[]>(["klanten"], (old) =>
        old?.map((k) => (k.id === id ? { ...k, ...patch } : k)),
      );
      try {
        await updateKlant(id, patch);
      } catch (e) {
        toast.error("Opslaan mislukt: " + fout(e));
        void qc.invalidateQueries({ queryKey: ["klanten"] });
        return;
      }
      if (gemaakteKlantRef.current?.id === id) {
        setGemaakteKlant((k) => (k && k.id === id ? { ...k, ...patch } : k));
      }
      // Zonder de vorige stand valt er niets terug te zetten; dan geen
      // Ongedaan die velden leeg zou maken.
      if (!huidig) return;
      pushUndo({
        label: `Wijziging ${huidig.naam || "klant"}`,
        undo: async () => {
          await updateKlant(id, vorige);
          void qc.invalidateQueries({ queryKey: ["klanten"] });
        },
      });
    });
  }

  /**
   * De klant van dit adres, en is er nog geen: nu een lege. Voor het
   * invul-linkje, dat de klant zelf zijn naam laat invullen.
   */
  function zorgVoorKlant(): Promise<string | null> {
    if (!magBewerken) return Promise.resolve(null);
    return inRij(async () => {
      const bijAdres = adresIdRef.current;
      const id = await echteKlant(
        klantIdRef.current ?? (bijAdres ? adresOp(bijAdres)?.klant_id : null),
      );
      if (id) return id;
      return bijAdres ? maakKlant(bijAdres, {}) : null;
    });
  }

  /** Mag deze rol dit veld van het pand wijzigen? */
  function magPand(patch: Partial<PandWaarden>): boolean {
    return Object.keys(patch).every((veld) =>
      PLAN_VELDEN.has(veld)
        ? magPlanOfBewerken
        : veld === "price"
          ? magBewerken && prijzenZien
          : magBewerken,
    );
  }

  /** Iets aan het pand wijzigen: prijs, frequentie, notitie, maanden, kleur… */
  function zetPand(patch: Partial<PandWaarden>): Promise<void> {
    return bewaarPand(() => patch, Object.keys(patch));
  }

  /**
   * De maanden die overgeslagen worden, uitgerekend uit de stand op het
   * moment van bewaren: zo gaan drie snel aangetikte maanden alle drie mee,
   * ook als de eerste nog wordt bewaard.
   */
  function zetOverslaan(bedoeling: OverslaanBedoeling) {
    const { aan = [], uit = [] } = bedoeling;
    return bewaarPand(
      (p) => ({
        overslaan: [...new Set([...p.overslaan.filter((m) => !uit.includes(m)), ...aan])].sort(),
      }),
      ["overslaan"],
    );
  }

  /**
   * Het extra werk als hele lijst, uit het schermpje. `vorige` is wat dat
   * schermpje zag bij het openen: is de database intussen anders, dan heeft
   * iemand anders het veranderd en overschrijven we niets.
   */
  function zetMaandwerk(werk: Maandwerk[], vorige: Maandwerk[]) {
    return bewaarPand(() => ({ maandwerk: werk }), ["maandwerk"], vorige);
  }

  /** Een vers opgehaald adres in de lijsten zetten (en in de laatst geziene stand). */
  function zetInCache(vers: Customer) {
    const pas = (old: Customer[] | undefined) => old?.map((c) => (c.id === vers.id ? vers : c));
    qc.setQueryData<Customer[]>(["customers"], pas);
    qc.setQueryData<Customer[]>(["customers", "met-inactief"], pas);
    if (laatstBekend.current?.id === vers.id) laatstBekend.current = vers;
  }

  /** Een wijziging meteen op het scherm zetten, uitgerekend uit wat er nu staat. */
  function pasCacheToe(id: string, reken: (p: PandWaarden) => Partial<PandWaarden>) {
    const pas = (old: Customer[] | undefined) =>
      old?.map((c) => (c.id === id ? ({ ...c, ...reken(c) } as Customer) : c));
    qc.setQueryData<Customer[]>(["customers"], pas);
    qc.setQueryData<Customer[]>(["customers", "met-inactief"], pas);
    if (laatstBekend.current?.id === id) {
      laatstBekend.current = {
        ...laatstBekend.current,
        ...reken(laatstBekend.current),
      } as Customer;
    }
    ververs((n) => n + 1);
  }

  /** De wijzigingen die nog in de rij wachten weer op het scherm zetten,
   *  nadat de verse stand of een opslag eroverheen ging. */
  function legOpenstaandErOverheen(id: string) {
    for (const o of openstaand.current) if (o.adres === id) pasCacheToe(id, o.reken);
  }

  /** Bewaart wat `reken` uit de stand van dat moment maakt; alleen de `velden`. */
  function bewaarPand(
    reken: (p: PandWaarden) => Partial<PandWaarden>,
    velden: string[],
    /** Het maandwerk waar de wijziging van uitging (zie zetMaandwerk). */
    maandwerkBasis?: Maandwerk[],
  ): Promise<void> {
    if (!magPand(Object.fromEntries(velden.map((k) => [k, true])))) return Promise.resolve();
    const bijAdres = adresIdRef.current;
    if (!bijAdres) {
      if (toevoegenBezigRef.current) return Promise.resolve();
      setPandConcept((p) => ({ ...p, ...reken(p) }));
      return Promise.resolve();
    }
    // Een lijst (overslaan, extra werk) staat meteen op het scherm, nog vóór
    // de verse stand is opgehaald: zo ziet een tweede tik of een tweede
    // schermpje al wat je net deed.
    const lijst = velden.some((v) => LIJST_VELDEN.has(v));
    const item = { adres: bijAdres, reken };
    if (lijst && !(bezigMet.current.get(bijAdres) ?? 0)) {
      // Wacht of loopt er niets voor dit adres, dan is wat er nu staat de
      // stand van de database: daar gaat het naar terug als het mislukt.
      const nu = adresOp(bijAdres);
      if (nu) bevestigd.current.set(bijAdres, nu);
    }
    if (lijst) {
      bezigMet.current.set(bijAdres, (bezigMet.current.get(bijAdres) ?? 0) + 1);
      openstaand.current.push(item);
      pasCacheToe(bijAdres, reken);
    }
    return inRij(async () => {
      if (!lijst) {
        await bewaarPandNu(bijAdres, reken, velden, maandwerkBasis);
        return;
      }
      openstaand.current = openstaand.current.filter((o) => o !== item);
      let ok = false;
      try {
        ok = await bewaarPandNu(bijAdres, reken, velden, maandwerkBasis);
      } finally {
        // Niet bewaard: terug naar de laatste stand die de database echt had
        // (ook zonder verbinding), en daarna de wachtende tikken er weer op.
        // Overslaan kan de startmaand hebben opgeschoven; die gaat mee terug.
        const bron = bevestigd.current.get(bijAdres);
        if (!ok && bron) {
          const terug = velden.includes("overslaan") ? [...velden, "start_maand"] : velden;
          pasCacheToe(bijAdres, () =>
            Object.fromEntries(terug.map((v) => [v, bron[v as keyof PandWaarden]])),
          );
        }
        legOpenstaandErOverheen(bijAdres);
        bezigMet.current.set(bijAdres, (bezigMet.current.get(bijAdres) ?? 1) - 1);
      }
    });
  }

  /** Het eigenlijke bewaren van bewaarPand, als het aan de beurt is in de rij. */
  async function bewaarPandNu(
    bijAdres: string,
    reken: (p: PandWaarden) => Partial<PandWaarden>,
    velden: string[],
    maandwerkBasis?: Maandwerk[],
  ): Promise<boolean> {
    {
      let a = adresOp(bijAdres);
      if (!a) {
        toast.error("Het adres is nog niet geladen. Probeer het zo nog eens.");
        return false;
      }
      // Een lijst (overslaan, extra werk) gaat in zijn geheel terug. Reken
      // daarom met de stand in de database, niet met die van het scherm: een
      // wijziging van Paaltje of een collega van net daarvoor blijft zo staan.
      if (velden.some((v) => LIJST_VELDEN.has(v))) {
        let vers: Customer | null;
        try {
          vers = await fetchCustomer(bijAdres);
        } catch (e) {
          toast.error("Opslaan mislukt: " + fout(e));
          return false;
        }
        if (!vers) {
          toast.error("Dit adres bestaat niet meer.");
          return false;
        }
        zetInCache(vers);
        bevestigd.current.set(vers.id, vers);
        // Wat er nog achter in de rij wacht, blijft op het scherm staan.
        legOpenstaandErOverheen(bijAdres);
        // Het extra werk komt als hele lijst uit het schermpje. Is het
        // intussen elders veranderd, dan niet overschrijven maar melden.
        if (
          velden.includes("maandwerk") &&
          kernVan(vers.maandwerk) !== kernVan(maandwerkBasis ?? a.maandwerk)
        ) {
          toast.error(
            "Het extra werk is intussen ergens anders gewijzigd. Kijk het na en pas het opnieuw aan.",
            { duration: 10000 },
          );
          return false;
        }
        a = bijAdres === adresIdRef.current ? { ...vers, ...adresExtraRef.current } : vers;
      }
      const patch = reken(a);
      // Nog eens de rechten, op wat er echt uit kwam.
      if (!magPand(patch) || Object.keys(patch).some((k) => !velden.includes(k))) return false;
      // Alles hierlangs, zodat een startmaand die je overslaat opschuift,
      // net als in het menu op de wijklijst.
      const volledig = schuifStartOp(a, patch);
      const veranderd = (Object.keys(volledig) as (keyof Customer)[]).some(
        (k) => JSON.stringify(a[k]) !== JSON.stringify(volledig[k]),
      );
      if (!veranderd) return true;
      const opslag = patchKlant(a, volledig);
      // patchKlant zet zijn wijziging meteen in de cache (over de wachtende
      // heen); die laatste daarom meteen weer erbovenop.
      legOpenstaandErOverheen(bijAdres);
      const ok = await opslag;
      if (!ok) return false;
      bevestigd.current.set(a.id, { ...a, ...volledig } as Customer);
      // Ook de laatst geziene stand bijwerken: staat het adres in geen
      // enkele lijst meer (gestopt), dan is dat wat het dossier laat zien.
      if (laatstBekend.current?.id === a.id) {
        laatstBekend.current = { ...laatstBekend.current, ...volledig };
        ververs((n) => n + 1);
      }
      // Heeft dit adres nog vooruitbetaalde beurten, dan houdt de database
      // het op contant tot die op zijn, en plant de wissel. Dat zeggen we,
      // anders lijkt het alsof overmaken niet is opgeslagen.
      if (
        "betaalmethode" in patch &&
        patch.betaalmethode !== a.betaalmethode &&
        (await fetchWisselStatus(a.id).catch(() => null)) === "gepland"
      ) {
        toast.info("Gaat overmaken zodra de vooruitbetaling op is", { duration: 8000 });
      }
      if (patch.price !== undefined && patch.price !== a.price) {
        void qc.invalidateQueries({ queryKey: ["geld-adres", a.id] });
        // Prijs omhoog terwijl er nog beurten vooruit betaald zijn: vragen of
        // die gratis blijven of worden omgerekend. Buiten de rij: de vraag
        // mag de rest van het bewaren niet ophouden.
        if (isEigenaar && !a.inactief_op && patch.price > a.price) void vraagOmrekenen(a.id);
      }
      return true;
    }
  }

  /**
   * Na een prijsverhoging, als er nog beurten vooruit betaald zijn: gratis
   * houden (niets boeken, de beurten blijven) of omrekenen (minder beurten
   * tegen de nieuwe prijs, de rest wordt tegoed).
   */
  async function vraagOmrekenen(id: string) {
    const g = await fetchGeldAdres(id).catch(() => null);
    if (!g) {
      toast.warning(
        "Vooruit betaalde beurten konden niet worden gecontroleerd, kijk in het dossier.",
      );
      return;
    }
    if (g.vooruit_eigen <= 0 || g.vooruit_p === null) return;
    const nieuwe = omrekenen(g.vooruit_eigen_waarde, g.vooruit_p);
    if (nieuwe.beurten >= g.vooruit_eigen) return;
    const ja = await bevestig({
      titel: "Nieuwe prijs en vooruit betaald",
      tekst:
        `Deze klant heeft nog ${beurtenTekst(g.vooruit_eigen)} vooruit betaald à ` +
        `${formatPrice(g.vooruit_eigen_waarde / g.vooruit_eigen)} (${formatPrice(g.vooruit_eigen_waarde)}). ` +
        `Wat doen we met de nieuwe prijs van ${formatPrice(g.vooruit_p)}? ` +
        `Gratis houden: het blijven ${beurtenTekst(g.vooruit_eigen)}. ` +
        `Omrekenen: ${beurtenTekst(nieuwe.beurten)} à ${formatPrice(g.vooruit_p)}` +
        (nieuwe.tegoed > 0.005 ? ` en ${formatPrice(nieuwe.tegoed)} tegoed.` : "."),
      bevestigLabel: "Omrekenen",
      annuleerLabel: "Gratis houden",
    });
    if (!ja) return;
    try {
      await boek(
        nieuweTik({
          adres: id,
          soort: "omgerekend",
          bedrag: g.vooruit_eigen_waarde,
          aantal: nieuwe.beurten,
          bron: "kantoor",
        }),
      );
      void qc.invalidateQueries({ queryKey: ["geld-adres", id] });
      void qc.invalidateQueries({ queryKey: ["geld-pof"] });
      void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
      toast.success(`Omgerekend: nog ${beurtenTekst(nieuwe.beurten)} vooruit betaald`);
    } catch (e) {
      toast.error(fout(e));
    }
  }

  // --- Andere adressen van deze klant ---------------------------------------
  const andereAdressen = klantId
    ? customers.filter((c) => c.klant_id === klantId && c.id !== adresId)
    : [];

  /** Een ander adres van deze klant openen, in hetzelfde dossier. */
  function openAdres(c: Customer) {
    zetAdresId(c.id);
    setAdresExtra({});
    laatstBekend.current = c;
    setTab("overzicht");
  }

  /** Nog een adres aan deze klant hangen: het samenvoegen van twee regels.
   *  Geeft terug of het gelukt is. */
  function koppelAdres(c: Customer): Promise<boolean> {
    if (!magBewerken) return Promise.resolve(false);
    const bijKlant = klantIdRef.current;
    const bijAdres = adresIdRef.current;
    return inRij(async () => {
      let id: string | null;
      try {
        id =
          (await echteKlant(bijKlant ?? (bijAdres ? adresOp(bijAdres)?.klant_id : null))) ??
          (bijAdres ? await maakKlant(bijAdres, {}) : null);
      } catch (e) {
        toast.error("Koppelen mislukt: " + fout(e));
        return false;
      }
      if (!id) return false;
      const vorige = c.klant_id;
      try {
        await koppelKlant([c.id], id);
      } catch (e) {
        toast.error("Koppelen mislukt: " + fout(e));
        return false;
      }
      const pas = (k: string | null) => (old: Customer[] | undefined) =>
        old?.map((x) => (x.id === c.id ? { ...x, klant_id: k } : x));
      qc.setQueryData<Customer[]>(["customers"], pas(id));
      qc.setQueryData<Customer[]>(["customers", "met-inactief"], pas(id));
      pushUndo({
        label: `Koppelen ${adresTekst(c)}`,
        undo: async () => {
          await koppelKlant([c.id], vorige);
          herlaad();
        },
      });
      // De klant die het adres kwijtraakt laten we staan; heeft hij niets
      // meer, dan staat hij onder "Nog zonder wijk" en gooi je hem daar weg.
      const oudeNaam =
        vorige && vorige !== id ? (klanten.find((k) => k.id === vorige)?.naam ?? "") : "";
      const nogIets = customers.some((x) => x.klant_id === vorige && x.id !== c.id);
      toast.success(
        vorige && vorige !== id
          ? `Samengevoegd: ${adresTekst(c)} hoort nu bij deze klant.${
              oudeNaam && !nogIets
                ? ` De oude gegevens van ${oudeNaam} staan nu onder "Nog zonder wijk".`
                : ""
            }`
          : `${adresTekst(c)} hoort nu bij deze klant.`,
        { duration: 8000 },
      );
      return true;
    });
  }

  /** Een ander adres losmaken van deze klant. Het adres zelf blijft. */
  function maakLos(c: Customer) {
    if (!magBewerken || !klantIdRef.current) return Promise.resolve();
    const id = klantIdRef.current;
    return inRij(async () => {
      try {
        await koppelKlant([c.id], null);
      } catch (e) {
        toast.error("Losmaken mislukt: " + fout(e));
        return;
      }
      const pas = (old: Customer[] | undefined) =>
        old?.map((x) => (x.id === c.id ? { ...x, klant_id: null } : x));
      qc.setQueryData<Customer[]>(["customers"], pas);
      qc.setQueryData<Customer[]>(["customers", "met-inactief"], pas);
      pushUndo({
        label: `Losmaken ${adresTekst(c)}`,
        undo: async () => {
          await koppelKlant([c.id], id);
          herlaad();
        },
      });
      toast.success(`${adresTekst(c)} hoort niet meer bij deze klant`);
    });
  }

  // --- Stoppen en weer actief -------------------------------------------------
  async function stop(reden: StopReden, planningWeg: boolean) {
    const a = adresIdRef.current ? adresOp(adresIdRef.current) : null;
    if (!a || !magBewerken) return;
    await stopKlant(a, reden, planningWeg);
    setAdresExtra({ inactief_op: new Date().toISOString(), inactief_reden: reden });
    // Bij een verhuizing gaan de klantgegevens naar de prullenbak: dan hoort
    // het dossier daarna een adres zonder klant te zijn.
    if (reden === "verhuisd") {
      setGemaakteKlant(null);
      zetKlantId(null);
      void qc.invalidateQueries({ queryKey: ["klanten"] });
    }
    bewaard.current = true;
  }

  async function weerActief() {
    const a = adresIdRef.current ? adresOp(adresIdRef.current) : null;
    if (!a || !magBewerken) return;
    try {
      await zetActief([a.id]);
    } catch (e) {
      toast.error("Dat lukte niet: " + fout(e));
      return;
    }
    setAdresExtra({ inactief_op: null, inactief_reden: null });
    bewaard.current = true;
    herlaad();
    void qc.invalidateQueries({ queryKey: ["customers-inactief"] });
    toast.success(
      a.inactief_reden === "verhuisd"
        ? `${adresTekst(a)} staat weer actief. De oude klantgegevens liggen nog in de prullenbak.`
        : `${adresTekst(a)} staat weer actief.`,
    );
  }

  // --- Nieuw-stand: straat, nummer, en Toevoegen -----------------------------
  const keuzeStraten = useMemo(
    () => nieuw?.straten ?? [...streets].sort((a, b) => a.name.localeCompare(b.name, "nl")),
    [nieuw?.straten, streets],
  );
  const nieuweStraat = keuze.straat === NIEUWE_STRAAT;
  const gekozenStraat = nieuweStraat ? undefined : streets.find((s) => s.id === keuze.straat);
  /** Bestaat de nieuwe straat al in die wijk? Dan stellen we voor die te kiezen. */
  const dubbeleStraat = useMemo(() => {
    const naam = keuze.naam.trim().toLowerCase();
    if (!nieuweStraat || !naam || !wijkId) return undefined;
    return streets.find(
      (s) =>
        s.district_id === wijkId &&
        [s.name, s.volledige_naam].some((n) => n.trim().toLowerCase() === naam),
    );
  }, [nieuweStraat, keuze.naam, wijkId, streets]);
  const keuzeStraatNaam = nieuweStraat
    ? keuze.naam.trim()
    : gekozenStraat
      ? volledigeNaam(gekozenStraat)
      : "";
  const keuzePlaats = districts.find((d) => d.id === wijkId)?.plaats.trim() ?? "";

  /** Straat of nummer gewijzigd; de wijk volgt de gekozen straat. */
  function zetKeuze(patch: Partial<AdresKeuze>, andereWijk?: string) {
    const k = { ...keuze, ...patch };
    setKeuze(k);
    if ("postcode" in patch) setPostcodeZelf(true);
    const s = k.straat === NIEUWE_STRAAT ? undefined : streets.find((x) => x.id === k.straat);
    // Bij "Nieuwe straat…" blijft de wijk van de straat die je als laatste koos.
    const w = andereWijk ?? s?.district_id ?? wijkId;
    if (w !== wijkId) setWijkId(w);
  }

  // De postcode van het pand opzoeken zodra straat, nummer en plaats er zijn.
  useEffect(() => {
    if (!open || adresId || postcodeZelf) return;
    const huisnummer = `${keuze.nummer.trim()}${keuze.toevoeging.trim()}`;
    if (!keuzeStraatNaam || !huisnummer || !keuzePlaats) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekAdres({ straat: keuzeStraatNaam, huisnummer, plaats: keuzePlaats }, ac.signal).then(
        (treffer) => {
          if (treffer && !ac.signal.aborted)
            setKeuze((k) => ({ ...k, postcode: treffer.postcode }));
        },
      );
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, adresId, postcodeZelf, keuzeStraatNaam, keuze.nummer, keuze.toevoeging, keuzePlaats]);

  // Officiële straatnamen voorstellen bij een nieuwe straat.
  useEffect(() => {
    if (!open || !nieuweStraat || !keuzePlaats) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(keuze.naam, keuzePlaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setStraatSuggesties(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, nieuweStraat, keuze.naam, keuzePlaats]);

  // De postcode van het postadres opzoeken zodra straat, nummer en plaats er
  // zijn. Alleen in een leeg veld, of over wat de app er zelf in zette: wat je
  // zelf typte blijft altijd staan. Wat de app invult is geel, met Ongedaan.
  const postcodeVrij =
    !velden.postcode.trim() ||
    (postcodeOpgezocht !== null && velden.postcode === postcodeOpgezocht);
  const zoekPostcode =
    open && magBewerken && postadresGewijzigd && !postcodeNietZoeken && postcodeVrij;
  // Wisselt de klant in het open dossier (koppelen, Toevoegen), dan begint
  // het opzoeken voor hem opnieuw.
  const [postcodeVoorKlant, setPostcodeVoorKlant] = useState(klantId);
  if (postcodeVoorKlant !== klantId) {
    setPostcodeVoorKlant(klantId);
    setPostcodeOpgezocht(null);
    setPostcodeNietZoeken(false);
    setPostadresGewijzigd(false);
  }
  useEffect(() => {
    if (!zoekPostcode) return;
    const straat = velden.straat.trim();
    const huisnummer = velden.huisnummer.trim();
    const plaats = velden.plaats.trim();
    if (!straat || !huisnummer || !plaats) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekAdres({ straat, huisnummer, plaats }, ac.signal).then((treffer) => {
        if (!treffer || ac.signal.aborted) return;
        if (treffer.postcode === velden.postcode) return;
        setPostcodeOpgezocht(treffer.postcode);
        void zetKlant({ postcode: treffer.postcode });
      });
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // De postcode zelf hoort er niet bij: na het invullen opnieuw zoeken geeft
    // hetzelfde antwoord (zoekPostcode zegt al of het veld vrij is).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoekPostcode, velden.straat, velden.huisnummer, velden.plaats]);

  // Officiële straatnamen voorstellen bij het postadres, terwijl je typt: de
  // wijklijst gebruikt werknamen, en daarmee vindt de postcode niets.
  useEffect(() => {
    const plaats = velden.plaats.trim();
    if (!open || !plaats || klantStraatTyp.trim().length < 2) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(klantStraatTyp, plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setKlantStraatSuggesties(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, klantStraatTyp, velden.plaats]);

  /** De postcode van het postadres, zelf getypt: die zoekt de app niet meer op. */
  function zetKlantPostcode(tekst: string) {
    setPostcodeOpgezocht(null);
    setPostcodeNietZoeken(true);
    return zetKlant({ postcode: tekst });
  }

  /** De opgezochte postcode weer weghalen; daarna zoekt de app hem niet meer op. */
  function postcodeTerug() {
    const opgezocht = postcodeOpgezocht;
    setPostcodeOpgezocht(null);
    setPostcodeNietZoeken(true);
    if (opgezocht !== null && velden.postcode === opgezocht) void zetKlant({ postcode: "" });
  }

  /** Het adres dat je in de nieuw-stand invulde, als het al op de wijklijst staat. */
  const bestaandAdres = useMemo(() => {
    if (adresId || nieuweStraat || !keuze.straat) return undefined;
    const nr = splitsHuisnummer(`${keuze.nummer.trim()}${keuze.toevoeging.trim()}`);
    if (!nr) return undefined;
    return customers.find(
      (c) =>
        c.street_id === keuze.straat &&
        c.house_number === nr.house_number &&
        (c.addition ?? "").trim().toLowerCase() === nr.addition.toLowerCase(),
    );
  }, [adresId, nieuweStraat, keuze.straat, keuze.nummer, keuze.toevoeging, customers]);

  /**
   * De nieuw-stand aan een adres hangen dat al op de wijklijst staat, in plaats
   * van een tweede regel voor hetzelfde huis. De klant van dit dossier (of een
   * nieuwe, met wat je invulde) wordt de klant van dat adres. Prijs, frequentie
   * en notitie van dat adres blijven zoals ze waren.
   */
  async function koppelAanBestaand(doelId: string) {
    if (!magBewerken || toevoegenBezigRef.current || adresIdRef.current) return;
    setToevoegenBezig(true);
    toevoegenBezigRef.current = true;
    try {
      let vers: Customer | null;
      try {
        vers = await fetchCustomer(doelId);
      } catch (e) {
        toast.error("Koppelen mislukt: " + fout(e));
        return;
      }
      const doel = vers;
      if (!doel) {
        toast.error("Dat adres bestaat niet meer.");
        return;
      }
      if (doel.inactief_op) {
        toast.error(
          "Dit adres staat bij Inactief (gestopt of verhuisd). Zet het eerst weer actief via Klanten → Inactief; dan blijven prijs en notities bewaard.",
        );
        return;
      }
      const tekst = adresTekst(doel);
      const bestaandeKlant = klantIdRef.current;
      const metGegevens = !bestaandeKlant && heeftKlantGegevens(concept);
      const vorige = doel.klant_id ?? null;
      // Hoort het adres al bij iemand anders, dan neemt deze klant het over:
      // dat is samenvoegen, en dat vragen we eerst.
      if ((bestaandeKlant || metGegevens) && vorige && vorige !== bestaandeKlant) {
        const naam = klanten.find((k) => k.id === vorige)?.naam || "een andere klant";
        const ja = await bevestig({
          titel: "Dit adres hoort al bij een klant",
          tekst: `${tekst} hoort nu bij ${naam}. Koppel je het, dan hoort het adres bij deze klant. De gegevens van ${naam} blijven bewaard.`,
          bevestigLabel: "Koppelen",
        });
        if (!ja) return;
      }
      let nieuweKlant: Klant | null = null;
      if (metGegevens) {
        const s = straatVan(doel);
        const pa = s ? adresVanRegel(doel, s, wijkVanStraat(s)) : null;
        try {
          nieuweKlant = await bewaarKlant(null, {
            ...concept,
            straat: concept.straat.trim() ? concept.straat : (pa?.straat ?? ""),
            huisnummer: concept.huisnummer.trim() ? concept.huisnummer : (pa?.huisnummer ?? ""),
            postcode: concept.postcode.trim() ? concept.postcode : doel.postcode,
            plaats: concept.plaats.trim() ? concept.plaats : (pa?.plaats ?? ""),
          });
        } catch (e) {
          toast.error("Koppelen mislukt: " + fout(e));
          return;
        }
      }
      const nieuw = bestaandeKlant ?? nieuweKlant?.id ?? null;
      if (nieuw && nieuw !== vorige) {
        try {
          await koppelKlant([doel.id], nieuw);
        } catch (e) {
          if (nieuweKlant) await deleteKlant(nieuweKlant.id).catch(() => undefined);
          toast.error("Koppelen mislukt: " + fout(e));
          return;
        }
        const gemaakt = nieuweKlant;
        pushUndo({
          label: `Koppelen ${tekst}`,
          undo: async () => {
            await koppelKlant([doel.id], vorige);
            if (gemaakt) await deleteKlant(gemaakt.id);
            // Kijk je nog naar de klant die net is gemaakt, dan is die weg:
            // het adres hoort weer bij wie het had (zoals bij maakKlant).
            if (gemaakt && klantIdRef.current === gemaakt.id) {
              zetKlantId(vorige);
              setGemaakteKlant(null);
            }
            void qc.invalidateQueries({ queryKey: ["klanten"] });
            herlaad();
          },
        });
      }
      const klantNu = nieuw ?? vorige;
      // Eerst de verse lijsten, dan pas overschakelen (zoals bij Toevoegen).
      await Promise.all([
        qc.fetchQuery({ queryKey: ["customers"], queryFn: fetchCustomers, staleTime: 0 }),
        qc.fetchQuery({ queryKey: ["klanten"], queryFn: fetchKlanten, staleTime: 0 }),
      ]).catch(() => undefined);
      laatstBekend.current = { ...doel, klant_id: klantNu };
      if (nieuweKlant) {
        setGemaakteKlant(nieuweKlant);
        klantGemaaktOp.current = Date.now();
      }
      zetAdresId(doel.id);
      zetKlantId(klantNu);
      const pandIngevuld =
        pandConcept.price > 0 ||
        Boolean(pandConcept.note.trim()) ||
        pandConcept.interval_maanden > 0;
      const nietAangepast = pandIngevuld
        ? " Prijs, frequentie en notitie van dat adres zijn niet aangepast."
        : "";
      toast.success(
        nieuw && nieuw !== vorige
          ? `Gekoppeld aan ${tekst}, dat al op de wijklijst stond.${nietAangepast}`
          : `${tekst} stond al op de wijklijst.${nietAangepast}`,
        { duration: 8000 },
      );
      invoer.onSaved(doel.id);
      bewaard.current = false;
    } finally {
      setToevoegenBezig(false);
      toevoegenBezigRef.current = false;
    }
  }

  /** Het adres aanmaken; daarna gaat het dossier verder in de bewaar-meteen-stand. */
  async function toevoegen() {
    if (!magBewerken || toevoegenBezig || adresIdRef.current) return;
    if (nieuweStraat ? !keuze.naam.trim() : !keuze.straat) {
      toast.error(nieuweStraat ? "Vul de naam van de nieuwe straat in." : "Kies een straat.");
      return;
    }
    if (nieuweStraat && !wijkId) {
      toast.error("Kies in welke wijk de nieuwe straat komt.");
      return;
    }
    if (dubbeleStraat) {
      toast.error(
        `In ${districts.find((d) => d.id === wijkId)?.name ?? "die wijk"} staat al ${volledigeNaam(dubbeleStraat)}. Kies die in de lijst.`,
      );
      return;
    }
    // "12a" in het nummervak telt ook: dan is de a de toevoeging.
    const nr = splitsHuisnummer(`${keuze.nummer.trim()}${keuze.toevoeging.trim()}`);
    if (!nr) {
      toast.error("Vul een huisnummer in.");
      return;
    }
    // Staat dit huis al op de wijklijst, dan koppelen we aan dat adres; prijs
    // en frequentie zijn dan niet nodig, want die heeft dat adres al.
    if (bestaandAdres) {
      await koppelAanBestaand(bestaandAdres.id);
      return;
    }
    if (prijzenZien && !(pandConcept.price > 0)) {
      toast.error("Vul een prijs in.");
      return;
    }
    if (!pandConcept.interval_maanden) {
      toast.error("Kies een frequentie.");
      return;
    }
    setToevoegenBezig(true);
    toevoegenBezigRef.current = true;
    const bestaandeKlant = klantIdRef.current;
    /** Bleek het adres toch al te bestaan (de lijst hier was nog niet bij). */
    let alBestaand: string | null = null;
    try {
      const uit = await maakNieuwAdres({
        straat: nieuweStraat ? { wijkId, naam: keuze.naam.trim() } : { id: keuze.straat },
        huisnummer: `${nr.house_number}${nr.addition}`,
        pand: {
          note: pandConcept.note,
          interval_maanden: pandConcept.interval_maanden,
          ritme: pandConcept.ritme,
          overslaan: pandConcept.overslaan,
          start_maand: pandConcept.start_maand,
          markering: pandConcept.markering,
          eigen_blok: pandConcept.eigen_blok,
          ...(pandConcept.duur_min !== null
            ? { duur_min: pandConcept.duur_min, duur_zelf: pandConcept.duur_zelf }
            : {}),
          // De postcode hoort bij het pand, niet bij de bewoner.
          postcode: keuze.postcode,
          betaalmethode: pandConcept.betaalmethode,
          maandwerk: pandConcept.maandwerk,
        },
        prijs: prijzenZien ? pandConcept.price : null,
        // Een klant die er al is (zonder adres) koppelen we hierna; anders
        // komt er een klant bij als er iets van hem ingevuld is.
        klant: bestaandeKlant
          ? null
          : {
              ...concept,
              straat: concept.straat.trim() ? concept.straat : keuzeStraatNaam,
              huisnummer: concept.huisnummer.trim()
                ? concept.huisnummer
                : `${nr.house_number}${nr.addition}`,
              postcode: concept.postcode.trim() ? concept.postcode : keuze.postcode,
              plaats: concept.plaats.trim() ? concept.plaats : keuzePlaats,
            },
        plek: (id) =>
          nieuw?.plekVoor
            ? nieuw.plekVoor(id)
            : id === nieuw?.streetId && nieuw.sortOrder !== undefined
              ? nieuw.sortOrder
              : plekAchteraan(customers, id),
        // Gaat er na de nieuwe straat iets mis, dan die straat gekozen
        // houden: nog eens toevoegen maakt hem anders twee keer aan.
        opStraat: (id) => {
          void qc.invalidateQueries({ queryKey: ["streets"] });
          setKeuze((k) => ({ ...k, straat: id, naam: "" }));
        },
      });
      const mislukt = [...uit.mislukt];
      if (bestaandeKlant) {
        await koppelKlant([uit.adresId], bestaandeKlant).catch((e: unknown) =>
          mislukt.push(`het koppelen aan de klant (${fout(e)})`),
        );
      }
      // Eerst de verse lijsten, dan pas overschakelen: anders staat er even
      // een leeg dossier.
      await Promise.all([
        qc.fetchQuery({ queryKey: ["customers"], queryFn: fetchCustomers, staleTime: 0 }),
        qc.fetchQuery({ queryKey: ["streets"], queryFn: fetchStreets, staleTime: 0 }),
        uit.klantId
          ? qc.fetchQuery({ queryKey: ["klanten"], queryFn: fetchKlanten, staleTime: 0 })
          : null,
      ]).catch(() => undefined);
      zetAdresId(uit.adresId);
      if (uit.klantId) zetKlantId(uit.klantId);
      if (mislukt.length > 0) {
        toast.error(`Het adres is toegevoegd, maar ${mislukt.join(" en ")} niet.`, {
          duration: 10000,
        });
      } else {
        toast.success(uit.klantId || bestaandeKlant ? "Klant toegevoegd" : "Adres toegevoegd");
      }
      invoer.onSaved(uit.adresId);
      bewaard.current = false;
    } catch (e) {
      if (e instanceof AdresBestaatAl) alBestaand = e.adresId;
      else toast.error("Toevoegen mislukt: " + fout(e));
    } finally {
      setToevoegenBezig(false);
      toevoegenBezigRef.current = false;
    }
    if (alBestaand) {
      const ja = await bevestig({
        titel: "Dit adres staat al op de wijklijst",
        tekst:
          "Er komt geen tweede regel voor hetzelfde huis. Koppel aan dat adres; prijs, frequentie en notitie van dat adres blijven zoals ze zijn.",
        bevestigLabel: "Koppel aan dat adres",
      });
      if (ja) await koppelAanBestaand(alBestaand);
    }
  }

  // --- Sluiten -----------------------------------------------------------------
  /** Staat er in de nieuw-stand iets ingevuld dat nog niet toegevoegd is? */
  const conceptGewijzigd =
    zonderAdres &&
    JSON.stringify({
      c: concept,
      p: { ...pandConcept, created_at: "" },
      // Een postcode die de app zelf opzocht, is geen invoer van jou.
      k: postcodeZelf ? keuze : { ...keuze, postcode: "" },
    }) !== beginConcept.current;

  async function sluit() {
    if (conceptGewijzigd && magBewerken) {
      const weg = await bevestig({
        titel: "Nog niet toegevoegd",
        tekst:
          "Je hebt een adres ingevuld maar nog niet toegevoegd. Tik op Terug om het toe te voegen.",
        bevestigLabel: "Weggooien",
        annuleerLabel: "Terug",
        gevaarlijk: true,
      });
      if (!weg) return;
    }
    invoer.onOpenChange(false);
    // Eén tik later: een veld dat door het sluiten zijn focus verliest, zet
    // zijn opslag dan nog in de rij. Pas als alles binnen is, mag de pagina
    // verversen; anders haalt ze de oude waarde op.
    setTimeout(() => {
      void rij.current.then(() => {
        if (bewaard.current) invoer.onSaved();
      });
    }, 0);
  }

  /** De nieuw-stand verlaten voor een ander adres: staat er iets ingevuld
   *  dat nog niet is toegevoegd, dan eerst vragen (zoals bij Sluiten). */
  async function magNieuwVerlaten(): Promise<boolean> {
    if (!conceptGewijzigd || !magBewerken) return true;
    return bevestig({
      titel: "Nog niet toegevoegd",
      tekst:
        "Je hebt een adres ingevuld maar nog niet toegevoegd. Ga je verder, dan is wat je invulde weg.",
      bevestigLabel: "Verder",
      annuleerLabel: "Terug",
      gevaarlijk: true,
    });
  }

  function naarTab(t: DossierTab) {
    setTab(t);
    setStap("tab");
  }

  return {
    // wat
    adres,
    adresId,
    klant,
    /** Alleen als de klant er echt is (niet in de prullenbak). */
    klantId: klant ? klantId : null,
    velden,
    pand,
    zonderAdres,
    wijk,
    adresStraat,
    methode,
    titel: adres ? adresTekst(adres) : "Nieuw adres",
    adresTekst,
    streets,
    customers,
    klanten,
    districts,
    quickNotes: invoer.quickNotes,
    onAddQuickNote: invoer.onAddQuickNote,
    andereAdressen,
    markeringen,
    openKlussen,
    openKlachten,
    ongelezen,
    nieuwTeller: ongelezen + openKlachten,
    laatsteMail: laatsteMail.data ?? null,
    geld: geld.data ?? null,
    volgendeBeurt: volgendeBeurt.data ?? null,
    gewassen,
    vandaag,
    dezeMaand,
    jaar,
    telefoon,
    email,
    whatsappNummer,
    routeAdres,
    kanMailen,
    kanBetalen,
    opRouteVandaag: volgendeBeurt.data?.datum === vandaag,
    telDagen: () => geplandeDagen(adresId ? [adresId] : []),
    // rechten
    mobiel,
    isEigenaar,
    magBewerken,
    /** Velden uit: geen recht, of het adres wordt net toegevoegd. */
    alleenLezen: !magBewerken || toevoegenBezig,
    magPlanOfBewerken,
    magPlannen,
    prijzenZien,
    magMailLezen,
    magKlachten,
    // navigatie
    tab,
    stap,
    naarTab,
    naarMenu: () => setStap("menu"),
    sluit,
    dialoog,
    setDialoog,
    // bewaren
    zetKlant,
    zorgVoorKlant,
    zetKlantPostcode,
    postcodeOpgezocht:
      postcodeOpgezocht !== null && velden.postcode === postcodeOpgezocht
        ? postcodeOpgezocht
        : null,
    postcodeTerug,
    typKlantStraat: setKlantStraatTyp,
    klantStraatSuggesties,
    zetPand,
    zetOverslaan,
    zetMaandwerk,
    openAdres,
    magNieuwVerlaten,
    koppelAdres,
    maakLos,
    stop,
    weerActief,
    maakKlus,
    // nieuw-stand
    keuze,
    zetKeuze,
    wijkId,
    keuzeStraten,
    nieuweStraat,
    dubbeleStraat,
    straatSuggesties,
    bestaandAdres,
    koppelAanBestaand,
    toevoegen,
    toevoegenBezig,
  };
}

export type Dossier = ReturnType<typeof useDossier>;

/** De velden zonder id, zodat het formulier precies de bewerkbare kolommen houdt. */
function stripId(k: Klant): KlantVelden {
  const { id: _id, ...rest } = k;
  return rest;
}
