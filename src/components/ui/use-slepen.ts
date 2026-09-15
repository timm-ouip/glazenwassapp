import * as React from "react";

/** Hier kun je niet mee slepen: je wilt erop klikken of erin typen. */
const NIET_SLEPEN = "button, a, input, textarea, select, label, [role='tab'], [contenteditable='true']";

/** Zoveel pixels moet de muis bewegen voor het een sleep is en geen klik. */
const DREMPEL = 4;

type SleepHandlers = Required<
  Pick<React.HTMLAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">
>;

/**
 * Een popup verslepen aan zijn kop (alles met `data-sleepgreep`, zoals PopupKop,
 * DialogHeader en de band van Bevestig). Zo kun je hem opzij schuiven om te zien
 * wat eronder staat. Voor Dialog en AlertDialog allebei; `reset` zet hem terug
 * in het midden.
 *
 * Eigen bestand: een bestand met onderdelen dat ook een losse functie deelt,
 * ververst tijdens het ontwikkelen niet meer vanzelf.
 */
export function useSlepen(eigen: Partial<SleepHandlers> = {}) {
  const [verschuiving, setVerschuiving] = React.useState({ x: 0, y: 0 });
  const sleep = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    plek: DOMRect;
    bezig: boolean;
  } | null>(null);

  function stop(e: React.PointerEvent<HTMLElement>) {
    const s = sleep.current;
    if (!s || s.id !== e.pointerId) return;
    sleep.current = null;
    if (s.bezig) {
      document.body.style.removeProperty("user-select");
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const handlers: SleepHandlers = {
    onPointerDown(e) {
      eigen.onPointerDown?.(e);
      if (e.defaultPrevented || e.button !== 0) return;
      const doel = e.target as HTMLElement;
      if (!doel.closest("[data-sleepgreep]") || doel.closest(NIET_SLEPEN)) return;
      // Nog niet vastpakken: een gewone klik op de kop moet een klik blijven.
      sleep.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        ...verschuiving,
        plek: e.currentTarget.getBoundingClientRect(),
        bezig: false,
      };
    },
    onPointerMove(e) {
      eigen.onPointerMove?.(e);
      const s = sleep.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (!s.bezig) {
        if (Math.hypot(dx, dy) < DREMPEL) return;
        s.bezig = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        // Tijdens het slepen geen tekst selecteren; titels blijven daarbuiten gewoon te kopiëren.
        window.getSelection()?.removeAllRanges();
        document.body.style.setProperty("user-select", "none");
      }
      // Grenzen vanaf de echte plek bij het begin: de bovenkant (de kop) blijft
      // altijd in beeld, en er blijft links of rechts een stuk te zien. Anders
      // krijg je een hoge popup niet meer terug.
      const r = s.plek;
      const minDx = 80 - r.right;
      const maxDx = window.innerWidth - 80 - r.left;
      const minDy = -r.top;
      const maxDy = window.innerHeight - 48 - r.top;
      setVerschuiving({
        x: s.x + Math.max(minDx, Math.min(maxDx, dx)),
        y: s.y + Math.max(minDy, Math.min(maxDy, dy)),
      });
    },
    onPointerUp(e) {
      eigen.onPointerUp?.(e);
      stop(e);
    },
    onPointerCancel(e) {
      eigen.onPointerCancel?.(e);
      stop(e);
    },
  };

  return {
    // Verschuiven met de marge: de transform is al van het centreren en het
    // in- en uitzoomen, en die blijven zo gewoon werken.
    stijl: { marginLeft: verschuiving.x, marginTop: verschuiving.y } as React.CSSProperties,
    handlers,
    reset: () => setVerschuiving({ x: 0, y: 0 }),
  };
}
