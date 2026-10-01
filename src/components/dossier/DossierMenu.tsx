/**
 * Het menu van het klantdossier. Op de computer staat het links (250px): het
 * adres, wie er woont en in welke wijk, wat er open staat, de vijf
 * onderdelen en onderaan apart "Klant stopt…". Op de telefoon is het menu
 * het eerste scherm, met de knoppen om te bellen of te betalen en de
 * notities erbij; een tik opent een onderdeel op volle breedte.
 */
import { IconChevronRight as ChevronRight } from "@tabler/icons-react";

import { ContactKnoppen, SluitKnop } from "@/components/dossier/DossierKop";
import { formatPrice } from "@/lib/klanten";
import { TAB_NAMEN, type Dossier, type DossierTab } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

interface Item {
  tab: DossierTab;
  /** Rechts in de regel: "1 nieuw", "€ 25 open", "contant". */
  info?: string | undefined;
  /** Als pil (zoals "1 nieuw") in plaats van grijze tekst. */
  pil?: boolean;
  /** Zichtbaar maar uitgegrijsd: er is nog geen adres of klant voor. */
  uit?: boolean;
  uitReden?: string;
}

/** Wat er in het menu staat, met wie wat mag zien. */
function menuItems(d: Dossier): Item[] {
  const open = d.geld?.open ?? 0;
  const items: Item[] = [{ tab: "overzicht" }];
  if (d.magMailLezen || d.magKlachten) {
    items.push({
      tab: "berichten",
      info: d.nieuwTeller > 0 ? `${d.nieuwTeller} nieuw` : undefined,
      pil: true,
      uit: !d.klantId,
      uitReden: d.zonderAdres
        ? "Kan pas als het adres er is"
        : "Er hoort nog geen klant bij dit adres",
    });
  }
  if (d.prijzenZien) {
    items.push({
      tab: "geld",
      info:
        open > 0.005
          ? `${formatPrice(open)} open`
          : open < -0.005
            ? `${formatPrice(-open)} tegoed`
            : undefined,
      uit: d.zonderAdres,
      uitReden: "Kan pas als het adres er is",
    });
  }
  items.push({ tab: "facturen", info: d.methode });
  items.push({ tab: "geschiedenis", uit: d.zonderAdres, uitReden: "Kan pas als het adres er is" });
  return items;
}

/** Onder het adres: wie er woont en in welke wijk. */
function onderregel(d: Dossier): string {
  return [d.velden.naam.trim() || d.velden.bedrijfsnaam.trim(), d.wijk?.name ?? ""]
    .filter(Boolean)
    .join(" · ");
}

/** De gele pil "€ 25 open" onder het adres. */
function OpenPil({ d }: { d: Dossier }) {
  const open = d.geld?.open ?? 0;
  if (!d.prijzenZien || Math.abs(open) <= 0.005) return null;
  return (
    <div className="mt-2.5 inline-block rounded-full bg-tint-geel px-2.5 py-1 text-[12px] font-semibold">
      {open > 0 ? `${formatPrice(open)} open` : `${formatPrice(-open)} tegoed`}
    </div>
  );
}

function StopKnop({ d, className }: { d: Dossier; className?: string }) {
  if (!d.magBewerken) return null;
  const kan = Boolean(d.adres) && !d.adres?.inactief_op;
  return (
    <button
      type="button"
      disabled={!kan}
      title={
        !d.adres
          ? "Kan pas als het adres er is"
          : d.adres.inactief_op
            ? "Staat al op inactief"
            : undefined
      }
      onClick={() => d.setDialoog("stop")}
      className={cn(
        "h-10 rounded-[12px] border border-border bg-card text-[14px] text-tint-rood-mid transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      Klant stopt…
    </button>
  );
}

/** Het menu links op de computer. */
export function DossierMenu({ d }: { d: Dossier }) {
  return (
    <nav
      aria-label="Onderdelen van het dossier"
      className="flex w-[250px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card px-[14px] py-[22px]"
    >
      <div className="px-2.5 pb-4">
        <div className="font-display text-[22px] font-semibold leading-tight">{d.titel}</div>
        <div className="text-[13px] text-muted-foreground">{onderregel(d)}</div>
        <OpenPil d={d} />
      </div>
      {menuItems(d).map((item) => {
        const actief = d.tab === item.tab;
        return (
          <button
            key={item.tab}
            type="button"
            aria-current={actief ? "page" : undefined}
            disabled={item.uit}
            title={item.uit ? item.uitReden : undefined}
            onClick={() => d.naarTab(item.tab)}
            className={cn(
              "flex h-11 shrink-0 items-center justify-between gap-2 rounded-[12px] px-[14px] text-left text-[15px] transition-colors disabled:pointer-events-none disabled:opacity-45",
              actief
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-foreground hover:bg-accent",
            )}
          >
            <span className="truncate">{TAB_NAMEN[item.tab]}</span>
            {item.info &&
              (item.pil ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-normal",
                    actief ? "bg-card text-foreground" : "bg-tint-blauw",
                  )}
                >
                  {item.info}
                </span>
              ) : (
                <span
                  className={cn(
                    "shrink-0 text-[12px] font-normal",
                    !actief && "text-muted-foreground",
                  )}
                >
                  {item.info}
                </span>
              ))}
          </button>
        );
      })}
      <div className="grow" />
      <StopKnop d={d} />
    </nav>
  );
}

/** Op de telefoon: het menu als eerste scherm. */
export function DossierMenuTelefoon({ d }: { d: Dossier }) {
  const notitie = [d.velden.notitie.trim(), d.pand.note.trim()].filter(Boolean).join(" · ");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-sleepgreep="" className="flex shrink-0 items-start gap-2 px-4 pb-3 pt-6">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[22px] font-semibold leading-tight">
            {d.titel}
          </div>
          <div className="truncate text-[13px] text-muted-foreground">{onderregel(d)}</div>
          <OpenPil d={d} />
        </div>
        <SluitKnop d={d} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4">
        {d.adres && (
          <div className="flex gap-2">
            <ContactKnoppen d={d} telefoonMenu />
          </div>
        )}
        {notitie && <p className="rounded-[12px] bg-tint-geel px-3 py-2 text-[13px]">{notitie}</p>}
        <div className="divide-y divide-border overflow-hidden rounded-[18px] bg-card">
          {menuItems(d).map((item) => (
            <button
              key={item.tab}
              type="button"
              disabled={item.uit}
              onClick={() => d.naarTab(item.tab)}
              className="flex h-14 w-full items-center gap-2 px-4 text-left text-[15px] active:bg-muted disabled:opacity-45"
            >
              <span className="flex-1 truncate">{TAB_NAMEN[item.tab]}</span>
              {item.info &&
                (item.pil ? (
                  <span className="rounded-full bg-tint-blauw px-2 py-0.5 text-[12px]">
                    {item.info}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">{item.info}</span>
                ))}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="grow" />
        <StopKnop d={d} className="w-full" />
      </div>
    </div>
  );
}
