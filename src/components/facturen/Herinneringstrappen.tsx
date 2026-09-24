/**
 * De trappen van de herinneringen.
 *
 * Na hoeveel dagen er een mail achter een onbetaalde factuur aan gaat, en wat
 * erin staat. Twee staan er klaar -- na zeven en na eenentwintig dagen -- maar
 * de teksten zijn van jou; ze staan er alleen zodat je niet met een leeg
 * scherm begint.
 *
 * Wat hier gebeurt is zichtbaar en terug te draaien: een dag voordat er iets
 * weggaat staat het geel aangekondigd in de facturenlijst, met een knop om het
 * tegen te houden. Daarom mag dit scherm gewoon een instelling zijn en hoeft
 * er geen waarschuwing omheen.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconPlus as Plus, IconTrash as Trash2 } from "@tabler/icons-react";
import { toast } from "sonner";

import {
  bewaarHerinneringstrap,
  fetchHerinneringstrappen,
  HERINNERING_VELDEN,
  nieuweHerinneringstrap,
  verwijderHerinneringstrap,
  type Herinneringstrap,
} from "@/lib/facturen";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function Herinneringstrappen({ mag }: { mag: boolean }) {
  const trappen = useQuery({
    queryKey: ["herinneringstrappen"],
    queryFn: fetchHerinneringstrappen,
  });
  const bevestig = useBevestig();
  const [bezig, setBezig] = useState(false);

  async function voegToe() {
    setBezig(true);
    try {
      await nieuweHerinneringstrap(trappen.data ?? []);
      await trappen.refetch();
    } catch (e) {
      toast.error("Niet gelukt: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  async function weg(t: Herinneringstrap) {
    const ja = await bevestig({
      titel: `Trap ${t.volgnummer} weghalen?`,
      tekst:
        "Facturen die deze trap al gehad hebben, krijgen hem niet nog eens. Facturen die hier nog" +
        " niet aan toe waren, schuiven door naar de eerstvolgende trap die aanstaat.",
      bevestigLabel: "Weghalen",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await verwijderHerinneringstrap(t.id);
      await trappen.refetch();
    } catch (e) {
      toast.error("Niet gelukt: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <section className="space-y-3 rounded-[14px] border border-border p-4">
      <div>
        <h3 className="text-sm font-medium">Herinneringen</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          Staat een factuur over de vervaldatum, dan gaat er vanzelf een mail achteraan. Een dag van
          tevoren zie je in de facturenlijst wat er weggaat, met een knop om het tegen te houden.
        </p>
      </div>

      {trappen.isLoading ? (
        <p className="text-[12.5px] text-muted-foreground">Laden…</p>
      ) : (trappen.data ?? []).length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          Er staan geen trappen ingesteld, dus er gaat niets vanzelf weg.
        </p>
      ) : (
        <div className="space-y-3">
          {(trappen.data ?? []).map((t) => (
            <Trap key={t.id} trap={t} mag={mag} onWeg={() => void weg(t)} />
          ))}
        </div>
      )}

      {mag && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={bezig}
          onClick={() => void voegToe()}
        >
          <Plus className="size-3.5" />
          Trap erbij
        </Button>
      )}
      <p className="text-[12px] text-muted-foreground">
        In de teksten mag je {HERINNERING_VELDEN.map((v) => `{{${v}}}`).join(", ")} gebruiken; die
        worden ingevuld. Er komt vanzelf een regel onder met je IBAN, en de betaalknop van Mollie
        als die gekoppeld is.
      </p>
    </section>
  );
}

function Trap({ trap, mag, onWeg }: { trap: Herinneringstrap; mag: boolean; onWeg: () => void }) {
  const [velden, setVelden] = useState(trap);
  const [bezig, setBezig] = useState(false);

  useEffect(() => setVelden(trap), [trap]);

  const veranderd =
    velden.na_dagen !== trap.na_dagen ||
    velden.onderwerp !== trap.onderwerp ||
    velden.tekst !== trap.tekst ||
    velden.aan !== trap.aan;

  async function bewaar(vorm: Herinneringstrap) {
    setBezig(true);
    try {
      await bewaarHerinneringstrap(vorm);
      toast.success("Opgeslagen.");
    } catch (e) {
      toast.error("Niet gelukt: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-2 rounded-[10px] border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">
          {trap.volgnummer === 1 ? "1e" : `${trap.volgnummer}e`} herinnering
        </span>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            max={365}
            disabled={!mag}
            className="h-8 w-20"
            value={velden.na_dagen}
            onChange={(e) =>
              setVelden((v) => ({ ...v, na_dagen: Math.max(0, Number(e.target.value) || 0) }))
            }
          />
          <span className="text-[12.5px] text-muted-foreground">dagen na de vervaldatum</span>
        </div>
        <label className="ml-auto flex items-center gap-2 text-[12.5px]">
          {velden.aan ? "Aan" : "Uit"}
          <Switch
            checked={velden.aan}
            disabled={!mag}
            onCheckedChange={(b) => {
              const vorm = { ...velden, aan: b };
              setVelden(vorm);
              // Een schakelaar waar je daarna nog op "opslaan" moet drukken is
              // een schakelaar die niet doet wat hij zegt.
              void bewaar(vorm);
            }}
          />
        </label>
        {mag && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-full text-muted-foreground"
            onClick={onWeg}
            aria-label="Trap weghalen"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-[12.5px]">Onderwerp</Label>
        <Input
          disabled={!mag}
          className="h-9 text-[13.5px]"
          value={velden.onderwerp}
          onChange={(e) => setVelden((v) => ({ ...v, onderwerp: e.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[12.5px]">Tekst</Label>
        <Textarea
          rows={6}
          disabled={!mag}
          className="text-[13.5px]"
          value={velden.tekst}
          onChange={(e) => setVelden((v) => ({ ...v, tekst: e.target.value }))}
        />
      </div>
      {mag && veranderd && (
        <Button
          size="sm"
          className="rounded-full"
          disabled={bezig}
          onClick={() => void bewaar(velden)}
        >
          Opslaan
        </Button>
      )}
    </div>
  );
}
