/**
 * Elke ochtend om half zeven (Nederlandse tijd): het dagrapport.
 *
 * pg_cron roept dit om 04:30 en 05:30 UTC aan; alleen de aanroep waarbij het
 * in Nederland zes uur is doet echt iets. Per bedrijf één rapport per dag
 * (unieke sleutel op de datum), over de tijd sinds het vorige rapport.
 *
 * De mail gaat naar de eigenaar(s), vanaf de eigen mailbox als die gekoppeld
 * is. Die mail komt daarna ook in het eigen postvak; omdat hij van het eigen
 * adres komt, leest Paaltje hem niet en telt hij niet als binnengekomen.
 * Mislukte het mailen, dan probeert de volgende aanroep het opnieuw.
 *
 * `{ "proef": true }` stelt het rapport samen en geeft het terug, zonder te
 * bewaren of te mailen — om te kijken of het klopt.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord } from "../_gedeeld/mail.ts";
import { cronSleutelKlopt } from "../_gedeeld/cron.ts";
import { alsTekst, heeftIets, stelSamen, type RapportInhoud } from "../_gedeeld/dagrapport.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import { maakOp } from "../_gedeeld/opmaken.ts";
import { stuurMail } from "../_gedeeld/mail.ts";
import { verstuurBericht } from "../_gedeeld/smtp.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// deno-lint-ignore no-explicit-any
type Db = any;

const APP_URL = Deno.env.get("WOOSHY_APP_URL") ?? "https://timm-ouip-glazenwassapp.wasapp.workers.dev";

/** Datum en uur in Nederland. */
function nederland(nu: Date): { datum: string; uur: number } {
  const delen = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nu);
  const deel = (t: string) => delen.find((d) => d.type === t)?.value ?? "";
  return { datum: `${deel("year")}-${deel("month")}-${deel("day")}`, uur: Number(deel("hour")) };
}

type Bedrijf = { id: string; name: string };

Deno.serve(async (req) => {
  if (!(await cronSleutelKlopt(req))) return antwoord({ ok: false }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return antwoord({ ok: false, fase: "instellingen" }, 500);
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let proef = false;
  try {
    proef = ((await req.json()) as { proef?: boolean }).proef === true;
  } catch {
    // lege body van de cron
  }

  const nu = new Date();
  const { datum, uur } = nederland(nu);

  // Elke echte aanroep (ook die van het "verkeerde" uur) probeert eerst de
  // rapporten van de afgelopen dagen die nog niet gemaild konden worden.
  if (!proef) {
    try {
      await mailAchterstand(db, nu);
    } catch (e) {
      console.error("achterstand mailen:", e instanceof Error ? e.message : e);
    }
  }

  if (!proef && uur !== 6) return antwoord({ ok: true, overgeslagen: `het is ${uur} uur in Nederland` });

  const { data: bedrijven, error } = await db.from("companies").select("id,name");
  if (error) return antwoord({ ok: false, fase: "bedrijven", fout: error.message.slice(0, 200) }, 500);

  const werk = async () => {
    const uitkomsten: Record<string, unknown>[] = [];
    for (const bedrijf of (bedrijven ?? []) as Bedrijf[]) {
      try {
        uitkomsten.push({ bedrijf: bedrijf.name, ...(await rapportVoor(db, bedrijf, datum, nu, proef)) });
      } catch (e) {
        const fout = e instanceof Error ? e.message.slice(0, 200) : String(e);
        console.error(`dagrapport ${bedrijf.id}:`, fout);
        uitkomsten.push({ bedrijf: bedrijf.name, fout });
      }
    }
    return uitkomsten;
  };

  // De proef wacht op de uitkomst (daar gaat het om). De echte ronde antwoordt
  // meteen en werkt op de achtergrond door: pg_cron wacht niet eindeloos, en
  // mailen naar meerdere bedrijven kan even duren.
  if (proef) return antwoord({ ok: true, datum, uitkomsten: await werk() });
  const bezig = werk().then((u) => console.log("dagrapport:", JSON.stringify(u).slice(0, 500)));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(bezig);
  else await bezig;
  return antwoord({ ok: true, datum });
});

/** Rapporten van de afgelopen drie dagen die nog niet gemaild zijn, alsnog mailen. */
async function mailAchterstand(db: Db, nu: Date) {
  const sinds = new Date(nu.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("dagrapporten")
    .select("id,datum,inhoud,company_id,companies(name)")
    .is("gemaild_op", null)
    .gte("datum", sinds)
    .limit(20);
  if (error) throw new Error(`Achterstand: ${error.message}`);
  for (const r of data ?? []) {
    const bedrijf = { id: r.company_id, name: r.companies?.name ?? "" };
    await mailEnNoteer(db, bedrijf, r.datum, r.id, r.inhoud as RapportInhoud);
  }
}

async function rapportVoor(
  db: Db,
  bedrijf: Bedrijf,
  datum: string,
  nu: Date,
  proef: boolean,
): Promise<Record<string, unknown>> {
  // Al gedaan vandaag? Dan alleen nog mailen als dat de vorige keer mislukte.
  const { data: bestaand, error: bestaandFout } = await db
    .from("dagrapporten")
    .select("id,inhoud,gemaild_op")
    .eq("company_id", bedrijf.id)
    .eq("datum", datum)
    .maybeSingle();
  if (bestaandFout) throw new Error(`Rapport van vandaag: ${bestaandFout.message}`);
  if (bestaand && !proef) {
    if (bestaand.gemaild_op) return { status: "al gedaan" };
    return await mailEnNoteer(db, bedrijf, datum, bestaand.id, bestaand.inhoud as RapportInhoud);
  }

  // Vanaf het vorige rapport, en anders de afgelopen 24 uur.
  const { data: vorige, error: vorigeFout } = await db
    .from("dagrapporten")
    .select("tot")
    .eq("company_id", bedrijf.id)
    .order("datum", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vorigeFout) throw new Error(`Vorig rapport: ${vorigeFout.message}`);
  const vanaf = vorige?.tot ? new Date(vorige.tot) : new Date(nu.getTime() - 24 * 60 * 60 * 1000);

  const inhoud = await stelSamen(db, bedrijf.id, vanaf, nu);
  if (proef) return { status: "proef", inhoud, tekst: alsTekst(inhoud, APP_URL) };
  if (!heeftIets(inhoud)) return { status: "niets gebeurd" };

  // Eerst vastleggen (de unieke datum voorkomt een tweede), dan pas mailen.
  const { data: rapport, error } = await db
    .from("dagrapporten")
    .insert({ company_id: bedrijf.id, datum, vanaf: vanaf.toISOString(), tot: nu.toISOString(), inhoud })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { status: "al gedaan" };
    throw new Error(`Rapport bewaren: ${error.message}`);
  }
  return await mailEnNoteer(db, bedrijf, datum, rapport.id, inhoud);
}

async function mailEnNoteer(
  db: Db,
  bedrijf: Bedrijf,
  datum: string,
  rapportId: string,
  inhoud: RapportInhoud,
): Promise<Record<string, unknown>> {
  const mailFout = await mail(db, bedrijf, datum, alsTekst(inhoud, APP_URL));
  const { error } = await db
    .from("dagrapporten")
    .update(mailFout ? { mail_fout: mailFout.slice(0, 300) } : { gemaild_op: new Date().toISOString(), mail_fout: "" })
    .eq("id", rapportId);
  if (error) console.error(`dagrapport ${bedrijf.id} vastleggen:`, error.message);
  return { status: mailFout ? "bewaard, mailen mislukte" : "verstuurd", fout: mailFout || undefined };
}

/** Het rapport mailen naar de eigenaar(s). Geeft een lege tekst als het lukte. */
async function mail(db: Db, bedrijf: Bedrijf, datum: string, tekst: string): Promise<string> {
  const { data: eigenaren, error: eigenaarFout } = await db
    .from("employees")
    .select("email")
    .eq("company_id", bedrijf.id)
    .eq("rol", "eigenaar");
  if (eigenaarFout) return `Eigenaren opzoeken lukte niet: ${eigenaarFout.message}`;
  const aan = [...new Set((eigenaren ?? []).map((e: { email: string }) => String(e.email ?? "").trim().toLowerCase()))]
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .map((email) => ({ email }));
  if (aan.length === 0) return "Geen eigenaar met een mailadres.";

  const [jaar, maand, dag] = datum.split("-");
  const onderwerp = `Wooshy dagrapport ${Number(dag)}-${Number(maand)}-${jaar}`;

  const { data: box, error: boxFout } = await db
    .from("mailboxen")
    .select("id,adres,smtp_host,smtp_poort,status")
    .eq("company_id", bedrijf.id)
    .maybeSingle();
  if (boxFout) return `Mailbox opzoeken lukte niet: ${boxFout.message}`;
  // Werkt de eigen mailbox niet (juist dan staat dat in het rapport), dan via
  // Brevo, waarmee ook de aankondigingen gaan.
  if (!box || box.status !== "actief") return await viaBrevo(db, bedrijf, aan, onderwerp, tekst);
  const { data: geheim, error: geheimFout } = await db
    .from("mailbox_geheimen")
    .select("versleuteld,iv")
    .eq("mailbox_id", box.id)
    .maybeSingle();
  if (geheimFout) return `Wachtwoord opzoeken lukte niet: ${geheimFout.message}`;
  if (!geheim) return "De mailbox heeft geen wachtwoord meer.";

  try {
    const wachtwoord = await ontsleutel(geheim.versleuteld, geheim.iv);
    const opgemaakt = await maakOp({
      van: { naam: "Paaltje (Wooshy)", adres: box.adres },
      aan,
      onderwerp,
      tekst,
    });
    await verstuurBericht(
      { host: box.smtp_host, poort: box.smtp_poort, adres: box.adres, wachtwoord },
      opgemaakt.ontvangers,
      opgemaakt.bericht,
    );
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Het rapport via Brevo, voor als de eigen mailbox niet werkt. */
async function viaBrevo(
  db: Db,
  bedrijf: Bedrijf,
  aan: { email: string }[],
  onderwerp: string,
  tekst: string,
): Promise<string> {
  const sleutel = Deno.env.get("BREVO_API_KEY") ?? "";
  const { data: instellingen, error } = await db
    .from("companies")
    .select("name,mail_afzender_naam,mail_afzender_email")
    .eq("id", bedrijf.id)
    .single();
  if (error) return `Afzender opzoeken lukte niet: ${error.message}`;
  const afzenderEmail = String(instellingen?.mail_afzender_email ?? "").trim();
  if (!sleutel || !afzenderEmail) {
    return "De mailbox werkt niet en er is geen andere manier ingesteld om het rapport te mailen.";
  }
  const afzender = { naam: String(instellingen?.mail_afzender_naam || instellingen?.name || "Wooshy"), email: afzenderEmail };
  for (const ontvanger of aan) {
    const uit = await stuurMail(sleutel, afzender, { naar: { email: ontvanger.email, naam: "" }, onderwerp, tekst });
    if (!uit.ok) return `Via Brevo mailen lukte niet: ${uit.fout}`;
  }
  return "";
}
