import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { redirect, useNavigate } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Rol = "eigenaar" | "medewerker";

export type Employee = {
  id: string;
  company_id: string;
  naam: string;
  email: string;
  rol: Rol;
};

/** Alleen wat de app buiten de instellingenpagina nodig heeft: de naam die
 *  linksboven in de zijbalk staat. */
export type Company = {
  id: string;
  name: string;
};

type AuthState = {
  session: Session | null;
  employee: Employee | null;
  company: Company | null;
  loading: boolean;
  /** Haalt de employees-rij en het bedrijf opnieuw op — nodig vlak nadat die
   * rij is aangemaakt (bedrijf aanmaken / uitnodiging accepteren), want die
   * acties veranderen de sessie niet, dus `onAuthStateChange` vuurt daar niet
   * op. Ook na het wijzigen van je naam of de bedrijfsnaam. */
  refreshEmployee: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  employee: null,
  company: null,
  loading: true,
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
    employee: null,
    company: null,
    loading: true,
  });

  useEffect(() => {
    let actief = true;

    /** Zet de sessie meteen neer; de medewerkersrij komt er zo achteraan.
     * Wachten met `session` tot die query klaar is zorgde ervoor dat een
     * pagina met `useRequireAuth` je vlak na het inloggen alsnog naar
     * /login stuurde (je moest dan een tweede keer inloggen). */
    function zetSessie(session: Session | null) {
      if (!actief) return;
      setState((vorig) => {
        const zelfde = session && vorig.employee?.id === session.user.id;
        return {
          session,
          employee: zelfde ? vorig.employee : null,
          company: zelfde ? vorig.company : null,
          loading: false,
        };
      });
    }

    async function laadMedewerker(session: Session | null) {
      zetSessie(session);
      if (!session) return;
      const { data } = await supabase
        .from("employees")
        .select("id,company_id,naam,email,rol")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!actief) return;
      const employee = (data as Employee) ?? null;
      const company = await laadBedrijf(employee);
      if (!actief) return;
      setState((vorig) =>
        vorig.session?.user.id === session.user.id
          ? { ...vorig, employee, company, loading: false }
          : vorig,
      );
    }

    supabase.auth.getSession().then(({ data }) => void laadMedewerker(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // De sessie meteen (synchroon) doorgeven, maar de employees-query pas
      // ná deze callback: supabase houdt hier zijn auth-lock vast en een
      // query erbinnen kan blijven hangen.
      zetSessie(session);
      setTimeout(() => void laadMedewerker(session), 0);
    });

    return () => {
      actief = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshEmployee() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const { data: emp } = await supabase
      .from("employees")
      .select("id,company_id,naam,email,rol")
      .eq("id", data.session.user.id)
      .maybeSingle();
    const employee = (emp as Employee) ?? null;
    setState({
      session: data.session,
      employee,
      company: await laadBedrijf(employee),
      loading: false,
    });
  }

  return <AuthContext.Provider value={{ ...state, refreshEmployee }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export async function signOut() {
  await supabase.auth.signOut();
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
  return data.session;
}

/** Client-side vangnet: stuurt alsnog naar /login als er (na laden) geen sessie blijkt te zijn. */
export function useRequireAuth() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);
}
