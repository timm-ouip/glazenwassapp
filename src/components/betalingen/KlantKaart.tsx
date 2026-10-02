import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconCreditCard as Pinpas,
  IconFileInvoice as Factuur,
  IconLayoutGrid as Raster,
} from "@tabler/icons-react";

import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  dagKort,
  draaiOmzettingTerug,
  effectieveMethode,
  fetchOmzettingen,
  isOmgezet,
  kaartStandTekst,
  terugNaarOvermakenTekst,
  zetKlantkaart,
  zetMaandNaarContant,
  zetMaandTerug,
  zetNaarContant,
  type Omzetting,
  type OvermaakBeurt,
} from "@/lib/betalingen";
import {
  kaartVakjesVan,
  leesVakInvoer,
  maandVan,
  vakjeVan,
  vakKleur,
  vakTeken,
  vakUitleg,
  vakVoor,
  vooruitGepland,
  type Vak,
} from "@/lib/geldkaart";
import { fetchCustomer, fetchDistricts, fetchStreets, formatPrice, toonMaand } from "@/lib/klanten";
import { fetchKaart, soortLabel } from "@/lib/overzichten";
import { useMagAfrekenen } from "@/lib/rechten";
import { cn } from "@/lib/utils";

const MAANDEN_KORT = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** Een omzetting van het adres die langer geleden is, hoeft niet meer geel in beeld. */
const OMGEZET_ZICHTBAAR_DAGEN = 30;

function moment(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Waar een overmaak-beurt bij de facturen staat, in gewone woorden. */
function factuurTekst(f: string | null): string {
  if (!f) return "";
  if (f === "los") return "klaar om te factureren";
  if (f === "concept") return "op een conceptfactuur";
  if (f === "factuur") return "op een factuur";
  return `op factuur ${f}`;
}

/** Staat hij op een concept of een verstuurde factuur? Dan zet je hem hier niet om. */
const opFactuur = (b: OvermaakBeurt) => !!b.factuur && b.factuur !== "los";

/**
 * De geldkaart van één klant, om aan te passen: dezelfde kaart als bij het
 * invullen van de pofjes per straat, maar voor dit ene adres, en groot genoeg
 * voor de telefoon. Tik een maand aan en je ziet eronder wat er gebeurde, en
 * wat je kunt zetten.
 *
 * Erbij: de maanden waarin een beurt als overmaken is afgemeld (een
 * pinpasje). Zo'n maand zet je om naar contant: 0 = open, 1 = al betaald.
 * Een beurt op een factuur (concept of verstuurd) gaat hier nooit om; dan
 * zegt het venster wat je eerst moet doen. Een omgezette maand houdt een
 * klein pinpasje en kan terug naar overmaken.
 *
 * Aanpassen (omzetten, terugzetten, en de kaart invullen met 0, ×, een
 * letter of een 1) kan de eigenaar en wie mag afrekenen, en alleen als het
 * adres nu contant betaalt (anders staat de knop "Omzetten naar contant"
 * er). Elke wijziging komt onderaan te staan, met wie en wanneer, en is daar
 * terug te zetten. De straatkaart blijft van de eigenaar. Wie alleen
 * bedragen mag zien, kijkt mee.
 */
export function KlantKaart({
  adresId,
  titel,
  onSluit,
  onVeranderd,
}: {
  /** Open voor dit adres; leeg = dicht. */
  adresId: string | null;
  /** "Kerkstraat 12 · Jansen", in de kop. */
  titel: string;
  onSluit: () => void;
  /** Na elke wijziging, voor de lijst eromheen (het betaalvenster). */
  onVeranderd?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const magAanpassen = useMagAfrekenen();
  const [jaar, setJaar] = useState(() => new Date().getFullYear());
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [invoer, setInvoer] = useState("");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  // Bij elk nieuw adres opnieuw beginnen (tijdens het tekenen, niet in een effect).
  const [wasAdres, setWasAdres] = useState(adresId);
  if (adresId !== wasAdres) {
    setWasAdres(adresId);
    if (adresId) {
      setJaar(new Date().getFullYear());
      setGekozen(null);
      setInvoer("");
      setFout(null);
    }
  }

  const adres = useQuery({
    queryKey: ["klantkaart-adres", adresId],
    queryFn: () => fetchCustomer(adresId!),
    enabled: !!adresId,
  });
  const c = adres.data ?? undefined;
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const straat = (streets.data ?? []).find((s) => s.id === c?.street_id);
  const wijk = (districts.data ?? []).find((d) => d.id === straat?.district_id);
  // Dezelfde opvraging (en sleutel) als de straatkaart en het dossier: wat
  // daar al geladen is, staat hier meteen, en een wijziging ververst ze alle.
  const kaart = useQuery({
    queryKey: ["geld-kaart", c?.street_id, jaar],
    queryFn: () => fetchKaart(c!.street_id, jaar),
    enabled: !!c,
  });
  const omz = useQuery({
    queryKey: ["geld-omzettingen", adresId],
    queryFn: () => fetchOmzettingen(adresId!),
    enabled: !!adresId,
  });

  const data = kaart.data?.adressen.find((x) => x.id === adresId);
  const peil = wijk?.geld_peildatum ?? kaart.data?.wijk.peildatum ?? null;
  const peilMaand = peil ? peil.slice(0, 7) : null;
  const contant = !!c && effectieveMethode(c, wijk) === "contant";
  const gestopt = !!c?.inactief_op;
  const kanAanpassen = magAanpassen && contant && !!peilMaand && !!c;
  // Zolang de kaart (of wat er omgezet is) laadt of ververst, staan de knoppen
  // uit: anders bouwt een tik voort op een oude stand, en zou hij een net
  // gezet vakje (of de hele beginstand) weer overschrijven.
  const kaartBezig = !data || kaart.isFetching || omz.isFetching;
  const uit = bezig || kaartBezig;
  const gepland = c ? vooruitGepland(c, data) : [];
  const beurten = omz.data?.beurten ?? [];

  // De laatste omzetting van het adres, zolang hij geldt: geel, met Ongedaan maken.
  const adresOmzetting = (omz.data?.omzettingen ?? []).find(
    (o) => o.soort === "adres" && !o.ongedaan_op,
  );
  const toonOmzetting =
    !!adresOmzetting &&
    contant &&
    Date.now() - Date.parse(adresOmzetting.op) < OMGEZET_ZICHTBAAR_DAGEN * 86_400_000;

  function vernieuw() {
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
    void qc.invalidateQueries({ queryKey: ["geld-omzettingen", adresId] });
    void qc.invalidateQueries({ queryKey: ["geld-adres", adresId] });
    void qc.invalidateQueries({ queryKey: ["dag-geld", adresId] });
    void qc.invalidateQueries({ queryKey: ["geld-eerder", adresId] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    void qc.invalidateQueries({ queryKey: ["geld-stand"] });
    void qc.invalidateQueries({ queryKey: ["geld-afrekenen"] });
    void qc.invalidateQueries({ queryKey: ["laatste-ronde", adresId] });
    onVeranderd?.();
  }

  /** Iets in de database zetten, met een melding als het mislukt. */
  async function doe(stap: () => Promise<unknown>, melding: string): Promise<boolean> {
    setBezig(true);
    try {
      await stap();
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBezig(false);
    }
    toast.success(melding);
    vernieuw();
    return true;
  }

  async function omzetten() {
    if (!c) return;
    const ok = await doe(() => zetNaarContant(c.id), "Betaalt nu contant");
    if (!ok) return;
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["klantkaart-adres", adresId] });
  }

  async function adresTerug() {
    if (!adresOmzetting) return;
    const ja = await bevestig({
      titel: "Omzetten ongedaan maken?",
      tekst:
        "Dan maakt dit adres weer over, zoals eerst. De maanden die je daarna naar contant zette, gaan ook terug naar overmaken.",
      bevestigLabel: "Ongedaan maken",
    });
    if (!ja) return;
    setBezig(true);
    try {
      toast.success(terugNaarOvermakenTekst(await draaiOmzettingTerug(adresOmzetting.id)));
    } catch (e) {
      toast.error((e as Error).message);
      return;
    } finally {
      setBezig(false);
    }
    vernieuw();
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["klantkaart-adres", adresId] });
  }

  /**
   * Een gewoon vakje zetten of wissen (null), zoals op de straatkaart: vóór
   * en in de startmaand de beginstand, daarna een 1 (al betaald). Via de
   * database van deze ene klant: die onthoudt wie wat veranderde, en dat zet
   * je onderaan terug. Een ingetypte beginstand (een bedrag zonder maanden)
   * vervang je hier niet; dat zegt de database dan.
   */
  async function zetVak(maand: string, nieuw: { teken: string; bedrag: number } | null) {
    if (!c || uit) return;
    if (nieuw && (nieuw.teken === "0" || nieuw.teken === "1") && c.price <= 0) {
      toast.error(
        "Dit adres heeft nog geen prijs, dus Paaltje Systems weet niet wat een maand kost.",
      );
      return;
    }
    const ok = await doe(
      () => zetKlantkaart(c.id, maand, nieuw?.teken ?? null, nieuw?.bedrag ?? 0),
      nieuw ? `${toonMaand(maand)} op de kaart gezet` : `${toonMaand(maand)} gewist`,
    );
    if (ok) {
      setInvoer("");
      setFout(null);
    }
  }

  function typVak(maand: string) {
    const uit = leesVakInvoer(invoer);
    if ("fout" in uit) {
      setFout(uit.fout);
      return;
    }
    if (uit.teken === "1") {
      setFout("Een 1 (al betaald) kan alleen na de start.");
      return;
    }
    void zetVak(maand, uit);
  }

  async function maandTerug(maand: string) {
    const ja = await bevestig({
      titel: "Terug naar overmaken?",
      tekst: `De beurt van ${toonMaand(maand)} telt dan weer als overmaken, en ${toonMaand(maand)} staat weer op de kaart zoals vóór het omzetten. Wat er al betaald is, telt dan voor een andere maand of als tegoed.`,
      bevestigLabel: "Terugzetten",
    });
    if (!ja) return;
    await doe(() => zetMaandTerug(adresId!, maand), `${toonMaand(maand)} maakt weer over`);
  }

  /** Eén wijziging op de kaart terugzetten, na een vraag: met één tik verandert er geld. */
  async function kaartTerug(o: Omzetting) {
    const maand = o.ronde ?? "";
    const ja = await bevestig({
      titel: "Wijziging op de kaart ongedaan maken?",
      tekst: `${toonMaand(maand)} ${maand.slice(0, 4)} gaat terug van ${kaartStandTekst(o.kaart_na)} naar ${kaartStandTekst(o.kaart_was)}.`,
      bevestigLabel: "Ongedaan maken",
    });
    if (!ja) return;
    await doe(() => draaiOmzettingTerug(o.id), "Op de kaart teruggezet");
  }

  if (!adresId) return null;

  const maanden = MAANDEN_KORT.map((_, i) => `${jaar}-${String(i + 1).padStart(2, "0")}`);
  const pijl =
    "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  /** De overmaak-beurten van een maand: nog overmaken, en omgezet. */
  function overmaakVan(maand: string) {
    const hier = beurten.filter((b) => b.ronde === maand);
    return {
      nog: hier.filter((b) => b.betaalmethode === "overmaken" && !isOmgezet(b)),
      omgezet: hier.filter(isOmgezet),
    };
  }

  // De gekozen maand, met wat er staat en wat je kunt zetten.
  const keuze = gekozen
    ? (() => {
        const maand = gekozen;
        const vak = c ? vakVoor(c, data, maand, peilMaand, undefined, gepland) : null;
        const vakje = kaartVakjesVan(data, peilMaand).find((v) => v.maand === maand);
        const ov = overmaakVan(maand);
        const voorStart = !!peilMaand && maand <= peilMaand;
        const alBetaald = vak?.soort === "betaald" || (vak?.soort === "vooruit" && !vak.kaart);
        return { maand, vak, vakje, ov, voorStart, alBetaald };
      })()
    : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onSluit()}>
      <PopupKader className="sm:max-w-xl">
        <PopupKop
          kleur="groen"
          icoon={<Raster className="size-[22px]" />}
          titel="Geldkaart"
          subtitel={titel}
        />
        <PopupBody className="gap-3">
          {toonOmzetting && adresOmzetting && (
            <div className="flex items-start gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
              <span className="min-w-0 flex-1">
                Omgezet naar contant door {adresOmzetting.door_naam || "?"} ·{" "}
                {moment(adresOmzetting.op)}
              </span>
              {magAanpassen && (
                <button
                  type="button"
                  className="min-h-9 shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={bezig}
                  onClick={() => void adresTerug()}
                >
                  Ongedaan maken
                </button>
              )}
            </div>
          )}

          {c && !contant && (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-tint-blauw px-3.5 py-2.5 text-[13px] text-tint-blauw-ink">
              <span className="min-w-0 flex-1">
                Deze klant maakt over.
                {magAanpassen && !gestopt
                  ? " Betaalt hij eigenlijk contant? Zet hem dan om; daarna kun je hier de maanden aanpassen."
                  : ""}
              </span>
              {magAanpassen && !gestopt && (
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={bezig}
                  onClick={() => void omzetten()}
                >
                  Omzetten naar contant
                </Button>
              )}
            </div>
          )}

          {c && contant && !peilMaand && (
            <p className="text-[13px] text-muted-foreground">
              Deze wijk doet nog niet mee met Betalingen: er is nog geen kaart.
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-[15px] font-semibold">{jaar}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={pijl}
                aria-label="Vorig jaar"
                onClick={() => {
                  setJaar((j) => j - 1);
                  setGekozen(null);
                }}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className={pijl}
                aria-label="Volgend jaar"
                onClick={() => {
                  setJaar((j) => j + 1);
                  setGekozen(null);
                }}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          {kaart.isError || adres.isError || omz.isError ? (
            <p className="text-[13px] text-tint-rood-ink">
              De kaart kon niet opgehaald worden. Vraag de eigenaar of je bedragen mag zien.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 text-center sm:grid-cols-6">
              {maanden.map((maand, i) => {
                const laden = !c || kaart.isLoading || omz.isLoading;
                const vak: Vak = c
                  ? vakVoor(c, data, maand, peilMaand, undefined, gepland)
                  : { soort: "leeg" };
                const ov = overmaakVan(maand);
                // Een beurt die als overmaken is afgemeld en verder niets: groot
                // het pinpasje (of de factuur, als hij daar al op staat).
                const groot =
                  ov.nog.length > 0 && (vak.soort === "leeg" || vak.soort === "niet_aan_de_beurt");
                const gefactureerd = ov.nog.some(opFactuur);
                const klein = !groot && (ov.nog.length > 0 || ov.omgezet.length > 0);
                const uitleg = [
                  `${toonMaand(maand)} ${jaar}`,
                  groot
                    ? gefactureerd
                      ? "als overmaken afgemeld, staat op een factuur"
                      : "als overmaken afgemeld"
                    : vakUitleg(vak),
                  ov.omgezet.length > 0 ? "omgezet van overmaken" : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={maand}
                    type="button"
                    aria-pressed={gekozen === maand}
                    aria-label={uitleg}
                    title={uitleg}
                    onClick={() => {
                      setGekozen(gekozen === maand ? null : maand);
                      setInvoer("");
                      setFout(null);
                    }}
                    className="flex flex-col gap-1 rounded-[12px] p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-foreground/70"
                  >
                    <span
                      className={cn(
                        "text-[12px]",
                        gekozen === maand
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {MAANDEN_KORT[i]}
                    </span>
                    {laden ? (
                      <span className="h-12 animate-pulse rounded-[10px] bg-muted" />
                    ) : (
                      <span
                        className={cn(
                          "relative flex h-12 items-center justify-center rounded-[10px] border-2 border-transparent text-[17px] tabular-nums",
                          groot ? "bg-tint-blauw text-tint-blauw-ink" : vakKleur(vak, false),
                          gekozen === maand && "ring-2 ring-foreground/60",
                        )}
                      >
                        {groot ? (
                          gefactureerd ? (
                            <Factuur className="size-5" aria-hidden="true" />
                          ) : (
                            <Pinpas className="size-5" aria-hidden="true" />
                          )
                        ) : (
                          vakTeken(vak)
                        )}
                        {klein && (
                          <Pinpas
                            aria-hidden="true"
                            className={cn(
                              "absolute right-1 top-1 size-3",
                              ov.nog.length > 0 ? "text-tint-blauw-ink" : "opacity-50",
                            )}
                          />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {keuze && c && (
            <section className="flex flex-col gap-2.5 rounded-[16px] bg-surface px-3.5 py-3">
              <h3 className="font-display text-[15px] font-semibold">
                {toonMaand(keuze.maand)} {keuze.maand.slice(0, 4)}
              </h3>
              <div className="space-y-1 text-[13px]">
                {keuze.vakje && (
                  <p>
                    Op de kaart: {keuze.vakje.teken === "x" ? "×" : keuze.vakje.teken}
                    {keuze.vakje.teken === "1"
                      ? " · al betaald, van de kaart"
                      : keuze.vakje.teken === "x"
                        ? " · niet gewassen"
                        : ` · ${formatPrice(keuze.vakje.bedrag)} open`}
                  </p>
                )}
                {(data?.posten ?? [])
                  .filter((p) => vakjeVan(p) === keuze.maand && p.soort !== "beginstand")
                  .map((p, i) => (
                    <p key={`p${i}`}>
                      {p.soort === "klus" ? `Klus: ${p.omschrijving}` : "Gewassen"} op{" "}
                      {dagKort(p.datum)} · {formatPrice(p.bedrag)}
                      {p.gedekt >= p.bedrag - 0.005
                        ? ` · ${p.betaald_soort === "vooruit" ? "vooruit betaald" : "betaald"}${p.betaald_door ? ` bij ${p.betaald_door}` : ""}`
                        : ` · nog ${formatPrice(p.bedrag - p.gedekt)} open`}
                    </p>
                  ))}
                {keuze.ov.nog.map((b) => (
                  <p key={b.regel_id} className="text-tint-blauw-ink">
                    Gewassen op {dagKort(b.datum)} · {formatPrice(b.prijs)} · als overmaken afgemeld
                    {b.factuur ? ` · ${factuurTekst(b.factuur)}` : ""}
                  </p>
                ))}
                {keuze.ov.omgezet.map((b) => (
                  <p key={b.regel_id}>
                    Beurt van {dagKort(b.datum)} omgezet van overmaken naar contant door{" "}
                    {b.omzetting?.door_naam || "?"}
                    {b.omzetting ? ` · ${moment(b.omzetting.op)}` : ""}
                  </p>
                ))}
                {(data?.gebeurtenissen ?? [])
                  .filter((g) => maandVan(g.op) === keuze.maand)
                  .map((g) => (
                    <p key={g.id} className={g.ongedaan ? "line-through opacity-60" : ""}>
                      {soortLabel(g.soort)}
                      {g.bedrag > 0 && ` ${formatPrice(g.bedrag)}`}
                      {g.reden && ` (${g.reden})`} · {g.door_naam} · {moment(g.op)}
                    </p>
                  ))}
                {!keuze.vakje &&
                  keuze.ov.nog.length === 0 &&
                  keuze.ov.omgezet.length === 0 &&
                  (data?.posten ?? []).every(
                    (p) => vakjeVan(p) !== keuze.maand || p.soort === "beginstand",
                  ) &&
                  (data?.gebeurtenissen ?? []).every((g) => maandVan(g.op) !== keuze.maand) && (
                    <p className="text-muted-foreground">Niets gebeurd in deze maand.</p>
                  )}
              </div>

              {kanAanpassen &&
                (keuze.ov.nog.length > 0 ? (
                  keuze.ov.nog.some(opFactuur) ? (
                    <p className="rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
                      {keuze.ov.nog.some((b) => b.factuur === "concept")
                        ? "Deze beurt staat op een conceptfactuur. Gooi dat concept eerst weg bij Facturen; daarna kun je hem hier omzetten."
                        : "Deze beurt staat op een factuur. Een gefactureerde beurt zet je niet om naar contant: crediteer eerst de factuur."}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <KeuzeKnop
                          teken="0"
                          uitleg="contant, nog open"
                          disabled={uit}
                          onKies={() =>
                            void doe(
                              () => zetMaandNaarContant(c.id, keuze.maand, "0"),
                              `${toonMaand(keuze.maand)} staat contant open`,
                            )
                          }
                        />
                        <KeuzeKnop
                          teken="1"
                          uitleg="contant, al betaald"
                          disabled={uit}
                          onKies={() =>
                            void doe(
                              () => zetMaandNaarContant(c.id, keuze.maand, "1"),
                              `${toonMaand(keuze.maand)} contant, al betaald`,
                            )
                          }
                        />
                      </div>
                      <p className="text-[11.5px] text-muted-foreground">
                        Deze beurt is als overmaken afgemeld.{" "}
                        {keuze.ov.nog.some((b) => b.factuur === "los")
                          ? "Zet je hem om, dan gaat hij ook van de facturen af."
                          : "Zet je hem om, dan telt hij als contant."}
                      </p>
                    </>
                  )
                ) : (
                  <>
                    {keuze.ov.omgezet.length > 0 && (
                      <KeuzeKnop
                        teken={<Pinpas className="size-[18px]" aria-hidden="true" />}
                        uitleg="terug naar overmaken"
                        disabled={uit}
                        onKies={() => void maandTerug(keuze.maand)}
                      />
                    )}
                    {keuze.voorStart ? (
                      <>
                        <div className="grid grid-cols-2 gap-1.5">
                          <KeuzeKnop
                            teken="0"
                            uitleg="hele beurt open"
                            aan={keuze.vakje?.teken === "0" && !keuze.vakje.ingetypt}
                            disabled={uit}
                            onKies={() => void zetVak(keuze.maand, { teken: "0", bedrag: 0 })}
                          />
                          <KeuzeKnop
                            teken="×"
                            uitleg="niet gewassen"
                            aan={keuze.vakje?.teken === "x"}
                            disabled={uit}
                            onKies={() => void zetVak(keuze.maand, { teken: "x", bedrag: 0 })}
                          />
                        </div>
                        <form
                          className="flex gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            typVak(keuze.maand);
                          }}
                        >
                          <Input
                            className="h-10 min-w-0 flex-1 rounded-full"
                            placeholder="v 8 of +5"
                            aria-label="Letter met bedrag, of + met bedrag"
                            autoCapitalize="off"
                            autoComplete="off"
                            value={invoer}
                            onChange={(e) => {
                              setInvoer(e.target.value);
                              setFout(null);
                            }}
                          />
                          <Button type="submit" className="h-10 rounded-full" disabled={uit}>
                            Zet
                          </Button>
                        </form>
                        {fout ? (
                          <p className="text-[12px] text-tint-rood-ink">{fout}</p>
                        ) : (
                          <p className="text-[11.5px] text-muted-foreground">
                            Vóór de start van de wijk: zoals het op de papieren kaart stond. Geen
                            vakje = betaald.
                          </p>
                        )}
                      </>
                    ) : (
                      !gestopt &&
                      (!keuze.alBetaald || keuze.vakje?.teken === "1") && (
                        <KeuzeKnop
                          teken="1"
                          uitleg="al betaald"
                          aan={keuze.vakje?.teken === "1"}
                          disabled={uit || keuze.vakje?.teken === "1"}
                          onKies={() => void zetVak(keuze.maand, { teken: "1", bedrag: 0 })}
                        />
                      )
                    )}
                    {keuze.vakje && !keuze.vakje.ingetypt && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 self-start rounded-full"
                        disabled={uit}
                        onClick={() => void zetVak(keuze.maand, null)}
                      >
                        Wissen
                      </Button>
                    )}
                  </>
                ))}
            </section>
          )}

          {/* Wie het adres omzette en wie wat op de kaart zette, nieuw naar
              oud; een kaartwijziging zet je hier terug. */}
          {(omz.data?.omzettingen ?? [])
            .filter((o) => o.soort === "adres" || o.soort === "kaart")
            .map((o) => (
              <div key={o.id} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                <p className="min-w-0 flex-1">
                  <span className={o.ongedaan_op ? "line-through" : ""}>
                    {o.soort === "adres"
                      ? "Omgezet van overmaken naar contant"
                      : `${toonMaand(o.ronde ?? "")} ${(o.ronde ?? "").slice(0, 4)} op de kaart: ${kaartStandTekst(o.kaart_was)} → ${kaartStandTekst(o.kaart_na)}`}{" "}
                    door {o.door_naam || "?"} · {moment(o.op)}
                  </span>
                  {o.ongedaan_op &&
                    ` · teruggedraaid door ${o.ongedaan_naam || "?"} · ${moment(o.ongedaan_op)}`}
                </p>
                {o.soort === "kaart" && !o.ongedaan_op && kanAanpassen && (
                  <button
                    type="button"
                    className="min-h-8 shrink-0 font-medium underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                    disabled={uit}
                    onClick={() => void kaartTerug(o)}
                  >
                    Ongedaan
                  </button>
                )}
              </div>
            ))}

          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            1 = betaald · 0 = niet betaald · letter of + = een deel open (van de kaart) · B =
            vooruit betaald (lichte 1: van de papieren kaart) · × = overgeslagen · % = niet aan de
            beurt · pinpasje = als overmaken afgemeld · klein pinpasje = omgezet van overmaken ·
            factuur = staat op een factuur
          </p>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Sluiten
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

/** Eén keuze voor een maand: het teken groot, de uitleg klein. */
function KeuzeKnop({
  teken,
  uitleg,
  aan = false,
  disabled,
  onKies,
}: {
  teken: ReactNode;
  uitleg: string;
  aan?: boolean;
  disabled?: boolean;
  onKies: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={aan}
      disabled={disabled}
      onClick={onKies}
      className={cn(
        "flex min-h-12 w-full items-center gap-2 rounded-[12px] border px-3 text-left transition-colors disabled:opacity-50",
        aan
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-surface",
      )}
    >
      <span className="flex min-w-5 justify-center font-display text-[18px] font-semibold tabular-nums">
        {teken}
      </span>
      <span className="text-[13px]">{uitleg}</span>
    </button>
  );
}
