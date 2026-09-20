import {
  IconAlertTriangle as AlertTriangle,
  IconMail as Mail,
  IconMailCheck as MailCheck,
  IconMailX as MailX,
  IconMessage as MessageSquare,
  IconMinus as Minus,
} from "@tabler/icons-react";

import type { Mailstatus } from "@/lib/aankondigingen";

/**
 * Het envelopje naast een adres in de dagweergave: is het planningsbericht
 * verstuurd, kwam het aan, of klopt het niet meer omdat het adres verplaatst
 * is? Dit staat bewust niet op de dagpagina van de wassers: die is voor het
 * werk van die dag.
 */
export function MailStatus({ status, klein = false }: { status: Mailstatus; klein?: boolean }) {
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
    <span title={status.uitleg} aria-label={status.uitleg} className="inline-flex items-center">
      {ikoon()}
    </span>
  );
}
