/**
 * De drie merkplaten: aqua met oranje strepen, oranje met aqua strepen, en
 * teal met allebei. Ze staan als platte PNG's in public/ — teruggebracht van
 * zes megabyte per stuk naar zo'n achttien kilobyte, want dit is het eerste
 * wat iemand van de app laadt.
 *
 * `grond` is de effen kleur van de plaat zelf. Die staat er als achtergrond
 * onder, zodat het scherm al goed staat voordat de afbeelding binnen is. Op
 * de twee lichte platen zijn de letters zwart, op teal crème.
 */
export interface Merkplaat {
  naam: string;
  plaat: string;
  woordmerk: string;
  grond: string;
}

export const MERKPLATEN: Merkplaat[] = [
  {
    naam: "aqua",
    plaat: "/paaltje-plaat-aqua.png",
    woordmerk: "/paaltje-woordmerk.png",
    grond: "#b4dcdd",
  },
  {
    naam: "oranje",
    plaat: "/paaltje-plaat-oranje.png",
    woordmerk: "/paaltje-woordmerk.png",
    grond: "#ff6723",
  },
  {
    naam: "teal",
    plaat: "/paaltje-plaat-teal.png",
    // Zwarte letters, niet de crèmekleurige die bij deze plaat zaten: door
    // het midden van de teal plaat loopt een lichtblauwe streep, en daar
    // vielen crème letters op weg. Zwart leest op allebei.
    woordmerk: "/paaltje-woordmerk.png",
    grond: "#0d686a",
  },
];

/**
 * Het woordmerk buiten een merkplaat, op een gewone kaart: zwarte letters op
 * een lichte kaart, crème letters op een donkere. Het zijn twee bestanden en
 * geen omgekleurd plaatje, want dit zijn de letters zoals ze bij het merk
 * horen.
 */
export const WOORDMERK_DONKER = "/paaltje-woordmerk.png";
export const WOORDMERK_LICHT = "/paaltje-woordmerk-licht.png";
