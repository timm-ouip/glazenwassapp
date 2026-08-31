import type { KeyboardEvent } from "react";

/**
 * Enter in een dialoogvenster betekent "opslaan". Zonder dit moet je na het
 * typen naar de knop reiken, terwijl je handen al op het toetsenbord liggen.
 *
 * Een paar plekken houden Enter voor zichzelf, en die slaan we over:
 * een knop (Enter drukt die knop in — ook Annuleren), een tekstvak over
 * meerdere regels, een uitklaplijst, en het zoekveld van een keuzelijst,
 * waar Enter het gemarkeerde item kiest.
 */
export function opslaanBijEnter(opslaan: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.defaultPrevented) return;

    const doel = e.target as HTMLElement | null;
    if (!doel) return;
    if (doel.tagName === "BUTTON" || doel.tagName === "TEXTAREA") return;
    if (doel.getAttribute("role") === "combobox") return;
    if (doel.closest("[cmdk-root]")) return;

    e.preventDefault();
    opslaan();
  };
}
