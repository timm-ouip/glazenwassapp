/**
 * Een gesprek als draad: boven een mail staan de andere mails uit hetzelfde
 * gesprek (jouw antwoorden en hun reacties), zodat je het verloop ziet zonder
 * te zoeken.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowDownLeft as ArrowDownLeft,
  IconArrowUpRight as ArrowUpRight,
  IconChevronDown as ChevronDown,
  IconMessages as MessagesSquare,
} from "@tabler/icons-react";

import { fetchGesprek, lijstDatum } from "@/lib/berichten";
import { cn } from "@/lib/utils";

export function Gesprek({ berichtId, onOpen }: { berichtId: string; onOpen: (id: string) => void }) {
  const gesprek = useQuery({ queryKey: ["gesprek", berichtId], queryFn: () => fetchGesprek(berichtId) });
  const [open, setOpen] = useState(false);
  const anderen = (gesprek.data ?? []).filter((m) => m.id !== berichtId);
  if (anderen.length === 0) return null;

  return (
    <div className="mx-5 mt-3 rounded-[12px] border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <MessagesSquare className="size-3.5" />
        <span className="flex-1">
          {anderen.length === 1 ? "1 andere mail" : `${anderen.length} andere mails`} in dit gesprek
        </span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="border-t border-border/60">
          {(gesprek.data ?? []).map((m) => {
            const deze = m.id === berichtId;
            const uit = m.richting === "uit";
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={deze || !m.op_server}
                  onClick={() => onOpen(m.id)}
                  title={!m.op_server ? "Staat niet meer in de mailbox" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px]",
                    deze ? "bg-accent/60" : "hover:bg-muted/50 disabled:opacity-60",
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", uit ? "text-tint-blauw-ink" : "text-muted-foreground")}>
                    {uit ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {uit ? "Jij" : m.van_naam || m.van_email}
                        {deze && <span className="font-normal text-muted-foreground"> · deze mail</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{lijstDatum(m.ontvangen_op)}</span>
                    </span>
                    <span className="block truncate text-muted-foreground">{m.fragment}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
