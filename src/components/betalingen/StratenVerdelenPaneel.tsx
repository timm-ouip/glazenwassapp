import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  fetchStraatVerdeling,
  verdeelEerlijk,
  verdeelStraat,
  type Vrijgave,
} from "@/lib/geldlopen";
import { fetchStreets } from "@/lib/klanten";

/**
 * De straten van een avond, met per straat wie hem loopt. Vink niemand aan en
 * de straat is van iedereen — zoals het ging vóór er verdeeld werd.
 *
 * "Eerlijk verdelen" legt de grootste straat bij wie tot dan toe het minst
 * heeft, zodat iedereen ongeveer evenveel deuren krijgt en straten heel
 * blijven. Je kunt er daarna gewoon overheen klikken, en de lopers mogen het
 * 's avonds zelf nog omgooien.
 */
export function StratenVerdelenPaneel({ vrijgave }: { vrijgave: Vrijgave }) {
  const qc = useQueryClient();
  const [bezig, setBezig] = useState(false);
  const lopers = vrijgave.lopers ?? [];
  const wijkIds = new Set(vrijgave.wijken.map((w) => w.id));
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, staleTime: 5 * 60_000 });
  const verdeling = useQuery({
    queryKey: ["straat-verdeling", vrijgave.id],
    queryFn: () => fetchStraatVerdeling(vrijgave.id),
  });

  const straten = (streets.data ?? [])
    .filter((s) => wijkIds.has(s.district_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["straat-verdeling", vrijgave.id] });
    void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] });
  }

  async function wissel(straatId: string, loperId: string) {
    // Zonder de huidige verdeling zou één klik de rest van een straat stil
    // overschrijven; daarom kan dit pas als hij binnen is.
    if (!verdeling.data) return;
    const nu = verdeling.data.get(straatId) ?? [];
    const straks = nu.includes(loperId) ? nu.filter((x) => x !== loperId) : [...nu, loperId];
    setBezig(true);
    try {
      await verdeelStraat(vrijgave.id, straatId, straks);
      ververs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function eerlijk() {
    setBezig(true);
    try {
      const uit = await verdeelEerlijk(vrijgave.id);
      ververs();
      toast.success(`${uit.straten} straten verdeeld over ${uit.lopers} lopers`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  if (lopers.length === 0) {
    return (
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Er is niemand aan deze avond gekoppeld.
      </p>
    );
  }

  if (verdeling.isError) {
    return (
      <p className="mt-2 text-[12.5px] text-tint-rood-ink">
        De verdeling kon niet opgehaald worden. Ververs de pagina om het opnieuw te proberen.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={bezig || lopers.length < 2}
          title={
            lopers.length < 2
              ? "Er loopt maar één iemand: er valt niets te verdelen"
              : "Verdeelt de straten op aantal adressen, zodat iedereen ongeveer evenveel deuren krijgt"
          }
          onClick={() => void eerlijk()}
        >
          Eerlijk verdelen
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Niemand aangevinkt: die straat is van iedereen.
        </span>
      </div>

      <div className="divide-y divide-border/70 rounded-[14px] border border-border">
        {straten.map((s) => {
          const bij = verdeling.data?.get(s.id) ?? [];
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{s.name}</span>
              <span className="flex flex-wrap gap-1">
                {lopers.map((l) => {
                  const aan = bij.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={aan}
                      disabled={bezig || !verdeling.data}
                      onClick={() => void wissel(s.id, l.id)}
                      className={`min-h-8 rounded-full border px-2.5 text-[12px] font-medium disabled:opacity-50 ${
                        aan
                          ? "border-transparent bg-tint-blauw text-tint-blauw-ink"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {l.naam.split(" ")[0]}
                    </button>
                  );
                })}
              </span>
            </div>
          );
        })}
        {straten.length === 0 && (
          <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
            Deze wijk heeft nog geen straten.
          </p>
        )}
      </div>
    </div>
  );
}
