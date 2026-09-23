import type { TablerIcon as LucideIcon } from "@tabler/icons-react";

/**
 * De rij cijfers boven aan een pagina.
 *
 * Elke kaart is één kleurfamilie: het vlak is de lichte tint, het icoonvakje
 * een stap dieper, de tekst de donkere kant ervan. Zwart op pastel zou de
 * kaart in tweeën trekken, en een witte kaart met een gekleurd rondje ervoor
 * laat de kleur niets betekenen.
 *
 * Vier pagina's tekenden deze rij eerst zelf, elk net iets anders. Nu staat
 * hij hier: verandert de vorm, dan verandert hij overal mee.
 *
 * In het thema Fel is het een felle tegel met het label bovenaan en een groot
 * getal onderin, zonder icoon. De kleuren komen dan uit --kaart-* in
 * styles.css: oranje, wit, donkergroen, aqua en perzik.
 *
 * In Zakelijk is elke kaart wit met een randje en zit de kleur alleen nog in
 * het icoonvakje — zo blijft de rij rustig en zie je toch waar je naar kijkt.
 */
export type Kaartkleur = "blauw" | "amber" | "groen" | "paars" | "roze";

const KLEUREN: Record<Kaartkleur, { vlak: string; chip: string }> = {
  blauw: {
    vlak: "bg-kaart-blauw text-kaart-blauw-ink",
    chip: "bg-kaart-blauw-ink/15 zak:bg-tint-blauw zak:text-tint-blauw-ink",
  },
  amber: {
    vlak: "bg-kaart-amber text-kaart-amber-ink",
    chip: "bg-kaart-amber-ink/15 zak:bg-tint-amber zak:text-tint-amber-ink",
  },
  groen: {
    vlak: "bg-kaart-groen text-kaart-groen-ink",
    chip: "bg-kaart-groen-ink/15 zak:bg-tint-groen zak:text-tint-groen-ink",
  },
  paars: {
    vlak: "bg-kaart-paars text-kaart-paars-ink",
    chip: "bg-kaart-paars-ink/15 zak:bg-tint-paars zak:text-tint-paars-ink",
  },
  roze: {
    vlak: "bg-kaart-roze text-kaart-roze-ink",
    chip: "bg-kaart-roze-ink/15 zak:bg-tint-roze zak:text-tint-roze-ink",
  },
};

export interface Cijfer {
  label: string;
  waarde: string;
  /** Eén regel context onder het getal — waar het vandaan komt, of waarover. */
  onder?: string;
  icon: LucideIcon;
  kleur: Kaartkleur;
  verberg?: boolean;
}

export function Cijferkaarten({ cijfers }: { cijfers: Cijfer[] }) {
  const zichtbaar = cijfers.filter((c) => !c.verberg);
  return (
    // Op de telefoon drie kleine tegels naast elkaar: het getal telt, de uitleg
    // eronder en het icoon passen daar niet meer.
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {zichtbaar.map((c) => {
        const kleur = KLEUREN[c.kleur];
        return (
          <div
            key={c.label}
            className={`min-w-0 rounded-[14px] px-2.5 py-2 sm:rounded-[18px] sm:px-4 sm:py-3.5 zak:border zak:border-border fel:flex fel:min-h-[112px] fel:flex-col fel:rounded-[22px] fel:px-3.5 fel:py-3 fel:sm:min-h-[132px] fel:sm:rounded-[24px] fel:sm:px-5 fel:sm:py-4 ${kleur.vlak}`}
          >
            <div
              className={`mb-2.5 hidden size-8 items-center sm:flex justify-center rounded-[10px] fel:sm:hidden ${kleur.chip}`}
            >
              <c.icon className="size-[16px]" />
            </div>
            <p className="truncate text-[11px] opacity-80 sm:text-[12.5px] fel:font-semibold fel:opacity-100 fel:sm:text-[13px] zak:text-[10px] zak:font-bold zak:uppercase zak:tracking-[0.08em] zak:text-muted-foreground zak:opacity-100 zak:sm:text-[10.5px]">
              {c.label}
            </p>
            <p className="truncate font-display text-[17px] font-semibold sm:text-[24px] leading-tight tracking-[-0.02em] tabular-nums fel:mt-auto fel:pt-2 fel:text-[30px] fel:leading-none fel:tracking-[-0.045em] fel:sm:text-[52px]">
              {c.waarde}
            </p>
            {c.onder && (
              <p className="mt-0.5 hidden truncate text-[11px] opacity-70 sm:block fel:mt-1.5 fel:block fel:opacity-80 fel:sm:text-[13px]">
                {c.onder}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
