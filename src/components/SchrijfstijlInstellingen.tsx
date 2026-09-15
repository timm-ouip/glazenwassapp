/**
 * Hoe klaargezette antwoorden van Paaltje klinken.
 *
 * Staat bij Instellingen en niet op de mailingpagina: je stelt het één keer in
 * en kijkt er daarna zelden meer naar. Wat wél vaak verandert — hoe hij
 * schrijft — gaat vanzelf, doordat hij kijkt naar de antwoorden die je zelf
 * verstuurt.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import {
  aantalVerstuurdeAntwoorden,
  bewaarSchrijfstijl,
  fetchSchrijfstijl,
} from "@/lib/mailing";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Naar zoveel eigen antwoorden kijkt Paaltje; zie `MAX_VOORBEELDEN`
 *  in supabase/functions/_gedeeld/paaltje.ts. */
const VOORBEELDEN = 5;

export function SchrijfstijlInstellingen({ isEigenaar }: { isEigenaar: boolean }) {
  const { company } = useAuth();
  const qc = useQueryClient();
  const schrijfstijl = useQuery({
    queryKey: ["schrijfstijl"],
    queryFn: fetchSchrijfstijl,
  });
  const verstuurd = useQuery({
    queryKey: ["aantal-verstuurde-antwoorden"],
    queryFn: aantalVerstuurdeAntwoorden,
  });
  const [stijl, setStijl] = useState("");
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    if (schrijfstijl.data !== undefined) setStijl(schrijfstijl.data);
  }, [schrijfstijl.data]);

  async function bewaar() {
    if (!company?.id) return;
    setBezig(true);
    try {
      await bewaarSchrijfstijl(company.id, stijl);
      await qc.invalidateQueries({ queryKey: ["schrijfstijl"] });
      toast.success("Schrijfstijl opgeslagen.");
    } catch (e) {
      toast.error("Opslaan mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  const aantal = Math.min(verstuurd.data ?? 0, VOORBEELDEN);
  const veranderd = stijl.trim() !== (schrijfstijl.data ?? "").trim();

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted-foreground">
        Hoe moeten de antwoorden klinken die Paaltje voor je klaarzet? Bijvoorbeeld:
        &ldquo;u-vorm, kort, afsluiten met Groet, Timmie&rdquo;.
      </p>
      <Textarea
        value={stijl}
        onChange={(e) => setStijl(e.target.value)}
        rows={3}
        maxLength={1000}
        disabled={!isEigenaar || schrijfstijl.isLoading}
        className="text-[13.5px]"
        placeholder="Laat leeg voor een gewone, vriendelijke je-vorm."
      />
      {isEigenaar && veranderd && (
        <Button size="sm" className="rounded-full" disabled={bezig} onClick={() => void bewaar()}>
          Opslaan
        </Button>
      )}
      <p className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
        {aantal === 0
          ? "Pas je een klaargezet antwoord aan en verstuur je het, dan kijkt hij daar de volgende keer naar. Hoe meer je zelf verstuurt, hoe meer het op jou lijkt."
          : `Hij kijkt ook naar je laatste ${aantal} verstuurde ${aantal === 1 ? "antwoord" : "antwoorden"}, en schrijft zoals jij daar schreef.`}
      </p>
      {!isEigenaar && (
        <p className="text-[12px] text-muted-foreground">Alleen de eigenaar kan dit aanpassen.</p>
      )}
    </div>
  );
}
