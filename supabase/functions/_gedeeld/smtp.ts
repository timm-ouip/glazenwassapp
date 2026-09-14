/**
 * Mail versturen via de uitgaande server van de eigen mailbox (SMTP, poort 465).
 *
 * Bewust een kleine eigen client en geen bibliotheek: we hebben maar vier
 * dingen nodig (hallo, inloggen, versturen, ophangen), en een bibliotheek die
 * op Node leunt is in de Edge Function een gok. Het opmaken van de mail zelf
 * (koppen, tekensets, bijlagen) gebeurt elders; hier gaat alleen een kant-en-
 * klaar bericht over de lijn.
 *
 * Elk lezen racet tegen een klok. Een server die niets zegt, laat anders de
 * gebruiker eindeloos naar een draaiend rondje kijken.
 */

export interface SmtpGegevens {
  host: string;
  poort: number;
  adres: string;
  wachtwoord: string;
}

const WACHT_MS = 20_000;

class SmtpFout extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

class Verbinding {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  private constructor(
    private readonly conn: Deno.TlsConn,
    private readonly lezer: ReadableStreamDefaultReader<Uint8Array>,
    private readonly schrijver: WritableStreamDefaultWriter<Uint8Array>,
  ) {}

  static async open(host: string, poort: number): Promise<Verbinding> {
    // Ook het verbinden zelf tegen de klok: een firewall die poort 465 stil
    // laat vallen, laat anders minutenlang niets van zich horen.
    const verbinden = Deno.connectTls({ hostname: host, port: poort });
    let conn: Deno.TlsConn;
    try {
      conn = await metKlok(verbinden, "De mailserver reageerde niet.");
    } catch (e) {
      // Komt de verbinding alsnog, dan meteen weer dicht.
      verbinden.then((c) => c.close()).catch(() => {});
      throw e;
    }
    const v = new Verbinding(conn, conn.readable.getReader(), conn.writable.getWriter());
    try {
      await v.antwoord([220]);
    } catch (e) {
      v.sluit();
      throw e;
    }
    return v;
  }

  /** Eén antwoord van de server: klaar bij een regel "250 " (spatie, geen streepje). */
  async antwoord(verwacht: number[]): Promise<string> {
    const eind = Date.now() + WACHT_MS;
    while (!/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(this.buffer)) {
      const over = eind - Date.now();
      if (over <= 0) throw new Error("De mailserver antwoordde niet.");
      let klok: number | undefined;
      const teLaat = new Promise<never>((_, nee) => {
        klok = setTimeout(() => nee(new Error("De mailserver antwoordde niet.")), over);
      });
      try {
        const { value, done } = await Promise.race([this.lezer.read(), teLaat]);
        if (done) throw new Error("De mailserver hing op.");
        this.buffer += this.decoder.decode(value, { stream: true });
      } finally {
        clearTimeout(klok);
      }
    }
    const tekst = this.buffer;
    this.buffer = "";
    const regels = tekst.trimEnd().split("\r\n");
    const code = Number(regels[regels.length - 1].slice(0, 3));
    if (!verwacht.includes(code)) {
      // De tekst van de server mag mee in de fout, maar nooit wat wíj stuurden:
      // daar zit bij AUTH het wachtwoord in.
      throw new SmtpFout(`De mailserver weigerde (${code}): ${regels[regels.length - 1].slice(4, 200)}`, code);
    }
    return tekst;
  }

  async schrijf(tekst: string) {
    await metKlok(this.schrijver.write(this.encoder.encode(tekst)), "De mailserver nam niets meer aan.");
  }

  async commando(regel: string, verwacht: number[]): Promise<string> {
    await this.schrijf(regel + "\r\n");
    return await this.antwoord(verwacht);
  }

  sluit() {
    try {
      this.conn.close();
    } catch {
      // al dicht
    }
  }
}

/** Een belofte die na `ms` opgeeft met `melding`. */
async function metKlok<T>(belofte: Promise<T>, melding: string, ms = WACHT_MS): Promise<T> {
  let klok: number | undefined;
  const teLaat = new Promise<never>((_, nee) => {
    klok = setTimeout(() => nee(new Error(melding)), ms);
  });
  try {
    return await Promise.race([belofte, teLaat]);
  } finally {
    clearTimeout(klok);
  }
}

function base64(tekst: string): string {
  const bytes = new TextEncoder().encode(tekst);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function openEnLogIn(g: SmtpGegevens): Promise<Verbinding> {
  const v = await Verbinding.open(g.host, g.poort);
  try {
    await v.commando("EHLO wooshy", [250]);
    await v.commando(`AUTH PLAIN ${base64(`\0${g.adres}\0${g.wachtwoord}`)}`, [235]);
    return v;
  } catch (e) {
    v.sluit();
    if (e instanceof SmtpFout && (e.code === 535 || e.code === 534)) {
      throw new Error("Inloggen voor versturen werd geweigerd.");
    }
    throw e;
  }
}

/** Alleen inloggen en ophangen. Leeg als het lukt, anders de reden. */
export async function probeerSmtp(g: SmtpGegevens): Promise<string> {
  try {
    const v = await openEnLogIn(g);
    await v.commando("QUIT", [221]).catch(() => {});
    v.sluit();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Een bericht (volledige mail, al opgemaakt) versturen naar de ontvangers.
 * `ontvangers` zijn alle adressen uit Aan, Cc en Bcc samen.
 */
export async function verstuurBericht(
  g: SmtpGegevens,
  ontvangers: string[],
  bericht: string,
): Promise<void> {
  if (ontvangers.length === 0) throw new Error("Geen ontvanger.");
  const v = await openEnLogIn(g);
  try {
    await v.commando(`MAIL FROM:<${g.adres}>`, [250]);
    for (const naar of ontvangers) {
      if (/[\r\n<>]/.test(naar)) throw new Error(`Ongeldig adres: ${naar}`);
      await v.commando(`RCPT TO:<${naar}>`, [250, 251]);
    }
    await v.commando("DATA", [354]);
    // Regeleinden gelijktrekken — ook een losse \r, anders kan "\r.\r\n" bij
    // sommige servers als "einde bericht" gelezen worden — en een regel die met
    // een punt begint krijgt er een extra punt voor.
    const lijnen = bericht
      .replace(/\r\n|\r|\n/g, "\r\n")
      .split("\r\n")
      .map((r) => (r.startsWith(".") ? "." + r : r));
    await v.schrijf(lijnen.join("\r\n") + "\r\n.\r\n");
    await v.antwoord([250]);
    await v.commando("QUIT", [221]).catch(() => {});
  } finally {
    v.sluit();
  }
}
