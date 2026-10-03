import { describe, expect, test } from "bun:test";

import {
  binnenVeelhoek,
  celSleutel,
  haalStraatAdressen,
  houdStatus,
  isVerblijfsobjectId,
  naarRd,
  ontdubbel,
  pandRef,
  soortVanGebruik,
  vulPandgegevens,
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

describe("naarRd", () => {
  // Paren uit de Locatieserver (centroide_ll en centroide_rd van hetzelfde adres).
  const paren: [string, number, number, number, number][] = [
    ["Rozenstraat 1, Den Haag", 4.25962215, 52.07280745, 77694.699, 454436.329],
    ["16 Aprillaan 1, Groningen", 6.55646991, 53.20046122, 233134.011, 579947],
    ["13 septemberstraat 1, Maastricht", 5.72160693, 50.84582431, 178553.3, 317385.3],
  ];
  for (const [naam, lon, lat, x, y] of paren) {
    test(`binnen 2 m: ${naam}`, () => {
      const [rx, ry] = naarRd(lon, lat);
      expect(Math.abs(rx - x) < 2).toBe(true);
      expect(Math.abs(ry - y) < 2).toBe(true);
    });
  }
  test("Amersfoort (de oorsprong) is 155000, 463000", () => {
    const [x, y] = naarRd(5.38720621, 52.1551744);
    expect(Math.round(x)).toBe(155000);
    expect(Math.round(y)).toBe(463000);
  });
});

describe("pandRef", () => {
  test("de UUID aan het eind van pand.href", () => {
    expect(
      pandRef(
        "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items/9a46dd63-faaa-5941-9e34-bdd39ce78e59",
      ),
    ).toBe("9a46dd63-faaa-5941-9e34-bdd39ce78e59");
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
    pand_refs: [],
    pand_id: null,
    woningtype: null,
    bouwlagen: null,
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
  pand?: string,
) => ({
  type: "Feature",
  properties: {
    identificatie: id,
    status,
    gebruiksdoel,
    oppervlakte,
    ...(pand
      ? { "pand.href": [`https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items/${pand}`] }
      : {}),
  },
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
        pand_refs: [],
        pand_id: null,
        woningtype: null,
        bouwlagen: null,
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

// ---------------------------------------------------------------------------
// vulPandgegevens: panden (BAG, in RD) en bouwlagen (3D BAG), nagemaakt
// ---------------------------------------------------------------------------

/** Een rechthoek in RD als GeoJSON-Polygon. */
const rdBlok = (x: number, y: number, b: number, d: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x + b, y],
      [x + b, y + d],
      [x, y + d],
      [x, y],
    ],
  ],
});

const pandFeature = (
  uuid: string,
  identificatie: string,
  x: number,
  extra: Record<string, unknown> = {},
) => ({
  type: "Feature",
  id: uuid,
  properties: {
    identificatie,
    aantal_verblijfsobjecten: 1,
    status: "Pand in gebruik",
    gebruiksdoel: "woonfunctie",
    ...extra,
  },
  geometry: rdBlok(x, 454430, 6, 10),
});

const drieD = (identificatie: string, bouwlagen: number) => ({
  type: "CityJSONFeature",
  id: `NL.IMBAG.Pand.${identificatie}`,
  CityObjects: {
    [`NL.IMBAG.Pand.${identificatie}`]: {
      type: "Building",
      attributes: { b3_bouwlagen: bouwlagen },
    },
    [`NL.IMBAG.Pand.${identificatie}-0`]: { type: "BuildingPart", attributes: {} },
  },
});

/** Drie adressen: twee halve 2-onder-1-kap en een winkel in een eigen pand. */
const gebied = () => [
  rij("0518010000000001", { huisnummer: 1, pand_refs: ["p-1"] }),
  rij("0518010000000003", { huisnummer: 3, pand_refs: ["p-3"] }),
  rij("0518010000000005", { huisnummer: 5, pand_refs: ["p-5"], gebruiksdoel: "winkelfunctie" }),
];

const panden = {
  features: [
    pandFeature("p-1", "0518100000000001", 77690),
    pandFeature("p-3", "0518100000000003", 77696),
    // De winkel staat los, 20 m verder.
    pandFeature("p-5", "0518100000000005", 77716, { gebruiksdoel: "winkelfunctie" }),
    // Gesloopt: telt niet als buur, ook al staat hij er precies tegenaan.
    pandFeature("p-weg", "0518100000000009", 77702, { status: "Pand gesloopt" }),
  ],
  links: [],
};

function maakPandFetch(drieDAntwoord: (url: URL) => Response, pandAntwoord?: () => Response) {
  const verzoeken: URL[] = [];
  globalThis.fetch = (async (invoer: URL | string) => {
    const url = new URL(invoer.toString());
    verzoeken.push(url);
    if (url.hostname === "api.3dbag.nl") return drieDAntwoord(url);
    if (url.pathname.endsWith("/pand/items")) {
      return pandAntwoord ? pandAntwoord() : Response.json(panden);
    }
    return new Response("onverwacht", { status: 404 });
  }) as unknown as typeof fetch;
  return verzoeken;
}

describe("vulPandgegevens", () => {
  test("koppelt pand, rekent het woningtype uit en haalt de bouwlagen (met next)", () =>
    metFetch(async () => {
      const verzoeken = maakPandFetch((url) =>
        url.searchParams.get("offset")
          ? Response.json({
              features: [drieD("0518100000000003", 3), drieD("0518100000000005", 1)],
              links: [],
            })
          : Response.json({
              features: [drieD("0518100000000001", 2), drieD("0518100000000099", 7)],
              links: [
                {
                  rel: "next",
                  href: `${url.origin}${url.pathname}?bbox=1,2,3,4&offset=101&limit=100`,
                },
              ],
            }),
      );
      const voortgang: string[] = [];
      const uit = await vulPandgegevens(gebied(), { onVoortgang: (t) => voortgang.push(t) });

      expect(uit.map((a) => [a.pand_id, a.woningtype, a.bouwlagen])).toEqual([
        ["0518100000000001", "twee_onder_een_kap", 2],
        ["0518100000000003", "twee_onder_een_kap", 3],
        // Een bedrijf krijgt geen woningtype, wel het pand en de lagen.
        ["0518100000000005", null, 1],
      ]);

      // De panden in RD opgevraagd, met de RD-naam voluit.
      const pandUrl = verzoeken.find((u) => u.pathname.endsWith("/pand/items"))!;
      const rd = "http://www.opengis.net/def/crs/EPSG/0/28992";
      expect(pandUrl.searchParams.get("bbox-crs")).toBe(rd);
      expect(pandUrl.searchParams.get("crs")).toBe(rd);
      const [minX, minY, maxX, maxY] = pandUrl.searchParams.get("bbox")!.split(",").map(Number);
      // Om het punt, met 30 m rand (alle drie de adressen staan op hetzelfde punt).
      const [px, py] = naarRd(4.2596, 52.0728);
      expect(Math.abs(minX! - (px - 30)) < 0.1 && Math.abs(maxX! - (px + 30)) < 0.1).toBe(true);
      expect(Math.abs(minY! - (py - 30)) < 0.1 && Math.abs(maxY! - (py + 30)) < 0.1).toBe(true);

      expect(verzoeken.filter((u) => u.hostname === "api.3dbag.nl").length).toBe(2);
      expect(voortgang[0]).toBe("Panden: cel 1 van 1");
      expect(voortgang).toContain("Verdiepingen uit de 3D BAG: 3 van 3 panden");
    }));

  test("de 3D BAG stopt zodra alle panden er zijn", () =>
    metFetch(async () => {
      const verzoeken = maakPandFetch((url) =>
        Response.json({
          features: [
            drieD("0518100000000001", 2),
            drieD("0518100000000003", 2),
            drieD("0518100000000005", 2),
          ],
          links: [{ rel: "next", href: `${url.origin}${url.pathname}?offset=101&limit=100` }],
        }),
      );
      await vulPandgegevens(gebied());
      expect(verzoeken.filter((u) => u.hostname === "api.3dbag.nl").length).toBe(1);
    }));

  test("mislukt de 3D BAG, dan blijven alleen de bouwlagen leeg", () =>
    metFetch(async () => {
      maakPandFetch(() => new Response("kapot", { status: 400 }));
      const uit = await vulPandgegevens(gebied());
      expect(uit.map((a) => [a.pand_id, a.woningtype, a.bouwlagen])).toEqual([
        ["0518100000000001", "twee_onder_een_kap", null],
        ["0518100000000003", "twee_onder_een_kap", null],
        ["0518100000000005", null, null],
      ]);
    }));

  test("mislukken de panden, dan blijven pand, type en lagen leeg (en geen 3D BAG)", () =>
    metFetch(async () => {
      const verzoeken = maakPandFetch(
        () => Response.json({ features: [], links: [] }),
        () => new Response("kapot", { status: 400 }),
      );
      const uit = await vulPandgegevens(gebied());
      expect(uit.map((a) => [a.vbo_id, a.pand_id, a.woningtype, a.bouwlagen])).toEqual([
        ["0518010000000001", null, null, null],
        ["0518010000000003", null, null, null],
        ["0518010000000005", null, null, null],
      ]);
      expect(verzoeken.some((u) => u.hostname === "api.3dbag.nl")).toBe(false);
    }));

  test("een adres zonder bekend pand houdt lege velden", () =>
    metFetch(async () => {
      maakPandFetch(() => Response.json({ features: [], links: [] }));
      const uit = await vulPandgegevens([rij("0518010000000007", { pand_refs: ["onbekend"] })]);
      expect([uit[0]!.pand_id, uit[0]!.woningtype, uit[0]!.bouwlagen]).toEqual([null, null, null]);
    }));
});

describe("haalStraatAdressen + pand.href", () => {
  test("neemt de pand-UUID's van het verblijfsobject over", () =>
    metFetch(async () => {
      maakFetch([doc("0518010000000001", 1, 4.2596)], () =>
        Response.json({
          features: [
            vbo("0518010000000001", "Verblijfsobject in gebruik", "woonfunctie", 80, "p-1"),
          ],
          links: [],
        }),
      );
      const uit = await haalStraatAdressen("Rozenstraat", "'s-Gravenhage");
      expect(uit![0]!.pand_refs).toEqual(["p-1"]);
    }));
});
