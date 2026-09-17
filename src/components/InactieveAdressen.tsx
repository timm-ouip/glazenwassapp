/**
 * De adressen in deze wijk die gestopt of verhuisd zijn. Ze staan niet meer
 * op de wijklijst of de planning, maar alles is bewaard: hier zie je waarom
 * en sinds wanneer, en zet je ze met één knop weer actief.
 */
import { useState } from "react";
import { IconLoader2 as Loader2, IconRotate as RotateCcw } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatPrice, type Klant, type Street } from "@/lib/klanten";
import { redenLabel, zetActief, type InactiefAdres } from "@/lib/stoppen";
import { useRecht } from "@/lib/rechten";

function frequentie(a: InactiefAdres): string {
  return a.interval_maanden <= 1 ? "elke maand" : `om de ${a.interval_maanden} maanden`;
}

function sinds(tijd: string): string {
  return new Date(tijd).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export function InactieveAdressen({
  adressen,
  straten,
  klanten,
  laden,
  onGewijzigd,
}: {
  adressen: InactiefAdres[];
  /** De straten van de wijk die je bekijkt. */
  straten: Street[];
  klanten: Klant[];
  laden: boolean;
  onGewijzigd: () => void;
}) {
  const [bezig, setBezig] = useState<string | null>(null);
  const prijzenZien = useRecht("prijzen_zien");
  // Weer actief zetten is een klant wijzigen.
  const magKlanten = useRecht("klanten_bewerken");
  const straatVan = new Map(straten.map((s) => [s.id, s]));
  const klantVan = new Map(klanten.map((k) => [k.id, k]));
  const inWijk = adressen.filter((a) => straatVan.has(a.street_id));

  async function maakActief(a: InactiefAdres, adres: string) {
    setBezig(a.id);
    try {
      await zetActief([a.id]);
      toast.success(
        a.inactief_reden === "verhuisd"
          ? `${adres} staat weer actief. De oude klantgegevens liggen nog in de prullenbak.`
          : `${adres} staat weer actief.`,
      );
      onGewijzigd();
    } catch (e) {
      toast.error("Dat lukte niet: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(null);
    }
  }

  if (laden) return <p className="text-[13px] text-muted-foreground">Bezig met ophalen…</p>;

  if (inWijk.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
        <p className="font-display text-lg font-semibold">Geen inactieve adressen</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Laat je een klant stoppen (rechtermuisknop op een adres), dan komt het adres hier te staan, met
          alles wat erbij hoorde.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[18px] border border-border bg-card shadow-card">
      <table className="w-full min-w-[44rem] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-card-header text-left text-[11px] font-medium text-muted-foreground/80">
            <th className="px-3 py-2.5">adres</th>
            <th className="px-3 py-2.5">klant</th>
            <th className="px-3 py-2.5">reden</th>
            <th className="px-3 py-2.5">sinds</th>
            {prijzenZien && <th className="px-3 py-2.5 text-right">prijs</th>}
            <th className="px-3 py-2.5">frequentie</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {inWijk.map((a) => {
            const straat = straatVan.get(a.street_id);
            const adres = `${straat?.name ?? ""} ${a.house_number}${a.addition}`.trim();
            const klant = a.klant_id ? klantVan.get(a.klant_id) : undefined;
            return (
              <tr key={a.id} className="border-b border-border/60 last:border-b-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{adres}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {klant?.naam || (a.inactief_reden === "verhuisd" ? "in de prullenbak" : "—")}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                      a.inactief_reden === "verhuisd"
                        ? "bg-tint-blauw text-tint-blauw-ink"
                        : "bg-tint-amber text-tint-amber-ink"
                    }`}
                  >
                    {redenLabel(a.inactief_reden)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{sinds(a.inactief_op)}</td>
                {prijzenZien && <td className="px-3 py-2 text-right tabular-nums">{formatPrice(a.price)}</td>}
                <td className="px-3 py-2 text-muted-foreground">{frequentie(a)}</td>
                <td className="px-3 py-2 text-right">
                  {magKlanten && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full"
                    disabled={bezig !== null}
                    onClick={() => void maakActief(a, adres)}
                  >
                    {bezig === a.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    Weer actief
                  </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
