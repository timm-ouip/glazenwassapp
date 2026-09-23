/**
 * Tabblad Mail in het klantdossier: het hele gesprek met deze klant, heen en
 * terug, nieuwste bovenaan.
 *
 * Mail die je in het postvak weggooide of die op de telefoon gewist is, blijft
 * hier staan: het dossier is een archief. Alleen de eigenaar haalt een mail
 * eruit, en dat gaat naar de prullenbak.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowDownLeft as ArrowDownLeft,
  IconArrowUpRight as ArrowUpRight,
  IconLoader2 as Loader2,
  IconPaperclip as Paperclip,
  IconCornerUpLeft as Reply,
  IconEdit as SquarePen,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PopupBlok, PopupHint } from "@/components/Popup";
import { MailOpstellen, type Opzet } from "@/components/mail/MailOpstellen";
import { antwoordOpzet, MailHtml } from "@/components/mail/Postvak";
import {
  fetchBericht,
  fetchDossierMails,
  lijstDatum,
  type DossierMail as Regel,
} from "@/lib/berichten";
import { fetchMailbox } from "@/lib/mailbox";
import { zetUitDossier } from "@/lib/mailacties";
import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import type { Klant } from "@/lib/klanten";
import { cn } from "@/lib/utils";

export function DossierMail({ klant }: { klant: Klant }) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const magVersturen = useRecht("mail_versturen");
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const kanVersturen = magVersturen && mailbox.data?.status === "actief";

  const mails = useQuery({
    queryKey: ["dossier-mail", klant.id],
    queryFn: () => fetchDossierMails(klant.id),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [opzet, setOpzet] = useState<Opzet | null>(null);

  const ververs = () => void qc.invalidateQueries({ queryKey: ["dossier-mail", klant.id] });

  async function uitDossier(id: string) {
    try {
      await zetUitDossier(id, true);
      setOpen((o) => (o === id ? null : o));
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

  const adres = klant.email.trim() || klant.email2.trim();
  const lijst = mails.data ?? [];

  return (
    <PopupBlok
      label="Correspondentie"
      terzijde={
        lijst.length > 0 ? `${lijst.length} ${lijst.length === 1 ? "mail" : "mails"}` : undefined
      }
    >
      {mails.isLoading ? (
        <PopupHint>Even ophalen…</PopupHint>
      ) : mails.isError ? (
        <p className="text-[13px] text-tint-rood-ink">De mails konden niet geladen worden.</p>
      ) : lijst.length === 0 ? (
        <PopupHint>
          Nog geen mail met deze klant. Mail van en aan{" "}
          {adres ? <span className="font-medium">{adres}</span> : "zijn mailadres"} komt hier
          vanzelf bij.
        </PopupHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {lijst.map((m) => (
            <MailRegel
              key={m.id}
              m={m}
              open={open === m.id}
              onToggle={() => setOpen((o) => (o === m.id ? null : m.id))}
              kanVersturen={kanVersturen}
              isEigenaar={isEigenaar}
              onBeantwoord={(opz) => setOpzet({ ...opz, klantId: klant.id })}
              onUitDossier={() => void uitDossier(m.id)}
            />
          ))}
        </ul>
      )}

      {kanVersturen && adres && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start rounded-full"
          onClick={() =>
            setOpzet({
              aan: klant.naam ? `"${klant.naam.replace(/"/g, "")}" <${adres}>` : adres,
              onderwerp: "",
              tekst: "",
              klantId: klant.id,
            })
          }
        >
          <SquarePen className="size-4" /> Nieuwe mail
        </Button>
      )}

      <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
    </PopupBlok>
  );
}

function MailRegel({
  m,
  open,
  onToggle,
  kanVersturen,
  isEigenaar,
  onBeantwoord,
  onUitDossier,
}: {
  m: Regel;
  open: boolean;
  onToggle: () => void;
  kanVersturen: boolean;
  isEigenaar: boolean;
  onBeantwoord: (opzet: Opzet) => void;
  onUitDossier: () => void;
}) {
  const uit = m.richting === "uit";
  const bericht = useQuery({
    queryKey: ["bericht", m.id, "dossier"],
    queryFn: () => fetchBericht(m.id, true),
    enabled: open,
  });
  const naar = m.aan.map((a) => a.naam || a.email).join(", ");

  return (
    <li
      className={cn(
        "rounded-xl border text-[13px]",
        uit ? "ml-6 border-transparent bg-tint-blauw/60" : "mr-6 border-input bg-background/70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span
          className={cn("mt-0.5 shrink-0", uit ? "text-tint-blauw-ink" : "text-muted-foreground")}
        >
          {uit ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">
              {m.onderwerp || "(geen onderwerp)"}
            </span>
            <span className="shrink-0 text-[11.5px] text-muted-foreground">
              {lijstDatum(m.ontvangen_op)}
            </span>
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {uit ? `Jij aan ${naar || "?"}` : m.van_naam || m.van_email}
            {!open && m.fragment ? ` · ${m.fragment}` : ""}
          </span>
          {(m.heeft_bijlagen || !m.op_server) && (
            <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {m.heeft_bijlagen && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip className="size-3" /> bijlage
                </span>
              )}
              {!m.op_server && (
                <span
                  className="rounded-full bg-muted px-2 py-px"
                  title="Weggegooid in het postvak of gewist op de telefoon; Paaltje Systems bewaart hem voor het dossier."
                >
                  niet meer in mailbox
                </span>
              )}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          {bericht.isLoading ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Even ophalen…
            </p>
          ) : !bericht.data ? (
            <p className="text-[12.5px] text-tint-rood-ink">Deze mail kon niet geladen worden.</p>
          ) : (
            <>
              {bericht.data.afgekapt && (
                <p className="mb-2 rounded-[10px] bg-tint-geel px-3 py-1.5 text-[12px] text-tint-geel-ink">
                  Deze mail is groot; Paaltje Systems toont alleen het begin.
                </p>
              )}
              {bericht.data.html ? (
                <div className="flex h-[320px] overflow-hidden rounded-lg border border-border/60">
                  <MailHtml html={bericht.data.html} />
                </div>
              ) : (
                <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                  {bericht.data.tekst || <span className="text-muted-foreground">(lege mail)</span>}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {!uit && kanVersturen && (
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    onClick={() => onBeantwoord(antwoordOpzet(bericht.data!))}
                  >
                    <Reply className="size-3.5" /> Beantwoorden
                  </Button>
                )}
                {isEigenaar && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto rounded-full text-muted-foreground hover:text-destructive"
                    onClick={onUitDossier}
                  >
                    <Trash2 className="size-3.5" /> Uit dossier
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
