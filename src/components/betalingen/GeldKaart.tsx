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
import { VakTekst } from "@/components/betalingen/VakTekst";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useBevestig } from "@/components/Bevestig";
import { useAuth } from "@/lib/auth";
import { effectieveMethode, fetchGeldStandWijk, frequentieKaart, zetKaart } from "@/lib/betalingen";
import {
  kaartDelen,
  kaartVakjesVan,
  leesVakInvoer,
  maandVan,
  vakjeVan,
  vakjeWoorden,
  vakWoorden,
  vakVoor,
  vooruitGepland,
  type KaartVakje,
} from "@/lib/geldkaart";
import { fetchVrijgaven } from "@/lib/geldlopen";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  formatPrice,
  sortCustomers,
  type Customer,
} from "@/lib/klanten";
import { fetchKaart, soortLabel, type Kaart } from "@/lib/overzichten";
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

/**
 * De kolom die blijft staan als je de kaart opzij schuift: het huisnummer met
 * de prijs eronder. Op een telefoon past een jaar van twaalf maanden er niet
 * naast, dus je scrolt altijd — en dan wil je blijven zien over wie een vakje
 * gaat en wat hij betaalt. Het lijntje rechts maakt de scheiding zichtbaar
 * zodra er iets onderdoor schuift.
 */
const VASTE_KOLOM = "sticky left-0 z-[2] w-20 border-r border-border/70";

/**
 * De frequentie met de naam eronder. Op een telefoon krijgt hij een vaste
 * breedte: de maandkolommen zijn smal, en zonder rem zou deze kolom alle
 * overgebleven ruimte opslokken — dat was het witte gat tussen de frequentie
 * en de prijs. Vanaf een tablet is er ruimte zat en mag hij weer meegroeien.
 */
const FREQUENTIE_KOLOM = "w-[7.5rem] sm:w-auto sm:max-w-[10rem]";

/**
 * De kaartweergave: per straat een jaar, zoals de papieren kaart. Tik een
 * vakje en je ziet wie wanneer wat intikte.
 *
 * Hier zit ook het invullen van de beginstand, want dat hoort bij dezelfde
 * kaart: met "Pofjes invullen" zet je per maand wat er op de papieren kaart
 * stond (0, x, een letter met bedrag, +bedrag, en na de start een 1 voor
 * vooruit betaald), en met de wisselknop typ je de pof desgewenst als bedrag
 * per adres. Een vakje aantikken geeft een klein keuzemenu; met het
 * toetsenbord gaat het meteen: pijltjes om te lopen, 0, x of 1, een letter of
 * + en dan het bedrag, en Backspace om te wissen.
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
  // De ingevulde vakjes die nog bewaard worden, per adres, zodat je door kunt tikken.
  const [concept, setConcept] = useState<Record<string, KaartVakje[]>>({});
  // Dezelfde stand, maar meteen bij: tik je sneller dan het scherm bijwerkt,
  // dan bouwt de volgende tik toch voort op de vorige.
  const conceptNu = useRef(concept);
  function wijzigConcept(adres: string, lijst: KaartVakje[] | null) {
    const rest = { ...conceptNu.current };
    if (lijst) rest[adres] = lijst;
    else delete rest[adres];
    conceptNu.current = rest;
    setConcept(rest);
  }
  const opslag = useRef(new Map<string, { keten: Promise<void>; versie: number }>());
  // Het vakje waar het toetsenbord staat (rij, maand).
  const [cursor, setCursor] = useState({ r: 0, k: 0 });
  // Het keuzemenu van één vakje, met wat je in het tekstvak typt.
  const [menu, setMenu] = useState<{
    adres: string;
    maand: string;
    invoer: string;
    fout: string | null;
  } | null>(null);
  const anker = useRef<HTMLButtonElement | null>(null);
  // Waar het menu voor openging: daar gaat het toetsenbord weer heen als hij sluit.
  const menuPlek = useRef({ r: 0, k: 0 });
  const menuInvoer = useRef<HTMLInputElement>(null);
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

  /**
   * Vul één vakje in zoals op de papieren kaart, of wis het (null). Vóór en
   * in de startmaand gaat het om de beginstand, daarna om een 1 (vooruit
   * betaald). Bewaard wordt per adres de hele rij vakjes.
   */
  async function zetVak(
    c: Customer,
    maand: string,
    nieuw: { teken: string; bedrag: number } | null,
  ) {
    // Vers uit de cache: net na het bewaren is de kaart op het scherm nog van ervoor.
    const vers = qc.getQueryData<Kaart>(["geld-kaart", straatId, jaar]);
    const data = vers?.adressen.find((a) => a.id === c.id) ?? perAdres.get(c.id);
    const nu = conceptNu.current[c.id] ?? kaartVakjesVan(data, peilMaand);
    const oud = nu.find((v) => v.maand === maand);
    if (!nieuw && !oud) return;
    if (
      nieuw &&
      oud &&
      !oud.ingetypt &&
      oud.teken === nieuw.teken &&
      (nieuw.teken === "0" || Math.abs(oud.bedrag - nieuw.bedrag) < 0.005)
    ) {
      return;
    }
    const voorStart = !!peilMaand && maand <= peilMaand;
    // Een ingetypt bedrag (zonder maanden) staat als 0 in de startmaand.
    const ingetypt = voorStart ? nu.find((v) => v.ingetypt) : undefined;
    if (ingetypt) {
      const ja = await bevestig(
        nieuw
          ? {
              titel: "Ingetypte beginstand vervangen?",
              tekst: `Hier staat nu ${formatPrice(ingetypt.bedrag)} als beginstand. Met invullen per maand wordt het wat je op de kaart zet.`,
              bevestigLabel: "Vervangen",
            }
          : {
              titel: "Ingetypte beginstand weghalen?",
              tekst: `Hier staat nu ${formatPrice(ingetypt.bedrag)} als beginstand, ingetypt zonder maanden.`,
              bevestigLabel: "Weghalen",
            },
      );
      if (!ja) return;
    }
    if (nieuw && (nieuw.teken === "0" || nieuw.teken === "1") && c.price <= 0) {
      toast.error(
        "Dit adres heeft nog geen prijs, dus Paaltje Systems weet niet wat een maand kost.",
      );
      return;
    }
    const lijst = nu.filter((v) => v.maand !== maand && !(voorStart && v.ingetypt));
    if (nieuw) {
      lijst.push({
        maand,
        teken: nieuw.teken,
        // Een 0 is de prijs van nu (dat rekent de database ook zo).
        bedrag: nieuw.teken === "0" ? c.price : nieuw.bedrag,
      });
    }
    lijst.sort((a, b) => a.maand.localeCompare(b.maand));
    wijzigConcept(c.id, lijst);
    // Per adres op volgorde bewaren; tik je snel door, dan telt alleen de laatste stand.
    const vorige = opslag.current.get(c.id);
    const versie = (vorige?.versie ?? 0) + 1;
    const laatste = () => opslag.current.get(c.id)?.versie === versie;
    const keten = (vorige?.keten ?? Promise.resolve()).then(async () => {
      if (!laatste()) return;
      try {
        // Alleen wat echt anders is dan wat er nu bewaard staat.
        const bewaard =
          qc
            .getQueryData<Kaart>(["geld-kaart", straatId, jaar])
            ?.adressen.find((a) => a.id === c.id) ?? data;
        const delen = kaartDelen(lijst, kaartVakjesVan(bewaard, peilMaand));
        if (delen.begin || delen.vooruit) {
          await zetKaart(c.id, delen.begin, delen.vooruit);
          await qc.invalidateQueries({ queryKey: ["geld-kaart", straatId] });
          void qc.invalidateQueries({ queryKey: ["geld-stand"] });
          void qc.invalidateQueries({ queryKey: ["geld-pof"] });
          void qc.invalidateQueries({ queryKey: ["geld-adres", c.id] });
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
      if (laatste()) wijzigConcept(c.id, null);
    });
    opslag.current.set(c.id, { keten, versie });
  }

  /** Het keuzemenu van een vakje openen; `start` staat al in het tekstvak. */
  function openMenu(
    el: HTMLButtonElement,
    r: number,
    k: number,
    c: Customer,
    maand: string,
    start = "",
  ) {
    anker.current = el;
    menuPlek.current = { r, k };
    setMenu({ adres: c.id, maand, invoer: start, fout: null });
  }

  /** Wat er in het menu gekozen of getypt is, invullen en het menu dicht. */
  function kiesInMenu(nieuw: { teken: string; bedrag: number } | null) {
    const m = menu;
    const c = m && adressen.find((a) => a.id === m.adres);
    if (!m || !c) return;
    setMenu(null);
    void zetVak(c, m.maand, nieuw);
  }

  function typInMenu() {
    if (!menu) return;
    const uit = leesVakInvoer(menu.invoer);
    if ("fout" in uit) {
      setMenu({ ...menu, fout: uit.fout });
      return;
    }
    const voorStart = !!peilMaand && menu.maand <= peilMaand;
    if (voorStart === (uit.teken === "1")) {
      setMenu({
        ...menu,
        fout: voorStart
          ? "Een 1 (vooruit betaald) kan alleen na de start."
          : "Na de start kun je alleen een 1 invullen: vooruit betaald.",
      });
      return;
    }
    kiesInMenu(uit);
  }

  function naarVak(r: number, k: number) {
    if (adressen.length === 0) return;
    const rij = Math.min(Math.max(r, 0), adressen.length - 1);
    const kol = Math.min(Math.max(k, 0), 11);
    setCursor({ r: rij, k: kol });
    tabel.current?.querySelector<HTMLButtonElement>(`[data-vak="${rij}-${kol}"]`)?.focus();
  }

  /**
   * Het toetsenbord op de kaart: pijltjes om te lopen; bij invullen 0, x of
   * 1 meteen, een letter of + opent het menu met dat teken al ingetypt (dan
   * het bedrag en Enter), en Backspace wist. Enter of spatie opent het menu.
   */
  function opToets(
    e: KeyboardEvent<HTMLButtonElement>,
    r: number,
    k: number,
    c: Customer,
    maand: string,
    zone: "begin" | "vooruit" | null,
  ) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const stap = PIJLEN[e.key];
    if (stap) {
      e.preventDefault();
      naarVak(r + stap[0], k + stap[1]);
      return;
    }
    if (!zone) return;
    const toets = e.key.toLowerCase();
    if (toets === "backspace" || toets === "delete") {
      e.preventDefault();
      void zetVak(c, maand, null);
    } else if (zone === "vooruit") {
      if (toets === "1") {
        e.preventDefault();
        void zetVak(c, maand, { teken: "1", bedrag: 0 });
      }
    } else if (toets === "0" || toets === "x") {
      e.preventDefault();
      void zetVak(c, maand, { teken: toets, bedrag: 0 });
    } else if (toets === "+" || /^[a-z]$/.test(toets)) {
      e.preventDefault();
      openMenu(e.currentTarget, r, k, c, maand, toets === "+" ? "+" : `${toets} `);
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
  const detailVakje = gekozen
    ? kaartVakjesVan(details, peilMaand).find((v) => v.maand === gekozen.maand)
    : undefined;

  // Het vakje van het keuzemenu.
  const menuAdres = menu ? adressen.find((c) => c.id === menu.adres) : undefined;
  const menuVoorStart = !!menu && !!peilMaand && menu.maand <= peilMaand;
  const menuVakje = menu
    ? (concept[menu.adres] ?? kaartVakjesVan(perAdres.get(menu.adres), peilMaand)).find(
        (v) => v.maand === menu.maand,
      )
    : undefined;

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
                          {w === "kaart" ? "Kaart" : "Bedragen"}
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
          Tik een maand aan en zet wat er op de kaart staat. Tot en met{" "}
          {MAANDNAMEN[Number(peil.slice(5, 7)) - 1]} {peil.slice(0, 4)}: 0 = hele beurt open (de
          prijs van nu), x = niet gewassen, een letter met bedrag (v 8 = alleen de voorkant, € 8
          open) of + met bedrag (+5 = te weinig betaald, € 5 open). Daarna: 1 = al vooruit betaald
          van vóór de app; dat telt niet als opgehaald geld.
          <span className="hidden sm:inline">
            {" "}
            Met het toetsenbord: pijltjes om te lopen, 0, x of 1 meteen, een letter of + en dan het
            bedrag met Enter, Backspace om te wissen.
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
            <table ref={tabel} className="w-full min-w-[920px] border-collapse text-[13px]">
              <thead>
                <tr className="text-[11.5px] text-muted-foreground">
                  {/* Het nummer met de prijs eronder, en die kolom blijft staan
                      als je opzij scrolt: op een telefoon is dat het enige
                      waaraan je ziet over wie een vakje gaat. */}
                  <th className={cn(VASTE_KOLOM, "bg-card px-3 py-2 text-left font-medium")}>Nr</th>
                  <th className={cn(FREQUENTIE_KOLOM, "px-2 py-2 text-left font-medium")}>
                    Frequentie
                  </th>
                  {MAANDEN.map((m, i) => (
                    <th
                      key={i}
                      className={cn(
                        // Een eigen minimumbreedte, anders houden deze kolommen
                        // niets over: het knopje erin heeft geen eigen breedte,
                        // en dan gaat alle ruimte naar de frequentiekolom.
                        // Breed genoeg voor twee korte regels: "Open" en "€ 30".
                        "min-w-[58px] py-2 text-center font-medium",
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
                  const gepland = vooruitGepland(c, data);
                  // De maanden met een 1 van de kaart: die kun je altijd wissen.
                  const enen = (concept[c.id] ?? kaartVakjesVan(data, peilMaand))
                    .filter((v) => v.teken === "1")
                    .map((v) => v.maand);
                  return (
                    <tr
                      key={c.id}
                      data-adres={c.id}
                      className={cn(
                        "border-t border-border/70",
                        markeer === c.id && "bg-tint-blauw/100",
                      )}
                    >
                      <td
                        className={cn(
                          VASTE_KOLOM,
                          "whitespace-nowrap px-3 py-1.5 align-top",
                          // Een bevroren vakje moet dekken, anders schuift de
                          // rest eronder door; vandaar geen doorzichtige tint.
                          markeer === c.id ? "bg-tint-blauw/100" : "bg-card",
                        )}
                      >
                        <span className="block font-display font-semibold tabular-nums">
                          {overmaken && <span className="mr-0.5 text-tint-blauw-ink">$</span>}
                          {c.house_number}
                          {c.addition}
                        </span>
                        <span className="block text-[11.5px] tabular-nums text-muted-foreground">
                          <span className="sr-only">prijs </span>
                          {/* Een streepje als er geen prijs is: een lege regel
                              neemt geen hoogte in en dan gaat de lijst golven. */}
                          {c.price > 0 ? formatPrice(c.price) : "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {/* De breedte staat op dit blokje en niet op de cel:
                            een browser leest een breedte op een tabelcel als
                            een wens, en lange tekst duwt de kolom dan alsnog
                            breder. */}
                        <div className={cn(FREQUENTIE_KOLOM, "truncate")}>
                          {frequentieKaart(c)}
                          {c.inactief_op && (
                            <span className="text-muted-foreground"> · gestopt</span>
                          )}
                          {/* De naam eronder, klein, en alleen als hij er is. */}
                          {c.klant_id && namen.get(c.klant_id) && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {namen.get(c.klant_id)}
                            </span>
                          )}
                        </div>
                      </td>
                      {maanden.map((maand, k) => {
                        const vak = vakVoor(c, data, maand, peilMaand, concept[c.id], gepland);
                        const beginZone = !!peilMaand && maand <= peilMaand;
                        // Wat je hier kunt invullen: vóór de start de beginstand,
                        // daarna een 1 (niet bij een gestopt adres, en niet waar
                        // de beurt al betaald is: dan zou dat geld verschuiven).
                        const alBetaald =
                          vak.soort === "betaald" || (vak.soort === "vooruit" && !vak.kaart);
                        const zone =
                          !invullen || overmaken || !peilMaand
                            ? null
                            : beginZone
                              ? "begin"
                              : c.inactief_op || (alBetaald && !enen.includes(maand))
                                ? null
                                : "vooruit";
                        const kanAanvinken = zone === "begin";
                        const aan = gekozen?.adres === c.id && gekozen.maand === maand;
                        // In woorden; de codes zijn alleen nog wat je typt.
                        const uitleg = vakWoorden(vak).lang;
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
                              onKeyDown={(e) => opToets(e, r, k, c, maand, zone)}
                              aria-label={`${c.house_number}${c.addition}, ${MAANDNAMEN[k]}${uitleg ? `: ${uitleg}` : ""}`}
                              aria-haspopup={zone ? "dialog" : undefined}
                              title={uitleg || undefined}
                              onClick={(e) =>
                                zone
                                  ? openMenu(e.currentTarget, r, k, c, maand)
                                  : setGekozen(aan ? null : { adres: c.id, maand })
                              }
                              className={`flex h-10 w-full items-center justify-center rounded-[8px] px-0.5 text-[10.5px] tabular-nums outline-none transition-colors ${
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
                                    : vak.soort === "vooruit"
                                      ? vak.gepland
                                        ? "border border-dashed border-tint-groen-ink/40 text-tint-groen-ink/60"
                                        : vak.meerOpen
                                          ? "bg-tint-groen text-tint-groen-ink ring-2 ring-inset ring-tint-rood-ink/60"
                                          : "bg-tint-groen text-tint-groen-ink"
                                      : kanAanvinken
                                        ? "border border-dashed border-border text-muted-foreground hover:bg-surface"
                                        : "text-muted-foreground/70 hover:bg-surface"
                              }`}
                            >
                              <VakTekst vak={vak} />
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
            Groen = betaald · rood = staat nog open (licht als het later betaald is) · paars = met
            korting afgeboekt · Vooruit betaald (licht: die beurt komt nog; rode rand: extra werk
            nog open) · $ = maakt over · geel = de maand van nu · grijs = vóór de start (de
            beginstand)
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
            {detailVakje && <p>Op de kaart: {vakjeWoorden(detailVakje)}</p>}
            {(details?.posten ?? [])
              .filter((p) => vakjeVan(p) === gekozen.maand && p.soort !== "beginstand")
              .map((p, i) => (
                <p key={`p${i}`}>
                  {p.soort === "klus" ? `Klus: ${p.omschrijving}` : "Gewassen"} op {p.datum} ·{" "}
                  {formatPrice(p.bedrag)}
                  {p.gedekt >= p.bedrag - 0.005
                    ? ` · ${p.betaald_soort === "vooruit" ? "vooruit betaald" : "betaald"}${p.betaald_door ? ` bij ${p.betaald_door}` : ""}${
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
            {!detailVakje &&
              (details?.posten ?? []).every(
                (p) => vakjeVan(p) !== gekozen.maand || p.soort === "beginstand",
              ) &&
              (details?.gebeurtenissen ?? []).every((g) => maandVan(g.op) !== gekozen.maand) && (
                <p className="text-muted-foreground">Niets gebeurd in deze maand.</p>
              )}
          </div>
        </section>
      )}

      {/* Het keuzemenu van één vakje: op de telefoon tik je zo in, op de
          computer opent hij met Enter of met een letter of +. */}
      <Popover open={!!menu} onOpenChange={(open) => !open && setMenu(null)}>
        <PopoverAnchor virtualRef={anker} />
        <PopoverContent
          className="w-72 p-3"
          onOpenAutoFocus={(e) => {
            // Begon je met een letter of +, dan meteen verder typen.
            const veld = menuInvoer.current;
            if (menu?.invoer && veld) {
              e.preventDefault();
              veld.focus();
              veld.setSelectionRange(veld.value.length, veld.value.length);
            }
          }}
          onCloseAutoFocus={(e) => {
            // Terug naar het vakje, zodat je met de pijltjes verder kunt.
            e.preventDefault();
            naarVak(menuPlek.current.r, menuPlek.current.k);
          }}
        >
          {menu && menuAdres && (
            <div className="space-y-2.5">
              <p className="font-display text-[14px] font-semibold">
                {menuAdres.house_number}
                {menuAdres.addition} · {MAANDNAMEN[Number(menu.maand.slice(5, 7)) - 1]}{" "}
                {menu.maand.slice(0, 4)}
              </p>
              {menuVoorStart ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <KeuzeKnop
                      teken="0"
                      uitleg="hele beurt open"
                      aan={menuVakje?.teken === "0" && !menuVakje.ingetypt}
                      onKies={() => kiesInMenu({ teken: "0", bedrag: 0 })}
                    />
                    <KeuzeKnop
                      teken="×"
                      uitleg="niet gewassen"
                      aan={menuVakje?.teken === "x"}
                      onKies={() => kiesInMenu({ teken: "x", bedrag: 0 })}
                    />
                  </div>
                  <form
                    className="flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      typInMenu();
                    }}
                  >
                    <Input
                      ref={menuInvoer}
                      className="h-9 min-w-0 flex-1 rounded-full"
                      placeholder="v 8 of +5"
                      aria-label="Letter met bedrag, of + met bedrag"
                      autoCapitalize="off"
                      autoComplete="off"
                      value={menu.invoer}
                      onChange={(e) => setMenu({ ...menu, invoer: e.target.value, fout: null })}
                    />
                    <Button type="submit" size="sm" className="h-9 rounded-full">
                      Zet
                    </Button>
                  </form>
                  {menu.fout ? (
                    <p className="text-[12px] text-tint-rood-ink">{menu.fout}</p>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">
                      Een letter met wat er open staat (v 8 = alleen de voorkant, € 8), of + met wat
                      er te weinig betaald is (+5). De B kan niet: die is al vooruit betaald.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <KeuzeKnop
                    teken="1"
                    uitleg="al vooruit betaald"
                    aan={menuVakje?.teken === "1"}
                    onKies={() => kiesInMenu({ teken: "1", bedrag: 0 })}
                  />
                  <p className="text-[11.5px] text-muted-foreground">
                    Op de papieren kaart al betaald, van vóór de app. Die beurt staat dan niet open,
                    en het telt niet als opgehaald geld.
                  </p>
                </>
              )}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                {menuVakje ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full"
                    onClick={() => kiesInMenu(null)}
                  >
                    Wissen
                  </Button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setGekozen({ adres: menu.adres, maand: menu.maand });
                    setMenu(null);
                  }}
                >
                  Wat gebeurde er?
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Eén keuze in het menu van een vakje: het teken groot, de uitleg klein. */
function KeuzeKnop({
  teken,
  uitleg,
  aan,
  onKies,
}: {
  teken: string;
  uitleg: string;
  aan: boolean;
  onKies: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={aan}
      onClick={onKies}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-[12px] border px-3 text-left transition-colors",
        aan
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-surface",
      )}
    >
      <span className="font-display text-[17px] font-semibold tabular-nums">{teken}</span>
      <span className="text-[12.5px]">{uitleg}</span>
    </button>
  );
}
