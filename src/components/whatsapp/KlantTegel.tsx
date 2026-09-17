/**
 * Rechts naast een WhatsApp-gesprek: wie het is. Dezelfde groene tegel als
 * naast een mail, gevonden via het telefoonnummer.
 */
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";

import { KlantBlok } from "@/components/mail/KlantKaart";
import { fetchKlantBijTelefoon, telefoonSleutel, toonNummer } from "@/lib/whatsapp";
import { vandaag } from "@/lib/wasdag";

export function KlantTegel({ telefoon, klantId }: { telefoon: string; klantId: string | null }) {
  const dag = vandaag();
  const klanten = useQuery({
    queryKey: ["wa-klant", telefoon, klantId, dag],
    queryFn: () => fetchKlantBijTelefoon(telefoon, klantId, dag),
  });

  if (klanten.isLoading) return <p className="text-[12.5px] text-muted-foreground">Klant zoeken…</p>;

  if (klanten.isError) {
    return (
      <p className="rounded-[14px] bg-tint-rood p-3 text-[12.5px] text-tint-rood-ink">
        Klant opzoeken lukte niet. Probeer het zo nog eens.
      </p>
    );
  }

  const lijst = klanten.data ?? [];
  if (lijst.length === 0) {
    return (
      <div className="rounded-[14px] bg-muted/50 p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-medium">
          <UserRound className="size-3.5 text-muted-foreground" /> Geen klant
        </p>
        <p className="mt-1 break-words text-[12px] leading-snug text-muted-foreground">
          {toonNummer(telefoon)} hoort nog bij geen klant.
          {/* Alleen Nederlandse nummers koppelt Wooshy aan een klant. */}
          {telefoonSleutel(telefoon) && " Zet het nummer bij een klant, dan herkent Wooshy het vanzelf."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {lijst.map((k) => (
        <KlantBlok key={k.id} k={k} />
      ))}
    </div>
  );
}
