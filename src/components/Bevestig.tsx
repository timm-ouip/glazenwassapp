import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{vraag?.titel}</AlertDialogTitle>
            {vraag?.tekst && <AlertDialogDescription>{vraag.tekst}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => sluit(false)}>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => sluit(true)}
              className={
                vraag?.gevaarlijk
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
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
