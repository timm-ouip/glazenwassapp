import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BetaalwijzeKiezer } from "@/components/betalingen/BetaalwijzeKiezer";
import { DossierGeld } from "@/components/dossier/DossierGeld";
import { BetaalIcoon } from "@/components/betalingen/BetaalIcoon";
import { GeldloopWijzigingenVak } from "@/components/betalingen/GeldloopWijzigingenVak";
import { effectieveMethode, type Betaalmethode } from "@/lib/betalingen";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBevestig } from "@/components/Bevestig";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupPaar,
  PopupScheiding,
  PopupTab,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  IconCalendar as CalendarDays,
  IconClock as Clock,
  IconCalendarOff as CalendarOff,
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconFlag as Flag,
  IconHammer as Hammer,
  IconMessageExclamation as MessageSquareWarning,
  IconCash as Cash,
  IconHash as Hash,
  IconHome as House,
  IconLink as Link2,
  IconMail as Mail,
  IconMapPin as MapPin,
  IconMessage as MessageSquare,
  IconPalette as Palette,
  IconPhone as Phone,
  IconSignRight as Signpost,
  IconUser as User,
  IconX as X,
} from "@tabler/icons-react";
import { NotitieCel } from "@/components/NotitieCel";
import { useRecht } from "@/lib/rechten";
import {
  adresVanRegel,
  bewaarKlant,
  formatNumber,
  formatPrice,
  INTERVALLEN,
  intervalLabels,
  komendeMaanden,
  maandSleutel,
  koppelKlant,
  fetchMarkeringen,
  tintStip,
  patchCustomer,
  ritmeLabel,
  ritmeMaanden,
  ritmeVarianten,
  schuifStartOp,
  toonMaand,
  toonMaandKort,
  vorigeMaand,
  zelfdeRitme,
  zorgVoorAdres,
  type Customer,
  type District,
  type Klant,
  leesDuur,
  type Maandwerk,
  type Markering,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { zoekAdres, zoekStraten } from "@/lib/postcode";
import { opslaanBijEnter } from "@/lib/dialoog";
import { blijvenLiggen, fetchKlussen, nieuweKlus, staatOpen } from "@/lib/klussen";
import { toonDatum } from "@/lib/wasdag";
import { KlusDialog } from "@/components/KlusDialog";
import { DossierKlachten } from "@/components/dossier/DossierKlachten";
import { fetchKlachtenVanKlant } from "@/lib/klachten";

// Pas laden als je het tabblad Mail opent: dit trekt het hele mailprogramma
// mee, en het dossier zit op de wijkenpagina, die daardoor trager opende.
const DossierMail = lazy(() =>
  import("@/components/dossier/DossierMail").then((m) => ({ default: m.DossierMail })),
);
const DossierWhatsApp = lazy(() =>
  import("@/components/dossier/DossierWhatsApp").then((m) => ({ default: m.DossierWhatsApp })),
);

/** Kon het mailgedeelte niet laden (slecht bereik, of er ging intussen een
 *  nieuwe versie live), dan alleen hier een melding — niet de hele pagina kwijt. */
class MailLaadFout extends Component<{ children: ReactNode }, { fout: boolean }> {
  override state = { fout: false };
  static getDerivedStateFromError() {
    return { fout: true };
  }
  override render() {
    if (!this.state.fout) return this.props.children;
    return (
      <p className="text-sm text-muted-foreground">
        Mail kon niet laden.{" "}
        <button type="button" className="underline" onClick={() => window.location.reload()}>
          Herlaad de pagina
        </button>
      </p>
    );
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  klant: Klant | null;
  /** De adresregel waar dit dossier over gaat. Ontbreekt hij, dan wordt het
   *  adres bij opslaan aangemaakt uit straat, huisnummer en wijk. */
  voorstelCustomer?: Customer | null;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
  onAddQuickNote: (label: string) => void;
  /** De wijk die de pagina toont; daar belandt een nieuw adres in. */
  standaardWijkId?: string | null;
  onSaved: () => void;
}

/**
 * Alles wat bij het adres hoort en niet bij de persoon: wat het kost, hoe
 * vaak, wat erbij staat en in welke maanden het anders loopt.
 *
 * Dit stond eerder verspreid over de wijklijst — het meerwerk in het
 * notitieveld, de kleur en de pauzes achter de rechtermuisknop. Hier staat
 * het bij elkaar, zodat je één plek hebt om een adres na te lopen.
 */
interface Pand {
  price: string;
  /** Hoe lang dit adres duurt, in minuten; leeg is: nog niet ingevuld. */
  duur: string;
  duurZelf: boolean;
  /** Eigen blok in de dagweergave: null = automatisch (op de duur). */
  eigenBlok: boolean | null;
  interval_maanden: number;
  ritme: number;
  note: string;
  maandwerk: Maandwerk[];
  overslaan: string[];
  start_maand: string;
  markering: Markering;
  /** Contant of overmaken; leeg = zoals de wijk. */
  betaalmethode: Betaalmethode | null;
}

const LEEG_PAND: Pand = {
  price: "",
  duur: "",
  duurZelf: false,
  eigenBlok: null,
  interval_maanden: 1,
  ritme: 1,
  note: "",
  maandwerk: [],
  overslaan: [],
  start_maand: "",
  markering: "",
  betaalmethode: null,
};

function pandVan(c: Customer): Pand {
  return {
    price: c.price ? String(c.price) : "",
    duur: c.duur_min === null || c.duur_min === undefined ? "" : String(c.duur_min),
    duurZelf: c.duur_zelf ?? false,
    eigenBlok: c.eigen_blok ?? null,
    interval_maanden: c.interval_maanden || 1,
    ritme: c.ritme || 1,
    note: c.note ?? "",
    maandwerk: c.maandwerk ?? [],
    // Op volgorde, zoals opslaan het ook bewaart: anders ziet het sluiten
    // een verschil na aan- en weer uitvinken van een maand.
    overslaan: [...(c.overslaan ?? [])].sort(),
    start_maand: c.start_maand ?? "",
    markering: c.markering ?? "",
    betaalmethode: c.betaalmethode ?? null,
  };
}

/** De keuze "meteen" heeft geen maand; Radix wil wel een echte waarde. */
const METEEN = "meteen";

function prijsGetal(waarde: string) {
  const n = Number(waarde.replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

const LEEG = {
  naam: "",
  email: "",
  email2: "",
  telefoon: "",
  telefoon2: "",
  straat: "",
  huisnummer: "",
  postcode: "",
  plaats: "",
  notitie: "",
};

export function KlantgegevensDialog({
  open,
  onOpenChange,
  klant,
  voorstelCustomer,
  districts,
  streets,
  customers,
  klanten,
  quickNotes,
  onAddQuickNote,
  standaardWijkId,
  onSaved,
}: Props) {
  // De zelfgemaakte kleuren komen hier rechtstreeks binnen: dit schermpje
  // wordt vanaf twee pagina's geopend, en dan is één query minder gedoe dan
  // hem overal doorgeven. React Query deelt hem met de rest.
  const markeringen = useQuery({ queryKey: ["markeringen"], queryFn: fetchMarkeringen }).data ?? [];
  const qc = useQueryClient();
  // Wat er nog openstaat aan extra werk voor dít adres. Openstaand werk is
  // niet aan een maand gebonden, dus er is geen periode om op te vragen.
  const klussen = useQuery({ queryKey: ["klussen"], queryFn: () => fetchKlussen() }).data ?? [];
  const [klusOpen, setKlusOpen] = useState(false);
  /** Welk tabblad je bekijkt: de persoon, het adres, het losse werk, de mail
   *  of de klachten. Korte schermen in plaats van één lange lap om doorheen te
   *  scrollen. Mail en klachten horen bij de persoon, dus die zijn er alleen
   *  als er een klant is. */
  const [tab, setTab] = useState<"klant" | "adres" | "werk" | "mail" | "klachten" | "geld">(
    "klant",
  );
  const mobiel = useIsMobile();
  const bevestig = useBevestig();
  /** Op de telefoon: het onderblad, het overzicht, of één onderdeel. */
  const [stap, setStap] = useState<"blad" | "overzicht" | "tab">("blad");
  // Mail kan privé zijn: alleen wie mail mag lezen ziet dat tabblad.
  const magMailLezen = useRecht("mail_lezen");
  const klachten = useQuery({
    queryKey: ["klachten", klant?.id],
    queryFn: () => fetchKlachtenVanKlant(klant!.id),
    enabled: open && !!klant,
  });
  const openKlachten = (klachten.data ?? []).filter((k) => k.status === "open").length;
  const [velden, setVelden] = useState(LEEG);
  const [pand, setPand] = useState<Pand>(LEEG_PAND);
  /** Ids van de overige adressen van deze klant — de uitzondering. */
  const [extra, setExtra] = useState<string[]>([]);
  const [koppelOpen, setKoppelOpen] = useState(false);
  const [wijkId, setWijkId] = useState("");
  const [saving, setSaving] = useState(false);
  // Zonder dit recht geen prijsveld, en geen prijs meesturen bij opslaan.
  const prijzenZien = useRecht("prijzen_zien");
  // Wie klanten alleen mag bekijken, ziet het dossier maar kan niets wijzigen:
  // de database zou het opslaan toch weigeren.
  const magBewerken = useRecht("klanten_bewerken");
  // Zodra de gebruiker zelf een postcode typt, houdt de opzoeking zijn mond.
  const [postcodeHandmatig, setPostcodeHandmatig] = useState(false);
  const [straatSuggesties, setStraatSuggesties] = useState<string[]>([]);

  const beginKoppeling = useRef<string[]>([]);
  /** Hoe het formulier er bij openen uitzag, om te zien of je iets wijzigde. */
  const beginStand = useRef<{
    velden: typeof LEEG;
    pand: Pand;
    extra: string[];
    wijkId: string;
  } | null>(null);

  /** Het adres waar dit dossier over gaat; null als het nog niet bestaat. */
  const dossierCustomer = voorstelCustomer ?? null;
  /** Straat, nummer en plaats van dat pand, voluit. */
  const pandStraat = dossierCustomer
    ? streets.find((s) => s.id === dossierCustomer.street_id)
    : undefined;
  const pandAdres =
    dossierCustomer && pandStraat
      ? adresVanRegel(
          dossierCustomer,
          pandStraat,
          districts.find((d) => d.id === pandStraat.district_id),
        )
      : null;
  /** Gaat het adres in het formulier over dit pand? Met een klant erbij staat
   *  daar zíjn adres; meestal is dat hetzelfde huis, maar niet altijd. */
  const gelijk = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const formulierIsPand =
    !klant ||
    (pandAdres !== null &&
      gelijk(velden.straat, pandAdres.straat) &&
      gelijk(velden.huisnummer, pandAdres.huisnummer));
  const openKlussen = klussen.filter((k) => k.customer_id === dossierCustomer?.id && staatOpen(k));

  function zet(patch: Partial<typeof LEEG>) {
    setVelden((v) => ({ ...v, ...patch }));
  }

  // Plaatsen die al gebruikt worden, meest voorkomende eerst: die is bijna
  // altijd de goede, want een glazenwasser werkt in één stad.
  const plaatsen = useMemo(() => {
    const telling = new Map<string, number>();
    for (const k of klanten) {
      const p = k.plaats.trim();
      if (p) telling.set(p, (telling.get(p) ?? 0) + 1);
    }
    return [...telling.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [klanten]);

  useEffect(() => {
    if (!open) return;
    const straatVan = (c: Customer | null) =>
      c ? streets.find((s) => s.id === c.street_id) : undefined;
    const wijkVan = (s: Street | undefined) => districts.find((d) => d.id === s?.district_id);

    let beginVelden: typeof LEEG;
    if (klant) {
      beginVelden = stripId(klant);
    } else if (voorstelCustomer) {
      // Vanuit een regel op de lijst: het adres is al bekend.
      const straat = straatVan(voorstelCustomer);
      const adres = straat
        ? adresVanRegel(voorstelCustomer, straat, wijkVan(straat))
        : { straat: "", huisnummer: "", plaats: "" };
      // De postcode van het pand zelf, niet leeg: anders schreef Opslaan een
      // lege of opgezochte postcode over die van het huis heen.
      beginVelden = { ...LEEG, ...adres, postcode: voorstelCustomer.postcode ?? "" };
    } else {
      // De plaats van de wijk waar je in werkt wint van de meest gebruikte
      // plaats: Testwijk ligt in Den Haag, ook al staan de meeste klanten in
      // Gouda. Met de verkeerde plaats vindt de postcode-opzoeking niets.
      const wijkPlaats = districts.find((d) => d.id === standaardWijkId)?.plaats.trim();
      beginVelden = { ...LEEG, plaats: wijkPlaats || (plaatsen[0] ?? "") };
    }
    setVelden(beginVelden);

    // Wat er nú aan de klant hangt, tegenover wat er straks aan moet hangen.
    // `save()` leidt uit het verschil af wat er gekoppeld en losgemaakt wordt.
    const bestaand = klant ? customers.filter((c) => c.klant_id === klant.id).map((c) => c.id) : [];
    beginKoppeling.current = bestaand;
    setExtra(bestaand.filter((id) => id !== voorstelCustomer?.id));

    const beginPand = voorstelCustomer ? pandVan(voorstelCustomer) : LEEG_PAND;
    const beginWijk =
      straatVan(voorstelCustomer ?? null)?.district_id ?? standaardWijkId ?? districts[0]?.id ?? "";
    setPand(beginPand);
    setWijkId(beginWijk);
    beginStand.current = {
      velden: beginVelden,
      pand: beginPand,
      extra: bestaand.filter((id) => id !== voorstelCustomer?.id),
      wijkId: beginWijk,
    };
    setKoppelOpen(false);
    setTab("klant");
    // Een nieuw adres heeft nog niets om snel te bekijken: meteen de lijst.
    setStap(voorstelCustomer ? "blad" : "overzicht");
    // Staat er al een postcode, dan zoekt de app er niet overheen.
    setPostcodeHandmatig(Boolean(beginVelden.postcode));
    // Alleen bij openen opnieuw vullen; verder is dit een vrij formulier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, klant, voorstelCustomer]);

  // Postcode opzoeken zodra straat, huisnummer en plaats compleet zijn.
  useEffect(() => {
    if (!open || postcodeHandmatig) return;
    const { straat, huisnummer, plaats } = velden;
    if (!straat.trim() || !huisnummer.trim() || !plaats.trim()) return;

    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekAdres({ straat, huisnummer, plaats }, ac.signal).then((treffer) => {
        if (!treffer || ac.signal.aborted) return;
        setVelden((v) => ({ ...v, postcode: treffer.postcode, plaats: treffer.plaats }));
        // Wat de app zelf invult is geen wijziging van jou: daar hoeft het
        // sluiten niet om te vragen.
        const begin = beginStand.current;
        if (begin && begin.velden.straat === straat && begin.velden.huisnummer === huisnummer) {
          begin.velden = { ...begin.velden, postcode: treffer.postcode, plaats: treffer.plaats };
        }
      });
    }, 400);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, postcodeHandmatig, velden.straat, velden.huisnummer, velden.plaats]);

  // Officiële straatnamen voorstellen. De wijklijst gebruikt afkortingen
  // ("Othilde" voor "Gravin Othildehof"); daarmee vindt de postcode-opzoeking
  // niets, dus hier hoort de volledige naam te staan.
  useEffect(() => {
    if (!open || !velden.plaats.trim()) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(velden.straat, velden.plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setStraatSuggesties(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, velden.straat, velden.plaats]);

  const straatNaam = (id: string) => streets.find((s) => s.id === id)?.name ?? "";
  const klantNaam = (id: string | null) => klanten.find((k) => k.id === id)?.naam ?? "";
  const wijkNaamVan = (streetId: string) => {
    const s = streets.find((x) => x.id === streetId);
    return districts.find((d) => d.id === s?.district_id)?.name ?? "";
  };
  const adresTekst = (c: Customer) => `${straatNaam(c.street_id)} ${formatNumber(c)}`;

  /** Adressen die je er nog bij kunt koppelen — ook die van een andere klant,
   *  want juist dat is het samenvoeggeval. */
  const koppelbaar = useMemo(
    () => customers.filter((c) => c.id !== dossierCustomer?.id && !extra.includes(c.id)),
    [customers, dossierCustomer, extra],
  );

  /** Loopt er al een opslag? Een tweede Enter maakte anders alles dubbel
   *  (twee klanten, twee adressen); de uitgezette knop hield alleen klikken tegen. */
  const opslaanBezig = useRef(false);
  async function save() {
    if (opslaanBezig.current) return;
    opslaanBezig.current = true;
    try {
      await bewaar();
    } finally {
      opslaanBezig.current = false;
    }
  }

  async function bewaar() {
    if (!magBewerken) return;
    // Een naam is niet verplicht: die ken je niet altijd, en een telefoon-
    // nummer of gekoppeld adres is op zichzelf al genoeg om te bewaren. Alleen
    // een dossier waar helemaal niets in staat heeft geen zin.
    const leeg =
      Object.values(velden).every((v) => !v.trim()) && !dossierCustomer && extra.length === 0;
    if (leeg) {
      toast.error("Vul iets in, of koppel een adres.");
      return;
    }
    setSaving(true);
    const nu = new Date().toISOString();
    try {
      // Een klantrecord alleen aanmaken als er ook echt iemand achter zit.
      // Vanaf de wijkenpagina open je dit schermpje vaak om alleen de prijs
      // of een pauze te wijzigen; dan hoort er geen naamloze klant bij te
      // komen die je daarna onder "Nog zonder wijk" weer moet opruimen.
      const persoonlijk = Boolean(
        velden.naam.trim() ||
        velden.email.trim() ||
        velden.email2.trim() ||
        velden.telefoon.trim() ||
        velden.telefoon2.trim() ||
        velden.notitie.trim(),
      );
      // Bestaat het adres nog niet op een wijklijst, dan maken we het nu aan:
      // de klantenpagina en de wijkenlijst horen hetzelfde te laten zien.
      // Vóór de klant: staat het adres bij Inactief, dan stopt het hier, en
      // blijft er geen losse klant achter (en bij nog eens proberen geen tweede).
      let adresId = dossierCustomer?.id ?? null;
      let aangemaakt = false;
      /** Alleen gezet bij een adres dat al bestond: zijn postcode van nu. */
      let bestaandePostcode: string | null = null;
      if (!adresId && wijkId && velden.straat.trim() && velden.huisnummer.trim()) {
        const gevonden = await zorgVoorAdres(wijkId, velden.straat, velden.huisnummer);
        adresId = gevonden?.id ?? null;
        // Het kan ook een adres zijn dat al op de wijklijst stond. Dat is dan
        // alleen gevonden, niet nieuw.
        aangemaakt = gevonden?.nieuw ?? false;
        bestaandePostcode = gevonden && !gevonden.nieuw ? gevonden.postcode : null;
      }

      const klantId =
        klant || persoonlijk || extra.length > 0
          ? (await bewaarKlant(klant?.id ?? null, velden)).id
          : null;

      const alles = [adresId, ...extra].filter((id): id is string => Boolean(id));
      const was = beginKoppeling.current;

      // Wie raakt er een adres kwijt doordat we het overnemen? Dát is het
      // samenvoegen: twee regels blijken dezelfde meneer.
      const overgenomen = klantId
        ? customers.filter((c) => alles.includes(c.id) && c.klant_id && c.klant_id !== klantId)
        : [];

      if (klantId) {
        await koppelKlant(
          alles.filter((id) => !was.includes(id)),
          klantId,
        );
      }
      await koppelKlant(
        was.filter((id) => !alles.includes(id)),
        null,
      );

      // Prijs, ritme, notitie, kleur en de maanden horen bij dít adres. De
      // bijgekoppelde adressen houden de hunne; die bewerk je in hun eigen
      // dossier. Een adres dat al bestond maar niet het adres van dit dossier
      // was, blijft zoals het is: het formulier stond dan leeg (prijs 0, geen
      // notitie), en dat hoort niet over zijn gegevens heen.
      /**
       * Wat er op het pand komt als postcode; null is: laat hem staan.
       * Een nieuw adres krijgt wat er in het veld staat. Een bestaand adres
       * alleen een nieuwe, niet-lege postcode, en alleen als het formulier
       * over dít huis gaat: met een klant erbij staat daar het adres van de
       * persoon, en dat kan een ander huis zijn (zie formulierIsPand).
       */
      const veldPostcode = velden.postcode.trim();
      const pandPostcode = aangemaakt
        ? veldPostcode
        : dossierCustomer &&
            formulierIsPand &&
            veldPostcode &&
            veldPostcode !== (dossierCustomer.postcode ?? "")
          ? veldPostcode
          : null;
      if (adresId && (dossierCustomer || aangemaakt)) {
        // Dezelfde regel als in de wijklijst: een adres dat nog moet
        // beginnen en dat je zijn startmaand laat overslaan, begint gewoon
        // later — anders staan er twee badges die hetzelfde zeggen.
        await patchCustomer(
          adresId,
          schuifStartOp(dossierCustomer ?? { start_maand: "", created_at: nu, overslaan: [] }, {
            ...(prijzenZien ? { price: prijsGetal(pand.price) } : {}),
            ...(leesDuur(pand.duur) !== undefined
              ? { duur_min: leesDuur(pand.duur) ?? null, duur_zelf: pand.duurZelf }
              : {}),
            eigen_blok: pand.eigenBlok,
            note: pand.note.trim(),
            // De postcode hoort bij het pand, niet bij de bewoner — en de
            // klantenlijst leest hem daar ook vandaan.
            ...(pandPostcode !== null ? { postcode: pandPostcode } : {}),
            interval_maanden: pand.interval_maanden,
            ritme: pand.ritme,
            maandwerk: pand.maandwerk,
            overslaan: [...pand.overslaan].sort(),
            start_maand: pand.start_maand,
            markering: pand.markering,
            // Alleen meesturen als het verandert: de database laat dit alleen
            // toe voor wie klanten bewerkt.
            ...(pand.betaalmethode !== (dossierCustomer?.betaalmethode ?? null)
              ? { betaalmethode: pand.betaalmethode }
              : {}),
          }),
        );
      } else if (adresId && bestaandePostcode === "" && velden.postcode.trim()) {
        // Een gevonden adres houdt zijn eigen gegevens. Alleen een postcode
        // die er nog niet was, zetten we erbij.
        await patchCustomer(adresId, { postcode: velden.postcode.trim() });
      }

      // De klant die het adres kwijtraakt laten we staan. Hij houdt misschien
      // geen adres meer over, maar dan verschijnt hij onder "Nog zonder wijk"
      // en gooi je hem daar zelf weg. Dat automatisch doen ging mis: het
      // oordeel steunt op `customers` zoals die was toen de dialoog opende,
      // en die lijst kan verouderd zijn — dan legt hij de verkeerde klant weg.
      // Gegevens wegvegen hoort niet van zo'n gok af te hangen.
      const verweesd = overgenomen
        .map((c) => klantNaam(c.klant_id))
        .filter((n, i, a) => n && a.indexOf(n) === i);

      // Stond het adres al op de wijklijst, dan zeggen we dat zijn gegevens
      // niet zijn aangepast: wie een prijs invulde, moet dat weten.
      const bestondAl = Boolean(adresId) && !dossierCustomer && !aangemaakt;
      const nietAangepast = bestondAl ? " Prijs en notitie van dat adres zijn niet aangepast." : "";

      if (overgenomen.length > 0) {
        toast.success(
          `Samengevoegd: ${overgenomen.map(adresTekst).join(", ")} ${
            overgenomen.length === 1 ? "hoort" : "horen"
          } nu bij deze klant.${
            verweesd.length > 0
              ? ` De oude gegevens van ${verweesd.join(" en ")} staan nu onder "Nog zonder wijk".`
              : ""
          }${nietAangepast}`,
          { duration: 8000 },
        );
      } else if (aangemaakt) {
        toast.success(`Klant opgeslagen en toegevoegd aan ${velden.straat.trim()} in de wijklijst`);
      } else if (bestondAl) {
        toast.success(
          klantId
            ? `Gekoppeld aan ${velden.straat.trim()} ${velden.huisnummer.trim()}, dat al op de wijklijst stond.${nietAangepast}`
            : `${velden.straat.trim()} ${velden.huisnummer.trim()} stond al op de wijklijst.${nietAangepast}`,
          { duration: 8000 },
        );
      } else if (alles.length === 0) {
        toast.success("Klant opgeslagen — nog niet aan een adres in een wijk gekoppeld");
      } else if (!klantId) {
        toast.success("Adres bijgewerkt");
      } else {
        toast.success(klant ? "Klant bijgewerkt" : "Klant toegevoegd");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const nieuwAdres = !dossierCustomer && Boolean(velden.straat.trim() && velden.huisnummer.trim());

  /** Sinds wanneer dit adres op de lijst staat. Bij een wijk die je in één
   *  keer geïmporteerd hebt is dat de dag van die import — de app houdt geen
   *  apart importstempel bij, dus verder kan hij die twee niet uit elkaar. */
  const sindsMaand = dossierCustomer ? maandSleutel(new Date(dossierCustomer.created_at)) : "";
  const klantSinds = sindsMaand
    ? `${dossierCustomer?.geimporteerd ? "geïmporteerd op" : "klant sinds"} ${toonMaandKort(
        sindsMaand,
      )} ${sindsMaand.slice(0, 4)}`
    : undefined;

  /** De ankermaanden waar je uit kiest bij om de 2, 3, 6 of 12 maanden. */
  const ritmeKeuzes = ritmeVarianten(pand.interval_maanden);
  /** De kalendermaanden waarin dit adres sowieso langskomt — het meerwerk-
   *  rooster laat de andere maanden daardoor anders zien. */
  const beurtMaanden = ritmeMaanden(pand).map((m) => String(m).padStart(2, "0"));
  /** Twaalf maanden vooruit: waar je een pauze of een startmaand uit kiest. */
  const maandenVooruit = komendeMaanden();

  const tabInhoud = (
    <>
      {dossierCustomer && (tab === "klant" || tab === "adres") && (
        <GeldloopWijzigingenVak adresId={dossierCustomer.id} />
      )}
      {!magBewerken && (
        <p className="mb-3 rounded-[12px] bg-accent/50 px-3 py-2 text-[12.5px] text-muted-foreground">
          Je kunt dit dossier bekijken, maar je rol mag het niet wijzigen.
        </p>
      )}
      {/* Zonder bewerkrecht staat alles hierbinnen uit: velden, keuzes en knoppen. */}
      <fieldset disabled={!magBewerken} className="contents">
        {tab === "klant" && (
          <>
            <PopupBlok label="De klant" terzijde={klantSinds}>
              <PopupVeld icoon={<User className="size-4" />}>
                <Input
                  id="naam"
                  className={popupInvoer}
                  placeholder="Naam"
                  value={velden.naam}
                  onChange={(e) => zet({ naam: e.target.value })}
                  // Op de telefoon niet: dan schiet het toetsenbord over het scherm.
                  autoFocus={!mobiel}
                />
              </PopupVeld>
              <PopupPaar>
                <PopupVeld icoon={<Mail className="size-4" />}>
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    className={popupInvoer}
                    placeholder="naam@voorbeeld.nl"
                    value={velden.email}
                    onChange={(e) => zet({ email: e.target.value })}
                  />
                </PopupVeld>
                <PopupVeld icoon={<Phone className="size-4" />}>
                  <Input
                    id="telefoon"
                    type="tel"
                    inputMode="tel"
                    className={popupInvoer}
                    placeholder="06 12 34 56 78"
                    value={velden.telefoon}
                    onChange={(e) => zet({ telefoon: e.target.value })}
                  />
                </PopupVeld>
              </PopupPaar>
              {/* Een tweede adres en nummer: vaak mailen of appen de man én de vrouw. */}
              <PopupPaar>
                <PopupVeld icoon={<Mail className="size-4" />}>
                  <Input
                    id="email2"
                    type="email"
                    inputMode="email"
                    className={popupInvoer}
                    placeholder="Tweede e-mail"
                    value={velden.email2}
                    onChange={(e) => zet({ email2: e.target.value })}
                  />
                </PopupVeld>
                <PopupVeld icoon={<Phone className="size-4" />}>
                  <Input
                    id="telefoon2"
                    type="tel"
                    inputMode="tel"
                    className={popupInvoer}
                    placeholder="Tweede telefoon"
                    value={velden.telefoon2}
                    onChange={(e) => zet({ telefoon2: e.target.value })}
                  />
                </PopupVeld>
              </PopupPaar>
            </PopupBlok>

            <PopupBlok>
              <PopupPaar smal>
                <PopupVeld icoon={<Signpost className="size-4" />}>
                  <Input
                    id="straat"
                    list="bekende-straten"
                    className={popupInvoer}
                    placeholder="Straat"
                    value={velden.straat}
                    onChange={(e) => zet({ straat: e.target.value })}
                  />
                </PopupVeld>
                <PopupVeld icoon={<Hash className="size-4" />}>
                  <Input
                    id="huisnr"
                    className={popupInvoer}
                    placeholder="12a"
                    value={velden.huisnummer}
                    onChange={(e) => zet({ huisnummer: e.target.value })}
                  />
                </PopupVeld>
              </PopupPaar>
              <datalist id="bekende-straten">
                {straatSuggesties.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>

              <PopupPaar smal>
                <PopupVeld icoon={<MapPin className="size-4" />}>
                  <Input
                    id="plaats"
                    list="bekende-plaatsen"
                    className={popupInvoer}
                    placeholder="Plaats"
                    value={velden.plaats}
                    onChange={(e) => zet({ plaats: e.target.value })}
                  />
                </PopupVeld>
                <PopupVeld>
                  <Input
                    id="postcode"
                    className={popupInvoer}
                    placeholder="1234 AB"
                    value={velden.postcode}
                    onChange={(e) => {
                      setPostcodeHandmatig(true);
                      zet({ postcode: e.target.value });
                    }}
                  />
                </PopupVeld>
              </PopupPaar>
              <datalist id="bekende-plaatsen">
                {plaatsen.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>

              {/* Een adres dat nog niet op een wijklijst staat, wordt bij
                    opslaan aangemaakt. In welke wijk staat hier, en is te
                    wijzigen zonder dat het een eigen formulierrij kost. */}
              {nieuwAdres && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  Wordt aangemaakt in
                  <Select disabled={!magBewerken} value={wijkId} onValueChange={setWijkId}>
                    <SelectTrigger className="h-auto w-auto gap-1 border-0 px-1 py-0 text-xs font-medium text-foreground shadow-none focus:ring-0">
                      <SelectValue placeholder="een wijk" />
                    </SelectTrigger>
                    <SelectContent>
                      {districts.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </p>
              )}
            </PopupBlok>

            <PopupBlok>
              <PopupVeld icoon={<MessageSquare className="size-4" />}>
                <Input
                  id="notitie"
                  className={popupInvoer}
                  placeholder="Notitie bij klant"
                  value={velden.notitie}
                  onChange={(e) => zet({ notitie: e.target.value })}
                />
              </PopupVeld>
            </PopupBlok>

            <PopupScheiding />

            {/* Twee adressen op één persoon is de uitzondering, dus het
                  krijgt één regel: de andere adressen als labels, en een
                  zoekveld dat alleen ruimte inneemt als je het opent. */}
            <PopupBlok label="Ook van deze klant">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {extra.map((id) => {
                  const c = customers.find((x) => x.id === id);
                  if (!c) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-accent-foreground"
                    >
                      {adresTekst(c)}
                      <button
                        type="button"
                        aria-label={`${adresTekst(c)} losmaken`}
                        onClick={() => setExtra((l) => l.filter((x) => x !== id))}
                        className="text-accent-foreground/60 hover:text-accent-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}

                <Popover open={koppelOpen} onOpenChange={setKoppelOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Link2 className="size-3.5" /> nog een adres koppelen
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Zoek een adres…" />
                      <CommandList>
                        <CommandEmpty>Geen adres gevonden.</CommandEmpty>
                        <CommandGroup>
                          {koppelbaar.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${adresTekst(c)} ${wijkNaamVan(c.street_id)}`}
                              onSelect={() => {
                                setExtra((l) => [...l, c.id]);
                                setKoppelOpen(false);
                              }}
                            >
                              <span className="truncate">{adresTekst(c)}</span>
                              <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                                {c.klant_id && c.klant_id !== klant?.id
                                  ? `nu van ${klantNaam(c.klant_id) || "een andere klant"}`
                                  : wijkNaamVan(c.street_id)}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </PopupBlok>
          </>
        )}

        {tab === "adres" && (
          <>
            <PopupBlok label={prijzenZien ? "Prijs en frequentie" : "Frequentie"}>
              <PopupPaar>
                {prijzenZien && (
                  <PopupVeld icoon={<span className="text-sm">€</span>}>
                    <Input
                      id="prijs"
                      inputMode="decimal"
                      className={`${popupInvoer} tabular-nums`}
                      placeholder="0"
                      value={pand.price}
                      onChange={(e) => setPand((p) => ({ ...p, price: e.target.value }))}
                    />
                  </PopupVeld>
                )}
                <PopupVeld icoon={<Clock className="size-4" />}>
                  <Input
                    id="duur"
                    inputMode="numeric"
                    className={`${popupInvoer} tabular-nums`}
                    placeholder="duur in minuten"
                    title="Hoe lang dit adres duurt, voor één persoon"
                    value={pand.duur}
                    disabled={!magBewerken}
                    onChange={(e) =>
                      setPand((p) => ({ ...p, duur: e.target.value, duurZelf: true }))
                    }
                  />
                </PopupVeld>
              </PopupPaar>
              <PopupPaar>
                <PopupVeld icoon={<CalendarDays className="size-4" />}>
                  <Select
                    disabled={!magBewerken}
                    value={String(pand.interval_maanden)}
                    onValueChange={(v) =>
                      setPand((p) => ({ ...p, interval_maanden: Number(v), ritme: 1 }))
                    }
                  >
                    <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVALLEN.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {intervalLabels[n]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PopupVeld>
              </PopupPaar>

              {/* Bij om de 2 kies je even of oneven, bij om de 3 welk van de
                    drie kwartaalfrequenties. Bij elke maand valt er niets te
                    kiezen. */}
              {ritmeKeuzes.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {ritmeKeuzes.map((r) => {
                    const aan = zelfdeRitme(pand.ritme, r, pand.interval_maanden);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setPand((p) => ({ ...p, ritme: r }))}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          aan
                            ? "border-transparent bg-tint-amber text-tint-amber-ink"
                            : "border-border bg-card text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {ritmeLabel({ interval_maanden: pand.interval_maanden, ritme: r })}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Grote panden staan in de dagweergave als eigen blok, en
                    alleen zij kunnen een tijdvak in de aankondiging krijgen.
                    Automatisch gaat op de duur; hier zet je het zelf vast. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted-foreground">Eigen blok op de dag:</span>
                {(
                  [
                    [null, "Automatisch"],
                    [true, "Altijd"],
                    [false, "Nooit"],
                  ] as const
                ).map(([waarde, label]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={!magBewerken}
                    onClick={() => setPand((p) => ({ ...p, eigenBlok: waarde }))}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      pand.eigenBlok === waarde
                        ? "border-transparent bg-tint-amber text-tint-amber-ink"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </PopupBlok>

            <PopupBlok
              label="Betalen"
              info="Contant: de geldloper haalt het op. Overmaken: deze klant staat grijs op de lijst van de geldloper."
            >
              <BetaalwijzeKiezer
                waarde={pand.betaalmethode}
                wijk={districts.find((d) => d.id === wijkId)?.betaalmethode ?? "contant"}
                disabled={!magBewerken}
                onChange={(m) => setPand((p) => ({ ...p, betaalmethode: m }))}
              />
            </PopupBlok>

            <PopupBlok label={prijzenZien ? "Notitie en meerwerk" : "Notitie"}>
              {/* Hetzelfde veld met snelkeuzes als op de wijkenpagina, nu
                    inclusief het werk dat er in bepaalde maanden bij komt en
                    wat dat extra kost. */}
              <NotitieCel
                value={pand.note}
                maandwerk={pand.maandwerk}
                onChangeMaandwerk={(werk) => setPand((p) => ({ ...p, maandwerk: werk }))}
                beurtMaanden={beurtMaanden}
                quickNotes={quickNotes}
                onChange={(v) => setPand((p) => ({ ...p, note: v }))}
                onAddQuickNote={onAddQuickNote}
                className="flex min-h-[44px] w-full items-center truncate rounded-xl border border-input bg-background/70 px-3 text-left text-sm hover:bg-accent/40 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
              />
            </PopupBlok>

            <PopupBlok label="Kleur op printlijst">
              <div className="flex flex-wrap gap-1.5">
                {markeringen.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setPand((p) => ({
                        ...p,
                        markering: p.markering === m.sleutel ? "" : m.sleutel,
                      }))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      pand.markering === m.sleutel
                        ? "border-transparent bg-tint-amber text-tint-amber-ink"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      className={`size-2.5 rounded-full ring-1 ring-inset ${tintStip[m.tint]}`}
                    />
                    {m.naam}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPand((p) => ({ ...p, markering: "" }))}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    pand.markering === ""
                      ? "border-transparent bg-tint-amber text-tint-amber-ink"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <Palette className="size-3" /> Geen
                </button>
              </div>
            </PopupBlok>

            <PopupBlok label="Wassen vanaf">
              <PopupVeld icoon={<Flag className="size-4" />}>
                <Select
                  disabled={!magBewerken}
                  value={pand.start_maand || METEEN}
                  onValueChange={(v) =>
                    setPand((p) => ({ ...p, start_maand: v === METEEN ? "" : v }))
                  }
                >
                  <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={METEEN}>Meteen (aanmaakmaand)</SelectItem>
                    <SelectItem value={vorigeMaand()}>Niet nieuw, al langer klant</SelectItem>
                    {maandenVooruit.map((m) => (
                      <SelectItem key={m} value={m}>
                        <span className="capitalize">{toonMaand(m)}</span>{" "}
                        <span className="text-muted-foreground">{m.slice(0, 4)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PopupVeld>
            </PopupBlok>

            {/* Losse maanden waarin dit adres niet meegaat: een vakantie, een
                  steiger voor de gevel. Dit is iets anders dan de frequentie —
                  daarom staan ze los, met de eerste maand vooraan. */}
            <PopupBlok
              label="Maanden overslaan"
              terzijde={
                pand.overslaan.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPand((p) => ({ ...p, overslaan: [] }))}
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Niets meer overslaan ({pand.overslaan.length})
                  </button>
                ) : undefined
              }
            >
              <div className="grid grid-cols-6 gap-1">
                {maandenVooruit.map((m) => {
                  const aan = pand.overslaan.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      title={`${toonMaand(m)} ${m.slice(0, 4)}`}
                      onClick={() =>
                        setPand((p) => ({
                          ...p,
                          overslaan: aan
                            ? p.overslaan.filter((x) => x !== m)
                            : [...p.overslaan, m].sort(),
                        }))
                      }
                      className={`rounded-lg border px-1 py-1 text-[10px] font-medium capitalize transition-colors ${
                        aan
                          ? "border-transparent bg-tint-rood text-tint-rood-ink"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {toonMaandKort(m)}
                    </button>
                  );
                })}
              </div>
              <PopupHint>
                <CalendarOff className="mr-1 inline size-3.5 align-[-2px]" />
                Maanden die al voorbij zijn staan niet in dit rijtje, maar tellen wel mee.
              </PopupHint>
            </PopupBlok>
          </>
        )}

        {tab === "werk" && (
          <PopupBlok
            label="Openstaand werk"
            terzijde={
              openKlussen.length > 0 && prijzenZien
                ? formatPrice(openKlussen.reduce((sum, k) => sum + k.prijs, 0))
                : undefined
            }
          >
            {!dossierCustomer ? (
              <PopupHint>
                Dit adres bestaat nog niet in een wijk. Sla het eerst op; daarna kun je er losse
                opdrachten bij noteren.
              </PopupHint>
            ) : (
              <>
                {openKlussen.length === 0 ? (
                  <PopupHint>
                    Niets openstaand. Werk dat niet aan een maand vastzit — een dakrand, een goot —
                    noteer je hier, en het komt terug op de planning zodra die wijk een dag heeft.
                  </PopupHint>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-xl border border-input">
                    {openKlussen.map((k) => (
                      <li key={k.id} className="flex items-center gap-2 px-3 py-2.5 text-[13.5px]">
                        <span className="min-w-0 flex-1 truncate">{k.omschrijving}</span>
                        {k.gepland_op && !blijvenLiggen(k) && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {toonDatum(k.gepland_op)}
                          </span>
                        )}
                        {prijzenZien && (
                          <span className="shrink-0 tabular-nums">{formatPrice(k.prijs)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start rounded-full"
                  onClick={() => setKlusOpen(true)}
                >
                  <Hammer className="size-4" /> Opdracht erbij
                </Button>
              </>
            )}
          </PopupBlok>
        )}
      </fieldset>
      {/* Buiten het formulier: mail en klachten hebben hun eigen rechten en slaan zelf op. */}
      {tab === "mail" && klant && magMailLezen && (
        <div className="flex flex-col gap-5">
          <MailLaadFout>
            <Suspense fallback={<p className="text-sm text-muted-foreground">Mail laden…</p>}>
              <DossierMail klant={klant} />
              <DossierWhatsApp klant={klant} />
            </Suspense>
          </MailLaadFout>
        </div>
      )}
      {tab === "geld" && dossierCustomer && prijzenZien && (
        <DossierGeld adresId={dossierCustomer.id} />
      )}
      {tab === "klachten" && klant && (
        <DossierKlachten
          klantId={klant.id}
          adressen={customers
            .filter((c) => c.klant_id === klant.id)
            .map((c) => ({ id: c.id, label: adresTekst(c) }))}
          onToonMail={magMailLezen ? () => setTab("mail") : undefined}
        />
      )}
    </>
  );

  const voetKnoppen = (
    <PopupVoet>
      <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
        {magBewerken ? "Annuleren" : "Sluiten"}
      </Button>
      {magBewerken && (
        <Button className="rounded-full" onClick={() => void save()} disabled={saving}>
          {saving ? "Bezig…" : "Opslaan"}
        </Button>
      )}
    </PopupVoet>
  );

  // --- Telefoon ------------------------------------------------------------
  // Een popup in het midden past daar niet. Eerst schuift er een onderblad
  // omhoog met wat je op straat nodig hebt; "Alles bekijken" maakt er een
  // eigen scherm van, met de onderdelen als lijst om op door te tikken.
  const gewijzigd =
    magBewerken &&
    beginStand.current !== null &&
    JSON.stringify({ velden, pand, extra, wijkId }) !== JSON.stringify(beginStand.current);

  /** Op de telefoon kom je via terugtikken bij het kruisje, en is Opslaan
   *  uit beeld. Dan niet zomaar weggooien wat je net invulde. */
  async function sluitMetVraag() {
    if (gewijzigd) {
      const weg = await bevestig({
        titel: "Wijzigingen niet opgeslagen",
        tekst: "Je hebt iets aangepast in dit dossier. Tik op Terug om het nog op te slaan.",
        bevestigLabel: "Weggooien",
        annuleerLabel: "Terug",
        gevaarlijk: true,
      });
      if (!weg) return;
    }
    onOpenChange(false);
  }

  const tabNamen: Record<typeof tab, string> = {
    klant: "Gegevens",
    adres: "Het adres",
    werk: "Werk",
    mail: "Berichten",
    klachten: "Klachten",
    geld: "Geld",
  };
  const titelTekst = dossierCustomer
    ? adresTekst(dossierCustomer)
    : klant
      ? klant.naam || "Naamloze klant"
      : "Nieuw adres";
  // Hoe dit adres betaalt (zoals nu in het formulier staat): muntje of pinpas
  // achter de titel. Alleen de tekst wordt afgekapt, het icoontje blijft staan.
  const methode = effectieveMethode(
    pand,
    districts.find((d) => d.id === wijkId),
  );
  const titelMetIcoon = (tekst: string) =>
    dossierCustomer ? (
      <span className="flex min-w-0 items-center">
        <span className="truncate">{tekst}</span>
        <BetaalIcoon className="ml-1.5" methode={methode} />
      </span>
    ) : (
      tekst
    );
  const telefoon = velden.telefoon.trim() || velden.telefoon2.trim();
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
  // Uit het formulier, niet uit de wijklijst: daar staan afkortingen
  // ("Othilde"), en daarmee vindt de kaart het adres niet.
  const routeVelden =
    dossierCustomer && pandAdres && !formulierIsPand
      ? { ...pandAdres, postcode: dossierCustomer.postcode ?? "" }
      : velden;
  const routeAdres = dossierCustomer
    ? [
        `${routeVelden.straat.trim()} ${routeVelden.huisnummer.trim()}`.trim(),
        [routeVelden.postcode.trim(), routeVelden.plaats.trim()].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const notitieTekst = [velden.notitie.trim(), pand.note.trim()].filter(Boolean).join(" · ");
  const onderregel = [
    velden.naam.trim(),
    prijzenZien && pand.price ? formatPrice(prijsGetal(pand.price)) : "",
    dossierCustomer
      ? `${ritmeLabel(pand).toLowerCase()}${pand.interval_maanden <= 2 ? " maand" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const snelKnop =
    "flex flex-1 flex-col items-center gap-1 rounded-[14px] bg-muted/70 py-2.5 text-[12px] font-medium text-foreground active:bg-muted";
  const snelleKnoppen = (
    <div className="flex gap-2">
      {telefoon && (
        <a href={`tel:${telefoon.replace(/\s/g, "")}`} className={snelKnop}>
          <Phone className="size-5" /> Bellen
        </a>
      )}
      {whatsappNummer && (
        <a
          href={`https://wa.me/${whatsappNummer}`}
          target="_blank"
          rel="noreferrer"
          className={snelKnop}
        >
          <MessageSquare className="size-5" /> WhatsApp
        </a>
      )}
      {routeAdres && (
        <a
          href={`https://maps.google.com/?daddr=${encodeURIComponent(routeAdres)}`}
          target="_blank"
          rel="noreferrer"
          className={snelKnop}
        >
          <MapPin className="size-5" /> Route
        </a>
      )}
      {dossierCustomer && magBewerken && (
        <button type="button" className={snelKnop} onClick={() => setKlusOpen(true)}>
          <Hammer className="size-5" /> Opdracht
        </button>
      )}
    </div>
  );

  const lijstRij = (naar: typeof tab, icoon: React.ReactNode, extraInfo?: React.ReactNode) => (
    <button
      key={naar}
      type="button"
      onClick={() => {
        setTab(naar);
        setStap("tab");
      }}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] active:bg-muted/60"
    >
      <span className="text-muted-foreground">{icoon}</span>
      <span className="flex-1">{tabNamen[naar]}</span>
      {extraInfo}
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
  const telBolletje = (n: number, rood = false) =>
    n > 0 ? (
      <span
        className={`rounded-full px-2 py-px text-[12px] font-semibold ${
          rood ? "bg-tint-rood text-tint-rood-ink" : "bg-tint-geel text-tint-geel-ink"
        }`}
      >
        {n}
      </span>
    ) : null;

  const bladSleep = useSleepBlad({
    onOmhoog: () => setStap("overzicht"),
    onOmlaag: () => sluitMetVraag(),
  });

  const mobielDossier =
    stap === "blad" ? (
      <PopupKader className="bottom-0 left-0 top-auto max-h-[85dvh] max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-[24px] pb-[env(safe-area-inset-bottom)] data-[state=open]:slide-in-from-bottom-10 data-[state=open]:zoom-in-100 data-[state=closed]:slide-out-to-bottom data-[state=closed]:zoom-out-100 [&>button:last-child]:hidden">
        <div className="flex flex-col gap-3.5 overflow-y-auto px-4 pb-4">
          {/* Het greepje en de titel zijn om te slepen: omhoog opent het hele
              dossier, omlaag sluit het blad. */}
          <div className="-mx-4 flex touch-none flex-col gap-3.5 px-4 pt-2.5" {...bladSleep}>
            <div className="mx-auto h-1 w-9 rounded-full bg-border" />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.02em]">
                  {titelMetIcoon(titelTekst)}
                </DialogTitle>
                <DialogDescription className="truncate text-[13px]">
                  {onderregel || "Nog geen gegevens"}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => void sluitMetVraag()}
                aria-label="Sluiten"
                className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
          {snelleKnoppen}
          {notitieTekst && (
            <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[13px] text-tint-geel-ink">
              {notitieTekst}
            </p>
          )}
          {(openKlussen.length > 0 || openKlachten > 0) && (
            <div className="divide-y divide-border/60 overflow-hidden rounded-[14px] border border-border/70">
              {openKlussen.length > 0 &&
                lijstRij(
                  "werk",
                  <Hammer className="size-[18px]" />,
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    {openKlussen.length} open
                    {prijzenZien
                      ? ` · ${formatPrice(openKlussen.reduce((sum, k) => sum + k.prijs, 0))}`
                      : ""}
                  </span>,
                )}
              {openKlachten > 0 &&
                lijstRij(
                  "klachten",
                  <MessageSquareWarning className="size-[18px]" />,
                  telBolletje(openKlachten, true),
                )}
            </div>
          )}
          <Button className="rounded-full" onClick={() => setStap("overzicht")}>
            Alles bekijken
          </Button>
        </div>
      </PopupKader>
    ) : (
      <PopupKader className="inset-0 flex h-[100dvh] max-h-none max-w-none translate-x-0 translate-y-0 flex-col rounded-none data-[state=open]:zoom-in-100 [&>button:last-child]:hidden">
        <div className="flex shrink-0 items-center gap-1 border-b border-border/70 bg-card px-1.5 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full"
            onClick={() => {
              if (stap === "tab") setStap("overzicht");
              else if (dossierCustomer) setStap("blad");
              else void sluitMetVraag();
            }}
            aria-label="Terug"
          >
            <ChevronLeft className="size-6" />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate font-display text-[18px] font-semibold leading-tight tracking-[-0.01em]">
              {stap === "tab" ? tabNamen[tab] : titelMetIcoon(titelTekst)}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {stap === "tab" ? titelTekst : onderregel || "Alles van dit adres bij elkaar"}
            </DialogDescription>
          </div>
        </div>
        {stap === "overzicht" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-3">
            <div className="flex flex-col gap-3">
              {snelleKnoppen}
              {notitieTekst && (
                <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[13px] text-tint-geel-ink">
                  {notitieTekst}
                </p>
              )}
              <div className="divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card shadow-card">
                {lijstRij("klant", <User className="size-[18px]" />)}
                {lijstRij("adres", <House className="size-[18px]" />)}
                {lijstRij(
                  "werk",
                  <Hammer className="size-[18px]" />,
                  telBolletje(openKlussen.length),
                )}
                {klant && magMailLezen && lijstRij("mail", <Mail className="size-[18px]" />)}
                {klant &&
                  lijstRij(
                    "klachten",
                    <MessageSquareWarning className="size-[18px]" />,
                    telBolletje(openKlachten, true),
                  )}
                {dossierCustomer &&
                  prijzenZien &&
                  lijstRij("geld", <Cash className="size-[18px]" />)}
              </div>
            </div>
          </div>
        ) : (
          <PopupBody className="min-h-0 flex-1 overscroll-contain px-4 pt-4">{tabInhoud}</PopupBody>
        )}
        {/* Ook in het overzicht: wie iets wijzigt en terugtikt, moet nog
            kunnen opslaan zonder het onderdeel opnieuw te openen. */}
        <div className="pb-[env(safe-area-inset-bottom)]">{voetKnoppen}</div>
      </PopupKader>
    );

  return (
    <Dialog
      open={open}
      // Op de telefoon ook bij wegtikken of Escape eerst vragen.
      onOpenChange={(o) => (o || !mobiel ? onOpenChange(o) : void sluitMetVraag())}
    >
      {mobiel ? (
        mobielDossier
      ) : (
        <PopupKader
          className="sm:max-w-lg"
          onKeyDown={magBewerken ? opslaanBijEnter(() => void save()) : undefined}
        >
          <PopupKop
            icoon={<House className="size-[22px]" />}
            titel={
              dossierCustomer
                ? titelMetIcoon(adresTekst(dossierCustomer))
                : klant
                  ? `Dossier van ${klant.naam || "naamloze klant"}`
                  : "Nieuw adres"
            }
            subtitel={
              [dossierCustomer ? wijkNaamVan(dossierCustomer.street_id) : "", velden.plaats.trim()]
                .filter(Boolean)
                .join(" · ") || "Alles van dit adres bij elkaar"
            }
            tabs={
              <>
                <PopupTab
                  actief={tab === "klant"}
                  onClick={() => setTab("klant")}
                  icoon={<User className="size-[15px]" />}
                >
                  Gegevens
                </PopupTab>
                <PopupTab
                  actief={tab === "adres"}
                  onClick={() => setTab("adres")}
                  icoon={<House className="size-[15px]" />}
                >
                  Het adres
                </PopupTab>
                <PopupTab
                  actief={tab === "werk"}
                  onClick={() => setTab("werk")}
                  icoon={<Hammer className="size-[15px]" />}
                  telletje={openKlussen.length}
                >
                  Werk
                </PopupTab>
                {klant && magMailLezen && (
                  <PopupTab
                    actief={tab === "mail"}
                    onClick={() => setTab("mail")}
                    icoon={<Mail className="size-[15px]" />}
                  >
                    Berichten
                  </PopupTab>
                )}
                {klant && (
                  <PopupTab
                    actief={tab === "klachten"}
                    onClick={() => setTab("klachten")}
                    icoon={<MessageSquareWarning className="size-[15px]" />}
                    telletje={openKlachten}
                  >
                    Klachten
                  </PopupTab>
                )}
                {dossierCustomer && prijzenZien && (
                  <PopupTab
                    actief={tab === "geld"}
                    onClick={() => setTab("geld")}
                    icoon={<Cash className="size-[15px]" />}
                  >
                    Geld
                  </PopupTab>
                )}
              </>
            }
          />

          <PopupBody className="max-h-[60vh]">{tabInhoud}</PopupBody>

          {voetKnoppen}
        </PopupKader>
      )}
      <KlusDialog
        open={klusOpen}
        onOpenChange={setKlusOpen}
        customer={dossierCustomer}
        klus={null}
        onOpslaan={(customerId, omschrijving, prijs) => {
          void nieuweKlus(customerId, omschrijving, prijs)
            .then(() => {
              qc.invalidateQueries({ queryKey: ["klussen"] });
              toast.success(`Opdracht genoteerd: ${omschrijving}`);
            })
            .catch((e: Error) => toast.error("Opslaan mislukt: " + e.message));
        }}
      />
    </Dialog>
  );
}

/** De velden zonder id, zodat het formulier precies de bewerkbare kolommen houdt. */
function stripId(k: Klant) {
  const { id: _id, ...rest } = k;
  return rest;
}

/**
 * Een onderblad slepen met de vinger. Het blad gaat mee met de vinger;
 * loslaten ver genoeg omhoog of omlaag (of met een snelle veeg) doet de
 * actie, anders veert het terug. Omhoog gaat stroever: het blad kan zelf niet
 * hoger, het laat alleen voelen dat er iets gebeurt.
 *
 * De verschuiving gaat rechtstreeks op het blad, niet via React-state: anders
 * wordt het hele dossier bij elke millimeter opnieuw opgebouwd.
 */
function useSleepBlad({
  onOmhoog,
  onOmlaag,
}: {
  onOmhoog: () => void;
  onOmlaag: () => Promise<unknown> | void;
}) {
  const start = useRef<{ y: number; t: number; id: number; blad: HTMLElement } | null>(null);

  function zet(blad: HTMLElement, dy: number, glijden: boolean) {
    blad.style.transition = glijden ? "transform 200ms ease-out" : "none";
    blad.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
  }

  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      // Het kruisje blijft gewoon een knop.
      if ((e.target as HTMLElement).closest("button")) return;
      const blad = e.currentTarget.closest<HTMLElement>('[role="dialog"]');
      if (!blad) return;
      start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId, blad };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const d = e.clientY - s.y;
      zet(s.blad, d > 0 ? d : d / 3, false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      start.current = null;
      const afstand = e.clientY - s.y;
      const snelheid = afstand / Math.max(1, e.timeStamp - s.t); // px per ms
      if (afstand > 90 || (afstand > 20 && snelheid > 0.5)) {
        // Blijft staan waar hij is: de sluitanimatie glijdt vanaf hier verder
        // omlaag. Wordt er eerst iets gevraagd en blijf je, dan veert hij terug.
        void Promise.resolve(onOmlaag()).finally(() =>
          // Even wachten tot het dicht-zetten verwerkt is.
          setTimeout(() => {
            if (s.blad.isConnected && s.blad.dataset["state"] === "open") zet(s.blad, 0, true);
          }, 0),
        );
        return;
      }
      zet(s.blad, 0, true);
      if (afstand < -50 || (afstand < -15 && snelheid < -0.5)) onOmhoog();
    },
    // Afgebroken (bijvoorbeeld een telefoontje): alleen terugveren.
    onPointerCancel: () => {
      if (start.current) zet(start.current.blad, 0, true);
      start.current = null;
    },
  };
}
