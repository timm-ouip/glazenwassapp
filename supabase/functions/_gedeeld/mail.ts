/**
 * Wat de twee mailfuncties allebei nodig hebben: de antwoordkop, het opmaken
 * van platte tekst tot een mailtje, en het praten met Brevo.
 */

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function antwoord(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Tekst die in html terechtkomt mag geen html zijn. */
export function veilig(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Platte tekst als mailtje. Geen sjabloon met logo's en knoppen: dit is een
 * berichtje van de glazenwasser, en dat hoort eruit te zien als een berichtje
 * van de glazenwasser. Witregels worden alinea's, enkele returns een regel.
 */
export function alsHtml(tekst: string): string {
  const alineas = tekst
    .split(/\n{2,}/)
    .map((stuk) => veilig(stuk.trim()).replace(/\n/g, "<br />"))
    .filter((stuk) => stuk.length > 0)
    .map((stuk) => `<p style="margin:0 0 14px">${stuk}</p>`)
    .join("");
  return [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#1f2320;max-width:560px">',
    alineas,
    "</div>",
  ].join("");
}

/** `{{naam}}` en `{{adres}}` invullen. Onbekende haakjes laten we staan. */
export function vulIn(sjabloon: string, velden: Record<string, string>): string {
  return sjabloon.replace(/\{\{\s*(naam|adres)\s*\}\}/g, (heel, sleutel: string) =>
    sleutel in velden ? velden[sleutel] : heel,
  );
}

export interface BrevoAfzender {
  naam: string;
  email: string;
}

export interface BrevoMail {
  naar: { email: string; naam: string };
  onderwerp: string;
  tekst: string;
  antwoordNaar?: string;
}

/**
 * Eén mail langs Brevo. Bewust per ontvanger en niet één aanroep met honderd
 * adressen erin: dan zou iedereen elkaars adres zien, en zou één geweigerd
 * adres de hele verzending laten mislukken. Nu weten we per adres of het
 * gelukt is.
 */
export async function stuurMail(
  sleutel: string,
  afzender: BrevoAfzender,
  mail: BrevoMail,
): Promise<{ ok: true; id: string } | { ok: false; fout: string }> {
  const body: Record<string, unknown> = {
    sender: { name: afzender.naam, email: afzender.email },
    to: [{ email: mail.naar.email, name: mail.naar.naam || mail.naar.email }],
    subject: mail.onderwerp,
    htmlContent: alsHtml(mail.tekst),
    textContent: mail.tekst,
  };
  if (mail.antwoordNaar) body["replyTo"] = { email: mail.antwoordNaar, name: afzender.naam };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": sleutel,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const tekst = await res.text();
      return { ok: false, fout: `${res.status}: ${tekst.slice(0, 300)}` };
    }
    const json = (await res.json()) as { messageId?: string };
    return { ok: true, id: json.messageId ?? "" };
  } catch (e) {
    return { ok: false, fout: e instanceof Error ? e.message : "onbekende fout" };
  }
}

/**
 * Een lijst in stukjes aflopen, een paar tegelijk. Honderd mails één voor één
 * duurt te lang voor één aanroep; honderd tegelijk krijgt een rem van Brevo.
 * Zes tegelijk zit daar comfortabel tussenin.
 */
export async function perGroepje<T, R>(
  lijst: T[],
  tegelijk: number,
  doe: (item: T) => Promise<R>,
): Promise<R[]> {
  const uit: R[] = [];
  for (let i = 0; i < lijst.length; i += tegelijk) {
    uit.push(...(await Promise.all(lijst.slice(i, i + tegelijk).map(doe))));
  }
  return uit;
}

/**
 * Supabase laat een `in`-filter als querystring reizen, dus een lijst van
 * honderden id's maakt de URL te lang. Zelfde stukjes als in de app.
 */
export function inStukjes<T>(lijst: T[], per = 100): T[][] {
  const uit: T[][] = [];
  for (let i = 0; i < lijst.length; i += per) uit.push(lijst.slice(i, i + per));
  return uit;
}
