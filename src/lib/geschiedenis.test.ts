import { describe, expect, test } from "bun:test";

import {
  maakGeschiedenis,
  perMaand,
  type GedaneBeurt,
  type GeschiedenisBronnen,
  type GeschiedenisRechten,
} from "@/lib/geschiedenis";
import type { WijzigingGroep } from "@/lib/wijzigingen";

const ALLES: GeschiedenisRechten = {
  prijzen: true,
  bewerken: true,
  planOfBewerken: true,
  eigenaar: true,
};

const leeg = (deel: Partial<GeschiedenisBronnen> = {}): GeschiedenisBronnen => ({
  adresId: "a",
  beurten: [],
  gebeurtenissen: [],
  klachten: [],
  wijzigingen: [],
  geldloper: [],
  paaltje: [],
  ...deel,
});

const beurt = (deel: Partial<GedaneBeurt>): GedaneBeurt => ({
  id: crypto.randomUUID(),
  datum: "2026-09-15",
  ronde: "2026-09",
  ploeg_nr: 1,
  notitie: null,
  gedaan_op: "2026-09-15T16:00:00Z",
  niet_gewassen_op: null,
  niet_gewassen_naam: null,
  prijs: 12.5,
  ...deel,
});

const groep = (deel: Partial<WijzigingGroep>): WijzigingGroep => ({
  sleutel: crypto.randomUUID(),
  op: "2026-09-20T10:00:00Z",
  tabel: "adres_prijzen",
  rij_id: "a",
  bron: "app",
  door: "Timmie",
  regels: [
    {
      id: "p1",
      company_id: "c",
      tabel: "adres_prijzen",
      rij_id: "a",
      customer_id: "a",
      klant_id: null,
      veld: "prijs",
      voor: { prijs: 11.5 },
      na: { prijs: 12.5 },
      door: "u",
      door_naam: "Timmie",
      bron: "app",
      op: "2026-09-20T10:00:00Z",
      herroept: null,
      teruggedraaid_op: null,
      teruggedraaid_door: null,
      teruggedraaid_naam: null,
      verborgen_door: null,
      tekst: "Prijs gewijzigd van € 11,50 naar € 12,50",
    },
  ],
  ongedaanIds: ["p1"],
  teruggedraaid: null,
  ...deel,
});

const zonderNbsp = (s: string) => s.replace(/ /g, " ");

describe("maakGeschiedenis", () => {
  test("een beurt: team en Dag klaar, of de notitie", () => {
    const [a, b] = maakGeschiedenis(
      leeg({
        beurten: [beurt({}), beurt({ datum: "2026-08-12", ronde: "2026-08", notitie: "alleen voorkant" })],
      }),
      ALLES,
    );
    expect(zonderNbsp(a!.titel[0]!)).toBe("Gewassen · € 12,50");
    expect(a!.onder).toBe("team 1 · afgemeld met Dag klaar");
    expect(b!.onder).toBe("team 1 · alleen voorkant");
  });

  test("een beurt in een andere maand dan zijn ronde heet septemberbeurt", () => {
    const [a] = maakGeschiedenis(
      leeg({ beurten: [beurt({ datum: "2026-10-01", ronde: "2026-09" })] }),
      ALLES,
    );
    expect(a!.onder).toContain("septemberbeurt");
    expect(a!.datum).toBe("2026-10-01");
  });

  test("zonder prijzen_zien: geen bedrag en geen prijsregels", () => {
    const rechten = { ...ALLES, prijzen: false };
    const lijst = maakGeschiedenis(
      leeg({ beurten: [beurt({})], wijzigingen: [groep({})] }),
      rechten,
    );
    expect(lijst).toHaveLength(1);
    expect(lijst[0]!.titel[0]).toBe("Gewassen");
  });

  test("Ongedaan alleen met ids én het recht op het veld", () => {
    const [met] = maakGeschiedenis(leeg({ wijzigingen: [groep({})] }), ALLES);
    expect(met!.ongedaan).toEqual({ soort: "log", ids: ["p1"] });
    const [zonderRecht] = maakGeschiedenis(leeg({ wijzigingen: [groep({})] }), {
      ...ALLES,
      bewerken: false,
    });
    expect(zonderRecht!.ongedaan).toBeNull();
    const [zonderIds] = maakGeschiedenis(
      leeg({ wijzigingen: [groep({ ongedaanIds: [] })] }),
      ALLES,
    );
    expect(zonderIds!.ongedaan).toBeNull();
  });

  test("automatisch is geel, en wat Paaltje deed staat er één keer", () => {
    const lijst = maakGeschiedenis(
      leeg({
        wijzigingen: [groep({ bron: "systeem", door: "automatisch", ongedaanIds: [] })],
        paaltje: [
          {
            id: "m1",
            created_at: "2026-09-20T10:00:30Z",
            soort: "overslaan",
            maanden: ["2026-10"],
            automatisch: true,
            teruggedraaid_op: null,
          },
        ],
      }),
      ALLES,
    );
    expect(lijst).toHaveLength(1);
    expect(lijst[0]!.titel[0]).toBe("Oktober op overslaan gezet");
    expect(lijst[0]!.geel).toBe(true);
  });

  test("klachten over een ander adres van de klant staan er niet bij", () => {
    const klacht = {
      id: "k",
      klant_id: "kl",
      customer_id: "ander",
      omschrijving: "streep",
      bron: "mail" as const,
      ontvangen_op: "2026-08-03T09:00:00Z",
      status: "afgehandeld" as const,
      afgehandeld_op: "2026-08-05T09:00:00Z",
      door_paaltje: false,
      bericht_ids: [],
    };
    expect(maakGeschiedenis(leeg({ klachten: [klacht] }), ALLES)).toHaveLength(0);
    const [k] = maakGeschiedenis(leeg({ klachten: [{ ...klacht, customer_id: null }] }), ALLES);
    expect(k!.titel[0]).toBe("Klacht genoteerd: streep");
    expect(k!.onder).toBe("uit mail · afgehandeld op 5 aug");
  });
});

describe("na de review", () => {
  const melding = (deel: Record<string, unknown> = {}) => ({
    id: "g1",
    customer_id: "a",
    soort: "niet_gewassen" as const,
    voor: { datum: "2026-09-15" },
    na: {},
    adres: "Kerkstraat 12",
    door: "u",
    door_naam: "Kees",
    op: "2026-09-20T19:00:00Z",
    teruggedraaid_op: null,
    teruggedraaid_naam: null,
    ...deel,
  });

  test("open niet gewassen: Ongedaan bij de beurt, alleen voor de eigenaar", () => {
    const bronnen = leeg({
      beurten: [beurt({ niet_gewassen_op: "2026-09-20T19:00:00Z", niet_gewassen_naam: "Kees" })],
      geldloper: [melding()],
    });
    const lijst = maakGeschiedenis(bronnen, ALLES);
    expect(lijst).toHaveLength(1);
    expect(lijst[0]!.ongedaan).toEqual({ soort: "geldloper", id: "g1" });
    expect(maakGeschiedenis(bronnen, { ...ALLES, eigenaar: false })[0]!.ongedaan).toBeNull();
  });

  test("teruggedraaid niet gewassen blijft als eigen regel staan", () => {
    const lijst = maakGeschiedenis(
      leeg({
        beurten: [beurt({})],
        geldloper: [melding({ teruggedraaid_op: "2026-09-21T09:00:00Z", teruggedraaid_naam: "Timmie" })],
      }),
      ALLES,
    );
    expect(lijst).toHaveLength(2);
    expect(lijst.find((x) => x.sleutel === "geldloper-g1")!.teruggedraaid).toBe(true);
  });

  test("wat Paaltje terugdraaide staat er niet dubbel", () => {
    const lijst = maakGeschiedenis(
      leeg({
        wijzigingen: [
          groep({ op: "2026-09-25T08:00:10Z", bron: "systeem", door: "automatisch", ongedaanIds: [] }),
        ],
        paaltje: [
          {
            id: "m1",
            created_at: "2026-09-20T10:00:00Z",
            soort: "overslaan",
            maanden: ["2026-10"],
            automatisch: true,
            teruggedraaid_op: "2026-09-25T08:00:00Z",
          },
        ],
      }),
      ALLES,
    );
    expect(lijst.map((x) => x.sleutel)).toEqual(["paaltje-m1"]);
  });

  test("bij het systeem staat er alleen automatisch", () => {
    const [a] = maakGeschiedenis(
      leeg({ wijzigingen: [groep({ bron: "systeem", door: "automatisch", ongedaanIds: [] })] }),
      ALLES,
    );
    expect(a!.onder).toBe("automatisch");
  });
});

describe("perMaand", () => {
  test("nieuwste maand eerst, per maand gegroepeerd", () => {
    const lijst = maakGeschiedenis(
      leeg({
        beurten: [
          beurt({ datum: "2026-07-22" }),
          beurt({ datum: "2026-09-15" }),
          beurt({ datum: "2026-09-01" }),
        ],
      }),
      ALLES,
    );
    expect(perMaand(lijst).map((m) => [m.maand, m.regels.length])).toEqual([
      ["2026-09", 2],
      ["2026-07", 1],
    ]);
  });
});

describe("verhuizing", () => {
  const verhuisdGroep = (teruggedraaid_op: string | null) => {
    const g = groep({ tabel: "customers", bron: "systeem", op: "2026-09-20T10:00:00Z" });
    return {
      ...g,
      regels: [
        {
          ...g.regels[0]!,
          id: "v1",
          tabel: "customers",
          veld: "verhuisd",
          voor: { klant_id: "k1" },
          na: {},
          bron: "systeem",
          teruggedraaid_op,
          tekst: "Verhuisd: geschiedenis van de vorige bewoner verborgen",
        },
      ],
      ongedaanIds: [],
    };
  };
  const paaltje = (created_at: string) => ({
    id: created_at,
    created_at,
    soort: "overslaan",
    maanden: ["2026-10"],
    automatisch: false,
    teruggedraaid_op: null,
  });
  const bronnen = (teruggedraaid: string | null) =>
    leeg({
      wijzigingen: [verhuisdGroep(teruggedraaid)],
      beurten: [beurt({ datum: "2026-09-20" }), beurt({ datum: "2026-09-25" })],
      paaltje: [paaltje("2026-09-18T10:00:00Z"), paaltje("2026-09-22T10:00:00Z")],
    });

  test("wat van vóór de verhuizing is, staat er niet meer", () => {
    const regels = maakGeschiedenis(bronnen(null), ALLES);
    expect(regels.map((x) => x.datum)).toEqual(["2026-09-25", "2026-09-22", "2026-09-20"]);
    expect(regels.filter((x) => x.soort === "beurt")).toHaveLength(1);
  });

  test("teruggedraaid: alles is er weer", () => {
    expect(maakGeschiedenis(bronnen("2026-09-21T10:00:00Z"), ALLES)).toHaveLength(5);
  });
});
