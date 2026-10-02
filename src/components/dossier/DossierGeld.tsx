/**
 * Het tabblad Geld van het klantdossier: vier tegels (wat er open staat, het
 * tegoed, de vooruitbetaalde beurten en hoe hij betaalt), de geldkaart van dit
 * ene adres, en elke betaling en korting met wie het intikte.
 *
 * Boeken kan de eigenaar, en wie mag afrekenen: betaald, een ander bedrag,
 * korting en vooruit betalen. Teruggeven, een andere prijs per beurt en
 * ongedaan maken blijven bij de eigenaar. Dat gaat met dezelfde vensters als
 * aan de deur; niets wordt gewist, ongedaan maken is een nieuwe regel.
 *
 * Daarbij de vooruitbetaling: wat er terug moet als de klant stopt, en de
 * geplande wissel naar overmaken (geel, want die gebeurt vanzelf — en dus met
 * Ongedaan maken ernaast).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconDiscount as Discount,
} from "@tabler/icons-react";

import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useBevestig } from "@/components/Bevestig";
import {
  BedragDialoog,
  KortingDialoog,
  VooruitDialoog,
  type DeurAdres,
} from "@/components/betalingen/DeurDialogen";
import { KlantKaart } from "@/components/betalingen/KlantKaart";
import { DossierKop, kopKnop, kopKnopPrimair } from "@/components/dossier/DossierKop";
import {
  KolomKop,
  VeldLabel,
  dossierInvoer,
  dossierLink,
} from "@/components/dossier/DossierVelden";
import {
  betaalmethodeLabel,
  beurtenTekst,
  draaiBetaalwisselTerug,
  draaiOmzettingTerug,
  fetchLaatsteRonde,
  fetchOmzettingen,
  maandKort,
  rekening,
  terugNaarOvermakenTekst,
  terugTekst,
  vooruitStart,
  vooruitTot,
  type GeldDeel,
  type Omzetting,
} from "@/lib/betalingen";
import { bronTekst, opsomming, regelDatum, volgendeBeurtMaand } from "@/lib/dossier";
import { vakKleur, vakTeken, vakUitleg, vakVoor, vooruitGepland, type Vak } from "@/lib/geldkaart";
import { boek, haalVasteKortingWeg, maakVasteKorting, nieuweTik, type Tik } from "@/lib/geldlopen";
import { formatPrice, toonMaand, type Customer } from "@/lib/klanten";
import {
  fetchGeldAdres,
  fetchKaart,
  soortLabel,
  vooruitOngedaanTekst,
  type GeldAdres,
  type Gebeurtenis,
} from "@/lib/overzichten";
import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

/** Een wissel die langer dan zoveel dagen geleden doorging, hoeft niet meer in beeld. */
const WISSEL_ZICHTBAAR_DAGEN = 30;

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

/** "€ 0" bij niets, anders het bedrag zoals overal in de app. */
const bedragOfNul = (n: number) => (n > 0.005 ? formatPrice(n) : "€ 0");

function moment(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Waar het open bedrag voor staat, kort: "aug en sep", of "sep · 1 klus". */
function openKort(delen: GeldDeel[]): string {
  const maanden = new Set<string>();
  let klussen = 0;
  for (const x of delen) {
    if (x.soort === "klus") klussen += 1;
    else if (x.soort === "wassen") maanden.add(x.datum.slice(0, 7));
    // De beginstand zegt in zijn omschrijving voor welke maanden hij staat.
    else for (const m of x.omschrijving.split(",")) if (/^\d{4}-\d{2}$/.test(m)) maanden.add(m);
  }
  const wanneer = opsomming([...maanden].sort().map((m) => maandKort(m)));
  const klus = klussen > 0 ? `${klussen} ${klussen === 1 ? "klus" : "klussen"}` : "";
  return [wanneer, klus].filter(Boolean).join(" · ");
}

/** Wat er in de kolom "Wat" staat. */
function watTekst(e: Gebeurtenis): string {
  const reden = e.reden ? ` · ${e.reden}` : "";
  switch (e.soort) {
    case "betaald":
      return `Betaald ${bronTekst(e.bron)}${reden}`;
    case "vooruit": {
      // Een 1 op de geldkaart: al betaald van vóór de app, niet opgehaald.
      const kaart = e.bron === "kaart" ? " · van de papieren kaart" : "";
      return e.aantal && e.prijs_per_beurt
        ? `${soortLabel(e.soort)} · ${e.aantal} × ${formatPrice(e.prijs_per_beurt)}${kaart}`
        : `${soortLabel(e.soort)}${kaart}`;
    }
    case "omgerekend": {
      if (!e.prijs_per_beurt) return soortLabel(e.soort);
      const tegoed = Math.round((e.bedrag - (e.aantal ?? 0) * e.prijs_per_beurt) * 100) / 100;
      return `${soortLabel(e.soort)} · ${e.omgerekend_van ?? 0} → ${beurtenTekst(e.aantal ?? 0)} à ${formatPrice(e.prijs_per_beurt)}${tegoed > 0.005 ? ` (+ ${formatPrice(tegoed)} tegoed)` : ""}`;
    }
    default:
      return `${soortLabel(e.soort)}${reden}`;
  }
}

/** Wat er in de kolom "Bedrag" staat; leeg als er geen geld bij hoort. */
function bedragTekst(e: Gebeurtenis): string {
  if (e.bedrag <= 0 || e.soort === "omgerekend") return "";
  // Korting en teruggegeven geld zijn geen ontvangen geld: met een min.
  return e.soort === "korting" || e.soort === "terugbetaald"
    ? `− ${formatPrice(e.bedrag)}`
    : formatPrice(e.bedrag);
}

// ---------------------------------------------------------------------------
// Het tabblad
// ---------------------------------------------------------------------------

type Venster = "korting" | "vast" | "bedrag" | "vooruit" | null;

export function DossierGeldTab({ d }: { d: Dossier }) {
  const a = d.adres;
  const qc = useQueryClient();
  const geld = useQuery({
    queryKey: ["geld-adres", a?.id],
    queryFn: () => fetchGeldAdres(a!.id),
    enabled: !!a && d.prijzenZien,
  });
  const g = geld.data;
  const [venster, setVenster] = useState<Venster>(null);
  const [bezig, setBezig] = useState(false);
  // De geldkaart van dit adres, om (wie mag afrekenen) oude maanden aan te passen.
  const [kaartOpen, setKaartOpen] = useState(false);
  // Omgezet naar contant (bijvoorbeeld aan de deur): geel bovenaan, met Ongedaan maken.
  const omz = useQuery({
    queryKey: ["geld-omzettingen", a?.id],
    queryFn: () => fetchOmzettingen(a!.id),
    enabled: !!a && d.prijzenZien,
  });
  const omzetting = (omz.data?.omzettingen ?? []).find(
    (o) => o.soort === "adres" && !o.ongedaan_op,
  );

  const gestopt = !!a?.inactief_op;
  const open = g?.open ?? 0;
  // Zonder gewone prijs vult alleen de eigenaar zelf een prijs per beurt in.
  const zonderPrijs = !d.isEigenaar && g?.vooruit_p == null;
  const vooruitKan = !gestopt && (g?.vooruit_vast ?? 0) === 0 && !zonderPrijs;

  function vernieuw() {
    if (!a) return;
    void qc.invalidateQueries({ queryKey: ["geld-adres", a.id] });
    void qc.invalidateQueries({ queryKey: ["laatste-ronde", a.id] });
    void qc.invalidateQueries({ queryKey: ["dag-geld", a.id] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
    // Een boeking kan de geplande wissel naar overmaken laten doorgaan (of
    // terugdraaien): dan verandert de betaalwijze van het adres zelf.
    void qc.invalidateQueries({ queryKey: ["customers"] });
  }

  /** Eén boeking op kantoor; de regel komt in de tabel, met Ongedaan erbij. */
  async function tik(
    t: Omit<Tik, "id" | "op" | "adres" | "bron" | "getoond_open">,
    melding: string,
  ): Promise<boolean> {
    if (!a) return false;
    setBezig(true);
    try {
      await boek(nieuweTik({ ...t, adres: a.id, bron: "kantoor", getoond_open: g?.open ?? null }));
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

  const acties =
    d.magAfrekenen && a && g ? (
      <>
        {/* Op kantoor ook als er niets openstaat: dan wordt de korting tegoed. */}
        <button
          type="button"
          className={kopKnop}
          disabled={bezig}
          title="Korting of kwijtschelden"
          onClick={() => setVenster("korting")}
        >
          Korting…
        </button>
        <button
          type="button"
          className={kopKnop}
          disabled={bezig}
          title="Een korting die voortaan klaarstaat bij dit adres, zoals horren"
          onClick={() => setVenster("vast")}
        >
          Vaste korting…
        </button>
        <button
          type="button"
          className={kopKnop}
          disabled={!vooruitKan || bezig}
          title={
            gestopt
              ? "Dit adres is gestopt"
              : zonderPrijs
                ? "Dit adres heeft geen prijs; vooruit betalen boekt de eigenaar"
                : !vooruitKan
                  ? "Geef eerst de vooruitbetaalde beurten van de vorige bewoner terug"
                  : undefined
          }
          onClick={() => setVenster("vooruit")}
        >
          Vooruit betalen…
        </button>
        {open > 0.005 && (
          <button
            type="button"
            className={kopKnopPrimair}
            disabled={bezig}
            onClick={() =>
              void tik({ soort: "betaald", bedrag: open }, `Betaald ${formatPrice(open)}`)
            }
          >
            Betaald {formatPrice(open)}
          </button>
        )}
      </>
    ) : undefined;

  const deurAdres: DeurAdres | null =
    a && g
      ? {
          id: a.id,
          open: g.open,
          delen: g.delen,
          house_number: a.house_number,
          addition: a.addition ?? "",
          vaste_kortingen: g.vaste_kortingen,
        }
      : null;

  return (
    <>
      <DossierKop d={d} titel="Geld" acties={acties} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className={cn("flex flex-col gap-[18px]", d.mobiel ? "px-4 py-4" : "px-[26px] py-[22px]")}
        >
          {!a ? (
            <p className="text-[14px] text-muted-foreground">
              Het geld staat hier zodra het adres is toegevoegd.
            </p>
          ) : !d.prijzenZien ? (
            <>
              <Tegels d={d} adres={a} g={null} />
              <p className="text-[14px] text-muted-foreground">
                Bedragen, de geldkaart en de betalingen zie je alleen met het recht om prijzen te
                zien.
              </p>
            </>
          ) : geld.isLoading ? (
            <p className="text-[14px] text-muted-foreground">Laden…</p>
          ) : geld.isError || !g ? (
            <p className="text-[14px] text-tint-rood-ink">
              {geld.error instanceof Error
                ? geld.error.message
                : "Het geld van dit adres kwam niet binnen."}
            </p>
          ) : (
            <>
              <Stroken
                d={d}
                adres={a}
                g={g}
                bezig={bezig}
                tik={tik}
                omzetting={d.methode === "contant" ? omzetting : undefined}
              />
              <Tegels
                d={d}
                adres={a}
                g={g}
                onAnderBedrag={d.magAfrekenen ? () => setVenster("bedrag") : undefined}
              />
              <WatErOpenstaat g={g} />
              <Kaart d={d} adres={a} onOpenen={() => setKaartOpen(true)} />
              <Betalingen d={d} adres={a} g={g} vernieuw={vernieuw} />
              <VasteKortingen d={d} g={g} vernieuw={vernieuw} />
            </>
          )}
        </div>
      </div>

      {a && kaartOpen && (
        <KlantKaart
          adresId={a.id}
          titel={d.adresTekst(a)}
          onSluit={() => setKaartOpen(false)}
          onVeranderd={() => {
            vernieuw();
            void qc.invalidateQueries({ queryKey: ["geld-omzettingen", a.id] });
          }}
        />
      )}

      {d.magAfrekenen && deurAdres && g && (
        <>
          <KortingDialoog
            open={venster === "korting"}
            adres={deurAdres}
            onSluit={() => setVenster(null)}
            onKorting={(bedrag, reden) =>
              tik({ soort: "korting", bedrag, reden }, `Korting −${formatPrice(bedrag)}`)
            }
            onVeranderd={vernieuw}
            // Korting die tegoed wordt, geeft alleen de eigenaar.
            meerDanOpen={d.isEigenaar}
          />
          <VasteKortingDialoog
            open={venster === "vast"}
            adresId={deurAdres.id}
            bestaand={g.vaste_kortingen.map((k) => k.naam)}
            onSluit={() => setVenster(null)}
            onVeranderd={vernieuw}
          />
          <BedragDialoog
            open={venster === "bedrag"}
            adres={deurAdres}
            onSluit={() => setVenster(null)}
            onBedrag={(bedrag) =>
              tik({ soort: "betaald", bedrag }, `Betaald ${formatPrice(bedrag)}`)
            }
          />
          {/* Zonder gewone prijs vult de eigenaar de prijs per beurt zelf in. */}
          <VooruitDialoog
            open={venster === "vooruit"}
            subtitel={
              g.open > 0.005 ? `Op kantoor · nog open ${formatPrice(g.open)}` : "Op kantoor"
            }
            delen={g.delen}
            vanaf={g.vooruit_vanaf}
            prijs={g.vooruit_p}
            prijsAanpassen={d.isEigenaar}
            onSluit={() => setVenster(null)}
            onVooruit={(aantal, prijs) =>
              tik(
                {
                  soort: "vooruit",
                  aantal,
                  prijs_per_beurt: prijs,
                  bedrag: Math.round(aantal * prijs * 100) / 100,
                },
                `${beurtenTekst(aantal)} vooruit betaald`,
              )
            }
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bovenaan: de wissel naar overmaken, en wat er terug moet
// ---------------------------------------------------------------------------

function Stroken({
  d,
  adres,
  g,
  bezig,
  tik,
  omzetting,
}: {
  d: Dossier;
  adres: Customer;
  g: GeldAdres;
  bezig: boolean;
  tik: (
    t: Omit<Tik, "id" | "op" | "adres" | "bron" | "getoond_open">,
    melding: string,
  ) => Promise<boolean>;
  /** Omgezet naar contant, en dat geldt nog. */
  omzetting?: Omzetting | undefined;
}) {
  const bevestig = useBevestig();
  const qc = useQueryClient();
  const [wisselBezig, setWisselBezig] = useState(false);
  const gestopt = !!adres.inactief_op;
  const bruikbaar = g.vooruit_over - g.vooruit_vast;
  // Terug te geven: beurten die niet meer gebruikt worden, of bij een
  // gestopt adres wat er aan tegoed over is.
  const terugTonen = g.vooruit_vast > 0 || (gestopt && g.terug > 0.005);
  const wissel = g.wissel;
  const wisselTonen =
    !!wissel &&
    !gestopt &&
    (wissel.status === "gepland" ||
      (!!wissel.uitgevoerd_op &&
        Date.now() - Date.parse(wissel.uitgevoerd_op) < WISSEL_ZICHTBAAR_DAGEN * 86_400_000));

  async function wisselTerug() {
    setWisselBezig(true);
    try {
      await draaiBetaalwisselTerug(adres.id);
      toast.success("De wissel naar overmaken is teruggedraaid");
      void qc.invalidateQueries({ queryKey: ["geld-adres", adres.id] });
      void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWisselBezig(false);
    }
  }

  const omzettingTonen =
    !!omzetting && Date.now() - Date.parse(omzetting.op) < WISSEL_ZICHTBAAR_DAGEN * 86_400_000;

  async function omzettingTerug() {
    if (!omzetting) return;
    const ja = await bevestig({
      titel: "Omzetten ongedaan maken?",
      tekst:
        "Dan maakt dit adres weer over, zoals eerst. De maanden die daarna naar contant zijn gezet, gaan ook terug naar overmaken.",
      bevestigLabel: "Ongedaan maken",
    });
    if (!ja) return;
    setWisselBezig(true);
    try {
      toast.success(terugNaarOvermakenTekst(await draaiOmzettingTerug(omzetting.id)));
      void qc.invalidateQueries({ queryKey: ["geld-omzettingen", adres.id] });
      void qc.invalidateQueries({ queryKey: ["geld-adres", adres.id] });
      void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
      void qc.invalidateQueries({ queryKey: ["geld-pof"] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWisselBezig(false);
    }
  }

  if (!wisselTonen && !terugTonen && !omzettingTonen) return null;
  return (
    <div className="flex flex-col gap-2">
      {omzettingTonen && omzetting && (
        <div className="flex items-start gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {`Op ${new Date(omzetting.op).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "short",
            })} omgezet van overmaken naar contant door ${omzetting.door_naam || "?"}.`}
          </span>
          {d.magAfrekenen && (
            <button
              type="button"
              className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50"
              disabled={wisselBezig}
              onClick={() => void omzettingTerug()}
            >
              Ongedaan maken
            </button>
          )}
        </div>
      )}
      {wisselTonen && wissel && (
        <div className="flex items-start gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {wissel.status === "gepland"
              ? `Gaat overmaken zodra de vooruitbetaling op is (nog ${beurtenTekst(bruikbaar)}).`
              : `Op ${new Date(wissel.uitgevoerd_op!).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "short",
                })} overgezet naar overmaken: vooruitbetaling op.`}
          </span>
          {d.magBewerken && (
            <button
              type="button"
              className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50"
              disabled={wisselBezig}
              onClick={() => void wisselTerug()}
            >
              Ongedaan maken
            </button>
          )}
        </div>
      )}
      {terugTonen && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            Terug te geven:{" "}
            {terugTekst({
              vorige: g.vooruit_vorige,
              vorigeWaarde: g.vooruit_vorige_waarde,
              eigen: g.vooruit_eigen,
              eigenWaarde: g.vooruit_eigen_waarde,
              open: g.open,
              gestopt,
            })}
          </span>
          {d.isEigenaar && (
            <Button
              size="sm"
              className="rounded-full"
              disabled={bezig}
              onClick={() =>
                void tik(
                  { soort: "terugbetaald", bedrag: g.terug },
                  `Teruggegeven: ${formatPrice(g.terug)}`,
                )
              }
            >
              Teruggegeven
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// De vier tegels
// ---------------------------------------------------------------------------

function Tegels({
  d,
  adres,
  g,
  onAnderBedrag,
}: {
  d: Dossier;
  adres: Customer;
  /** Leeg zonder het recht om bedragen te zien: dan alleen hoe hij betaalt. */
  g: GeldAdres | null;
  onAnderBedrag?: (() => void) | undefined;
}) {
  const bruikbaar = g ? Math.max(0, g.vooruit_over - g.vooruit_vast) : 0;
  // Alleen nodig om te zeggen tot welke maand de beurten ongeveer reiken.
  const laatsteRonde = useQuery({
    queryKey: ["laatste-ronde", adres.id],
    queryFn: () => fetchLaatsteRonde(adres.id),
    enabled: bruikbaar > 0,
  });
  const open = g?.open ?? 0;
  const waarde = cn(
    "font-display font-semibold leading-tight tabular-nums",
    d.mobiel ? "text-[24px]" : "text-[30px]",
  );
  const tegel = "flex min-w-0 flex-col rounded-[18px] px-[18px] py-4";
  const label = "text-[13px] text-muted-foreground";
  const onder = "text-[12px] text-muted-foreground";

  return (
    <div className={cn("grid gap-[14px]", d.mobiel ? "grid-cols-2" : "grid-cols-4")}>
      {g && (
        <>
          <div className={cn(tegel, open > 0.005 ? "bg-tint-geel" : "bg-card")}>
            <div className={open > 0.005 ? "text-[13px]" : label}>Staat open</div>
            <div className={waarde}>{bedragOfNul(open)}</div>
            <div className={open > 0.005 ? "text-[12px]" : onder}>
              {open > 0.005 ? openKort(g.delen) : "alles betaald"}
            </div>
            {onAnderBedrag && (
              <button
                type="button"
                className="mt-1 self-start text-[12px] underline underline-offset-2 hover:no-underline"
                onClick={onAnderBedrag}
              >
                {open > 0.005 ? "Ander bedrag…" : "Betaling boeken…"}
              </button>
            )}
          </div>
          <div className={cn(tegel, "bg-card")}>
            <div className={label}>Tegoed</div>
            <div className={waarde}>{bedragOfNul(-open)}</div>
            <div className={onder}>
              {open < -0.005 ? "gaat af van de volgende beurten" : "niets te goed"}
            </div>
          </div>
          <div className={cn(tegel, "bg-card")}>
            <div className={label}>Vooruit betaald</div>
            <div className={waarde}>{beurtenTekst(bruikbaar)}</div>
            <div className={onder}>
              {bruikbaar > 0
                ? `betaald t/m ${vooruitTot(adres, bruikbaar, vooruitStart(laatsteRonde.data))}`
                : "—"}
            </div>
          </div>
        </>
      )}
      <div className={cn(tegel, "bg-card")}>
        <div className={label}>Betalen</div>
        <div className={waarde}>{betaalmethodeLabel(d.methode)}</div>
        <div className={onder}>{adres.betaalmethode ? "eigen keuze" : "zoals de wijk"}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wat er openstaat, per regel
// ---------------------------------------------------------------------------

/** De open posten als rekening: per regel wat, wanneer en waarom, en het totaal. */
function WatErOpenstaat({ g }: { g: GeldAdres }) {
  const regels = rekening(g.delen, g.vooruit_p);
  return (
    <div className="flex flex-col gap-1 rounded-[18px] bg-card px-5 py-[18px]">
      <div className="pb-2">
        <KolomKop>Wat er openstaat</KolomKop>
      </div>
      {regels.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">
          {g.open < -0.005
            ? `Er staat niets open; ${formatPrice(-g.open)} tegoed.`
            : "Er staat niets open."}
        </p>
      ) : (
        <>
          {regels.map((r, i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 border-t border-muted py-2.5 text-[14px]"
            >
              <span className="min-w-0 flex-1">
                {r.label} <span className="text-[12px] text-muted-foreground">{r.wanneer}</span>
                {r.uitleg && (
                  <span className="block text-[12px] text-muted-foreground">{r.uitleg}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-border pt-2.5 text-[14px] font-semibold">
            <span>Totaal</span>
            <span className="tabular-nums">{formatPrice(g.open)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** "12,50" of "12.50" als bedrag; null als het geen bedrag boven nul is. */
function leesBedrag(tekst: string): number | null {
  const n = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * Een vaste korting aanmaken zonder dat er nu iets af gaat: een naam en een
 * bedrag, die daarna aan de deur en op kantoor als knop klaarstaan.
 */
function VasteKortingDialoog({
  open,
  adresId,
  bestaand,
  onSluit,
  onVeranderd,
}: {
  open: boolean;
  adresId: string;
  /** De namen van de vaste kortingen die er al zijn: geen twee dezelfde knoppen. */
  bestaand: string[];
  onSluit: () => void;
  onVeranderd: () => void;
}) {
  const [naam, setNaam] = useState("");
  const [bedrag, setBedrag] = useState("");
  const [bezig, setBezig] = useState(false);
  // Bij elke keer openen leeg beginnen (tijdens het tekenen, niet in een effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNaam("");
      setBedrag("");
    }
  }

  async function bewaar() {
    const waarde = leesBedrag(bedrag);
    if (!naam.trim()) {
      toast.error("Geef de korting een naam.");
      return;
    }
    if (!waarde) {
      toast.error("Vul een bedrag in.");
      return;
    }
    if (bestaand.some((n) => n.trim().toLowerCase() === naam.trim().toLowerCase())) {
      toast.error(`Er staat al een vaste korting ${naam.trim()} bij dit adres.`);
      return;
    }
    setBezig(true);
    try {
      // Een knop heeft een korte naam; een lange past daar niet op.
      await maakVasteKorting(adresId, naam.trim().slice(0, 40), waarde);
      toast.success(`${naam.trim()} −${formatPrice(waarde)} staat voortaan klaar bij dit adres`);
      onVeranderd();
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
          titel="Vaste korting"
          subtitel="Staat voortaan klaar bij dit adres"
        />
        <PopupBody className="gap-3">
          <VeldLabel label="Naam">
            <input
              autoFocus
              className={dossierInvoer}
              placeholder="bijv. Horren"
              maxLength={40}
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
            />
          </VeldLabel>
          <VeldLabel label="Bedrag">
            <input
              className={dossierInvoer}
              inputMode="decimal"
              placeholder="€ 0"
              value={bedrag}
              onChange={(e) => setBedrag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void bewaar()}
            />
          </VeldLabel>
          <p className="text-[12.5px] text-muted-foreground">
            Er gaat nu niets af. De korting staat als knop klaar bij het afrekenen.
          </p>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={onSluit}>
            Annuleren
          </Button>
          <Button className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
            Bewaren
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// De geldkaart van dit adres
// ---------------------------------------------------------------------------

function Kaart({ d, adres, onOpenen }: { d: Dossier; adres: Customer; onOpenen: () => void }) {
  const [jaar, setJaar] = useState(d.jaar);
  // Dezelfde opvraging (en sleutel) als de geldkaart bij Betalingen: wat daar
  // al geladen is, staat hier meteen, en een boeking ververst ze allebei.
  const kaart = useQuery({
    queryKey: ["geld-kaart", adres.street_id, jaar],
    queryFn: () => fetchKaart(adres.street_id, jaar),
  });
  const data = kaart.data?.adressen.find((x) => x.id === adres.id);
  const peil = d.wijk?.geld_peildatum ?? kaart.data?.wijk.peildatum ?? null;
  const peilMaand = peil ? peil.slice(0, 7) : null;
  const gepland = vooruitGepland(adres, data);
  // Dezelfde maand als de oranje rand in het jaar op het Overzicht.
  const volgende = volgendeBeurtMaand(adres, d.volgendeBeurt, d.dezeMaand);
  const pijl =
    "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-card px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1">
          <KolomKop>Geldkaart {jaar}</KolomKop>
          <button
            type="button"
            className={cn(pijl, "ml-1")}
            aria-label="Vorig jaar"
            onClick={() => setJaar((j) => j - 1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className={pijl}
            aria-label="Volgend jaar"
            onClick={() => setJaar((j) => j + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
          {/* Dezelfde kaart groot, met de maanden die als overmaken zijn
              afgemeld; wie mag afrekenen past daar oude maanden aan. */}
          <button type="button" className={cn(dossierLink, "ml-2")} onClick={onOpenen}>
            {d.magAfrekenen ? "Aanpassen" : "Openen"}
          </button>
        </div>
        <div className="text-[12px] text-muted-foreground">
          1 = betaald · 0 = niet betaald · letter of + = een deel open (van de kaart) · % = niet aan
          de beurt · × = overgeslagen · B = vooruit betaald (lichte 1: van de papieren kaart) ·
          oranje rand = volgende beurt
        </div>
      </div>
      {kaart.isError ? (
        <p className="text-[13px] text-tint-rood-ink">De geldkaart kon niet opgehaald worden.</p>
      ) : (
        <div
          className={cn(
            "grid gap-1.5 text-center",
            d.mobiel ? "grid-cols-6 gap-y-3" : "grid-cols-12",
          )}
        >
          {MAANDEN_KORT.map((naam, i) => {
            const maand = `${jaar}-${String(i + 1).padStart(2, "0")}`;
            const kaartVak = vakVoor(adres, data, maand, peilMaand, undefined, gepland);
            // Een ingeplande beurt buiten de frequentie om is toch de volgende,
            // zoals in het jaar op het Overzicht: dan geen %, maar een open plek.
            const vak: Vak =
              maand === volgende && kaartVak.soort === "niet_aan_de_beurt"
                ? { soort: "leeg" }
                : kaartVak;
            const isVolgende =
              maand === volgende && (vak.soort === "leeg" || vak.soort === "vooruit");
            const teken = vak.soort === "leeg" && isVolgende ? "·" : vakTeken(vak);
            return (
              <div key={maand} className="flex flex-col gap-1">
                <span className="text-[12px] text-muted-foreground">{naam}</span>
                {kaart.isLoading ? (
                  <span className="h-11 animate-pulse rounded-[10px] bg-muted" />
                ) : (
                  <span
                    title={[
                      `${toonMaand(maand)} ${jaar}`,
                      vakUitleg(vak),
                      isVolgende ? "volgende beurt" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-[10px] border-2 border-transparent text-[16px] tabular-nums",
                      vakKleur(vak, isVolgende),
                    )}
                  >
                    {teken}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Betalingen en kortingen
// ---------------------------------------------------------------------------

const KOLOMMEN = "grid grid-cols-[110px_minmax(0,1fr)_160px_110px_120px] gap-3";

function Betalingen({
  d,
  adres,
  g,
  vernieuw,
}: {
  d: Dossier;
  adres: Customer;
  g: GeldAdres;
  vernieuw: () => void;
}) {
  const bevestig = useBevestig();
  const [bezig, setBezig] = useState(false);

  async function draaiTerug(e: Gebeurtenis) {
    if (e.soort === "vooruit") {
      // Wat al gebruikt is, komt weer open te staan: dat moet de eigenaar
      // weten voordat hij klikt.
      const ja = await bevestig({
        titel: "Vooruitbetaling ongedaan maken?",
        tekst: vooruitOngedaanTekst(e),
        bevestigLabel: "Ongedaan maken",
      });
      if (!ja) return;
    }
    if (e.soort === "omgerekend") {
      const ja = await bevestig({
        titel: "Omrekenen ongedaan maken?",
        tekst: `Dan staan er weer ${beurtenTekst(e.omgerekend_van ?? 0)} vooruit betaald tegen de oude prijs, zoals vóór het omrekenen.`,
        bevestigLabel: "Ongedaan maken",
      });
      if (!ja) return;
    }
    setBezig(true);
    try {
      await boek(
        nieuweTik({ adres: adres.id, soort: "ongedaan", herroept: e.id, bron: "kantoor" }),
      );
      toast.success("Ongedaan gemaakt");
      vernieuw();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBezig(false);
    }
  }

  /** De kleine regel onder "Wat": gebruikt, een afwijkende prijs, teruggedraaid. */
  function extra(e: Gebeurtenis) {
    const delen = [
      e.soort === "vooruit" && !e.ongedaan
        ? `${e.gebruikt ?? 0} van de ${e.aantal ?? 0} gebruikt`
        : "",
      e.ongedaan ? `teruggedraaid door ${e.ongedaan.door_naam}` : "",
    ].filter(Boolean);
    // Tikte de loper een andere prijs per beurt dan de gewone? Dan ziet de
    // eigenaar dat hier, en kan hij het rechtzetten.
    const afwijkend = e.soort === "vooruit" && e.prijs_verwacht != null && !e.ongedaan;
    if (delen.length === 0 && !afwijkend) return null;
    return (
      <span className="block text-[12px] text-muted-foreground">
        {afwijkend && (
          <span className="mr-1.5 rounded-full bg-tint-amber px-1.5 text-[11px] text-tint-amber-ink">
            gewone prijs {formatPrice(e.prijs_verwacht!)}
          </span>
        )}
        {delen.join(" · ")}
      </span>
    );
  }

  const kanOngedaan = (e: Gebeurtenis) => d.isEigenaar && !e.ongedaan && e.soort !== "beginstand";
  const ongedaanKnop = (e: Gebeurtenis) => (
    <button
      type="button"
      className={cn(dossierLink, "text-right disabled:opacity-50")}
      disabled={bezig}
      onClick={() => void draaiTerug(e)}
    >
      Ongedaan
    </button>
  );

  return (
    <div className="flex flex-col gap-1 rounded-[18px] bg-card px-5 py-[18px]">
      <div className="pb-2">
        <KolomKop>Betalingen en kortingen</KolomKop>
      </div>
      {g.gebeurtenissen.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">Nog niets gebeurd.</p>
      ) : d.mobiel ? (
        g.gebeurtenissen.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-3 border-t border-muted py-2.5 text-[14px]"
          >
            <div className="min-w-0 flex-1">
              <span className={cn("block", e.ongedaan && "line-through opacity-60")}>
                {watTekst(e)}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {regelDatum(e.op)} · {e.door_naam || "?"}
              </span>
              {extra(e)}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn("tabular-nums", e.ongedaan && "line-through opacity-60")}>
                {bedragTekst(e)}
              </span>
              {kanOngedaan(e) && ongedaanKnop(e)}
            </div>
          </div>
        ))
      ) : (
        <>
          <div className={cn(KOLOMMEN, "pb-1.5 text-[12px] text-muted-foreground")}>
            <span>Datum</span>
            <span>Wat</span>
            <span>Door</span>
            <span className="text-right">Bedrag</span>
            <span />
          </div>
          {g.gebeurtenissen.map((e) => (
            <div
              key={e.id}
              title={moment(e.op)}
              className={cn(KOLOMMEN, "border-t border-muted py-2.5 text-[14px]")}
            >
              <span>{regelDatum(e.op)}</span>
              <span className="min-w-0">
                <span className={cn(e.ongedaan && "line-through opacity-60")}>{watTekst(e)}</span>
                {extra(e)}
              </span>
              <span className="truncate">{e.door_naam || "?"}</span>
              <span
                className={cn("text-right tabular-nums", e.ongedaan && "line-through opacity-60")}
              >
                {bedragTekst(e)}
              </span>
              <span className="text-right">{kanOngedaan(e) && ongedaanKnop(e)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vaste kortingen (alleen als er een is)
// ---------------------------------------------------------------------------

function VasteKortingen({ d, g, vernieuw }: { d: Dossier; g: GeldAdres; vernieuw: () => void }) {
  const [bezig, setBezig] = useState(false);

  async function haalWeg(id: string) {
    setBezig(true);
    try {
      await haalVasteKortingWeg(id);
      vernieuw();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  if (g.vaste_kortingen.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-[18px] bg-card px-5 py-[18px]">
      <div className="pb-2">
        <KolomKop>Vaste kortingen</KolomKop>
      </div>
      {g.vaste_kortingen.map((k) => (
        <div
          key={k.id}
          className="flex items-center gap-3 border-t border-muted py-2.5 text-[14px]"
        >
          <span className="min-w-0 flex-1">
            {k.naam} − {formatPrice(k.bedrag)}
            <span className="block text-[12px] text-muted-foreground">
              {k.door_naam} · {moment(k.op)}
            </span>
          </span>
          {d.magAfrekenen && (
            <button
              type="button"
              className={cn(dossierLink, "disabled:opacity-50")}
              disabled={bezig}
              onClick={() => void haalWeg(k.id)}
            >
              Weghalen
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
