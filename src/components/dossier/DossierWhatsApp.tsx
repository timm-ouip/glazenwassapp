/**
 * WhatsApp in het klantdossier, onder de mail: het gesprek met deze klant,
 * met antwoorden erbij. Appte de klant vanaf meer nummers (de man en de
 * vrouw), dan kies je het nummer.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PopupBlok, PopupHint } from "@/components/Popup";
import { ChatVenster } from "@/components/whatsapp/Chat";
import { KlantKanaal, SjabloonBericht } from "@/components/whatsapp/Sjablonen";
import { useRecht } from "@/lib/rechten";
import { fetchKlantNummers, toonNummer } from "@/lib/whatsapp";
import type { Klant } from "@/lib/klanten";
import { cn } from "@/lib/utils";

export function DossierWhatsApp({ klant }: { klant: Klant }) {
  const nummers = useQuery({
    queryKey: ["dossier-whatsapp", klant.id],
    queryFn: () => fetchKlantNummers(klant.id),
  });
  const [gekozen, setGekozen] = useState<string | null>(null);
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
    <PopupBlok label="WhatsApp">
      <KlantKanaal klantId={klant.id} />
      {nummers.isLoading ? (
        <PopupHint>Even ophalen…</PopupHint>
      ) : nummers.isError ? (
        <p className="text-[13px] text-tint-rood-ink">
          De WhatsApp-berichten konden niet geladen worden.
        </p>
      ) : !actief ? (
        <>
          <PopupHint>
            Nog geen WhatsApp met deze klant. Appt hij vanaf een nummer dat bij hem staat, dan komt
            het hier vanzelf bij.
          </PopupHint>
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
                    "rounded-full px-2.5 py-0.5 text-[12px]",
                    n === actief
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {toonNummer(n)}
                </button>
              ))}
            </div>
          )}
          <ChatVenster
            telefoon={actief}
            className="h-[380px] overflow-hidden rounded-[14px] border border-border"
          />
        </>
      )}
    </PopupBlok>
  );
}
