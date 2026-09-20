/** Mail die later verstuurd wordt, met Annuleren. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle as AlertTriangle,
  IconClock as Clock,
  IconLoader2 as Loader2,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchGepland } from "@/lib/berichten";
import { annuleerGepland } from "@/lib/mailacties";
import { toonMoment } from "@/components/mail/MomentKiezer";

export function GeplandLijst({ kanSchrijven }: { kanSchrijven: boolean }) {
  const qc = useQueryClient();
  const lijst = useQuery({ queryKey: ["gepland"], queryFn: fetchGepland, refetchInterval: 60_000 });

  if (lijst.isLoading)
    return <p className="p-4 text-[13px] text-muted-foreground">Even ophalen…</p>;
  if (lijst.isError)
    return (
      <p className="p-4 text-[13px] text-tint-rood-ink">
        De geplande mail kon niet geladen worden.
      </p>
    );
  if (!lijst.data?.length) {
    return (
      <p className="p-6 text-center text-[13px] text-muted-foreground">
        Niets gepland. Bij het versturen kies je "Later versturen".
      </p>
    );
  }

  return (
    <ul>
      {lijst.data.map((g) => (
        <li key={g.id} className="flex items-start gap-2 border-b border-border/60 px-3.5 py-2.5">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {g.status === "mislukt" ? (
              <AlertTriangle className="size-4 text-tint-rood-ink" />
            ) : g.status === "bezig" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clock className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px]">{g.aan_tekst || "?"}</span>
            <span className="block truncate text-[13px] text-foreground/80">
              {g.onderwerp || "(geen onderwerp)"}
            </span>
            <span className="block text-[12px] text-muted-foreground">
              {g.status === "mislukt"
                ? `Niet verstuurd: ${g.fout}`
                : `Gaat weg ${toonMoment(g.versturen_op)}`}
            </span>
          </span>
          {g.status === "wacht" && (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              disabled={!kanSchrijven}
              onClick={() =>
                void annuleerGepland(g.id)
                  .then(() => {
                    toast.success("Niet meer verstuurd.");
                    void qc.invalidateQueries({ queryKey: ["gepland"] });
                  })
                  .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
              }
            >
              <X className="size-3.5" /> Annuleren
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
