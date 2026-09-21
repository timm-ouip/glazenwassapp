import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopupBlok } from "@/components/Popup";
import { useAuth } from "@/lib/auth";
import { rekening } from "@/lib/betalingen";
import { boek, haalVasteKortingWeg, maakVasteKorting, nieuweTik } from "@/lib/geldlopen";
import { formatPrice } from "@/lib/klanten";
import { fetchGeldAdres, soortLabel, type Gebeurtenis } from "@/lib/overzichten";

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

/**
 * Het geld van één adres: wat er open staat en waarvoor, elke betaling,
 * korting en poging aan de deur (met wie het intikte), en de vaste kortingen.
 * De eigenaar kan hier ook op kantoor een betaling of korting boeken, of iets
 * terugdraaien; niets wordt gewist.
 */
export function DossierGeld({ adresId }: { adresId: string }) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const geld = useQuery({
    queryKey: ["geld-adres", adresId],
    queryFn: () => fetchGeldAdres(adresId),
  });
  const [boeken, setBoeken] = useState<"betaald" | "korting" | "vast" | null>(null);
  const [bedrag, setBedrag] = useState("");
  const [reden, setReden] = useState("");
  const [bezig, setBezig] = useState(false);

  const vernieuw = () => {
    void qc.invalidateQueries({ queryKey: ["geld-adres", adresId] });
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

  async function draaiTerug(g: Gebeurtenis) {
    try {
      await boek(nieuweTik({ adres: adresId, soort: "ongedaan", herroept: g.id, bron: "kantoor" }));
      vernieuw();
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

  return (
    <>
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
          </div>
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
                  {soortLabel(e.soort)}
                  {e.bedrag > 0 && ` ${e.soort === "korting" ? "−" : ""}${formatPrice(e.bedrag)}`}
                  {e.reden && ` (${e.reden})`}
                  <span className="block text-[11.5px] text-muted-foreground no-underline">
                    {e.door_naam || "?"} · {moment(e.op)}
                    {e.bron === "kantoor" ? " · op kantoor" : e.bron === "dag" ? " · overdag" : ""}
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
    </>
  );
}
