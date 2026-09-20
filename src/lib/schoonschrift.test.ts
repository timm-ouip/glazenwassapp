import { describe, expect, test } from "bun:test";

import { netjesEmail, netjesPostcode, netjesStraat, netjesVeld } from "./schoonschrift";

describe("netjesPostcode", () => {
  test("maakt er 4 cijfers, een spatie en 2 hoofdletters van", () => {
    expect(netjesPostcode("1234ab")).toBe("1234 AB");
    expect(netjesPostcode("1234 ab")).toBe("1234 AB");
    expect(netjesPostcode(" 1234AB ")).toBe("1234 AB");
    expect(netjesPostcode("1234 ab")).toBe("1234 AB");
  });

  test("laat staan wat geen Nederlandse postcode is", () => {
    expect(netjesPostcode("B-2000")).toBe("B-2000");
    expect(netjesPostcode("  ")).toBe("");
    expect(netjesPostcode("12345")).toBe("12345");
  });
});

describe("netjesStraat", () => {
  test("begint met een hoofdletter", () => {
    expect(netjesStraat("kerkstraat")).toBe("Kerkstraat");
    expect(netjesStraat("  laan van meerdervoort ")).toBe("Laan van meerdervoort");
  });

  test("kent de IJ als één letter", () => {
    expect(netjesStraat("ijsselstraat")).toBe("IJsselstraat");
    expect(netjesStraat("Ijsselmeerweg")).toBe("IJsselmeerweg");
    expect(netjesStraat("IJsbaanpad")).toBe("IJsbaanpad");
    expect(netjesStraat("ij")).toBe("IJ");
  });

  test("laat de rest met rust", () => {
    expect(netjesStraat("de Ruijterstraat")).toBe("De Ruijterstraat");
    expect(netjesStraat("AMELAND")).toBe("AMELAND");
    expect(netjesStraat("'s-Gravenweg")).toBe("'s-Gravenweg");
    expect(netjesStraat("")).toBe("");
  });
});

describe("netjesEmail", () => {
  test("gaat in kleine letters", () => {
    expect(netjesEmail("  Piet@Voorbeeld.NL ")).toBe("piet@voorbeeld.nl");
    expect(netjesEmail("")).toBe("");
  });
});

describe("netjesVeld", () => {
  test("kiest de juiste behandeling per veld", () => {
    expect(netjesVeld("postcode", "1234ab")).toBe("1234 AB");
    expect(netjesVeld("straat", "kerkstraat")).toBe("Kerkstraat");
    expect(netjesVeld("email2", "A@B.NL")).toBe("a@b.nl");
    expect(netjesVeld("naam", "  Jan de Vries ")).toBe("Jan de Vries");
    expect(netjesVeld("notitie", " VH, D ")).toBe("VH, D");
  });
});
