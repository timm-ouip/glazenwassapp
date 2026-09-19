import { useSyncExternalStore } from "react";
import { toast } from "sonner";

export interface UndoActie {
  label: string;
  undo: () => Promise<void>;
}

const stack: UndoActie[] = [];
const listeners = new Set<() => void>();

function meld() {
  listeners.forEach((l) => l());
}

export function pushUndo(actie: UndoActie) {
  stack.push(actie);
  if (stack.length > 50) stack.shift();
  meld();
}

export function laatsteUndo(): UndoActie | null {
  return stack[stack.length - 1] ?? null;
}

/**
 * Draai precies deze actie terug. Is hij al teruggedraaid (bijvoorbeeld met
 * Ctrl+Z), dan gebeurt er niets: anders zou een oude melding een ándere,
 * latere actie terugdraaien. Mislukt het, dan blijft hij op de lijst staan,
 * zodat je het nog eens kunt proberen, en gaat de fout door naar de aanroeper.
 */
export async function undoActie(actie: UndoActie | null): Promise<string | null> {
  if (!actie) return null;
  const plek = stack.lastIndexOf(actie);
  if (plek === -1) return null;
  stack.splice(plek, 1);
  meld();
  try {
    await actie.undo();
  } catch (e) {
    // Eén keer terugleggen (bijvoorbeeld even geen bereik). Mislukt hij
    // daarna weer, dan blijft hij weg: anders pakte elke Ctrl+Z steeds
    // dezelfde kapotte stap en kwam je nooit meer bij de oudere.
    if (!eerderMislukt.has(actie)) {
      eerderMislukt.add(actie);
      stack.splice(Math.min(plek, stack.length), 0, actie);
      meld();
    }
    throw e;
  }
  return actie.label;
}

const eerderMislukt = new WeakSet<UndoActie>();

/** Alles vergeten, bij uitloggen of een andere gebruiker: de stappen van de
 *  vorige persoon horen niet terug te draaien door de volgende. */
export function wisUndo() {
  stack.length = 0;
  meld();
}

export function undoLaatste(): Promise<string | null> {
  return undoActie(laatsteUndo());
}

/** Terugdraaien met een melding van wat er gebeurde, ook als het mislukt. */
export async function undoMetMelding(actie: UndoActie | null, legeMelding?: string) {
  try {
    const label = await undoActie(actie);
    if (label) toast.success("Teruggedraaid: " + label);
    else if (legeMelding) toast(legeMelding);
  } catch (e) {
    toast.error("Terugdraaien mislukt: " + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * De knop "Ongedaan maken" voor in een melding. Roep hem aan direct na
 * `pushUndo`: hij onthoudt die actie en draait alleen díe terug, ook als je
 * intussen iets anders deed.
 */
export function undoKnop() {
  const actie = laatsteUndo();
  return { label: "Ongedaan maken", onClick: () => void undoMetMelding(actie) };
}

export function useUndoStack() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => stack.length,
    () => 0,
  );
}

export function useLaatsteUndoLabel() {
  useUndoStack();
  return laatsteUndo()?.label ?? null;
}
