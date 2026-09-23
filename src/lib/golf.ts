/**
 * De golf onder je vinger.
 *
 * Tik je op een tegel, dan loopt er een lichte kring weg vanaf de plek waar je
 * hem raakte: het bewijs dat je raak tikte, ook als de pagina nog even laadt.
 * Hoe die kring eruitziet staat in styles.css; hier wordt hij neergezet.
 *
 * Eén luisteraar voor de hele app in plaats van een handler per tegel: de
 * tegels worden bij elke verandering opnieuw getekend, en dan is dit werk dat
 * je steeds opnieuw doet voor iets wat nooit verandert.
 */
const KLASSE = "tegel-golf";

function golf(e: PointerEvent) {
  const doel = (e.target as Element | null)?.closest?.(`.${KLASSE}`);
  if (!(doel instanceof HTMLElement)) return;
  // Alleen de linkermuisknop en een vinger; rechtsklikken tikt niets aan.
  if (e.button !== 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const vak = doel.getBoundingClientRect();
  const maat = Math.max(vak.width, vak.height) * 2.2;
  const bel = document.createElement("span");
  bel.className = "golfje";
  bel.style.width = `${maat}px`;
  bel.style.height = `${maat}px`;
  bel.style.left = `${e.clientX - vak.left - maat / 2}px`;
  bel.style.top = `${e.clientY - vak.top - maat / 2}px`;
  doel.appendChild(bel);
  bel.addEventListener("animationend", () => bel.remove());
}

// Op de server is er geen document; daar hoeft er ook niets te golven. Het
// vlaggetje is voor de dev-server: die laadt dit bestand opnieuw in na elke
// wijziging, en zonder vlaggetje staan er dan drie luisteraars die elk hun
// eigen kringetje neerzetten.
if (typeof document !== "undefined") {
  const raam = window as typeof window & { __golfAan?: boolean };
  if (!raam.__golfAan) {
    raam.__golfAan = true;
    document.addEventListener("pointerdown", golf);
  }
}
