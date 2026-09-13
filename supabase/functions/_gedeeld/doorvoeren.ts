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
function maandVan(d: Date): string {
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

/** Overslaan erbij, met de startmaand die meeschuift. */
function metOverslaan(
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
  /** Het bericht waar dit uit voortkwam; leeg als het nergens uit voortkwam. */
  antwoordId: string | null;
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
export async function voerOverslaanDoor(db: Db, o: Doorvoering): Promise<{ aangepast: number }> {
  if (o.customerIds.length === 0 || o.maanden.length === 0) return { aangepast: 0 };

  const { data: rijen } = await db
    .from("customers")
    .select(
      "id,overslaan,start_maand,created_at,house_number,addition,streets(name,volledige_naam),klanten(naam)",
    )
    .eq("company_id", o.companyId)
    .is("deleted_at", null)
    .in("id", o.customerIds);

  let aangepast = 0;
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
    if (error) continue;

    const straat = c.streets ? c.streets.volledige_naam || c.streets.name || "" : "";
    await db.from("mail_wijzigingen").insert({
      company_id: o.companyId,
      antwoord_id: o.antwoordId,
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
  if (o.antwoordId) {
    await db
      .from("mail_antwoorden")
      .update({
        doorgevoerd_op: new Date().toISOString(),
        doorgevoerd_automatisch: o.automatisch,
      })
      .eq("company_id", o.companyId)
      .eq("id", o.antwoordId);
  }

  return { aangepast };
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
  if (!w.customer_id) return { ok: false, fout: "Het adres bestaat niet meer." };

  const { data: c } = await db
    .from("customers")
    .select("id,overslaan,start_maand")
    .eq("company_id", companyId)
    .eq("id", w.customer_id)
    .maybeSingle();
  if (!c) return { ok: false, fout: "Het adres bestaat niet meer." };

  const voor: string[] = w.voor_overslaan ?? [];
  const na: string[] = w.na_overslaan ?? [];
  const erbij = na.filter((m) => !voor.includes(m));
  // Wat de startmaand opschoof haalde maanden uit de lijst; die komen terug.
  const eraf = voor.filter((m) => !na.includes(m));
  const overslaan = [
    ...new Set([...(c.overslaan ?? []).filter((m: string) => !erbij.includes(m)), ...eraf]),
  ].sort();
  const start_maand = c.start_maand === w.na_start_maand ? w.voor_start_maand : c.start_maand;

  const { error } = await db
    .from("customers")
    .update({ overslaan, start_maand })
    .eq("company_id", companyId)
    .eq("id", c.id);
  if (error) return { ok: false, fout: "Het adres aanpassen lukte niet." };

  await db
    .from("mail_wijzigingen")
    .update({ teruggedraaid_op: new Date().toISOString(), teruggedraaid_door: door })
    .eq("id", w.id);

  // Is er van dit bericht niets meer doorgevoerd, dan gaat ook het stempel eraf
  // — en staat het voorstel weer klaar om opnieuw te kiezen.
  if (w.antwoord_id) {
    const { count } = await db
      .from("mail_wijzigingen")
      .select("id", { count: "exact", head: true })
      .eq("antwoord_id", w.antwoord_id)
      .is("teruggedraaid_op", null);
    if ((count ?? 0) === 0) {
      await db
        .from("mail_antwoorden")
        .update({ doorgevoerd_op: null, doorgevoerd_automatisch: false })
        .eq("company_id", companyId)
        .eq("id", w.antwoord_id);
    }
  }

  return { ok: true };
}
