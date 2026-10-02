import { describe, expect, test } from "bun:test";

import { jaarVakken, volgendeBeurtMaand } from "@/lib/dossier";
import {
  kaartDelen,
  kaartStandWoorden,
  kaartVakjesVan,
  leesVakInvoer,
  vakjeWoorden,
  vakTeken,
  vakVoor,
  vakWoorden,
  vooruitGepland,
  type KaartVakje,
} from "@/lib/geldkaart";
import type { Customer } from "@/lib/klanten";
import type { KaartAdres, KaartPost } from "@/lib/overzichten";

// Om de twee maanden, in de even maanden.
const adres = {
  id: "a",
  interval_maanden: 2,
  ritme: 2,
  overslaan: ["2026-12"],
  maandwerk: [],
  inactief_op: null,
} as unknown as Customer;

const beurt = (ronde: string, p: Partial<KaartPost> = {}): KaartPost => ({
  soort: "wassen",
  datum: `${ronde}-10`,
  ronde,
  bedrag: 12.5,
  aantal: 1,
  omschrijving: "",
  gedekt: 0,
  betaald_soort: null,
  vooruit: 0,
  betaald_op: null,
  betaald_door: null,
  ...p,
});

const kaart = (
  posten: KaartPost[],
  vooruit_over = 0,
  extra: Partial<KaartAdres> = {},
): KaartAdres => ({
  id: "a",
  posten,
  vooruit_over,
  vooruit_vast: 0,
  begin_vakjes: null,
  kaart_vooruit: null,
  gebeurtenissen: [],
  ...extra,
});

const teken = (data: KaartAdres | undefined, maand: string, gepland: string[] = []) =>
  vakTeken(vakVoor(adres, data, maand, null, undefined, gepland));

describe("vakVoor en vakTeken", () => {
  test("betaald, niet betaald, overgeslagen en niet aan de beurt", () => {
    const data = kaart([
      beurt("2026-06", {
        gedekt: 12.5,
        betaald_soort: "betaald",
        betaald_op: "2026-06-20T19:00:00Z",
      }),
      beurt("2026-08"),
    ]);
    expect(teken(data, "2026-06")).toBe("1");
    expect(teken(data, "2026-08")).toBe("0");
    expect(teken(data, "2026-12")).toBe("×");
    expect(teken(data, "2026-07")).toBe("%");
    expect(teken(data, "2026-10")).toBe("");
  });

  test("vooruit betaald is een B, ook als hij nog moet komen", () => {
    const data = kaart(
      [beurt("2026-08", { gedekt: 12.5, betaald_soort: "vooruit", vooruit: 12.5 })],
      2,
    );
    expect(teken(data, "2026-08")).toBe("B");
    expect(teken(data, "2026-10", ["2026-10"])).toBe("B");
  });
});

describe("geldkaart en het jaar op het Overzicht", () => {
  test("1× per 3 maanden: % buiten de frequentie, de volgende beurt leeg", () => {
    const kwartaal = {
      ...adres,
      interval_maanden: 3,
      ritme: 3,
      overslaan: [],
      start_maand: "2026-09",
    } as unknown as Customer;
    const volgende = volgendeBeurtMaand(kwartaal, null, "2026-10");
    const vak = (maand: string) => vakVoor(kwartaal, undefined, maand, "2026-09");
    expect(volgende).toBe("2026-12");
    // Het jaar op het Overzicht zet de oranje rand op dezelfde maand.
    const jaar = jaarVakken(2026, kwartaal, [], volgende, "2026-10");
    expect(jaar.find((v) => v.status === "volgende")?.maand).toBe(volgende!);
    // Op de geldkaart is die maand nog open (daar komt de "·"), de rest %.
    expect(vak("2026-12").soort).toBe("leeg");
    expect(vakTeken(vak("2026-10"))).toBe("%");
    expect(vakTeken(vak("2026-11"))).toBe("%");
    expect(vakTeken(vak("2026-09"))).toBe("");
  });
});

describe("vooruitGepland", () => {
  test("de beurten die over zijn, na de laatste gewassen beurt", () => {
    const data = kaart([beurt("2099-02")], 2);
    expect(vooruitGepland(adres, data)).toEqual(["2099-04", "2099-06"]);
  });
  test("een gestopt adres gebruikt ze niet meer", () => {
    const gestopt = { ...adres, inactief_op: "2026-09-01" } as Customer;
    expect(vooruitGepland(gestopt, kaart([], 2))).toEqual([]);
  });
});

describe("de kaart invullen: 0, x, letter, + en 1", () => {
  const begin = (bedrag: number, aantal: number, omschrijving: string, gedekt = 0): KaartPost => ({
    ...beurt("2026-09"),
    soort: "beginstand",
    datum: "2026-09-30",
    ronde: null,
    bedrag,
    aantal,
    omschrijving,
    gedekt,
  });
  const vakjes: KaartVakje[] = [
    { maand: "2026-06", teken: "0", bedrag: 12.5 },
    { maand: "2026-07", teken: "x", bedrag: 0 },
    { maand: "2026-08", teken: "v", bedrag: 8 },
    { maand: "2026-09", teken: "+", bedrag: 12.5 },
  ];
  const data = kaart([begin(33, 1, "2026-06,2026-08,2026-09,2026-08=v,2026-09=+")], 2, {
    begin_vakjes: vakjes,
    kaart_vooruit: { maanden: ["2026-10", "2026-12"], aantal: 2, over: 2 },
  });
  const t = (maand: string) => vakTeken(vakVoor(adres, data, maand, "2026-09"));

  test("elk vakje komt terug zoals het is ingevuld", () => {
    expect(t("2026-06")).toBe("0");
    expect(t("2026-07")).toBe("×");
    expect(t("2026-08")).toBe("v");
    expect(t("2026-09")).toBe("+12,5");
    expect(t("2026-10")).toBe("1");
    expect(t("2026-12")).toBe("1");
    expect(vakVoor(adres, data, "2026-10", "2026-09")).toEqual({
      soort: "vooruit",
      gepland: true,
      kaart: true,
    });
  });

  test("een 1 blijft alleen licht zolang er beurten van over zijn", () => {
    // November overgeslagen, december gewassen: die ene beurt is op.
    const op = kaart(
      [beurt("2026-12", { gedekt: 12.5, betaald_soort: "vooruit", vooruit: 12.5 })],
      0,
      {
        kaart_vooruit: { maanden: ["2026-11"], aantal: 1, over: 0 },
      },
    );
    expect(vakVoor(adres, op, "2026-11", "2026-09").soort === "vooruit").toBe(false);
    expect(vakTeken(vakVoor(adres, op, "2026-12", "2026-09"))).toBe("B");
    // Net ingevuld (nog niet bewaard) staat hij er wel.
    const concept: KaartVakje[] = [{ maand: "2026-11", teken: "1", bedrag: 0 }];
    expect(vakTeken(vakVoor(adres, op, "2026-11", "2026-09", concept))).toBe("1");
  });

  test("de enen van de kaart tellen niet nog eens als geplande B", () => {
    expect(vooruitGepland(adres, data)).toEqual([]);
  });

  test("een oude beginstand (alleen maanden) is een rij nullen", () => {
    const oud = kaart([begin(25, 2, "2026-07,2026-08")]);
    expect(kaartVakjesVan(oud, "2026-09").map((v) => `${v.maand}${v.teken}`)).toEqual([
      "2026-070",
      "2026-080",
    ]);
  });

  test("een ingetypt bedrag staat als 0 in de startmaand", () => {
    const getypt = kaart([begin(40, 3, "")]);
    expect(kaartVakjesVan(getypt, "2026-09")).toEqual([
      { maand: "2026-09", teken: "0", bedrag: 40, ingetypt: true },
    ]);
  });

  test("een beginstand van alleen +5 die betaald is, telt als één keer betaald", () => {
    const betaald = kaart(
      [
        {
          ...begin(5, 0, "2026-09,2026-09=+", 5),
          betaald_soort: "betaald",
          betaald_op: "2026-10-12T19:00:00Z",
        },
      ],
      0,
      { begin_vakjes: [{ maand: "2026-09", teken: "+", bedrag: 5 }] },
    );
    expect(vakTeken(vakVoor(adres, betaald, "2026-10", "2026-09"))).toBe("1");
  });
});

describe("leesVakInvoer", () => {
  test("de tekens van de papieren kaart", () => {
    expect(leesVakInvoer("0")).toEqual({ teken: "0", bedrag: 0 });
    expect(leesVakInvoer("X")).toEqual({ teken: "x", bedrag: 0 });
    expect(leesVakInvoer("1")).toEqual({ teken: "1", bedrag: 0 });
    expect(leesVakInvoer("v 8")).toEqual({ teken: "v", bedrag: 8 });
    expect(leesVakInvoer("A12,50")).toEqual({ teken: "a", bedrag: 12.5 });
    expect(leesVakInvoer("+5")).toEqual({ teken: "+", bedrag: 5 });
    expect(leesVakInvoer("+ € 7.25")).toEqual({ teken: "+", bedrag: 7.25 });
  });
  test("wat niet kan, met uitleg", () => {
    expect("fout" in leesVakInvoer("b 8")).toBe(true);
    expect("fout" in leesVakInvoer("v")).toBe(true);
    expect("fout" in leesVakInvoer("+0")).toBe(true);
    expect("fout" in leesVakInvoer("x 5")).toBe(true);
    expect("fout" in leesVakInvoer("vv 8")).toBe(true);
  });
});

describe("kaartDelen", () => {
  const nul = (maand: string, bedrag = 12.5): KaartVakje => ({ maand, teken: "0", bedrag });
  test("alleen het deel dat verandert gaat mee", () => {
    const was = [nul("2026-07"), { maand: "2026-10", teken: "1", bedrag: 0 }];
    expect(kaartDelen([...was, { maand: "2026-12", teken: "1", bedrag: 0 }], was)).toEqual({
      begin: null,
      vooruit: ["2026-10", "2026-12"],
    });
    expect(kaartDelen([nul("2026-07"), nul("2026-08")], was)).toEqual({
      begin: [nul("2026-07"), nul("2026-08")],
      vooruit: [],
    });
  });
  test("een 0 met een andere (oude) prijs is niet anders", () => {
    expect(kaartDelen([nul("2026-07", 15)], [nul("2026-07", 12.5)]).begin).toBeNull();
  });
  test("een ingetypt bedrag blijft staan tot je het vervangt of wist", () => {
    const getypt: KaartVakje = { ...nul("2026-09", 40), ingetypt: true };
    expect(kaartDelen([getypt], [getypt]).begin).toBeNull();
    expect(kaartDelen([], [getypt]).begin).toEqual([]);
  });
});

describe("vakjes in woorden", () => {
  // Spaties in een bedrag kunnen een harde spatie zijn; vergelijk zonder.
  const plat = (t: string) => t.replace(/\s/g, " ");
  const kort = (vak: Parameters<typeof vakWoorden>[0]) => vakWoorden(vak).kort.map(plat);
  const lang = (vak: Parameters<typeof vakWoorden>[0]) => plat(vakWoorden(vak).lang);

  test("betaald, korting, niet aan de beurt en leeg", () => {
    expect(kort({ soort: "betaald", aantal: 1, korting: false })).toEqual(["1"]);
    expect(kort({ soort: "betaald", aantal: 2, korting: false })).toEqual(["2"]);
    expect(lang({ soort: "betaald", aantal: 1, korting: true })).toBe("Met korting afgeboekt");
    expect(lang({ soort: "niet_aan_de_beurt" })).toBe("Niet aan de beurt");
    expect(vakWoorden({ soort: "leeg" })).toEqual({ kort: [], lang: "" });
  });

  test("open, met het bedrag", () => {
    expect(kort({ soort: "open", nogOpen: true, bedrag: 30 })).toEqual(["0"]);
    expect(lang({ soort: "open", nogOpen: true, bedrag: 12.5 })).toBe("Open · € 12,50");
    expect(lang({ soort: "open", nogOpen: false, bedrag: 30 })).toBe(
      "Stond open (€ 30), later betaald",
    );
  });

  test("wat er op de kaart staat", () => {
    const v = { maand: "2026-07", teken: "v", bedrag: 8 };
    expect(lang({ soort: "open", nogOpen: true, kaart: v })).toBe("Alleen voorkant · € 8 open");
    expect(kort({ soort: "open", nogOpen: true, kaart: v })).toEqual(["Voorkant", "€ 8"]);
    const q = { maand: "2026-07", teken: "q", bedrag: 8 };
    expect(lang({ soort: "open", nogOpen: true, kaart: q })).toBe("Deels gewassen · € 8 open");
    const plus = { maand: "2026-07", teken: "+", bedrag: 5 };
    expect(lang({ soort: "open", nogOpen: true, kaart: plus })).toBe("€ 5 te weinig betaald");
    expect(kort({ soort: "overgeslagen", kaart: true })).toEqual(["x"]);
    expect(lang({ soort: "vooruit", gepland: true, kaart: true })).toBe(
      "Al betaald, van de papieren kaart",
    );
    expect(lang({ soort: "vooruit", gepland: false })).toBe("Vooruit betaald");
  });

  // Een vakje op de straatkaart is op de telefoon zo'n 58 pixels breed:
  // hooguit negen tekens per regel, en een bedrag tot € 999,99.
  test("elke regel in een vakje is kort", () => {
    const vakken: Parameters<typeof vakWoorden>[0][] = [
      { soort: "betaald", aantal: 2, korting: false },
      { soort: "open", nogOpen: true, bedrag: 123.45 },
      { soort: "open", nogOpen: true, kaart: { maand: "2026-07", teken: "+", bedrag: 12.5 } },
      { soort: "open", nogOpen: false, bedrag: 30 },
      { soort: "overgeslagen", kaart: true },
      { soort: "vooruit", gepland: true, kaart: true },
      { soort: "open", nogOpen: true, kaart: { maand: "2026-07", teken: "a", bedrag: 12.5 } },
      { soort: "vooruit", gepland: false, meerOpen: true },
      { soort: "overgeslagen" },
      { soort: "niet_aan_de_beurt" },
    ];
    for (const vak of vakken) {
      const regels = vakWoorden(vak).kort;
      expect(regels.length <= 2).toBe(true);
      for (const r of regels) expect(r.length <= 9).toBe(true);
    }
  });

  test("het log: hoe een maand stond", () => {
    expect(plat(kaartStandWoorden({ vakje: { teken: "0", bedrag: 27 }, een: false }))).toBe(
      "Open · € 27",
    );
    expect(kaartStandWoorden({ vakje: null, een: true })).toBe("Al betaald (van de kaart)");
    expect(kaartStandWoorden({ vakje: null, een: false })).toBe("Leeg");
    expect(kaartStandWoorden(null)).toBe("Leeg");
    expect(vakjeWoorden({ teken: "x", bedrag: 0 })).toBe("Niet gewassen");
  });
});
