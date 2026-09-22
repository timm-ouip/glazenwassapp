import { describe, expect, test } from "bun:test";

import { frequentieKort, rekening, type GeldDeel } from "@/lib/betalingen";
import { metWachtende, pasToeOpAdres, type Wachtend } from "@/lib/geldloop-wachtrij";
import { nietGewassen, type GeldloopAdres, type GeldloopLijst } from "@/lib/geldlopen";

const wassen = (datum: string, bedrag: number, rest = bedrag, omschrijving = ""): GeldDeel => ({
  soort: "wassen",
  datum,
  bedrag,
  rest,
  aantal: 1,
  omschrijving,
});

describe("rekening", () => {
  test("gewone wasbeurten met dezelfde prijs op één regel", () => {
    const r = rekening([wassen("2026-07-10", 15), wassen("2026-09-12", 15)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.label).toContain("2× wassen");
    expect(r[0]!.wanneer).toBe("jul, sep");
    expect(r[0]!.bedrag).toBe(30);
  });

  test("klus en beginstand apart, beginstand bovenaan", () => {
    const r = rekening([
      wassen("2026-09-12", 28),
      {
        soort: "klus",
        datum: "2026-09-12",
        bedrag: 25,
        rest: 25,
        aantal: 1,
        omschrijving: "Dakgoot",
      },
      {
        soort: "beginstand",
        datum: "2026-09-01",
        bedrag: 30,
        rest: 30,
        aantal: 2,
        omschrijving: "2026-07,2026-08",
      },
    ]);
    expect(r.map((x) => x.label)).toEqual(["Van de kaart", "Wassen", "Klus: Dakgoot"]);
    expect(r[0]!.wanneer).toBe("jul, aug");
  });

  test("een deels betaalde wasbeurt staat apart als rest", () => {
    const r = rekening([wassen("2026-08-10", 15, 5), wassen("2026-09-10", 15)]);
    expect(r.map((x) => [x.label, x.bedrag])).toEqual([
      ["Wassen", 15],
      ["Wassen, rest", 5],
    ]);
  });
});

const adres = (extra: Partial<GeldloopAdres> = {}): GeldloopAdres => ({
  id: "a1",
  wijk_id: "w",
  wijk: "MS",
  wijk_sort: 0,
  straat_id: "s",
  straat: "Kerkstraat",
  straat_sort: 0,
  sort_desc: false,
  doorlopend: false,
  house_number: 12,
  addition: "",
  sort_order: 0,
  hoek_kant: "",
  naam: "",
  note: "",
  interval_maanden: 1,
  ritme: 1,
  methode: "contant",
  gestopt: false,
  open: 45,
  open_wassen: 3,
  delen: [wassen("2026-07-10", 15), wassen("2026-08-10", 15), wassen("2026-09-10", 15)],
  klachten: [],
  vaste_kortingen: [],
  kortingen_vanavond: [],
  vanavond: null,
  ...extra,
});

const tik = (extra: Partial<Wachtend>): Wachtend => ({
  id: "t1",
  adres: "a1",
  soort: "betaald",
  op: "2026-09-21T19:00:00Z",
  vrijgave: "v1",
  door: "me",
  door_naam: "Kees",
  ...extra,
});

describe("wachtrij: een tik in de lijst", () => {
  test("betaald haalt de oudste posten eerst weg", () => {
    const a = pasToeOpAdres(adres(), tik({ bedrag: 20 }));
    expect(a.open).toBe(25);
    expect(a.delen.map((d) => d.rest)).toEqual([10, 15]);
    expect(a.open_wassen).toBe(2);
    expect(a.vanavond?.soort).toBe("betaald");
  });

  test("korting komt bij de kortingen van vanavond", () => {
    const a = pasToeOpAdres(adres(), tik({ soort: "korting", bedrag: 5, reden: "Horren" }));
    expect(a.open).toBe(40);
    expect(a.kortingen_vanavond).toHaveLength(1);
  });

  test("een tik die de server al heeft, telt niet twee keer", () => {
    const een = pasToeOpAdres(adres(), tik({ bedrag: 45 }));
    const twee = pasToeOpAdres(een, tik({ bedrag: 45 }));
    expect(twee.open).toBe(0);
  });

  test("ongedaan maken zet betaald terug", () => {
    const betaald = pasToeOpAdres(adres(), tik({ bedrag: 45 }));
    const terug = pasToeOpAdres(betaald, tik({ id: "t2", soort: "ongedaan", herroept: "t1" }));
    expect(terug.open).toBe(45);
    expect(terug.vanavond).toBeNull();
  });

  test("alleen tikken van dezelfde avond tellen mee in de lijst", () => {
    const lijst: GeldloopLijst = {
      vrijgave: { id: "v1", datum: "2026-09-21", begin_op: "", eind_op: "", ingetrokken: false },
      adressen: [adres()],
      opgehaald: { mij: 0, mij_aantal: 0, totaal: 0 },
    };
    const uit = metWachtende(lijst, [
      tik({ bedrag: 45 }),
      tik({ id: "x", vrijgave: "v2", bedrag: 10 }),
    ]);
    expect(uit.adressen[0]!.open).toBe(0);
    expect(uit.opgehaald.mij).toBe(45);
  });
});

describe("frequentie", () => {
  test("om de maand zegt of het de even of de oneven maanden zijn", () => {
    expect(frequentieKort({ interval_maanden: 2, ritme: 2 })).toBe("om de maand, even");
    expect(frequentieKort({ interval_maanden: 2, ritme: 1 })).toBe("om de maand, oneven");
    expect(frequentieKort({ interval_maanden: 1, ritme: 1 })).toBe("elke maand");
  });
});

describe("pof maar deze maand niet gewassen", () => {
  // Dit jaar, want maandKort zet er bij een ander jaar "'26" achter.
  const jaar = new Date().getFullYear();
  const avond = `${jaar}-09-21`;
  const aug = adres({ open: 15, open_wassen: 1, delen: [wassen(`${jaar}-08-10`, 15)] });

  test("alleen pof van eerder: sep niet gewassen", () => {
    expect(nietGewassen(aug, avond)).toBe("sep niet gewassen");
    expect(nietGewassen({ ...aug, interval_maanden: 2, ritme: 2 }, avond)).toBe(
      "sep niet gewassen",
    );
  });
  test("deze maand gewassen: niets", () => {
    const a = { ...aug, delen: [...aug.delen, wassen(`${jaar}-09-10`, 15)] };
    expect(nietGewassen(a, avond)).toBeNull();
  });
  test("wasbeurt al betaald maar de klus van deze maand nog open: niets", () => {
    const klus: GeldDeel = {
      ...wassen(`${jaar}-09-10`, 25),
      soort: "klus",
      omschrijving: "dakgoot",
    };
    expect(nietGewassen({ ...aug, open: 25, delen: [klus] }, avond)).toBeNull();
  });
  test("niets open, maakt over of gestopt: niets", () => {
    expect(nietGewassen({ ...aug, open: 0 }, avond)).toBeNull();
    expect(nietGewassen({ ...aug, methode: "overmaken" }, avond)).toBeNull();
    expect(nietGewassen({ ...aug, gestopt: true }, avond)).toBeNull();
  });
});
