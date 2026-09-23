import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconX as Kruis } from "@tabler/icons-react";

import { useAuth } from "@/lib/auth";
import { draaiGeldloopWijzigingTerug, fetchVergeten } from "@/lib/geldlopen";
import { toonDatum, vandaag, verplaatsWasdag } from "@/lib/wasdag";

/**
 * Wat er op deze dag is overgeslagen: adressen waarvan een geldloper aan de
 * deur hoorde dat er niet gewassen was. Ze blijven op de dag staan, rood en
 * zonder bedrag — deze strook zet ze bij elkaar, zodat je ze meeneemt als je
 * nog een keer in die wijk bent.
 *
 * Twee wegen eruit. Bleek het een vergissing — er is wél gewassen — dan haalt
 * "Toch gewassen" de markering eraf; er verhuist niets. Moet hij echt nog een
 * beurt, dan zet "Verplaatsen" hem op een andere dag: daar staat hij weer
 * gewoon zwart, met zijn bedrag, want een nieuwe dag is een nieuwe kans.
 */
export function VergetenStrook({ datum }: { datum: string }) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  // Bij welk adres het datumvakje openstaat.
  const [verplaatst, setVerplaatst] = useState<string | null>(null);
  const vergeten = useQuery({
    queryKey: ["vergeten", datum],
    queryFn: () => fetchVergeten(datum, datum),
    // Mag je deze lijst niet zien, dan blijft de strook gewoon leeg; opnieuw
    // vragen levert hetzelfde antwoord op.
    retry: false,
  });
  const lijst = vergeten.data ?? [];
  if (lijst.length === 0) return null;

  /** Wat er na een wijziging opnieuw opgehaald moet worden. */
  function ververs() {
    void qc.invalidateQueries({ queryKey: ["vergeten"] });
    void qc.invalidateQueries({ queryKey: ["niet-gewassen"] });
    void qc.invalidateQueries({ queryKey: ["wasdag"] });
    void qc.invalidateQueries({ queryKey: ["wasdagen"] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
  }

  async function terugzetten(id: string, adres: string) {
    try {
      await draaiGeldloopWijzigingTerug(id);
      toast.success(`${adres} telt weer als gewassen op ${toonDatum(datum)}.`);
      ververs();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function verplaats(customerId: string, adres: string, naar: string) {
    // Een datumvakje geeft zijn waarde al door zodra dag, maand en jaar
    // ingevuld zijn; wie het jaartal traag intikt zou anders naar het jaar 20
    // verhuizen. Vandaar deze controle, en niet alleen de min in de HTML.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(naar) || naar === datum) return;
    if (naar < vandaag()) {
      toast.error("Kies een dag van vandaag of later.");
      return;
    }
    setVerplaatst(null);
    try {
      await verplaatsWasdag(datum, naar, [customerId]);
      toast.success(`${adres} staat nu op ${toonDatum(naar)}, met zijn bedrag erbij.`);
      ververs();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="rounded-[18px] bg-tint-rood px-4 py-3 text-[13px] text-tint-rood-ink shadow-card">
      <p className="flex items-center gap-1.5 font-medium">
        <Kruis className="size-4" />
        {lijst.length === 1
          ? "Eén adres is niet gewassen"
          : `${lijst.length} adressen zijn niet gewassen`}
      </p>
      <div className="mt-1.5 divide-y divide-tint-rood-ink/15">
        {lijst.map((v) => (
          <div key={v.id} className="flex items-start gap-3 py-1.5">
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{v.adres}</b> · teruggemeld door {v.door_naam}
            </span>
            {/* Onder elkaar: twee knoppen naast elkaar op een smal scherm
                staan te dicht op elkaar om er zeker de goede te raken. */}
            {isEigenaar && (
              <span className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  title={`De beurt blijft op ${toonDatum(datum)} staan en telt weer als gewassen, met zijn bedrag erbij`}
                  className="min-h-8 font-medium underline-offset-2 hover:underline"
                  onClick={() => void terugzetten(v.id, v.adres)}
                >
                  Toch gewassen
                </button>
                {verplaatst === v.id ? (
                  <input
                    autoFocus
                    type="date"
                    min={vandaag()}
                    aria-label={`Nieuwe dag voor ${v.adres}`}
                    className="h-8 rounded-full border border-tint-rood-ink/30 bg-card px-2.5 text-[12.5px] text-foreground"
                    onChange={(e) => void verplaats(v.customer_id, v.adres, e.target.value)}
                    onBlur={() => setVerplaatst(null)}
                  />
                ) : (
                  <button
                    type="button"
                    title="Zet deze beurt op een andere dag; daar telt hij weer gewoon mee"
                    className="min-h-8 font-medium underline-offset-2 hover:underline"
                    onClick={() => setVerplaatst(v.id)}
                  >
                    Verplaatsen
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
