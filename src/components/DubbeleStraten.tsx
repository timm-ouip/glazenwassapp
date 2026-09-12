import { useMemo, useState } from "react";
import { AlertTriangle, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupVoet,
} from "@/components/Popup";
import { toast } from "sonner";
import { pushUndo } from "@/lib/undo";
import {
  formatNumber,
  sortCustomers,
  straatSleutel,
  type Customer,
  type Street,
} from "@/lib/klanten";

interface Props {
  streets: Street[];
  customers: Customer[];
  onDone: () => void;
}

interface Groep {
  naam: string;
  straten: Street[];
}

export function DubbeleStraten({ streets, customers, onDone }: Props) {
  const [actief, setActief] = useState<Groep | null>(null);
  const [bezig, setBezig] = useState(false);

  const groepen = useMemo<Groep[]>(() => {
    const map = new Map<string, Street[]>();
    for (const s of streets) {
      const key = straatSleutel(s.name);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.values()]
      .filter((lijst) => lijst.length > 1)
      .map((lijst) => ({ naam: lijst[0]!.name, straten: lijst }));
  }, [streets]);

  const klantenVanGroep = (g: Groep) =>
    g.straten.flatMap((s) => customers.filter((c) => c.street_id === s.id));

  const dubbeleNummers = (g: Groep) => {
    const map = new Map<string, Customer[]>();
    for (const c of klantenVanGroep(g)) {
      const key = `${c.house_number}|${(c.addition ?? "").trim().toLowerCase()}`;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.values()].filter((l) => l.length > 1);
  };

  async function samenvoegen(g: Groep) {
    setBezig(true);
    try {
      const doel = g.straten[0]!;
      const overige = g.straten.slice(1);
      const teVerplaatsen = sortCustomers(
        overige.flatMap((s) => customers.filter((c) => c.street_id === s.id)),
      );
      const origineel = teVerplaatsen.map((c) => ({
        id: c.id,
        street_id: c.street_id,
        sort_order: c.sort_order,
      }));
      const max = Math.max(
        0,
        ...customers.filter((c) => c.street_id === doel.id).map((c) => c.sort_order),
      );

      for (const [i, c] of teVerplaatsen.entries()) {
        const { error } = await supabase
          .from("customers")
          .update({ street_id: doel.id, sort_order: max + i + 1 })
          .eq("id", c.id);
        if (error) throw error;
      }
      const { error: delError } = await supabase
        .from("streets")
        .delete()
        .in(
          "id",
          overige.map((s) => s.id),
        );
      if (delError) throw delError;

      pushUndo({
        label: `Samenvoegen ${doel.name}`,
        undo: async () => {
          await supabase.from("streets").insert(overige);
          for (const o of origineel) {
            await supabase
              .from("customers")
              .update({ street_id: o.street_id, sort_order: o.sort_order })
              .eq("id", o.id);
          }
          onDone();
        },
      });

      toast.success(`"${doel.name}" samengevoegd (${teVerplaatsen.length} klanten verplaatst)`);
      setActief(null);
      onDone();
    } catch (e) {
      toast.error("Samenvoegen mislukt: " + (e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  if (groepen.length === 0) return null;

  const dubbels = actief ? dubbeleNummers(actief) : [];

  return (
    <>
      <div className="rounded-lg border border-tint-amber-ink/25 bg-tint-amber p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-tint-amber-ink" />
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {groepen.length === 1
                ? "Er staan 2 of meer straten met dezelfde naam in deze wijk."
                : `${groepen.length} straatnamen komen meerdere keren voor in deze wijk.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {groepen.map((g) => (
                <Button key={g.naam} size="sm" variant="outline" onClick={() => setActief(g)}>
                  <Merge className="size-4" /> {g.naam} ({g.straten.length}×)
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!actief} onOpenChange={(o) => !o && setActief(null)}>
        <PopupKader className="sm:max-w-lg">
          <PopupKop
            icoon={<Merge className="size-[22px]" />}
            titel={`"${actief?.naam}" samenvoegen?`}
            subtitel={`${actief?.straten.length} straten met dezelfde naam worden één straat`}
          />
          <PopupBody>
            <PopupHint>
              Alle klanten komen achter elkaar te staan in de eerste straat. Dit kun je met Ongedaan
              maken terugdraaien.
            </PopupHint>

            {actief && (
              <>
                <PopupBlok label="Wordt samengevoegd">
                  <ul className="divide-y divide-border/60 rounded-xl border border-input text-sm">
                    {actief.straten.map((s, i) => (
                      <li key={s.id} className="flex justify-between gap-2 px-3 py-2">
                        <span>
                          {s.name}{" "}
                          {i === 0 && (
                            <span className="text-xs text-muted-foreground">(blijft bestaan)</span>
                          )}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {customers.filter((c) => c.street_id === s.id).length} klanten
                        </span>
                      </li>
                    ))}
                  </ul>
                </PopupBlok>

                {dubbels.length > 0 ? (
                  <div className="rounded-xl border border-tint-rood-ink/25 bg-tint-rood px-3 py-2.5 text-tint-rood-ink">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      <AlertTriangle className="size-4" /> Let op: {dubbels.length} huisnummer(s)
                      komen dubbel voor
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {dubbels.map((lijst) => (
                        <li key={lijst[0]!.id}>
                          <span className="font-medium">nr {formatNumber(lijst[0]!)}</span> —{" "}
                          {lijst.length}× (
                          {lijst
                            .map((c) => `€ ${c.price}${c.note ? ` · ${c.note}` : ""}`)
                            .join(" / ")}
                          )
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs opacity-80">
                      Deze regels blijven allemaal staan; controleer ze na het samenvoegen zelf.
                    </p>
                  </div>
                ) : (
                  <PopupHint>Geen dubbele huisnummers gevonden.</PopupHint>
                )}
              </>
            )}
          </PopupBody>

          <PopupVoet>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setActief(null)}
              disabled={bezig}
            >
              Annuleren
            </Button>
            <Button
              className="rounded-full"
              onClick={() => actief && void samenvoegen(actief)}
              disabled={bezig}
            >
              Samenvoegen
            </Button>
          </PopupVoet>
        </PopupKader>
      </Dialog>
    </>
  );
}
