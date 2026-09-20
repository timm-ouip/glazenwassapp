/**
 * "Koppelen aan adres" naast een mail van iemand die Wooshy niet herkende.
 *
 * Zoek een adres (straat + huisnummer) of een klant (naam) en kies. Hoort er al
 * een klant bij het adres, dan komt de mail bij die klant. Staat het adres er
 * nog zonder klant, dan maken we de klant aan met de gegevens uit de mail.
 * Daarna hoort het mailadres bij de klant en leest Paaltje de mail opnieuw.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconLink as Link2,
  IconLoader2 as Loader2,
  IconMapPin as MapPin,
  IconSearch as Search,
  IconUser as UserRound,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import { zoekAdresOfKlant, type AdresKeuze, type Bericht } from "@/lib/berichten";
import { bewaarKlant, koppelKlant as hangKlantAanAdres } from "@/lib/klanten";
import { koppelKlant } from "@/lib/mailacties";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  b: Bericht;
  onKlaar: () => void;
}

export function KoppelAanAdresDialog({ open, onOpenChange, b, onKlaar }: Props) {
  const [zoek, setZoek] = useState("");
  const [term, setTerm] = useState("");
  const [bezig, setBezig] = useState<string | null>(null);

  // Beginnen met wat in de mail stond: het adres, anders de naam.
  useEffect(() => {
    if (!open) return;
    const g = b.klantgegevens.gevonden;
    const begin = g?.straat ? `${g.straat} ${g.huisnummer}`.trim() : g?.naam || b.van_naam || "";
    setZoek(begin);
    setTerm(begin.trim());
  }, [open, b]);

  useEffect(() => {
    const t = setTimeout(() => setTerm(zoek.trim()), 300);
    return () => clearTimeout(t);
  }, [zoek]);

  const treffers = useQuery({
    queryKey: ["adres-of-klant", term],
    queryFn: () => zoekAdresOfKlant(term),
    enabled: open && term.length >= 2,
  });

  async function kies(k: AdresKeuze) {
    setBezig(k.sleutel);
    try {
      let klantId = k.klantId;
      let naam = k.klantNaam;
      if (!klantId && k.customerId) {
        // Een adres zonder klant: de klant maken met wat in de mail stond.
        const g = b.klantgegevens.gevonden;
        naam = g?.naam || b.van_naam;
        const klant = await bewaarKlant(null, {
          naam,
          email: b.van_email,
          email2: "",
          telefoon: g?.telefoon ?? "",
          telefoon2: "",
          straat: k.straat,
          huisnummer: k.huisnummer,
          postcode: g?.postcode ?? "",
          plaats: g?.plaats ?? "",
          notitie: "",
        });
        await hangKlantAanAdres([k.customerId], klant.id);
        klantId = klant.id;
      }
      if (!klantId) return;
      await koppelKlant(b.id, klantId);
      toast.success(
        `${b.van_email || "De mail"} hoort nu bij ${naam || "deze klant"}. Paaltje leest de mail opnieuw.`,
      );
      onOpenChange(false);
      onKlaar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(null);
    }
  }

  const lijst = treffers.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader>
        <PopupKop
          icoon={<Link2 className="size-5" />}
          titel="Koppelen aan adres"
          subtitel={b.van_naam || b.van_email}
        />
        <PopupBody>
          <div className="flex flex-col gap-2">
            <PopupVeld icoon={<Search className="size-4" />}>
              <Input
                className={popupInvoer}
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Kerkstraat 12, of een naam"
                autoFocus
              />
            </PopupVeld>
            <PopupHint>Typ een straat met huisnummer, of de naam van de klant.</PopupHint>
          </div>

          <div className="flex flex-col gap-1">
            {term.length < 2 ? null : treffers.isLoading ? (
              <p className="text-[13px] text-muted-foreground">Zoeken…</p>
            ) : treffers.isError ? (
              <p className="text-[13px] text-tint-rood-ink">
                Zoeken lukte niet. Probeer het zo nog eens.
              </p>
            ) : lijst.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Niets gevonden.</p>
            ) : (
              lijst.map((k) => (
                <button
                  key={k.sleutel}
                  type="button"
                  disabled={k.inactief || bezig !== null}
                  onClick={() => void kies(k)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-[12px] border border-border px-3 py-2 text-left transition-colors",
                    k.inactief ? "opacity-50" : "hover:bg-muted/60",
                  )}
                >
                  {bezig === k.sleutel ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : k.customerId ? (
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">
                      {k.adres || k.klantNaam}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {k.inactief
                        ? "Inactief (gestopt of verhuisd)"
                        : k.klantId
                          ? k.adres
                            ? k.klantNaam || "Klant zonder naam"
                            : "Klant zonder adres"
                          : "Nog geen klant: wordt aangemaakt met de gegevens uit de mail"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </PopupBody>
        <PopupVoet>
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
