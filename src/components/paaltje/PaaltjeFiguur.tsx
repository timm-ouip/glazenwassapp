/**
 * Paaltje als Haagse paal: groen gietijzer, rond kopje met kraag en de
 * ooievaar als reliëf, op een stoep van klinkers.
 *
 * Met `beweegt` wiebelt hij licht op zijn voet en wisselt hij om de paar
 * seconden willekeurig van gezicht; elk gezicht heeft zijn eigen beweging.
 * Zonder `beweegt` staat hij stil met het nuchtere gezicht (in de kop van
 * het paneel, waar je leest en typt).
 *
 * Dit bestand wordt pas opgehaald nadat het scherm geladen is — zie
 * `PaaltjeLui.tsx` — dus alles, ook de animaties, zit hier bij elkaar.
 */
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

const G = {
  groen: "#2f6b56",
  donker: "#24574a",
  licht: "#4f927a",
  diep: "#1d4639",
  oog: "#eef3ec",
};

type Gezicht = "nuchter" | "slaperig" | "sceptisch" | "streng" | "scheef" | "snorheer";
const GEZICHTEN: Gezicht[] = ["nuchter", "slaperig", "sceptisch", "streng", "scheef", "snorheer"];

function Lijn({ d, w = 2.1 }: { d: string; w?: number }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={G.oog}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Stippen({ r = 2.4 }: { r?: number }) {
  return (
    <g className="pf-ogen">
      <circle cx="55" cy="61" r={r} fill={G.oog} />
      <circle cx="65" cy="61" r={r} fill={G.oog} />
    </g>
  );
}

/** Elk gezicht in losse delen, zodat ogen, wenkbrauwen en mond apart bewegen. */
function GezichtDelen({ gezicht }: { gezicht: Gezicht }) {
  switch (gezicht) {
    case "nuchter":
      return (
        <>
          <g className="pf-kijk">
            <Stippen />
          </g>
          <Lijn d="M56.5 67.5h7" />
        </>
      );
    case "slaperig":
      return (
        <>
          <g className="pf-ogen">
            <path d="M52.5 60.5a2.5 2.5 0 0 0 5 0zM62.5 60.5a2.5 2.5 0 0 0 5 0z" fill={G.oog} />
          </g>
          <Lijn d="M52 60.5h6M62 60.5h6" w={1.6} />
          <Lijn d="M57 67.5h6" />
          <text
            className="pf-zzz"
            x="69"
            y="55"
            fontSize="6"
            fontWeight="700"
            fill={G.oog}
            fontFamily="system-ui, sans-serif"
          >
            z
          </text>
        </>
      );
    case "sceptisch":
      return (
        <>
          <Stippen />
          <Lijn d="M52 57h6" w={1.8} />
          <g className="pf-brauw-r">
            <Lijn d="M62 55.5l6-1.8" w={1.8} />
          </g>
          <g className="pf-mond">
            <Lijn d="M56 68.2q4-1.2 8-.8" />
          </g>
        </>
      );
    case "streng":
      return (
        <g className="pf-knik">
          <Stippen r={2.2} />
          <g className="pf-brauw">
            <Lijn d="M52 56.2l6 1.4M68 56.2l-6 1.4" w={1.8} />
          </g>
          <Lijn d="M56.5 68h7" />
        </g>
      );
    case "scheef":
      return (
        <>
          <Stippen />
          <g className="pf-mond">
            <Lijn d="M55.5 68h5.5q2.5 0 3.5-2.2" />
          </g>
        </>
      );
    case "snorheer":
      return (
        <>
          <Stippen />
          <g className="pf-brauw">
            <Lijn d="M52 57.5h6M62 57.5h6" w={1.6} />
          </g>
          <g className="pf-snor">
            <path
              d="M52.5 67.5c2-2.6 5.2-2.6 7.5-1 2.3-1.6 5.5-1.6 7.5 1-2.6 1.2-5.2 1-7.5-.2-2.3 1.2-4.9 1.4-7.5.2z"
              fill={G.oog}
            />
          </g>
        </>
      );
  }
}

function Relief({ d, w = 2.6 }: { d: string; w?: number }) {
  const lijn = {
    d,
    fill: "none",
    strokeWidth: w,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  return (
    <>
      <path {...lijn} transform="translate(.9 .9)" stroke={G.diep} />
      <path {...lijn} stroke={G.licht} />
    </>
  );
}

// De animaties zitten in de tekening zelf, zodat ze alleen meekomen als
// Paaltje geladen wordt. Alles hangt onder `.pf-beweegt`.
const STIJL = `
.pf-beweegt .pf-paal, .pf-beweegt .pf-ogen, .pf-beweegt .pf-kijk, .pf-beweegt .pf-brauw,
.pf-beweegt .pf-brauw-r, .pf-beweegt .pf-mond, .pf-beweegt .pf-snor, .pf-beweegt .pf-knik,
.pf-beweegt .pf-zzz, .pf-beweegt .pf-gezicht { transform-box: fill-box; transform-origin: 50% 50%; }
.pf-zzz { opacity: 0; }
.pf-beweegt .pf-paal { transform-origin: 50% 100%; animation: pf-wiebel 6s ease-in-out infinite; }
.pf-beweegt .pf-gezicht { animation: pf-verschijn .35s ease-out; }
.pf-beweegt.pf-nuchter .pf-ogen { animation: pf-knipper 4.5s infinite; }
.pf-beweegt.pf-nuchter .pf-kijk { animation: pf-kijk 9s ease-in-out infinite; }
.pf-beweegt.pf-slaperig .pf-ogen { transform-origin: 50% 0; animation: pf-dommel 6s ease-in-out infinite; }
.pf-beweegt.pf-slaperig .pf-zzz { animation: pf-zweef 6s ease-out infinite; }
.pf-beweegt.pf-sceptisch .pf-ogen { animation: pf-knipper 5s infinite 1s; }
.pf-beweegt.pf-sceptisch .pf-brauw-r { transform-origin: 0% 50%; animation: pf-brauw-op 5s ease-in-out infinite; }
.pf-beweegt.pf-sceptisch .pf-mond { transform-origin: 0% 50%; animation: pf-mond-scheef 5s ease-in-out infinite; }
.pf-beweegt.pf-streng .pf-ogen { animation: pf-knipper 5.5s infinite .5s; }
.pf-beweegt.pf-streng .pf-brauw { animation: pf-frons 5.5s ease-in-out infinite; }
.pf-beweegt.pf-streng .pf-knik { animation: pf-knik 5.5s ease-in-out infinite; }
.pf-beweegt.pf-scheef .pf-ogen { animation: pf-knipper 4s infinite 2s; }
.pf-beweegt.pf-scheef .pf-mond { transform-origin: 0% 50%; animation: pf-mondhoek 4s ease-in-out infinite; }
.pf-beweegt.pf-snorheer .pf-ogen { animation: pf-knipper 5s infinite 1.5s; }
.pf-beweegt.pf-snorheer .pf-snor { transform-origin: 50% 20%; animation: pf-snor 5s ease-in-out infinite; }
.pf-beweegt.pf-snorheer .pf-brauw { animation: pf-wenkbrauwen-op 5s ease-in-out infinite; }
@keyframes pf-wiebel { 0%, 100% { transform: rotate(-1deg); } 50% { transform: rotate(1deg); } }
@keyframes pf-verschijn { from { opacity: 0; } to { opacity: 1; } }
@keyframes pf-knipper { 0%, 44%, 50%, 100% { transform: scaleY(1); } 47% { transform: scaleY(.1); } }
@keyframes pf-kijk { 0%, 15%, 85%, 100% { transform: translateX(0); } 25%, 45% { transform: translateX(-1.8px); } 55%, 75% { transform: translateX(1.8px); } }
@keyframes pf-dommel { 0%, 8% { transform: scaleY(1); } 55%, 84% { transform: scaleY(.2); } 88% { transform: scaleY(1.15); } 92%, 100% { transform: scaleY(1); } }
@keyframes pf-zweef { 0%, 40% { opacity: 0; transform: translate(0, 0); } 55% { opacity: 1; } 90%, 100% { opacity: 0; transform: translate(7px, -14px); } }
@keyframes pf-brauw-op { 0%, 50%, 100% { transform: translateY(0) rotate(0); } 60%, 85% { transform: translateY(-2.4px) rotate(-8deg); } }
@keyframes pf-mond-scheef { 0%, 50%, 100% { transform: rotate(0); } 60%, 85% { transform: rotate(-7deg); } }
@keyframes pf-frons { 0%, 55%, 100% { transform: translateY(0); } 62%, 82% { transform: translateY(1.4px); } }
@keyframes pf-knik { 0%, 60%, 100% { transform: translateY(0); } 66% { transform: translateY(1.8px); } 72% { transform: translateY(0); } 78% { transform: translateY(1.8px); } 84% { transform: translateY(0); } }
@keyframes pf-mondhoek { 0%, 55%, 100% { transform: rotate(0) scaleX(1); } 65%, 88% { transform: rotate(-8deg) scaleX(1.12); } }
@keyframes pf-snor { 0%, 40%, 62%, 100% { transform: rotate(0); } 45% { transform: rotate(6deg); } 50% { transform: rotate(-6deg); } 55% { transform: rotate(4deg); } 59% { transform: rotate(-2deg); } }
@keyframes pf-wenkbrauwen-op { 0%, 38%, 66%, 100% { transform: translateY(0); } 44%, 58% { transform: translateY(-1.8px); } }
@media (prefers-reduced-motion: reduce) { .pf-beweegt * { animation: none !important; } }
`;

/** Wisselt om de 4 à 7 seconden naar een willekeurig ander gezicht. */
function useWisselendGezicht(beweegt: boolean): Gezicht {
  const [gezicht, setGezicht] = useState<Gezicht>("nuchter");
  useEffect(() => {
    if (!beweegt) return;
    // Wie minder beweging wil, krijgt ook geen wisselende gezichten.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    const volgende = () => {
      timer = setTimeout(
        () => {
          setGezicht((huidig) => {
            const anderen = GEZICHTEN.filter((g) => g !== huidig);
            return anderen[Math.floor(Math.random() * anderen.length)] ?? huidig;
          });
          volgende();
        },
        4000 + Math.random() * 3000,
      );
    };
    volgende();
    return () => clearTimeout(timer);
  }, [beweegt]);
  return beweegt ? gezicht : "nuchter";
}

export default function PaaltjeFiguur({
  beweegt = false,
  className,
}: {
  beweegt?: boolean;
  className?: string;
}) {
  const gezicht = useWisselendGezicht(beweegt);
  const patroon = `klinker-${useId().replace(/:/g, "")}`;

  return (
    <svg
      viewBox="0 0 120 120"
      className={cn(beweegt && "pf-beweegt", `pf-${gezicht}`, className)}
      aria-hidden="true"
    >
      {beweegt && <style>{STIJL}</style>}
      <defs>
        <pattern id={patroon} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#bdb7ad" />
          <path d="M0 .5h12M0 6.5h12M.5 0v6M6.5 6v6" stroke="#a59f95" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="120" height="120" fill={`url(#${patroon})`} />
      <rect width="120" height="120" fill="#f3ead2" opacity=".35" />
      <g transform="translate(-21 -26) scale(1.35)">
        <g className="pf-paal">
          <path d="M45 50l-6 58h42l-6-58z" fill={G.groen} />
          <path d="M67 50l5 58h9l-6-58z" fill={G.donker} />
          <path
            d="M49.5 55l-4.8 48"
            stroke={G.licht}
            strokeWidth="3"
            strokeLinecap="round"
            opacity=".6"
          />
          <path d="M46.5 42c0-11 5.5-18 13.5-18s13.5 7 13.5 18z" fill={G.groen} />
          <path d="M65 25.5c5 2.5 8.5 8.5 8.5 16.5H67c0-7-.8-12.5-2-16.5z" fill={G.donker} />
          <ellipse
            cx="54"
            cy="31"
            rx="3.2"
            ry="2"
            transform="rotate(-35 54 31)"
            fill="#fff"
            opacity=".35"
          />
          <rect x="44" y="40" width="32" height="11" rx="3" fill={G.groen} />
          <path d="M68 40h5a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-5z" fill={G.donker} />
          <path
            d="M47 42h14"
            stroke={G.licht}
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity=".8"
          />
          <path d="M45 51h30" stroke={G.diep} strokeWidth="1.4" />
          <g transform="translate(60 63) scale(1.3) translate(-60 -63)">
            {/* key: bij elk nieuw gezicht beginnen de animaties opnieuw. */}
            <g key={gezicht} className="pf-gezicht">
              <GezichtDelen gezicht={gezicht} />
            </g>
          </g>
          <Relief d="M50 80h11l-8 8h13c5 0 5.5 7.5.5 8.5l-8.5-4M62 94v10" />
        </g>
      </g>
    </svg>
  );
}
