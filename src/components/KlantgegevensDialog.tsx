import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
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
  CalendarDays,
  CalendarOff,
  Flag,
  Hammer,
  Hash,
  House,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Palette,
  Phone,
  Signpost,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { NotitieCel } from "@/components/NotitieCel";
import {
  adresVanRegel,
  bewaarKlant,
  formatNumber,
  formatPrice,
  INTERVALLEN,
  intervalLabels,
  komendeMaanden,
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
  zorgVoorAdresRegel,
  type Customer,
  type District,
  type Klant,
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
  interval_maanden: number;
  ritme: number;
  note: string;
  maandwerk: Maandwerk[];
  overslaan: string[];
  start_maand: string;
  markering: Markering;
}

const LEEG_PAND: Pand = {
  price: "",
  interval_maanden: 1,
  ritme: 1,
  note: "",
  maandwerk: [],
  overslaan: [],
  start_maand: "",
  markering: "",
};

function pandVan(c: Customer): Pand {
  return {
    price: c.price ? String(c.price) : "",
    interval_maanden: c.interval_maanden || 1,
    ritme: c.ritme || 1,
    note: c.note ?? "",
    maandwerk: c.maandwerk ?? [],
    overslaan: c.overslaan ?? [],
    start_maand: c.start_maand ?? "",
    markering: c.markering ?? "",
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
  telefoon: "",
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
  /** Welk tabblad je bekijkt: de persoon, het adres, of het losse werk. Drie
   *  korte schermen in plaats van één lange lap om doorheen te scrollen. */
  const [tab, setTab] = useState<"klant" | "adres" | "werk">("klant");
  const [velden, setVelden] = useState(LEEG);
  const [pand, setPand] = useState<Pand>(LEEG_PAND);
  /** Ids van de overige adressen van deze klant — de uitzondering. */
  const [extra, setExtra] = useState<string[]>([]);
  const [koppelOpen, setKoppelOpen] = useState(false);
  const [wijkId, setWijkId] = useState("");
  const [saving, setSaving] = useState(false);
  // Zodra de gebruiker zelf een postcode typt, houdt de opzoeking zijn mond.
  const [postcodeHandmatig, setPostcodeHandmatig] = useState(false);
  const [postcodeGevonden, setPostcodeGevonden] = useState(false);
  const [straatSuggesties, setStraatSuggesties] = useState<string[]>([]);

  const beginKoppeling = useRef<string[]>([]);

  /** Het adres waar dit dossier over gaat; null als het nog niet bestaat. */
  const dossierCustomer = voorstelCustomer ?? null;
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

    if (klant) {
      setVelden(stripId(klant));
    } else if (voorstelCustomer) {
      // Vanuit een regel op de lijst: het adres is al bekend.
      const straat = straatVan(voorstelCustomer);
      const adres = straat
        ? adresVanRegel(voorstelCustomer, straat, wijkVan(straat))
        : { straat: "", huisnummer: "", plaats: "" };
      setVelden({ ...LEEG, ...adres });
    } else {
      // De plaats van de wijk waar je in werkt wint van de meest gebruikte
      // plaats: Testwijk ligt in Den Haag, ook al staan de meeste klanten in
      // Gouda. Met de verkeerde plaats vindt de postcode-opzoeking niets.
      const wijkPlaats = districts.find((d) => d.id === standaardWijkId)?.plaats.trim();
      setVelden({ ...LEEG, plaats: wijkPlaats || (plaatsen[0] ?? "") });
    }

    // Wat er nú aan de klant hangt, tegenover wat er straks aan moet hangen.
    // `save()` leidt uit het verschil af wat er gekoppeld en losgemaakt wordt.
    const bestaand = klant ? customers.filter((c) => c.klant_id === klant.id).map((c) => c.id) : [];
    beginKoppeling.current = bestaand;
    setExtra(bestaand.filter((id) => id !== voorstelCustomer?.id));

    setPand(voorstelCustomer ? pandVan(voorstelCustomer) : LEEG_PAND);
    setWijkId(
      straatVan(voorstelCustomer ?? null)?.district_id ?? standaardWijkId ?? districts[0]?.id ?? "",
    );
    setKoppelOpen(false);
    setTab("klant");
    setPostcodeHandmatig(Boolean(klant?.postcode));
    setPostcodeGevonden(false);
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
        setPostcodeGevonden(true);
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

  async function save() {
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
        velden.telefoon.trim() ||
        velden.notitie.trim(),
      );
      const klantId =
        klant || persoonlijk || extra.length > 0
          ? (await bewaarKlant(klant?.id ?? null, velden)).id
          : null;

      // Bestaat het adres nog niet op een wijklijst, dan maken we het nu aan:
      // de klantenpagina en de wijkenlijst horen hetzelfde te laten zien.
      let adresId = dossierCustomer?.id ?? null;
      let aangemaakt = false;
      if (!adresId && wijkId && velden.straat.trim() && velden.huisnummer.trim()) {
        adresId = await zorgVoorAdresRegel(wijkId, velden.straat, velden.huisnummer);
        aangemaakt = Boolean(adresId);
      }

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
      // dossier.
      if (adresId) {
        // Dezelfde regel als in de wijklijst: een adres dat nog moet
        // beginnen en dat je zijn startmaand laat overslaan, begint gewoon
        // later — anders staan er twee badges die hetzelfde zeggen.
        await patchCustomer(
          adresId,
          schuifStartOp(dossierCustomer ?? { start_maand: "", created_at: nu, overslaan: [] }, {
            price: prijsGetal(pand.price),
            note: pand.note.trim(),
            // De postcode hoort bij het pand, niet bij de bewoner — en de
            // klantenlijst leest hem daar ook vandaan.
            postcode: velden.postcode.trim(),
            interval_maanden: pand.interval_maanden,
            ritme: pand.ritme,
            maandwerk: pand.maandwerk,
            overslaan: [...pand.overslaan].sort(),
            start_maand: pand.start_maand,
            markering: pand.markering,
          }),
        );
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

      if (overgenomen.length > 0) {
        toast.success(
          `Samengevoegd: ${overgenomen.map(adresTekst).join(", ")} ${
            overgenomen.length === 1 ? "hoort" : "horen"
          } nu bij deze klant.${
            verweesd.length > 0
              ? ` De oude gegevens van ${verweesd.join(" en ")} staan nu onder "Nog zonder wijk".`
              : ""
          }`,
          { duration: 8000 },
        );
      } else if (aangemaakt) {
        toast.success(`Klant opgeslagen en toegevoegd aan ${velden.straat.trim()} in de wijklijst`);
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

  /** De ankermaanden waar je uit kiest bij om de 2, 3, 6 of 12 maanden. */
  const ritmeKeuzes = ritmeVarianten(pand.interval_maanden);
  /** De kalendermaanden waarin dit adres sowieso langskomt — het meerwerk-
   *  rooster laat de andere maanden daardoor anders zien. */
  const beurtMaanden = ritmeMaanden(pand).map((m) => String(m).padStart(2, "0"));
  /** Twaalf maanden vooruit: waar je een pauze of een startmaand uit kiest. */
  const maandenVooruit = komendeMaanden();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-lg" onKeyDown={opslaanBijEnter(() => void save())}>
        <PopupKop
          icoon={<House className="size-[22px]" />}
          titel={
            dossierCustomer
              ? adresTekst(dossierCustomer)
              : klant
                ? `Dossier van ${klant.naam || "naamloze klant"}`
                : "Nieuw adres"
          }
          subtitel={
            [
              dossierCustomer ? wijkNaamVan(dossierCustomer.street_id) : "",
              velden.plaats.trim(),
            ]
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
                De klant
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
            </>
          }
        />

        <PopupBody className="max-h-[60vh]">
          {tab === "klant" && (
            <>
              <PopupBlok label="De klant">
                <PopupVeld icoon={<User className="size-4" />}>
                  <Input
                    id="naam"
                    className={popupInvoer}
                    placeholder="nog onbekend"
                    value={velden.naam}
                    onChange={(e) => zet({ naam: e.target.value })}
                    autoFocus
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
              </PopupBlok>

              <PopupBlok label="Waar">
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
                        setPostcodeGevonden(false);
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

                {postcodeGevonden && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5" /> Postcode automatisch gevonden — je kunt hem
                    overschrijven.
                  </p>
                )}

                {/* Een adres dat nog niet op een wijklijst staat, wordt bij
                    opslaan aangemaakt. In welke wijk staat hier, en is te
                    wijzigen zonder dat het een eigen formulierrij kost. */}
                {nieuwAdres && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    Wordt aangemaakt in
                    <Select value={wijkId} onValueChange={setWijkId}>
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

              <PopupBlok label="Notitie bij de persoon">
                <PopupVeld icoon={<MessageSquare className="size-4" />}>
                  <Input
                    id="notitie"
                    className={popupInvoer}
                    placeholder="wat je over deze klant wilt onthouden"
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
                        <Link2 className="size-3.5" /> adres koppelen
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
              <PopupBlok label="Prijs en frequentie">
                <PopupPaar>
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
                  <PopupVeld icoon={<CalendarDays className="size-4" />}>
                    <Select
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
              </PopupBlok>

              <PopupBlok label="Notitie en meerwerk">
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
                openKlussen.length > 0
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
                        <li
                          key={k.id}
                          className="flex items-center gap-2 px-3 py-2.5 text-[13.5px]"
                        >
                          <span className="min-w-0 flex-1 truncate">{k.omschrijving}</span>
                          {k.gepland_op && !blijvenLiggen(k) && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {toonDatum(k.gepland_op)}
                            </span>
                          )}
                          <span className="shrink-0 tabular-nums">{formatPrice(k.prijs)}</span>
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
        </PopupBody>

        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={() => void save()} disabled={saving}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </PopupVoet>
      </PopupKader>
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
