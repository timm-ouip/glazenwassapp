import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { patchCustomer, schuifStartOp, toonMaand, type Customer } from "@/lib/klanten";
import { pushUndo } from "@/lib/undo";

/**
 * Overslaan voor een hele selectie adressen — de wijkenpagina en de dagpagina
 * doen dit allebei, en het hoort op beide plekken precies hetzelfde te werken:
 * dezelfde melding, dezelfde undo, en de startmaand die meeschuift.
 *
 * De lijst gaat er als adressen in en niet als id's, want de optimistische
 * update heeft het adres zelf nodig om te weten wat er al overgeslagen werd.
 */
/** "1 adres" of "7 adressen" — telwoord en meervoud horen bij elkaar. */
function telAdressen(n: number): string {
  return `${n} ${n === 1 ? "adres" : "adressen"}`;
}

export async function slaSelectieOver(
  gekozen: Customer[],
  maanden: string[],
  qc: QueryClient,
): Promise<void> {
  if (gekozen.length === 0) return;
  const vorige = gekozen.map((c) => ({ id: c.id, overslaan: c.overslaan, start: c.start_maand }));

  const patches = gekozen.map((c) => ({
    c,
    patch: schuifStartOp(c, {
      overslaan: [...new Set([...c.overslaan, ...maanden])].sort(),
    }),
  }));

  qc.setQueryData<Customer[]>(["customers"], (oud) =>
    (oud ?? []).map((x) => {
      const p = patches.find((y) => y.c.id === x.id);
      return p ? { ...x, ...p.patch } : x;
    }),
  );

  try {
    await Promise.all(patches.map(({ c, patch }) => patchCustomer(c.id, patch)));
  } catch (e) {
    toast.error("Overslaan mislukt: " + (e as Error).message);
    qc.invalidateQueries({ queryKey: ["customers"] });
    return;
  }

  pushUndo({
    label: `Overslaan voor ${telAdressen(gekozen.length)}`,
    undo: async () => {
      await Promise.all(
        vorige.map((v) => patchCustomer(v.id, { overslaan: v.overslaan, start_maand: v.start })),
      );
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
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
  qc.setQueryData<Customer[]>(["customers"], (oud) =>
    (oud ?? []).map((x) => (ids.has(x.id) ? { ...x, overslaan: [] } : x)),
  );
  try {
    await Promise.all(met.map((c) => patchCustomer(c.id, { overslaan: [] })));
  } catch (e) {
    toast.error("Mislukt: " + (e as Error).message);
    qc.invalidateQueries({ queryKey: ["customers"] });
    return;
  }
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
