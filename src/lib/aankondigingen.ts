import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toonDatum, vandaag } from "@/lib/wasdag";

/**
 * Wat er per adres aan de klant verstuurd is, en hoe het afliep.
 *
 * "Geopend" houden we niet bij: daarvoor is een volgpixel nodig, en die valt
 * onder de cookieregels (toestemming van de klant). "Afgeleverd" is een
 * melding van de mailserver van de ontvanger en mag wel. Bij WhatsApp
 * gebruiken we de vinkjes die de klant zelf aan heeft staan.
 */
export interface AankondigingRij {
  customer_id: string;
  kanaal: string;
  soort: string;
  aangekondigd_voor: string;
  tijdvak_van: string | null;
  tijdvak_tot: string | null;
  status: string;
  bezorgstatus: string;
  verstuurd_op: string;
}

export function useAankondigingen(vanaf: string, tot: string, aan = true) {
  return useQuery({
    queryKey: ["aankondigingen", vanaf, tot],
    enabled: aan,
    queryFn: async (): Promise<AankondigingRij[]> => {
      const { data, error } = await supabase.rpc("aankondigingen_voor", { vanaf, tot });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        tijdvak_van: r.tijdvak_van ? r.tijdvak_van.slice(0, 5) : null,
        tijdvak_tot: r.tijdvak_tot ? r.tijdvak_tot.slice(0, 5) : null,
      })) as AankondigingRij[];
    },
  });
}

/** Per adres alles wat er verstuurd is, om snel bij te zoeken. */
export function perAdres(rijen: AankondigingRij[]): Map<string, AankondigingRij[]> {
  const uit = new Map<string, AankondigingRij[]>();
  for (const r of rijen) {
    const lijst = uit.get(r.customer_id) ?? [];
    lijst.push(r);
    uit.set(r.customer_id, lijst);
  }
  return uit;
}

export type Mailstand =
  | "geen-adres"
  | "niet-verstuurd"
  | "verstuurd"
  | "afgeleverd"
  | "gelezen"
  | "mislukt"
  | "verplaatst";

export interface Mailstatus {
  stand: Mailstand;
  /** Wat er in het tooltipje staat. */
  uitleg: string;
  /** Alleen bij "verplaatst": voor welke dag het bericht ging. */
  aangekondigdVoor?: string;
  kanaal?: string;
}

const NIET_AANGEKOMEN = ["gebounced", "geblokkeerd", "ongeldig"];

/** Kwam dit bericht (voor zover we weten) aan? Een mislukte mail telt niet. */
export function kwamAan(r: AankondigingRij): boolean {
  return r.status !== "mislukt" && !NIET_AANGEKOMEN.includes(r.bezorgstatus);
}

/**
 * Hoe het envelopje er bij dit adres uitziet op deze dag.
 *
 * `tijdvak` is wat er nú gepland staat: verschilt dat van wat er beloofd is,
 * dan is het bericht niet meer waar en wordt het oranje.
 *
 * `staatOp` zegt of het adres (nog) op een bepaalde dag gepland staat. Zonder
 * die vraag zou een gewone volgende beurt ook "verplaatst" lijken: de mail van
 * vorige maand noemt dan een andere dag dan deze.
 */
export function statusVan(
  rijen: AankondigingRij[] | undefined,
  datum: string,
  opties: {
    heeftContact: boolean;
    tijdvak?: { van: string; tot: string } | null;
    staatOp?: (datum: string) => boolean;
  },
): Mailstatus {
  if (!opties.heeftContact) {
    return { stand: "geen-adres", uitleg: "Geen e-mailadres of telefoonnummer bij deze klant." };
  }
  const alles = rijen ?? [];
  if (alles.length === 0) {
    return { stand: "niet-verstuurd", uitleg: "Nog geen planningsmail gestuurd." };
  }

  const voorDezeDag = alles.filter((r) => r.aangekondigd_voor === datum);
  if (voorDezeDag.length === 0) {
    // Verplaatst is alleen een mail die de klant nog iets belooft: een dag die
    // nog moet komen, en waar het adres niet meer op staat. Een mail voor een
    // dag die al geweest is, of voor een beurt die er gewoon nog staat, hoort
    // bij een andere beurt — dan is er voor déze dag nog niets gestuurd.
    const nu = vandaag();
    const beloftes = alles.filter(
      (r) => r.aangekondigd_voor >= nu && !(opties.staatOp?.(r.aangekondigd_voor) ?? false),
    );
    if (beloftes.length === 0) {
      return { stand: "niet-verstuurd", uitleg: "Nog geen planningsmail voor deze dag gestuurd." };
    }
    const laatste = [...beloftes].sort((a, b) => b.verstuurd_op.localeCompare(a.verstuurd_op))[0]!;
    return {
      stand: "verplaatst",
      uitleg: `De planningsmail noemde ${toonDatum(laatste.aangekondigd_voor)}, maar het staat nu op ${toonDatum(datum)}. De klant verwacht je dus nog op ${toonDatum(laatste.aangekondigd_voor)}. Stuur een wijziging: rechtermuisknop → Wijziging sturen.`,
      aangekondigdVoor: laatste.aangekondigd_voor,
      kanaal: laatste.kanaal,
    };
  }

  // Beloofd tijdvak dat niet meer klopt telt ook als verplaatst.
  const beloofd = voorDezeDag.find((r) => r.tijdvak_van);
  if (
    beloofd &&
    opties.tijdvak &&
    (beloofd.tijdvak_van !== opties.tijdvak.van || beloofd.tijdvak_tot !== opties.tijdvak.tot)
  ) {
    return {
      stand: "verplaatst",
      uitleg: `De planningsmail beloofde tussen ${beloofd.tijdvak_van} en ${beloofd.tijdvak_tot}, maar nu staat het tussen ${opties.tijdvak.van} en ${opties.tijdvak.tot}. Stuur een wijziging: rechtermuisknop → Wijziging sturen.`,
      aangekondigdVoor: datum,
      kanaal: beloofd.kanaal,
    };
  }

  const wa = voorDezeDag.find((r) => r.kanaal === "whatsapp");
  if (wa?.bezorgstatus === "gelezen") {
    return { stand: "gelezen", uitleg: "Appje gelezen.", kanaal: "whatsapp" };
  }

  const mislukt = voorDezeDag.find(
    (r) => r.status === "mislukt" || NIET_AANGEKOMEN.includes(r.bezorgstatus),
  );
  if (mislukt) {
    return {
      stand: "mislukt",
      uitleg:
        mislukt.bezorgstatus === "geblokkeerd"
          ? "De mailserver van de klant weigerde het bericht."
          : "Het bericht kwam niet aan. Klopt het adres?",
      kanaal: mislukt.kanaal,
    };
  }

  const aangekomen = voorDezeDag.find(
    (r) => r.bezorgstatus === "afgeleverd" || r.bezorgstatus === "gelezen",
  );
  if (aangekomen) {
    return {
      stand: "afgeleverd",
      uitleg: `Afgeleverd bij de ${aangekomen.kanaal === "whatsapp" ? "telefoon" : "mailbox"} van de klant op ${toonDatum(aangekomen.verstuurd_op.slice(0, 10))}. Of hij het gelezen heeft, houden we niet bij.`,
      kanaal: aangekomen.kanaal,
    };
  }

  const eerste = voorDezeDag[0]!;
  return {
    stand: "verstuurd",
    uitleg: `Verstuurd op ${toonDatum(eerste.verstuurd_op.slice(0, 10))}; nog geen bevestiging dat het aankwam.`,
    kanaal: eerste.kanaal,
  };
}

/** De standen waarbij er echt iets naar de klant is gegaan. */
const GESTUURD: ReadonlySet<Mailstand> = new Set([
  "verstuurd",
  "afgeleverd",
  "gelezen",
  "mislukt",
  "verplaatst",
]);

/** Is er bij deze stand al een planningsmail (of appje) de deur uit? */
export function isGestuurd(status: Mailstatus): boolean {
  return GESTUURD.has(status.stand);
}

/**
 * Eén envelopje voor een hele straat, voor de weekweergave: daar is geen plek
 * voor een icoontje per adres. Het ergste telt: een adres dat na de mail
 * verplaatst is, dan een mail die niet aankwam, dan pas "verstuurd". Is er nog
 * niets gestuurd, dan null: dan hoort er geen icoontje te staan.
 */
export function samenvattingVan(standen: Mailstatus[]): Mailstatus | null {
  const gestuurd = standen.filter(isGestuurd);
  if (gestuurd.length === 0) return null;
  if (standen.length === 1) return standen[0]!;

  const n = standen.length;
  const tel = (stand: Mailstand) => standen.filter((s) => s.stand === stand).length;
  const verplaatst = tel("verplaatst");
  if (verplaatst > 0) {
    return {
      stand: "verplaatst",
      uitleg: `Bij ${verplaatst} van de ${n} adressen klopt de planning niet meer met de planningsmail: ze staan nu op een andere dag of tijd. Stuur een wijziging: rechtermuisknop → Wijziging sturen.`,
    };
  }
  const mislukt = tel("mislukt");
  if (mislukt > 0) {
    return {
      stand: "mislukt",
      uitleg: `Bij ${mislukt} van de ${n} adressen kwam de planningsmail niet aan. Klopt het adres?`,
    };
  }
  const aangekomen = tel("afgeleverd") + tel("gelezen");
  if (aangekomen === n) {
    return {
      stand: "afgeleverd",
      uitleg: `Bij alle ${n} adressen is de planningsmail aangekomen.`,
    };
  }
  return {
    stand: "verstuurd",
    uitleg:
      `Planningsmail verstuurd naar ${gestuurd.length} van de ${n} adressen` +
      (aangekomen > 0 ? `; bij ${aangekomen} is hij aangekomen.` : "."),
  };
}
