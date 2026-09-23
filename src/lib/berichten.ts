/**
 * De mail in Paaltje Systems lezen: lijsten per map en één bericht in zijn geheel.
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
  /** Staat er een antwoord of voorstel klaar dat nog op jou wacht, of ging de herinnering af? */
  wacht: boolean;
  /** Herinnering: op dit moment komt de mail in "Wacht op jou". */
  herinner_op: string | null;
}

export interface Voorstel {
  overslaan?: {
    maanden: string[];
    adressen: string[];
    doorgevoerd?: boolean;
    teruggedraaid?: boolean;
  };
  stoppen?: { adressen: string[]; doorgevoerd?: boolean };
  /** Waarom Paaltje de bevestiging niet (zeker) kon versturen. */
  bevestiging_fout?: string;
  aanmelding_id?: string;
  prijs?: {
    eigen?: { adres: string; prijs: number }[];
    richtprijzen?: { wijk: string; prijs: number }[];
  };
}

export type KlantVeld =
  | "naam"
  | "email"
  | "email2"
  | "telefoon"
  | "telefoon2"
  | "straat"
  | "huisnummer"
  | "postcode"
  | "plaats";

/**
 * Wat Paaltje Systems met de klantgegevens in een mail deed (zie
 * supabase/functions/_gedeeld/klantgegevens.ts, waar het ontstaat).
 */
export interface KlantGegevens {
  /** Wat Paaltje in de mail vond over de afzender. */
  gevonden?: {
    naam: string;
    straat: string;
    huisnummer: string;
    postcode: string;
    plaats: string;
    telefoon: string;
  };
  /** Herkend aan telefoon of adres; het mailadres is toen aan de klant gekoppeld. */
  herkend?: {
    klant_id: string;
    via: "telefoon" | "adres";
    email: string;
    aangemaakt?: boolean;
    customer_id?: string;
  };
  /** Lege velden die Paaltje Systems bij deze klant invulde. */
  toegevoegd?: { klant_id: string; velden: Partial<Record<KlantVeld, string>> };
  /** Wat in de mail anders is dan bij de klant, en niet meer in een leeg vak paste. */
  anders?: { telefoon?: string; email?: string; adres?: string };
  /** Klanten die niet opnieuw herkend mogen worden (teruggedraaid). */
  afgewezen?: string[];
  teruggedraaid?: {
    op: string;
    velden: Partial<Record<KlantVeld, string>>;
    herkend?: {
      klant_id: string;
      via: "telefoon" | "adres";
      email: string;
      aangemaakt?: boolean;
      customer_id?: string;
    };
    /** Velden die intussen door iemand gewijzigd waren en dus bleven staan. */
    bleven: KlantVeld[];
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
  klantgegevens: KlantGegevens;
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
  | { soort: "categorie"; postvakId: string; categorieId: string }
  /** Alle mail met een vlag, uit alle mappen behalve de prullenbak. */
  | { soort: "vlag"; prullenbakId: string | null }
  /** Mail die later verstuurd wordt; geen echte lijst met berichten. */
  | { soort: "gepland" };

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
  "id,map_id,richting,van_naam,van_email,aan,onderwerp,fragment,ontvangen_op,gelezen,gemarkeerd,bijlagen,is_klantmail,afgehandeld_op,concept,voorstel,herinner_op,bericht_categorieen(categorie_id)";

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
  | "herinner_op"
> & { bericht_categorieen: { categorie_id: string }[] | null };

function heeftIets(voorstel: unknown): boolean {
  return !!voorstel && typeof voorstel === "object" && Object.keys(voorstel).length > 0;
}

function alsRegel(r: RegelRij): BerichtRegel {
  return {
    id: r.id,
    // Klantmail uit een verdwenen map heeft geen map meer; die staat alleen in het dossier.
    map_id: r.map_id ?? "",
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
    herinner_op: r.herinner_op,
    wacht:
      (r.is_klantmail === true &&
        !r.afgehandeld_op &&
        (r.concept !== "" || heeftIets(r.voorstel))) ||
      (!!r.herinner_op && new Date(r.herinner_op) <= new Date()),
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
      ? REGEL_KOLOMMEN.replace(
          "bericht_categorieen(categorie_id)",
          "bericht_categorieen!inner(categorie_id)",
        )
      : REGEL_KOLOMMEN;

  let query = supabase
    .from("berichten")
    .select(kolommen)
    .eq("kanaal", "mail")
    .eq("op_server", true)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(PER_PAGINA);

  switch (bron.soort) {
    case "map":
      query = query.eq("map_id", bron.mapId);
      break;
    case "wacht":
      query = query.eq("map_id", bron.postvakId).or(wachtFilter());
      break;
    case "overige":
      query = query.eq("map_id", bron.postvakId).eq("is_klantmail", false);
      break;
    case "vlag":
      query = query.eq("gemarkeerd", true);
      if (bron.prullenbakId) query = query.neq("map_id", bron.prullenbakId);
      break;
    case "categorie":
      query = query
        .eq("map_id", bron.postvakId)
        .eq("bericht_categorieen.categorie_id", bron.categorieId);
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
/**
 * Wacht op jou: een klantmail met iets klaar dat nog niet afgehandeld is, of
 * een mail waarvan de herinnering is afgegaan.
 */
function wachtFilter(): string {
  const nu = new Date().toISOString();
  return `and(is_klantmail.eq.true,afgehandeld_op.is.null,or(concept.neq."",voorstel.neq.{})),herinner_op.lte.${nu}`;
}

/** Hoeveel mails een vlag hebben (voor het telletje bij "Met vlag"). */
export async function telVlag(prullenbakId: string | null): Promise<number> {
  let query = supabase
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("kanaal", "mail")
    .eq("op_server", true)
    .is("deleted_at", null)
    .eq("gemarkeerd", true);
  if (prullenbakId) query = query.neq("map_id", prullenbakId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Hoeveel mails er op je wachten (voor het telletje bij "Wacht op jou"). */
export async function telWachtend(postvakId: string): Promise<number> {
  const { count, error } = await supabase
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("map_id", postvakId)
    .eq("op_server", true)
    .is("deleted_at", null)
    .or(wachtFilter());
  if (error) throw error;
  return count ?? 0;
}

const BERICHT_KOLOMMEN = `${REGEL_KOLOMMEN},cc,antwoord_naar,tekst,html,afgekapt,message_id,klant_id,paaltje_status,samenvatting,zekerheid,ai_fout,klant_gok_id,klantgegevens,doorgevoerd_op,doorgevoerd_automatisch,beantwoord_op`;

/**
 * Eén mail, zolang hij nog op de server staat en niet weggelegd is. Het
 * dossier vraagt ook mail die uit de mailbox weg is (`ookUitMailbox`): die
 * bewaart Paaltje Systems voor de klant.
 */
export async function fetchBericht(id: string, ookUitMailbox = false): Promise<Bericht | null> {
  let query = supabase
    .from("berichten")
    .select(BERICHT_KOLOMMEN)
    .eq("id", id)
    .is("deleted_at", null);
  if (!ookUitMailbox) query = query.eq("op_server", true);
  const { data, error } = await query.maybeSingle();
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
      | "klantgegevens"
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
    klantgegevens: (r.klantgegevens as unknown as KlantGegevens | null) ?? {},
    doorgevoerd_op: r.doorgevoerd_op,
    doorgevoerd_automatisch: r.doorgevoerd_automatisch,
    beantwoord_op: r.beantwoord_op,
    afgehandeld_op: r.afgehandeld_op,
  };
}

/** Een mail uit hetzelfde gesprek (zelfde draad). */
export interface GesprekMail {
  id: string;
  richting: "in" | "uit";
  van_naam: string;
  van_email: string;
  onderwerp: string;
  fragment: string;
  ontvangen_op: string;
  op_server: boolean;
}

/** Alle mail uit hetzelfde gesprek als deze, oudste eerst (inclusief deze). */
export async function fetchGesprek(id: string): Promise<GesprekMail[]> {
  const { data, error } = await supabase.rpc("gesprek_van", { bericht: id });
  if (error) throw error;
  return (data ?? []) as GesprekMail[];
}

/** Een mail die later verstuurd wordt. */
export interface GeplandeMail {
  id: string;
  onderwerp: string;
  aan_tekst: string;
  versturen_op: string;
  status: "wacht" | "bezig" | "verstuurd" | "mislukt" | "geannuleerd";
  fout: string;
}

/** Wat nog weg moet, en wat de afgelopen week misging. */
export async function fetchGepland(): Promise<GeplandeMail[]> {
  const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("geplande_mails")
    .select("id,onderwerp,aan_tekst,versturen_op,status,fout")
    .or(`status.in.(wacht,bezig),and(status.eq.mislukt,versturen_op.gte.${week})`)
    .order("versturen_op", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as GeplandeMail[];
}

/** De afzenders die altijd naar spam gaan. */
export async function fetchSpamRegels(): Promise<string[]> {
  const { data, error } = await supabase
    .from("mail_regels")
    .select("van_email")
    .eq("actie", "spam")
    .order("van_email");
  if (error) throw error;
  return (data ?? []).map((r) => r.van_email);
}

/** De laatste mail per klant, voor de gesprekkenlijst op de telefoon. */
export interface MailGesprekRegel {
  id: string;
  klant_id: string;
  richting: "in" | "uit";
  van_naam: string;
  onderwerp: string;
  fragment: string;
  ontvangen_op: string;
  gelezen: boolean;
}

/**
 * De recente klantmail, nieuwste eerst. De lijst groepeert zelf per klant;
 * 500 mails is ruim genoeg om van de laatste weken iedereen te zien.
 */
export async function fetchMailGesprekken(): Promise<MailGesprekRegel[]> {
  const { data, error } = await supabase
    .from("berichten")
    .select("id,klant_id,richting,van_naam,onderwerp,fragment,ontvangen_op,gelezen")
    .eq("kanaal", "mail")
    .not("klant_id", "is", null)
    .is("deleted_at", null)
    .is("uit_dossier_op", null)
    .order("ontvangen_op", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    klant_id: r.klant_id!,
    richting: r.richting === "uit" ? "uit" : "in",
  })) as MailGesprekRegel[];
}

/** Een mail in het dossier van een klant: ook als hij uit de mailbox weg is. */
export interface DossierMail extends BerichtRegel {
  op_server: boolean;
}

/** Alle mail van en aan een klant, nieuwste eerst. In stukken van 1000. */
export async function fetchDossierMails(klantId: string): Promise<DossierMail[]> {
  const uit: DossierMail[] = [];
  for (let vanaf = 0; ; vanaf += 1000) {
    const { data, error } = await supabase
      .from("berichten")
      .select(`${REGEL_KOLOMMEN},op_server`)
      // WhatsApp krijgt een eigen weergave in het dossier.
      .eq("kanaal", "mail")
      .eq("klant_id", klantId)
      .is("deleted_at", null)
      .is("uit_dossier_op", null)
      .order("ontvangen_op", { ascending: false })
      .order("id", { ascending: false })
      .range(vanaf, vanaf + 999);
    if (error) throw error;
    const rijen = (data ?? []) as unknown as (RegelRij & { op_server: boolean })[];
    uit.push(...rijen.map((r) => ({ ...alsRegel(r), op_server: r.op_server })));
    if (rijen.length < 1000) return uit;
  }
}

/** Wat de klantkaart naast een mail laat zien. */
export interface KlantBijMail {
  id: string;
  naam: string;
  email: string;
  email2: string;
  telefoon: string;
  telefoon2: string;
  straat: string;
  huisnummer: string;
  postcode: string;
  plaats: string;
  adressen: {
    id: string;
    interval_maanden: number;
    ritme: number;
    /** "Dorpsstraat 12a". */
    adres: string;
    /** Leeg zonder het recht "prijzen zien". */
    prijs: number | null;
    notitie: string;
  }[];
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
export async function fetchKlantBijEmail(
  email: string,
  vandaag: string,
  /** De klant die al op de mail staat; ook als het mailadres (nog) nergens bij hoort. */
  klantId: string | null = null,
): Promise<KlantBijMail[]> {
  const schoon = email.trim().toLowerCase();
  const ids: string[] = klantId ? [klantId] : [];
  if (schoon) {
    const { data: koppelingen, error: koppelFout } = await supabase
      .from("klant_emails")
      .select("klant_id")
      .eq("email", schoon)
      .limit(5);
    if (koppelFout) throw koppelFout;
    ids.push(...(koppelingen ?? []).map((k) => k.klant_id));
  }
  return await klantenMetAdressen([...new Set(ids)], vandaag);
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
    .select("id,naam,email,email2,telefoon,telefoon2,straat,huisnummer,postcode,plaats")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;

  return await Promise.all(
    (klanten ?? []).map(async (k) => {
      const { data: adressen, error: adresFout } = await supabase
        .from("customers")
        .select(
          "id,interval_maanden,ritme,house_number,addition,note,streets(name,volledige_naam),adres_prijzen(prijs)",
        )
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
        adressen: (adressen ?? []).map((a) => {
          const straat = Array.isArray(a.streets) ? a.streets[0] : a.streets;
          // Prijzen staan in hun eigen tabel; zonder het recht komt die leeg terug.
          const prijsRij = Array.isArray(a.adres_prijzen) ? a.adres_prijzen[0] : a.adres_prijzen;
          return {
            id: a.id,
            interval_maanden: a.interval_maanden ?? 1,
            ritme: a.ritme ?? 1,
            adres:
              `${straat?.volledige_naam || straat?.name || ""} ${a.house_number}${a.addition ?? ""}`.trim(),
            prijs: prijsRij ? Number(prijsRij.prijs) : null,
            notitie: (a.note ?? "").trim(),
          };
        }),
        volgendeWasdag,
      };
    }),
  );
}

/** Eén keuze bij "Koppelen aan adres": een adres (met of zonder klant), of een klant zonder adres. */
export interface AdresKeuze {
  sleutel: string;
  customerId: string | null;
  adres: string;
  /** Los, om bij een nieuwe klant het postadres in te vullen. */
  straat: string;
  huisnummer: string;
  klantId: string | null;
  klantNaam: string;
  /** Gestopt of verhuisd: daar koppel je geen nieuwe mail aan. */
  inactief: boolean;
}

type AdresRij = {
  id: string;
  house_number: number;
  addition: string | null;
  klant_id: string | null;
  inactief_op: string | null;
  streets: { name: string; volledige_naam: string | null } | null;
  klanten: { naam: string; deleted_at: string | null } | null;
};

const ADRES_KOLOMMEN =
  "id,house_number,addition,klant_id,inactief_op,streets(name,volledige_naam),klanten(naam,deleted_at)";

function alsKeuze(c: AdresRij): AdresKeuze {
  const straat = c.streets ? c.streets.volledige_naam || c.streets.name : "";
  const klant = c.klanten && !c.klanten.deleted_at ? c.klanten : null;
  return {
    sleutel: `a:${c.id}`,
    customerId: c.id,
    adres: `${straat} ${c.house_number}${c.addition ?? ""}`.trim(),
    straat,
    huisnummer: `${c.house_number}${c.addition ?? ""}`,
    klantId: klant ? c.klant_id : null,
    klantNaam: klant?.naam ?? "",
    inactief: !!c.inactief_op,
  };
}

/**
 * Zoeken voor "Koppelen aan adres": "Kerkstraat 12" zoekt het adres, een naam
 * zoekt de klant. Hooguit een handvol treffers; typ meer voor minder.
 */
export async function zoekAdresOfKlant(zoek: string): Promise<AdresKeuze[]> {
  // Tekens die de filtertaal van PostgREST zelf gebruikt, eruit.
  const term = zoek
    .replace(/[%,()*"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (term.length < 2) return [];
  const uit: AdresKeuze[] = [];

  const m = term.match(/^(.*?)\s*(\d+)\s*([a-zA-Z]{0,3})$/);
  const straatDeel = (m ? (m[1] ?? "") : term).trim();
  const nummer = m ? Number(m[2]) : null;

  if (straatDeel.length >= 2) {
    const { data: straten, error } = await supabase
      .from("streets")
      .select("id")
      .or(`name.ilike.%${straatDeel}%,volledige_naam.ilike.%${straatDeel}%`)
      .is("deleted_at", null)
      .limit(40);
    if (error) throw error;
    const ids = (straten ?? []).map((s) => s.id);
    if (ids.length > 0) {
      let query = supabase
        .from("customers")
        .select(ADRES_KOLOMMEN)
        .in("street_id", ids)
        .is("deleted_at", null);
      if (nummer !== null) query = query.eq("house_number", nummer);
      const { data, error: adresFout } = await query.order("house_number").limit(20);
      if (adresFout) throw adresFout;
      uit.push(...((data ?? []) as unknown as AdresRij[]).map(alsKeuze));
    }
  }

  // Zonder huisnummer ook op naam: een klant zoek je vaak zo.
  if (nummer === null) {
    const { data: klanten, error } = await supabase
      .from("klanten")
      .select("id,naam")
      .ilike("naam", `%${term}%`)
      .is("deleted_at", null)
      .limit(10);
    if (error) throw error;
    const ids = (klanten ?? []).map((k) => k.id);
    if (ids.length > 0) {
      const { data, error: adresFout } = await supabase
        .from("customers")
        .select(ADRES_KOLOMMEN)
        .in("klant_id", ids)
        .is("deleted_at", null)
        .limit(20);
      if (adresFout) throw adresFout;
      const rijen = ((data ?? []) as unknown as AdresRij[]).map(alsKeuze);
      uit.push(...rijen);
      // Klanten zonder adres kun je ook kiezen.
      const metAdres = new Set(rijen.map((r) => r.klantId));
      for (const k of klanten ?? []) {
        if (!metAdres.has(k.id)) {
          uit.push({
            sleutel: `k:${k.id}`,
            customerId: null,
            adres: "",
            straat: "",
            huisnummer: "",
            klantId: k.id,
            klantNaam: k.naam,
            inactief: false,
          });
        }
      }
    }
  }

  const gezien = new Set<string>();
  return uit
    .filter((k) => (gezien.has(k.sleutel) ? false : (gezien.add(k.sleutel), true)))
    .slice(0, 25);
}

/** De klant die al aan een adres hangt, als die er is (niet weggelegd). */
export async function klantVanAdres(
  customerId: string,
): Promise<{ id: string; naam: string } | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("klant_id,klanten(id,naam,deleted_at)")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  const k = (
    data as unknown as {
      klanten: { id: string; naam: string; deleted_at: string | null } | null;
    } | null
  )?.klanten;
  return k && !k.deleted_at ? { id: k.id, naam: k.naam } : null;
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
 *    openen dat nog vat heeft op het Paaltje Systems-tabblad;
 *  - een eigen `<base>` in de mail, die onze instellingen zou overschrijven.
 *
 * DOMParser voert niets uit: hij bouwt alleen de boom, zodat we die kunnen
 * nalopen.
 */
export function veiligeMailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // noscript ook: hier wordt het als html gelezen, in een kader waar scripts
  // mogen als platte tekst. Met dat verschil kan een mail er iets langs smokkelen.
  doc
    .querySelectorAll("script, noscript, base, meta, link, form, iframe, object, embed")
    .forEach((el) => el.remove());
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
