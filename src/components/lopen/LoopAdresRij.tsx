/**
 * Eén adres op de looplijst: het huisnummer groot, wat het voor pand is, de
 * vier knoppen voor wat er aan de deur gezegd is, een prijs en een notitie.
 *
 * Opslaan gaat meteen (de lijst zet de nieuwe stand alvast neer). Mislukt het,
 * dan blijft wat je invulde staan, met de fout en "Opnieuw".
 *
 * Een klantadres staat er grijs bij, met "klant" of "inactief", en zonder
 * knoppen of invulvakken: daar valt niets te lopen.
 */
import { memo, useEffect, useRef, useState } from "react";
import {
  IconArrowBackUp as Terug,
  IconNote as Notitie,
  IconUserPlus as KlantMaken,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  UITKOMSTEN,
  adresOmschrijving,
  foutTekst,
  korteDatum,
  leesPrijs,
  loopNummer,
  prijsTekst,
  uitkomstLabel,
  type LoopAdres,
  type LoopPatch,
  type Uitkomst,
} from "@/lib/lopen";
import { cn } from "@/lib/utils";

const KNOP_AAN: Record<Uitkomst, string> = {
  niet_thuis: "border-transparent bg-tint-amber text-tint-amber-ink",
  interesse: "border-transparent bg-tint-blauw text-tint-blauw-ink",
  ja: "border-transparent bg-tint-groen text-tint-groen-ink",
  nee: "border-transparent bg-tint-rood text-tint-rood-ink",
};

const PIL: Record<Uitkomst, string> = {
  niet_thuis: "bg-tint-amber text-tint-amber-ink",
  interesse: "bg-tint-blauw text-tint-blauw-ink",
  ja: "bg-tint-groen text-tint-groen-ink",
  nee: "bg-muted text-muted-foreground",
};

const NOTITIE_HINT =
  "Schrijf over het huis, niet over de bewoner. Niets over gezondheid, geloof of andere gevoelige zaken.";

interface Props {
  rij: LoopAdres;
  /** Bewaart en gooit bij een fout; de lijst zet de nieuwe stand alvast neer. */
  onBewaar: (id: string, patch: LoopPatch) => Promise<void>;
  /** Ja: eerst bewaren, dan het venster voor de nieuwe klant. */
  onJa: (rij: LoopAdres) => Promise<void>;
}

export const LoopAdresRij = memo(function LoopAdresRij({ rij, onBewaar, onJa }: Props) {
  const omschrijving = adresOmschrijving(rij);

  if (rij.klant_status) {
    return (
      <div className="flex min-h-[52px] items-center gap-3 rounded-[16px] bg-muted/50 px-3.5 py-2 text-muted-foreground">
        <span className="font-display text-[22px] font-semibold leading-none tabular-nums">
          {loopNummer(rij)}
        </span>
        {omschrijving && <span className="min-w-0 truncate text-[12px]">{omschrijving}</span>}
        <span className="ml-auto shrink-0 rounded-full bg-background/70 px-2.5 py-0.5 text-[11.5px] font-semibold">
          {rij.klant_status === "inactief" ? "inactief" : "klant"}
        </span>
      </div>
    );
  }

  return <OpenRij rij={rij} omschrijving={omschrijving} onBewaar={onBewaar} onJa={onJa} />;
});

function OpenRij({
  rij,
  omschrijving,
  onBewaar,
  onJa,
}: Props & {
  omschrijving: string;
}) {
  const [fout, setFout] = useState<{ melding: string; opnieuw?: () => void } | null>(null);
  const [prijs, setPrijs] = useState(prijsTekst(rij.prijs));
  const prijsBezig = useRef(false);
  const [notitieOpen, setNotitieOpen] = useState(false);
  const [notitie, setNotitie] = useState(rij.notitie);
  const notitieBezig = useRef(false);

  // Wat een collega intikte overnemen, maar niet terwijl jij zelf typt.
  useEffect(() => {
    if (!prijsBezig.current) setPrijs(prijsTekst(rij.prijs));
  }, [rij.prijs]);
  useEffect(() => {
    if (!notitieBezig.current) setNotitie(rij.notitie);
  }, [rij.notitie]);

  async function bewaar(patch: LoopPatch) {
    setFout(null);
    try {
      await onBewaar(rij.id, patch);
    } catch (e) {
      setFout({ melding: foutTekst(e), opnieuw: () => void bewaar(patch) });
    }
  }

  async function tik(u: Uitkomst) {
    if (u === "ja") {
      setFout(null);
      try {
        await onJa(rij);
      } catch (e) {
        setFout({ melding: foutTekst(e), opnieuw: () => void tik("ja") });
      }
      return;
    }
    if (rij.uitkomst === u) return;
    await bewaar({ uitkomst: u });
  }

  function prijsKlaar() {
    prijsBezig.current = false;
    const waarde = leesPrijs(prijs);
    if (waarde === undefined) {
      setFout({ melding: "Dit is geen bedrag. Typ bijvoorbeeld 14,50." });
      return;
    }
    if (waarde === rij.prijs) return;
    void bewaar({ prijs: waarde });
  }

  function notitieKlaar() {
    notitieBezig.current = false;
    if (notitie === rij.notitie) return;
    void bewaar({ notitie });
  }

  const nee = rij.uitkomst === "nee";
  const datum = korteDatum(rij.uitkomst_op);

  return (
    <div
      className={cn(
        "rounded-[16px] border border-border bg-card p-3 shadow-card",
        nee && "bg-muted/40 shadow-none",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-display text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
              nee && "text-muted-foreground",
            )}
          >
            {loopNummer(rij)}
          </div>
          {omschrijving && (
            <div className="mt-1 truncate text-[12px] text-muted-foreground">{omschrijving}</div>
          )}
        </div>
        {rij.uitkomst && (
          <span
            title={rij.uitkomst_door_naam ? `door ${rij.uitkomst_door_naam}` : undefined}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
              PIL[rij.uitkomst],
            )}
          >
            {uitkomstLabel(rij.uitkomst)}
            {datum && ` · ${datum}`}
          </span>
        )}
      </div>

      {nee ? (
        <div className="mt-2.5">
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => void bewaar({ uitkomst: null })}
          >
            <Terug className="size-4" /> Terugzetten
          </Button>
        </div>
      ) : (
        <div className="mt-2.5 grid grid-cols-4 gap-1.5" role="group" aria-label="Wat zeiden ze?">
          {UITKOMSTEN.map((u) => {
            const aan = rij.uitkomst === u.waarde;
            return (
              <button
                key={u.waarde}
                type="button"
                aria-pressed={aan}
                onClick={() => void tik(u.waarde)}
                className={cn(
                  "min-h-11 rounded-[12px] border border-border bg-background px-1 text-[13px] font-medium leading-tight transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  aan && KNOP_AAN[u.waarde],
                )}
              >
                {u.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex h-11 w-[116px] items-center gap-1.5 rounded-xl border border-input bg-background/70 px-3 text-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
          <span className="text-muted-foreground">€</span>
          <input
            inputMode="decimal"
            aria-label={`Prijs voor ${rij.straat} ${loopNummer(rij)}`}
            placeholder="prijs"
            value={prijs}
            onFocus={() => (prijsBezig.current = true)}
            onChange={(e) => setPrijs(e.target.value)}
            onBlur={prijsKlaar}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Button
          variant="ghost"
          className="h-11 rounded-full px-3"
          aria-expanded={notitieOpen}
          onClick={() => setNotitieOpen((o) => !o)}
        >
          <Notitie className="size-4" />
          {rij.notitie ? "Notitie" : "Notitie toevoegen"}
        </Button>
        {rij.uitkomst === "ja" && (
          <Button
            variant="outline"
            className="ml-auto h-11 rounded-full"
            onClick={() => void tik("ja")}
          >
            <KlantMaken className="size-4" /> Klant maken
          </Button>
        )}
      </div>

      {!notitieOpen && rij.notitie && (
        <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted-foreground">{rij.notitie}</p>
      )}

      {notitieOpen && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Textarea
            aria-label="Notitie"
            value={notitie}
            rows={2}
            maxLength={1000}
            onFocus={() => (notitieBezig.current = true)}
            onChange={(e) => setNotitie(e.target.value)}
            onBlur={notitieKlaar}
            className="rounded-xl text-[14px]"
          />
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
              {NOTITIE_HINT}
            </p>
            {(notitie || rij.notitie) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 shrink-0 rounded-full"
                // Niet eerst het veld laten loslaten: dan bewaart hij de oude tekst nog.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  notitieBezig.current = false;
                  setNotitie("");
                  void bewaar({ notitie: "" });
                }}
              >
                Notitie wissen
              </Button>
            )}
          </div>
        </div>
      )}

      {fout && (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-xl bg-tint-rood px-3 py-2 text-[12.5px] text-tint-rood-ink"
        >
          <span className="min-w-0 flex-1">{fout.melding}</span>
          {fout.opnieuw && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 rounded-full"
              onClick={fout.opnieuw}
            >
              Opnieuw
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
