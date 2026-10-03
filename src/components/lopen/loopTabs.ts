import { type LoopFilter, type LoopGebied } from "@/lib/lopen";

/** De tabjes, met het getal dat erbij hoort. */
export const LOOP_TABS: {
  filter: LoopFilter;
  label: string;
  kleur: string;
  tel: (g: LoopGebied) => number;
}[] = [
  {
    filter: "open",
    label: "Te lopen",
    kleur: "border border-border bg-card",
    tel: (g) => g.te_lopen,
  },
  { filter: "niet_thuis", label: "Niet thuis", kleur: "bg-tint-amber", tel: (g) => g.niet_thuis },
  { filter: "interesse", label: "Interesse", kleur: "bg-tint-blauw", tel: (g) => g.interesse },
  { filter: "ja", label: "Ja", kleur: "bg-tint-groen", tel: (g) => g.ja },
  { filter: "nee", label: "Nee", kleur: "bg-muted-foreground/40", tel: (g) => g.nee },
];
