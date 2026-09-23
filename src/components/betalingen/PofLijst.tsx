import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconArrowLeft as ArrowLeft } from "@tabler/icons-react";

import { ROOD_VANAF } from "@/components/betalingen/GeldloopScherm";
import { rekening } from "@/lib/betalingen";
import { fetchDistricts, formatPrice } from "@/lib/klanten";
import { fetchPof, type PofRegel } from "@/lib/overzichten";
import { toonDatum } from "@/lib/wasdag";

function datumVan(iso: string): string {
  const d = new Date(iso);
  return toonDatum(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  );
}

/**
 * Wie er nog moet betalen, het hoogste bedrag bovenaan. Vanaf drie
 * wasbeurten open kleurt een adres rood. Tegoed staat apart onderaan.
 */
export function PofLijst({
  onKaart,
  onTerug,
}: {
  onKaart: (straat: string) => void;
  /** Terug naar het overzicht; pof is geen tabblad meer. */
  onTerug?: () => void;
}) {
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const [wijk, setWijk] = useState<string | null>(null);
  const pof = useQuery({
    queryKey: ["geld-pof", wijk],
    queryFn: () => fetchPof(wijk ? [wijk] : null),
  });
  const regels = pof.data ?? [];
  const open = useMemo(() => regels.filter((r) => r.open > 0.005), [regels]);
  const tegoed = useMemo(() => regels.filter((r) => r.open < -0.005), [regels]);
  const totaal = open.reduce((t, r) => t + r.open, 0);

  return (
    <div className="space-y-3 pb-4">
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
        {[{ id: null, name: "Alle wijken" }, ...(districts.data ?? [])].map((d) => (
          <button
            key={d.id ?? "alle"}
            type="button"
            onClick={() => setWijk(d.id)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              wijk === d.id
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {d.name}
          </button>
        ))}
        <span className="ml-auto text-[13px] text-muted-foreground">
          {open.length} adressen ·{" "}
          <span className="font-medium text-foreground tabular-nums">{formatPrice(totaal)}</span>{" "}
          open
        </span>
      </div>

      {pof.isLoading && <p className="text-[13px] text-muted-foreground">Laden…</p>}

      <section className="overflow-hidden rounded-[24px] border border-border bg-card shadow-card">
        {open.length === 0 && !pof.isLoading ? (
          <p className="p-4 text-[13px] text-muted-foreground">Er staat nergens iets open.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {open.map((r) => (
              <Regel key={r.id} r={r} onKaart={onKaart} />
            ))}
          </div>
        )}
      </section>

      {tegoed.length > 0 && (
        <section className="rounded-[24px] border border-border bg-card p-4 shadow-card">
          <h2 className="mb-1 font-display text-[15px] font-semibold">Tegoed</h2>
          <p className="mb-2 text-[12.5px] text-muted-foreground">
            Te veel betaald, of een betaalde wasbeurt die later is weggehaald. Gaat vanzelf af van
            de volgende keer.
          </p>
          <div className="divide-y divide-border/70">
            {tegoed.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1">
                  {r.straat} {r.house_number}
                  {r.addition}
                  {r.naam && <span className="text-muted-foreground"> · {r.naam}</span>}
                </span>
                <span className="tabular-nums text-tint-groen-ink">{formatPrice(-r.open)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Regel({ r, onKaart }: { r: PofRegel; onKaart: (straat: string) => void }) {
  const rood = r.open_wassen >= ROOD_VANAF;
  const rek = rekening(r.delen);
  return (
    <button
      type="button"
      onClick={() => onKaart(r.straat_id)}
      title="Op de kaart bekijken"
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface ${
        rood ? "bg-tint-rood/50" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${rood ? "text-tint-rood-ink" : ""}`}>
          <b className="font-semibold">
            {r.straat} {r.house_number}
            {r.addition}
          </b>
          {r.naam && <span> · {r.naam}</span>}
          {r.gestopt && <span className="text-muted-foreground"> · gestopt</span>}
          {r.methode === "overmaken" && (
            <span className="text-muted-foreground"> · maakt over</span>
          )}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {r.wijk} · {rek.map((x) => `${x.label.toLowerCase()} ${x.wanneer}`).join(" + ")}
          {r.laatste_poging &&
            ` · ${r.laatste_poging.soort === "niet_thuis" ? "niet thuis" : "geen geld"} ${datumVan(r.laatste_poging.op)}`}
          {r.laatst_betaald && ` · laatst betaald ${datumVan(r.laatst_betaald)}`}
        </span>
      </span>
      {rood && (
        <span className="shrink-0 rounded-full bg-tint-rood px-2 py-0.5 text-[11.5px] font-medium text-tint-rood-ink">
          {r.open_wassen}× open
        </span>
      )}
      <span
        className={`w-20 shrink-0 text-right font-display text-[16px] font-semibold tabular-nums ${
          rood ? "text-tint-rood-ink" : ""
        }`}
      >
        {formatPrice(r.open)}
      </span>
    </button>
  );
}
