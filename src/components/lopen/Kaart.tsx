/**
 * De kaart om een gebied te omcirkelen (Klanten lopen, "Op de kaart").
 *
 * Alleen in de browser: GebiedMaken laadt dit bestand met React.lazy, en
 * Leaflet zelf komt pas na het tekenen binnen via `import("leaflet")`, want
 * Leaflet raakt bij het laden `window` aan en de server heeft dat niet. Zo
 * zit de kaart ook in een eigen stukje JavaScript en niet in de rest van de app.
 *
 * Tekenen: klik op de kaart voor een punt; een nieuw punt komt in de lijn
 * waar je het dichtst bij klikt. Een punt versleep je, en met een klik erop
 * haal je het weg. Vanaf drie punten krijgt `onChange` de ring in [lon, lat],
 * daaronder `null`.
 *
 * Twee ondergronden, te wisselen rechtsboven: de straatkaart van
 * OpenStreetMap (straatnamen, winkels, zoals je het van je telefoon kent) en
 * de luchtfoto van het Kadaster, waarop je de huizen zelf ziet. Voor allebei
 * is geen sleutel of account nodig.
 */
import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

import { Button } from "@/components/ui/button";
import { zoekKaartMidden } from "@/lib/postcode";

type Ondergrond = "kaart" | "foto";
const ONDERGRONDEN: Record<Ondergrond, { label: string; url: string; bron: string }> = {
  kaart: {
    label: "Kaart",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    bron: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  },
  foto: {
    label: "Luchtfoto",
    url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
    bron: "Luchtfoto © Kadaster / Beeldmateriaal Nederland",
  },
};
/** Als de plaats niet te vinden is: Den Haag, [lat, lon]. */
const DEN_HAAG: [number, number] = [52.0721, 4.293];

type Punt = [number, number];

/** De afstand van p tot het lijnstuk a–b, in schermpunten. */
function afstandTotLijn(p: Leaflet.Point, a: Leaflet.Point, b: Leaflet.Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengte2 = dx * dx + dy * dy;
  const t =
    lengte2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengte2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

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
  onChange: (ring: Punt[] | null) => void;
}) {
  const houder = useRef<HTMLDivElement>(null);
  const kaart = useRef<Leaflet.Map | null>(null);
  const laag = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const tegels = useRef<Leaflet.TileLayer | null>(null);
  const [ondergrond, setOndergrond] = useState<Ondergrond>("kaart");
  /** De hoeken in [lon, lat]. */
  const [punten, setPunten] = useState<Punt[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fout, setFout] = useState(false);
  // De klik op de kaart leest deze, niet de state van het moment van aanmaken.
  const vast = useRef(false);
  useEffect(() => {
    vast.current = disabled;
  }, [disabled]);
  /** Wanneer er voor het laatst een punt is losgelaten (ms). */
  const gesleeptOp = useRef(0);

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
        laag.current = L.layerGroup().addTo(k);
        k.on("click", (e: Leaflet.LeafletMouseEvent) => {
          // Sommige browsers sturen na het loslaten van een versleept punt
          // nog een klik naar de kaart: dat is geen nieuw punt.
          if (vast.current || Date.now() - gesleeptOp.current < 300) return;
          const nieuw: Punt = [e.latlng.lng, e.latlng.lat];
          setPunten((oud) => {
            if (oud.length < 3) return [...oud, nieuw];
            // In de lijn waar je het dichtst bij klikt: de volgorde van
            // klikken maakt dan niet uit en de lijn kruist zichzelf niet.
            const klik = k.latLngToLayerPoint(e.latlng);
            const opScherm = oud.map(([lon, lat]) => k.latLngToLayerPoint([lat, lon]));
            let beste = 0;
            let kleinste = Infinity;
            for (let i = 0; i < opScherm.length; i++) {
              const d = afstandTotLijn(klik, opScherm[i]!, opScherm[(i + 1) % opScherm.length]!);
              if (d < kleinste) {
                kleinste = d;
                beste = i;
              }
            }
            return [...oud.slice(0, beste + 1), nieuw, ...oud.slice(beste + 1)];
          });
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
      tegels.current = null;
    };
  }, []);

  // De gekozen ondergrond neerleggen, onder de getekende lijn.
  useEffect(() => {
    const L = lib.current;
    const k = kaart.current;
    if (!L || !k) return;
    tegels.current?.remove();
    const keuze = ONDERGRONDEN[ondergrond];
    tegels.current = L.tileLayer(keuze.url, { maxZoom: 19, attribution: keuze.bron }).addTo(k);
  }, [ondergrond, geladen]);

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

  // Vanaf drie punten is het een gebied.
  const meld = useRef(onChange);
  useEffect(() => {
    meld.current = onChange;
  }, [onChange]);
  useEffect(() => {
    meld.current(punten.length >= 3 ? punten : null);
  }, [punten]);

  // De hoeken en de lijn tekenen.
  useEffect(() => {
    const L = lib.current;
    const groep = laag.current;
    if (!L || !groep) return;
    groep.clearLayers();
    const ll = punten.map(([lon, lat]) => L.latLng(lat, lon));
    const stijl = { className: "loopkaart-lijn", weight: 3, interactive: false };
    const vlak =
      ll.length >= 3
        ? L.polygon(ll, { ...stijl, fillOpacity: 0.15 }).addTo(groep)
        : ll.length === 2
          ? L.polyline(ll, stijl).addTo(groep)
          : null;
    const icoon = L.divIcon({ className: "loopkaart-hoek", iconSize: [22, 22] });
    ll.forEach((p, i) => {
      const hoek = L.marker(p, {
        icon: icoon,
        draggable: !disabled,
        keyboard: false,
        title: "Sleep om te verplaatsen, klik om weg te halen",
      }).addTo(groep);
      // Tijdens het slepen alleen de lijn mee laten lopen; pas bij loslaten
      // de punten vastleggen, anders breekt het slepen af.
      hoek.on("drag", () => {
        const tijdelijk = [...ll];
        tijdelijk[i] = hoek.getLatLng();
        vlak?.setLatLngs(tijdelijk);
      });
      hoek.on("dragend", () => {
        gesleeptOp.current = Date.now();
        const { lat, lng } = hoek.getLatLng();
        setPunten((oud) => oud.map((punt, j) => (j === i ? [lng, lat] : punt)));
      });
      hoek.on("click", () => {
        if (vast.current) return;
        setPunten((oud) => oud.filter((_, j) => j !== i));
      });
    });
  }, [punten, geladen, disabled]);

  return (
    <div className="flex flex-col gap-2">
      {/* De kleuren van de app, ook in het donkere thema. */}
      <style>{`
        .loopkaart-lijn { stroke: var(--primary); fill: var(--primary); }
        .loopkaart-hoek {
          border-radius: 9999px;
          border: 3px solid var(--primary);
          background: var(--card);
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
          cursor: grab;
        }
        .loopkaart-hoek:active { cursor: grabbing; }
      `}</style>
      <div className="relative">
        <div
          ref={houder}
          className="relative z-0 h-[min(60dvh,560px)] min-h-[380px] w-full cursor-crosshair overflow-hidden rounded-xl border border-border bg-muted"
          aria-label="Kaart: klik de hoeken van het gebied aan"
          role="application"
        >
          {!geladen && (
            <p className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">
              {fout ? "De kaart kon niet geladen worden. Probeer het opnieuw." : "Kaart laden…"}
            </p>
          )}
        </div>
        {geladen && (
          // Naast de kaart en niet erin: een klik hier mag geen punt zetten.
          <div
            role="group"
            aria-label="Ondergrond"
            className="absolute right-2.5 top-2.5 z-10 flex gap-0.5 rounded-full bg-card p-0.5 shadow-card"
          >
            {(Object.keys(ONDERGRONDEN) as Ondergrond[]).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={ondergrond === o}
                onClick={() => setOndergrond(o)}
                className={`min-h-9 rounded-full px-3 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ondergrond === o
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                }`}
              >
                {ONDERGRONDEN[o].label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground" aria-live="polite">
          {punten.length === 0
            ? "Klik op de kaart de hoeken van het gebied aan."
            : punten.length < 3
              ? `${punten.length} ${punten.length === 1 ? "punt" : "punten"}. Zet er minstens drie.`
              : `${punten.length} punten. Sleep een punt om het te verplaatsen, klik erop om het weg te halen.`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 rounded-full"
          disabled={disabled || punten.length === 0}
          onClick={() => setPunten([])}
        >
          Opnieuw
        </Button>
      </div>
    </div>
  );
}
