import { describe, expect, test } from "bun:test";

import { vakTeken, vakVoor, vooruitGepland } from "@/lib/geldkaart";
import type { Customer } from "@/lib/klanten";
import type { KaartAdres, KaartPost } from "@/lib/overzichten";

// Om de twee maanden, in de even maanden.
const adres = {
  id: "a",
  interval_maanden: 2,
  ritme: 2,
  overslaan: ["2026-12"],
  maandwerk: [],
  inactief_op: null,
} as unknown as Customer;

const beurt = (ronde: string, p: Partial<KaartPost> = {}): KaartPost => ({
  soort: "wassen",
  datum: `${ronde}-10`,
  ronde,
  bedrag: 12.5,
  aantal: 1,
  omschrijving: "",
  gedekt: 0,
  betaald_soort: null,
  vooruit: 0,
  betaald_op: null,
  betaald_door: null,
  ...p,
});

const kaart = (posten: KaartPost[], vooruit_over = 0): KaartAdres => ({
  id: "a",
  posten,
  vooruit_over,
  vooruit_vast: 0,
  gebeurtenissen: [],
});

const teken = (data: KaartAdres | undefined, maand: string, gepland: string[] = []) =>
  vakTeken(vakVoor(adres, data, maand, null, undefined, gepland));

describe("vakVoor en vakTeken", () => {
  test("betaald, niet betaald, overgeslagen en niet aan de beurt", () => {
    const data = kaart([
      beurt("2026-06", {
        gedekt: 12.5,
        betaald_soort: "betaald",
        betaald_op: "2026-06-20T19:00:00Z",
      }),
      beurt("2026-08"),
    ]);
    expect(teken(data, "2026-06")).toBe("1");
    expect(teken(data, "2026-08")).toBe("0");
    expect(teken(data, "2026-12")).toBe("×");
    expect(teken(data, "2026-07")).toBe("%");
    expect(teken(data, "2026-10")).toBe("");
  });

  test("vooruit betaald is een B, ook als hij nog moet komen", () => {
    const data = kaart(
      [beurt("2026-08", { gedekt: 12.5, betaald_soort: "vooruit", vooruit: 12.5 })],
      2,
    );
    expect(teken(data, "2026-08")).toBe("B");
    expect(teken(data, "2026-10", ["2026-10"])).toBe("B");
  });
});

describe("vooruitGepland", () => {
  test("de beurten die over zijn, na de laatste gewassen beurt", () => {
    const data = kaart([beurt("2099-02")], 2);
    expect(vooruitGepland(adres, data)).toEqual(["2099-04", "2099-06"]);
  });
  test("een gestopt adres gebruikt ze niet meer", () => {
    const gestopt = { ...adres, inactief_op: "2026-09-01" } as Customer;
    expect(vooruitGepland(gestopt, kaart([], 2))).toEqual([]);
  });
});
