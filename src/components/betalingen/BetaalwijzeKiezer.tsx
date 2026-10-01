import { Pillen } from "@/components/Pillen";
import { betaalmethodeLabel, BETAALMETHODEN, type Betaalmethode } from "@/lib/betalingen";

/**
 * Contant of overmaken, als pillen. Bij een adres komt er een derde keuze
 * bij: "zoals de wijk" (null), met wat de wijk doet erachter.
 */
export function BetaalwijzeKiezer({
  waarde,
  onChange,
  wijk,
  disabled,
  groot,
}: {
  waarde: Betaalmethode | null;
  onChange: (m: Betaalmethode | null) => void;
  /** Wat de wijk doet. Alleen bij een adres: dan kun je die ook volgen. */
  wijk?: Betaalmethode | undefined;
  disabled?: boolean | undefined;
  /** De maat van het klantdossier (zie Pillen). */
  groot?: boolean | undefined;
}) {
  const keuzes: { waarde: Betaalmethode | null; label: string }[] = [
    ...(wijk
      ? [{ waarde: null, label: `Zoals de wijk (${betaalmethodeLabel(wijk).toLowerCase()})` }]
      : []),
    ...BETAALMETHODEN,
  ];
  return (
    <Pillen
      keuzes={keuzes}
      waarde={waarde}
      onChange={onChange}
      disabled={disabled}
      label="Betaalmethode"
      groot={groot}
    />
  );
}
