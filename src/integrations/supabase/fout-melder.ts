/**
 * TIJDELIJK — op zoek naar de oorzaak van het uitloggen bij
 * Betalingen → Facturen → Versturen.
 *
 * De console laat van een mislukt verzoek alleen "status 400" zien; de
 * eigenlijke melding zit in het antwoord zelf en verdwijnt daarmee. Dit
 * haakje leest dat antwoord alsnog en zet het in de console.
 *
 * Daarnaast meldt het hoe lang een inlogtoken geldig is: bij het opstarten
 * van de bewaarde sessie, en daarna van elk nieuw token. Supabase ververst
 * een token zodra het binnen 90 seconden verloopt, dus staat die geldigheid
 * korter dan ongeveer twee minuten, dan is de app voortdurend aan het
 * verversen en gaat het vroeg of laat mis.
 *
 * Alleen tijdens ontwikkelen: foutteksten van Supabase bevatten soms
 * klantgegevens ("Key (email)=(...) already exists"), en die horen niet in
 * de console van een gebruiker of in de logboeken van Cloudflare.
 *
 * Er worden nooit tokens gelogd — alleen het pad, de status, de
 * foutmelding en een aantal seconden.
 *
 * Weghalen zodra de oorzaak bekend is: dit bestand plus de twee regels in
 * client.ts die ernaar verwijzen.
 */

const AAN = import.meta.env.DEV;

/** Alleen het pad; de zoekreeks kan een token bevatten (magic links). */
function pad(url: string): string {
  try {
    const u = new URL(url);
    const soort = u.searchParams.get("grant_type");
    return u.pathname + (soort ? `?grant_type=${soort}` : "");
  } catch {
    return "(onbekend pad)";
  }
}

/** Een rij die er niet is, is geen fout — die meldt Supabase als 406. */
function isOnschuldig(res: Response, tekst: string): boolean {
  return res.status === 406 && tekst.includes("PGRST116");
}

async function tekstVan(res: Response): Promise<string> {
  try {
    return (await res.clone().text()).slice(0, 500);
  } catch {
    return "(antwoord niet te lezen)";
  }
}

export async function meldMislukt(res: Response): Promise<Response> {
  if (!AAN) return res;
  const weg = pad(res.url);

  if (!res.ok) {
    const tekst = await tekstVan(res);
    if (!isOnschuldig(res, tekst)) {
      console.error(`[Supabase ${res.status}] ${weg} → ${tekst}`);
    }
    return res;
  }

  // Een geslaagd token-antwoord: hoe lang is dit token geldig?
  if (weg.startsWith("/auth/v1/token")) {
    try {
      const body = (await res.clone().json()) as { expires_in?: number };
      if (typeof body.expires_in === "number") {
        console.info(`[Supabase] nieuw token, ${body.expires_in} seconden geldig (${weg})`);
      }
    } catch {
      // Geen leesbaar antwoord; niets aan de hand, dit is alleen meekijken.
    }
  }

  return res;
}

/**
 * Eenmalig bij het opstarten: wat staat er al in de browser? Een sessie die
 * uit een eerdere keer komt doet geen tokenverzoek, dus zonder dit zie je de
 * geldigheidsduur pas na de eerstvolgende verversing.
 */
function meldBewaardeSessie(): void {
  if (!AAN || typeof localStorage === "undefined") return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const sleutel = localStorage.key(i);
      if (!sleutel?.startsWith("sb-")) continue;
      const rauw = localStorage.getItem(sleutel);
      if (!rauw) continue;
      const sessie = JSON.parse(rauw) as { access_token?: string; expires_at?: number };
      if (!sessie?.access_token || typeof sessie.expires_at !== "number") continue;

      const deel = sessie.access_token.split(".")[1];
      if (!deel) continue;
      const lading = JSON.parse(atob(deel.replace(/-/g, "+").replace(/_/g, "/"))) as {
        iat?: number;
        exp?: number;
      };
      const nu = Math.round(Date.now() / 1000);
      const duur = lading.exp && lading.iat ? lading.exp - lading.iat : null;
      console.info(
        `[Supabase] bewaarde sessie: token ${duur ?? "?"} seconden geldig, ` +
          `verloopt over ${sessie.expires_at - nu} seconden`,
      );
    }
  } catch {
    // Onleesbaar of afgeschermd; dit is alleen meekijken.
  }
}

meldBewaardeSessie();
