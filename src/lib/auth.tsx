import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { redirect, useNavigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { wisUndo } from "@/lib/undo";
import { supabase } from "@/integrations/supabase/client";
import { vergeetTellers } from "@/lib/tellers";

export type Rol = "eigenaar" | "medewerker";

export type Employee = {
  id: string;
  company_id: string;
  naam: string;
  email: string;
  rol: Rol;
  rol_id: string | null;
  /** Naam van de rol met rechten; leeg voor de eigenaar of zonder rol. */
  rolnaam: string;
  /** De rechten uit die rol. De eigenaar mag altijd alles (zie lib/rechten). */
  rechten: string[];
};

const MEDEWERKER_VELDEN = "id,company_id,naam,email,rol,rol_id,rollen(naam,rechten)";

type MedewerkerRij = Omit<Employee, "rolnaam" | "rechten"> & {
  rollen: { naam: string; rechten: string[] } | null;
};

function alsMedewerker(rij: unknown): Employee | null {
  if (!rij) return null;
  const { rollen, ...rest } = rij as MedewerkerRij;
  return { ...rest, rolnaam: rollen?.naam ?? "", rechten: rollen?.rechten ?? [] };
}

/**
 * Hoe het staat met de code uit de authenticator-app voor deze sessie:
 * - "ok": ingevuld (aal2 in het token), de app is open;
 * - "invullen": er is een app gekoppeld, maar de code is nog niet ingevuld;
 * - "instellen": er is nog geen app gekoppeld.
 * Zonder "ok" geeft de database niets terug (zie de migratie
 * tweestaps_verplicht), dus dan heeft ophalen ook geen zin.
 */
export type Tweestaps = "ok" | "invullen" | "instellen";

/** Rekent het zelf uit, zonder supabase aan te roepen: dit moet ook binnen
 *  `onAuthStateChange` kunnen, en daar hangt een aanroep naar supabase. */
export function tweestapsVan(session: Session): Tweestaps {
  let aal = "";
  try {
    const deel = session.access_token.split(".")[1] ?? "";
    const json = atob(deel.replace(/-/g, "+").replace(/_/g, "/"));
    aal = (JSON.parse(json) as { aal?: string }).aal ?? "";
  } catch {
    // Onleesbaar token: dan geldt het als niet ingevuld.
  }
  if (aal === "aal2") return "ok";
  return session.user.factors?.some((f) => f.status === "verified") ? "invullen" : "instellen";
}

/** Alleen wat de app buiten de instellingenpagina nodig heeft: de naam die
 *  linksboven in de zijbalk staat. */
export type Company = {
  id: string;
  name: string;
};

type AuthState = {
  session: Session | null;
  /** Leeg zonder sessie. */
  tweestaps: Tweestaps | null;
  employee: Employee | null;
  company: Company | null;
  loading: boolean;
  /** Wel een sessie, maar geen employees-rij (meer): opgehaald en niets
   * gevonden. Zo weet `useRequireAuth` het verschil met "nog aan het laden". */
  geenTeamregel: boolean;
  /** Haalt de employees-rij en het bedrijf opnieuw op — nodig vlak nadat die
   * rij is aangemaakt (bedrijf aanmaken / uitnodiging accepteren), want die
   * acties veranderen de sessie niet, dus `onAuthStateChange` vuurt daar niet
   * op. Ook na het wijzigen van je naam of de bedrijfsnaam. */
  refreshEmployee: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  tweestaps: null,
  employee: null,
  company: null,
  loading: true,
  geenTeamregel: false,
  refreshEmployee: async () => {},
});

/** Het bedrijf bij een medewerkersrij. RLS laat je alleen je eigen bedrijf
 *  zien, dus een filter op company_id is genoeg. */
async function laadBedrijf(employee: Employee | null): Promise<Company | null> {
  if (!employee) return null;
  const { data } = await supabase
    .from("companies")
    .select("id,name")
    .eq("id", employee.company_id)
    .maybeSingle();
  return (data as Company) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refreshEmployee">>({
    session: null,
    tweestaps: null,
    employee: null,
    company: null,
    loading: true,
    geenTeamregel: false,
  });
  const qc = useQueryClient();

  useEffect(() => {
    let actief = true;
    /** Wie er nu ingelogd is; nog niet bekend bij het opstarten. */
    let gebruiker: string | null | undefined;

    /** Zet de sessie meteen neer; de medewerkersrij komt er zo achteraan.
     * Wachten met `session` tot die query klaar is zorgde ervoor dat een
     * pagina met `useRequireAuth` je vlak na het inloggen alsnog naar
     * /login stuurde (je moest dan een tweede keer inloggen). */
    function zetSessie(session: Session | null) {
      if (!actief) return;
      setState((vorig) => {
        const tweestaps = session ? tweestapsVan(session) : null;
        const zelfde = session && tweestaps === "ok" && vorig.employee?.id === session.user.id;
        return {
          session,
          tweestaps,
          employee: zelfde ? vorig.employee : null,
          company: zelfde ? vorig.company : null,
          loading: false,
          geenTeamregel: zelfde ? vorig.geenTeamregel : false,
        };
      });
    }

    /** Voor wie de employees- en companies-rij al opgehaald zijn. Bij het
     * opstarten komt hier meer dan één aanroep langs — `getSession` levert er
     * één, en `onAuthStateChange` vuurt zijn eigen beginevents daar bovenop —
     * en zonder dit deed elk van die aanroepen dezelfde twee queries opnieuw.
     * Op de gebruiker en niet op de sessie: een verversde token is dezelfde
     * persoon, en dan hoeft er niets opgehaald te worden. */
    let geladenVoor: string | null = null;

    async function laadMedewerker(session: Session | null) {
      zetSessie(session);
      if (!session) {
        // Uitgelogd: de volgende die binnenkomt hoort weer opgehaald te worden.
        geladenVoor = null;
        return;
      }
      // Zonder code geeft de database niets; en een lege uitkomst zou hieronder
      // lijken op "uit het team gehaald". Na het invullen komt hier een nieuwe
      // sessie langs, en dan wel.
      if (tweestapsVan(session) !== "ok") return;
      if (geladenVoor === session.user.id) return;
      // Vóór de eerste await, anders glipt een tweede aanroep er nog langs.
      geladenVoor = session.user.id;
      const { data, error } = await supabase
        .from("employees")
        .select(MEDEWERKER_VELDEN)
        .eq("id", session.user.id)
        .maybeSingle();
      if (!actief) return;
      if (error) {
        // Mislukt is niet hetzelfde als opgehaald: laat een volgende aanroep
        // het opnieuw proberen, anders blijf je zonder bedrijf zitten.
        if (geladenVoor === session.user.id) geladenVoor = null;
        return;
      }
      const employee = alsMedewerker(data);
      const company = await laadBedrijf(employee);
      if (!actief) return;
      setState((vorig) =>
        vorig.session?.user.id === session.user.id
          ? { ...vorig, employee, company, loading: false, geenTeamregel: !employee }
          : vorig,
      );
    }

    supabase.auth.getSession().then(({ data }) => void laadMedewerker(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // De sessie meteen (synchroon) doorgeven, maar de employees-query pas
      // ná deze callback: supabase houdt hier zijn auth-lock vast en een
      // query erbinnen kan blijven hangen.
      zetSessie(session);
      // Uitgelogd of iemand anders ingelogd: alles wat de app onthield hoort
      // bij de vorige persoon (en misschien een ander bedrijf). Weg ermee,
      // anders zag de volgende op een gedeelde laptop even diens gegevens.
      const id = session?.user.id ?? null;
      if (gebruiker !== undefined && id !== gebruiker) {
        qc.clear();
        wisUndo();
      }
      gebruiker = id;
      setTimeout(() => void laadMedewerker(session), 0);
    });

    return () => {
      actief = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  async function refreshEmployee() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    if (tweestapsVan(data.session) !== "ok") return;
    const { data: emp, error } = await supabase
      .from("employees")
      .select(MEDEWERKER_VELDEN)
      .eq("id", data.session.user.id)
      .maybeSingle();
    const employee = alsMedewerker(emp);
    setState({
      session: data.session,
      tweestaps: "ok",
      employee,
      company: await laadBedrijf(employee),
      loading: false,
      // Een mislukte query is niet hetzelfde als "geen teamregel": alleen bij
      // een geslaagde query zonder rij hoort iemand uitgelogd te worden.
      geenTeamregel: !error && !employee,
    });
  }

  return (
    <AuthContext.Provider value={{ ...state, refreshEmployee }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export async function signOut() {
  vergeetTellers();
  // Alleen hier uitloggen. Zonder bereik kiest supabase "global", en dan
  // trekt het je sessies op álle apparaten in: uitloggen op je telefoon
  // gooide je ook van je laptop.
  await supabase.auth.signOut({ scope: "local" });
}

/**
 * Gebruik in een route's `beforeLoad` om de pagina achter een login te
 * zetten. De sessie leeft alleen in de browser (localStorage) — op de
 * server (eerste paginalading/SSR) is die nooit zichtbaar, dus daar slaan
 * we de check over en laten we `useRequireAuth` in de pagina zelf (client-
 * side, na het laden) de eigenlijke controle + redirect doen.
 */
export async function requireSession() {
  if (typeof window === "undefined") return null;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/login" });
  }
  if (tweestapsVan(data.session) !== "ok") {
    throw redirect({ to: "/tweestaps" });
  }
  return data.session;
}

/** Client-side vangnet: stuurt alsnog naar /login als er (na laden) geen
 *  sessie blijkt te zijn, en naar /tweestaps als de code nog niet is ingevuld. */
export function useRequireAuth() {
  const { session, tweestaps, loading, geenTeamregel } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) void navigate({ to: "/login" });
    else if (tweestaps !== "ok") void navigate({ to: "/tweestaps" });
  }, [loading, session, tweestaps, navigate]);

  // Uit het team gehaald: je sessie loopt nog (die verloopt pas later), maar
  // er valt niets meer te zien. Dan hier uitloggen in plaats van je naar een
  // lege app laten kijken. Eerst nog één keer navragen, want vlak na het
  // aanmaken van een bedrijf of het accepteren van een uitnodiging kan de rij
  // er nog net niet geweest zijn toen we keken.
  useEffect(() => {
    if (!session || !geenTeamregel) return;
    let stop = false;
    void supabase
      .from("employees")
      .select("id")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (stop || error || data) return;
        void signOut().then(() => void navigate({ to: "/login" }));
      });
    return () => {
      stop = true;
    };
  }, [session, geenTeamregel, navigate]);
}
