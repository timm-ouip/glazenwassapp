/**
 * Een tik buiten een menu sluit het menu, en doet verder niets.
 *
 * Een menu of keuzelijst (Radix) gaat al dicht bij het néérdrukken buiten het
 * menu. Zolang hij open is kan de pagina eronder niet aangetikt worden, maar
 * dat slot gaat eraf zodra het menu weg is — en dat is na zijn korte
 * verdwijnanimatie, vaak nog vóór je je vinger optilt. De telefoon stuurt de
 * klik pas bij het optillen, en die landt dan op wat er onder je vinger ligt:
 * een ander adres, een ander menu. Hier wordt die klik opgevangen.
 *
 * Pop-ups en bladen (Dialog, Popover) hebben dit niet nodig: die sluiten pas
 * óp de klik, en tot dan ligt de pagina nog op slot.
 *
 * Eén set luisteraars voor de hele app, op het venster en in de vangfase,
 * zodat ze vóór React en vóór de rest van de pagina komen. De stand staat op
 * het venster zelf: de dev-server laadt dit bestand opnieuw na een wijziging,
 * en dan moeten de luisteraars die er al hangen dezelfde stand lezen.
 */

type Stand = {
  /** Het neerdrukken van de tik die nu loopt; weg zodra zijn klik er was. */
  druk: PointerEvent | null;
  /** De rest van deze tik opvangen. */
  slikken: boolean;
};

const raam = (typeof window === "undefined" ? undefined : window) as
  (Window & { __tikBuiten?: Stand }) | undefined;

if (raam && !raam.__tikBuiten) {
  const stand: Stand = { druk: null, slikken: false };
  raam.__tikBuiten = stand;
  const opvangen = (e: Event) => {
    if (!stand.slikken) return;
    e.preventDefault();
    e.stopPropagation();
  };
  // Een nieuwe tik begint altijd schoon.
  raam.addEventListener(
    "pointerdown",
    (e) => {
      stand.slikken = false;
      stand.druk = e;
    },
    true,
  );
  // Het neerdrukken van de muis zou anders een veld eronder de cursor geven
  // (en op de telefoon het toetsenbord laten opkomen).
  raam.addEventListener("mousedown", opvangen, true);
  raam.addEventListener(
    "click",
    (e) => {
      opvangen(e);
      stand.slikken = false;
      stand.druk = null;
    },
    true,
  );
  // Werd het een veeg of schuiven, dan komt er geen klik. Een klik met het
  // toetsenbord hoort daarna gewoon door te gaan.
  raam.addEventListener("keydown", () => (stand.slikken = false), true);
}

/**
 * Geef dit aan `onPointerDownOutside` van een menu: de rest van de tik die het
 * menu sloot (de klik bij het optillen) komt dan nergens meer aan.
 */
export function slikRestVanTik(event: CustomEvent<{ originalEvent: PointerEvent }>) {
  const stand = raam?.__tikBuiten;
  if (!stand || event.defaultPrevented) return;
  // Alleen zolang deze tik nog loopt; was zijn klik er al, dan valt er niets
  // meer op te vangen, en zou de volgende klik er onterecht aan gaan.
  if (event.detail.originalEvent === stand.druk) stand.slikken = true;
}
