/**
 * Rechts in "Mail en klachten": de gekozen mail, en daaronder wat Paaltje
 * voorstelt (het paarse kaartje). "Gebruiken" zet zijn antwoord klaar in het
 * opstelscherm; "Niet nodig" handelt de mail af.
 *
 * Los geladen (zie DossierBerichten): dit trekt het mailprogramma mee.
 *
 * Mail die je in het postvak weggooide of die op de telefoon gewist is, blijft
 * hier staan: het dossier is een archief. Alleen de eigenaar haalt een mail
 * eruit, en dat gaat naar de prullenbak.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconLoader2 as Loader2,
  IconPaperclip as Paperclip,
  IconCornerUpLeft as Reply,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { MailOpstellen, type Opzet } from "@/components/mail/MailOpstellen";
import { PaaltjeKaart } from "@/components/mail/PaaltjeKaart";
import { antwoordOpzet, MailHtml } from "@/components/mail/Postvak";
import { fetchBericht, type Bericht, type DossierMail as DossierMailRegel } from "@/lib/berichten";
import { fetchMailbox } from "@/lib/mailbox";
import { zetUitDossier } from "@/lib/mailacties";
import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";

/** "30 september", met het jaar erbij als het niet dit jaar was. */
function langeDatum(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

export function MailDetail({
  id,
  klantId,
  nietInMailbox,
  onWeg,
}: {
  id: string;
  klantId: string;
  /** Weggegooid in het postvak of gewist op de telefoon; het dossier bewaart hem. */
  nietInMailbox: boolean;
  /** De mail is uit het dossier gehaald. */
  onWeg: () => void;
}) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const magVersturen = useRecht("mail_versturen");
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const kanSchrijven = mailbox.data?.status === "actief";
  const bericht = useQuery({
    queryKey: ["bericht", id, "dossier"],
    queryFn: () => fetchBericht(id, true),
    // Leest Paaltje hem nog, dan verschijnt zijn voorstel vanzelf.
    refetchInterval: (q) =>
      ["wacht", "bezig"].includes(q.state.data?.paaltje_status ?? "") ? 30_000 : false,
  });
  const [opzet, setOpzet] = useState<Opzet | null>(null);

  function beantwoord(b: Bericht, begin = "") {
    if (!magVersturen || !kanSchrijven) {
      toast("Antwoorden kan alleen met een gekoppelde mailbox en het recht om mail te versturen.");
      return;
    }
    setOpzet({ ...antwoordOpzet(b, begin), klantId });
  }

  async function uitDossier() {
    const ververs = () => {
      void qc.invalidateQueries({ queryKey: ["dossier-mail", klantId] });
      void qc.invalidateQueries({ queryKey: ["dossier-ongelezen", klantId] });
      void qc.invalidateQueries({ queryKey: ["dossier-laatste-mail", klantId] });
    };
    try {
      await zetUitDossier(id, true);
      // Eerst uit de lijst in het geheugen: anders opent het dossier meteen
      // weer deze mail, als bovenste van de lijst die nog niet ververst is.
      qc.setQueryData<DossierMailRegel[]>(["dossier-mail", klantId], (oud) =>
        oud?.filter((m) => m.id !== id),
      );
      onWeg();
      ververs();
      toast.success("Uit het dossier gehaald. Hij ligt in de prullenbak.", {
        action: {
          label: "Ongedaan maken",
          onClick: () =>
            void zetUitDossier(id, false)
              .then(ververs)
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const b = bericht.data;
  if (bericht.isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-[18px] bg-card p-[18px] text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Even ophalen…
      </div>
    );
  }
  if (!b) {
    return (
      <div className="rounded-[18px] bg-card p-[18px] text-[13px] text-tint-rood-ink">
        Deze mail kon niet geladen worden.
      </div>
    );
  }

  const uit = b.richting === "uit";
  const naar = b.aan.map((a) => a.naam || a.email).join(", ");

  return (
    <>
      <div className="flex flex-col gap-2.5 rounded-[18px] bg-card p-[18px]">
        <div className="text-[12px] text-muted-foreground">
          {langeDatum(b.ontvangen_op)} · {uit ? `aan ${naar || "?"}` : `van ${b.van_email}`}
        </div>
        <div className="break-words font-display text-[18px] font-semibold">
          {b.onderwerp || "(geen onderwerp)"}
        </div>
        {b.afgekapt && (
          <p className="rounded-[10px] bg-tint-geel px-3 py-1.5 text-[12px]">
            Deze mail is groot; Paaltje Systems toont alleen het begin.
          </p>
        )}
        {b.html ? (
          // Op een groot scherm een vaste hoogte (de mail heeft een eigen
          // venstertje); kleiner groeit hij mee met de inhoud.
          <div className="flex overflow-hidden rounded-[12px] border border-border lg:h-[360px]">
            <MailHtml html={b.html} meegroeien />
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.55]">
            {b.tekst || <span className="text-muted-foreground">(lege mail)</span>}
          </div>
        )}
        {(b.bijlagen.length > 0 || nietInMailbox) && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {b.bijlagen.length > 0 && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Paperclip className="size-3.5 shrink-0" />
                <span className="truncate">{b.bijlagen.map((x) => x.naam).join(", ")}</span>
              </span>
            )}
            {nietInMailbox && (
              <span
                className="rounded-full bg-muted px-2 py-px"
                title="Weggegooid in het postvak of gewist op de telefoon; Paaltje Systems bewaart hem voor het dossier."
              >
                niet meer in de mailbox
              </span>
            )}
          </div>
        )}
        {((!uit && magVersturen && kanSchrijven) || isEigenaar) && (
          <div className="flex flex-wrap gap-2">
            {!uit && magVersturen && kanSchrijven && (
              <button
                type="button"
                onClick={() => beantwoord(b)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-[13px] transition-colors hover:bg-accent"
              >
                <Reply className="size-3.5" /> Beantwoorden
              </button>
            )}
            {isEigenaar && (
              <button
                type="button"
                onClick={() => void uitDossier()}
                className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Uit dossier
              </button>
            )}
          </div>
        )}
      </div>

      <PaaltjeKaart
        b={b}
        kanSchrijven={kanSchrijven}
        onBeantwoord={(begin) => beantwoord(b, begin)}
        dossier
      />

      <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
    </>
  );
}
