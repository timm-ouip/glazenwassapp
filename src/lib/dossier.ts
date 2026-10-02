/**
 * Wat het klantdossier opvraagt en uitrekent, los van het scherm: de tellers
 * in het menu, het jaar in twaalf vakjes, de volgende beurt, wat er open
 * staat en de laatste mail. Het dossier zelf staat in KlantgegevensDialog en
 * src/components/dossier/.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GeldDeel } from "@/lib/betalingen";
import { eersteMaand, ritmeMaanden, toonMaand, volgendeMaand, type Customer } from "@/lib/klanten";
import type { Gebeurtenis } from "@/lib/overzichten";

// ---------------------------------------------------------------------------
// Opvragen
// ---------------------------------------------------------------------------

/** Binnengekomen berichten (mail en WhatsApp) van een klant die nog niemand las. */
export async function telOngelezen(klantId: string): Promise<number> {
  const { count, error } = await supabase
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("klant_id", klantId)
    .eq("richting", "in")
    .eq("gelezen", false)
    .is("deleted_at", null)
    .is("uit_dossier_op", null)
    // Mail die niet meer in de mailbox staat, kan niet meer op gelezen; die
    // zou het getal voor altijd ophouden.
    .or("kanaal.neq.mail,op_server.eq.true");
  if (error) throw error;
  return count ?? 0;
}

export interface LaatsteMail {
  onderwerp: string;
  ontvangen_op: string;
  richting: "in" | "uit";
  /** Het antwoord dat Paaltje klaarzette; leeg als er niets klaarstaat. */
  concept: string;
  beantwoord_op: string | null;
  afgehandeld_op: string | null;
}

/** De nieuwste mail in het dossier van een klant (niet uit het dossier gehaald). */
export async function fetchLaatsteMail(klantId: string): Promise<LaatsteMail | null> {
  const { data, error } = await supabase
    .from("berichten")
    .select("onderwerp,ontvangen_op,richting,concept,beantwoord_op,afgehandeld_op")
    .eq("kanaal", "mail")
    .eq("klant_id", klantId)
    .is("deleted_at", null)
    .is("uit_dossier_op", null)
    .order("ontvangen_op", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    onderwerp: data.onderwerp ?? "",
    ontvangen_op: data.ontvangen_op,
    richting: data.richting === "uit" ? "uit" : "in",
    concept: data.concept ?? "",
    beantwoord_op: data.beantwoord_op ?? null,
    afgehandeld_op: data.afgehandeld_op ?? null,
  };
}

/** Staat er een antwoord van Paaltje klaar dat nog niet verstuurd of afgehandeld is? */
export function antwoordKlaar(m: LaatsteMail | null | undefined): boolean {
  return Boolean(
    m && m.richting === "in" && m.concept.trim() && !m.beantwoord_op && !m.afgehandeld_op,
  );
}

export interface Beurt {
  /** De dag waarop hij gepland staat, jjjj-mm-dd. */
  datum: string;
  /** De ronde ("2026-10") waar de beurt bij hoort; niet altijd de maand van de datum. */
  ronde: string;
  ploeg_nr: number | null;
}

/** De eerstvolgende beurt die op de planning staat, vandaag meegeteld. */
export async function fetchVolgendeBeurt(adresId: string, vandaag: string): Promise<Beurt | null> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("datum,ronde,ploeg_nr")
    .eq("customer_id", adresId)
    .gte("datum", vandaag)
    .is("gedaan_op", null)
    .is("niet_gewassen_op", null)
    .order("datum", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * De rondes van dit jaar ("2026-02") waarin het adres echt gewassen is.
 * Op ronde en niet op datum: een septemberbeurt die op 2 oktober gebeurt,
 * hoort bij september (zie fetchLaatsteRonde in betalingen).
 */
export async function fetchGewassenRondes(adresId: string, jaar: number): Promise<string[]> {
  const { data, error } = await supabase
    .from("wasdag_regels")
    .select("ronde")
    .eq("customer_id", adresId)
    .like("ronde", `${jaar}-%`)
    .not("gedaan_op", "is", null)
    .is("niet_gewassen_op", null);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.ronde))].sort();
}

// ---------------------------------------------------------------------------
// Uitrekenen
// ---------------------------------------------------------------------------

/** "augustus en september", of "juli, augustus en september". */
export function opsomming(delen: string[]): string {
  if (delen.length <= 1) return delen[0] ?? "";
  return `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;
}

/**
 * Waar het open bedrag voor staat, in één regel: "augustus en september ·
 * 2 wasbeurten". De maanden zijn die van de rondes; een klus telt apart.
 */
export function openOmschrijving(delen: GeldDeel[]): string {
  const maanden = new Set<string>();
  let beurten = 0;
  let klussen = 0;
  for (const d of delen) {
    if (d.soort === "klus") {
      klussen += 1;
      continue;
    }
    // Een beginstand van alleen een letter of + van de kaart is geen beurt (aantal 0).
    beurten += d.soort === "beginstand" ? d.aantal : 1;
    if (d.soort === "wassen") maanden.add(d.datum.slice(0, 7));
    // De beginstand zegt in zijn omschrijving voor welke maanden hij staat.
    else for (const m of d.omschrijving.split(",")) if (/^\d{4}-\d{2}$/.test(m)) maanden.add(m);
  }
  const tellers = [
    beurten > 0 ? `${beurten} ${beurten === 1 ? "wasbeurt" : "wasbeurten"}` : "",
    klussen > 0 ? `${klussen} ${klussen === 1 ? "klus" : "klussen"}` : "",
  ].filter(Boolean);
  const wanneer = opsomming([...maanden].sort().map(toonMaand));
  return [wanneer, tellers.join(" en ")].filter(Boolean).join(" · ");
}

/** Waar een betaling binnenkwam, zoals in de regel "22 jul · aan de deur". */
export function bronTekst(bron: Gebeurtenis["bron"]): string {
  return bron === "geldloop" ? "aan de deur" : bron === "dag" ? "overdag" : "op kantoor";
}

/** De nieuwste betaling die niet ongedaan is gemaakt. */
export function laatsteBetaling(gebeurtenissen: Gebeurtenis[]): Gebeurtenis | null {
  return (
    gebeurtenissen
      .filter((g) => g.soort === "betaald" && !g.ongedaan)
      .sort((a, b) => b.op.localeCompare(a.op))[0] ?? null
  );
}

/** "22 jul": dag en korte maand, zoals in het dossier. */
export function korteDatum(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** "22 jul", met het jaar erbij als het niet dit jaar was. */
export function regelDatum(iso: string): string {
  const jaar = new Date(iso).getFullYear();
  return jaar === new Date().getFullYear() ? korteDatum(iso) : `${korteDatum(iso)} ${jaar}`;
}

/** "Do 15 oktober": de volgende beurt in het dossier. */
export function beurtDatum(datum: string): string {
  const d = new Date(`${datum}T12:00:00`);
  if (Number.isNaN(d.getTime())) return datum;
  const dag = d.toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "");
  const rest = d.toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
  return `${dag.charAt(0).toUpperCase()}${dag.slice(1)} ${rest}`;
}

/**
 * De eerste maand vanaf `vanaf` waarin dit adres volgens zijn frequentie aan
 * de beurt is: niet overgeslagen, en niet vóór zijn startmaand. Voor als er
 * nog niets op de planning staat. Hooguit twee jaar vooruit.
 */
export function volgendeFrequentieMaand(
  c: Pick<
    Customer,
    "interval_maanden" | "ritme" | "overslaan" | "start_maand" | "created_at" | "geimporteerd"
  >,
  vanaf: string,
): string | null {
  const beurten = ritmeMaanden(c);
  const start = eersteMaand(c);
  let m = vanaf;
  for (let i = 0; i < 24; i++) {
    if (m >= start && !c.overslaan.includes(m) && beurten.includes(Number(m.slice(5, 7)))) return m;
    m = volgendeMaand(m);
  }
  return null;
}

/**
 * De maand van de volgende beurt: de ronde van wat er op de planning staat,
 * en anders de eerstvolgende maand van de frequentie. Geen bij een inactief
 * adres. Het jaar op het Overzicht en de geldkaart op Geld gebruiken allebei
 * deze, zodat de oranje rand altijd op dezelfde maand staat.
 */
export function volgendeBeurtMaand(
  c: Parameters<typeof volgendeFrequentieMaand>[0] & { inactief_op?: string | null },
  beurt: Pick<Beurt, "ronde"> | null,
  dezeMaand: string,
): string | null {
  if (c.inactief_op) return null;
  return beurt?.ronde ?? (c.interval_maanden ? volgendeFrequentieMaand(c, dezeMaand) : null);
}

export type JaarStatus = "gewassen" | "volgende" | "overslaan" | "beurt" | "geen";

export interface JaarVak {
  /** "2026-03" */
  maand: string;
  /** "m": de eerste letter, zoals in het ontwerp. */
  letter: string;
  status: JaarStatus;
  /** Kun je hem aantikken om over te slaan (of terug te zetten)? */
  tikbaar: boolean;
}

const LETTERS = "jfmamjjasond";

/**
 * Het jaar in twaalf vakjes. Groen is gewassen, de oranje rand de volgende
 * beurt, geel overgeslagen; een maand buiten de frequentie is grijs. Een
 * gewassen maand of een maand die al voorbij is tik je niet meer aan.
 */
export function jaarVakken(
  jaar: number,
  c: Pick<Customer, "interval_maanden" | "ritme" | "overslaan">,
  gewassen: string[],
  volgende: string | null,
  dezeMaand: string,
): JaarVak[] {
  const beurten = ritmeMaanden(c);
  return Array.from({ length: 12 }, (_, i) => {
    const maand = `${jaar}-${String(i + 1).padStart(2, "0")}`;
    const isGewassen = gewassen.includes(maand);
    const status: JaarStatus = isGewassen
      ? "gewassen"
      : c.overslaan.includes(maand)
        ? "overslaan"
        : maand === volgende
          ? "volgende"
          : beurten.includes(i + 1)
            ? "beurt"
            : "geen";
    return {
      maand,
      letter: LETTERS[i]!,
      status,
      tikbaar: !isGewassen && maand >= dezeMaand,
    };
  });
}
