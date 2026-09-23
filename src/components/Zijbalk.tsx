import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconLogout as LogOut,
  IconCalendar as CalendarDays,
  IconCash as Cash,
  IconMap as Map,
  IconHistory as History,
  IconHome as Home,
  IconLayoutDashboard as Dashboard,
  IconInbox as Inbox,
  IconMail as Mail,
  IconLayoutSidebarLeftCollapse as PanelLeftClose,
  IconLayoutSidebarLeftExpand as PanelLeftOpen,
  IconSettings as Settings,
  IconUpload as Upload,
  IconUsers as Users,
  type TablerIcon as LucideIcon,
} from "@tabler/icons-react";

import { Druppel } from "@/components/Merk";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, signOut } from "@/lib/auth";
import { aantalOpenAanmeldingen } from "@/lib/aanmeldingen";
import { heeftRecht, rolLabel, type Recht } from "@/lib/rechten";
import { MENU_TABBLADEN, TABNAAM, type BetalingenTab } from "@/lib/betalingen";
import { MAIL_BLADEN, MAIL_BLADNAAM, MAIL_BLADRECHT, type MailBlad } from "@/lib/mailbladen";

const OPSLAG = "zijbalk-ingeklapt";

type Pagina = {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Zichtbaar voor wie minstens één van deze rechten heeft (de eigenaar altijd). */
  recht?: Recht[];
  /** En deze allemaal: het dashboard telt planning en prijzen bij elkaar op. */
  rechtAlles?: Recht[];
};

/** Het startscherm met een vak per onderdeel. Voor iedereen: wat erop staat
 *  hangt zelf van je rechten af. */
const THUIS: Pagina = { label: "Home", to: "/home", icon: Home };

const WERK: Pagina[] = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: Dashboard,
    rechtAlles: ["planning", "prijzen_zien"],
  },
  { label: "Wijken", to: "/", icon: Map, recht: ["planning"] },
  // Printen staat bewust niet in dit menu: die knop hoort bij de wijk waar je
  // op dat moment naar kijkt, en zit daarom op de wijkenpagina zelf.
  { label: "Planning", to: "/planning", icon: CalendarDays, recht: ["planning"] },
  { label: "Klanten", to: "/klanten", icon: Users, recht: ["klanten_bekijken"] },
  { label: "Aanmeldingen", to: "/aanmeldingen", icon: Inbox, recht: ["klanten_bewerken"] },
  { label: "Mailing", to: "/mailing", icon: Mail, recht: ["mail_lezen", "mail_versturen"] },
  // Geldlopers zien hier alleen iets als de eigenaar hun wijk vrijgaf.
  { label: "Betalingen", to: "/betalingen", icon: Cash, recht: ["geldlopen", "prijzen_zien"] },
  { label: "Importeren", to: "/importeren", icon: Upload, recht: ["klanten_bewerken"] },
];

const BEHEER: Pagina[] = [
  // Zonder recht: ook een medewerker moet bij zijn eigen account kunnen.
  { label: "Instellingen", to: "/instellingen", icon: Settings },
  { label: "Geschiedenis", to: "/prullenbak", icon: History, recht: ["klanten_bewerken"] },
];

/** De pagina's waar deze gebruiker bij mag, plus het aantal open
 *  aanmeldingen. Gedeeld door de zijbalk en de tabbalk op de telefoon, zodat
 *  die nooit iets anders laten zien. */
export function useMenu() {
  const { employee, company } = useAuth();
  const pad = useRouterState({ select: (s) => s.location.pathname });
  const zoek = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });

  // Wat er in het postvak op een mens wacht. Staat in de balk en niet op
  // de pagina zelf, want je moet het zien zonder ernaartoe te gaan.
  const { data: teDoen } = useQuery({
    queryKey: ["aanmeldingen-open"],
    queryFn: aantalOpenAanmeldingen,
    enabled: heeftRecht(employee, "klanten_bewerken"),
  });

  const magZien = (p: Pagina) =>
    (!p.recht || p.recht.some((r) => heeftRecht(employee, r))) &&
    (!p.rechtAlles || p.rechtAlles.every((r) => heeftRecht(employee, r)));
  const isActief = (p: Pagina) => (p.to === "/" ? pad === "/" : pad.startsWith(p.to));

  /**
   * De tabbladen van de pagina waar je bent, als sublijstje onder het
   * menu-item. Betalingen en Mail hebben ze; de rest van de app past op één
   * pagina.
   */
  const subtabs = (p: Pagina): Subtab[] => {
    if (!isActief(p)) return [];
    if (p.to === "/betalingen") {
      // Alleen voor wie bedragen mag zien: een geldloper krijgt daar toch maar
      // één lijst te zien.
      if (!heeftRecht(employee, "prijzen_zien")) return [];
      const gevraagd = String(zoek["tab"] ?? "");
      // Pof staat niet in het menu; je opent hem vanaf het overzicht, dus dat
      // blijft zolang het menu-item dat oplicht.
      const huidig = MENU_TABBLADEN.find((t) => t === gevraagd) ?? "vanavond";
      // De gekozen wijk gaat mee: wissel je van tabblad, dan kijk je nog
      // steeds naar dezelfde wijk.
      const wijk = typeof zoek["wijk"] === "string" ? (zoek["wijk"] as string) : undefined;
      return MENU_TABBLADEN.map((t) => ({
        sleutel: t,
        naar: "/betalingen" as const,
        label: TABNAAM[t],
        actief: t === huidig,
        zoek: { tab: t, ...(wijk ? { wijk } : {}) },
      }));
    }
    if (p.to === "/mailing") {
      const zichtbaar = MAIL_BLADEN.filter((b) => {
        const recht = MAIL_BLADRECHT[b];
        return recht === "eigenaar" ? employee?.rol === "eigenaar" : heeftRecht(employee, recht);
      });
      if (zichtbaar.length < 2) return [];
      const gevraagd = String(zoek["blad"] ?? "");
      const huidig = zichtbaar.find((b) => b === gevraagd) ?? zichtbaar[0]!;
      return zichtbaar.map((b) => ({
        sleutel: b,
        naar: "/mailing" as const,
        label: MAIL_BLADNAAM[b],
        actief: b === huidig,
        zoek: { blad: b },
      }));
    }
    return [];
  };

  return {
    employee,
    company,
    thuis: THUIS,
    werk: WERK.filter(magZien),
    beheer: BEHEER.filter(magZien),
    teDoen: teDoen ?? 0,
    isActief,
    subtabs,
  };
}

/** Een tabblad van de pagina waar je bent, zoals het menu het toont. */
export type Subtab = {
  sleutel: string;
  label: string;
  actief: boolean;
} & (
  | { naar: "/betalingen"; zoek: { tab: BetalingenTab; wijk?: string } }
  | { naar: "/mailing"; zoek: { blad: MailBlad } }
);

export type { Pagina };

/**
 * Het sublijstje onder een menu-item: de tabbladen van die pagina. In de
 * zijbalk klein, in de balk onderin op de telefoon met regels waar je duim
 * bij kan.
 */
export function Subtabs({
  lijst,
  groot = false,
  onKies,
}: {
  lijst: Subtab[];
  groot?: boolean;
  onKies?: () => void;
}) {
  if (lijst.length === 0) return null;
  return (
    <div className="mb-1 ml-[22px] flex flex-col gap-0.5 border-l border-border pl-2">
      {lijst.map((s) => {
        // Twee takken, want de router wil per pagina weten wat er in het
        // webadres mag staan.
        const klassen = `flex items-center rounded-[10px] transition-colors ${
          groot ? "h-12 px-3 text-[15px] fel:rounded-full" : "h-9 px-2.5 text-[12.5px]"
        } ${
          s.actief
            ? "bg-card font-semibold shadow-card fel:shadow-none"
            : "text-foreground/65 hover:bg-card/70 hover:text-foreground"
        }`;
        return s.naar === "/mailing" ? (
          <Link key={s.sleutel} to="/mailing" search={s.zoek} onClick={onKies} className={klassen}>
            {s.label}
          </Link>
        ) : (
          <Link
            key={s.sleutel}
            to="/betalingen"
            search={s.zoek}
            onClick={onKies}
            className={klassen}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Het icoon van een ingeklapte zijbalk, met de tabbladen eronder. */
function TabbladenMenu({ p, lijst }: { p: Pagina; lijst: Subtab[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={p.label}
          aria-label={p.label}
          className="flex h-10 items-center justify-center rounded-[12px] bg-card shadow-card fel:rounded-full fel:bg-primary fel:text-primary-foreground fel:shadow-none zak:border zak:border-border zak:shadow-none"
        >
          <p.icon className="size-[17px] shrink-0 text-tint-oranje-ink fel:text-primary-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-44">
        {lijst.map((s) => (
          <DropdownMenuItem key={s.sleutel} asChild>
            {s.naar === "/mailing" ? (
              <Link to="/mailing" search={s.zoek} className={s.actief ? "font-semibold" : ""}>
                {s.label}
              </Link>
            ) : (
              <Link to="/betalingen" search={s.zoek} className={s.actief ? "font-semibold" : ""}>
                {s.label}
              </Link>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Zijbalk() {
  const { employee, company, thuis, werk, beheer, teDoen, isActief, subtabs } = useMenu();
  const navigate = useNavigate();

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
    const actief = isActief(p);
    const telletje = p.to === "/aanmeldingen" ? teDoen : 0;
    return (
      <Link
        to={p.to}
        title={ingeklapt ? p.label : undefined}
        aria-label={p.label}
        // Het actieve item is een witte pil op de crème balk, niet een
        // gekleurd vlak: de kleur zit in het icoon, en het wit tilt de pagina
        // waar je bent op uit de rest. In Fel is het juist de enige plek met
        // kleur: een volle oranje pil, de rest van het menu blijft rustig.
        // Zakelijk doet hetzelfde, maar dan muntgroen op een witte balk.
        className={`relative flex h-10 items-center rounded-[12px] text-[13.5px] transition-colors fel:rounded-full zak:rounded-[10px] ${
          ingeklapt ? "justify-center px-0" : "gap-3 px-2.5 fel:px-3"
        } ${
          actief
            ? "bg-card font-semibold shadow-card fel:bg-primary fel:text-primary-foreground fel:shadow-none zak:bg-sidebar-accent zak:text-sidebar-accent-foreground zak:shadow-none"
            : "border border-transparent text-foreground/75 hover:bg-card/70 hover:text-foreground zak:hover:bg-accent"
        }`}
      >
        <p.icon
          className={`size-[17px] shrink-0 ${actief ? "text-tint-oranje-ink fel:text-primary-foreground zak:text-sidebar-accent-foreground" : "text-muted-foreground"}`}
        />
        {!ingeklapt && <span className="truncate">{p.label}</span>}
        {/* Ingeklapt is er geen ruimte voor een getal: dan alleen een stip,
            zodat je toch ziet dat er iets ligt. */}
        {telletje > 0 &&
          (ingeklapt ? (
            <span className="absolute right-2 top-2 size-2 rounded-full bg-tint-amber-ink" />
          ) : (
            <span className="ml-auto rounded-full bg-tint-amber px-1.5 text-[11px] font-semibold tabular-nums text-tint-amber-ink">
              {telletje}
            </span>
          ))}
      </Link>
    );
  }

  return (
    <aside
      className={`${breed} sticky top-0 hidden h-screen md:flex shrink-0 flex-col gap-5 border-r border-border bg-surface px-3.5 py-5 fel:dark:bg-background zak:bg-sidebar zak:border-sidebar-border transition-[width] duration-200 print:hidden`}
    >
      <div className={`flex items-center ${ingeklapt ? "flex-col gap-3" : "gap-2.5"}`}>
        <div className="flex size-[34px] shrink-0 items-center justify-center rounded-[12px] bg-card shadow-card zak:border zak:border-border zak:shadow-none">
          <Druppel className="size-[22px]" />
        </div>
        {/* Leeg tot het bedrijf geladen is: een placeholder die daarna
            verspringt leest slechter dan even niets. */}
        {!ingeklapt && (
          // Over twee regels: bedrijfsnamen zijn langer dan de 236px die de
          // balk breed is, en afkappen maakt er "Wassersapp be…" van.
          <span className="line-clamp-2 min-w-0 flex-1 font-display text-[15px] font-bold leading-tight">
            {company?.name ?? ""}
          </span>
        )}
        <button
          type="button"
          onClick={klap}
          aria-label={ingeklapt ? "Navigatie uitklappen" : "Navigatie inklappen"}
          title={ingeklapt ? "Uitklappen" : "Inklappen"}
          className={`flex size-[26px] items-center justify-center rounded-[8px] bg-card text-muted-foreground shadow-card hover:text-foreground zak:border zak:border-border zak:shadow-none ${
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

      <nav className="-mb-2 flex flex-col gap-0.5" aria-label="Start">
        <Item p={thuis} />
      </nav>

      {werk.length > 0 && (
        <nav className="flex flex-col gap-0.5">
          {!ingeklapt && (
            <span className="px-2.5 pb-2 text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground/80">
              werk
            </span>
          )}
          {werk.map((p) => {
            const subs = subtabs(p);
            // Ingeklapt is er geen ruimte voor een sublijstje. De tabbladen
            // hangen dan als menuutje aan het icoon — zonder dat kom je er op
            // een groot scherm helemaal niet meer bij.
            return ingeklapt && subs.length > 0 ? (
              <TabbladenMenu key={p.to} p={p} lijst={subs} />
            ) : (
              <Fragment key={p.to}>
                <Item p={p} />
                {!ingeklapt && <Subtabs lijst={subs} />}
              </Fragment>
            );
          })}
        </nav>
      )}

      {beheer.length > 0 && (
        <nav className="flex flex-col gap-0.5">
          {!ingeklapt && (
            <span className="px-2.5 pb-2 text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground/80">
              beheer
            </span>
          )}
          {beheer.map((p) => (
            <Item key={p.to} p={p} />
          ))}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {employee && !ingeklapt && (
          <div className="flex items-center gap-2.5 rounded-[16px] bg-card p-2.5 shadow-card zak:border zak:border-border zak:shadow-none">
            <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
              {(employee.naam || employee.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium leading-tight">
                {employee.naam || employee.email}
              </p>
              <p className="text-[11px] text-muted-foreground">{rolLabel(employee)}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void signOut().then(() => void navigate({ to: "/login" }))}
          aria-label="Uitloggen"
          title="Uitloggen"
          className={`flex h-10 items-center rounded-[12px] text-[13.5px] text-foreground/75 transition-colors hover:bg-card/70 hover:text-foreground zak:hover:bg-accent ${
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
