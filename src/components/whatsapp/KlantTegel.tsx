/**
 * Rechts naast een WhatsApp-gesprek: wie het is. Dezelfde groene tegel als
 * naast een mail, gevonden via het telefoonnummer.
 *
 * Erboven, net als bij mail, wat Wooshy zelf deed met de gegevens uit de
 * appjes (klant herkend, lege vakjes ingevuld): geel, met Klopt en Ongedaan
 * maken. Wat niet in een leeg vak paste staat in "Anders in het appje".
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconUser as UserRound } from "@tabler/icons-react";

import {
  AndersVakje,
  KlantBlok,
  WooshyVakje,
  type VakjesActies,
} from "@/components/mail/KlantKaart";
import { useRecht } from "@/lib/rechten";
import {
  bevestigWaKlant,
  draaiWaKlantgegevensTerug,
  fetchKlantBijTelefoon,
  fetchWaKlantgegevens,
  telefoonSleutel,
  toonNummer,
} from "@/lib/whatsapp";
import { vandaag } from "@/lib/wasdag";

const WA_ACTIES: VakjesActies = {
  klopt: bevestigWaKlant,
  terug: draaiWaKlantgegevensTerug,
  soort: "appje",
};

export function KlantTegel({ telefoon, klantId }: { telefoon: string; klantId: string | null }) {
  const qc = useQueryClient();
  const dag = vandaag();
  const magBewerken = useRecht("klanten_bewerken");
  const klanten = useQuery({
    queryKey: ["wa-klant", telefoon, klantId, dag],
    queryFn: () => fetchKlantBijTelefoon(telefoon, klantId, dag),
  });
  // Ververst mee met het gesprek: Paaltje leest een nieuw appje binnen een minuut.
  const gegevens = useQuery({
    queryKey: ["wa-klantgegevens", telefoon],
    queryFn: () => fetchWaKlantgegevens(telefoon),
    refetchInterval: 30_000,
  });

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["wa-klantgegevens", telefoon] });
    void qc.invalidateQueries({ queryKey: ["wa-klant"] });
    void qc.invalidateQueries({ queryKey: ["wa-gesprekken"] });
    void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
    void qc.invalidateQueries({ queryKey: ["klanten"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };

  if (klanten.isLoading)
    return <p className="text-[12.5px] text-muted-foreground">Klant zoeken…</p>;

  if (klanten.isError) {
    return (
      <p className="rounded-[14px] bg-tint-rood p-3 text-[12.5px] text-tint-rood-ink">
        Klant opzoeken lukte niet. Probeer het zo nog eens.
      </p>
    );
  }

  const lijst = klanten.data ?? [];
  const appjes = gegevens.data ?? [];
  const vakjes = appjes.map((b) => (
    <WooshyVakje
      key={b.id}
      b={b}
      klanten={lijst}
      uit={!magBewerken}
      onKlaar={ververs}
      acties={WA_ACTIES}
    />
  ));

  if (lijst.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {vakjes}
        <div className="rounded-[14px] bg-muted/50 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <UserRound className="size-3.5 text-muted-foreground" /> Geen klant
          </p>
          <p className="mt-1 break-words text-[12px] leading-snug text-muted-foreground">
            {toonNummer(telefoon)} hoort nog bij geen klant.
            {/* Alleen Nederlandse nummers koppelt Wooshy aan een klant. */}
            {telefoonSleutel(telefoon) &&
              " Zet het nummer bij een klant, dan herkent Wooshy het vanzelf."}
          </p>
        </div>
      </div>
    );
  }

  // "Anders in het appje" van het nieuwste appje dat er iets over zegt, bij de
  // klant die op dat appje staat.
  const metAnders = appjes.find((b) => b.klantgegevens.anders);
  const doel = metAnders
    ? (lijst.find(
        (k) => k.id === (metAnders.klant_id ?? metAnders.klantgegevens.toegevoegd?.klant_id),
      ) ?? lijst[0]!)
    : null;

  return (
    <div className="flex flex-col gap-2">
      {vakjes}
      {lijst.map((k) => (
        <KlantBlok key={k.id} k={k} />
      ))}
      {metAnders && doel && (
        <AndersVakje b={metAnders} klant={doel} uit={!magBewerken} soort="appje" />
      )}
    </div>
  );
}
