import { describe, expect, test } from "bun:test";

import {
  binnenVeelhoek,
  celSleutel,
  haalStraatAdressen,
  houdStatus,
  isVerblijfsobjectId,
  ontdubbel,
  soortVanGebruik,
  type BagAdres,
} from "@/lib/bag";

describe("isVerblijfsobjectId", () => {
  test("teken 5-6 is 01: verblijfsobject", () => {
    expect(isVerblijfsobjectId("0518010000370715")).toBe(true);
  });
  test("02 is een standplaats, 03 een ligplaats", () => {
    expect(isVerblijfsobjectId("0518020000370715")).toBe(false);
    expect(isVerblijfsobjectId("0518030000370715")).toBe(false);
  });
  test("leeg, ontbrekend of verkeerde lengte", () => {
    expect(isVerblijfsobjectId(undefined)).toBe(false);
    expect(isVerblijfsobjectId("")).toBe(false);
    expect(isVerblijfsobjectId("051801")).toBe(false);
  });
});

describe("houdStatus", () => {
  test("gevormd (nieuwbouw) blijft", () => {
    expect(houdStatus("Verblijfsobject gevormd")).toBe(true);
  });
  test("in gebruik, niet ingemeten en verbouwing blijven", () => {
    expect(houdStatus("Verblijfsobject in gebruik")).toBe(true);
    expect(houdStatus("Verblijfsobject in gebruik (niet ingemeten)")).toBe(true);
    expect(houdStatus("Verbouwing verblijfsobject")).toBe(true);
  });
  test("ten onrechte opgevoerd, ingetrokken, niet gerealiseerd en buiten gebruik gaan weg", () => {
    expect(houdStatus("Verblijfsobject ten onrechte opgevoerd")).toBe(false);
    expect(houdStatus("Verblijfsobject ingetrokken")).toBe(false);
    expect(houdStatus("Niet gerealiseerd verblijfsobject")).toBe(false);
    expect(houdStatus("Verblijfsobject buiten gebruik")).toBe(false);
    expect(houdStatus(undefined)).toBe(false);
  });
});

describe("soortVanGebruik", () => {
  test("woonfunctie is woon", () => {
    expect(soortVanGebruik("woonfunctie")).toBe("woon");
  });
  test("winkelfunctie is bedrijf", () => {
    expect(soortVanGebruik("winkelfunctie")).toBe("bedrijf");
  });
  test("woonfunctie bovenop iets anders blijft woon", () => {
    expect(soortVanGebruik("winkelfunctie,woonfunctie")).toBe("woon");
    expect(soortVanGebruik("overige gebruiksfunctie,woonfunctie")).toBe("woon");
  });
  test("alle bedrijfsdoelen tellen als bedrijf", () => {
    for (const d of [
      "kantoorfunctie",
      "bijeenkomstfunctie",
      "gezondheidszorgfunctie",
      "onderwijsfunctie",
      "logiesfunctie",
      "sportfunctie",
      "industriefunctie",
    ]) {
      expect(soortVanGebruik(d)).toBe("bedrijf");
    }
  });
  test("alleen overige gebruiksfunctie en/of celfunctie valt weg", () => {
    expect(soortVanGebruik("overige gebruiksfunctie")).toBeNull();
    expect(soortVanGebruik("celfunctie")).toBeNull();
    expect(soortVanGebruik("celfunctie,overige gebruiksfunctie")).toBeNull();
    expect(soortVanGebruik(null)).toBeNull();
    expect(soortVanGebruik(undefined)).toBeNull();
  });
  test("een lijst werkt net zo als een kommatekst", () => {
    expect(soortVanGebruik(["winkelfunctie", "woonfunctie"])).toBe("woon");
    expect(soortVanGebruik(["overige gebruiksfunctie"])).toBeNull();
  });
});

describe("celSleutel", () => {
  test("punten dicht bij elkaar delen een cel", () => {
    expect(celSleutel(4.2596, 52.0728)).toBe(celSleutel(4.2599, 52.0729));
  });
  test("punten ver uit elkaar niet", () => {
    expect(celSleutel(4.2596, 52.0728) === celSleutel(4.2696, 52.0728)).toBe(false);
    expect(celSleutel(4.2596, 52.0728) === celSleutel(4.2596, 52.0828)).toBe(false);
  });
});

function rij(vbo_id: string, extra: Partial<BagAdres> = {}): BagAdres {
  return {
    vbo_id,
    straat: "Rozenstraat",
    straat_verkort: "Rozenstr",
    woonplaats: "'s-Gravenhage",
    huisnummer: 1,
    toevoeging: "",
    postcode: "2565SG",
    oppervlakte: 80,
    gebruiksdoel: "woonfunctie",
    lon: 4.2596,
    lat: 52.0728,
    ...extra,
  };
}

describe("ontdubbel", () => {
  test("dezelfde vbo_id in twee cellen geeft één rij", () => {
    const uit = ontdubbel([
      rij("0518010000370715"),
      rij("0518010000793471"),
      rij("0518010000370715"),
    ]);
    expect(uit.map((r) => r.vbo_id)).toEqual(["0518010000370715", "0518010000793471"]);
  });
  test("leeg blijft leeg", () => {
    expect(ontdubbel([])).toEqual([]);
  });
});

describe("binnenVeelhoek", () => {
  const vierkant: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  test("midden is binnen", () => {
    expect(binnenVeelhoek([5, 5], vierkant)).toBe(true);
  });
  test("ver weg is buiten", () => {
    expect(binnenVeelhoek([15, 5], vierkant)).toBe(false);
    expect(binnenVeelhoek([-1, 5], vierkant)).toBe(false);
    expect(binnenVeelhoek([5, 11], vierkant)).toBe(false);
  });
  test("vlak langs de rand", () => {
    expect(binnenVeelhoek([9.999, 5], vierkant)).toBe(true);
    expect(binnenVeelhoek([10.001, 5], vierkant)).toBe(false);
  });
  test("een gesloten ring (eerste punt herhaald) werkt hetzelfde", () => {
    expect(binnenVeelhoek([5, 5], [...vierkant, [0, 0]])).toBe(true);
    expect(binnenVeelhoek([15, 5], [...vierkant, [0, 0]])).toBe(false);
  });
  test("een holle (L-vormige) veelhoek: de uitsparing is buiten", () => {
    const l: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(binnenVeelhoek([2, 8], l)).toBe(true);
    expect(binnenVeelhoek([8, 2], l)).toBe(true);
    expect(binnenVeelhoek([8, 8], l)).toBe(false);
  });
  test("minder dan drie punten is nooit binnen", () => {
    expect(binnenVeelhoek([5, 5], [])).toBe(false);
    expect(
      binnenVeelhoek(
        [5, 5],
        [
          [0, 0],
          [10, 10],
        ],
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// haalStraatAdressen met een nagemaakte fetch (ingekort uit echte antwoorden)
// ---------------------------------------------------------------------------

const echteFetch = globalThis.fetch;

/** Zet de nagemaakte fetch neer voor één test en herstelt de echte daarna. */
async function metFetch(fn: () => Promise<void>) {
  try {
    await fn();
  } finally {
    globalThis.fetch = echteFetch;
  }
}

const doc = (id: string, nr: number, lon: number, extra: Record<string, unknown> = {}) => ({
  woonplaatsnaam: "'s-Gravenhage",
  straatnaam_verkort: "Rozenstr",
  postcode: "2565SG",
  centroide_ll: `POINT(${lon} 52.07280745)`,
  adresseerbaarobject_id: id,
  huisnummer: nr,
  straatnaam: "Rozenstraat",
  ...extra,
});

const vbo = (
  id: string,
  status: string,
  gebruiksdoel: string,
  oppervlakte: number | null = 80,
) => ({
  type: "Feature",
  properties: { identificatie: id, status, gebruiksdoel, oppervlakte },
});

function maakFetch(locatie: unknown[], bag: (url: URL) => Response) {
  const verzoeken: string[] = [];
  globalThis.fetch = (async (invoer: URL | string) => {
    const url = new URL(invoer.toString());
    verzoeken.push(url.toString());
    if (url.hostname === "api.pdok.nl" && url.pathname.includes("locatieserver")) {
      return Response.json({ response: { numFound: locatie.length, docs: locatie } });
    }
    return bag(url);
  }) as unknown as typeof fetch;
  return verzoeken;
}

describe("haalStraatAdressen", () => {
  test("filtert op id, status en gebruiksdoel, en ontdubbelt over twee cellen", () =>
    metFetch(async () => {
      // Twee groepen punten ver uit elkaar: twee cellen.
      const locatie = [
        doc("0518010000000001", 1, 4.2596),
        doc("0518010000000002", 2, 4.2597, { huisletter: "a", huisnummertoevoeging: "2" }),
        doc("0518010000000003", 3, 4.2598),
        doc("0518010000000004", 4, 4.2599),
        doc("0518010000000005", 5, 4.2599),
        doc("0518020000000006", 6, 4.2599), // standplaats: valt af op het id
        doc("0518010000000007", 7, 4.32), // andere cel
      ];
      const bagAntwoord = {
        features: [
          vbo("0518010000000001", "Verblijfsobject in gebruik", "woonfunctie"),
          vbo("0518010000000002", "Verblijfsobject gevormd", "woonfunctie", null),
          vbo("0518010000000003", "Verblijfsobject ten onrechte opgevoerd", "woonfunctie"),
          vbo("0518010000000004", "Verblijfsobject in gebruik", "overige gebruiksfunctie"),
          vbo("0518010000000005", "Verblijfsobject in gebruik", "winkelfunctie"),
          vbo("0518010000000099", "Verblijfsobject in gebruik", "woonfunctie"), // niet in de lijst
          vbo("0518010000000007", "Verblijfsobject in gebruik", "woonfunctie"),
        ],
        links: [],
      };
      const verzoeken = maakFetch(locatie, () => Response.json(bagAntwoord));
      const voortgang: string[] = [];

      const uit = await haalStraatAdressen("Rozenstraat", "'s-Gravenhage", {
        onVoortgang: (t) => voortgang.push(t),
      });

      expect(uit === null).toBe(false);
      // Beide cellen geven dezelfde antwoordlijst, toch komt elke woning één keer voor.
      expect(uit!.map((r) => r.vbo_id)).toEqual([
        "0518010000000001",
        "0518010000000002",
        "0518010000000005",
        "0518010000000007",
      ]);
      expect(uit![1]).toEqual({
        vbo_id: "0518010000000002",
        straat: "Rozenstraat",
        straat_verkort: "Rozenstr",
        woonplaats: "'s-Gravenhage",
        huisnummer: 2,
        toevoeging: "A2",
        postcode: "2565SG",
        oppervlakte: null,
        gebruiksdoel: "woonfunctie",
        lon: 4.2597,
        lat: 52.07280745,
      });
      expect(uit![2]!.gebruiksdoel).toBe("winkelfunctie");
      expect(verzoeken.filter((u) => u.includes("verblijfsobject")).length).toBe(2);
      expect(voortgang[0]).toBe("Rozenstraat: adressen zoeken…");
      expect(voortgang).toContain("Rozenstraat: cel 2 van 2");
    }));

  test("volgt next-links", () =>
    metFetch(async () => {
      const locatie = [doc("0518010000000001", 1, 4.2596), doc("0518010000000002", 2, 4.2597)];
      const verzoeken = maakFetch(locatie, (url) =>
        url.searchParams.get("cursor")
          ? Response.json({
              features: [vbo("0518010000000002", "Verblijfsobject in gebruik", "woonfunctie")],
              links: [],
            })
          : Response.json({
              features: [vbo("0518010000000001", "Verblijfsobject in gebruik", "woonfunctie")],
              links: [
                {
                  rel: "next",
                  href: `${url.origin}${url.pathname}?bbox=1,2,3,4&cursor=abc&f=json&limit=1000`,
                },
              ],
            }),
      );
      const uit = await haalStraatAdressen("Rozenstraat", "'s-Gravenhage");
      expect(uit!.map((r) => r.vbo_id)).toEqual(["0518010000000001", "0518010000000002"]);
      expect(verzoeken.filter((u) => u.includes("verblijfsobject")).length).toBe(2);
    }));

  test("een mislukte BAG-cel (400, geen herhaling) geeft null voor het geheel", () =>
    metFetch(async () => {
      maakFetch([doc("0518010000000001", 1, 4.2596)], () => new Response("kapot", { status: 400 }));
      expect(await haalStraatAdressen("Rozenstraat", "'s-Gravenhage")).toBeNull();
    }));

  test("een mislukte Locatieserver geeft null", () =>
    metFetch(async () => {
      globalThis.fetch = (async () =>
        new Response("kapot", { status: 400 })) as unknown as typeof fetch;
      expect(await haalStraatAdressen("Rozenstraat", "'s-Gravenhage")).toBeNull();
    }));

  test("een straat zonder adressen geeft een lege lijst, geen null", () =>
    metFetch(async () => {
      maakFetch([], () => Response.json({ features: [], links: [] }));
      expect(await haalStraatAdressen("Nergensstraat", "'s-Gravenhage")).toEqual([]);
    }));
});
