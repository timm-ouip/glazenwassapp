import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopupBlok } from "@/components/Popup";
import { useBevestig } from "@/components/Bevestig";
import { VooruitDialoog } from "@/components/betalingen/DeurDialogen";
import { useAuth } from "@/lib/auth";
import {
  beurtenTekst,
  draaiBetaalwisselTerug,
  fetchLaatsteRonde,
  rekening,
  terugTekst,
  vooruitStart,
  vooruitTot,
} from "@/lib/betalingen";
import { boek, haalVasteKortingWeg, maakVasteKorting, nieuweTik } from "@/lib/geldlopen";
import { formatPrice, type Customer } from "@/lib/klanten";
import {
  fetchGeldAdres,
  soortLabel,
  vooruitOngedaanTekst,
  type Gebeurtenis,
} from "@/lib/overzichten";
import { useRecht } from "@/lib/rechten";

function leesBedrag(tekst: string): number | null {
  const n = Number(tekst.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function moment(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Een wissel die langer dan zoveel dagen geleden doorging, hoeft niet meer in beeld. */
const WISSEL_ZICHTBAAR_DAGEN = 30;

/** Wat er op één regel van de geschiedenis staat. */
function regelTekst(e: Gebeurtenis): string {
  if (e.soort === "vooruit" && e.aantal && e.prijs_per_beurt) {
    return `Vooruit · ${e.aantal} × ${formatPrice(e.prijs_per_beurt)} = ${formatPrice(e.bedrag)}`;
  }
  if (e.soort === "omgerekend" && e.prijs_per_beurt) {
    const tegoed = Math.round((e.bedrag - (e.aantal ?? 0) * e.prijs_per_beurt) * 100) / 100;
    return `Omgerekend naar nieuwe prijs · ${e.omgerekend_van ?? 0} → ${beurtenTekst(e.aantal ?? 0)} à ${formatPrice(e.prijs_per_beurt)}${tegoed > 0.005 ? ` (+ ${formatPrice(tegoed)} tegoed)` : ""}`;
  }
  const bedrag = e.bedrag > 0 ? ` ${e.soort === "korting" ? "−" : ""}${formatPrice(e.bedrag)}` : "";
  return `${soortLabel(e.soort)}${bedrag}${e.reden ? ` (${e.reden})` : ""}`;
}

/**
 * Het geld van één adres: wat er open staat en waarvoor, elke betaling,
 * korting en poging aan de deur (met wie het intikte), en de vaste kortingen.
 * De eigenaar kan hier ook op kantoor een betaling of korting boeken, of iets
 * terugdraaien; niets wordt gewist.
 *
 * Daarbij de vooruitbetaling: hoeveel beurten er nog over zijn, wat er terug
 * moet als de klant stopt, en de geplande wissel naar overmaken (geel, want
 * die gebeurt vanzelf — en dus met Ongedaan maken ernaast).
 */
export function DossierGeld({ adres }: { adres: Customer }) {
  const adresId = adres.id;
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const magWisselen = useRecht("klanten_bewerken");
  const geld = useQuery({
    queryKey: ["geld-adres", adresId],
    queryFn: () => fetchGeldAdres(adresId),
  });
  const bruikbaar = geld.data ? geld.data.vooruit_over - geld.data.vooruit_vast : 0;
  // Alleen nodig om te zeggen tot welke maand de beurten ongeveer reiken.
  const laatsteRonde = useQuery({
    queryKey: ["laatste-ronde", adresId],
    queryFn: () => fetchLaatsteRonde(adresId),
    enabled: bruikbaar > 0,
  });
  const [boeken, setBoeken] = useState<"betaald" | "korting" | "vast" | null>(null);
  const [vooruitOpen, setVooruitOpen] = useState(false);
  const [bedrag, setBedrag] = useState("");
  const [reden, setReden] = useState("");
  const [bezig, setBezig] = useState(false);

  const vernieuw = () => {
    void qc.invalidateQueries({ queryKey: ["geld-adres", adresId] });
    void qc.invalidateQueries({ queryKey: ["laatste-ronde", adresId] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
  };

  async function bewaar() {
    const waarde = leesBedrag(bedrag);
    if (!waarde) {
      toast.error("Vul een bedrag in.");
      return;
    }
    if ((boeken === "korting" || boeken === "vast") && !reden.trim()) {
      toast.error(boeken === "vast" ? "Geef de korting een naam." : "Zet erbij waarom.");
      return;
    }
    setBezig(true);
    try {
      if (boeken === "vast") {
        await maakVasteKorting(adresId, reden.trim().slice(0, 40), waarde);
      } else if (boeken) {
        await boek(
          nieuweTik({
            adres: adresId,
            soort: boeken,
            bedrag: waarde,
            reden: reden.trim(),
            bron: "kantoor",
          }),
        );
      }
      setBoeken(null);
      setBedrag("");
      setReden("");
      vernieuw();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function boekVooruit(aantal: number, prijs: number): Promise<boolean> {
    try {
      await boek(
        nieuweTik({
          adres: adresId,
          soort: "vooruit",
          aantal,
          prijs_per_beurt: prijs,
          bedrag: Math.round(aantal * prijs * 100) / 100,
          bron: "kantoor",
        }),
      );
      toast.success(`${beurtenTekst(aantal)} vooruit betaald`);
      vernieuw();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function draaiTerug(g: Gebeurtenis) {
    if (g.soort === "vooruit") {
      // Wat al gebruikt is, komt weer open te staan: dat moet de eigenaar
      // weten voordat hij klikt.
      const ja = await bevestig({
        titel: "Vooruitbetaling ongedaan maken?",
        tekst: vooruitOngedaanTekst(g),
        bevestigLabel: "Ongedaan maken",
      });
      if (!ja) return;
    }
    if (g.soort === "omgerekend") {
      const ja = await bevestig({
        titel: "Omrekenen ongedaan maken?",
        tekst: `Dan staan er weer ${beurtenTekst(g.omgerekend_van ?? 0)} vooruit betaald tegen de oude prijs, zoals vóór het omrekenen.`,
        bevestigLabel: "Ongedaan maken",
      });
      if (!ja) return;
    }
    try {
      await boek(nieuweTik({ adres: adresId, soort: "ongedaan", herroept: g.id, bron: "kantoor" }));
      vernieuw();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function geefTerug(terug: number) {
    setBezig(true);
    try {
      await boek(
        nieuweTik({ adres: adresId, soort: "terugbetaald", bedrag: terug, bron: "kantoor" }),
      );
      toast.success(`Teruggegeven: ${formatPrice(terug)}`);
      vernieuw();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function wisselTerug() {
    try {
      await draaiBetaalwisselTerug(adresId);
      toast.success("De wissel naar overmaken is teruggedraaid");
      vernieuw();
      void qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function haalWeg(id: string) {
    try {
      await haalVasteKortingWeg(id);
      vernieuw();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (geld.isLoading) return <p className="text-[13px] text-muted-foreground">Laden…</p>;
  if (geld.isError)
    return <p className="text-[13px] text-tint-rood-ink">{(geld.error as Error).message}</p>;
  const g = geld.data!;
  const regels = rekening(g.delen);
  const gestopt = !!adres.inactief_op;
  // Terug te geven: beurten die niet meer gebruikt worden, of bij een
  // gestopt adres wat er aan tegoed over is.
  const terugTonen = g.vooruit_vast > 0 || (gestopt && g.terug > 0.005);
  const wissel = g.wissel;
  const wisselTonen =
    !!wissel &&
    !gestopt &&
    (wissel.status === "gepland" ||
      (!!wissel.uitgevoerd_op &&
        Date.now() - Date.parse(wissel.uitgevoerd_op) < WISSEL_ZICHTBAAR_DAGEN * 86_400_000));

  return (
    <>
      {wisselTonen && wissel && (
        <div className="flex items-start gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
          <span className="min-w-0 flex-1">
            {wissel.status === "gepland"
              ? `Gaat overmaken zodra de vooruitbetaling op is (nog ${beurtenTekst(bruikbaar)}).`
              : `Op ${new Date(wissel.uitgevoerd_op!).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "short",
                })} overgezet naar overmaken: vooruitbetaling op.`}
          </span>
          {magWisselen && (
            <button
              type="button"
              className="shrink-0 font-medium underline-offset-2 hover:underline"
              onClick={() => void wisselTerug()}
            >
              Ongedaan maken
            </button>
          )}
        </div>
      )}

      <PopupBlok label="Staat open">
        <div className="rounded-[14px] bg-surface px-3.5 py-2.5">
          {regels.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {g.open < -0.005 ? `Tegoed: ${formatPrice(-g.open)}.` : "Er staat niets open."}
            </p>
          ) : (
            <>
              {regels.map((r, i) => (
                <div key={i} className="flex items-baseline gap-3 py-0.5 text-[13.5px]">
                  <span className="min-w-0 flex-1">
                    {r.label} <span className="text-[12px] text-muted-foreground">{r.wanneer}</span>
                    {r.uitleg && (
                      <span className="block text-[12px] text-muted-foreground">{r.uitleg}</span>
                    )}
                  </span>
                  <span className="tabular-nums">{formatPrice(r.bedrag)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-border pt-1.5 text-[14px] font-semibold">
                <span>Totaal</span>
                <span className="tabular-nums">{formatPrice(g.open)}</span>
              </div>
            </>
          )}
        </div>
        {bruikbaar > 0 && (
          <p className="rounded-[14px] bg-tint-groen px-3.5 py-2 text-[13px] text-tint-groen-ink">
            Nog {beurtenTekst(bruikbaar)} vooruit betaald, t/m ongeveer{" "}
            {vooruitTot(adres, bruikbaar, vooruitStart(laatsteRonde.data))}.
          </p>
        )}
        {terugTonen && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-tint-amber px-3.5 py-2.5 text-[13px] text-tint-amber-ink">
            <span className="min-w-0 flex-1">
              Terug te geven:{" "}
              {terugTekst({
                vorige: g.vooruit_vorige,
                vorigeWaarde: g.vooruit_vorige_waarde,
                eigen: g.vooruit_eigen,
                eigenWaarde: g.vooruit_eigen_waarde,
                open: g.open,
                gestopt,
              })}
            </span>
            {isEigenaar && (
              <Button
                size="sm"
                className="rounded-full"
                disabled={bezig}
                onClick={() => void geefTerug(g.terug)}
              >
                Teruggegeven
              </Button>
            )}
          </div>
        )}
        {isEigenaar && (
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["betaald", "Betaling boeken"],
                ["korting", "Korting of kwijtschelden"],
                ["vast", "Vaste korting"],
              ] as const
            ).map(([soort, label]) => (
              <button
                key={soort}
                type="button"
                onClick={() => setBoeken(boeken === soort ? null : soort)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  boeken === soort
                    ? "border-transparent bg-tint-amber text-tint-amber-ink"
                    : "border-border bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              disabled={gestopt || g.vooruit_vast > 0}
              title={
                gestopt
                  ? "Dit adres is gestopt"
                  : g.vooruit_vast > 0
                      ? "Geef eerst de vooruitbetaalde beurten van de vorige bewoner terug"
                      : undefined
              }
              onClick={() => setVooruitOpen(true)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Vooruit betalen
            </button>
          </div>
        )}
        {isEigenaar && !gestopt && g.vooruit_vast > 0 && (
          <p className="text-[12px] text-muted-foreground">
            Vooruit betalen kan weer als de beurten van de vorige bewoner zijn teruggegeven.
          </p>
        )}
        {boeken && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              inputMode="decimal"
              className="w-28 rounded-full"
              placeholder="€ 0"
              value={bedrag}
              onChange={(e) => setBedrag(e.target.value)}
            />
            {boeken !== "betaald" && (
              <Input
                className="min-w-0 flex-1 rounded-full"
                placeholder={boeken === "vast" ? "Naam, bijv. Horren" : "Waarom?"}
                maxLength={boeken === "vast" ? 40 : 200}
                value={reden}
                onChange={(e) => setReden(e.target.value)}
              />
            )}
            <Button
              size="sm"
              className="rounded-full"
              disabled={bezig}
              onClick={() => void bewaar()}
            >
              Opslaan
            </Button>
          </div>
        )}
      </PopupBlok>

      {g.vaste_kortingen.length > 0 && (
        <PopupBlok label="Vaste kortingen">
          <div className="divide-y divide-border/70 rounded-[14px] border border-border">
            {g.vaste_kortingen.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  {k.naam} −{formatPrice(k.bedrag)}
                  <span className="block text-[11.5px] text-muted-foreground">
                    {k.door_naam} · {moment(k.op)}
                  </span>
                </span>
                {isEigenaar && (
                  <button
                    type="button"
                    className="text-[12.5px] font-medium underline-offset-2 hover:underline"
                    onClick={() => void haalWeg(k.id)}
                  >
                    Weghalen
                  </button>
                )}
              </div>
            ))}
          </div>
        </PopupBlok>
      )}

      <PopupBlok label="Geschiedenis">
        {g.gebeurtenissen.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nog niets gebeurd.</p>
        ) : (
          <div className="divide-y divide-border/70 rounded-[14px] border border-border">
            {g.gebeurtenissen.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-3 py-2 text-[13px]">
                <span className={`min-w-0 flex-1 ${e.ongedaan ? "line-through opacity-60" : ""}`}>
                  {regelTekst(e)}
                  {/* Tikte de loper een andere prijs per beurt dan de gewone?
                      Dan ziet de eigenaar dat hier, en kan hij het rechtzetten. */}
                  {e.soort === "vooruit" && e.prijs_verwacht != null && !e.ongedaan && (
                    <span className="ml-1.5 rounded-full bg-tint-amber px-1.5 text-[11px] text-tint-amber-ink">
                      gewone prijs {formatPrice(e.prijs_verwacht)}
                    </span>
                  )}
                  <span className="block text-[11.5px] text-muted-foreground no-underline">
                    {e.door_naam || "?"} · {moment(e.op)}
                    {e.bron === "kantoor" ? " · op kantoor" : e.bron === "dag" ? " · overdag" : ""}
                    {e.soort === "vooruit" &&
                      !e.ongedaan &&
                      ` · ${e.gebruikt ?? 0} van de ${e.aantal ?? 0} gebruikt`}
                    {e.ongedaan && ` · teruggedraaid door ${e.ongedaan.door_naam}`}
                  </span>
                </span>
                {isEigenaar && !e.ongedaan && e.soort !== "beginstand" && (
                  <button
                    type="button"
                    className="shrink-0 text-[12.5px] font-medium underline-offset-2 hover:underline"
                    onClick={() => void draaiTerug(e)}
                  >
                    Ongedaan
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </PopupBlok>

      {/* Zonder gewone prijs vult de eigenaar de prijs per beurt zelf in. */}
      {isEigenaar && (
        <VooruitDialoog
          open={vooruitOpen}
          subtitel={g.open > 0.005 ? `Op kantoor · nog open ${formatPrice(g.open)}` : "Op kantoor"}
          delen={g.delen}
          prijs={g.vooruit_p}
          prijsAanpassen
          onSluit={() => setVooruitOpen(false)}
          onVooruit={boekVooruit}
        />
      )}
    </>
  );
}
