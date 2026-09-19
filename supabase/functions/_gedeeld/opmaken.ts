/**
 * Een mail opmaken tot iets wat over de lijn kan: koppen, tekensets, en de
 * draad naar het bericht waarop geantwoord wordt.
 *
 * Het echte werk doet de MailComposer van nodemailer — pure JavaScript, zonder
 * netwerk. Die weet hoe een onderwerp met een euroteken of een naam met een
 * apostrof in een mailkop hoort; dat zelf naschrijven levert mail op die er
 * bij de ontvanger als hiërogliefen uitziet.
 */
import MailComposer from "npm:nodemailer@10.0.9/lib/mail-composer/index.js";

import { alsHtml } from "./mail.ts";

export interface Opmaak {
  van: { naam: string; adres: string };
  aan: { naam?: string; email: string }[];
  cc?: { naam?: string; email: string }[];
  onderwerp: string;
  /** Platte tekst; de html-versie wordt ervan gemaakt. */
  tekst: string;
  /** Een eigen html-versie in plaats van de gemaakte, bv. met een knop. */
  html?: string;
  /** Het bericht waarop dit een antwoord is, zodat het in dezelfde draad valt. */
  antwoordOp?: { messageId: string; referenties: string[] };
  /** Door Paaltje zelf verstuurd: dan antwoorden afwezigheidsmelders er niet op. */
  automatisch?: boolean;
  /** Bijlagen, met de inhoud als base64. */
  bijlagen?: { naam: string; type: string; inhoud: string }[];
}

export interface Opgemaakt {
  bericht: string;
  messageId: string;
  ontvangers: string[];
}

/** Een eigen Message-ID, zodat we de mail straks in Verzonden herkennen. */
function nieuwMessageId(adres: string): string {
  const domein = adres.split("@")[1] || "wooshy.local";
  return `<wooshy-${crypto.randomUUID()}@${domein}>`;
}

export async function maakOp(m: Opmaak): Promise<Opgemaakt> {
  const messageId = nieuwMessageId(m.van.adres);
  const referenties = m.antwoordOp
    ? [...m.antwoordOp.referenties, m.antwoordOp.messageId].filter(Boolean).slice(-20)
    : [];

  const composer = new MailComposer({
    from: { name: m.van.naam, address: m.van.adres },
    to: m.aan.map((a) => ({ name: a.naam ?? "", address: a.email })),
    cc: (m.cc ?? []).map((a) => ({ name: a.naam ?? "", address: a.email })),
    subject: m.onderwerp,
    text: m.tekst,
    html: m.html ?? alsHtml(m.tekst),
    messageId,
    date: new Date(),
    ...(m.antwoordOp?.messageId
      ? { inReplyTo: m.antwoordOp.messageId, references: referenties }
      : {}),
    ...(m.automatisch ? { headers: { "Auto-Submitted": "auto-replied" } } : {}),
    ...(m.bijlagen?.length
      ? {
          attachments: m.bijlagen.map((b) => ({
            filename: b.naam,
            content: b.inhoud,
            encoding: "base64",
            contentType: b.type || "application/octet-stream",
          })),
        }
      : {}),
  });

  const buffer = await new Promise<Uint8Array>((ok, nee) =>
    // deno-lint-ignore no-explicit-any
    composer.compile().build((fout: any, uit: Uint8Array) => (fout ? nee(fout) : ok(uit))),
  );

  return {
    // Na het opmaken is alles ASCII (tekensets zijn gecodeerd), dus als tekst
    // over de lijn sturen is veilig.
    bericht: new TextDecoder().decode(buffer),
    messageId,
    ontvangers: [...m.aan, ...(m.cc ?? [])].map((a) => a.email),
  };
}
