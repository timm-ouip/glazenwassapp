/**
 * De factuur-PDF, hier zelf opgebouwd.
 *
 * Bewust geen omzetdienst van buiten: dan zou er een derde partij tussen
 * zitten die je klantgegevens langs ziet komen, die maandgeld kost, en die
 * bij storing je hele facturering plat legt. Zelf tekenen is wat strakker van
 * vorm, maar het resultaat is elke keer identiek en er kan niets tussenuit
 * vallen.
 *
 * Eigen briefpapier (fase 2) gaat er als achterlaag onder: eerst het papier,
 * daarna de tekst erop. Dat papier heeft meestal zelf al een kop met naam,
 * adres en logo, dus dan zetten wij die niet nog eens neer -- en houdt de
 * tekst boven- en onderaan de ruimte vrij die `kaderBoven`/`kaderOnder`
 * aangeven.
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

/** Het briefpapier zoals het uit de opslagbak komt. */
export interface FactuurBriefpapier {
  bytes: Uint8Array;
  soort: "pdf" | "png" | "jpg";
}

export interface FactuurVormgeving {
  briefpapier?: FactuurBriefpapier;
  /** Millimeters die boven- en onderaan vrij blijven voor dat papier. */
  kaderBoven: number;
  kaderOnder: number;
  /** Zelf een kop met naam en adres zetten. Uit als het papier die al heeft. */
  eigenKop: boolean;
  /** Zelf de regel met KvK, btw-nummer en IBAN onderaan zetten. */
  eigenVoet: boolean;
  /** Accentkleur als "#rrggbb"; leeg is het gewone zwart-grijs. */
  kleur?: string;
  /** Een zin boven de regels, bijvoorbeeld waar deze factuur over gaat. */
  koptekst?: string;
  /** Losse tekst onderaan, boven de KvK-regel. */
  voettekst?: string;
}

/** Zonder briefpapier: de vorm zoals de facturen tot nu toe de deur uit gingen. */
export const STANDAARD_VORMGEVING: FactuurVormgeving = {
  kaderBoven: 20,
  kaderOnder: 20,
  eigenKop: true,
  eigenVoet: true,
};

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
  vormgeving?: Partial<FactuurVormgeving>;
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
/** Eén millimeter in PDF-punten. */
const MM = 72 / 25.4;

/** "1.234,56" — Nederlands, met een euroteken ervoor. */
export function euro(n: number): string {
  const negatief = n < 0;
  const centen = Math.round(Math.abs(n) * 100);
  const heel = Math.floor(centen / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (centen % 100).toString().padStart(2, "0");
  // Het euroteken zelf, niet "EUR": pdf-lib zet zijn standaardletters neer met
  // /WinAnsiEncoding, en daar zit de € gewoon in (byte 0x80). Los uitgeprobeerd
  // met een proef-PDF, want een fout hierin komt pas naar boven als er al een
  // factuurnummer getrokken is.
  return `${negatief ? "-" : ""}€ ${heel},${rest}`;
}

/** "28-03-2026" */
export function datum(iso: string): string {
  const [j, m, d] = iso.split("-");
  return `${d}-${m}-${j}`;
}

/** "#1b6ac8" naar een pdf-lib-kleur; alles wat er niet op lijkt valt terug. */
function kleurUit(hex: string | undefined, terugval: ReturnType<typeof rgb>) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return terugval;
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function maakFactuurPdf(f: FactuurGegevens): Promise<Uint8Array> {
  const v: FactuurVormgeving = { ...STANDAARD_VORMGEVING, ...f.vormgeving };
  const pdf = await PDFDocument.create();
  const gewoon = await pdf.embedFont(StandardFonts.Helvetica);
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold);
  const zwart = rgb(0.1, 0.1, 0.12);
  const grijs = rgb(0.45, 0.45, 0.5);
  const accent = kleurUit(v.kleur, zwart);
  const lijnkleur = kleurUit(v.kleur, grijs);

  // Het briefpapier één keer inladen. Gaat dat mis -- een beschadigd bestand,
  // een PDF met een wachtwoord -- dan gaat de factuur gewoon zonder papier de
  // deur uit. Hier stukgaan zou betekenen dat een factuur die net zijn nummer
  // heeft getrokken geen PDF meer krijgt, en dat is veel erger dan een kale
  // bladzijde.
  let papier: Awaited<ReturnType<typeof pdf.embedPdf>>[number] | undefined;
  let plaatje: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
  if (v.briefpapier) {
    try {
      if (v.briefpapier.soort === "pdf") {
        const bron = await PDFDocument.load(v.briefpapier.bytes, { ignoreEncryption: true });
        [papier] = await pdf.embedPdf(bron, [0]);
      } else if (v.briefpapier.soort === "png") {
        plaatje = await pdf.embedPng(v.briefpapier.bytes);
      } else {
        plaatje = await pdf.embedJpg(v.briefpapier.bytes);
      }
    } catch (e) {
      console.error("Briefpapier overgeslagen:", e instanceof Error ? e.message : e);
    }
  }

  // De grenzen van het tekstvlak. Buiten deze twee blijft het papier zelf aan
  // het woord.
  const boven = A4.hoogte - Math.max(v.kaderBoven, 0) * MM;
  const onder = Math.max(v.kaderOnder, 0) * MM;
  const rechts = A4.breedte - KANTLIJN;

  let blad = pdf.addPage([A4.breedte, A4.hoogte]);
  let y = boven;

  const achtergrond = () => {
    if (papier) blad.drawPage(papier, { x: 0, y: 0, width: A4.breedte, height: A4.hoogte });
    else if (plaatje) {
      blad.drawImage(plaatje, { x: 0, y: 0, width: A4.breedte, height: A4.hoogte });
    }
  };
  const nieuwBlad = () => {
    blad = pdf.addPage([A4.breedte, A4.hoogte]);
    y = boven;
    achtergrond();
  };
  achtergrond();

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

  /** Vrije tekst over meerdere regels verdelen, zodat niets de kantlijn uit loopt. */
  const breek = (tekst: string, grootte: number, breedte: number): string[] => {
    const uit: string[] = [];
    const past = (t: string) => gewoon.widthOfTextAtSize(alleenBekend(t), grootte) <= breedte;
    for (const stuk of tekst.replace(/\r/g, "").split("\n")) {
      let regel = "";
      for (let woord of stuk.split(/\s+/).filter(Boolean)) {
        // Een woord dat in zijn eentje al te breed is -- een lang webadres in
        // de voettekst -- knippen we hard door. Alleen tussen woorden knippen
        // laat zo'n regel de bladzijde uit lopen, en dan valt het staartje
        // gewoon van het papier.
        while (!past(woord)) {
          let hap = woord;
          while (hap.length > 1 && !past(hap)) hap = hap.slice(0, -1);
          if (regel) {
            uit.push(regel);
            regel = "";
          }
          uit.push(hap);
          woord = woord.slice(hap.length);
        }
        if (!woord) continue;
        const kandidaat = regel ? `${regel} ${woord}` : woord;
        if (regel && !past(kandidaat)) {
          uit.push(regel);
          regel = woord;
        } else {
          regel = kandidaat;
        }
      }
      uit.push(regel);
    }
    return uit;
  };

  // --- Kop: wie stuurt dit ---------------------------------------------
  if (v.eigenKop) {
    schrijf(f.bedrijf.naam, KANTLIJN, y, { groot: 17, vet: true, kleur: accent });
    y -= 16;
    for (const regel of [
      [f.bedrijf.adres, `${f.bedrijf.postcode} ${f.bedrijf.plaats}`].filter(Boolean).join(", "),
      [f.bedrijf.telefoon, f.bedrijf.email].filter(Boolean).join(" · "),
    ]) {
      if (!regel.trim()) continue;
      schrijf(regel, KANTLIJN, y, { kleur: grijs });
      y -= 12;
    }
    y -= 26;
  }

  // --- Aan wie ----------------------------------------------------------
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
  let yr = bovenkantBlok;
  schrijf(f.soort === "credit" ? "CREDITFACTUUR" : "FACTUUR", 0, yr, {
    groot: 8,
    vet: true,
    kleur: accent,
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

  // --- Waar deze factuur over gaat --------------------------------------
  if (v.koptekst?.trim()) {
    for (const regel of breek(v.koptekst.trim(), 9.5, rechts - KANTLIJN)) {
      schrijf(regel, KANTLIJN, y);
      y -= 13;
    }
    y -= 12;
  }

  // --- De regels --------------------------------------------------------
  const kolomBedrag = rechts;
  const kolomBtw = rechts - 78;
  const kolomDatum = KANTLIJN;
  const kolomOmschrijving = KANTLIJN + 62;

  const kolomkoppen = () => {
    schrijf("DATUM", kolomDatum, y, { groot: 8, vet: true, kleur: grijs });
    schrijf("OMSCHRIJVING", kolomOmschrijving, y, { groot: 8, vet: true, kleur: grijs });
    schrijf("BTW", 0, y, { groot: 8, vet: true, kleur: grijs, rechts: kolomBtw });
    schrijf("BEDRAG", 0, y, { groot: 8, vet: true, kleur: grijs, rechts: kolomBedrag });
    y -= 6;
    blad.drawLine({
      start: { x: KANTLIJN, y },
      end: { x: rechts, y },
      thickness: 0.6,
      color: lijnkleur,
    });
    y -= 15;
  };
  kolomkoppen();

  for (const r of f.regels) {
    // Onder deze grens past de afsluiting (subtotaal, btw, te betalen en het
    // betaalblok) er niet meer onder; dan liever een nieuw blad.
    if (y < onder + 110) {
      nieuwBlad();
      kolomkoppen();
    }
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

  if (y < onder + 130) nieuwBlad();
  y -= 8;
  blad.drawLine({
    start: { x: kolomBtw - 60, y },
    end: { x: rechts, y },
    thickness: 0.6,
    color: lijnkleur,
  });
  y -= 16;
  schrijf("Subtotaal", 0, y, { kleur: grijs, rechts: kolomBtw });
  schrijf(euro(excl), 0, y, { rechts: kolomBedrag });
  y -= 14;
  schrijf("Btw", 0, y, { kleur: grijs, rechts: kolomBtw });
  schrijf(euro(btw), 0, y, { rechts: kolomBedrag });
  y -= 18;
  schrijf("Te betalen", 0, y, { vet: true, groot: 11, rechts: kolomBtw });
  schrijf(euro(incl), 0, y, { vet: true, groot: 11, kleur: accent, rechts: kolomBedrag });

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

  // --- Eigen slotwoord --------------------------------------------------
  if (v.voettekst?.trim()) {
    y -= 14;
    const regels = breek(v.voettekst.trim(), 8.5, rechts - KANTLIJN);
    if (y - regels.length * 11 < onder) nieuwBlad();
    for (const regel of regels) {
      schrijf(regel, KANTLIJN, y, { groot: 8.5, kleur: grijs });
      y -= 11;
    }
  }

  // --- Voet -------------------------------------------------------------
  // Net onder het tekstvlak: dit hóórt in de ondermarge, en staat die vol met
  // briefpapier, dan zet je hem uit.
  if (v.eigenVoet) {
    const voet = [
      f.bedrijf.kvk && `KvK ${f.bedrijf.kvk}`,
      f.bedrijf.btw && `Btw ${f.bedrijf.btw}`,
      f.bedrijf.iban && `IBAN ${f.bedrijf.iban}`,
    ]
      .filter(Boolean)
      .join("  ·  ");
    if (voet) schrijf(voet, KANTLIJN, Math.max(onder - 14, 14), { groot: 8, kleur: grijs });
  }

  return await pdf.save();
}
