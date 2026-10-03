/**
 * Klanten lopen: langs de deur voor nieuwe klanten.
 *
 * Zonder `?gebied=` de gebieden met hun tellers; met een gebied de looplijst,
 * straat voor straat in de looprichting (oneven heen, even terug). Alle
 * tellers komen uit één aanroep van loop_tellingen, net als het vak op Home.
 *
 * In de looplijst kun je zoeken (straat, huisnummer of postcode), de straten
 * anders sorteren en op een uitkomst filteren met de tabjes bovenaan
 * (LoopStand).
 *
 * Op de telefoon is een straat twee kolommen tegels, even links en oneven
 * rechts zoals op de Wijken-pagina (LoopTegel); een tik opent het adres onderin.
 * Een straat klap je dicht, en dicht blijft dicht, ook na het herstarten van
 * de app (loopdicht.ts).
 *
 * De computer heeft een eigen weergave in de vorm van de Wijken-pagina: de
 * naam groot, één wit vak met de tabjes, de cijfervakken en het zoekbakje,
 * en daaronder elke straat als blok met even links en oneven rechts, één
 * smalle regel per adres (LoopTabelRij).
 *
 * Plan: .omc/plans/klanten-lopen.md, §8.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft as Terug,
  IconArrowsSort as Sorteer,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconDoorExit as Deur,
  IconFold as Inklappen,
  IconMessageCircle as Praat,
  IconPlus as Plus,
  IconRefresh as Ververs,
  IconRoad as Weg,
  IconSelector as Uitklappen,
  IconThumbUp as Duim,
  IconTrash as Prullenbak,
  IconX as Sluit,
  IconWalk as Walk,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Cijferkaarten } from "@/components/Cijferkaarten";
import { GebiedMaken } from "@/components/lopen/GebiedMaken";
import { JaDialog } from "@/components/lopen/JaDialog";
import { LoopAdresRij } from "@/components/lopen/LoopAdresRij";
import { LoopStand } from "@/components/lopen/LoopStand";
import { LoopKolomKop, LoopTabelRij } from "@/components/lopen/LoopTabelRij";
import { LOOP_TABS } from "@/components/lopen/loopTabs";
import { LoopTegel } from "@/components/lopen/LoopTegel";
import { PlakVak } from "@/components/PlakVak";
import { ZoekBalk } from "@/components/ZoekBalk";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { fetchStreets } from "@/lib/klanten";
import { leesDichteStraten, onthoudDichteStraten } from "@/lib/loopdicht";
import {
  LOOP_SORTERINGEN,
  LOOP_TELLINGEN,
  LOOP_VOORSTELLEN,
  fetchLoopLijst,
  fetchLoopTellingen,
  filterLooplijst,
  foutTekst,
  gooiGebiedWeg,
  haalVeelhoekGebied,
  korteDatum,
  loopLijstSleutel,
  loopNummer,
  looplijstVolgorde,
  pastInFilter,
  schrijfGebied,
  sorteerLoopStraten,
  straatStand,
  useLoopLive,
  useLoopVoorstellen,
  vulGebied,
  wijkstraatVoor,
  zetLoopAdres,
  zoekInLooplijst,
  type LoopAdres,
  type LoopFilter,
  type LoopGebied,
  type LoopPatch,
  type LoopSortering,
} from "@/lib/lopen";
import { useRecht } from "@/lib/rechten";
import { cn } from "@/lib/utils";
import { pushUndo, undoKnop } from "@/lib/undo";

type LopenSearch = { gebied?: string };

export const Route = createFileRoute("/lopen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): LopenSearch => {
    const uit: LopenSearch = {};
    if (typeof search["gebied"] === "string" && search["gebied"]) uit.gebied = search["gebied"];
    return uit;
  },
  head: () => ({ meta: [{ title: "Klanten lopen — Paaltje Systems" }] }),
  component: Lopen,
});

/** "38 te lopen · 4 interesse · 12 ja · 3 nee" */
function tellerTekst(g: LoopGebied): string {
  const delen = [`${g.te_lopen} te lopen`];
  if (g.niet_thuis) delen.push(`${g.niet_thuis} niet thuis`);
  delen.push(`${g.interesse} interesse`, `${g.ja} ja`, `${g.nee} nee`);
  return delen.join(" · ");
}

function Lopen() {
  useRequireAuth();
  const { gebied } = Route.useSearch();
  const { employee } = useAuth();
  const mag = useRecht("klanten_lopen");
  useLoopLive(mag ? employee?.company_id : undefined);

  const tellingen = useQuery({
    queryKey: LOOP_TELLINGEN,
    queryFn: fetchLoopTellingen,
    enabled: mag,
  });

  // Eén "bezig" voor beide schermen: zo haal je hetzelfde gebied niet twee
  // keer tegelijk op als je tijdens het ophalen de looplijst opent.
  const ophalen = useOpnieuwOphalen();

  return gebied ? (
    <Looplijst
      key={gebied}
      gebiedId={gebied}
      tellingen={tellingen.data}
      mag={mag}
      ophalen={ophalen}
    />
  ) : (
    <Gebieden
      tellingen={tellingen.data}
      laden={tellingen.isLoading}
      fout={tellingen.error}
      ophalen={ophalen}
    />
  );
}

// ---------------------------------------------------------------------------
// De gebieden
// ---------------------------------------------------------------------------

/** Opnieuw ophalen: de straten van het gebied (of de omcirkelde veelhoek),
 *  met de wijkstraat erbij. */
function useOpnieuwOphalen() {
  const qc = useQueryClient();
  const [bezig, setBezig] = useState<{ id: string; tekst: string } | null>(null);

  async function ophalen(g: LoopGebied) {
    if (bezig) return;
    if (!g.veelhoek && g.straten.length === 0) {
      toast.error("Dit gebied heeft geen straten om op te halen.");
      return;
    }
    setBezig({ id: g.gebied_id, tekst: "Beginnen…" });
    try {
      const straten = g.district_id
        ? (await qc.fetchQuery({ queryKey: ["streets"], queryFn: fetchStreets })).filter(
            (s) => s.district_id === g.district_id,
          )
        : [];
      const voortgang = (tekst: string) => setBezig({ id: g.gebied_id, tekst });
      if (g.veelhoek) {
        const { rijen } = await haalVeelhoekGebied(g.veelhoek, straten, { onVoortgang: voortgang });
        const aantal = await schrijfGebied(g.gebied_id, rijen, { onVoortgang: voortgang });
        toast.success(`${g.naam}: ${aantal} ${aantal === 1 ? "adres" : "adressen"}`);
        return;
      }
      const { aantal, nietGevonden } = await vulGebied(
        g.gebied_id,
        g.straten.map((naam) => ({ naam, street_id: wijkstraatVoor(naam, straten)?.id ?? null })),
        g.plaats,
        { onVoortgang: voortgang },
      );
      if (nietGevonden.length > 0) {
        toast.warning(
          `Niet gevonden: ${nietGevonden.join(", ")}. Kies de officiële naam via Straten aanpassen.`,
        );
      }
      toast.success(`${g.naam}: ${aantal} ${aantal === 1 ? "adres" : "adressen"}`);
    } catch (e) {
      toast.error(`Ophalen mislukt: ${foutTekst(e)}`);
    } finally {
      setBezig(null);
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
      void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
    }
  }

  return { bezig, ophalen };
}

type Ophalen = ReturnType<typeof useOpnieuwOphalen>;

function Gebieden({
  tellingen,
  laden,
  fout,
  ophalen: { bezig, ophalen },
}: {
  tellingen: LoopGebied[] | undefined;
  laden: boolean;
  fout: unknown;
  ophalen: Ophalen;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [maken, setMaken] = useState(false);
  const [bewerken, setBewerken] = useState<LoopGebied | null>(null);

  async function weggooien(g: LoopGebied) {
    const ja = await bevestig({
      titel: `${g.naam} weggooien?`,
      tekst:
        "Het gebied verdwijnt uit de lijst. Terugzetten kan alleen met Ongedaan maken in de melding die daarna verschijnt. Wat je bij de adressen noteerde blijft bewaard, ook in andere gebieden.",
      bevestigLabel: "Weggooien",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await gooiGebiedWeg(g.gebied_id);
      pushUndo({
        label: `${g.naam} weggooien`,
        undo: async () => {
          await gooiGebiedWeg(g.gebied_id, true);
          await qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
        },
      });
      toast.success(`${g.naam} weggegooid`, { duration: 10000, action: undoKnop() });
    } catch (e) {
      toast.error(`Weggooien mislukt: ${foutTekst(e)}`);
    } finally {
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
    }
  }

  return (
    <AppLayout
      titel="Klanten lopen"
      acties={
        <Button className="rounded-full" onClick={() => setMaken(true)}>
          <Plus className="size-4" /> Nieuw gebied
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {fout ? (
          <Leeg tekst={`De gebieden konden niet geladen worden: ${foutTekst(fout)}`} />
        ) : laden ? (
          <Leeg tekst="Bezig met ophalen…" />
        ) : !tellingen || tellingen.length === 0 ? (
          <Leeg tekst="Nog geen gebieden. Maak er een bij een wijk, of een los gebied met eigen straten." />
        ) : (
          tellingen.map((g) => {
            const haalt = bezig?.id === g.gebied_id;
            return (
              <section
                key={g.gebied_id}
                className="rounded-[18px] border border-border bg-card p-4 shadow-card"
              >
                <Link
                  to="/lopen"
                  search={{ gebied: g.gebied_id }}
                  className="block rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-0.01em]">
                      {g.naam}
                    </h2>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {g.wijk ? `wijk ${g.wijk}` : "los"}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] tabular-nums">{tellerTekst(g)}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {g.totaal} {g.totaal === 1 ? "adres" : "adressen"}
                    {g.klanten > 0 && ` · ${g.klanten} al klant`}
                    {!g.onvolledig &&
                      g.opgehaald_op &&
                      ` · opgehaald ${korteDatum(g.opgehaald_op)}`}
                  </p>
                </Link>
                {g.onvolledig && !haalt && (
                  <button
                    type="button"
                    onClick={() => void ophalen(g)}
                    disabled={!!bezig}
                    className="mt-2 min-h-11 w-full rounded-xl bg-tint-amber px-3 text-left text-[13px] font-medium text-tint-amber-ink"
                  >
                    Onvolledig — opnieuw ophalen
                  </button>
                )}
                {haalt && (
                  <p aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">
                    {bezig.tekst}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-full"
                    disabled={!!bezig}
                    onClick={() =>
                      g.veelhoek
                        ? toast.info(
                            "Dit gebied is op de kaart omcirkeld. Zo'n gebied aanpassen kan nog niet; maak een nieuw gebied op de kaart.",
                          )
                        : setBewerken(g)
                    }
                  >
                    <Weg className="size-4" /> Straten
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-full"
                    disabled={!!bezig}
                    onClick={() => void ophalen(g)}
                  >
                    <Ververs className="size-4" /> Opnieuw ophalen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-10 rounded-full text-muted-foreground"
                    disabled={haalt}
                    onClick={() => void weggooien(g)}
                  >
                    <Prullenbak className="size-4" /> Weggooien
                  </Button>
                </div>
              </section>
            );
          })
        )}
      </div>

      <GebiedMaken open={maken} onOpenChange={setMaken} />
      <GebiedMaken
        open={bewerken !== null}
        onOpenChange={(o) => !o && setBewerken(null)}
        gebied={bewerken}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// De looplijst
// ---------------------------------------------------------------------------

/** Een straat herkennen, ook als zijn volgnummer na opnieuw ophalen verschuift. */
const straatSleutel = (s: { straat: string; woonplaats: string }) => `${s.straat}|${s.woonplaats}`;

/** De onderstreepte tabjes in het witte vak, dezelfde als op de Wijken-pagina. */
const ONDERSTREEP =
  "flex h-11 shrink-0 items-center border-b-[3px] border-transparent text-[14px] font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
const ONDERSTREEP_AAN = "border-primary text-foreground";

/** De ronde knoppen onderin op de telefoon: dicht, zodat de lijst er niet
 *  doorheen schijnt, met dezelfde schaduw als de zoekbalk ernaast. De
 *  omlijnde knop is in Fel doorzichtig en heeft in beide thema's geen
 *  schaduw, vandaar de regels met fel: en zak: erbij. Staat hij uit, dan
 *  wordt alleen het icoon grijs: half doorzichtig zou de lijst weer laten
 *  doorschijnen. */
const RONDE_KNOP =
  "size-9 shrink-0 rounded-full bg-card shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)] hover:bg-card fel:bg-card fel:shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)] fel:hover:bg-card zak:shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)] zak:hover:bg-card disabled:text-muted-foreground disabled:opacity-100";

function Looplijst({
  gebiedId,
  tellingen,
  mag,
  ophalen: { bezig, ophalen },
}: {
  gebiedId: string;
  tellingen: LoopGebied[] | undefined;
  mag: boolean;
  ophalen: Ophalen;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { employee } = useAuth();
  const gebied = tellingen?.find((g) => g.gebied_id === gebiedId) ?? null;
  const sleutel = loopLijstSleutel(gebiedId);
  const lijst = useQuery({
    queryKey: sleutel,
    queryFn: () => fetchLoopLijst(gebiedId),
    enabled: mag,
  });
  const voorstellen = useLoopVoorstellen(gebiedId, mag);
  const [jaId, setJaId] = useState<string | null>(null);

  const straten = useMemo(() => looplijstVolgorde(lijst.data ?? []), [lijst.data]);
  const mobiel = useIsMobile();

  // Sorteren. "Meeste te lopen" legt de volgorde vast op het moment van
  // kiezen: anders verspringt een straat onder je vinger zodra je er een
  // adres afvinkt.
  const [sortering, setSortering] = useState<{ hoe: LoopSortering; vast: string[] }>({
    hoe: "route",
    vast: [],
  });
  function kiesSortering(hoe: LoopSortering) {
    setSortering({
      hoe,
      vast: hoe === "open" ? sorteerLoopStraten(straten, "open").map(straatSleutel) : [],
    });
  }
  const gesorteerd = useMemo(() => {
    if (sortering.hoe !== "open") return sorteerLoopStraten(straten, sortering.hoe);
    // Een lange straat kan in twee stukken in de wijk staan: dan telt de
    // hoogste plek voor allebei.
    const plek = new Map<string, number>();
    sortering.vast.forEach((sleutel, i) => {
      if (!plek.has(sleutel)) plek.set(sleutel, i);
    });
    const op = (s: (typeof straten)[number]) => plek.get(straatSleutel(s)) ?? Infinity;
    return [...straten].sort((a, b) => op(a) - op(b) || a.straat_volgorde - b.straat_volgorde);
  }, [straten, sortering]);

  // Telefoon: het adres dat onderin open staat.
  const [gekozenId, setGekozenId] = useState<string | null>(null);

  // Zoeken: wat past staat open, ook als de straat dichtgeklapt was.
  const [zoektermen, setZoektermen] = useState<string[]>([]);
  // De zoekbalk staat op de telefoon onderin en op de computer in de pagina.
  // Draai je het scherm, dan verhuist hij en begint hij leeg: de lijst mag
  // dan niet gefilterd blijven op iets wat je niet meer ziet staan.
  useEffect(() => {
    setZoektermen([]);
    // Het blad onderin hoort bij de telefoon: na terugkantelen niet vanzelf
    // weer openspringen.
    setGekozenId(null);
  }, [mobiel]);
  const zoekt = zoektermen.length > 0;

  // De tabjes: alleen wat nog te lopen is, of één uitkomst. Wat er stond toen
  // je het tabje koos blijft staan, ook als je er daarna iets anders van maakt.
  const [filter, setFilter] = useState<{ wat: LoopFilter; vast: Set<string> } | null>(null);
  function kiesFilter(wat: LoopFilter | null) {
    // Het open adres hoort straks misschien niet meer bij wat je ziet.
    setGekozenId(null);
    setFilter(
      wat && {
        wat,
        vast: new Set((lijst.data ?? []).filter((r) => pastInFilter(r, wat)).map((r) => r.id)),
      },
    );
  }
  const zichtbaar = useMemo(
    () =>
      zoekInLooplijst(filterLooplijst(gesorteerd, filter?.wat ?? null, filter?.vast), zoektermen),
    [gesorteerd, filter, zoektermen],
  );
  /** Zoeken of een tabje: dan zie je niet de hele straat. */
  const beperkt = zoekt || filter !== null;
  const gevonden = zichtbaar.reduce((n, s) => n + s.heen.length + s.terug.length, 0);
  const heleStraat = useMemo(() => new Map(straten.map((s) => [s.straat_volgorde, s])), [straten]);

  const gekozen = gekozenId ? ((lijst.data ?? []).find((r) => r.id === gekozenId) ?? null) : null;
  const kies = useCallback((id: string) => setGekozenId((was) => (was === id ? null : id)), []);
  const blad = useRef<HTMLDivElement>(null);
  function sluitBlad() {
    // Terug naar de tegel waar je vandaan kwam, voor wie met toetsen werkt.
    if (gekozenId) document.getElementById(`looptegel-${gekozenId}`)?.focus();
    setGekozenId(null);
  }
  useEffect(() => {
    if (!gekozenId) return;
    blad.current?.focus({ preventScroll: true });
    // De tegel waar je op tikte mag niet achter het blad verdwijnen. Even
    // wachten: de pagina krijgt pas onderaan ruimte bij als het blad er staat.
    const straks = setTimeout(() => {
      const tegel = document.getElementById(`looptegel-${gekozenId}`);
      const rand = blad.current?.getBoundingClientRect().top;
      if (!tegel || rand === undefined) return;
      const over = tegel.getBoundingClientRect().bottom + 12 - rand;
      if (over > 0) window.scrollBy({ top: over, behavior: "smooth" });
    }, 150);
    return () => clearTimeout(straks);
  }, [gekozenId]);

  // In- en uitklappen, onthouden per gebied.
  const [dicht, setDicht] = useState(() => new Set(leesDichteStraten(gebiedId)));
  function zetDicht(nieuw: Set<string>) {
    setDicht(nieuw);
    onthoudDichteStraten(gebiedId, [...nieuw]);
  }
  function wissel(straat: string, sectie: string) {
    const nieuw = new Set(dicht);
    const ging = nieuw.delete(straat) ? "open" : "dicht";
    if (ging === "dicht") nieuw.add(straat);
    zetDicht(nieuw);
    requestAnimationFrame(() => {
      const el = document.getElementById(sectie);
      if (!el) return;
      // De knop waar je op stond is vervangen door een andere: de focus gaat
      // mee, anders begint Tab weer bovenaan de pagina.
      (el instanceof HTMLButtonElement ? el : el.querySelector("button"))?.focus({
        preventScroll: true,
      });
      if (ging === "open") return;
      // Een lange straat die dichtklapt laat je anders ergens ver onder zijn
      // eigen kop achter: terug naar de plek waar hij nu staat.
      const rand = parseFloat(getComputedStyle(el).getPropertyValue("--plakrand")) || 0;
      if (el.getBoundingClientRect().top < rand) el.scrollIntoView({ block: "start" });
    });
  }
  const allesDicht = straten.length > 0 && straten.every((s) => dicht.has(s.straat));
  function klapAlles() {
    zetDicht(allesDicht ? new Set() : new Set(straten.map((s) => s.straat)));
  }

  const zoekbalk = (
    <ZoekBalk
      placeholder="Zoek straat of huisnummer"
      onTermen={setZoektermen}
      className={
        mobiel
          ? "w-0 flex-1 shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
          : "min-h-10 shadow-none group-data-[plakt]/plak:bg-background sm:w-auto sm:min-w-[160px] sm:max-w-[340px] sm:flex-1"
      }
    />
  );
  const sorteerknop = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={mobiel ? "outline" : "ghost"}
          size={mobiel ? "icon" : "default"}
          className={mobiel ? RONDE_KNOP : "h-10 rounded-[12px]"}
          disabled={straten.length === 0}
          aria-label={`Sorteren: ${LOOP_SORTERINGEN.find((x) => x.waarde === sortering.hoe)?.label}`}
          title="De straten sorteren"
        >
          <Sorteer className="size-4" />
          {!mobiel && LOOP_SORTERINGEN.find((x) => x.waarde === sortering.hoe)?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={sortering.hoe}
          onValueChange={(hoe) => kiesSortering(hoe as LoopSortering)}
        >
          {LOOP_SORTERINGEN.map((x) => (
            <DropdownMenuRadioItem key={x.waarde} value={x.waarde} className="min-h-10">
              {x.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const inklapknop = (
    <Button
      variant={mobiel ? "outline" : "ghost"}
      size={mobiel ? "icon" : "default"}
      className={mobiel ? RONDE_KNOP : "h-10 rounded-[12px]"}
      onClick={klapAlles}
      disabled={straten.length === 0 || beperkt}
      aria-label={allesDicht ? "Alle straten uitklappen" : "Alle straten inklappen"}
      title={allesDicht ? "Alle straten uitklappen" : "Alle straten inklappen"}
    >
      {allesDicht ? <Uitklappen className="size-4" /> : <Inklappen className="size-4" />}
      {!mobiel && (allesDicht ? "Uitklappen" : "Inklappen")}
    </Button>
  );

  const jaRij = jaId ? ((lijst.data ?? []).find((r) => r.id === jaId) ?? null) : null;

  const bewaar = useCallback(
    async (id: string, patch: LoopPatch) => {
      const k = loopLijstSleutel(gebiedId);
      await qc.cancelQueries({ queryKey: k });
      // Alvast neerzetten; mislukt het, dan blijft het staan met een foutmelding.
      qc.setQueryData<LoopAdres[]>(k, (oud) =>
        oud?.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                ...patch,
                ...(patch.uitkomst !== undefined && patch.uitkomst !== r.uitkomst
                  ? {
                      uitkomst_op: patch.uitkomst ? new Date().toISOString() : null,
                      uitkomst_door_naam: patch.uitkomst ? (employee?.naam ?? null) : null,
                    }
                  : {}),
              },
        ),
      );
      try {
        await zetLoopAdres(id, patch);
      } catch (e) {
        // De rij toont de fout zelf met "Opnieuw", maar op de telefoon is het
        // blad dan vaak al dicht of bij het volgende adres: dus ook hier.
        const r = qc.getQueryData<LoopAdres[]>(k)?.find((x) => x.id === id);
        toast.error(
          `${r ? `${r.straat} ${loopNummer(r)}` : "Dit adres"} is niet bewaard: ${foutTekst(e)}`,
        );
        throw e;
      }
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      // Alleen een prijs of type verschuift een voorstel; een uitkomst niet.
      if (patch.prijs !== undefined || patch.woningtype_zelf !== undefined) {
        void qc.invalidateQueries({ queryKey: LOOP_VOORSTELLEN });
      }
    },
    [qc, gebiedId, employee?.naam],
  );

  const ja = useCallback(
    async (r: LoopAdres) => {
      if (r.uitkomst !== "ja") await bewaar(r.id, { uitkomst: "ja" });
      setJaId(r.id);
    },
    [bewaar],
  );

  const voorstelVan = (r: LoopAdres) => voorstellen.data?.[r.id] ?? null;

  const leeg = lijst.error ? (
    <Leeg tekst={foutTekst(lijst.error)} />
  ) : lijst.isLoading ? (
    <Leeg tekst="Bezig met ophalen…" />
  ) : tellingen && !gebied ? (
    <Leeg tekst="Dit gebied bestaat niet (meer)." />
  ) : straten.length === 0 ? (
    <Leeg tekst="Er staan nog geen adressen in dit gebied." />
  ) : zichtbaar.length === 0 ? (
    <Leeg
      tekst={
        zoekt
          ? `Niets gevonden voor "${zoektermen.join('", "')}".`
          : "Bij dit tabje staan geen adressen."
      }
    />
  ) : null;

  const onvolledig = gebied?.onvolledig && (
    <button
      type="button"
      onClick={() => void ophalen(gebied)}
      disabled={!!bezig}
      className="min-h-11 w-full rounded-xl bg-tint-amber px-3 text-left text-[13px] font-medium text-tint-amber-ink"
    >
      {bezig ? bezig.tekst : "Onvolledig — opnieuw ophalen"}
    </button>
  );

  const meldingen = (
    <>
      {zoekt && zichtbaar.length > 0 && (
        <p role="status" className="px-1 text-[12.5px] text-muted-foreground">
          {gevonden} {gevonden === 1 ? "adres" : "adressen"} gevonden in {zichtbaar.length}{" "}
          {zichtbaar.length === 1 ? "straat" : "straten"}
        </p>
      )}
      {voorstellen.error && (
        <p role="status" className="px-1 text-[12.5px] text-muted-foreground">
          De prijsvoorstellen konden niet geladen worden: {foutTekst(voorstellen.error)}
        </p>
      )}
    </>
  );

  /** "3 van 32" bij zoeken of een tabje, anders hoe ver de straat is. */
  function straatTeller(s: (typeof zichtbaar)[number]) {
    const stand = straatStand(heleStraat.get(s.straat_volgorde) ?? s);
    if (beperkt) return `${s.heen.length + s.terug.length} van ${stand.totaal}`;
    return `${stand.open === 0 ? "alles gelopen" : `${stand.open} te lopen`} · ${stand.totaal}`;
  }

  const naam = gebied?.naam ?? "Klanten lopen";
  const naarGebieden = () => void navigate({ to: "/lopen", search: {} });
  const gehad = gebied ? gebied.niet_thuis + gebied.interesse + gebied.ja + gebied.nee : 0;

  return (
    <AppLayout
      // Op de computer dezelfde opbouw als de Wijken-pagina: de naam groot en
      // los, daaronder één wit vak (kop + het zoekbakje dat blijft plakken).
      witVak={!mobiel}
      titel={
        mobiel ? (
          naam
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate pb-1 font-display text-[52px] font-bold leading-[1.25] tracking-[-0.03em]">
              {naam}
            </h1>
            <div className="flex-1" />
            <button
              type="button"
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-card px-4 text-[13px] font-semibold shadow-card transition-colors hover:bg-card/80"
              onClick={naarGebieden}
            >
              <Terug className="size-4" /> Gebieden
            </button>
          </div>
        )
      }
      zonderPaaltje
      actiePositie={mobiel ? "titelbalk" : "onder"}
      acties={
        mobiel ? (
          <Button variant="outline" className="rounded-full" onClick={naarGebieden}>
            <Terug className="size-4" /> Gebieden
          </Button>
        ) : (
          <PlakVak>
            <div className="flex flex-wrap items-center gap-1 rounded-[18px] bg-card-header p-1.5 group-data-[plakt]/plak:bg-card group-data-[plakt]/plak:shadow-[0_10px_30px_-12px_oklch(0.3_0.02_70/35%)]">
              {zoekbalk}
              {sorteerknop}
              {inklapknop}
            </div>
          </PlakVak>
        )
      }
      kop={
        mobiel ? undefined : (
          <div className="space-y-4 rounded-t-[24px] bg-card px-[22px] pb-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border/60">
              <button
                type="button"
                aria-pressed={!filter}
                onClick={() => kiesFilter(null)}
                className={cn(ONDERSTREEP, !filter && ONDERSTREEP_AAN)}
              >
                Alles
              </button>
              {LOOP_TABS.map((t) => {
                const aan = filter?.wat === t.filter;
                return (
                  <button
                    key={t.filter}
                    type="button"
                    aria-pressed={aan}
                    onClick={() => kiesFilter(aan ? null : t.filter)}
                    className={cn(ONDERSTREEP, aan && ONDERSTREEP_AAN)}
                  >
                    {t.label}
                    {gebied && (
                      <span className="ml-1.5 rounded-full bg-surface px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                        {t.tel(gebied)}
                      </span>
                    )}
                  </button>
                );
              })}
              {gebied && (
                <span className="ml-auto text-[12.5px] text-muted-foreground">
                  {[gebied.wijk ? `wijk ${gebied.wijk}` : "los gebied", gebied.plaats]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
            {gebied && (
              <Cijferkaarten
                cijfers={[
                  {
                    label: "Te lopen",
                    waarde: String(gebied.te_lopen),
                    onder: `van ${gebied.totaal} adressen in ${straten.length} ${straten.length === 1 ? "straat" : "straten"}`,
                    icon: Walk,
                    kleur: "blauw",
                  },
                  {
                    label: "Deuren gehad",
                    waarde: String(gehad),
                    onder: `${gebied.niet_thuis} niet thuis · ${gebied.nee} nee`,
                    icon: Deur,
                    kleur: "amber",
                    // Wit op wit valt weg: in het witte vak de kleur van de pagina.
                    klasse: "fel:bg-background fel:dark:bg-kaart-amber",
                  },
                  {
                    label: "Interesse",
                    waarde: String(gebied.interesse),
                    onder: " ",
                    icon: Praat,
                    kleur: "paars",
                  },
                  {
                    label: "Ja",
                    waarde: String(gebied.ja),
                    onder:
                      gebied.klanten > 0
                        ? `${gebied.klanten} al klant in dit gebied`
                        : "nog geen klant in dit gebied",
                    icon: Duim,
                    kleur: "groen",
                  },
                ]}
              />
            )}
            {onvolledig}
          </div>
        )
      }
      onderbalk={
        mobiel ? (
          <>
            {gekozen && (
              <div
                ref={blad}
                role="region"
                aria-label={`${gekozen.straat} ${loopNummer(gekozen)}`}
                tabIndex={-1}
                onKeyDown={(e) => {
                  if (e.key === "Escape") sluitBlad();
                }}
                className="max-h-[62dvh] overflow-y-auto rounded-[22px] bg-card shadow-[0_-4px_24px_oklch(0.3_0.02_70/24%)] outline-none"
              >
                <div className="flex items-center gap-2 pl-4 pr-1 pt-1">
                  <span className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">
                    {gekozen.straat}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 rounded-full"
                    aria-label="Adres sluiten"
                    onClick={sluitBlad}
                  >
                    <Sluit className="size-4" />
                  </Button>
                </div>
                <div className="-mt-2">
                  <LoopAdresRij
                    key={gekozen.id}
                    rij={gekozen}
                    voorstel={voorstelVan(gekozen)}
                    onBewaar={bewaar}
                    onJa={ja}
                    kaal
                  />
                </div>
              </div>
            )}
            {/* Blijft bestaan als er een adres open staat: de zoekbalk onthoudt
                zelf wat je typte, en de lijst is daar nog op gefilterd. */}
            <div className={gekozen ? "hidden" : "flex items-center gap-2"}>
              {zoekbalk}
              {sorteerknop}
              {inklapknop}
            </div>
          </>
        ) : undefined
      }
    >
      {mobiel ? (
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {gebied && (
            <div className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card px-4 pt-3.5 shadow-card">
              <LoopStand gebied={gebied} filter={filter?.wat ?? null} onFilter={kiesFilter} />
              {onvolledig && <div className="pb-3">{onvolledig}</div>}
            </div>
          )}
          {meldingen}
          {leeg ??
            zichtbaar.map((s) => {
              const sectie = `loopstraat-${s.straat_volgorde}`;
              if (!beperkt && dicht.has(s.straat)) {
                return (
                  <DichteStraat
                    key={s.straat_volgorde}
                    id={sectie}
                    straat={s.straat}
                    stand={straatStand(s)}
                    onOpen={() => wissel(s.straat, sectie)}
                  />
                );
              }
              const naam = (
                <span className="min-w-0 truncate font-display text-[17px] font-semibold tracking-[-0.01em]">
                  {s.straat}
                </span>
              );
              const tegel = (r: LoopAdres) => (
                <LoopTegel
                  key={r.id}
                  rij={r}
                  voorstel={voorstelVan(r)}
                  gekozen={r.id === gekozenId}
                  onKies={kies}
                />
              );
              return (
                <section
                  key={s.straat_volgorde}
                  id={sectie}
                  className="flex scroll-mt-[var(--plakrand,0px)] flex-col gap-2"
                >
                  <h2 className="sticky top-[var(--plakrand,0px)] z-[5] -mx-3 flex items-center gap-2 bg-background/95 px-3 pb-1 pt-3 backdrop-blur md:-mx-6 md:px-6">
                    {beperkt ? (
                      <span className="flex min-h-9 min-w-0 flex-1 items-center">{naam}</span>
                    ) : (
                      <button
                        type="button"
                        className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded
                        title={`${s.straat} dichtklappen`}
                        onClick={() => wissel(s.straat, sectie)}
                      >
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        {naam}
                      </button>
                    )}
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {straatTeller(s)}
                    </span>
                  </h2>
                  {s.heen.length === 0 || s.terug.length === 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {[...s.heen, ...s.terug].map(tegel)}
                    </div>
                  ) : (
                    // Zoals op Wijken: even links, oneven rechts, allebei in
                    // dezelfde richting, zodat wat tegenover elkaar ligt naast
                    // elkaar staat. Heen loop je de rechter kolom af, terug
                    // de linker weer omhoog.
                    <div className="grid grid-cols-2 items-start gap-2">
                      <div className="flex min-w-0 flex-col gap-2">
                        <Kant tekst="Even · terug" />
                        {[...s.terug].reverse().map(tegel)}
                      </div>
                      <div className="flex min-w-0 flex-col gap-2">
                        <Kant tekst="Oneven · heen" />
                        {s.heen.map(tegel)}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meldingen}
          {leeg ?? (
            <div>
              {zichtbaar.map((s) => {
                const sectie = `loopstraat-${s.straat_volgorde}`;
                const stand = straatStand(heleStraat.get(s.straat_volgorde) ?? s);
                const open = beperkt || !dicht.has(s.straat);
                const kolom = (titel: string, rijen: LoopAdres[], klasse?: string) => (
                  <div className={cn("min-w-0", klasse)}>
                    <div className="px-1.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                      {titel}
                    </div>
                    <LoopKolomKop />
                    {rijen.map((r) => (
                      <LoopTabelRij
                        key={r.id}
                        rij={r}
                        voorstel={voorstelVan(r)}
                        onBewaar={bewaar}
                        onJa={ja}
                      />
                    ))}
                  </div>
                );
                return (
                  <section
                    key={s.straat_volgorde}
                    id={sectie}
                    // @container: twee kolommen hangt af van hoe breed dit blok is (het
                    // menu links kan open of dicht staan), niet van het scherm.
                    className="@container mb-3 scroll-mt-[var(--plakrand,0px)] overflow-hidden rounded-[18px] bg-card p-1.5 shadow-card"
                  >
                    <div className="flex items-center gap-2.5 rounded-[12px] bg-card-header px-2.5 py-2">
                      <h2 className="flex min-w-0 flex-1">
                        <button
                          type="button"
                          aria-expanded={open}
                          disabled={beperkt}
                          title={`${s.straat} ${open ? "dichtklappen" : "openklappen"}`}
                          onClick={() => wissel(s.straat, sectie)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {open ? (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">
                            {s.straat}
                          </span>
                        </button>
                      </h2>
                      <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface">
                        <span
                          className="block h-full rounded-full bg-tint-groen-ink transition-[width] duration-300"
                          style={{
                            width: `${stand.teDoen > 0 ? (stand.gedaan / stand.teDoen) * 100 : 100}%`,
                          }}
                        />
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">
                        {straatTeller(s)}
                      </span>
                    </div>
                    {open &&
                      (s.heen.length === 0 || s.terug.length === 0 ? (
                        <div className="px-1 pt-1">
                          {kolom(
                            s.doorlopend ? "Op volgorde" : s.heen.length > 0 ? "Oneven" : "Even",
                            [...s.heen, ...s.terug],
                          )}
                        </div>
                      ) : (
                        // Zoals op Wijken: even links, oneven rechts, allebei
                        // in dezelfde richting, zodat wat tegenover elkaar ligt
                        // naast elkaar staat. Is het scherm te smal voor twee
                        // kolommen, dan eerst oneven (heen), dan even (terug).
                        <div className="grid gap-x-3 px-1 pt-1 @[1130px]:grid-cols-2">
                          {kolom("Oneven · heen", s.heen, "@[1130px]:order-last")}
                          {kolom("Even · terug", [...s.terug].reverse())}
                        </div>
                      ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      <JaDialog
        rij={jaRij}
        voorstel={jaRij ? voorstelVan(jaRij) : null}
        gebiedWijk={gebied?.district_id ?? null}
        onOpenChange={(o) => !o && setJaId(null)}
      />
    </AppLayout>
  );
}

/**
 * Een straat die dicht staat: hoe ver hij is en wat er nog te lopen valt,
 * net als de dichte straat bij het geldlopen. Tik erop en hij klapt open.
 */
function DichteStraat({
  id,
  straat,
  stand,
  onOpen,
}: {
  id: string;
  straat: string;
  stand: ReturnType<typeof straatStand>;
  onOpen: () => void;
}) {
  const af = stand.open === 0;
  const deel = stand.teDoen > 0 ? stand.gedaan / stand.teDoen : 1;
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      title={`${straat} openklappen`}
      className={`flex w-full scroll-mt-[var(--plakrand,0px)] flex-col gap-1.5 rounded-[16px] px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        af ? "border border-dashed border-border text-muted-foreground" : "bg-card shadow-card"
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={`min-w-0 flex-1 truncate font-display font-semibold ${af ? "text-[13.5px]" : "text-[15px]"}`}
        >
          {straat}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums ${
            af ? "font-semibold text-tint-groen-ink" : "text-muted-foreground"
          }`}
        >
          {af && <Check className="size-3.5" />}
          {af ? "alles gelopen" : `${stand.open} te lopen`} · {stand.totaal}
        </span>
      </span>
      <span className="ml-6 h-1 overflow-hidden rounded-full bg-surface">
        <span
          className="block h-full rounded-full bg-tint-groen-ink transition-[width] duration-300"
          style={{ width: `${deel * 100}%` }}
        />
      </span>
    </button>
  );
}

function Kant({ tekst }: { tekst: string }) {
  return (
    <div className="px-1 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {tekst}
    </div>
  );
}

function Leeg({ tekst }: { tekst: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-border px-6 py-12 text-center">
      <Walk className="mx-auto mb-3 size-6 text-muted-foreground" />
      <p className="mx-auto max-w-[40ch] text-[13.5px] text-muted-foreground">{tekst}</p>
    </div>
  );
}
