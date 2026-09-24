/**
 * Praten met Mollie.
 *
 * Eén ding is hier leidend: **we geloven nooit wat er binnenkomt, we vragen
 * het na.** Een melding van Mollie zegt alleen "er is iets gebeurd"; wat er
 * precies betaald is, halen we daarna zelf op met de sleutel van het bedrijf.
 * Zo kan iemand die de meldings-URL kent hooguit een extra navraag uitlokken,
 * en nooit een factuur op betaald zetten.
 *
 * Er wordt met een **betaallink** gewerkt en niet met een gewone betaling:
 * een gewone Mollie-betaling verloopt na een kwartier, en dat is precies
 * verkeerd voor een factuur die veertien dagen open staat.
 */
import { ontsleutel } from "./geheim.ts";

const MOLLIE = "https://api.mollie.com/v2";
/**
 * Hoe lang we op Mollie wachten. Zonder grens kan één trage aanroep een hele
 * maandrun ophouden -- met de factuurnummers al getrokken en een deel wel en
 * een deel niet verstuurd. Liever een factuur zonder knop dan een run die
 * halverwege blijft staan.
 */
const WACHTTIJD = 15000;

export interface Betaallink {
  id: string;
  url: string;
}

/** Bedragen gaan bij Mollie als tekst met twee decimalen over de lijn. */
function bedragUit(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function bedragIn(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * De dag waarop betaald is, in Nederlandse tijd.
 *
 * Mollie schrijft zijn tijden in wereldtijd. Zomaar de eerste tien tekens
 * afknippen zet een betaling van half één 's nachts op de dag ervóór -- en op
 * 1 januari of 1 juli schuift zo'n betaling een heel kwartaal terug, precies
 * waar het btw-overzicht op rekent.
 */
function dagIn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA schrijft de datum als 2026-09-24.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(d);
}

/**
 * De sleutel van dit bedrijf, of leeg als er niet gekoppeld is.
 * Vraagt om een client met de service role: de tabel `mollie_geheimen` heeft
 * geen enkele policy, dus niemand anders komt erbij.
 */
export async function mollieSleutel(beheerder: unknown, companyId: string): Promise<string> {
  // Net genoeg van de Supabase-client om deze ene rij op te halen. Het hele
  // clienttype meenemen zou dit bestand aan supabase-js vastklinken voor één
  // select.
  const db = beheerder as {
    from: (tabel: string) => {
      select: (velden: string) => {
        eq: (
          kolom: string,
          waarde: string,
        ) => {
          maybeSingle: () => Promise<{ data: { versleuteld?: string; iv?: string } | null }>;
        };
      };
    };
  };
  const { data } = await db
    .from("mollie_geheimen")
    .select("versleuteld,iv")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return "";
  try {
    return await ontsleutel(String(data.versleuteld), String(data.iv));
  } catch {
    // Onleesbaar geheim: dat gaat niet vanzelf over, maar het mag nooit een
    // factuur tegenhouden. De beller ziet een lege sleutel en slaat Mollie over.
    console.error("Mollie-sleutel niet te openen voor bedrijf", companyId);
    return "";
  }
}

async function vraag(
  sleutel: string,
  pad: string,
  opties: { methode?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const antwoord = await fetch(`${MOLLIE}${pad}`, {
    method: opties.methode ?? "GET",
    headers: {
      Authorization: `Bearer ${sleutel}`,
      ...(opties.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opties.body ? { body: JSON.stringify(opties.body) } : {}),
    signal: AbortSignal.timeout(WACHTTIJD),
  });
  const tekst = await antwoord.text();
  let uit: Record<string, unknown> = {};
  try {
    uit = tekst ? (JSON.parse(tekst) as Record<string, unknown>) : {};
  } catch {
    uit = {};
  }
  if (!antwoord.ok) {
    const melding =
      String((uit as { detail?: string }).detail ?? "").trim() ||
      `Mollie antwoordde met ${antwoord.status}.`;
    throw new Error(melding);
  }
  return uit;
}

/** Kijken of een sleutel echt werkt, zonder iets aan te maken. */
export async function mollieWerkt(sleutel: string): Promise<void> {
  await vraag(sleutel, "/payment-links?limit=1");
}

/**
 * Een betaallink voor één factuur.
 *
 * Geen `redirectUrl`: we hebben geen eigen factuurpagina om de klant daarna
 * heen te sturen, en dan laat Mollie zelf netjes zien dat het gelukt is.
 * Geen `expiresAt` om dezelfde reden als hierboven -- de link moet blijven
 * werken zolang de factuur open staat.
 */
export async function maakBetaallink(
  sleutel: string,
  gegevens: { bedrag: number; omschrijving: string; meldingUrl: string },
): Promise<Betaallink> {
  const uit = await vraag(sleutel, "/payment-links", {
    methode: "POST",
    body: {
      amount: { currency: "EUR", value: bedragUit(gegevens.bedrag) },
      // Mollie kapt af op 255 tekens en zet dit op het bankafschrift.
      description: gegevens.omschrijving.slice(0, 255),
      webhookUrl: gegevens.meldingUrl,
    },
  });
  const id = String(uit.id ?? "");
  const links = (uit._links ?? {}) as { paymentLink?: { href?: string } };
  const url = String(links.paymentLink?.href ?? "");
  if (!id || !url) throw new Error("Mollie gaf geen bruikbare betaallink terug.");
  return { id, url };
}

/**
 * Wat er via deze betaallink echt binnen is, en wanneer de laatste betaling
 * binnenkwam.
 *
 * Alleen betalingen met de status `paid` tellen, en wat daarvan is
 * teruggestort of teruggeboekt gaat er weer af. Een terugstorting hoort de
 * factuur weer open te zetten -- anders staat er "betaald" bij geld dat niet
 * meer van jou is.
 */
export async function betaaldViaLink(
  sleutel: string,
  linkId: string,
): Promise<{ bedrag: number; op: string | null }> {
  let pad: string | null = `/payment-links/${encodeURIComponent(linkId)}/payments?limit=250`;
  let totaal = 0;
  let laatsteTijd = 0;
  let laatsteDag = "";
  // Meer dan 250 betalingen op één factuur is ondenkbaar, maar een lus die
  // niet eindigt is dat ook -- vandaar de harde grens van vier bladzijden.
  for (let blad = 0; pad && blad < 4; blad += 1) {
    const uit: Record<string, unknown> = await vraag(sleutel, pad);
    const ingebed = (uit._embedded ?? {}) as { payments?: Record<string, unknown>[] };
    for (const p of ingebed.payments ?? []) {
      if (String(p.status ?? "") !== "paid") continue;
      const bedrag = (p.amount ?? {}) as { value?: string };
      const terug = (p.amountRefunded ?? {}) as { value?: string };
      const teruggeboekt = (p.amountChargedBack ?? {}) as { value?: string };
      totaal += bedragIn(bedrag.value) - bedragIn(terug.value) - bedragIn(teruggeboekt.value);
      const op = String(p.paidAt ?? "");
      const tijd = op ? new Date(op).getTime() : 0;
      if (tijd && tijd > laatsteTijd) {
        laatsteTijd = tijd;
        laatsteDag = dagIn(op);
      }
    }
    const volgende = ((uit._links ?? {}) as { next?: { href?: string } }).next?.href ?? "";
    pad = volgende.startsWith(MOLLIE) ? volgende.slice(MOLLIE.length) : null;
  }
  return {
    bedrag: Math.round(Math.max(totaal, 0) * 100) / 100,
    op: laatsteDag || null,
  };
}

/**
 * Het kenmerk dat in de meldings-URL meegaat.
 *
 * De melding wordt nog steeds niet geloofd -- dit is alleen een slot op de
 * deur, zodat niet iedereen die een factuur-id te pakken krijgt onbeperkt
 * navraag bij Mollie kan uitlokken en zo de limiet van het Mollie-account kan
 * opsouperen. Afgeleid van dezelfde MAIL_SLEUTEL die de geheimen versleutelt:
 * zelfde server, zelfde vertrouwensgrens, en niets extra's om in te stellen.
 */
export async function meldingKenmerk(factuurId: string): Promise<string> {
  const ruw = Deno.env.get("MAIL_SLEUTEL") ?? "";
  if (!ruw) return "";
  const sleutel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ruw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const uit = await crypto.subtle.sign(
    "HMAC",
    sleutel,
    new TextEncoder().encode(`mollie:${factuurId}`),
  );
  return [...new Uint8Array(uit)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Twee kenmerken vergelijken zonder te verraden hoe ver je kwam. */
export function kenmerkKlopt(verwacht: string, gegeven: string): boolean {
  if (!verwacht || verwacht.length !== gegeven.length) return false;
  let verschil = 0;
  for (let i = 0; i < verwacht.length; i += 1) {
    verschil |= verwacht.charCodeAt(i) ^ gegeven.charCodeAt(i);
  }
  return verschil === 0;
}
