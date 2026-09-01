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
  BASISRITMES,
  basisRitmeVan,
  ritmeLabel,
  type BasisRitme,
  formatNumber,
  koppelKlant,
  updateCustomer,
  zorgVoorAdresRegel,
  type Customer,
  type District,
  type Klant,
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

/** Prijs, ritme en notitie van het adres zelf. */
interface Pand {
  price: string;
  /** Een van de drie basisritmes, of "anders" als het adres in de wijklijst
   *  een fijner ritme heeft gekregen — dat laten we dan met rust. */
  ritme: BasisRitme | "anders";
  note: string;
}

const LEEG_PAND: Pand = { price: "", ritme: "elke", note: "" };

function pandVan(c: Customer): Pand {
  return {
    price: c.price ? String(c.price) : "",
    ritme: basisRitmeVan(c),
    note: c.note ?? "",
  };
}

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
    try {
      const bewaard = await bewaarKlant(klant?.id ?? null, velden);

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
      const overgenomen = customers.filter(
        (c) => alles.includes(c.id) && c.klant_id && c.klant_id !== klant?.id,
      );

      await koppelKlant(
        alles.filter((id) => !was.includes(id)),
        bewaard.id,
      );
      await koppelKlant(
        was.filter((id) => !alles.includes(id)),
        null,
      );

      // Prijs, ritme en notitie horen bij dít adres. De bijgekoppelde
      // adressen houden de hunne; die bewerk je in hun eigen dossier.
      if (adresId) {
        const basis = BASISRITMES.find((b) => b.waarde === pand.ritme);
        await updateCustomer(adresId, {
          price: prijsGetal(pand.price),
          note: pand.note.trim(),
          // Bij "anders" niets aanraken: dat ritme is hier niet te kiezen en
          // hoort niet stilletjes teruggezet te worden naar elke maand.
          ...(basis ? { interval_maanden: basis.interval_maanden, ritme: basis.ritme } : {}),
        });
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prijs">Prijs (€)</Label>
              <Input
                id="prijs"
                inputMode="decimal"
                placeholder="0"
                value={pand.price}
                onChange={(e) => setPand((p) => ({ ...p, price: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Hoe vaak</Label>
              <Select
                value={pand.ritme}
                onValueChange={(v) => setPand((p) => ({ ...p, ritme: v as BasisRitme }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BASISRITMES.map((b) => (
                    <SelectItem key={b.waarde} value={b.waarde}>
                      {b.label}
                    </SelectItem>
                  ))}
                  {/* Een ritme uit de wijklijst kun je hier zien maar niet
                      maken; daar horen de maanden bij die je hier niet ziet. */}
                  {pand.ritme === "anders" && voorstelCustomer && (
                    <SelectItem value="anders" disabled>
                      {ritmeLabel(voorstelCustomer)} (stel je in de lijst in)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Notitie bij dit adres</Label>
              {/* Hetzelfde veld met snelkeuzes als op de wijkenpagina; dit is
                  de notitie die op de printlijst terechtkomt. */}
              <NotitieCel
                value={pand.note}
                quickNotes={quickNotes}
                onChange={(v) => setPand((p) => ({ ...p, note: v }))}
                onAddQuickNote={onAddQuickNote}
                className="flex h-9 w-full items-center truncate rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm hover:bg-accent/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notitie">Notitie bij de persoon</Label>
              <Input
                id="notitie"
                value={velden.notitie}
                onChange={(e) => zet({ notitie: e.target.value })}
              />
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
