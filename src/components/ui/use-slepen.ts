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
 * Na het indrukken luisteren we naar het hele venster, niet naar de popup: bij
 * een snelle beweging staat de muis al buiten de popup (boven het donkere vlak)
 * voor hij ook maar één stap gesleept is, en dan kwam de beweging nooit aan.
 *
 * Eigen bestand: een bestand met onderdelen dat ook een losse functie deelt,
 * ververst tijdens het ontwikkelen niet meer vanzelf.
 */
export function useSlepen(eigen: Partial<SleepHandlers> = {}) {
  const [verschuiving, setVerschuiving] = React.useState({ x: 0, y: 0 });
  /** Haalt de luisteraars van een lopende sleep weg. */
  const opruimen = React.useRef<(() => void) | null>(null);

  // Verdwijnt de popup midden in een sleep, dan geen luisteraars laten slingeren.
  React.useEffect(() => () => opruimen.current?.(), []);

  const handlers: SleepHandlers = {
    onPointerDown(e) {
      eigen.onPointerDown?.(e);
      if (e.defaultPrevented || e.button !== 0) return;
      const doel = e.target as HTMLElement;
      if (!doel.closest("[data-sleepgreep]") || doel.closest(NIET_SLEPEN)) return;

      opruimen.current?.();
      const id = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      const basis = verschuiving;
      const plek = e.currentTarget.getBoundingClientRect();
      // Nog niet slepen: een gewone klik op de kop moet een klik blijven.
      let bezig = false;

      const beweeg = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!bezig) {
          if (Math.hypot(dx, dy) < DREMPEL) return;
          bezig = true;
          // Tijdens het slepen geen tekst selecteren; titels blijven daarbuiten gewoon te kopiëren.
          window.getSelection()?.removeAllRanges();
          document.body.style.setProperty("user-select", "none");
        }
        ev.preventDefault();
        // Grenzen vanaf de echte plek bij het begin: de bovenkant (de kop) blijft
        // altijd in beeld, en er blijft links of rechts een stuk te zien. Anders
        // krijg je een hoge popup niet meer terug.
        const minDx = 80 - plek.right;
        const maxDx = window.innerWidth - 80 - plek.left;
        const minDy = -plek.top;
        const maxDy = window.innerHeight - 48 - plek.top;
        setVerschuiving({
          x: basis.x + Math.max(minDx, Math.min(maxDx, dx)),
          y: basis.y + Math.max(minDy, Math.min(maxDy, dy)),
        });
      };
      const los = (ev: PointerEvent) => {
        if (ev.pointerId === id) stop();
      };
      const stop = () => {
        window.removeEventListener("pointermove", beweeg);
        window.removeEventListener("pointerup", los);
        window.removeEventListener("pointercancel", los);
        if (bezig) document.body.style.removeProperty("user-select");
        opruimen.current = null;
      };

      window.addEventListener("pointermove", beweeg);
      window.addEventListener("pointerup", los);
      window.addEventListener("pointercancel", los);
      opruimen.current = stop;
    },
    // De rest geven we alleen door: het slepen zelf luistert naar het venster.
    onPointerMove(e) {
      eigen.onPointerMove?.(e);
    },
    onPointerUp(e) {
      eigen.onPointerUp?.(e);
    },
    onPointerCancel(e) {
      eigen.onPointerCancel?.(e);
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
