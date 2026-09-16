/**
 * Een voorstel van de assistent doorvoeren, en weer terugdraaien.
 *
 * Eén weg voor allebei: of de assistent het automatisch doet of iemand op
 * doorvoeren klikt, het komt in hetzelfde rapport en draait op dezelfde
 * manier terug. Twee wegen zou betekenen dat de ene net iets anders doet dan
 * de andere, en dat merk je pas als het ertoe doet.
 *
 * De rekenregel voor overslaan is dezelfde als `schuifStartOp` in de app:
 * valt de overgeslagen maand samen met de eerste maand van een nieuw adres,
 * dan schuift de startmaand op in plaats van dat er een pauze bij komt.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Hoe zeker de assistent moet zijn om zelf door te voeren. Strenger dan de
 * streep voor een voorstel (0,7): een voorstel ziet nog een mens, dit niet.
 */
export const ZEKER_AUTOMATISCH = 0.9;

/** Hoeveel maanden hij in één keer zelf mag overslaan. */
const MAX_MAANDEN_AUTOMATISCH = 3;

/** "jjjj-mm" in Nederlandse tijd — de server draait in UTC. */
export function maandVan(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
  }).format(d);
}

function volgendeMaand(maand: string): string {
  const [jaar, nr] = maand.split("-").map(Number);
  const d = new Date(Date.UTC(jaar, nr, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function maandenVooruit(maand: string, n: number): string {
  let m = maand;
  for (let i = 0; i < n; i++) m = volgendeMaand(m);
  return m;
}

/**
 * Mag de assistent deze maanden zelf overslaan? Alleen een korte pauze in de
 * nabije toekomst: hooguit drie maanden, niet in het verleden en niet verder
 * dan een jaar vooruit. "Sla mij de rest van mijn leven over" is geen
 * overslaan maar afmelden, en daar hoort een mens naar te kijken — ook als
 * iemand het slim in een mail verpakt.
 */
export function veiligVoorAutomatisch(maanden: string[]): boolean {
  if (maanden.length === 0 || maanden.length > MAX_MAANDEN_AUTOMATISCH) return false;
  const nu = maandVan(new Date());
  const grens = maandenVooruit(nu, 12);
  return maanden.every((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= nu && m <= grens);
}

/** Overslaan erbij, met de startmaand die meeschuift. Ook voor de assistent in de app (`paaltje-chat.ts`). */
export function metOverslaan(
  c: { overslaan: string[]; start_maand: string; created_at: string },
  maanden: string[],
): { overslaan: string[]; start_maand: string } {
  const overslaan = [...new Set([...c.overslaan, ...maanden])].sort();
  let start = c.start_maand || maandVan(new Date(c.created_at));
  if (start < maandVan(new Date())) return { overslaan, start_maand: c.start_maand };

  const rest = [...overslaan];
  let verschoven = false;
  while (rest.includes(start)) {
    rest.splice(rest.indexOf(start), 1);
    start = volgendeMaand(start);
    verschoven = true;
  }
  return verschoven
    ? { overslaan: rest, start_maand: start }
    : { overslaan, start_maand: c.start_maand };
}

export interface Doorvoering {
  companyId: string;
  /** De mail uit de mailbox (berichten) waar dit uit voortkwam, of leeg. */
  berichtId?: string | null;
  customerIds: string[];
  maanden: string[];
  automatisch: boolean;
  zekerheid: number | null;
  /** De medewerker die klikte; leeg bij automatisch. */
  door: string | null;
}

/**
 * Zet de maanden op overslaan bij deze adressen, en schrijft elke aanpassing
 * in het rapport. Een adres dat die maanden al oversloeg wordt overgeslagen:
 * er verandert niets, dus er valt ook niets te melden.
 */
export async function voerOverslaanDoor(
  db: Db,
  o: Doorvoering,
): Promise<{ aangepast: number; mislukt: number }> {
  if (o.customerIds.length === 0 || o.maanden.length === 0) return { aangepast: 0, mislukt: 0 };

  const { data: rijen, error: leesFout } = await db
    .from("customers")
    .select(
      "id,overslaan,start_maand,created_at,house_number,addition,streets(name,volledige_naam),klanten(naam)",
    )
    .eq("company_id", o.companyId)
    .is("deleted_at", null)
    // Een inactief adres komt niet, dus valt er niets over te slaan.
    .is("inactief_op", null)
    .in("id", o.customerIds);
  // Niet kunnen lezen is niet "niets te doen": dan telt alles als mislukt.
  if (leesFout) return { aangepast: 0, mislukt: o.customerIds.length };

  let aangepast = 0;
  let mislukt = 0;
  for (const c of rijen ?? []) {
    const voorOverslaan: string[] = c.overslaan ?? [];
    const voorStart: string = c.start_maand ?? "";
    const na = metOverslaan(
      { overslaan: voorOverslaan, start_maand: voorStart, created_at: c.created_at },
      o.maanden,
    );
    const zelfde =
      na.start_maand === voorStart &&
      JSON.stringify(na.overslaan) === JSON.stringify([...voorOverslaan].sort());
    if (zelfde) continue;

    const { error } = await db
      .from("customers")
      .update({ overslaan: na.overslaan, start_maand: na.start_maand })
      .eq("company_id", o.companyId)
      .eq("id", c.id);
    if (error) {
      mislukt += 1;
      continue;
    }

    const straat = c.streets ? c.streets.volledige_naam || c.streets.name || "" : "";
    await db.from("mail_wijzigingen").insert({
      company_id: o.companyId,
      bericht_id: o.berichtId ?? null,
      customer_id: c.id,
      adres: `${straat} ${c.house_number}${c.addition ?? ""}`.trim(),
      klant: c.klanten?.naam ?? "",
      maanden: o.maanden,
      voor_overslaan: voorOverslaan,
      voor_start_maand: voorStart,
      na_overslaan: na.overslaan,
      na_start_maand: na.start_maand,
      automatisch: o.automatisch,
      zekerheid: o.zekerheid,
      door: o.door,
    });
    aangepast += 1;
  }

  // Het stempel op het bericht. De status blijft staan: er moet vaak nog een
  // antwoord terug, en dat vak hoort niet te verdwijnen omdat de planning al
  // klopt.
  if (o.berichtId && aangepast > 0) {
    await db
      .from("berichten")
      .update({
        doorgevoerd_op: new Date().toISOString(),
        doorgevoerd_automatisch: o.automatisch,
      })
      .eq("company_id", o.companyId)
      .eq("id", o.berichtId);
  }

  return { aangepast, mislukt };
}

export type StopReden = "verhuisd" | "gestopt";

export interface Stopzetting {
  companyId: string;
  berichtId: string;
  customerIds: string[];
  /** Verhuisd: klantgegevens naar de prullenbak. Gestopt: alles blijft. */
  reden: StopReden;
  /** Ook de wasdagen vanaf vandaag van de planning halen. */
  planningWeg: boolean;
  /** De medewerker die klikte. Stoppen gebeurt nooit automatisch. */
  door: string;
}

/** Eén weggehaalde regel van de planning, zoals `zet_adressen_inactief` hem teruggeeft. */
interface Planningsregel {
  datum: string;
  customer_id: string;
  prijs: number | null;
  notitie: string | null;
}

/**
 * Wat er in `details` van een stoprapportregel staat. Alles wat nodig is om
 * precies dít adres terug te draaien, en niet meer: de planning van één adres,
 * en alleen de klant die bij dít adres hoort.
 */
interface StopDetails {
  inactief_op?: string;
  reden?: StopReden;
  klanten?: string[];
  planning?: Planningsregel[];
  /** Van vóór inactief: toen ging het adres zelf naar de prullenbak. */
  deleted_at?: string;
}

/** "jjjj-mm-dd" in Nederlandse tijd. */
function vandaagInNederland(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Een stopzetting van één adres ongedaan maken. Voorzichtig: alleen wat nog
 * precies zo staat als deze stopzetting het achterliet. Is het adres intussen
 * met de hand weer actief gemaakt en opnieuw gestopt (ander tijdstip), of de
 * klant al uit de prullenbak gehaald, dan blijft dat staan.
 */
async function draaiStoppenTerug(
  db: Db,
  companyId: string,
  customerId: string,
  d: StopDetails,
): Promise<{ ok: true } | { ok: false; fout: string }> {
  if (!d.inactief_op) return { ok: false, fout: "Bij deze aanpassing staat niet wanneer het adres stopte." };

  // Eén stap in de database (stoppen_terugdraaien), dezelfde als de ongedaan-
  // knop in de app: alleen wat nog van déze stopzetting is, klantgegevens
  // alleen als ze nog sinds dit moment in de prullenbak liggen, planning alleen
  // vanaf vandaag en nooit over een intussen opnieuw ingeplande dag heen.
  const { error } = await db.rpc("stoppen_terugdraaien", {
    uitkomst: {
      adressen: [customerId],
      klanten: (d.klanten ?? []).filter((k) => typeof k === "string"),
      planning: (d.planning ?? []).filter((r) => r && r.customer_id === customerId),
      inactief_op: d.inactief_op,
    },
    voor_bedrijf: companyId,
  });
  if (error) return { ok: false, fout: "Terugdraaien lukte niet." };
  return { ok: true };
}

/**
 * Een klant laten stoppen: zijn adressen worden inactief (niet weggegooid), elk
 * met een regel in het rapport. Daar is het terug te draaien: het adres wordt
 * weer actief, en wat er met de klantgegevens en de planning gebeurde komt
 * terug.
 *
 * Het inactief maken zelf gebeurt in één keer in de database
 * (`zet_adressen_inactief`): adres, planning en klantgegevens gaan samen, of
 * niets gaat.
 */
export async function voerStoppenDoor(
  db: Db,
  o: Stopzetting,
): Promise<{ aangepast: number; mislukt: number; mislukteIds: string[] }> {
  if (o.customerIds.length === 0) return { aangepast: 0, mislukt: 0, mislukteIds: [] };
  const allesMislukt = { aangepast: 0, mislukt: o.customerIds.length, mislukteIds: o.customerIds };

  // Eerst de namen, voor het rapport: na de verhuizing ligt de klant in de
  // prullenbak, en dan is zijn naam lastiger te vinden.
  const { data: rijen, error: leesFout } = await db
    .from("customers")
    .select("id,klant_id,house_number,addition,streets(name,volledige_naam),klanten(naam)")
    .eq("company_id", o.companyId)
    .in("id", o.customerIds);
  if (leesFout) return allesMislukt;
  const perId = new Map<string, { klant_id: string | null; adres: string; klant: string }>();
  for (const c of rijen ?? []) {
    const straat = c.streets ? c.streets.volledige_naam || c.streets.name || "" : "";
    perId.set(c.id, {
      klant_id: c.klant_id ?? null,
      adres: `${straat} ${c.house_number}${c.addition ?? ""}`.trim(),
      klant: c.klanten?.naam ?? "",
    });
  }

  const { data: uitkomst, error: rpcFout } = await db.rpc("zet_adressen_inactief", {
    adressen: o.customerIds,
    reden: o.reden,
    planning_weg: o.planningWeg,
    voor_bedrijf: o.companyId,
  });
  if (rpcFout || !uitkomst) {
    console.error("stoppen:", rpcFout?.message);
    return allesMislukt;
  }
  const gezet: string[] = uitkomst.adressen ?? [];
  const klantenWeg: string[] = uitkomst.klanten ?? [];
  const planning: Planningsregel[] = uitkomst.planning ?? [];
  const inactiefOp: string = uitkomst.inactief_op;

  // Adressen die gevraagd waren maar niet in `gezet` staan waren al inactief of
  // weg: niets gebeurd, niets te melden, en ook niet mislukt.
  let aangepast = 0;
  const mislukteIds: string[] = [];
  for (const id of gezet) {
    const info = perId.get(id);
    const details: StopDetails = {
      inactief_op: inactiefOp,
      reden: o.reden,
      // De klant komt bij elk adres van hem dat nu stopte. Draai je er één
      // terug, dan heeft dat adres zijn klant weer nodig; de rest van die
      // regels vindt de klant daarna gewoon niet meer in de prullenbak.
      klanten: info?.klant_id && klantenWeg.includes(info.klant_id) ? [info.klant_id] : [],
      planning: planning.filter((r) => r.customer_id === id),
    };
    const { error: rapportFout } = await db.from("mail_wijzigingen").insert({
      company_id: o.companyId,
      bericht_id: o.berichtId,
      customer_id: id,
      adres: info?.adres ?? "",
      klant: info?.klant ?? "",
      soort: "stoppen",
      automatisch: false,
      door: o.door,
      details,
    });
    if (rapportFout) {
      // Zonder regel in het rapport is het niet terug te draaien: dan het
      // adres meteen terugzetten (met klant en planning) en als mislukt tellen.
      console.error("rapport stoppen:", rapportFout.message);
      const terug = await draaiStoppenTerug(db, o.companyId, id, details);
      if (!terug.ok) console.error("stoppen terugzetten:", terug.fout);
      mislukteIds.push(id);
      continue;
    }
    aangepast += 1;
  }
  // Bewust geen doorgevoerd_op op de mail: dat stempel hoort bij overslaan, en
  // zou die knop anders blokkeren. Stoppen houdt het bij in voorstel.stoppen.
  return { aangepast, mislukt: mislukteIds.length, mislukteIds };
}

/**
 * Een overslaan terugnemen: precies weghalen wat erbij kwam, en terugzetten
 * wat het opschuiven van de startmaand uit de lijst haalde. Wat iemand
 * intussen zelf nog oversloeg blijft staan; de startmaand gaat alleen terug
 * als hij nog staat zoals het doorvoeren hem achterliet.
 */
export function overslaanTerug(
  nu: { overslaan: string[]; start_maand: string },
  voor: { overslaan: string[]; start_maand: string },
  na: { overslaan: string[]; start_maand: string },
): { overslaan: string[]; start_maand: string } {
  const erbij = na.overslaan.filter((m) => !voor.overslaan.includes(m));
  // Wat de startmaand opschoof haalde maanden uit de lijst; die komen terug.
  const eraf = voor.overslaan.filter((m) => !na.overslaan.includes(m));
  const overslaan = [...new Set([...nu.overslaan.filter((m) => !erbij.includes(m)), ...eraf])].sort();
  const start_maand = nu.start_maand === na.start_maand ? voor.start_maand : nu.start_maand;
  return { overslaan, start_maand };
}

/**
 * Draait één aanpassing uit het rapport terug.
 *
 * Niet door de oude lijst terug te zetten, maar door precies weg te halen wat
 * deze aanpassing erbij deed. Heeft iemand intussen met de hand nog een maand
 * overgeslagen, dan blijft die staan.
 */
export async function draaiTerug(
  db: Db,
  companyId: string,
  wijzigingId: string,
  door: string,
): Promise<{ ok: true } | { ok: false; fout: string }> {
  const { data: w } = await db
    .from("mail_wijzigingen")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", wijzigingId)
    .maybeSingle();
  if (!w) return { ok: false, fout: "Die aanpassing bestaat niet." };
  if (w.teruggedraaid_op) return { ok: false, fout: "Die is al teruggedraaid." };
  // Leest Paaltje de mail net, dan zou hij na afloop zijn oude voorstel
  // terugschrijven en jouw terugdraaien stil ongedaan maken.
  if (w.bericht_id) {
    const { data: bericht } = await db
      .from("berichten")
      .select("paaltje_status")
      .eq("company_id", companyId)
      .eq("id", w.bericht_id)
      .maybeSingle();
    if (bericht?.paaltje_status === "bezig") {
      return { ok: false, fout: "Paaltje leest deze mail net. Probeer het zo nog eens." };
    }
  }
  if (w.soort !== "overslaan" && w.soort !== "stoppen") {
    return { ok: false, fout: "Dit soort aanpassing kun je niet vanuit het rapport terugdraaien." };
  }
  if (!w.customer_id) return { ok: false, fout: "Het adres bestaat niet meer." };

  const stopDetails = (w.details ?? {}) as StopDetails;
  if (w.soort === "stoppen" && stopDetails.inactief_op) {
    // Een stopzetting als inactief: adres weer actief, klant en planning terug.
    const terug = await draaiStoppenTerug(db, companyId, w.customer_id, stopDetails);
    if (!terug.ok) return terug;
  } else if (w.soort === "stoppen") {
    // Een oude regel, van toen stoppen het adres naar de prullenbak legde.
    // Terug uit de prullenbak, maar alleen als het adres nog weggelegd is op
    // het moment van deze aanpassing: is het intussen met de hand teruggezet
    // of opnieuw weggelegd, dan blijft dat staan.
    const weggelegdOp = stopDetails.deleted_at ?? null;
    const { data: adres } = await db
      .from("customers")
      .select("id,deleted_at")
      .eq("company_id", companyId)
      .eq("id", w.customer_id)
      .maybeSingle();
    if (!adres) return { ok: false, fout: "Het adres bestaat niet meer." };
    if (adres.deleted_at && weggelegdOp && new Date(adres.deleted_at).getTime() === new Date(weggelegdOp).getTime()) {
      const { error: terugFout } = await db
        .from("customers")
        .update({ deleted_at: null })
        .eq("company_id", companyId)
        .eq("id", adres.id);
      if (terugFout) return { ok: false, fout: "Het adres terugzetten lukte niet." };
    }
  } else {
  const { data: c } = await db
    .from("customers")
    .select("id,overslaan,start_maand")
    .eq("company_id", companyId)
    .eq("id", w.customer_id)
    .maybeSingle();
  if (!c) return { ok: false, fout: "Het adres bestaat niet meer." };

  const { overslaan, start_maand } = overslaanTerug(
    { overslaan: c.overslaan ?? [], start_maand: c.start_maand },
    { overslaan: w.voor_overslaan ?? [], start_maand: w.voor_start_maand },
    { overslaan: w.na_overslaan ?? [], start_maand: w.na_start_maand },
  );

  const { error } = await db
    .from("customers")
    .update({ overslaan, start_maand })
    .eq("company_id", companyId)
    .eq("id", c.id);
  if (error) return { ok: false, fout: "Het adres aanpassen lukte niet." };
  }

  await db
    .from("mail_wijzigingen")
    .update({ teruggedraaid_op: new Date().toISOString(), teruggedraaid_door: door })
    .eq("id", w.id);

  // Is er van dit bericht niets meer doorgevoerd, dan gaat ook het stempel eraf
  // — en staat het voorstel weer klaar om opnieuw te kiezen.
  if (w.bericht_id) {
    const { count } = await db
      .from("mail_wijzigingen")
      .select("id", { count: "exact", head: true })
      .eq("bericht_id", w.bericht_id)
      .is("teruggedraaid_op", null);
    if ((count ?? 0) === 0) {
      // Het voorstel staat daarna weer klaar, met de knop Doorvoeren.
      const { data: bericht, error: leesFout } = await db
        .from("berichten")
        .select("voorstel")
        .eq("company_id", companyId)
        .eq("id", w.bericht_id)
        .maybeSingle();
      const bijwerken: Record<string, unknown> = { doorgevoerd_op: null, doorgevoerd_automatisch: false };
      // Alleen het voorstel aanraken als het lezen lukte: anders zou een lege
      // waarde alles wegschrijven, ook de aanmelding en de prijzen.
      if (!leesFout && bericht) {
        const voorstel = (bericht.voorstel ?? {}) as {
          overslaan?: Record<string, unknown>;
          stoppen?: Record<string, unknown>;
        };
        if (w.soort === "stoppen" && voorstel.stoppen) {
          // "doorgevoerd" helemaal weg (niet false): dan werkt de knop weer.
          const { doorgevoerd: _weg, ...open } = voorstel.stoppen;
          voorstel.stoppen = open;
          bijwerken.voorstel = voorstel;
        } else if (w.soort === "overslaan" && voorstel.overslaan) {
          // "teruggedraaid": de knop komt terug, maar Paaltje voert dit nooit
          // meer zelf door — jij besloot er net anders over.
          voorstel.overslaan = { ...voorstel.overslaan, doorgevoerd: false, teruggedraaid: true };
          bijwerken.voorstel = voorstel;
        }
      }
      await db
        .from("berichten")
        .update(bijwerken)
        .eq("company_id", companyId)
        .eq("id", w.bericht_id);
    }
  }

  return { ok: true };
}
