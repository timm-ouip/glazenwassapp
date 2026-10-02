/**
 * Wat het klantdossier nodig heeft om te openen, zonder eerst alle lijsten
 * opnieuw binnen te halen.
 *
 * Het dossier schrijft bij opslaan alle klant- en adresvelden terug. Met een
 * oude versie zou je een net toegevoegd telefoonnummer (van een collega, of
 * van Paaltje) stil weer wissen. Daarom halen we dat ene adres en die ene
 * klant altijd vers op. Maar de hele adressenlijst (al snel 2700 rijen, bijna
 * 2 MB) vers ophalen kostte op 4G seconden waarin er niets gebeurde; voor de
 * lijsten is wat er in het geheugen staat goed genoeg. Het verse adres en de verse klant zetten we in die lijsten,
 * want het dossier leest uit de lijsten (zie useDossier).
 *
 * Eigen bestand: DossierKnop en het betaalpaneel van de geldloop gebruiken het
 * allebei, en een bestand met onderdelen dat ook een losse functie deelt,
 * ververst tijdens het ontwikkelen niet meer vanzelf.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import {
  fetchCustomer,
  fetchCustomers,
  fetchDistricts,
  fetchKlant,
  fetchKlanten,
  fetchQuickNotes,
  fetchStreets,
  type Customer,
  type District,
  type Klant,
  type QuickNote,
  type Street,
} from "@/lib/klanten";

export interface DossierGegevens {
  /** Null als het adres bij niemand hoort, of de klant in de prullenbak ligt. */
  klant: Klant | null;
  adres: Customer;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
}

/**
 * Haalt het adres en de klant vers op. De twee grote lijsten (adressen en
 * klanten) komen uit het geheugen; de kleine (wijken, straten, notities)
 * mogen hooguit een minuut oud zijn, zodat een net gemaakte straat er ook in
 * staat. Wat er nog niet is, wordt opgehaald. Null als het adres er niet
 * (meer) is. Geef `klantId` mee als je die al weet: dan gaan beide
 * opvragingen tegelijk de deur uit.
 */
export async function haalDossierGegevens(
  qc: QueryClient,
  adresId: string,
  klantId?: string,
): Promise<DossierGegevens | null> {
  const [adres, klantVooraf, districts, streets, quickNotes] = await Promise.all([
    fetchCustomer(adresId),
    klantId ? fetchKlant(klantId) : Promise.resolve(null),
    qc.fetchQuery({ queryKey: ["districts"], queryFn: fetchDistricts }),
    qc.fetchQuery({ queryKey: ["streets"], queryFn: fetchStreets }),
    qc.fetchQuery({ queryKey: ["quick_notes"], queryFn: fetchQuickNotes }),
    qc.ensureQueryData({ queryKey: ["customers"], queryFn: fetchCustomers }),
    qc.ensureQueryData({ queryKey: ["klanten"], queryFn: fetchKlanten }),
  ]);
  if (!adres) return null;
  // Het verse adres zegt bij wie het hoort; de meegegeven klant kan uit een
  // oudere lijst komen (intussen een andere klant gekoppeld).
  const klant = !adres.klant_id
    ? null
    : adres.klant_id === klantId
      ? klantVooraf
      : await fetchKlant(adres.klant_id);

  await Promise.all([
    // De lijst met actieve adressen: een adres dat inmiddels gestopt is hoort
    // daar niet meer in.
    adres.inactief_op
      ? zetInLijst<Customer>(qc, ["customers"], (lijst) => lijst.filter((c) => c.id !== adres.id))
      : vervangInLijst(qc, ["customers"], fetchCustomers, adres),
    klant ? vervangInLijst(qc, ["klanten"], fetchKlanten, klant) : null,
  ]);
  // Deze lijst is alleen een reserve van het dossier (voor een gestopt
  // adres); daar hoeven we niet op te wachten.
  const metInactief = qc.getQueryData<Customer[]>(["customers", "met-inactief"]);
  if (metInactief?.some((c) => c.id === adres.id)) {
    zetInLijst<Customer>(qc, ["customers", "met-inactief"], (lijst) =>
      lijst.map((c) => (c.id === adres.id ? adres : c)),
    );
  } else if (metInactief) {
    void qc.invalidateQueries({ queryKey: ["customers", "met-inactief"], exact: true });
  }

  return {
    klant,
    adres,
    districts,
    streets,
    customers: qc.getQueryData<Customer[]>(["customers"]) ?? [],
    klanten: qc.getQueryData<Klant[]>(["klanten"]) ?? [],
    quickNotes,
  };
}

/**
 * Een rij in een lijst in het geheugen vervangen. Staat hij er (nog) niet in
 * (net gemaakt door een collega, Paaltje of een aanmelding), dan toch de hele
 * lijst vers ophalen: het dossier leest uit de lijst, en zou de klant anders
 * leeg tonen. Zelf ertussen zetten zou de volgorde door de war gooien.
 */
async function vervangInLijst<T extends { id: string }>(
  qc: QueryClient,
  queryKey: string[],
  queryFn: () => Promise<T[]>,
  rij: T,
) {
  const lijst = qc.getQueryData<T[]>(queryKey);
  if (lijst?.some((x) => x.id === rij.id)) {
    zetInLijst<T>(qc, queryKey, (oud) => oud.map((x) => (x.id === rij.id ? rij : x)));
    return;
  }
  await qc.fetchQuery({ queryKey, queryFn, staleTime: 0 });
}

/** Een lijst in het geheugen aanpassen zonder hem "vers" te noemen: één
 *  verse rij maakt de rest van de lijst niet nieuwer. */
function zetInLijst<T>(qc: QueryClient, queryKey: QueryKey, pas: (lijst: T[]) => T[]) {
  const stand = qc.getQueryState<T[]>(queryKey);
  if (!stand?.data) return;
  qc.setQueryData<T[]>(queryKey, pas(stand.data), { updatedAt: stand.dataUpdatedAt });
}
