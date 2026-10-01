/**
 * De kopbalk van een tabblad in het klantdossier: de titel, de knoppen van
 * dat tabblad en het kruisje. Op de telefoon staat er een terugknop voor,
 * want daar is het menu een eigen scherm.
 *
 * Elk tabblad tekent zijn eigen kop, zodat een tabblad zijn knoppen erin zet
 * zonder dat de schil (KlantgegevensDialog) daarvoor hoeft te veranderen.
 */
import type { ReactNode } from "react";
import { IconChevronLeft as ChevronLeft } from "@tabler/icons-react";

import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

/** Een ronde knop in de kop: 44px hoog, wit met een randje. */
export const kopKnop =
  "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 text-[14px] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

/** De oranje hoofdknop in de kop. */
export const kopKnopPrimair =
  "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-[18px] text-[14px] font-semibold text-primary-foreground transition-[filter] hover:brightness-95 disabled:pointer-events-none disabled:opacity-50";

export function DossierKop({
  d,
  titel,
  acties,
}: {
  d: Dossier;
  titel: string;
  /** De knoppen van dit tabblad, rechts naast de titel. */
  acties?: ReactNode;
}) {
  if (d.mobiel) {
    return (
      <div
        data-sleepgreep=""
        className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-card px-3 pb-3 pt-5"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={d.naarMenu}
            aria-label="Terug naar het menu"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-foreground active:bg-muted"
          >
            <ChevronLeft className="size-6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[20px] font-semibold leading-tight">
              {titel}
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">{d.titel}</div>
          </div>
          <SluitKnop d={d} />
        </div>
        {acties && <div className="flex flex-wrap gap-2 pl-1">{acties}</div>}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-[26px] py-5">
      <div className="min-w-0 flex-1 truncate font-display text-[22px] font-semibold">{titel}</div>
      {acties}
      <SluitKnop d={d} />
    </div>
  );
}

export function SluitKnop({ d, className }: { d: Dossier; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Sluiten"
      onClick={() => void d.sluit()}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[18px] leading-none text-foreground transition-colors hover:bg-accent",
        className,
      )}
    >
      ×
    </button>
  );
}

/**
 * Bellen, Mailen, Appen en Betalen…: in de kop van het Overzicht en op de
 * telefoon bovenaan het menu. Wat niet kan (geen nummer, geen mailbox) staat
 * uit, met de reden erbij als je er met de muis op staat.
 */
export function ContactKnoppen({
  d,
  telefoonMenu = false,
}: {
  d: Dossier;
  telefoonMenu?: boolean;
}) {
  const knop = telefoonMenu
    ? "inline-flex h-11 flex-1 items-center justify-center rounded-full border border-border bg-card px-3 text-[14px] text-foreground active:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
    : `${kopKnop} aria-disabled:pointer-events-none aria-disabled:opacity-50`;
  const primair = telefoonMenu
    ? "inline-flex h-11 flex-1 items-center justify-center rounded-full bg-primary px-3 text-[14px] font-semibold text-primary-foreground"
    : kopKnopPrimair;
  return (
    <>
      <a
        href={d.telefoon ? `tel:${d.telefoon.replace(/\s/g, "")}` : undefined}
        aria-disabled={!d.telefoon}
        title={d.telefoon ? `Bel ${d.telefoon}` : "Geen telefoonnummer bekend"}
        className={knop}
      >
        Bellen
      </a>
      <button
        type="button"
        disabled={!d.kanMailen}
        aria-disabled={!d.kanMailen}
        title={
          d.kanMailen
            ? `Mail aan ${d.email}`
            : !d.email
              ? "Geen e-mailadres bekend"
              : "Mailen kan alleen met een gekoppelde mailbox en het recht om te versturen"
        }
        onClick={() => d.setDialoog("mail")}
        className={knop}
      >
        Mailen
      </button>
      <a
        href={d.whatsappNummer ? `https://wa.me/${d.whatsappNummer}` : undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!d.whatsappNummer}
        title={d.whatsappNummer ? "WhatsApp openen" : "Geen 06-nummer bekend"}
        className={knop}
      >
        Appen
      </a>
      {d.kanBetalen && (
        <button type="button" onClick={() => d.setDialoog("betalen")} className={primair}>
          Betalen…
        </button>
      )}
    </>
  );
}
