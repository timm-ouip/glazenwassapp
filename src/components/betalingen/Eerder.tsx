import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconLoader2 as Loader2,
} from "@tabler/icons-react";

import { useBevestig } from "@/components/Bevestig";
import { useAuth } from "@/lib/auth";
import { beurtenTekst } from "@/lib/betalingen";
import { regelDatum } from "@/lib/dossier";
import { boek, fetchEerder, nieuweTik, type EerdereBoeking } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";
import { soortLabel, vooruitOngedaanTekst } from "@/lib/overzichten";
import { useMagAfrekenen } from "@/lib/rechten";
import { cn } from "@/lib/utils";

/** Zoveel regels eerst; de rest achter "Meer tonen". */
const EERST = 8;

/** Waar het vandaan kwam, kort: onder de regel. */
const BRON: Record<EerdereBoeking["bron"], string> = {
  geldloop: "avondronde",
  kantoor: "kantoor",
  dag: "overdag",
  kaart: "papieren kaart",
};

/** Hetzelfde, in de bevestigvraag: "ingetikt door Timm op kantoor". */
const BRON_ZIN: Record<EerdereBoeking["bron"], string> = {
  geldloop: "tijdens de avondronde",
  kantoor: "op kantoor",
  dag: "overdag",
  kaart: "van de papieren kaart",
};

/**
 * Het bolletje voor de regel: groen betaald, paars korting, grijs niet thuis,
 * rood geen geld, blauw vooruit (en omgerekend), amber teruggegeven.
 */
const BOLLETJE: Record<EerdereBoeking["soort"], string> = {
  betaald: "bg-tint-groen-ink",
  korting: "bg-tint-paars-ink",
  niet_thuis: "bg-muted-foreground",
  geen_geld: "bg-tint-rood-ink",
  vooruit: "bg-tint-blauw-ink",
  omgerekend: "bg-tint-blauw-ink",
  terugbetaald: "bg-tint-amber-ink",
  beginstand: "bg-muted-foreground",
};

/** "Betaald € 30", "Korting −€ 5 (horren)", "Vooruit 2 beurten € 60". */
function regelTekst(b: EerdereBoeking): string {
  const reden = b.reden ? ` (${b.reden})` : "";
  switch (b.soort) {
    case "korting":
      return `Korting −${formatPrice(b.bedrag)}${reden}`;
    case "vooruit":
      return `Vooruit ${beurtenTekst(b.aantal ?? 0)} ${formatPrice(b.bedrag)}`;
    case "omgerekend":
      return `Omgerekend: ${b.omgerekend_van ?? 0} → ${beurtenTekst(b.aantal ?? 0)}`;
    case "niet_thuis":
    case "geen_geld":
      return `${soortLabel(b.soort)}${reden}`;
    default:
      return `${soortLabel(b.soort)} ${formatPrice(b.bedrag)}${reden}`;
  }
}

/**
 * "Eerder": de boekingen van dit adres, nieuwste eerst, met wie ze intikte.
 * Dicht is het één regel ("Eerder (8)" en de laatste boeking), zodat de
 * knoppen onderin in beeld blijven. Iedereen die het betaalvenster mag openen
 * ziet dit, ook een geldloper tijdens zijn avond.
 *
 * Klopt er iets niet, dan draait de eigenaar (of wie mag afrekenen) het met
 * "Klopt niet" terug; daarna tik je het gewoon goed in met de knoppen van het
 * venster. Niets wordt gewist: het blijft doorgestreept staan, met wie het
 * terugdraaide. Niet met deze knop: de beginstand en een 1 van de papieren
 * kaart (die zet je op de Wijkkaart), en voor wie geen eigenaar is ook
 * teruggeven en omrekenen, en een vooruitbetaling waar dat daarna nog mee
 * gebeurde. De database controleert hetzelfde.
 */
export function Eerder({
  adres,
  verberg = [],
  onTeruggedraaid,
  className,
}: {
  adres: string;
  /** Wat het venster er al boven laat zien (de tik van vanavond). */
  verberg?: string[];
  /** Na terugdraaien: het openstaande bedrag en de lijst verversen. */
  onTeruggedraaid: () => void;
  className?: string;
}) {
  const bevestig = useBevestig();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const magTerug = useMagAfrekenen();
  const [open, setOpen] = useState(false);
  const [alles, setAlles] = useState(false);
  const [meer, setMeer] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  // Meteen ophalen, ook dicht: de kop laat het aantal en de laatste zien.
  const q = useQuery({
    queryKey: ["geld-eerder", adres, alles],
    queryFn: () => fetchEerder(adres, alles),
    // Bij elk openen vers: elders (dossier, een collega) kan intussen iets
    // teruggedraaid zijn.
    staleTime: 0,
    // Mag je het niet (meer) zien, dan helpt opnieuw proberen niet.
    retry: false,
    // Bij "langer geleden" de lijst laten staan tot de rest er is.
    placeholderData: (vorige) => vorige,
  });

  const boekingen = (q.data?.boekingen ?? []).filter((b) => !verberg.includes(b.id));
  const zichtbaar = meer ? boekingen : boekingen.slice(0, EERST);
  const laatste = boekingen[0];

  const kanTerug = (b: EerdereBoeking) =>
    magTerug &&
    !b.ongedaan &&
    b.soort !== "beginstand" &&
    b.bron !== "kaart" &&
    (isEigenaar ||
      (b.soort !== "terugbetaald" &&
        b.soort !== "omgerekend" &&
        // Een vooruitbetaling waar daarna iets van teruggegeven of omgerekend
        // is: dat draait de eigenaar terug. Wat later kwam staat altijd hoger.
        !(
          b.soort === "vooruit" &&
          boekingen.some(
            (x) =>
              x.op >= b.op &&
              !x.ongedaan &&
              (x.soort === "terugbetaald" || x.soort === "omgerekend"),
          )
        )));

  async function terug(b: EerdereBoeking) {
    const wat = regelTekst(b);
    const gevolg =
      b.soort === "vooruit"
        ? vooruitOngedaanTekst(b)
        : b.soort === "omgerekend"
          ? `Dan staan er weer ${beurtenTekst(b.omgerekend_van ?? 0)} vooruit betaald tegen de oude prijs, zoals vóór het omrekenen.`
          : "";
    const ja = await bevestig({
      titel: "Klopt niet?",
      tekst: (
        <>
          „{wat}” van {regelDatum(b.op)}, ingetikt door{" "}
          <strong className="font-semibold">{b.door_naam || "?"}</strong> {BRON_ZIN[b.bron]},
          terugdraaien?
          {gevolg && <span className="mt-1.5 block">{gevolg}</span>}
          <span className="mt-1.5 block text-[12px] opacity-75">
            Er wordt niets gewist: de boeking blijft zichtbaar, doorgestreept, met jouw naam erbij.
            Daarna tik je het goed in.
          </span>
        </>
      ),
      annuleerLabel: "Laat staan",
      bevestigLabel: "Terugdraaien",
      gevaarlijk: true,
    });
    if (!ja) return;
    setBezig(b.id);
    try {
      const uit = await boek(
        nieuweTik({ adres, soort: "ongedaan", herroept: b.id, bron: "kantoor" }),
      );
      if (uit.status === "al_ontvangen") toast("Dit was al teruggedraaid.");
      else toast.success(`Teruggedraaid: ${wat}`);
      onTeruggedraaid();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(null);
      void q.refetch();
    }
  }

  const aantal = q.data ? ` (${boekingen.length})` : "";

  // Dicht: één regel, met de laatste boeking erbij.
  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-12 w-full items-center gap-2 rounded-[14px] border border-border bg-card px-3.5 text-left shadow-card active:bg-surface",
          className,
        )}
      >
        <span className="shrink-0 text-[14px] font-semibold">Eerder{aantal}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground">
          {q.isError
            ? ""
            : laatste
              ? `laatste: ${regelDatum(laatste.op)} · ${laatste.door_naam || "?"}`
              : q.data
                ? "nog niets"
                : ""}
        </span>
        {q.isLoading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[14px] border border-border bg-card px-3.5 pb-1 shadow-card",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded
        onClick={() => setOpen(false)}
        className="flex min-h-12 w-full items-center gap-2 text-left"
      >
        <span className="flex-1 text-[14px] font-semibold">Eerder{aantal}</span>
        <span className="text-[12.5px] text-muted-foreground">dichtklappen</span>
        <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {q.isError ? (
        <p className="pb-2.5 text-[13px] text-tint-rood-ink">
          {q.error instanceof Error ? q.error.message : "Eerder kon niet opgehaald worden."}
        </p>
      ) : q.isLoading ? null : boekingen.length === 0 ? (
        <p className="pb-2.5 text-[13px] text-muted-foreground">
          {alles ? "Hier is nog nooit iets geboekt." : "Het afgelopen jaar is hier niets geboekt."}
        </p>
      ) : (
        zichtbaar.map((b) => (
          <div key={b.id} className="flex items-center gap-2.5 border-t border-border py-2">
            <span className="w-[3.25rem] shrink-0 text-[12.5px] leading-tight tabular-nums text-muted-foreground">
              {regelDatum(b.op)}
            </span>
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", BOLLETJE[b.soort])} />
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[13.5px] font-semibold",
                  b.ongedaan && "font-normal text-muted-foreground line-through",
                )}
              >
                {regelTekst(b)}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {b.door_naam || "?"} · {BRON[b.bron]}
              </span>
              {b.ongedaan && (
                <span className="block text-[12px] text-tint-rood-ink">
                  teruggedraaid door {b.ongedaan.door_naam || "?"} · {regelDatum(b.ongedaan.op)}
                </span>
              )}
            </div>
            {kanTerug(b) && (
              <button
                type="button"
                disabled={bezig !== null}
                onClick={() => void terug(b)}
                className="flex min-h-11 shrink-0 items-center rounded-full border border-border bg-card px-3.5 text-[13px] font-medium shadow-card active:bg-surface disabled:opacity-50"
              >
                {bezig === b.id ? <Loader2 className="size-4 animate-spin" /> : "Klopt niet"}
              </button>
            )}
          </div>
        ))
      )}

      {!meer && boekingen.length > EERST && (
        <button
          type="button"
          onClick={() => setMeer(true)}
          className="min-h-11 w-full border-t border-border text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          Meer tonen ({boekingen.length - EERST})
        </button>
      )}
      {(meer || boekingen.length <= EERST) && !alles && (q.data?.ouder ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => {
            setAlles(true);
            setMeer(true);
          }}
          className="min-h-11 w-full border-t border-border text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          Ook van langer dan een jaar geleden ({q.data?.ouder})
        </button>
      )}

      {/* Een gewone geldloper ziet wie wat deed, maar draait niets terug. */}
      {!magTerug && !q.isError && boekingen.length > 0 && (
        <p className="mb-2.5 mt-1 rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
          Klopt er iets niet? Bel de eigenaar; jij ziet wie het intikte, maar terugdraaien doet de
          eigenaar of wie mag afrekenen.
        </p>
      )}
    </div>
  );
}
