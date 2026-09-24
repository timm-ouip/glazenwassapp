/**
 * De factuur-PDF, hier zelf opgebouwd.
 *
 * Bewust geen omzetdienst van buiten: dan zou er een derde partij tussen
 * zitten die je klantgegevens langs ziet komen, die maandgeld kost, en die
 * bij storing je hele facturering plat legt. Zelf tekenen is wat strakker van
 * vorm, maar het resultaat is elke keer identiek en er kan niets tussenuit
 * vallen.
 *
 * Het ge-uploade briefpapier (fase 2) komt hier straks als achterlaag onder;
 * de indeling houdt daar links en boven alvast ruimte voor.
 */
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

export interface FactuurBedrijf {
  naam: string;
  adres: string;
  postcode: string;
  plaats: string;
  telefoon: string;
  email: string;
  kvk: string;
  btw: string;
  iban: string;
}

export interface FactuurKlant {
  naam: string;
  bedrijfsnaam?: string;
  straat?: string;
  huisnummer?: string;
  postcode?: string;
  plaats?: string;
  kvk?: string;
  btw_nummer?: string;
}

export interface FactuurRegel {
  datum: string;
  omschrijving: string;
  notitie: string;
  bedrag_excl: number;
  btw_bedrag: number;
  bedrag_incl: number;
  btw_procent: number;
}

export interface FactuurGegevens {
  nummer: string;
  soort: "factuur" | "credit";
  factuurdatum: string;
  vervaldatum: string;
  /** Toont de bedragen inclusief btw als hoofdgetal (particulier). */
  inclusief: boolean;
  bedrijf: FactuurBedrijf;
  klant: FactuurKlant;
  regels: FactuurRegel[];
  betaallink?: string;
}

/**
 * De standaardletters van pdf-lib kennen alleen West-Europese tekens. Eén
 * emoji in een dagnotitie of een Poolse ł in een naam laat het tekenen
 * klappen — en dat gebeurt ná het vastzetten, dus dan zit de factuur muurvast
 * met een nummer en zonder PDF. Daarom hier alles wat er niet in past
 * vervangen in plaats van erop stuk te lopen.
 */
function alleenBekend(tekst: string): string {
  let uit = "";
  for (const teken of tekst) {
    const code = teken.codePointAt(0) ?? 0;
    // Latin-1 plus het stukje daarboven dat WinAnsi nog wél kent.
    uit += code <= 0xff || (code >= 0x20ac && code <= 0x20ac) ? teken : "?";
  }
  return uit;
}

const A4 = { breedte: 595.28, hoogte: 841.89 };
const KANTLIJN = 56;

/** "1.234,56" — Nederlands, met een euroteken ervoor. */
export function euro(n: number): string {
  const negatief = n < 0;
  const centen = Math.round(Math.abs(n) * 100);
  const heel = Math.floor(centen / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (centen % 100).toString().padStart(2, "0");
  return `${negatief ? "-" : ""}EUR ${heel},${rest}`;
}

/** "28-03-2026" */
export function datum(iso: string): string {
  const [j, m, d] = iso.split("-");
  return `${d}-${m}-${j}`;
}

export async function maakFactuurPdf(f: FactuurGegevens): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const gewoon = await pdf.embedFont(StandardFonts.Helvetica);
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold);
  const zwart = rgb(0.1, 0.1, 0.12);
  const grijs = rgb(0.45, 0.45, 0.5);

  let blad = pdf.addPage([A4.breedte, A4.hoogte]);
  let y = A4.hoogte - KANTLIJN;

  const schrijf = (
    tekst: string,
    x: number,
    yy: number,
    opts: { groot?: number; vet?: boolean; kleur?: typeof zwart; rechts?: number } = {},
  ) => {
    const grootte = opts.groot ?? 9.5;
    const font = opts.vet ? vet : gewoon;
    tekst = alleenBekend(tekst);
    const breedte = font.widthOfTextAtSize(tekst, grootte);
    blad.drawText(tekst, {
      x: opts.rechts !== undefined ? opts.rechts - breedte : x,
      y: yy,
      size: grootte,
      font,
      color: opts.kleur ?? zwart,
    });
  };

  // --- Kop: wie stuurt dit ---------------------------------------------
  schrijf(f.bedrijf.naam, KANTLIJN, y, { groot: 17, vet: true });
  y -= 16;
  for (const regel of [
    [f.bedrijf.adres, `${f.bedrijf.postcode} ${f.bedrijf.plaats}`].filter(Boolean).join(", "),
    [f.bedrijf.telefoon, f.bedrijf.email].filter(Boolean).join(" · "),
  ]) {
    if (!regel.trim()) continue;
    schrijf(regel, KANTLIJN, y, { kleur: grijs });
    y -= 12;
  }

  // --- Aan wie ----------------------------------------------------------
  y -= 26;
  const bovenkantBlok = y;
  schrijf("AAN", KANTLIJN, y, { groot: 8, vet: true, kleur: grijs });
  y -= 14;
  const klantregels = [
    f.klant.bedrijfsnaam?.trim() || f.klant.naam,
    f.klant.bedrijfsnaam?.trim() ? f.klant.naam : "",
    [f.klant.straat, f.klant.huisnummer].filter(Boolean).join(" "),
    [f.klant.postcode, f.klant.plaats].filter(Boolean).join("  "),
  ].filter((r) => r && r.trim());
  for (const regel of klantregels) {
    schrijf(regel, KANTLIJN, y);
    y -= 12;
  }

  // --- Welke factuur ----------------------------------------------------
  const rechts = A4.breedte - KANTLIJN;
  let yr = bovenkantBlok;
  schrijf(f.soort === "credit" ? "CREDITFACTUUR" : "FACTUUR", 0, yr, {
    groot: 8,
    vet: true,
    kleur: grijs,
    rechts,
  });
  yr -= 16;
  for (const [label, waarde] of [
    ["Nummer", f.nummer],
    ["Datum", datum(f.factuurdatum)],
    ["Vervaldatum", datum(f.vervaldatum)],
  ]) {
    schrijf(label, 0, yr, { kleur: grijs, rechts: rechts - 90 });
    schrijf(waarde, 0, yr, { vet: true, rechts });
    yr -= 13;
  }

  y = Math.min(y, yr) - 30;

  // --- De regels --------------------------------------------------------
  const kolomBedrag = rechts;
  const kolomBtw = rechts - 78;
  const kolomDatum = KANTLIJN;
  const kolomOmschrijving = KANTLIJN + 62;

  schrijf("DATUM", kolomDatum, y, { groot: 8, vet: true, kleur: grijs });
  schrijf("OMSCHRIJVING", kolomOmschrijving, y, { groot: 8, vet: true, kleur: grijs });
  schrijf("BTW", 0, y, { groot: 8, vet: true, kleur: grijs, rechts: kolomBtw });
  schrijf("BEDRAG", 0, y, { groot: 8, vet: true, kleur: grijs, rechts: kolomBedrag });
  y -= 6;
  blad.drawLine({
    start: { x: KANTLIJN, y },
    end: { x: rechts, y },
    thickness: 0.6,
    color: grijs,
  });
  y -= 15;

  const nieuwBlad = () => {
    blad = pdf.addPage([A4.breedte, A4.hoogte]);
    y = A4.hoogte - KANTLIJN;
  };

  for (const r of f.regels) {
    if (y < 150) nieuwBlad();
    schrijf(datum(r.datum), kolomDatum, y, { kleur: grijs });
    // Afkappen in plaats van door de kolom heen lopen: een lange VvE-naam
    // mag het bedrag niet overschrijven.
    let tekst = r.omschrijving;
    const ruimte = kolomBtw - kolomOmschrijving - 10;
    while (gewoon.widthOfTextAtSize(tekst, 9.5) > ruimte && tekst.length > 4) {
      tekst = tekst.slice(0, -2);
    }
    schrijf(tekst === r.omschrijving ? tekst : tekst + "…", kolomOmschrijving, y);
    schrijf(`${r.btw_procent}%`, 0, y, { kleur: grijs, rechts: kolomBtw });
    schrijf(euro(f.inclusief ? r.bedrag_incl : r.bedrag_excl), 0, y, { rechts: kolomBedrag });
    y -= 13;
    if (r.notitie.trim()) {
      schrijf(r.notitie, kolomOmschrijving, y, { groot: 8.5, kleur: grijs });
      y -= 12;
    }
  }

  // --- Optellen ---------------------------------------------------------
  const excl = f.regels.reduce((t, r) => t + r.bedrag_excl, 0);
  const btw = f.regels.reduce((t, r) => t + r.btw_bedrag, 0);
  const incl = f.regels.reduce((t, r) => t + r.bedrag_incl, 0);

  if (y < 170) nieuwBlad();
  y -= 8;
  blad.drawLine({
    start: { x: kolomBtw - 60, y },
    end: { x: rechts, y },
    thickness: 0.6,
    color: grijs,
  });
  y -= 16;
  schrijf("Subtotaal", 0, y, { kleur: grijs, rechts: kolomBtw });
  schrijf(euro(excl), 0, y, { rechts: kolomBedrag });
  y -= 14;
  schrijf("Btw", 0, y, { kleur: grijs, rechts: kolomBtw });
  schrijf(euro(btw), 0, y, { rechts: kolomBedrag });
  y -= 18;
  schrijf("Te betalen", 0, y, { vet: true, groot: 11, rechts: kolomBtw });
  schrijf(euro(incl), 0, y, { vet: true, groot: 11, rechts: kolomBedrag });

  // --- Hoe te betalen ---------------------------------------------------
  y -= 34;
  const termijn = `Graag betalen vóór ${datum(f.vervaldatum)}`;
  schrijf(termijn, KANTLIJN, y, { vet: true });
  y -= 13;
  if (f.bedrijf.iban) {
    schrijf(`Overmaken naar ${f.bedrijf.iban} onder vermelding van ${f.nummer}.`, KANTLIJN, y, {
      kleur: grijs,
    });
    y -= 12;
  }
  if (f.betaallink) {
    schrijf(`Of betaal direct online: ${f.betaallink}`, KANTLIJN, y, { kleur: grijs });
    y -= 12;
  }

  // --- Voet -------------------------------------------------------------
  const voet = [
    f.bedrijf.kvk && `KvK ${f.bedrijf.kvk}`,
    f.bedrijf.btw && `Btw ${f.bedrijf.btw}`,
    f.bedrijf.iban && `IBAN ${f.bedrijf.iban}`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (voet) schrijf(voet, KANTLIJN, KANTLIJN - 16, { groot: 8, kleur: grijs });

  return await pdf.save();
}
