import { useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Zoekbalk waar je meer dan één ding tegelijk kunt zoeken.
 *
 * Tab (of Enter) maakt van wat je net typte een tegeltje, zodat je daarna een
 * tweede en derde straat kunt intikken. Alles wat op één van de tegels past
 * blijft staan: je wilt die straten náást elkaar zien, niet alleen wat op
 * allebei past. Backspace in een leeg vak haalt de laatste tegel weer weg.
 */
export function ZoekBalk({
  placeholder,
  onTermen,
  className,
}: {
  placeholder?: string;
  /** Alles waarop gefilterd moet worden: de tegels plus wat je nú typt. */
  onTermen: (termen: string[]) => void;
  className?: string;
}) {
  const [tegels, setTegels] = useState<string[]>([]);
  const [tekst, setTekst] = useState("");
  const invoer = useRef<HTMLInputElement>(null);

  function meld(nieuweTegels: string[], nieuweTekst: string) {
    onTermen([...nieuweTegels, nieuweTekst.trim()].filter(Boolean));
  }

  /** Geeft terug of er echt een tegel bij kwam. */
  function zetVast() {
    const t = tekst.trim();
    if (!t) return false;
    const nieuw = tegels.includes(t) ? tegels : [...tegels, t];
    setTegels(nieuw);
    setTekst("");
    meld(nieuw, "");
    return true;
  }

  function haalWeg(i: number) {
    const nieuw = tegels.filter((_, x) => x !== i);
    setTegels(nieuw);
    meld(nieuw, tekst);
    invoer.current?.focus();
  }

  function opToets(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab" && tekst.trim()) {
      // Alleen tegenhouden als er iets vast te zetten valt, anders spring je
      // met Tab gewoon door naar de volgende knop.
      e.preventDefault();
      zetVast();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      zetVast();
      return;
    }
    if (e.key === "Backspace" && !tekst && tegels.length) {
      e.preventDefault();
      haalWeg(tegels.length - 1);
    }
  }

  return (
    <div
      className={cn(
        "relative flex min-h-9 w-full flex-wrap items-center gap-1 rounded-full border border-input bg-card py-1 pl-9 pr-3 text-sm focus-within:ring-1 focus-within:ring-ring sm:w-56",
        className,
      )}
      onClick={() => invoer.current?.focus()}
    >
      <Search className="pointer-events-none absolute left-3 top-[0.9rem] size-4 -translate-y-1/2 text-muted-foreground" />
      {tegels.map((t, i) => (
        <span
          key={t}
          className="flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
        >
          <span className="truncate">{t}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            title={`"${t}" niet meer zoeken`}
            onClick={(e) => {
              e.stopPropagation();
              haalWeg(i);
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={invoer}
        className="h-6 min-w-16 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        placeholder={tegels.length ? "" : placeholder}
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value);
          meld(tegels, e.target.value);
        }}
        onKeyDown={opToets}
      />
    </div>
  );
}
