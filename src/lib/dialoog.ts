import type { KeyboardEvent } from "react";

/**
 * Enter in een dialoogvenster betekent "opslaan". Zonder dit moet je na het
 * typen naar de knop reiken, terwijl je handen al op het toetsenbord liggen.
 *
 * Een paar plekken houden Enter voor zichzelf, en die slaan we over:
 * een knop (Enter drukt die knop in — ook Annuleren), een tekstvak over
 * meerdere regels, een uitklaplijst, het zoekveld van een keuzelijst, waar
 * Enter het gemarkeerde item kiest, en een open menu (zoals de frequentie):
 * daar kiest Enter wat je aanwijst, en de popup mag dan niet ineens opslaan.
 */
export function opslaanBijEnter(opslaan: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    // Enter ingedrukt houden: één keer opslaan, niet bij elke herhaling.
    if (e.defaultPrevented || e.repeat) return;

    const doel = e.target as HTMLElement | null;
    if (!doel) return;
    // Alleen wat in het venster zelf gebeurt. Een schermpje dat erin
    // openspringt (de notitie, een nieuwe mail) staat elders in de pagina,
    // maar React stuurt de toets toch hierheen: dan sloeg het venster op met
    // de oude gegevens en ging dicht, en was wat je net typte weg.
    if (!(e.currentTarget as Node).contains(doel)) return;
    if (doel.tagName === "BUTTON" || doel.tagName === "TEXTAREA") return;
    if (doel.getAttribute("role") === "combobox") return;
    if (doel.closest("[cmdk-root]")) return;
    if (doel.closest('[role="menu"]')) return;

    e.preventDefault();
    opslaan();
  };
}
