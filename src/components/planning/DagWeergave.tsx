import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  IconClock as Clock,
  IconCoffee as Coffee,
  IconSquareCheck as CheckSquare,
  IconDots as MoreHorizontal,
  IconTruck as Truck,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MailStatus } from "@/components/planning/MailStatus";
import { SelectieGreep } from "@/components/planning/SelectieGreep";
import { useVerfSelectie } from "@/components/planning/verfselectie";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  minutenVan,
  NIET_INGEDEELD,
  opzetVan,
  tijdVan,
  tijdvakVan,
  volPercentage,
  type Blok,
  type DagKlus,
  type DagRegel,
  type PlanInstellingen,
  type Ploeg,
  type Tijdlijn,
  verdeelOverAdressen,
} from "@/lib/dagplanning";
import { maandVan, type Bouwstenen } from "@/lib/dagbouwstenen";
import { statusVan, type AankondigingRij } from "@/lib/aankondigingen";
import { ploegNaam } from "@/lib/ploegen";
import { formatPrice, toonMaand, wijkInkt, wijkVlak } from "@/lib/klanten";

export interface DagWeergaveProps {
  datum: string;
  /** De knop naar de dagpagina; die hoort bij de andere knoppen en niet op een
   *  eigen regel met de datum die al in de pil erboven staat. */
  naarDagpagina?: ReactNode;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  regels: DagRegel[];
  klussen: DagKlus[];
  ploegen: Ploeg[];
  /** Per adres wat er aan de klant verstuurd is. */
  aankondigingen: Map<string, AankondigingRij[]>;
  /** Heeft de klant van dit adres een mailadres of 06? */
  heeftContact: (customerId: string) => boolean;
  /** Staat dit adres op die dag gepland? Voor de envelopjes. */
  staatOp: (customerId: string, datum: string) => boolean;
  magPlannen: boolean;
  prijzenZien: boolean;
  /** Blokken opnieuw ordenen; de lijst is de nieuwe volgorde per ploeg. */
  onVolgorde: (
    blokken: { ploeg_nr: number | null; vasteStart: string | null; blok: Blok }[],
  ) => void;
  onPloegen: () => void;
  onWerktijd: (ploegNr: number, begin: string, eind: string) => void;
  onEigenBlok: (customerId: string, waarde: boolean | null) => void;
  onSamenvoegen: (blok: Blok) => void;
  onVerplaats: (customerIds: string[], naar: string) => void;
  /** Bij een blok dat een extra opdracht is, hoort `klusId` mee: de adressen
   *  van zo'n blok zijn het adres waar de opdracht bij staat, niet de opdracht. */
  onNaarPloeg: (customerIds: string[], ploegNr: number | null, klusId?: string) => void;
  onWijziging: (customerIds: string[]) => void;
  /** Van deze dag af, terug naar "Nog in te plannen". Bij een extra opdracht
   *  telt `klusId`: die staat daarna weer open. */
  onUitPlanning: (customerIds: string[], klusId?: string) => void;
  /** De maand van deze dag overslaan; ze gaan dan ook van de dag af. */
  onOverslaan: (customerIds: string[]) => void;
  /** De selectie is van de pagina: in de week wijs je dezelfde adressen aan. */
  selecteren: boolean;
  gekozen: Set<string>;
  onKies: (ids: string[], aan: boolean, dag: string) => void;
  /** Wat er in het menu bij een selectie komt te staan. */
  selectieActies: (ids: string[]) => { sleutel: string; label: string; doe: () => void }[];
}

/**
 * Hoe hoog een uur is als er niets bijzonders in staat. Klap je de adressen
 * uit, dan rekt een uur vanzelf mee tot alles erin past — dat regelt
 * `uurHoogte`. Een aparte zoomstand is daar niet voor nodig.
 */
const BASIS_UUR_PX = 66;
/**
 * Hoger dan dit rekt een uur niet op, ook niet met heel veel korte adressen
 * erin: anders wordt één uur een hele pagina. Een uur met vijftien losse
 * adressen (15 × 24 px) blijft er ruim onder.
 */
const MAX_UUR_PX = 10 * BASIS_UUR_PX;

/**
 * Een blok moet zijn naam en zijn ⋯-knopje kwijt kunnen, met de rand erbij —
 * ook een straat van tien minuten. Daar rekt het uur zo nodig voor uit.
 * (Het vak is twee pixels hoger dan het blokje: dat is het kiertje ertussen.)
 */
const MIN_BLOK_PX = 26;
/** Hetzelfde voor een los adres; dat heeft geen rand. */
const MIN_ADRES_PX = 24;
/** Hoogte van een blok als de hele dag geen duur heeft: dan zegt hoogte niets. */
const BLOK_ZONDER_DUUR_PX = 44;

/** Eén ding in een kolom: een blok, een los adres, of pauze en rijtijd. */
interface Eenheid {
  sleutel: string;
  soort: "blok" | "adres" | "pauze" | "rijtijd";
  titel: string;
  /** Minuten na middernacht. */
  start: number;
  minuten: number;
  /** Het blok waar hij bij hoort; ook een los adres houdt zijn straat vast. */
  blok: Blok | null;
  adresId: string | null;
}

/** Eén kolom van het raster: een ploeg, of wat nog niet ingedeeld is. */
interface Kolom {
  ploeg: Ploeg | null;
  nr: number;
  blokken: Blok[];
  tijdlijn: Tijdlijn;
  eenheden: Eenheid[];
  /** Staat het werk hier op de klok? "Nog niet ingedeeld" hoort bij niemand,
   *  dus daar is geen begintijd om het aan op te hangen. */
  metKlok: boolean;
  /**
   * Alleen bij "Nog niet ingedeeld": met welk ploegnummer elk blok binnenkwam.
   * Daar staat ook werk van een ploeg die deze dag niet bestaat; wissel je de
   * volgorde, dan hoort dat nummer te blijven staan in plaats van stilletjes
   * te verdwijnen.
   */
  herkomst: Map<string, number>;
}

/** Wat een eenheid minstens hoog moet zijn om te kunnen lezen. */
function minHoogte(soort: Eenheid["soort"]): number {
  if (soort === "adres") return MIN_ADRES_PX;
  if (soort === "blok") return MIN_BLOK_PX;
  return 12;
}

/**
 * De blokken van een kolom als eenheden. Op het diepste zoomniveau valt een
 * straat uiteen in zijn adressen: elk adres begint waar het vorige ophoudt,
 * met zijn eigen duur gedeeld door het aantal mensen — dezelfde rekensom die
 * `berekenTijden` voor het hele blok maakt.
 *
 * Een groot pand en een extra opdracht blijven één blok: daar valt niets uit
 * elkaar te halen.
 */
function eenhedenVan(
  tijdlijn: Tijdlijn,
  perAdres: boolean,
  adressen: Bouwstenen["adressen"],
  mensen: number,
): Eenheid[] {
  const uit: Eenheid[] = [];
  for (const item of tijdlijn.items) {
    if (!item.blok) {
      uit.push({
        sleutel: item.sleutel,
        soort: item.soort === "pauze" ? "pauze" : "rijtijd",
        titel: item.titel,
        start: item.start,
        minuten: item.minuten,
        blok: null,
        adresId: null,
      });
      continue;
    }
    const blok = item.blok;
    const splitsen = perAdres && blok.soort === "straat" && blok.adressen.length > 1;
    if (!splitsen) {
      uit.push({
        sleutel: blok.sleutel,
        soort: "blok",
        titel: blok.titel,
        start: item.start,
        minuten: item.minuten,
        blok,
        adresId: null,
      });
      continue;
    }
    for (const a of verdeelOverAdressen(blok, item.start, item.minuten, adressen)) {
      uit.push({
        sleutel: `${blok.sleutel}:${a.id}`,
        soort: "adres",
        titel: a.titel,
        start: a.start,
        minuten: a.minuten,
        blok,
        adresId: a.id,
      });
    }
  }
  return uit;
}

/**
 * De verdeling van de uren over de hoogte.
 *
 * Een uur is normaal even hoog als elk ander uur, maar moet er meer in dan
 * erin past — zeven adressen in één uur — dan wordt dát uur hoger. De lijnen
 * blijven zo op hun eigen tijd staan: 10:00 staat op de streep van 10:00, ook
 * als het uur ervoor is uitgerekt.
 */
interface Schaal {
  van: number;
  tot: number;
  uren: number[];
  hoogten: number[];
  /** Waar elk uur begint, in pixels. Eén langer dan het aantal uren. */
  grens: number[];
  hoogte: number;
  pixelVan: (minuut: number) => number;
}

function maakSchaal(kolommen: Kolom[], van: number, tot: number, basisUurPx: number): Schaal {
  const aantal = Math.max(1, Math.round((tot - van) / 60));

  /** Wat er van één eenheid in één uur valt. */
  interface Stuk {
    /** Hoe hoog hij minstens moet zijn om te kunnen lezen. */
    min: number;
    /** Zijn hele duur; de hoogte volgt daaruit. */
    minuten: number;
    /** Welk deel van hem in dit uur valt (1 als hij er helemaal in past). */
    deel: number;
  }
  // Per uur, per kolom: de stukken. Per kolom apart, want kolommen staan naast
  // elkaar — het uur hoeft alleen de volste kolom aan te kunnen.
  const stukken: Stuk[][][] = Array.from({ length: aantal }, () => kolommen.map(() => []));
  kolommen.forEach((kolom, k) => {
    if (!kolom.metKlok) return;
    for (const e of kolom.eenheden) {
      // Een adres zonder duur staat op één tijdstip, maar moet wel leesbaar
      // zijn: hij telt voor zijn hele minimum mee in het uur waarin hij valt.
      if (e.minuten <= 0) {
        const i = Math.min(aantal - 1, Math.max(0, Math.floor((e.start - van) / 60)));
        stukken[i]![k]!.push({ min: minHoogte(e.soort), minuten: 0, deel: 1 });
        continue;
      }
      const eind = e.start + e.minuten;
      for (let i = 0; i < aantal; i++) {
        const uurVan = van + i * 60;
        const overlap = Math.min(eind, uurVan + 60) - Math.max(e.start, uurVan);
        if (overlap > 0) {
          stukken[i]![k]!.push({
            min: minHoogte(e.soort),
            minuten: e.minuten,
            deel: overlap / e.minuten,
          });
        }
      }
    }
  });

  /**
   * Hoe hoog een uur moet zijn.
   *
   * Een eenheid is zo hoog als hij lang duurt, maar nooit lager dan wat je
   * kunt lezen. Zitten er korte eenheden in, dan nemen die meer ruimte dan hun
   * minuten, en moet het uur mee — anders zakt alles erna onder zijn eigen
   * tijd. Een hoger uur maakt de lange eenheden ook weer hoger, dus per kolom
   * lossen we het exact op: de korte houden hun minimum, de lange nemen hun
   * deel van het uur, en het uur is wat daar samen uitkomt.
   */
  function uurHoogte(i: number): number {
    let hoogte = basisUurPx;
    for (const kolom of stukken[i]!) hoogte = Math.max(hoogte, kolomHoogte(kolom));
    return Math.ceil(hoogte);
  }

  /**
   * Hoe hoog één kolom dit uur moet zijn. Bij een hoger uur worden korte stukken
   * vanzelf lang genoeg; dan rekenen we opnieuw met die indeling. Dat kan alleen
   * maar omhoog, dus het stopt vanzelf, en nooit hoger dan MAX_UUR_PX.
   */
  function kolomHoogte(kolom: Stuk[]): number {
    let hoogte = basisUurPx;
    for (let ronde = 0; ronde <= kolom.length; ronde++) {
      let kort = 0;
      let langDeel = 0;
      for (const st of kolom) {
        if ((st.minuten * hoogte) / 60 >= st.min) langDeel += (st.minuten * st.deel) / 60;
        else kort += st.min * st.deel;
      }
      // Past het al? Dan klaar. Zo niet, dan is de hoogte waarbij de korte
      // precies hun minimum krijgen en de lange hun deel: h = kort + langDeel·h.
      if (kort + langDeel * hoogte <= hoogte + 0.5) break;
      // Vult het lange werk het hele uur al, dan helpt geen enkele hoogte: wat
      // kort is steekt er altijd uit. Dan niet voor niets oprekken.
      if (langDeel >= 1) break;
      hoogte = Math.min(MAX_UUR_PX, kort / (1 - langDeel));
      if (hoogte === MAX_UUR_PX) break;
    }
    return hoogte;
  }

  const hoogten: number[] = [];
  for (let i = 0; i < aantal; i++) hoogten.push(uurHoogte(i));
  const grens: number[] = [0];
  for (const h of hoogten) grens.push(grens[grens.length - 1]! + h);
  const uren: number[] = [];
  for (let i = 0; i <= aantal; i++) uren.push(van + i * 60);
  return {
    van,
    tot,
    uren,
    hoogten,
    grens,
    hoogte: grens[grens.length - 1]!,
    pixelVan(minuut: number) {
      const m = Math.max(van, Math.min(tot, minuut));
      const i = Math.min(aantal - 1, Math.floor((m - van) / 60));
      const binnen = m - van - i * 60;
      return grens[i]! + (binnen / 60) * hoogten[i]!;
    },
  };
}

/**
 * De dag als tijdraster: een kolom per ploeg, het werk op de klok.
 *
 * De tijden komen uit `berekenTijden`; hier worden ze alleen getekend. Zoom je
 * in tot "per adres", dan valt elke straat uiteen in zijn adressen en rekken
 * de uren mee zodat elk adres leesbaar blijft.
 *
 * Zonder tijdlijn (de instelling staat uit) blijven de kolommen en de
 * blokhoogtes staan, maar verdwijnen de uren en de klok: dan is er geen
 * begintijd om te tonen.
 */
export function DagWeergave(p: DagWeergaveProps) {
  /** Staan de losse adressen onder hun straat, of is het één blok per straat? */
  const [uitgeklapt, setUitgeklapt] = useState(false);
  /** Op een telefoon past maar één kolom; welke kijk je aan? */
  const [kolomOpTelefoon, setKolomOpTelefoon] = useState(0);
  const mobiel = useIsMobile();
  const { selecteren, gekozen } = p;

  // Ga je selecteren, dan wil je bij de losse adressen zijn.
  useEffect(() => {
    if (selecteren) setUitgeklapt(true);
  }, [selecteren]);

  const verf = useVerfSelectie({
    actief: selecteren && p.magPlannen,
    isGekozen: (id) => gekozen.has(id),
    onKies: p.onKies,
  });

  const perPloeg = useMemo(
    () =>
      maakBlokken({
        regels: p.regels,
        klussen: p.klussen,
        adressen: p.bouwstenen.adressen,
        straten: p.bouwstenen.straten,
        wijken: p.bouwstenen.wijken,
      }),
    [p.regels, p.klussen, p.bouwstenen],
  );

  /** Welke kolommen er staan: de ploegen van die dag, plus wat nog niet is ingedeeld. */
  const kolommen: Kolom[] = useMemo(() => {
    const maak = (
      ploeg: Ploeg | null,
      blokken: Blok[],
      metKlok: boolean,
      herkomst: Map<string, number> = new Map(),
    ): Kolom => {
      const opzet = opzetVan(p.instellingen, ploeg);
      const tijdlijn = berekenTijden(blokken, opzet);
      return {
        ploeg,
        nr: ploeg?.nr ?? NIET_INGEDEELD,
        blokken,
        tijdlijn,
        eenheden: eenhedenVan(tijdlijn, uitgeklapt, p.bouwstenen.adressen, opzet.mensen),
        metKlok,
        herkomst,
      };
    };
    const uit = p.ploegen.map((pl) => maak(pl, perPloeg.get(pl.nr) ?? [], true));
    // Werk kan een ploegnummer dragen dat op deze dag niet bestaat: het is
    // bijvoorbeeld opgeschoven van een dag waar wél twee ploegen waren. Dat
    // hoort zichtbaar te zijn, anders lijkt de dag leeg.
    const bekend = new Set(p.ploegen.map((pl) => pl.nr));
    const losMet = [...perPloeg.entries()].filter(([nr]) => !bekend.has(nr));
    const los = losMet.flatMap(([, blokken]) => blokken);
    const herkomst = new Map<string, number>(
      losMet.flatMap(([nr, blokken]) => blokken.map((b) => [b.sleutel, nr] as const)),
    );
    // Zonder ploegen is er één kolom; die heet dan niet "nog niet ingedeeld",
    // en dan ís dat de dag — dus mét klok.
    if (uit.length === 0) return [maak(null, los, true, herkomst)];
    // Anders staat hij rechts en heeft hij geen klok: er staat niemand op, dus
    // een begintijd zou verzonnen zijn.
    if (los.length > 0) uit.push(maak(null, los, false, herkomst));
    return uit;
  }, [p.ploegen, perPloeg, p.instellingen, p.bouwstenen.adressen, uitgeklapt]);

  /**
   * Van hoe laat tot hoe laat het raster loopt, op hele uren, en hoe hoog elk
   * uur is. Alle kolommen delen dezelfde verdeling, anders staat 10:00 in de
   * ene kolom ergens anders dan in de andere.
   */
  const schaal = useMemo(() => {
    const metKlok = kolommen.filter((k) => k.metKlok);
    if (!p.instellingen.tijdlijn || metKlok.length === 0) return null;
    let van = Infinity;
    let tot = -Infinity;
    for (const k of metKlok) {
      const opzet = opzetVan(p.instellingen, k.ploeg);
      van = Math.min(van, minutenVan(opzet.begin) ?? 480);
      tot = Math.max(tot, minutenVan(opzet.eind) ?? 990, k.tijdlijn.klaarOm);
    }
    if (!Number.isFinite(van) || !Number.isFinite(tot)) return null;
    return maakSchaal(kolommen, Math.floor(van / 60) * 60, Math.ceil(tot / 60) * 60, BASIS_UUR_PX);
  }, [kolommen, p.instellingen]);

  /**
   * Slepen om te selecteren, net als op de wijkenpagina. Het eerste vakje
   * bepaalt de richting: was het al gekozen, dan wist deze streek. Zou elk
   * vakje omschakelen, dan vink je bij het terugslepen je eigen werk weer uit.
   */
  /** Alles van één ploeg in één keer aan- of uitzetten. */
  function kiesKolom(kolom: Kolom) {
    // Extra opdrachten slaan we over: zie de opmerking bij `data-kies`.
    const ids = kolom.blokken.filter((b) => b.soort !== "klus").flatMap((b) => b.adressen);
    if (ids.length === 0) return;
    p.onKies(ids, !ids.every((id) => gekozen.has(id)), p.datum);
  }

  /** Bij welke ploeg een blok blijft horen als alleen de volgorde verandert. */
  function ploegVan(kolom: Kolom, blok: Blok): number | null {
    if (kolom.nr !== NIET_INGEDEELD) return kolom.nr;
    return kolom.herkomst.get(blok.sleutel) || null;
  }

  function verschuif(kolom: Kolom, blok: Blok, richting: -1 | 1) {
    const lijst = kolom.blokken;
    const i = lijst.findIndex((b) => b.sleutel === blok.sleutel);
    const j = i + richting;
    if (i < 0 || j < 0 || j >= lijst.length) return;
    const verwisseld = [...lijst];
    verwisseld[i] = lijst[j]!;
    verwisseld[j] = lijst[i]!;
    p.onVolgorde(
      verwisseld.map((b) => ({
        ploeg_nr: ploegVan(kolom, b),
        vasteStart: b.vasteStart,
        blok: b,
      })),
    );
  }

  /** Een blok op een vaste tijd zetten (of weer loslaten). */
  function zetVast(kolom: Kolom, blok: Blok, tijd: string | null) {
    p.onVolgorde(
      kolom.blokken.map((b) => ({
        ploeg_nr: ploegVan(kolom, b),
        vasteStart: b.sleutel === blok.sleutel ? tijd : b.vasteStart,
        blok: b,
      })),
    );
  }

  const maandNaam = toonMaand(maandVan(p.datum));

  /** Wat er in het menu van één eenheid staat, voor allebei de menu's. */
  function actiesVan(kolom: Kolom, e: Eenheid, anders: string[]): Actie[] {
    const blok = e.blok;
    if (!blok) return [];
    const uit: Actie[] = [];

    // Klik je op iets dat aangewezen is, dan gaat het menu eerst over de hele
    // selectie: dat is wat je bedoelde toen je ze aanwees.
    const eigen = e.adresId ? [e.adresId] : blok.adressen;
    // Niet bij een extra opdracht: zijn "adres" is het adres waar hij bij
    // staat, en dan zou het menu de straat raken in plaats van hem.
    const bulk = blok.soort === "klus" ? [] : p.selectieActies(eigen);
    if (bulk.length > 0) {
      uit.push({
        sleutel: "selkop",
        label: `Selectie (${gekozen.size})`,
        kop: true,
        doe: () => {},
      });
      for (const a of bulk) uit.push({ ...a });
      uit.push({ sleutel: "eigenkop", label: e.titel, kop: true, doe: () => {} });
    }

    // Een los adres: eerst wat je met dát adres kunt, daarna de straat waar hij
    // in staat — anders is die in de zoomstand "per adres" nergens meer te
    // vinden.
    const id = e.soort === "adres" ? e.adresId : null;
    if (id) {
      for (const pl of p.ploegen) {
        uit.push({
          sleutel: `adres-ploeg:${pl.nr}`,
          label: `Naar ${ploegNaam(pl)}`,
          uit: pl.nr === kolom.nr,
          doe: () => p.onNaarPloeg([id], pl.nr),
        });
      }
      if (kolom.nr !== NIET_INGEDEELD) {
        uit.push({
          sleutel: "adres-uitploeg",
          label: "Uit het team halen",
          doe: () => p.onNaarPloeg([id], null),
        });
      }
      if (anders.includes(id)) {
        uit.push({
          sleutel: "adres-wijziging",
          label: "Wijziging sturen",
          doe: () => p.onWijziging([id]),
        });
      }
      uit.push(
        {
          sleutel: "adres-uitplanning",
          scheidingVoor: true,
          label: "Uit planning halen",
          doe: () => p.onUitPlanning([id]),
        },
        {
          sleutel: "adres-overslaan",
          label: `Overslaan in ${maandNaam}`,
          doe: () => p.onOverslaan([id]),
        },
      );
      uit.push({
        sleutel: "straatkop",
        label: `Hele straat: ${blok.titel}`,
        kop: true,
        doe: () => {},
      });
    }

    const i = kolom.blokken.findIndex((b) => b.sleutel === blok.sleutel);
    uit.push(
      {
        sleutel: "eerder",
        label: "Eerder op de dag",
        uit: i <= 0,
        doe: () => verschuif(kolom, blok, -1),
      },
      {
        sleutel: "later",
        label: "Later op de dag",
        uit: i < 0 || i >= kolom.blokken.length - 1,
        doe: () => verschuif(kolom, blok, 1),
      },
    );
    if (p.instellingen.tijdlijn && kolom.metKlok) {
      uit.push({
        sleutel: "vast",
        scheidingVoor: !id,
        label: blok.vasteStart ? "Tijd loslaten" : `Vastzetten op ${tijdVan(e.start)}`,
        doe: () => zetVast(kolom, blok, blok.vasteStart ? null : tijdVan(e.start)),
      });
    }
    if (blok.soort !== "klus" && blok.adressen.length === 1) {
      uit.push({
        sleutel: "eigenblok",
        scheidingVoor: !id && uit.length === 2,
        label: blok.soort === "pand" ? "Terug bij de straat" : "Als eigen blok zetten",
        doe: () => p.onEigenBlok(blok.adressen[0]!, blok.soort !== "pand"),
      });
    }
    if (blok.rest) {
      uit.push({
        sleutel: "samen",
        label: "Samenvoegen met de straat",
        doe: () => p.onSamenvoegen(blok),
      });
    }
    if (anders.length > 0) {
      uit.push({
        sleutel: "wijziging",
        scheidingVoor: !id,
        label: `Wijziging sturen (${anders.length})`,
        doe: () => p.onWijziging(anders),
      });
    }
    for (const pl of p.ploegen) {
      uit.push({
        sleutel: `straat-ploeg:${pl.nr}`,
        scheidingVoor: !id && pl.nr === p.ploegen[0]!.nr,
        label: `Naar ${ploegNaam(pl)}`,
        uit: pl.nr === kolom.nr,
        doe: () => p.onNaarPloeg(blok.adressen, pl.nr, blok.klusId),
      });
    }
    if (kolom.nr !== NIET_INGEDEELD) {
      uit.push({
        sleutel: "straat-uitploeg",
        label: "Uit het team halen",
        doe: () => p.onNaarPloeg(blok.adressen, null, blok.klusId),
      });
    }
    const hoeveel = blok.soort === "straat" && blok.adressen.length > 1;
    uit.push({
      sleutel: "uitplanning",
      scheidingVoor: true,
      label: hoeveel ? `Uit planning halen (${blok.adressen.length})` : "Uit planning halen",
      doe: () => p.onUitPlanning(blok.adressen, blok.klusId),
    });
    // Een extra opdracht is eenmalig: die sla je niet over, die haal je eraf.
    if (blok.soort !== "klus") {
      uit.push({
        sleutel: "overslaan",
        label: hoeveel
          ? `Overslaan in ${maandNaam} (${blok.adressen.length})`
          : `Overslaan in ${maandNaam}`,
        doe: () => p.onOverslaan(blok.adressen),
      });
    }
    return uit;
  }

  // Welke kolom je op een telefoon ziet; op een breed scherm allemaal.
  const zichtbaar = Math.min(kolomOpTelefoon, Math.max(0, kolommen.length - 1));
  const teTonen = mobiel && kolommen.length > 1 ? [kolommen[zichtbaar]!] : kolommen;

  const gekozenLijst = [...gekozen];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.magPlannen && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            data-sneltoets="ploegen"
            onClick={p.onPloegen}
          >
            Teams indelen…
          </Button>
        )}
        {p.naarDagpagina}

        {/* Uitklappen zet de losse adressen onder hun straat; de uren rekken
            daar vanzelf voor mee. */}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto rounded-full"
          data-sneltoets="uitklappen"
          onClick={() => setUitgeklapt((aan) => !aan)}
        >
          {uitgeklapt ? "Straten tonen" : "Adressen tonen"}
        </Button>
      </div>

      {/* Op een telefoon past er maar één kolom naast de uren; met chips
          wissel je van ploeg. Op een breed scherm staan ze naast elkaar. */}
      {mobiel && kolommen.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {kolommen.map((k, i) => (
            <button
              key={`chip:${k.nr}`}
              type="button"
              aria-pressed={i === zichtbaar}
              onClick={() => setKolomOpTelefoon(i)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-medium ${
                i === zichtbaar
                  ? "bg-foreground text-background"
                  : k.ploeg
                    ? "border border-border bg-card text-muted-foreground"
                    : "border border-dashed border-border text-muted-foreground"
              }`}
            >
              {k.ploeg ? ploegNaam(k.ploeg) : "Niet ingedeeld"}
            </button>
          ))}
        </div>
      )}

      {/* Geen eigen scrollvenster: de pagina scrolt, niet het raster.
          De kolommen krimpen dus mee in plaats van opzij te schuiven. */}
      <div className={selecteren ? "select-none" : undefined} {...verf}>
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `${schaal ? "2.75rem " : ""}repeat(${teTonen.length}, minmax(0, 1fr))`,
          }}
        >
          {/* Kopjes: ze staan in dezelfde rasterrij, zodat de kolommen
              even breed blijven als de tijdkolom ernaast. */}
          {schaal && <div />}
          {teTonen.map((k) => (
            <KolomKop
              key={`kop:${k.nr}`}
              kolom={k}
              meerderePloegen={p.ploegen.length > 0}
              instellingen={p.instellingen}
              magPlannen={p.magPlannen}
              selecteren={selecteren && p.magPlannen}
              onAlles={() => kiesKolom(k)}
              onWerktijd={p.onWerktijd}
            />
          ))}

          {schaal && <Tijdkolom schaal={schaal} />}
          {teTonen.map((kolom) => (
            <PloegKolom
              key={kolom.nr}
              kolom={kolom}
              schaal={schaal}
              uurPx={BASIS_UUR_PX}
              magPlannen={p.magPlannen}
              prijzenZien={p.prijzenZien}
              selecteren={selecteren}
              gekozen={gekozen}
              datum={p.datum}
              instellingen={p.instellingen}
              bouwstenen={p.bouwstenen}
              aankondigingen={p.aankondigingen}
              heeftContact={p.heeftContact}
              staatOp={p.staatOp}
              actiesVan={actiesVan}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Eén regel in het menu van een blok of adres. */
interface Actie {
  sleutel: string;
  label: string;
  uit?: boolean;
  scheidingVoor?: boolean;
  /** Geen regel om aan te klikken, maar een kopje: wat eronder staat gaat over
   *  de straat en niet over het adres waar je op klikte. */
  kop?: boolean;
  doe: () => void;
}

/** De naam van de ploeg, hoe vol hij zit, en zijn werktijden. */
function KolomKop({
  kolom,
  meerderePloegen,
  instellingen,
  magPlannen,
  selecteren,
  onAlles,
  onWerktijd,
}: {
  kolom: Kolom;
  meerderePloegen: boolean;
  instellingen: PlanInstellingen;
  magPlannen: boolean;
  selecteren: boolean;
  onAlles: () => void;
  onWerktijd: (ploegNr: number, begin: string, eind: string) => void;
}) {
  const { ploeg, tijdlijn } = kolom;
  const opzet = opzetVan(instellingen, ploeg);
  const vol = volPercentage(tijdlijn);
  return (
    <div
      className={`rounded-[12px] border p-2 ${
        ploeg ? "border-border bg-card" : "border-dashed border-border bg-card/50"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-1.5">
        <h3 className="font-display text-[13.5px] font-semibold">
          {ploeg ? ploegNaam(ploeg) : meerderePloegen ? "Nog niet ingedeeld" : "Deze dag"}
        </h3>
        {ploeg && ploeg.leden.length > 1 && (
          <span className="text-[11.5px] text-muted-foreground">{ploeg.leden.length} man</span>
        )}
        {selecteren && kolom.blokken.length > 0 && (
          <button
            type="button"
            onClick={onAlles}
            className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Alles
          </button>
        )}
      </div>
      {kolom.metKlok ? (
        <>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${tijdlijn.teVol ? "bg-tint-amber-ink/70" : "bg-tint-blauw-ink/70"}`}
              style={{ width: `${Math.min(100, vol)}%` }}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="tabular-nums">
              {duurTekst(tijdlijn.werkMin)} / {duurTekst(tijdlijn.capaciteitMin)}
            </span>
            {instellingen.tijdlijn && (
              <span
                className={`ml-auto tabular-nums ${tijdlijn.teVol ? "text-tint-amber-ink" : ""}`}
              >
                {tijdlijn.teVol ? "loopt tot" : "klaar om"} {tijdVan(tijdlijn.klaarOm)}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {duurTekst(tijdlijn.werkMin)} werk — sleep naar een team
        </p>
      )}
      {instellingen.tijdlijn && ploeg && magPlannen && (
        <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <Input
            type="time"
            value={opzet.begin}
            aria-label="Begintijd"
            className="h-7 w-full min-w-0 flex-1 px-1 text-[11.5px]"
            onChange={(e) => onWerktijd(ploeg.nr, e.target.value, opzet.eind)}
          />
          <span className="shrink-0">–</span>
          <Input
            type="time"
            value={opzet.eind}
            aria-label="Eindtijd"
            className="h-7 w-full min-w-0 flex-1 px-1 text-[11.5px]"
            onChange={(e) => onWerktijd(ploeg.nr, opzet.begin, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

/** De uren langs de kant, op dezelfde lijnen als de kolommen ernaast. */
function Tijdkolom({ schaal }: { schaal: Schaal }) {
  return (
    <div className="relative" style={{ height: schaal.hoogte }}>
      {schaal.uren.map((m, i) => (
        <span
          key={m}
          className="absolute right-1 -translate-y-1/2 text-[10.5px] tabular-nums text-muted-foreground"
          style={{ top: schaal.grens[i] }}
        >
          {tijdVan(m)}
        </span>
      ))}
    </div>
  );
}

/** Eén kolom met werk: een plek om een blok op los te laten. */
function PloegKolom({
  kolom,
  schaal,
  uurPx,
  magPlannen,
  prijzenZien,
  selecteren,
  gekozen,
  datum,
  instellingen,
  bouwstenen,
  aankondigingen,
  heeftContact,
  staatOp,
  actiesVan,
}: {
  kolom: Kolom;
  schaal: Schaal | null;
  uurPx: number;
  magPlannen: boolean;
  prijzenZien: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  datum: string;
  instellingen: PlanInstellingen;
  bouwstenen: Bouwstenen;
  aankondigingen: Map<string, AankondigingRij[]>;
  heeftContact: (customerId: string) => boolean;
  staatOp: (customerId: string, datum: string) => boolean;
  actiesVan: (kolom: Kolom, e: Eenheid, anders: string[]) => Actie[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `ploegkolom:${kolom.nr}`,
    disabled: !magPlannen,
  });

  const opzet = opzetVan(instellingen, kolom.ploeg);
  const opDeKlok = Boolean(schaal) && kolom.metKlok;
  const eenheden = kolom.eenheden;
  // Heeft niets een duur, dan zegt hoogte niets meer; dan worden het even hoge
  // blokken onder elkaar — precies de lijst van vroeger.
  const metWerk = eenheden.filter((e) => e.blok);
  const zonderDuur = metWerk.length > 0 && metWerk.every((e) => e.minuten <= 1);

  /** De stand van één adres, zoals de klant hem te horen kreeg. */
  function standVan(id: string, start: number) {
    return statusVan(aankondigingen.get(id), datum, {
      heeftContact: heeftContact(id),
      staatOp: (dag) => staatOp(id, dag),
      tijdvak: instellingen.tijdlijn ? tijdvakVan(start, opzet.begin) : null,
    });
  }

  /**
   * De envelopstand van elk zichtbaar adres, één keer uitgerekend. Zonder dit
   * rekent een dag met vijftig adressen hem bij elk vinkje opnieuw uit, en dat
   * hapert op een tablet.
   */
  const standen = useMemo(() => {
    const kaart = new Map<string, ReturnType<typeof statusVan>>();
    for (const e of eenheden) {
      if (e.adresId) kaart.set(e.sleutel, standVan(e.adresId, e.start));
    }
    return kaart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eenheden, aankondigingen, heeftContact, staatOp, datum, instellingen.tijdlijn, opzet.begin]);

  /** Wat elke klant van een blok te horen kreeg, voor "Wijziging sturen". */
  function andersVan(e: Eenheid): string[] {
    if (!e.blok || e.soort === "adres") return [];
    return e.blok.adressen.filter((id) => standVan(id, e.start).stand === "verplaatst");
  }

  /**
   * Waar elke eenheid staat. Op de klok hangt hij aan zijn eigen begintijd; de
   * uren zijn al zo hoog gemaakt dat hij past. Zonder klok stapelen ze gewoon.
   * De onderkant van de vorige is altijd de bovengrens, zodat er nooit iets
   * over elkaar heen valt.
   */
  const plaatsen = useMemo(() => {
    const kaart = new Map<string, { top: number; hoogte: number }>();
    const px = uurPx / 60;
    let onderkant = 0;
    for (const e of eenheden) {
      const eigen = zonderDuur
        ? BLOK_ZONDER_DUUR_PX
        : schaal && opDeKlok
          ? schaal.pixelVan(e.start + e.minuten) - schaal.pixelVan(e.start)
          : e.minuten * px;
      // Het vak dat hij inneemt, en daarbinnen het blokje zelf: twee pixels
      // korter, zodat er een kiertje tussen zit zonder dat de volgende
      // opschuift. Zou het kiertje bij de tijd opgeteld worden, dan liep de
      // hele kolom per uur een paar pixels achter op de klok.
      const vak = Math.max(minHoogte(e.soort), Math.round(eigen));
      const natuurlijk = schaal && opDeKlok ? schaal.pixelVan(e.start) : onderkant;
      const top = Math.max(natuurlijk, onderkant);
      kaart.set(e.sleutel, { top, hoogte: Math.max(10, vak - 2) });
      onderkant = top + vak;
    }
    return { kaart, onderkant };
  }, [eenheden, zonderDuur, schaal, opDeKlok, uurPx]);

  const hoogte =
    schaal && opDeKlok
      ? Math.max(schaal.hoogte, plaatsen.onderkant)
      : Math.max(plaatsen.onderkant, 120);

  return (
    <div
      ref={setNodeRef}
      className={`relative rounded-[12px] border ${
        kolom.ploeg ? "border-border bg-card" : "border-dashed border-border bg-card/50"
      } ${isOver ? "ring-2 ring-ring" : ""}`}
      style={{ height: hoogte }}
    >
      {schaal &&
        opDeKlok &&
        schaal.uren
          .slice(1, -1)
          .map((m, i) => (
            <div
              key={m}
              className="pointer-events-none absolute inset-x-0 border-t border-border/50"
              style={{ top: schaal.grens[i + 1] }}
            />
          ))}

      <NuStreep datum={datum} schaal={opDeKlok ? schaal : null} />

      {eenheden.length === 0 && (
        <p className="p-2 text-center text-[12px] text-muted-foreground">Nog niets.</p>
      )}

      {eenheden.map((e) => {
        const plek = plaatsen.kaart.get(e.sleutel) ?? { top: 0, hoogte: MIN_BLOK_PX };
        if (!e.blok) {
          return <Rustitem key={e.sleutel} eenheid={e} plek={plek} metKlok={opDeKlok} />;
        }
        return (
          <Eenheidkaart
            key={e.sleutel}
            eenheid={e}
            plek={plek}
            metKlok={opDeKlok}
            wijkIndex={bouwstenen.wijken.get(e.blok.wijk_id)?.index ?? null}
            magPlannen={magPlannen}
            prijzenZien={prijzenZien}
            selecteren={selecteren && magPlannen}
            gekozen={gekozen}
            datum={datum}
            kolomNr={kolom.nr}
            mailStand={standen.get(e.sleutel) ?? null}
            maakActies={() => actiesVan(kolom, e, andersVan(e))}
          />
        );
      })}
    </div>
  );
}

/** Pauze of rijtijd: een streepje, geen blok — je doet er niets mee. */
function Rustitem({
  eenheid,
  plek,
  metKlok,
}: {
  eenheid: Eenheid;
  plek: { top: number; hoogte: number };
  metKlok: boolean;
}) {
  return (
    <div
      className="absolute inset-x-1 flex items-center gap-1 overflow-hidden rounded-[6px] bg-muted/70 px-1.5 text-[10.5px] text-muted-foreground"
      style={{ top: plek.top, height: plek.hoogte }}
      title={`${eenheid.titel} — ${duurTekst(eenheid.minuten)}`}
    >
      {eenheid.soort === "pauze" ? (
        <Coffee className="size-3 shrink-0" />
      ) : (
        <Truck className="size-3 shrink-0" />
      )}
      <span className="truncate">{eenheid.titel}</span>
      {metKlok && (
        <span className="ml-auto shrink-0 tabular-nums">{duurTekst(eenheid.minuten)}</span>
      )}
    </div>
  );
}

/** De streep op het uur van nu, alleen op de dag van vandaag. */
function NuStreep({ datum, schaal }: { datum: string; schaal: Schaal | null }) {
  const nu = new Date();
  const vandaag =
    datum ===
    `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}-${String(nu.getDate()).padStart(2, "0")}`;
  if (!schaal || !vandaag) return null;
  const minuten = nu.getHours() * 60 + nu.getMinutes();
  if (minuten < schaal.van || minuten > schaal.tot) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive"
      style={{ top: schaal.pixelVan(minuten) }}
      aria-hidden
    />
  );
}

/**
 * Eén blok of één adres in het raster: te slepen naar een andere ploeg, met
 * het menu op de rechtermuisknop en op het ⋯-knopje.
 *
 * Het menu zit op allebei: op een telefoon is er geen rechtermuisknop, en lang
 * indrukken begint daar een sleep.
 */
function Eenheidkaart({
  eenheid,
  plek,
  metKlok,
  wijkIndex,
  magPlannen,
  prijzenZien,
  selecteren,
  gekozen,
  datum,
  kolomNr,
  mailStand,
  maakActies,
}: {
  eenheid: Eenheid;
  plek: { top: number; hoogte: number };
  metKlok: boolean;
  wijkIndex: number | null;
  magPlannen: boolean;
  prijzenZien: boolean;
  selecteren: boolean;
  gekozen: Set<string>;
  datum: string;
  kolomNr: number;
  mailStand: ReturnType<typeof statusVan> | null;
  /** Het menu wordt pas gebouwd als het opengaat: bij vijftig adressen scheelt
   *  dat vijftig menu's per keer dat er iets op het scherm verandert. */
  maakActies: () => Actie[];
}) {
  const blok = eenheid.blok!;
  const losAdres = eenheid.soort === "adres";
  const adresId = eenheid.adresId;
  const aangevinkt = losAdres
    ? Boolean(adresId && gekozen.has(adresId))
    : blok.adressen.some((id) => gekozen.has(id));
  // Hoort hij bij de selectie, dan gaat die hele selectie mee als je sleept.
  const eigenIds = losAdres && adresId ? [adresId] : blok.adressen;
  const meeslepen = aangevinkt && blok.soort !== "klus" ? [...gekozen] : eigenIds;

  // Laat je een straat op deze vallen, dan komt hij hiervóór te staan en
  // schuift de rest gewoon op. Alleen bij hele straten: losse adressen volgen
  // de volgorde van hun straat.
  const { setNodeRef: setPlekRef, isOver } = useDroppable({
    id: `voor|${datum}|${kolomNr}|${blok.sleutel}`,
    disabled: !magPlannen || selecteren || losAdres,
  });
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `blok:${eenheid.sleutel}`,
    // Tijdens het selecteren is een streek een selectie, geen sleep.
    disabled: !magPlannen || selecteren,
    data: {
      soort: "blok",
      adressen: meeslepen,
      titel: eenheid.titel,
      datum,
      // Een extra opdracht verhuist als opdracht; zijn adressen zijn het adres
      // waar hij bij staat en dat hoort niet mee te gaan.
      ...(blok.klusId && !losAdres ? { klusId: blok.klusId } : {}),
    },
  });

  // Een extra opdracht heeft zijn eigen kleur (boter), de rest die van de wijk.
  // Een los adres wat lichter, zodat je ziet dat het bij zijn straat hoort.
  const vlak =
    blok.soort === "klus"
      ? "var(--tint-geel)"
      : wijkIndex === null
        ? undefined
        : wijkVlak([wijkIndex]);
  const inkt =
    blok.soort === "klus"
      ? "var(--tint-geel-ink)"
      : wijkIndex === null
        ? undefined
        : wijkInkt(wijkIndex);

  const aantalGekozen = losAdres ? 0 : blok.adressen.filter((id) => gekozen.has(id)).length;

  const kaart = (
    <div
      ref={(el) => {
        setNodeRef(el);
        setPlekRef(el);
      }}
      {...attributes}
      {...listeners}
      // Een extra opdracht hoort niet in een selectie: zijn "adressen" zijn het
      // adres waar hij bij staat, en dat zou dan meeverhuizen in plaats van de
      // opdracht zelf. Die gaat alleen via zijn eigen menu.
      {...(blok.soort === "klus"
        ? {}
        : {
            "data-kies": (losAdres && adresId ? [adresId] : blok.adressen).join(","),
            "data-kies-sleutel": eenheid.sleutel,
            "data-kies-dag": datum,
          })}
      // bg-tint-geel naast de inline kleur: daaraan ziet het thema Fel dat
      // hier een fel vlak ligt, en zet het de tekst erop donker.
      className={`absolute overflow-hidden rounded-[7px] px-1.5 py-0.5 text-left ${
        losAdres ? "left-3 right-1 opacity-90" : "inset-x-1 border border-border/60"
      } ${blok.soort === "klus" ? "bg-tint-geel" : ""} ${isDragging ? "opacity-40" : ""} ${
        aangevinkt ? "outline outline-2 -outline-offset-2 outline-primary" : ""
      } ${isOver ? "border-t-2 border-primary" : ""}`}
      style={{ top: plek.top, height: plek.hoogte, background: vlak, color: inkt }}
    >
      <div className="flex items-center gap-1">
        {selecteren && magPlannen && aangevinkt && blok.soort !== "klus" && (
          <SelectieGreep sleutel={`${datum}:${eenheid.sleutel}`} datum={datum} gekozen={gekozen} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{eenheid.titel}</span>
        {metKlok && losAdres && (
          <span className="shrink-0 text-[10px] tabular-nums opacity-70">
            {tijdVan(eenheid.start)}
          </span>
        )}
        {mailStand && <MailStatus status={mailStand} klein />}
        {!losAdres && blok.vasteStart && (
          <Clock className="size-3 shrink-0" aria-label="Vastgezet" />
        )}
        {magPlannen && <EenheidMenu maakActies={maakActies} titel={eenheid.titel} />}
      </div>
      {!losAdres && plek.hoogte >= 30 && (
        <div className="flex items-center gap-1 text-[10.5px] opacity-80">
          {metKlok && <span className="tabular-nums">{tijdVan(eenheid.start)}</span>}
          <span className="tabular-nums">{duurTekst(eenheid.minuten)}</span>
          {blok.soort === "straat" && <span>· {blok.adressen.length}</span>}
          {prijzenZien && <span className="ml-auto tabular-nums">{formatPrice(blok.bedrag)}</span>}
        </div>
      )}
      {aantalGekozen > 0 && (
        <span className="absolute bottom-0.5 right-1 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
          {aantalGekozen}
        </span>
      )}
    </div>
  );

  if (!magPlannen) return kaart;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{kaart}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <MenuInhoud maakActies={maakActies} soort="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Het ⋯-knopje met hetzelfde rijtje als de rechtermuisknop. */
function EenheidMenu({ maakActies, titel }: { maakActies: () => Actie[]; titel: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Menu voor ${titel}`}
          // Niet meeslepen: dit knopje is het menu.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.preventDefault()}
          className="shrink-0 rounded p-0.5 hover:bg-background/50"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuInhoud maakActies={maakActies} soort="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Eigen component, zodat `maakActies` pas draait als het menu open is — als
 * gewoon kind van de menu-inhoud zou het bij elke keer tekenen meelopen.
 */
function MenuInhoud({
  maakActies,
  soort,
}: {
  maakActies: () => Actie[];
  soort: "context" | "dropdown";
}) {
  return (
    <>
      {maakActies().map((a) => (
        <MenuRegel key={a.sleutel} actie={a} soort={soort} />
      ))}
    </>
  );
}

function MenuRegel({ actie, soort }: { actie: Actie; soort: "context" | "dropdown" }) {
  const Regel = soort === "context" ? ContextMenuItem : DropdownMenuItem;
  const Scheiding = soort === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  const Kop = soort === "context" ? ContextMenuLabel : DropdownMenuLabel;
  if (actie.kop) {
    return (
      <>
        <Scheiding />
        <Kop className="text-[11.5px] text-muted-foreground">{actie.label}</Kop>
      </>
    );
  }
  return (
    <>
      {actie.scheidingVoor && <Scheiding />}
      <Regel disabled={actie.uit ?? false} onSelect={actie.doe}>
        {actie.label}
      </Regel>
    </>
  );
}
