/**
 * De dagelijkse ronde herinneringen.
 *
 * Eén keer per ochtend, zonder gebruiker (pg_cron). Welke facturen aan de
 * beurt zijn bepaalt de database -- `factuur_herinneringen_klaar` -- en dat is
 * met opzet dezelfde functie waarmee de app een dag van tevoren het gele vakje
 * vult. Zou dat uit elkaar lopen, dan kondig je iets aan wat niet gebeurt, of
 * gaat er iets weg wat je niet hebt zien aankomen.
 *
 * Een herinnering gaat pas af als de trap ervoor geweest is, de factuur nog
 * open staat en er geen "even met rust laten" op staat. Mislukt er één, dan
 * gaat de trap niet omhoog en komt hij morgen gewoon terug.
 *
 * Het slot is de kop `x-cron-sleutel`, net als bij mail-ophalen.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, perGroepje, stuurMail, veilig, vulIn } from "../_gedeeld/mail.ts";
import { euro } from "../_gedeeld/factuurpdf.ts";
import { maakOp } from "../_gedeeld/opmaken.ts";
import { kopieInVerzonden, mailboxVoorKopie, type KopieMail } from "../_gedeeld/verzenden.ts";

/**
 * Zoveel herinneringen per bedrijf per ronde; de rest komt morgen.
 *
 * Per bedríjf, niet over de hele lijst. Zou er één grens over alles heen
 * liggen, dan kan één bedrijf met een stapel oude facturen -- en helemaal een
 * bedrijf waar niets weg kán, bijvoorbeeld zonder afzenderadres -- elke
 * ochtend alle plekken vullen en de andere bedrijven eeuwig laten wachten.
 */
const PER_BEDRIJF = 200;

interface Rij {
  factuur_id: string;
  company_id: string;
  nummer: string;
  klant: string;
  mail: string;
  open_bedrag: number;
  vervaldatum: string;
  dagen_open: number;
  trap: number;
  onderwerp: string;
  tekst: string;
}

async function gelijk(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let verschil = 0;
  for (let i = 0; i < x.length; i++) verschil |= x[i] ^ y[i];
  return verschil === 0;
}

/** "08-10-2026" */
function datum(iso: string): string {
  const [j, m, d] = iso.split("-");
  return `${d}-${m}-${j}`;
}

Deno.serve(async (req) => {
  const geheim = Deno.env.get("MAIL_CRON_SLEUTEL") ?? "";
  if (!geheim || !(await gelijk(req.headers.get("x-cron-sleutel") ?? "", geheim))) {
    return antwoord({ ok: false }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const brevo = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!url || !service || !brevo) return antwoord({ ok: false, fase: "instellingen" }, 500);

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const vandaag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(
    new Date(),
  );

  const { data, error } = await db.rpc("factuur_herinneringen_klaar", { op: vandaag });
  if (error) {
    console.error("herinneringen ophalen:", error.message);
    return antwoord({ ok: false, fase: "ophalen" }, 500);
  }
  const rijen = (data ?? []) as Rij[];
  if (rijen.length === 0) return antwoord({ ok: true, verstuurd: 0 });

  // Per bedrijf: de afzender en de mailbox hoeven maar één keer opgezocht, en
  // de grens telt per bedrijf.
  const perBedrijf = new Map<string, Rij[]>();
  for (const r of rijen) {
    const lijst = perBedrijf.get(r.company_id) ?? [];
    if (lijst.length < PER_BEDRIJF) lijst.push(r);
    perBedrijf.set(r.company_id, lijst);
  }

  let verstuurd = 0;
  let mislukt = 0;

  for (const [bedrijfId, lijst] of perBedrijf) {
    const { data: bedrijf, error: bedrijfFout } = await db
      .from("companies")
      .select("id,name,iban,mail_afzender_naam,mail_afzender_email")
      .eq("id", bedrijfId)
      .maybeSingle();
    if (bedrijfFout) {
      // Niet stil overslaan: dan lijkt het alsof het bedrijf niet bestaat.
      console.error(
        `Herinneringen voor ${bedrijfId}: bedrijf niet op te halen:`,
        bedrijfFout.message,
      );
      continue;
    }
    if (!bedrijf) continue;
    const afzenderNaam =
      String(bedrijf.mail_afzender_naam ?? "").trim() || String(bedrijf.name ?? "");
    const afzenderEmail = String(bedrijf.mail_afzender_email ?? "").trim();
    if (!afzenderEmail) {
      // Zonder afzender kan er niets weg. De trap gaat niet omhoog, dus zodra
      // het adres er staat gaat de herinnering alsnog.
      console.error(`Herinneringen voor ${bedrijf.name}: geen afzender ingesteld.`);
      continue;
    }

    // order + limit, net als in _gedeeld/verzenden.ts: heeft een bedrijf er
    // ooit twee, dan zou maybeSingle() op zichzelf een fout geven en viel het
    // antwoordadres stilletjes weg.
    const { data: mailbox, error: mailboxFout } = await db
      .from("mailboxen")
      .select("adres")
      .eq("company_id", bedrijfId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (mailboxFout) {
      console.error(`Mailbox van ${bedrijf.name} niet op te halen:`, mailboxFout.message);
    }

    const kopieen: KopieMail[] = [];

    await perGroepje(lijst, 4, async (r: Rij) => {
      try {
        // De betaallink erbij als die er is: een herinnering zonder de weg om
        // meteen te betalen is alleen maar een verwijt.
        const { data: f } = await db
          .from("facturen")
          .select("mollie_link,klant_id,betaald_bedrag,tegoed_verrekend")
          .eq("id", r.factuur_id)
          .eq("company_id", bedrijfId)
          .maybeSingle();
        // Maar alleen als er nog niets op betaald is. De link is bij het
        // versturen gemaakt voor het hele bedrag en staat daar vast; heeft de
        // klant de helft overgemaakt, dan zou de herinnering "nog € 50 open"
        // zeggen met een knop die € 100 afschrijft. Dan liever geen knop: de
        // IBAN en het betaalkenmerk staan er toch onder.
        //
        // Verrekend tegoed telt hier niet als betaald: de link is dan al voor
        // het restbedrag gemaakt, dus die klopt nog precies.
        const alBetaald = Number(f?.betaald_bedrag ?? 0) - Number(f?.tegoed_verrekend ?? 0) > 0.005;
        const link = alBetaald ? "" : String(f?.mollie_link ?? "");

        const velden: Record<string, string> = {
          naam: r.klant,
          nummer: r.nummer,
          bedrag: euro(Number(r.open_bedrag)),
          vervaldatum: datum(r.vervaldatum),
          dagen: String(Math.max(r.dagen_open, 0)),
        };
        const onderwerp = vulIn(r.onderwerp, velden);
        const tekst =
          vulIn(r.tekst, velden) +
          (link ? `\n\nDirect online betalen kan hier: ${link}\n` : "") +
          (bedrijf.iban ? `\nOvermaken kan naar ${bedrijf.iban} o.v.v. ${r.nummer}.\n` : "");
        const knop = link
          ? `<p style="margin:18px 0"><a href="${veilig(link)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Direct betalen</a></p>`
          : "";
        const html = `<p>${veilig(tekst).replace(/\n/g, "<br>")}</p>${knop}`;

        // De trap gaat omhoog vóór het versturen en weer terug als het
        // mislukt. Andersom -- pas omhoog na een geslaagde mail -- ging het mis
        // zodra die ene laatste stap niet lukte: de mail was dan al bij de
        // klant en de factuur stond nog op de oude trap, dus de volgende
        // ochtend ging dezelfde herinnering weer weg. En de ochtend daarna
        // weer. Eén herinnering missen is vervelend; er elke dag een sturen is
        // erger.
        const { error: trapFout } = await db.rpc("factuur_herinnering_trap", {
          factuur: r.factuur_id,
          trap: r.trap,
        });
        if (trapFout) throw new Error(trapFout.message);

        const uit = await stuurMail(
          brevo,
          { naam: afzenderNaam, email: afzenderEmail },
          {
            naar: { email: r.mail, naam: r.klant },
            onderwerp,
            tekst,
            html,
            ...(mailbox?.adres ? { antwoordNaar: String(mailbox.adres) } : {}),
          },
        );
        if (!uit.ok) {
          // Terugdraaien, zodat hij morgen opnieuw aan de beurt is.
          await db.rpc("factuur_herinnering_trap", {
            factuur: r.factuur_id,
            trap: Math.max(r.trap - 1, 0),
          });
          throw new Error(uit.fout);
        }
        verstuurd += 1;

        try {
          kopieen.push({
            opgemaakt: await maakOp({
              van: { naam: afzenderNaam, adres: afzenderEmail },
              aan: [{ naam: r.klant, email: r.mail }],
              onderwerp,
              tekst,
              html,
            }),
            aan: [{ naam: r.klant, email: r.mail }],
            onderwerp,
            tekst,
            ontvangen_op: new Date().toISOString(),
            vanEmail: afzenderEmail,
            klant_id: f?.klant_id ?? null,
          });
        } catch (e) {
          console.error(`Kopie van herinnering ${r.nummer} niet opgemaakt:`, e);
        }
      } catch (e) {
        mislukt += 1;
        console.error(`Herinnering ${r.nummer}:`, e instanceof Error ? e.message : e);
      }
    });

    // De kopieën in Verzonden, en daarmee in het dossier van de klant. Wat
    // hier misgaat mag de verstuurde herinneringen niet ongedaan maken.
    try {
      if (kopieen.length > 0) {
        const post = await mailboxVoorKopie(db, bedrijfId);
        if (post) await kopieInVerzonden(db, post.box, post.wachtwoord, afzenderNaam, kopieen);
      }
    } catch (e) {
      console.error("kopieen in Verzonden:", e instanceof Error ? e.message : e);
    }
  }

  return antwoord({ ok: true, verstuurd, mislukt });
});
