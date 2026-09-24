import { IconAlertTriangle as AlertTriangle, IconPrinter as Printer } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { VANGNET, type VangnetRij } from "@/lib/facturen";

/**
 * Wat er stilzwijgend niet gefactureerd wordt.
 *
 * Een adres op "overmaken" hoort een factuur op te leveren. Gebeurt dat niet,
 * dan merk je er niets van: er staat gewoon geen factuur, en een getal dat er
 * niet is valt niemand op. Daarom staat het hier hardop.
 *
 * De drie redenen en de teksten erbij staan in `VANGNET` (facturen.ts), zodat
 * het vakje en de printlijst niet uit elkaar kunnen lopen.
 */
/**
 * Niet "levert geen factuur op": bij een klant zonder e-mailadres wordt de
 * factuur wél gemaakt, hij blijft alleen als concept liggen. Wat alle vier de
 * redenen gemeen hebben, is dat er niets bij de klant aankomt.
 */
function kop(n: number): string {
  return n === 1
    ? "Bij 1 adres op overmaken komt er geen factuur bij de klant"
    : `Bij ${n} adressen op overmaken komt er geen factuur bij de klant`;
}

function perSoort(rijen: VangnetRij[]) {
  return VANGNET.map((v) => ({ ...v, rijen: rijen.filter((r) => r.soort === v.soort) })).filter(
    (g) => g.rijen.length > 0,
  );
}

/** Het rode vakje boven de lijst: hoeveel, en een knop om te kijken. */
export function VangnetVak({ rijen, onBekijk }: { rijen: VangnetRij[]; onBekijk: () => void }) {
  const aantal = rijen.length;
  if (aantal === 0) return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-tint-rood px-4 py-3 text-[13px] text-tint-rood-ink print:hidden">
      <AlertTriangle className="size-[18px] shrink-0" />
      <span className="min-w-0 flex-1">
        {kop(aantal)}. Daar hoor je verder niets van — er staat dan gewoon geen factuur.
      </span>
      <Button size="sm" variant="secondary" className="rounded-full" onClick={onBekijk}>
        Bekijken
      </Button>
    </section>
  );
}

/**
 * De lijst zelf, met een printknop. Om mee de straat in te nemen: bij het
 * ene adres haal je een mailadres op, bij het andere een naam.
 *
 * Alles wat niet op papier hoort (knoppen, de rest van de tab) staat op
 * `print:hidden`; wat je wel wilt zien staat er gewoon.
 */
export function VangnetLijst({ rijen, onTerug }: { rijen: VangnetRij[]; onTerug: () => void }) {
  const groepen = perSoort(rijen);
  const totaal = rijen.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" className="rounded-full" onClick={onTerug}>
          Terug naar de facturen
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto gap-1.5 rounded-full"
          onClick={() => window.print()}
        >
          <Printer className="size-4" aria-hidden="true" />
          Printen
        </Button>
      </div>

      <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em]">{kop(totaal)}</h2>

      {groepen.map((g) => (
        <section
          key={g.soort}
          className="overflow-hidden rounded-[20px] border border-border bg-card shadow-card print:shadow-none"
        >
          <div className="border-b border-border/70 px-4 py-3">
            <p className="font-display text-[15px] font-semibold">
              {g.kop} · {g.rijen.length}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{g.uitleg}</p>
          </div>
          <ul className="divide-y divide-border/70">
            {g.rijen.map((r) => (
              <li
                key={`${g.soort}:${r.customer_id}`}
                className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[13.5px]"
              >
                <span className="font-medium">{r.adres}</span>
                {r.naam && <span className="text-muted-foreground">{r.naam}</span>}
                <span className="ml-auto text-[12px] text-muted-foreground">{r.wijk}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
