import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { rondeVanDag } from "@/lib/dagbouwstenen";
import {
  fetchCustomers,
  fetchStreets,
  formatNumber,
  prijsVoorMaand,
  type Customer,
} from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";
import { pushUndo, undoKnop } from "@/lib/undo";
import {
  alDichtbij,
  dubbelVraag,
  fetchWasdag,
  haalUitWasdag,
  toonDatum,
  vandaag,
  voegToeAanWasdag,
} from "@/lib/wasdag";

/**
 * Na een nieuwe klant: staat zijn straat vandaag op de planning, dan de vraag
 * of hij vandaag meegaat. Je staat er toch al. Ja zet hem op de dag, in het
 * team dat die straat doet, met de prijs van de ronde van vandaag, en met
 * Ongedaan maken. Staat de straat er niet op, dan gebeurt er niets.
 */
export function useOokVandaag() {
  const bevestig = useBevestig();
  const qc = useQueryClient();
  const magPlannen = useRecht("planning");

  return useCallback(
    async (adresId?: string) => {
      async function zetErop(
        datum: string,
        c: Customer,
        adres: string,
        regels: Awaited<ReturnType<typeof fetchWasdag>>,
        inStraat: typeof regels,
      ) {
        const dichtbij = await alDichtbij(datum, [c.id], datum);
        if (dichtbij.size > 0 && !(await bevestig(dubbelVraag(dichtbij)))) return;
        const ronde = rondeVanDag(
          regels.map((r) => ({ datum, ronde: r.ronde })),
          datum,
        );
        await voegToeAanWasdag(datum, [{ customer_id: c.id, prijs: prijsVoorMaand(c, ronde) }], {
          ronde,
          ploeg_nr: meesteTeam(inStraat),
        });
        pushUndo({
          label: `${adres} op ${toonDatum(datum)}`,
          undo: async () => {
            await haalUitWasdag(datum, [c.id]);
            qc.invalidateQueries({ queryKey: ["wasdag"] });
            qc.invalidateQueries({ queryKey: ["wasdagen"] });
          },
        });
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        toast.success(`${adres} staat op ${toonDatum(datum)}`, {
          duration: 10000,
          action: undoKnop(),
        });
      }

      if (!adresId || !magPlannen) return;
      const datum = vandaag();
      // Lukt het nakijken niet (even geen verbinding), dan stil: de klant is
      // wel bewaard, en er was nog niets gevraagd.
      const gelezen = await Promise.all([
        fetchWasdag(datum),
        // Vers: het adres is net aangemaakt en staat nog niet in de cache.
        qc.fetchQuery({ queryKey: ["customers"], queryFn: fetchCustomers, staleTime: 0 }),
        qc.fetchQuery({ queryKey: ["streets"], queryFn: fetchStreets }),
      ]).catch(() => null);
      if (!gelezen) return;
      const [regels, customers, straten] = gelezen;
      try {
        if (regels.some((r) => r.customer_id === adresId)) return;
        const c = customers.find((x) => x.id === adresId);
        if (!c) return;
        const opId = new Map(customers.map((x) => [x.id, x]));
        const inStraat = regels.filter(
          (r) => r.customer_id && opId.get(r.customer_id)?.street_id === c.street_id,
        );
        if (inStraat.length === 0) return;

        const straat = straten.find((s) => s.id === c.street_id)?.name ?? "";
        const adres = `${straat} ${formatNumber(c)}`.trim();
        const ja = await bevestig({
          titel: "Ook vandaag meewassen?",
          tekst: `${straat} staat vandaag op de planning. Zal ik ${adres} er ook op zetten?`,
          bevestigLabel: "Ja, vandaag erbij",
          annuleerLabel: "Nee",
        });
        if (!ja) return;
        await zetErop(datum, c, adres, regels, inStraat);
      } catch (e) {
        toast.error("Op de dag zetten mislukt: " + (e as Error).message);
      }
    },
    [bevestig, qc, magPlannen],
  );
}

/** Het team dat de meeste adressen van die straat doet; geen = nog niet ingedeeld. */
function meesteTeam(regels: { ploeg_nr?: number | null }[]): number | null {
  const tel = new Map<number, number>();
  for (const r of regels)
    if (r.ploeg_nr != null) tel.set(r.ploeg_nr, (tel.get(r.ploeg_nr) ?? 0) + 1);
  return [...tel].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
