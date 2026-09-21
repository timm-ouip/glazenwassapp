import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Slepen om te selecteren, zoals op de wijkenpagina.
 *
 * Eén streek gaat helemaal dezelfde kant op: het eerste vakje dat je aanraakt
 * bepaalt of je kiest of juist wist. Zou elk vakje omschakelen, dan vink je bij
 * het terugslepen je eigen werk weer uit.
 *
 * Wat je kunt aanwijzen zet je zelf klaar met drie attributen:
 * `data-kies` met de id's die erbij horen (met komma's ertussen),
 * `data-kies-sleutel` zodat dezelfde kaart niet twee keer meetelt, en
 * `data-kies-dag` met de dag waar dat werk op staat — een adres kan deze maand
 * op meer dan één dag staan, en dan moet je weten wélke je aanwees.
 */
export interface Verfselectie {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

export function useVerfSelectie({
  actief,
  isGekozen,
  onKies,
}: {
  actief: boolean;
  isGekozen: (id: string) => boolean;
  onKies: (ids: string[], aan: boolean, dag: string) => void;
}): Verfselectie {
  const verf = useRef<{ aan: boolean; laatste: string; vorig: { x: number; y: number } } | null>(
    null,
  );

  function pasToe(el: Element | null | undefined) {
    const v = verf.current;
    const doel = el?.closest<HTMLElement>("[data-kies]");
    if (!v || !doel) return;
    const sleutel = doel.dataset["kiesSleutel"] ?? "";
    if (sleutel === v.laatste) return;
    v.laatste = sleutel;
    const ids = (doel.dataset["kies"] ?? "").split(",").filter(Boolean);
    if (ids.length > 0) onKies(ids, v.aan, doel.dataset["kiesDag"] ?? "");
  }

  function stop() {
    verf.current = null;
    // Ook weghalen als de streek op een andere manier eindigde: anders
    // stapelen er bij lang doorwerken honderden luisteraars op.
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  }

  return {
    onPointerDown(e) {
      // Alleen de linkerknop: met rechts open je het menu, en dan hoort de
      // selectie niet stiekem mee te veranderen.
      if (!actief || e.button !== 0) return;
      const doel = (e.target as Element).closest<HTMLElement>("[data-kies]");
      if (!doel) return;
      const ids = (doel.dataset["kies"] ?? "").split(",").filter(Boolean);
      if (ids.length === 0) return;
      verf.current = {
        aan: !ids.every(isGekozen),
        laatste: "",
        vorig: { x: e.clientX, y: e.clientY },
      };
      pasToe(doel);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // Laat je los buiten het raster — of raakt het venster zijn aandacht
      // kwijt — dan zou de streek blijven staan en selecteer je daarna al
      // bewegend, zonder te klikken.
      window.addEventListener("pointerup", stop, { once: true });
      window.addEventListener("pointercancel", stop, { once: true });
    },

    onPointerMove(e) {
      const v = verf.current;
      if (!v) return;
      // De lijn tussen twee meetpunten aflopen: beweeg je snel, dan liggen ze
      // tientallen pixels uit elkaar terwijl een regel maar twintig hoog is.
      const van = v.vorig;
      const naar = { x: e.clientX, y: e.clientY };
      v.vorig = naar;
      const dx = naar.x - van.x;
      const dy = naar.y - van.y;
      const stappen = Math.min(80, Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8)));
      for (let i = 1; i <= stappen; i++) {
        pasToe(document.elementFromPoint(van.x + (dx * i) / stappen, van.y + (dy * i) / stappen));
      }
    },

    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
  };
}
