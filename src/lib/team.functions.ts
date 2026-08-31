import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Maakt bij het registreren van een nieuw bedrijf zowel de `companies`-rij
 * als de eerste `employees`-rij (rol "eigenaar") aan. Dit moet via de
 * service-role admin-client omdat een gloednieuwe gebruiker nog geen
 * employees-rij heeft en dus normaal niets zou mogen inserten (RLS).
 */
export const createCompanyAndOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { companyName: string; naam: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const companyName = data.companyName.trim();
    const naam = data.naam.trim();
    if (!companyName) throw new Error("Bedrijfsnaam is verplicht");

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .insert({ name: companyName })
      .select("id")
      .single();
    if (companyError || !company) {
      throw new Error(companyError?.message ?? "Kon bedrijf niet aanmaken");
    }

    const { error: employeeError } = await supabaseAdmin.from("employees").insert({
      id: context.userId,
      company_id: company.id,
      naam,
      email: (context.claims.email as string | undefined) ?? "",
      rol: "eigenaar",
    });
    if (employeeError) {
      // Rol terugdraaien zodat er geen wees-bedrijf achterblijft.
      await supabaseAdmin.from("companies").delete().eq("id", company.id);
      throw new Error(employeeError.message);
    }

    return { companyId: company.id as string };
  });

/** Alleen de eigenaar mag medewerkers uitnodigen per e-mail. */
export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { email: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || me.rol !== "eigenaar") {
      throw new Error("Alleen de eigenaar kan medewerkers uitnodigen");
    }

    const email = data.email.trim();
    if (!email) throw new Error("E-mailadres is verplicht");

    const request = getRequest();
    const origin = new URL(request.url).origin;

    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { company_id: me.company_id },
      redirectTo: `${origin}/uitnodiging`,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Wordt aangeroepen zodra een uitgenodigde medewerker zijn wachtwoord heeft
 * ingesteld: zet de employees-rij neer met het bedrijf uit de
 * uitnodigingsmetadata.
 */
export const completeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { naam: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const companyId = (context.claims.user_metadata as Record<string, unknown> | undefined)?.[
      "company_id"
    ] as string | undefined;
    if (!companyId) throw new Error("Geen bedrijf gevonden bij deze uitnodiging");

    const { error } = await supabaseAdmin.from("employees").upsert({
      id: context.userId,
      company_id: companyId,
      naam: data.naam.trim(),
      email: (context.claims.email as string | undefined) ?? "",
      rol: "medewerker",
    });
    if (error) throw new Error(error.message);

    return { companyId };
  });

/** Voor de teampagina: lijst collega's + eigen rol. */
export const fetchTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me) throw new Error("Geen bedrijf gevonden");

    const { data: collegas, error } = await supabaseAdmin
      .from("employees")
      .select("id,naam,email,rol,created_at")
      .eq("company_id", me.company_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return { rol: me.rol, collegas: collegas ?? [] };
  });

/** Eigenaar verwijdert een medewerker (kan zichzelf niet verwijderen). */
export const removeEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { employeeId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.employeeId === context.userId) {
      throw new Error("Je kunt jezelf niet verwijderen");
    }

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || me.rol !== "eigenaar") {
      throw new Error("Alleen de eigenaar kan medewerkers verwijderen");
    }

    const { error } = await supabaseAdmin
      .from("employees")
      .delete()
      .eq("id", data.employeeId)
      .eq("company_id", me.company_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/** Je eigen naam wijzigen. Employees heeft geen update-policy, dus dit moet
 *  via de admin-client — vandaar dat het hier staat en niet in de browser. */
export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { naam: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const naam = data.naam.trim();
    if (!naam) throw new Error("Naam mag niet leeg zijn");

    const { error } = await supabaseAdmin
      .from("employees")
      .update({ naam })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/**
 * Eigenaar wijzigt de rol van een collega. Drie dingen die niet mogen, en
 * alle drie om dezelfde reden: je moet het bedrijf erna nog kunnen beheren.
 */
export const updateEmployeeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { employeeId: string; rol: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.rol !== "eigenaar" && data.rol !== "medewerker") {
      throw new Error("Onbekende rol");
    }
    if (data.employeeId === context.userId) {
      throw new Error("Je kunt je eigen rol niet wijzigen");
    }

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || me.rol !== "eigenaar") {
      throw new Error("Alleen de eigenaar kan rollen wijzigen");
    }

    // Zonder eigenaar is een bedrijf niet meer te beheren: niemand kan dan
    // nog uitnodigen, verwijderen of deze rol terugzetten.
    if (data.rol === "medewerker") {
      const { count } = await supabaseAdmin
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", me.company_id)
        .eq("rol", "eigenaar");
      if ((count ?? 0) <= 1) throw new Error("Er moet minstens één eigenaar blijven");
    }

    const { error } = await supabaseAdmin
      .from("employees")
      .update({ rol: data.rol })
      .eq("id", data.employeeId)
      .eq("company_id", me.company_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
