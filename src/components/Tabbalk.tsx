import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { IconLogout as LogOut, IconMenu2 as Menu } from "@tabler/icons-react";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Subtabs, useMenu, type Pagina } from "@/components/Zijbalk";
import { useQuery } from "@tanstack/react-query";

import { signOut } from "@/lib/auth";
import { fetchMappen } from "@/lib/mailbox";
import { heeftRecht, rolLabel } from "@/lib/rechten";

/** Wat je op de telefoon het vaakst opent, staat los in de balk. De rest zit
 *  achter "Meer" — net als in een bank- of fotoapp. Wijken staat niet los:
 *  daar kom je via Home of via Meer. */
const VAST = ["/home", "/planning", "/klanten", "/mailing", "/betalingen"];
/** Meer dan dit past niet naast "Meer". De eigenaar houdt zo zijn vier vaste
 *  tabs; een geldloper, die alleen Betalingen heeft, krijgt die als tab. */
const MAX_TABS = 4;
/** Korter op een tab dan in het menu. */
const TABNAAM: Record<string, string> = { "/mailing": "Mail" };

/**
 * De navigatie op de telefoon: een balk onderin, waar je duim al is. Op een
 * groter scherm staat de zijbalk er, dan is deze balk verborgen.
 */
export function Tabbalk({ boven }: { boven?: ReactNode }) {
  const { employee, company, thuis, werk, beheer, teDoen, isActief, subtabs } = useMenu();
  const navigate = useNavigate();
  const [meerOpen, setMeerOpen] = useState(false);
  // De tabbladen van de pagina waar je bent (Betalingen en Mail). Sta je er
  // al, dan klapt dezelfde knop ze open in plaats van niets te doen.
  const [tabsOpen, setTabsOpen] = useState(false);
  // Ongelezen mail in het postvak, als getal op de Mail-tab. Dezelfde vraag
  // als het postvak zelf stelt, dus die delen de cache.
  const mappen = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: heeftRecht(employee, "mail_lezen"),
  });
  const ongelezen = mappen.data?.find((m) => m.rol === "postvak")?.ongelezen ?? 0;

  // Hoe hoog alles onderin samen is, als --onderrand op de pagina: de inhoud
  // houdt daar onderaan ruimte voor, en de Paaltje-knop zweeft erboven.
  const stapel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stapel.current;
    if (!el) return;
    const wortel = document.documentElement;
    const meet = () => wortel.style.setProperty("--onderrand", `${el.offsetHeight}px`);
    meet();
    const ro = new ResizeObserver(meet);
    ro.observe(el);
    return () => {
      ro.disconnect();
      wortel.style.removeProperty("--onderrand");
    };
  }, []);

  const alles = [thuis, ...werk, ...beheer];
  const tabs = alles.filter((p) => VAST.includes(p.to)).slice(0, MAX_TABS);
  const meer = alles.filter((p) => !tabs.includes(p));
  const meerActief = meer.some(isActief);
  const eigenTabs = alles.flatMap(subtabs);

  const tabKlassen = (actief: boolean) =>
    `relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] ${
      actief ? "font-semibold text-foreground" : "text-muted-foreground"
    }`;

  function MeerRegel({ p }: { p: Pagina }) {
    const actief = isActief(p);
    const telletje = p.to === "/aanmeldingen" ? teDoen : 0;
    return (
      <Link
        to={p.to}
        onClick={() => setMeerOpen(false)}
        // In Fel: alleen de pagina waar je bent krijgt kleur, een oranje pil.
        className={`flex h-12 items-center gap-3 rounded-[12px] px-3 text-[15px] fel:rounded-full fel:px-4 ${
          actief
            ? "bg-card font-semibold shadow-card fel:bg-primary fel:text-primary-foreground fel:shadow-none zak:bg-sidebar-accent zak:text-sidebar-accent-foreground zak:shadow-none"
            : "text-foreground/85"
        }`}
      >
        <p.icon
          className={`size-5 shrink-0 ${actief ? "text-tint-oranje-ink fel:text-primary-foreground zak:text-sidebar-accent-foreground" : "text-muted-foreground"}`}
        />
        <span className="truncate">{p.label}</span>
        {telletje > 0 && (
          <span className="ml-auto rounded-full bg-tint-amber px-2 text-xs font-semibold tabular-nums text-tint-amber-ink">
            {telletje}
          </span>
        )}
      </Link>
    );
  }

  return (
    <>
      <div ref={stapel} className="fixed inset-x-0 bottom-0 z-30 md:hidden print:hidden">
        {/* De belangrijkste knoppen van de pagina, vlak boven de tabs: daar
            kan je duim bij als je de telefoon met één hand vasthoudt. */}
        {boven && (
          <div className="pointer-events-none flex flex-col gap-2 px-2 pb-2 [&>*]:pointer-events-auto">
            {boven}
          </div>
        )}
        <nav
          aria-label="Hoofdmenu"
          className="flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur fel:dark:bg-background/95"
        >
          {tabs.map((p) => (
            <Link
              key={p.to}
              to={p.to}
              onClick={(e) => {
                // Sta je al op deze pagina en heeft hij tabbladen, dan opent
                // dezelfde knop de lijst met die tabbladen.
                if (subtabs(p).length > 0) {
                  e.preventDefault();
                  setTabsOpen(true);
                }
              }}
              className={tabKlassen(isActief(p))}
            >
              <p.icon
                className={`size-[21px] ${isActief(p) ? "text-tint-oranje-ink zak:text-tint-groen-ink" : ""}`}
                strokeWidth={isActief(p) ? 2.2 : 1.8}
              />
              <span className="truncate">{TABNAAM[p.to] ?? p.label}</span>
              {p.to === "/mailing" && ongelezen > 0 && (
                <span className="absolute left-[calc(50%+4px)] top-1 min-w-4 rounded-full bg-tint-amber-ink px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-card">
                  {ongelezen > 99 ? "99+" : ongelezen}
                </span>
              )}
            </Link>
          ))}
          {/* Ook zonder extra pagina's blijft "Meer" staan: daar zit Uitloggen. */}
          <button
            type="button"
            onClick={() => setMeerOpen(true)}
            className={tabKlassen(meerActief)}
          >
            <Menu
              className={`size-[21px] ${meerActief ? "text-tint-oranje-ink zak:text-tint-groen-ink" : ""}`}
              strokeWidth={meerActief ? 2.2 : 1.8}
            />
            <span>Meer</span>
            {teDoen > 0 && (
              <span className="absolute right-[calc(50%-16px)] top-1.5 size-2 rounded-full bg-tint-amber-ink ring-2 ring-card" />
            )}
          </button>
        </nav>
      </div>

      <Drawer open={meerOpen} onOpenChange={setMeerOpen} shouldScaleBackground={false}>
        <DrawerContent className="rounded-t-[22px] border-border bg-surface zak:bg-card px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerTitle className="px-3 pt-3 pb-2 font-display text-lg font-bold">
            {company?.name ?? "Menu"}
          </DrawerTitle>
          <div className="flex flex-col gap-0.5">
            {meer.map((p) => (
              <Fragment key={p.to}>
                <MeerRegel p={p} />
                <Subtabs lijst={subtabs(p)} groot onKies={() => setMeerOpen(false)} />
              </Fragment>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-[14px] border border-border bg-card p-3 shadow-card">
            {employee && (
              <>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
                  {(employee.naam || employee.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">
                    {employee.naam || employee.email}
                  </p>
                  <p className="text-xs text-muted-foreground">{rolLabel(employee)}</p>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setMeerOpen(false);
                void signOut().then(() => void navigate({ to: "/login" }));
              }}
              className="ml-auto flex h-9 items-center gap-2 rounded-full border border-border px-3 text-sm"
            >
              <LogOut className="size-4" /> Uitloggen
            </button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Tik je onderin op de pagina waar je al bent, dan klappen haar
          tabbladen hier open — binnen duimbereik. */}
      <Drawer open={tabsOpen} onOpenChange={setTabsOpen} shouldScaleBackground={false}>
        <DrawerContent className="rounded-t-[22px] border-border bg-surface px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerTitle className="px-3 pb-2 pt-3 font-display text-lg font-bold">
            {alles.find(isActief)?.label ?? "Tabbladen"}
          </DrawerTitle>
          <Subtabs lijst={eigenTabs} groot onKies={() => setTabsOpen(false)} />
        </DrawerContent>
      </Drawer>
    </>
  );
}
