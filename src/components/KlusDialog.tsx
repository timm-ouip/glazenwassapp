import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hammer, House, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { opslaanBijEnter } from "@/lib/dialoog";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import {
  fetchCustomers,
  fetchDistricts,
  fetchStreets,
  formatNumber,
  type Customer,
} from "@/lib/klanten";
import type { Klus } from "@/lib/klussen";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Het adres waar de opdracht bij hoort. Leeg: dan zoek je hem hier op. */
  customer: Customer | null;
  /** Een bestaande opdracht om te wijzigen; leeg is een nieuwe. */
  klus: Klus | null;
  onOpslaan: (customerId: string, omschrijving: string, prijs: number) => void;
}

/** "Kerkstraat 12 · Gouda", waar je op zoekt en wat je in de lijst ziet. */
function adresLabel(c: Customer, straat: string, wijk: string) {
  return `${straat} ${formatNumber(c)}${wijk ? ` · ${wijk}` : ""}`;
}

/**
 * Een extra opdracht bij een adres: de dakrand, de goot, een serre die één
 * keer mee moet. Omschrijving en prijs, en verder niets — geen maand, want
 * dat is het hele punt: je doet hem als je toch in die wijk bent.
 *
 * Kom je hier vanaf een adres, dan ligt dat vast. Kom je van de planning, dan
 * zoek je het adres er eerst bij.
 */
export function KlusDialog({ open, onOpenChange, customer, klus, onOpslaan }: Props) {
  const [omschrijving, setOmschrijving] = useState("");
  const [prijs, setPrijs] = useState("");
  const [zoek, setZoek] = useState("");
  const [gekozen, setGekozen] = useState<Customer | null>(null);

  // Alleen nodig als er nog geen adres bij hoort. React Query deelt deze drie
  // met de rest van de app, dus dit kost meestal geen extra aanvraag.
  const zoeken = open && !customer;
  const customersQuery = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
    enabled: zoeken,
  });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, enabled: zoeken });
  const districtsQuery = useQuery({
    queryKey: ["districts"],
    queryFn: fetchDistricts,
    enabled: zoeken,
  });

  useEffect(() => {
    if (!open) return;
    setOmschrijving(klus?.omschrijving ?? "");
    setPrijs(klus?.prijs ? String(klus.prijs) : "");
    setZoek("");
    setGekozen(null);
  }, [open, klus]);

  /** De adressen om uit te kiezen, met hun straat en wijk erbij. */
  const treffers = useMemo(() => {
    if (!zoeken) return [];
    const term = zoek.trim().toLowerCase();
    if (term.length < 2) return [];
    const straten = new Map((streetsQuery.data ?? []).map((s) => [s.id, s]));
    const wijken = new Map((districtsQuery.data ?? []).map((d) => [d.id, d.name]));
    const uit: { c: Customer; label: string }[] = [];
    for (const c of customersQuery.data ?? []) {
      const straat = straten.get(c.street_id);
      if (!straat) continue;
      const label = adresLabel(c, straat.name, wijken.get(straat.district_id) ?? "");
      if (label.toLowerCase().includes(term)) uit.push({ c, label });
      // Meer dan dit lees je toch niet; typ dan een huisnummer erbij.
      if (uit.length >= 30) break;
    }
    return uit;
  }, [zoeken, zoek, customersQuery.data, streetsQuery.data, districtsQuery.data]);

  const adres = customer ?? gekozen;

  function save() {
    if (!adres) {
      toast.error("Kies eerst een adres.");
      return;
    }
    if (!omschrijving.trim()) {
      toast.error("Vul in wat er gedaan moet worden.");
      return;
    }
    const bedrag = Number(prijs.replace(",", "."));
    if (prijs.trim() && Number.isNaN(bedrag)) {
      toast.error("Die prijs begrijp ik niet.");
      return;
    }
    onOpslaan(adres.id, omschrijving.trim(), prijs.trim() ? bedrag : 0);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-sm" onKeyDown={opslaanBijEnter(save)}>
        <PopupKop
          icoon={<Hammer className="size-[22px]" />}
          titel={klus ? "Opdracht wijzigen" : "Extra opdracht"}
          subtitel={customer ? formatNumber(customer) : "Werk zonder vaste maand"}
        />
        <PopupBody>
          {!customer && (
            <PopupBlok label="Adres">
              {gekozen ? (
                <PopupVeld
                  icoon={<House className="size-4" />}
                  achter={
                    <button
                      type="button"
                      className="text-xs underline underline-offset-2"
                      onClick={() => setGekozen(null)}
                    >
                      anders
                    </button>
                  }
                >
                  <span className="block truncate">
                    {treffers.find((t) => t.c.id === gekozen.id)?.label ?? formatNumber(gekozen)}
                  </span>
                </PopupVeld>
              ) : (
                <>
                  <PopupVeld icoon={<Search className="size-4" />}>
                    <Input
                      id="klus-adres"
                      autoFocus
                      className={popupInvoer}
                      placeholder="Zoek op straat en huisnummer"
                      value={zoek}
                      onChange={(e) => setZoek(e.target.value)}
                    />
                  </PopupVeld>
                  {treffers.length > 0 && (
                    <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto rounded-xl border border-input">
                      {treffers.map((t) => (
                        <li key={t.c.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-[13.5px] hover:bg-accent"
                            onClick={() => setGekozen(t.c)}
                          >
                            {t.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </PopupBlok>
          )}

          <PopupBlok label="Wat er gedaan moet worden">
            <PopupVeld icoon={<Hammer className="size-4" />}>
              <Input
                id="klus-wat"
                autoFocus={!!customer}
                className={popupInvoer}
                placeholder="bijv. dakrand schoonmaken"
                value={omschrijving}
                onChange={(e) => setOmschrijving(e.target.value)}
              />
            </PopupVeld>
          </PopupBlok>

          <PopupBlok label="Prijs">
            <PopupVeld icoon={<span className="text-sm">€</span>}>
              <Input
                id="klus-prijs"
                inputMode="decimal"
                className={`${popupInvoer} tabular-nums`}
                placeholder="0,00"
                value={prijs}
                onChange={(e) => setPrijs(e.target.value)}
              />
            </PopupVeld>
            <PopupHint>
              Komt bij de omzet van de dag waarop je hem doet. Er hoort geen maand bij: hij blijft
              openstaan tot je hem afvinkt.
            </PopupHint>
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={save}>
            Opslaan
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
