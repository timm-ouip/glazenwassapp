import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import {
  draaiGeldloopWijzigingTerug,
  fetchGeldloopWijzigingen,
  wijzigingTekst,
} from "@/lib/geldlopen";

/**
 * Het gele vak in het dossier: wat een geldloper de afgelopen twee weken aan
 * dit adres veranderde, met Ongedaan maken. Zo zie je het ook als je het
 * avondoverzicht niet opende.
 */
export function GeldloopWijzigingenVak({ adresId }: { adresId: string }) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const magZien = useRecht("prijzen_zien", "klanten_bekijken");
  const wijzigingen = useQuery({
    queryKey: ["geldloop-wijzigingen", adresId],
    queryFn: () => fetchGeldloopWijzigingen({ adres: adresId }),
    enabled: magZien,
  });
  const grens = Date.now() - 14 * 24 * 3600 * 1000;
  const recent = (wijzigingen.data ?? []).filter(
    (w) => !w.teruggedraaid_op && Date.parse(w.op) > grens,
  );
  if (recent.length === 0) return null;

  async function terug(id: string) {
    try {
      await draaiGeldloopWijzigingTerug(id);
      toast.success("Teruggedraaid");
      void qc.invalidateQueries({ queryKey: ["geldloop-wijzigingen", adresId] });
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["klanten"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-1 rounded-[14px] bg-tint-geel px-3 py-2 text-[13px] text-tint-geel-ink">
      <p className="font-medium">Veranderd door een geldloper</p>
      {recent.map((w) => (
        <div key={w.id} className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            {wijzigingTekst(w)} · {w.door_naam} ·{" "}
            {new Date(w.op).toLocaleString("nl-NL", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isEigenaar && (
            <button
              type="button"
              className="shrink-0 font-medium underline-offset-2 hover:underline"
              onClick={() => void terug(w.id)}
            >
              Ongedaan maken
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
