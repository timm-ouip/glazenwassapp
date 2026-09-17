/**
 * De zwevende knop rechtsonder waarmee je Paaltje opent: de Haagse paal die
 * wiebelt en af en toe anders kijkt. Het gele bolletje
 * laat zien hoeveel voorstellen op jouw goedkeuring wachten, ook als het
 * paneel dicht is.
 */
import { useState } from "react";
import { PaaltjeLui } from "@/components/paaltje/PaaltjeLui";
import { useTeKeurenAantal } from "@/lib/paaltje-chat";
import { PaaltjePaneel } from "@/components/paaltje/PaaltjePaneel";
import { cn } from "@/lib/utils";

export function PaaltjeKnop() {
  const [open, setOpen] = useState(false);
  const teKeurenAantal = useTeKeurenAantal();
  const aantal = teKeurenAantal.data ?? 0;

  return (
    <>
      <button
        type="button"
        aria-label={
          open ? "Paaltje sluiten" : `Paaltje openen${aantal > 0 ? `, ${aantal} te keuren` : ""}`
        }
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // Op de telefoon boven alles wat onderin staat (tabs, zoekbalk,
          // selectiebalk): --onderrand is hoe hoog dat samen is.
          "fixed bottom-[calc(var(--onderrand,0px)+0.75rem)] right-[calc(1rem+env(safe-area-inset-right))] z-40 md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))] md:right-[calc(1.25rem+env(safe-area-inset-right))]",
          "flex size-14 items-center justify-center rounded-full shadow-[0_4px_14px_oklch(0.4_0.02_70/25%)] transition-transform hover:scale-105 active:scale-95 print:hidden",
          open && "hidden",
        )}
      >
        <PaaltjeLui beweegt className="size-14 overflow-hidden rounded-full" />
        {aantal > 0 && (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-tint-geel text-[11px] font-semibold text-tint-geel-ink ring-2 ring-background">
            {aantal > 9 ? "9+" : aantal}
          </span>
        )}
      </button>
      <PaaltjePaneel open={open} onClose={() => setOpen(false)} teKeurenAantal={aantal} />
    </>
  );
}
