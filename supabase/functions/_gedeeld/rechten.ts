/**
 * Mag deze medewerker dit? Zelfde regel als heeft_recht() in de database: de
 * eigenaar mag altijd alles, een medewerker wat zijn rol hem geeft.
 *
 * Met de service-role-client: de rol wordt hier vers opgehaald en niet uit het
 * verzoek gehaald, zodat niemand zichzelf rechten kan meegeven.
 */
// deno-lint-ignore no-explicit-any
type Db = any;

export type Recht =
  | "mail_lezen"
  | "mail_versturen"
  | "klanten_bekijken"
  | "klanten_bewerken"
  | "prijzen_zien"
  | "planning"
  | "instellingen_team";

export async function heeftRecht(
  db: Db,
  medewerker: { id: string; company_id: string; rol: string },
  recht: Recht,
): Promise<boolean> {
  if (medewerker.rol === "eigenaar") return true;
  const { data, error } = await db
    .from("employees")
    .select("rol_id,rollen(rechten)")
    .eq("id", medewerker.id)
    .eq("company_id", medewerker.company_id)
    .maybeSingle();
  if (error) {
    // Zonder dit krijgt elke medewerker "geen recht" en weet niemand waarom.
    console.error(`rechten van ${medewerker.id} ophalen:`, error.message);
    return false;
  }
  if (!data?.rollen) return false;
  const rechten = (data.rollen as { rechten?: string[] }).rechten ?? [];
  return rechten.includes(recht);
}
