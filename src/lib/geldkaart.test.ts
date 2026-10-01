import { describe, expect, test } from "bun:test";

import { jaarVakken, volgendeBeurtMaand } from "@/lib/dossier";
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

describe("geldkaart en het jaar op het Overzicht", () => {
  test("1× per 3 maanden: % buiten de frequentie, de volgende beurt leeg", () => {
    const kwartaal = {
      ...adres,
      interval_maanden: 3,
      ritme: 3,
      overslaan: [],
      start_maand: "2026-09",
    } as unknown as Customer;
    const volgende = volgendeBeurtMaand(kwartaal, null, "2026-10");
    const vak = (maand: string) => vakVoor(kwartaal, undefined, maand, "2026-09");
    expect(volgende).toBe("2026-12");
    // Het jaar op het Overzicht zet de oranje rand op dezelfde maand.
    const jaar = jaarVakken(2026, kwartaal, [], volgende, "2026-10");
    expect(jaar.find((v) => v.status === "volgende")?.maand).toBe(volgende!);
    // Op de geldkaart is die maand nog open (daar komt de "·"), de rest %.
    expect(vak("2026-12").soort).toBe("leeg");
    expect(vakTeken(vak("2026-10"))).toBe("%");
    expect(vakTeken(vak("2026-11"))).toBe("%");
    expect(vakTeken(vak("2026-09"))).toBe("");
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
