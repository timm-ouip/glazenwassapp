import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * De vaste indeling van elk schermpje in deze app.
 *
 * Eén vorm voor alle popups: een gekleurde kopstrook met een icoontje, de
 * titel groot en eronder waar het over gaat; daaronder de velden in afgeronde
 * vakjes met een icoontje ervoor, en onderaan een voet waar de knoppen altijd
 * op dezelfde plek staan. Wat bij elkaar hoort staat naast elkaar.
 *
 * Vandaar deze bouwstenen en niet twaalf keer hetzelfde met de hand: als de
 * maten op één plek staan, kan één schermpje er niet stiekem anders uitzien
 * dan de rest.
 */

/** De buitenkant. Vervangt DialogContent: geen eigen vulling en geen rand,
 *  want de kop en de voet lopen tot aan de zijkant door. */
export function PopupKader({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.ComponentPropsWithoutRef<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "max-h-[90vh] gap-0 overflow-hidden border-0 bg-card p-0 shadow-[0_2px_6px_oklch(0.4_0.02_70/6%),0_24px_60px_oklch(0.35_0.02_70/14%)] sm:max-w-md sm:rounded-[22px]",
        className,
      )}
      {...rest}
    >
      {children}
    </DialogContent>
  );
}

/**
 * De kopstrook: icoontje, titel, en eronder waar het over gaat.
 *
 * Rechts blijft ruimte vrij voor het kruisje dat de dialoog zelf tekent —
 * zonder die ruimte loopt een lange titel eronderdoor.
 */
export function PopupKop({
  icoon,
  titel,
  subtitel,
  tabs,
  tegelKleur = "bg-brand text-brand-foreground",
}: {
  icoon: ReactNode;
  titel: ReactNode;
  /** Waar het over gaat: de wijk, de datum, de straat. */
  subtitel?: ReactNode;
  /** Optionele tabbladen, die op de onderrand van de kop staan. */
  tabs?: ReactNode;
  /** De kleur van het tegeltje. Dezelfde tint als waar het schermpje over
   *  gaat — straten zijn amber, net als de tegel op de wijkenpagina. */
  tegelKleur?: string;
}) {
  return (
    <div className="bg-surface px-6 pt-5">
      <DialogHeader className="space-y-0 text-left">
        <div className="flex items-start gap-3.5 pr-8">
          <span
            className={cn(
              "flex size-[46px] shrink-0 items-center justify-center rounded-[14px] shadow-card",
              tegelKleur,
            )}
          >
            {icoon}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate font-display text-[22px] font-semibold leading-tight tracking-[-0.02em]">
              {titel}
            </DialogTitle>
            {subtitel && (
              <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitel}</div>
            )}
          </div>
        </div>
      </DialogHeader>
      {tabs && <div className="mt-[18px] flex gap-1">{tabs}</div>}
    </div>
  );
}

/** Eén tabblad op de rand van de kop. Het actieve blad is wit en loopt door
 *  in de inhoud eronder, zodat je ziet dat het bij elkaar hoort. */
export function PopupTab({
  actief,
  onClick,
  icoon,
  telletje,
  children,
}: {
  actief: boolean;
  onClick: () => void;
  icoon?: ReactNode;
  /** Een getal achter de naam, bijvoorbeeld hoeveel er openstaat. */
  telletje?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={actief}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-t-[11px] border border-b-0 border-transparent px-3 py-2 text-[13px] font-medium transition-colors",
        actief
          ? "border-border/70 bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icoon}
      {children}
      {telletje !== undefined && telletje > 0 && (
        <span className="rounded-full bg-tint-geel px-1.5 py-px text-[11px] font-semibold text-tint-geel-ink">
          {telletje}
        </span>
      )}
    </button>
  );
}

/** De inhoud onder de kop. Scrollt als er meer in staat dan er past. */
export function PopupBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-[18px] overflow-y-auto px-6 pb-6 pt-[22px]", className)}>
      {children}
    </div>
  );
}

/** Een groepje bij elkaar horende velden, met zijn opschrift erboven en
 *  rechts eventueel een getal dat het samenvat. */
export function PopupBlok({
  label,
  terzijde,
  info,
  children,
}: {
  label?: ReactNode;
  terzijde?: ReactNode;
  /** Uitleg die je alleen ziet als je hem zoekt: een puntje achter het
   *  opschrift. Lange lappen tekst onder elk veld maken een schermpje druk. */
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {(label || terzijde || info) && (
        <div className="flex items-center justify-between gap-3">
          {label && (
            <span className="flex items-center gap-1 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {label}
              {info && <PopupInfo>{info}</PopupInfo>}
            </span>
          )}
          {terzijde && (
            <span className="text-[12.5px] tabular-nums text-muted-foreground">{terzijde}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** Twee velden naast elkaar. "smal" maakt het tweede vakje kort, voor een
 *  huisnummer naast een straat. */
export function PopupPaar({ smal, children }: { smal?: boolean; children: ReactNode }) {
  return (
    <div className={cn("grid gap-2.5", smal ? "grid-cols-[1fr_96px]" : "grid-cols-2")}>
      {children}
    </div>
  );
}

/** Een veld: een afgerond vakje met het icoontje ervoor. Wat erin staat mag
 *  een invulveld zijn, een keuzelijst of gewoon tekst. */
export function PopupVeld({
  icoon,
  achter,
  className,
  children,
}: {
  icoon?: ReactNode;
  /** Rechts in het vakje, bijvoorbeeld "per beurt". */
  achter?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[44px] items-center gap-2.5 rounded-xl border border-input bg-background/70 px-3 text-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
        className,
      )}
    >
      {icoon && <span className="shrink-0 text-muted-foreground">{icoon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {achter && <span className="shrink-0 text-[13px] text-muted-foreground">{achter}</span>}
    </div>
  );
}

/** De klassen voor een invulveld binnen een PopupVeld: het vakje eromheen
 *  tekent de rand al, dus het veld zelf is onzichtbaar. */
export const popupInvoer =
  "h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/**
 * Een informatiepuntje: houd je muis erboven en de uitleg verschijnt.
 *
 * Zo hoeft niet elke uitleg onder een veld te staan. Je leest een schermpje
 * één keer; daarna wil je alleen de vakjes zien.
 */
export function PopupInfo({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Uitleg"
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-[12px] leading-relaxed normal-case tracking-normal">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Uitleg onder een veld. Klein en stil: het is een bijzin, geen opschrift. */
export function PopupHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Een dunne scheiding tussen twee onderwerpen binnen hetzelfde schermpje. */
export function PopupScheiding() {
  return <div className="h-px bg-border/70" />;
}

/** De voet: annuleren en opslaan rechts, en wat links staat (weggooien,
 *  terugzetten) blijft links. Op elk schermpje dezelfde plek. */
export function PopupVoet({ links, children }: { links?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-border/70 bg-card px-6 py-3.5">
      {links && <div className="mr-auto flex items-center gap-2">{links}</div>}
      <div className={cn("flex items-center gap-2", links ? "" : "ml-auto")}>{children}</div>
    </div>
  );
}
