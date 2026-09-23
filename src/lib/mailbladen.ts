/**
 * De bladen van de mailpagina, zoals ze in het webadres staan en in het menu
 * onder "Mail" verschijnen.
 *
 * Ze staan in een eigen bestandje en niet in lib/mailing.ts, omdat het menu
 * ze op elke pagina nodig heeft: dan hoeft de hele mailmachinerie niet mee.
 *
 * WhatsApp is hier geen blad. Appjes en de gesprekken per klant zijn kanalen
 * binnen het postvak, met hun eigen blokje bovenin de mappenkolom — dat wisselt
 * sneller dan een tabblad, en het is dezelfde soort post.
 */
export const MAIL_BLADEN = ["postvak", "opstellen", "verstuurd", "dagrapport", "rapport"] as const;

export type MailBlad = (typeof MAIL_BLADEN)[number];

export const MAIL_BLADNAAM: Record<MailBlad, string> = {
  postvak: "Postvak",
  opstellen: "Aankondigen",
  verstuurd: "Verstuurd",
  dagrapport: "Dagrapport",
  rapport: "Rapport",
};

/**
 * Wat je moet mogen om een blad te zien: lezen is het postvak, versturen de
 * aankondigingen, en de rapporten blijven bij de eigenaar (de database geeft
 * een ander toch niets terug).
 */
export const MAIL_BLADRECHT: Record<MailBlad, "mail_lezen" | "mail_versturen" | "eigenaar"> = {
  postvak: "mail_lezen",
  opstellen: "mail_versturen",
  verstuurd: "mail_versturen",
  dagrapport: "eigenaar",
  rapport: "eigenaar",
};

/** De kanalen binnen het postvak: gewone mail, appjes, of allebei per klant. */
export const MAIL_KANALEN = ["postvak", "whatsapp", "samen"] as const;

export type MailKanaal = (typeof MAIL_KANALEN)[number];
