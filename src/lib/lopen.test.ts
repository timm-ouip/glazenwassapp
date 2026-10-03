import { describe, expect, test } from "bun:test";

import { nummerSleutel } from "./postcode";
import {
  adresOmschrijving,
  filterLooplijst,
  klantMatchSleutel,
  leesPrijs,
  looplijstVolgorde,
  sorteerLoopStraten,
  straatStand,
  voorstelUitleg,
  woningtypeTekst,
  zoekInLooplijst,
  type LoopAdres,
} from "./lopen";

type Rij = Pick<
  LoopAdres,
  | "straat"
  | "woonplaats"
  | "street_id"
  | "huisnummer"
  | "toevoeging"
  | "klant_hoek_kant"
  | "straat_volgorde"
  | "sort_desc"
  | "doorlopend"
>;

function rij(huisnummer: number, extra: Partial<Rij> = {}): Rij {
  return {
    straat: "Rozenstraat",
    woonplaats: "'s-Gravenhage",
    street_id: "s1",
    huisnummer,
    toevoeging: "",
    klant_hoek_kant: "",
    straat_volgorde: 1,
    sort_desc: false,
    doorlopend: false,
    ...extra,
  };
}

const nummers = (lijst: Rij[]) => lijst.map((r) => `${r.huisnummer}${r.toevoeging}`);

describe("looplijstVolgorde", () => {
  test("oneven heen, even terug", () => {
    const [straat] = looplijstVolgorde([1, 2, 3, 4, 5, 6].map((n) => rij(n)));
    expect(nummers(straat!.heen)).toEqual(["1", "3", "5"]);
    expect(nummers(straat!.terug)).toEqual(["6", "4", "2"]);
  });

  test("sort_desc draait de richting om", () => {
    const [straat] = looplijstVolgorde([1, 2, 3, 4, 5, 6].map((n) => rij(n, { sort_desc: true })));
    expect(nummers(straat!.heen)).toEqual(["5", "3", "1"]);
    expect(nummers(straat!.terug)).toEqual(["2", "4", "6"]);
  });

  test("toevoegingen staan na het kale nummer", () => {
    const [straat] = looplijstVolgorde([
      rij(3, { toevoeging: "B" }),
      rij(3),
      rij(3, { toevoeging: "A" }),
    ]);
    expect(nummers(straat!.heen)).toEqual(["3", "3A", "3B"]);
  });

  test("doorlopend geeft één lijst", () => {
    const [straat] = looplijstVolgorde([4, 1, 3, 2].map((n) => rij(n, { doorlopend: true })));
    expect(nummers(straat!.heen)).toEqual(["1", "2", "3", "4"]);
    expect(straat!.terug).toHaveLength(0);
  });

  test("doorlopend met sort_desc", () => {
    const [straat] = looplijstVolgorde(
      [1, 2, 3].map((n) => rij(n, { doorlopend: true, sort_desc: true })),
    );
    expect(nummers(straat!.heen)).toEqual(["3", "2", "1"]);
  });

  test("een klant met hoek_kant staat aan die kant", () => {
    const [straat] = looplijstVolgorde([
      rij(1),
      rij(2),
      rij(3),
      rij(4, { klant_hoek_kant: "oneven" }),
      rij(5, { klant_hoek_kant: "even" }),
    ]);
    expect(nummers(straat!.heen)).toEqual(["1", "3", "4"]);
    expect(nummers(straat!.terug)).toEqual(["5", "2"]);
  });

  test("straten op wijkvolgorde, nieuwbouw achteraan", () => {
    const lijst = looplijstVolgorde([
      rij(1, { straat: "Nieuwbouwlaan", street_id: null, straat_volgorde: 3 }),
      rij(1, { straat: "Klaverstraat", street_id: "s2", straat_volgorde: 2 }),
      rij(1, { straat: "Rozenstraat", street_id: "s1", straat_volgorde: 1 }),
      rij(3, { straat: "Nieuwbouwlaan", street_id: null, straat_volgorde: 3 }),
    ]);
    expect(lijst.map((s) => s.straat)).toEqual(["Rozenstraat", "Klaverstraat", "Nieuwbouwlaan"]);
    expect(nummers(lijst[2]!.heen)).toEqual(["1", "3"]);
  });
});

describe("klantMatchSleutel", () => {
  test('"12 A", "12-a" en "12a" geven dezelfde sleutel', () => {
    const a = klantMatchSleutel({ postcode: "2565 av", huisnummer: 12, toevoeging: " A" });
    const b = klantMatchSleutel({ postcode: "2565AV", huisnummer: 12, toevoeging: "-a" });
    const c = klantMatchSleutel({ postcode: "2565AV", huisnummer: "12", toevoeging: "a" });
    expect(a).toBe("2565AV|12a");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test("gelijk aan de SQL-formule: lower(regexp_replace(nr || toevoeging, '[\\s-]', '', 'g'))", () => {
    const sql = (nr: number, toev: string) => `${nr}${toev}`.replace(/[\s-]/g, "").toLowerCase();
    for (const [nr, toev] of [
      [12, " A"],
      [12, "-a"],
      [7, "A 2"],
      [100, ""],
    ] as const) {
      expect(nummerSleutel(nr, toev)).toBe(sql(nr, toev));
    }
  });
});

describe("leesPrijs", () => {
  test("komma, punt, euroteken en leeg", () => {
    expect(leesPrijs("14,50")).toBe(14.5);
    expect(leesPrijs("€ 12")).toBe(12);
    expect(leesPrijs("9.5")).toBe(9.5);
    expect(leesPrijs("")).toBeNull();
    expect(leesPrijs("abc")).toBeUndefined();
  });
});

describe("adresOmschrijving", () => {
  const woning = {
    oppervlakte: 96,
    gebruiksdoel: "woonfunctie",
    woningtype: "tussen",
    woningtype_zelf: null,
    bouwlagen: 3,
  };
  test("geschat type, m² en lagen", () => {
    expect(adresOmschrijving(woning)).toBe("tussenwoning (geschat) · 96 m² · 3 lagen");
  });
  test("een eigen keuze is niet geschat", () => {
    expect(woningtypeTekst({ woningtype: "tussen", woningtype_zelf: "hoek" })).toBe("hoekwoning");
  });
  test("zonder type vooraan, voor naast de typeknop", () => {
    expect(adresOmschrijving(woning, { zonderType: true })).toBe("96 m² · 3 lagen");
  });
  test("één laag, en niets wat ontbreekt", () => {
    expect(
      adresOmschrijving({ ...woning, woningtype: null, oppervlakte: null, bouwlagen: 1 }),
    ).toBe("1 laag");
  });
  test("een bedrijf krijgt nooit een woningtype", () => {
    expect(
      adresOmschrijving({
        ...woning,
        gebruiksdoel: "winkelfunctie",
        woningtype: "tussen",
        bouwlagen: null,
        oppervlakte: 80,
      }),
    ).toBe("bedrijf · winkel · 80 m²");
  });
});

describe("voorstelUitleg", () => {
  test("aantal, type en niveau", () => {
    expect(voorstelUitleg({ voorstel: 14.5, n: 3, niveau: "straat" }, "tussen")).toBe(
      "3 tussenwoningen in deze straat",
    );
    expect(voorstelUitleg({ voorstel: 20, n: 2, niveau: "buurt" }, "twee_onder_een_kap")).toBe(
      "2 twee-onder-een-kapwoningen in de buurt",
    );
    expect(voorstelUitleg({ voorstel: 9, n: 4, niveau: "wijk" }, "appartement")).toBe(
      "4 appartementen in de wijk",
    );
  });
});

describe("sorteren en zoeken in de looplijst", () => {
  type Z = Pick<LoopAdres, "huisnummer" | "toevoeging" | "postcode" | "klant_status" | "uitkomst">;
  const adres = (huisnummer: number, extra: Partial<Z> = {}): Z => ({
    huisnummer,
    toevoeging: "",
    postcode: "2512AB",
    klant_status: null,
    uitkomst: null,
    ...extra,
  });
  const straten = [
    {
      straat: "Rozenstraat",
      straat_volgorde: 1,
      heen: [adres(1), adres(3, { uitkomst: "nee" })],
      terug: [adres(2, { klant_status: "actief" })],
    },
    {
      straat: "Anjerlaan",
      straat_volgorde: 2,
      heen: [adres(12), adres(12, { toevoeging: "A" }), adres(120)],
      terug: [],
    },
    {
      straat: "2e Klaverstraat",
      straat_volgorde: 3,
      heen: [adres(5, { postcode: "2533 XK", uitkomst: "ja" })],
      terug: [],
    },
  ];
  const namen = (lijst: { straat: string }[]) => lijst.map((s) => s.straat);

  test("de stand van een straat telt klanten niet mee", () => {
    expect(straatStand(straten[0]!)).toEqual({ totaal: 3, open: 1, teDoen: 2, gedaan: 1 });
  });

  test("looproute, A–Z en meeste te lopen", () => {
    expect(sorteerLoopStraten(straten, "route")).toBe(straten);
    expect(namen(sorteerLoopStraten(straten, "az"))).toEqual([
      "2e Klaverstraat",
      "Anjerlaan",
      "Rozenstraat",
    ]);
    expect(namen(sorteerLoopStraten(straten, "open"))).toEqual([
      "Anjerlaan",
      "Rozenstraat",
      "2e Klaverstraat",
    ]);
  });

  test("zonder zoekterm blijft de lijst zoals hij is", () => {
    expect(zoekInLooplijst(straten, [])).toBe(straten);
    expect(zoekInLooplijst(straten, ["  "])).toBe(straten);
  });

  test("een stukje straatnaam geeft de hele straat", () => {
    const [s, ...rest] = zoekInLooplijst(straten, ["rozen"]);
    expect(rest).toHaveLength(0);
    expect(s!.heen).toHaveLength(2);
    expect(s!.terug).toHaveLength(1);
  });

  test("straat met huisnummer: 12 vindt ook 12 A, maar niet 120", () => {
    const [s] = zoekInLooplijst(straten, ["anjer 12"]);
    expect(s!.heen.map((r) => `${r.huisnummer}${r.toevoeging}`)).toEqual(["12", "12A"]);
    const [precies] = zoekInLooplijst(straten, ["12a"]);
    expect(precies!.heen).toHaveLength(1);
  });

  test("de toevoeging los getypt, zoals hij op het scherm staat", () => {
    const b = [
      {
        straat: "Molenweg",
        straat_volgorde: 1,
        heen: [adres(12), adres(12, { toevoeging: "B" })],
        terug: [],
      },
    ];
    const [s] = zoekInLooplijst(b, ["molen 12 b"]);
    expect(s!.heen.map((r) => `${r.huisnummer}${r.toevoeging}`)).toEqual(["12B"]);
  });

  test("postcode met of zonder spatie, en een straat die met een cijfer begint", () => {
    expect(namen(zoekInLooplijst(straten, ["2533 xk"]))).toEqual(["2e Klaverstraat"]);
    expect(namen(zoekInLooplijst(straten, ["2512"]))).toEqual(["Rozenstraat", "Anjerlaan"]);
    expect(namen(zoekInLooplijst(straten, ["2e klaver"]))).toEqual(["2e Klaverstraat"]);
  });

  test("meerdere termen staan naast elkaar", () => {
    expect(namen(zoekInLooplijst(straten, ["rozen", "klaver"]))).toEqual([
      "Rozenstraat",
      "2e Klaverstraat",
    ]);
  });
});

describe("filterLooplijst", () => {
  type F = Pick<LoopAdres, "id" | "klant_status" | "uitkomst">;
  const straten: { straat: string; heen: F[]; terug: F[] }[] = [
    {
      straat: "Rozenstraat",
      heen: [
        { id: "a", klant_status: null, uitkomst: null },
        { id: "b", klant_status: null, uitkomst: "niet_thuis" },
      ],
      terug: [{ id: "c", klant_status: "actief", uitkomst: null }],
    },
    {
      straat: "Anjerlaan",
      heen: [
        { id: "d", klant_status: null, uitkomst: "ja" },
        { id: "e", klant_status: "actief", uitkomst: "ja" },
        { id: "f", klant_status: "actief", uitkomst: "niet_thuis" },
      ],
      terug: [],
    },
  ];
  const ids = (lijst: typeof straten) =>
    lijst.flatMap((s) => [...s.heen, ...s.terug].map((r) => r.id));

  test("zonder tabje de hele lijst", () => {
    expect(filterLooplijst(straten, null)).toBe(straten);
  });
  test("te lopen: geen uitkomst en geen klant", () => {
    expect(ids(filterLooplijst(straten, "open"))).toEqual(["a"]);
  });
  test("een uitkomst, en een straat zonder treffers valt weg", () => {
    const uit = filterLooplijst(straten, "niet_thuis");
    expect(uit.map((s) => s.straat)).toEqual(["Rozenstraat"]);
    expect(ids(uit)).toEqual(["b"]);
  });
  test("een ja die klant werd blijft een ja, een andere uitkomst niet", () => {
    expect(ids(filterLooplijst(straten, "ja"))).toEqual(["d", "e"]);
    expect(ids(filterLooplijst(straten, "niet_thuis"))).toEqual(["b"]);
  });
  test("wat er stond toen je het tabje koos blijft staan", () => {
    expect(ids(filterLooplijst(straten, "niet_thuis", new Set(["d"])))).toEqual(["b", "d"]);
  });
});
