import { supabase } from "@/integrations/supabase/client";
import type { GeldDeel } from "@/lib/betalingen";

/**
 * Wat een wasser overdag bij een contant adres op zijn route van vandaag
 * ziet: wat er openstaat, met de wasbeurt van vandaag erbij. Het
 * betaalvenster (DagBetalen) en het dossier lezen het.
 */
export interface DagStand {
  open: number;
  open_wassen: number;
  delen: GeldDeel[];
  /**
   * Vooruitbetaalde beurten die dit adres nog kan opmaken (de beurt van
   * vandaag nog niet eraf; die van een vorige bewoner tellen niet).
   */
  vooruit_over: number;
  vandaag: {
    id: string;
    bedrag: number;
    door: string | null;
    door_naam: string;
    op: string;
  } | null;
}

export async function fetchDagStand(adres: string): Promise<DagStand | null> {
  const { data, error } = await supabase.rpc("dag_geld_stand", { adres_id: adres });
  if (error) throw error;
  if (!data) return null;
  const x = data as unknown as DagStand & { vooruit_vast?: number };
  return {
    open: Number(x.open ?? 0),
    open_wassen: Number(x.open_wassen ?? 0),
    delen: (x.delen ?? []).map((d) => ({
      ...d,
      bedrag: Number(d.bedrag),
      rest: Number(d.rest),
      aantal: Number(d.aantal ?? 1),
      omschrijving: d.omschrijving ?? "",
      vooruit: Number(d.vooruit ?? 0),
    })),
    // De server telt ook de beurten mee die niet meer opgemaakt worden.
    vooruit_over: Math.max(0, Number(x.vooruit_over ?? 0) - Number(x.vooruit_vast ?? 0)),
    vandaag: x.vandaag ? { ...x.vandaag, bedrag: Number(x.vandaag.bedrag) } : null,
  };
}
