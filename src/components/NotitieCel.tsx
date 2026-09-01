import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import {
  formatPrice,
  noteTokens,
  toggleNoteToken,
  toonMaandKort,
  type Maandwerk,
  type QuickNote,
} from "@/lib/klanten";

const MAANDEN = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** Terwijl je typt is een prijs gewoon tekst: "18," moet ook even mogen. */
interface Regel {
  maanden: string[];
  notitie: string;
  prijs: string;
}

function naarRegels(werk: Maandwerk[] | undefined): Regel[] {
  return (werk ?? []).map((w) => ({
    maanden: w.maanden,
    notitie: w.notitie,
    prijs: w.prijs === null ? "" : String(w.prijs).replace(".", ","),
  }));
}

function naarMaandwerk(regels: Regel[]): Maandwerk[] {
  return regels
    // Zonder maanden slaat een uitzondering nergens op; die valt vanzelf weg.
    .filter((r) => r.maanden.length > 0)
    .map((r) => {
      const getal = Number(r.prijs.replace(",", ".").replace(/[^\d.]/g, ""));
      return {
        maanden: r.maanden,
        notitie: r.notitie.trim(),
        prijs: r.prijs.trim() === "" || Number.isNaN(getal) ? null : getal,
      };
    });
}

/** Voor de tooltip: "serre in mrt/sep". */
function omschrijf(w: Maandwerk): string {
  const maanden = w.maanden.map((m) => toonMaandKort(`2000-${m}`)).join("/");
  return `${w.notitie.trim() || "andere prijs"} in ${maanden}`;
}

interface Props {
  value: string;
  quickNotes: QuickNote[];
  onChange: (value: string) => void;
  onAddQuickNote: (label: string) => void;
  className?: string;
  /** Werk dat er alleen in bepaalde maanden bij komt. Laat weg waar dat niet
   *  speelt, zoals in het importscherm. */
  maandwerk?: Maandwerk[] | undefined;
  onChangeMaandwerk?: ((werk: Maandwerk[]) => void) | undefined;
  /** De vaste prijs van dit adres — staat als grijze voorbeeldwaarde in het
   *  prijsvakje, zodat duidelijk is dat je daar de hele prijs voor die ronde
   *  zet en niet de meerkosten. */
  prijs?: number | undefined;
}

/** Notitieveld met meervoudige snelkeuzes en de mogelijkheid nieuwe toe te voegen. */
export function NotitieCel({
  value,
  quickNotes,
  onChange,
  onAddQuickNote,
  className,
  maandwerk,
  onChangeMaandwerk,
  prijs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(value);
  const [werk, setWerk] = useState<Regel[]>(() => naarRegels(maandwerk));
  const [nieuw, setNieuw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const maandVelden = Boolean(onChangeMaandwerk);

  useEffect(() => setTekst(value), [value]);
  useEffect(() => setWerk(naarRegels(maandwerk)), [maandwerk]);

  const actief = noteTokens(tekst).map((t) => t.toLowerCase());

  /** Enter sluit het scherm; het opslaan gebeurt in onOpenChange. */
  function sluitBijEnter(e: ReactKeyboardEvent) {
    if (e.key === "Enter") setOpen(false);
  }

  function bewaar(next: string) {
    setTekst(next);
    onChange(next);
  }

  function pasAan(i: number, patch: Partial<Regel>) {
    setWerk(werk.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function wisselMaand(i: number, maand: string) {
    const regel = werk[i]!;
    const aan = regel.maanden.includes(maand);
    pasAan(i, {
      maanden: aan
        ? regel.maanden.filter((m) => m !== maand)
        : [...regel.maanden, maand].sort(),
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) return;
        if (tekst !== value) onChange(tekst);
        if (!onChangeMaandwerk) return;
        const volgende = naarMaandwerk(werk);
        if (JSON.stringify(volgende) !== JSON.stringify(maandwerk ?? [])) {
          onChangeMaandwerk(volgende);
        }
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
          {/* Kleine stip als er in bepaalde maanden werk bij hoort; anders zie
              je dat pas als je het veld opent. */}
          {(maandwerk ?? []).length > 0 && (
            <span
              className="ml-1 inline-block size-2 rounded-full bg-tint-amber align-middle ring-1 ring-inset ring-tint-amber-ink/30"
              title={(maandwerk ?? []).map(omschrijf).join("; ")}
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
            <p className="text-[11px] text-muted-foreground">
              Alleen in bepaalde maanden
            </p>
            {werk.map((regel, i) => (
              <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                <div className="grid grid-cols-6 gap-1">
                  {MAANDEN.map((m) => {
                    const aan = regel.maanden.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => wisselMaand(i, m)}
                        className={`rounded border px-1 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                          aan
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                        }`}
                      >
                        {toonMaandKort(`2000-${m}`)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    value={regel.notitie}
                    placeholder="bijv. serre"
                    className="h-8 text-xs"
                    onChange={(e) => pasAan(i, { notitie: e.target.value })}
                    onKeyDown={sluitBijEnter}
                  />
                  {/* De vaste prijs staat er grijs in: dit is de hele prijs
                      voor die ronde, niet wat er bij komt. */}
                  <Input
                    value={regel.prijs}
                    placeholder={prijs === undefined ? "prijs" : formatPrice(prijs)}
                    inputMode="decimal"
                    className="h-8 w-20 shrink-0 text-xs"
                    onChange={(e) => pasAan(i, { prijs: e.target.value })}
                    onKeyDown={sluitBijEnter}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                    aria-label="Deze maanden weghalen"
                    onClick={() => setWerk(werk.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full text-xs"
              onClick={() => setWerk([...werk, { maanden: [], notitie: "", prijs: "" }])}
            >
              <Plus className="size-3.5" /> Maanden toevoegen
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
