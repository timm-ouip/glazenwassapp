import { zonderEuro } from "@/lib/bedrag";

/**
 * Een bedrag zoals het op een tegel of een cijferkaart staat: het euroteken
 * een slag kleiner dan het getal zelf.
 *
 * Drie cijferkaarten naast elkaar laten op een telefoon zo'n negentig pixels
 * over voor het getal. "€ 12.450" was er honderdvier en werd afgekapt — je zag
 * dan niet eens meer wát er stond. Het euroteken kleiner maken scheelt tien
 * pixels; de rest moet van het getal zelf komen, zie `pasIn` in
 * src/lib/bedrag.ts.
 *
 * De maat staat in em, dus hij loopt mee met het vak waar het bedrag in staat:
 * groot op de tegel van Home, klein op een cijferkaart. Staat er geen
 * euroteken voor — een aantal adressen, een aantal straten — dan verandert er
 * niets.
 */
export function Bedrag({ tekst }: { tekst: string }) {
  const getal = zonderEuro(tekst);
  if (getal === tekst) return <>{tekst}</>;
  return (
    <>
      <span className="text-[0.56em]">€</span>
      <span className="pl-[0.12em]">{getal}</span>
    </>
  );
}
