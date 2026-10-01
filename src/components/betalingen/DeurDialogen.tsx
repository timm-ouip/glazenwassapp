import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconCalendarDollar as CalendarDollar,
  IconCash as Cash,
  IconCheck as Check,
  IconDiscount as Discount,
  IconMinus as Minus,
  IconPlus as Plus,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import {
  beurtenTekst,
  dagKort,
  maandenVanDeKaart,
  maandKort,
  vooruitEerst,
  type GeldDeel,
} from "@/lib/betalingen";
import { klachtAanDeDeur, maakVasteKorting, type GeldloopAdres } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";

/**
 * Wat de korting en de gedeeltelijke betaling van een adres nodig hebben. Een
 * deel van een geldloop-adres, zodat de dag (het menu Betalen) dezelfde
 * vensters kan gebruiken met de stand uit het dossier.
 */
export type DeurAdres = Pick<
  GeldloopAdres,
  "id" | "open" | "delen" | "house_number" | "addition" | "vaste_kortingen"
>;

/** De redenen die aan de deur het vaakst voorkomen. */
const REDENEN = ["Horren", "Luiken dicht", "Raam vergeten", "Niet goed schoon"];

function leesBedrag(tekst: string): number | null {
  const n = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const groteInvoer =
  "h-14 rounded-[14px] text-center font-display text-[26px] font-semibold tabular-nums";

/** Een bedrag als tekst, zoals het in een invulvak hoort: "17,5". */
function alsTekst(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/**
 * Korting aan de deur: een bedrag en een reden. Daarna de vraag of het
 * voortaan vast bij dit adres hoort, zoals horren die er altijd voor zitten.
 *
 * Twee invulvakken, want aan de deur denk je nu eens in de korting ("die
 * horen kosten een vijfje minder") en dan weer in het eindbedrag ("we maken
 * er dertig van"). Vul er één in en het andere rekent zichzelf uit.
 */
export function KortingDialoog({
  open,
  adres,
  onSluit,
  onKorting,
  onVeranderd,
  meerDanOpen = false,
}: {
  open: boolean;
  adres: DeurAdres;
  onSluit: () => void;
  onKorting: (bedrag: number, reden: string) => Promise<boolean>;
  onVeranderd: () => void;
  /** Op kantoor mag de korting hoger zijn dan wat er openstaat (ook als er
   *  niets openstaat): het verschil wordt tegoed. Aan de deur niet. */
  meerDanOpen?: boolean;
}) {
  const [bedrag, setBedrag] = useState("");
  const [totaal, setTotaal] = useState("");
  const [reden, setReden] = useState("");
  const [stap, setStap] = useState<"invullen" | "onthouden">("invullen");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBedrag("");
    setTotaal("");
    setReden("");
    setStap("invullen");
  }, [open]);

  const waarde = leesBedrag(bedrag);

  /** Typ je de korting, dan volgt het nieuwe totaal, en andersom. */
  function zetKorting(tekst: string) {
    setBedrag(tekst);
    const k = leesBedrag(tekst);
    setTotaal(k === null ? "" : alsTekst(Math.max(0, adres.open - k)));
  }
  function zetTotaal(tekst: string) {
    setTotaal(tekst);
    const t = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
    if (!Number.isFinite(t) || tekst.trim() === "") {
      setBedrag("");
      return;
    }
    setBedrag(alsTekst(Math.max(0, adres.open - t)));
  }
  const alVast = adres.vaste_kortingen.some(
    (k) => k.naam.toLowerCase() === reden.trim().toLowerCase(),
  );

  async function geef() {
    if (!waarde) {
      toast.error("Vul een bedrag in.");
      return;
    }
    if (!reden.trim()) {
      toast.error("Zet erbij waarom.");
      return;
    }
    if (!meerDanOpen && waarde > adres.open + 0.005) {
      toast.error(`Meer korting dan er open staat (${formatPrice(adres.open)}).`);
      return;
    }
    setBezig(true);
    try {
      if (!(await onKorting(waarde, reden.trim()))) return;
      if (alVast) onSluit();
      else setStap("onthouden");
    } finally {
      setBezig(false);
    }
  }

  async function onthoud() {
    if (!waarde) return;
    setBezig(true);
    try {
      // Een knop heeft een korte naam; een lange reden past daar niet op.
      await maakVasteKorting(adres.id, reden.trim().slice(0, 40), waarde);
      onVeranderd();
      toast.success(`${reden.trim()} −${formatPrice(waarde)} staat voortaan klaar bij dit adres`);
      onSluit();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="amber"
          icoon={<Discount className="size-[22px]" />}
          titel="Korting"
          subtitel={`Nr ${adres.house_number}${adres.addition} · ${
            meerDanOpen && adres.open < -0.005
              ? `tegoed ${formatPrice(-adres.open)}`
              : `open ${formatPrice(adres.open)}`
          }`}
        />
        {stap === "invullen" ? (
          <>
            <PopupBody className="gap-3">
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[12.5px] text-muted-foreground">Korting</span>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    aria-label="Bedrag korting"
                    className={groteInvoer}
                    placeholder="€ 0"
                    value={bedrag}
                    onChange={(e) => zetKorting(e.target.value)}
                  />
                </label>
                {/* Staat er op kantoor niets open, dan is er ook geen nieuw totaal:
                    de korting wordt tegoed. */}
                {(!meerDanOpen || adres.open > 0.005) && (
                  <>
                    <span className="pb-4 text-[18px] text-muted-foreground">→</span>
                    <label className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[12.5px] text-muted-foreground">Nieuw totaal</span>
                      <Input
                        inputMode="decimal"
                        aria-label="Nieuw totaalbedrag"
                        className={groteInvoer}
                        placeholder={formatPrice(adres.open)}
                        value={totaal}
                        onChange={(e) => zetTotaal(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
              {meerDanOpen && waarde !== null && waarde > Math.max(0, adres.open) + 0.005 && (
                <p className="text-[12.5px] text-muted-foreground">
                  {formatPrice(waarde - Math.max(0, adres.open))} hiervan wordt tegoed voor de
                  volgende beurten.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {REDENEN.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReden(r)}
                    className={`min-h-10 rounded-full border px-3.5 text-[13.5px] font-medium ${
                      reden === r
                        ? "border-transparent bg-tint-amber text-tint-amber-ink"
                        : "border-border bg-card"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input
                aria-label="Reden"
                className="h-11 rounded-[12px]"
                placeholder="Of schrijf zelf waarom"
                maxLength={200}
                value={reden}
                onChange={(e) => setReden(e.target.value)}
              />
            </PopupBody>
            <PopupVoet>
              <Button variant="outline" className="rounded-full" onClick={onSluit}>
                Annuleren
              </Button>
              <Button className="rounded-full" disabled={bezig} onClick={() => void geef()}>
                Korting geven
              </Button>
            </PopupVoet>
          </>
        ) : (
          <>
            <PopupBody>
              <p className="text-[15px]">
                Voortaan <b>{reden.trim()}</b> −{formatPrice(waarde ?? 0)} bij dit adres?
              </p>
              <p className="text-[13px] text-muted-foreground">
                Dan staat er de volgende keer een knop voor klaar, en hoef je het niet opnieuw in te
                typen.
              </p>
            </PopupBody>
            <PopupVoet>
              <Button variant="outline" className="rounded-full" onClick={onSluit}>
                Nee, alleen nu
              </Button>
              <Button className="rounded-full" disabled={bezig} onClick={() => void onthoud()}>
                Ja, onthouden
              </Button>
            </PopupVoet>
          </>
        )}
      </PopupKader>
    </Dialog>
  );
}

/**
 * Eén open post, zoals hij in het venster staat: één wasbeurt, één klus, of
 * de stand van de kaart. Anders dan op de rekening worden gelijke wasbeurten
 * hier niet samengevoegd — je wilt ze juist los kunnen afvinken.
 */
interface OpenPost {
  sleutel: string;
  label: string;
  wanneer: string;
  bedrag: number;
}

function openPosten(delen: GeldDeel[]): OpenPost[] {
  return [...delen]
    .filter((d) => d.rest > 0.005)
    .sort((x, y) => x.datum.localeCompare(y.datum))
    .map((d, i) => {
      if (d.soort === "klus") {
        return {
          sleutel: `klus-${d.datum}-${i}`,
          label: `Klus: ${d.omschrijving || "extra werk"}`,
          wanneer: dagKort(d.datum),
          bedrag: d.rest,
        };
      }
      if (d.soort === "beginstand") {
        // De maanden waar de pof voor staat; de peildatum zegt alleen wanneer
        // de kaart is overgenomen en hoort hier dus niet als maand te staan.
        const maanden = maandenVanDeKaart(d);
        return {
          sleutel: `beginstand-${d.datum}-${i}`,
          label: d.aantal > 1 ? `${d.aantal}× wasbeurt` : "Wasbeurt",
          wanneer: maanden.length > 0 ? maanden.join(", ") : `van vóór ${dagKort(d.datum)}`,
          bedrag: d.rest,
        };
      }
      return {
        sleutel: `wassen-${d.datum}-${i}`,
        // De beurt zelf is vooruit betaald; open is alleen het extra werk.
        label: (d.vooruit ?? 0) > 0.005 ? "Meerprijs" : "Wasbeurt",
        wanneer: maandKort(d.datum),
        bedrag: d.rest,
      };
    });
}

/**
 * Een gedeeltelijke betaling: hij geeft niet alles. Je kunt de wasbeurten
 * afvinken die hij wél betaalt, of gewoon intypen wat je kreeg — wat je
 * afvinkt telt het bedrag voor je op.
 *
 * Afvinken gaat van oud naar nieuw en neemt alles erboven mee, want een
 * betaling dekt altijd eerst de oudste post. Zo staat er op het scherm
 * hetzelfde als wat de administratie ervan maakt.
 */
export function BedragDialoog({
  open,
  adres,
  onSluit,
  onBedrag,
}: {
  open: boolean;
  adres: DeurAdres;
  onSluit: () => void;
  onBedrag: (bedrag: number) => Promise<boolean>;
}) {
  const [bedrag, setBedrag] = useState("");
  const [tot, setTot] = useState(0);
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBedrag("");
    setTot(0);
  }, [open]);

  const posten = openPosten(adres.delen);
  const waarde = leesBedrag(bedrag);
  const rest = waarde !== null ? Math.round((adres.open - waarde) * 100) / 100 : null;

  /** Alles tot en met deze post; nog een keer op dezelfde tikken zet hem uit. */
  function vinkTot(i: number) {
    const nieuwTot = tot === i + 1 ? i : i + 1;
    setTot(nieuwTot);
    const som = posten.slice(0, nieuwTot).reduce((t, x) => t + x.bedrag, 0);
    setBedrag(nieuwTot === 0 ? "" : String(Math.round(som * 100) / 100).replace(".", ","));
  }

  async function boek() {
    if (!waarde) {
      toast.error("Vul in wat je kreeg, of vink af wat hij betaalt.");
      return;
    }
    setBezig(true);
    try {
      if (await onBedrag(waarde)) onSluit();
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="groen"
          icoon={<Cash className="size-[22px]" />}
          titel="Gedeeltelijke betaling"
          subtitel={`Nr ${adres.house_number}${adres.addition} · open ${formatPrice(adres.open)}`}
        />
        <PopupBody className="gap-3">
          {posten.length > 1 && (
            <div className="overflow-hidden rounded-[14px] border border-border">
              {posten.map((post, i) => {
                const aan = i < tot;
                return (
                  <button
                    key={post.sleutel}
                    type="button"
                    aria-pressed={aan}
                    onClick={() => vinkTot(i)}
                    className={`flex min-h-12 w-full items-center gap-2.5 px-3 text-left text-[14px] ${
                      i > 0 ? "border-t border-border" : ""
                    } ${aan ? "bg-tint-groen text-tint-groen-ink" : "bg-card"}`}
                  >
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-[6px] border ${
                        aan
                          ? "border-transparent bg-tint-groen-ink text-tint-groen"
                          : "border-border"
                      }`}
                    >
                      {aan && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {post.label}{" "}
                      <span className={aan ? "opacity-70" : "text-muted-foreground"}>
                        {post.wanneer}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatPrice(post.bedrag)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <Input
            autoFocus={posten.length <= 1}
            inputMode="decimal"
            aria-label="Betaald bedrag"
            className={groteInvoer}
            placeholder="€ 0"
            value={bedrag}
            onChange={(e) => {
              setBedrag(e.target.value);
              setTot(0);
            }}
          />
          {rest !== null && (
            <p className="text-center text-[13px] text-muted-foreground">
              {rest > 0.005
                ? `Er blijft ${formatPrice(rest)} open`
                : rest < -0.005
                  ? `${formatPrice(-rest)} gaat als tegoed naar de volgende keer`
                  : "Daarmee is alles betaald"}
            </p>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig || !waarde} onClick={() => void boek()}>
            Betaald {waarde ? formatPrice(waarde) : ""}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

/**
 * Vooruit betalen: de klant betaalt nu voor een aantal beurten tegen de
 * prijs die hij normaal per beurt betaalt. De app rekent het bedrag uit; de
 * prijs kan alleen de eigenaar aanpassen.
 *
 * Staat er nog een gewassen beurt open, dan telt die als eerste van de
 * beurten (zo rekent de database ook). De papieren kaart en klussen gaan er
 * niet af: die betaalt hij apart, en dat zegt het venster erbij.
 */
export function VooruitDialoog({
  open,
  subtitel,
  delen,
  prijs,
  prijsAanpassen = false,
  vanaf,
  maandenVoor,
  onSluit,
  onVooruit,
}: {
  open: boolean;
  /** "Nr 12" of het adres, onder de titel. */
  subtitel: string;
  /** Wat er nu open staat. */
  delen: GeldDeel[];
  /** Vanaf welke wasbeurt de betaling telt, van de database (zie vooruitEerst). */
  vanaf: string | null | undefined;
  /**
   * Voor welke maanden zoveel beurten ongeveer betalen ("2026-09", ...; zie
   * vooruitNieuweMaanden). Zonder dit, of zonder frequentie om mee te
   * rekenen, staan alleen de open beurten erbij die als eerste tellen.
   */
  maandenVoor?: ((aantal: number) => string[]) | undefined;
  /** De prijs per beurt zoals de database hem voorstelt; leeg zonder gewone prijs. */
  prijs: number | null;
  prijsAanpassen?: boolean;
  onSluit: () => void;
  onVooruit: (aantal: number, prijsPerBeurt: number) => Promise<boolean>;
}) {
  const [aantal, setAantal] = useState(4);
  const [prijsTekst, setPrijsTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAantal(4);
    setPrijsTekst(prijs === null ? "" : alsTekst(prijs));
  }, [open, prijs]);

  const perBeurt = prijsAanpassen ? leesBedrag(prijsTekst) : prijs;
  const totaal = perBeurt ? Math.round(aantal * perBeurt * 100) / 100 : null;
  // De open wasbeurten die als eerste een beurt gebruiken: de beurt van nu,
  // of anders de open beurten, oudste eerst (zoals de database).
  const telt = vooruitEerst(delen, vanaf).slice(0, aantal);
  const openBeurten = telt.map((d) => maandKort(d.datum));
  // Wat er daarnaast open blijft: oudere pof, de papieren kaart, een klus.
  const apart = delen.filter((d) => !telt.includes(d)).reduce((t, d) => t + d.rest, 0);
  const maanden = maandenVoor?.(aantal) ?? [];
  const maandenTekst =
    maanden.length === aantal ? lijstTekst(maanden.map((m) => maandKort(`${m}-01`))) : "";

  async function boek() {
    if (!perBeurt || perBeurt > 1000) {
      toast.error("Vul een prijs per beurt in.");
      return;
    }
    setBezig(true);
    try {
      if (await onVooruit(aantal, perBeurt)) onSluit();
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-sm">
        <PopupKop
          kleur="paars"
          icoon={<CalendarDollar className="size-[22px]" />}
          titel="Vooruit betalen"
          subtitel={subtitel}
        />
        <PopupBody className="gap-3">
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Eén beurt minder"
              className="size-12 rounded-full"
              disabled={aantal <= 1}
              onClick={() => setAantal((n) => Math.max(1, n - 1))}
            >
              <Minus className="size-5" />
            </Button>
            <span className="min-w-[6.5rem] text-center">
              <span className="block font-display text-[34px] font-semibold leading-none tabular-nums">
                {aantal}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {aantal === 1 ? "beurt" : "beurten"}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Eén beurt meer"
              className="size-12 rounded-full"
              disabled={aantal >= 12}
              onClick={() => setAantal((n) => Math.min(12, n + 1))}
            >
              <Plus className="size-5" />
            </Button>
          </div>
          {prijsAanpassen && (
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-muted-foreground">Prijs per beurt</span>
              <Input
                inputMode="decimal"
                aria-label="Prijs per beurt"
                className="h-10 w-28 rounded-full text-right tabular-nums"
                value={prijsTekst}
                onChange={(e) => setPrijsTekst(e.target.value)}
              />
            </label>
          )}
          <p className="rounded-[14px] bg-surface px-3 py-2.5 text-center text-[15px] font-semibold tabular-nums">
            {perBeurt && totaal !== null
              ? `${beurtenTekst(aantal)} × ${formatPrice(perBeurt)} = ${formatPrice(totaal)}`
              : "Vul een prijs per beurt in"}
          </p>
          {maandenTekst && (
            <p className="text-center text-[13.5px]">
              Betaald voor <span className="font-semibold">{maandenTekst}</span>
            </p>
          )}
          {openBeurten.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {openBeurten.length === 1
                ? `De open beurt van ${openBeurten[0]} telt als eerste.`
                : `De open beurten van ${openBeurten.join(", ")} tellen als eerste.`}
            </p>
          )}
          {apart > 0.005 && (
            <p className="text-[13px] text-muted-foreground">
              Nog {formatPrice(apart)} open van eerder, de papieren kaart of een klus: dat gaat hier
              niet af, dat betaalt hij apart.
            </p>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button
            className="rounded-full"
            disabled={bezig || totaal === null}
            onClick={() => void boek()}
          >
            Betaald {totaal !== null ? formatPrice(totaal) : ""}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

/** "sep", "sep en okt", "sep, okt, nov en dec". */
function lijstTekst(woorden: string[]): string {
  if (woorden.length <= 1) return woorden.join("");
  return `${woorden.slice(0, -1).join(", ")} en ${woorden[woorden.length - 1]}`;
}

/** Een klacht aan de deur: komt in het dossier van de klant, kastanje. */
export function KlachtDialoog({
  open,
  adres,
  onSluit,
  onVeranderd,
}: {
  open: boolean;
  adres: GeldloopAdres;
  onSluit: () => void;
  onVeranderd: () => void;
}) {
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (open) setTekst("");
  }, [open]);

  async function bewaar() {
    if (!tekst.trim()) {
      toast.error("Schrijf op wat de klacht is.");
      return;
    }
    setBezig(true);
    try {
      await klachtAanDeDeur(adres.id, tekst.trim());
      onVeranderd();
      toast.success(`Klacht genoteerd · nr ${adres.house_number}${adres.addition}`);
      onSluit();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      {/* Het sluitkruisje staat buiten de kopstrook en neemt de tekstkleur van
          de kaart over — op de diepe kastanje band is dat in de lichte thema's
          bijna onzichtbaar. Daarom hier licht gezet. */}
      <PopupKader className="sm:max-w-sm [&>button]:text-tint-kastanje-ink">
        <PopupKop
          kleur="kastanje"
          icoon={<AlertTriangle className="size-[22px]" />}
          titel="Klacht"
          subtitel={`Nr ${adres.house_number}${adres.addition}${adres.naam ? ` · ${adres.naam}` : ""}`}
        />
        <PopupBody>
          <Textarea
            autoFocus
            rows={4}
            maxLength={500}
            className="rounded-[14px] text-[15px]"
            placeholder="Wat is er mis? Bijvoorbeeld: raam boven niet gedaan"
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
          />
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
            Klacht opslaan
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
