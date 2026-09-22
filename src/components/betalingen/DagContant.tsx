import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconCash as Cash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopupBlok } from "@/components/Popup";
import { supabase } from "@/integrations/supabase/client";
import { rekening, type GeldDeel } from "@/lib/betalingen";
import { useAuth } from "@/lib/auth";
import { boek, nieuweTik } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";

interface DagStand {
  open: number;
  delen: GeldDeel[];
  vandaag: {
    id: string;
    bedrag: number;
    door: string | null;
    door_naam: string;
    op: string;
  } | null;
}

async function fetchDagStand(adres: string): Promise<DagStand | null> {
  const { data, error } = await supabase.rpc("dag_geld_stand", { adres_id: adres });
  if (error) throw error;
  if (!data) return null;
  const x = data as unknown as DagStand;
  return {
    open: Number(x.open ?? 0),
    delen: (x.delen ?? []).map((d) => ({
      ...d,
      bedrag: Number(d.bedrag),
      rest: Number(d.rest),
      aantal: Number(d.aantal ?? 1),
      omschrijving: d.omschrijving ?? "",
    })),
    vandaag: x.vandaag ? { ...x.vandaag, bedrag: Number(x.vandaag.bedrag) } : null,
  };
}

function leesBedrag(tekst: string): number | null {
  const n = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * Betaalt een klant overdag contant aan de wasser, dan tikt die het hier in.
 * Alleen bij een contant adres op de route van vandaag; de wasser ziet dan
 * het bedrag van alleen dit adres, met de wasbeurt van vandaag erbij.
 */
export function DagContant({ adres }: { adres: string }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const stand = useQuery({
    queryKey: ["dag-geld", adres],
    queryFn: () => fetchDagStand(adres),
  });
  const [ander, setAnder] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  /** Een betaling die misging (bijv. geen bereik): nog eens met hetzelfde id,
   *  zodat hij niet dubbel telt als hij de eerste keer toch binnenkwam. */
  const vorige = useRef<ReturnType<typeof nieuweTik> | null>(null);
  const s = stand.data;
  // Staat de betaling van vandaag er al, dan hoeft er niets opnieuw.
  if (s?.vandaag) vorige.current = null;
  if (!s) return null;

  async function tik(bedrag: number) {
    setBezig(true);
    const t =
      vorige.current?.bedrag === bedrag
        ? vorige.current
        : nieuweTik({ adres, soort: "betaald", bedrag, bron: "dag", getoond_open: s!.open });
    vorige.current = t;
    try {
      await boek(t);
      vorige.current = null;
      toast.success(`Betaald ${formatPrice(bedrag)}`);
      setAnder(null);
      void qc.invalidateQueries({ queryKey: ["dag-geld", adres] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function herstel(id: string) {
    vorige.current = null;
    setBezig(true);
    try {
      await boek(nieuweTik({ adres, soort: "ongedaan", herroept: id, bron: "dag" }));
      toast("Teruggedraaid");
      void qc.invalidateQueries({ queryKey: ["dag-geld", adres] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  const regels = rekening(s.delen);

  return (
    <PopupBlok label="Contant betaald?">
      {s.vandaag && (
        <div className="flex items-center gap-2 rounded-[12px] bg-tint-groen px-3 py-2 text-[13px] text-tint-groen-ink">
          <Cash className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Betaald {formatPrice(s.vandaag.bedrag)} · {s.vandaag.door_naam} om{" "}
            {new Date(s.vandaag.op).toLocaleTimeString("nl-NL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {(s.vandaag.door === employee?.id || employee?.rol === "eigenaar") && (
            <button
              type="button"
              disabled={bezig}
              className="shrink-0 font-medium underline-offset-2 hover:underline"
              onClick={() => void herstel(s.vandaag!.id)}
            >
              Ongedaan maken
            </button>
          )}
        </div>
      )}
      {s.open > 0.005 && (
        <>
          <div className="rounded-[12px] bg-surface px-3 py-2 text-[13px]">
            {regels.map((r, i) => (
              <div key={i} className="flex justify-between gap-3 py-0.5">
                <span>
                  {r.label} <span className="text-muted-foreground">{r.wanneer}</span>
                </span>
                <span className="tabular-nums">{formatPrice(r.bedrag)}</span>
              </div>
            ))}
          </div>
          {ander === null ? (
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-11 flex-1 rounded-full bg-tint-groen-ink text-card hover:bg-tint-groen-ink/90"
                disabled={bezig}
                onClick={() => void tik(s.open)}
              >
                Betaald {formatPrice(s.open)}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => setAnder("")}
              >
                Ander bedrag
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                autoFocus
                inputMode="decimal"
                className="h-11 flex-1 rounded-full"
                placeholder="€ 0"
                value={ander}
                onChange={(e) => setAnder(e.target.value)}
              />
              <Button
                type="button"
                className="h-11 rounded-full"
                disabled={bezig || !leesBedrag(ander)}
                onClick={() => {
                  const b = leesBedrag(ander);
                  if (b) void tik(b);
                }}
              >
                Betaald
              </Button>
            </div>
          )}
        </>
      )}
    </PopupBlok>
  );
}
