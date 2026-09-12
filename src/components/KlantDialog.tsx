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
import { FrequentieOpties } from "@/components/FrequentieKiezer";
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
import { CalendarDays, Hash, House, MessageSquare, Plus, User } from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    setStreetId(customer?.street_id ?? defaultStreetId ?? streets[0]?.id ?? "");
    setNumber(customer ? String(customer.house_number) : (defaultNumber ?? ""));
    setAddition(customer?.addition ?? "");
    setNote(customer?.note ?? "");
    setPrice(customer ? String(customer.price) : "");
    setRitme(customer ? ritmeWaarde(customer) : "");
  }, [open, customer, defaultStreetId, defaultNumber, streets]);

  async function save() {
    const huisnummer = parseInt(number, 10);
    if (!streetId || Number.isNaN(huisnummer)) {
      toast.error("Kies een straat en vul een huisnummer in.");
      return;
    }
    const prijs = Number(price.trim().replace(",", "."));
    if (price.trim() === "" || Number.isNaN(prijs)) {
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
      price: prijs,
      interval_maanden: gekozen.interval_maanden,
      ritme: gekozen.ritme,
      ...(!customer && nieuweSortOrder !== undefined ? { sort_order: nieuweSortOrder } : {}),
      // Een nieuw adres begint in de eerste maand van zijn frequentie: maak je
      // in september een adres voor de even maanden, dan is hij pas in oktober
      // nieuw. Valt deze maand al in de frequentie, dan hoeft er niets vast.
      ...(!customer ? startMaandVoorNieuw(gekozen) : {}),
    };
    const { error } = customer
      ? await supabase.from("customers").update(payload).eq("id", customer.id)
      : await supabase.from("customers").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      return;
    }
    toast.success(customer ? "Klant bijgewerkt" : "Klant toegevoegd");
    onOpenChange(false);
    onSaved();
  }

  const straatNaam = streets.find((s) => s.id === streetId)?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader
        onKeyDown={opslaanBijEnter(save)}
        onOpenAutoFocus={(e) => {
          // Kwam je via "+ adres", dan staan straat en nummer er al: begin bij de prijs.
          if (!customer && defaultNumber) {
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
                  <SelectValue placeholder="Kies een straat" />
                </SelectTrigger>
                <SelectContent>
                  {streets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
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

          <PopupBlok label="Prijs en frequentie">
            <PopupPaar>
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
              <PopupVeld icoon={<CalendarDays className="size-4" />}>
                <Select value={ritme} onValueChange={setRitme}>
                  <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none focus:ring-0">
                    <SelectValue placeholder="Kies…" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Per interval een groepje met de maanden die erbij
                        kunnen horen — dezelfde indeling als het menu op de
                        wijkenlijst, zodat je hier niet minder kunt kiezen dan
                        daar. Bij om de 1 is er één mogelijkheid, dus dan is de
                        maandkeuze geen keuze. */}
                    <FrequentieOpties />
                  </SelectContent>
                </Select>
              </PopupVeld>
            </PopupPaar>
            <PopupHint>
              Allebei nodig: zonder prijs en frequentie weet de app niet wanneer dit adres aan de
              beurt is of wat het opbrengt.
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
