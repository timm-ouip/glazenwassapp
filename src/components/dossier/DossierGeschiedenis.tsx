/**
 * Tabblad "Geschiedenis" van het klantdossier: alles wat er met dit adres
 * gebeurde, per maand en nieuwste eerst. Groen de beurten, oranje het geld,
 * rood de klachten, paars elke wijziging met wie het deed. Wat automatisch
 * ging staat geel. Een wijziging die je mag terugzetten heeft "Ongedaan".
 *
 * De regels zelf maakt src/lib/geschiedenis.ts; hier het opvragen en tekenen.
 */
import { useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DossierKop } from "@/components/dossier/DossierKop";
import { dossierLink } from "@/components/dossier/DossierVelden";
import { korteDatum } from "@/lib/dossier";
import { draaiGeldloopWijzigingTerug, fetchGeldloopWijzigingen } from "@/lib/geldlopen";
import {
  fetchGedaneBeurten,
  fetchPaaltjeWijzigingen,
  maakGeschiedenis,
  maandKop,
  perMaand,
  type GedaneBeurt,
  type GeschiedenisRegel,
  type GeschiedenisSoort,
} from "@/lib/geschiedenis";
import { fetchKlachtenVanKlant } from "@/lib/klachten";
import { fetchGeldAdres } from "@/lib/overzichten";
import { useRecht } from "@/lib/rechten";
import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";
import { fetchWijzigingen, wijzigingenOngedaan } from "@/lib/wijzigingen";

type Filter = "alles" | "beurten" | "geld" | "wijzigingen";

const FILTERS: { waarde: Filter; label: string; soort: GeschiedenisSoort | null }[] = [
  { waarde: "alles", label: "Alles", soort: null },
  { waarde: "beurten", label: "Beurten", soort: "beurt" },
  { waarde: "geld", label: "Geld", soort: "geld" },
  { waarde: "wijzigingen", label: "Wijzigingen", soort: "wijziging" },
];

const STIP: Record<GeschiedenisSoort, string> = {
  wijziging: "bg-tint-paars-mid",
  beurt: "bg-tint-groen-mid",
  geld: "bg-tint-oranje-mid",
  klacht: "bg-tint-rood-mid",
};

/** Zoveel beurten per keer; "Ouder laden" haalt er weer zoveel bij. */
const STAP = 50;

const fout = (e: unknown) =>
  e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);

export function DossierGeschiedenis({ d }: { d: Dossier }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("alles");
  const [limiet, setLimiet] = useState(STAP);
  const [bezig, setBezig] = useState<string | null>(null);

  const adresId = d.adresId;
  const klantId = d.klantId;
  const magLog = useRecht("planning", "klanten_bekijken", "klanten_bewerken");
  const magGeldloper = useRecht("prijzen_zien", "klanten_bekijken");

  // De planning mag niet iedereen lezen: zonder dat recht zijn er geen
  // beurten. Elke andere fout (slecht bereik) komt wel als melding.
  const beurten = useQuery({
    queryKey: ["dossier-beurten", adresId, limiet, d.prijzenZien],
    queryFn: () =>
      fetchGedaneBeurten(adresId!, limiet, d.prijzenZien).catch((e: unknown) => {
        if ((e as { code?: string })?.code === "42501") return [] as GedaneBeurt[];
        throw e;
      }),
    enabled: !!adresId,
    placeholderData: keepPreviousData,
  });
  // Wat er echt getoond wordt: de laatste beurten die binnenkwamen, met de
  // limiet waarmee ze opgehaald zijn. Zo verspringt de lijst niet terwijl
  // "Ouder laden" bezig is, en blijft hij staan als dat mislukt.
  const getoond = useRef<{ adresId: string; limiet: number; data: GedaneBeurt[] } | null>(null);
  if (adresId && beurten.isSuccess && !beurten.isPlaceholderData) {
    getoond.current = { adresId, limiet, data: beurten.data };
  }
  const opgehaald = getoond.current?.adresId === adresId ? getoond.current : null;
  // Dezelfde sleutels als het Overzicht en het gele vak: wat daar al staat,
  // hoeft niet opnieuw.
  const geld = useQuery({
    queryKey: ["geld-adres", adresId],
    queryFn: () => fetchGeldAdres(adresId!),
    enabled: !!adresId && d.prijzenZien,
  });
  const klachten = useQuery({
    queryKey: ["klachten", klantId],
    queryFn: () => fetchKlachtenVanKlant(klantId!),
    enabled: !!klantId && d.magKlachten,
  });
  const wijzigingen = useQuery({
    queryKey: ["dossier-wijzigingen", adresId, klantId],
    queryFn: () => fetchWijzigingen(adresId!, klantId),
    enabled: !!adresId && magLog,
  });
  const geldloper = useQuery({
    queryKey: ["geldloop-wijzigingen", adresId],
    queryFn: () => fetchGeldloopWijzigingen({ adres: adresId! }),
    enabled: !!adresId && magGeldloper,
  });
  const paaltje = useQuery({
    queryKey: ["dossier-paaltje", adresId],
    queryFn: () => fetchPaaltjeWijzigingen(adresId!),
    enabled: !!adresId && d.isEigenaar,
  });

  const bronnen = [beurten, geld, klachten, wijzigingen, geldloper, paaltje];
  const laden = bronnen.some((q) => q.isLoading);
  const mislukt = bronnen.some((q) => q.isError);

  const alles = adresId
    ? maakGeschiedenis(
        {
          adresId,
          beurten: opgehaald?.data ?? [],
          gebeurtenissen: geld.data?.gebeurtenissen ?? [],
          klachten: klachten.data ?? [],
          wijzigingen: wijzigingen.data ?? [],
          geldloper: geldloper.data ?? [],
          paaltje: paaltje.data ?? [],
        },
        {
          prijzen: d.prijzenZien,
          bewerken: d.magBewerken,
          planOfBewerken: d.magPlanOfBewerken,
          eigenaar: d.isEigenaar,
        },
      )
    : [];
  // Zijn er meer beurten dan er nu opgehaald zijn, dan stopt de lijst bij de
  // oudste die er is: anders lijkt het of er daarvoor niets gewassen is.
  const meer = opgehaald ? opgehaald.data.length >= opgehaald.limiet : false;
  const grens = meer ? (opgehaald?.data[opgehaald.data.length - 1]?.datum ?? null) : null;
  const soort = FILTERS.find((f) => f.waarde === filter)?.soort ?? null;
  const zichtbaar = alles.filter(
    (x) => (!grens || x.datum >= grens) && (!soort || x.soort === soort),
  );
  const maanden = perMaand(zichtbaar);

  async function ongedaan(x: GeschiedenisRegel) {
    if (!x.ongedaan || bezig) return;
    setBezig(x.sleutel);
    try {
      if (x.ongedaan.soort === "log") {
        await wijzigingenOngedaan(x.ongedaan.ids);
      } else {
        await draaiGeldloopWijzigingTerug(x.ongedaan.id);
      }
      toast.success("Ongedaan gemaakt");
      void qc.invalidateQueries({ queryKey: ["dossier-wijzigingen", adresId] });
      void qc.invalidateQueries({ queryKey: ["geldloop-wijzigingen", adresId] });
      void qc.invalidateQueries({ queryKey: ["geld-adres", adresId] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["klanten"] });
      if (x.ongedaan.soort === "geldloper") {
        // Een teruggezette wasbeurt staat weer in de planning en telt weer mee
        // in wat er open staat (zoals in het Avondoverzicht).
        void qc.invalidateQueries({ queryKey: ["dossier-beurten", adresId] });
        void qc.invalidateQueries({ queryKey: ["vergeten"] });
        void qc.invalidateQueries({ queryKey: ["geldloop-lijst"] });
        void qc.invalidateQueries({ queryKey: ["wasdag"] });
        void qc.invalidateQueries({ queryKey: ["wasdagen"] });
        void qc.invalidateQueries({ queryKey: ["geld-pof"] });
      }
    } catch (e) {
      // De database zegt in een Nederlandse zin waarom niet.
      toast.error(fout(e));
    } finally {
      setBezig(null);
    }
  }

  const pillen = FILTERS.map((f) => {
    const aan = f.waarde === filter;
    return (
      <button
        key={f.waarde}
        type="button"
        aria-pressed={aan}
        onClick={() => setFilter(f.waarde)}
        className={cn(
          "shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
          aan
            ? "border-transparent bg-foreground text-background"
            : "border-border bg-card text-foreground hover:bg-accent",
        )}
      >
        {f.label}
      </button>
    );
  });

  return (
    <>
      <DossierKop d={d} titel="Geschiedenis" acties={pillen} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={cn(d.mobiel ? "px-4 py-4" : "px-[26px] py-[22px]")}>
          {!adresId ? (
            <Melding>Zodra het adres is toegevoegd, staat hier alles wat ermee gebeurde.</Melding>
          ) : laden && alles.length === 0 ? (
            <Melding>Bezig met ophalen…</Melding>
          ) : maanden.length === 0 ? (
            <Melding>
              {mislukt
                ? "Niet alles kon worden opgehaald. Probeer het later nog eens."
                : filter === "alles"
                  ? "Hier staat nog niets. Zodra er gewassen, betaald of iets gewijzigd wordt, zie je het hier."
                  : "Hier staat nog niets van."}
            </Melding>
          ) : (
            <div className="flex flex-col rounded-[18px] bg-card px-5 py-2">
              {maanden.map((m, i) => (
                <section key={m.maand} aria-label={maandKop(m.maand)}>
                  <h3
                    className={cn(
                      "pb-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground",
                      i === 0 ? "pt-3" : "pt-[18px]",
                    )}
                  >
                    {maandKop(m.maand)}
                  </h3>
                  {m.regels.map((x) => (
                    <Regel
                      key={x.sleutel}
                      x={x}
                      bezig={bezig === x.sleutel}
                      uit={bezig !== null}
                      onOngedaan={() => void ongedaan(x)}
                    />
                  ))}
                </section>
              ))}
              {mislukt && (
                <p className="border-t border-muted py-3 text-[13px] text-muted-foreground">
                  Niet alles kon worden opgehaald; er kan iets ontbreken.
                </p>
              )}
            </div>
          )}
          {adresId && meer && (
            <button
              type="button"
              // Mislukte het ophalen, dan eerst opnieuw proberen.
              onClick={() =>
                beurten.isError ? void beurten.refetch() : setLimiet((n) => n + STAP)
              }
              disabled={beurten.isFetching}
              className="mx-auto mt-3 flex h-10 items-center rounded-full border border-border bg-card px-4 text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {beurten.isFetching ? "Bezig…" : "Ouder laden"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Melding({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] bg-card px-[18px] py-4 text-[14px] text-muted-foreground">
      {children}
    </p>
  );
}

function Regel({
  x,
  bezig,
  uit,
  onOngedaan,
}: {
  x: GeschiedenisRegel;
  bezig: boolean;
  uit: boolean;
  onOngedaan: () => void;
}) {
  return (
    <div className="border-t border-muted py-1.5">
      <div
        className={cn(
          "flex items-start gap-3.5 py-1.5",
          // Automatisch (Paaltje of het systeem): geel, zoals elders in de app.
          x.geel && "-mx-3 rounded-[12px] bg-tint-geel px-3 text-tint-geel-ink",
          x.teruggedraaid && "opacity-60",
        )}
      >
        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", STIP[x.soort])} />
        <div className="min-w-0 flex-1">
          {x.titel.map((t, i) => (
            <div
              key={i}
              className={cn("break-words text-[15px]", x.teruggedraaid && "line-through")}
            >
              {t}
            </div>
          ))}
          {x.onder && (
            <div
              className={cn(
                "break-words text-[13px]",
                x.geel ? "text-tint-geel-ink" : "text-muted-foreground",
              )}
            >
              {x.onder}
            </div>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-[13px]",
            x.geel ? "text-tint-geel-ink" : "text-muted-foreground",
          )}
        >
          {korteDatum(x.datum)}
        </span>
        {x.ongedaan && (
          <button
            type="button"
            onClick={onOngedaan}
            disabled={uit}
            className={cn(dossierLink, "shrink-0 pl-3 text-[13px] disabled:opacity-50")}
          >
            {bezig ? "Bezig…" : "Ongedaan"}
          </button>
        )}
      </div>
    </div>
  );
}
