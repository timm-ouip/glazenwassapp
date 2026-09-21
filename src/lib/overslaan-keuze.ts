import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { patchCustomer, schuifStartOp, toonMaand, type Customer } from "@/lib/klanten";
import { pushUndo } from "@/lib/undo";

/** "1 adres" of "7 adressen" — telwoord en meervoud horen bij elkaar. */
export function telAdressen(n: number): string {
  return `${n} ${n === 1 ? "adres" : "adressen"}`;
}

/**
 * Zet bij elk adres zijn eigen maanden op overslaan, met de startmaand die
 * meeschuift. Geeft terug hoe het terug moet, of null als het misging (de
 * melding staat dan al in beeld). Melding en undo laat hij aan de aanroeper:
 * de planning haalt de adressen er ook nog van de dag af, en dat hoort bij
 * dezelfde stap terug.
 */
export async function zetOverslaan(
  wat: { c: Customer; maanden: string[] }[],
  qc: QueryClient,
): Promise<(() => Promise<void>) | null> {
  const vorige = wat.map(({ c }) => ({ id: c.id, overslaan: c.overslaan, start: c.start_maand }));

  const patches = wat.map(({ c, maanden }) => ({
    c,
    patch: schuifStartOp(c, {
      overslaan: [...new Set([...c.overslaan, ...maanden])].sort(),
    }),
  }));

  // Allebei de lijsten: de gewone, en die mét gestopte adressen (de planning).
  // Anders rekent een tweede overslaan direct hierna met de oude stand.
  qc.setQueriesData<Customer[]>({ queryKey: ["customers"] }, (oud) =>
    oud?.map((x) => {
      const p = patches.find((y) => y.c.id === x.id);
      return p ? { ...x, ...p.patch } : x;
    }),
  );

  const terug = async () => {
    await Promise.all(
      vorige.map((v) => patchCustomer(v.id, { overslaan: v.overslaan, start_maand: v.start })),
    );
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  // Op allemaal wachten, ook als er één misgaat: anders kan een opslag die nog
  // onderweg is het terugzetten hieronder inhalen.
  const uitkomst = await Promise.allSettled(
    patches.map(({ c, patch }) => patchCustomer(c.id, patch)),
  );
  const fout = uitkomst.find((u): u is PromiseRejectedResult => u.status === "rejected");
  if (fout) {
    toast.error("Overslaan mislukt: " + (fout.reason as Error).message);
    // Een deel kan al gelukt zijn; die zetten we meteen terug, anders slaan
    // ze stilletjes over zonder dat er iets terug te draaien valt.
    await terug().catch(() => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.error("Let op: bij een deel van de adressen staat de maand nu toch overgeslagen.");
    });
    return null;
  }

  qc.invalidateQueries({ queryKey: ["customers"] });
  return terug;
}

/**
 * Overslaan voor een hele selectie adressen — de wijkenpagina en de dagpagina
 * doen dit allebei, en het hoort op beide plekken precies hetzelfde te werken:
 * dezelfde melding, dezelfde undo, en de startmaand die meeschuift.
 *
 * De lijst gaat er als adressen in en niet als id's, want de optimistische
 * update heeft het adres zelf nodig om te weten wat er al overgeslagen werd.
 */
export async function slaSelectieOver(
  gekozen: Customer[],
  maanden: string[],
  qc: QueryClient,
): Promise<void> {
  if (gekozen.length === 0) return;
  const terug = await zetOverslaan(
    gekozen.map((c) => ({ c, maanden })),
    qc,
  );
  if (!terug) return;

  pushUndo({
    label: `Overslaan voor ${telAdressen(gekozen.length)}`,
    undo: terug,
  });

  const wat =
    maanden.length === 1
      ? toonMaand(maanden[0]!)
      : `${maanden.length} maanden t/m ${toonMaand(maanden[maanden.length - 1]!)}`;
  toast.success(
    `${telAdressen(gekozen.length)} ${gekozen.length === 1 ? "slaat" : "slaan"} ${wat} over`,
  );
}

/** De pauzes weghalen bij alles wat aangevinkt staat. */
export async function wisOverslaanVanSelectie(gekozen: Customer[], qc: QueryClient): Promise<void> {
  const met = gekozen.filter((c) => c.overslaan.length > 0);
  if (met.length === 0) {
    toast("Bij deze adressen staat niets overgeslagen.");
    return;
  }
  const vorige = met.map((c) => ({ id: c.id, overslaan: c.overslaan }));
  const ids = new Set(met.map((c) => c.id));
  qc.setQueriesData<Customer[]>({ queryKey: ["customers"] }, (oud) =>
    oud?.map((x) => (ids.has(x.id) ? { ...x, overslaan: [] } : x)),
  );
  try {
    await Promise.all(met.map((c) => patchCustomer(c.id, { overslaan: [] })));
  } catch (e) {
    toast.error("Mislukt: " + (e as Error).message);
    qc.invalidateQueries({ queryKey: ["customers"] });
    return;
  }
  qc.invalidateQueries({ queryKey: ["customers"] });
  pushUndo({
    label: `Overslaan teruggezet voor ${telAdressen(met.length)}`,
    undo: async () => {
      await Promise.all(vorige.map((v) => patchCustomer(v.id, { overslaan: v.overslaan })));
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  toast.success(
    `${telAdressen(met.length)} ${met.length === 1 ? "slaat" : "slaan"} niets meer over`,
  );
}
