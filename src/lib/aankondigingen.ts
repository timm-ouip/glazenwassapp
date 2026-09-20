import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toonDatum } from "@/lib/wasdag";

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

/**
 * Hoe het envelopje er bij dit adres uitziet op deze dag.
 *
 * `tijdvak` is wat er nú gepland staat: verschilt dat van wat er beloofd is,
 * dan is het bericht niet meer waar en wordt het oranje.
 */
export function statusVan(
  rijen: AankondigingRij[] | undefined,
  datum: string,
  opties: { heeftContact: boolean; tijdvak?: { van: string; tot: string } | null },
): Mailstatus {
  if (!opties.heeftContact) {
    return { stand: "geen-adres", uitleg: "Geen e-mailadres of telefoonnummer bij deze klant." };
  }
  const alles = rijen ?? [];
  if (alles.length === 0) {
    return { stand: "niet-verstuurd", uitleg: "Nog niet aangekondigd." };
  }

  const voorDezeDag = alles.filter((r) => r.aangekondigd_voor === datum);
  if (voorDezeDag.length === 0) {
    // Wel iets verstuurd, maar voor een andere dag: het adres is verplaatst.
    const laatste = [...alles].sort((a, b) => b.verstuurd_op.localeCompare(a.verstuurd_op))[0]!;
    return {
      stand: "verplaatst",
      uitleg: `Aangekondigd voor ${toonDatum(laatste.aangekondigd_voor)}, maar staat nu op ${toonDatum(datum)}. Stuur een wijziging.`,
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
      uitleg: `Beloofd tussen ${beloofd.tijdvak_van} en ${beloofd.tijdvak_tot}, nu gepland tussen ${opties.tijdvak.van} en ${opties.tijdvak.tot}. Stuur een wijziging.`,
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
