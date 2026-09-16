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
        "id,company_id,mailbox_id,van_naam,van_email,onderwerp,tekst,ontvangen_op,in_reply_to,voorstel,klant_id,beantwoord_op,afgehandeld_op,paaltje_pogingen,indeling_door_mens,message_id,referenties,antwoord_naar,klantgegevens",
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
      try {
        if (email) {
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
    ? await zekerGekoppeld(db, mail.company_id, mail.van_email, klantVoorActies)
    : true;

  const acties = await voerActiesUit(
    db,
    mail,
    { ...uit, is_klantmail: isKlantmail, categorieen: indeling },
    categorieen,
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
          klantZeker ? mail.van_email : "",
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
      await klachtUitMail(db, mail, klantVanKlacht, uit.samenvatting, uit.aanmelding);
    } catch (e) {
      console.error(`klacht ${mail.id}:`, e instanceof Error ? e.message : e);
    }
  }

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
