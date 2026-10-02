import type { ReactNode } from "react";

/**
 * De knoppen aan de deur (het betaalvenster), ook in de kaart van één klant:
 * dezelfde vorm, andere acties. Dezelfde vorm voor alle kleuren, zodat het één rij
 * knoppen lijkt die alleen in betekenis verschilt. De kleur zegt wat er
 * gebeurt: amber is opzoeken of aanpassen, groen is er komt een deel binnen,
 * kastanje is een klacht, rood is er kwam geen geld, grafiet is de wasbeurt
 * gaat eraf, paars is vooruit betalen, en salie is helemaal betaald; lichtblauw is overmaken. De vier bovenste staan op een rij
 * en zijn daarom half zo breed.
 */
const SMAL = "min-h-14 flex-col gap-1 px-1 text-[11.5px] leading-tight";

const DEURKLEUR = {
  amber: `${SMAL} bg-tint-amber text-tint-amber-ink`,
  // Deel betaald groen: er komt geld binnen, alleen niet alles.
  groen: `${SMAL} bg-tint-groen text-tint-groen-ink`,
  // Een klacht blijft rood, maar niet hetzelfde rood als de pof hieronder:
  // kastanje is de diepe kant van dezelfde familie.
  kastanje: `${SMAL} bg-tint-kastanje text-tint-kastanje-ink`,
  rood: "min-h-14 text-[13.5px] bg-tint-rood text-tint-rood-ink",
  // Grafiet valt buiten het hele geldverhaal, en dat klopt: dit gaat niet over
  // de centen maar over het werk. De wasbeurt gaat eraf en het adres komt
  // terug in de planning.
  grafiet: "min-h-14 text-[13.5px] bg-tint-grafiet text-tint-grafiet-ink",
  // Paars voor vooruit: geld voor beurten die nog moeten komen. Een eigen
  // kleur, los van het groen en salie van nu betalen en het lichtblauw van
  // overmaken.
  paars: "min-h-14 text-[13.5px] bg-tint-paars text-tint-paars-ink",
  // Salie met bijna zwarte tekst. Het lichte groen haalde met witte letters de
  // leesnorm niet; deze kleur staat in elk thema hetzelfde op het scherm.
  salie: "min-h-16 text-[19px] bg-tint-salie text-tint-salie-ink",
  // Lichtblauw is overmaken, zoals de melding "Deze klant maakt over".
  blauw: "min-h-14 text-[13.5px] bg-tint-blauw text-tint-blauw-ink",
} as const;

export function DeurKnop({
  children,
  onClick,
  kleur,
  icoon,
  smal,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  kleur: keyof typeof DEURKLEUR;
  icoon?: ReactNode;
  /** Vier op een rij: de tekst mag dan afgekapt worden. */
  smal?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-1.5 rounded-[16px] font-display font-semibold tracking-[-0.01em] transition-transform active:scale-[0.98] disabled:opacity-40 ${DEURKLEUR[kleur]}`}
    >
      {icoon}
      <span className={smal ? "w-full truncate text-center" : ""}>{children}</span>
    </button>
  );
}
