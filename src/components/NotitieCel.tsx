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
}

/** Notitieveld met meervoudige snelkeuzes en de mogelijkheid nieuwe toe te voegen. */
export function NotitieCel({ value, quickNotes, onChange, onAddQuickNote, className }: Props) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(value);
  const [nieuw, setNieuw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTekst(value), [value]);

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
        if (!o && tekst !== value) onChange(tekst);
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
      </PopoverContent>
    </Popover>
  );
}
