import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { IconUsers as Users } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MailStatus } from "@/components/planning/MailStatus";
import { SelectieGreep } from "@/components/planning/SelectieGreep";
import { useVerfSelectie } from "@/components/planning/verfselectie";
import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  NIET_INGEDEELD,
  opzetVan,
  tijdVan,
  tijdvakVan,
  volPercentage,
  type AdresInfo,
  type Blok,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type Tijdlijn,
  verdeelOverAdressen,
} from "@/lib/dagplanning";
import { maandVan, type Bouwstenen } from "@/lib/dagbouwstenen";
import {
  isGestuurd,
  samenvattingVan,
  statusVan,
  type AankondigingRij,
  type Mailstatus,
} from "@/lib/aankondigingen";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice, toonMaand, wijkInkt, wijkVlak } from "@/lib/klanten";

/** Eén dag in de week, met wat er die dag te doen is. */
export interface WeekDag {
  datum: string;
  regels: DagRegel[];
  klussen: DagKlus[];
  ploegen: Ploeg[];
}

/** Eén regel in het menu van een blok. */
interface Actie {
  sleutel: string;
  label: string;
  kop?: boolean;
  /** Een streepje erboven, om een nieuw groepje te beginnen. */
  scheidingVoor?: boolean;
  doe: () => void;
}

/** Wat alle kaartjes en regels van de week van de pagina meekrijgen. */
interface Handelingen {
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
  onNaarPloeg: (datum: string, ids: string[], ploegNr: number | null, klusId?: string) => void;
  /** Van de dag af, terug naar "Nog in te plannen". Bij een extra opdracht
   *  telt `klusId`: die staat daarna weer open. */
  onUitPlanning: (datum: string, ids: string[], klusId?: string) => void;
  /** De maand van die dag overslaan; ze gaan dan ook van de dag af. */
  onOverslaan: (datum: string, ids: string[]) => void;
  /** Klanten laten weten dat hun dag of tijd veranderd is. */
  onWijziging: (ids: string[]) => void;
}

/** Wat er aan de klanten verstuurd is, voor de envelopjes. */
interface Post {
  aankondigingen: Map<string, AankondigingRij[]>;
  heeftContact: (customerId: string) => boolean;
  /** Staat dit adres op die dag gepland? */
  staatOp: (customerId: string, datum: string) => boolean;
}

/**
 * De week: een kolom per werkdag. Bovenaan staat wat er die dag nog bij geen
 * ploeg hoort, daaronder een kaartje per ploeg.
 *
 * Elk kaartje heeft zijn eigen vol-balk, zodat je ziet waar nog ruimte is, en
 * de begintijd staat bij elke straat. Je sleept werk naar een andere dag of
 * ploeg, en met "Selecteren" wijs je met een streek aan wat er tegelijk mee
 * moet. Met "Adressen tonen" staan de losse adressen onder hun straat, elk
 * met zijn eigen menu.
 */
export function WeekWeergave({
  dagen,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  onKies,
  selectieActies,
  onOpenDag,
  onKiesDag,
  gekozenDag,
  onPloegen,
  onNaarPloeg,
  onUitPlanning,
  onOverslaan,
  onWijziging,
  aankondigingen,
  heeftContact,
  staatOp,
}: {
  dagen: WeekDag[];
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  onKies: (ids: string[], aan: boolean, dag: string) => void;
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
  /** Dubbelklik op een dag: naar de dagweergave. */
  onOpenDag: (datum: string) => void;
  /** Klik op een dag: die dag kiezen, zodat het vak rechts hem laat zien. */
  onKiesDag: (datum: string) => void;
  gekozenDag: string;
  onPloegen: (datum: string) => void;
} & Handelingen &
  Post) {
  /** Staan de losse adressen onder hun straat? */
  const [uitgeklapt, setUitgeklapt] = useState(false);
  const doen: Handelingen = {
    selectieActies,
    onNaarPloeg,
    onUitPlanning,
    onOverslaan,
    onWijziging,
  };
  const post = useMemo<Post>(
    () => ({ aankondigingen, heeftContact, staatOp }),
    [aankondigingen, heeftContact, staatOp],
  );
  const verf = useVerfSelectie({
    actief: selecteren && sleepbaar,
    isGekozen: (id) => gekozen.has(id),
    onKies,
  });

  const perDag = useMemo(
    () =>
      dagen.map((d) => {
        const blokken = maakBlokken({
          regels: d.regels,
          klussen: d.klussen,
          adressen: bouwstenen.adressen,
          straten: bouwstenen.straten,
          wijken: bouwstenen.wijken,
        });
        // Werk zonder ploeg, én werk met een ploegnummer dat deze dag niet
        // kent (na opschuiven bijvoorbeeld), hoort bovenaan de kolom: daar kun
        // je het vandaan slepen naar een ploeg.
        const bekend = new Set(d.ploegen.map((pl) => pl.nr));
        const los = [...blokken.entries()].filter(([nr]) => !bekend.has(nr)).flatMap(([, b]) => b);
        // De tijden hier al uitrekenen, niet bij het tekenen: dan blijven ze
        // hetzelfde bij elke streek van een selectie, en rekent een kaart zijn
        // envelopjes niet steeds opnieuw uit.
        const losTijdlijn = berekenTijden(los, opzetVan(instellingen, null));
        const tijdlijnen = new Map(
          d.ploegen.map((pl) => [
            pl.nr,
            berekenTijden(blokken.get(pl.nr) ?? [], opzetVan(instellingen, pl)),
          ]),
        );
        return { ...d, blokken, los, losTijdlijn, tijdlijnen };
      }),
    [dagen, bouwstenen, instellingen],
  );

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          data-sneltoets="uitklappen"
          aria-pressed={uitgeklapt}
          onClick={() => setUitgeklapt((aan) => !aan)}
        >
          {uitgeklapt ? "Straten tonen" : "Adressen tonen"}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <div
          className={`grid min-w-[52rem] gap-2 ${selecteren ? "select-none" : ""}`}
          style={{ gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))` }}
          {...verf}
        >
          {perDag.map((d) => (
            <div key={d.datum} className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  // Klikken kiest de dag (rechts zie je wat er staat), dubbelklikken
                  // opent de dagweergave — net als in de maand.
                  onClick={() => onKiesDag(d.datum)}
                  onDoubleClick={() => onOpenDag(d.datum)}
                  aria-pressed={d.datum === gekozenDag}
                  title="Klik om te bekijken, dubbelklik voor de dagweergave"
                  className={`min-w-0 flex-1 truncate rounded-[10px] px-1 py-1 text-[12.5px] font-medium ${
                    d.datum === gekozenDag ? "bg-foreground text-background" : "hover:bg-accent"
                  }`}
                >
                  {new Date(`${d.datum}T12:00:00`).toLocaleDateString("nl-NL", {
                    weekday: "short",
                    day: "numeric",
                  })}
                </button>
                {sleepbaar && (
                  <button
                    type="button"
                    onClick={() => onPloegen(d.datum)}
                    aria-label={`Teams indelen voor ${d.datum}`}
                    title="Teams indelen"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Users className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Nog niet ingedeeld staat bovenaan, ook als het leeg is zolang er
                ploegen zijn: dan is er een plek om iets naartoe te slepen. */}
              {(d.los.length > 0 || d.ploegen.length > 0) && (
                <Plek datum={d.datum} ploegNr={null} actief={sleepbaar}>
                  {(setRef, erboven) => (
                    <Kaart
                      setRef={setRef}
                      erboven={erboven}
                      ploeg={null}
                      datum={d.datum}
                      ploegenVanDag={d.ploegen}
                      blokken={d.los}
                      tijdlijn={d.losTijdlijn}
                      instellingen={instellingen}
                      bouwstenen={bouwstenen}
                      prijzenZien={prijzenZien}
                      sleepbaar={sleepbaar}
                      selecteren={selecteren}
                      gekozen={gekozen}
                      uitgeklapt={uitgeklapt}
                      doen={doen}
                      post={post}
                    />
                  )}
                </Plek>
              )}

              {d.ploegen.map((pl) => {
                const blokken = d.blokken.get(pl.nr) ?? [];
                return (
                  <Plek key={pl.nr} datum={d.datum} ploegNr={pl.nr} actief={sleepbaar}>
                    {(setRef, erboven) => (
                      <Kaart
                        setRef={setRef}
                        erboven={erboven}
                        ploeg={pl}
                        datum={d.datum}
                        ploegenVanDag={d.ploegen}
                        blokken={blokken}
                        tijdlijn={d.tijdlijnen.get(pl.nr)!}
                        instellingen={instellingen}
                        bouwstenen={bouwstenen}
                        prijzenZien={prijzenZien}
                        sleepbaar={sleepbaar}
                        selecteren={selecteren}
                        gekozen={gekozen}
                        uitgeklapt={uitgeklapt}
                        doen={doen}
                        post={post}
                      />
                    )}
                  </Plek>
                );
              })}

              {/* Een dag zonder ploegen: één vak waar alles op valt. */}
              {d.ploegen.length === 0 && d.los.length === 0 && (
                <Plek datum={d.datum} ploegNr={null} actief={sleepbaar}>
                  {(setRef, erboven) => (
                    <div
                      ref={setRef}
                      className={`min-h-20 rounded-[14px] border border-dashed p-1.5 text-center text-[11px] text-muted-foreground ${
                        erboven ? "border-primary bg-accent/60" : "border-border"
                      }`}
                    >
                      niets gepland
                    </div>
                  )}
                </Plek>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Eén ploeg op één dag, of wat er nog niet ingedeeld is. */
function Kaart({
  setRef,
  erboven,
  ploeg,
  datum,
  ploegenVanDag,
  blokken,
  tijdlijn,
  instellingen,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  uitgeklapt,
  doen,
  post,
}: {
  setRef: (el: HTMLElement | null) => void;
  erboven: boolean;
  ploeg: Ploeg | null;
  datum: string;
  ploegenVanDag: Ploeg[];
  blokken: Blok[];
  tijdlijn: Tijdlijn;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  uitgeklapt: boolean;
  doen: Handelingen;
  post: Post;
}) {
  const vol = volPercentage(tijdlijn);
  const opzet = opzetVan(instellingen, ploeg);

  /**
   * Per adres wat de klant te horen kreeg. Het tijdvak rekent vanaf het begin
   * van het blok, net als de planningsmail zelf (en de dagweergave). Eén keer
   * per kaart uitgerekend, niet bij elke streek van een selectie.
   */
  const standen = useMemo(() => {
    const kaart = new Map<string, Mailstatus>();
    for (const item of tijdlijn.items) {
      const blok = item.blok;
      if (!blok || blok.soort === "klus") continue;
      const tijdvak = instellingen.tijdlijn ? tijdvakVan(item.start, opzet.begin) : null;
      for (const id of blok.adressen) {
        kaart.set(
          id,
          statusVan(post.aankondigingen.get(id), datum, {
            heeftContact: post.heeftContact(id),
            tijdvak,
            staatOp: (dag) => post.staatOp(id, dag),
          }),
        );
      }
    }
    return kaart;
  }, [tijdlijn, post, datum, instellingen.tijdlijn, opzet.begin]);
  const leeg = blokken.length === 0;
  return (
    <div
      ref={setRef}
      className={`rounded-[14px] border p-1.5 text-left transition-colors ${
        ploeg ? "min-h-24" : "min-h-14 border-dashed"
      } ${erboven ? "border-primary bg-accent/60" : "border-border bg-card"}`}
    >
      <p className="mb-1 truncate text-[11.5px] font-medium text-muted-foreground">
        {ploeg ? ploegNaam(ploeg) : "Nog niet ingedeeld"}
      </p>

      {leeg && !ploeg && (
        <p className="px-1 text-[10.5px] text-muted-foreground">sleep hier werk naartoe</p>
      )}

      <ul className="space-y-0.5">
        {/* Uit de tijdlijn, zodat de begintijd er meteen bij staat. Pauze en
            rijtijd laten we hier weg: in een kolom van deze breedte zeggen ze
            weinig, en in de dagweergave staan ze wel. */}
        {tijdlijn.items.map((item) => {
          const blok = item.blok;
          if (!blok) return null;
          const metKlok = instellingen.tijdlijn && ploeg !== null;
          // Een straat met één adres, een groot pand of een opdracht ís al één
          // adres: daar valt niets uit te klappen.
          const losseAdressen =
            uitgeklapt && blok.soort === "straat" && blok.adressen.length > 1
              ? verdeelOverAdressen(blok, item.start, item.minuten, bouwstenen.adressen)
              : [];
          return (
            <Fragment key={item.sleutel}>
              <BlokRegel
                blok={blok}
                datum={datum}
                huidigePloeg={ploeg?.nr ?? NIET_INGEDEELD}
                ploegenVanDag={ploegenVanDag}
                bouwstenen={bouwstenen}
                prijzenZien={prijzenZien}
                sleepbaar={sleepbaar}
                selecteren={selecteren}
                gekozen={gekozen}
                doen={doen}
                tijd={metKlok ? tijdVan(item.start) : null}
                minuten={item.minuten}
                standen={blok.adressen.flatMap((id) => standen.get(id) ?? [])}
                anders={blok.adressen.filter((id) => standen.get(id)?.stand === "verplaatst")}
              />
              {losseAdressen.map((a) => (
                <AdresRegel
                  key={a.id}
                  id={a.id}
                  adres={bouwstenen.adressen.get(a.id)}
                  titel={a.titel}
                  tijd={metKlok ? tijdVan(a.start) : null}
                  blok={blok}
                  datum={datum}
                  huidigePloeg={ploeg?.nr ?? NIET_INGEDEELD}
                  ploegenVanDag={ploegenVanDag}
                  wijkIndex={bouwstenen.wijken.get(blok.wijk_id)?.index ?? null}
                  sleepbaar={sleepbaar}
                  selecteren={selecteren}
                  gekozen={gekozen}
                  doen={doen}
                  stand={standen.get(a.id) ?? null}
                />
              ))}
            </Fragment>
          );
        })}
      </ul>

      {!leeg && ploeg && (
        <>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${tijdlijn.teVol ? "bg-tint-amber-ink/70" : "bg-tint-blauw-ink/70"}`}
                style={{ width: `${Math.min(100, vol)}%` }}
              />
            </div>
            <span
              className={`shrink-0 text-[10.5px] tabular-nums ${tijdlijn.teVol ? "text-tint-amber-ink" : "text-muted-foreground"}`}
            >
              {duurTekst(tijdlijn.werkMin)}/{duurTekst(tijdlijn.capaciteitMin)}
            </span>
          </div>
          {instellingen.tijdlijn && (
            <div className="mt-1 flex items-baseline justify-between border-t border-border/60 pt-1 text-[10.5px]">
              <span className="text-muted-foreground">
                {tijdlijn.teVol ? "loopt tot" : "klaar om"}
              </span>
              <span
                className={`tabular-nums ${tijdlijn.teVol ? "text-tint-amber-ink" : "font-medium"}`}
              >
                {tijdVan(tijdlijn.klaarOm)}
              </span>
            </div>
          )}
        </>
      )}

      {!leeg && !ploeg && (
        <p className="mt-1 px-1 text-[10.5px] text-muted-foreground">
          {duurTekst(tijdlijn.werkMin)} werk
        </p>
      )}
    </div>
  );
}

/** Eén straat of opdracht, in de kleur van zijn wijk. */
function BlokRegel({
  blok,
  datum,
  huidigePloeg,
  ploegenVanDag,
  bouwstenen,
  prijzenZien,
  sleepbaar,
  selecteren,
  gekozen,
  doen,
  tijd,
  minuten,
  standen,
  anders,
}: {
  blok: Blok;
  datum: string;
  huidigePloeg: number;
  ploegenVanDag: Ploeg[];
  bouwstenen: Bouwstenen;
  prijzenZien: boolean;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  doen: Handelingen;
  /** Hoe laat hij begint, of niets als er geen klok is. */
  tijd: string | null;
  minuten: number;
  /** Wat elk adres van dit blok te horen kreeg. */
  standen: Mailstatus[];
  /** De adressen die na de planningsmail verplaatst zijn. */
  anders: string[];
}) {
  const klus = blok.soort === "klus";
  // Hoort hij bij de selectie, dan gaat die hele selectie mee als je sleept.
  const aangewezen = !klus && blok.adressen.some((id) => gekozen.has(id));
  const mee = aangewezen ? [...gekozen] : blok.adressen;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${datum}:${blok.sleutel}`,
    // Tijdens het selecteren is een streek een selectie, geen sleep.
    disabled: !sleepbaar || selecteren,
    data: {
      soort: "blok",
      adressen: mee,
      titel: blok.titel,
      datum,
      ...(blok.klusId ? { klusId: blok.klusId } : {}),
    },
  });
  // Laat je iets op deze straat vallen, dan komt het hiervóór te staan en
  // schuift de rest gewoon op.
  const { setNodeRef: setPlekRef, isOver } = useDroppable({
    id: `voor|${datum}|${huidigePloeg}|${blok.sleutel}`,
    disabled: !sleepbaar || selecteren,
  });
  const zetRef = (el: HTMLElement | null) => {
    setNodeRef(el);
    setPlekRef(el);
  };

  const index = bouwstenen.wijken.get(blok.wijk_id)?.index ?? null;
  const vlak = klus ? "var(--tint-geel)" : index === null ? undefined : wijkVlak([index]);
  const inkt = klus ? "var(--tint-geel-ink)" : index === null ? undefined : wijkInkt(index);

  const maakActies = () =>
    actiesVoor({
      ids: blok.adressen,
      klusId: blok.klusId,
      titel: blok.titel,
      datum,
      huidigePloeg,
      ploegenVanDag,
      gekozen,
      doen,
      anders,
    });
  const mail = samenvattingVan(standen);

  const regel = (
    <li
      ref={zetRef}
      {...attributes}
      {...listeners}
      {...(klus
        ? {}
        : {
            "data-kies": blok.adressen.join(","),
            "data-kies-sleutel": `${datum}:${blok.sleutel}`,
            "data-kies-dag": datum,
          })}
      // bg-tint-geel naast de inline kleur: daaraan ziet het thema Fel dat
      // hier een fel vlak ligt, en zet het de tekst erop donker.
      className={`rounded-[8px] px-1.5 py-0.5 text-[11.5px] ${klus ? "bg-tint-geel" : ""} ${isDragging ? "opacity-40" : ""} ${
        aangewezen ? "outline outline-2 -outline-offset-2 outline-primary" : ""
      } ${isOver ? "border-t-2 border-primary" : ""}`}
      style={{ background: vlak ?? "var(--muted)", color: inkt }}
    >
      <div className="flex items-center gap-1">
        {selecteren && sleepbaar && aangewezen && (
          <SelectieGreep sleutel={`${datum}:${blok.sleutel}`} datum={datum} gekozen={gekozen} />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{blok.titel}</span>
        {prijzenZien && <span className="shrink-0 tabular-nums">{formatPrice(blok.bedrag)}</span>}
      </div>
      <div className="flex items-center gap-1 text-[10.5px] opacity-80">
        {tijd && <span className="tabular-nums">{tijd}</span>}
        <span className="tabular-nums">{duurTekst(minuten)}</span>
        {blok.soort === "straat" && <span>· {blok.adressen.length}</span>}
        {mail && (
          <span className="ml-auto">
            <MailStatus status={mail} klein />
          </span>
        )}
      </div>
    </li>
  );

  return (
    <MetMenu actief={sleepbaar} maakActies={maakActies}>
      {regel}
    </MetMenu>
  );
}

/**
 * Eén adres onder zijn straat, als de adressen uitgeklapt staan. Te slepen en
 * aan te wijzen zoals een straat, met een eigen menu voor alleen dit adres.
 */
function AdresRegel({
  id,
  adres,
  titel,
  tijd,
  blok,
  datum,
  huidigePloeg,
  ploegenVanDag,
  wijkIndex,
  sleepbaar,
  selecteren,
  gekozen,
  doen,
  stand,
}: {
  id: string;
  adres: AdresInfo | undefined;
  titel: string;
  /** Hoe laat hij aan de beurt is, of niets als er geen klok is. */
  tijd: string | null;
  blok: Blok;
  datum: string;
  huidigePloeg: number;
  ploegenVanDag: Ploeg[];
  wijkIndex: number | null;
  sleepbaar: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  doen: Handelingen;
  /** Wat de klant te horen kreeg. */
  stand: Mailstatus | null;
}) {
  const aangewezen = gekozen.has(id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${datum}:${blok.sleutel}:${id}`,
    disabled: !sleepbaar || selecteren,
    data: {
      soort: "blok",
      // Hoort hij bij de selectie, dan gaat die hele selectie mee.
      adressen: aangewezen ? [...gekozen] : [id],
      titel,
      datum,
    },
  });

  const maakActies = () =>
    actiesVoor({
      ids: [id],
      titel,
      datum,
      huidigePloeg,
      ploegenVanDag,
      gekozen,
      doen,
      anders: stand?.stand === "verplaatst" ? [id] : [],
    });

  // De straatnaam staat er al boven; het huisnummer is genoeg.
  const kort = adres ? `${adres.house_number}${adres.addition}` : titel;

  const regel = (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-kies={id}
      data-kies-sleutel={`${datum}:${blok.sleutel}:${id}`}
      data-kies-dag={datum}
      title={titel}
      className={`ml-2.5 flex items-center gap-1 rounded-[6px] px-1.5 py-px text-[10.5px] opacity-90 ${
        isDragging ? "opacity-40" : ""
      } ${aangewezen ? "outline outline-2 -outline-offset-2 outline-primary" : ""}`}
      style={{
        background: wijkIndex === null ? "var(--muted)" : wijkVlak([wijkIndex]),
        color: wijkIndex === null ? undefined : wijkInkt(wijkIndex),
      }}
    >
      {selecteren && sleepbaar && aangewezen && (
        <SelectieGreep sleutel={`${datum}:${blok.sleutel}:${id}`} datum={datum} gekozen={gekozen} />
      )}
      <span className="min-w-0 flex-1 truncate">{kort}</span>
      {tijd && <span className="shrink-0 tabular-nums opacity-80">{tijd}</span>}
      {stand && isGestuurd(stand) && <MailStatus status={stand} klein />}
    </li>
  );

  return (
    <MetMenu actief={sleepbaar} maakActies={maakActies}>
      {regel}
    </MetMenu>
  );
}

/**
 * Het menu van een straat of van één adres. Staat wat je aanklikt in de
 * selectie, dan komt eerst wat je met de hele selectie kunt: dat bedoelde je
 * toen je ze aanwees.
 */
function actiesVoor({
  ids,
  klusId,
  titel,
  datum,
  huidigePloeg,
  ploegenVanDag,
  gekozen,
  doen,
  anders,
}: {
  ids: string[];
  klusId?: string | undefined;
  titel: string;
  datum: string;
  huidigePloeg: number;
  ploegenVanDag: Ploeg[];
  gekozen: Set<string>;
  doen: Handelingen;
  /** Wie na de planningsmail verplaatst is: die hoort een wijziging te krijgen. */
  anders: string[];
}): Actie[] {
  const acties: Actie[] = [];
  // Een extra opdracht hoort niet bij een selectie: zijn "adres" is het adres
  // waar hij bij staat, en dan zou het menu de straat raken in plaats van hem.
  const bulk = klusId ? [] : doen.selectieActies(ids);
  if (bulk.length > 0) {
    acties.push({
      sleutel: "selkop",
      label: `Selectie (${gekozen.size})`,
      kop: true,
      doe: () => {},
    });
    for (const a of bulk) acties.push({ ...a });
    acties.push({ sleutel: "eigenkop", label: titel, kop: true, doe: () => {} });
  }
  for (const pl of ploegenVanDag) {
    if (pl.nr === huidigePloeg) continue;
    acties.push({
      sleutel: `ploeg:${pl.nr}`,
      label: `Naar ${ploegNaam(pl)}`,
      doe: () => doen.onNaarPloeg(datum, ids, pl.nr, klusId),
    });
  }
  if (huidigePloeg !== NIET_INGEDEELD) {
    acties.push({
      sleutel: "uitploeg",
      label: "Uit het team halen",
      doe: () => doen.onNaarPloeg(datum, ids, null, klusId),
    });
  }
  // Alleen een streepje als er al iets boven staat.
  const streepje = () => acties.length > 0 && !acties[acties.length - 1]!.kop;
  if (anders.length > 0) {
    acties.push({
      sleutel: "wijziging",
      scheidingVoor: streepje(),
      label: anders.length > 1 ? `Wijziging sturen (${anders.length})` : "Wijziging sturen",
      doe: () => doen.onWijziging(anders),
    });
  }
  const aantal = ids.length > 1 ? ` (${ids.length})` : "";
  acties.push({
    sleutel: "uitplanning",
    scheidingVoor: streepje(),
    label: `Uit planning halen${klusId ? "" : aantal}`,
    doe: () => doen.onUitPlanning(datum, ids, klusId),
  });
  // Een extra opdracht is eenmalig: die sla je niet over, die haal je eraf.
  if (!klusId) {
    acties.push({
      sleutel: "overslaan",
      label: `Overslaan in ${toonMaand(maandVan(datum))}${aantal}`,
      doe: () => doen.onOverslaan(datum, ids),
    });
  }
  return acties;
}

/**
 * Een regel met het rechtermuisknopmenu erop. Het menu wordt pas opgebouwd als
 * het opengaat: met de adressen uitgeklapt staan er honderden regels in de
 * week, en elke streek bij het selecteren tekent ze allemaal opnieuw.
 */
function MetMenu({
  actief,
  maakActies,
  children,
}: {
  actief: boolean;
  maakActies: () => Actie[];
  children: ReactNode;
}) {
  if (!actief) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <MenuRegels maakActies={maakActies} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Eigen component, zodat `maakActies` pas draait als het menu open is. */
function MenuRegels({ maakActies }: { maakActies: () => Actie[] }) {
  return (
    <>
      {maakActies().map((a) =>
        a.kop ? (
          <div key={a.sleutel}>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-[11.5px] text-muted-foreground">
              {a.label}
            </ContextMenuLabel>
          </div>
        ) : (
          <Fragment key={a.sleutel}>
            {a.scheidingVoor && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={a.doe}>{a.label}</ContextMenuItem>
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * Een plek om werk op los te laten: een dag, en als er ploegen zijn ook welke
 * ploeg. Eigen component omdat een hook niet in een lus mag staan.
 */
function Plek({
  datum,
  ploegNr,
  actief,
  children,
}: {
  datum: string;
  ploegNr: number | null;
  actief: boolean;
  children: (setRef: (el: HTMLElement | null) => void, erboven: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `plek:${datum}:${ploegNr ?? 0}`,
    disabled: !actief,
  });
  return <>{children(setNodeRef, isOver)}</>;
}
