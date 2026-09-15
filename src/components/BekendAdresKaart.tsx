/**
 * Een aanmelding op een adres dat we al kennen: iemand stopte of verhuisde,
 * en nu meldt zich (weer) iemand. De oude gegevens van het huis staan erbij
 * als voorstel; jij kiest.
 *
 * Overnemen gebeurt in één stap in de database (bekend_adres_overnemen): die
 * kijkt eerst of het adres nog inactief is, zodat er nooit een dubbele klant
 * ontstaat of een adres van een collega overschreven wordt.
 */
import { useState } from "react";
import { Home, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { aanmeldAdres, type Aanmelding } from "@/lib/aanmeldingen";
import { formatPrice, type Klant } from "@/lib/klanten";
import { bekendAdresOvernemen, redenLabel, type InactiefAdres } from "@/lib/stoppen";
import { useRecht } from "@/lib/rechten";

export function BekendAdresKaart({
  aanmelding: a,
  adres,
  oudeKlant,
  onKlaar,
  onWeigeren,
}: {
  aanmelding: Aanmelding;
  /** Het inactieve adres; leeg als het intussen weer actief of weg is. */
  adres: InactiefAdres | null;
  /** De vorige klant, als die er nog is (bij "gestopt"). */
  oudeKlant: Klant | null;
  onKlaar: () => Promise<void>;
  onWeigeren: () => void;
}) {
  const [bezig, setBezig] = useState<"nieuw" | "oud" | null>(null);
  const prijzenZien = useRecht("prijzen_zien");

  async function overnemen(metVorigeKlant: boolean) {
    if (bezig) return;
    setBezig(metVorigeKlant ? "oud" : "nieuw");
    try {
      await bekendAdresOvernemen(a.id, metVorigeKlant);
      await onKlaar();
      toast.success(
        metVorigeKlant
          ? `${oudeKlant?.naam || "De klant"} is weer klant.`
          : "Het adres staat weer actief, met de nieuwe klant.",
      );
    } catch (e) {
      toast.error("Dat lukte niet: " + (e instanceof Error ? e.message : String(e)));
      await onKlaar();
    } finally {
      setBezig(null);
    }
  }

  const sinds = adres
    ? new Date(adres.inactief_op).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-tint-blauw text-tint-blauw-ink">
          <Home className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold leading-tight">{a.naam || "Zonder naam"}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{aanmeldAdres(a)}</p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {adres ? (
          <div className="rounded-[12px] bg-tint-blauw/50 px-3 py-2.5 text-[13px]">
            <p className="font-medium">Dit huis kennen we al</p>
            <p className="mt-0.5 text-muted-foreground">
              {redenLabel(adres.inactief_reden)} sinds {sinds} ·{" "}
              {prijzenZien ? `${formatPrice(adres.price)} · ` : ""}
              {adres.interval_maanden <= 1 ? "elke maand" : `om de ${adres.interval_maanden} maanden`}
              {adres.note.trim() ? ` · ${adres.note.trim()}` : ""}
            </p>
            {oudeKlant && (
              <p className="mt-0.5 text-muted-foreground">Vorige klant: {oudeKlant.naam || "zonder naam"}</p>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Dit adres staat intussen niet meer als inactief. Kijk op de klantenpagina hoe het er nu voor staat.
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {a.telefoon && <span>{a.telefoon}</span>}
          {a.email && <span>{a.email}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" disabled={!adres || bezig !== null} onClick={() => void overnemen(false)}>
            {bezig === "nieuw" && <Loader2 className="size-4 animate-spin" />}
            Weer actief met deze gegevens
          </Button>
          {oudeKlant && (
            <Button
              variant="outline"
              className="rounded-full"
              disabled={!adres || bezig !== null}
              onClick={() => void overnemen(true)}
            >
              {bezig === "oud" && <Loader2 className="size-4 animate-spin" />}
              Weer actief met de vorige klant
            </Button>
          )}
          <Button variant="ghost" className="rounded-full text-muted-foreground" onClick={onWeigeren}>
            <X className="size-4" /> Wegleggen
          </Button>
        </div>
      </div>
    </section>
  );
}
