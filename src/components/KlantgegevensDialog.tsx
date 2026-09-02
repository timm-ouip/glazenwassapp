import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Link2, Sparkles, X } from "lucide-react";
import { NotitieCel } from "@/components/NotitieCel";
import {
  adresVanRegel,
  bewaarKlant,
  formatNumber,
  INTERVALLEN,
  intervalLabels,
  komendeMaanden,
  koppelKlant,
  markeringLabels,
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

const KLEUR_STIP: Record<Exclude<Markering, "">, string> = {
  geel: "bg-tint-amber ring-tint-amber-ink/40",
  groen: "bg-tint-groen ring-tint-groen-ink/40",
};

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
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        onKeyDown={opslaanBijEnter(() => void save())}
      >
        <DialogHeader>
          <DialogTitle>
            {dossierCustomer
              ? adresTekst(dossierCustomer)
              : klant
                ? `Dossier van ${klant.naam || "naamloze klant"}`
                : "Nieuw adres"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="naam">Naam</Label>
            <Input
              id="naam"
              placeholder="nog onbekend"
              value={velden.naam}
              onChange={(e) => zet({ naam: e.target.value })}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                placeholder="naam@voorbeeld.nl"
                value={velden.email}
                onChange={(e) => zet({ email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefoon">Telefoon</Label>
              <Input
                id="telefoon"
                type="tel"
                inputMode="tel"
                placeholder="06 12 34 56 78"
                value={velden.telefoon}
                onChange={(e) => zet({ telefoon: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-2">
              <Label htmlFor="straat">Straat</Label>
              <Input
                id="straat"
                list="bekende-straten"
                value={velden.straat}
                onChange={(e) => zet({ straat: e.target.value })}
              />
              <datalist id="bekende-straten">
                {straatSuggesties.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="huisnr">Huisnummer</Label>
              <Input
                id="huisnr"
                placeholder="12a"
                value={velden.huisnummer}
                onChange={(e) => zet({ huisnummer: e.target.value })}
              />
            </div>
          </div>

          {/* Een adres dat nog niet op een wijklijst staat, wordt bij opslaan
              aangemaakt. In welke wijk staat hier, en is te wijzigen zonder
              dat het een eigen formulierrij kost. */}
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

          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            <div className="space-y-2">
              <Label htmlFor="postcode">Postcode</Label>
              <Input
                id="postcode"
                placeholder="1234 AB"
                value={velden.postcode}
                onChange={(e) => {
                  setPostcodeHandmatig(true);
                  setPostcodeGevonden(false);
                  zet({ postcode: e.target.value });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plaats">Plaats</Label>
              <Input
                id="plaats"
                list="bekende-plaatsen"
                value={velden.plaats}
                onChange={(e) => zet({ plaats: e.target.value })}
              />
              <datalist id="bekende-plaatsen">
                {plaatsen.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          </div>
          {postcodeGevonden && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" /> Postcode automatisch gevonden — je kunt hem
              overschrijven.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="notitie">Notitie bij de persoon</Label>
            <Input
              id="notitie"
              value={velden.notitie}
              onChange={(e) => zet({ notitie: e.target.value })}
            />
          </div>

          {/* Alles van het pand bij elkaar. Hetzelfde als in de wijklijst,
              maar daar zit het verspreid over de regel en de rechtermuisknop;
              hier loop je een adres in één keer na. */}
          <div className="space-y-4 rounded-lg border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Het adres
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prijs">Vaste prijs (€)</Label>
                <Input
                  id="prijs"
                  inputMode="decimal"
                  placeholder="0"
                  value={pand.price}
                  onChange={(e) => setPand((p) => ({ ...p, price: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Frequentie</Label>
                <Select
                  value={String(pand.interval_maanden)}
                  onValueChange={(v) =>
                    setPand((p) => ({ ...p, interval_maanden: Number(v), ritme: 1 }))
                  }
                >
                  <SelectTrigger>
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
              </div>
            </div>

            {/* Bij om de 2 kies je even of oneven, bij om de 3 welk van de
                drie kwartaalritmes. Bij elke maand valt er niets te kiezen. */}
            {ritmeKeuzes.length > 1 && (
              <div className="space-y-2">
                <Label>In welke maanden</Label>
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
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        {ritmeLabel({ interval_maanden: pand.interval_maanden, ritme: r })}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Notitie en meerwerk</Label>
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
                className="flex h-9 w-full items-center truncate rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm hover:bg-accent/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Kleur op de printlijst</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(markeringLabels) as Exclude<Markering, "">[]).map((kleur) => (
                    <button
                      key={kleur}
                      type="button"
                      onClick={() =>
                        setPand((p) => ({ ...p, markering: p.markering === kleur ? "" : kleur }))
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        pand.markering === kleur
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                      }`}
                    >
                      <span
                        className={`size-2.5 rounded-full ring-1 ring-inset ${KLEUR_STIP[kleur]}`}
                      />
                      {markeringLabels[kleur]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPand((p) => ({ ...p, markering: "" }))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      pand.markering === ""
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    Geen
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Wassen vanaf</Label>
                <Select
                  value={pand.start_maand || METEEN}
                  onValueChange={(v) =>
                    setPand((p) => ({ ...p, start_maand: v === METEEN ? "" : v }))
                  }
                >
                  <SelectTrigger>
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
              </div>
            </div>

            {/* Losse maanden waarin dit adres niet meegaat: een vakantie, een
                steiger voor de gevel. Dit is iets anders dan het ritme —
                daarom staan ze los, met de eerste maand vooraan. */}
            <div className="space-y-2">
              <Label>Maanden overslaan</Label>
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
                      className={`rounded border px-1 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                        aan
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                      }`}
                    >
                      {toonMaandKort(m)}
                    </button>
                  );
                })}
              </div>
              {/* Maanden die al voorbij zijn staan niet in het rijtje hierboven,
                  maar tellen wel mee — dus zeg hoeveel het er in totaal zijn. */}
              {pand.overslaan.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPand((p) => ({ ...p, overslaan: [] }))}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Niets meer overslaan ({pand.overslaan.length})
                </button>
              )}
            </div>
          </div>

          {/* Twee adressen op één persoon is de uitzondering, dus het krijgt
              één regel: de andere adressen als labels, en een zoekveld dat
              alleen ruimte inneemt als je het opent. */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs">
            {extra.length > 0 && <span className="text-muted-foreground">Ook van deze klant:</span>}
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
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** De velden zonder id, zodat het formulier precies de bewerkbare kolommen houdt. */
function stripId(k: Klant) {
  const { id: _id, ...rest } = k;
  return rest;
}
