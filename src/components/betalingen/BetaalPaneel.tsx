import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconAlertTriangle as AlertTriangle,
  IconCalendarDollar as CalendarDollar,
  IconCheck as Check,
  IconCoin as Coin,
  IconDiscount as Discount,
  IconDoorOff as DoorOff,
  IconFolder as Folder,
  IconLayoutGrid as Raster,
  IconLoader2 as Loader2,
  IconWalletOff as WalletOff,
  IconX as Kruis,
} from "@tabler/icons-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  KortingDialoog,
  BedragDialoog,
  KlachtDialoog,
  VooruitDialoog,
} from "@/components/betalingen/DeurDialogen";
import { DeurKnop } from "@/components/betalingen/DeurKnop";
import { Eerder } from "@/components/betalingen/Eerder";
import { GeldloopDossier } from "@/components/betalingen/GeldloopDossier";
import { KlantKaart } from "@/components/betalingen/KlantKaart";
import { useBevestig } from "@/components/Bevestig";
import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  beurtenTekst,
  draaiOmzettingTerug,
  fetchOmzettingen,
  frequentieZin,
  keerOpen,
  maandVanNu,
  rekening,
  volgendeMaand,
  vooruitNieuweMaanden,
  terugNaarOvermakenTekst,
  zetNaarContant,
} from "@/lib/betalingen";
import { useAuth } from "@/lib/auth";
import { useMagAfrekenen, useRecht } from "@/lib/rechten";
import {
  boek,
  geldloopNietGewassen,
  heeftIetsOpen,
  nieuweTik,
  vooruitTotVan,
  type GeldloopAdres,
  type Tik,
  type Vrijgave,
} from "@/lib/geldlopen";
import { zetInWachtrij } from "@/lib/geldloop-wachtrij";
import { haalDossierGegevens, type DossierGegevens } from "@/lib/dossierOpenen";
import { klachtBijAdres } from "@/lib/klachten";
import { addQuickNote, formatPrice } from "@/lib/klanten";
import { vooruitLabel } from "@/lib/overzichten";
import { pushUndo, undoActie, undoKnop, type UndoActie } from "@/lib/undo";

type Venster = "korting" | "bedrag" | "klacht" | "dossier" | "vooruit" | null;

/**
 * Hetzelfde venster, maar niet op straat: bij Afrekenen, bij Betalen… op de
 * Wijken-pagina en op de dag, en in het dossier. Er is dan geen avond (geen
 * vrijgave) en je staat niet aan de deur: geen Niet thuis, Geen geld of
 * Niet gewassen. Een boeking gaat meteen naar de database, niet via de
 * wachtrij van de geldloper; lukt het niet, dan zegt de melding waarom.
 */
export interface Kantoor {
  /**
   * "kantoor": de eigenaar, of wie mag afrekenen. "dag": een wasser met
   * Planning die overdag geld kreeg; die tikt alleen Betaald (ook een deel)
   * in, en zet dat weer terug. Zo controleert de database het ook.
   */
  bron: "kantoor" | "dag";
  /** "Kerkstraat 12": in de melding na een boeking. */
  adresTekst: string;
  /** De dossierknop; niet als het venster al uit het dossier komt. */
  metDossier: boolean;
  /**
   * Weet de app of er deze maand nog een wasbeurt wacht? Alleen dan zegt
   * het venster voor welke maanden vooruit betalen ongeveer geldt.
   */
  maandenBekend: boolean;
  /** In plaats van de rekening en de knoppen: laden, of waarom hier niets kan. */
  melding?: ReactNode;
  /** Na "Klopt niet" bij Eerder: dat kan de betaalwijze van het adres veranderen. */
  onTeruggedraaid: () => void;
  /**
   * Tot hoeveel korting een ander dan de eigenaar mag geven. De database
   * rekent zonder de beurt van vandaag (die is nog niet afgemeld); weglaten
   * = wat er openstaat.
   */
  kortingTot?: number;
}

/**
 * Per kantoorboeking zijn stap op de Ongedaan-lijst van de pagina. Buiten het
 * venster bewaard: het dossier bouwt het venster opnieuw op, de lijst niet.
 */
const undoVan = new Map<string, UndoActie>();

/**
 * Wat je ziet als je een adres aantikt: bovenin wat je leest (wie, wat er
 * open staat en waarvoor), onderin wat je aantikt — eerst de rij van vier
 * (Korting, Deel betaald, Klacht en Dossier), dan Niet thuis, Geen geld en
 * Niet gewassen, dan Vooruit betalen, en helemaal onderaan de grote
 * saliegroene Betaald.
 *
 * Op de telefoon schuift het van onderen omhoog, zodat alles onder je duim
 * zit. Op de computer is dat onhandig: daar staat hetzelfde als een venster
 * midden in beeld, met Esc om te sluiten, Enter voor Betaald en de pijltjes
 * naar het vorige of volgende adres.
 *
 * Op straat hoort het bij een avond (`vrijgave`). Met `kantoor` is het
 * hetzelfde venster zonder avond: zie Kantoor. Daar staat alleen wat jij
 * mag; de rest laat het weg.
 */
export function BetaalPaneel({
  adres,
  vrijgave,
  voorbij = false,
  kantoor,
  onSluit,
  onVeranderd,
  onVorige,
  onVolgende,
}: {
  adres: GeldloopAdres | null;
  /** Op straat: de avond. Leeg met `kantoor`. */
  vrijgave?: Vrijgave | undefined;
  voorbij?: boolean | undefined;
  kantoor?: Kantoor | undefined;
  onSluit: () => void;
  /** Voor wat niet via de wachtrij gaat (klacht, vaste korting); op kantoor ook na elke boeking. */
  onVeranderd: () => void;
  /** Met de pijltjes door de lijst, zonder het venster te sluiten. */
  onVorige?: (() => void) | undefined;
  onVolgende?: (() => void) | undefined;
}) {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const mobiel = useIsMobile();
  const bevestig = useBevestig();
  const isEigenaar = employee?.rol === "eigenaar";
  const magBedragen = useRecht("prijzen_zien");
  // Op kantoor alleen wat je mag (de database dwingt hetzelfde af): een
  // klacht noteren met Klanten bewerken, het dossier met Klanten bekijken.
  const magKlacht = useRecht("klanten_bewerken");
  const magDossier = useRecht("klanten_bekijken", "klanten_bewerken");
  // Korting, vooruit en de vaste kortingen: niet voor de wasser overdag.
  const kantoorGeld = kantoor?.bron === "kantoor";
  // Omzetten naar contant en de kaart aanpassen: de eigenaar en wie mag afrekenen.
  const magAfrekenen = useMagAfrekenen();
  const [bezig, setBezig] = useState(false);
  // De geldkaart van alleen deze klant.
  const [kaartOpen, setKaartOpen] = useState(false);
  // Net omgezet naar contant, hier in dit venster: geel, met Ongedaan maken.
  const [omgezet, setOmgezet] = useState<{ id: string; adres: string } | null>(null);
  // Of die omzetting nog geldt: wie hem in de kaart terugdraait, ziet de gele
  // melding hier ook verdwijnen.
  const omzettingen = useQuery({
    queryKey: ["geld-omzettingen", omgezet?.adres],
    queryFn: () => fetchOmzettingen(omgezet!.adres),
    enabled: !!omgezet,
  });
  const omgezetGeldt =
    !!omgezet &&
    !(omzettingen.data?.omzettingen ?? []).some((o) => o.id === omgezet.id && o.ongedaan_op);
  /** Een boeking op kantoor die misging (bijv. geen bereik): nog eens met
   *  hetzelfde id, zodat hij niet dubbel telt als hij toch binnenkwam. */
  const vorige = useRef<{ sleutel: string; tik: Tik } | null>(null);
  const [venster, setVenster] = useState<Venster>(null);
  // Het volledige dossier (alleen de eigenaar): eerst laden, dan openen.
  const [dossierLaden, setDossierLaden] = useState(false);
  const [volDossier, setVolDossier] = useState<DossierGegevens | null>(null);
  // Het laatst gekozen adres vasthouden terwijl het paneel dichtschuift.
  const [a, setA] = useState<GeldloopAdres | null>(adres);
  useEffect(() => {
    if (adres) setA(adres);
  }, [adres]);
  // Een mislukte boeking op kantoor geldt alleen zolang dit adres open staat.
  const adresId = adres?.id;
  useEffect(() => {
    vorige.current = null;
  }, [adresId]);

  /**
   * Eén tik: meteen zichtbaar in de lijst, en op de achtergrond naar de
   * database. Het paneel wacht er niet op: met slecht bereik loop je gewoon
   * door naar het volgende huis. Weigert de database hem, dan meldt de app
   * dat (en staat hij bij "Niet verwerkt").
   */
  function stuur(t: Omit<Tik, "id" | "op" | "adres" | "getoond_open">): string | null {
    if (!a || !employee || !vrijgave) return null;
    const nieuw = {
      ...nieuweTik({ ...t, adres: a.id, getoond_open: a.open }),
      vrijgave: vrijgave.id,
      door: employee.id,
      door_naam: employee.naam || employee.email || "",
      adres_tekst: `${a.straat} ${a.house_number}${a.addition}`,
    };
    zetInWachtrij(nieuw);
    return nieuw.id;
  }

  async function tik(
    t: Omit<Tik, "id" | "op" | "adres" | "getoond_open">,
    melding: string,
    sluiten: boolean,
  ): Promise<boolean> {
    if (!a) return false;
    if (kantoor) return boekOpKantoor(t, melding, sluiten);
    const id = stuur(t);
    if (!id) return false;
    if (sluiten) onSluit();
    const nummer = `${a.house_number}${a.addition}`;
    toast.success(`${melding} · nr ${nummer}`, {
      duration: 8000,
      action: {
        label: "Ongedaan maken",
        onClick: () => {
          stuur({ soort: "ongedaan", herroept: id });
          toast(`Teruggedraaid · nr ${nummer}`);
        },
      },
    });
    return true;
  }

  function herstel(id: string) {
    if (kantoor) {
      // Dezelfde stap als op de Ongedaan-lijst van de pagina: dan staat hij
      // daar niet meer, en pakt Ctrl+Z later niet deze al teruggedraaide.
      // Lukt dat niet (er loopt al een andere stap, of hij staat niet meer op
      // de lijst), dan rechtstreeks: de database weet of hij al terug is.
      const actie = undoVan.get(id) ?? null;
      void undoActie(actie)
        .then((label) => (label === null ? herstelOpKantoor(id) : undefined))
        .then(
          () => toast("Teruggedraaid"),
          (e: unknown) => toast.error((e as Error).message),
        );
      return;
    }
    stuur({ soort: "ongedaan", herroept: id });
    toast("Teruggedraaid");
  }

  /**
   * Eén boeking op kantoor of overdag: meteen naar de database, en pas daarna
   * dicht. Met Ongedaan maken in de melding en in de Ongedaan-rij van de
   * pagina, zodat die knop dit terugdraait en niet iets van daarvoor.
   */
  async function boekOpKantoor(
    t: Omit<Tik, "id" | "op" | "adres" | "getoond_open">,
    melding: string,
    sluiten: boolean,
  ): Promise<boolean> {
    if (!a || !kantoor) return false;
    const sleutel = JSON.stringify({ ...t, adres: a.id });
    // Een nieuwe poging houdt het id, maar krijgt het tijdstip van nu.
    const nieuw =
      vorige.current?.sleutel === sleutel
        ? { ...vorige.current.tik, op: new Date().toISOString() }
        : nieuweTik({ ...t, adres: a.id, bron: kantoor.bron, getoond_open: a.open });
    vorige.current = { sleutel, tik: nieuw };
    setBezig(true);
    try {
      await boek(nieuw);
      vorige.current = null;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBezig(false);
    }
    onVeranderd();
    if (sluiten) onSluit();
    const actie: UndoActie = { label: melding, undo: () => herstelOpKantoor(nieuw.id) };
    pushUndo(actie);
    undoVan.set(nieuw.id, actie);
    // Vooruit kan een geplande wissel naar overmaken laten doorgaan: dan
    // verandert de betaalwijze van het adres zelf.
    if (t.soort === "vooruit") void qc.invalidateQueries({ queryKey: ["customers"] });
    toast.success(`${melding} · ${kantoor.adresTekst}`, { duration: 10000, action: undoKnop() });
    return true;
  }

  /** Een boeking op kantoor terugdraaien; een fout gaat door naar wie het vroeg. */
  async function herstelOpKantoor(id: string) {
    if (!a || !kantoor) return;
    await boek(nieuweTik({ adres: a.id, soort: "ongedaan", herroept: id, bron: kantoor.bron }));
    onVeranderd();
    // Terugdraaien kan een wissel naar overmaken terugzetten (zie hierboven).
    void qc.invalidateQueries({ queryKey: ["customers"] });
  }

  /** Een klacht op kantoor: bij de klant van dit adres, zoals in het dossier. */
  async function klachtOpKantoor(tekst: string) {
    if (!a) return;
    await klachtBijAdres(a.id, tekst, "anders");
    void qc.invalidateQueries({ queryKey: ["klachten"] });
    void qc.invalidateQueries({ queryKey: ["open-klachten"] });
  }

  const regels = a ? rekening(a.delen, a.vooruit_p) : [];
  const open = a && heeftIetsOpen(a);
  const kanTikken = !!a && (!voorbij || isEigenaar);
  // Op kantoor weet het venster niet waar de tik van vandaag vandaan kwam (ook
  // de papieren kaart telt mee); die draai je daar terug onder Eerder, met
  // dezelfde regels als de database. Overdag is het altijd een tik van overdag.
  const vanavondHier = !kantoor || kantoor.bron === "dag";
  const vanMij = a?.vanavond && vanavondHier && (a.vanavond.door === employee?.id || isEigenaar);
  // Vooruit betaald en nog niet op: de vaste korting zit dan al in de prijs
  // per beurt (de database weigert hem ook).
  const vooruitOver = a && !a.gestopt ? a.vooruit_over : 0;
  const vooruitGedekt =
    vooruitOver > 0 || !!a?.delen.some((d) => d.soort === "wassen" && (d.vooruit ?? 0) > 0.005);
  // Vooruit betalen kan alleen bij een contant adres dat nog loopt en een prijs
  // heeft, en niet zolang de beurten van een vorige bewoner nog terug moeten.
  // Zonder prijs vult de eigenaar op kantoor de prijs per beurt zelf in.
  const vooruitKan =
    !!a &&
    (a.vooruit_p !== null || (kantoorGeld && isEigenaar)) &&
    a.methode === "contant" &&
    !a.gestopt &&
    a.vooruit_vast === 0;
  // Voor welke maanden vooruit betalen ongeveer geldt: op straat altijd.
  const metMaanden = !kantoor || kantoor.maandenBekend;

  /**
   * De dossierknop. Een geldloper krijgt het kleine dossier (zonder
   * betaalwijze); de eigenaar het volledige klantdossier, zodat hij aan de
   * deur ook contant of overmaken kan omzetten. Dit adres en de klant vers
   * ophalen: het dossier schrijft bij opslaan alles terug, en met een oude
   * versie zou je een net toegevoegd nummer stil weer wissen (zie
   * lib/dossierOpenen). De lijsten komen uit het geheugen; die opnieuw
   * ophalen duurde aan de deur op 4G seconden.
   */
  async function openDossier() {
    if (!a) return;
    // Het kleine dossier hoort bij de avond; op kantoor het volledige.
    if (!isEigenaar && !kantoor) {
      setVenster("dossier");
      return;
    }
    setDossierLaden(true);
    try {
      const g = await haalDossierGegevens(qc, a.id);
      if (!g) {
        toast.error("Dit adres staat er niet (meer).");
        return;
      }
      setVolDossier(g);
    } catch {
      toast.error("Het dossier kon niet geladen worden. Probeer het zo nog eens.");
    } finally {
      setDossierLaden(false);
    }
  }

  /** Na het dossier: een andere betaalwijze of prijs meteen in de lijst. */
  function ververs() {
    if (vrijgave) void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] });
    else onVeranderd();
  }

  /**
   * Dit adres maakt over, maar betaalt eigenlijk contant: blijvend omzetten,
   * net als de betaalwijze in het dossier. Daarna meteen de kaart van deze
   * klant, om de maanden die nog open stonden op 0 te zetten.
   */
  async function omzettenNaarContant() {
    if (!a) return;
    const nummer = `${a.house_number}${a.addition}`;
    const ja = await bevestig({
      titel: `Nummer ${nummer} omzetten naar contant?`,
      tekst:
        "Dan betaalt dit adres voortaan contant, net als wanneer je het in het dossier verandert. Daarna zie je de geldkaart van deze klant: daar zet je de maanden die nog open stonden op 0.",
      bevestigLabel: "Omzetten",
    });
    if (!ja) return;
    setBezig(true);
    try {
      const id = await zetNaarContant(a.id);
      setOmgezet({ id, adres: a.id });
    } catch (e) {
      toast.error((e as Error).message);
      return;
    } finally {
      setBezig(false);
    }
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["geld-omzettingen", a.id] });
    ververs();
    toast.success(`Nr ${nummer} betaalt nu contant`);
    setKaartOpen(true);
  }

  async function omzettenTerug() {
    if (!a || !omgezet) return;
    const ja = await bevestig({
      titel: "Omzetten ongedaan maken?",
      tekst:
        "Dan maakt dit adres weer over, zoals eerst. De maanden die je daarna in de geldkaart naar contant zette, gaan ook terug naar overmaken.",
      bevestigLabel: "Ongedaan maken",
    });
    if (!ja) return;
    let methode: Awaited<ReturnType<typeof draaiOmzettingTerug>> = null;
    setBezig(true);
    try {
      methode = await draaiOmzettingTerug(omgezet.id);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    } finally {
      setBezig(false);
    }
    setOmgezet(null);
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["geld-omzettingen", a.id] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
    ververs();
    toast(`Nr ${a.house_number}${a.addition}: ${terugNaarOvermakenTekst(methode).toLowerCase()}`);
  }

  function betaalAlles() {
    if (!a || !open || !kanTikken || bezig || kantoor?.melding) return;
    void tik({ soort: "betaald", bedrag: a.open }, `Betaald ${formatPrice(a.open)}`, true);
  }

  /**
   * Er is hier helemaal niet gewassen — vergeten, of er kon niemand bij. De
   * beurt blijft op de dag staan, maar telt niet meer mee: het bedrag vervalt
   * en het adres telt weer als niet gewassen.
   */
  async function meldNietGewassen() {
    if (!a || !vrijgave) return;
    const nummer = `${a.house_number}${a.addition}`;
    const ja = await bevestig({
      titel: `Nummer ${nummer} niet gewassen?`,
      tekst:
        "De beurt blijft op de dag staan, maar telt niet meer mee: het bedrag vervalt en hij kleurt rood. Het adres telt weer als niet gewassen, zodat je hem opnieuw kunt inplannen.",
      bevestigLabel: "Niet gewassen",
    });
    if (!ja) return;
    try {
      await geldloopNietGewassen(a.id, vrijgave.datum);
      onVeranderd();
      onSluit();
      toast.success(`Niet gewassen · nr ${nummer}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Het toetsenbord in het venster op de computer. */
  function opToets(e: KeyboardEvent) {
    if (mobiel || venster !== null || e.metaKey || e.ctrlKey || e.altKey) return;
    // Staat de aandacht op een knop, dan doet Enter of de spatie die knop al.
    const doel = e.target as HTMLElement | null;
    if (e.key === "Enter" && doel?.tagName === "BUTTON") return;
    if (e.key === "Enter") {
      e.preventDefault();
      betaalAlles();
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      if (!onVolgende) return;
      e.preventDefault();
      onVolgende();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      if (!onVorige) return;
      e.preventDefault();
      onVorige();
    }
  }

  const Titel = mobiel ? DrawerTitle : DialogTitle;

  // De rij van vier; op kantoor alleen de knoppen die je mag gebruiken.
  const toonKorting = !kantoor || kantoorGeld;
  const toonKlacht = !kantoor || magKlacht;
  const toonDossier = !kantoor || (kantoor.metDossier && magDossier);
  const rij = 1 + [toonKorting, toonKlacht, toonDossier].filter(Boolean).length;
  // Korting die tegoed wordt (meer dan er openstaat) geeft alleen de eigenaar, op kantoor.
  const meerDanOpen = kantoorGeld && isEigenaar;
  // Voor een ander dan de eigenaar: de grens van de database (zie kortingTot).
  const kortingOpen =
    a && kantoor && !isEigenaar ? Math.min(a.open, kantoor.kortingTot ?? a.open) : (a?.open ?? 0);

  const inhoud = a ? (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-5 md:pb-5 md:pt-4">
      {/* Wat je leest */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-baseline justify-between gap-3 pr-6">
          <Titel className="min-w-0 truncate font-display text-[24px] font-semibold tracking-[-0.02em]">
            {a.house_number}
            {a.addition}
            {a.naam && <span className="font-normal"> · {a.naam}</span>}
          </Titel>
          <span className="shrink-0 text-[12.5px] text-muted-foreground">{frequentieZin(a)}</span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {a.straat}
          {a.note && ` · ${a.note}`}
        </p>
        {a.klachten.length > 0 && (
          <div className="mt-3 space-y-1 rounded-[14px] bg-tint-kastanje px-3 py-2 text-[13px] text-tint-kastanje-ink">
            {a.klachten.map((k, i) => (
              <p key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {k}
              </p>
            ))}
          </div>
        )}

        {kantoor?.melding ? (
          <div className="mt-3">{kantoor.melding}</div>
        ) : (
          <>
            {omgezet?.adres === a.id && omgezetGeldt ? (
              <div className="mt-3 flex items-center gap-2 rounded-[14px] bg-tint-amber px-3 py-2 text-[13px] text-tint-amber-ink">
                <span className="min-w-0 flex-1">Omgezet naar contant.</span>
                <button
                  type="button"
                  className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={bezig}
                  onClick={() => void omzettenTerug()}
                >
                  Ongedaan maken
                </button>
              </div>
            ) : (
              a.methode === "overmaken" && (
                <div className="mt-3 rounded-[14px] bg-tint-blauw px-3 py-2 text-[13px] text-tint-blauw-ink">
                  <p>
                    Deze klant maakt over.
                    {open
                      ? " Er staat nog iets contant open van eerder."
                      : kantoor
                        ? ""
                        : " Hier hoef je niet aan te bellen."}
                  </p>
                  {/* Betaalt hij eigenlijk contant: blijvend omzetten. */}
                  {magAfrekenen && !a.gestopt && (
                    <button
                      type="button"
                      className="mt-1.5 min-h-9 rounded-full bg-tint-blauw-ink/10 px-3.5 font-medium disabled:opacity-50"
                      disabled={bezig}
                      onClick={() => void omzettenNaarContant()}
                    >
                      Omzetten naar contant
                    </button>
                  )}
                </div>
              )
            )}

            {a.vanavond && (
              <div
                className={`mt-3 flex items-center gap-2 rounded-[14px] px-3 py-2 text-[13px] ${
                  a.vanavond.soort === "betaald" || a.vanavond.soort === "vooruit"
                    ? "bg-tint-salie text-tint-salie-ink"
                    : "bg-surface text-foreground"
                }`}
              >
                <span className="min-w-0 flex-1">
                  {a.vanavond.soort === "betaald"
                    ? `Betaald ${formatPrice(a.vanavond.bedrag)}`
                    : a.vanavond.soort === "vooruit"
                      ? `${vooruitLabel(a.vanavond.aantal)} ${formatPrice(a.vanavond.bedrag)}`
                      : a.vanavond.soort === "niet_thuis"
                        ? "Niet thuis"
                        : "Geen geld"}{" "}
                  · {a.vanavond.door_naam || "?"} om{" "}
                  {new Date(a.vanavond.op).toLocaleTimeString("nl-NL", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {vanMij && kanTikken && (
                  <button
                    type="button"

                    className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline"
                    onClick={() => herstel(a.vanavond!.id)}
                  >
                    Ongedaan maken
                  </button>
                )}
              </div>
            )}

            {a.kortingen_vanavond.length > 0 && (
              <div className="mt-3 space-y-1">
                {a.kortingen_vanavond.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center gap-2 rounded-[14px] bg-tint-paars px-3 py-2 text-[13px] text-tint-paars-ink"
                  >
                    <span className="min-w-0 flex-1">
                      Korting −{formatPrice(k.bedrag)}
                      {k.reden && ` (${k.reden})`} · {k.door_naam || "?"}
                    </span>
                    {(k.door === employee?.id || isEigenaar) && kanTikken && (
                      <button
                        type="button"

                        className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline"
                        onClick={() => herstel(k.id)}
                      >
                        Ongedaan maken
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* De rekening */}
            <div className="mt-3 rounded-[14px] bg-surface px-3.5 py-2.5">
              {regels.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  {a.open < -0.005
                    ? `Tegoed: ${formatPrice(-a.open)}. Er staat niets open.`
                    : "Er staat niets open."}
                </p>
              ) : (
                <>
                  {regels.map((r, i) => (
                    <div key={i} className="flex items-baseline gap-3 py-0.5 text-[14px]">
                      <span className="min-w-0 flex-1">
                        {r.label}{" "}
                        <span className="text-[12.5px] text-muted-foreground">{r.wanneer}</span>
                        {r.uitleg && (
                          <span className="block text-[12px] text-muted-foreground">
                            {r.uitleg}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1.5 text-[15px] font-semibold">
                    <span>Totaal</span>
                    <span className="tabular-nums">
                      {keerOpen(a.open_wassen) && (
                        <span className="mr-1.5 text-[12.5px] font-medium text-muted-foreground">
                          {keerOpen(a.open_wassen)}
                        </span>
                      )}
                      {formatPrice(a.open)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* De geldkaart van alleen deze klant: kijken, en (wie mag
                afrekenen) oude maanden aanpassen. */}
            {magBedragen && (
              <button
                type="button"
                className="mt-2 flex min-h-9 items-center gap-1.5 text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setKaartOpen(true)}
              >
                <Raster className="size-4" />
                Geldkaart van deze klant
              </button>
            )}

            {/* Vooruit: wat er nog staat. De knop om te boeken staat onderin. */}
            {vooruitOver > 0 && (
              <p className="mt-2 rounded-[14px] bg-tint-groen px-3 py-2 text-[13px] text-tint-groen-ink">
                Nog {beurtenTekst(vooruitOver)} vooruit betaald
                {metMaanden ? `, t/m ongeveer ${vooruitTotVan(a)}` : ""}.
              </p>
            )}

            {/* Wat er eerder gebeurde, met wie het intikte; wie mag afrekenen kan
            daar iets terugdraaien dat niet klopt. Een geldloper ziet het
            alleen tijdens zijn avond (daarna weigert de database het ook). Op
            kantoor wie bedragen mag zien. */}
            {(kantoor ? magBedragen : !voorbij || magBedragen) && (
              <Eerder
                key={a.id}
                adres={a.id}
                verberg={
                  vanavondHier
                    ? [
                        ...(a.vanavond ? [a.vanavond.id] : []),
                        ...a.kortingen_vanavond.map((k) => k.id),
                      ]
                    : []
                }
                onTeruggedraaid={kantoor?.onTeruggedraaid ?? onVeranderd}
                className="mt-3"
              />
            )}
          </>
        )}
      </div>

      {/* Wat je aantikt: onderin, bij je duim */}
      {kantoor?.melding ? null : kanTikken ? (
        <div className="shrink-0 pt-3">
          {kortingOpen > 0.005 &&
            !vooruitGedekt &&
            a.vaste_kortingen.length > 0 &&
            (!kantoor || kantoorGeld) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {a.vaste_kortingen.map((k) => (
                  <Chip
                    key={k.id}
                    disabled={bezig}

                    onClick={() =>
                      void tik(
                        {
                          soort: "korting",
                          bedrag: Math.min(k.bedrag, kortingOpen),
                          vaste_korting: k.id,
                          reden: k.naam,
                        },
                        `${k.naam} −${formatPrice(Math.min(k.bedrag, kortingOpen))}`,
                        false,
                      )
                    }
                  >
                    {k.naam} −{formatPrice(k.bedrag)}
                  </Chip>
                ))}
              </div>
            )}
          <div className={`mb-2 grid ${RIJ[rij]} gap-1.5`}>
            {toonKorting && (
              <DeurKnop
                kleur="amber"
                smal
                icoon={<Discount className="size-[18px]" />}
                disabled={(kortingOpen <= 0.005 && !meerDanOpen) || bezig}
                onClick={() => setVenster("korting")}
              >
                Korting
              </DeurKnop>
            )}
            <DeurKnop
              kleur="groen"
              smal
              icoon={<Coin className="size-[18px]" />}
              disabled={!open || bezig}
              onClick={() => setVenster("bedrag")}
            >
              Deel betaald
            </DeurKnop>
            {toonKlacht && (
              <DeurKnop
                kleur="kastanje"
                smal
                icoon={<AlertTriangle className="size-[18px]" />}
                onClick={() => setVenster("klacht")}
              >
                Klacht
              </DeurKnop>
            )}
            {toonDossier && (
              <DeurKnop
                kleur="amber"
                smal
                icoon={
                  dossierLaden ? (
                    <Loader2 className="size-[18px] animate-spin" />
                  ) : (
                    <Folder className="size-[18px]" />
                  )
                }
                disabled={dossierLaden}
                onClick={() => void openDossier()}
              >
                Dossier
              </DeurKnop>
            )}
          </div>
          {/* Alleen aan de deur: op kantoor sta je niet voor de deur. */}
          {open && !kantoor && (
            <div className="mb-2 grid grid-cols-3 gap-2">
              <DeurKnop
                kleur="rood"
                icoon={<DoorOff className="size-[18px]" />}
                onClick={() => void tik({ soort: "niet_thuis" }, "Niet thuis", true)}
              >
                Niet thuis
              </DeurKnop>
              <DeurKnop
                kleur="rood"
                icoon={<WalletOff className="size-[18px]" />}
                onClick={() => void tik({ soort: "geen_geld" }, "Geen geld", true)}
              >
                Geen geld
              </DeurKnop>
              <DeurKnop
                kleur="grafiet"
                icoon={<Kruis className="size-[18px]" />}
                onClick={() => void meldNietGewassen()}
              >
                Niet gewassen
              </DeurKnop>
            </div>
          )}
          {/* Vooruit opent eerst een venster om het aantal beurten te kiezen:
              een verkeerde tik boekt dus nog niets. Ook als er niets open
              staat: dan zijn het allemaal komende beurten. */}
          {a.methode === "contant" && !a.gestopt && (!kantoor || kantoorGeld) && (
            <div className={open ? "mb-2" : ""}>
              <DeurKnop
                kleur="paars"
                icoon={<CalendarDollar className="size-[18px]" />}
                disabled={!vooruitKan || bezig}
                onClick={() => setVenster("vooruit")}
              >
                Vooruit betalen
              </DeurKnop>
              {!vooruitKan && (
                <p className="pt-1 text-center text-[12px] text-muted-foreground">
                  {a.vooruit_vast > 0
                    ? kantoor
                      ? "Eerst de beurten van de vorige bewoner teruggeven (dossier, Geld)"
                      : "Eerst de beurten van de vorige bewoner teruggeven (kantoor)"
                    : kantoor
                      ? "Geen prijs bekend; vooruit betalen boekt dan de eigenaar"
                      : "Geen prijs bekend"}
                </p>
              )}
            </div>
          )}
          {open && (
            <>
              <DeurKnop
                kleur="salie"
                icoon={<Check className="size-[22px]" />}
                disabled={bezig}
                onClick={betaalAlles}
              >
                Betaald {formatPrice(a.open)}
              </DeurKnop>
              {!mobiel && (
                <p className="pt-2 text-center text-[12px] text-muted-foreground">
                  Esc sluit · Enter is Betaald
                  {onVolgende ? " · pijltjes naar het volgende adres" : ""}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="shrink-0 pt-3 text-center text-[13px] text-muted-foreground">
          De avond is voorbij; je kunt hier niets meer intikken.
        </p>
      )}
    </div>
  ) : null;

  return (
    <>
      {mobiel ? (
        <Drawer open={!!adres} onOpenChange={(o) => !o && onSluit()}>
          <DrawerContent className="max-h-[94dvh] rounded-t-[24px] border-0 bg-card">
            {inhoud}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={!!adres} onOpenChange={(o) => !o && onSluit()}>
          <DialogContent
            onKeyDown={opToets}
            className="flex max-h-[90dvh] w-[min(440px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden border-0 bg-card p-0 sm:rounded-[24px]"
          >
            {inhoud}
          </DialogContent>
        </Dialog>
      )}

      {a && (
        <>
          <KortingDialoog
            open={venster === "korting"}
            adres={kortingOpen === a.open ? a : { ...a, open: kortingOpen }}
            onSluit={() => setVenster(null)}
            onKorting={(bedrag, reden) =>
              tik({ soort: "korting", bedrag, reden }, `Korting −${formatPrice(bedrag)}`, false)
            }
            onVeranderd={onVeranderd}
            meerDanOpen={meerDanOpen}
            grens={
              kortingOpen < a.open - 0.005
                ? `Korting tot ${formatPrice(kortingOpen)}: de beurt van vandaag telt hier nog niet mee.`
                : undefined
            }
          />
          <BedragDialoog
            open={venster === "bedrag"}
            adres={a}
            onSluit={() => setVenster(null)}
            onBedrag={(bedrag) =>
              tik({ soort: "betaald", bedrag }, `Betaald ${formatPrice(bedrag)}`, true)
            }
          />
          <VooruitDialoog
            open={venster === "vooruit"}
            subtitel={`Nr ${a.house_number}${a.addition}${a.naam ? ` · ${a.naam}` : ""}`}
            delen={a.delen}
            vanaf={a.vooruit_vanaf}
            maandenVoor={
              metMaanden
                ? (aantal) => {
                    // Zoals vooruitTotVan: wacht er geen beurt meer, dan is die van
                    // deze maand al gedaan en tellen nieuwe beurten vanaf volgende maand.
                    const hier = maandVanNu();
                    const start = a.wacht_op_wasbeurt ? hier : volgendeMaand(hier);
                    return vooruitNieuweMaanden(
                      a,
                      aantal,
                      a.delen,
                      a.vooruit_vanaf,
                      vooruitOver,
                      start,
                    );
                  }
                : undefined
            }
            // Op kantoor zonder prijs vult de eigenaar hem zelf in.
            prijs={kantoor ? a.vooruit_p : (a.vooruit_p ?? 0)}
            prijsAanpassen={isEigenaar}
            onSluit={() => setVenster(null)}
            onVooruit={(aantal, prijs) => {
              const bedrag = Math.round(aantal * prijs * 100) / 100;
              return tik(
                { soort: "vooruit", aantal, prijs_per_beurt: prijs, bedrag },
                `${vooruitLabel(aantal)} ${formatPrice(bedrag)}`,
                true,
              );
            }}
          />
          <KlachtDialoog
            open={venster === "klacht"}
            adres={a}
            onSluit={() => setVenster(null)}
            onVeranderd={onVeranderd}
            {...(kantoor ? { opslaan: klachtOpKantoor } : {})}
          />
          {/* Het kleine dossier hoort bij de avond (de database controleert dat). */}
          {!kantoor && (
            <GeldloopDossier
              open={venster === "dossier"}
              adres={a}
              onSluit={() => setVenster(null)}
              onVeranderd={onVeranderd}
            />
          )}
        </>
      )}
      {a && kaartOpen && (
        <KlantKaart
          adresId={a.id}
          titel={`${kantoor?.adresTekst ?? `${a.straat} ${a.house_number}${a.addition}`}${a.naam ? ` · ${a.naam}` : ""}`}
          onSluit={() => setKaartOpen(false)}
          onVeranderd={ververs}
        />
      )}
      {volDossier && (
        <KlantgegevensDialog
          open
          onOpenChange={(o) => {
            if (o) return;
            setVolDossier(null);
            ververs();
          }}
          klant={volDossier.klant}
          voorstelCustomer={volDossier.adres}
          districts={volDossier.districts}
          streets={volDossier.streets}
          customers={volDossier.customers}
          klanten={volDossier.klanten}
          quickNotes={volDossier.quickNotes}
          onAddQuickNote={(label) => {
            void addQuickNote(label).then(() =>
              qc.invalidateQueries({ queryKey: ["quick_notes"] }),
            );
          }}
          standaardWijkId={a?.wijk_id ?? null}
          onSaved={() => {
            ververs();
            void qc.invalidateQueries({ queryKey: ["klanten"] });
            void qc.invalidateQueries({ queryKey: ["customers"] });
          }}
        />
      )}
    </>
  );
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-10 rounded-full border border-border bg-card px-3.5 text-[13.5px] font-medium shadow-card active:bg-surface disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Hoeveel knoppen er in de bovenste rij staan (op kantoor soms minder dan vier). */
const RIJ = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"] as const;
