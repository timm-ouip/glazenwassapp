/**
 * Welke straat er in het loopscherm open staat, per avond (vrijgave). Zo sta
 * je na een andere pagina, een andere weergave of het herstarten van de app
 * weer in dezelfde straat, zonder opnieuw te zoeken.
 *
 * Hoort bij het toestel (localStorage): twee lopers op twee telefoons staan
 * elk in hun eigen straat. Een lege straat ("") betekent: alles dichtgeklapt.
 */
const SLEUTEL = "wooshy.geldloop-straat";
/** Oude avonden hoeven niet bewaard; een paar is genoeg voor wie wisselt. */
const HOOGUIT = 5;

type Onthouden = Record<string, string>;

function lees(): Onthouden {
  try {
    const ruw = JSON.parse(localStorage.getItem(SLEUTEL) ?? "{}") as unknown;
    return ruw && typeof ruw === "object" && !Array.isArray(ruw) ? (ruw as Onthouden) : {};
  } catch {
    // Privémodus, geblokkeerde opslag of een kapotte waarde: niets onthouden.
    return {};
  }
}

/** De straat die bij deze avond open stond, of null als er niets onthouden is. */
export function leesOpenStraat(vrijgaveId: string): string | null {
  const straat = lees()[vrijgaveId];
  return typeof straat === "string" ? straat : null;
}

export function onthoudOpenStraat(vrijgaveId: string, straatId: string) {
  // De nieuwste achteraan, zodat de oudste er als eerste uit valt.
  const { [vrijgaveId]: _oud, ...rest } = lees();
  const nieuw = Object.fromEntries(
    [...Object.entries(rest), [vrijgaveId, straatId]].slice(-HOOGUIT),
  );
  try {
    localStorage.setItem(SLEUTEL, JSON.stringify(nieuw));
  } catch {
    /* zie lees() */
  }
}
