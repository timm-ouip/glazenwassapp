/**
 * Eén adres als regel, voor de looplijst op de computer. Dezelfde vorm als
 * een regel op de Wijken-pagina: smal, alles naast elkaar, en een straat in
 * twee kolommen (even links, oneven rechts). Nummer met de woning eronder,
 * de vier knoppen, de prijs en een notitie. Alles bewaart meteen, net als de
 * kaart op de telefoon (useLoopRij).
 *
 * In het prijsvak staat het voorstel grijs voorgedrukt; het vinkje erachter
 * maakt er de prijs van. Een klantadres is een grijze regel.
 */
import { memo, useEffect, useRef } from "react";
import {
  IconArrowBackUp as Terug,
  IconCheck as Vink,
  IconUserPlus as KlantMaken,
} from "@tabler/icons-react";

import { TypeKiezer } from "@/components/lopen/LoopAdresRij";
import {
  KNOP_AAN,
  NOTITIE_HINT,
  UITKOMST_VLAK,
  useLoopRij,
  type LoopRijProps,
} from "@/components/lopen/useLoopRij";
import { formatPrice } from "@/lib/klanten";
import {
  UITKOMSTEN,
  adresOmschrijving,
  isBedrijf,
  korteDatum,
  loopNummer,
  prijsTekst,
  uitkomstLabel,
  voorstelUitleg,
  woningtypeVan,
} from "@/lib/lopen";
import { cn } from "@/lib/utils";

/** De breedtes van de kolommen; de kop boven een kolom gebruikt dezelfde. */
const NR = "w-[104px] shrink-0";
const UITKOMST = "w-[216px] shrink-0";
const PRIJS = "w-[94px] shrink-0";

/** De kleine kop boven een kolom regels, zoals op de Wijken-pagina. */
export function LoopKolomKop() {
  return (
    <div className="flex items-center gap-2 px-1.5 pb-0.5 text-[10.5px] font-medium text-muted-foreground/60">
      <span className={NR}>nr</span>
      <span className={UITKOMST}>wat zeiden ze?</span>
      <span className={PRIJS}>prijs</span>
      <span className="min-w-0 flex-1 truncate">notitie</span>
    </div>
  );
}

const REGEL = "flex items-center gap-2 rounded-[9px] px-1.5 py-[3px] text-[12.5px]";
const KLEIN_KNOPJE =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-border bg-background px-2 text-[11.5px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

export const LoopTabelRij = memo(function LoopTabelRij({
  rij,
  voorstel,
  onBewaar,
  onJa,
}: LoopRijProps) {
  if (rij.klant_status) {
    return (
      <div className={cn(REGEL, "min-h-9 text-muted-foreground")}>
        <span className={cn(NR, "font-display text-[15px] font-semibold tabular-nums")}>
          {loopNummer(rij)}
        </span>
        <span className="rounded-full bg-surface px-2 py-[1px] text-[10.5px] font-semibold">
          {rij.klant_status === "inactief" ? "inactief" : "klant"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px]">{adresOmschrijving(rij)}</span>
      </div>
    );
  }
  return <OpenRij rij={rij} voorstel={voorstel} onBewaar={onBewaar} onJa={onJa} />;
});

function OpenRij({ rij, voorstel, onBewaar, onJa }: LoopRijProps) {
  const {
    fout,
    bewaar,
    tik,
    prijs,
    setPrijs,
    prijsFocus,
    prijsKlaar,
    neemOver,
    notitie,
    setNotitie,
    notitieFocus,
    notitieKlaar,
  } = useLoopRij({ rij, onBewaar, onJa });

  // Een knop die na de klik verdwijnt ("Nee", "Terugzetten") neemt de focus
  // mee het niets in: daarna staat hij op wat ervoor in de plaats kwam.
  const regel = useRef<HTMLDivElement>(null);
  const focusStraks = useRef<string | null>(null);
  useEffect(() => {
    if (!focusStraks.current) return;
    const doel = regel.current?.querySelector<HTMLElement>(focusStraks.current);
    if (!doel) return;
    focusStraks.current = null;
    doel.focus();
  }, [rij.uitkomst]);

  const nee = rij.uitkomst === "nee";
  const datum = korteDatum(rij.uitkomst_op);
  const bedrijf = isBedrijf(rij);
  const toonVoorstel = !!voorstel && rij.prijs === null && prijs.trim() === "";
  const adres = `${rij.straat} ${loopNummer(rij)}`;
  const wanneer = [datum, rij.uitkomst_door_naam && `door ${rij.uitkomst_door_naam}`]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div ref={regel} className={cn(REGEL, "min-h-9 hover:bg-muted/70", nee && "bg-muted/40")}>
        <span className={cn(NR, "flex min-w-0 flex-col leading-tight")}>
          <span
            className={cn(
              "font-display text-[15px] font-semibold tabular-nums",
              nee && "text-muted-foreground",
            )}
          >
            {loopNummer(rij)}
          </span>
          <span
            className="truncate text-[10.5px] text-muted-foreground"
            title={adresOmschrijving(rij)}
          >
            {bedrijf ? (
              adresOmschrijving(rij)
            ) : (
              <TypeKiezer rij={rij} onKies={(t) => void bewaar({ woningtype_zelf: t })} />
            )}
          </span>
        </span>

        {nee ? (
          <span className={cn(UITKOMST, "flex items-center gap-1.5")}>
            <span
              className={cn(
                "rounded-full px-2 py-[1px] text-[10.5px] font-semibold",
                UITKOMST_VLAK.nee,
              )}
              title={wanneer || undefined}
            >
              {uitkomstLabel("nee")}
              {datum && ` · ${datum}`}
            </span>
            <button
              type="button"
              data-terugzetten
              className={KLEIN_KNOPJE}
              onClick={() => {
                focusStraks.current = '[role="group"] button';
                void bewaar({ uitkomst: null });
              }}
            >
              <Terug className="size-3.5" /> Terugzetten
            </button>
          </span>
        ) : (
          <span
            // "Niet thuis" en "Interesse" zijn langer dan "Ja" en "Nee".
            className={cn(UITKOMST, "grid grid-cols-[1.35fr_1.25fr_0.7fr_0.7fr] gap-1")}
            role="group"
            aria-label={`Wat zeiden ze op ${adres}?`}
          >
            {UITKOMSTEN.map((u) => {
              const aan = rij.uitkomst === u.waarde;
              return (
                <button
                  key={u.waarde}
                  type="button"
                  aria-pressed={aan}
                  title={aan ? wanneer || undefined : undefined}
                  onClick={() => {
                    if (u.waarde === "nee") focusStraks.current = "[data-terugzetten]";
                    void tik(u.waarde);
                  }}
                  className={cn(
                    "h-7 whitespace-nowrap rounded-[8px] border border-border bg-background px-0.5 text-[11.5px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    aan && KNOP_AAN[u.waarde],
                  )}
                >
                  {u.label}
                </button>
              );
            })}
          </span>
        )}

        <label
          className={cn(
            PRIJS,
            "flex h-7 items-center gap-1 rounded-[8px] border border-input bg-background/70 pl-2 pr-0.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
          )}
        >
          <span className="text-muted-foreground">€</span>
          <input
            inputMode="decimal"
            aria-label={`Prijs voor ${adres}`}
            placeholder={voorstel ? prijsTekst(voorstel.voorstel) : ""}
            value={prijs}
            onFocus={prijsFocus}
            onChange={(e) => setPrijs(e.target.value)}
            onBlur={prijsKlaar}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground/70"
          />
          {toonVoorstel && voorstel && (
            <button
              type="button"
              aria-label={`Voorstel ${formatPrice(voorstel.voorstel)} overnemen voor ${adres}`}
              title={`Voorstel overnemen · ${voorstelUitleg(voorstel, woningtypeVan(rij))}`}
              // Niet eerst het veld laten loslaten: dan bewaart hij "leeg".
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                neemOver(voorstel);
                // Het vinkje verdwijnt; verder in het prijsvak.
                regel.current?.querySelector<HTMLElement>("input")?.focus();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Vink className="size-3.5" />
            </button>
          )}
        </label>

        <input
          aria-label={`Notitie bij ${adres}`}
          title={NOTITIE_HINT}
          placeholder="notitie"
          maxLength={1000}
          // Een notitie van de telefoon kan regels hebben; hier is het één regel.
          value={notitie.replace(/\s*\n\s*/g, " ")}
          onFocus={notitieFocus}
          onChange={(e) => setNotitie(e.target.value)}
          onBlur={notitieKlaar}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="h-7 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-1.5 outline-none placeholder:text-muted-foreground/50 hover:border-input focus:border-ring focus:bg-background/70"
        />

        {rij.uitkomst === "ja" && (
          // Alleen het icoon: met tekst erbij past de regel niet in een kolom.
          <button
            type="button"
            aria-label={`Klant maken van ${adres}`}
            title="Klant maken"
            className={cn(KLEIN_KNOPJE, "w-7 justify-center px-0")}
            onClick={() => void tik("ja")}
          >
            <KlantMaken className="size-3.5" />
          </button>
        )}
      </div>

      {fout && (
        <div
          role="alert"
          className="mb-1 flex items-center gap-2 rounded-[9px] bg-tint-rood px-2.5 py-1.5 text-[12px] text-tint-rood-ink"
        >
          <span className="min-w-0 flex-1">{fout.melding}</span>
          {fout.opnieuw && (
            <button type="button" className={KLEIN_KNOPJE} onClick={fout.opnieuw}>
              Opnieuw
            </button>
          )}
        </div>
      )}
    </>
  );
}
