/**
 * De uitnodigingsmail voor een nieuwe collega, vanaf het eigen adres van het
 * bedrijf.
 *
 * De app (src/lib/team.functions.ts) zet de uitnodiging klaar: het account,
 * het bedrijf en de code. Hier gaat alleen de mail de deur uit, want hier
 * zitten de mailbox en Brevo. Alleen de eigenaar, en alleen voor een
 * uitnodiging die echt van zijn bedrijf is en waarvan de code klopt: zo kan
 * niemand hiermee een willekeurige link of tekst laten mailen.
 *
 * Kan het bedrijf niet zelf mailen (geen mailbox), dan zegt hij dat met
 * `via: "geen"` en valt de app terug op de standaardmail van Supabase.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS, stuurMail, veilig } from "../_gedeeld/mail.ts";
import { ontsleutel } from "../_gedeeld/geheim.ts";
import { maakOp } from "../_gedeeld/opmaken.ts";
import { verstuurBericht } from "../_gedeeld/smtp.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface Verzoek {
  gebruiker_id?: string;
  code?: string;
  /** Het adres van de app, voor de link in de mail. */
  adres?: string;
}

/** Zelfde als UITNODIGING_DAGEN in src/lib/team.functions.ts. */
const UITNODIGING_DAGEN = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) {
    return antwoord({ fout: "De server is niet goed ingesteld." }, 500);
  }

  const kop = req.headers.get("Authorization") ?? "";
  if (!kop.startsWith("Bearer ")) return antwoord({ fout: "Niet ingelogd." }, 401);
  const alsGebruiker = createClient(url, anon, {
    global: { headers: { Authorization: kop } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: gebruiker } = await alsGebruiker.auth.getUser();
  if (!gebruiker?.user) return antwoord({ fout: "Niet ingelogd." }, 401);

  const { data: eigenaar } = await alsGebruiker
    .from("employees")
    .select("id,company_id,naam,rol")
    .eq("id", gebruiker.user.id)
    .maybeSingle();
  if (!eigenaar) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);
  if (eigenaar.rol !== "eigenaar") {
    return antwoord({ fout: "Alleen de eigenaar kan medewerkers uitnodigen." }, 403);
  }

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }
  const id = String(verzoek.gebruiker_id ?? "");
  const code = String(verzoek.code ?? "");
  const app = appAdres(String(verzoek.adres ?? ""));
  if (!UUID.test(id) || code.length < 20 || code.length > 200 || !app) {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Is dit een uitnodiging van dit bedrijf, met deze code?
  const { data: uitgenodigde, error: ophaalFout } = await db.auth.admin.getUserById(id);
  if (ophaalFout || !uitgenodigde?.user?.email) {
    return antwoord({ fout: "Deze uitnodiging is niet gevonden." }, 404);
  }
  const meta = uitgenodigde.user.app_metadata ?? {};
  if (meta["uitgenodigd_voor"] !== eigenaar.company_id || meta["uitnodiging_code"] !== (await hashVan(code))) {
    return antwoord({ fout: "Deze uitnodiging hoort niet bij jouw bedrijf." }, 403);
  }
  const op = Date.parse(String(meta["uitgenodigd_op"] ?? ""));
  if (!Number.isFinite(op)) return antwoord({ fout: "Deze uitnodiging heeft geen datum." }, 400);

  const { data: bedrijf, error: bedrijfFout } = await db
    .from("companies")
    .select("name,mail_afzender_naam,mail_afzender_email")
    .eq("id", eigenaar.company_id)
    .single();
  if (bedrijfFout || !bedrijf) return antwoord({ fout: "Het bedrijf kon niet opgezocht worden." }, 500);

  const naam = String(bedrijf.name ?? "").trim() || "je nieuwe werkgever";
  const mail = uitnodigingsmail({
    bedrijf: naam,
    uitnodiger: String(eigenaar.naam ?? "").trim(),
    email: uitgenodigde.user.email,
    link: `${app}/uitnodiging?id=${id}&code=${encodeURIComponent(code)}`,
    tot: new Date(op + UITNODIGING_DAGEN * 24 * 60 * 60 * 1000),
  });
  const afzenderNaam = String(bedrijf.mail_afzender_naam ?? "").trim() || naam;

  const uitslag = await verstuur(db, eigenaar.company_id, afzenderNaam, String(bedrijf.mail_afzender_email ?? ""), {
    aan: uitgenodigde.user.email,
    ...mail,
  });
  // Mislukt is een foutcode, anders ziet de app het als verstuurd.
  return antwoord(uitslag, "fout" in uitslag ? 502 : 200);
});

/**
 * Alleen het begin van een webadres (https://…), zonder pad. Gewoon http mag
 * alleen op de eigen computer, voor het testen.
 */
function appAdres(adres: string): string {
  try {
    const u = new URL(adres);
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return u.origin;
  } catch {
    // Geen adres.
  }
  return "";
}

async function hashVan(code: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function domeinVan(adres: string): string {
  const at = adres.lastIndexOf("@");
  return at < 0 ? "" : adres.slice(at + 1).trim().toLowerCase();
}

type Uitslag = { via: "mailbox" | "brevo"; van: string } | { via: "geen" } | { fout: string };

/**
 * Versturen zoals het dagrapport: vanaf de eigen mailbox als die werkt, en
 * anders via Brevo, maar alleen vanaf het domein van een mailbox die dit
 * bedrijf ooit met het echte wachtwoord koppelde. Het Brevo-account is van
 * heel Paaltje Systems; zonder die controle kon een bedrijf mailen namens een ander.
 */
async function verstuur(
  db: Db,
  companyId: string,
  afzenderNaam: string,
  afzenderEmail: string,
  mail: { aan: string; onderwerp: string; tekst: string; html: string },
): Promise<Uitslag> {
  const { data: box, error: boxFout } = await db
    .from("mailboxen")
    .select("id,adres,smtp_host,smtp_poort,status")
    .eq("company_id", companyId)
    .maybeSingle();
  if (boxFout) return { fout: "Je mailbox kon even niet opgezocht worden. Probeer het zo nog eens." };

  if (box?.status === "actief") {
    const { data: geheim, error: geheimFout } = await db
      .from("mailbox_geheimen")
      .select("versleuteld,iv")
      .eq("mailbox_id", box.id)
      .maybeSingle();
    if (geheimFout || !geheim) return { fout: "Het wachtwoord van je mailbox kon niet gelezen worden." };
    try {
      const wachtwoord = await ontsleutel(geheim.versleuteld, geheim.iv);
      const opgemaakt = await maakOp({
        van: { naam: afzenderNaam, adres: box.adres },
        aan: [{ email: mail.aan }],
        onderwerp: mail.onderwerp,
        tekst: mail.tekst,
        html: mail.html,
      });
      await verstuurBericht(
        { host: box.smtp_host, poort: box.smtp_poort, adres: box.adres, wachtwoord },
        opgemaakt.ontvangers,
        opgemaakt.bericht,
      );
      return { via: "mailbox", van: box.adres };
    } catch (e) {
      return { fout: `Versturen vanaf ${box.adres} lukte niet: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const sleutel = Deno.env.get("BREVO_API_KEY") ?? "";
  const email = afzenderEmail.trim();
  const domein = domeinVan(String(box?.adres ?? ""));
  if (!sleutel || !email || !domein || domeinVan(email) !== domein) return { via: "geen" };
  const uit = await stuurMail(sleutel, { naam: afzenderNaam, email }, {
    naar: { email: mail.aan, naam: "" },
    onderwerp: mail.onderwerp,
    tekst: mail.tekst,
    html: mail.html,
  });
  return uit.ok ? { via: "brevo", van: email } : { fout: `Versturen via Brevo lukte niet: ${uit.fout}` };
}

/**
 * De mail zelf. Zegt wie er uitnodigt, voor welk bedrijf, wat Paaltje Systems is en
 * tot wanneer de link werkt, zodat niemand hoeft te raden of dit echt is.
 */
function uitnodigingsmail(m: {
  bedrijf: string;
  uitnodiger: string;
  email: string;
  link: string;
  tot: Date;
}): { onderwerp: string; tekst: string; html: string } {
  const wie = m.uitnodiger ? `${m.uitnodiger} van ${m.bedrijf}` : m.bedrijf;
  const nl = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", ...o }).format(m.tot);
  const tot = `${nl({ weekday: "long", day: "numeric", month: "long" })} om ${nl({ hour: "2-digit", minute: "2-digit" })}`;
  const opnieuw = m.uitnodiger || m.bedrijf;
  const groet = m.uitnodiger ? `${m.uitnodiger}\n${m.bedrijf}` : m.bedrijf;

  const onderwerp = `Uitnodiging voor het team van ${m.bedrijf}`;

  const tekst = [
    "Hoi,",
    `${wie} nodigt je uit om mee te werken in Paaltje Systems. Dat is de app waarin ${m.bedrijf} de klanten, de planning en het werk van de dag bijhoudt.`,
    `Zo doe je mee:\n1. Open de link hieronder.\n2. Vul je naam in en kies een wachtwoord.\n3. Daarna log je in met ${m.email} en dat wachtwoord.`,
    m.link,
    `De link werkt tot ${tot}. Is hij verlopen, vraag ${opnieuw} dan om een nieuwe.`,
    "Vragen? Antwoord gewoon op deze mail.",
    "Verwachtte je deze uitnodiging niet? Dan kun je de mail negeren; er gebeurt dan niets.",
    `Groet,\n${groet}`,
  ].join("\n\n");

  const p = (inhoud: string) => `<p style="margin:0 0 14px">${inhoud}</p>`;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#1f2320;max-width:560px">',
    p("Hoi,"),
    p(
      `<strong>${veilig(wie)}</strong> nodigt je uit om mee te werken in Paaltje Systems. Dat is de app waarin ${veilig(m.bedrijf)} de klanten, de planning en het werk van de dag bijhoudt.`,
    ),
    p(
      `Klik op de knop, vul je naam in en kies een wachtwoord. Daarna log je in met <strong>${veilig(m.email)}</strong> en dat wachtwoord.`,
    ),
    '<p style="margin:22px 0">',
    `<a href="${veilig(m.link)}" style="display:inline-block;background:#185FA5;color:#ffffff;`,
    'text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Uitnodiging accepteren</a>',
    "</p>",
    p(`De link werkt tot ${veilig(tot)}. Is hij verlopen, vraag ${veilig(opnieuw)} dan om een nieuwe.`),
    p("Vragen? Antwoord gewoon op deze mail."),
    p(
      '<span style="color:#6b6f6a">Verwachtte je deze uitnodiging niet? Dan kun je de mail negeren; er gebeurt dan niets.</span>',
    ),
    p(`Groet,<br />${veilig(groet).replace(/\n/g, "<br />")}`),
    '<p style="margin:26px 0 0;font-size:12px;color:#8a8e89">',
    `Werkt de knop niet? Kopieer dan deze link in je browser:<br />`,
    `<a href="${veilig(m.link)}" style="color:#185FA5;word-break:break-all">${veilig(m.link)}</a>`,
    "</p>",
    "</div>",
  ].join("");

  return { onderwerp, tekst, html };
}
