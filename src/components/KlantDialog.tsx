import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FrequentieKeuze } from "@/components/FrequentieKiezer";
import { toast } from "sonner";
import {
  leesRitmeWaarde,
  ritmeWaarde,
  noteTokens,
  toggleNoteToken,
  type Customer,
  type QuickNote,
  type Street,
} from "@/lib/klanten";
import {
  IconCalendar as CalendarDays,
  IconHash as Hash,
  IconHome as House,
  IconMessage as MessageSquare,
  IconPlus as Plus,
  IconUser as User,
} from "@tabler/icons-react";
import { opslaanBijEnter } from "@/lib/dialoog";
import { eersteBeurtVanaf, maandSleutel } from "@/lib/klanten";
import {
  PopupBlok,
  PopupBody,
  PopupHint,
  PopupKader,
  PopupKop,
  PopupPaar,
  PopupVeld,
  PopupVoet,
  popupInvoer,
} from "@/components/Popup";
import { slaAdresPrijzenOp } from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";

function startMaandVoorNieuw(ritme: { interval_maanden: number; ritme: number }): {
  start_maand?: string;
} {
  const dezeMaand = maandSleutel(new Date());
  const start = eersteBeurtVanaf(dezeMaand, ritme);
  return start === dezeMaand ? {} : { start_maand: start };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streets: Street[];
  customer: Customer | null;
  defaultStreetId?: string | undefined;
  /** Het nummer dat je al in "+ adres" typte; dan staat de cursor meteen bij de prijs. */
  defaultNumber?: string | undefined;
  /** Plek in de straat voor een nieuw adres: achteraan, zoals je hem intypt. */
  nieuweSortOrder?: number | undefined;
  quickNotes: QuickNote[];
  onAddQuickNote: (label: string) => void;
  onSaved: () => void;
}

export function KlantDialog({
  open,
  onOpenChange,
  streets,
  customer,
  defaultStreetId,
  defaultNumber,
  nieuweSortOrder,
  quickNotes,
  onAddQuickNote,
  onSaved,
}: Props) {
  const [nieuweSnelkeuze, setNieuweSnelkeuze] = useState("");
  const [streetId, setStreetId] = useState("");
  const [number, setNumber] = useState("");
  const [addition, setAddition] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  // Leeg bij een nieuw adres: de frequentie kies je zelf, anders staat er
  // ongemerkt "elke maand" op een adres dat om de twee moet.
  const [ritme, setRitme] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const prijsRef = useRef<HTMLInputElement>(null);
  // Zonder dit recht zie en stuur je geen prijs: die kent hij toch niet.
  const prijzenZien = useRecht("prijzen_zien");

  useEffect(() => {
    if (!open) return;
    setStreetId(customer?.street_id ?? defaultStreetId ?? streets[0]?.id ?? "");
    setNumber(customer ? String(customer.house_number) : (defaultNumber ?? ""));
    setAddition(customer?.addition ?? "");
    setNote(customer?.note ?? "");
    setPrice(customer ? String(customer.price) : "");
    setRitme(customer ? ritmeWaarde(customer) : "");
  }, [open, customer, defaultStreetId, defaultNumber, streets]);

  /** Loopt er al een opslag? Een tweede Enter maakte anders alles dubbel
   *  (twee klanten, twee adressen); de uitgezette knop hield alleen klikken tegen. */
  const opslaanBezig = useRef(false);
  async function save() {
    if (opslaanBezig.current) return;
    opslaanBezig.current = true;
    try {
      await bewaar();
    } finally {
      opslaanBezig.current = false;
    }
  }

  async function bewaar() {
    const huisnummer = parseInt(number, 10);
    if (!streetId || Number.isNaN(huisnummer)) {
      toast.error("Kies een straat en vul een huisnummer in.");
      return;
    }
    const prijs = Number(price.trim().replace(",", "."));
    if (prijzenZien && (price.trim() === "" || Number.isNaN(prijs))) {
      toast.error("Vul een prijs in.");
      prijsRef.current?.focus();
      return;
    }
    if (ritme === "") {
      toast.error("Kies een frequentie.");
      return;
    }
    const gekozen = leesRitmeWaarde(ritme);
    if (!gekozen) {
      toast.error("Kies een frequentie.");
      return;
    }
    setSaving(true);
    const payload = {
      street_id: streetId,
      house_number: huisnummer,
      addition: addition.trim(),
      note: note.trim(),
      interval_maanden: gekozen.interval_maanden,
      ritme: gekozen.ritme,
      ...(!customer && nieuweSortOrder !== undefined ? { sort_order: nieuweSortOrder } : {}),
      // Een nieuw adres begint in de eerste maand van zijn frequentie: maak je
      // in september een adres voor de even maanden, dan is hij pas in oktober
      // nieuw. Valt deze maand al in de frequentie, dan hoeft er niets vast.
      ...(!customer ? startMaandVoorNieuw(gekozen) : {}),
    };
    const { data: rij, error } = customer
      ? await supabase.from("customers").update(payload).eq("id", customer.id).select("id").single()
      : await supabase.from("customers").insert(payload).select("id").single();
    if (error || !rij) {
      setSaving(false);
      toast.error("Opslaan mislukt: " + (error?.message ?? "onbekende fout"));
      return;
    }
    // De prijs staat in zijn eigen tabel; dat mag alleen wie prijzen mag zien.
    try {
      if (prijzenZien) await slaAdresPrijzenOp(rij.id, { price: prijs });
    } catch (e) {
      setSaving(false);
      toast.error(
        "Het adres is opgeslagen, maar de prijs niet: " +
          (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)),
      );
      onOpenChange(false);
      onSaved();
      return;
    }
    setSaving(false);
    toast.success(customer ? "Klant bijgewerkt" : "Klant toegevoegd");
    onOpenChange(false);
    onSaved();
  }

  // De echte straatnaam (die de knop Straatnamen opzoekt), met de werknaam
  // van de wijklijst als terugval: "Willem Beukelszoonstraat", niet "Beukels".
  const volledig = (s: Street) => s.volledige_naam.trim() || s.name;
  const gekozenStraat = streets.find((s) => s.id === streetId);
  const straatNaam = gekozenStraat ? volledig(gekozenStraat) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader
        onKeyDown={opslaanBijEnter(save)}
        onOpenAutoFocus={(e) => {
          // Kwam je via "+ adres", dan staan straat en nummer er al: begin bij de prijs.
          if (!customer && defaultNumber && prijzenZien) {
            e.preventDefault();
            prijsRef.current?.focus();
          }
        }}
      >
        <PopupKop
          icoon={<User className="size-[22px]" />}
          titel={customer ? "Klant bewerken" : "Klant toevoegen"}
          subtitel={
            straatNaam && number.trim()
              ? `${straatNaam} ${number.trim()}${addition.trim()}`
              : "Een adres in deze wijk"
          }
        />
        <PopupBody>
          <PopupBlok label="Waar">
            <PopupVeld icoon={<House className="size-4" />}>
              <Select value={streetId} onValueChange={setStreetId}>
                <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                  {/* In het dichte vak alleen de echte naam; de werknaam staat in de uitgeklapte lijst. */}
                  <SelectValue placeholder="Kies een straat">{straatNaam || undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {streets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {volledig(s)}
                      {/* De werknaam erachter als hij anders is: zo herken je de straat van de lijst. */}
                      {s.volledige_naam.trim() &&
                        s.volledige_naam.trim().toLowerCase() !== s.name.trim().toLowerCase() && (
                          <span className="ml-1.5 text-muted-foreground">({s.name})</span>
                        )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PopupVeld>
            <PopupPaar smal>
              <PopupVeld icoon={<Hash className="size-4" />}>
                <Input
                  id="nr"
                  inputMode="numeric"
                  className={popupInvoer}
                  placeholder="Huisnummer"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </PopupVeld>
              <PopupVeld>
                <Input
                  id="toev"
                  className={popupInvoer}
                  placeholder="a, bis…"
                  value={addition}
                  onChange={(e) => setAddition(e.target.value)}
                />
              </PopupVeld>
            </PopupPaar>
          </PopupBlok>

          <PopupBlok label="Notitie">
            <PopupVeld icoon={<MessageSquare className="size-4" />}>
              <Input
                id="notitie"
                className={popupInvoer}
                placeholder="wat er bij dit adres hoort"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </PopupVeld>
            <div className="flex flex-wrap gap-1.5">
              {quickNotes.map((q) => {
                const aan = noteTokens(note).some((t) => t.toLowerCase() === q.label.toLowerCase());
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setNote(toggleNoteToken(note, q.label))}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      aan
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              <PopupVeld className="min-h-9">
                <Input
                  value={nieuweSnelkeuze}
                  placeholder="Nieuwe snelkeuze"
                  className={`${popupInvoer} text-xs`}
                  onChange={(e) => setNieuweSnelkeuze(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nieuweSnelkeuze.trim()) {
                      e.preventDefault();
                      onAddQuickNote(nieuweSnelkeuze.trim());
                      setNieuweSnelkeuze("");
                    }
                  }}
                />
              </PopupVeld>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-9 shrink-0 rounded-full"
                onClick={() => {
                  if (!nieuweSnelkeuze.trim()) return;
                  onAddQuickNote(nieuweSnelkeuze.trim());
                  setNieuweSnelkeuze("");
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </PopupBlok>

          <PopupBlok label={prijzenZien ? "Prijs en frequentie" : "Frequentie"}>
            <PopupPaar>
              {prijzenZien && (
                <PopupVeld icoon={<span className="text-sm">€</span>}>
                  <Input
                    id="prijs"
                    ref={prijsRef}
                    inputMode="decimal"
                    className={`${popupInvoer} tabular-nums`}
                    placeholder="0,00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </PopupVeld>
              )}
              <PopupVeld icoon={<CalendarDays className="size-4" />}>
                {/* Hetzelfde menu als op de wijklijst: per frequentie een zijmenu met de maanden. */}
                <FrequentieKeuze value={ritme} onChange={setRitme} />
              </PopupVeld>
            </PopupPaar>
            <PopupHint>
              {prijzenZien
                ? "Allebei nodig: zonder prijs en frequentie weet de app niet wanneer dit adres aan de beurt is of wat het opbrengt."
                : "Nodig: zonder frequentie weet de app niet wanneer dit adres aan de beurt is."}
            </PopupHint>
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button className="rounded-full" onClick={save} disabled={saving}>
            {saving ? "Bezig…" : "Opslaan"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
