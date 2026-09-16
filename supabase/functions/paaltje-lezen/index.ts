/**
 * Elke twee minuten: Paaltje leest de mail die nog op hem wacht.
 *
 * pg_cron roept dit aan, een minuut na het ophalen. Per ronde maar een paar
 * mails: elke mail kost een aanroep van het taalmodel, en de eerste keer
 * staat er een maand oude mail klaar. Nieuwste eerst, zodat wat vandaag
 * binnenkomt niet achter die berg aan hoeft te sluiten.
 *
 * Een mail gaat eerst op "bezig", zodat twee rondes hem nooit tegelijk lezen.
 * Blijft hij daar hangen (een ronde die halverwege stopte), dan zet een
 * volgende ronde hem na tien minuten terug op "wacht". Na drie pogingen
 * stopt het: dan staat hij op "fout" en kan een mens hem opnieuw laten lezen.
 *
 * WhatsApp gaat mee in dezelfde ronde, per gesprek: een klant stuurt vaak
 * drie korte berichtjes achter elkaar, en die leest Paaltje samen, pas als er
 * even niets meer bijkomt. Mag hij zelf antwoorden, dan plant hij het
 * antwoord in; de functie whatsapp-planner verstuurt het na de wachttijd, als
 * niemand intussen zelf antwoordde.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { cronSleutelKlopt } from "../_gedeeld/cron.ts";
import {
  categorieenVan,
  leesMail,
  richtprijzen,
  telefoonAlsSleutel,
  type Categorie,
  type TeLezen,
} from "../_gedeeld/paaltje.ts";
import { ZEKER_AUTOMATISCH } from "../_gedeeld/doorvoeren.ts";
import { binnenAntwoordtijd } from "../_gedeeld/whatsapp.ts";
import { klachtUitMail } from "../_gedeeld/klachten.ts";
import { voerActiesUit, type MailStand, type Voorstel } from "../_gedeeld/acties.ts";
import { stuurAntwoord } from "../_gedeeld/verzenden.ts";
import { stelAfsprakenVoor } from "../_gedeeld/afspraken.ts";
import {
  draaiAanmakenTerug,
  GEEN_GEGEVENS,
  herken,
  leesKlantgegevens,
  magKlantAanmaken,
  maakKlantBijAdres,
  vulAan,
  zekerGekoppeld,
  type KlantGegevens,
} from "../_gedeeld/klantgegevens.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const PER_RONDE = 8;
/** Na zoveel tijd begint de ronde geen nieuwe mail meer. */
const TIJD_MS = 90_000;
const VASTGELOPEN_MS = 10 * 60_000;
const MAX_POGINGEN = 3;
/** Storingen die vanzelf overgaan: dan later nog eens, niet meteen "fout". */
/** Zo lang na het laatste berichtje van een klant wachten, voor het geval er nog een komt. */
const WA_RUST_MS = 45_000;
const WA_PER_RONDE = 8;
const WA_GESPREK = 12;
const TIJDELIJK = /\b(429|500|502|503|504|529)\b|overloaded|rate.?limit|timeout|timed out|network|fetch failed|ECONN/i;

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (!(await cronSleutelKlopt(req))) return antwoord({ ok: false }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return antwoord({ ok: false, fase: "instellingen" }, 500);
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const werk = leesRonde(db).catch((e) => console.error("paaltje-lezen:", e instanceof Error ? e.message : e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(werk);
  else await werk;
  return antwoord({ ok: true });
});

type Gepakt = TeLezen &
  MailStand & {
    paaltje_pogingen: number;
    indeling_door_mens: boolean;
    message_id: string;
    referenties: string[];
    antwoord_naar: string;
    klantgegevens: unknown;
    wa_antwoord_status?: string;
  };

const WA_KOLOMMEN =
  "id,company_id,mailbox_id,van_naam,van_email,onderwerp,tekst,ontvangen_op,in_reply_to,voorstel,klant_id,beantwoord_op,afgehandeld_op,paaltje_pogingen,indeling_door_mens,message_id,referenties,antwoord_naar,klantgegevens,kanaal,wa_telefoon,wa_antwoord_status";

async function leesRonde(db: Db) {
  const begin = Date.now();

  // Vastgelopen rondes van eerder vrijgeven.
  const { error: vrijFout } = await db
    .from("berichten")
    .update({ paaltje_status: "wacht" })
    .eq("kanaal", "mail")
    .eq("paaltje_status", "bezig")
    .lt("gelezen_door_paaltje_op", new Date(Date.now() - VASTGELOPEN_MS).toISOString());
  if (vrijFout) console.error("vastgelopen vrijgeven:", vrijFout.message);

  const { data: wachtend, error } = await db
    .from("berichten")
    .select("id,paaltje_pogingen")
    // WhatsApp heeft zijn eigen lezer.
    .eq("kanaal", "mail")
    .eq("paaltje_status", "wacht")
    .eq("op_server", true)
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(PER_RONDE);
  if (error) throw new Error(`Wachtende mail: ${error.message}`);

  const bedrijfsnamen = new Map<string, string>();
  const prijzenPerBedrijf = new Map<string, { wijk: string; prijs: number }[]>();
  let gelezen = 0;

  for (const { id, paaltje_pogingen } of wachtend ?? []) {
    if (Date.now() - begin > TIJD_MS) break;

    if (paaltje_pogingen >= MAX_POGINGEN) {
      await db
        .from("berichten")
        .update({ paaltje_status: "fout", ai_fout: "Paaltje kreeg deze mail na drie pogingen niet gelezen." })
        .eq("id", id)
        .eq("paaltje_status", "wacht");
      continue;
    }

    // Pakken: alleen als hij nog op "wacht" staat.
    const { data: gepakt, error: pakFout } = await db
      .from("berichten")
      .update({
        paaltje_status: "bezig",
        gelezen_door_paaltje_op: new Date().toISOString(),
        paaltje_pogingen: paaltje_pogingen + 1,
      })
      .eq("id", id)
      .eq("paaltje_status", "wacht")
      .select(
        "id,company_id,mailbox_id,van_naam,van_email,onderwerp,tekst,ontvangen_op,in_reply_to,voorstel,klant_id,beantwoord_op,afgehandeld_op,paaltje_pogingen,indeling_door_mens,message_id,referenties,antwoord_naar,klantgegevens",
      );
    if (pakFout) {
      console.error(`bericht ${id} pakken:`, pakFout.message);
      continue;
    }
    const mail = gepakt?.[0] as Gepakt | undefined;
    if (!mail) continue;

    // "Altijd naar spam": niet lezen; de planner zet hem zo in de spammap.
    const { data: regel } = await db
      .from("mail_regels")
      .select("id")
      .eq("mailbox_id", mail.mailbox_id)
      .eq("van_email", mail.van_email.trim().toLowerCase())
      .maybeSingle();
    if (regel) {
      await db.from("berichten").update({ paaltje_status: "overslaan" }).eq("id", mail.id);
      continue;
    }

    try {
      if (!prijzenPerBedrijf.has(mail.company_id)) {
        prijzenPerBedrijf.set(mail.company_id, await richtprijzen(db, mail.company_id));
      }
      await leesEen(db, mail, bedrijfsnamen, prijzenPerBedrijf.get(mail.company_id) ?? []);
      gelezen += 1;
    } catch (e) {
      const fout = e instanceof Error ? e.message.slice(0, 300) : String(e);
      console.error(`bericht ${id}:`, fout);
      await db.from("berichten").update({ paaltje_status: "fout", ai_fout: fout }).eq("id", id);
    }
  }
  try {
    gelezen += await leesWhatsAppRonde(db, begin, bedrijfsnamen, prijzenPerBedrijf);
  } catch (e) {
    console.error("paaltje-lezen whatsapp:", e instanceof Error ? e.message : e);
  }

  // Tijd over? Dan kijken of Paaltje iets kan leren van antwoorden die je
  // flink aanpaste. Alleen in een rustige ronde: nieuwe mail gaat voor.
  if (Date.now() - begin < TIJD_MS / 2) {
    try {
      const n = await stelAfsprakenVoor(db);
      if (n > 0) console.log(`paaltje-lezen: ${n} afspraken voorgesteld`);
    } catch (e) {
      console.error("afspraken voorstellen:", e instanceof Error ? e.message : e);
    }
  }
  console.log(`paaltje-lezen: ${gelezen} gelezen`);
}

/**
 * WhatsApp: per gesprek de wachtende berichten samen lezen. De uitkomst komt
 * op het laatste bericht; de eerdere krijgen dezelfde stand.
 */
async function leesWhatsAppRonde(
  db: Db,
  begin: number,
  bedrijfsnamen: Map<string, string>,
  prijzenPerBedrijf: Map<string, { wijk: string; prijs: number }[]>,
): Promise<number> {
  const { error: vrijFout } = await db
    .from("berichten")
    .update({ paaltje_status: "wacht" })
    .eq("kanaal", "whatsapp")
    .eq("paaltje_status", "bezig")
    .lt("gelezen_door_paaltje_op", new Date(Date.now() - VASTGELOPEN_MS).toISOString());
  if (vrijFout) console.error("whatsapp vastgelopen vrijgeven:", vrijFout.message);

  const { data: wachtend, error } = await db
    .from("berichten")
    .select("id,company_id,wa_telefoon,ontvangen_op,paaltje_pogingen")
    .eq("kanaal", "whatsapp")
    .eq("paaltje_status", "wacht")
    .is("deleted_at", null)
    .order("ontvangen_op", { ascending: false })
    .limit(60);
  if (error) throw new Error(`Wachtende WhatsApp: ${error.message}`);

  // Per gesprek, nieuwste gesprek eerst.
  const gesprekken = new Map<string, { id: string; company_id: string; wa_telefoon: string; ontvangen_op: string; paaltje_pogingen: number }[]>();
  for (const r of wachtend ?? []) {
    const sleutel = `${r.company_id}|${r.wa_telefoon}`;
    gesprekken.set(sleutel, [...(gesprekken.get(sleutel) ?? []), r]);
  }

  let gelezen = 0;
  for (const rijen of [...gesprekken.values()].slice(0, WA_PER_RONDE)) {
    if (Date.now() - begin > TIJD_MS) break;
    const nieuwste = rijen[0];
    // Typt de klant misschien nog? Dan de volgende ronde.
    if (Date.now() - new Date(nieuwste.ontvangen_op).getTime() < WA_RUST_MS) continue;
    const ids = rijen.map((r) => r.id);

    if (Math.max(...rijen.map((r) => r.paaltje_pogingen)) >= MAX_POGINGEN) {
      await db
        .from("berichten")
        .update({ paaltje_status: "fout", ai_fout: "Paaltje kreeg dit bericht na drie pogingen niet gelezen." })
        .in("id", ids)
        .eq("paaltje_status", "wacht");
      continue;
    }

    const { data: gepakt, error: pakFout } = await db
      .from("berichten")
      .update({
        paaltje_status: "bezig",
        gelezen_door_paaltje_op: new Date().toISOString(),
        paaltje_pogingen: nieuwste.paaltje_pogingen + 1,
      })
      .in("id", ids)
      .eq("paaltje_status", "wacht")
      .select(WA_KOLOMMEN);
    if (pakFout) {
      console.error(`whatsapp ${nieuwste.wa_telefoon} pakken:`, pakFout.message);
      continue;
    }
    const berichten = ((gepakt ?? []) as Gepakt[]).sort((a, b) => a.ontvangen_op.localeCompare(b.ontvangen_op));
    if (berichten.length === 0) continue;
    const laatste = berichten[berichten.length - 1];
    const eerdere = berichten.slice(0, -1).map((b) => b.id);

    try {
      const { data: ervoor, error: gesprekFout } = await db
        .from("berichten")
        .select("richting,tekst,ontvangen_op")
        .eq("company_id", laatste.company_id)
        .eq("kanaal", "whatsapp")
        .eq("wa_telefoon", laatste.wa_telefoon)
        .lt("ontvangen_op", berichten[0].ontvangen_op)
        .is("deleted_at", null)
        .order("ontvangen_op", { ascending: false })
        .limit(WA_GESPREK);
      if (gesprekFout) throw new Error(`Gesprek ophalen: ${gesprekFout.message}`);

      const mail: Gepakt = {
        ...laatste,
        kanaal: "whatsapp",
        tekst: berichten.map((b) => b.tekst).filter(Boolean).join("\n"),
        van_naam: [...berichten].reverse().find((b) => b.van_naam)?.van_naam ?? "",
        klant_id: [...berichten].reverse().find((b) => b.klant_id)?.klant_id ?? null,
        gesprek: ((ervoor ?? []) as { richting: "in" | "uit"; tekst: string; ontvangen_op: string }[]).reverse(),
      };
      if (!prijzenPerBedrijf.has(mail.company_id)) {
        prijzenPerBedrijf.set(mail.company_id, await richtprijzen(db, mail.company_id));
      }
      await leesEen(db, mail, bedrijfsnamen, prijzenPerBedrijf.get(mail.company_id) ?? []);
      gelezen += 1;

      // De eerdere berichtjes volgen het laatste: klaar, weer wachten of fout.
      if (eerdere.length > 0) {
        const { data: stand, error: standFout } = await db
          .from("berichten")
          .select("paaltje_status,is_klantmail")
          .eq("id", laatste.id)
          .single();
        if (standFout) throw new Error(`Stand lezen: ${standFout.message}`);
        const status = stand?.paaltje_status === "bezig" ? "wacht" : (stand?.paaltje_status ?? "wacht");
        const { error: volgFout } = await db
          .from("berichten")
          .update({
            paaltje_status: status,
            ...(status === "klaar"
              ? { is_klantmail: stand?.is_klantmail ?? null, samenvatting: "Samen gelezen met het bericht erna.", paaltje_pogingen: 0 }
              : {}),
          })
          .in("id", eerdere)
          .eq("paaltje_status", "bezig");
        if (volgFout) throw new Error(`Eerdere berichtjes bijwerken: ${volgFout.message}`);
      }
    } catch (e) {
      const fout = e instanceof Error ? e.message.slice(0, 300) : String(e);
      console.error(`whatsapp ${laatste.id}:`, fout);
      await db.from("berichten").update({ paaltje_status: "fout", ai_fout: fout }).in("id", ids);
    }
  }
  return gelezen;
}

async function leesEen(
  db: Db,
  mail: Gepakt,
  bedrijfsnamen: Map<string, string>,
  prijzen: { wijk: string; prijs: number }[],
) {
  let naam = bedrijfsnamen.get(mail.company_id);
  if (naam === undefined) {
    const { data } = await db
      .from("companies")
      .select("name,mail_afzender_naam")
      .eq("id", mail.company_id)
      .single();
    naam = String(data?.mail_afzender_naam || data?.name || "het bedrijf");
    bedrijfsnamen.set(mail.company_id, naam);
  }

  const [uit, categorieen] = await Promise.all([
    leesMail(db, mail, naam, prijzen),
    categorieenVan(db, mail.company_id),
  ]);

  // Lukte het lezen niet: een storing die overgaat terug in de rij (tot het
  // maximum aantal pogingen), anders op "fout" zodat een mens kan kijken.
  if (uit.ai_fout) {
    const tijdelijk = TIJDELIJK.test(uit.ai_fout) && mail.paaltje_pogingen < MAX_POGINGEN;
    await db
      .from("berichten")
      .update({ paaltje_status: tijdelijk ? "wacht" : "fout", ai_fout: uit.ai_fout })
      .eq("id", mail.id);
    return;
  }

  const bewaarVoorstel = async (v: Voorstel) => {
    const { error } = await db.from("berichten").update({ voorstel: v }).eq("id", mail.id);
    if (error) throw new Error(`Voorstel bewaren: ${error.message}`);
  };

  // Koos een mens de categorieën, dan rekenen de acties met die indeling en
  // niet met wat Paaltje nu zelf denkt.
  let indeling = uit.categorieen;
  if (mail.indeling_door_mens) {
    const { data: vanMens, error: mensFout } = await db
      .from("bericht_categorieen")
      .select("categorie_id")
      .eq("bericht_id", mail.id);
    if (mensFout) throw new Error(`Categorieën lezen: ${mensFout.message}`);
    indeling = (vanMens ?? []).map((r: { categorie_id: string }) => ({ id: r.categorie_id, zekerheid: 1 }));
  }

  // Koos jij categorieën, dan is het voor jou klantmail, ook als Paaltje nu
  // anders denkt.
  const isKlantmail = uit.is_klantmail || (mail.indeling_door_mens && indeling.length > 0);

  // Klantgegevens (zie _gedeeld/klantgegevens.ts). Hoort het mailadres bij geen
  // klant, maar klopt het telefoonnummer (of adres én naam) wel bij een klant,
  // dan koppelen we het adres en leest Paaltje de mail de volgende ronde
  // opnieuw, nu mét die klant. Zo komt er niet eerst een aanmelding of een
  // antwoord alsof het een onbekende is.
  const eerderKg = leesKlantgegevens(mail.klantgegevens);
  let gokUitAdres: string | null = null;
  if (isKlantmail && uit.aanmelding && !mail.klant_id && !uit.klant_bekend) {
    const { herkend: opTelefoonOfAdres, gok, leegAdres } = await herken(
      db,
      mail.company_id,
      uit.aanmelding,
      mail.van_naam,
      eerderKg.afgewezen ?? [],
    );
    let herkend: {
      klant_id: string;
      via: "telefoon" | "adres";
      aangemaakt?: boolean;
      customer_id?: string;
    } | null = opTelefoonOfAdres;
    // Het adres staat er wel, maar er hangt nog geen klant aan (bijvoorbeeld net
    // geïmporteerd): dan maakt Wooshy de klant zelf aan. Een lege plek vullen
    // mag, net als op de aanmeldpagina; het gele vakje heeft Ongedaan maken.
    if (!herkend && leegAdres && (await magKlantAanmaken(db, mail.company_id, leegAdres))) {
      const nieuw = await maakKlantBijAdres(db, mail.company_id, leegAdres, uit.aanmelding, mail.van_naam);
      if (nieuw) herkend = { klant_id: nieuw, via: "adres", aangemaakt: true, customer_id: leegAdres };
    }
    if (herkend) {
      const email = mail.van_email.trim().toLowerCase();
      const nummer = mail.kanaal === "whatsapp" ? telefoonAlsSleutel(mail.wa_telefoon ?? "") : "";
      try {
        if (nummer) {
          const { error: koppelFout } = await db
            .from("klant_telefoons")
            .insert({ company_id: mail.company_id, klant_id: herkend.klant_id, telefoon: nummer, bron: "paaltje" });
          if (koppelFout && koppelFout.code !== "23505") throw new Error(`Nummer koppelen: ${koppelFout.message}`);
        } else if (email) {
          const { error: koppelFout } = await db
            .from("klant_emails")
            .insert({ company_id: mail.company_id, klant_id: herkend.klant_id, email, bron: "paaltje" });
          if (koppelFout && koppelFout.code !== "23505") throw new Error(`Mailadres koppelen: ${koppelFout.message}`);
        }
        const opnieuw: KlantGegevens = {
          ...eerderKg,
          gevonden: uit.aanmelding,
          herkend: { ...herkend, email },
        };
        const { error: terugFout } = await db
          .from("berichten")
          .update({
            klant_id: herkend.klant_id,
            klant_gok_id: null,
            klantgegevens: opnieuw,
            paaltje_status: "wacht",
            paaltje_pogingen: 0,
            ai_fout: "",
          })
          .eq("id", mail.id);
        if (terugFout) throw new Error(`Herkende klant bewaren: ${terugFout.message}`);
      } catch (e) {
        // Maakte Wooshy de klant net aan, dan die meteen weer weg: anders blijft
        // er een klant op het adres staan zonder dat bewaard is dat Wooshy hem
        // maakte, en kun je hem niet meer ongedaan maken.
        if (herkend.aangemaakt && herkend.customer_id) {
          await draaiAanmakenTerug(db, mail.company_id, herkend.customer_id, herkend.klant_id);
        }
        throw e;
      }
      return;
    }
    gokUitAdres = gok;
  }

  // Herkend aan telefoon of adres in de mail is niet hetzelfde als zeker: dat
  // kan iedereen typen. Zolang een mens het niet bevestigde, voert Paaltje
  // voor deze klant niets zelf door en komt het mailadres niet bij de klant.
  const klantVoorActies = mail.klant_id ?? uit.klant_id;
  const klantZeker = klantVoorActies
    ? mail.kanaal === "whatsapp"
      ? await nummerZeker(db, mail.company_id, mail.wa_telefoon ?? "", klantVoorActies)
      : await zekerGekoppeld(db, mail.company_id, mail.van_email, klantVoorActies)
    : true;

  // WhatsApp: bij een bekend nummer voert Paaltje overslaan zelf door (zo
  // gekozen), ook als het voor mail op voorstellen staat. Een nummer is veel
  // lastiger na te maken dan een afzender van een mail.
  const categorieenVoorActies: Categorie[] =
    mail.kanaal === "whatsapp"
      ? categorieen.map((c) =>
          c.sleutel === "overslaan" && c.zelfstandigheid === "concept_voorstel"
            ? { ...c, zelfstandigheid: "zelf_doorvoeren" }
            : c,
        )
      : categorieen;

  const acties = await voerActiesUit(
    db,
    mail,
    { ...uit, is_klantmail: isKlantmail, categorieen: indeling },
    categorieenVoorActies,
    {
      klant_id: mail.klant_id,
      klant_zeker: klantZeker,
      beantwoord_op: mail.beantwoord_op,
      afgehandeld_op: mail.afgehandeld_op,
      voorstel: (mail.voorstel as Voorstel | null) ?? {},
    },
    bewaarVoorstel,
  );
  const concept = acties.conceptToegestaan ? uit.concept : "";

  const bijwerken: Record<string, unknown> = {
    is_klantmail: isKlantmail,
    samenvatting: uit.samenvatting,
    zekerheid: uit.zekerheid,
    voorstel: acties.voorstel,
    ai_fout: "",
    paaltje_status: "klaar",
    paaltje_pogingen: 0,
    gelezen_door_paaltje_op: new Date().toISOString(),
    klant_gok_id: mail.klant_id ? null : (uit.klant_gok_id ?? gokUitAdres),
  };

  // Lege vakjes bij de klant aanvullen met wat in de mail staat. Een fout hier
  // maakt de gelezen mail niet "fout": het aanvullen is een extraatje.
  const klantgegevens: KlantGegevens = { ...eerderKg };
  delete klantgegevens.anders;
  if (isKlantmail) {
    if (uit.aanmelding) klantgegevens.gevonden = uit.aanmelding;
    const klantId = mail.klant_id ?? uit.klant_id;
    if (klantId) {
      try {
        const r = await vulAan(
          db,
          mail.company_id,
          klantId,
          uit.aanmelding ?? GEEN_GEGEVENS,
          klantZeker && mail.kanaal !== "whatsapp" ? mail.van_email : "",
          eerderKg.teruggedraaid?.waarden ?? [],
        );
        // Opnieuw lezen vindt de vakjes niet meer leeg: wat er eerder bij
        // dezelfde klant ingevuld werd, blijft in de lijst staan.
        const eerder = eerderKg.toegevoegd?.klant_id === klantId ? eerderKg.toegevoegd.velden : {};
        const velden = { ...eerder, ...r.toegevoegd };
        if (Object.keys(velden).length > 0) klantgegevens.toegevoegd = { klant_id: klantId, velden };
        else delete klantgegevens.toegevoegd;
        if (Object.keys(r.anders).length > 0) klantgegevens.anders = r.anders;
      } catch (e) {
        console.error(`klantgegevens ${mail.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  bijwerken.klantgegevens = klantgegevens;
  // Een al beantwoorde mail houdt zijn verstuurde tekst, en ook het concept
  // van Paaltje waar dat antwoord op aansloot: een nieuw concept achteraf zou
  // bij "afspraken voorstellen" vergeleken worden met iets dat nooit iemand zag.
  if (!mail.beantwoord_op) {
    bijwerken.concept = concept;
    bijwerken.concept_paaltje = concept;
  }
  // Een klant die een mens al koppelde blijft staan.
  if (!mail.klant_id && uit.klant_id) bijwerken.klant_id = uit.klant_id;
  // Geen klantmail: niets te doen, meteen afgehandeld — en onthouden dat
  // Paaltje dat deed, zodat opnieuw lezen het kan terugnemen.
  if (!isKlantmail && !mail.afgehandeld_op) {
    bijwerken.afgehandeld_op = new Date().toISOString();
    bijwerken.afgehandeld_door_paaltje = true;
  }

  // Categorieën: die van een mens blijven; die van Paaltje worden vervangen.
  // Vlak voor het schrijven nog eens kijken: de indeling kan tijdens het lezen
  // door een mens zijn aangepast.
  const { data: nu, error: nuFout } = await db
    .from("berichten")
    .select("indeling_door_mens")
    .eq("id", mail.id)
    .single();
  if (nuFout) throw new Error(`Indeling controleren: ${nuFout.message}`);
  if (!mail.indeling_door_mens && !nu?.indeling_door_mens) {
    const { error: wegFout } = await db
      .from("bericht_categorieen")
      .delete()
      .eq("bericht_id", mail.id)
      .eq("door", "paaltje");
    if (wegFout) throw new Error(`Oude categorieën weghalen: ${wegFout.message}`);
    if (uit.categorieen.length > 0) {
      const { error: catFout } = await db.from("bericht_categorieen").insert(
        uit.categorieen.map((c) => ({
          bericht_id: mail.id,
          categorie_id: c.id,
          company_id: mail.company_id,
          zekerheid: c.zekerheid,
          door: "paaltje",
        })),
      );
      if (catFout) throw new Error(`Categorieën bewaren: ${catFout.message}`);
    }
  }

  // WhatsApp: zelf antwoorden inplannen, als alles klopt.
  if (mail.kanaal === "whatsapp") {
    Object.assign(
      bijwerken,
      await planWhatsAppAntwoord(db, mail, {
        isKlantmail,
        indeling,
        categorieen,
        klantId: mail.klant_id ?? uit.klant_id,
        klantZeker,
        zekerheid: uit.zekerheid,
        concept,
        wilGeenWhatsApp: uit.wil_geen_whatsapp,
        klantAfgemeld: await klantAfgemeld(db, mail.company_id, mail.klant_id ?? uit.klant_id),
        overslaanGevraagd: indeling.some((c) => categorieen.find((x) => x.id === c.id)?.sleutel === "overslaan"),
        overslaanDoorgevoerd: acties.voorstel.overslaan?.doorgevoerd === true,
      }),
    );
  }

  // Pas nu "klaar": tot hier stond de mail op "bezig", en dan kan niemand
  // tussendoor de indeling wijzigen.
  const { error } = await db.from("berichten").update(bijwerken).eq("id", mail.id);
  if (error) throw new Error(`Uitkomst bewaren: ${error.message}`);

  // Een klacht van een bekende klant komt in zijn dossier. Een fout hier maakt
  // de gelezen mail niet "fout": de indeling als klacht staat er al.
  const klachtCategorie = categorieen.find((c) => c.sleutel === "klachten")?.id;
  const klantVanKlacht = mail.klant_id ?? uit.klant_id;
  if (isKlantmail && klantVanKlacht && indeling.some((c) => c.id === klachtCategorie)) {
    try {
      await klachtUitMail(db, mail, klantVanKlacht, uit.klacht, uit.aanmelding, mail.kanaal === "whatsapp" ? "app" : "mail");
    } catch (e) {
      console.error(`klacht ${mail.id}:`, e instanceof Error ? e.message : e);
    }
  }

  // Voerde Paaltje overslaan zelf door (alleen bij "zelf doorvoeren"), dan
  // stuurt hij ook zelf de bevestiging: dat hoort bij dezelfde keuze. Lukt het
  // versturen niet, dan blijft het concept op jou wachten en staat de reden
  // bij de mail. Een fout hier maakt de al gelezen mail nooit weer "fout".
  // WhatsApp: "stop" gezegd. Bij een bekende klant zetten we WhatsApp voor
  // hem uit, zichtbaar en terug te draaien in het rapport.
  if (mail.kanaal === "whatsapp" && isKlantmail && uit.wil_geen_whatsapp) {
    const klantId = mail.klant_id ?? uit.klant_id;
    // Alleen als het nummer zeker bij deze klant hoort: anders kan een ander
    // nummer WhatsApp uitzetten voor iemand die het wel wil.
    if (klantId && klantZeker) {
      try {
        await zetWhatsAppUit(db, mail, klantId, uit.zekerheid);
      } catch (e) {
        console.error(`whatsapp uitzetten ${mail.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  if (mail.kanaal !== "whatsapp" && acties.doorgevoerd && concept && !mail.beantwoord_op) {
    let reden: string;
    try {
      reden = await stuurAntwoord(db, mail, concept);
    } catch (e) {
      reden = e instanceof Error ? e.message : String(e);
    }
    if (reden) {
      console.error(`bevestiging ${mail.id} niet verstuurd:`, reden);
      try {
        const { data: nu } = await db.from("berichten").select("voorstel").eq("id", mail.id).maybeSingle();
        await db
          .from("berichten")
          .update({ voorstel: { ...(nu?.voorstel ?? {}), bevestiging_fout: reden.slice(0, 300) } })
          .eq("id", mail.id);
      } catch (e) {
        console.error("reden bewaren:", e instanceof Error ? e.message : e);
      }
    }
  }
}

/** Hoort dit nummer echt bij deze klant (op de klant zelf, of door een mens gekoppeld)? */
async function nummerZeker(db: Db, companyId: string, waTelefoon: string, klantId: string): Promise<boolean> {
  const nummer = telefoonAlsSleutel(waTelefoon);
  if (!nummer) return false;
  const { data, error } = await db
    .from("klant_telefoons")
    .select("id")
    .eq("company_id", companyId)
    .eq("klant_id", klantId)
    .eq("telefoon", nummer)
    .in("bron", ["klant", "mens"])
    .limit(1);
  if (error) throw new Error(`Nummer nakijken: ${error.message}`);
  return (data ?? []).length > 0;
}

interface AntwoordKeuze {
  isKlantmail: boolean;
  indeling: { id: string; zekerheid: number }[];
  categorieen: Categorie[];
  klantId: string | null;
  klantZeker: boolean;
  zekerheid: number;
  concept: string;
  wilGeenWhatsApp: boolean;
  klantAfgemeld: boolean;
  overslaanGevraagd: boolean;
  overslaanDoorgevoerd: boolean;
}

/**
 * Mag Paaltje dit WhatsApp-bericht zelf beantwoorden, en wanneer? Alleen als
 * elke gekozen categorie dat toestaat, de klant zeker bekend is aan zijn
 * nummer, Paaltje heel zeker is, en bij overslaan het overslaan ook echt
 * doorgevoerd is. Het versturen zelf doet de planner, na de wachttijd.
 */
async function planWhatsAppAntwoord(db: Db, mail: Gepakt, k: AntwoordKeuze): Promise<Record<string, unknown>> {
  // Al verstuurd of net bezig: niet opnieuw.
  if (mail.wa_antwoord_status === "verstuurd" || mail.wa_antwoord_status === "bezig") return {};

  const gekozen = k.indeling
    .map((c) => k.categorieen.find((x) => x.id === c.id))
    .filter((c): c is Categorie => !!c);
  const reden =
    mail.beantwoord_op
      ? "Er is al geantwoord."
      : !k.isKlantmail || gekozen.length === 0
        ? "Geen klantbericht."
        : !gekozen.every((c) => c.zelf_antwoorden_whatsapp)
          ? "Voor deze soort bericht antwoordt Paaltje niet zelf."
          : !k.klantId || !k.klantZeker
            ? "Het nummer hoort niet zeker bij een klant."
            : k.klantAfgemeld
              ? "Deze klant heeft WhatsApp uitgezet."
            : k.wilGeenWhatsApp
              ? "De klant wil geen WhatsApp meer."
              : k.zekerheid < ZEKER_AUTOMATISCH
                ? "Paaltje is niet zeker genoeg."
                : !k.concept
                  ? "Er is geen antwoord."
                  : k.overslaanGevraagd && !k.overslaanDoorgevoerd
                    ? "Het overslaan is niet vanzelf doorgevoerd."
                    : "";
  if (reden) {
    // Stond er van een eerdere lezing iets gepland, dan vervalt dat.
    return mail.wa_antwoord_status === "gepland"
      ? { wa_antwoord_status: "geannuleerd", wa_antwoord_reden: reden, wa_antwoord_op: null }
      : { wa_antwoord_reden: reden };
  }

  const { data: bedrijf, error } = await db
    .from("companies")
    .select("wa_wachttijd_min,wa_antwoord_van,wa_antwoord_tot")
    .eq("id", mail.company_id)
    .single();
  if (error) throw new Error(`Antwoordtijden: ${error.message}`);
  const wacht = Number(bedrijf?.wa_wachttijd_min ?? 10);
  const vanaf = new Date(Math.max(Date.now(), new Date(mail.ontvangen_op).getTime() + wacht * 60_000));
  const op = binnenAntwoordtijd(vanaf, String(bedrijf?.wa_antwoord_van ?? "07:00"), String(bedrijf?.wa_antwoord_tot ?? "21:00"));
  return { wa_antwoord_status: "gepland", wa_antwoord_op: op.toISOString(), wa_antwoord_reden: "" };
}

async function zetWhatsAppUit(db: Db, mail: Gepakt, klantId: string, zekerheid: number) {
  const { data: klant, error } = await db
    .from("klanten")
    .select("id,naam,wa_afgemeld_op")
    .eq("company_id", mail.company_id)
    .eq("id", klantId)
    .maybeSingle();
  if (error) throw new Error(`Klant ophalen: ${error.message}`);
  if (!klant || klant.wa_afgemeld_op) return;
  const nu = new Date().toISOString();
  const { error: uitFout } = await db
    .from("klanten")
    .update({ wa_afgemeld_op: nu })
    .eq("company_id", mail.company_id)
    .eq("id", klantId)
    .is("wa_afgemeld_op", null);
  if (uitFout) throw new Error(`WhatsApp uitzetten: ${uitFout.message}`);
  const { error: rapportFout } = await db.from("mail_wijzigingen").insert({
    company_id: mail.company_id,
    bericht_id: mail.id,
    soort: "whatsapp_afgemeld",
    klant: klant.naam,
    adres: "",
    automatisch: true,
    zekerheid,
    details: { klant_id: klantId, afgemeld_op: nu },
  });
  if (rapportFout) console.error("rapport whatsapp uit:", rapportFout.message);
}

async function klantAfgemeld(db: Db, companyId: string, klantId: string | null): Promise<boolean> {
  if (!klantId) return false;
  const { data, error } = await db
    .from("klanten")
    .select("wa_afgemeld_op")
    .eq("company_id", companyId)
    .eq("id", klantId)
    .maybeSingle();
  if (error) throw new Error(`Klant nakijken: ${error.message}`);
  return !!data?.wa_afgemeld_op;
}
