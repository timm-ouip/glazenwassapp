/**
 * Rollen en rechten. De eigenaar mag altijd alles; een medewerker alleen wat
 * zijn rol hem geeft. Wat hier staat bepaalt wat de app laat zien; wat iemand
 * werkelijk mag, dwingt de database af.
 */
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Employee } from "@/lib/auth";

export const RECHTEN = [
  {
    sleutel: "planning",
    label: "Planning & wijken",
    uitleg: "Wijken, planning en de dag bekijken en bijwerken",
  },
  {
    sleutel: "klanten_bekijken",
    label: "Klanten bekijken",
    uitleg: "Klanten en hun adressen zien",
  },
  {
    sleutel: "klanten_bewerken",
    label: "Klanten bewerken",
    uitleg: "Klanten toevoegen, wijzigen en weggooien; aanmeldingen",
  },
  {
    sleutel: "prijzen_zien",
    label: "Prijzen zien",
    uitleg: "Prijzen en omzet; zonder dit recht ziet hij nergens een bedrag",
  },
  { sleutel: "mail_lezen", label: "Mail lezen", uitleg: "Het postvak en wat Paaltje klaarzette" },
  {
    sleutel: "mail_versturen",
    label: "Mail versturen",
    uitleg: "Antwoorden en aankondigingen versturen",
  },
  { sleutel: "instellingen_team", label: "Team bekijken", uitleg: "Zien wie er in het team zit" },
] as const;

export type Recht = (typeof RECHTEN)[number]["sleutel"];

export function heeftRecht(employee: Employee | null, recht: Recht): boolean {
  if (!employee) return false;
  if (employee.rol === "eigenaar") return true;
  return employee.rechten.includes(recht);
}

/** Heeft de ingelogde gebruiker minstens één van deze rechten? */
export function useRecht(...rechten: Recht[]): boolean {
  const { employee } = useAuth();
  return rechten.some((r) => heeftRecht(employee, r));
}

/**
 * Welk recht een pagina vraagt (minstens één ervan). Leeg: iedereen die
 * ingelogd is. Dezelfde indeling als het menu in de zijbalk; de database
 * dwingt het af, dit zorgt dat je een nette melding krijgt in plaats van een
 * lege pagina.
 */
export function rechtenVoorPad(pad: string): Recht[] | null {
  if (
    pad === "/" ||
    pad.startsWith("/planning") ||
    pad.startsWith("/dag") ||
    pad.startsWith("/printen")
  ) {
    return ["planning"];
  }
  if (pad.startsWith("/klanten")) return ["klanten_bekijken"];
  if (
    pad.startsWith("/aanmeldingen") ||
    pad.startsWith("/importeren") ||
    pad.startsWith("/prullenbak")
  ) {
    return ["klanten_bewerken"];
  }
  if (pad.startsWith("/mailing")) return ["mail_lezen", "mail_versturen"];
  if (pad.startsWith("/berichten")) return ["mail_lezen"];
  return null;
}

/** "Eigenaar", de naam van de rol, of "Medewerker" als hij (nog) geen rol heeft. */
export function rolLabel(employee: Pick<Employee, "rol" | "rolnaam">): string {
  if (employee.rol === "eigenaar") return "Eigenaar";
  return employee.rolnaam || "Medewerker";
}

export interface Rol {
  id: string;
  naam: string;
  rechten: Recht[];
}

const GELDIG = new Set<string>(RECHTEN.map((r) => r.sleutel));

export async function fetchRollen(): Promise<Rol[]> {
  const { data, error } = await supabase.from("rollen").select("id,naam,rechten").order("naam");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    naam: r.naam,
    rechten: (r.rechten ?? []).filter((x): x is Recht => GELDIG.has(x)),
  }));
}

export async function bewaarRol(rol: {
  id?: string;
  naam: string;
  rechten: Recht[];
}): Promise<void> {
  const naam = rol.naam.trim();
  if (!naam) throw new Error("Geef de rol een naam.");
  const rechten = RECHTEN.map((r) => r.sleutel).filter((s) => rol.rechten.includes(s));
  const { error } = rol.id
    ? await supabase.from("rollen").update({ naam, rechten }).eq("id", rol.id)
    : await supabase.from("rollen").insert({ naam, rechten });
  if (error) {
    if (error.code === "23505") throw new Error("Er is al een rol met die naam.");
    throw error;
  }
}

export async function verwijderRol(id: string): Promise<void> {
  const { error } = await supabase.from("rollen").delete().eq("id", id);
  if (error) throw error;
}
