import { useEffect } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { bijGeweigerd, useWachtrijVersturen } from "@/lib/geldloop-wachtrij";

/**
 * Verstuurt de tikken die nog op de telefoon staan, waar je ook bent in de
 * app: ook als de avond al voorbij is. Weigert de database er een, dan zie je
 * dat meteen, met het adres erbij.
 */
export function WachtrijVerzender() {
  const { employee } = useAuth();
  useWachtrijVersturen(employee?.id);
  useEffect(
    () =>
      bijGeweigerd((t) =>
        toast.error(`Niet verwerkt${t.adres_tekst ? ` (${t.adres_tekst})` : ""}: ${t.fout ?? ""}`, {
          duration: 12000,
        }),
      ),
    [],
  );
  return null;
}
