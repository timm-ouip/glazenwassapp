import { describe, expect, test } from "bun:test";

import {
  beschrijfWijziging as beschrijfMetNbsp,
  groepeerWijzigingen,
  type Wijziging,
} from "@/lib/wijzigingen";

// Intl zet een harde spatie tussen € en het bedrag; voor de vergelijking maakt dat niet uit.
const beschrijfWijziging = (...args: Parameters<typeof beschrijfMetNbsp>) =>
  beschrijfMetNbsp(...args).replace(/\u00a0/g, " ");

const regel = (deel: Partial<Wijziging>): Wijziging => ({
  id: crypto.randomUUID(),
  company_id: "c",
  tabel: "customers",
  rij_id: "a",
  customer_id: "a",
  klant_id: null,
  veld: "notitie",
  voor: {},
  na: {},
  door: "u",
  door_naam: "Timmie",
  bron: "app",
  op: "2026-10-01T10:00:00+00:00",
  herroept: null,
  teruggedraaid_op: null,
  teruggedraaid_door: null,
  teruggedraaid_naam: null,
  verborgen_door: null,
  ...deel,
});

describe("beschrijfWijziging", () => {
  test("prijs", () => {
    expect(
      beschrijfWijziging(regel({ veld: "prijs", voor: { prijs: 11.5 }, na: { prijs: 12.5 } })),
    ).toBe("Prijs gewijzigd van € 11,50 naar € 12,50");
  });

  test("frequentie zegt nooit ritme", () => {
    const zin = beschrijfWijziging(
      regel({
        veld: "frequentie",
        voor: { interval_maanden: 1, ritme: 1 },
        na: { interval_maanden: 2, ritme: 2 },
      }),
    );
    expect(zin).toBe("Frequentie gewijzigd naar om de 2 maanden (even)");
    expect(zin.includes("itme")).toBe(false);
  });

  test("verplaatst", () => {
    const jaar = new Date().getFullYear();
    expect(
      beschrijfWijziging(
        regel({
          veld: "verplaatst",
          voor: { datum: `${jaar}-09-08` },
          na: { datum: `${jaar}-09-15` },
        }),
      ),
    ).toBe("Verplaatst van 8 sep naar 15 sep");
  });

  test("ongedaan en automatisch", () => {
    expect(
      beschrijfWijziging(
        regel({ veld: "prijs", voor: { prijs: 12.5 }, na: { prijs: 11.5 }, herroept: "x" }),
      ),
    ).toBe("Prijs teruggezet naar € 11,50");
    expect(
      beschrijfWijziging(
        regel({
          veld: "betaalmethode",
          voor: { betaalmethode: null },
          na: { betaalmethode: "overmaken" },
          bron: "systeem",
        }),
      ),
    ).toBe("Betaalmethode automatisch gewijzigd van zoals de wijk naar overmaken");
  });

  test("klantgegevens", () => {
    expect(
      beschrijfWijziging(regel({ veld: "email", voor: { email: "" }, na: { email: "a@b.nl" } })),
    ).toBe("E-mail ingevuld: a@b.nl");
    expect(
      beschrijfWijziging(
        regel({ veld: "klant", voor: { klant_id: "k1" }, na: { klant_id: "k2" } }),
        { klantNamen: new Map([["k2", "Jansen"]]) },
      ),
    ).toBe("Andere klant: Jansen (was een gewiste klant)");
  });

  test("overslaan", () => {
    expect(
      beschrijfWijziging(
        regel({
          veld: "overslaan",
          voor: { overslaan: [], start_maand: "" },
          na: { overslaan: ["2026-11"], start_maand: "" },
        }),
      ),
    ).toBe("Overslaan: november 2026");
  });
});

describe("groepeerWijzigingen", () => {
  test("één opslag is één groep; alleen app-regels gaan terug", () => {
    const groepen = groepeerWijzigingen([
      regel({
        veld: "frequentie",
        voor: { interval_maanden: 1, ritme: 1 },
        na: { interval_maanden: 2, ritme: 1 },
      }),
      regel({ veld: "notitie", voor: { note: "a" }, na: { note: "b" } }),
      regel({
        veld: "notitie",
        op: "2026-10-01T09:00:00+00:00",
        bron: "paaltje",
        door: null,
        door_naam: "Paaltje",
      }),
      regel({
        tabel: "wasdag_regels",
        rij_id: "r",
        veld: "verplaatst",
        voor: { datum: "2026-09-08" },
        na: { datum: "2026-09-15" },
      }),
    ]);
    expect(groepen).toHaveLength(3);
    const eerste = groepen.find((g) => g.rij_id === "a" && g.bron === "app");
    expect(eerste?.regels).toHaveLength(2);
    expect(eerste?.ongedaanIds).toHaveLength(2);
    expect(groepen.find((g) => g.bron === "paaltje")?.ongedaanIds).toHaveLength(0);
    expect(groepen.find((g) => g.tabel === "wasdag_regels")?.ongedaanIds).toHaveLength(0);
  });
});

describe("extra werk en meerprijs", () => {
  test("gaan samen terug", () => {
    const werk = regel({
      veld: "extra_werk",
      voor: { maandwerk: [{ id: "s" }] },
      na: { maandwerk: [] },
    });
    const prijs = regel({
      tabel: "adres_prijzen",
      veld: "meerprijs",
      op: "2026-10-01T10:00:00.400+00:00",
      voor: { maandwerk_extra: { s: 25 } },
      na: { maandwerk_extra: {} },
    });
    const groepen = groepeerWijzigingen([werk, prijs]);
    expect(groepen).toHaveLength(2);
    for (const g of groepen) expect([...g.ongedaanIds].sort()).toEqual([werk.id, prijs.id].sort());
  });
});

describe("verhuizing", () => {
  const verhuisd = (deel: Partial<Wijziging> = {}) =>
    regel({
      veld: "verhuisd",
      bron: "systeem",
      voor: { klant_id: "k1" },
      op: "2026-09-20T10:00:00+00:00",
      ...deel,
    });
  const wissel = regel({
    veld: "klant",
    voor: { klant_id: "k1" },
    na: { klant_id: "k2" },
    op: "2026-09-25T10:00:00+00:00",
  });
  const klantNamen = new Map([
    ["k1", "Jansen"],
    ["k2", "De Vries"],
  ]);
  const teksten = (rijen: Wijziging[]) =>
    groepeerWijzigingen(rijen, { klantNamen }).flatMap((g) => g.regels.map((r) => r.tekst));

  test("de verhuisd-regel en de nieuwe bewoner, zonder de naam van de vorige", () => {
    expect(teksten([verhuisd(), wissel])).toEqual([
      "Nieuwe bewoner: De Vries",
      "Verhuisd: geschiedenis van de vorige bewoner verborgen",
    ]);
  });

  test("teruggedraaide verhuizing: weer een gewone klantwissel", () => {
    expect(teksten([verhuisd({ teruggedraaid_op: "2026-09-21T10:00:00+00:00" }), wissel])[0]).toBe(
      "Andere klant: De Vries (was Jansen)",
    );
  });
});
