/**
 * Eén adres op de looplijst: het huisnummer groot, wat het voor pand is, de
 * vier knoppen voor wat er aan de deur gezegd is, een prijs en een notitie.
 *
 * Opslaan gaat meteen (de lijst zet de nieuwe stand alvast neer). Mislukt het,
 * dan blijft wat je invulde staan, met de fout en "Opnieuw".
 *
 * Een klantadres staat er grijs bij, met "klant" of "inactief", en zonder
 * knoppen of invulvakken: daar valt niets te lopen.
 *
 * Het woningtype is een schatting ("geschat") tot iemand het met een tik
 * verbetert; "Terug naar schatting" haalt die verbetering weer weg. Een
 * prijsvoorstel staat er alleen als grijze tekst, en wordt pas met "Neem
 * over" de prijs.
 */
import { memo, useEffect, useRef, useState } from "react";
import {
  IconArrowBackUp as Terug,
  IconCheck as Vink,
  IconChevronDown as Open,
  IconNote as Notitie,
  IconUserPlus as KlantMaken,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice } from "@/lib/klanten";
import {
  UITKOMSTEN,
  adresOmschrijving,
  foutTekst,
  isBedrijf,
  korteDatum,
  leesPrijs,
  loopNummer,
  prijsTekst,
  uitkomstLabel,
  voorstelUitleg,
  woningtypeTekst,
  woningtypeVan,
  type LoopAdres,
  type LoopPatch,
  type LoopVoorstel,
  type Uitkomst,
} from "@/lib/lopen";
import { cn } from "@/lib/utils";
import { WONINGTYPEN } from "@/lib/woningtype";

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
  /** Het prijsvoorstel voor dit adres, als er een is. */
  voorstel: LoopVoorstel | null;
  /** Bewaart en gooit bij een fout; de lijst zet de nieuwe stand alvast neer. */
  onBewaar: (id: string, patch: LoopPatch) => Promise<void>;
  /** Ja: eerst bewaren, dan het venster voor de nieuwe klant. */
  onJa: (rij: LoopAdres) => Promise<void>;
}

export const LoopAdresRij = memo(function LoopAdresRij({ rij, voorstel, onBewaar, onJa }: Props) {
  if (rij.klant_status) {
    const omschrijving = adresOmschrijving(rij);
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

  return <OpenRij rij={rij} voorstel={voorstel} onBewaar={onBewaar} onJa={onJa} />;
});

function OpenRij({ rij, voorstel, onBewaar, onJa }: Props) {
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
  const bedrijf = isBedrijf(rij);
  const omschrijving = adresOmschrijving(rij, { zonderType: !bedrijf });
  const toonVoorstel = !!voorstel && rij.prijs === null && prijs.trim() === "";

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
          {bedrijf ? (
            omschrijving && (
              <div className="mt-1 truncate text-[12px] text-muted-foreground">{omschrijving}</div>
            )
          ) : (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
              <TypeKiezer rij={rij} onKies={(t) => void bewaar({ woningtype_zelf: t })} />
              {omschrijving && (
                <>
                  <span>&nbsp;·&nbsp;</span>
                  <span className="min-w-0">{omschrijving}</span>
                </>
              )}
            </div>
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

      {toonVoorstel && voorstel && (
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
            voorstel {formatPrice(voorstel.voorstel)} ·{" "}
            {voorstelUitleg(voorstel, woningtypeVan(rij))}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-full"
            onClick={() => {
              setPrijs(prijsTekst(voorstel.voorstel));
              void bewaar({ prijs: voorstel.voorstel });
            }}
          >
            Neem over
          </Button>
        </div>
      )}

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

/**
 * Het woningtype als knop: een tik geeft de vijf typen en "Terug naar
 * schatting". Zonder type (nog niets geschat) staat er "type kiezen".
 */
function TypeKiezer({
  rij,
  onKies,
}: {
  rij: LoopAdres;
  onKies: (type: LoopAdres["woningtype_zelf"]) => void;
}) {
  const huidig = woningtypeVan(rij);
  const tekst = woningtypeTekst(rij) || "type kiezen";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Woningtype: ${tekst}. Tik om te verbeteren.`}
          className="-my-1 inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-md py-1 underline decoration-dotted underline-offset-[3px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tekst}
          <Open className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {WONINGTYPEN.map((t) => (
          <DropdownMenuItem
            key={t.waarde}
            className="min-h-10"
            onSelect={() => {
              if (rij.woningtype_zelf !== t.waarde) onKies(t.waarde);
            }}
          >
            <Vink className={cn("size-4", huidig === t.waarde ? "opacity-100" : "opacity-0")} />
            {t.label}
            {!rij.woningtype_zelf && rij.woningtype === t.waarde && (
              <span className="ml-auto text-xs text-muted-foreground">geschat</span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-10"
          disabled={!rij.woningtype_zelf}
          onSelect={() => onKies(null)}
        >
          <Terug className="size-4" /> Terug naar schatting
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
