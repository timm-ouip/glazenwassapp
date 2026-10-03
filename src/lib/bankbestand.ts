/**
 * Een bankbestand lezen: de afschriften die je bij de bank downloadt.
 *
 * Drie soorten, want elke bank doet het anders:
 *
 *   CAMT.053  XML, de opvolger van MT940. Alle Nederlandse banken kunnen dit.
 *   MT940     het oude tekstformaat. Sommige banken stoppen ermee.
 *   CSV       de CSV van ASN (en de andere banken van de Volksbank: SNS,
 *             RegioBank). Geen kopregel, negentien kolommen.
 *
 * Het lezen gebeurt hier, in de browser: het bestand zelf gaat nergens heen.
 * Alleen de bijschrijvingen (geld dat binnenkwam) gaan naar de database
 * (`bank_inlezen`), en daar wordt gekeken bij welke factuur ze horen.
 * Afschrijvingen tellen we alleen, om te kunnen zeggen dat ze overgeslagen
 * zijn.
 */

export type BankBron = "camt053" | "mt940" | "csv";

/** Eén bijschrijving, zoals de database hem wil hebben. */
export interface BankRegel {
  /** jjjj-mm-dd */
  datum: string;
  /** Altijd positief: alleen geld dat binnenkwam. */
  bedrag: number;
  tegen_iban: string;
  tegen_naam: string;
  omschrijving: string;
  /** Betalingskenmerk of end-to-end-referentie, als de klant die gaf. */
  kenmerk: string;
  /** De eigen referentie van de bank, om dubbel inlezen te herkennen. */
  ref: string;
}

export interface BankBestand {
  bron: BankBron;
  regels: BankRegel[];
  /** Hoeveel afschrijvingen er overgeslagen zijn. */
  afschrijvingen: number;
}

export class BankbestandFout extends Error {}

/** Groter dan dit is geen afschrift van een glazenwasser. */
export const MAX_BESTAND = 10 * 1024 * 1024;

/**
 * De tekst uit het bestand. Banken schrijven niet allemaal UTF-8: MT940 en
 * CSV komen vaak als Windows-1252, en dan wordt "Müller" anders "M�ller".
 */
export function bestandTekst(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Herkent het soort bestand en leest het. */
export function leesBankbestand(tekst: string): BankBestand {
  const t = tekst.replace(/^\uFEFF/, "");
  if (/<Document[\s>]/.test(t) && /camt\.05[234]/.test(t)) return leesCamt(t);
  if (/<Document[\s>]/.test(t)) {
    throw new BankbestandFout(
      "Dit is een XML-bestand, maar geen CAMT.053-afschrift. Kies bij je bank CAMT.053.",
    );
  }
  if (/^:20:/m.test(t) && /^:61:/m.test(t)) return leesMt940(t);
  const csv = leesAsnCsv(t);
  if (csv) return csv;
  throw new BankbestandFout(
    "Dit bestand herken ik niet. Download bij je bank de afschriften als CAMT.053, MT940 of CSV.",
  );
}

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** "1.234,56", "1234.56", "45,00", "45" → 1234.56 enz. */
export function bedragUit(tekst: string): number {
  let t = tekst.trim().replace(/\s/g, "").replace(/^\+/, "");
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function iban(tekst: string): string {
  return tekst.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

const IBAN_PATROON = /\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/;

function schoon(tekst: string): string {
  return tekst.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// CAMT.053
// ---------------------------------------------------------------------------

/** Kinderen met deze naam, ongeacht de namespace (camt.053.001.02 t/m .08). */
function kinderen(el: Element | Document, naam: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", naam));
}

/** De tekst langs een pad van namen, bijvoorbeeld ["Dbtr", "Nm"]. */
function langs(el: Element | null | undefined, ...pad: string[]): string {
  let nu: Element | null | undefined = el;
  for (const naam of pad) {
    if (!nu) return "";
    nu = Array.from(nu.children).find((k) => k.localName === naam);
  }
  return nu?.textContent?.trim() ?? "";
}

function kind(el: Element | null | undefined, naam: string): Element | undefined {
  return el ? Array.from(el.children).find((k) => k.localName === naam) : undefined;
}

function leesCamt(tekst: string): BankBestand {
  const doc = new DOMParser().parseFromString(tekst, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new BankbestandFout("Het XML-bestand is beschadigd of niet helemaal gedownload.");
  }
  const regels: BankRegel[] = [];
  let afschrijvingen = 0;

  for (const ntry of kinderen(doc, "Ntry")) {
    const credit = langs(ntry, "CdtDbtInd") === "CRDT";
    // Een teruggedraaide boeking (RvslInd) laten we liggen: dat is geen
    // betaling van een klant.
    if (!credit || langs(ntry, "RvslInd") === "true") {
      afschrijvingen += 1;
      continue;
    }
    const datum = (langs(ntry, "BookgDt", "Dt") || langs(ntry, "BookgDt", "DtTm")).slice(0, 10);
    const ntryRef = langs(ntry, "AcctSvcrRef") || langs(ntry, "NtryRef");
    const ntryBedrag = bedragUit(langs(ntry, "Amt"));
    const algemeen = langs(ntry, "AddtlNtryInf");

    // Een boeking kan meer transacties bundelen (een verzamelbetaling). Dan
    // heeft elke transactie zijn eigen bedrag; anders geldt dat van de boeking.
    const details = kinderen(ntry, "TxDtls");
    const lijst = details.length > 0 ? details : [undefined];
    lijst.forEach((tx, i) => {
      const txBedrag =
        lijst.length > 1
          ? bedragUit(langs(tx, "Amt") || langs(tx, "AmtDtls", "TxAmt", "Amt"))
          : ntryBedrag;
      const partijen = kind(tx, "RltdPties");
      // Vanaf versie 08 zit de naam een laag dieper (Dbtr/Pty/Nm).
      const naam =
        langs(partijen, "Dbtr", "Nm") ||
        langs(partijen, "Dbtr", "Pty", "Nm") ||
        langs(partijen, "UltmtDbtr", "Nm");
      const rekening = langs(partijen, "DbtrAcct", "Id", "IBAN");
      const rmt = kind(tx, "RmtInf");
      const vrij = rmt
        ? Array.from(rmt.children)
            .filter((k) => k.localName === "Ustrd")
            .map((k) => k.textContent?.trim() ?? "")
            .join(" ")
        : "";
      const gestructureerd = rmt ? langs(kind(rmt, "Strd"), "CdtrRefInf", "Ref") : "";
      const e2e = langs(tx, "Refs", "EndToEndId");
      const kenmerk = gestructureerd || (e2e && e2e !== "NOTPROVIDED" ? e2e : "");
      const ref = langs(tx, "Refs", "AcctSvcrRef") || (ntryRef ? `${ntryRef}/${i}` : "");

      if (!datum || !Number.isFinite(txBedrag) || txBedrag <= 0) return;
      regels.push({
        datum,
        bedrag: txBedrag,
        tegen_iban: iban(rekening),
        tegen_naam: schoon(naam),
        omschrijving: schoon(vrij || algemeen),
        kenmerk: schoon(kenmerk),
        ref,
      });
    });
  }
  return { bron: "camt053", regels, afschrijvingen };
}

// ---------------------------------------------------------------------------
// MT940
// ---------------------------------------------------------------------------

/** 260315 → 2026-03-15 */
function mtDatum(jjmmdd: string): string {
  return `20${jjmmdd.slice(0, 2)}-${jjmmdd.slice(2, 4)}-${jjmmdd.slice(4, 6)}`;
}

/**
 * Het :86:-veld. ING, Rabobank en ABN AMRO schrijven het gestructureerd
 * (/CNTP/iban/bic/naam/plaats/ en /REMI/.../), de Volksbank (ASN, SNS) als
 * vrije tekst met de rekening en de naam op de eerste regel.
 */
function lees86(tekst: string): {
  iban: string;
  naam: string;
  omschrijving: string;
  kenmerk: string;
} {
  const plat = tekst.replace(/\r?\n/g, "");
  // Alleen bekende codes: de waarden bevatten zelf ook schuine strepen
  // ("/CNTP/iban/bic/naam/plaats/", "/REMI/USTD//tekst/").
  const codes =
    /\/(CNTP|REMI|EREF|IREF|MARF|CSID|BUSP|PURP|ULTC|ULTD|ULTB|ORDP|BENM|RTRN|TRCD|ISDT|NAME|IBAN|BIC|ADDR)\//g;
  const plekken = [...plat.matchAll(codes)];
  if (plekken.length > 0) {
    const velden = new Map<string, string>();
    plekken.forEach((m, i) => {
      const van = m.index + m[0].length;
      const tot = plekken[i + 1]?.index ?? plat.length;
      if (!velden.has(m[1]!)) velden.set(m[1]!, plat.slice(van, tot));
    });
    const cntp = (velden.get("CNTP") ?? "").split("/");
    const remi = (velden.get("REMI") ?? "")
      .replace(/^(USTD|STRD)\/+(CUR\/+)?/, "")
      .replace(/\/+$/, "");
    const eref = (velden.get("EREF") ?? "").replace(/\/+$/, "");
    return {
      iban: iban(cntp[0] || velden.get("IBAN") || ""),
      naam: schoon(cntp[2] || (velden.get("NAME") ?? "").replace(/\/+$/, "")),
      omschrijving: schoon(remi || plat),
      kenmerk: schoon(eref && eref !== "NOTPROVIDED" ? eref : ""),
    };
  }
  const regels = tekst.split(/\r?\n/).map((r) => r.trim());
  const eerste = regels[0] ?? "";
  // Staat de rekening vooraan op de eerste regel, dan is de rest de naam.
  const vooraan = IBAN_PATROON.exec(eerste);
  const rekening = vooraan?.index === 0 ? vooraan[1]! : (IBAN_PATROON.exec(plat)?.[1] ?? "");
  const naam = vooraan?.index === 0 ? eerste.slice(vooraan[1]!.length) : "";
  return {
    iban: iban(rekening),
    naam: schoon(naam),
    omschrijving: schoon((vooraan?.index === 0 ? regels.slice(1) : regels).join(" ")),
    kenmerk: "",
  };
}

function leesMt940(tekst: string): BankBestand {
  const regels: BankRegel[] = [];
  let afschrijvingen = 0;
  // Velden beginnen met ":XX:" of ":XXa:" aan het begin van een regel; alles
  // tot het volgende veld hoort erbij.
  const velden: { code: string; waarde: string }[] = [];
  for (const regel of tekst.split(/\r?\n/)) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(regel);
    if (m) velden.push({ code: m[1]!, waarde: m[2]! });
    else if (velden.length > 0 && regel.trim() !== "-") {
      velden[velden.length - 1]!.waarde += "\n" + regel;
    }
  }

  for (let i = 0; i < velden.length; i++) {
    const v = velden[i]!;
    if (v.code !== "61") continue;
    // jjmmdd [mmdd] C/D/RC/RD [valutaletter] bedrag N/F + code + referentie [//bankref]
    const m =
      /^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)([NF][A-Z0-9]{3})([^\n/]*)(?:\/\/([^\n]*))?/.exec(
        v.waarde,
      );
    if (!m) continue;
    const credit = m[3] === "C";
    const bedrag = bedragUit(m[5]!);
    const volgende = velden[i + 1];
    const info = volgende?.code === "86" ? lees86(volgende.waarde) : null;
    if (!credit || !Number.isFinite(bedrag) || bedrag <= 0) {
      afschrijvingen += 1;
      continue;
    }
    regels.push({
      datum: mtDatum(m[1]!),
      bedrag,
      tegen_iban: info?.iban ?? "",
      tegen_naam: info?.naam ?? "",
      omschrijving: info?.omschrijving ?? "",
      kenmerk: info?.kenmerk ?? "",
      ref: schoon(m[8] || m[7] || ""),
    });
  }
  if (regels.length === 0 && afschrijvingen === 0) {
    throw new BankbestandFout("In dit MT940-bestand staan geen boekingen.");
  }
  return { bron: "mt940", regels, afschrijvingen };
}

// ---------------------------------------------------------------------------
// CSV van ASN (Volksbank)
// ---------------------------------------------------------------------------

/** Eén CSV-regel in velden, met "…" of '…' rond een veld. */
function csvVelden(regel: string, scheiding: string): string[] {
  const uit: string[] = [];
  let veld = "";
  let quote: string | null = null;
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i]!;
    if (quote) {
      if (c === quote && regel[i + 1] === quote) {
        veld += c;
        i++;
      } else if (c === quote) quote = null;
      else veld += c;
    } else if ((c === '"' || c === "'") && veld.trim() === "") {
      quote = c;
      veld = "";
    } else if (c === scheiding) {
      uit.push(veld.trim());
      veld = "";
    } else veld += c;
  }
  uit.push(veld.trim());
  return uit;
}

/** 15-03-2026 → 2026-03-15 */
function nlDatum(t: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * De kolommen van de ASN-export (zonder kopregel):
 *   0 boekingsdatum  2 tegenrekening  3 naam tegenrekening  10 bedrag
 *   15 volgnummer  16 betalingskenmerk  17 omschrijving
 * Geeft null als het er niet op lijkt, zodat de foutmelding iets zegt.
 */
function leesAsnCsv(tekst: string): BankBestand | null {
  const regels = tekst.split(/\r?\n/).filter((r) => r.trim() !== "");
  if (regels.length === 0) return null;
  const scheiding =
    (regels[0]!.match(/;/g)?.length ?? 0) > (regels[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const uit: BankRegel[] = [];
  let afschrijvingen = 0;
  let herkend = 0;
  for (const regel of regels) {
    const v = csvVelden(regel, scheiding);
    const datum = nlDatum(v[0] ?? "");
    if (v.length < 18 || !datum) continue;
    const bedrag = bedragUit(v[10] ?? "");
    if (!Number.isFinite(bedrag)) continue;
    herkend += 1;
    if (bedrag <= 0) {
      afschrijvingen += 1;
      continue;
    }
    uit.push({
      datum,
      bedrag,
      tegen_iban: iban(v[2] ?? ""),
      tegen_naam: schoon(v[3] ?? ""),
      omschrijving: schoon(v[17] ?? ""),
      kenmerk: schoon(v[16] ?? ""),
      ref: schoon(v[15] ?? ""),
    });
  }
  // Minstens de helft van de regels moet kloppen, anders is het iets anders.
  if (herkend === 0 || herkend < regels.length / 2) return null;
  return { bron: "csv", regels: uit, afschrijvingen };
}
