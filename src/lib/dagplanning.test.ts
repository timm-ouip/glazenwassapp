import { describe, expect, test } from "bun:test";

import {
  berekenTijden,
  duurTekst,
  maakBlokken,
  minutenVan,
  nogInTePlannen,
  opzetVan,
  STANDAARD_INSTELLINGEN,
  stelWeekVoor,
  tijdVan,
  tijdvakVan,
  volPercentage,
  type AdresInfo,
  type DagRegel,
  type StraatInfo,
  type WijkInfo,
} from "@/lib/dagplanning";

const wijken = new Map<string, WijkInfo>([
  ["w1", { id: "w1", naam: "Markgraaf", sort_order: 1, index: 0 }],
  ["w2", { id: "w2", naam: "Othilde", sort_order: 2, index: 1 }],
]);
const straten = new Map<string, StraatInfo>([
  ["s1", { id: "s1", naam: "Markgraaf A", wijk_id: "w1", sort_order: 1 }],
  ["s2", { id: "s2", naam: "Markgraaf CD", wijk_id: "w1", sort_order: 2 }],
  ["s3", { id: "s3", naam: "Othilde", wijk_id: "w2", sort_order: 1 }],
]);

function adres(
  id: string,
  straat: string,
  nummer: number,
  duur: number,
  eigenBlok = false,
): AdresInfo {
  return {
    id,
    street_id: straat,
    sort_order: nummer,
    house_number: nummer,
    addition: "",
    naam: `${straten.get(straat)?.naam} ${nummer}`,
    duur,
    bedrag: duur,
    eigenBlok,
  };
}

function regel(id: string, extra: Partial<DagRegel> = {}): DagRegel {
  return {
    customer_id: id,
    ploeg_nr: null,
    volgorde: null,
    rest: false,
    vaste_start: null,
    ...extra,
  };
}

describe("tijd omrekenen", () => {
  test("heen en terug", () => {
    expect(minutenVan("08:30")).toBe(510);
    expect(minutenVan("00:00")).toBe(0);
    expect(minutenVan("")).toBeNull();
    expect(minutenVan("onzin")).toBeNull();
    expect(tijdVan(510)).toBe("08:30");
    expect(tijdVan(0)).toBe("00:00");
  });

  test("duur in woorden", () => {
    expect(duurTekst(25)).toBe("25m");
    expect(duurTekst(60)).toBe("1u");
    expect(duurTekst(80)).toBe("1u20");
    expect(duurTekst(0)).toBe("0m");
  });
});

describe("blokken maken", () => {
  const adressen = new Map<string, AdresInfo>([
    ["a1", adres("a1", "s1", 2, 25)],
    ["a2", adres("a2", "s1", 4, 30)],
    ["a3", adres("a3", "s2", 10, 20)],
    ["a4", adres("a4", "s3", 3, 90, true)], // groot pand
  ]);

  test("een straat wordt één blok, een groot pand staat apart", () => {
    const per = maakBlokken({
      regels: [regel("a1"), regel("a2"), regel("a3"), regel("a4")],
      adressen,
      straten,
      wijken,
    });
    const blokken = per.get(0) ?? [];
    expect(blokken.map((b) => b.titel)).toEqual(["Markgraaf A", "Markgraaf CD", "Othilde 3"]);
    expect(blokken[0]!.duur).toBe(55);
    expect(blokken[0]!.adressen).toEqual(["a1", "a2"]);
    expect(blokken[2]!.soort).toBe("pand");
  });

  test("de rest van een straat is een eigen blok", () => {
    const per = maakBlokken({
      regels: [regel("a1"), regel("a2", { rest: true })],
      adressen,
      straten,
      wijken,
    });
    const blokken = per.get(0) ?? [];
    expect(blokken.map((b) => b.titel)).toEqual(["Markgraaf A", "Markgraaf A (rest)"]);
  });

  test("ploegen staan los, en de volgorde telt", () => {
    const per = maakBlokken({
      regels: [
        regel("a3", { ploeg_nr: 1, volgorde: 10 }),
        regel("a1", { ploeg_nr: 1, volgorde: 20 }),
        regel("a2", { ploeg_nr: 1, volgorde: 20 }),
        regel("a4", { ploeg_nr: 2 }),
      ],
      adressen,
      straten,
      wijken,
    });
    expect((per.get(1) ?? []).map((b) => b.titel)).toEqual(["Markgraaf CD", "Markgraaf A"]);
    expect((per.get(2) ?? []).map((b) => b.titel)).toEqual(["Othilde 3"]);
    expect(per.get(0)).toBeUndefined();
  });

  test("een extra opdracht is ook een blok", () => {
    const per = maakBlokken({
      regels: [regel("a1")],
      klussen: [
        {
          id: "k1",
          customer_id: "a1",
          omschrijving: "Goot",
          duur: 40,
          bedrag: 50,
          ploeg_nr: null,
          volgorde: 5,
          vaste_start: null,
        },
      ],
      adressen,
      straten,
      wijken,
    });
    const blokken = per.get(0) ?? [];
    expect(blokken[0]!.soort).toBe("klus");
    expect(blokken[0]!.titel).toBe("Goot — Markgraaf A 2");
  });
});

describe("tijden rekenen", () => {
  const adressen = new Map<string, AdresInfo>([
    ["a1", adres("a1", "s1", 2, 80)],
    // Een groot pand in een andere wijk: dat geeft ook rijtijd.
    ["a2", adres("a2", "s3", 3, 65, true)],
  ]);
  const blokken = [
    ...(maakBlokken({ regels: [regel("a1"), regel("a2")], adressen, straten, wijken }).get(0) ??
      []),
  ];

  test("in de rij, met rijtijd tussen twee wijken", () => {
    const t = berekenTijden(blokken, opzetVan(STANDAARD_INSTELLINGEN));
    expect(t.items.map((i) => `${tijdVan(i.start)} ${i.soort} ${i.minuten}`)).toEqual([
      "08:00 straat 80",
      "09:20 rijtijd 15",
      "09:35 pand 65",
    ]);
    expect(t.werkMin).toBe(160);
    // 08:00–16:30 is 8u30, min een half uur pauze = 8u.
    expect(t.capaciteitMin).toBe(480);
    expect(t.teVol).toBe(false);
    expect(volPercentage(t)).toBe(33);
  });

  test("met twee man gaat het twee keer zo snel", () => {
    const opzet = { ...opzetVan(STANDAARD_INSTELLINGEN), mensen: 2 };
    const t = berekenTijden(blokken, opzet);
    expect(t.items[0]!.minuten).toBe(40);
    expect(t.werkMin).toBe(40 + 15 + 33);
  });

  test("de pauze valt op de eerste bloknaad na de pauzetijd", () => {
    const lang = new Map<string, AdresInfo>([
      ["b1", adres("b1", "s1", 2, 300)],
      ["b2", adres("b2", "s2", 4, 60)],
    ]);
    const lijst =
      maakBlokken({ regels: [regel("b1"), regel("b2")], adressen: lang, straten, wijken }).get(0) ??
      [];
    const t = berekenTijden(lijst, opzetVan(STANDAARD_INSTELLINGEN));
    // Het eerste blok duurt tot 13:00; je stopt niet halverwege een straat,
    // dus de pauze schuift mee naar de eerste naad erna.
    expect(t.items.map((i) => `${tijdVan(i.start)} ${i.soort}`)).toEqual([
      "08:00 straat",
      "13:00 pauze",
      "13:30 straat",
    ]);
  });

  test("een vastgezet blok wacht tot zijn tijd", () => {
    const lijst =
      maakBlokken({
        regels: [regel("a1"), regel("a2", { vaste_start: "13:00" })],
        adressen,
        straten,
        wijken,
      }).get(0) ?? [];
    const t = berekenTijden(lijst, opzetVan(STANDAARD_INSTELLINGEN));
    const pand = t.items.find((i) => i.soort === "pand");
    expect(tijdVan(pand!.start)).toBe("13:00");
  });

  test("te veel werk loopt over de eindtijd", () => {
    const veel = new Map<string, AdresInfo>([["c1", adres("c1", "s1", 2, 600)]]);
    const lijst =
      maakBlokken({ regels: [regel("c1")], adressen: veel, straten, wijken }).get(0) ?? [];
    const t = berekenTijden(lijst, opzetVan(STANDAARD_INSTELLINGEN));
    expect(t.teVol).toBe(true);
    expect(volPercentage(t)).toBe(125);
  });
});

describe("tijdvak", () => {
  test("twee uur, op halve uren, met speling vooraf", () => {
    expect(tijdvakVan(minutenVan("10:25")!)).toEqual({ van: "09:30", tot: "11:30" });
    expect(tijdvakVan(minutenVan("08:00")!, "08:00")).toEqual({ van: "08:00", tot: "10:00" });
    expect(tijdvakVan(minutenVan("13:40")!)).toEqual({ van: "13:00", tot: "15:00" });
  });
});

describe("nog in te plannen en het voorstel", () => {
  const open = nogInTePlannen(
    [
      adres("a1", "s1", 2, 60),
      adres("a2", "s1", 4, 60),
      adres("a3", "s2", 10, 120),
      adres("a4", "s3", 3, 90),
    ],
    straten,
    wijken,
  );

  test("straten in de volgorde van de ronde", () => {
    expect(open.map((b) => `${b.titel} ${b.duur}`)).toEqual([
      "Markgraaf A 120",
      "Markgraaf CD 120",
      "Othilde 90",
    ]);
  });

  test("het voorstel vult de vrije ruimte, zonder te forceren", () => {
    const voorstel = stelWeekVoor(open, [
      { datum: "2026-10-07", ploeg_nr: 1, vrij: 150, mensen: 1 },
      { datum: "2026-10-08", ploeg_nr: 1, vrij: 300, mensen: 1 },
    ]);
    expect(voorstel).toEqual([
      { datum: "2026-10-07", ploeg_nr: 1, blokken: [open[0]!] },
      { datum: "2026-10-08", ploeg_nr: 1, blokken: [open[1]!, open[2]!] },
    ]);
  });
});
