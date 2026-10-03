/**
 * Facturen versturen.
 *
 * De volgorde is met opzet drieledig, en die volgorde is het hele verhaal:
 *
 *   1. vastzetten  de factuur trekt zijn nummer en bevriest de klantgegevens
 *   2. PDF + mail  het papier wordt gemaakt en gaat de deur uit
 *   3. verstuurd   pas nu gaat de status om
 *   4. de kopie    in Verzonden, en daarmee in het dossier van de klant
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
 *
 * Omdat het buiten de eigen mailbox omgaat, zou de verstuurde factuur nergens
 * te zien zijn: niet in Verzonden en niet bij de klant. Daarom legt stap 4 de
 * mail alsnog in Verzonden, met de PDF eraan. De ophaalronde ziet hem daar en
 * de database hangt hem aan de klant, net als elke andere verzonden mail.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import { antwoord, CORS, inStukjes, perGroepje, stuurMail, veilig } from "../_gedeeld/mail.ts";
import {
  euro,
  maakFactuurPdf,
  STANDAARD_VORMGEVING,
  type FactuurBriefpapier,
  type FactuurRegel,
  type FactuurVormgeving,
} from "../_gedeeld/factuurpdf.ts";
import { maakOp } from "../_gedeeld/opmaken.ts";
import { maakBetaallink, meldingKenmerk, mollieSleutel } from "../_gedeeld/mollie.ts";
import { kopieInVerzonden, mailboxVoorKopie, type KopieMail } from "../_gedeeld/verzenden.ts";

interface Verzoek {
  actie: "versturen" | "voorbeeld";
  ids?: string[];
  /**
   * Alleen bij "voorbeeld": de vormgeving zoals hij op dit moment op het
   * scherm staat, zodat een schuifje meteen te zien is zonder eerst op te
   * slaan. Het briefpapier zelf zit hier niet bij -- dat komt altijd uit de
   * opslagbak, en dat uploaden is al een bewuste stap.
   */
  vorm?: {
    kaderBoven?: number;
    kaderOnder?: number;
    eigenKop?: boolean;
    eigenVoet?: boolean;
    kleur?: string;
    koptekst?: string;
    voettekst?: string;
  };
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
      // Eén letterlijke tekst laten, niet aan elkaar plakken: supabase-js leest
      // deze regel om het rijtype af te leiden, en van een som maakt hij niets.
      "id,name,adres,postcode,plaats,telefoon,email,kvk,btw,iban,mail_afzender_naam,mail_afzender_email,factuur_briefpapier_pad,factuur_kader_boven,factuur_kader_onder,factuur_eigen_kop,factuur_eigen_voet,factuur_kleur,factuur_koptekst,factuur_voettekst",
    )
    .eq("id", medewerker.company_id)
    .maybeSingle();
  if (!bedrijf) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);

  // Een eigen naam voor hetzelfde bedrijf: TypeScript houdt de controle op leeg
  // hierboven niet vast binnen een functie die pas later wordt aangeroepen.
  const bedr = bedrijf;

  /**
   * De vormgeving van dit bedrijf, met het briefpapier erbij.
   *
   * Het papier wordt één keer opgehaald en daarna hergebruikt: bij een bulk van
   * vijfhonderd facturen zou dat anders vijfhonderd keer dezelfde download
   * zijn, en dat is het traagste stukje van de hele rit.
   */
  let vormOnthouden: Partial<FactuurVormgeving> | undefined;
  async function vormgeving(): Promise<Partial<FactuurVormgeving>> {
    if (vormOnthouden) return vormOnthouden;
    const pad = String(bedr.factuur_briefpapier_pad ?? "");
    let papier: FactuurBriefpapier | undefined;
    // Alleen uit de eigen merkmap. Dit haalt op met de service role en gaat
    // dus langs de RLS heen; de map die het beleid afdwingt moet hier dan ook
    // met de hand nagelopen worden.
    if (pad.startsWith(`${bedr.id}/merk/`)) {
      try {
        const { data, error } = await beheerder.storage.from("facturen").download(pad);
        if (error || !data) throw new Error(error?.message ?? "geen bestand");
        const klein = pad.toLowerCase();
        papier = {
          bytes: new Uint8Array(await data.arrayBuffer()),
          soort: klein.endsWith(".png") ? "png" : /\.jpe?g$/.test(klein) ? "jpg" : "pdf",
        };
      } catch (e) {
        // Zonder papier is de factuur nog steeds een factuur.
        console.error("Briefpapier niet op te halen:", e instanceof Error ? e.message : e);
      }
    }
    vormOnthouden = {
      kaderBoven: Number(bedr.factuur_kader_boven ?? STANDAARD_VORMGEVING.kaderBoven),
      kaderOnder: Number(bedr.factuur_kader_onder ?? STANDAARD_VORMGEVING.kaderOnder),
      eigenKop: bedr.factuur_eigen_kop !== false,
      eigenVoet: bedr.factuur_eigen_voet !== false,
      ...(papier ? { briefpapier: papier } : {}),
      ...(bedr.factuur_kleur ? { kleur: String(bedr.factuur_kleur) } : {}),
      ...(bedr.factuur_koptekst ? { koptekst: String(bedr.factuur_koptekst) } : {}),
      ...(bedr.factuur_voettekst ? { voettekst: String(bedr.factuur_voettekst) } : {}),
    };
    return vormOnthouden;
  }

  /** De Mollie-sleutel, één keer opgehaald. Leeg = niet gekoppeld. */
  let sleutelOnthouden: string | undefined;
  async function mollie(): Promise<string> {
    if (sleutelOnthouden === undefined) sleutelOnthouden = await mollieSleutel(beheerder, bedr.id);
    return sleutelOnthouden;
  }

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  // --- Een proef op de vormgeving -----------------------------------------
  // Verzonnen gegevens, geen nummer uit de teller, niets dat bewaard wordt. Zo
  // kun je aan het briefpapier en de marges schuiven zonder dat er ooit een
  // echte factuur aan te pas komt.
  if (verzoek.actie === "voorbeeld") {
    const { data: mag } = await alsGebruiker.rpc("heeft_recht", { recht: "facturen" });
    if (mag !== true) return antwoord({ fout: "Je mag geen facturen bekijken." }, 403);

    const over = verzoek.vorm ?? {};
    const maat = (n: unknown, terugval: number, max: number) =>
      Number.isFinite(Number(n)) ? Math.min(Math.max(Math.round(Number(n)), 0), max) : terugval;
    // Leeg is hier een keuze, geen "niets meegestuurd": wie de koptekst
    // weghaalt of op zwart klikt, moet dat meteen in het voorbeeld zien.
    const zin = (t: unknown, terugval: string | undefined) =>
      typeof t === "string" ? t.slice(0, 600).trim() || undefined : terugval;
    const basis = await vormgeving();
    const kop = zin(over.koptekst, basis.koptekst);
    const voet = zin(over.voettekst, basis.voettekst);
    const kleur = zin(over.kleur, basis.kleur);

    const vandaag = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const proef = await maakFactuurPdf({
      nummer: `${vandaag.getFullYear()}-0001`,
      soort: "factuur",
      factuurdatum: iso(vandaag),
      vervaldatum: iso(new Date(vandaag.getTime() + 14 * 86400000)),
      inclusief: false,
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
        naam: "J. de Voorbeeld",
        bedrijfsnaam: "Voorbeeld Beheer BV",
        straat: "Voorbeeldstraat",
        huisnummer: "12",
        postcode: "1234 AB",
        plaats: "Den Haag",
      },
      regels: [
        {
          datum: iso(vandaag),
          omschrijving: "Glazenwassen Voorbeeldstraat 12",
          notitie: "Zo ziet een notitie bij een beurt eruit.",
          bedrag_excl: 24.79,
          btw_bedrag: 5.21,
          bedrag_incl: 30,
          btw_procent: 21,
        },
        {
          datum: iso(vandaag),
          omschrijving: "Extra opdracht: dakrand",
          notitie: "",
          bedrag_excl: 45.45,
          btw_bedrag: 9.55,
          bedrag_incl: 55,
          btw_procent: 21,
        },
      ],
      vormgeving: {
        ...basis,
        kaderBoven: maat(over.kaderBoven, basis.kaderBoven ?? 20, 150),
        kaderOnder: maat(over.kaderOnder, basis.kaderOnder ?? 20, 100),
        eigenKop: typeof over.eigenKop === "boolean" ? over.eigenKop : basis.eigenKop === true,
        eigenVoet: typeof over.eigenVoet === "boolean" ? over.eigenVoet : basis.eigenVoet === true,
        koptekst: kop,
        voettekst: voet,
        kleur,
      },
    });
    return antwoord({ pdf: naarBase64(proef) });
  }

  // --- Vanaf hier gaat het echt de deur uit -------------------------------
  if (!Array.isArray(verzoek.ids) || verzoek.ids.length === 0) {
    return antwoord({ fout: "Niets om te versturen." }, 400);
  }
  if (verzoek.ids.length > 500) {
    return antwoord({ fout: "Maximaal 500 facturen tegelijk." }, 400);
  }
  if (!brevo) {
    return antwoord(
      { fout: "De Brevo-sleutel ontbreekt op de server. Zet BREVO_API_KEY als secret." },
      500,
    );
  }

  const afzenderNaam =
    String(bedrijf.mail_afzender_naam ?? "").trim() || String(bedrijf.name ?? "");
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

  const mislukt: { id: string; reden: string }[] = [];
  let gelukt = 0;
  /**
   * Wat er de deur uit ging, om in Verzonden en in het dossier te zetten.
   * Wordt per stapel geleegd: in elke kopie zit de PDF als tekst, en vijfhonderd
   * daarvan tegelijk in het geheugen houden is vragen om een functie die
   * omvalt nadat de facturen al verstuurd zijn.
   */
  let kopieen: KopieMail[] = [];

  /** De mailbox één keer opzoeken, ook als er meerdere stapels zijn. */
  const bedrijfId = String(bedrijf.id);
  let post: Awaited<ReturnType<typeof mailboxVoorKopie>> | undefined;
  async function kopieenWegschrijven() {
    if (kopieen.length === 0) return;
    const lijst = kopieen;
    kopieen = [];
    try {
      if (post === undefined) post = await mailboxVoorKopie(beheerder, bedrijfId);
      if (post) await kopieInVerzonden(beheerder, post.box, post.wachtwoord, afzenderNaam, lijst);
    } catch (e) {
      // De facturen zijn verstuurd en afgemeld; dat blijft leidend.
      console.error("kopieen in Verzonden:", e instanceof Error ? e.message : e);
    }
  }

  // Ontdubbelen: staat dezelfde factuur twee keer in de lijst, dan zouden
  // twee aanroepen langs elkaar lopen en de klant twee mails krijgen.
  const ids = [...new Set(verzoek.ids)];

  const perStapel = async (id: string) => {
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

      const { data: f, error: fFout } = await beheerder
        .from("facturen")
        .select(
          "id,soort,klantgegevens,klant_id,mollie_link,onderwerp,kenmerk,opmerking,tegoed_verrekend",
        )
        .eq("id", id)
        .eq("company_id", bedrijf.id)
        .maybeSingle();
      // De echte melding doorgeven: het nummer is hierboven al getrokken, en
      // "bestaat niet" zet je dan op het verkeerde been.
      if (fFout) throw new Error(fFout.message);
      if (!f) throw new Error("Die factuur bestaat niet.");

      const kg = (f.klantgegevens ?? {}) as Record<string, string | number>;
      const naar = String(kg.email ?? "").trim();
      if (!naar) throw new Error("Deze klant heeft geen e-mailadres.");

      const { data: regels, error: regelFout } = await beheerder
        .from("factuurregels")
        .select(
          "datum,omschrijving,notitie,bedrag,bedrag_excl,btw_bedrag,bedrag_incl,btw_procent,btw_inclusief,aantal,eenheid,stukprijs",
        )
        .eq("factuur_id", id)
        .is("deleted_at", null)
        .order("datum")
        .order("created_at");
      if (regelFout) throw new Error(regelFout.message);
      // Een particulier ziet bedragen inclusief btw, een bedrijf of VvE
      // exclusief met de btw eronder. Een losse factuur volgt wat je bij het
      // maken koos, zodat de prijzen op papier dezelfde zijn als die je typte.
      const losseModi = new Set(
        (regels ?? []).filter((r) => r.stukprijs !== null).map((r) => Boolean(r.btw_inclusief)),
      );
      const inclusief =
        losseModi.size === 1
          ? [...losseModi][0]!
          : String(kg.klanttype ?? "particulier") === "particulier";
      const lijst = (regels ?? []).map((r) => {
        const aantal = Number(r.aantal ?? 1) || 1;
        const regel: FactuurRegel = {
          datum: String(r.datum),
          omschrijving: String(r.omschrijving ?? ""),
          notitie: String(r.notitie ?? ""),
          bedrag_excl: Number(r.bedrag_excl),
          btw_bedrag: Number(r.btw_bedrag),
          bedrag_incl: Number(r.bedrag_incl),
          btw_procent: Number(r.btw_procent),
        };
        // Aantal en prijs alleen op papier als aantal x prijs precies het
        // regelbedrag is. Is het bedrag later met de hand veranderd ("maar een
        // deel gedaan"), of scheelt de btw-afronding een cent, dan liever
        // alleen het totaal dan een som die niet klopt.
        if (r.stukprijs !== null && r.stukprijs !== undefined) {
          const regelbedrag = inclusief ? regel.bedrag_incl : regel.bedrag_excl;
          const centen = (n: number) => Math.round(n * 100);
          const opgegeven = Number(r.stukprijs);
          const teruggerekend = Math.round((regelbedrag / aantal) * 100) / 100;
          const stuk = [opgegeven, teruggerekend].find(
            (p) => centen(aantal * p) === centen(regelbedrag),
          );
          if (stuk !== undefined) {
            regel.aantal = aantal;
            regel.eenheid = String(r.eenheid ?? "");
            regel.stukprijs = stuk;
          }
        }
        return regel;
      });
      if (lijst.length === 0) throw new Error("Deze factuur heeft geen regels.");
      const totaal = lijst.reduce((t, r) => t + r.bedrag_incl, 0);
      // Tegoed van de klant dat bij het vastzetten op deze factuur verrekend
      // is. De factuur zelf blijft het hele bedrag; alleen wat er nog betaald
      // moet worden is minder.
      const tegoed = f.soort === "factuur" ? Number(f.tegoed_verrekend ?? 0) : 0;
      const nogTeBetalen = Math.max(0, Math.round((totaal - tegoed) * 100) / 100);

      // De betaallink hoort hier en niet eerder: hij moet het factuurnummer op
      // het bankafschrift kunnen zetten en het bedrag kennen.
      //
      // Lukt het niet, dan gaat de factuur gewoon zonder knop de deur uit. Een
      // factuur tegenhouden omdat Mollie even niet thuis geeft zou het middel
      // erger maken dan de kwaal: de IBAN en het betaalkenmerk staan er toch
      // al op, en met de hand afvinken blijft gewoon werken.
      let betaallink = String(f.mollie_link ?? "");
      const sleutel = f.soort === "credit" || nogTeBetalen <= 0 || betaallink ? "" : await mollie();
      if (sleutel) {
        try {
          const kenmerk = await meldingKenmerk(id);
          const link = await maakBetaallink(sleutel, {
            bedrag: nogTeBetalen,
            omschrijving: `Factuur ${kaart.nummer} - ${bedrijf.name}`,
            meldingUrl: `${url}/functions/v1/mollie-webhook?factuur=${id}&kenmerk=${kenmerk}`,
          });
          // Alleen wegschrijven als er nog geen link staat. Twee verzendrondes
          // tegelijk -- twee tabbladen, of jij en een collega -- zouden anders
          // allebei een link maken en alleen de laatste bewaren. Betaalt de
          // klant dan via de eerste, dan kijkt de melding naar de tweede,
          // vindt daar niets, en blijft een betaalde factuur openstaan.
          const { data: gezet, error: linkFout } = await beheerder
            .from("facturen")
            .update({ mollie_id: link.id, mollie_link: link.url })
            .eq("id", id)
            .eq("company_id", bedrijf.id)
            .is("mollie_id", null)
            .select("mollie_link")
            .maybeSingle();
          if (linkFout) throw new Error(linkFout.message);
          if (gezet?.mollie_link) {
            betaallink = String(gezet.mollie_link);
          } else {
            // De ander was ons voor. Zijn link ligt straks bij de klant, de
            // onze is een ongebruikte link bij Mollie -- die doet geen kwaad.
            const { data: al } = await beheerder
              .from("facturen")
              .select("mollie_link")
              .eq("id", id)
              .eq("company_id", bedrijf.id)
              .maybeSingle();
            betaallink = String(al?.mollie_link ?? "");
          }
        } catch (e) {
          console.error(
            `Betaallink voor ${kaart.nummer} mislukt:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      // 2. Het papier.
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
          kvk: String(kg.kvk ?? ""),
          btw_nummer: String(kg.btw_nummer ?? ""),
        },
        regels: lijst,
        onderwerp: String(f.onderwerp ?? ""),
        kenmerk: String(f.kenmerk ?? ""),
        opmerking: String(f.opmerking ?? ""),
        ...(betaallink ? { betaallink } : {}),
        ...(tegoed > 0 ? { tegoed } : {}),
        vormgeving: await vormgeving(),
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
      const naam = String(kg.bedrijfsnaam ?? "").trim() || String(kg.naam ?? "");
      const vervaldatum = kaart.vervaldatum.split("-").reverse().join("-");
      const tekst =
        `Beste ${naam},\n\n` +
        `In de bijlage vind je factuur ${kaart.nummer} van ${euro(totaal)}.\n` +
        (tegoed > 0 && nogTeBetalen <= 0
          ? `Dit bedrag is helemaal betaald uit je tegoed bij ons. Je hoeft niets te betalen.\n`
          : (tegoed > 0
              ? `Daarvan is ${euro(tegoed)} al betaald uit je tegoed bij ons; er staat nog ${euro(nogTeBetalen)} open.\n`
              : "") +
            `Wij zien de betaling graag tegemoet vóór ${vervaldatum}.\n` +
            (betaallink ? `\nDirect online betalen kan hier: ${betaallink}\n` : "") +
            (bedrijf.iban
              ? `\nOvermaken kan naar ${bedrijf.iban} o.v.v. ${kaart.nummer}.\n`
              : "")) +
        `\nMet vriendelijke groet,\n${bedrijf.name}`;

      const knop = betaallink
        ? `<p style="margin:18px 0"><a href="${veilig(betaallink)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Direct betalen</a></p>`
        : "";

      const onderwerp = `Factuur ${kaart.nummer} · ${bedrijf.name}`;
      const pdfBase64 = naarBase64(pdf);
      const uitkomst = await stuurMail(
        brevo,
        { naam: afzenderNaam, email: afzenderEmail },
        {
          naar: { email: naar, naam },
          onderwerp,
          tekst,
          html: `<p>${veilig(tekst).replace(/\n/g, "<br>")}</p>${knop}`,
          ...(mailbox?.adres ? { antwoordNaar: String(mailbox.adres) } : {}),
          bijlagen: [{ naam: bestandsnaam, inhoud: pdfBase64 }],
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

      // 4. De kopie voor Verzonden en het klantdossier. Apart afgeschermd:
      //    de factuur is hier al verstuurd en afgemeld, dus wat hier misgaat
      //    mag hem niet alsnog op "mislukt" zetten.
      //
      //    De mail wordt hiervoor nog een keer opgemaakt, want Brevo geeft
      //    niet terug wat het over de lijn stuurde. De kopie krijgt daardoor
      //    een eigen Message-ID; voor Verzonden is dat geen bezwaar.
      try {
        kopieen.push({
          opgemaakt: await maakOp({
            van: { naam: afzenderNaam, adres: afzenderEmail },
            aan: [{ naam, email: naar }],
            onderwerp,
            tekst,
            html: `<p>${veilig(tekst).replace(/\n/g, "<br>")}</p>${knop}`,
            bijlagen: [{ naam: bestandsnaam, type: "application/pdf", inhoud: pdfBase64 }],
          }),
          aan: [{ naam, email: naar }],
          onderwerp,
          tekst,
          ontvangen_op: new Date().toISOString(),
          vanEmail: afzenderEmail,
          klant_id: f.klant_id ?? null,
          bijlagen: [{ naam: bestandsnaam, type: "application/pdf", grootte: pdf.length }],
        });
      } catch (e) {
        console.error(`Kopie van ${kaart.nummer} niet opgemaakt:`, e);
      }
    } catch (e) {
      mislukt.push({ id, reden: e instanceof Error ? e.message : "onbekende fout" });
    }
  };

  // Per stapel versturen, en daarna de kopieën in één IMAP-sessie wegschrijven.
  // Zo hoeven we niet per factuur opnieuw in te loggen op de mailbox.
  //
  // Hoe groot die stapel mag zijn hangt aan het briefpapier: dat zit in elke
  // PDF, en elke kopie houdt zijn PDF als tekst in het geheugen vast tot de
  // stapel weggeschreven is. Met een lichte achtergrond kunnen er vijftig
  // tegelijk; met een zwaardere zou dat de functie omver duwen -- en dan
  // halverwege een maandrun, met de nummers al getrokken.
  const papier = (await vormgeving()).briefpapier;
  const perStapelAantal = (papier?.bytes.length ?? 0) > 500 * 1024 ? 10 : 50;
  for (const stapel of inStukjes(ids, perStapelAantal)) {
    await perGroepje(stapel, 4, perStapel);
    await kopieenWegschrijven();
  }

  return antwoord({ gelukt, mislukt });
});
