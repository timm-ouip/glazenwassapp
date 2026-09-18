import { useEffect, useRef, useState } from "react";
import {
  IconArrowsExchange as Verplaats,
  IconCheck as Check,
  IconChevronDown as ChevronDown,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/** Wat er met een adres gebeurt dat kort ervoor of erna al op een dag staat. */
export type DubbelKeuze = "verplaatsen" | "allebei" | "niet";

export interface DubbelRij {
  id: string;
  /** "Wadden 7" */
  label: string;
  /** De dag waar hij al op staat. */
  oudeDatum: string;
  /** Die dag is al geweest: dan is hij gewassen, en verplaats je hem niet. */
  gewassen: boolean;
}

export interface DubbelVraag {
  rijen: DubbelRij[];
  /** De dag waarop je nu opslaat. */
  datum: string;
}

const KEUZES: { waarde: DubbelKeuze; label: string }[] = [
  { waarde: "verplaatsen", label: "Verplaatsen" },
  { waarde: "allebei", label: "Allebei" },
  { waarde: "niet", label: "Niet" },
];

/** "ma 21" */
function kort(datum: string) {
  return new Date(`${datum}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
  });
}

/** Wat er gaat gebeuren, in woorden onder het adres. */
function uitleg(rij: DubbelRij, keuze: DubbelKeuze, datum: string) {
  const oud = kort(rij.oudeDatum);
  if (keuze === "verplaatsen") return `${oud} → ${kort(datum)}`;
  if (keuze === "allebei") return `op ${oud} én ${kort(datum)}`;
  return rij.gewassen
    ? `gewassen op ${oud} · niet op ${kort(datum)}`
    : `blijft op ${oud} · niet op ${kort(datum)}`;
}

/**
 * De vraag als adressen die je opslaat binnen twee weken al op een andere dag
 * staan. Per adres kies je: verplaatsen (van de oude dag naar deze), allebei,
 * of niet op deze dag. Bovenaan één keuze voor allemaal.
 *
 * Op de computer drie knopjes per adres; op de telefoon een klein menu, want
 * daar passen ze niet naast het adres.
 */
export function DubbelDialoog({
  vraag,
  onKlaar,
}: {
  vraag: DubbelVraag | null;
  /** De keuzes, of null bij annuleren: dan wordt er niets opgeslagen. */
  onKlaar: (keuzes: Map<string, DubbelKeuze> | null) => void;
}) {
  const mobiel = useIsMobile();
  const [keuzes, setKeuzes] = useState<Map<string, DubbelKeuze>>(new Map());
  // De laatste vraag blijft staan terwijl het venster dichtgaat: zo sluit hij
  // netjes, en ziet een Esc die hem sloot nog een open venster (en stopt dan
  // niet ook nog het selecteren).
  const laatste = useRef<DubbelVraag | null>(null);
  if (vraag) laatste.current = vraag;
  const open = vraag !== null;

  // Een gewassen beurt verplaats je niet; wat nog moet komen wel.
  const standaard = (r: DubbelRij): DubbelKeuze => (r.gewassen ? "niet" : "verplaatsen");
  useEffect(() => {
    if (!vraag) return;
    setKeuzes(new Map(vraag.rijen.map((r) => [r.id, standaard(r)])));
  }, [vraag]);

  const getoond = vraag ?? laatste.current;
  if (!getoond) return null;
  const n = getoond.rijen.length;
  const zet = (id: string, k: DubbelKeuze) => setKeuzes((oud) => new Map(oud).set(id, k));
  const alles = (k: DubbelKeuze) => setKeuzes(new Map(getoond.rijen.map((r) => [r.id, k])));
  // Altijd een keuze per adres, ook vóór het effect hierboven gedraaid heeft.
  const gekozen = new Map(getoond.rijen.map((r) => [r.id, keuzes.get(r.id) ?? standaard(r)]));
  const iedereen = [...gekozen.values()];
  const allemaal =
    iedereen.length > 0 && iedereen.every((k) => k === iedereen[0]) ? iedereen[0] : null;

  const segment = (actief: DubbelKeuze | null | undefined, kies: (k: DubbelKeuze) => void) => (
    // Dezelfde vorm als het maandfilter: één pil, het gekozen knopje gevuld.
    <div className="inline-flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px] text-[12px]">
      {KEUZES.map((k) => (
        <button
          key={k.waarde}
          type="button"
          onClick={() => kies(k.waarde)}
          aria-pressed={actief === k.waarde}
          className={cn(
            "rounded-full px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            actief === k.waarde
              ? "bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {k.label}
        </button>
      ))}
    </div>
  );

  const menu = (actief: DubbelKeuze | undefined, kies: (k: DubbelKeuze) => void) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="shrink-0 rounded-full">
          {KEUZES.find((k) => k.waarde === actief)?.label ?? "Kies"}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {KEUZES.map((k) => (
          <DropdownMenuItem key={k.waarde} onSelect={() => kies(k.waarde)}>
            {k.label}
            {actief === k.waarde && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && open && onKlaar(null)}>
      <PopupKader
        className="sm:max-w-lg"
        aria-describedby="dubbel-uitleg"
        // Niet meteen op het eerste knopje springen: dan krijgt "Verplaatsen"
        // een rand en lijkt het een losse knop.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <PopupKop
          kleur="geel"
          icoon={<Verplaats className="size-[22px]" />}
          titel={`${n} ${n === 1 ? "adres staat" : "adressen staan"} al kort ervoor of erna`}
          subtitel={`Je slaat op op ${kort(getoond.datum)}. Kies per adres wat er gebeurt.`}
        />
        <DialogDescription id="dubbel-uitleg" className="sr-only">
          Verplaatsen haalt het adres van de oude dag; allebei laat het op beide staan; niet zet het
          niet op deze dag.
        </DialogDescription>
        <PopupBody className="max-h-[60vh] gap-2">
          {n > 1 && (
            <div className="flex items-center gap-2 pb-1">
              <span className="flex-1 text-[12.5px] text-muted-foreground">Voor allemaal:</span>
              {mobiel ? menu(allemaal ?? undefined, alles) : segment(allemaal, alles)}
            </div>
          )}
          {getoond.rijen.map((r) => {
            const k = gekozen.get(r.id)!;
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-[12px] border border-border/70 px-3 py-2"
              >
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13.5px] font-medium">{r.label}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {uitleg(r, k, getoond.datum)}
                  </p>
                </div>
                {mobiel ? menu(k, (w) => zet(r.id, w)) : segment(k, (w) => zet(r.id, w))}
              </div>
            );
          })}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => open && onKlaar(null)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={() => open && onKlaar(gekozen)}>
            Opslaan op {kort(getoond.datum)}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
