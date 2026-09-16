/**
 * Praten met Paaltje in de app, en zijn voorstellen afhandelen.
 *
 * `stuur` laat Paaltje antwoorden: hij zoekt op met gereedschap en zet een
 * wijziging hooguit klaar als voorstel. De andere acties zijn de knoppen op
 * het kaartje: doorvoeren, als aanvraag versturen, afwijzen, annuleren en
 * terugdraaien. Wie wat mag staat in `_gedeeld/paaltje-chat.ts`.
 *
 * Iedereen van het bedrijf mag met Paaltje praten. Het bedrijf heeft een
 * daglimiet op het aantal berichten, zodat een knop die blijft hangen geen
 * rekening oplevert.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";

import { antwoord, CORS } from "../_gedeeld/mail.ts";
import {
  aanvragen,
  afwijzen,
  annuleren,
  ChatFout,
  doorvoeren,
  gereedschap,
  leesVoorstellen,
  teKeurenAantal,
  isUuid,
  knip,
  maakVoorstel,
  type Medewerker,
  type Rechten,
  rechtenVan,
  snelkeuzesVan,
  STATUS_TEKST,
  type Status,
  straatAdressen,
  systeemPrompt,
  terugdraaien,
  type Voorstel,
  voorLezer,
  voorstelVerslag,
  zoekAdres,
  zoekKlant,
  adresDetails,
} from "../_gedeeld/paaltje-chat.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const MODEL = "claude-sonnet-5";
const MAX_RONDES = 8;
const MAX_TOKENS = 1500;
const MAX_BERICHT = 2000;
/** Hoeveel eerdere berichten Paaltje meekrijgt, en van hoe ver terug. */
const MAX_GESCHIEDENIS = 20;
const DAGEN_TERUG = 3;
const DAGEN_BEWAREN = 7;
/** Een antwoord van gereedschap hooguit zo lang: een hele straat is al veel. */
const MAX_GEREEDSCHAP = 60_000;

interface Verzoek {
  actie:
    | "stuur"
    | "doorvoeren"
    | "aanvragen"
    | "afwijzen"
    | "annuleren"
    | "terugdraaien"
    | "wis_gesprek"
    | "lees_voorstellen"
    | "te_keuren_aantal";
  /** Bij lees_voorstellen: welke voorstellen (hooguit 50). */
  ids?: string[];
  /** Bij lees_voorstellen: de lijst "Te keuren" van deze keurder. */
  te_keuren?: boolean;
  tekst?: string;
  voorstel_id?: string;
  regels?: unknown;
  ondanks_wijziging?: boolean;
  reden?: string;
}

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
  const { data: medewerker } = await alsGebruiker
    .from("employees")
    .select("id,company_id,rol")
    .eq("id", gebruiker.user.id)
    .maybeSingle();
  if (!medewerker) return antwoord({ fout: "Geen bedrijf gevonden." }, 403);
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let verzoek: Verzoek;
  try {
    verzoek = (await req.json()) as Verzoek;
  } catch {
    return antwoord({ fout: "Onleesbaar verzoek." }, 400);
  }

  try {
    // De rechten één keer, vers uit de database: nooit uit het verzoek.
    const rechten = await rechtenVan(db, medewerker as Medewerker);
    const m = medewerker as Medewerker;
    switch (verzoek?.actie) {
      case "stuur":
        return await stuur(db, m, rechten, String(verzoek.tekst ?? ""));
      case "doorvoeren":
        return antwoord({ voorstel: await doorvoeren(db, m, rechten, verzoek) });
      case "aanvragen":
        return antwoord({ voorstel: await aanvragen(db, m, rechten, verzoek) });
      case "afwijzen":
        return antwoord({ voorstel: await afwijzen(db, m, rechten, verzoek) });
      case "annuleren":
        return antwoord({ voorstel: await annuleren(db, m, rechten, verzoek) });
      case "terugdraaien":
        return antwoord(await terugdraaien(db, m, rechten, verzoek));
      case "lees_voorstellen":
        return antwoord(await leesVoorstellen(db, m, rechten, verzoek));
      case "te_keuren_aantal":
        return antwoord(await teKeurenAantal(db, m, rechten));
      case "wis_gesprek": {
        const { error } = await db
          .from("paaltje_berichten")
          .delete()
          .eq("company_id", m.company_id)
          .eq("employee_id", m.id);
        if (error) throw new Error(`Gesprek wissen: ${error.message}`);
        return antwoord({ ok: true });
      }
      default:
        return antwoord({ fout: "Onbekende actie." }, 400);
    }
  } catch (e) {
    if (e instanceof ChatFout) return antwoord({ fout: e.message, ...e.extra }, e.status);
    console.error(`paaltje-chat ${verzoek?.actie}:`, e instanceof Error ? e.message : e);
    return antwoord({ fout: "Er ging iets mis op de server. Probeer het nog eens." }, 500);
  }
});

/** "dinsdag 15 september 2026", in Nederlandse tijd. */
function vandaagVoluit(): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

/** Een fout van het model als zin voor op het scherm. */
function modelFout(e: unknown): string {
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  if (status === 429) return "Paaltje heeft het even te druk. Probeer het over een minuut nog eens.";
  if (status === 529 || status === 503) return "Paaltje is even overbelast. Probeer het zo nog eens.";
  if (status === 401 || status === 403) {
    return "Paaltje kan zijn AI-dienst niet bereiken. Laat de eigenaar de sleutel controleren.";
  }
  return "Paaltje is even niet bereikbaar. Probeer het zo nog eens.";
}

/**
 * Het gesprek tot nu toe, als afwisselende beurten. Bij een antwoord met een
 * voorstel staat erbij hoe het ermee staat, zodat Paaltje niet denkt dat iets
 * nog open staat als het al doorgevoerd of afgewezen is.
 */
async function geschiedenis(db: Db, m: Medewerker): Promise<Anthropic.MessageParam[]> {
  const sinds = new Date(Date.now() - DAGEN_TERUG * 86_400_000).toISOString();
  const { data, error } = await db
    .from("paaltje_berichten")
    .select("rol,tekst,voorstel_id,created_at")
    .eq("company_id", m.company_id)
    .eq("employee_id", m.id)
    .gte("created_at", sinds)
    .order("created_at", { ascending: false })
    .limit(MAX_GESCHIEDENIS);
  if (error) throw new Error(`Gesprek ophalen: ${error.message}`);
  const berichten = [...(data ?? [])].reverse() as {
    rol: "gebruiker" | "paaltje";
    tekst: string;
    voorstel_id: string | null;
  }[];

  const ids = [...new Set(berichten.map((b) => b.voorstel_id).filter(isUuid))];
  const perId = new Map<string, { status: Status; samenvatting: string; reden: string }>();
  if (ids.length > 0) {
    const { data: voorstellen, error: vFout } = await db
      .from("paaltje_voorstellen")
      .select("id,status,samenvatting,reden")
      .eq("company_id", m.company_id)
      .in("id", ids);
    if (vFout) throw new Error(`Voorstellen ophalen: ${vFout.message}`);
    for (const v of voorstellen ?? []) perId.set(v.id, v);
  }

  const beurten: Anthropic.MessageParam[] = [];
  for (const b of berichten) {
    const rol = b.rol === "paaltje" ? "assistant" : "user";
    let tekst = b.tekst ?? "";
    const v = b.voorstel_id ? perId.get(b.voorstel_id) : undefined;
    if (v) {
      tekst += `\n\n[Het voorstel "${v.samenvatting}" ${STATUS_TEKST[v.status] ?? v.status}${
        v.status === "afgewezen" && v.reden ? ` (reden: ${v.reden})` : ""
      }.]`;
    }
    if (!tekst.trim()) continue;
    const vorige = beurten[beurten.length - 1];
    if (vorige && vorige.role === rol) vorige.content = `${vorige.content}\n\n${tekst}`;
    else beurten.push({ role: rol, content: tekst });
  }
  // Het gesprek begint altijd bij de medewerker.
  while (beurten.length > 0 && beurten[0].role !== "user") beurten.shift();
  return beurten;
}

/**
 * Een cachepunt op het laatste stuk van het gesprek. Bij elke ronde met
 * gereedschap schuift het mee, zodat alles ervoor uit de cache komt.
 */
function metCache(berichten: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (berichten.length === 0) return berichten;
  const kopie = [...berichten];
  const laatste = kopie[kopie.length - 1];
  const blokken: Anthropic.ContentBlockParam[] =
    typeof laatste.content === "string"
      ? [{ type: "text", text: laatste.content }]
      : [...laatste.content];
  const eind = blokken.length - 1;
  blokken[eind] = { ...blokken[eind], cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  kopie[kopie.length - 1] = { ...laatste, content: blokken };
  return kopie;
}

async function stuur(db: Db, m: Medewerker, rechten: Rechten, invoer: string): Promise<Response> {
  const tekst = invoer.trim();
  if (!tekst) return antwoord({ fout: "Het bericht is leeg." }, 400);
  if (tekst.length > MAX_BERICHT) return antwoord({ fout: `Hooguit ${MAX_BERICHT} tekens per bericht.` }, 400);

  const sleutel = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!sleutel) return antwoord({ fout: "Paaltje is nog niet ingesteld op de server." }, 500);

  const { data: bedrijf, error: bedrijfFout } = await db
    .from("companies")
    .select("name,paaltje_daglimiet")
    .eq("id", m.company_id)
    .maybeSingle();
  if (bedrijfFout || !bedrijf) throw new Error(`Bedrijf ophalen: ${bedrijfFout?.message ?? "niet gevonden"}`);
  const limiet = Number(bedrijf.paaltje_daglimiet ?? 200);

  // Eerst tellen, dan pas praten — in één stap in de database. Andersom zien
  // tien berichten die tegelijk binnenkomen allemaal nog ruimte. Een bericht
  // telt mee zodra het binnen is, ook als Paaltje daarna een fout geeft.
  const { data: stand, error: telFout } = await db.rpc("paaltje_verbruik_tellen", {
    bedrijf: m.company_id,
    invoer: 0,
    uitvoer: 0,
    extra_bericht: 1,
  });
  if (telFout) throw new Error(`Verbruik tellen: ${telFout.message}`);
  if (Number(stand ?? 0) > limiet) {
    // Geweigerd is niet gepraat: die telt niet mee.
    await telVerbruik(db, m.company_id, 0, 0, -1);
    return antwoord({ fout: "Paaltje heeft vandaag genoeg gepraat, morgen weer.", limiet: true }, 429);
  }

  // Oude berichten van deze medewerker opruimen; mislukt dat, dan de volgende keer.
  const { error: opruimFout } = await db
    .from("paaltje_berichten")
    .delete()
    .eq("company_id", m.company_id)
    .eq("employee_id", m.id)
    .lt("created_at", new Date(Date.now() - DAGEN_BEWAREN * 86_400_000).toISOString());
  if (opruimFout) console.error("oude berichten opruimen:", opruimFout.message);

  const begonnen = new Date().toISOString();
  const [snelkeuzes, eerder] = await Promise.all([snelkeuzesVan(db, m.company_id), geschiedenis(db, m)]);
  const systeem = systeemPrompt(String(bedrijf.name ?? ""), snelkeuzes, rechten);
  const tools = gereedschap(rechten) as Anthropic.Tool[];

  // De datum in het bericht, niet in de vaste instructies: die blijven zo in de cache.
  const vraag = `[Vandaag is het ${vandaagVoluit()}.]\n\n${tekst}`;
  const berichten: Anthropic.MessageParam[] = [...eerder];
  const vorige = berichten[berichten.length - 1];
  if (vorige && vorige.role === "user") vorige.content = `${vorige.content}\n\n${vraag}`;
  else berichten.push({ role: "user", content: vraag });

  let invoerTokens = 0;
  let uitvoerTokens = 0;
  let voorstel: Voorstel | null = null;
  let eind = "";
  let klaar = false;

  const client = new Anthropic({ apiKey: sleutel });
  try {
    for (let ronde = 0; ronde < MAX_RONDES; ronde++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: systeem, cache_control: { type: "ephemeral" } }],
        ...(tools.length > 0 ? { tools } : {}),
        messages: metCache(berichten),
      });
      invoerTokens +=
        (res.usage.input_tokens ?? 0) +
        (res.usage.cache_creation_input_tokens ?? 0) +
        (res.usage.cache_read_input_tokens ?? 0);
      uitvoerTokens += res.usage.output_tokens ?? 0;

      const teksten = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (res.stop_reason !== "tool_use") {
        eind = res.stop_reason === "refusal" ? "Daar kan ik je niet mee helpen." : teksten;
        klaar = true;
        break;
      }

      berichten.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });
      const resultaten: Anthropic.ToolResultBlockParam[] = [];
      for (const blok of res.content) {
        if (blok.type !== "tool_use") continue;
        const uit = await voerUit(db, m, rechten, blok.name, blok.input as Record<string, unknown>, voorstel);
        if (uit.voorstel) voorstel = uit.voorstel;
        resultaten.push({
          type: "tool_result",
          tool_use_id: blok.id,
          content: knip(uit.tekst, MAX_GEREEDSCHAP),
          ...(uit.fout ? { is_error: true } : {}),
        });
      }
      berichten.push({ role: "user", content: resultaten });
    }
  } catch (e) {
    console.error("paaltje-chat model:", e instanceof Error ? e.message : e);
    // Een half gesprek slaan we niet op. Stond er al een voorstel klaar, dan
    // hoort daar geen antwoord bij: dan niet open laten staan.
    if (voorstel) {
      await db
        .from("paaltje_voorstellen")
        .update({ status: "geannuleerd" })
        .eq("company_id", m.company_id)
        .eq("id", voorstel.id)
        .eq("status", "open");
    }
    if (invoerTokens + uitvoerTokens > 0) await telVerbruik(db, m.company_id, invoerTokens, uitvoerTokens, 0);
    return antwoord({ fout: modelFout(e) }, 502);
  }

  if (!klaar) {
    eind = voorstel
      ? "Ik heb een voorstel klaargezet, maar kwam er niet helemaal uit. Kijk het goed na."
      : "Dit werd me te ingewikkeld. Kun je het in kleinere stappen vragen?";
  }
  if (!eind) {
    eind = voorstel
      ? rechten.bewerken
        ? "Klopt dit? Druk op Doorvoeren."
        : "Klopt dit? Druk op Aanvraag versturen."
      : "Sorry, daar heb ik geen antwoord op.";
  }

  const { data: opgeslagen, error: opslaanFout } = await db
    .from("paaltje_berichten")
    .insert([
      { company_id: m.company_id, employee_id: m.id, rol: "gebruiker", tekst, created_at: begonnen },
      {
        company_id: m.company_id,
        employee_id: m.id,
        rol: "paaltje",
        tekst: knip(eind, 8000),
        voorstel_id: voorstel?.id ?? null,
        created_at: new Date().toISOString(),
      },
    ])
    .select("id,rol,tekst,voorstel_id,created_at");
  if (opslaanFout) {
    await telVerbruik(db, m.company_id, invoerTokens, uitvoerTokens, 0);
    throw new Error(`Gesprek opslaan: ${opslaanFout.message}`);
  }
  // Het bericht zelf telde al bij binnenkomst; nu alleen de tokens erbij.
  await telVerbruik(db, m.company_id, invoerTokens, uitvoerTokens, 0);

  const paaltje = (opgeslagen ?? []).find((b: { rol: string }) => b.rol === "paaltje");
  return antwoord({
    antwoord: paaltje ?? null,
    voorstel: voorstel ? voorLezer(voorstel, rechten, m.id) : null,
  });
}

async function telVerbruik(db: Db, companyId: string, invoer: number, uitvoer: number, bericht: number) {
  const { error } = await db.rpc("paaltje_verbruik_tellen", {
    bedrijf: companyId,
    invoer,
    uitvoer,
    extra_bericht: bericht,
  });
  if (error) console.error("verbruik tellen:", error.message);
}

/** Eén gereedschap uitvoeren. Een fout gaat terug naar Paaltje, niet naar het scherm. */
async function voerUit(
  db: Db,
  m: Medewerker,
  rechten: Rechten,
  naam: string,
  input: Record<string, unknown>,
  alVoorstel: Voorstel | null,
): Promise<{ tekst: string; fout: boolean; voorstel?: Voorstel }> {
  const zoeken = ["zoek_adres", "zoek_klant", "adres_details", "straat_adressen"];
  if (zoeken.includes(naam) && !(rechten.bekijken || rechten.bewerken || rechten.planning)) {
    return { tekst: "Deze medewerker mag geen klantgegevens inzien.", fout: true };
  }
  const json = (uit: Record<string, unknown>) => ({
    tekst: JSON.stringify(uit),
    fout: typeof uit.fout === "string",
  });
  try {
    switch (naam) {
      case "zoek_adres":
        return json(await zoekAdres(db, m.company_id, rechten, String(input?.zoekterm ?? "")));
      case "zoek_klant":
        return json(await zoekKlant(db, m.company_id, rechten, String(input?.zoekterm ?? "")));
      case "adres_details":
        return json(await adresDetails(db, m.company_id, rechten, String(input?.customer_id ?? "")));
      case "straat_adressen":
        return json(
          await straatAdressen(
            db,
            m.company_id,
            rechten,
            String(input?.straat ?? ""),
            typeof input?.straat_id === "string" ? input.straat_id : undefined,
          ),
        );
      case "stel_wijziging_voor": {
        if (alVoorstel) {
          return {
            tekst: "Er staat in dit antwoord al een voorstel klaar. Hooguit één voorstel per antwoord.",
            fout: true,
          };
        }
        const uit = await maakVoorstel(db, m, rechten, input ?? {});
        if (!uit.ok) return { tekst: uit.fout, fout: true };
        // Het verslag voor Paaltje ook zonder prijzen die de vrager niet mag zien.
        return {
          tekst: voorstelVerslag(voorLezer(uit.voorstel, rechten, m.id), uit.overgeslagen),
          fout: false,
          voorstel: uit.voorstel,
        };
      }
      default:
        return { tekst: `Onbekend gereedschap "${naam}".`, fout: true };
    }
  } catch (e) {
    console.error(`gereedschap ${naam}:`, e instanceof Error ? e.message : e);
    return { tekst: "Dat lukte niet door een fout in de database. Zeg dat tegen de medewerker.", fout: true };
  }
}
