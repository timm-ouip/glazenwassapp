/**
 * Een antwoord versturen vanaf de eigen mailbox, voor Paaltje.
 *
 * Hetzelfde als "Beantwoorden" in het postvak: via SMTP de deur uit, een kopie
 * in Verzonden, en de mail staat daarna op beantwoord. Met dezelfde rem op het
 * aantal mails (mail_verzendpogingen), zodat een ronde vol automatische
 * bevestigingen het adres niet op een zwarte lijst krijgt.
 */
import { ontsleutel } from "./geheim.ts";
import { maakOp } from "./opmaken.ts";
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
  const afzender = String(mail.van_email || "").trim().toLowerCase();
  const antwoordNaar = String(mail.antwoord_naar || "").trim().toLowerCase();
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
    (/^re:/i.test(mail.onderwerp) ? mail.onderwerp : `Re: ${mail.onderwerp}`).replace(/[\r\n]+/g, " ").trim(),
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
    await db.from("berichten").update({ beantwoord_op: null }).eq("id", mail.id).eq("beantwoord_op", tijd);
    return e instanceof Error ? e.message : String(e);
  }

  // Verstuurd. Mislukt de kopie in Verzonden, dan haalt de ophaalronde die later op.
  const { error: markeerFout } = await db
    .from("berichten")
    .update({ afgehandeld_op: tijd, concept: knip(eigenTekst(tekst), 20_000) })
    .eq("id", mail.id);
  if (markeerFout) console.error("antwoord markeren:", markeerFout.message);

  try {
    const { data: verzonden } = await db
      .from("mail_mappen")
      .select("id,pad")
      .eq("mailbox_id", box.id)
      .eq("rol", "verzonden")
      .order("pad", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (verzonden) {
      const client = maakImap(box, wachtwoord);
      await client.connect();
      try {
        const res = await client.append(verzonden.pad, opgemaakt.bericht, ["\\Seen"], new Date());
        if (res && typeof res.uid === "number" && res.uidValidity !== undefined) {
          await db.from("berichten").upsert(
            {
              company_id: box.company_id,
              mailbox_id: box.id,
              map_id: verzonden.id,
              uidvalidity: Number(res.uidValidity),
              uid: res.uid,
              message_id: opgemaakt.messageId,
              in_reply_to: antwoordOp?.messageId ?? "",
              referenties: antwoordOp ? [...antwoordOp.referenties, antwoordOp.messageId].slice(-20) : [],
              richting: "uit",
              van_naam: vanNaam,
              van_email: box.adres,
              aan: [{ naam: mail.van_naam, email: naar }],
              onderwerp,
              fragment: knip(tekst.replace(/\s+/g, " ").trim(), 200),
              tekst,
              ontvangen_op: tijd,
              gelezen: true,
              paaltje_status: "overslaan",
            },
            { onConflict: "map_id,uidvalidity,uid", ignoreDuplicates: true },
          );
        }
      } finally {
        try {
          await client.logout();
        } catch {
          client.close();
        }
      }
    }
  } catch (e) {
    console.error("kopie in Verzonden:", e instanceof Error ? e.message : e);
  }
  return "";
}
