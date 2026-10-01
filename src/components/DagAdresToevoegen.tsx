import { useEffect, useMemo, useState } from "react";
import {
  IconLoader2 as Loader2,
  IconMapPin as MapPin,
  IconPlus as Plus,
  IconSearch as Search,
} from "@tabler/icons-react";

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
import { useIsMobile } from "@/hooks/use-mobile";
import { formatNumber, type Customer, type District, type Klant, type Street } from "@/lib/klanten";
import { toonDatum } from "@/lib/wasdag";
import { cn } from "@/lib/utils";

/** Een toevoeging zonder streepjes, spaties en hoofdletters: "-A" is "a". */
function kaal(tekst: string): string {
  return tekst.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Zoveel treffers tonen we; typ meer om te verfijnen. */
const MAX_TREFFERS = 60;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datum: string;
  /** De adressen die al op deze dag staan (op adres-id, alle teams). */
  opDeDag: Set<string>;
  /** De actieve adressen, straten, wijken en klanten van de pagina. */
  adressen: Customer[];
  straten: Street[];
  wijken: District[];
  klanten: Klant[];
  /** De klanten komen nog binnen: dan nog niets zeggen over namen. */
  klantenLaden: boolean;
  /** Zet het adres op de dag; true als dat gelukt is (dan gaat dit dicht). */
  onKies: (customerId: string) => Promise<boolean>;
  /** Niet gevonden: een nieuw adres maken, met wat je typte. Weglaten als je
   *  rol geen adressen mag toevoegen. */
  onNieuw?: ((zoek: string) => void) | undefined;
}

interface Treffer {
  c: Customer;
  /** "Westduinweg 230k" */
  adres: string;
  /** De straatnaam waarop gesorteerd wordt. */
  straatNaam: string;
  /** Klant, wijk en werknaam: zo zie je het verschil tussen twee adressen
   *  die er hetzelfde uitzien. */
  onder: string;
}

/**
 * "+ Adres" op de dag: een adres dat er nog niet op staat erbij zetten. Zoek
 * op straat en huisnummer ("Westduinweg 230", "westduin 230k"), of op de naam
 * van de klant.
 *
 * Gezocht wordt in de lijsten die de pagina al heeft: alleen actieve adressen
 * in straten en wijken die niet weggelegd zijn, elk adres één keer. Zo klopt
 * ook "staat al op deze dag", want dat gaat op het adres zelf en niet op de
 * klant.
 */
export function DagAdresToevoegen({
  open,
  onOpenChange,
  datum,
  opDeDag,
  adressen,
  straten,
  wijken,
  klanten,
  klantenLaden,
  onKies,
  onNieuw,
}: Props) {
  const [zoek, setZoek] = useState("");
  const [term, setTerm] = useState("");
  const [bezig, setBezig] = useState<string | null>(null);
  const mobiel = useIsMobile();

  useEffect(() => {
    if (!open) return;
    setZoek("");
    setTerm("");
  }, [open]);

  // Even wachten tot je uitgetypt bent: anders herschikt de lijst bij elke letter.
  useEffect(() => {
    const t = setTimeout(() => setTerm(zoek.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [zoek]);

  const straatOpId = useMemo(() => new Map(straten.map((s) => [s.id, s])), [straten]);
  const wijkOpId = useMemo(() => new Map(wijken.map((w) => [w.id, w])), [wijken]);
  const klantOpId = useMemo(() => new Map(klanten.map((k) => [k.id, k])), [klanten]);

  const { treffers, meer } = useMemo(() => {
    if (term.length < 2) return { treffers: [] as Treffer[], meer: false };
    // "kerkstraat 12", "12a", "12-1", "12 bis": het deel na het nummer is de
    // toevoeging, zonder streepjes en spaties vergeleken.
    const m = term.match(/^(.*?)\s*(\d+)([-/\s]?[a-z0-9]{0,4})$/);
    const straatDeel = (m ? (m[1] ?? "") : term).trim();
    const nummer = m ? Number(m[2]) : null;
    const toevoeging = kaal(m?.[3] ?? "");

    const uit: Treffer[] = [];
    for (const c of adressen) {
      const s = straatOpId.get(c.street_id);
      // Een straat of wijk in de prullenbak: dan hoort het adres er niet bij.
      const w = s ? wijkOpId.get(s.district_id) : undefined;
      if (!s || !w) continue;
      const klant = c.klant_id ? klantOpId.get(c.klant_id) : undefined;
      const namen = [s.name, s.volledige_naam].map((n) => n.trim().toLowerCase());
      const straatPast = straatDeel === "" || namen.some((n) => n !== "" && n.includes(straatDeel));
      const nummerPast =
        nummer === null ||
        (c.house_number === nummer && kaal(c.addition ?? "").startsWith(toevoeging));
      // Zonder huisnummer ook op naam: een klant zoek je vaak zo.
      const naamPast = nummer === null && !!klant?.naam.toLowerCase().includes(term);
      if (!((straatPast && nummerPast && (straatDeel !== "" || nummer !== null)) || naamPast)) {
        continue;
      }
      const straatNaam = s.volledige_naam.trim() || s.name;
      const werknaam =
        s.name.trim().toLowerCase() !== straatNaam.trim().toLowerCase() ? s.name : "";
      uit.push({
        c,
        adres: `${straatNaam} ${formatNumber(c)}`,
        straatNaam,
        onder: [klant?.naam || "Nog geen klant", w.name, werknaam].filter(Boolean).join(" · "),
      });
    }
    // Straat, dan huisnummer, dan toevoeging: 230, 230a, 230b …
    uit.sort(
      (a, b) =>
        a.straatNaam.localeCompare(b.straatNaam, "nl") ||
        a.c.house_number - b.c.house_number ||
        (a.c.addition ?? "").localeCompare(b.c.addition ?? "", "nl", { sensitivity: "base" }) ||
        a.onder.localeCompare(b.onder, "nl"),
    );
    return { treffers: uit.slice(0, MAX_TREFFERS), meer: uit.length > MAX_TREFFERS };
  }, [term, adressen, straatOpId, wijkOpId, klantOpId]);

  async function kies(id: string) {
    setBezig(id);
    try {
      if (await onKies(id)) onOpenChange(false);
    } finally {
      setBezig(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader blad={mobiel} onSluit={() => onOpenChange(false)}>
        <PopupKop
          icoon={<Plus className="size-5" />}
          titel="Adres op deze dag zetten"
          subtitel={toonDatum(datum)}
        />
        <PopupBody>
          <div className="flex flex-col gap-2">
            <PopupVeld icoon={<Search className="size-4" />}>
              <Input
                className={popupInvoer}
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Kerkstraat 12, of een naam"
                autoFocus={!mobiel}
              />
            </PopupVeld>
            <PopupHint>Typ een straat met huisnummer, of de naam van de klant.</PopupHint>
          </div>

          <div className="flex flex-col gap-1">
            {term.length < 2 ? null : klantenLaden ? (
              <p className="text-[13px] text-muted-foreground">Zoeken…</p>
            ) : treffers.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Niets gevonden.</p>
            ) : (
              <>
                {treffers.map((t) => {
                  const erop = opDeDag.has(t.c.id);
                  return (
                    <button
                      key={t.c.id}
                      type="button"
                      disabled={erop || bezig !== null}
                      onClick={() => void kies(t.c.id)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-[12px] border border-border px-3 py-2 text-left transition-colors",
                        erop ? "opacity-50" : "hover:bg-muted/60",
                      )}
                    >
                      {bezig === t.c.id ? (
                        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{t.adres}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {erop ? `Staat al op deze dag · ${t.onder}` : t.onder}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {meer && (
                  <p className="text-[12px] text-muted-foreground">
                    Er zijn meer treffers; typ meer om te verfijnen.
                  </p>
                )}
              </>
            )}
          </div>
        </PopupBody>
        <PopupVoet
          links={
            onNieuw && (
              <Button
                type="button"
                variant="ghost"
                className="rounded-full"
                onClick={() => onNieuw(zoek.trim())}
              >
                <Plus className="size-4" /> Nieuw adres aanmaken
              </Button>
            )
          }
        >
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            Annuleren
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
