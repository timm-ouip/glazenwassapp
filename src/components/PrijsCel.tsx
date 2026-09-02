import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  extraVoorMaand,
  formatPrice,
  maandwerkVoor,
  prijsVoorMaand,
  toonMaand,
  toonMaandKort,
  type Customer,
  type Maandwerk,
} from "@/lib/klanten";

interface Props {
  customer: Customer;
  /** De maand die je bekijkt: die bepaalt welk bedrag er in de regel staat. */
  ronde: string;
  onPatch: (patch: Partial<Customer>) => void;
}

function bedragVan(waarde: string): number {
  return Number(waarde.replace(",", ".").replace(/[^\d.]/g, "")) || 0;
}

function maandenVan(w: Maandwerk): string {
  return w.maanden.map((m) => toonMaandKort(`2000-${m}`)).join("/");
}

/**
 * De prijs van een adres voor de maand die je bekijkt. In de regel staat het
 * bedrag dat je die ronde rekent — hetzelfde bedrag dat de omzetteller en de
 * printlijst gebruiken — en dat kan meer zijn dan de vaste prijs.
 *
 * Daarom is dit een schermpje en geen invulvakje: één getal bewerken terwijl
 * er twee in het spel zijn, is een val. Hier zie je waar het bedrag vandaan
 * komt en pas je aan wat je bedoelt.
 */
export function PrijsCel({ customer: c, ronde, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const [vast, setVast] = useState(String(c.price).replace(".", ","));
  const [extras, setExtras] = useState<string[]>([]);

  const werkNu = maandwerkVoor(c, ronde);
  const extra = extraVoorMaand(c, ronde);
  const totaal = prijsVoorMaand(c, ronde);

  /** Overnemen wat er in de database staat — alleen bij het opengaan. Deed
   *  dit een useEffect op de klant, dan wiste elke hervalidatie van de lijst
   *  wat je net had ingetypt. */
  function vulIn() {
    setVast(String(c.price).replace(".", ","));
    setExtras(c.maandwerk.map((w) => (w.extra === null ? "" : String(w.extra).replace(".", ","))));
  }

  /** Zelf sluiten gaat buiten Radix om, dus dan slaan we hier zelf op. */
  function sluit() {
    bewaar();
    setOpen(false);
  }

  function bewaar() {
    const nieuwePrijs = bedragVan(vast);
    const patch: Partial<Customer> = {};
    if (nieuwePrijs !== c.price) patch.price = nieuwePrijs;

    const volgende = c.maandwerk.map((w, i) => {
      const tekst = extras[i] ?? "";
      return { ...w, extra: tekst.trim() === "" ? null : bedragVan(tekst) };
    });
    if (JSON.stringify(volgende) !== JSON.stringify(c.maandwerk)) patch.maandwerk = volgende;
    if (Object.keys(patch).length > 0) onPatch(patch);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) vulIn();
        else bewaar();
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            extra > 0
              ? `${formatPrice(c.price)} plus ${formatPrice(extra)} meerwerk in ${toonMaand(ronde)}`
              : "Prijs van dit adres"
          }
          className={`w-full truncate px-1 py-0.5 text-right tabular-nums hover:bg-accent/60 focus:bg-accent focus:outline-none ${
            totaal === 0 ? "text-red-600" : extra > 0 ? "text-tint-amber-ink" : ""
          }`}
        >
          {formatPrice(totaal)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-3 p-3" align="end">
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Prijs van het adres</p>
          <Input
            value={vast}
            inputMode="decimal"
            placeholder="0"
            className="h-8 text-sm"
            onChange={(e) => setVast(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sluit()}
          />
        </div>

        {c.maandwerk.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Extra in bepaalde maanden
            </p>
            {c.maandwerk.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs">
                  {w.notitie || "meerwerk"}
                  <span className="ml-1 text-muted-foreground">{maandenVan(w)}</span>
                </span>
                <Input
                  value={extras[i] ?? ""}
                  inputMode="decimal"
                  placeholder="+ €"
                  className="h-8 w-16 shrink-0 text-xs"
                  onChange={(e) => setExtras(extras.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => e.key === "Enter" && sluit()}
                />
              </div>
            ))}
          </div>
        )}

        {/* Waar het om gaat: wat je deze ronde rekent. Alleen tonen als er
            iets bij komt, anders herhaalt het alleen de prijs hierboven. */}
        {werkNu.length > 0 && extra > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="capitalize text-muted-foreground">{toonMaand(ronde)}</span>
            <span className="font-semibold tabular-nums">{formatPrice(totaal)}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
