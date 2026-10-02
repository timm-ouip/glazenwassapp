/**
 * De invulpagina voor één klant (/gegevens), de kant van de server.
 *
 * Vanuit het dossier maak je een geheim linkje; wie dat opent is niet
 * ingelogd, dus alles loopt hier langs de service-role-client, net als bij
 * `aanmelden.functions.ts`. Dit bestand is daarmee de poortwachter:
 *
 *  1. De token uit de URL bepaalt de klant (tabel `klant_links`), en alleen
 *     een token die nog geldig is (7 dagen). Niets anders uit de aanvraag
 *     kiest een rij.
 *  2. Naar buiten gaan alleen naam, telefoon en e-mail van die ene klant, en
 *     de naam van het bedrijf. Geen adres, geen prijzen, geen notities, geen
 *     id: wie het linkje doorgestuurd krijgt, leest niet meer dan dat.
 */
import { createServerFn } from "@tanstack/react-start";

import { netjesVeld } from "@/lib/schoonschrift";

/** De velden die de klant ziet en mag invullen. */
export const INVUL_VELDEN = ["naam", "telefoon", "telefoon2", "email", "email2"] as const;
export type InvulVeld = (typeof INVUL_VELDEN)[number];
export type InvulGegevens = Record<InvulVeld, string>;

const MAXIMA: Record<InvulVeld, number> = {
  naam: 120,
  telefoon: 40,
  telefoon2: 40,
  email: 160,
  email2: 160,
};

const ALGEMEEN = "Dit lukt nu niet. Probeer het later nog eens.";

function kort(waarde: unknown, max: number) {
  return String(waarde ?? "")
    .trim()
    .slice(0, max);
}

/** Wat de pagina bij het openen krijgt, of null als het linkje niet (meer) werkt. */
export const haalGegevensPagina = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<{ bedrijf: string; gegevens: InvulGegevens } | null> => {
    const token = kort(data.token, 64);
    if (token.length < 20) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin
      .from("klant_links")
      .select("klant_id,company_id,geldig_tot")
      .eq("token", token)
      .maybeSingle();
    if (error) {
      // Een storing is geen kapot linkje: dan niet "vraag een nieuwe".
      console.error("gegevens: linkje lezen", error.message);
      throw new Error(ALGEMEEN);
    }
    if (!link || Date.parse(link.geldig_tot) <= Date.now()) return null;
    const [klant, bedrijf] = await Promise.all([
      supabaseAdmin
        .from("klanten")
        .select("naam,telefoon,telefoon2,email,email2")
        .eq("id", link.klant_id)
        .eq("company_id", link.company_id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin.from("companies").select("name").eq("id", link.company_id).maybeSingle(),
    ]);
    if (klant.error || bedrijf.error) {
      console.error("gegevens: klant lezen", klant.error?.message ?? bedrijf.error?.message);
      throw new Error(ALGEMEEN);
    }
    const k = klant.data;
    if (!k) return null;
    return {
      bedrijf: bedrijf.data?.name ?? "",
      gegevens: {
        naam: k.naam ?? "",
        telefoon: k.telefoon ?? "",
        telefoon2: k.telefoon2 ?? "",
        email: k.email ?? "",
        email2: k.email2 ?? "",
      },
    };
  });

/** Wat de klant verstuurt. De database vergelijkt en onthoudt wat er stond. */
export const bewaarGegevensPagina = createServerFn({ method: "POST" })
  .validator(
    (data: { token: string; gegevens: InvulGegevens; begin: InvulGegevens; val?: string }) => data,
  )
  .handler(async ({ data }) => {
    // Het lokkertje ingevuld: een robot. Doe alsof het lukte.
    if (data.val) return { ok: true };
    const token = kort(data.token, 64);
    const velden: Partial<InvulGegevens> = {};
    for (const veld of INVUL_VELDEN) {
      velden[veld] = netjesVeld(veld, kort(data.gegevens?.[veld], MAXIMA[veld]));
    }
    for (const veld of ["email", "email2"] as const) {
      const v = velden[veld];
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        throw new Error(`Dit e-mailadres klopt niet: ${v}`);
      }
    }
    if (!velden.naam) throw new Error("Vul je naam in.");
    if (!velden.telefoon && !velden.email) {
      throw new Error("Vul een telefoonnummer of een e-mailadres in, zodat we je kunnen bereiken.");
    }
    // Alleen wat de klant zelf veranderde ten opzichte van wat hij bij het
    // openen zag. Anders zou een veld dat jij intussen in het dossier
    // verbeterde, terugspringen naar wat er op zijn scherm stond.
    const veranderd: Partial<InvulGegevens> = {};
    for (const veld of INVUL_VELDEN) {
      const was = netjesVeld(veld, kort(data.begin?.[veld], MAXIMA[veld]));
      const nu = velden[veld] ?? "";
      if (nu !== was) veranderd[veld] = nu;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    /** Werkt het linkje nog? Ook als er niets te bewaren valt: anders zegt de
     *  pagina "bijgewerkt" bij een linkje dat al ingetrokken is. */
    const linkWerkt = async () => {
      const { data: l, error } = await supabaseAdmin
        .from("klant_links")
        .select("geldig_tot,aantal")
        .eq("token", token)
        .maybeSingle();
      if (error) {
        console.error("gegevens: linkje lezen", error.message);
        throw new Error(ALGEMEEN);
      }
      return Boolean(l && Date.parse(l.geldig_tot) > Date.now() && l.aantal < 30);
    };
    const WEG = "Deze link werkt niet meer. Vraag je glazenwasser om een nieuwe.";
    if (Object.keys(veranderd).length === 0) {
      if (!(await linkWerkt())) throw new Error(WEG);
      return { ok: true };
    }
    const { data: gelukt, error } = await supabaseAdmin.rpc("klant_vult_gegevens_in", {
      sleutel: token,
      velden: veranderd,
    });
    if (error) {
      console.error("gegevens: opslaan", error.message);
      throw new Error(ALGEMEEN);
    }
    if (!gelukt) {
      // Werkt het linkje nog, dan weigerde de database omdat er na samenvoegen
      // geen telefoon of e-mail overbleef (bijvoorbeeld intussen gewist).
      if (await linkWerkt()) {
        throw new Error(
          "Vul een telefoonnummer of een e-mailadres in, zodat we je kunnen bereiken.",
        );
      }
      throw new Error(WEG);
    }
    return { ok: true };
  });
