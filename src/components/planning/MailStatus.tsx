import { useState } from "react";
import {
  IconAlertTriangle as AlertTriangle,
  IconMail as Mail,
  IconMailCheck as MailCheck,
  IconMailX as MailX,
  IconMessage as MessageSquare,
  IconMinus as Minus,
} from "@tabler/icons-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Mailstand, Mailstatus } from "@/lib/aankondigingen";

/** De kop boven de uitleg: in een paar woorden wat het icoontje zegt. */
const KOP: Record<Mailstand, string> = {
  "geen-adres": "Geen mail of telefoon",
  "niet-verstuurd": "Nog geen planningsmail",
  verstuurd: "Planningsmail verstuurd",
  afgeleverd: "Planningsmail aangekomen",
  gelezen: "Gelezen",
  mislukt: "Niet aangekomen",
  verplaatst: "Planning gewijzigd na de mail",
};

/**
 * Het envelopje naast een adres in de dag- en weekweergave: is het
 * planningsbericht verstuurd, kwam het aan, of klopt het niet meer omdat het
 * adres verplaatst is? Dit staat bewust niet op de dagpagina van de wassers:
 * die is voor het werk van die dag.
 *
 * De uitleg komt meteen als je er met de muis boven hangt, en ook als je erop
 * tikt: op een telefoon is er geen muis, en het oranje driehoekje moet je
 * kunnen snappen zonder te gokken.
 */
export function MailStatus({ status, klein = false }: { status: Mailstatus; klein?: boolean }) {
  const [open, setOpen] = useState(false);
  const maat = klein ? "size-3.5" : "size-4";
  const gedeeld = `${maat} shrink-0`;

  const ikoon = () => {
    switch (status.stand) {
      case "geen-adres":
        return <Minus className={`${gedeeld} text-muted-foreground/40`} />;
      case "niet-verstuurd":
        return <Mail className={`${gedeeld} text-muted-foreground/40`} />;
      case "verstuurd":
        return <Mail className={`${gedeeld} text-muted-foreground`} />;
      case "afgeleverd":
        return <MailCheck className={`${gedeeld} text-tint-groen-ink`} />;
      case "gelezen":
        return <MessageSquare className={`${gedeeld} text-tint-blauw-ink`} />;
      case "mislukt":
        return <MailX className={`${gedeeld} text-destructive`} />;
      case "verplaatst":
        return <AlertTriangle className={`${gedeeld} text-tint-oranje-ink`} />;
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={-1}
            aria-label={`${KOP[status.stand]}. ${status.uitleg}`}
            // Niet meeslepen en geen menu openen: dit icoontje is de uitleg.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="inline-flex cursor-help items-center"
          >
            {ikoon()}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-[12px] leading-relaxed">
          <p className="font-medium">{KOP[status.stand]}</p>
          <p className="opacity-90">{status.uitleg}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
