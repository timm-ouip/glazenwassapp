// Fase 0 van de mailbox-koppeling: kan Wooshy inloggen bij de Mijndomein-mail?
//
// Draai met:  bun scripts/imap-proef.ts
//
// Vraagt om het mailadres en het wachtwoord (onzichtbaar getypt), logt in via
// IMAP en SMTP en laat zien wat de server kan en hoe de mappen heten. Het
// wachtwoord wordt nergens opgeslagen of getoond. Er wordt niets verstuurd en
// niets in de mailbox veranderd: alleen kijken.

import tls from "node:tls";

const IMAP_HOST = "mail.mijndomein.nl";
const SMTP_HOST = "mail.mijndomein.nl";

function vraag(tekst: string, verborgen = false): Promise<string> {
  return new Promise((klaar) => {
    process.stdout.write(tekst);
    const stdin = process.stdin;
    let invoer = "";
    if (verborgen && stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const opToets = (stuk: string) => {
      for (const teken of stuk) {
        if (teken === "\r" || teken === "\n") {
          if (verborgen && stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", opToets);
          process.stdout.write("\n");
          // Een wachtwoord mag met een spatie beginnen of eindigen.
          klaar(verborgen ? invoer : invoer.trim());
          return;
        }
        if (teken === "") process.exit(1); // ctrl+c
        if (teken === "") invoer = invoer.slice(0, -1); // backspace
        else invoer += teken;
      }
    };
    stdin.on("data", opToets);
  });
}

// Eén TLS-verbinding met een simpele regel-lezer.
function verbind(host: string, poort: number) {
  const sok = tls.connect({ host, port: poort, servername: host });
  let buffer = "";
  const wachters: Array<() => void> = [];
  sok.setEncoding("utf8");
  sok.on("data", (d: string) => {
    buffer += d;
    wachters.splice(0).forEach((w) => w());
  });
  const fout = new Promise<never>((_, nee) => sok.on("error", nee));
  fout.catch(() => {}); // een reset na het afsluiten mag het script niet laten crashen

  async function tot(klaar: (b: string) => boolean, ms = 15000) {
    const eind = Date.now() + ms;
    while (!klaar(buffer)) {
      if (Date.now() > eind) throw new Error(`Geen antwoord van ${host} binnen ${ms / 1000}s`);
      await Promise.race([new Promise<void>((r) => { wachters.push(r); setTimeout(r, 500); }), fout]);
    }
    const uit = buffer;
    buffer = "";
    return uit;
  }
  return { sok, tot, schrijf: (s: string) => sok.write(s + "\r\n") };
}

const imapQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function proefImap(adres: string, wachtwoord: string) {
  console.log(`\n── IMAP ${IMAP_HOST}:993 ──`);
  const c = verbind(IMAP_HOST, 993);
  const welkom = await c.tot((b) => b.includes("\r\n"));
  console.log("Server:", welkom.trim());

  let tag = 0;
  const opdracht = async (cmd: string, toon = true) => {
    const t = `w${++tag}`;
    c.schrijf(`${t} ${cmd}`);
    const antwoord = await c.tot((b) => new RegExp(`(^|\\r\\n)${t} (OK|NO|BAD)`).test(b));
    const regel = antwoord.split("\r\n").find((r) => r.startsWith(`${t} `)) ?? "";
    if (toon) console.log(antwoord.trim());
    return { ok: regel.startsWith(`${t} OK`), antwoord, regel };
  };

  // Het wachtwoord gaat als "literal" mee: dan mogen er ook tekens als é of € in.
  const loginTag = `w${++tag}`;
  c.schrijf(`${loginTag} LOGIN ${imapQuote(adres)} {${Buffer.byteLength(wachtwoord)}}`);
  const verder = await c.tot((b) => /(^|\r\n)(\+|w\d+ (NO|BAD))/.test(b));
  let login = { ok: false, regel: verder.trim() };
  if (verder.startsWith("+")) {
    c.schrijf(wachtwoord);
    const antwoord = await c.tot((b) => new RegExp(`(^|\\r\\n)${loginTag} (OK|NO|BAD)`).test(b));
    const regel = antwoord.split("\r\n").find((r) => r.startsWith(`${loginTag} `)) ?? "";
    login = { ok: regel.startsWith(`${loginTag} OK`), regel };
  }
  if (!login.ok) {
    console.log("❌ Inloggen via IMAP lukt NIET:", login.regel.replace(/^w\d+ /, ""));
    c.sok.end();
    return false;
  }
  console.log("✅ Inloggen via IMAP lukt met het gewone wachtwoord.");

  const cap = await opdracht("CAPABILITY", false);
  const kan = cap.antwoord.toUpperCase();
  console.log("\nWat de server kan:");
  for (const k of ["IDLE", "SPECIAL-USE", "UIDPLUS", "MOVE", "CONDSTORE"]) {
    console.log(`  ${kan.includes(k) ? "✅" : "❌"} ${k}`);
  }

  console.log("\nMappen:");
  const lijst = await opdracht('LIST "" "*"', false);
  for (const r of lijst.antwoord.split("\r\n").filter((r) => r.startsWith("* LIST"))) {
    console.log("  " + r.slice(7));
  }

  console.log("\nPostvak IN:");
  await opdracht("STATUS INBOX (MESSAGES UNSEEN UIDVALIDITY UIDNEXT)");

  await opdracht("LOGOUT", false);
  c.sok.end();
  return true;
}

async function proefSmtp(adres: string, wachtwoord: string) {
  console.log(`\n── SMTP ${SMTP_HOST}:465 ──`);
  const c = verbind(SMTP_HOST, 465);
  // SMTP-antwoord is klaar bij een regel "250 " (spatie, niet streepje).
  const klaar = (b: string) => /(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(b);
  console.log("Server:", (await c.tot(klaar)).trim());
  c.schrijf("EHLO wooshy.proef");
  const ehlo = await c.tot(klaar);
  console.log("Inlogmethodes:", ehlo.match(/AUTH[ =]([^\r\n]*)/)?.[1] ?? "(geen genoemd)");
  const plain = Buffer.from(`\0${adres}\0${wachtwoord}`).toString("base64");
  c.schrijf(`AUTH PLAIN ${plain}`);
  const auth = await c.tot(klaar);
  const ok = auth.startsWith("235");
  console.log(ok ? "✅ Inloggen via SMTP lukt." : `❌ Inloggen via SMTP lukt NIET: ${auth.trim()}`);
  c.schrijf("QUIT");
  c.sok.end();
  return ok;
}

const adres = await vraag("Mailadres (bijv. info@deramensopperij.nl): ");
const wachtwoord = await vraag("Wachtwoord van die mailbox (je ziet niets tijdens typen): ", true);

// Elke test apart, zodat een haperende IMAP-server de SMTP-test niet overslaat.
async function probeer(naam: string, test: () => Promise<boolean>) {
  try {
    return await test();
  } catch (e) {
    console.log(`\n❌ ${naam}: er ging iets mis:`, (e as Error).message);
    return false;
  }
}

const imap = await probeer("IMAP", () => proefImap(adres, wachtwoord));
const smtp = await probeer("SMTP", () => proefSmtp(adres, wachtwoord));
console.log("\n── Uitkomst ──");
console.log(`IMAP (mail ophalen):   ${imap ? "werkt" : "werkt niet"}`);
console.log(`SMTP (mail versturen): ${smtp ? "werkt" : "werkt niet"}`);
if (!imap || !smtp) {
  console.log("Werkt het niet terwijl webmail wel lukt? Vraag Soverin-support om een app-wachtwoord.");
}
process.exit(0);
