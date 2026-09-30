/**
 * Eigen bestand: een bestand met onderdelen dat ook een losse functie deelt,
 * ververst tijdens het ontwikkelen niet meer vanzelf. Gebruikt door het
 * klantblad (KlantgegevensDialog) en door PopupKader als hij als blad opent.
 */
import { useRef } from "react";

/**
 * Een onderblad slepen met de vinger. Het blad gaat mee met de vinger;
 * loslaten ver genoeg omhoog of omlaag (of met een snelle veeg) doet de
 * actie, anders veert het terug. Omhoog gaat stroever: het blad kan zelf niet
 * hoger, het laat alleen voelen dat er iets gebeurt.
 *
 * De verschuiving gaat rechtstreeks op het blad, niet via React-state: anders
 * wordt het hele dossier bij elke millimeter opnieuw opgebouwd.
 */
export function useSleepBlad({
  onOmhoog,
  onOmlaag,
}: {
  /** Omhoog vegen; zonder dit veert het blad alleen terug. */
  onOmhoog?: () => void;
  onOmlaag: () => Promise<unknown> | void;
}) {
  const start = useRef<{ y: number; t: number; id: number; blad: HTMLElement } | null>(null);

  function zet(blad: HTMLElement, dy: number, glijden: boolean) {
    blad.style.transition = glijden ? "transform 200ms ease-out" : "none";
    blad.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
  }

  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      // Het kruisje blijft gewoon een knop.
      if ((e.target as HTMLElement).closest("button")) return;
      const blad = e.currentTarget.closest<HTMLElement>('[role="dialog"]');
      if (!blad) return;
      start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId, blad };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const d = e.clientY - s.y;
      zet(s.blad, d > 0 ? d : d / 3, false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      start.current = null;
      const afstand = e.clientY - s.y;
      const snelheid = afstand / Math.max(1, e.timeStamp - s.t); // px per ms
      if (afstand > 90 || (afstand > 20 && snelheid > 0.5)) {
        // Blijft staan waar hij is: de sluitanimatie glijdt vanaf hier verder
        // omlaag. Wordt er eerst iets gevraagd en blijf je, dan veert hij terug.
        void Promise.resolve(onOmlaag()).finally(() =>
          // Even wachten tot het dicht-zetten verwerkt is.
          setTimeout(() => {
            if (s.blad.isConnected && s.blad.dataset["state"] === "open") zet(s.blad, 0, true);
          }, 0),
        );
        return;
      }
      zet(s.blad, 0, true);
      if (afstand < -50 || (afstand < -15 && snelheid < -0.5)) onOmhoog?.();
    },
    // Afgebroken (bijvoorbeeld een telefoontje): alleen terugveren.
    onPointerCancel: () => {
      if (start.current) zet(start.current.blad, 0, true);
      start.current = null;
    },
  };
}
