import { describe, expect, test } from "bun:test";

import { adresVormen, zoekHooiberg, zoekPast, zoekSleutel } from "./zoeken";

const vindt = (hooiberg: string, term: string) => zoekPast(hooiberg, [zoekSleutel(term)]);

describe("zoekSleutel", () => {
  test("slaat hoofdletters, accenten en leestekens plat", () => {
    expect(zoekSleutel("Prins Hendrik-straat 12-A")).toBe("prins hendrik straat 12 a");
    expect(zoekSleutel("Café  Ruïne")).toBe("cafe ruine");
    expect(zoekSleutel("'s-Gravenhage")).toBe("s gravenhage");
  });
});

describe("adres zoeken", () => {
  // Werknaam "Lindel", officiële naam "Lindelaan"; een hoekadres aan de Kerkstraat.
  const hooiberg = zoekHooiberg([
    ...adresVormen(["Lindelaan", "Lindel"], 12, "A"),
    "Jansen",
    "2631 AB",
  ]);

  test("vindt op de officiële naam, de werknaam en een stuk ervan", () => {
    expect(vindt(hooiberg, "lindelaan")).toBe(true);
    expect(vindt(hooiberg, "Lindel")).toBe(true);
    expect(vindt(hooiberg, "linde")).toBe(true);
  });

  test("vindt straat met huisnummer, met of zonder spatie of streepje", () => {
    expect(vindt(hooiberg, "lindelaan 12")).toBe(true);
    expect(vindt(hooiberg, "Lindelaan 12a")).toBe(true);
    expect(vindt(hooiberg, "Lindelaan 12 a")).toBe(true);
    expect(vindt(hooiberg, "Lindelaan 12-a")).toBe(true);
    expect(vindt(hooiberg, "lindel 12a")).toBe(true);
  });

  test("vindt een ander huisnummer niet", () => {
    expect(vindt(hooiberg, "lindelaan 14")).toBe(false);
    expect(vindt(hooiberg, "kerkstraat")).toBe(false);
  });

  test("een term loopt niet over twee velden heen", () => {
    expect(vindt(hooiberg, "12a jansen")).toBe(false);
  });

  test("één treffer is genoeg, geen termen is alles", () => {
    expect(zoekPast(hooiberg, ["kerkstraat", "lindelaan"])).toBe(true);
    expect(zoekPast(hooiberg, [])).toBe(true);
  });
});

describe("adresVormen", () => {
  test("zonder toevoeging één vorm per naam, en dubbele namen tellen één keer", () => {
    expect(adresVormen(["Lindelaan", "lindelaan", ""], 12, "")).toEqual(["lindelaan 12"]);
  });
});
