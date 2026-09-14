/**
 * De mail in Wooshy lezen: lijsten per map en één bericht in zijn geheel.
 *
 * Alles hier is lezen, rechtstreeks uit de database; RLS laat alleen de
 * eigenaar bij de berichten. Wat de mailbox verandert (gelezen, weggooien,
 * versturen) gaat langs de Edge Function, want dat moet ook op de server
 * gebeuren.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export interface Adres {
  naam: string;
  email: string;
}

export interface Bijlage {
  naam: string;
  type: string;
  grootte: number;
}

/** Wat de lijst nodig heeft: één regel per mail, zonder de hele tekst. */
export interface BerichtRegel {
  id: string;
  map_id: string;
  richting: "in" | "uit";
  van_naam: string;
  van_email: string;
  aan: Adres[];
  onderwerp: string;
  fragment: string;
  ontvangen_op: string;
  gelezen: boolean;
  gemarkeerd: boolean;
  heeft_bijlagen: boolean;
}

export interface Bericht extends BerichtRegel {
  cc: Adres[];
  antwoord_naar: string;
  tekst: string;
  html: string;
  bijlagen: Bijlage[];
  afgekapt: boolean;
  message_id: string;
  klant_id: string | null;
}

type Rij = Tables<"berichten">;

const REGEL_KOLOMMEN =
  "id,map_id,richting,van_naam,van_email,aan,onderwerp,fragment,ontvangen_op,gelezen,gemarkeerd,bijlagen";

/** Zoveel mails per keer in de lijst; verder scrollen haalt de volgende op. */
export const PER_PAGINA = 50;

type RegelRij = Pick<
  Rij,
  | "id"
  | "map_id"
  | "richting"
  | "van_naam"
  | "van_email"
  | "aan"
  | "onderwerp"
  | "fragment"
  | "ontvangen_op"
  | "gelezen"
  | "gemarkeerd"
  | "bijlagen"
>;

function alsRegel(r: RegelRij): BerichtRegel {
  return {
    id: r.id,
    map_id: r.map_id,
    richting: r.richting === "uit" ? "uit" : "in",
    van_naam: r.van_naam,
    van_email: r.van_email,
    aan: (r.aan as unknown as Adres[] | null) ?? [],
    onderwerp: r.onderwerp,
    fragment: r.fragment,
    ontvangen_op: r.ontvangen_op,
    gelezen: r.gelezen,
    gemarkeerd: r.gemarkeerd,
    heeft_bijlagen: Array.isArray(r.bijlagen) && r.bijlagen.length > 0,
  };
}

/**
 * Eén pagina van een map, nieuwste eerst. De volgende pagina begint bij "ouder
 * dan de laatste die je al hebt", niet bij een paginanummer: komt er intussen
 * nieuwe mail binnen, dan schuift er anders een mail door naar de volgende
 * pagina en staat hij twee keer in de lijst.
 *
 * `zoek` kijkt in afzender en onderwerp; genoeg om een klant terug te vinden
 * zonder zoekindex.
 */
export async function fetchBerichten(
  mapId: string,
  ouderDan: string | null,
  zoek = "",
): Promise<BerichtRegel[]> {
  let query = supabase
    .from("berichten")
    .select(REGEL_KOLOMMEN)
    .eq("map_id", mapId)
    .eq("op_server", true)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(PER_PAGINA);
  // lte en niet lt: twee mails op precies dezelfde tijd vallen anders net
  // tussen twee pagina's weg. Dubbele haalt de lijst er zelf uit.
  if (ouderDan) query = query.lte("ontvangen_op", ouderDan);

  // Tekens die de filtertaal van PostgREST zelf gebruikt, eruit.
  const term = zoek.replace(/[%,()*"\\]/g, " ").trim();
  if (term) {
    query = query.or(
      `onderwerp.ilike.%${term}%,van_naam.ilike.%${term}%,van_email.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as RegelRij[]).map(alsRegel);
}

/** Eén mail, zolang hij nog op de server staat en niet weggelegd is. */
export async function fetchBericht(id: string): Promise<Bericht | null> {
  const { data, error } = await supabase
    .from("berichten")
    .select(`${REGEL_KOLOMMEN},cc,antwoord_naar,tekst,html,afgekapt,message_id,klant_id`)
    .eq("id", id)
    .eq("op_server", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as RegelRij &
    Pick<Rij, "cc" | "antwoord_naar" | "tekst" | "html" | "afgekapt" | "message_id" | "klant_id">;
  return {
    ...alsRegel(r),
    cc: (r.cc as unknown as Adres[] | null) ?? [],
    antwoord_naar: r.antwoord_naar,
    tekst: r.tekst,
    html: r.html,
    bijlagen: (r.bijlagen as unknown as Bijlage[] | null) ?? [],
    afgekapt: r.afgekapt,
    message_id: r.message_id,
    klant_id: r.klant_id,
  };
}

/** Wat de klantkaart naast een mail laat zien. */
export interface KlantBijMail {
  id: string;
  naam: string;
  telefoon: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  plaats: string;
  adressen: { id: string; interval_maanden: number; ritme: number }[];
  /** De eerstvolgende ingeplande dag voor een van zijn adressen, 'jjjj-mm-dd'. */
  volgendeWasdag: string | null;
}

/**
 * De klant(en) achter een mailadres. Meestal één; een stel of een beheerder
 * met hetzelfde adres kan er meer opleveren, en dan tonen we ze allemaal in
 * plaats van er stil één te kiezen.
 *
 * Elke fout gaat door naar de kaart: "geen klant" of "niet ingepland" tonen
 * terwijl het opzoeken gewoon mislukte, zet de glazenwasser op het verkeerde
 * been.
 */
export async function fetchKlantBijEmail(email: string, vandaag: string): Promise<KlantBijMail[]> {
  const schoon = email.trim();
  if (!schoon) return [];
  // ilike zonder jokertekens: een % of _ in een adres mag geen patroon worden.
  const patroon = schoon.replace(/[\\%_]/g, (t) => `\\${t}`);
  const { data: klanten, error } = await supabase
    .from("klanten")
    .select("id,naam,telefoon,straat,huisnummer,postcode,plaats")
    .ilike("email", patroon)
    .is("deleted_at", null)
    .limit(3);
  if (error) throw error;

  return await Promise.all(
    (klanten ?? []).map(async (k) => {
      const { data: adressen, error: adresFout } = await supabase
        .from("customers")
        .select("id,interval_maanden,ritme")
        .eq("klant_id", k.id)
        .is("deleted_at", null);
      if (adresFout) throw adresFout;

      const ids = (adressen ?? []).map((a) => a.id);
      let volgendeWasdag: string | null = null;
      if (ids.length > 0) {
        const { data: dag, error: dagFout } = await supabase
          .from("wasdag_regels")
          .select("datum")
          .in("customer_id", ids)
          .gte("datum", vandaag)
          .order("datum", { ascending: true })
          .limit(1);
        if (dagFout) throw dagFout;
        volgendeWasdag = dag?.[0]?.datum ?? null;
      }
      return {
        ...k,
        adressen: (adressen ?? []).map((a) => ({
          id: a.id,
          interval_maanden: a.interval_maanden ?? 1,
          ritme: a.ritme ?? 1,
        })),
        volgendeWasdag,
      };
    }),
  );
}

/** Wie het is, zoals een mailprogramma het in de lijst zet. */
export function afzenderNaam(b: Pick<BerichtRegel, "richting" | "van_naam" | "van_email" | "aan">) {
  if (b.richting === "uit") {
    const eerste = b.aan[0];
    return `Aan: ${eerste?.naam || eerste?.email || "(niemand)"}`;
  }
  return b.van_naam || b.van_email || "(onbekend)";
}

/** Vandaag de tijd, dit jaar dag en maand, anders ook het jaar. */
export function lijstDatum(iso: string): string {
  const d = new Date(iso);
  const nu = new Date();
  if (d.toDateString() === nu.toDateString()) {
    return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === nu.getFullYear()) {
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Mail-html klaarmaken om te tonen. Het afgesloten kader houdt scripts en
 * formulieren al tegen; dit gaat over wat het kader níet tegenhoudt:
 *
 *  - links met een eigen `target` of een `javascript:`-adres, die een venster
 *    openen dat nog vat heeft op het Wooshy-tabblad;
 *  - een eigen `<base>` in de mail, die onze instellingen zou overschrijven.
 *
 * DOMParser voert niets uit: hij bouwt alleen de boom, zodat we die kunnen
 * nalopen.
 */
export function veiligeMailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, base, meta, link, form, iframe, object, embed").forEach((el) => el.remove());
  doc.querySelectorAll("a, area").forEach((el) => {
    const href = (el.getAttribute("href") ?? "").trim();
    if (!/^(https?:|mailto:|tel:)/i.test(href)) {
      el.removeAttribute("href");
    }
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  });
  return doc.body.innerHTML;
}
