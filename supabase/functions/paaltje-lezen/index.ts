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
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { cronSleutelKlopt } from "../_gedeeld/cron.ts";
import { categorieenVan, leesMail, richtprijzen, type TeLezen } from "../_gedeeld/paaltje.ts";
import { voerActiesUit, type MailStand, type Voorstel } from "../_gedeeld/acties.ts";
import { stuurAntwoord } from "../_gedeeld/verzenden.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const PER_RONDE = 8;
/** Na zoveel tijd begint de ronde geen nieuwe mail meer. */
const TIJD_MS = 90_000;
const VASTGELOPEN_MS = 10 * 60_000;
const MAX_POGINGEN = 3;
/** Storingen die vanzelf overgaan: dan later nog eens, niet meteen "fout". */
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
  };

async function leesRonde(db: Db) {
  const begin = Date.now();

  // Vastgelopen rondes van eerder vrijgeven.
  const { error: vrijFout } = await db
    .from("berichten")
    .update({ paaltje_status: "wacht" })
    .eq("paaltje_status", "bezig")
    .lt("gelezen_door_paaltje_op", new Date(Date.now() - VASTGELOPEN_MS).toISOString());
  if (vrijFout) console.error("vastgelopen vrijgeven:", vrijFout.message);

  const { data: wachtend, error } = await db
    .from("berichten")
    .select("id,paaltje_pogingen")
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
        "id,company_id,mailbox_id,van_naam,van_email,onderwerp,tekst,ontvangen_op,in_reply_to,voorstel,klant_id,beantwoord_op,afgehandeld_op,paaltje_pogingen,indeling_door_mens,message_id,referenties,antwoord_naar",
      );
    if (pakFout) {
      console.error(`bericht ${id} pakken:`, pakFout.message);
      continue;
    }
    const mail = gepakt?.[0] as Gepakt | undefined;
    if (!mail) continue;

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
  console.log(`paaltje-lezen: ${gelezen} gelezen`);
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

  const acties = await voerActiesUit(
    db,
    mail,
    { ...uit, is_klantmail: isKlantmail, categorieen: indeling },
    categorieen,
    {
      klant_id: mail.klant_id,
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
    klant_gok_id: mail.klant_id ? null : uit.klant_gok_id,
    concept_paaltje: concept,
  };
  // Een al beantwoorde mail houdt zijn verstuurde tekst.
  if (!mail.beantwoord_op) bijwerken.concept = concept;
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

  // Pas nu "klaar": tot hier stond de mail op "bezig", en dan kan niemand
  // tussendoor de indeling wijzigen.
  const { error } = await db.from("berichten").update(bijwerken).eq("id", mail.id);
  if (error) throw new Error(`Uitkomst bewaren: ${error.message}`);

  // Voerde Paaltje overslaan zelf door (alleen bij "zelf doorvoeren"), dan
  // stuurt hij ook zelf de bevestiging: dat hoort bij dezelfde keuze. Lukt het
  // versturen niet, dan blijft het concept op jou wachten en staat de reden
  // bij de mail. Een fout hier maakt de al gelezen mail nooit weer "fout".
  if (acties.doorgevoerd && concept && !mail.beantwoord_op) {
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
