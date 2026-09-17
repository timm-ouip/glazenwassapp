/**
 * Het poppetje dat het dossier van één adres opent, ter plekke — zonder naar
 * de klantenpagina te gaan. Gebruikt in de klanttegel naast een mail of een
 * WhatsApp-gesprek.
 *
 * Altijd voor een bekend adres: zonder adres zoekt het dossier bij opslaan
 * zelf een adres op uit straat en huisnummer, in een wijk die we hier niet
 * kennen, en zet daar het lege formulier op. Heeft een klant meer panden, dan
 * krijgt elk pand zijn eigen poppetje; er wordt niet gegokt.
 *
 * Het dossier heeft wijken, straten, adressen en klanten nodig. Die haalt hij
 * bij elke klik vers op (in dezelfde cache als de klantenpagina). Zodra alles
 * er is, legt hij het vast en opent het venster: een verversing daarna mag het
 * formulier niet opnieuw vullen en je getypte tekst wissen.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconLoader2 as Loader2, IconUser as User } from "@tabler/icons-react";
import { toast } from "sonner";

import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import {
  addQuickNote,
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchQuickNotes,
  fetchStreets,
  type Customer,
  type District,
  type Klant,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import { cn } from "@/lib/utils";

interface Vast {
  klant: Klant;
  adres: Customer;
  districts: District[];
  streets: Street[];
  customers: Customer[];
  klanten: Klant[];
  quickNotes: QuickNote[];
}

export function DossierKnop({
  klantId,
  customerId,
  naam,
  className,
}: {
  klantId: string;
  /** Het adres (pand) waar het dossier over gaat. */
  customerId: string;
  naam: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [laden, setLaden] = useState(false);
  const [vast, setVast] = useState<Vast | null>(null);

  /**
   * Bij elke klik vers ophalen, ook als het al in het geheugen staat: het
   * dossier schrijft bij opslaan alle klantvelden terug, dus met een oude
   * versie zou je een net toegevoegd nummer stil weer wissen.
   */
  async function open() {
    setLaden(true);
    try {
      const vers = <T,>(queryKey: string[], queryFn: () => Promise<T>) =>
        qc.fetchQuery({ queryKey, queryFn, staleTime: 0 });
      const [districts, streets, customers, klanten, quickNotes] = await Promise.all([
        vers(["districts"], fetchDistricts),
        vers(["streets"], fetchStreets),
        vers(["customers"], fetchCustomers),
        vers(["klanten"], fetchKlanten),
        vers(["quick_notes"], fetchQuickNotes),
      ]);
      const klant = klanten.find((k) => k.id === klantId);
      const adres = customers.find((c) => c.id === customerId && c.klant_id === klantId);
      if (!klant || !adres) {
        toast.error("Deze klant of dit adres staat er niet (meer).");
        return;
      }
      setVast({ klant, adres, districts, streets, customers, klanten, quickNotes });
    } catch {
      toast.error("Het dossier kon niet geladen worden. Probeer het zo nog eens.");
    } finally {
      setLaden(false);
    }
  }

  function herlaad() {
    void qc.invalidateQueries({ queryKey: ["klanten"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["wa-klant"] });
    void qc.invalidateQueries({ queryKey: ["klant-bij-email"] });
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-card/70",
          className,
        )}
        title="Dossier openen"
        aria-label={`Dossier van ${naam || "deze klant"} openen`}
        disabled={laden}
        onClick={() => void open()}
      >
        {laden ? <Loader2 className="size-4 animate-spin" /> : <User className="size-4" />}
      </button>
      {vast && (
        <KlantgegevensDialog
          open
          onOpenChange={(o) => !o && setVast(null)}
          klant={vast.klant}
          voorstelCustomer={vast.adres}
          districts={vast.districts}
          streets={vast.streets}
          customers={vast.customers}
          klanten={vast.klanten}
          quickNotes={vast.quickNotes}
          onAddQuickNote={(label) => {
            void addQuickNote(label).then(() => qc.invalidateQueries({ queryKey: ["quick_notes"] }));
          }}
          onSaved={herlaad}
        />
      )}
    </>
  );
}
