/**
 * Een antwoord versturen vanaf de eigen mailbox, voor Paaltje.
 *
 * Hetzelfde als "Beantwoorden" in het postvak: via SMTP de deur uit, een kopie
 * in Verzonden, en de mail staat daarna op beantwoord. Met dezelfde rem op het
 * aantal mails (mail_verzendpogingen), zodat een ronde vol automatische
 * bevestigingen het adres niet op een zwarte lijst krijgt.
 */
import { ontsleutel } from "./geheim.ts";
import { maakOp, type Opgemaakt } from "./opmaken.ts";
import { eigenTekst } from "./paaltje.ts";
import { knip, maakImap } from "./ophalen.ts";
import { MogelijkVerstuurd, verstuurBericht } from "./smtp.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const MAX_PER_5_MIN = 8;
const MAX_PER_UUR = 60;

export interface AntwoordOp {
  id: string;
  company_id: string;
  mailbox_id: string;
  van_naam: string;
  van_email: string;
  onderwerp: string;
  message_id: string;
  referenties: string[];
  antwoord_naar: string;
  /** De klant van de mail: het antwoord komt dan ook in zijn dossier. */
  klant_id?: string | null;
}

/** Leeg als het verstuurd is; anders de reden waarom niet. */
export async function stuurAntwoord(db: Db, mail: AntwoordOp, tekst: string): Promise<string> {
  const { data: box, error: boxFout } = await db
    .from("mailboxen")
    .select("id,company_id,adres,imap_host,imap_poort,smtp_host,smtp_poort,status")
    .eq("id", mail.mailbox_id)
    .eq("company_id", mail.company_id)
    .maybeSingle();
  if (boxFout) return `Mailbox opzoeken: ${boxFout.message}`;
  if (!box || box.status !== "actief") return "De mailbox is niet actief.";

  const { data: geheim, error: geheimFout } = await db
    .from("mailbox_geheimen")
    .select("versleuteld,iv")
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (geheimFout) return `Wachtwoord opzoeken: ${geheimFout.message}`;
  if (!geheim) return "De mailbox heeft geen wachtwoord meer.";

  // Paaltje herkent de klant aan de afzender. Een apart "antwoord naar"-adres
  // kiest de schrijver zelf; daar sturen we niets heen zonder dat een mens
  // meekijkt, anders gaan adres en maanden van de klant naar een vreemde.
  const afzender = String(mail.van_email || "")
    .trim()
    .toLowerCase();
  const antwoordNaar = String(mail.antwoord_naar || "")
    .trim()
    .toLowerCase();
  if (antwoordNaar && antwoordNaar !== afzender) {
    return "De mail vraagt om een antwoord naar een ander adres dan de afzender; dat stuurt Paaltje niet zelf.";
  }
  const naar = afzender;
  if (!/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(naar)) {
    return "Geen geldig adres om naar te antwoorden.";
  }
  // Nooit een antwoord naar het eigen adres: dat is een lus.
  if (naar === String(box.adres).toLowerCase()) return "De mail kwam van het eigen adres.";

  // Eerst de poging vastleggen, dan tellen (net als mail-acties).
  const { data: poging, error: pogingFout } = await db
    .from("mail_verzendpogingen")
    .insert({ mailbox_id: box.id, company_id: box.company_id })
    .select("id")
    .single();
  if (pogingFout || !poging) return `Poging vastleggen: ${pogingFout?.message}`;
  const nu = Date.now();
  // Lukt tellen niet, dan niet versturen: liever wachten dan zonder rem.
  const tel = async (ms: number) => {
    const { count, error } = await db
      .from("mail_verzendpogingen")
      .select("id", { count: "exact", head: true })
      .eq("mailbox_id", box.id)
      .gte("created_at", new Date(nu - ms).toISOString());
    return error || count === null ? null : count;
  };
  const in5 = await tel(5 * 60_000);
  const inUur = await tel(60 * 60_000);
  if (in5 === null || inUur === null) {
    await db.from("mail_verzendpogingen").delete().eq("id", poging.id);
    return "Het aantal verstuurde mails kon niet geteld worden; dit antwoord wacht op jou.";
  }
  if (in5 > MAX_PER_5_MIN || inUur > MAX_PER_UUR) {
    await db.from("mail_verzendpogingen").delete().eq("id", poging.id);
    return "Even te veel mail verstuurd; dit antwoord wacht op jou.";
  }

  const { data: bedrijf } = await db
    .from("companies")
    .select("name,mail_afzender_naam")
    .eq("id", box.company_id)
    .single();
  const vanNaam = String(bedrijf?.mail_afzender_naam || bedrijf?.name || "").trim();
  const onderwerp = knip(
    (/^re:/i.test(mail.onderwerp) ? mail.onderwerp : `Re: ${mail.onderwerp}`)
      .replace(/[\r\n]+/g, " ")
      .trim(),
    300,
  );
  const antwoordOp = mail.message_id
    ? { messageId: mail.message_id, referenties: mail.referenties ?? [] }
    : undefined;

  let wachtwoord: string;
  try {
    wachtwoord = await ontsleutel(geheim.versleuteld, geheim.iv);
  } catch {
    return "Het wachtwoord van de mailbox is niet leesbaar.";
  }

  const opgemaakt = await maakOp({
    van: { naam: vanNaam, adres: box.adres },
    aan: [{ naam: mail.van_naam, email: naar }],
    onderwerp,
    tekst,
    antwoordOp,
    automatisch: true,
  });

  // Eerst de mail vastleggen als beantwoord, en alleen versturen als dat lukt.
  // Heeft iemand hem intussen zelf beantwoord, dan raakt deze update niets en
  // krijgt de klant geen tweede mail.
  const tijd = new Date().toISOString();
  const { data: vast, error: vastFout } = await db
    .from("berichten")
    .update({ beantwoord_op: tijd })
    .eq("id", mail.id)
    .is("beantwoord_op", null)
    .select("id");
  if (vastFout) return `Mail vastleggen: ${vastFout.message}`;
  if (!vast?.length) {
    // Al beantwoord: er gaat niets de deur uit, dus telt ook niet mee.
    await db.from("mail_verzendpogingen").delete().eq("id", poging.id);
    return "";
  }

  try {
    await verstuurBericht(
      { host: box.smtp_host, poort: box.smtp_poort, adres: box.adres, wachtwoord },
      opgemaakt.ontvangers,
      opgemaakt.bericht,
    );
  } catch (e) {
    if (e instanceof MogelijkVerstuurd) {
      // Misschien is hij aangekomen: laten staan als beantwoord, zodat niemand
      // hem argeloos nog eens stuurt. De reden komt bij de mail te staan.
      return e.message;
    }
    // Zeker niet verstuurd: terug naar "wacht op jou".
    await db
      .from("berichten")
      .update({ beantwoord_op: null })
      .eq("id", mail.id)
      .eq("beantwoord_op", tijd);
    return e instanceof Error ? e.message : String(e);
  }

  // Verstuurd. Mislukt de kopie in Verzonden, dan haalt de ophaalronde die later op.
  const { error: markeerFout } = await db
    .from("berichten")
    .update({ afgehandeld_op: tijd, herinner_op: null, concept: knip(eigenTekst(tekst), 20_000) })
    .eq("id", mail.id);
  if (markeerFout) console.error("antwoord markeren:", markeerFout.message);

  await kopieInVerzonden(db, box, wachtwoord, vanNaam, [
    {
      opgemaakt,
      aan: [{ naam: mail.van_naam, email: naar }],
      onderwerp,
      tekst,
      ontvangen_op: tijd,
      ...(antwoordOp ? { antwoordOp } : {}),
      klant_id: mail.klant_id ?? null,
    },
  ]);
  return "";
}

// ---------------------------------------------------------------------
// De kopie in Verzonden
// ---------------------------------------------------------------------

/** Een mailbox, voor zover er een kopie in te leggen valt. */
export interface KopieBox {
  id: string;
  company_id: string;
  adres: string;
  imap_host: string;
  imap_poort: number;
}

export interface KopieMail {
  /** De mail zoals hij de deur uit ging. */
  opgemaakt: Opgemaakt;
  aan: { naam?: string; email: string }[];
  onderwerp: string;
  tekst: string;
  /** Wanneer hij verstuurd is (ISO). */
  ontvangen_op: string;
  /** Het afzenderadres, als dat niet de mailbox zelf was (Brevo). */
  vanEmail?: string;
  antwoordOp?: { messageId: string; referenties: string[] };
  /** De klant bij wie hij in het dossier hoort. Leeg = zoek op het aan-adres. */
  klant_id?: string | null;
  /** Wat eraan vastzat — alleen de beschrijving, niet het bestand zelf. */
  bijlagen?: { naam: string; type: string; grootte: number }[];
}

/**
 * Verstuurde mail in de map Verzonden zetten, en daarmee in het klantdossier.
 *
 * Eén IMAP-sessie voor de hele lijst: bij een stapel facturen scheelt dat
 * evenveel keer inloggen als er facturen zijn.
 *
 * Hier wordt niets gegooid en niets teruggegeven. De mail is al weg; dat de
 * kopie niet lukte, is vervelend maar mag de verzending niet ongedaan maken.
 * De ophaalronde vindt hem later alsnog als het mailprogramma hem zelf
 * bewaarde.
 */
export async function kopieInVerzonden(
  db: Db,
  box: KopieBox,
  wachtwoord: string,
  vanNaam: string,
  mails: KopieMail[],
): Promise<void> {
  if (mails.length === 0) return;
  try {
    const { data: verzonden } = await db
      .from("mail_mappen")
      .select("id,pad")
      .eq("mailbox_id", box.id)
      .eq("rol", "verzonden")
      .order("pad", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!verzonden) return;

    const client = maakImap(box, wachtwoord);
    await client.connect();
    try {
      for (const m of mails) {
        try {
          const res = await client.append(
            verzonden.pad,
            m.opgemaakt.bericht,
            ["\\Seen"],
            new Date(m.ontvangen_op),
          );
          if (!res || typeof res.uid !== "number" || res.uidValidity === undefined) continue;
          await db.from("berichten").upsert(
            {
              company_id: box.company_id,
              mailbox_id: box.id,
              map_id: verzonden.id,
              uidvalidity: Number(res.uidValidity),
              uid: res.uid,
              message_id: m.opgemaakt.messageId,
              in_reply_to: m.antwoordOp?.messageId ?? "",
              referenties: m.antwoordOp
                ? [...m.antwoordOp.referenties, m.antwoordOp.messageId].slice(-20)
                : [],
              richting: "uit",
              van_naam: vanNaam,
              van_email: m.vanEmail || box.adres,
              aan: m.aan.map((a) => ({ naam: a.naam ?? "", email: a.email })),
              onderwerp: m.onderwerp,
              fragment: knip(m.tekst.replace(/\s+/g, " ").trim(), 200),
              tekst: m.tekst,
              bijlagen: m.bijlagen ?? [],
              ontvangen_op: m.ontvangen_op,
              gelezen: true,
              paaltje_status: "overslaan",
              // Leeg: dan zoekt de database de klant op het aan-adres.
              klant_id: m.klant_id ?? null,
            },
            { onConflict: "map_id,uidvalidity,uid", ignoreDuplicates: true },
          );
        } catch (e) {
          console.error("kopie in Verzonden:", e instanceof Error ? e.message : e);
        }
      }
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  } catch (e) {
    console.error("kopie in Verzonden:", e instanceof Error ? e.message : e);
  }
}

/**
 * De actieve mailbox van een bedrijf plus zijn wachtwoord, om een kopie in
 * Verzonden te kunnen leggen. Leeg als er geen bruikbare mailbox is — dan
 * gaat de mail gewoon zonder kopie de deur uit.
 */
export async function mailboxVoorKopie(
  db: Db,
  bedrijf: string,
): Promise<{ box: KopieBox; wachtwoord: string } | null> {
  const { data: box, error: boxFout } = await db
    .from("mailboxen")
    .select("id,company_id,adres,imap_host,imap_poort,status")
    .eq("company_id", bedrijf)
    .eq("status", "actief")
    // Eén rij: heeft een bedrijf er ooit twee, dan zou maybeSingle() een fout
    // geven en verdween de kopie stilletjes.
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (boxFout) {
    console.error("mailbox voor kopie:", boxFout.message);
    return null;
  }
  if (!box) return null;
  const { data: geheim, error: geheimFout } = await db
    .from("mailbox_geheimen")
    .select("versleuteld,iv")
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (geheimFout) console.error("wachtwoord voor kopie:", geheimFout.message);
  if (!geheim) return null;
  try {
    return { box: box as KopieBox, wachtwoord: await ontsleutel(geheim.versleuteld, geheim.iv) };
  } catch {
    return null;
  }
}
