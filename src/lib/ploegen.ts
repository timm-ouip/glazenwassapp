import { supabase } from "@/integrations/supabase/client";
import { eenVan } from "@/lib/embed";
import type { Ploeg, PloegLid } from "@/lib/dagplanning";

/**
 * Teamleden en ploegen.
 *
 * Een teamlid is iemand die meewast. Meestal is dat een medewerker met een
 * account (dan hangt er een employee_id aan), maar het mag ook iemand zonder
 * account zijn — een hulpkracht die je later nog kunt uitnodigen.
 *
 * Een ploeg bestaat per dag: wie er samen op pad gaan, verschilt. Ploeg 1, 2,
 * … zijn gewoon nummers; de namen komen van de leden van die dag. Is een dag
 * niet ingedeeld, dan rekent de app met één persoon.
 */
export interface Teamlid {
  id: string;
  naam: string;
  employee_id: string | null;
  uitgenodigd_user_id: string | null;
}

export async function fetchTeamleden(): Promise<Teamlid[]> {
  const [leden, mensen] = await Promise.all([
    supabase
      .from("teamleden")
      .select("id,naam,employee_id,uitgenodigd_user_id")
      .is("deleted_at", null)
      .order("naam", { ascending: true }),
    supabase.from("employees").select("id,rol,rollen(rechten)"),
  ]);
  if (leden.error) throw leden.error;
  // Geldlopers die niet wassen (wel "geld lopen", geen planning) horen niet
  // in de teams van overdag. Lukt het opvragen van de rollen niet, dan
  // gewoon iedereen.
  const alleenGeld = new Set(
    (mensen.data ?? [])
      .filter((e) => {
        const rechten = eenVan(e.rollen)?.rechten ?? [];
        return (
          e.rol !== "eigenaar" && rechten.includes("geldlopen") && !rechten.includes("planning")
        );
      })
      .map((e) => e.id),
  );
  return (leden.data ?? []).filter((l) => !l.employee_id || !alleenGeld.has(l.employee_id));
}

export async function maakTeamlid(naam: string): Promise<string> {
  const { data, error } = await supabase
    .from("teamleden")
    .insert({ naam: naam.trim() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function hernoemTeamlid(id: string, naam: string) {
  const { error } = await supabase.from("teamleden").update({ naam: naam.trim() }).eq("id", id);
  if (error) throw error;
}

/** Weghalen is wegleggen: de ploegen van vroeger blijven kloppen. */
export async function legTeamlidWeg(id: string) {
  const { error } = await supabase
    .from("teamleden")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** De ploegen van één dag, met hun leden. */
export async function fetchDagPloegen(vanaf: string, tot: string): Promise<Map<string, Ploeg[]>> {
  const [ploegen, leden] = await Promise.all([
    supabase
      .from("dag_ploegen")
      .select("datum,nr,begin_tijd,eind_tijd,pauze_van,pauze_min")
      .gte("datum", vanaf)
      .lte("datum", tot)
      .order("nr", { ascending: true }),
    supabase
      .from("dag_ploeg_leden")
      .select("datum,nr,teamlid_id,teamleden(naam,employee_id)")
      .gte("datum", vanaf)
      .lte("datum", tot),
  ]);
  if (ploegen.error) throw ploegen.error;
  if (leden.error) throw leden.error;

  const perDagNr = new Map<string, PloegLid[]>();
  for (const l of leden.data ?? []) {
    const tl = l.teamleden as unknown as { naam: string; employee_id: string | null } | null;
    const sleutel = `${l.datum}:${l.nr}`;
    const lijst = perDagNr.get(sleutel) ?? [];
    lijst.push({
      teamlid_id: l.teamlid_id,
      naam: tl?.naam ?? "",
      employee_id: tl?.employee_id ?? null,
    });
    perDagNr.set(sleutel, lijst);
  }

  const uit = new Map<string, Ploeg[]>();
  for (const p of ploegen.data ?? []) {
    const lijst = uit.get(p.datum) ?? [];
    lijst.push({
      nr: p.nr,
      leden: (perDagNr.get(`${p.datum}:${p.nr}`) ?? []).sort((a, b) =>
        a.naam.localeCompare(b.naam),
      ),
      begin: p.begin_tijd ? p.begin_tijd.slice(0, 5) : null,
      eind: p.eind_tijd ? p.eind_tijd.slice(0, 5) : null,
      pauzeVan: p.pauze_van ? p.pauze_van.slice(0, 5) : null,
      pauzeMin: p.pauze_min,
    });
    uit.set(p.datum, lijst);
  }
  return uit;
}

/** De ploegen van een dag in één keer neerzetten (vervangt wat er stond). */
export async function zetDagPloegen(datum: string, ploegen: Ploeg[]) {
  const payload = ploegen.map((p) => ({
    nr: p.nr,
    begin: p.begin ?? null,
    eind: p.eind ?? null,
    pauze_van: p.pauzeVan ?? null,
    pauze_min: p.pauzeMin ?? null,
    leden: p.leden.map((l) => l.teamlid_id),
  }));
  const { error } = await supabase.rpc("dag_ploegen_zetten", { dag: datum, ploegen: payload });
  if (error) throw error;
}

/** Eén blok zoals de volgorde-functie het wil. */
export interface VolgordeBlok {
  ploeg_nr: number | null;
  vaste_start?: string | null;
  adressen: string[];
  klussen?: string[];
}

/** De volgorde van de blokken op een dag vastleggen. */
export async function zetDagVolgorde(datum: string, blokken: VolgordeBlok[]) {
  const payload = blokken.map((b) => ({
    ploeg_nr: b.ploeg_nr,
    vaste_start: b.vaste_start ?? null,
    adressen: b.adressen,
    klussen: b.klussen ?? [],
  }));
  const { error } = await supabase.rpc("dag_volgorde_zetten", { dag: datum, blokken: payload });
  if (error) throw error;
}

/** Het teamlid dat bij de ingelogde medewerker hoort. */
export function eigenTeamlid(teamleden: Teamlid[], employeeId: string | undefined): Teamlid | null {
  if (!employeeId) return null;
  return teamleden.find((t) => t.employee_id === employeeId) ?? null;
}

/** In welke ploeg dit teamlid die dag zit. */
export function ploegVan(ploegen: Ploeg[], teamlidId: string | null | undefined): number | null {
  if (!teamlidId) return null;
  return ploegen.find((p) => p.leden.some((l) => l.teamlid_id === teamlidId))?.nr ?? null;
}

/** "Jan & Piet", of "Team 2" als er niemand in staat. */
export function ploegNaam(p: Ploeg): string {
  if (p.leden.length === 0) return `Team ${p.nr}`;
  const namen = p.leden.map((l) => l.naam.split(" ")[0] || l.naam);
  if (namen.length === 1) return namen[0]!;
  return `${namen.slice(0, -1).join(", ")} & ${namen.at(-1)}`;
}
