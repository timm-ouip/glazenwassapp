import { describe, expect, test } from "bun:test";

import {
  frequentieKaart,
  frequentieZin,
  rekening,
  omrekenen,
  terugBedrag,
  terugTekst,
  vooruitEerst,
  vooruitMaanden,
  vooruitNieuweMaanden,
  vooruitStart,
  keerOpen,
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

  test("kaart met twee prijzen: een regel per prijs, zoals op een factuur", () => {
    const kaart = (rest: number) =>
      rekening([
        {
          soort: "beginstand",
          datum: "2026-09-30",
          bedrag: 55,
          rest,
          aantal: 3,
          omschrijving:
            "2026-07,2026-08,2026-09,2026-06=v,2026-06~8.00~v,2026-07~15.00~0,2026-08~15.00~0,2026-09~17.00~0",
        },
      ]).map((r) => [r.label, r.wanneer, r.bedrag]);
    expect(kaart(55)).toEqual([
      [`2× wasbeurt à ${formatPrice(15)}`, "jul, aug", 30],
      ["Wasbeurt", "sep", 17],
      ["Wasbeurt, v", "jun", 8],
    ]);
    // € 20 betaald: eerst juni (€ 8), dan € 12 van juli.
    expect(kaart(35)).toEqual([
      ["Wasbeurt", "aug", 15],
      ["Wasbeurt", "sep", 17],
      ["Wasbeurt, rest", "jul", 3],
    ]);
  });

  test("kaart zonder bedragen per maand blijft één regel", () => {
    const r = rekening([
      {
        soort: "beginstand",
        datum: "2026-09-30",
        bedrag: 30,
        rest: 30,
        aantal: 2,
        omschrijving: "2026-07,2026-08",
      },
    ]);
    expect(r).toHaveLength(1);
  });

  test("prijs per beurt alleen als het de prijs van nu is", () => {
    const kaart = (bedrag: number, aantal: number, prijs?: number) =>
      rekening(
        [
          {
            soort: "beginstand",
            datum: "2026-09-01",
            bedrag,
            rest: bedrag,
            aantal,
            omschrijving: "",
          },
        ],
        prijs,
      )[0]!.label;
    expect(kaart(64, 8, 8)).toBe(`8× wasbeurt à ${formatPrice(8)}`);
    // € 15 + € 17: netjes te delen, maar "à € 16" heeft nooit bestaan.
    expect(kaart(32, 2, 17)).toBe("2× wasbeurt");
    expect(kaart(50, 3, 16.5)).toBe("3× wasbeurt");
    expect(kaart(64, 8)).toBe("8× wasbeurt");
  });

  test("een beginstand met een letter of + van de kaart", () => {
    const r = rekening([
      {
        soort: "beginstand",
        datum: "2026-09-30",
        bedrag: 25.5,
        rest: 25.5,
        aantal: 1,
        omschrijving: "2026-07,2026-08,2026-09,2026-08=v,2026-09=+",
      },
    ]);
    expect(r[0]!.label).toBe("Van de kaart");
    expect(r[0]!.wanneer).toBe("jul, aug v, sep +");
    expect(r[0]!.bedrag).toBe(25.5);
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
  // Geen beurt van nu bekend: de open beurten tellen vanaf de oudste.
  vooruit_vanaf: "2026-07-10",
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
  test("de beurt van nu is beurt 1; oudere pof blijft pof", () => {
    // Juli, augustus en september open; de database zegt: vanaf september.
    const a = pasToeOpAdres(
      adres({ vooruit_vanaf: "2026-09-10" }),
      tik({ soort: "vooruit", aantal: 4, prijs_per_beurt: 15, bedrag: 60 }),
    );
    expect(a.open).toBe(30);
    expect(a.delen.map((d) => d.datum)).toEqual(["2026-07-10", "2026-08-10"]);
    expect(a.open_wassen).toBe(2);
    expect(a.vooruit_over).toBe(3);
    expect(a.vooruit_waarde).toBe(45);
    expect(a.vanavond?.soort).toBe("vooruit");
    expect(a.vanavond?.aantal).toBe(4);
  });

  test("nog beurten vooruit: een nieuwe betaling laat de pof staan", () => {
    const a = pasToeOpAdres(
      // De laatste beurt (september) is al met vooruit betaald: vanaf de dag erna.
      adres({
        open: 15,
        delen: [wassen("2026-07-10", 15)],
        vooruit_over: 1,
        vooruit_waarde: 15,
        vooruit_vanaf: "2026-09-11",
      }),
      tik({ soort: "vooruit", aantal: 2, prijs_per_beurt: 15, bedrag: 30 }),
    );
    expect(a.open).toBe(15);
    expect(a.delen).toHaveLength(1);
    expect(a.vooruit_over).toBe(3);
  });

  test("geen beurt van nu open: de open beurten tellen als eerste, oudste eerst", () => {
    const a = pasToeOpAdres(
      adres(),
      tik({ soort: "vooruit", aantal: 4, prijs_per_beurt: 15, bedrag: 60 }),
    );
    expect(a.open).toBe(0);
    expect(a.delen).toHaveLength(0);
    expect(a.open_wassen).toBe(0);
    expect(a.vooruit_over).toBe(1);
    expect(a.vooruit_waarde).toBe(15);
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
      // Vanaf augustus (de oudste): augustus gebruikt de beurt.
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

describe("vooruit: vanaf welke beurt (van de database)", () => {
  const elkeMaand = { interval_maanden: 1, ritme: 1 };

  test("de open beurten vanaf de datum tellen als eerste; oudere pof niet", () => {
    const delen = [wassen("2026-08-10", 15), wassen("2026-09-28", 15)];
    expect(vooruitEerst(delen, "2026-09-28").map((d) => d.datum)).toEqual(["2026-09-28"]);
  });

  test("vanaf de oudste: alle open beurten, oudste eerst", () => {
    const delen = [wassen("2026-07-10", 15), wassen("2026-06-10", 15)];
    expect(vooruitEerst(delen, "2026-06-10").map((d) => d.datum)).toEqual([
      "2026-06-10",
      "2026-07-10",
    ]);
  });

  test("de dag na de laatste beurt: geen open beurt telt", () => {
    // Alle beurten op, of de laatste betaald met een 1 van de kaart: juli blijft pof.
    expect(vooruitEerst([wassen("2026-07-10", 15)], "2026-09-29")).toEqual([]);
  });

  test("twee open beurten op die dag: allebei", () => {
    const delen = [wassen("2026-09-28", 15), wassen("2026-09-28", 10)];
    expect(vooruitEerst(delen, "2026-09-28")).toHaveLength(2);
  });

  test("al vooruit betaald (alleen de meerprijs open) telt niet", () => {
    const meer = { ...wassen("2026-09-28", 20, 5, "serre"), vooruit: 15 };
    expect(vooruitEerst([meer], "2026-09-28")).toEqual([]);
  });

  test("zonder datum (oude lijst): alle open beurten", () => {
    expect(vooruitEerst([wassen("2026-07-10", 15)], null)).toHaveLength(1);
  });

  test("4 beurten met de beurt van nu open: sep, okt, nov, dec", () => {
    const delen = [wassen("2026-09-28", 15)];
    expect(vooruitNieuweMaanden(elkeMaand, 4, delen, "2026-09-28", 0, "2026-11")).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });

  test("met de frequentie: om de maand", () => {
    const delen = [wassen("2026-09-28", 15)];
    expect(
      vooruitNieuweMaanden({ interval_maanden: 2, ritme: 1 }, 3, delen, "2026-09-28", 0, "2026-11"),
    ).toEqual(["2026-09", "2026-11", "2027-01"]);
  });

  test("al betaald: alleen komende beurten, vanaf start", () => {
    expect(vooruitNieuweMaanden(elkeMaand, 2, [], "2026-09-29", 0, "2026-11")).toEqual([
      "2026-11",
      "2026-12",
    ]);
  });

  test("enen van de kaart in okt en nov, september open: sep, dan na de enen", () => {
    const delen = [wassen("2026-09-28", 15)];
    expect(vooruitNieuweMaanden(elkeMaand, 3, delen, "2026-09-28", 2, "2026-11")).toEqual([
      "2026-09",
      "2026-12",
      "2027-01",
    ]);
  });

  test("oude pof en nog beurten vooruit: de pof telt niet, de beurten gaan voor", () => {
    const delen = [wassen("2026-07-10", 15)];
    expect(vooruitNieuweMaanden(elkeMaand, 2, delen, "2026-09-29", 1, "2026-11")).toEqual([
      "2026-12",
      "2027-01",
    ]);
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
    expect(terugTekst({ ...leeg, eigen: 1, eigenWaarde: 12.5 })).toBe(
      `1 beurt = ${formatPrice(12.5)}`,
    );
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

describe("keerOpen", () => {
  test("hele en halve beurten", () => {
    expect(keerOpen(3)).toBe("3×");
    expect(keerOpen(1.5)).toBe("1,5×");
    expect(keerOpen(1.4)).toBe("1,5×");
  });
  test("niets open is leeg", () => {
    expect(keerOpen(0)).toBe("");
    expect(keerOpen(0.2)).toBe("");
  });
});
