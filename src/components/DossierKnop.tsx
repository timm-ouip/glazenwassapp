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
 * Het dossier heeft wijken, straten, adressen en klanten nodig. Die komen uit
 * het geheugen (dezelfde cache als de klantenpagina); alleen dit adres en deze
 * klant haalt hij bij elke klik vers op (zie lib/dossierOpenen). Zodra dat er
 * is, legt hij het vast en opent het venster: een verversing daarna mag het
 * formulier niet opnieuw vullen en je getypte tekst wissen.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconLoader2 as Loader2, IconUser as User } from "@tabler/icons-react";
import { toast } from "sonner";

import { KlantgegevensDialog } from "@/components/KlantgegevensDialog";
import { haalDossierGegevens, type DossierGegevens } from "@/lib/dossierOpenen";
import { addQuickNote, type Klant } from "@/lib/klanten";
import { cn } from "@/lib/utils";

type Vast = DossierGegevens & { klant: Klant };

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
   * Het adres en de klant bij elke klik vers ophalen, ook als ze al in het
   * geheugen staan: het dossier schrijft bij opslaan alle klantvelden terug,
   * dus met een oude versie zou je een net toegevoegd nummer stil weer wissen.
   * De lijsten komen uit het geheugen; die opnieuw ophalen duurde op 4G
   * seconden.
   */
  async function open() {
    setLaden(true);
    try {
      const g = await haalDossierGegevens(qc, customerId, klantId);
      const klant = g?.klant;
      if (!g || !klant || g.adres.klant_id !== klantId) {
        toast.error("Deze klant of dit adres staat er niet (meer).");
        return;
      }
      setVast({ ...g, klant });
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
            void addQuickNote(label).then(() =>
              qc.invalidateQueries({ queryKey: ["quick_notes"] }),
            );
          }}
          onSaved={herlaad}
        />
      )}
    </>
  );
}
