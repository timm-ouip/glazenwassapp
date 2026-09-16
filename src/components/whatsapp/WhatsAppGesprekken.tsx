/**
 * De WhatsApp-tab: links de gesprekken, rechts het gesprek zelf, zoals in
 * WhatsApp. Op een telefoon één van de twee tegelijk.
 *
 * Fase 1: alleen lezen. Antwoorden, foto's bekijken en Paaltje komen later.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, MessageCircle, Smartphone } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { lijstDatum } from "@/lib/berichten";
import {
  fetchGesprekken,
  fetchWaBerichten,
  fetchWhatsAppKoppeling,
  markeerGesprekGelezen,
  toonNummer,
  type WaBericht,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export function WhatsAppGesprekken() {
  const qc = useQueryClient();
  const koppeling = useQuery({ queryKey: ["whatsapp-koppeling"], queryFn: fetchWhatsAppKoppeling });
  const gesprekken = useQuery({
    queryKey: ["wa-gesprekken"],
    queryFn: fetchGesprekken,
    refetchInterval: 15_000,
  });
  const [open, setOpen] = useState<string | null>(null);

  const gekozen = (gesprekken.data ?? []).find((g) => g.wa_telefoon === open) ?? null;

  // Openen = gelezen. Alleen als er iets ongelezen is: anders een verzoek voor niets.
  useEffect(() => {
    if (!gekozen || gekozen.ongelezen === 0) return;
    void markeerGesprekGelezen(gekozen.wa_telefoon)
      .then(() => qc.invalidateQueries({ queryKey: ["wa-gesprekken"] }))
      .catch(() => undefined);
  }, [gekozen, qc]);

  if (koppeling.isLoading || gesprekken.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Even kijken…</p>;
  }

  if (!koppeling.data || koppeling.data.status === "uit") {
    return (
      <div className="rounded-[18px] border border-border bg-card p-6 text-center shadow-card">
        <MessageCircle className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-[14px] font-medium">WhatsApp is nog niet gekoppeld</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Koppel je nummer bij{" "}
          <Link to="/instellingen" search={{ tab: "mail" }} className="underline">
            Instellingen → mail
          </Link>
          .
        </p>
      </div>
    );
  }

  const lijst = gesprekken.data ?? [];

  return (
    <div className="grid h-[calc(100vh-220px)] min-h-[420px] overflow-hidden rounded-[18px] border border-border bg-card shadow-card md:grid-cols-[300px_1fr]">
      <ul className={cn("overflow-y-auto border-border md:border-r", open && "hidden md:block")}>
        {lijst.length === 0 && (
          <li className="p-4 text-[13px] text-muted-foreground">
            Nog geen berichten. Stuur een appje naar {koppeling.data.weergavenummer || "het nummer"}
            .
          </li>
        )}
        {lijst.map((g) => (
          <li key={g.wa_telefoon}>
            <button
              type="button"
              onClick={() => setOpen(g.wa_telefoon)}
              className={cn(
                "flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/50",
                open === g.wa_telefoon && "bg-accent/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13.5px]",
                      g.ongelezen > 0 && "font-semibold",
                    )}
                  >
                    {g.naam || toonNummer(g.wa_telefoon)}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {lijstDatum(g.laatste_op)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                    {g.richting === "uit" && "Jij: "}
                    {g.fragment}
                  </span>
                  {g.ongelezen > 0 && (
                    <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                      {g.ongelezen}
                    </span>
                  )}
                </div>
                {!g.klant_id && (
                  <span className="text-[11px] text-muted-foreground">geen klant gevonden</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className={cn("flex min-h-0 flex-col", !open && "hidden md:flex")}>
        {gekozen ? (
          <Gesprek
            telefoon={gekozen.wa_telefoon}
            naam={gekozen.naam}
            onTerug={() => setOpen(null)}
          />
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-muted-foreground">
            Kies links een gesprek.
          </div>
        )}
      </div>
    </div>
  );
}

function Gesprek({
  telefoon,
  naam,
  onTerug,
}: {
  telefoon: string;
  naam: string;
  onTerug: () => void;
}) {
  const berichten = useQuery({
    queryKey: ["wa-berichten", telefoon],
    queryFn: () => fetchWaBerichten(telefoon),
    refetchInterval: 15_000,
  });
  const onderkant = useRef<HTMLDivElement>(null);
  const aantal = berichten.data?.length ?? 0;

  // Nieuw bericht of ander gesprek: naar beneden, zoals in WhatsApp.
  useEffect(() => {
    onderkant.current?.scrollIntoView({ block: "end" });
  }, [telefoon, aantal]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          type="button"
          onClick={onTerug}
          className="md:hidden"
          aria-label="Terug naar gesprekken"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{naam || toonNummer(telefoon)}</p>
          {naam && <p className="text-[12px] text-muted-foreground">{toonNummer(telefoon)}</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-background/60 px-3 py-3">
        {berichten.isLoading && <p className="text-[13px] text-muted-foreground">Even kijken…</p>}
        {(berichten.data ?? []).map((b) => (
          <Bubbel key={b.id} bericht={b} />
        ))}
        <div ref={onderkant} />
      </div>
      <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        Antwoorden vanuit Wooshy komt in de volgende stap. Antwoord voor nu op je telefoon.
      </p>
    </>
  );
}

function Bubbel({ bericht: b }: { bericht: WaBericht }) {
  const uit = b.richting === "uit";
  return (
    <div className={cn("flex", uit ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-[14px] px-3 py-1.5 text-[13.5px] shadow-sm",
          uit
            ? "bg-tint-groen text-tint-groen-ink"
            : "bg-card text-card-foreground ring-1 ring-inset ring-border",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{b.tekst}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] opacity-70">
          {b.bron === "app" && (
            <span className="inline-flex items-center gap-0.5" title="Verstuurd vanaf je telefoon">
              <Smartphone className="size-3" />
            </span>
          )}
          {new Date(b.ontvangen_op).toLocaleString("nl-NL", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {uit && b.wa_status === "gelezen" && (
            <CheckCheck className="size-3 text-tint-blauw-ink" />
          )}
          {uit && b.wa_status === "afgeleverd" && <CheckCheck className="size-3" />}
          {uit && b.wa_status === "verstuurd" && <Check className="size-3" />}
          {uit && b.wa_status === "mislukt" && <span className="text-destructive">mislukt</span>}
        </p>
      </div>
    </div>
  );
}
