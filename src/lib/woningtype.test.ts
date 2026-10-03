import { describe, expect, test } from "bun:test";

import {
  alsWoningtype,
  burenVan,
  gedeeldeMuur,
  woningtypeLabel,
  woningtypen,
  type PandVorm,
  type Punt,
} from "@/lib/woningtype";

/** Een rechthoek in RD-meters: linksonder (x, y), breed b, diep d. */
function blok(x: number, y: number, b: number, d: number): Punt[][] {
  return [
    [
      [x, y],
      [x + b, y],
      [x + b, y + d],
      [x, y + d],
      [x, y],
    ],
  ];
}

function pand(
  id: string,
  ringen: Punt[][],
  extra: Partial<Omit<PandVorm, "id" | "ringen">> = {},
): PandVorm {
  return { id, ringen, aantal_verblijfsobjecten: 1, woon: true, ...extra };
}

/** Ergens in Den Haag, zodat de getallen op echte RD lijken. */
const X = 80600;
const Y = 454800;

describe("gedeeldeMuur", () => {
  test("twee huizen tegen elkaar delen hun zijmuur (10 m)", () => {
    expect(Math.round(gedeeldeMuur(blok(X, Y, 6, 10), blok(X + 6, Y, 6, 10)))).toBe(10);
  });
  test("een kier van 0,2 m (tekenfout) telt nog als dezelfde muur", () => {
    expect(Math.round(gedeeldeMuur(blok(X, Y, 6, 10), blok(X + 6.2, Y, 6, 10)))).toBe(10);
  });
  test("0,5 m uit elkaar is geen gedeelde muur", () => {
    expect(gedeeldeMuur(blok(X, Y, 6, 10), blok(X + 6.5, Y, 6, 10))).toBe(0);
  });
  test("alleen een hoekpunt raken is geen muur", () => {
    expect(gedeeldeMuur(blok(X, Y, 6, 10), blok(X + 6, Y + 10, 6, 10)) < 1).toBe(true);
  });
});

describe("woningtypen", () => {
  test("los huis: vrijstaand", () => {
    const uit = woningtypen([pand("a", blok(X, Y, 10, 10)), pand("ver", blok(X + 30, Y, 10, 10))]);
    expect(uit.get("a")).toBe("vrijstaand");
    expect(uit.get("ver")).toBe("vrijstaand");
  });

  test("twee huizen tegen elkaar: 2-onder-1-kap", () => {
    const uit = woningtypen([pand("a", blok(X, Y, 6, 10)), pand("b", blok(X + 6, Y, 6, 10))]);
    expect(uit.get("a")).toBe("twee_onder_een_kap");
    expect(uit.get("b")).toBe("twee_onder_een_kap");
  });

  test("een rij van vier: hoek, tussen, tussen, hoek", () => {
    const rij = [0, 1, 2, 3].map((i) => pand(`h${i}`, blok(X + i * 5.5, Y, 5.5, 9)));
    const uit = woningtypen(rij);
    expect(rij.map((p) => uit.get(p.id))).toEqual(["hoek", "tussen", "tussen", "hoek"]);
  });

  test("twee verblijfsobjecten in één pand: appartement, ook als het los staat", () => {
    const uit = woningtypen([
      pand("flat", blok(X, Y, 12, 10), { aantal_verblijfsobjecten: 2 }),
      pand("huis", blok(X + 30, Y, 6, 10)),
    ]);
    expect(uit.get("flat")).toBe("appartement");
    expect(uit.get("huis")).toBe("vrijstaand");
  });

  test("een garage zonder adres met 3 m gedeelde muur telt niet mee", () => {
    const panden = [
      pand("huis", blok(X, Y, 6, 10)),
      pand("garage", blok(X + 6, Y, 3, 3), { aantal_verblijfsobjecten: 0, woon: false }),
    ];
    expect(burenVan(panden).get("huis")).toEqual([]);
    expect(woningtypen(panden).get("huis")).toBe("vrijstaand");
  });

  test("dezelfde garage met 5 m gedeelde muur telt wel", () => {
    const panden = [
      pand("huis", blok(X, Y, 6, 10)),
      pand("garage", blok(X + 6, Y, 3, 5), { aantal_verblijfsobjecten: 0, woon: false }),
    ];
    expect(burenVan(panden).get("huis")).toEqual(["garage"]);
    expect(woningtypen(panden).get("huis")).toBe("twee_onder_een_kap");
  });

  test("een buur mét adres telt al bij 3 m", () => {
    const panden = [pand("huis", blok(X, Y, 6, 10)), pand("schuurwoning", blok(X + 6, Y, 3, 3))];
    expect(burenVan(panden).get("huis")).toEqual(["schuurwoning"]);
  });

  test("een pand zonder woonfunctie krijgt geen type", () => {
    const uit = woningtypen([
      pand("winkel", blok(X, Y, 6, 10), { woon: false }),
      pand("huis", blok(X + 6, Y, 6, 10)),
    ]);
    expect(uit.get("winkel")).toBeNull();
    // De winkel telt wel als buur van het huis.
    expect(uit.get("huis")).toBe("twee_onder_een_kap");
  });

  test("de volgorde van de panden maakt niet uit", () => {
    const rij = [3, 1, 0, 2].map((i) => pand(`h${i}`, blok(X + i * 5.5, Y, 5.5, 9)));
    const uit = woningtypen(rij);
    expect(["h0", "h1", "h2", "h3"].map((id) => uit.get(id))).toEqual([
      "hoek",
      "tussen",
      "tussen",
      "hoek",
    ]);
  });
});

describe("labels", () => {
  test("enkelvoud en meervoud", () => {
    expect(woningtypeLabel("tussen")).toBe("tussenwoning");
    expect(woningtypeLabel("tussen", 3)).toBe("tussenwoningen");
    expect(woningtypeLabel("twee_onder_een_kap")).toBe("2-onder-1-kap");
  });
  test("alleen bekende typen", () => {
    expect(alsWoningtype("hoek")).toBe("hoek");
    expect(alsWoningtype("bungalow")).toBeNull();
    expect(alsWoningtype(null)).toBeNull();
  });
});
