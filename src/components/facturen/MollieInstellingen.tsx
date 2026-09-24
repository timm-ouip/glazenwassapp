/**
 * Mollie koppelen: de knop "Direct betalen" onder de factuurmail.
 *
 * Zonder Mollie werkt het factureren gewoon; er staat dan een IBAN en een
 * betaalkenmerk op de factuur en je vinkt betalingen met de hand af. Met
 * Mollie komt daar een knop bij waarmee de klant met iDEAL betaalt, en vinkt
 * een melding van Mollie de factuur vanzelf af.
 *
 * De sleutel wordt hier één keer ingetypt en verdwijnt daarna uit beeld: hij
 * gaat versleuteld naar de server en komt nooit meer terug naar de browser.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle as Waarschuwing, IconCheck as Check } from "@tabler/icons-react";
import { toast } from "sonner";

import { fetchMollieModus, koppelMollie, ontkoppelMollie } from "@/lib/mollie";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MollieInstellingen({ mag }: { mag: boolean }) {
  const modus = useQuery({ queryKey: ["mollie-modus"], queryFn: fetchMollieModus });
  const [sleutel, setSleutel] = useState("");
  const [bezig, setBezig] = useState(false);

  async function koppel() {
    if (!sleutel.trim()) return;
    setBezig(true);
    try {
      await koppelMollie(sleutel.trim());
      setSleutel("");
      await modus.refetch();
      toast.success("Mollie is gekoppeld.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  async function ontkoppel() {
    setBezig(true);
    try {
      await ontkoppelMollie();
      await modus.refetch();
      toast.success("Mollie is losgekoppeld.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  const nu = modus.data ?? null;

  return (
    <section className="space-y-3 rounded-[14px] border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">Online betalen (Mollie)</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Zet een knop &ldquo;Direct betalen&rdquo; in de factuurmail. Betaalt de klant daarmee, dan
          vinkt de factuur zichzelf af. Je IBAN blijft er gewoon op staan, en met de hand afvinken
          blijft werken.
        </p>
      </div>

      {modus.isLoading ? (
        <p className="text-[12.5px] text-muted-foreground">Laden…</p>
      ) : nu ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {nu === "live" ? (
              <span className="flex items-center gap-1.5 text-[13px]">
                <Check className="size-4 text-emerald-600" />
                Gekoppeld met je echte sleutel — er gaat echt geld overheen.
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[13px]">
                <Waarschuwing className="size-4 text-amber-600" />
                Gekoppeld met je <strong>testsleutel</strong>. Klanten kunnen hiermee niet echt
                betalen.
              </span>
            )}
          </div>
          {mag && (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              disabled={bezig}
              onClick={() => void ontkoppel()}
            >
              Loskoppelen
            </Button>
          )}
          <p className="text-[12px] text-muted-foreground">
            Losmaken haalt alleen de sleutel weg. Betaallinks die al bij klanten liggen blijven
            werken — ze worden alleen niet meer vanzelf afgevinkt.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="molliesleutel" className="text-[12.5px]">
              API-sleutel van Mollie
            </Label>
            <Input
              id="molliesleutel"
              type="password"
              autoComplete="off"
              disabled={!mag || bezig}
              placeholder="test_… of live_…"
              value={sleutel}
              onChange={(e) => setSleutel(e.target.value)}
            />
          </div>
          {mag ? (
            <Button
              size="sm"
              className="rounded-full"
              disabled={bezig || !sleutel.trim()}
              onClick={() => void koppel()}
            >
              Koppelen
            </Button>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Alleen de eigenaar kan Mollie koppelen.
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">
            Die staat in je Mollie-dashboard onder Ontwikkelaars → API-sleutels. Begin met de
            <strong> testsleutel</strong>: dan kun je de hele weg een keer doorlopen zonder dat er
            geld in beweging komt. De sleutel wordt versleuteld bewaard en is daarna nergens meer
            terug te lezen.
          </p>
        </div>
      )}
    </section>
  );
}
