import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconPlus as Plus, IconTrash as Trash2 } from "@tabler/icons-react";
import {
  eerstvolgendJaar,
  EVEN_MAANDEN,
  formatPrice,
  isGeweest,
  leesDuur,
  maandwerkMaanden,
  noteTokens,
  ONEVEN_MAANDEN,
  toggleNoteToken,
  toonMaand,
  toonMaandKort,
  type Maandwerk,
  type QuickNote,
} from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";

const MAANDEN = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** Terwijl je typt is een bedrag gewoon tekst: "18," moet ook even mogen. */
interface Regel {
  id?: string;
  maanden: string[];
  /** Eenmalig: alleen in dit jaar. Zonder jaar komt het elk jaar terug. */
  jaar?: number;
  notitie: string;
  extra: string;
  /** Minuten, als tekst terwijl je typt. */
  duur: string;
  duurZelf: boolean;
}

function naarRegels(werk: Maandwerk[] | undefined): Regel[] {
  return (werk ?? []).map((w) => ({
    ...(w.id ? { id: w.id } : {}),
    maanden: w.maanden,
    ...(w.jaar !== undefined ? { jaar: w.jaar } : {}),
    notitie: w.notitie,
    extra: w.extra === null ? "" : String(w.extra).replace(".", ","),
    duur: w.duur === null || w.duur === undefined ? "" : String(w.duur),
    duurZelf: w.duur_zelf === true,
  }));
}

function naarMaandwerk(regels: Regel[]): Maandwerk[] {
  return (
    regels
      // Zonder maanden slaat een uitzondering nergens op; die valt vanzelf weg.
      .filter((r) => r.maanden.length > 0)
      .map((r) => {
        const getal = Number(r.extra.replace(",", ".").replace(/[^\d.]/g, ""));
        const minuten = leesDuur(r.duur);
        return {
          ...(r.id ? { id: r.id } : {}),
          maanden: r.maanden,
          ...(r.jaar !== undefined ? { jaar: r.jaar } : {}),
          notitie: r.notitie.trim(),
          extra: r.extra.trim() === "" || Number.isNaN(getal) ? null : getal,
          // De duur gaat altijd mee terug: laat je hem weg, dan wist elke
          // bewerking wat de database had ingevuld.
          duur: minuten === undefined ? null : minuten,
          duur_zelf: r.duurZelf,
        };
      })
  );
}

/** Voor de tooltip: "serre in mrt/sep — € 15 extra", of "in okt 2026" als het
 *  eenmalig is. Zonder recht op prijzen zonder bedrag. */
function omschrijf(w: Maandwerk, prijzenZien: boolean): string {
  const wat = `${w.notitie.trim() || (prijzenZien ? "andere prijs" : "extra werk")} in ${maandwerkMaanden(w)}`;
  return w.extra === null || !prijzenZien ? wat : `${wat} — ${formatPrice(w.extra)} extra`;
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
  /** De kalendermaanden ("01"-"12") waarin dit adres sowieso langskomt. De
   *  andere maanden kun je wel aanvinken — dan komt hij een keer extra — maar
   *  ze horen er anders uit te zien. */
  beurtMaanden?: string[] | undefined;
  /** Alleen tonen, zonder schermpje: voor wie dit niet mag bijwerken. */
  alleenLezen?: boolean;
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
  beurtMaanden,
  alleenLezen = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tekst, setTekst] = useState(value);
  const [werk, setWerk] = useState<Regel[]>(() => naarRegels(maandwerk));
  const [nieuw, setNieuw] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prijzenZien = useRecht("prijzen_zien");

  const maandVelden = Boolean(onChangeMaandwerk);

  useEffect(() => setTekst(value), [value]);

  const actief = noteTokens(tekst).map((t) => t.toLowerCase());

  /** Zelf sluiten gaat buiten Radix om, dus dan slaan we hier zelf op:
   *  de notitie én de maanden, waar je ook op Enter drukte. */
  function sluit() {
    if (tekst !== value) onChange(tekst);
    bewaarMaandwerk();
    setOpen(false);
  }

  /** Escape betekent weggooien. Radix hoort hem eerder dan het invoerveld en
   *  sluit via onOpenChange, dat juist opslaat; deze vlag houdt dat tegen. */
  const weggooien = useRef(false);

  function sluitBijEnter(e: ReactKeyboardEvent) {
    if (e.key === "Enter") sluit();
  }

  function bewaarMaandwerk() {
    if (!onChangeMaandwerk) return;
    const volgende = naarMaandwerk(werk);
    if (JSON.stringify(volgende) !== JSON.stringify(maandwerk ?? [])) {
      onChangeMaandwerk(volgende);
    }
  }

  function bewaar(next: string) {
    setTekst(next);
    onChange(next);
  }

  function pasAan(i: number, patch: Partial<Regel>) {
    setWerk(werk.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  /** Komt dit adres deze maand sowieso langs? Zonder ritme (het importscherm)
   *  gaan we ervan uit van wel. */
  function hoortErbij(maand: string): boolean {
    return beurtMaanden === undefined || beurtMaanden.includes(maand);
  }

  /** Een hele helft van het jaar aan- of uitzetten. */
  function zetHelft(i: number, maanden: string[], aan: boolean) {
    const regel = werk[i]!;
    pasAan(i, {
      maanden: aan
        ? [...new Set([...regel.maanden, ...maanden])].sort()
        : regel.maanden.filter((m) => !maanden.includes(m)),
    });
  }

  function wisselMaand(i: number, maand: string) {
    const regel = werk[i]!;
    const aan = regel.maanden.includes(maand);
    pasAan(i, {
      maanden: aan ? regel.maanden.filter((m) => m !== maand) : [...regel.maanden, maand].sort(),
    });
  }

  /** Eenmalig is één maand, in het jaar waarin die maand het eerst weer komt. */
  function kiesEenmalig(i: number, maand: string) {
    const regel = werk[i]!;
    const aan = regel.maanden.includes(maand) && regel.jaar === eerstvolgendJaar(maand);
    pasAan(i, { maanden: aan ? [] : [maand], jaar: eerstvolgendJaar(maand) });
  }

  /** Van elk jaar naar eenmalig: de eerstvolgende maand van wat er aan stond. */
  function zetEenmalig(i: number, eenmalig: boolean) {
    const regel = werk[i]!;
    if (!eenmalig) {
      const { jaar: _jaar, ...elkJaar } = regel;
      setWerk(werk.map((r, j) => (j === i ? elkJaar : r)));
      return;
    }
    const eerste = komend.find((m) => regel.maanden.includes(m));
    pasAan(i, {
      maanden: eerste ? [eerste] : [],
      jaar: eerstvolgendJaar(eerste ?? komend[0]!),
    });
  }

  /** De komende twaalf maanden, te beginnen met deze: de keuze bij eenmalig werk. */
  const deze = new Date().getMonth() + 1;
  const komend = MAANDEN.map((_, k) => String(((deze - 1 + k) % 12) + 1).padStart(2, "0"));

  // Eenmalig werk dat al geweest is telt niet meer, en krijgt dus geen stip.
  const lopend = (maandwerk ?? []).filter((w) => !isGeweest(w));
  const stip = lopend.length > 0 && (
    <span
      className="ml-1 inline-block size-2 rounded-full bg-tint-amber align-middle ring-1 ring-inset ring-tint-amber-ink/30"
      title={lopend.map((w) => omschrijf(w, prijzenZien)).join("; ")}
    />
  );

  if (alleenLezen) {
    return (
      <span className="block w-full truncate px-1 py-0.5 text-left">
        {value || <span className="text-muted-foreground/50">—</span>}
        {stip}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Bij het opengaan overnemen wat er in de database staat; deed een
        // useEffect dat, dan wiste elke hervalidatie van de lijst je invoer.
        if (o) {
          weggooien.current = false;
          setWerk(naarRegels(maandwerk));
          return;
        }
        if (weggooien.current) {
          weggooien.current = false;
          setTekst(value);
          return;
        }
        if (tekst !== value) onChange(tekst);
        bewaarMaandwerk();
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
          {stip}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 space-y-3 p-3"
        align="start"
        onEscapeKeyDown={() => {
          weggooien.current = true;
        }}
      >
        <Input
          ref={inputRef}
          value={tekst}
          placeholder="Notitie"
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sluit();
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
            {werk.map((regel, i) => (
              <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                {/* Komt dit elk jaar terug, of is het één keer? Een klant die
                    "volgende maand een keer de serre" vraagt, hoeft niet elk
                    jaar in die maand de serre erbij te krijgen. */}
                <div className="flex gap-1" role="group" aria-label="Hoe vaak">
                  {([false, true] as const).map((eenmalig) => {
                    const aan = (regel.jaar !== undefined) === eenmalig;
                    return (
                      <button
                        key={String(eenmalig)}
                        type="button"
                        aria-pressed={aan}
                        onClick={() => aan || zetEenmalig(i, eenmalig)}
                        className={`flex-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          aan
                            ? "border-foreground/70 bg-foreground/85 text-background"
                            : "border-border bg-transparent text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {eenmalig ? "Eenmalig" : "Elk jaar"}
                      </button>
                    );
                  })}
                </div>
                {regel.jaar === undefined ? (
                  <>
                    {/* De twee helften die je het vaakst nodig hebt, in één klik.
                        Ze staan boven de losse maanden en zijn wat groter, want
                        hier begin je meestal. */}
                    <div className="flex gap-1.5">
                      {(["even", "oneven"] as const).map((helft) => {
                        const alle = helft === "even" ? EVEN_MAANDEN : ONEVEN_MAANDEN;
                        // Een adres dat alleen de oneven maanden doet, heeft niets
                        // aan een knop "even maanden": die zou zes extra beurten
                        // aanzetten en dat is nooit wat je bedoelt.
                        const maanden = alle.filter((m) => hoortErbij(m));
                        if (maanden.length === 0) return null;
                        const aan = maanden.every((m) => regel.maanden.includes(m));
                        return (
                          <button
                            key={helft}
                            type="button"
                            onClick={() => zetHelft(i, maanden, !aan)}
                            className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                              aan
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                            }`}
                          >
                            {helft === "even" ? "Even maanden" : "Oneven maanden"}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {MAANDEN.map((m) => {
                        const aan = regel.maanden.includes(m);
                        const erbij = hoortErbij(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => wisselMaand(i, m)}
                            title={
                              erbij
                                ? undefined
                                : "Komt dan niet langs — aanvinken is een extra beurt"
                            }
                            className={`rounded border px-1 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                              aan
                                ? erbij
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-dashed border-tint-amber-ink bg-tint-amber text-tint-amber-ink"
                                : erbij
                                  ? "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                                  : "border-dashed border-border bg-transparent text-muted-foreground/60 hover:bg-accent"
                            }`}
                          >
                            {toonMaandKort(`2000-${m}`)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-6 gap-1">
                      {komend.map((m) => {
                        const jaar = eerstvolgendJaar(m);
                        const aan = regel.maanden.includes(m) && regel.jaar === jaar;
                        const erbij = hoortErbij(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => kiesEenmalig(i, m)}
                            title={`${toonMaand(`${jaar}-${m}`)} ${jaar}${
                              erbij ? "" : " — komt dan niet langs, dus een extra beurt"
                            }`}
                            className={`rounded border px-1 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                              aan
                                ? erbij
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-dashed border-tint-amber-ink bg-tint-amber text-tint-amber-ink"
                                : erbij
                                  ? "border-border bg-secondary text-secondary-foreground hover:bg-accent"
                                  : "border-dashed border-border bg-transparent text-muted-foreground/60 hover:bg-accent"
                            }`}
                          >
                            {toonMaandKort(`${jaar}-${m}`)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {regel.maanden.length === 0
                        ? "Kies de maand"
                        : isGeweest(regel)
                          ? `Was in ${toonMaand(`${regel.jaar}-${regel.maanden[0]}`)} ${regel.jaar}; dat is geweest`
                          : `Alleen in ${toonMaand(`${regel.jaar}-${regel.maanden[0]}`)} ${regel.jaar}, daarna niet meer`}
                    </p>
                  </>
                )}
                <div className="flex gap-1.5">
                  <Input
                    value={regel.notitie}
                    placeholder="bijv. serre"
                    className="h-8 text-xs"
                    onChange={(e) => pasAan(i, { notitie: e.target.value })}
                    onKeyDown={sluitBijEnter}
                  />
                  {/* Alleen wat er bij komt: op een factuur hoort het meerwerk
                      apart te staan van wat het pand normaal kost. Zonder
                      recht op prijzen geen bedragveld. */}
                  {prijzenZien && (
                    <Input
                      value={regel.extra}
                      placeholder="+ €"
                      title="Wat dit werk extra kost, bovenop de vaste prijs"
                      inputMode="decimal"
                      className="h-8 w-16 shrink-0 text-xs pointer-coarse:w-20"
                      onChange={(e) => pasAan(i, { extra: e.target.value })}
                      onKeyDown={sluitBijEnter}
                    />
                  )}
                  {/* Hoeveel langer je die keer bezig bent. De app vult hem
                      één keer uit de meerprijs; typ je zelf iets, dan blijft
                      dat staan als het uurtarief verandert. */}
                  <Input
                    value={regel.duur}
                    placeholder="+ min"
                    title="Hoeveel minuten dit werk extra kost"
                    inputMode="numeric"
                    className="h-8 w-14 shrink-0 text-xs pointer-coarse:w-16"
                    onChange={(e) => pasAan(i, { duur: e.target.value, duurZelf: true })}
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
              onClick={() =>
                setWerk([
                  ...werk,
                  { maanden: [], notitie: "", extra: "", duur: "", duurZelf: false },
                ])
              }
            >
              <Plus className="size-3.5" /> Maanden toevoegen
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
