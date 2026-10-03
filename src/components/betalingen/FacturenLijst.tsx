import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft as ArrowLeft,
  IconReceipt as Bon,
  IconSend as Send,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBevestig } from "@/components/Bevestig";
import { VangnetLijst, VangnetVak } from "@/components/betalingen/Vangnet";
import { LosseFactuurDialog } from "@/components/facturen/LosseFactuurDialog";
import { formatPrice } from "@/lib/klanten";
import { cn } from "@/lib/utils";
import { datumSleutel, toonDatum, vandaag } from "@/lib/wasdag";
import {
  facturenKlaarzetten,
  facturenVersturen,
  exclusiefVoorop,
  factuurBetaald,
  factuurCrediteren,
  factuurMetRust,
  factuurOpnieuw,
  factuurStand,
  factuurWeggooien,
  fetchFacturen,
  fetchFactuurregels,
  fetchHerinneringenStraks,
  fetchLosseRegels,
  fetchVangnet,
  openBedrag,
  porNodig,
  type Factuur,
} from "@/lib/facturen";

type Filter = "alles" | "concept" | "verstuurd" | "telaat" | "betaald";

const FILTERS: { waarde: Filter; label: string }[] = [
  { waarde: "alles", label: "Alles" },
  { waarde: "concept", label: "Concepten" },
  { waarde: "verstuurd", label: "Verstuurd" },
  { waarde: "telaat", label: "Te laat" },
  { waarde: "betaald", label: "Betaald" },
];

function past(f: Factuur, filter: Filter): boolean {
  if (filter === "alles") return true;
  if (filter === "concept") return f.status === "concept";
  if (filter === "betaald") return f.status === "betaald";
  if (filter === "telaat") return f.te_laat;
  return f.status === "verstuurd";
}

/**
 * De facturen van de klanten die overmaken.
 *
 * Je komt binnen op de concepten, want daar is iets te doen. Een concept
 * heeft nog geen nummer en is nog vrij te veranderen; zodra je hem verstuurt
 * krijgt hij er een en staat hij vast. Rechtzetten kan daarna alleen nog met
 * een creditfactuur — de klant heeft dat papier immers al.
 */
export function FacturenLijst({ onTerug }: { onTerug?: () => void }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [filter, setFilter] = useState<Filter>("concept");
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  /** Staat de lijst met adressen die geen factuur opleveren open? */
  const [vangnetOpen, setVangnetOpen] = useState(false);

  const facturen = useQuery({ queryKey: ["facturen"], queryFn: () => fetchFacturen() });
  const los = useQuery({ queryKey: ["factuurregels-los"], queryFn: fetchLosseRegels });
  // Adressen op overmaken waar nooit een factuur van komt; zie Vangnet.tsx.
  const vangnet = useQuery({ queryKey: ["facturen-vangnet"], queryFn: fetchVangnet });
  // Wat er morgen vanzelf de deur uit gaat. Zie het gele vak hieronder.
  const straks = useQuery({
    queryKey: ["herinneringen-straks"],
    queryFn: fetchHerinneringenStraks,
  });
  const [straksOpen, setStraksOpen] = useState(false);
  const [losOpen, setLosOpen] = useState(false);

  const alles = useMemo(() => facturen.data ?? [], [facturen.data]);
  const lijst = useMemo(() => alles.filter((f) => past(f, filter)), [alles, filter]);
  const concepten = useMemo(() => alles.filter((f) => f.status === "concept"), [alles]);
  const teLaat = useMemo(() => alles.filter((f) => f.te_laat), [alles]);
  /** Hoe lang het oudste concept al klaarstaat; leeg als er niets te zeggen is. */
  const porDagen = porNodig(concepten, vandaag());
  const openTotaal = alles.reduce((t, f) => t + (f.status === "verstuurd" ? openBedrag(f) : 0), 0);

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["facturen"] });
    void qc.invalidateQueries({ queryKey: ["tegoed"] });
    void qc.invalidateQueries({ queryKey: ["factuurregels-los"] });
    // Ook het gele vak: vink je een factuur af als betaald of laat je hem met
    // rust, dan zou het anders blijven beloven dat er een herinnering naartoe
    // gaat die niet meer komt.
    void qc.invalidateQueries({ queryKey: ["herinneringen-straks"] });
  }

  const klaarzetten = useMutation({
    mutationFn: (nuOok: boolean) => facturenKlaarzetten(nuOok),
    onSuccess: (n) => {
      ververs();
      toast.success(
        n === 0
          ? "Er stond niets klaar te zetten."
          : n === 1
            ? "1 concept klaargezet."
            : `${n} concepten klaargezet.`,
      );
    },
    onError: (e: Error) => toast.error("Klaarzetten mislukt: " + e.message),
  });

  const versturen = useMutation({
    mutationFn: (ids: string[]) => facturenVersturen(ids),
    onSuccess: (r) => {
      setGekozen([]);
      ververs();
      if (r.mislukt.length === 0) {
        toast.success(r.gelukt === 1 ? "1 factuur verstuurd." : `${r.gelukt} facturen verstuurd.`);
      } else {
        toast.error(
          `${r.gelukt} verstuurd, ${r.mislukt.length} niet: ${r.mislukt[0]?.reden ?? ""}`,
        );
      }
    },
    onError: (e: Error) => toast.error("Versturen mislukt: " + e.message),
  });

  const teVersturen = gekozen.filter((id) =>
    alles.some((f) => f.id === id && f.status === "concept"),
  );

  /**
   * Een concept dat al een nummer heeft, is eerder vastgezet en toen blijven
   * steken. Meestal ging het mailen mis -- maar het kán ook zijn dat alleen
   * het laatste stapje ("zet de stand op verstuurd") niet lukte, en dan is de
   * mail wél weg. Dat kan de app niet zien, dus vragen we het.
   */
  const opnieuw = alles.filter((f) => teVersturen.includes(f.id) && f.nummer);

  async function versturenNaVraag() {
    if (opnieuw.length > 0) {
      const ja = await bevestig({
        titel: "Nog een keer versturen?",
        tekst:
          `${opnieuw.length === 1 ? `Factuur ${opnieuw[0]?.nummer}` : `${opnieuw.length} facturen`}` +
          " is eerder al vastgezet. Waarschijnlijk ging het mailen toen mis, maar als de mail toch" +
          " is aangekomen krijgt de klant hem nu twee keer. Het nummer blijft hetzelfde.",
        bevestigLabel: "Versturen",
      });
      if (!ja) return;
    }
    versturen.mutate(teVersturen);
  }

  /**
   * De herinnering van morgen tegenhouden.
   *
   * Twee weken, dezelfde termijn als de knop "met rust laten" verderop in de
   * lijst -- één dag overslaan heeft geen zin, want dan staat hij morgen
   * gewoon weer in dit vakje. Terugdraaien kan bij de factuur zelf.
   */
  async function nietDoen(id: string) {
    const tot = new Date();
    tot.setDate(tot.getDate() + 14);
    try {
      await factuurMetRust(id, datumSleutel(tot));
      ververs();
      toast.success("Deze factuur blijft twee weken met rust.");
    } catch (e) {
      toast.error("Niet gelukt: " + (e as Error).message);
    }
  }

  // Een eigen blad, want er hoort een printknop bij en dan mag de rest van de
  // tab niet mee op papier.
  if (vangnetOpen) {
    return <VangnetLijst rijen={vangnet.data ?? []} onTerug={() => setVangnetOpen(false)} />;
  }

  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-center gap-1.5">
        {onTerug && (
          <button
            type="button"
            onClick={onTerug}
            className="mr-1 flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground shadow-card hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Overzicht
          </button>
        )}
        {FILTERS.map((f) => (
          <button
            key={f.waarde}
            type="button"
            onClick={() => setFilter(f.waarde)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              filter === f.waarde
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
            {f.waarde === "concept" && concepten.length > 0 && ` (${concepten.length})`}
            {f.waarde === "telaat" && teLaat.length > 0 && ` (${teLaat.length})`}
          </button>
        ))}
        {/* Een factuur die niet uit de planning komt: een offerte die doorgaat,
            een eenmalige klus, iets wat je achteraf alsnog moet sturen. */}
        <button
          type="button"
          onClick={() => setLosOpen(true)}
          className="ml-auto flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground shadow-card hover:text-foreground"
        >
          <Bon className="size-4" /> Losse factuur
        </button>
        <span className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {formatPrice(openTotaal)}
          </span>{" "}
          nog niet binnen
        </span>
      </div>

      {/* De por. De concepten staan klaar, maar iemand moet op versturen
          drukken -- en dat is precies wat je vergeet. */}
      {porDagen !== null && (
        <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {concepten.length === 1
              ? "Er staat 1 concept"
              : `Er staan ${concepten.length} concepten`}{" "}
            klaar om te versturen; het oudste al {porDagen} dagen. Hoe later ze weggaan, hoe later
            het geld binnenkomt.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => {
              setFilter("concept");
              setGekozen(concepten.map((f) => f.id));
            }}
          >
            Allemaal kiezen
          </Button>
        </section>
      )}

      {/* Wat er morgen vanzelf weggaat.

          Een dag van tevoren, met een knop ernaast: een herinnering die je
          pas ziet als hij al bij je klant ligt, is geen automaat maar een
          verrassing. En soms weet jij iets wat de app niet weet -- die klant
          belde gisteren, of je hebt hem net in de kroeg gesproken. */}
      {(straks.data?.length ?? 0) > 0 && (
        <section className="space-y-2 rounded-[20px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">
              Bij de eerstvolgende ronde gaat er vanzelf een herinnering naar{" "}
              {straks.data?.length === 1 ? "1 factuur" : `${straks.data?.length} facturen`}. Die is
              elke ochtend.
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => setStraksOpen((o) => !o)}
            >
              {straksOpen ? "Verbergen" : "Bekijken"}
            </Button>
          </div>
          {straksOpen && (
            <ul className="space-y-1.5 border-t border-current/15 pt-2">
              {(straks.data ?? []).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{h.nummer}</span>
                  <span className="min-w-0 flex-1 truncate">{h.klant}</span>
                  <span className="tabular-nums">{formatPrice(h.bedrag)}</span>
                  <span className="text-[12px] opacity-80">
                    {h.trap === 1 ? "1e" : `${h.trap}e`} herinnering
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => void nietDoen(h.id)}
                  >
                    Niet doen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Wat er stilzwijgend niet gefactureerd wordt. Boven het gele vakje:
          hier gebeurt niets vanzelf, en dat is het vervelendste soort stilte. */}
      {vangnet.isError ? (
        // Juist hier niet stil zijn: deze controle bestaat om te vertellen dat
        // er iets ontbreekt, en dan is "niets te zien" het verkeerde antwoord.
        <p className="rounded-[20px] bg-tint-rood px-4 py-3 text-[13px] text-tint-rood-ink">
          De controle op adressen zonder factuur kon niet opgehaald worden. Er kunnen dus adressen
          zijn die stilzwijgend niets opleveren; ververs de pagina om het opnieuw te proberen.
        </p>
      ) : (
        <VangnetVak rijen={vangnet.data ?? []} onBekijk={() => setVangnetOpen(true)} />
      )}

      {/* Regels die nog op geen enkele factuur staan. Geel, met een knop:
          automatisch mag, maar je ziet het en je drukt zelf. */}
      {(los.data ?? 0) > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {los.data === 1
              ? "1 te factureren regel staat nog los."
              : `${los.data} te factureren regels staan nog los.`}{" "}
            Klanten die per maand, kwartaal, half jaar of jaar een factuur krijgen, wachten tot die
            periode voorbij is.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={klaarzetten.isPending}
            onClick={() => klaarzetten.mutate(false)}
          >
            {klaarzetten.isPending ? "Bezig…" : "Concepten klaarzetten"}
          </Button>
          {/* Voor als je niet wilt wachten, bv. een jaarklant die in maart
              stopt. Terug te draaien: een concept weggooien zet de regels
              weer los. */}
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-tint-amber-ink"
            disabled={klaarzetten.isPending}
            onClick={async () => {
              const ja = await bevestig({
                titel: "Ook wat nog wacht klaarzetten?",
                tekst:
                  "Klanten die per maand, kwartaal, half jaar of jaar een factuur krijgen, krijgen nu al een" +
                  " concept met wat er tot nu toe gedaan is. Wil je dat voor een klant toch niet, gooi dat" +
                  " concept dan weg: de regels wachten dan gewoon weer op het eind van de periode.",
                bevestigLabel: "Toch nu klaarzetten",
              });
              if (ja) klaarzetten.mutate(true);
            }}
          >
            Toch nu
          </Button>
        </section>
      )}

      <LosseFactuurDialog
        open={losOpen}
        onOpenChange={setLosOpen}
        onKlaar={() => {
          ververs();
          setFilter("concept");
        }}
      />

      {facturen.isLoading && <p className="text-[13px] text-muted-foreground">Laden…</p>}

      <section className="overflow-hidden rounded-[24px] border border-border bg-card shadow-card">
        {lijst.length === 0 && !facturen.isLoading ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            {filter !== "concept"
              ? "Niets te zien onder deze keuze."
              : (los.data ?? 0) > 0
                ? "Geen concepten. Er staan wel regels klaar: druk hierboven op “Concepten klaarzetten”."
                : alles.length > 0
                  ? "Geen concepten. Wat de deur uit is staat onder “Verstuurd”."
                  : "Nog geen facturen. Meld een dag helemaal af, dan staan de regels hierboven klaar om er concepten van te maken."}
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {lijst.map((f) => (
              <FactuurRegel
                key={f.id}
                f={f}
                gekozen={gekozen.includes(f.id)}
                onKies={(aan) =>
                  setGekozen((l) => (aan ? [...l, f.id] : l.filter((x) => x !== f.id)))
                }
                open={open === f.id}
                onOpen={() => setOpen(open === f.id ? null : f.id)}
                onVeranderd={ververs}
                bevestig={bevestig}
              />
            ))}
          </div>
        )}
      </section>

      {/* De balk verschijnt alleen als er wat te versturen is. */}
      {teVersturen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="min-w-0 flex-1 text-[13px]">
              {teVersturen.length} factuur{teVersturen.length === 1 ? "" : "en"} klaar om te
              versturen
            </span>
            <Button variant="ghost" size="sm" onClick={() => setGekozen([])}>
              Laat maar
            </Button>
            <Button
              className="rounded-full"
              disabled={versturen.isPending}
              onClick={() => void versturenNaVraag()}
            >
              <Send className="size-4" />
              {versturen.isPending ? "Bezig…" : "Versturen"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FactuurRegel({
  f,
  gekozen,
  onKies,
  open,
  onOpen,
  onVeranderd,
  bevestig,
}: {
  f: Factuur;
  gekozen: boolean;
  onKies: (aan: boolean) => void;
  open: boolean;
  onOpen: () => void;
  onVeranderd: () => void;
  bevestig: ReturnType<typeof useBevestig>;
}) {
  const concept = f.status === "concept";
  // Een bedrijf of VvE rekent zonder btw; een particulier in wat hij betaalt.
  const exclVoorop = exclusiefVoorop(f);
  const stand = factuurStand(f);

  return (
    <div className={f.te_laat ? "bg-tint-rood/40" : ""}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Ook een concept dat al een nummer heeft: dan is het vastzetten
            gelukt maar het mailen niet, en moet je het opnieuw kunnen
            proberen. Hij houdt hetzelfde nummer. */}
        {concept && (
          <Checkbox
            checked={gekozen}
            onCheckedChange={(v) => onKies(v === true)}
            aria-label={`${f.klant} kiezen`}
          />
        )}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px]">
            <b className="font-semibold">{f.klant}</b>
            {f.nummer && <span className="text-muted-foreground"> · {f.nummer}</span>}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {stand}
            {f.factuurdatum && ` · ${toonDatum(f.factuurdatum)}`}
            {f.vervaldatum && f.status === "verstuurd" && ` · vervalt ${toonDatum(f.vervaldatum)}`}
            {f.totalen.regels > 0 &&
              ` · ${f.totalen.regels} ${f.totalen.regels === 1 ? "regel" : "regels"}`}
            {!f.mail && <span className="text-tint-rood-ink"> · geen e-mailadres</span>}
          </span>
        </button>
        <span className="w-24 shrink-0 text-right font-display text-[16px] font-semibold tabular-nums">
          {formatPrice(exclVoorop ? f.totalen.excl : f.totalen.incl)}
        </span>
      </div>

      <FactuurDetail f={f} open={open} onVeranderd={onVeranderd} bevestig={bevestig} />
    </div>
  );
}

/**
 * Wat je ziet als je een factuur openklapt: de regels, de totalen en wat je
 * ermee kunt. Ook het klantdossier gebruikt hem. Hij blijft bestaan als hij
 * dicht is, zodat wat je bij een gecrediteerde factuur aanvinkte blijft staan.
 */
export function FactuurDetail({
  f,
  open,
  onVeranderd,
  bevestig,
  className,
}: {
  f: Factuur;
  open: boolean;
  onVeranderd: () => void;
  bevestig: ReturnType<typeof useBevestig>;
  className?: string | undefined;
}) {
  const concept = f.status === "concept";
  const gecrediteerd = f.status === "gecrediteerd";
  // Een bedrijf of VvE rekent zonder btw; een particulier in wat hij betaalt.
  const exclVoorop = exclusiefVoorop(f);
  const [opnieuwGekozen, setOpnieuwGekozen] = useState<string[]>([]);
  // Per pand het bedrag dat op de aangepaste factuur moet, als tekst zodat je
  // het veld ook even leeg kunt maken tijdens het typen.
  const [opnieuwBedrag, setOpnieuwBedrag] = useState<Record<string, string>>({});
  const regels = useQuery({
    queryKey: ["factuurregels", f.id],
    queryFn: () => fetchFactuurregels(f.id),
    enabled: open,
  });
  const nogOpen = openBedrag(f);
  // Wat de klant zelf betaalde, zonder het tegoed dat erop verrekend is.
  const zelfBetaald = Math.round((f.betaald_bedrag - f.tegoed_verrekend) * 100) / 100;
  // Een ander bedrag boeken dan wat er openstaat: een deel, of juist meer
  // (dan wordt het verschil tegoed). Als tekst, zodat het veld even leeg mag.
  const [anderBedrag, setAnderBedrag] = useState<string | null>(null);
  // Zolang er geboekt wordt, staan de knoppen uit: twee keer klikken zou
  // anders twee keer boeken, en het tweede deel wordt dan tegoed.
  const [boekt, setBoekt] = useState(false);
  // Op een gecrediteerde factuur staat niets meer open: alles wat er nog
  // binnenkomt, wordt tegoed voor de klant.
  const openVoorBoeken = gecrediteerd ? 0 : nogOpen;

  // Standaard staat alles aan: meestal moet bijna al het werk opnieuw op de
  // factuur en vink je alleen het pand uit dat niet gedaan is.
  //
  // Eén keer vullen, en daarna niet meer. De regels worden namelijk opnieuw
  // opgehaald zodra je terugkomt in het tabblad, en dan zou je uitgevinkte
  // pand en je aangepaste bedrag stil terugspringen naar de standaard --
  // zonder dat er iets op het scherm verandert wat dat verraadt.
  const gevuld = useRef<string | null>(null);
  useEffect(() => {
    if (!gecrediteerd || !regels.data || gevuld.current === f.id) return;
    gevuld.current = f.id;
    setOpnieuwGekozen(regels.data.map((r) => r.id));
    setOpnieuwBedrag(Object.fromEntries(regels.data.map((r) => [r.id, String(r.bedrag)])));
  }, [gecrediteerd, regels.data, f.id]);

  /** Bij elk aangevinkt pand hoort een bedrag boven nul. */
  const bedragenKloppen = opnieuwGekozen.every((id) => Number(opnieuwBedrag[id]) > 0);

  /**
   * Het aangevinkte werk van deze gecrediteerde factuur opnieuw aanmelden. Het
   * komt dan als los werk terug, waar je met "Concepten klaarzetten" een
   * aangepaste factuur van maakt.
   */
  const opnieuwZetten = useMutation({
    mutationFn: () =>
      factuurOpnieuw(
        f.id,
        opnieuwGekozen.map((id) => ({ id, bedrag: Number(opnieuwBedrag[id]) })),
      ),
    onSuccess: (n) => {
      onVeranderd();
      if (n === 0) {
        toast.info("Dit werk stond al klaar om opnieuw gefactureerd te worden.");
      } else {
        toast.success(n === 1 ? "1 pand staat weer klaar." : `${n} panden staan weer klaar.`, {
          description:
            "Druk bij Betalingen › Facturen op “Concepten klaarzetten” voor de aangepaste factuur.",
        });
      }
    },
    onError: (e: Error) => toast.error("Niet gelukt: " + e.message),
  });

  /** `null` = precies wat er nu openstaat; dat rekent de database uit. */
  async function afvinken(bedrag: number | null) {
    if (boekt) return;
    setBoekt(true);
    try {
      const uit = await factuurBetaald(f.id, bedrag);
      setAnderBedrag(null);
      onVeranderd();
      if (uit.tegoed > 0.005) {
        toast.success(`${formatPrice(uit.tegoed)} te veel betaald.`, {
          description: "Dat staat nu als tegoed bij de klant en gaat af van de volgende factuur.",
          duration: 8000,
        });
      } else if (uit.open > 0.005) {
        toast.success(`Geboekt. Er staat nog ${formatPrice(uit.open)} open.`);
      } else {
        toast.success("Afgevinkt als betaald.");
      }
    } catch (e) {
      toast.error("Afvinken mislukt: " + (e as Error).message);
    } finally {
      setBoekt(false);
    }
  }

  /** Het getypte bedrag, met een komma of een punt. Leeg of nul = niets. */
  const anderGetal = Number((anderBedrag ?? "").replace(",", "."));
  const anderKlopt = Number.isFinite(anderGetal) && anderGetal > 0;

  async function crediteren() {
    const ja = await bevestig({
      titel: `Factuur ${f.nummer} crediteren?`,
      tekst:
        "Er komt een creditfactuur met een eigen nummer die deze tegenboekt. Deze factuur zelf verandert niet — je klant heeft hem al. Daarna stuur je een aangepaste factuur met het juiste werk erop." +
        (f.betaald_bedrag > 0.005
          ? ` Wat er al op betaald is (${formatPrice(f.betaald_bedrag)}) komt als tegoed bij de klant en gaat af van de volgende factuur.`
          : ""),
      bevestigLabel: "Crediteren",
    });
    if (!ja) return;
    try {
      await factuurCrediteren(f.id);
      onVeranderd();
      // Twee stappen te gaan, en de tweede wordt het makkelijkst vergeten.
      toast.success("Creditfactuur staat als concept klaar.", {
        description: "Verstuur hem, en stuur daarna de aangepaste factuur met het juiste werk.",
        duration: 8000,
      });
    } catch (e) {
      toast.error("Crediteren mislukt: " + (e as Error).message);
    }
  }

  /**
   * Deze factuur even laten liggen: hij verdwijnt uit "Te laat" tot die
   * datum. Bedoeld voor het VvE-bestuur dat het in de volgende vergadering
   * behandelt. Twee weken is de standaard; nog een keer drukken haalt het
   * weer weg, zoals alles wat de app zelf zet.
   */
  async function metRust() {
    const aan = f.met_rust_tot !== null;
    const tot = new Date();
    tot.setDate(tot.getDate() + 14);
    try {
      await factuurMetRust(f.id, aan ? null : datumSleutel(tot));
      onVeranderd();
      toast.success(aan ? "Weer opgepakt." : "Twee weken met rust gelaten.");
    } catch (e) {
      toast.error("Niet gelukt: " + (e as Error).message);
    }
  }

  async function weggooien() {
    const ja = await bevestig({
      titel: "Concept weggooien?",
      tekst: "De te factureren regels blijven bestaan: die wachten gewoon op een volgende factuur.",
      bevestigLabel: "Weggooien",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await factuurWeggooien(f.id);
      onVeranderd();
    } catch (e) {
      toast.error("Weggooien mislukt: " + (e as Error).message);
    }
  }

  if (!open) return null;
  return (
    <div className={cn("space-y-3 border-t border-border/70 bg-surface px-4 py-3", className)}>
      {regels.isLoading ? (
        <p className="text-[12.5px] text-muted-foreground">Laden…</p>
      ) : (
        <div className="space-y-1">
          {(regels.data ?? []).map((r) => (
            <div key={r.id} className="flex gap-3 text-[12.5px]">
              {/* Bij een gecrediteerde factuur vink je hier aan welke
                  panden er op de aangepaste factuur moeten. */}
              {gecrediteerd && (
                <Checkbox
                  checked={opnieuwGekozen.includes(r.id)}
                  onCheckedChange={(v) =>
                    setOpnieuwGekozen((l) =>
                      v === true ? [...l, r.id] : l.filter((x) => x !== r.id),
                    )
                  }
                  aria-label={`${r.omschrijving} op de aangepaste factuur`}
                />
              )}
              <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                {toonDatum(r.datum)}
              </span>
              <span className="min-w-0 flex-1">
                {(r.aantal !== 1 || r.eenheid) && (
                  <span className="tabular-nums text-muted-foreground">
                    {String(r.aantal).replace(".", ",")}
                    {r.eenheid ? ` ${r.eenheid}` : " x"}{" "}
                  </span>
                )}
                {r.omschrijving}
                {r.notitie && <span className="text-muted-foreground"> · {r.notitie}</span>}
              </span>
              {/* Bij een gecrediteerde factuur is het bedrag aanpasbaar:
                  soms is niet een heel pand overgeslagen maar de helft. */}
              {gecrediteerd ? (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={opnieuwBedrag[r.id] ?? ""}
                  disabled={!opnieuwGekozen.includes(r.id)}
                  onChange={(e) => setOpnieuwBedrag((b) => ({ ...b, [r.id]: e.target.value }))}
                  aria-label={`Bedrag voor ${r.omschrijving}`}
                  className="w-20 shrink-0 rounded-lg border border-input bg-background/70 px-2 py-0.5 text-right tabular-nums disabled:opacity-40"
                />
              ) : (
                <span className="shrink-0 tabular-nums">
                  {formatPrice(exclVoorop ? r.bedrag_excl : r.bedrag_incl)}
                </span>
              )}
            </div>
          ))}
          <div className="flex gap-3 border-t border-border/70 pt-1 text-[12.5px] text-muted-foreground">
            <span className="min-w-0 flex-1 text-right">
              {exclVoorop
                ? `Btw ${formatPrice(f.totalen.btw)} · te betalen ${formatPrice(f.totalen.incl)}`
                : `Excl. btw ${formatPrice(f.totalen.excl)} · waarvan btw ${formatPrice(f.totalen.btw)}`}
            </span>
          </div>
          {f.tegoed_verrekend > 0.005 && (
            <div className="flex gap-3 text-[12.5px] text-muted-foreground">
              <span className="min-w-0 flex-1 text-right">
                Reeds betaald uit tegoed −{formatPrice(f.tegoed_verrekend)} · nog te betalen{" "}
                {formatPrice(Math.max(0, f.totalen.incl - f.tegoed_verrekend))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Wat deze factuur aan tegoed opleverde. Het staat bij de klant en
          gaat vanzelf af van zijn volgende factuur. */}
      {f.tegoed_uit > 0.005 && (
        <p className="rounded-[14px] bg-tint-groen px-3 py-2 text-[12.5px] text-tint-groen-ink">
          {gecrediteerd
            ? `Er was al ${formatPrice(f.tegoed_uit)} op betaald.`
            : `Er is ${formatPrice(f.tegoed_uit)} te veel betaald.`}{" "}
          Dat staat als tegoed bij de klant en gaat af van de volgende factuur.
        </p>
      )}

      {/* Na het crediteren: welke panden gaan er op de aangepaste factuur?
          Meestal alles op één na -- het pand dat niet gedaan is of vergeten
          werd. Daarom staat alles standaard aan. */}
      {gecrediteerd && (
        <p className="rounded-[14px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
          Deze factuur is teruggeboekt. Vink hierboven aan wat er wél gedaan is en zet dat op een
          aangepaste factuur.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {gecrediteerd && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={opnieuwGekozen.length === 0 || !bedragenKloppen || opnieuwZetten.isPending}
              onClick={() => opnieuwZetten.mutate()}
            >
              {opnieuwZetten.isPending
                ? "Bezig…"
                : opnieuwGekozen.length === 1
                  ? "1 pand opnieuw factureren"
                  : `${opnieuwGekozen.length} panden opnieuw factureren`}
            </Button>
            {opnieuwGekozen.length > 0 && !bedragenKloppen && (
              <span className="self-center text-[12.5px] text-tint-rood-ink">
                Vul bij elk aangevinkt pand een bedrag in.
              </span>
            )}
          </>
        )}
        {concept && !f.nummer && (
          <Button size="sm" variant="ghost" onClick={() => void weggooien()}>
            Weggooien
          </Button>
        )}
        {f.status === "verstuurd" && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={boekt}
              onClick={() => void afvinken(null)}
            >
              Betaald ({formatPrice(nogOpen)})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void metRust()}>
              {f.met_rust_tot ? "Weer oppakken" : "Even met rust"}
            </Button>
          </>
        )}
        {/* Een ander bedrag: een deel, of meer dan er openstond. Ook bij een
            betaalde of gecrediteerde factuur, want juist daar komt een
            dubbele overboeking binnen -- en die wordt tegoed. */}
        {f.soort === "factuur" && f.nummer && f.status !== "concept" && anderBedrag === null && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setAnderBedrag(openVoorBoeken > 0 ? String(openVoorBoeken).replace(".", ",") : "")
            }
          >
            {f.status === "verstuurd" ? "Ander bedrag…" : "Betaling boeken…"}
          </Button>
        )}
        {/* Ook bij een betaalde factuur. Terugbetalen ná ontvangst is
            juist het gewone geval, en het is de enige manier om een
            verstuurde factuur recht te zetten. Maar niet bij een factuur
            die alleen vastgezet is en nooit verstuurd: die heeft de klant
            nooit gezien, dus daar is niets tegen te boeken. */}
        {f.soort !== "credit" && (f.status === "verstuurd" || f.status === "betaald") && (
          <Button size="sm" variant="ghost" onClick={() => void crediteren()}>
            Crediteren
          </Button>
        )}
        {zelfBetaald > 0.005 && f.status !== "betaald" && (
          <span className="self-center text-[12.5px] text-muted-foreground">
            Al betaald: {formatPrice(zelfBetaald)}
          </span>
        )}
      </div>

      {anderBedrag !== null && (
        <form
          className="flex flex-wrap items-center gap-2 text-[12.5px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (anderKlopt) void afvinken(Math.round(anderGetal * 100) / 100);
          }}
        >
          <label htmlFor={`ander-bedrag-${f.id}`}>Ontvangen bedrag</label>
          <input
            id={`ander-bedrag-${f.id}`}
            type="text"
            inputMode="decimal"
            autoFocus
            value={anderBedrag}
            onChange={(e) => setAnderBedrag(e.target.value)}
            className="w-24 rounded-lg border border-input bg-background/70 px-2 py-1 text-right tabular-nums"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!anderKlopt || boekt}>
            Boeken
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAnderBedrag(null)}>
            Annuleren
          </Button>
          {gecrediteerd ? (
            <span className="text-muted-foreground">
              Deze factuur is gecrediteerd: het hele bedrag wordt tegoed voor de klant.
            </span>
          ) : (
            anderKlopt &&
            anderGetal - openVoorBoeken > 0.005 && (
              <span className="text-muted-foreground">
                {formatPrice(anderGetal - openVoorBoeken)} daarvan wordt tegoed voor de klant.
              </span>
            )
          )}
        </form>
      )}
    </div>
  );
}
