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

type AuthState = {
  session: Session | null;
  employee: Employee | null;
  loading: boolean;
  /** Haalt de employees-rij opnieuw op — nodig vlak nadat die rij is
   * aangemaakt (bedrijf aanmaken / uitnodiging accepteren), want die acties
   * veranderen de sessie niet, dus `onAuthStateChange` vuurt daar niet op. */
  refreshEmployee: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  employee: null,
  loading: true,
  refreshEmployee: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refreshEmployee">>({
    session: null,
    employee: null,
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
      setState((vorig) => ({
        session,
        employee:
          session && vorig.employee?.id === session.user.id ? vorig.employee : null,
        loading: false,
      }));
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
      setState((vorig) =>
        vorig.session?.user.id === session.user.id
          ? { ...vorig, employee: (data as Employee) ?? null, loading: false }
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
    setState({ session: data.session, employee: (emp as Employee) ?? null, loading: false });
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
