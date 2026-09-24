import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft as ArrowLeft, IconSend as Send } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBevestig } from "@/components/Bevestig";
import { formatPrice } from "@/lib/klanten";
import { toonDatum } from "@/lib/wasdag";
import {
  facturenKlaarzetten,
  facturenVersturen,
  factuurBetaald,
  factuurCrediteren,
  factuurStand,
  factuurWeggooien,
  fetchFacturen,
  fetchFactuurregels,
  fetchLosseRegels,
  openBedrag,
  type Factuur,
} from "@/lib/facturen";

type Filter = "alles" | "concept" | "verstuurd" | "telaat" | "betaald";

const FILTERS: { waarde: Filter; label: string }[] = [
  { waarde: "alles", label: "Alles" },
  { waarde: "concept", label: "Concepten" },
  { waarde: "verstuurd", label: "Verstuurd" },
  { waarde: "telaat", label: "Te laat" },
  { waarde: "betaald", label: "Betaald" },
];

function past(f: Factuur, filter: Filter): boolean {
  if (filter === "alles") return true;
  if (filter === "concept") return f.status === "concept";
  if (filter === "betaald") return f.status === "betaald";
  if (filter === "telaat") return f.te_laat;
  return f.status === "verstuurd";
}

/**
 * De facturen van de klanten die overmaken.
 *
 * Je komt binnen op de concepten, want daar is iets te doen. Een concept
 * heeft nog geen nummer en is nog vrij te veranderen; zodra je hem verstuurt
 * krijgt hij er een en staat hij vast. Rechtzetten kan daarna alleen nog met
 * een creditfactuur — de klant heeft dat papier immers al.
 */
export function FacturenLijst({ onTerug }: { onTerug?: () => void }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [filter, setFilter] = useState<Filter>("concept");
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const facturen = useQuery({ queryKey: ["facturen"], queryFn: () => fetchFacturen() });
  const los = useQuery({ queryKey: ["factuurregels-los"], queryFn: fetchLosseRegels });

  const alles = useMemo(() => facturen.data ?? [], [facturen.data]);
  const lijst = useMemo(() => alles.filter((f) => past(f, filter)), [alles, filter]);
  const concepten = useMemo(() => alles.filter((f) => f.status === "concept"), [alles]);
  const teLaat = useMemo(() => alles.filter((f) => f.te_laat), [alles]);
  const openTotaal = alles.reduce((t, f) => t + (f.status === "verstuurd" ? openBedrag(f) : 0), 0);

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["facturen"] });
    void qc.invalidateQueries({ queryKey: ["factuurregels-los"] });
  }

  const klaarzetten = useMutation({
    mutationFn: () => facturenKlaarzetten(false),
    onSuccess: (n) => {
      ververs();
      toast.success(n === 0 ? "Er stond niets klaar te zetten." : `${n} concept(en) klaargezet.`);
    },
    onError: (e: Error) => toast.error("Klaarzetten mislukt: " + e.message),
  });

  const versturen = useMutation({
    mutationFn: (ids: string[]) => facturenVersturen(ids),
    onSuccess: (r) => {
      setGekozen([]);
      ververs();
      if (r.mislukt.length === 0) {
        toast.success(`${r.gelukt} factuur(en) verstuurd.`);
      } else {
        toast.error(
          `${r.gelukt} verstuurd, ${r.mislukt.length} niet: ${r.mislukt[0]?.reden ?? ""}`,
        );
      }
    },
    onError: (e: Error) => toast.error("Versturen mislukt: " + e.message),
  });

  const teVersturen = gekozen.filter((id) =>
    alles.some((f) => f.id === id && f.status === "concept"),
  );

  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-center gap-1.5">
        {onTerug && (
          <button
            type="button"
            onClick={onTerug}
            className="mr-1 flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-muted-foreground shadow-card hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Overzicht
          </button>
        )}
        {FILTERS.map((f) => (
          <button
            key={f.waarde}
            type="button"
            onClick={() => setFilter(f.waarde)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              filter === f.waarde
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
            {f.waarde === "concept" && concepten.length > 0 && ` (${concepten.length})`}
            {f.waarde === "telaat" && teLaat.length > 0 && ` (${teLaat.length})`}
          </button>
        ))}
        <span className="ml-auto text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {formatPrice(openTotaal)}
          </span>{" "}
          nog niet binnen
        </span>
      </div>

      {/* Regels die nog op geen enkele factuur staan. Geel, met een knop:
          automatisch mag, maar je ziet het en je drukt zelf. */}
      {(los.data ?? 0) > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {los.data} te factureren regel{los.data === 1 ? "" : "s"} staan nog los. Klanten met
            &ldquo;verzamelen per maand&rdquo; wachten tot de maand voorbij is.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={klaarzetten.isPending}
            onClick={() => klaarzetten.mutate()}
          >
            {klaarzetten.isPending ? "Bezig…" : "Concepten klaarzetten"}
          </Button>
        </section>
      )}

      {facturen.isLoading && <p className="text-[13px] text-muted-foreground">Laden…</p>}

      <section className="overflow-hidden rounded-[24px] border border-border bg-card shadow-card">
        {lijst.length === 0 && !facturen.isLoading ? (
          <p className="p-4 text-[13px] text-muted-foreground">
            {filter === "concept"
              ? "Geen concepten. Zodra een dag helemaal is afgemeld, komen ze hier vanzelf te staan."
              : "Niets te zien onder deze keuze."}
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {lijst.map((f) => (
              <FactuurRegel
                key={f.id}
                f={f}
                gekozen={gekozen.includes(f.id)}
                onKies={(aan) =>
                  setGekozen((l) => (aan ? [...l, f.id] : l.filter((x) => x !== f.id)))
                }
                open={open === f.id}
                onOpen={() => setOpen(open === f.id ? null : f.id)}
                onVeranderd={ververs}
                bevestig={bevestig}
              />
            ))}
          </div>
        )}
      </section>

      {/* De balk verschijnt alleen als er wat te versturen is. */}
      {teVersturen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="min-w-0 flex-1 text-[13px]">
              {teVersturen.length} factuur{teVersturen.length === 1 ? "" : "en"} klaar om te
              versturen
            </span>
            <Button variant="ghost" size="sm" onClick={() => setGekozen([])}>
              Laat maar
            </Button>
            <Button
              className="rounded-full"
              disabled={versturen.isPending}
              onClick={() => versturen.mutate(teVersturen)}
            >
              <Send className="size-4" />
              {versturen.isPending ? "Bezig…" : "Versturen"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FactuurRegel({
  f,
  gekozen,
  onKies,
  open,
  onOpen,
  onVeranderd,
  bevestig,
}: {
  f: Factuur;
  gekozen: boolean;
  onKies: (aan: boolean) => void;
  open: boolean;
  onOpen: () => void;
  onVeranderd: () => void;
  bevestig: ReturnType<typeof useBevestig>;
}) {
  const concept = f.status === "concept";
  const regels = useQuery({
    queryKey: ["factuurregels", f.id],
    queryFn: () => fetchFactuurregels(f.id),
    enabled: open,
  });
  const stand = factuurStand(f);
  const nogOpen = openBedrag(f);

  async function afvinken() {
    try {
      await factuurBetaald(f.id, nogOpen);
      onVeranderd();
      toast.success("Afgevinkt als betaald.");
    } catch (e) {
      toast.error("Afvinken mislukt: " + (e as Error).message);
    }
  }

  async function crediteren() {
    const ja = await bevestig({
      titel: `Factuur ${f.nummer} crediteren?`,
      tekst:
        "Er komt een creditfactuur met een eigen nummer die deze tegenboekt. Deze factuur zelf verandert niet — je klant heeft hem al.",
      bevestigLabel: "Crediteren",
    });
    if (!ja) return;
    try {
      await factuurCrediteren(f.id);
      onVeranderd();
      toast.success("Creditfactuur gemaakt. Hij staat als concept klaar.");
    } catch (e) {
      toast.error("Crediteren mislukt: " + (e as Error).message);
    }
  }

  async function weggooien() {
    const ja = await bevestig({
      titel: "Concept weggooien?",
      tekst: "De te factureren regels blijven bestaan: die wachten gewoon op een volgende factuur.",
      bevestigLabel: "Weggooien",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await factuurWeggooien(f.id);
      onVeranderd();
    } catch (e) {
      toast.error("Weggooien mislukt: " + (e as Error).message);
    }
  }

  return (
    <div className={f.te_laat ? "bg-tint-rood/40" : ""}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {concept && !f.nummer && (
          <Checkbox
            checked={gekozen}
            onCheckedChange={(v) => onKies(v === true)}
            aria-label={`${f.klant} kiezen`}
          />
        )}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px]">
            <b className="font-semibold">{f.klant}</b>
            {f.nummer && <span className="text-muted-foreground"> · {f.nummer}</span>}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {stand}
            {f.factuurdatum && ` · ${toonDatum(f.factuurdatum)}`}
            {f.vervaldatum && f.status === "verstuurd" && ` · vervalt ${toonDatum(f.vervaldatum)}`}
            {f.totalen.regels > 0 && ` · ${f.totalen.regels} regel(s)`}
            {!f.mail && <span className="text-tint-rood-ink"> · geen e-mailadres</span>}
          </span>
        </button>
        <span className="w-24 shrink-0 text-right font-display text-[16px] font-semibold tabular-nums">
          {formatPrice(f.totalen.incl)}
        </span>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border/70 bg-surface px-4 py-3">
          {regels.isLoading ? (
            <p className="text-[12.5px] text-muted-foreground">Laden…</p>
          ) : (
            <div className="space-y-1">
              {(regels.data ?? []).map((r) => (
                <div key={r.id} className="flex gap-3 text-[12.5px]">
                  <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                    {toonDatum(r.datum)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {r.omschrijving}
                    {r.notitie && <span className="text-muted-foreground"> · {r.notitie}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatPrice(r.bedrag_incl)}</span>
                </div>
              ))}
              <div className="flex gap-3 border-t border-border/70 pt-1 text-[12.5px] text-muted-foreground">
                <span className="min-w-0 flex-1 text-right">
                  Excl. btw {formatPrice(f.totalen.excl)} · waarvan btw {formatPrice(f.totalen.btw)}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {concept && !f.nummer && (
              <Button size="sm" variant="ghost" onClick={() => void weggooien()}>
                Weggooien
              </Button>
            )}
            {f.status === "verstuurd" && (
              <>
                <Button size="sm" variant="secondary" onClick={() => void afvinken()}>
                  Betaald ({formatPrice(nogOpen)})
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void crediteren()}>
                  Crediteren
                </Button>
              </>
            )}
            {f.betaald_bedrag > 0 && f.status !== "betaald" && (
              <span className="self-center text-[12.5px] text-muted-foreground">
                Al betaald: {formatPrice(f.betaald_bedrag)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
