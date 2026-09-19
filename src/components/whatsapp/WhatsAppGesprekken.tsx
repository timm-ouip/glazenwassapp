/**
 * De WhatsApp-tab: links de gesprekken, in het midden het gesprek zelf, zoals
 * in WhatsApp, en op een breed scherm rechts wie het is (net als bij mail).
 * Op een telefoon één van de twee tegelijk, zonder de klanttegel.
 *
 * Antwoorden kan binnen 24 uur na het laatste bericht van de klant; Paaltje
 * en sjablonen komen later.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft as ArrowLeft, IconMessageCircle as MessageCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import { lijstDatum } from "@/lib/berichten";
import {
  fetchGesprekken,
  fetchWhatsAppKoppeling,
  markeerGesprekGelezen,
  toonNummer,
} from "@/lib/whatsapp";
import { ChatVenster } from "@/components/whatsapp/Chat";
import { KlantTegel } from "@/components/whatsapp/KlantTegel";
import { cn } from "@/lib/utils";

/** Breed genoeg voor de klanttegel (Tailwinds xl). Zo niet, dan wordt hij ook niet opgehaald. */
function useBreed(): boolean {
  const [breed, setBreed] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1280px)");
    const zet = () => setBreed(mql.matches);
    zet();
    mql.addEventListener("change", zet);
    return () => mql.removeEventListener("change", zet);
  }, []);
  return breed;
}

export function WhatsAppGesprekken() {
  const qc = useQueryClient();
  const koppeling = useQuery({ queryKey: ["whatsapp-koppeling"], queryFn: fetchWhatsAppKoppeling });
  const gesprekken = useQuery({
    queryKey: ["wa-gesprekken"],
    queryFn: fetchGesprekken,
    refetchInterval: 15_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const breed = useBreed();

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
  // De klanttegel pas als er een gesprek open staat, zoals bij mail.
  const metKlant = breed && !!gekozen;

  return (
    <div
      className={cn(
        "grid h-[calc(100vh-220px)] min-h-[420px] overflow-hidden rounded-[18px] border border-border bg-card shadow-card md:grid-cols-[300px_1fr]",
        metKlant && "xl:grid-cols-[300px_minmax(0,1fr)_250px]",
      )}
    >
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

      {metKlant && gekozen && (
        <aside className="overflow-y-auto border-l border-border p-4">
          <KlantTegel telefoon={gekozen.wa_telefoon} klantId={gekozen.klant_id} />
        </aside>
      )}
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
      {/* Per nummer een eigen venster: anders bleef een half getypt (of door
          Paaltje voorgesteld) appje staan als je een ander gesprek koos, en
          ging het met Enter naar de verkeerde klant. */}
      <ChatVenster key={telefoon} telefoon={telefoon} className="flex-1" />
    </>
  );
}
