import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nieuweStraatGroep, type StraatGroep, type Street } from "@/lib/klanten";
import { zoekStraten } from "@/lib/postcode";
import { opslaanBijEnter } from "@/lib/dialoog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  street: Street | null;
  /** De subgroepen van deze wijk, om de straat in te kunnen zetten. */
  groepen: StraatGroep[];
  districtId?: string | undefined;
  /** Woonplaats van de wijk; nodig om straatnamen te kunnen voorstellen. */
  plaats?: string | undefined;
  onSaved: () => void;
}

/** De waarde in de keuzelijst voor "hoort bij geen enkele groep". Een lege
 *  string kan niet: Radix gebruikt die voor "nog niets gekozen". */
const GEEN = "geen";
/** En dit is de regel onderaan waarmee je er ter plekke een maakt. */
const NIEUW = "nieuw";

export function StraatDialog({
  open,
  onOpenChange,
  street,
  groepen,
  districtId,
  plaats,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [volledig, setVolledig] = useState("");
  const [suggesties, setSuggesties] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** Het id van de gekozen groep, of GEEN, of NIEUW. */
  const [groep, setGroep] = useState<string>(GEEN);
  /** De naam die je intikt als je NIEUW koos. */
  const [nieuweNaam, setNieuweNaam] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(street?.name ?? "");
    setVolledig(street?.volledige_naam ?? "");
    setSuggesties([]);
    setGroep(street?.groep_id ?? GEEN);
    setNieuweNaam("");
  }, [open, street]);

  // Officiële straatnamen voorstellen op basis van wat er in het korte veld
  // staat: "Ameland" leidt zo naar Amelandstraat.
  useEffect(() => {
    if (!open || !plaats?.trim()) return;
    const zoekterm = volledig.trim() || name.trim();
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekStraten(zoekterm, plaats, ac.signal).then((namen) => {
        if (!ac.signal.aborted) setSuggesties(namen ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [open, plaats, name, volledig]);

  async function save() {
    if (!name.trim()) {
      toast.error("Vul een straatnaam in.");
      return;
    }
    if (groep === NIEUW && !nieuweNaam.trim()) {
      toast.error("Geef de nieuwe groep een naam.");
      return;
    }
    setSaving(true);

    // Koos je "Nieuwe groep…", dan bestaat die groep nog niet: eerst maken,
    // dan de straat opslaan met het id dat daaruit komt. Lukt het maken niet,
    // dan slaan we ook de straat niet op — anders staat hij straks in een
    // groep die er niet is.
    let groepId: string | null = groep === GEEN || groep === NIEUW ? null : groep;
    if (groep === NIEUW) {
      try {
        const volgende = Math.max(0, ...groepen.map((g) => g.sort_order)) + 1;
        groepId = await nieuweStraatGroep(districtId!, nieuweNaam, volgende);
      } catch (e) {
        setSaving(false);
        toast.error("Groep aanmaken mislukt: " + (e as Error).message);
        return;
      }
    }

    const payload = {
      name: name.trim(),
      volledige_naam: volledig.trim(),
      groep_id: groepId,
    };
    const { error } = street
      ? await supabase.from("streets").update(payload).eq("id", street.id)
      : await supabase
          .from("streets")
          .insert({ ...payload, sort_order: 0, district_id: districtId! });
    setSaving(false);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      return;
    }
    toast.success(street ? "Straat bijgewerkt" : "Straat toegevoegd");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onKeyDown={opslaanBijEnter(save)}>
        <DialogHeader>
          <DialogTitle>{street ? "Straat bewerken" : "Straat toevoegen"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="straat">Naam op de lijst</Label>
            <Input id="straat" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Kort houden — zo staat hij op de printlijst.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="volledig">Volledige straatnaam</Label>
            <Input
              id="volledig"
              list="straat-suggesties"
              placeholder={name.trim() ? `bijv. ${name.trim()}straat` : "Amelandstraat"}
              value={volledig}
              onChange={(e) => setVolledig(e.target.value)}
            />
            <datalist id="straat-suggesties">
              {suggesties.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              De officiële naam, waarmee postcodes opgezocht worden. Mag leeg blijven als dit geen
              echte straat is, zoals een blok of complex.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groep">Onderdeel van</Label>
            <Select value={groep} onValueChange={setGroep}>
              <SelectTrigger id="groep">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GEEN}>Geen groep</SelectItem>
                {groepen.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.naam}
                  </SelectItem>
                ))}
                <SelectItem value={NIEUW}>Nieuwe groep…</SelectItem>
              </SelectContent>
            </Select>
            {groep === NIEUW && (
              <Input
                autoFocus
                placeholder="Naam van de groep, bijv. Noordkant"
                value={nieuweNaam}
                onChange={(e) => setNieuweNaam(e.target.value)}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Een groep is een stuk van de wijk dat je in één keer kunt inklappen of inplannen.
              Straten zonder groep staan er gewoon los onder.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
