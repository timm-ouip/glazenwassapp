/**
 * Facturen versturen.
 *
 * De volgorde is met opzet drieledig, en die volgorde is het hele verhaal:
 *
 *   1. vastzetten  de factuur trekt zijn nummer en bevriest de klantgegevens
 *   2. PDF + mail  het papier wordt gemaakt en gaat de deur uit
 *   3. verstuurd   pas nu gaat de status om
 *
 * Gaat stap 2 mis, dan blijft de factuur staan mét zijn nummer, maar nog niet
 * verstuurd. Je probeert het gewoon opnieuw en hij houdt hetzelfde nummer.
 * Zou het nummer pas na een geslaagde mail getrokken worden, dan liet een
 * half-mislukte bulk gaten in de reeks achter -- en die moet je aan de
 * Belastingdienst uitleggen.
 *
 * Mailen gaat via Brevo's transactionele weg: die kan per klant een eigen
 * bijlage meesturen en kent de rem van de eigen mailbox niet. Het antwoord
 * komt wel in de eigen mailbox binnen, want reply-to staat daarop.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS, perGroepje, stuurMail, veilig } from "../_gedeeld/mail.ts";
import { euro, maakFactuurPdf, type FactuurRegel } from "../_gedeeld/factuurpdf.ts";

interface Verzoek {
  actie: "versturen";
  ids: string[];
}

/** Grote arrays breken String.fromCharCode(...); daarom in stukjes. */
function naarBase64(bytes: Uint8Array): string {
  let bin = "";
  const stap = 0x8000;
  for (let i = 0; i < bytes.length; i += stap) {
    bin += String.fromCharCode(...bytes.subarray(i, i + stap));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const brevo = Deno.env.get("BREVO_API_KEY") ?? "";
  if (!url || !anon || !service) {
    return antwoord({ fout: "De server is niet goed ingesteld." }, 500);
  }
  if (!brevo) {
    return antwoord(
      { fout: "De Brevo-sleutel ontbreekt op de server. Zet BREVO_API_KEY als secret." },
      500,
    );
  }

  const kop = req.headers.get("Authorization") ?? "";
  if (!kop.startsWith("Bearer ")) return antwoord({ fout: "Niet ingelogd." }, 401);

  // Alles wat mag-of-niet-mag is, gaat langs de gebruiker zelf: de
  // database-functies eisen het recht "facturen". De beheerder gebruiken we
  // alleen om te lezen en het bestand weg te schrijven.
  const alsGebruiker = createClient(url, anon, {
    global: { headers: { Authorization: kop } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: gebruiker } = await alsGebruiker.auth.getUser();
  if (!gebruiker?.user) return antwoord({ fout: "Niet ingelogd." }, 401);

  const { data: medewerker } = await alsGebruiker
    .from("employees")
    .select("id,company_id")
    .eq("id", gebruiker.user.id)
    .maybeSingle();
  if (!medewerker) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);

  const beheerder = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: bedrijf } = await beheerder
    .from("companies")
    .select(
      "id,name,adres,postcode,plaats,telefoon,email,kvk,btw,iban,mail_afzender_naam,mail_afzender_email",
    )
    .eq("id", medewerker.company_id)
    .maybeSingle();
  if (!bedrijf) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);

  const afzenderEmail = String(bedrijf.mail_afzender_email ?? "").trim();
  if (!afzenderEmail) {
    return antwoord(
      {
        fout: "Er staat nog geen afzender bij Instellingen → Mail. Zonder afzender kan er niets weg.",
      },
      400,
    );
  }

  // Antwoorden horen in je eigen postvak te komen, niet bij Brevo.
  const { data: mailbox } = await beheerder
    .from("mailboxen")
    .select("adres")
    .eq("company_id", bedrijf.id)
    .maybeSingle();

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }
  if (verzoek.actie !== "versturen" || !Array.isArray(verzoek.ids) || verzoek.ids.length === 0) {
    return antwoord({ fout: "Niets om te versturen." }, 400);
  }
  if (verzoek.ids.length > 500) {
    return antwoord({ fout: "Maximaal 500 facturen tegelijk." }, 400);
  }

  const mislukt: { id: string; reden: string }[] = [];
  let gelukt = 0;

  // Ontdubbelen: staat dezelfde factuur twee keer in de lijst, dan zouden
  // twee aanroepen langs elkaar lopen en de klant twee mails krijgen.
  const ids = [...new Set(verzoek.ids)];

  await perGroepje(ids, 4, async (id: string) => {
    try {
      // 1. Vastzetten. Was hij dat al (eerdere poging), dan geeft de functie
      //    gewoon hetzelfde nummer terug.
      const { data: vast, error: vastFout } = await alsGebruiker.rpc("factuur_vastzetten", {
        factuur: id,
      });
      if (vastFout) throw new Error(vastFout.message);
      const kaart = vast as {
        nummer: string;
        factuurdatum: string;
        vervaldatum: string;
      };

      const { data: f } = await beheerder
        .from("facturen")
        .select("id,soort,klantgegevens,klant_id,mollie_link")
        .eq("id", id)
        .eq("company_id", bedrijf.id)
        .maybeSingle();
      if (!f) throw new Error("Die factuur bestaat niet.");

      const kg = (f.klantgegevens ?? {}) as Record<string, string | number>;
      const naar = String(kg.email ?? "").trim();
      if (!naar) throw new Error("Deze klant heeft geen e-mailadres.");

      const { data: regels } = await beheerder
        .from("factuurregels")
        .select("datum,omschrijving,notitie,bedrag_excl,btw_bedrag,bedrag_incl,btw_procent")
        .eq("factuur_id", id)
        .is("deleted_at", null)
        .order("datum");
      const lijst = (regels ?? []).map((r) => ({
        datum: String(r.datum),
        omschrijving: String(r.omschrijving ?? ""),
        notitie: String(r.notitie ?? ""),
        bedrag_excl: Number(r.bedrag_excl),
        btw_bedrag: Number(r.btw_bedrag),
        bedrag_incl: Number(r.bedrag_incl),
        btw_procent: Number(r.btw_procent),
      })) as FactuurRegel[];
      if (lijst.length === 0) throw new Error("Deze factuur heeft geen regels.");

      // 2. Het papier. Een particulier ziet bedragen inclusief btw, een
      //    bedrijf of VvE exclusief met de btw eronder.
      const inclusief = String(kg.klanttype ?? "particulier") === "particulier";
      const pdf = await maakFactuurPdf({
        nummer: kaart.nummer,
        soort: f.soort === "credit" ? "credit" : "factuur",
        factuurdatum: kaart.factuurdatum,
        vervaldatum: kaart.vervaldatum,
        inclusief,
        bedrijf: {
          naam: String(bedrijf.name ?? ""),
          adres: String(bedrijf.adres ?? ""),
          postcode: String(bedrijf.postcode ?? ""),
          plaats: String(bedrijf.plaats ?? ""),
          telefoon: String(bedrijf.telefoon ?? ""),
          email: String(bedrijf.email ?? ""),
          kvk: String(bedrijf.kvk ?? ""),
          btw: String(bedrijf.btw ?? ""),
          iban: String(bedrijf.iban ?? ""),
        },
        klant: {
          naam: String(kg.naam ?? ""),
          bedrijfsnaam: String(kg.bedrijfsnaam ?? ""),
          straat: String(kg.straat ?? ""),
          huisnummer: String(kg.huisnummer ?? ""),
          postcode: String(kg.postcode ?? ""),
          plaats: String(kg.plaats ?? ""),
        },
        regels: lijst,
        ...(f.mollie_link ? { betaallink: String(f.mollie_link) } : {}),
      });

      const bestandsnaam = `Factuur ${kaart.nummer}.pdf`;
      const pad = `${bedrijf.id}/${kaart.nummer.slice(0, 4)}/${kaart.nummer}.pdf`;
      // Mislukt het opslaan, dan gaat de mail gewoon door: het bewaren is
      // voor later, de klant is nu. Maar dan onthouden we ook geen pad, want
      // een verwijzing naar een bestand dat er niet is, is erger dan geen
      // verwijzing.
      const bewaard = await beheerder.storage
        .from("facturen")
        .upload(pad, pdf, { contentType: "application/pdf", upsert: true });
      if (bewaard.error) {
        console.error(`Factuur ${kaart.nummer} niet opgeslagen: ${bewaard.error.message}`);
      }

      // 3. De mail.
      const totaal = lijst.reduce((t, r) => t + r.bedrag_incl, 0);
      const naam = String(kg.bedrijfsnaam ?? "").trim() || String(kg.naam ?? "");
      const tekst =
        `Beste ${naam},\n\n` +
        `In de bijlage vind je factuur ${kaart.nummer} van ${euro(totaal)}.\n` +
        `Wij zien de betaling graag tegemoet vóór ${kaart.vervaldatum.split("-").reverse().join("-")}.\n` +
        (f.mollie_link ? `\nDirect online betalen kan hier: ${f.mollie_link}\n` : "") +
        (bedrijf.iban ? `\nOvermaken kan naar ${bedrijf.iban} o.v.v. ${kaart.nummer}.\n` : "") +
        `\nMet vriendelijke groet,\n${bedrijf.name}`;

      const knop = f.mollie_link
        ? `<p style="margin:18px 0"><a href="${veilig(String(f.mollie_link))}" style="background:#111;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Direct betalen</a></p>`
        : "";

      const uitkomst = await stuurMail(
        brevo,
        {
          naam: String(bedrijf.mail_afzender_naam ?? "").trim() || String(bedrijf.name ?? ""),
          email: afzenderEmail,
        },
        {
          naar: { email: naar, naam },
          onderwerp: `Factuur ${kaart.nummer} · ${bedrijf.name}`,
          tekst,
          html: `<p>${veilig(tekst).replace(/\n/g, "<br>")}</p>${knop}`,
          ...(mailbox?.adres ? { antwoordNaar: String(mailbox.adres) } : {}),
          bijlagen: [{ naam: bestandsnaam, inhoud: naarBase64(pdf) }],
        },
      );
      if (!uitkomst.ok) throw new Error(uitkomst.fout);

      const { error: klaarFout } = await alsGebruiker.rpc("factuur_verstuurd", {
        factuur: id,
        via: "mail",
        naar,
        pdf: bewaard.error ? null : pad,
      });
      if (klaarFout) throw new Error(klaarFout.message);
      gelukt += 1;
    } catch (e) {
      mislukt.push({ id, reden: e instanceof Error ? e.message : "onbekende fout" });
    }
  });

  return antwoord({ gelukt, mislukt });
});
