/**
 * Rechts in "Mail en klachten": het WhatsApp-gesprek met deze klant, met
 * antwoorden erbij. Appte de klant vanaf meer nummers (de man en de vrouw),
 * dan kies je het nummer. Nog nooit geappt: dan een eerste bericht via een
 * template, als er een 06-nummer is.
 *
 * Los geladen (zie DossierBerichten), net als de mail.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ChatVenster } from "@/components/whatsapp/Chat";
import { KlantKanaal, SjabloonBericht } from "@/components/whatsapp/Sjablonen";
import { useRecht } from "@/lib/rechten";
import { fetchKlantNummers, toonNummer } from "@/lib/whatsapp";
import type { Klant } from "@/lib/klanten";
import { cn } from "@/lib/utils";

export function WhatsAppDetail({
  klant,
  nummer,
}: {
  klant: Klant;
  /** Het nummer van het gekozen appje; anders het nummer van het laatste gesprek. */
  nummer: string | null;
}) {
  const nummers = useQuery({
    queryKey: ["dossier-whatsapp", klant.id],
    queryFn: () => fetchKlantNummers(klant.id),
  });
  const [gekozen, setGekozen] = useState<string | null>(nummer);
  const qc = useQueryClient();
  const magVersturen = useRecht("mail_versturen");
  // Een 06-nummer van de klant, als WhatsApp-nummer: daarheen kan een eerste bericht.
  const mobiel = [klant.telefoon, klant.telefoon2]
    .map((t) =>
      String(t ?? "")
        .replace(/\D/g, "")
        .replace(/^0031/, "0")
        .replace(/^31(?=6\d{8}$)/, "0"),
    )
    .map((d) => (/^06\d{8}$/.test(d) ? `31${d.slice(1)}` : ""))
    .find(Boolean);
  const lijst = nummers.data ?? [];
  const actief = gekozen && lijst.includes(gekozen) ? gekozen : (lijst[0] ?? null);

  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] bg-card p-[18px]">
      <div className="text-[12px] text-muted-foreground">
        WhatsApp{actief ? ` · ${toonNummer(actief)}` : ""}
      </div>
      <div className="font-display text-[18px] font-semibold">Appjes</div>
      {nummers.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Even ophalen…</p>
      ) : nummers.isError ? (
        <p className="text-[13px] text-tint-rood-ink">
          De WhatsApp-berichten konden niet geladen worden.
        </p>
      ) : !actief ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            Nog geen WhatsApp met deze klant. Appt hij vanaf een nummer dat bij hem staat, dan komt
            het hier vanzelf bij.
          </p>
          {magVersturen && mobiel && (
            <div className="overflow-hidden rounded-[14px] border border-border">
              <SjabloonBericht
                telefoon={mobiel}
                onVerstuurd={() =>
                  void qc.invalidateQueries({ queryKey: ["dossier-whatsapp", klant.id] })
                }
              />
            </div>
          )}
        </>
      ) : (
        <>
          {lijst.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {lijst.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGekozen(n)}
                  className={cn(
                    "rounded-full px-3 py-[5px] text-[13px]",
                    n === actief ? "bg-foreground text-background" : "border border-border",
                  )}
                >
                  {toonNummer(n)}
                </button>
              ))}
            </div>
          )}
          <ChatVenster
            key={actief}
            telefoon={actief}
            className="h-[440px] overflow-hidden rounded-[14px] border border-border"
          />
        </>
      )}
      <KlantKanaal klantId={klant.id} />
    </div>
  );
}
