/**
 * Rollen en rechten. De eigenaar mag altijd alles; een medewerker alleen wat
 * zijn rol hem geeft. Wat hier staat bepaalt wat de app laat zien; wat iemand
 * werkelijk mag, dwingt de database af.
 */
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Employee } from "@/lib/auth";

export const RECHTEN = [
  {
    sleutel: "planning",
    label: "Planning & wijken",
    uitleg: "Wijken, planning en de dag bekijken en bijwerken",
    meer: {
      kan: [
        "De Wijken-pagina, de kalender en de dagplanning bekijken",
        "Adressen op een dag zetten, verplaatsen en teams indelen",
        "Notities, frequentie, kleur en overslaan van een adres aanpassen",
        "Overdag contant geld intikken bij een contant adres op zijn route van vandaag (hij ziet dan wat dat adres open heeft)",
        "Klantnamen zien (de wijklijst toont ze)",
      ],
      niet: [
        "Naam, telefoon en e-mail van een klant wijzigen (daarvoor: Klanten bewerken)",
        "Andere bedragen zien zonder Prijzen zien",
      ],
    },
  },
  {
    sleutel: "klanten_bekijken",
    label: "Klanten bekijken",
    uitleg: "Klanten en hun adressen zien",
    meer: {
      kan: [
        "De klantenlijst en het dossier van een klant openen",
        "Adressen, telefoon en e-mail lezen",
      ],
      niet: ["Iets wijzigen, toevoegen of weggooien (daarvoor: Klanten bewerken)"],
    },
  },
  {
    sleutel: "klanten_bewerken",
    label: "Klanten bewerken",
    uitleg: "Klanten toevoegen, wijzigen en weggooien; aanmeldingen",
    meer: {
      kan: [
        "Klanten en adressen toevoegen, wijzigen en weggooien (naar de prullenbak)",
        "Aanmeldingen afhandelen en klanten importeren uit Excel",
        "Een linkje maken waarmee de klant zelf zijn gegevens invult",
      ],
      niet: ["Bedragen zien zonder Prijzen zien"],
      nodig:
        "Klanten bekijken gaat automatisch mee aan: zonder kan hij de klantenpagina niet openen.",
    },
  },
  {
    sleutel: "prijzen_zien",
    label: "Prijzen zien",
    uitleg: "Prijzen en omzet; zonder dit recht ziet hij nergens een bedrag",
    meer: {
      kan: [
        "Prijzen, omzet en openstaande bedragen overal in de app zien",
        "Het geld-deel van het dossier",
        "Samen met Klanten bewerken: de prijs van een adres wijzigen",
        "Samen met Planning: de prijs van een dag of een klus wijzigen",
      ],
      niet: ["Betalingen intikken zonder vrijgave (daarvoor: Afrekenen zonder vrijgave)"],
    },
  },
  {
    sleutel: "mail_lezen",
    label: "Mail lezen",
    uitleg: "Het postvak en wat Paaltje klaarzette",
    meer: {
      kan: [
        "Het postvak en WhatsApp-gesprekken lezen",
        "Zien wat Paaltje uit de mail haalde en klaarzette",
        "Mail weggooien, verplaatsen en als spam markeren (ook in de echte mailbox)",
      ],
      niet: ["Zelf mail of WhatsApp versturen (daarvoor: Mail versturen)"],
    },
  },
  {
    sleutel: "mail_versturen",
    label: "Mail versturen",
    uitleg: "Antwoorden en aankondigingen versturen",
    meer: {
      kan: [
        "Aankondigingen per mail en WhatsApp versturen",
        "WhatsApp-berichten naar klanten sturen",
        "Samen met Mail lezen: mail beantwoorden, nieuwe mail sturen en mappen in de mailbox beheren",
      ],
      niet: ["Het postvak lezen zonder Mail lezen"],
    },
  },
  {
    sleutel: "instellingen_team",
    label: "Team bekijken",
    uitleg: "Zien wie er in het team zit",
    meer: {
      kan: ["Zien wie er in het team zit en welke rol ze hebben"],
      niet: ["Mensen uitnodigen of rollen wijzigen: dat doet alleen de eigenaar"],
    },
  },
  {
    sleutel: "facturen",
    label: "Facturen",
    uitleg:
      "Facturen nakijken, versturen en afvinken; een bedrag zien is iets anders dan namens het bedrijf post sturen",
    meer: {
      kan: [
        "Facturen nakijken, versturen en als betaald afvinken",
        "Crediteren, een losse factuur maken (ook met een eigen bedrag) en herinneringen sturen",
      ],
      niet: ["Contant geld teruggeven, of de vaste prijs van een adres wijzigen"],
    },
  },
  {
    sleutel: "geldlopen",
    label: "Geld lopen",
    uitleg:
      "Contant geld ophalen in een wijk die de eigenaar voor die avond vrijgeeft; alleen dan ziet hij adressen en bedragen",
    meer: {
      kan: [
        "Op een avond die de eigenaar vrijgeeft de straat in: Betaald, Niet thuis, Geen geld, korting en beurten vooruit",
        'Bij een adres onder "Eerder" zien wie wat eerder intikte',
        "Zijn eigen tik van die avond terugdraaien",
      ],
      niet: [
        "Iets intikken zonder vrijgave",
        "Een boeking van een eerdere avond of van een ander terugdraaien",
      ],
    },
  },
  {
    sleutel: "afrekenen",
    label: "Afrekenen zonder vrijgave",
    uitleg:
      "Betalingen intikken via Betalingen en de wijklijst, zonder dat er een wijk is vrijgegeven. Gaat samen met Prijzen zien; geld teruggeven blijft bij de eigenaar",
    meer: {
      kan: [
        "Het vak Afrekenen op Betalingen, en (met Planning) Betalen… bij een adres op de Wijken-pagina",
        "Betalingen, korting en vooruit intikken zonder dat er een wijk is vrijgegeven",
        'Met "Klopt niet" een boeking terugdraaien, ook van een collega of de eigenaar: alles wat op kantoor is geboekt (ook ouder), en wat vandaag op straat of overdag is opgehaald',
      ],
      niet: [
        "Geld teruggeven, omrekenen naar een nieuwe prijs of iets op een eerdere datum boeken",
        "Korting geven die hoger is dan wat er openstaat",
        "Terugdraaien wat op straat of overdag op een eerdere dag is opgehaald (daarvoor: Oude avonden herstellen)",
      ],
      nodig: "Prijzen zien gaat automatisch mee aan.",
    },
  },
  {
    sleutel: "herstellen",
    label: "Oude avonden herstellen",
    uitleg:
      "Een betaling terugdraaien die op een eerdere dag is opgehaald, op straat of overdag. Gaat samen met Afrekenen zonder vrijgave",
    meer: {
      kan: [
        'Met "Klopt niet" ook een betaling terugdraaien die op een eerdere avond of dag is opgehaald',
      ],
      niet: ["Geld teruggeven of omrekenen: dat blijft bij de eigenaar"],
      nodig:
        "Afrekenen zonder vrijgave en Prijzen zien gaan automatisch mee aan. Let op: dat geld kan al bij jou zijn ingeleverd.",
    },
  },
] as const;

export type Recht = (typeof RECHTEN)[number]["sleutel"];

export function heeftRecht(employee: Employee | null, recht: Recht): boolean {
  if (!employee) return false;
  if (employee.rol === "eigenaar") return true;
  return employee.rechten.includes(recht);
}

/**
 * Mag hij op kantoor afrekenen, zonder vrijgegeven wijk? De eigenaar altijd;
 * een ander met "afrekenen" én "prijzen_zien" (zonder bedragen kun je niet
 * afrekenen). Dezelfde regel als public.mag_afrekenen() in de database.
 */
export function magAfrekenen(employee: Employee | null): boolean {
  return heeftRecht(employee, "afrekenen") && heeftRecht(employee, "prijzen_zien");
}

export function useMagAfrekenen(): boolean {
  const { employee } = useAuth();
  return magAfrekenen(employee);
}

/**
 * Mag hij iets terugdraaien dat op een voorbije avond of dag is opgehaald?
 * De eigenaar altijd; een ander met "herstellen" bovenop afrekenen. Dezelfde
 * regel als public.mag_herstellen() in de database.
 */
export function useMagHerstellen(): boolean {
  const { employee } = useAuth();
  return heeftRecht(employee, "herstellen") && magAfrekenen(employee);
}

/** Heeft de ingelogde gebruiker minstens één van deze rechten? */
export function useRecht(...rechten: Recht[]): boolean {
  const { employee } = useAuth();
  return rechten.some((r) => heeftRecht(employee, r));
}

/**
 * Welk recht een pagina vraagt (minstens één ervan). Leeg: iedereen die
 * ingelogd is. Dezelfde indeling als het menu in de zijbalk; de database
 * dwingt het af, dit zorgt dat je een nette melding krijgt in plaats van een
 * lege pagina.
 */
export function rechtenVoorPad(pad: string): Recht[] | null {
  if (
    pad === "/" ||
    pad.startsWith("/planning") ||
    pad.startsWith("/dag") ||
    pad.startsWith("/printen")
  ) {
    return ["planning"];
  }
  // Het dashboard telt de planning en de prijzen bij elkaar op; zonder die
  // twee rechten geeft de database er toch niets voor terug.
  if (pad.startsWith("/dashboard")) return ["prijzen_zien"];
  if (pad.startsWith("/klanten")) return ["klanten_bekijken"];
  if (
    pad.startsWith("/aanmeldingen") ||
    pad.startsWith("/importeren") ||
    pad.startsWith("/prullenbak")
  ) {
    return ["klanten_bewerken"];
  }
  if (pad.startsWith("/mailing")) return ["mail_lezen", "mail_versturen"];
  if (pad.startsWith("/berichten")) return ["mail_lezen"];
  if (pad.startsWith("/betalingen")) return ["geldlopen", "prijzen_zien", "facturen"];
  return null;
}

/** "Eigenaar", de naam van de rol, of "Medewerker" als hij (nog) geen rol heeft. */
export function rolLabel(employee: Pick<Employee, "rol" | "rolnaam">): string {
  if (employee.rol === "eigenaar") return "Eigenaar";
  return employee.rolnaam || "Medewerker";
}

export interface Rol {
  id: string;
  naam: string;
  rechten: Recht[];
}

const GELDIG = new Set<string>(RECHTEN.map((r) => r.sleutel));

export async function fetchRollen(): Promise<Rol[]> {
  const { data, error } = await supabase.from("rollen").select("id,naam,rechten").order("naam");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    naam: r.naam,
    rechten: (r.rechten ?? []).filter((x): x is Recht => GELDIG.has(x)),
  }));
}

export async function bewaarRol(rol: {
  id?: string;
  naam: string;
  rechten: Recht[];
}): Promise<void> {
  const naam = rol.naam.trim();
  if (!naam) throw new Error("Geef de rol een naam.");
  const rechten = RECHTEN.map((r) => r.sleutel).filter((s) => rol.rechten.includes(s));
  const { error } = rol.id
    ? await supabase.from("rollen").update({ naam, rechten }).eq("id", rol.id)
    : await supabase.from("rollen").insert({ naam, rechten });
  if (error) {
    if (error.code === "23505") throw new Error("Er is al een rol met die naam.");
    throw error;
  }
}

export async function verwijderRol(id: string): Promise<void> {
  const { error } = await supabase.from("rollen").delete().eq("id", id);
  if (error) throw error;
}
