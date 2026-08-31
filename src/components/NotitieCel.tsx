import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { noteTokens, toggleNoteToken, type QuickNote } from "@/lib/klanten";

interface Props {
  value: string;
  quickNotes: QuickNote[];
  onChange: (value: string) => void;
  onAddQuickNote: (label: string) => void;
  className?: string;
  /** Werk dat er alleen in even maanden bij komt. Laat weg waar maandnotities
   *  niet spelen, zoals in het importscherm. */
  even?: string | undefined;
  oneven?: string | undefined;
  onChangeEven?: ((value: string) => void) | undefined;
  onChangeOneven?: ((value: string) => void) | undefined;
}

/** Notitieveld met meervoudige snelkeuzes en de mogelijkheid nieuwe toe te voegen. */
export function NotitieCel({
  value,
  quickNotes,
  onChange,
  onAddQuickNote,
  className,
  even,
  oneven,
  onChangeEven,
  onChangeOneven,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(value);
  const [tekstEven, setTekstEven] = useState(even ?? "");
  const [tekstOneven, setTekstOneven] = useState(oneven ?? "");
  const [nieuw, setNieuw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const maandVelden = Boolean(onChangeEven && onChangeOneven);

  useEffect(() => setTekst(value), [value]);
  useEffect(() => setTekstEven(even ?? ""), [even]);
  useEffect(() => setTekstOneven(oneven ?? ""), [oneven]);

  const actief = noteTokens(tekst).map((t) => t.toLowerCase());

  function bewaar(next: string) {
    setTekst(next);
    onChange(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) return;
        if (tekst !== value) onChange(tekst);
        if (onChangeEven && tekstEven !== (even ?? "")) onChangeEven(tekstEven);
        if (onChangeOneven && tekstOneven !== (oneven ?? "")) onChangeOneven(tekstOneven);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            className ??
            "w-full truncate px-1 py-0.5 text-left hover:bg-accent/60 focus:bg-accent focus:outline-none"
          }
        >
          {value || <span className="text-muted-foreground/50">—</span>}
          {/* Kleine stip als er nog werk in één van beide maanden bij hoort;
              anders zie je dat pas als je het veld opent. */}
          {even?.trim() && (
            <span
              className="ml-1 inline-block size-1.5 rounded-full bg-tint-amber-ink align-middle"
              title={`Even maanden ook: ${even.trim()}`}
            />
          )}
          {oneven?.trim() && (
            <span
              className="ml-1 inline-block size-1.5 rounded-full bg-muted-foreground align-middle"
              title={`Oneven maanden ook: ${oneven.trim()}`}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" align="start">
        <Input
          ref={inputRef}
          value={tekst}
          placeholder="Notitie"
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onChange(tekst);
              setOpen(false);
            }
            if (e.key === "Escape") {
              setTekst(value);
              setOpen(false);
            }
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {quickNotes.map((q) => {
            const aan = actief.includes(q.label.toLowerCase());
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => bewaar(toggleNoteToken(tekst, q.label))}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  aan
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={nieuw}
            placeholder="Nieuwe snelkeuze"
            className="h-8 text-xs"
            onChange={(e) => setNieuw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nieuw.trim()) {
                onAddQuickNote(nieuw.trim());
                setNieuw("");
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2"
            onClick={() => {
              if (!nieuw.trim()) return;
              onAddQuickNote(nieuw.trim());
              setNieuw("");
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        {maandVelden && (
          // Alleen wat er die maand bij hoort komt op de printlijst. Boven
          // staat wat er élke keer geldt.
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">Alleen in bepaalde maanden</p>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 rounded-full bg-tint-amber px-2 py-0.5 text-center text-[10px] font-semibold text-tint-amber-ink">
                even
              </span>
              <Input
                value={tekstEven}
                placeholder="bijv. serre"
                className="h-8 text-xs"
                onChange={(e) => setTekstEven(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 rounded-full bg-muted px-2 py-0.5 text-center text-[10px] font-semibold text-muted-foreground">
                oneven
              </span>
              <Input
                value={tekstOneven}
                placeholder="bijv. dakraam"
                className="h-8 text-xs"
                onChange={(e) => setTekstOneven(e.target.value)}
              />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
