/**
 * Een bankbestand lezen: de afschriften die je bij de bank downloadt.
 *
 * Drie soorten, want elke bank doet het anders:
 *
 *   CAMT.053  XML, de opvolger van MT940. Alle Nederlandse banken kunnen dit.
 *   MT940     het oude tekstformaat. Sommige banken stoppen ermee.
 *   CSV       de CSV van ASN (en de andere banken van de Volksbank: SNS,
 *             RegioBank): geen kopregel, negentien kolommen. En de CSV van
 *             ING: met kopregel, de kolommen worden op naam gezocht.
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
  /**
   * Het gestructureerde betalingskenmerk, als de klant dat gaf. Niet de
   * end-to-end-referentie: die kiest de betaler zelf (vaak een nummer uit zijn
   * eigen boekhouding) en de database zoekt hier factuurnummers in.
   */
  kenmerk: string;
  /** De eigen referentie van de bank, om dubbel inlezen te herkennen. */
  ref: string;
  /**
   * Hoeveelste keer precies deze regel in het bestand staat (1, 2, …). Twee
   * echt gelijke overmakingen blijven er zo twee, ook als het bestand in
   * stukken naar de database gaat.
   */
  volg?: number;
}

export interface BankBestand {
  bron: BankBron;
  regels: BankRegel[];
  /** Hoeveel afschrijvingen er overgeslagen zijn. */
  afschrijvingen: number;
  /** Regels die op een boeking leken maar niet te lezen waren. */
  onleesbaar: number;
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
  const b = leesSoort(tekst);
  const gezien = new Map<string, number>();
  for (const r of b.regels) {
    const sleutel = [r.datum, r.bedrag, r.tegen_iban, r.omschrijving, r.kenmerk, r.ref].join("|");
    const n = (gezien.get(sleutel) ?? 0) + 1;
    gezien.set(sleutel, n);
    r.volg = n;
  }
  return b;
}

function leesSoort(tekst: string): BankBestand {
  const t = tekst.replace(/^\uFEFF/, "");
  if (/<Document[\s>]/.test(t) && /camt\.05[234]/.test(t)) return leesCamt(t);
  if (/<Document[\s>]/.test(t)) {
    throw new BankbestandFout(
      "Dit is een XML-bestand, maar geen CAMT.053-afschrift. Kies bij je bank CAMT.053.",
    );
  }
  if (/^:20:/m.test(t) && /^:61:/m.test(t)) return leesMt940(t);
  const ing = leesIngCsv(t);
  if (ing) return ing;
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
      const kenmerk = gestructureerd;
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
  return { bron: "camt053", regels, afschrijvingen, onleesbaar: 0 };
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
    // Geen /REMI/: dan liever geen omschrijving dan het hele veld, want daar
    // staat /EREF/ in -- de eigen verwijzing van de betaler, die op een
    // factuurnummer van een ander kan lijken.
    return {
      iban: iban(cntp[0] || velden.get("IBAN") || ""),
      naam: schoon(cntp[2] || (velden.get("NAME") ?? "").replace(/\/+$/, "")),
      omschrijving: schoon(remi),
      kenmerk: "",
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
    // De Rabobank zet de rekening van de betaler op de tweede regel van :61:.
    const tweede = v.waarde.split("\n").slice(1).join(" ");
    const rekeningUit61 = IBAN_PATROON.exec(tweede)?.[1] ?? "";
    if (!credit || !Number.isFinite(bedrag) || bedrag <= 0) {
      afschrijvingen += 1;
      continue;
    }
    regels.push({
      datum: mtDatum(m[1]!),
      bedrag,
      tegen_iban: info?.iban || iban(rekeningUit61),
      tegen_naam: info?.naam ?? "",
      omschrijving: info?.omschrijving ?? "",
      kenmerk: info?.kenmerk ?? "",
      ref: schoon(m[8] || m[7] || ""),
    });
  }
  if (regels.length === 0 && afschrijvingen === 0) {
    throw new BankbestandFout("In dit MT940-bestand staan geen boekingen.");
  }
  return { bron: "mt940", regels, afschrijvingen, onleesbaar: 0 };
}

// ---------------------------------------------------------------------------
// CSV van ASN (Volksbank)
// ---------------------------------------------------------------------------

/**
 * Eén CSV-regel in velden. Alleen "…" telt als aanhalingsteken. ASN zet de
 * omschrijving tussen enkele aanhalingstekens, maar daar kun je niet op
 * splitsen: "'t Hart" en "Glazen 't Hoekje" hebben er zelf ook een. Zie
 * `asnKolommen` voor hoe een komma in de tekst wordt opgevangen.
 */
function csvVelden(regel: string, scheiding: string): string[] {
  const uit: string[] = [];
  let veld = "";
  let binnen = false;
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i]!;
    if (binnen) {
      if (c === '"' && regel[i + 1] === '"') {
        veld += c;
        i++;
      } else if (c === '"') binnen = false;
      else veld += c;
    } else if (c === '"' && veld.trim() === "") {
      binnen = true;
      veld = "";
    } else if (c === scheiding) {
      uit.push(veld.trim());
      veld = "";
    } else veld += c;
  }
  uit.push(veld.trim());
  return uit;
}

/** 'tekst' → tekst */
function zonderEnkele(t: string): string {
  const s = t.trim();
  return s.length >= 2 && s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1) : s;
}

/**
 * De negentien kolommen van ASN, ook als er een komma in de naam of de
 * omschrijving stond en de regel daardoor te veel velden heeft. Het vaste
 * punt is de valuta van de rekening ("EUR", kolom 7): alles daarvoor na
 * kolom 2 is naam en adres, alles na het betalingskenmerk tot de laatste
 * kolom is de omschrijving.
 */
function asnKolommen(v: string[]): string[] | null {
  if (v.length === 19) return v.map(zonderEnkele);
  if (v.length < 19) return null;
  const eur = v.findIndex(
    (x, i) => i >= 7 && /^[A-Z]{3}$/.test(x) && /^[A-Z]{3}$/.test(v[i + 2] ?? ""),
  );
  if (eur < 7) return null;
  const naam = v.slice(3, eur - 3).join(", ");
  const vast = v.slice(eur, eur + 10);
  const omschrijving = v.slice(eur + 10, v.length - 1).join(", ");
  const uit = [
    v[0]!,
    v[1]!,
    v[2]!,
    naam,
    v[eur - 3]!,
    v[eur - 2]!,
    v[eur - 1]!,
    ...vast,
    omschrijving,
    v[v.length - 1]!,
  ];
  return uit.length === 19 ? uit.map(zonderEnkele) : null;
}

// ---------------------------------------------------------------------------
// CSV van ING
// ---------------------------------------------------------------------------

/** 20261005 → 2026-10-05; 05-10-2026 kan ook. */
function ingDatum(t: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(t.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : nlDatum(t);
}

/**
 * Uit de kolom Mededelingen ("Naam: … Omschrijving: Factuur 2026-0042 IBAN:
 * NL… Kenmerk: … Valutadatum: …") alleen wat er achter Omschrijving staat.
 * Niet het Kenmerk: dat is vaak de eigen verwijzing van de betaler, en die
 * kan op het factuurnummer van een ander lijken.
 */
function ingOmschrijving(mededelingen: string): { omschrijving: string; iban: string } {
  const t = schoon(mededelingen);
  const volgende =
    "(?=\\s+(?:Naam|IBAN|BIC|Kenmerk|Machtiging ID|Incassant ID|Valutadatum|Datum/Tijd|Pasvolgnr|Transactie|Term|Apple Pay|Google Pay):|$)";
  const om = new RegExp(`Omschrijving:\\s*(.*?)${volgende}`).exec(t);
  const ib = /IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9 ]{10,40}?)(?=\s+[A-Z][a-z]|$)/.exec(t);
  // Geen "Omschrijving:" maar wel andere kopjes ("Naam: … Kenmerk: …"): dan
  // gaf de klant geen omschrijving, en de rest van de tekst is niet van hem
  // maar van de bank -- met het Kenmerk erin. Liever leeg dan dat.
  const gelabeld = /(?:^|\s)(?:Naam|IBAN|Kenmerk|Valutadatum):/.test(t);
  return {
    omschrijving: om ? om[1]!.trim() : gelabeld ? "" : t,
    iban: ib ? iban(ib[1]!) : "",
  };
}

/**
 * De ING-export: een kopregel met onder meer "Datum", "Naam / Omschrijving",
 * "Tegenrekening", "Af Bij", "Bedrag (EUR)" en "Mededelingen". Met komma's
 * (oud) of puntkomma's (nieuw). Geeft null als de kopregel er niet op lijkt.
 */
function leesIngCsv(tekst: string): BankBestand | null {
  const regels = tekst.split(/\r?\n/).filter((r) => r.trim() !== "");
  const kop = regels[0] ?? "";
  if (!/af\s*bij/i.test(kop) || !/bedrag/i.test(kop)) return null;
  const scheiding = (kop.match(/;/g)?.length ?? 0) > (kop.match(/,/g)?.length ?? 0) ? ";" : ",";
  const namen = csvVelden(kop, scheiding).map((n) => n.toLowerCase());
  const kolom = (...zoek: string[]) => namen.findIndex((n) => zoek.some((z) => n.startsWith(z)));
  const k = {
    datum: kolom("datum"),
    naam: kolom("naam"),
    tegen: kolom("tegenrekening"),
    afBij: kolom("af bij", "af/bij"),
    bedrag: kolom("bedrag"),
    mededelingen: kolom("mededelingen"),
  };
  if (k.datum < 0 || k.afBij < 0 || k.bedrag < 0) return null;

  const uit: BankRegel[] = [];
  let afschrijvingen = 0;
  let onleesbaar = 0;
  for (const regel of regels.slice(1)) {
    const v = csvVelden(regel, scheiding);
    const datum = ingDatum(v[k.datum] ?? "");
    const bedrag = bedragUit(v[k.bedrag] ?? "");
    if (!datum || !Number.isFinite(bedrag)) {
      onleesbaar += 1;
      continue;
    }
    if (!/^bij$/i.test(v[k.afBij] ?? "") || bedrag <= 0) {
      afschrijvingen += 1;
      continue;
    }
    const med = ingOmschrijving(k.mededelingen >= 0 ? (v[k.mededelingen] ?? "") : "");
    uit.push({
      datum,
      bedrag,
      tegen_iban: iban(k.tegen >= 0 ? (v[k.tegen] ?? "") : "") || med.iban,
      tegen_naam: schoon(k.naam >= 0 ? (v[k.naam] ?? "") : ""),
      omschrijving: med.omschrijving,
      kenmerk: "",
      // ING geeft geen eigen referentie per regel; de dubbelherkenning leunt
      // dan op datum, bedrag, rekening en omschrijving, plus het volgnummer.
      ref: "",
    });
  }
  return { bron: "csv", regels: uit, afschrijvingen, onleesbaar };
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
  // Begint met een datum maar valt niet te lezen: niet stil overslaan, maar
  // tellen, zodat het scherm het kan zeggen.
  let onleesbaar = 0;
  for (const regel of regels) {
    const velden = csvVelden(regel, scheiding);
    const datum = nlDatum(velden[0] ?? "");
    if (!datum) continue;
    const v = asnKolommen(velden) ?? [];
    const bedrag = v.length === 19 ? bedragUit(v[10] ?? "") : NaN;
    if (!Number.isFinite(bedrag)) {
      onleesbaar += 1;
      continue;
    }
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
  return { bron: "csv", regels: uit, afschrijvingen, onleesbaar };
}
