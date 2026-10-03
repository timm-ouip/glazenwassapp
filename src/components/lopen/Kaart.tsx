/**
 * De kaart om een gebied te omcirkelen (Klanten lopen, "Op de kaart").
 *
 * Alleen in de browser: GebiedMaken laadt dit bestand met React.lazy, en
 * Leaflet zelf komt pas na het tekenen binnen via `import("leaflet")`, want
 * Leaflet raakt bij het laden `window` aan en de server heeft dat niet. Zo
 * zit de kaart ook in een eigen stukje JavaScript en niet in de rest van de app.
 *
 * Tekenen: klik de hoeken aan; Punt terug, Opnieuw en Klaar (vanaf 3 punten).
 * Bij Klaar krijgt `onChange` de ring in [lon, lat]; verandert er daarna iets,
 * dan `null`.
 */
import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

import { Button } from "@/components/ui/button";
import { zoekKaartMidden } from "@/lib/postcode";

const TEGELS =
  "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png";
/** Als de plaats niet te vinden is: Den Haag, [lat, lon]. */
const DEN_HAAG: [number, number] = [52.0721, 4.293];

export default function Kaart({
  plaats,
  straat = "",
  disabled = false,
  onChange,
}: {
  /** De woonplaats zoals de BAG hem kent ("'s-Gravenhage"). */
  plaats: string;
  /** Een straat uit de wijk: dan opent hij daar, dichterbij. */
  straat?: string;
  disabled?: boolean;
  onChange: (ring: [number, number][] | null) => void;
}) {
  const houder = useRef<HTMLDivElement>(null);
  const kaart = useRef<Leaflet.Map | null>(null);
  const laag = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  /** De hoeken in [lon, lat]. */
  const [punten, setPunten] = useState<[number, number][]>([]);
  const [klaar, setKlaar] = useState(false);
  const [geladen, setGeladen] = useState(false);
  const [fout, setFout] = useState(false);
  // De klik op de kaart leest deze, niet de state van het moment van aanmaken.
  const vast = useRef(false);
  useEffect(() => {
    vast.current = klaar || disabled;
  }, [klaar, disabled]);

  // De kaart maken, één keer.
  useEffect(() => {
    let weg = false;
    let kijker: ResizeObserver | null = null;
    void import("leaflet")
      .then((mod) => {
        const L = (mod as { default?: typeof Leaflet }).default ?? mod;
        if (weg || !houder.current) return;
        lib.current = L;
        const k = L.map(houder.current, { center: DEN_HAAG, zoom: 13, maxZoom: 19 });
        L.tileLayer(TEGELS, {
          maxZoom: 19,
          attribution: "Kaartgegevens © Kadaster",
        }).addTo(k);
        laag.current = L.layerGroup().addTo(k);
        k.on("click", (e: Leaflet.LeafletMouseEvent) => {
          if (vast.current) return;
          setPunten((oud) => [...oud, [e.latlng.lng, e.latlng.lat]]);
        });
        kaart.current = k;
        // In een venster dat nog opengaat klopt de maat eerst niet.
        kijker = new ResizeObserver(() => k.invalidateSize());
        kijker.observe(houder.current);
        setGeladen(true);
      })
      .catch(() => {
        if (!weg) setFout(true);
      });
    return () => {
      weg = true;
      kijker?.disconnect();
      kaart.current?.remove();
      kaart.current = null;
      laag.current = null;
    };
  }, []);

  // Eén keer per plaats (of straat) daarheen, en alleen zolang er nog niets
  // getekend is: na Opnieuw blijft de kaart staan waar je was.
  const gecentreerd = useRef("");
  const getekend = useRef(false);
  useEffect(() => {
    getekend.current = punten.length > 0;
  }, [punten]);
  useEffect(() => {
    const sleutel = `${plaats.trim()}|${straat.trim()}`;
    if (!geladen || !plaats.trim() || gecentreerd.current === sleutel) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void zoekKaartMidden(plaats, straat, ac.signal).then((midden) => {
        if (ac.signal.aborted || !midden || getekend.current) return;
        gecentreerd.current = sleutel;
        kaart.current?.setView(midden, straat.trim() ? 16 : 14);
      });
    }, 400);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [geladen, plaats, straat]);

  // De hoeken en de lijn tekenen.
  useEffect(() => {
    const L = lib.current;
    const groep = laag.current;
    if (!L || !groep) return;
    groep.clearLayers();
    const ll = punten.map(([lon, lat]) => L.latLng(lat, lon));
    const stijl = { className: "loopkaart-lijn", weight: 3, interactive: false };
    if (ll.length >= 3) L.polygon(ll, { ...stijl, fillOpacity: klaar ? 0.2 : 0.1 }).addTo(groep);
    else if (ll.length === 2) L.polyline(ll, stijl).addTo(groep);
    for (const p of ll) {
      L.circleMarker(p, {
        className: "loopkaart-punt",
        radius: 5,
        weight: 2,
        fillOpacity: 1,
        interactive: false,
      }).addTo(groep);
    }
  }, [punten, klaar, geladen]);

  function puntTerug() {
    setPunten((oud) => oud.slice(0, -1));
    if (klaar) {
      setKlaar(false);
      onChange(null);
    }
  }

  function opnieuw() {
    setPunten([]);
    if (klaar) {
      setKlaar(false);
      onChange(null);
    }
  }

  function afronden() {
    if (punten.length < 3) return;
    setKlaar(true);
    onChange(punten);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* De kleuren van de app, ook in het donkere thema. */}
      <style>{`
        .loopkaart-lijn { stroke: var(--primary); fill: var(--primary); }
        .loopkaart-punt { stroke: var(--primary); fill: var(--card); }
      `}</style>
      <div
        ref={houder}
        className="relative z-0 h-[380px] w-full cursor-crosshair overflow-hidden rounded-xl border border-border bg-muted"
        aria-label="Kaart: klik de hoeken van het gebied aan"
        role="application"
      >
        {!geladen && (
          <p className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">
            {fout ? "De kaart kon niet geladen worden. Probeer het opnieuw." : "Kaart laden…"}
          </p>
        )}
      </div>
      <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
        {klaar
          ? `Omcirkeld met ${punten.length} punten. Kies Maken en ophalen.`
          : punten.length < 3
            ? "Klik op de kaart de hoeken van het gebied aan, rondom."
            : `${punten.length} punten. Klaar sluit de lijn.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 rounded-full"
          disabled={disabled || punten.length === 0}
          onClick={puntTerug}
        >
          Punt terug
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 rounded-full"
          disabled={disabled || punten.length === 0}
          onClick={opnieuw}
        >
          Opnieuw
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-10 rounded-full"
          disabled={disabled || klaar || punten.length < 3}
          onClick={afronden}
        >
          Klaar
        </Button>
      </div>
    </div>
  );
}
