import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconCircleCheck as CircleCheck,
  IconCloudOff as CloudOff,
  IconCloudUpload as CloudUpload,
  IconLock as Lock,
  IconLockOpen as LockOpen,
  IconSearch as Search,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { BetaalPaneel } from "@/components/betalingen/BetaalPaneel";
import { GeldKaart } from "@/components/betalingen/GeldKaart";
import { StraatVerdelen } from "@/components/betalingen/StraatVerdelen";
import { TelBedrag } from "@/components/TelBedrag";
import { Button } from "@/components/ui/button";
import { frequentieZin, keerOpen, maandKort } from "@/lib/betalingen";
import { useGeldloopVast, zetGeldloopVast } from "@/lib/dagslot";
import {
  fetchGeldloopLijst,
  heeftIetsOpen,
  looprichting,
  aanDeBeurt,
  useGeldloopLive,
  vooruitTotVan,
  type GeldloopAdres,
  type GeldloopLijst,
  type Vrijgave,
} from "@/lib/geldlopen";
import { formatPrice, kantVan, type Kant } from "@/lib/klanten";
import { leesOpenStraat, onthoudOpenStraat } from "@/lib/openstraat";
import { heeftPlek, useZelfdePlek } from "@/lib/zelfdeplek";
import { vooruitLabel } from "@/lib/overzichten";
import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import {
  bijVerstuurd,
  metWachtende,
  probeerOpnieuw,
  useWachtrij,
  vergeetMislukt,
  type Wachtend,
} from "@/lib/geldloop-wachtrij";

/** Per avond, in deze tab: welk adres (of welke straat) bovenin stond. */
const PLEK_OPSLAG = "wooshy.geldloop-plek.";

/** Vanaf zoveel open wasbeurten staat het bedrag van een adres in het rood. */
export const ROOD_VANAF = 3;

/** Zolang blijft een straat die net af is groen staan voor de volgende openklapt. */
const GROEN_ZIEN_MS = 1500;

interface Straat {
  id: string;
  naam: string;
  wijk: string;
  adressen: GeldloopAdres[];
  /** Wie hem vanavond loopt; leeg is: iedereen die meeloopt. */
  lopers: { id: string; naam: string }[];
  /** Loop ik hem zelf, of is hij van niemand? */
  vanMij: boolean;
  /** Adressen waar vanavond iets te doen is: iets open, of al getikt. */
  teDoen: number;
  /** Daarvan vanavond al getikt (ook een deel betaald of niet thuis). */
  gedaan: number;
  /** Wat er in deze straat nog open staat. */
  openBedrag: number;
}

/** Elk adres waar iets te doen was, is vanavond getikt. */
function isAf(s: Straat): boolean {
  return s.teDoen > 0 && s.gedaan >= s.teDoen;
}

/** Adressen met iets open waar vanavond nog niemand getikt heeft. */
function nietGeweest(s: Straat): GeldloopAdres[] {
  return s.adressen.filter((a) => heeftIetsOpen(a) && !a.vanavond);
}

/** "1, 4 en 7A" — bij een lange rij de eerste vier en hoeveel er nog zijn. */
function nummersZin(lijst: GeldloopAdres[]): string {
  const nrs = lijst.map((a) => `${a.house_number}${a.addition}`);
  const getoond = nrs.length > 5 ? [...nrs.slice(0, 4), `nog ${nrs.length - 4} andere`] : nrs;
  return getoond.length === 1
    ? getoond[0]!
    : `${getoond.slice(0, -1).join(", ")} en ${getoond[getoond.length - 1]}`;
}

/** "jul, sep" en " + klus": waar het open bedrag vandaan komt. */
export function maandenVan(a: GeldloopAdres): string {
  const maanden = a.delen
    .filter((d) => d.soort === "wassen")
    .map((d) => maandKort(d.datum))
    .filter((m, i, lijst) => lijst.indexOf(m) === i);
  const extra = a.delen.some((d) => d.soort === "klus") ? ["klus"] : [];
  return [...(maanden.length ? [maanden.join(", ")] : []), ...extra].join(" + ");
}

/**
 * Welke straat er open staat. `wasAf` onthoudt of hij al af was toen je hem
 * koos: alleen een straat die onder je handen af raakt, blijft even groen op
 * zijn plek staan en geeft dan de beurt aan de volgende. Een straat die je
 * uit "Klaar" openklapt, blijft gewoon daar.
 */
interface Keuze {
  /** "" is: alles dichtgeklapt. */
  straat: string;
  wasAf: boolean;
}

/** Ga je de straat uit terwijl er nog adressen open staan? */
interface Melding {
  van: string;
  naar: string;
  /** Liep je met de pijltjes de straat uit, dan het adres waar je heen ging. */
  adres?: string;
}

/**
 * De lijst van één avond: de straten onder elkaar, en alleen de straat waar
 * je nu bent staat open. Tik een adres en er schuift een paneel omhoog met de
 * grote knoppen. Alles wat je vaak aantikt zit onderin, bij je duim.
 */
export function GeldloopScherm({
  vrijgave,
  titel = "Geldlopen",
  bovenaan,
}: {
  vrijgave: Vrijgave;
  titel?: string;
  /** Iets boven de lijst, zoals de keuze tussen twee avonden. */
  bovenaan?: ReactNode;
}) {
  const qc = useQueryClient();
  const lijst = useQuery({
    queryKey: ["geldloop-lijst", vrijgave.id],
    queryFn: () => fetchGeldloopLijst(vrijgave.id),
    // Realtime houdt hem bij; dit is de vangrail als dat even hapert.
    refetchInterval: 60_000,
  });
  useGeldloopLive(vrijgave.id);
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const magBedragen = useRecht("prijzen_zien");
  const wachtrij = useWachtrij(employee?.id);
  const vast = useGeldloopVast();

  // Een tik die binnen is, blijft in de lijst staan tot de verse lijst van
  // de server er is (die komt via het live meekijken).
  useEffect(
    () =>
      bijVerstuurd((t) => {
        if (t.vrijgave !== vrijgave.id) return;
        const sleutel = ["geldloop-lijst", vrijgave.id];
        // Een oudere lijst die nog onderweg is, mag deze tik niet overschrijven.
        void qc
          .cancelQueries({ queryKey: sleutel })
          .then(() =>
            qc.setQueryData<GeldloopLijst>(sleutel, (oud) => (oud ? metWachtende(oud, [t]) : oud)),
          );
      }),
    [qc, vrijgave.id],
  );
  const data = useMemo(
    () => (lijst.data ? metWachtende(lijst.data, wachtrij.wachtend) : undefined),
    [lijst.data, wachtrij.wachtend],
  );

  const [gekozen, setGekozen] = useState<string | null>(null);
  const [zoeken, setZoeken] = useState<string | null>(null);
  /**
   * Hoe je de avond bekijkt. "Beide kanten" zet de even en de oneven kant
   * naast elkaar — handig als je met z'n tweeën loopt of zelf de straat
   * overzigzagt. "Kaart" laat de jaarkaart van deze straat zien, zoals de
   * papieren kaart: hoe vaak stond het al open?
   */
  const [weergave, setWeergave] = useState<"lijst" | "kanten" | "kaart">("lijst");
  const [uitgeklapt, setUitgeklapt] = useState<Set<string>>(new Set());
  // Welke straat je aan het verdelen bent.
  const [verdeelStraatId, setVerdeelStraatId] = useState<string | null>(null);
  const [klaarUit, setKlaarUit] = useState(false);
  const [melding, setMelding] = useState<Melding | null>(null);
  // Per avond: wie twee avonden loopt, staat in elk in zijn eigen straat.
  const [keuzes, setKeuzes] = useState<Record<string, Keuze>>({});
  const onthouden = useMemo(() => leesOpenStraat(vrijgave.id), [vrijgave.id]);
  /**
   * De open straat in beeld schuiven, zodra hij er staat. Kom je terug in een
   * straat die je had openstaan, dan hoef je niet opnieuw te zoeken. Weten we
   * nog precies waar je was (welk adres bovenin, in deze tab), dan zet
   * useZelfdePlek je daar neer en blijft dit stil.
   */
  const plekSleutel = PLEK_OPSLAG + vrijgave.id;
  const [scrollen, setScrollen] = useState<ScrollBehavior | null>(() =>
    leesOpenStraat(vrijgave.id) && !heeftPlek(plekSleutel) ? "auto" : null,
  );
  // Staat het adres er niet meer (het zoeken is weg, of je koos op de kaart
  // een andere straat), dan alsnog de open straat in beeld.
  useZelfdePlek(plekSleutel, Boolean(lijst.data), "geldplek", () => setScrollen("auto"));
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const voorbij = nu >= Date.parse(vrijgave.eind_op);

  /** Alle straten van de avond, ook die waar niets te lopen valt (de kaart en zoeken). */
  const straten = useMemo<Straat[]>(() => {
    const perStraat = new Map<string, GeldloopAdres[]>();
    for (const a of data?.adressen ?? []) {
      // Nog niet gewassen deze maand: dan ben je hier nog niet aan de beurt.
      // Is de hele straat zo, dan valt die straat vanzelf weg.
      if (!aanDeBeurt(a)) continue;
      perStraat.set(a.straat_id, [...(perStraat.get(a.straat_id) ?? []), a]);
    }
    return [...perStraat.values()]
      .sort(
        (x, y) =>
          x[0]!.wijk_sort - y[0]!.wijk_sort ||
          x[0]!.straat_sort - y[0]!.straat_sort ||
          x[0]!.straat.localeCompare(y[0]!.straat),
      )
      .map((adressen) => {
        const lopers = adressen[0]!.straat_lopers;
        return {
          id: adressen[0]!.straat_id,
          naam: adressen[0]!.straat,
          wijk: adressen[0]!.wijk,
          adressen: looprichting(adressen),
          lopers,
          // Een straat die van niemand is, is van iedereen — dus ook van mij.
          vanMij: lopers.length === 0 || lopers.some((l) => l.id === employee?.id),
          teDoen: adressen.filter((a) => heeftIetsOpen(a) || a.vanavond).length,
          gedaan: adressen.filter((a) => a.vanavond).length,
          openBedrag: adressen.reduce((t, a) => t + Math.max(0, a.open), 0),
        };
      });
  }, [data, employee?.id]);
  /**
   * De straten waar vanavond iets te lopen valt. Alleen overmakers zonder
   * contant open, of niets open en niets getikt: dan hoef je er niet heen.
   */
  const lijstStraten = useMemo(() => straten.filter((s) => s.teDoen > 0), [straten]);

  const keuze: Keuze | undefined = keuzes[vrijgave.id];
  // Via een ref, zodat kiesStraat hetzelfde blijft als de lijst ververst:
  // anders begint de klok van "straat af" hieronder bij elke tik opnieuw.
  const stratenRef = useRef(lijstStraten);
  useEffect(() => {
    stratenRef.current = lijstStraten;
  }, [lijstStraten]);
  const kiesStraat = useCallback(
    (id: string, inBeeld = true) => {
      const s = stratenRef.current.find((x) => x.id === id);
      setKeuzes((was) => ({ ...was, [vrijgave.id]: { straat: id, wasAf: !!s && isAf(s) } }));
      onthoudOpenStraat(vrijgave.id, id);
      // Een melding over de vorige straat is daarmee beantwoord.
      setMelding(null);
      if (inBeeld && id) setScrollen("smooth");
    },
    [vrijgave.id],
  );

  /**
   * De volgorde waarin je de avond leest: eerst jouw straten die nog te lopen
   * zijn, dan die van een ander (met wie hem loopt erbij), en pas onderaan
   * wat al klaar is. Zo zie je in één blik waar het blijft hangen.
   */
  const standaard =
    lijstStraten.find((s) => s.vanMij && !isAf(s)) ?? lijstStraten.find((s) => !isAf(s));
  const gewenst = keuze?.straat ?? onthouden ?? standaard?.id ?? "";
  const huidige =
    gewenst === "" ? null : (lijstStraten.find((s) => s.id === gewenst) ?? standaard ?? null);
  // Raakt de open straat af terwijl je erin loopt, dan blijft hij even op
  // zijn plek staan, zodat je het groen nog ziet.
  const netAf =
    !!huidige && isAf(huidige) && !!keuze && keuze.straat === huidige.id && !keuze.wasAf;
  const teLopen = (s: Straat) => !isAf(s) || (netAf && s.id === huidige?.id);
  const mijn = lijstStraten.filter((s) => s.vanMij && teLopen(s));
  const vanAnder = lijstStraten.filter((s) => !s.vanMij && teLopen(s));
  const klaar = lijstStraten.filter((s) => !teLopen(s));
  const volgende = [...mijn, ...vanAnder].find((s) => s.id !== huidige?.id && !isAf(s));

  // Zolang je nog niets koos, staat de eerste straat open. Leg die vast, zodat
  // hij niet wegspringt zodra hij af raakt (dan zou de standaard de volgende
  // al zijn, nog voor je het groen zag).
  useEffect(() => {
    if (keuze || !huidige) return;
    setKeuzes((was) => ({
      ...was,
      [vrijgave.id]: { straat: huidige.id, wasAf: isAf(huidige) },
    }));
  }, [keuze, huidige, vrijgave.id]);

  // Straat af: na een kort moment klapt de volgende te lopen straat open.
  // Was dit de laatste, dan schuift hij bij de rest in "Klaar".
  const volgendeId = volgende?.id;
  const huidigeId = huidige?.id;
  useEffect(() => {
    if (!netAf || !huidigeId) return;
    const t = setTimeout(() => {
      if (volgendeId) kiesStraat(volgendeId);
      else setKeuzes((was) => ({ ...was, [vrijgave.id]: { straat: huidigeId, wasAf: true } }));
    }, GROEN_ZIEN_MS);
    return () => clearTimeout(t);
  }, [netAf, huidigeId, volgendeId, kiesStraat, vrijgave.id]);

  useEffect(() => {
    if (!scrollen || !data) return;
    document.querySelector("[data-open-straat]")?.scrollIntoView({
      block: "start",
      behavior: scrollen,
    });
    setScrollen(null);
  }, [scrollen, data, weergave]);

  const zoekTerm = (zoeken ?? "").trim().toLowerCase();
  // Het blok "Klaar" staat open als je het openklapte, of als de straat die
  // open staat erin zit (je had hem eerder gekozen, of alles is af).
  const klaarZichtbaar = klaarUit || klaar.some((s) => s.id === huidige?.id);
  const nogTeLopen = mijn.length + vanAnder.length;

  // De adressen op volgorde van de lijst: met de pijltjes in het venster
  // loop je daar doorheen, ook de straat uit. Je slaat over waar je toch niet
  // aanbelt (niets open, niets ingetikt), net als de lijst zelf doet; wat
  // klaar is en dicht staat ook.
  const volgorde = [...mijn, ...vanAnder, ...(klaarZichtbaar ? klaar : [])].flatMap(
    (s) => s.adressen,
  );
  // De kaart kijkt of zijn stratenlijst veranderde; dit scherm hertekent elke
  // tik, dus zonder dit zou hij zich telkens opnieuw opbouwen.
  const kaartStraten = useMemo(
    () => straten.map((s, i) => ({ id: s.id, name: s.naam, sort_order: i })),
    [straten],
  );

  /**
   * Moet je even gewaarschuwd worden als je deze straat uit gaat? Alleen in
   * een straat van jou, en alleen als je er al begonnen bent: wie bovenaan de
   * lijst een andere straat kiest om te beginnen, is niets vergeten. Liep je
   * met de pijltjes de straat door, dan was je er dus wel.
   */
  function waarschuwBijWeggaan(s: Straat, gelopen: boolean): boolean {
    return !zoekTerm && s.vanMij && nietGeweest(s).length > 0 && (gelopen || s.gedaan > 0);
  }

  function openStraat(s: Straat) {
    if (huidige && huidige.id !== s.id && waarschuwBijWeggaan(huidige, false)) {
      setMelding({ van: huidige.id, naar: s.id });
      return;
    }
    kiesStraat(s.id);
  }

  function naarAdres(a: GeldloopAdres) {
    const hier = lijstStraten.find((s) => s.adressen.some((x) => x.id === gekozen));
    if (hier && a.straat_id !== hier.id && !zoekTerm) {
      if (waarschuwBijWeggaan(hier, true)) {
        // Het paneel gaat dicht, zodat je de melding ziet.
        setGekozen(null);
        setMelding({ van: hier.id, naar: a.straat_id, adres: a.id });
        return;
      }
      kiesStraat(a.straat_id, false);
    }
    setGekozen(a.id);
  }

  function spring(stap: number) {
    if (!gekozen) return;
    let i = volgorde.findIndex((a) => a.id === gekozen);
    if (i < 0) return;
    for (i += stap; i >= 0 && i < volgorde.length; i += stap) {
      const a = volgorde[i]!;
      if (heeftIetsOpen(a) || a.vanavond || a.methode === "overmaken") {
        naarAdres(a);
        return;
      }
    }
  }

  const wijken = new Set(straten.map((s) => s.wijk));
  const adres = (data?.adressen ?? []).find((a) => a.id === gekozen) ?? null;
  // Alleen wat er in de lijst staat: adressen die nog op hun wasbeurt wachten
  // zijn eruit gefilterd, en dan hoort hun bedrag hier ook niet bij te staan.
  const openTotaal = straten.reduce((t, s) => t + s.openBedrag, 0);

  // De melding onderin: in welke straat ben je nog niet overal geweest?
  const meldingVan = melding ? lijstStraten.find((s) => s.id === melding.van) : undefined;
  const vergeten = meldingVan ? nietGeweest(meldingVan) : [];
  const meldingBlok = melding && meldingVan && vergeten.length > 0 && (
    <div
      role="alert"
      className="space-y-2 rounded-[16px] bg-foreground px-3.5 py-3 text-[13px] text-background shadow-card"
    >
      <p>
        In de {meldingVan.naam} ben je nog niet bij nr {nummersZin(vergeten)} geweest.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="min-h-9 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground"
          onClick={() => {
            kiesStraat(meldingVan.id);
            setGekozen(vergeten[0]!.id);
          }}
        >
          Terug naar nr {vergeten[0]!.house_number}
          {vergeten[0]!.addition}
        </button>
        <button
          type="button"
          className="min-h-9 rounded-full bg-background/15 px-3.5 text-[12.5px] font-semibold"
          onClick={() => {
            kiesStraat(melding.naar, !melding.adres);
            if (melding.adres) setGekozen(melding.adres);
          }}
        >
          Toch verder
        </button>
      </div>
    </div>
  );

  /**
   * De balk onderin: wat je opgehaald hebt, zoeken, en de melding als je een
   * straat uit gaat terwijl er nog iets open staat.
   */
  const onderbalk = (
    <Onderbalk
      eigenaar={isEigenaar}
      vrijgaveId={vrijgave.id}
      opgehaald={data?.opgehaald}
      wachtend={wachtrij.wachtend.length}
      online={wachtrij.online}
      zoeken={zoeken}
      onZoeken={setZoeken}
      melding={meldingBlok || null}
    />
  );

  // In een useMemo, want AppLayout meet zijn balk opnieuw zodra `acties` een
  // ander blokje is — dat hoeft alleen als je de schakelaar echt omzet.
  const acties = useMemo(
    () => (
      <>
        <div className="flex items-center gap-0.5 rounded-full bg-card p-1 shadow-card">
          {(
            [
              ["lijst", "Lijst"],
              ["kanten", "Beide kanten"],
              // De kaart komt uit geld_kaart, en die geeft niets terug zonder
              // "prijzen zien": voor een geldloper zou het een leeg vak zijn.
              ...(magBedragen ? ([["kaart", "Kaart"]] as const) : []),
            ] as const
          ).map(([w, naam]) => (
            <button
              key={w}
              type="button"
              aria-pressed={weergave === w}
              onClick={() => {
                setWeergave(w);
                // Andere weergave, zelfde straat: die blijft in beeld.
                setScrollen("auto");
              }}
              className={`min-h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                weergave === w
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground"
              }`}
            >
              {naam}
            </button>
          ))}
        </div>
        {/* Net als op de dag: de app opent op deze telefoon voortaan hier.
            Op de telefoon alleen het slotje; het woord blijft voor de
            schermlezer. */}
        <Button
          size="sm"
          variant={vast ? "default" : "outline"}
          className="rounded-full max-md:size-9 max-md:px-0"
          aria-pressed={vast}
          onClick={() => {
            zetGeldloopVast(!vast, vrijgave.eind_op);
            toast.success(
              vast
                ? "Losgemaakt: de app opent weer op Home."
                : `Vastgezet tot ${tijdVan(vrijgave.eind_op)}: tot het eind van de avond opent de app op deze telefoon op het geldlopen.`,
            );
          }}
          title={
            vast
              ? `Vastgezet tot ${tijdVan(vrijgave.eind_op)}: de app opent hier op het geldlopen. Tik om los te maken.`
              : "Vastzetten: de app opent op deze telefoon voortaan op het geldlopen"
          }
        >
          {vast ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
          <span className="max-md:sr-only">{vast ? "Vastgezet" : "Vastzetten"}</span>
        </Button>
      </>
    ),
    [weergave, magBedragen, vast, vrijgave.eind_op],
  );

  /** De straat die open staat: kop, adressen, en de groene balk als hij af is. */
  const openSectie = (s: Straat, adressen: GeldloopAdres[], inZoeken: boolean) => {
    // Wat vanavond aandacht vraagt; de rest klapt in.
    const zichtbaar = inZoeken
      ? adressen
      : adressen.filter((a) => heeftIetsOpen(a) || a.vanavond || a.methode === "overmaken");
    const rust = adressen.filter((a) => !zichtbaar.includes(a));
    const open = uitgeklapt.has(s.id);
    const af = isAf(s);
    const naam = (
      <span className="min-w-0 truncate font-display text-[15px] font-semibold">
        {s.naam}
        {wijken.size > 1 && (
          <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">{s.wijk}</span>
        )}
      </span>
    );
    return (
      <section
        key={s.id}
        id={`straat-${s.id}`}
        data-open-straat={inZoeken ? undefined : ""}
        className="scroll-mt-24 rounded-[24px] bg-card p-1.5 shadow-card"
      >
        {/* Het anker voor terugkomen is de kop, niet de hele straat: anders
            telt een lange straat als één plek en kom je bovenaan uit. */}
        <h2 data-geldplek={`straat-${s.id}`} className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
          {inZoeken ? (
            <span className="flex min-w-0 flex-1">{naam}</span>
          ) : (
            <button
              type="button"
              className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left"
              aria-expanded
              title={`${s.naam} dichtklappen`}
              onClick={() => kiesStraat("", false)}
            >
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              {naam}
            </button>
          )}
          <Teller s={s} />
          {/* Van wie is deze straat? Een straat van een ander zegt het met
              een naam; die van jou hoeft dat niet te roepen. */}
          <button
            type="button"
            className={`min-h-8 shrink-0 rounded-full px-2.5 text-[11.5px] font-medium ${
              s.vanMij
                ? "text-muted-foreground hover:bg-surface"
                : "bg-tint-amber text-tint-amber-ink"
            }`}
            title={`Wie loopt de ${s.naam}?`}
            onClick={() => setVerdeelStraatId(s.id)}
          >
            {s.lopers.length === 0
              ? "van iedereen"
              : s.vanMij
                ? s.lopers.length === 1
                  ? "van jou"
                  : `jij + ${s.lopers.length - 1}`
                : `van ${voornamen(s)}`}
          </button>
        </h2>
        {weergave === "kanten" ? (
          <BeideKanten adressen={adressen} onKies={setGekozen} />
        ) : (
          <div className="divide-y divide-border/60">
            {zichtbaar.map((a) => (
              <AdresRij key={a.id} a={a} onKies={() => setGekozen(a.id)} />
            ))}
            {rust.length > 0 && (
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-2.5 text-[12.5px] text-muted-foreground"
                onClick={() =>
                  setUitgeklapt((was) => {
                    const nu = new Set(was);
                    if (nu.has(s.id)) nu.delete(s.id);
                    else nu.add(s.id);
                    return nu;
                  })
                }
              >
                <ChevronDown
                  className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                />
                {rust.length} {rust.length === 1 ? "adres" : "adressen"} zonder iets open
              </button>
            )}
            {open && rust.map((a) => <AdresRij key={a.id} a={a} onKies={() => setGekozen(a.id)} />)}
          </div>
        )}
        {af && !inZoeken && (
          <div className="mx-1 mb-1 mt-1.5 flex items-center justify-between gap-2 rounded-[12px] bg-tint-groen px-3 py-2 text-[13.5px] font-semibold text-tint-groen-ink">
            <span className="min-w-0 truncate">{s.naam} klaar</span>
            <Check className="size-4 shrink-0" />
          </div>
        )}
      </section>
    );
  };

  const straatRegel = (s: Straat) =>
    s.id === huidige?.id ? (
      openSectie(s, s.adressen, false)
    ) : (
      <DichteStraat key={s.id} s={s} metWijk={wijken.size > 1} onKies={() => openStraat(s)} />
    );

  return (
    <AppLayout titel={titel} onderbalk={onderbalk} acties={acties}>
      {/* De kaart is een brede tabel; de looplijst leest juist prettiger smal. */}
      <div className={`mx-auto space-y-3 pb-6 ${weergave === "kaart" ? "max-w-5xl" : "max-w-2xl"}`}>
        {bovenaan}
        <div className="flex items-baseline justify-between gap-3 px-1 text-[13px] text-muted-foreground">
          <span>
            {[...wijken].join(", ")} · tot {tijdVan(vrijgave.eind_op)}
          </span>
          <span className="tabular-nums">nog {formatPrice(openTotaal)} open</span>
        </div>

        {wachtrij.mislukt.length > 0 && (
          <div className="space-y-1.5 rounded-[14px] bg-tint-rood px-4 py-3 text-[13px] text-tint-rood-ink">
            <p className="font-medium">Niet verwerkt</p>
            {wachtrij.mislukt.map((w: Wachtend) => (
              <div key={w.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  {w.adres_tekst ? `${w.adres_tekst} · ` : ""}
                  {w.soort.replace("_", " ")}
                  {w.bedrag ? ` ${formatPrice(w.bedrag)}` : ""} · {w.fout}
                </span>
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={() => probeerOpnieuw(w.id)}
                >
                  Opnieuw
                </button>
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={() => vergeetMislukt(w.id)}
                >
                  Weghalen
                </button>
              </div>
            ))}
          </div>
        )}

        {voorbij && (
          <div className="rounded-[14px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
            De avond is voorbij. Wat je hebt ingetikt is bewaard.
          </div>
        )}

        {lijst.isLoading && <p className="px-1 text-[13px] text-muted-foreground">Laden…</p>}
        {lijst.isError && (
          <p className="px-1 text-[13px] text-tint-rood-ink">{(lijst.error as Error).message}</p>
        )}

        {weergave === "kaart" ? (
          // De kaart opent op de straat die in de lijst open staat, en een
          // andere straat kiezen op de kaart klapt die in de lijst open.
          <GeldKaart
            compact
            straatId={
              (keuze?.straat && straten.some((s) => s.id === keuze.straat)
                ? keuze.straat
                : huidige?.id) ?? straten[0]?.id
            }
            onStraat={(id) => kiesStraat(id, false)}
            straten={kaartStraten}
          />
        ) : zoekTerm ? (
          // Zoeken kijkt in alle straten, ook die klaar zijn of waar niets
          // te lopen valt: wie je zoekt, wil je vinden.
          straten.map((s) => {
            const passend = s.adressen.filter(
              (a) =>
                `${a.house_number}${a.addition}`.toLowerCase().startsWith(zoekTerm) ||
                a.naam.toLowerCase().includes(zoekTerm),
            );
            return passend.length > 0 ? openSectie(s, passend, true) : null;
          })
        ) : (
          <>
            {nogTeLopen > 0 && (
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Nog te lopen · {nogTeLopen} {nogTeLopen === 1 ? "straat" : "straten"}
              </p>
            )}
            {mijn.map(straatRegel)}
            {vanAnder.map(straatRegel)}
            {klaar.length > 0 && (
              <button
                type="button"
                aria-expanded={klaarZichtbaar}
                onClick={() => {
                  // Dichtklappen terwijl de open straat erin zit: dan gaat
                  // die ook dicht, anders blijft het blok open staan.
                  if (klaarZichtbaar && klaar.some((s) => s.id === huidige?.id))
                    kiesStraat("", false);
                  setKlaarUit(!klaarZichtbaar);
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-[16px] border border-dashed border-border px-3.5 py-2 text-left text-[13px] font-medium text-muted-foreground"
              >
                <ChevronRight
                  className={`size-4 shrink-0 transition-transform ${klaarZichtbaar ? "rotate-90" : ""}`}
                />
                <span className="min-w-0 flex-1 truncate">
                  Klaar: {klaar.map((s) => s.naam).join(", ")}
                </span>
                <Check className="size-4 shrink-0 text-tint-groen-ink" />
              </button>
            )}
            {klaarZichtbaar && klaar.map(straatRegel)}
            {data && lijstStraten.length === 0 && (
              <p className="px-1 text-[13px] text-muted-foreground">
                Er valt vanavond nergens geld op te halen.
              </p>
            )}
          </>
        )}

        {/* Op de telefoon zit de balk boven de tabs (AppLayout zet hem daar);
            op een groter scherm plakt hij onderaan de lijst. */}
        <div className="sticky bottom-4 z-30 hidden md:block">{onderbalk}</div>
      </div>

      <StraatVerdelen
        open={verdeelStraatId !== null}
        vrijgave={vrijgave}
        straat={straten.find((s) => s.id === verdeelStraatId) ?? null}
        huidige={straten.find((s) => s.id === verdeelStraatId)?.lopers ?? []}
        onSluit={() => setVerdeelStraatId(null)}
        onVeranderd={() => void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] })}
      />

      <BetaalPaneel
        adres={adres}
        vrijgave={vrijgave}
        voorbij={voorbij}
        onSluit={() => setGekozen(null)}
        onVeranderd={() => void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] })}
        onVorige={() => spring(-1)}
        onVolgende={() => spring(1)}
      />
    </AppLayout>
  );
}

/** "Piet, Kees": wie een straat van een ander loopt. */
function voornamen(s: Straat): string {
  return s.lopers.map((l) => l.naam.split(" ")[0]).join(", ");
}

/** "2 van 5 gedaan", groen met een vinkje als de straat af is. */
function Teller({ s }: { s: Straat }) {
  const af = isAf(s);
  return (
    <span
      className={`flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums ${
        af ? "font-semibold text-tint-groen-ink" : "text-muted-foreground"
      }`}
    >
      {af && <Check className="size-3.5" />}
      {s.gedaan} van {s.teDoen} gedaan
    </span>
  );
}

/**
 * Een straat die dicht staat: hoe ver hij is, wat er nog open staat en wie
 * hem loopt. Het balkje staat er ook bij de straten van een ander, zodat je
 * ziet hoe ver die zijn. Tik erop en hij klapt open.
 */
function DichteStraat({ s, metWijk, onKies }: { s: Straat; metWijk: boolean; onKies: () => void }) {
  const af = isAf(s);
  const deel = s.teDoen > 0 ? Math.min(1, s.gedaan / s.teDoen) : 0;
  return (
    <button
      type="button"
      onClick={onKies}
      aria-expanded={false}
      data-geldplek={`straat-${s.id}`}
      className={`flex w-full flex-col gap-1.5 rounded-[16px] px-3.5 py-2.5 text-left ${
        af ? "border border-dashed border-border text-muted-foreground" : "bg-card shadow-card"
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={`min-w-0 flex-1 truncate font-display font-semibold ${af ? "text-[13.5px]" : "text-[15px]"}`}
        >
          {s.naam}
          {metWijk && (
            <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">{s.wijk}</span>
          )}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums ${
            af ? "font-semibold text-tint-groen-ink" : "text-muted-foreground"
          }`}
        >
          {af && <Check className="size-3.5" />}
          {s.gedaan} van {s.teDoen} gedaan
          {s.openBedrag > 0.005 && ` · ${formatPrice(s.openBedrag)}`}
        </span>
      </span>
      <span className="flex w-full items-center gap-2 pl-6">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
          <span
            className="block h-full rounded-full bg-tint-groen-ink transition-[width] duration-300"
            style={{ width: `${deel * 100}%` }}
          />
        </span>
        {!s.vanMij && (
          <span className="shrink-0 rounded-full bg-tint-amber px-2 text-[11px] font-medium text-tint-amber-ink">
            van {voornamen(s)}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * De even en de oneven kant naast elkaar, voor als je de straat overzigzagt
 * of met z'n tweeën loopt. Er is dan ongeveer 150 px per kant, dus alleen het
 * huisnummer en het bedrag passen; de naam zie je zodra je een adres aantikt.
 *
 * De verdeling is dezelfde als op de printlijst — even links, oneven rechts,
 * en een hoekhuis in de kolom die de wijklijst hem met de hand gaf — zodat
 * papier en telefoon naast elkaar hetzelfde beeld geven. Loopt de straat per
 * 1 op, dan is er geen overkant en knippen we de lijst doormidden.
 */
function BeideKanten({
  adressen,
  onKies,
}: {
  adressen: GeldloopAdres[];
  onKies: (id: string) => void;
}) {
  const doorlopend = adressen[0]?.doorlopend ?? false;
  const helft = Math.ceil(adressen.length / 2);
  const kant = (a: GeldloopAdres) =>
    kantVan({ house_number: a.house_number, hoek_kant: a.hoek_kant as Kant | "" });
  return (
    <div className="flex gap-1.5 px-1 pb-1">
      <Kolom
        naam={doorlopend ? "eerste helft" : "even"}
        lijst={doorlopend ? adressen.slice(0, helft) : adressen.filter((a) => kant(a) === "even")}
        onKies={onKies}
      />
      <Kolom
        naam={doorlopend ? "tweede helft" : "oneven"}
        lijst={doorlopend ? adressen.slice(helft) : adressen.filter((a) => kant(a) === "oneven")}
        onKies={onKies}
      />
    </div>
  );
}

function Kolom({
  naam,
  lijst,
  onKies,
}: {
  naam: string;
  lijst: GeldloopAdres[];
  onKies: (id: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {naam}
      </p>
      {/* Een eigen scrollvak per kant: de nummers lopen links en rechts zelden
          gelijk op, dus je moet de ene kant vooruit kunnen schuiven terwijl de
          andere blijft staan. Wat er niet is, staat er niet tussen. */}
      <div className="max-h-[52vh] space-y-1 overflow-y-auto overscroll-contain">
        {lijst.map((a) => (
          <Tegel key={a.id} a={a} onKies={() => onKies(a.id)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Wat er vanavond aan de deur gebeurde, voor de kleur van het vlak. Het vlak
 * zegt alleen dat: groen is betaald (helemaal of een deel), rood is niet
 * thuis of geen geld, lichtblauw is een overmaker waar je niet hoeft aan te
 * bellen. Veel pof kleurt alleen het bedrag, anders lijkt een adres waar je
 * nog heen moet er een waar je al geweest bent.
 */
function deurVan(a: GeldloopAdres) {
  const soort = a.vanavond?.soort;
  const betaald = soort === "betaald" || soort === "vooruit";
  const open = heeftIetsOpen(a);
  return {
    betaald,
    // Deel betaald boekt dezelfde soort tik als helemaal betaald. Het vlak
    // is dan ook groen, maar het restbedrag blijft staan in plaats van het
    // vinkje: zo leest het niet als afgerond en slaat de volgende loper hem
    // niet over.
    helemaal: betaald && !open,
    mislukt: !!soort && !betaald,
    overmaken: !soort && a.methode === "overmaken",
    open,
    veelPof: a.open_wassen >= ROOD_VANAF && open,
  };
}

function vlakVan(d: ReturnType<typeof deurVan>): string {
  return d.betaald
    ? "bg-tint-groen text-tint-groen-ink"
    : d.mislukt
      ? "bg-tint-rood text-tint-rood-ink"
      : d.overmaken
        ? "bg-tint-blauw text-tint-blauw-ink"
        : "";
}

/** Eén adres als tegeltje: het nummer en wat er nog moet gebeuren. */
function Tegel({ a, onKies }: { a: GeldloopAdres; onKies: () => void }) {
  const d = deurVan(a);
  const stil = !d.open && !a.vanavond && !d.overmaken;
  const keer = keerOpen(a.open_wassen);
  return (
    <button
      type="button"
      onClick={onKies}
      className={`flex min-h-11 w-full items-center justify-between gap-1.5 rounded-[11px] px-2 py-1.5 text-left transition-colors ${
        vlakVan(d) || (stil ? "text-muted-foreground" : "bg-surface")
      }`}
    >
      <span className="font-display text-[15px] font-semibold tabular-nums">
        {a.house_number}
        {a.addition}
      </span>
      {a.klachten.length > 0 && <span className="size-1.5 rounded-full bg-tint-rood-ink" />}
      <span className="truncate text-[12.5px] font-semibold tabular-nums">
        {d.helemaal ? (
          <Check className="size-4" />
        ) : d.mislukt && !d.open ? (
          a.vanavond?.soort === "niet_thuis" ? (
            "niet thuis"
          ) : (
            "geen geld"
          )
        ) : d.open ? (
          // Niet thuis of geen geld: het rode vlak zegt dat al, dus hier
          // blijft staan wat er nog open staat (en hoe vaak).
          <>
            {keer && <span className="mr-1 font-medium opacity-70">{keer}</span>}
            <span className={d.veelPof && !a.vanavond ? "text-tint-rood-ink" : ""}>
              {formatPrice(a.open)}
            </span>
          </>
        ) : d.overmaken ? (
          "maakt over"
        ) : (
          "—"
        )}
      </span>
    </button>
  );
}

function AdresRij({ a, onKies }: { a: GeldloopAdres; onKies: () => void }) {
  const d = deurVan(a);
  const vlak = vlakVan(d);
  const overmaken = a.methode === "overmaken";
  // Niets open maar nog beurten vooruit: dan zegt de rij tot wanneer.
  const vooruit = !overmaken && !a.gestopt && a.vooruit_over > 0 ? vooruitTotVan(a) : "";
  const nummer = `${a.house_number}${a.addition}`;
  return (
    <button
      type="button"
      onClick={onKies}
      data-geldplek={a.id}
      className={`flex min-h-14 w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors ${
        vlak || "active:bg-surface"
      }`}
    >
      <span
        className={`w-11 shrink-0 font-display text-[18px] font-semibold tabular-nums ${
          !vlak && !d.open ? "text-muted-foreground" : ""
        }`}
      >
        {nummer}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-[14px]">
          <span className="truncate">{a.naam || (overmaken ? "" : " ")}</span>
          {a.klachten.length > 0 && (
            <span
              className="size-2 shrink-0 rounded-full bg-tint-rood-ink"
              aria-label="Open klacht"
            />
          )}
          {a.gestopt && (
            <span className="shrink-0 rounded-full bg-surface px-1.5 text-[10.5px] text-muted-foreground">
              gestopt
            </span>
          )}
        </span>
        <span
          className={`block truncate text-[12px] ${vlak ? "opacity-80" : "text-muted-foreground"}`}
        >
          {overmaken
            ? d.open
              ? "maakt over · nog contant open"
              : "maakt over"
            : [
                frequentieZin(a),
                maandenVan(a),
                keerOpen(a.open_wassen),
                vooruit ? `betaald t/m ${vooruit}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {a.vanavond ? (
          <Status a={a} />
        ) : d.open ? (
          <span
            className={`font-display text-[16px] font-semibold tabular-nums ${d.veelPof ? "text-tint-rood-ink" : ""}`}
          >
            {formatPrice(a.open)}
          </span>
        ) : a.open < -0.005 ? (
          <span className="text-[12px] text-tint-groen-ink">tegoed {formatPrice(-a.open)}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Rechts in een rij die vanavond getikt is; de kleur komt van de rij. */
function Status({ a }: { a: GeldloopAdres }) {
  const v = a.vanavond!;
  const door = v.door_naam.split(" ")[0] ?? "";
  const rest = heeftIetsOpen(a);
  if (v.soort === "betaald" || v.soort === "vooruit") {
    const bedrag = `${v.soort === "vooruit" ? `${vooruitLabel(v.aantal)} · ` : ""}${formatPrice(v.bedrag)}`;
    return (
      <span className="flex flex-col items-end">
        {rest ? (
          // Maar een deel binnen: wat er nog moet staat groot, met "nog"
          // ervoor, en wat er betaald is eronder.
          <>
            <span className="font-display text-[15px] font-semibold tabular-nums">
              <span className="mr-1 text-[11px] font-medium opacity-80">nog</span>
              {formatPrice(a.open)}
            </span>
            <span className="text-[12px] font-medium tabular-nums">betaald {bedrag}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 font-display text-[15px] font-semibold tabular-nums">
            {bedrag}
            <Check className="size-4" />
          </span>
        )}
        <span className="mt-0.5 text-[11px] opacity-80">{door}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      {rest && (
        <span className="font-display text-[15px] font-semibold tabular-nums">
          {formatPrice(a.open)}
        </span>
      )}
      <span className="text-[12px] font-medium">
        {v.soort === "niet_thuis" ? "Niet thuis" : "Geen geld"} · {door}
      </span>
    </span>
  );
}

/** Onderin, bij je duim: wat je opgehaald hebt, en zoeken. */
function Onderbalk({
  eigenaar,
  vrijgaveId,
  opgehaald,
  wachtend,
  online,
  zoeken,
  onZoeken,
  melding,
}: {
  /** Alleen de eigenaar ziet wat het team samen ophaalde. */
  eigenaar: boolean;
  /** Kies je een andere avond, dan begint de teller opnieuw. */
  vrijgaveId: string;
  opgehaald: { mij: number; mij_aantal: number; totaal: number } | undefined;
  /** Hoeveel tikken er nog op de telefoon staan. */
  wachtend: number;
  online: boolean;
  zoeken: string | null;
  onZoeken: (z: string | null) => void;
  /** Ga je een straat uit met nog adressen open, dan staat dat hier. */
  melding: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {melding}
      {zoeken !== null && (
        <div className="flex items-center gap-2 rounded-full bg-card px-3 shadow-card">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            inputMode="search"
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            placeholder="Huisnummer of naam"
            value={zoeken}
            onChange={(e) => onZoeken(e.target.value)}
          />
          <button
            type="button"
            aria-label="Zoeken sluiten"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground"
            onClick={() => onZoeken(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 rounded-[16px] bg-card px-4 py-2.5 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] text-muted-foreground">Jij opgehaald</p>
          <p className="font-display text-[17px] font-semibold tabular-nums">
            <TelBedrag key={vrijgaveId} bedrag={opgehaald?.mij} />
            <span className="ml-1.5 text-[12.5px] font-normal text-muted-foreground">
              · {opgehaald?.mij_aantal ?? 0} {opgehaald?.mij_aantal === 1 ? "adres" : "adressen"}
            </span>
          </p>
        </div>
        {eigenaar && opgehaald && opgehaald.totaal > opgehaald.mij && (
          <div className="text-right">
            <p className="text-[11.5px] text-muted-foreground">Samen</p>
            <p className="text-[13px] font-medium tabular-nums">{formatPrice(opgehaald.totaal)}</p>
          </div>
        )}
        {wachtend > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-tint-amber-ink"
            title="Nog niet verstuurd: gaat zodra er bereik is"
          >
            {online ? <CloudUpload className="size-5" /> : <CloudOff className="size-5" />}
            {wachtend}
          </span>
        ) : online ? (
          <CircleCheck
            className="size-5 shrink-0 text-tint-groen-ink"
            aria-label="Alles verstuurd"
          />
        ) : (
          <CloudOff className="size-5 shrink-0 text-muted-foreground" aria-label="Geen bereik" />
        )}
        {zoeken === null && (
          <button
            type="button"
            aria-label="Zoeken"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface"
            onClick={() => onZoeken("")}
          >
            <Search className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** "23:00": hoe laat de avond afloopt. */
function tijdVan(moment: string): string {
  return new Date(moment).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}
