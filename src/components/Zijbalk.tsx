import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Droplets,
  LogOut,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Trash2,
  Upload,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { useAuth, signOut } from "@/lib/auth";

const OPSLAG = "zijbalk-ingeklapt";

type Pagina = {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Alleen voor de eigenaar zichtbaar. */
  eigenaar?: boolean;
};

const WERK: Pagina[] = [
  { label: "Wijken", to: "/", icon: Map },
  { label: "Klanten", to: "/klanten", icon: Users },
  { label: "Printen", to: "/printen", icon: Printer },
  { label: "Importeren", to: "/importeren", icon: Upload },
];

const BEHEER: Pagina[] = [
  { label: "Team", to: "/team", icon: UsersRound, eigenaar: true },
  { label: "Prullenbak", to: "/prullenbak", icon: Trash2 },
];

export function Zijbalk() {
  const { employee } = useAuth();
  const navigate = useNavigate();
  const pad = useRouterState({ select: (s) => s.location.pathname });

  // Begint uitgeklapt; de keuze van de gebruiker wordt na het eerste
  // renderen ingelezen, zodat server en client hetzelfde beginnen.
  const [ingeklapt, setIngeklapt] = useState(false);

  useEffect(() => {
    try {
      setIngeklapt(localStorage.getItem(OPSLAG) === "ja");
    } catch {
      // Privémodus of geblokkeerde opslag: uitgeklapt is prima.
    }
  }, []);

  function klap() {
    setIngeklapt((was) => {
      const nu = !was;
      try {
        localStorage.setItem(OPSLAG, nu ? "ja" : "nee");
      } catch {
        // Niet kunnen onthouden is geen reden om niet te klappen.
      }
      return nu;
    });
  }

  const breed = ingeklapt ? "w-[68px]" : "w-[236px]";

  function Item({ p }: { p: Pagina }) {
    const actief = p.to === "/" ? pad === "/" : pad.startsWith(p.to);
    return (
      <Link
        to={p.to}
        title={ingeklapt ? p.label : undefined}
        aria-label={p.label}
        className={`flex h-10 items-center rounded-lg text-[13.5px] transition-colors ${
          ingeklapt ? "justify-center px-0" : "gap-3 px-2.5"
        } ${
          actief
            ? "bg-brand font-semibold text-brand-foreground"
            : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        <p.icon className="size-[17px] shrink-0" />
        {!ingeklapt && <span className="truncate">{p.label}</span>}
      </Link>
    );
  }

  const beheer = BEHEER.filter((p) => !p.eigenaar || employee?.rol === "eigenaar");

  return (
    <aside
      className={`${breed} sticky top-0 flex h-screen shrink-0 flex-col gap-5 border-r border-border bg-surface px-3.5 py-5 transition-[width] duration-200 print:hidden`}
    >
      <div className={`flex items-center ${ingeklapt ? "flex-col gap-3" : "gap-2.5"}`}>
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-brand text-brand-foreground">
          <Droplets className="size-[19px]" />
        </div>
        {!ingeklapt && (
          <span className="truncate font-display text-base font-bold">'t Zonnetje</span>
        )}
        <button
          type="button"
          onClick={klap}
          aria-label={ingeklapt ? "Navigatie uitklappen" : "Navigatie inklappen"}
          title={ingeklapt ? "Uitklappen" : "Inklappen"}
          className={`flex size-[26px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground hover:text-foreground ${
            ingeklapt ? "" : "ml-auto"
          }`}
        >
          {ingeklapt ? (
            <PanelLeftOpen className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5">
        {!ingeklapt && (
          <span className="px-2.5 pb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
            WERK
          </span>
        )}
        {WERK.map((p) => (
          <Item key={p.to} p={p} />
        ))}
      </nav>

      {beheer.length > 0 && (
        <nav className="flex flex-col gap-0.5">
          {!ingeklapt && (
            <span className="px-2.5 pb-2 text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
              BEHEER
            </span>
          )}
          {beheer.map((p) => (
            <Item key={p.to} p={p} />
          ))}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {employee && !ingeklapt && (
          <div className="flex items-center gap-2.5 rounded-[11px] border border-border bg-card p-2.5">
            <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
              {(employee.naam || employee.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium leading-tight">
                {employee.naam || employee.email}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {employee.rol === "eigenaar" ? "Eigenaar" : "Medewerker"}
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut().then(() => void navigate({ to: "/login" }))}
          aria-label="Uitloggen"
          title="Uitloggen"
          className={`flex h-10 items-center rounded-lg text-[13.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground ${
            ingeklapt ? "justify-center px-0" : "gap-3 px-2.5"
          }`}
        >
          <LogOut className="size-[17px] shrink-0" />
          {!ingeklapt && <span>Uitloggen</span>}
        </button>
      </div>
    </aside>
  );
}
