import { useRef, type MouseEvent, type PointerEvent } from "react";

const WACHT = 400;
const SPEELRUIMTE = 10;

/**
 * Lang indrukken met een vinger, zoals je op je telefoon foto's gaat
 * selecteren. Beweeg je meer dan een paar pixels, dan ben je aan het scrollen
 * en gebeurt er niets. Met de muis doet dit niets: daar is de rechtermuisknop.
 *
 * Geeft handlers terug om op het element te zetten. `onContextMenu` houdt het
 * menu van de telefoon (en dat van Radix) tegen zodra het lang indrukken
 * gelukt is, anders gaat er meteen ook nog een menu open.
 */
export function useLangIndrukken(onLang: (() => void) | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const gelukt = useRef(false);

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }

  // Altijd mee, ook als lang indrukken nu niet kan: het lang indrukken zet
  // meestal zelf de selecteermodus aan. Het menu van de telefoon komt dan
  // nog een tel later binnen en moet toch tegen.
  const houdMenuTegen = {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if (gelukt.current) {
        e.preventDefault();
        gelukt.current = false;
      }
    },
  };

  if (!onLang) {
    // Loopt de klok nog terwijl lang indrukken ineens niet meer kan — een
    // veeg met twee vingers zette net de selecteermodus aan — dan hem stil
    // zetten; de handlers die hem anders stoppen zijn er nu niet meer.
    if (timer.current) stop();
    return houdMenuTegen;
  }

  return {
    ...houdMenuTegen,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return;
      // In de selecteermodus is een tik al aanvinken, en opent lang
      // indrukken gewoon het menu. De pagina zet dat op de lijst.
      if (e.currentTarget.closest("[data-selecteren]")) return;
      // Op het sleepgreepje ben je een regel aan het verplaatsen.
      if ((e.target as HTMLElement).closest("[data-sleepgreep]")) return;
      gelukt.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const doel = e.currentTarget;
      timer.current = setTimeout(() => {
        timer.current = null;
        // Zette een veeg met twee vingers intussen de selecteermodus aan,
        // dan is dit geen lang indrukken meer.
        if (doel.closest("[data-selecteren]")) return;
        gelukt.current = true;
        // Komt er geen menu van de telefoon (iPhone), dan mag de vlag niet
        // blijven staan: dan slikt hij het eerstvolgende echte menu in.
        setTimeout(() => {
          gelukt.current = false;
        }, 1000);
        // Het menu onder de rechtermuisknop start bij aanraken zijn eigen,
        // langere klok. Een pointercancel zet die stil.
        doel.dispatchEvent(
          new window.PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }),
        );
        try {
          navigator.vibrate?.(15);
        } catch {
          // Niet elke telefoon kan trillen; dat is geen probleem.
        }
        onLang();
      }, WACHT);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SPEELRUIMTE) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
