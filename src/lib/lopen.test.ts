import { describe, expect, test } from "bun:test";

import { nummerSleutel } from "./postcode";
import {
  adresOmschrijving,
  klantMatchSleutel,
  leesPrijs,
  looplijstVolgorde,
  voorstelUitleg,
  woningtypeTekst,
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
