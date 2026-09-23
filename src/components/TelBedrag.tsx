import { useEffect, useRef, useState } from "react";

import { formatPrice } from "@/lib/klanten";
import { LAATSTE_STANDEN } from "@/lib/tellers";

/** Hoe lang het tellen duurt. Kort genoeg om niet in de weg te zitten. */
const DUUR = 520;

/**
 * Wanneer het zwevende bedrag sowieso weg moet. De animatie duurt 1100 ms en
 * meldt normaal zelf dat ze klaar is, maar in een stuk pagina dat verborgen
 * staat — de onderbalk bestaat twee keer, één voor de telefoon en één voor de
 * computer — loopt ze niet en komt die melding nooit.
 */
const OPRUIMEN = 1500;

/** Tijdens het tellen altijd centen, anders springt de breedte heen en weer. */
const metCenten = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Staat er in de instellingen dat beweging niet mag? Dan alles in één keer. */
function zachtjes() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Het tellen zelf, voor een bedrag en voor een gewoon aantal.
 *
 * Zolang er nog geen stand binnen is (`undefined`) gebeurt er niets, en de
 * eerste die komt wordt gewoon neergezet: een teller die bij het openen van de
 * pagina van nul omhoogkruipt laat alleen maar even een getal zien dat niet
 * klopt. Kent hij de vorige stand nog uit `LAATSTE_STANDEN`, dan telt hij daarvandaan.
 */
function useTeller(waarde: number | undefined, onthoud: string | undefined, metErbij: boolean) {
  // Eén keer bij het opbouwen ophalen: daarna is het onze eigen stand.
  const [begin] = useState(() =>
    onthoud === undefined ? undefined : LAATSTE_STANDEN.get(onthoud),
  );
  const [getoond, setGetoond] = useState(begin ?? waarde ?? 0);
  const [tellend, setTellend] = useState(false);
  const [erbij, setErbij] = useState<{ bedrag: number; sleutel: number } | null>(null);
  /** Wat er op dit moment op het scherm staat. */
  const opScherm = useRef(begin ?? waarde ?? 0);
  /** De laatste stand die binnenkwam; `null` zolang dat er nog geen is. */
  const vorige = useRef<number | null>(begin ?? waarde ?? null);
  const beeldje = useRef<number | null>(null);
  const klokje = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (waarde === undefined) return;
    const van = vorige.current;
    vorige.current = waarde;
    if (onthoud !== undefined) LAATSTE_STANDEN.set(onthoud, waarde);
    if (van === null) {
      opScherm.current = waarde;
      setGetoond(waarde);
      return;
    }
    if (Math.abs(waarde - van) < 0.005) return;

    // Staat de app op de achtergrond, dan tekent de browser niets en zou de
    // teller blijven staan op een getal dat niet meer klopt.
    if (zachtjes() || document.hidden) {
      opScherm.current = waarde;
      setGetoond(waarde);
      return;
    }

    if (metErbij && waarde > van) {
      setErbij({ bedrag: waarde - van, sleutel: Date.now() });
      if (klokje.current) clearTimeout(klokje.current);
      klokje.current = setTimeout(() => setErbij(null), OPRUIMEN);
    }

    // Komt er tijdens het tellen alweer een betaling binnen, dan telt hij
    // verder vanaf wat er nú staat — niet vanaf de vorige eindstand, want dan
    // springt het getal eerst een stuk vooruit.
    if (beeldje.current !== null) cancelAnimationFrame(beeldje.current);
    const vanaf = opScherm.current;
    const start = performance.now();
    setTellend(true);
    const stap = (nu: number) => {
      const t = Math.min(1, (nu - start) / DUUR);
      const soepel = 1 - Math.pow(1 - t, 3);
      opScherm.current = vanaf + (waarde - vanaf) * soepel;
      setGetoond(opScherm.current);
      if (t < 1) {
        beeldje.current = requestAnimationFrame(stap);
      } else {
        beeldje.current = null;
        setTellend(false);
      }
    };
    beeldje.current = requestAnimationFrame(stap);
  }, [waarde, onthoud, metErbij]);

  useEffect(
    () => () => {
      if (beeldje.current !== null) cancelAnimationFrame(beeldje.current);
      if (klokje.current) clearTimeout(klokje.current);
    },
    [],
  );

  return { getoond, tellend, erbij, setErbij };
}

/**
 * Een bedrag dat oploopt terwijl je kijkt.
 *
 * Verandert het bedrag, dan telt hij ernaartoe in plaats van te verspringen,
 * en zweeft er kort omhoog wat erbij kwam ("+ € 17,50"). Tijdens het
 * geldlopen zie je zo aan de tegel dat er net iemand betaald heeft, en ook
 * hoeveel, zonder dat je de lijst erbij hoeft te pakken.
 *
 * Is de teller aan iets anders toe — een andere dag, een andere avond — geef
 * hem dan een `key` mee, dan begint hij opnieuw.
 */
export function TelBedrag({ bedrag, onthoud }: { bedrag: number | undefined; onthoud?: string }) {
  const { getoond, tellend, erbij, setErbij } = useTeller(bedrag, onthoud, true);
  return (
    <span className="relative inline-block">
      {tellend ? metCenten.format(getoond) : formatPrice(getoond)}
      {erbij && (
        <span
          key={erbij.sleutel}
          aria-hidden="true"
          className="erbij pointer-events-none absolute -top-1 left-0 whitespace-nowrap text-[13px] font-semibold tabular-nums"
          onAnimationEnd={() => setErbij(null)}
        >
          + {formatPrice(erbij.bedrag)}
        </span>
      )}
    </span>
  );
}

/**
 * Hetzelfde, maar voor een aantal: klanten, wijken, aanmeldingen.
 *
 * Zonder het zwevende "+ 3" ernaast: bij geld wil je weten hoeveel erbij
 * kwam, bij een aantal zie je dat aan het getal zelf. Met `onthoud` telt het
 * vak ook bij tegen de stand van de vorige keer dat je keek, zodat je na het
 * aanpassen van een wijk op Home ziet dat het getal opliep.
 */
export function TelGetal({ waarde, onthoud }: { waarde: number | undefined; onthoud?: string }) {
  const { getoond } = useTeller(waarde, onthoud, false);
  return <>{Math.round(getoond).toLocaleString("nl-NL")}</>;
}
