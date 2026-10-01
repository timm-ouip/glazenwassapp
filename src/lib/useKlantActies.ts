import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchStreets, formatNumber, haalTerug, legWeg, patchCustomer } from "@/lib/klanten";
import type { Customer } from "@/lib/klanten";
import { nieuweKlus, verwijderKlus } from "@/lib/klussen";
import { useRecht } from "@/lib/rechten";
import {
  draaiStoppenTerug,
  haalVanPlanning,
  zetInactief,
  zetPlanningTerug,
  type StopReden,
} from "@/lib/stoppen";
import { pushUndo, undoKnop } from "@/lib/undo";

/**
 * Wat je met één adres kunt doen vanuit het menu op een regel: iets aan het
 * adres veranderen, een extra opdracht, de klant laten stoppen of het adres
 * weggooien. De wijkenpagina en de dag gebruiken allebei deze handelingen,
 * zodat ze er overal hetzelfde uitzien en met dezelfde Ongedaan-melding komen.
 */
export function useKlantActies() {
  const qc = useQueryClient();
  const magPlannen = useRecht("planning");
  // Alleen voor de straatnaam in de meldingen; dezelfde cache als de pagina.
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["districts"] });
    qc.invalidateQueries({ queryKey: ["streets"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
    qc.invalidateQueries({ queryKey: ["straat_groepen"] });
    // Een verhuizing maakt het wijzigingslog van het adres leeg.
    qc.invalidateQueries({ queryKey: ["dossier-wijzigingen"] });
  }

  function meldUndo(bericht: string) {
    // Standaard verdwijnt een melding na ~4 seconden. Dat is te kort om te beslissen
    // of je een verwijdering terugdraait — de knop is weg voor je hem kunt raken.
    toast(bericht, {
      duration: 12000,
      action: undoKnop(),
    });
  }

  /** Met de straat erbij: "Klant 8" zegt niet welke 8, en elke straat heeft er een. */
  function adresVan(c: Customer) {
    const straat = (streetsQuery.data ?? []).find((s) => s.id === c.street_id)?.name;
    return straat ? `${straat} ${formatNumber(c)}` : `Klant ${formatNumber(c)}`;
  }

  /** Geeft terug of het opslaan lukte (een fout is al gemeld). */
  async function patchKlant(c: Customer, patch: Partial<Customer>): Promise<boolean> {
    const vorige: Partial<Customer> = {};
    for (const key of Object.keys(patch) as (keyof Customer)[]) {
      (vorige as Record<string, unknown>)[key] = c[key];
    }
    // Meteen zichtbaar, in de actieve lijst én in die met de gestopte
    // adressen erbij (de dag leest die tweede).
    const pas = (old: Customer[] | undefined) =>
      old?.map((x) => (x.id === c.id ? { ...x, ...patch } : x));
    qc.setQueryData<Customer[]>(["customers"], (old) => pas(old) ?? []);
    qc.setQueryData<Customer[]>(["customers", "met-inactief"], pas);
    // Via patchCustomer: een prijs of meerprijs gaat dan naar zijn eigen tabel.
    try {
      await patchCustomer(c.id, patch);
    } catch (error) {
      toast.error(
        "Opslaan mislukt: " +
          (error instanceof Error
            ? error.message
            : String((error as { message?: string })?.message ?? error)),
      );
      qc.invalidateQueries({ queryKey: ["customers"] });
      return false;
    }
    pushUndo({
      label: `Wijziging ${formatNumber(c)}`,
      undo: async () => {
        await patchCustomer(c.id, vorige);
        herlaad();
      },
    });
    return true;
  }

  /**
   * Een extra opdracht bij een adres. Hij komt zonder dag binnen: waar en
   * wanneer je hem doet beslis je op de planning, als die wijk aan de beurt
   * is.
   */
  async function maakKlus(customerId: string, omschrijving: string, prijs: number) {
    let id: string;
    try {
      id = await nieuweKlus(customerId, omschrijving, prijs);
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Opdracht ${omschrijving}`,
      undo: async () => {
        await verwijderKlus(id);
        qc.invalidateQueries({ queryKey: ["klussen"] });
      },
    });
    qc.invalidateQueries({ queryKey: ["klussen"] });
    toast.success(`Opdracht genoteerd: ${omschrijving}`);
  }

  /** Een klant laat stoppen: het adres wordt inactief, met alles bewaard. */
  async function stopKlant(c: Customer, reden: StopReden, planningWeg: boolean) {
    const adres = adresVan(c);
    const u = await zetInactief([c.id], reden, planningWeg);
    if (u.adressen.length === 0) {
      toast.info(`${adres} was al inactief of weg.`);
      herlaad();
      return;
    }
    const planning = () => {
      // Ging hij van de planning af, dan klopt een open dag niet meer.
      if (!planningWeg) return;
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
    };
    pushUndo({
      label: `Stoppen ${adres}`,
      undo: async () => {
        await draaiStoppenTerug(u);
        herlaad();
        planning();
      },
    });
    herlaad();
    planning();
    meldUndo(`${adres} staat nu bij Inactief (klantenpagina)`);
  }

  async function verwijderKlant(c: Customer, planningWeg: boolean) {
    const adres = adresVan(c);
    // Geen aparte vraag meer: je koos "Verwijderen" in het stopschermpje, en
    // daar ook wat er met de planning moet.
    let kenmerken: string[] = [];
    // Zonder het recht op de planning kan dat deel niet; het verwijderen zelf
    // wel. Dan blijft de planning staan, en dat zeggen we.
    const planningMag = planningWeg && magPlannen;
    if (planningWeg && !magPlannen) {
      toast.info("De planning bleef staan: je rol mag de planning niet aanpassen.");
    }
    try {
      if (planningMag) kenmerken = await haalVanPlanning([c.id]);
      await legWeg("customers", [c.id]);
    } catch (e) {
      // Stond hij al van de planning af, dan dat terug: half is erger dan niets.
      await zetPlanningTerug(kenmerken).catch(() => {});
      toast.error("Verwijderen mislukt: " + (e as Error).message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${adres}`,
      undo: async () => {
        // Eerst het adres terug, dan de planning: een weggegooid adres komt
        // niet terug op een dag in de toekomst.
        await haalTerug("customers", [c.id]);
        await zetPlanningTerug(kenmerken);
        qc.invalidateQueries({ queryKey: ["wasdag"] });
        qc.invalidateQueries({ queryKey: ["wasdagen"] });
        herlaad();
      },
    });
    if (kenmerken.length) {
      qc.invalidateQueries({ queryKey: ["wasdag"] });
      qc.invalidateQueries({ queryKey: ["wasdagen"] });
    }
    herlaad();
    meldUndo(
      kenmerken.length
        ? `${adres} verwijderd en van ${kenmerken.length} ${kenmerken.length === 1 ? "dag" : "dagen"} op de planning gehaald`
        : `${adres} verwijderd`,
    );
  }

  return { herlaad, meldUndo, patchKlant, maakKlus, stopKlant, verwijderKlant };
}
