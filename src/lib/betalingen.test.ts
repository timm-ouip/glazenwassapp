import { describe, expect, test } from "bun:test";

import {
  frequentieKaart,
  frequentieZin,
  rekening,
  omrekenen,
  terugBedrag,
  terugTekst,
  vooruitMaanden,
  vooruitStart,
  vooruitTot,
  type GeldDeel,
} from "@/lib/betalingen";
import { formatPrice } from "@/lib/klanten";
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
  vooruit_over: 0,
  vooruit_vast: 0,
  vooruit_vorige_waarde: 0,
  vooruit_eigen_waarde: 0,
  vooruit_waarde: 0,
  vooruit_p: 15,
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

describe("wachtrij: vooruit betalen", () => {
  test("de open beurten tellen als eerste, de rest blijft over", () => {
    const a = pasToeOpAdres(
      adres(),
      tik({ soort: "vooruit", aantal: 4, prijs_per_beurt: 15, bedrag: 60 }),
    );
    expect(a.open).toBe(0);
    expect(a.delen).toHaveLength(0);
    expect(a.open_wassen).toBe(0);
    expect(a.vooruit_over).toBe(1);
    expect(a.vooruit_waarde).toBe(15);
    expect(a.vanavond?.soort).toBe("vooruit");
    expect(a.vanavond?.aantal).toBe(4);
  });

  test("de papieren kaart en een klus gebruiken geen beurt", () => {
    const a = pasToeOpAdres(
      adres({
        open: 45,
        delen: [
          {
            soort: "beginstand",
            datum: "2026-06-01",
            bedrag: 20,
            rest: 20,
            aantal: 1,
            omschrijving: "",
          },
          wassen("2026-09-10", 15),
          { soort: "klus", datum: "2026-09-10", bedrag: 10, rest: 10, aantal: 1, omschrijving: "" },
        ],
      }),
      tik({ soort: "vooruit", aantal: 2, prijs_per_beurt: 15, bedrag: 30 }),
    );
    expect(a.open).toBe(30);
    expect(a.delen.map((d) => d.soort)).toEqual(["beginstand", "klus"]);
    expect(a.vooruit_over).toBe(1);
  });

  test("een duurdere beurt: het verschil blijft open, en telt niet als open wasbeurt", () => {
    const a = pasToeOpAdres(
      adres({ open: 20, delen: [wassen("2026-09-10", 20, 20, "serre")] }),
      tik({ soort: "vooruit", aantal: 1, prijs_per_beurt: 15, bedrag: 15 }),
    );
    expect(a.open).toBe(5);
    expect(a.delen[0]!.rest).toBe(5);
    expect(a.open_wassen).toBe(0);
    expect(rekening(a.delen)[0]!.label).toBe("Meerprijs");
  });

  test("met een vaste korting: de gewone beurt is helemaal gedekt", () => {
    // € 15 min horren € 2 = € 13 per beurt; de beurt van € 15 is gewoon betaald.
    const a = pasToeOpAdres(
      adres({
        open: 15,
        delen: [wassen("2026-09-10", 15)],
        vaste_kortingen: [{ id: "k", naam: "Horren", bedrag: 2 }],
      }),
      tik({ soort: "vooruit", aantal: 3, prijs_per_beurt: 13, bedrag: 39 }),
    );
    expect(a.open).toBe(0);
    expect(a.delen).toHaveLength(0);
    expect(a.vooruit_over).toBe(2);
    expect(a.vooruit_waarde).toBe(26);
  });

  test("een goedkopere beurt: het verschil wordt tegoed", () => {
    const a = pasToeOpAdres(
      adres({ open: 10, delen: [wassen("2026-09-10", 10)] }),
      tik({ soort: "vooruit", aantal: 1, prijs_per_beurt: 15, bedrag: 15 }),
    );
    expect(a.open).toBe(-5);
    expect(a.vooruit_over).toBe(0);
  });

  test("al deels met euro's betaald: dat geld gaat naar de volgende post", () => {
    const a = pasToeOpAdres(
      adres({
        open: 25,
        delen: [wassen("2026-08-10", 15, 10), wassen("2026-09-10", 15)],
      }),
      tik({ soort: "vooruit", aantal: 1, prijs_per_beurt: 15, bedrag: 15 }),
    );
    expect(a.open).toBe(10);
    expect(a.delen.map((d) => d.rest)).toEqual([10]);
  });

  test("ongedaan maken: wat over was gaat eraf, wat gebruikt was komt weer open", () => {
    const vooruit = pasToeOpAdres(
      adres(),
      tik({ soort: "vooruit", aantal: 4, prijs_per_beurt: 15, bedrag: 60 }),
    );
    const terug = pasToeOpAdres(vooruit, tik({ id: "t2", soort: "ongedaan", herroept: "t1" }));
    expect(terug.open).toBe(45);
    expect(terug.vooruit_over).toBe(0);
    expect(terug.vanavond).toBeNull();
  });

  test("vooruit telt mee als opgehaald", () => {
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
      tik({ soort: "vooruit", aantal: 4, prijs_per_beurt: 15, bedrag: 60 }),
    ]);
    expect(uit.opgehaald.mij).toBe(60);
    expect(uit.opgehaald.mij_aantal).toBe(1);
  });
});

describe("vooruit: welke maanden", () => {
  test("elke maand, vanaf de startmaand, over de jaargrens", () => {
    expect(vooruitMaanden({ interval_maanden: 1, ritme: 1 }, 4, "2026-11")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  test("om de maand: alleen de even maanden, en overslaan telt niet", () => {
    expect(
      vooruitMaanden({ interval_maanden: 2, ritme: 2, overslaan: ["2026-12"] }, 3, "2026-09"),
    ).toEqual(["2026-10", "2027-02", "2027-04"]);
  });

  test("niets over: geen maanden", () => {
    expect(vooruitMaanden({ interval_maanden: 1, ritme: 1 }, 0, "2026-09")).toEqual([]);
  });

  test("t/m welke maand, en vanaf wanneer", () => {
    const nu = new Date(2026, 8, 30);
    expect(vooruitTot({ interval_maanden: 1, ritme: 1 }, 3, "2026-10", nu)).toBe("dec");
    expect(vooruitTot({ interval_maanden: 1, ritme: 1 }, 4, "2026-10", nu)).toBe("jan '27");
    // De beurt van september is al gewassen: dan vanaf oktober.
    expect(vooruitStart("2026-09", nu)).toBe("2026-10");
    // De laatste beurt was in juli: september telt nog.
    expect(vooruitStart("2026-07", nu)).toBe("2026-09");
    expect(vooruitStart(null, nu)).toBe("2026-09");
  });
});

describe("terug te geven", () => {
  const leeg = { vorige: 0, vorigeWaarde: 0, eigen: 0, eigenWaarde: 0, open: 0, gestopt: true };
  test("gestopt: eigen beurten plus tegoed in één regel", () => {
    expect(terugTekst({ ...leeg, eigen: 2, eigenWaarde: 25, open: -2.5 })).toBe(
      `2 beurten (${formatPrice(25)}) + tegoed ${formatPrice(2.5)} = ${formatPrice(27.5)}`,
    );
  });
  test("gestopt: alleen beurten", () => {
    expect(terugTekst({ ...leeg, eigen: 1, eigenWaarde: 12.5 })).toBe(`1 beurt = ${formatPrice(12.5)}`);
  });
  test("gestopt: alleen tegoed", () => {
    expect(terugTekst({ ...leeg, open: -5 })).toBe(`tegoed ${formatPrice(5)}`);
  });
  test("gestopt: wat er open staat gaat van de eigen beurten af", () => {
    expect(terugTekst({ ...leeg, eigen: 2, eigenWaarde: 25, open: 5 })).toBe(
      `2 beurten (${formatPrice(25)}) − nog open ${formatPrice(5)} = ${formatPrice(20)}`,
    );
  });
  test("gestopt: de pof van B gaat niet van de beurten van A af", () => {
    const t = { ...leeg, vorige: 2, vorigeWaarde: 25, open: 15 };
    expect(terugBedrag(t)).toBe(25);
    expect(terugTekst(t)).toBe(`2 beurten van de vorige bewoner = ${formatPrice(25)}`);
  });
  test("gestopt: beurten van A plus de eigen beurt van B", () => {
    const t = { ...leeg, vorige: 2, vorigeWaarde: 25, eigen: 1, eigenWaarde: 12.5 };
    expect(terugBedrag(t)).toBe(37.5);
    expect(terugTekst(t)).toBe(
      `2 beurten van de vorige bewoner (${formatPrice(25)}) + 1 beurt (${formatPrice(12.5)}) = ${formatPrice(37.5)}`,
    );
  });
  test("loopt: alleen de beurten van de vorige bewoner, tegoed blijft staan", () => {
    const t = { ...leeg, vorige: 2, vorigeWaarde: 25, open: -10, gestopt: false };
    expect(terugBedrag(t)).toBe(25);
    expect(terugTekst(t)).toBe(`2 beurten van de vorige bewoner = ${formatPrice(25)}`);
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

describe("omrekenen na een prijsverhoging", () => {
  test("hetzelfde geld, minder beurten, de rest tegoed", () => {
    expect(omrekenen(37.5, 15)).toEqual({ beurten: 2, tegoed: 7.5 });
  });
  test("past precies", () => {
    expect(omrekenen(45, 15)).toEqual({ beurten: 3, tegoed: 0 });
  });
  test("geen centen kwijt door afronding", () => {
    expect(omrekenen(37.5, 12.51)).toEqual({ beurten: 2, tegoed: 12.48 });
  });
  test("minder dan één beurt: alles tegoed", () => {
    expect(omrekenen(10, 15)).toEqual({ beurten: 0, tegoed: 10 });
  });
});
