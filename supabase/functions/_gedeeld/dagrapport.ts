/**
 * Het dagrapport samenstellen: wat Paaltje Systems sinds de vorige keer deed.
 *
 * Alleen tellen en opsommen, geen taalmodel: een rapport over wat de assistent
 * deed hoort niet door diezelfde assistent geschreven te worden.
 *
 * De getallen gaan over het postvak, net als de mappen in de app: wat in spam
 * of een andere map binnenkwam, telt hier niet mee. WhatsApp staat er apart
 * bij.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export interface RapportInhoud {
  vanaf: string;
  tot: string;
  binnen: {
    totaal: number;
    klantmail: number;
    overige: number;
    /** Nog niet door Paaltje gelezen (hij is er nog mee bezig). */
    nogNietGelezen: number;
    perCategorie: { naam: string; aantal: number }[];
  };
  zelfGedaan: { soort: string; klant: string; adres: string; maanden: string[]; tijd: string }[];
  verstuurd: number;
  wacht: { aantal: number; voorbeelden: { van: string; onderwerp: string; samenvatting: string }[] };
  /** Klachten: wat er in deze periode bijkwam, en hoeveel er nu nog openstaan. */
  klachten: { nieuw: { klant: string; omschrijving: string; door_paaltje: boolean }[]; open: number };
  /** Nieuw in deze periode: dit bepaalt mee of er een rapport komt. */
  problemen: string[];
  /** Al langer zo (bijv. oude fouten): wel in het rapport, maar geen reden voor een rapport. */
  opmerkingen: string[];
  /** Alleen als WhatsApp gekoppeld is. */
  whatsapp?: {
    binnen: number;
    vanKlanten: number;
    paaltjeAntwoorden: number;
    aankondigingen: number;
    wacht: { aantal: number; voorbeelden: { van: string; samenvatting: string }[] };
  };
}

/** Gebeurde er in deze periode iets? Een mail die al dagen wacht is geen nieuws. */
export function heeftIets(r: RapportInhoud): boolean {
  return (
    r.binnen.totaal > 0 ||
    r.zelfGedaan.length > 0 ||
    r.verstuurd > 0 ||
    r.problemen.length > 0 ||
    r.klachten.nieuw.length > 0 ||
    (r.whatsapp?.binnen ?? 0) > 0 ||
    (r.whatsapp?.paaltjeAntwoorden ?? 0) > 0 ||
    (r.whatsapp?.aankondigingen ?? 0) > 0
  );
}

const MAX_MAILS = 2000;
const MAX_WIJZIGINGEN = 200;
/** Een mail die net voor het begin van de periode binnenkwam maar pas daarna werd opgehaald, telt nog mee. */
const MARGE_MS = 24 * 60 * 60 * 1000;

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function toonMaand(sleutel: string): string {
  const [jaar, nr] = sleutel.split("-");
  const naam = MAANDEN[Number(nr) - 1];
  return naam ? `${naam} ${jaar}` : sleutel;
}

/**
 * Tekst van buiten (afzendernaam, onderwerp) op één regel en kort. Anders kan
 * een afzender met regeleinden nep-regels in een rapport zetten dat van je
 * eigen mailbox komt.
 */
function eenRegel(tekst: string, max: number): string {
  const schoon = String(tekst ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return schoon.length > max ? `${schoon.slice(0, max - 1)}…` : schoon;
}

function check<T>(uit: { data: T; error: { message: string } | null }, wat: string): T {
  if (uit.error) throw new Error(`${wat}: ${uit.error.message}`);
  return uit.data;
}

export async function stelSamen(db: Db, companyId: string, vanaf: Date, tot: Date): Promise<RapportInhoud> {
  const van = vanaf.toISOString();
  const t = tot.toISOString();
  const problemen: string[] = [];
  const opmerkingen: string[] = [];

  // Het postvak (of postvakken) van dit bedrijf.
  const mappen = check(
    await db.from("mail_mappen").select("id").eq("company_id", companyId).eq("rol", "postvak"),
    "Postvak",
  ) as { id: string }[] | null;
  const postvakken = (mappen ?? []).map((m) => m.id);

  // 1. Binnengekomen: in deze periode in Paaltje Systems gekomen. De ontvangstdatum
  //    alleen met marge, zodat de eerste koppeling (een jaar oude mail) niet als
  //    "nieuw" telt, maar een mail van 06:29 die om 06:31 werd opgehaald wel.
  let rijen: { id: string; is_klantmail: boolean | null; paaltje_status: string }[] = [];
  if (postvakken.length > 0) {
    rijen = (check(
      await db
        .from("berichten")
        .select("id,is_klantmail,paaltje_status")
        .eq("company_id", companyId)
        .in("map_id", postvakken)
        .eq("richting", "in")
        .is("deleted_at", null)
        .gte("created_at", van)
        .lt("created_at", t)
        .gte("ontvangen_op", new Date(vanaf.getTime() - MARGE_MS).toISOString())
        .limit(MAX_MAILS),
      "Binnengekomen mail",
    ) ?? []) as typeof rijen;
  }
  if (rijen.length >= MAX_MAILS) {
    opmerkingen.push(`Er kwam meer dan ${MAX_MAILS} mail binnen; het rapport telt alleen de eerste ${MAX_MAILS}.`);
  }

  const perCategorie = new Map<string, number>();
  const ids = rijen.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const data = check(
      await db.from("bericht_categorieen").select("mail_categorieen(naam)").in("bericht_id", ids.slice(i, i + 100)),
      "Categorieën",
    ) as { mail_categorieen: { naam: string } | null }[] | null;
    for (const r of data ?? []) {
      const naam = r.mail_categorieen?.naam;
      if (naam) perCategorie.set(naam, (perCategorie.get(naam) ?? 0) + 1);
    }
  }

  // 2. Wat Paaltje zelf deed (en niet teruggedraaid is).
  const wijzigingen = (check(
    await db
      .from("mail_wijzigingen")
      .select("soort,klant,adres,maanden,created_at")
      .eq("company_id", companyId)
      .eq("automatisch", true)
      .is("teruggedraaid_op", null)
      .gte("created_at", van)
      .lt("created_at", t)
      .order("created_at", { ascending: true })
      .limit(MAX_WIJZIGINGEN),
    "Wijzigingen",
  ) ?? []) as { soort: string; klant: string; adres: string; maanden: string[]; created_at: string }[];
  if (wijzigingen.length >= MAX_WIJZIGINGEN) {
    opmerkingen.push(`Paaltje deed meer dan ${MAX_WIJZIGINGEN} dingen zelf; het rapport noemt alleen de eerste ${MAX_WIJZIGINGEN}.`);
  }

  // 3. Wat er beantwoord is.
  const verstuurd = await db
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("beantwoord_op", van)
    .lt("beantwoord_op", t);
  if (verstuurd.error) throw new Error(`Verstuurd: ${verstuurd.error.message}`);

  // 4. Wat nu op je wacht: net als "Wacht op jou" in de app, alleen het postvak.
  const wachtFilter = 'concept.neq."",voorstel.neq.{}';
  let wachtAantal = 0;
  let wachtRijen: { van_naam: string; van_email: string; onderwerp: string; samenvatting: string }[] = [];
  if (postvakken.length > 0) {
    const telling = await db
      .from("berichten")
      .select("id", { count: "exact", head: true })
      .in("map_id", postvakken)
      .eq("op_server", true)
      .is("deleted_at", null)
      .eq("is_klantmail", true)
      .is("afgehandeld_op", null)
      .or(wachtFilter);
    if (telling.error) throw new Error(`Wacht op jou: ${telling.error.message}`);
    wachtAantal = telling.count ?? 0;
    wachtRijen = (check(
      await db
        .from("berichten")
        .select("van_naam,van_email,onderwerp,samenvatting")
        .in("map_id", postvakken)
        .eq("op_server", true)
        .is("deleted_at", null)
        .eq("is_klantmail", true)
        .is("afgehandeld_op", null)
        .or(wachtFilter)
        .order("ontvangen_op", { ascending: false })
        .limit(5),
      "Wacht op jou",
    ) ?? []) as typeof wachtRijen;
  }

  // 5. Klachten: nieuw in de periode (ook zelf ingevoerd), en wat nog openstaat.
  const nieuweKlachten = (check(
    await db
      .from("klachten")
      .select("omschrijving,door_paaltje,klanten(naam)")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .gte("created_at", van)
      .lt("created_at", t)
      .order("created_at", { ascending: true })
      .limit(50),
    "Nieuwe klachten",
  ) ?? []) as { omschrijving: string; door_paaltje: boolean; klanten: { naam: string } | null }[];
  const openKlachten = await db
    .from("klachten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "open")
    .is("deleted_at", null);
  if (openKlachten.error) throw new Error(`Open klachten: ${openKlachten.error.message}`);

  // 6. Problemen: nieuw in de periode telt, wat al langer zo is staat erbij.
  const box = check(
    await db.from("mailboxen").select("status,fout,laatste_sync").eq("company_id", companyId).maybeSingle(),
    "Mailbox",
  ) as { status: string; fout: string; laatste_sync: string | null } | null;
  if (box?.status === "fout") problemen.push("Paaltje Systems kan niet meer inloggen bij je mailbox. Vul het wachtwoord opnieuw in.");
  else if (box?.fout) problemen.push(`De mailbox gaf een storing: ${eenRegel(box.fout, 160)}`);

  const nieuweFouten = await db
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("paaltje_status", "fout")
    .is("deleted_at", null)
    .gte("gelezen_door_paaltje_op", van);
  if (nieuweFouten.error) throw new Error(`Paaltje-fouten: ${nieuweFouten.error.message}`);
  const alleFouten = await db
    .from("berichten")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("paaltje_status", "fout")
    .is("deleted_at", null);
  if (alleFouten.error) throw new Error(`Paaltje-fouten: ${alleFouten.error.message}`);
  const nieuw = nieuweFouten.count ?? 0;
  const oud = (alleFouten.count ?? 0) - nieuw;
  if (nieuw > 0) problemen.push(`Paaltje kon ${nieuw} ${nieuw === 1 ? "bericht" : "berichten"} niet lezen.`);
  if (oud > 0) opmerkingen.push(`Er ${oud === 1 ? "staat" : "staan"} nog ${oud} ${oud === 1 ? "ouder bericht" : "oudere berichten"} die Paaltje niet kon lezen.`);

  // 7. WhatsApp, als het gekoppeld is.
  const whatsapp = await whatsappDeel(db, companyId, van, t, problemen);

  return {
    vanaf: van,
    tot: t,
    binnen: {
      totaal: rijen.length,
      klantmail: rijen.filter((r) => r.is_klantmail === true).length,
      overige: rijen.filter((r) => r.is_klantmail === false).length,
      nogNietGelezen: rijen.filter((r) => r.is_klantmail === null).length,
      perCategorie: [...perCategorie.entries()]
        .map(([naam, aantal]) => ({ naam, aantal }))
        .sort((a, b) => b.aantal - a.aantal),
    },
    zelfGedaan: wijzigingen.map((w) => ({
      soort: w.soort,
      klant: eenRegel(w.klant, 80),
      adres: eenRegel(w.adres, 80),
      maanden: w.maanden ?? [],
      tijd: w.created_at,
    })),
    verstuurd: verstuurd.count ?? 0,
    wacht: {
      aantal: wachtAantal,
      voorbeelden: wachtRijen.map((r) => ({
        van: eenRegel(r.van_naam || r.van_email, 80),
        onderwerp: eenRegel(r.onderwerp, 80),
        samenvatting: eenRegel(r.samenvatting, 160),
      })),
    },
    klachten: {
      nieuw: nieuweKlachten.map((k) => ({
        klant: eenRegel(k.klanten?.naam || "Klant zonder naam", 80),
        omschrijving: eenRegel(k.omschrijving, 160),
        door_paaltje: k.door_paaltje,
      })),
      open: openKlachten.count ?? 0,
    },
    problemen,
    opmerkingen,
    ...(whatsapp ? { whatsapp } : {}),
  };
}

async function whatsappDeel(
  db: Db,
  companyId: string,
  van: string,
  t: string,
  problemen: string[],
): Promise<RapportInhoud["whatsapp"] | null> {
  const koppeling = check(
    await db.from("whatsapp_koppelingen").select("status,fout").eq("company_id", companyId).maybeSingle(),
    "WhatsApp-koppeling",
  ) as { status: string; fout: string } | null;
  if (!koppeling || koppeling.status === "uit") return null;
  if (koppeling.status === "fout" || koppeling.fout) {
    problemen.push(`WhatsApp gaf een storing: ${eenRegel(koppeling.fout || "de koppeling werkt niet", 160)}`);
  }

  // deno-lint-ignore no-explicit-any
  const tel = async (wat: string, bouw: (q: any) => any) => {
    const uit = await bouw(
      db.from("berichten").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("kanaal", "whatsapp"),
    );
    if (uit.error) throw new Error(`${wat}: ${uit.error.message}`);
    return uit.count ?? 0;
  };

  const binnen = await tel("WhatsApp binnen", (q) =>
    q.eq("richting", "in").eq("bron", "klant").gte("created_at", van).lt("created_at", t),
  );
  const vanKlanten = await tel("WhatsApp van klanten", (q) =>
    q.eq("richting", "in").eq("bron", "klant").eq("is_klantmail", true).gte("created_at", van).lt("created_at", t),
  );
  const paaltjeAntwoorden = await tel("Antwoorden van Paaltje", (q) =>
    q.eq("richting", "uit").eq("bron", "paaltje").gte("created_at", van).lt("created_at", t),
  );
  // Alleen echte aankondigingen (geen proef, geen los appje vanuit de chat).
  const aankondigingUit = await db
    .from("mail_ontvangers")
    .select("id,mailingen!inner(test)", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("kanaal", "whatsapp")
    .eq("status", "verzonden")
    .eq("mailingen.test", false)
    .gte("created_at", van)
    .lt("created_at", t);
  if (aankondigingUit.error) throw new Error(`Aankondigingen via WhatsApp: ${aankondigingUit.error.message}`);
  const aankondigingen = aankondigingUit.count ?? 0;
  // De planner zet wa_antwoord_op op het moment dat hij het antwoord oppakt.
  const mislukt = await tel("Mislukte antwoorden", (q) =>
    q.eq("wa_antwoord_status", "mislukt").gte("wa_antwoord_op", van).lt("wa_antwoord_op", t),
  );
  if (mislukt > 0) {
    problemen.push(`${mislukt} ${mislukt === 1 ? "antwoord" : "antwoorden"} van Paaltje via WhatsApp ${mislukt === 1 ? "ging" : "gingen"} niet weg.`);
  }

  // Wat op jou wacht: een klantbericht met iets klaar, niet beantwoord en
  // niet ingepland door Paaltje.
  // deno-lint-ignore no-explicit-any
  const wachtBasis = (q: any) =>
    q
      .eq("richting", "in")
      .eq("bron", "klant")
      .eq("is_klantmail", true)
      .is("deleted_at", null)
      .is("beantwoord_op", null)
      .is("afgehandeld_op", null)
      .neq("wa_antwoord_status", "gepland")
      .neq("samenvatting", "Samen gelezen met het bericht erna.")
      .or('concept.neq."",voorstel.neq.{}');
  const wachtAantal = await tel("WhatsApp wacht op jou", wachtBasis);
  const wachtRijen = (check(
    await wachtBasis(
      db.from("berichten").select("van_naam,wa_telefoon,samenvatting").eq("company_id", companyId).eq("kanaal", "whatsapp"),
    )
      .order("ontvangen_op", { ascending: false })
      .limit(5),
    "WhatsApp wacht op jou",
  ) ?? []) as { van_naam: string; wa_telefoon: string; samenvatting: string }[];

  return {
    binnen,
    vanKlanten,
    paaltjeAntwoorden,
    aankondigingen,
    wacht: {
      aantal: wachtAantal,
      voorbeelden: wachtRijen.map((r) => ({
        van: eenRegel(r.van_naam || `+${r.wa_telefoon}`, 80),
        samenvatting: eenRegel(r.samenvatting, 160),
      })),
    },
  };
}

/** Wat een wijziging van Paaltje was, in woorden. */
export function wijzigingZin(w: RapportInhoud["zelfGedaan"][number]): string {
  const wie = [w.klant, w.adres].filter(Boolean).join(", ");
  switch (w.soort) {
    case "overslaan":
      return `${wie}: ${w.maanden.map(toonMaand).join(", ")} op overslaan gezet`;
    case "aanmelding":
      return `Aanmelding klaargezet: ${wie}`;
    case "stoppen":
      return `${wie}: gestopt als klant`;
    case "klant_email":
      return `${wie}: mailadres aan de klant gekoppeld`;
    case "whatsapp_afgemeld":
      return `${wie}: wil geen WhatsApp meer, uitgezet`;
    default:
      return wie;
  }
}

/** Het rapport als platte tekst, voor in de mail. */
export function alsTekst(r: RapportInhoud, appUrl: string): string {
  const regels: string[] = ["Goedemorgen,", "", "Dit is wat Paaltje Systems sinds het vorige rapport deed.", ""];

  if (r.problemen.length > 0) {
    regels.push("LET OP", ...r.problemen.map((p) => `- ${p}`), "");
  }

  regels.push(
    `Binnengekomen in je postvak: ${r.binnen.totaal} ${r.binnen.totaal === 1 ? "mail" : "mails"}` +
      (r.binnen.totaal
        ? ` (${r.binnen.klantmail} van klanten, ${r.binnen.overige} overige post` +
          (r.binnen.nogNietGelezen ? `, ${r.binnen.nogNietGelezen} nog niet gelezen door Paaltje` : "") +
          ")"
        : ""),
  );
  if (r.binnen.perCategorie.length > 0) {
    regels.push(`  ${r.binnen.perCategorie.map((c) => `${eenRegel(c.naam, 60)} ${c.aantal}`).join(" · ")}`);
  }
  regels.push("");

  if (r.zelfGedaan.length > 0) {
    regels.push("Paaltje deed zelf:", ...r.zelfGedaan.map((w) => `- ${wijzigingZin(w)}`));
    regels.push("  (Terugdraaien kan in Paaltje Systems onder Mailing → Rapport.)", "");
  }

  // Een ouder rapport dat nog gemaild moet worden, heeft nog geen klachten.
  const klachten = r.klachten ?? { nieuw: [], open: 0 };
  if (klachten.nieuw.length > 0 || klachten.open > 0) {
    regels.push(
      `Klachten: ${klachten.nieuw.length} nieuw, ${klachten.open} nog open`,
      ...klachten.nieuw.map((k) => `- ${k.klant}: ${k.omschrijving}${k.door_paaltje ? " (door Paaltje)" : ""}`),
      "",
    );
  }

  if (r.verstuurd > 0) {
    regels.push(`Beantwoord: ${r.verstuurd} ${r.verstuurd === 1 ? "bericht" : "berichten"}`, "");
  }

  if (r.whatsapp) {
    const w = r.whatsapp;
    regels.push(
      `WhatsApp: ${w.binnen} ${w.binnen === 1 ? "bericht" : "berichten"} binnen (${w.vanKlanten} van klanten)` +
        `, ${w.paaltjeAntwoorden} keer zelf beantwoord door Paaltje` +
        (w.aankondigingen ? `, ${w.aankondigingen} aankondigingen verstuurd` : ""),
    );
    if (w.wacht.aantal > 0) {
      regels.push(`WhatsApp wacht op jou: ${w.wacht.aantal}`);
      for (const v of w.wacht.voorbeelden) regels.push(`- ${v.van}${v.samenvatting ? `: ${v.samenvatting}` : ""}`);
    }
    regels.push("");
  }

  regels.push(`Mail die op jou wacht: ${r.wacht.aantal}`);
  for (const v of r.wacht.voorbeelden) {
    regels.push(`- ${v.van} — ${v.onderwerp || "(geen onderwerp)"}${v.samenvatting ? `: ${v.samenvatting}` : ""}`);
  }
  if (r.wacht.aantal > r.wacht.voorbeelden.length) {
    regels.push(`  en nog ${r.wacht.aantal - r.wacht.voorbeelden.length}`);
  }
  if (r.opmerkingen.length > 0) {
    regels.push("", ...r.opmerkingen.map((o) => `(${o})`));
  }
  regels.push("", `Bekijk alles in Paaltje Systems: ${appUrl}/mailing`, "", "Groet,", "Paaltje");
  return regels.join("\n");
}
