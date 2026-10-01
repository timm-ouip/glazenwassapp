import { describe, expect, test } from "bun:test";

import { factuurOver, type OverRegel } from "@/lib/facturen";

const was = (datum: string): OverRegel => ({
  soort: "wasbeurt",
  datum,
  omschrijving: "Kerkstraat 12",
});

describe("factuurOver", () => {
  test("losse factuur: het onderwerp, anders de eerste regel", () => {
    const regels: OverRegel[] = [{ soort: "los", datum: "2026-03-03", omschrijving: "dakgoot" }];
    expect(factuurOver("factuur", "", regels)).toBe("Losse factuur · dakgoot");
    expect(factuurOver("factuur", "Offerte 12", regels)).toBe("Losse factuur · Offerte 12");
  });

  test("één wasbeurt: de maand", () => {
    expect(factuurOver("factuur", "", [was("2026-09-12")])).toBe("Wasbeurt · sep");
  });

  test("meer beurten over maanden: van – tot", () => {
    expect(
      factuurOver("factuur", "", [was("2026-09-01"), was("2026-07-03"), was("2026-08-04")]),
    ).toBe("3 wasbeurten · jul – sep");
  });

  test("over de jaargrens: met jaartallen", () => {
    expect(factuurOver("factuur", "", [was("2025-12-01"), was("2026-01-05")])).toBe(
      "2 wasbeurten · dec 2025 – jan 2026",
    );
  });

  test("wasbeurt en klus samen", () => {
    expect(
      factuurOver("factuur", "", [
        was("2026-05-01"),
        { soort: "klus", datum: "2026-05-01", omschrijving: "serre" },
      ]),
    ).toBe("Wasbeurt en klus · mei");
  });

  test("creditfactuur en een lege factuur", () => {
    expect(factuurOver("credit", "", [was("2026-04-02")])).toBe("Creditfactuur · apr");
    expect(factuurOver("factuur", "", [])).toBe("Factuur");
  });
});
