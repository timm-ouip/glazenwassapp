import { describe, expect, test } from "bun:test";

import type { GeldDeel } from "@/lib/betalingen";
import {
  antwoordKlaar,
  jaarVakken,
  laatsteBetaling,
  openOmschrijving,
  opsomming,
  volgendeFrequentieMaand,
} from "@/lib/dossier";
import type { Gebeurtenis } from "@/lib/overzichten";

const wassen = (datum: string, bedrag = 12.5): GeldDeel =>
  ({ soort: "wassen", datum, bedrag, rest: bedrag, aantal: 1, omschrijving: "" }) as GeldDeel;

describe("opsomming", () => {
  test("één, twee en drie delen", () => {
    expect(opsomming(["mei"])).toBe("mei");
    expect(opsomming(["augustus", "september"])).toBe("augustus en september");
    expect(opsomming(["juli", "augustus", "september"])).toBe("juli, augustus en september");
  });
});

describe("openOmschrijving", () => {
  test("maanden van de rondes en het aantal wasbeurten", () => {
    expect(openOmschrijving([wassen("2026-08-14"), wassen("2026-09-11")])).toBe(
      "augustus en september · 2 wasbeurten",
    );
  });
  test("een klus telt apart, de beginstand naar zijn maanden", () => {
    const delen = [
      { ...wassen("2026-07-01"), soort: "beginstand", aantal: 2, omschrijving: "2026-06,2026-07" },
      { ...wassen("2026-09-02", 30), soort: "klus", omschrijving: "dakgoot" },
    ] as GeldDeel[];
    expect(openOmschrijving(delen)).toBe("juni en juli · 2 wasbeurten en 1 klus");
  });
});

describe("laatsteBetaling", () => {
  const g = (op: string, soort: Gebeurtenis["soort"], ongedaan = false) =>
    ({
      op,
      soort,
      bedrag: 10,
      bron: "geldloop",
      ongedaan: ongedaan ? { id: "x" } : null,
    }) as unknown as Gebeurtenis;
  test("de nieuwste betaling die niet ongedaan is", () => {
    const lijst = [
      g("2026-07-22T19:00:00Z", "betaald"),
      g("2026-09-01T19:00:00Z", "betaald", true),
      g("2026-08-30T19:00:00Z", "niet_thuis"),
    ];
    expect(laatsteBetaling(lijst)?.op).toBe("2026-07-22T19:00:00Z");
    expect(laatsteBetaling([])).toBeNull();
  });
});

describe("antwoordKlaar", () => {
  const m = {
    onderwerp: "Vraag",
    ontvangen_op: "2026-09-30T08:00:00Z",
    richting: "in" as const,
    concept: "Beste…",
    beantwoord_op: null,
    afgehandeld_op: null,
  };
  test("alleen bij een binnengekomen mail met een concept dat nog wacht", () => {
    expect(antwoordKlaar(m)).toBe(true);
    expect(antwoordKlaar({ ...m, beantwoord_op: "2026-09-30T09:00:00Z" })).toBe(false);
    expect(antwoordKlaar({ ...m, concept: "" })).toBe(false);
    expect(antwoordKlaar({ ...m, richting: "uit" })).toBe(false);
    expect(antwoordKlaar(null)).toBe(false);
  });
});

describe("volgendeFrequentieMaand", () => {
  const even = {
    interval_maanden: 2,
    ritme: 2,
    overslaan: [] as string[],
    start_maand: "",
    created_at: "2025-01-10T10:00:00Z",
    geimporteerd: false,
  };
  test("de eerstvolgende even maand, en overslaan schuift door", () => {
    expect(volgendeFrequentieMaand(even, "2026-09")).toBe("2026-10");
    expect(volgendeFrequentieMaand({ ...even, overslaan: ["2026-10"] }, "2026-09")).toBe("2026-12");
  });
  test("niet vóór de startmaand", () => {
    expect(volgendeFrequentieMaand({ ...even, start_maand: "2027-02" }, "2026-09")).toBe("2027-02");
  });
});

describe("jaarVakken", () => {
  test("gewassen, volgende, overslaan, buiten de frequentie", () => {
    const vakken = jaarVakken(
      2026,
      { interval_maanden: 2, ritme: 2, overslaan: ["2026-12"] },
      ["2026-02", "2026-08"],
      "2026-10",
      "2026-10",
    );
    const kort = (v: (typeof vakken)[number] | undefined) => `${v?.status} ${v?.tikbaar}`;
    expect(vakken.map((v) => v.letter).join("")).toBe("jfmamjjasond");
    expect(kort(vakken[1])).toBe("gewassen false");
    expect(kort(vakken[0])).toBe("geen false");
    expect(kort(vakken[3])).toBe("beurt false");
    expect(kort(vakken[9])).toBe("volgende true");
    expect(kort(vakken[10])).toBe("geen true");
    expect(kort(vakken[11])).toBe("overslaan true");
  });
});
