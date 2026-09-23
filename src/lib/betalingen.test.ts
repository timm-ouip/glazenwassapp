import { describe, expect, test } from "bun:test";

import { frequentieKaart, frequentieZin, rekening, type GeldDeel } from "@/lib/betalingen";
import { metWachtende, pasToeOpAdres, type Wachtend } from "@/lib/geldloop-wachtrij";
import { aanDeBeurt, type GeldloopAdres, type GeldloopLijst } from "@/lib/geldlopen";

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
    expect(r[0]!.label).toContain("2× wasbeurt");
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
    expect(r.map((x) => x.label)).toEqual(["2× wasbeurt", "Wasbeurt", "Klus: Dakgoot"]);
    expect(r[0]!.wanneer).toBe("jul, aug");
  });

  test("een deels betaalde wasbeurt staat apart als rest", () => {
    const r = rekening([wassen("2026-08-10", 15, 5), wassen("2026-09-10", 15)]);
    expect(r.map((x) => [x.label, x.bedrag])).toEqual([
      ["Wasbeurt", 15],
      ["Wasbeurt, rest", 5],
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
  wacht_op_wasbeurt: false,
  straat_lopers: [],
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
      opgehaald: {
        mij: 0,
        mij_aantal: 0,
        totaal: 0,
        mijn_open: 0,
        mijn_gedaan: 0,
        mijn_straten_open: 0,
        samen_open: 0,
        samen_gedaan: 0,
        samen_straten_open: 0,
      },
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
  test("in een halve zin: welke maanden er gewassen wordt", () => {
    expect(frequentieZin({ interval_maanden: 2, ritme: 2 })).toBe("even maanden");
    expect(frequentieZin({ interval_maanden: 2, ritme: 1 })).toBe("oneven maanden");
    expect(frequentieZin({ interval_maanden: 1, ritme: 1 })).toBe("elke maand");
  });
  test("in de smalle kolom op de kaart: zonder het woord maanden", () => {
    expect(frequentieKaart({ interval_maanden: 2, ritme: 2 })).toBe("even");
    expect(frequentieKaart({ interval_maanden: 2, ritme: 1 })).toBe("oneven");
    expect(frequentieKaart({ interval_maanden: 1, ritme: 1 })).toBe("elke maand");
    expect(frequentieKaart({ interval_maanden: 12, ritme: 1 })).toBe("1× per jaar");
  });
});

describe("aan de beurt", () => {
  test("wacht er deze maand nog een wasbeurt, dan bel je hier niet aan", () => {
    expect(aanDeBeurt(adres())).toBe(true);
    expect(aanDeBeurt(adres({ wacht_op_wasbeurt: true }))).toBe(false);
  });
});
