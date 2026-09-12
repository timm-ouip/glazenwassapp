import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Vraag = {
  titel: string;
  tekst?: string;
  bevestigLabel?: string;
  /** Rode knop voor onomkeerbare acties zoals verwijderen. */
  gevaarlijk?: boolean;
};

type BevestigFn = (vraag: Vraag) => Promise<boolean>;

const Ctx = createContext<BevestigFn | null>(null);

/**
 * Vervangt window.confirm(). Die wordt in sommige omgevingen (ingeklemde
 * previews, of een browser waarin de gebruiker "geen dialogen meer" heeft
 * aangevinkt) stilzwijgend geblokkeerd: confirm() geeft dan false terug
 * zonder iets te tonen, waardoor knoppen dood lijken.
 *
 * Dezelfde vorm als de andere schermpjes (zie Popup.tsx): een kopstrook met
 * een icoontje en de vraag, en onderaan de knoppen. Bij iets onomkeerbaars is
 * het icoontje rood — dat is het enige verschil, en het valt meteen op.
 */
export function BevestigProvider({ children }: { children: ReactNode }) {
  const [vraag, setVraag] = useState<Vraag | null>(null);
  const antwoord = useRef<((ja: boolean) => void) | null>(null);

  const bevestig = useCallback<BevestigFn>((v) => {
    setVraag(v);
    return new Promise<boolean>((resolve) => {
      antwoord.current = resolve;
    });
  }, []);

  function sluit(ja: boolean) {
    antwoord.current?.(ja);
    antwoord.current = null;
    setVraag(null);
  }

  const gevaarlijk = vraag?.gevaarlijk ?? false;

  return (
    <Ctx.Provider value={bevestig}>
      {children}
      <AlertDialog
        open={vraag !== null}
        onOpenChange={(open) => {
          // Escape of klik buiten het venster telt als annuleren.
          if (!open) sluit(false);
        }}
      >
        <AlertDialogContent className="gap-0 overflow-hidden border-0 bg-card p-0 shadow-[0_2px_6px_oklch(0.4_0.02_70/6%),0_24px_60px_oklch(0.35_0.02_70/14%)] sm:max-w-sm sm:rounded-[22px]">
          <div className="bg-surface px-6 py-5">
            <AlertDialogHeader className="space-y-0 text-left">
              <div className="flex items-start gap-3.5">
                <span
                  className={`flex size-[46px] shrink-0 items-center justify-center rounded-[14px] shadow-card ${
                    gevaarlijk
                      ? "bg-tint-rood text-tint-rood-ink"
                      : "bg-brand text-brand-foreground"
                  }`}
                >
                  {gevaarlijk ? (
                    <AlertTriangle className="size-[22px]" />
                  ) : (
                    <HelpCircle className="size-[22px]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <AlertDialogTitle className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em]">
                    {vraag?.titel}
                  </AlertDialogTitle>
                  {vraag?.tekst && (
                    <AlertDialogDescription className="mt-1 text-[13px] leading-relaxed">
                      {vraag.tekst}
                    </AlertDialogDescription>
                  )}
                </div>
              </div>
            </AlertDialogHeader>
          </div>
          <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-border/70 bg-card px-6 py-3.5 sm:space-x-0">
            <AlertDialogCancel className="mt-0 rounded-full" onClick={() => sluit(false)}>
              Annuleren
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sluit(true)}
              className={`rounded-full ${
                gevaarlijk ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""
              }`}
            >
              {vraag?.bevestigLabel ?? "Verwijderen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

export function useBevestig(): BevestigFn {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useBevestig moet binnen <BevestigProvider> gebruikt worden");
  return fn;
}
