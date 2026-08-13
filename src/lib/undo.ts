import { useSyncExternalStore } from "react";

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

export async function undoLaatste(): Promise<string | null> {
  const actie = stack.pop();
  meld();
  if (!actie) return null;
  await actie.undo();
  return actie.label;
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
