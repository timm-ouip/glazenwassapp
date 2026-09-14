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

    const { data: uitnodiging, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/uitnodiging`,
    });
    if (error || !uitnodiging?.user) throw new Error(error?.message ?? "Uitnodigen mislukte");

    // Het bedrijf staat in app_metadata en niet in user_metadata: die laatste
    // kan een ingelogde gebruiker zelf aanpassen, en dan zou iedereen met een
    // bedrijfs-id zich bij dat bedrijf kunnen aansluiten. app_metadata kan
    // alleen de server wijzigen.
    const { error: metaFout } = await supabaseAdmin.auth.admin.updateUserById(uitnodiging.user.id, {
      app_metadata: { uitgenodigd_voor: me.company_id },
    });
    if (metaFout) throw new Error(metaFout.message);

    return { ok: true };
  });

/**
 * Wordt aangeroepen zodra een uitgenodigde medewerker zijn wachtwoord heeft
 * ingesteld: zet de employees-rij neer bij het bedrijf van de uitnodiging.
 *
 * Het bedrijf komt uit app_metadata, vers opgehaald bij Supabase en niet uit
 * het token: alleen de server zet het daar (zie inviteEmployee). En wie al
 * bij een bedrijf hoort, wordt nooit verplaatst.
 */
export const completeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { naam: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: bestaand } = await supabaseAdmin
      .from("employees")
      .select("company_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (bestaand) return { companyId: bestaand.company_id as string };

    const { data: gebruiker, error: gebruikerFout } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (gebruikerFout || !gebruiker?.user) throw new Error("Deze uitnodiging kon niet gecontroleerd worden");
    const companyId = (gebruiker.user.app_metadata as Record<string, unknown> | undefined)?.[
      "uitgenodigd_voor"
    ];
    if (typeof companyId !== "string" || !companyId) {
      throw new Error("Geen geldige uitnodiging gevonden. Vraag de eigenaar om je opnieuw uit te nodigen.");
    }

    const { error } = await supabaseAdmin.from("employees").insert({
      id: context.userId,
      company_id: companyId,
      naam: data.naam.trim(),
      email: gebruiker.user.email ?? "",
      rol: "medewerker",
    });
    if (error) throw new Error(error.message);

    // De uitnodiging is gebruikt.
    await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      app_metadata: { uitgenodigd_voor: null },
    });

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
      .select("id,naam,email,rol,rol_id,created_at")
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
 * Eigenaar geeft een medewerker een rol met rechten (of haalt die weg). Via de
 * server, want employees heeft geen update-policy: anders zou iemand zijn
 * eigen rol kunnen kiezen.
 */
export const assignRol = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { employeeId: string; rolId: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || me.rol !== "eigenaar") {
      throw new Error("Alleen de eigenaar kan rollen toekennen");
    }

    const { data: doel } = await supabaseAdmin
      .from("employees")
      .select("rol")
      .eq("id", data.employeeId)
      .eq("company_id", me.company_id)
      .maybeSingle();
    if (!doel) throw new Error("Die medewerker hoort niet bij jouw bedrijf");
    // Een eigenaar mag altijd alles; een rol erbij zou pas gaan tellen als hij
    // ooit medewerker wordt, en dat moet dan een bewuste keuze zijn.
    if (doel.rol === "eigenaar" && data.rolId !== null) {
      throw new Error("Een eigenaar mag al alles en krijgt geen rol");
    }

    if (data.rolId !== null) {
      const { data: rol } = await supabaseAdmin
        .from("rollen")
        .select("id")
        .eq("id", data.rolId)
        .eq("company_id", me.company_id)
        .maybeSingle();
      if (!rol) throw new Error("Die rol bestaat niet (meer)");
    }

    const { data: bijgewerkt, error } = await supabaseAdmin
      .from("employees")
      .update({ rol_id: data.rolId })
      .eq("id", data.employeeId)
      .eq("company_id", me.company_id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!bijgewerkt?.length) throw new Error("Die medewerker hoort niet bij jouw bedrijf");

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
      // De rol met rechten vervalt bij elke wissel: wie weer medewerker wordt,
      // krijgt niet ongemerkt de rechten van vroeger terug.
      .update({ rol: data.rol, rol_id: null })
      .eq("id", data.employeeId)
      .eq("company_id", me.company_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
