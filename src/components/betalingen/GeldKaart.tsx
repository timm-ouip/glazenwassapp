import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconPencil as Pencil,
  IconSearch as Search,
  IconX as X,
} from "@tabler/icons-react";

import {
  BeginstandBalk,
  BeginstandBedragen,
  BeginstandStarten,
} from "@/components/betalingen/Beginstand";
import { Button } from "@/components/ui/button";
import { useBevestig } from "@/components/Bevestig";
import { useAuth } from "@/lib/auth";
import {
  effectieveMethode,
  fetchGeldStandWijk,
  frequentieKaart,
  zetBeginstand,
} from "@/lib/betalingen";
import { fetchVrijgaven } from "@/lib/geldlopen";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  formatPrice,
  maandwerkVoor,
  ritmeMaanden,
  sortCustomers,
  type Customer,
} from "@/lib/klanten";
import { fetchKaart, soortLabel, type Kaart, type KaartAdres } from "@/lib/overzichten";
import { cn } from "@/lib/utils";

const MAANDEN = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MAANDNAMEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/** Pijltjes in de kaart: [rijen, maanden] verder. */
const PIJLEN: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** De maand waar we nu in zitten, als "2026-09". */
function dezeMaand(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Vak =
  | { soort: "betaald"; aantal: number; korting: boolean }
  | { soort: "open"; nogOpen: boolean }
  | { soort: "overgeslagen" }
  | { soort: "niet_aan_de_beurt" }
  | { soort: "leeg" };

function maandVan(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** De maanden die in de beginstand open stonden ("2026-07"), uit de post. */
function beginMaandenVan(data: KaartAdres | undefined): string[] {
  const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
  return (begin?.omschrijving ?? "").split(",").filter((m) => /^\d{4}-\d{2}$/.test(m));
}

/**
 * Wat er in één maandvakje staat, zoals op de papieren kaart:
 *   1, 2 …  zoveel wasbeurten zijn die maand betaald (2 = er stond er een open)
 *   0       er is gewassen (of de kaart stond open) maar niet betaald
 *   ×       overgeslagen, buiten de gewone frequentie om
 *   %       niet aan de beurt volgens de frequentie
 * Losse klussen tellen niet mee: op de kaart staan alleen wasbeurten. Een
 * wasbeurt die met eerder tegoed betaald is, telt in de maand dat hij gewassen
 * werd.
 */
function vakVoor(
  c: Customer,
  data: KaartAdres | undefined,
  maand: string,
  peilMaand: string | null,
  concept?: string[],
): Vak {
  const posten = (data?.posten ?? []).filter((p) => p.soort !== "klus");
  // Net aangevinkt maar nog niet bewaard: dat tonen we alvast.
  const beginMaanden = concept ?? beginMaandenVan(data);
  const betaald = posten.filter((p) => {
    if (!p.betaald_op) return false;
    const betaalMaand = maandVan(p.betaald_op);
    const postMaand = p.datum.slice(0, 7);
    return (betaalMaand > postMaand ? betaalMaand : postMaand) === maand;
  });
  if (betaald.length > 0) {
    return {
      soort: "betaald",
      aantal: betaald.reduce((t, p) => t + (p.soort === "beginstand" ? p.aantal : 1), 0),
      korting: betaald.every((p) => p.betaald_soort === "korting"),
    };
  }
  // Vóór (en in) de startmaand: wat er op de kaart nog open stond. Is de
  // beginstand als bedrag ingetypt (zonder maanden), dan staat hij als 0 in
  // de startmaand.
  if (peilMaand && maand <= peilMaand) {
    const begin = posten.find((p) => p.soort === "beginstand");
    if (
      beginMaanden.includes(maand) ||
      (!concept && begin && beginMaanden.length === 0 && maand === peilMaand)
    ) {
      return {
        soort: "open",
        nogOpen: !!concept || !begin || begin.gedekt < begin.bedrag - 0.005,
      };
    }
  }
  // Vanaf de startmaand: gewassen maar (nog) niet betaald.
  if (!peilMaand || maand >= peilMaand) {
    const gewassen = posten.filter((p) => p.soort === "wassen" && p.datum.slice(0, 7) === maand);
    if (gewassen.length > 0) {
      return { soort: "open", nogOpen: gewassen.some((p) => p.gedekt < p.bedrag - 0.005) };
    }
  }
  if (c.overslaan.includes(maand)) return { soort: "overgeslagen" };
  const m = Number(maand.slice(5, 7));
  if (!ritmeMaanden(c).includes(m) && maandwerkVoor(c, maand).length === 0) {
    return { soort: "niet_aan_de_beurt" };
  }
  return { soort: "leeg" };
}

/**
 * De kaartweergave: per straat een jaar, zoals de papieren kaart. Tik een
 * vakje en je ziet wie wanneer wat intikte.
 *
 * Hier zit ook het invullen van de beginstand, want dat hoort bij dezelfde
 * kaart: met "Pofjes invullen" tik je de maanden aan die op de papieren kaart
 * nog open stonden, en met de wisselknop typ je ze desgewenst als bedrag per
 * adres. Met het toetsenbord kan het aanvinken ook: pijltjes om te lopen, 0
 * voor pof en Backspace om hem weg te halen.
 *
 * Zodra de beginstand klaar is én er daarna een keer geld gelopen is, hoeft er
 * nooit meer iets ingevuld te worden: de grote knop maakt dan plaats voor een
 * klein "Bewerken", zodat de eigenaar er wel altijd bij kan.
 */
export function GeldKaart({
  straatId,
  wijkId: gevraagdeWijk,
  onStraat,
  straten,
  compact = false,
}: {
  straatId: string | undefined;
  /** Een wijk zonder straat, bijvoorbeeld vanuit het wijkmenu. */
  wijkId?: string | undefined;
  onStraat: (id: string) => void;
  /** Alleen deze straten in het strookje, bijvoorbeeld die van vanavond. */
  straten?: { id: string; name: string; sort_order: number }[] | undefined;
  /** Meekijken zonder de rest: geen wijken, geen zoeken, geen invullen. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customers = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
  });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const [jaar, setJaar] = useState(() => new Date().getFullYear());
  const [invullen, setInvullen] = useState(false);
  const [weergave, setWeergave] = useState<"kaart" | "bedragen">("kaart");
  const [gekozen, setGekozen] = useState<{ adres: string; maand: string } | null>(null);
  const [zoek, setZoek] = useState("");
  const [markeer, setMarkeer] = useState<string | null>(null);
  const [alleStraten, setAlleStraten] = useState(false);
  // De pof-maanden die nog bewaard worden, per adres, zodat je door kunt tikken.
  const [concept, setConcept] = useState<Record<string, string[]>>({});
  // Dezelfde stand, maar meteen bij: tik je sneller dan het scherm bijwerkt,
  // dan bouwt de volgende tik toch voort op de vorige.
  const conceptNu = useRef(concept);
  function wijzigConcept(adres: string, lijst: string[] | null) {
    const rest = { ...conceptNu.current };
    if (lijst) rest[adres] = lijst;
    else delete rest[adres];
    conceptNu.current = rest;
    setConcept(rest);
  }
  const opslag = useRef(new Map<string, { keten: Promise<void>; versie: number }>());
  // Het vakje waar het toetsenbord staat (rij, maand).
  const [cursor, setCursor] = useState({ r: 0, k: 0 });
  const tabel = useRef<HTMLTableElement>(null);
  const bevestig = useBevestig();

  const straat = (streets.data ?? []).find((s) => s.id === straatId);
  const wijkId = straat?.district_id ?? gevraagdeWijk ?? districts.data?.[0]?.id;
  const wijk = (districts.data ?? []).find((d) => d.id === wijkId);
  const stratenVanWijk = useMemo(
    () =>
      straten ??
      (streets.data ?? [])
        .filter((s) => s.district_id === wijkId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [straten, streets.data, wijkId],
  );

  // Zonder keuze: de eerste straat van de eerste wijk.
  useEffect(() => {
    if (!straatId && stratenVanWijk[0]) onStraat(stratenVanWijk[0].id);
  }, [straatId, stratenVanWijk, onStraat]);

  const kaart = useQuery({
    queryKey: ["geld-kaart", straatId, jaar],
    queryFn: () => fetchKaart(straatId!, jaar),
    enabled: !!straatId,
  });
  const perAdres = useMemo(
    () => new Map((kaart.data?.adressen ?? []).map((a) => [a.id, a])),
    [kaart.data],
  );
  const namen = useMemo(
    () => new Map((klanten.data ?? []).map((k) => [k.id, k.naam])),
    [klanten.data],
  );
  const adressen = useMemo(
    () => sortCustomers((customers.data ?? []).filter((c) => c.street_id === straatId)),
    [customers.data, straatId],
  );

  // Uit de wijkenlijst en niet uit de kaart: die is leeg zolang een andere
  // straat of een ander jaar laadt, en dan zou het scherm even denken dat de
  // wijk nog niet meedoet — met de knop "Beginnen" erbij.
  const peil = wijk?.geld_peildatum ?? null;
  const peilMaand = peil ? peil.slice(0, 7) : null;
  const maanden = MAANDEN.map((_, i) => `${jaar}-${String(i + 1).padStart(2, "0")}`);
  const nuMaand = dezeMaand();

  // De beginstand klaar én daarna een keer geld gelopen: dan hoeft er niets
  // meer ingevuld te worden en wordt de knop een klein "Bewerken".
  const klaarSinds = wijk?.geld_klaar_op?.slice(0, 10);
  const vrijgaven = useQuery({
    // Dezelfde sleutel als het scherm Vrijgeven: geeft de eigenaar daar een
    // avond vrij of trekt hij hem in, dan ververst deze mee.
    queryKey: ["geldloop-vrijgaven", klaarSinds],
    queryFn: () => fetchVrijgaven(klaarSinds!),
    enabled: isEigenaar && !!klaarSinds,
    staleTime: 5 * 60_000,
  });
  const alGelopen = (vrijgaven.data ?? []).some(
    (v) =>
      !v.ingetrokken_op &&
      Date.parse(v.eind_op) < Date.now() &&
      v.wijken.some((w) => w.id === wijkId),
  );

  // De bedragenweergave rekent met de hele wijk, niet met één straat.
  const stand = useQuery({
    queryKey: ["geld-stand", wijkId],
    queryFn: () => fetchGeldStandWijk(wijkId!),
    enabled: !!wijkId && !!peil && invullen,
  });
  const wijkAdressen = useMemo(() => {
    const ids = new Set(stratenVanWijk.map((s) => s.id));
    return (customers.data ?? []).filter((c) => ids.has(c.street_id) && !c.inactief_op);
  }, [customers.data, stratenVanWijk]);

  const vernieuwWijk = () => {
    void qc.invalidateQueries({ queryKey: ["districts"] });
    void qc.invalidateQueries({ queryKey: ["geld-stand", wijkId] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
  };

  /** Zet een maand aan of uit als pof van vóór de start (of wissel hem). */
  async function zetBegin(c: Customer, maand: string, aan: boolean | "wissel") {
    // Vers uit de cache: net na het bewaren is de kaart op het scherm nog van ervoor.
    const vers = qc.getQueryData<Kaart>(["geld-kaart", straatId, jaar]);
    const data = vers?.adressen.find((a) => a.id === c.id) ?? perAdres.get(c.id);
    const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
    const nu = new Set(conceptNu.current[c.id] ?? beginMaandenVan(data));
    const wordtAan = aan === "wissel" ? !nu.has(maand) : aan;
    // Een ingetypt bedrag (zonder maanden) staat als 0 in de startmaand.
    const ingetypt =
      !conceptNu.current[c.id] && begin && begin.bedrag > 0 && nu.size === 0 ? begin : null;
    if (ingetypt && !wordtAan) {
      if (maand !== peilMaand) return;
      const ja = await bevestig({
        titel: "Ingetypte beginstand weghalen?",
        tekst: `Hier staat nu ${formatPrice(ingetypt.bedrag)} als beginstand, ingetypt zonder maanden.`,
        bevestigLabel: "Weghalen",
      });
      if (!ja) return;
    } else {
      if (wordtAan === nu.has(maand)) return;
      // Aanvinken vervangt een ingetypt bedrag door maanden × prijs.
      if (ingetypt) {
        const ja = await bevestig({
          titel: "Ingetypte beginstand vervangen?",
          tekst: `Hier staat nu ${formatPrice(ingetypt.bedrag)} als beginstand. Met aanvinken wordt dat het aantal maanden × ${formatPrice(c.price)}.`,
          bevestigLabel: "Vervangen",
        });
        if (!ja) return;
      }
    }
    if (wordtAan) nu.add(maand);
    else nu.delete(maand);
    const lijst = [...nu].sort();
    if (c.price <= 0 && lijst.length > 0) {
      toast.error("Dit adres heeft nog geen prijs, dus Wooshy weet niet wat een maand kost.");
      return;
    }
    wijzigConcept(c.id, lijst);
    // Per adres op volgorde bewaren; tik je snel door, dan telt alleen de laatste stand.
    const vorige = opslag.current.get(c.id);
    const versie = (vorige?.versie ?? 0) + 1;
    const laatste = () => opslag.current.get(c.id)?.versie === versie;
    const keten = (vorige?.keten ?? Promise.resolve()).then(async () => {
      if (!laatste()) return;
      try {
        await zetBeginstand(c.id, lijst.length * c.price, Math.max(1, lijst.length), lijst);
        await qc.invalidateQueries({ queryKey: ["geld-kaart", straatId] });
        void qc.invalidateQueries({ queryKey: ["geld-stand"] });
      } catch (e) {
        toast.error((e as Error).message);
      }
      if (laatste()) wijzigConcept(c.id, null);
    });
    opslag.current.set(c.id, { keten, versie });
  }

  function naarVak(r: number, k: number) {
    if (adressen.length === 0) return;
    const rij = Math.min(Math.max(r, 0), adressen.length - 1);
    const kol = Math.min(Math.max(k, 0), 11);
    setCursor({ r: rij, k: kol });
    tabel.current?.querySelector<HTMLButtonElement>(`[data-vak="${rij}-${kol}"]`)?.focus();
  }

  function opToets(
    e: KeyboardEvent,
    r: number,
    k: number,
    c: Customer,
    maand: string,
    kanAanvinken: boolean,
  ) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const stap = PIJLEN[e.key];
    if (stap) {
      e.preventDefault();
      naarVak(r + stap[0], k + stap[1]);
    } else if (kanAanvinken && e.key === "0") {
      e.preventDefault();
      void zetBegin(c, maand, true);
    } else if (kanAanvinken && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      void zetBegin(c, maand, false);
    }
  }

  // De maand waar het aanvinken begint: de startmaand, als die in dit jaar valt.
  const startKolom =
    peilMaand && Number(peilMaand.slice(0, 4)) === jaar
      ? Number(peilMaand.slice(5, 7)) - 1
      : peilMaand && Number(peilMaand.slice(0, 4)) > jaar
        ? 11
        : 0;
  const cursorRij = Math.min(cursor.r, Math.max(adressen.length - 1, 0));

  const details = gekozen ? perAdres.get(gekozen.adres) : undefined;
  const detailAdres = gekozen ? adressen.find((c) => c.id === gekozen.adres) : undefined;

  // Zoeken: straatnaam, huisnummer of klantnaam, door alle wijken heen.
  const zoekTerm = zoek.trim().toLowerCase();
  const treffers = useMemo(() => {
    if (zoekTerm.length === 0) return [];
    // Alleen straten in een wijk die je hier ook kunt kiezen: anders kom je
    // uit bij een kaart zonder wijk erboven.
    const bekend = new Set((districts.data ?? []).map((d) => d.id));
    const bruikbaar = (streets.data ?? []).filter((s) => bekend.has(s.district_id));
    const straatNaam = new Map(bruikbaar.map((s) => [s.id, s.name]));
    const uit: { sleutel: string; straat: string; label: string; adres?: string }[] = [];
    for (const s of bruikbaar) {
      if (s.name.toLowerCase().includes(zoekTerm)) {
        uit.push({ sleutel: `s${s.id}`, straat: s.id, label: s.name });
      }
    }
    for (const c of customers.data ?? []) {
      if (!straatNaam.has(c.street_id)) continue;
      const naam = c.klant_id ? (namen.get(c.klant_id) ?? "") : "";
      const nummer = `${c.house_number}${c.addition}`.toLowerCase();
      if (!nummer.startsWith(zoekTerm) && !naam.toLowerCase().includes(zoekTerm)) continue;
      uit.push({
        sleutel: `a${c.id}`,
        straat: c.street_id,
        label: `${straatNaam.get(c.street_id) ?? ""} ${c.house_number}${c.addition}${
          naam ? ` · ${naam}` : ""
        }`,
        adres: c.id,
      });
    }
    return uit.slice(0, 12);
  }, [zoekTerm, districts.data, streets.data, customers.data, namen]);

  // Een gezocht adres even laten oplichten, dan weer gewoon.
  useEffect(() => {
    if (!markeer) return;
    tabel.current
      ?.querySelector(`[data-adres="${markeer}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setMarkeer(null), 5000);
    return () => clearTimeout(t);
  }, [markeer, straatId]);

  // Passen de straten niet in twee rijen, dan komt er een knop "alle straten".
  const stratenVak = useRef<HTMLDivElement>(null);
  const [tweeRijenVol, setTweeRijenVol] = useState(false);
  useEffect(() => {
    const el = stratenVak.current;
    if (!el) return;
    const meet = () => {
      if (!alleStraten) setTweeRijenVol(el.scrollHeight > el.clientHeight + 2);
    };
    meet();
    const kijker = new ResizeObserver(meet);
    kijker.observe(el);
    return () => kijker.disconnect();
  }, [alleStraten, stratenVanWijk]);

  return (
    <div className="space-y-3 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("flex flex-wrap gap-1.5", compact && "hidden")}>
          {(districts.data ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                const eerste = (streets.data ?? [])
                  .filter((s) => s.district_id === d.id)
                  .sort((a, b) => a.sort_order - b.sort_order)[0];
                if (eerste) onStraat(eerste.id);
              }}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                d.id === wijkId
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-card">
          <button
            type="button"
            aria-label="Jaar ervoor"
            className="flex size-7 items-center justify-center rounded-full hover:bg-surface"
            onClick={() => setJaar((j) => j - 1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 text-[13px] font-medium tabular-nums">{jaar}</span>
          <button
            type="button"
            aria-label="Jaar erna"
            className="flex size-7 items-center justify-center rounded-full hover:bg-surface"
            onClick={() => setJaar((j) => j + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        {!compact && (
          // Het zoekvak, en daaronder de knop om in te vullen: die past in de
          // ruimte die het strookje met straten ernaast toch overlaat.
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-64">
            <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 shadow-card">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                inputMode="search"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                placeholder="Straat, nummer of naam"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
              />
              {zoek !== "" && (
                <button
                  type="button"
                  aria-label="Zoeken leegmaken"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setZoek("")}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {isEigenaar && peil && (
              <div className="flex flex-wrap items-center gap-2">
                {invullen ? (
                  <>
                    <Button size="sm" className="rounded-full" onClick={() => setInvullen(false)}>
                      Klaar met invullen
                    </Button>
                    <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-card">
                      {(["kaart", "bedragen"] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          aria-pressed={weergave === w}
                          onClick={() => setWeergave(w)}
                          className={cn(
                            "min-h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                            weergave === w
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {w === "kaart" ? "Aanvinken" : "Bedragen"}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <Button
                    size="sm"
                    // Is alles ingevuld en daarna een keer gelopen, dan hoeft
                    // er niets meer bij: dan is het alleen nog bewerken.
                    variant={alGelopen ? "outline" : "default"}
                    className="rounded-full"
                    onClick={() => {
                      setInvullen(true);
                      setWeergave("kaart");
                      // Meteen verder met het toetsenbord, in de startmaand
                      // van het eerste adres.
                      naarVak(0, startKolom);
                    }}
                  >
                    <Pencil className="size-3.5" />
                    {alGelopen ? "Bewerken" : "Pofjes invullen"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {zoekTerm.length > 0 ? (
          <div className="min-w-0 flex-1">
            {treffers.length === 0 ? (
              <p className="py-2 text-[12.5px] text-muted-foreground">Niets gevonden.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {treffers.map((t) => (
                  <button
                    key={t.sleutel}
                    type="button"
                    onClick={() => {
                      onStraat(t.straat);
                      setMarkeer(t.adres ?? null);
                      setZoek("");
                    }}
                    className="min-h-9 shrink-0 rounded-full border border-border bg-card px-3.5 text-[12.5px] font-medium text-muted-foreground shadow-card hover:text-foreground"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Bij het geldlopen staat het strookje op de telefoon onderin, bij je
          // duim; daar zou het hier dubbel staan.
          <div className={cn("min-w-0 flex-1", compact && "max-md:hidden")}>
            <div
              ref={stratenVak}
              className={cn(
                "flex flex-wrap gap-1.5",
                // Twee rijen hoog; past het niet, dan klap je hem uit.
                !alleStraten && "max-h-[78px] overflow-hidden",
              )}
            >
              {stratenVanWijk.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onStraat(s.id)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors",
                    s.id === straatId
                      ? // De straat waar je bent moet er echt uitspringen.
                        "border-transparent bg-primary font-semibold text-primary-foreground shadow-card"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
            {tweeRijenVol && (
              <button
                type="button"
                className="mt-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setAlleStraten((a) => !a)}
              >
                {alleStraten ? "minder straten" : "alle straten"}
              </button>
            )}
          </div>
        )}
      </div>

      {invullen && weergave === "kaart" && peil && (
        <p className="text-[12.5px] text-muted-foreground">
          Tik de maanden tot en met {MAANDNAMEN[Number(peil.slice(5, 7)) - 1]} {peil.slice(0, 4)}{" "}
          aan die op de kaart nog open stonden (een 0). Wooshy rekent de beginstand uit met de prijs
          van nu.
          <span className="hidden sm:inline">
            {" "}
            Met het toetsenbord: pijltjes om te lopen, 0 voor pof, Backspace om weg te halen.
          </span>
        </p>
      )}

      {invullen && wijk && peil && (
        <BeginstandBalk
          wijk={wijk}
          customers={wijkAdressen}
          stand={stand.data ?? []}
          laden={stand.isLoading}
          magBewerken={isEigenaar}
          onVeranderd={vernieuwWijk}
        />
      )}

      {!peil && wijk && !compact && (
        <>
          {isEigenaar ? (
            <BeginstandStarten wijk={wijk} magStarten onGestart={vernieuwWijk} />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {wijk.name} doet nog niet mee met Betalingen: de eigenaar vult eerst de stand van de
              kaarten in.
            </p>
          )}
        </>
      )}

      {invullen && weergave === "bedragen" && wijk && peil ? (
        <BeginstandBedragen
          wijk={wijk}
          customers={wijkAdressen}
          straten={stratenVanWijk}
          naamVan={(id) => namen.get(id) ?? ""}
          stand={stand.data ?? []}
          laden={stand.isLoading}
          magBewerken={isEigenaar}
          onVeranderd={vernieuwWijk}
        />
      ) : (
        <>
          {/* Waar je bent, groot: in het strookje erboven raak je dat kwijt
              zodra je naar de tabel scrolt. */}
          {straat && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
              <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] md:text-[21px]">
                {straat.name}
              </h2>
              {wijk && <span className="text-[13px] text-muted-foreground">{wijk.name}</span>}
              <span className="text-[13px] text-muted-foreground">
                · {adressen.length} {adressen.length === 1 ? "adres" : "adressen"}
              </span>
            </div>
          )}
          <section className="overflow-x-auto rounded-[24px] border border-border bg-card shadow-card">
            <table ref={tabel} className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="text-[11.5px] text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Nr</th>
                  <th className="px-2 py-2 text-left font-medium">Frequentie</th>
                  <th className="px-2 py-2 text-right font-medium">€</th>
                  {MAANDEN.map((m, i) => (
                    <th
                      key={i}
                      className={cn(
                        "w-8 py-2 text-center font-medium",
                        maanden[i] === nuMaand
                          ? // De maand waar we nu in zitten: geel, met een lijntje
                            // dat de hele kolom door loopt.
                            "rounded-t-[8px] border-x border-t border-tint-geel-ink/40 bg-tint-geel font-semibold text-tint-geel-ink"
                          : peilMaand && maanden[i]! <= peilMaand
                            ? "bg-surface/60"
                            : "",
                      )}
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adressen.map((c, r) => {
                  const data = perAdres.get(c.id);
                  const overmaken = effectieveMethode(c, wijk) === "overmaken";
                  return (
                    <tr
                      key={c.id}
                      data-adres={c.id}
                      className={cn(
                        "border-t border-border/70",
                        markeer === c.id && "bg-tint-blauw/70",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 font-display font-semibold tabular-nums">
                        {overmaken && <span className="mr-1 text-tint-blauw-ink">$</span>}
                        {c.house_number}
                        {c.addition}
                      </td>
                      <td className="max-w-[10rem] truncate px-2 py-1.5">
                        {frequentieKaart(c)}
                        {c.inactief_op && <span className="text-muted-foreground"> · gestopt</span>}
                        {/* De naam eronder, klein, en alleen als hij er is. */}
                        {c.klant_id && namen.get(c.klant_id) && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {namen.get(c.klant_id)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {c.price > 0 ? formatPrice(c.price) : ""}
                      </td>
                      {maanden.map((maand, k) => {
                        const vak = vakVoor(c, data, maand, peilMaand, concept[c.id]);
                        const beginZone = !!peilMaand && maand <= peilMaand;
                        const kanAanvinken = invullen && beginZone && !overmaken;
                        const aan = gekozen?.adres === c.id && gekozen.maand === maand;
                        return (
                          <td
                            key={maand}
                            className={cn(
                              "p-0.5",
                              beginZone && "bg-surface/60",
                              maand === nuMaand && [
                                "border-x border-tint-geel-ink/40",
                                // Binnen de beginstand blijft het grijs: daar
                                // zegt de kleur al iets anders.
                                !beginZone && "bg-tint-geel/40",
                              ],
                            )}
                          >
                            <button
                              type="button"
                              data-vak={`${r}-${k}`}
                              tabIndex={r === cursorRij && k === cursor.k ? 0 : -1}
                              onFocus={() => setCursor({ r, k })}
                              onKeyDown={(e) => opToets(e, r, k, c, maand, kanAanvinken)}
                              aria-label={`${c.house_number}${c.addition}, ${MAANDNAMEN[k]}`}
                              aria-pressed={
                                kanAanvinken
                                  ? (concept[c.id] ?? beginMaandenVan(data)).includes(maand)
                                  : undefined
                              }
                              onClick={() =>
                                kanAanvinken
                                  ? void zetBegin(c, maand, "wissel")
                                  : setGekozen(aan ? null : { adres: c.id, maand })
                              }
                              className={`flex h-8 w-full items-center justify-center rounded-[8px] text-[13px] font-semibold tabular-nums outline-none transition-colors ${
                                // Bij aanvinken ook na een muisklik zien waar de 0 terechtkomt.
                                invullen
                                  ? "focus:ring-2 focus:ring-foreground/70"
                                  : "focus-visible:ring-2 focus-visible:ring-foreground/70"
                              } ${aan ? "ring-2 ring-foreground/40" : ""} ${
                                vak.soort === "betaald"
                                  ? vak.korting
                                    ? "bg-tint-paars text-tint-paars-ink"
                                    : "bg-tint-salie text-tint-salie-ink"
                                  : vak.soort === "open"
                                    ? vak.nogOpen
                                      ? "bg-tint-rood text-tint-rood-ink"
                                      : "text-tint-rood-ink/60"
                                    : kanAanvinken
                                      ? "border border-dashed border-border text-muted-foreground hover:bg-surface"
                                      : "text-muted-foreground/70 hover:bg-surface"
                              }`}
                            >
                              {vak.soort === "betaald"
                                ? vak.aantal
                                : vak.soort === "open"
                                  ? "0"
                                  : vak.soort === "overgeslagen"
                                    ? "×"
                                    : vak.soort === "niet_aan_de_beurt"
                                      ? "%"
                                      : ""}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {kaart.isLoading && <p className="p-3 text-[13px] text-muted-foreground">Laden…</p>}
            {kaart.isError && (
              <p className="p-3 text-[13px] text-tint-rood-ink">
                De kaart kon niet opgehaald worden. Ververs de pagina, of vraag de eigenaar of je
                bedragen mag zien.
              </p>
            )}
          </section>

          <p className="text-[12px] text-muted-foreground">
            1, 2 = zoveel wasbeurten betaald die maand · 0 = niet betaald (rood zolang het nog open
            staat) · paars = met korting afgeboekt · × = overgeslagen · % = niet aan de beurt · $ =
            maakt over · geel = de maand van nu · grijs = vóór de start (de beginstand)
          </p>
        </>
      )}

      {gekozen && detailAdres && (
        <section className="rounded-[24px] border border-border bg-card p-4 shadow-card">
          <h3 className="font-display text-[15px] font-semibold">
            {straat?.name} {detailAdres.house_number}
            {detailAdres.addition} · {MAANDNAMEN[Number(gekozen.maand.slice(5, 7)) - 1]}{" "}
            {gekozen.maand.slice(0, 4)}
          </h3>
          <div className="mt-2 space-y-1 text-[13px]">
            {(details?.posten ?? [])
              .filter((p) => p.datum.slice(0, 7) === gekozen.maand && p.soort !== "beginstand")
              .map((p, i) => (
                <p key={`p${i}`}>
                  {p.soort === "klus" ? `Klus: ${p.omschrijving}` : "Gewassen"} op {p.datum} ·{" "}
                  {formatPrice(p.bedrag)}
                  {p.gedekt >= p.bedrag - 0.005
                    ? ` · betaald${p.betaald_door ? ` bij ${p.betaald_door}` : ""}${
                        p.betaald_op
                          ? ` op ${new Date(p.betaald_op).toLocaleDateString("nl-NL")}`
                          : ""
                      }`
                    : ` · nog ${formatPrice(p.bedrag - p.gedekt)} open`}
                </p>
              ))}
            {(details?.gebeurtenissen ?? [])
              .filter((g) => maandVan(g.op) === gekozen.maand)
              .map((g) => (
                <p key={g.id} className={g.ongedaan ? "line-through opacity-60" : ""}>
                  {soortLabel(g.soort)}
                  {g.bedrag > 0 && ` ${formatPrice(g.bedrag)}`}
                  {g.reden && ` (${g.reden})`} · {g.door_naam} ·{" "}
                  {new Date(g.op).toLocaleString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {g.ongedaan && ` · teruggedraaid door ${g.ongedaan.door_naam}`}
                </p>
              ))}
            {(details?.posten ?? []).every(
              (p) => p.datum.slice(0, 7) !== gekozen.maand || p.soort === "beginstand",
            ) &&
              (details?.gebeurtenissen ?? []).every((g) => maandVan(g.op) !== gekozen.maand) && (
                <p className="text-muted-foreground">Niets gebeurd in deze maand.</p>
              )}
          </div>
        </section>
      )}
    </div>
  );
}
