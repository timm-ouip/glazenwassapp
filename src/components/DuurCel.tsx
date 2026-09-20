import { InlineCel } from "@/components/InlineCel";
import { duurVoorMaand, leesDuur, toonDuur, type Customer } from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";

interface Props {
  customer: Customer;
  /** De maand die je bekijkt: extra werk van die maand telt mee. */
  ronde: string;
  onPatch: (patch: Partial<Customer>) => void;
  alleenLezen?: boolean;
}

/**
 * Hoe lang een adres duurt, als cel in de wijklijst.
 *
 * Je typt minuten ("25") of uren en minuten ("1u30"). Wat je zelf invult
 * blijft staan, ook als het uurtarief verandert; daarom onthoudt de cel dat
 * met `duur_zelf`. De duur van deze ronde kan hoger zijn dan die van het
 * adres — extra werk van die maand telt mee — en dan bewerk je hier het
 * vaste deel, net als bij de prijs.
 */
export function DuurCel({ customer: c, ronde, onPatch, alleenLezen = false }: Props) {
  const prijzenZien = useRecht("prijzen_zien");
  const rondeDuur = duurVoorMaand(c, ronde);
  const extra = rondeDuur - (c.duur_min ?? 0);

  return (
    <InlineCel
      value={c.duur_min === null ? "" : toonDuur(c.duur_min, prijzenZien)}
      align="right"
      inputMode="numeric"
      placeholder="—"
      alleenLezen={alleenLezen}
      className={extra > 0 ? "text-tint-amber-ink" : ""}
      onCommit={(tekst) => {
        const minuten = leesDuur(tekst);
        if (minuten === undefined) return;
        if (minuten === c.duur_min) return;
        onPatch({ duur_min: minuten, duur_zelf: minuten !== null });
      }}
    />
  );
}
