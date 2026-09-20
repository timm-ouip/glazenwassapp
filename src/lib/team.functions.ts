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

/** Zo lang is een uitnodiging geldig. Daarna moet de eigenaar een nieuwe sturen. */
const UITNODIGING_DAGEN = 7;

/** Wanneer iemand is uitgenodigd: wat wij noteerden, anders wat Supabase weet. */
function uitgenodigdOp(user: {
  app_metadata?: Record<string, unknown> | null;
  invited_at?: string | null;
  created_at?: string;
}): string {
  const eigen = user.app_metadata?.["uitgenodigd_op"];
  return typeof eigen === "string" && eigen ? eigen : (user.invited_at ?? user.created_at ?? "");
}

function isVerlopen(op: string): boolean {
  const t = Date.parse(op);
  return !Number.isFinite(t) || Date.now() - t > UITNODIGING_DAGEN * 24 * 60 * 60 * 1000;
}

/** Een willekeurige code voor in de uitnodigingslink (256 bits). */
function nieuweCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Alleen de hash van de code wordt bewaard; de code zelf staat alleen in de mail. */
async function hashVan(code: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** De uitleg uit het antwoord van een Edge Function, niet de kale melding van de bibliotheek. */
async function uitlegVan(fout: unknown): Promise<string> {
  const res = (fout as { context?: unknown })?.context;
  if (res instanceof Response) {
    try {
      const body = (await res.clone().json()) as { fout?: string };
      if (body?.fout) return body.fout;
    } catch {
      // Geen JSON: dan de gewone melding.
    }
  }
  return fout instanceof Error ? fout.message : String(fout);
}

/** Waarlangs de uitnodiging ging: het eigen adres van het bedrijf, of de standaardmail van Supabase. */
export type UitnodigingVia = { via: "mailbox" | "brevo"; van: string } | { via: "supabase" };

/**
 * Alleen de eigenaar mag medewerkers uitnodigen per e-mail.
 *
 * De mail gaat vanaf het eigen adres van het bedrijf (Edge Function
 * `team-uitnodiging`), met een eigen code in de link die net zo lang geldig
 * is als de uitnodiging. De links van Supabase verlopen na hooguit een dag.
 * Kan het bedrijf niet zelf mailen, dan de standaardmail van Supabase.
 */
export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { email: string; teamlidId?: string }) => data)
  .handler(async ({ data, context }): Promise<UitnodigingVia> => {
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

    const redirectTo = `${origin}/uitnodiging`;

    // Eerst kijken of er al een account met dit adres is, vóór er iets
    // verstuurd wordt. Opzoeken in de database, niet via een inloglink maken:
    // dan weigerde Supabase de mail die daarna moest komen.
    const { data: bestaandId, error: zoekFout } = await supabaseAdmin.rpc("gebruiker_met_email", {
      adres: email,
    });
    if (zoekFout) throw new Error("Uitnodigen mislukte");
    // Eén melding voor alles wat niet kan: anders vertelt hij aan elke
    // eigenaar of een adres ergens anders in Wooshy gebruikt wordt.
    const kanNiet = "Dit e-mailadres kan nu niet uitgenodigd worden.";
    if (bestaandId) {
      const { data: al } = await supabaseAdmin
        .from("employees")
        .select("company_id")
        .eq("id", bestaandId)
        .maybeSingle();
      if (al)
        throw new Error(
          al.company_id === me.company_id ? "Deze persoon zit al in je team." : kanNiet,
        );
      // Een lopende uitnodiging van een ander bedrijf niet overnemen: dan zou
      // hij via de mail van dat bedrijf bij jou binnenkomen. Kan dat niet
      // nagekeken worden, dan niet.
      const { data: bestaand, error: ophaalFout } =
        await supabaseAdmin.auth.admin.getUserById(bestaandId);
      if (ophaalFout || !bestaand?.user) throw new Error("Uitnodigen mislukte");
      const andere = bestaand.user.app_metadata?.["uitgenodigd_voor"];
      if (
        typeof andere === "string" &&
        andere &&
        andere !== me.company_id &&
        !isVerlopen(uitgenodigdOp(bestaand.user))
      ) {
        throw new Error(kanNiet);
      }
    }

    // Het account klaarzetten zonder dat Supabase al iets mailt. Zonder
    // wachtwoord en onbevestigd: inloggen kan pas na de uitnodiging.
    let account: string | null = bestaandId ?? null;
    if (!account) {
      const { data: nieuw, error: maakFout } = await supabaseAdmin.auth.admin.createUser({ email });
      if (maakFout || !nieuw?.user) throw new Error(maakFout?.message ?? "Uitnodigen mislukte");
      account = nieuw.user.id;
    }
    const gebruikerId = account;

    // Het bedrijf staat in app_metadata en niet in user_metadata: die laatste
    // kan een ingelogde gebruiker zelf aanpassen, en dan zou iedereen met een
    // bedrijfs-id zich bij dat bedrijf kunnen aansluiten. app_metadata kan
    // alleen de server wijzigen. Met de datum: na UITNODIGING_DAGEN verloopt
    // hij. Een nieuwe code maakt de link uit een eerdere mail ongeldig.
    // Nodig je een teamlid zonder account uit, dan hangen we de uitnodiging
    // aan dat teamlid: accepteert hij, dan is het dezelfde persoon en houdt
    // hij zijn plek in de ploegen van vroeger.
    if (data.teamlidId) {
      const { data: teamlid, error: tlFout } = await supabaseAdmin
        .from("teamleden")
        .select("id,company_id,employee_id")
        .eq("id", data.teamlidId)
        .maybeSingle();
      if (tlFout) throw new Error("Uitnodigen mislukte");
      if (!teamlid || teamlid.company_id !== me.company_id || teamlid.employee_id) {
        throw new Error("Dit teamlid kan niet uitgenodigd worden.");
      }
      const { error: koppelFout } = await supabaseAdmin
        .from("teamleden")
        .update({ uitgenodigd_user_id: gebruikerId })
        .eq("id", data.teamlidId);
      if (koppelFout) throw new Error("Uitnodigen mislukte");
    }

    const code = nieuweCode();
    const { error: metaFout } = await supabaseAdmin.auth.admin.updateUserById(gebruikerId, {
      app_metadata: {
        uitgenodigd_voor: me.company_id,
        uitgenodigd_op: new Date().toISOString(),
        uitnodiging_code: await hashVan(code),
      },
    });
    if (metaFout) throw new Error(metaFout.message);

    // Mislukt het versturen, dan staat er ook geen uitnodiging open: anders
    // staat hij in de lijst als verstuurd terwijl er niets aankwam.
    const trekIn = async () => {
      await supabaseAdmin.auth.admin.updateUserById(gebruikerId, {
        app_metadata: { uitgenodigd_voor: null, uitgenodigd_op: null, uitnodiging_code: null },
      });
      await supabaseAdmin
        .from("teamleden")
        .update({ uitgenodigd_user_id: null })
        .eq("uitgenodigd_user_id", gebruikerId);
    };

    const { data: uit, error: functieFout } = await context.supabase.functions.invoke<
      { via: "mailbox" | "brevo"; van: string } | { via: "geen" }
    >("team-uitnodiging", { body: { gebruiker_id: gebruikerId, code, adres: origin } });
    if (functieFout || !uit?.via) {
      await trekIn();
      throw new Error(functieFout ? await uitlegVan(functieFout) : "Versturen mislukte");
    }
    if (uit.via !== "geen") return uit;

    // Het bedrijf kan (nog) niet zelf mailen: de standaardmail van Supabase.
    // Die link komt terug op /uitnodiging mét een sessie (zie completeInvite).
    // Is het account al bevestigd, dan weigert Supabase een uitnodiging. Dat
    // gebeurt als iemand de link al opende maar nooit een wachtwoord koos, of
    // bij een oud-medewerker die terugkomt. Dan sturen we een inloglink naar
    // dezelfde pagina: daar kiest hij alsnog een wachtwoord.
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
    let mailFout = error;
    if (error && /already|registered|exists/i.test(error.message)) {
      ({ error: mailFout } = await supabaseAdmin.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      }));
    }
    if (mailFout) {
      await trekIn();
      throw new Error(
        `${mailFout.message}. Koppel je bedrijfsmail bij Instellingen → mail, dan verstuurt Wooshy de uitnodiging zelf.`,
      );
    }
    return { via: "supabase" };
  });

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

type Uitnodiging =
  | {
      status: "geldig";
      id: string;
      email: string;
      companyId: string;
      /** Dit adres heeft al een eigen Wooshy-account (bevestigd): zie accepteerUitnodiging. */
      bestaand: boolean;
    }
  | { status: "verlopen" | "ongeldig" | "gebruikt" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hoort deze code bij een uitnodiging die nog open staat? De code blijft na
 * gebruik bewaard, zodat een tweede klik op de link "al gebruikt" kan zeggen
 * in plaats van "ongeldig".
 */
async function zoekUitnodiging(admin: Admin, id: string, code: string): Promise<Uitnodiging> {
  if (!UUID.test(id) || code.length < 20 || code.length > 200) return { status: "ongeldig" };
  const { data: gebruiker, error } = await admin.auth.admin.getUserById(id);
  if (error || !gebruiker?.user?.email) return { status: "ongeldig" };
  const meta = gebruiker.user.app_metadata ?? {};
  if (meta["uitnodiging_code"] !== (await hashVan(code))) return { status: "ongeldig" };
  const { data: al } = await admin.from("employees").select("id").eq("id", id).maybeSingle();
  if (al) return { status: "gebruikt" };
  const companyId = meta["uitgenodigd_voor"];
  if (typeof companyId !== "string" || !companyId) return { status: "ongeldig" };
  if (isVerlopen(uitgenodigdOp(gebruiker.user))) return { status: "verlopen" };
  return {
    status: "geldig",
    id,
    email: gebruiker.user.email,
    companyId,
    bestaand: !!gebruiker.user.email_confirmed_at,
  };
}

const WAAROM_NIET: Record<Exclude<Uitnodiging["status"], "geldig">, string> = {
  verlopen: `Deze uitnodiging is verlopen (langer dan ${UITNODIGING_DAGEN} dagen geleden). Vraag de eigenaar om een nieuwe.`,
  ongeldig:
    "Deze uitnodigingslink klopt niet (meer). Misschien is er een nieuwere gestuurd of is hij ingetrokken.",
  gebruikt: "Deze uitnodiging is al gebruikt. Log in met je e-mailadres en wachtwoord.",
};

function leesCode(data: unknown): { id: string; code: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  const id = d["id"];
  const code = d["code"];
  if (typeof id !== "string" || typeof code !== "string") throw new Error("Onleesbaar verzoek");
  return { id, code };
}

/**
 * Voor de uitnodigingspagina: klopt de link, en van welk bedrijf is hij? Zonder
 * login, want de nieuwe collega heeft nog geen wachtwoord. Verandert niets,
 * dus een virusscanner die de link vooraf opent, maakt hem niet stuk.
 */
export const bekijkUitnodiging = createServerFn({ method: "POST" })
  .validator(leesCode)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const u = await zoekUitnodiging(supabaseAdmin, data.id, data.code);
    if (u.status !== "geldig") return { status: u.status, uitleg: WAAROM_NIET[u.status] };
    const { data: bedrijf } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", u.companyId)
      .maybeSingle();
    return { status: u.status, email: u.email, bedrijf: bedrijf?.name ?? "", bestaand: u.bestaand };
  });

/**
 * De nieuwe collega kiest zijn naam en wachtwoord. De code in de link bewijst
 * dat hij de mail kreeg; daarna is hij lid van het bedrijf van de uitnodiging
 * en logt hij gewoon in met zijn e-mailadres en dit wachtwoord.
 *
 * Alleen voor een account dat nog nooit bevestigd is. De mail staat ook in
 * Verzonden van het bedrijf; bij een bestaand account zou wie daar kan lezen
 * anders het wachtwoord van iemand anders kunnen kiezen. Een bestaand account
 * logt in met zijn eigen wachtwoord (completeInvite), of vraagt een inloglink
 * die naar zijn eigen adres gaat (stuurInloglink).
 */
export const accepteerUitnodiging = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const naam = d["naam"];
    const wachtwoord = d["wachtwoord"];
    if (typeof naam !== "string" || typeof wachtwoord !== "string")
      throw new Error("Onleesbaar verzoek");
    return { ...leesCode(data), naam, wachtwoord };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const naam = data.naam.trim().slice(0, 100);
    if (!naam) throw new Error("Vul je naam in.");
    if (data.wachtwoord.length < 6) throw new Error("Kies een wachtwoord van minimaal 6 tekens.");

    const u = await zoekUitnodiging(supabaseAdmin, data.id, data.code);
    if (u.status !== "geldig") throw new Error(WAAROM_NIET[u.status]);
    if (u.bestaand) {
      throw new Error("Er is al een Wooshy-account met dit adres. Log in met je eigen wachtwoord.");
    }

    const { error: pwFout } = await supabaseAdmin.auth.admin.updateUserById(u.id, {
      password: data.wachtwoord,
      email_confirm: true,
    });
    if (pwFout) throw new Error("Wachtwoord instellen mislukt: " + pwFout.message);

    const { error } = await supabaseAdmin.from("employees").insert({
      id: u.id,
      company_id: u.companyId,
      naam,
      email: u.email,
      rol: "medewerker",
    });
    if (error) throw new Error(error.message);

    // De uitnodiging is gebruikt.
    await supabaseAdmin.auth.admin.updateUserById(u.id, {
      app_metadata: { uitgenodigd_voor: null },
    });

    return { email: u.email };
  });

/**
 * Wie al een account heeft maar zijn wachtwoord kwijt is: een inloglink van
 * Supabase naar zijn eigen adres. Die komt terug op /uitnodiging met een
 * sessie, en daar kiest hij een nieuw wachtwoord (completeInvite). De code
 * alleen is niet genoeg: de link gaat naar de uitgenodigde zelf.
 */
export const stuurInloglink = createServerFn({ method: "POST" })
  .validator(leesCode)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const u = await zoekUitnodiging(supabaseAdmin, data.id, data.code);
    if (u.status !== "geldig") throw new Error(WAAROM_NIET[u.status]);
    if (!u.bestaand) throw new Error("Kies hierboven gewoon een wachtwoord.");
    const origin = new URL(getRequest().url).origin;
    const { error } = await supabaseAdmin.auth.signInWithOtp({
      email: u.email,
      options: { shouldCreateUser: false, emailRedirectTo: `${origin}/uitnodiging` },
    });
    if (error) throw new Error(error.message);
    return { email: u.email };
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
    if (gebruikerFout || !gebruiker?.user)
      throw new Error("Deze uitnodiging kon niet gecontroleerd worden");
    const companyId = (gebruiker.user.app_metadata as Record<string, unknown> | undefined)?.[
      "uitgenodigd_voor"
    ];
    if (typeof companyId !== "string" || !companyId) {
      throw new Error(
        "Geen geldige uitnodiging gevonden. Vraag de eigenaar om je opnieuw uit te nodigen.",
      );
    }
    if (isVerlopen(uitgenodigdOp(gebruiker.user))) {
      throw new Error(
        `Deze uitnodiging is verlopen (langer dan ${UITNODIGING_DAGEN} dagen geleden). Vraag de eigenaar om een nieuwe.`,
      );
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

    // Wie is uitgenodigd maar nog niet binnen: alleen voor de eigenaar, die
    // kan ze intrekken of opnieuw sturen. Zo zie je wie er nog kan binnenkomen.
    let uitgenodigd: { id: string; email: string; op: string; verlopen: boolean }[] = [];
    if (me.rol === "eigenaar") {
      // Alleen de accounts van dit bedrijf, rechtstreeks uit de database.
      const { data: open, error: openFout } = await supabaseAdmin.rpc("openstaande_uitnodigingen", {
        bedrijf: me.company_id,
      });
      if (openFout) throw new Error(openFout.message);
      uitgenodigd = (open ?? []).map((u) => {
        const op = u.uitgenodigd_op || u.invited_at || u.created_at;
        return { id: u.id, email: u.email, op, verlopen: isVerlopen(op) };
      });
    }

    return { rol: me.rol, collegas: collegas ?? [], uitgenodigd };
  });

/** Eigenaar trekt een uitnodiging in die nog niet gebruikt is. */
export const trekUitnodigingIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("employees")
      .select("company_id,rol")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || me.rol !== "eigenaar") {
      throw new Error("Alleen de eigenaar kan uitnodigingen intrekken");
    }
    const { data: gebruiker, error } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (error || !gebruiker?.user) throw new Error("Deze uitnodiging is niet gevonden");
    // Alleen een uitnodiging van je eigen bedrijf.
    if (gebruiker.user.app_metadata?.["uitgenodigd_voor"] !== me.company_id) {
      throw new Error("Deze uitnodiging is niet (meer) van jouw bedrijf");
    }
    const { error: metaFout } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      app_metadata: { uitgenodigd_voor: null, uitgenodigd_op: null, uitnodiging_code: null },
    });
    if (metaFout) throw new Error(metaFout.message);
    // Een teamlid dat op deze uitnodiging wachtte, wacht nergens meer op.
    await supabaseAdmin
      .from("teamleden")
      .update({ uitgenodigd_user_id: null })
      .eq("uitgenodigd_user_id", data.userId);
    return { ok: true };
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
