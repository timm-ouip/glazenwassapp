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
  /** De categorieën van Paaltje (of die je zelf koos). */
  categorie_ids: string[];
  /** Staat er een antwoord of voorstel klaar dat nog op jou wacht? */
  wacht: boolean;
}

export interface Voorstel {
  overslaan?: { maanden: string[]; adressen: string[]; doorgevoerd?: boolean; teruggedraaid?: boolean };
  stoppen?: { adressen: string[]; doorgevoerd?: boolean };
  /** Waarom Paaltje de bevestiging niet (zeker) kon versturen. */
  bevestiging_fout?: string;
  aanmelding_id?: string;
  prijs?: {
    eigen?: { adres: string; prijs: number }[];
    richtprijzen?: { wijk: string; prijs: number }[];
  };
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
  // Wat Paaltje ervan maakte:
  paaltje_status: "overslaan" | "wacht" | "bezig" | "klaar" | "fout";
  is_klantmail: boolean | null;
  samenvatting: string;
  concept: string;
  zekerheid: number | null;
  voorstel: Voorstel;
  ai_fout: string;
  klant_gok_id: string | null;
  doorgevoerd_op: string | null;
  doorgevoerd_automatisch: boolean;
  beantwoord_op: string | null;
  afgehandeld_op: string | null;
}

/** Waar een lijst uit bestaat: een echte map, of een van de mappen van Paaltje. */
export type Bron =
  | { soort: "map"; mapId: string }
  | { soort: "wacht"; postvakId: string }
  | { soort: "overige"; postvakId: string }
  | { soort: "categorie"; postvakId: string; categorieId: string };

export function bronSleutel(bron: Bron): string {
  switch (bron.soort) {
    case "map":
      return `map:${bron.mapId}`;
    case "categorie":
      return `cat:${bron.categorieId}`;
    default:
      return bron.soort;
  }
}

type Rij = Tables<"berichten">;

const REGEL_KOLOMMEN =
  "id,map_id,richting,van_naam,van_email,aan,onderwerp,fragment,ontvangen_op,gelezen,gemarkeerd,bijlagen,is_klantmail,afgehandeld_op,concept,voorstel,bericht_categorieen(categorie_id)";

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
  | "is_klantmail"
  | "afgehandeld_op"
  | "concept"
  | "voorstel"
> & { bericht_categorieen: { categorie_id: string }[] | null };

function heeftIets(voorstel: unknown): boolean {
  return !!voorstel && typeof voorstel === "object" && Object.keys(voorstel).length > 0;
}

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
    categorie_ids: (r.bericht_categorieen ?? []).map((c) => c.categorie_id),
    wacht:
      r.is_klantmail === true && !r.afgehandeld_op && (r.concept !== "" || heeftIets(r.voorstel)),
  };
}

/**
 * Eén pagina van een lijst, nieuwste eerst. De volgende pagina begint bij
 * "ouder dan de laatste die je al hebt", niet bij een paginanummer: komt er
 * intussen nieuwe mail binnen, dan schuift er anders een mail door naar de
 * volgende pagina en staat hij twee keer in de lijst.
 *
 * De mappen van Paaltje ("Wacht op jou", "Overige post", een categorie) kijken
 * alleen in het postvak: wat je weggooide of verstuurde hoort daar niet in.
 *
 * `zoek` kijkt in afzender en onderwerp; genoeg om een klant terug te vinden
 * zonder zoekindex.
 */
export async function fetchBerichten(
  bron: Bron,
  ouderDan: string | null,
  zoek = "",
): Promise<BerichtRegel[]> {
  const kolommen =
    bron.soort === "categorie"
      ? REGEL_KOLOMMEN.replace("bericht_categorieen(categorie_id)", "bericht_categorieen!inner(categorie_id)")
      : REGEL_KOLOMMEN;

  let query = supabase
    .from("berichten")
    .select(kolommen)
    .eq("op_server", true)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(PER_PAGINA);

  switch (bron.soort) {
    case "map":
      query = query.eq("map_id", bron.mapId);
      break;
    case "wacht":
      query = query
        .eq("map_id", bron.postvakId)
        .eq("is_klantmail", true)
        .is("afgehandeld_op", null)
        .or(WACHT_FILTER);
      break;
    case "overige":
      query = query.eq("map_id", bron.postvakId).eq("is_klantmail", false);
      break;
    case "categorie":
      query = query.eq("map_id", bron.postvakId).eq("bericht_categorieen.categorie_id", bron.categorieId);
      break;
  }

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
  // In een categorie-lijst geeft de !inner-koppeling alleen die ene categorie
  // terug, dus daar staat in de lijst één label; de mail zelf toont ze allemaal.
  return ((data ?? []) as unknown as RegelRij[]).map(alsRegel);
}

/**
 * "Er staat iets klaar": een concept of een voorstel. In de database gefilterd,
 * niet in de browser: anders telt een pagina minder dan 50 en stopt het laden
 * van oudere mail te vroeg.
 */
const WACHT_FILTER = 'concept.neq."",voorstel.neq.{}';

/** Hoeveel mails er op je wachten (voor het telletje bij "Wacht op jou"). */
export async function telWachtend(postvakId: string): Promise<number> {
  const { count, error } = await supabase
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("map_id", postvakId)
    .eq("op_server", true)
    .is("deleted_at", null)
    .eq("is_klantmail", true)
    .is("afgehandeld_op", null)
    .or(WACHT_FILTER);
  if (error) throw error;
  return count ?? 0;
}

const BERICHT_KOLOMMEN = `${REGEL_KOLOMMEN},cc,antwoord_naar,tekst,html,afgekapt,message_id,klant_id,paaltje_status,samenvatting,zekerheid,ai_fout,klant_gok_id,doorgevoerd_op,doorgevoerd_automatisch,beantwoord_op`;

/** Eén mail, zolang hij nog op de server staat en niet weggelegd is. */
export async function fetchBericht(id: string): Promise<Bericht | null> {
  const { data, error } = await supabase
    .from("berichten")
    .select(BERICHT_KOLOMMEN)
    .eq("id", id)
    .eq("op_server", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as RegelRij &
    Pick<
      Rij,
      | "cc"
      | "antwoord_naar"
      | "tekst"
      | "html"
      | "afgekapt"
      | "message_id"
      | "klant_id"
      | "paaltje_status"
      | "samenvatting"
      | "zekerheid"
      | "ai_fout"
      | "klant_gok_id"
      | "doorgevoerd_op"
      | "doorgevoerd_automatisch"
      | "beantwoord_op"
    >;
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
    paaltje_status: r.paaltje_status as Bericht["paaltje_status"],
    is_klantmail: r.is_klantmail,
    samenvatting: r.samenvatting,
    concept: r.concept,
    zekerheid: r.zekerheid,
    voorstel: (r.voorstel as unknown as Voorstel | null) ?? {},
    ai_fout: r.ai_fout,
    klant_gok_id: r.klant_gok_id,
    doorgevoerd_op: r.doorgevoerd_op,
    doorgevoerd_automatisch: r.doorgevoerd_automatisch,
    beantwoord_op: r.beantwoord_op,
    afgehandeld_op: r.afgehandeld_op,
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
 * De klant(en) achter een mailadres: via de gekoppelde mailadressen van
 * klanten (klant_emails), alleen klanten die niet weggelegd zijn. Meestal één;
 * een stel of een beheerder met hetzelfde adres kan er meer opleveren, en dan
 * tonen we ze allemaal in plaats van er stil één te kiezen.
 *
 * Elke fout gaat door naar de kaart: "geen klant" of "niet ingepland" tonen
 * terwijl het opzoeken gewoon mislukte, zet de glazenwasser op het verkeerde
 * been.
 */
export async function fetchKlantBijEmail(email: string, vandaag: string): Promise<KlantBijMail[]> {
  const schoon = email.trim().toLowerCase();
  if (!schoon) return [];
  const { data: koppelingen, error: koppelFout } = await supabase
    .from("klant_emails")
    .select("klant_id")
    .eq("email", schoon)
    .limit(5);
  if (koppelFout) throw koppelFout;
  const ids = [...new Set((koppelingen ?? []).map((k) => k.klant_id))];
  return await klantenMetAdressen(ids, vandaag);
}

/** Klanten op id, met adressen en eerstvolgende wasdag (voor de kaart en de gok). */
/** "Dorpsstraat 12a (Jansen)" per adres, voor een bevestigingsvraag. */
export async function adresNamen(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("customers")
    .select("house_number,addition,streets(name,volledige_naam),klanten(naam)")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  const rijen = (data ?? []) as unknown as {
    house_number: number;
    addition: string | null;
    streets: { name: string; volledige_naam: string | null } | null;
    klanten: { naam: string } | null;
  }[];
  return rijen.map((c) => {
    const straat = c.streets ? c.streets.volledige_naam || c.streets.name : "";
    const adres = `${straat} ${c.house_number}${c.addition ?? ""}`.trim();
    return c.klanten?.naam ? `${adres} (${c.klanten.naam})` : adres;
  });
}

export async function klantenMetAdressen(ids: string[], vandaag: string): Promise<KlantBijMail[]> {
  if (ids.length === 0) return [];
  const { data: klanten, error } = await supabase
    .from("klanten")
    .select("id,naam,telefoon,straat,huisnummer,postcode,plaats")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;

  return await Promise.all(
    (klanten ?? []).map(async (k) => {
      const { data: adressen, error: adresFout } = await supabase
        .from("customers")
        .select("id,interval_maanden,ritme")
        .eq("klant_id", k.id)
        .is("deleted_at", null)
        .is("inactief_op", null);
      if (adresFout) throw adresFout;

      const adresIds = (adressen ?? []).map((a) => a.id);
      let volgendeWasdag: string | null = null;
      if (adresIds.length > 0) {
        const { data: dag, error: dagFout } = await supabase
          .from("wasdag_regels")
          .select("datum")
          .in("customer_id", adresIds)
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
