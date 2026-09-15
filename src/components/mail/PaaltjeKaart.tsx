/**
 * Wat Paaltje van een mail vindt, boven de mail zelf.
 *
 * De samenvatting en de categorieën, en daaronder wat er voor jou klaarstaat:
 * een antwoord, een voorstel, een klant die hij denkt te herkennen. Elke knop
 * doet één ding, en wat Paaltje al zelf deed staat erbij — met de weg naar het
 * rapport om het terug te draaien.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { adresNamen, klantenMetAdressen, type Bericht } from "@/lib/berichten";
import {
  handelAf,
  koppelKlant,
  laatOpnieuwLezen,
  overslaanDoorvoeren,
  stoppenDoorvoeren,
  stoppenPlanning,
} from "@/lib/mailacties";
import { StopDialog } from "@/components/StopDialog";
import { categorieTint, fetchCategorieen, zetCategorieen, type MailCategorie } from "@/lib/paaltje";
import { toonMaand } from "@/lib/klanten";
import { vandaag } from "@/lib/wasdag";
import { useRecht } from "@/lib/rechten";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function PaaltjeKaart({
  b,
  kanSchrijven,
  onBeantwoord,
}: {
  b: Bericht;
  kanSchrijven: boolean;
  /** Het concept van Paaltje als begin van het antwoord. */
  onBeantwoord: (begin: string) => void;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const categorieen = useQuery({ queryKey: ["mail-categorieen"], queryFn: fetchCategorieen });
  const [bezig, setBezig] = useState<string | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const prijzenZien = useRecht("prijzen_zien");
  const stopNamen = useQuery({
    queryKey: ["adres-namen", b.voorstel.stoppen?.adressen ?? []],
    queryFn: () => adresNamen(b.voorstel.stoppen?.adressen ?? []),
    enabled: stopOpen,
  });

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["bericht", b.id] });
    void qc.invalidateQueries({ queryKey: ["berichten"] });
    void qc.invalidateQueries({ queryKey: ["mail-wacht"] });
  };

  async function doe(naam: string, actie: () => Promise<unknown>, gelukt?: string) {
    setBezig(naam);
    try {
      await actie();
      if (gelukt) toast.success(gelukt);
      ververs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(null);
    }
  }

  if (b.richting !== "in" || b.paaltje_status === "overslaan") return null;

  const kader = "mx-5 mt-3 rounded-[14px] border border-tint-paars-ink/15 bg-tint-paars/60 px-3.5 py-3 text-[13px]";

  if (b.paaltje_status === "wacht" || b.paaltje_status === "bezig") {
    return (
      <div className={cn(kader, "flex items-center gap-2 text-tint-paars-ink")}>
        <Loader2 className="size-3.5 animate-spin" /> Paaltje leest deze mail zo…
      </div>
    );
  }

  if (b.paaltje_status === "fout") {
    return (
      <div className={cn(kader, "flex flex-wrap items-center gap-2")}>
        <span className="text-tint-paars-ink">Paaltje kon deze mail niet lezen{b.ai_fout ? `: ${b.ai_fout}` : "."}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-full"
          disabled={!kanSchrijven || bezig !== null}
          onClick={() => void doe("lezen", () => laatOpnieuwLezen(b.id), "Paaltje leest hem zo opnieuw.")}
        >
          <RefreshCw className="size-3" /> Opnieuw proberen
        </Button>
      </div>
    );
  }

  if (b.is_klantmail === false) {
    return (
      <div className={cn(kader, "flex flex-wrap items-center gap-2 text-tint-paars-ink")}>
        <Sparkles className="size-3.5" />
        <span>Geen klantmail{b.samenvatting ? `: ${b.samenvatting}` : ""}. Staat in Overige post.</span>
        <button
          type="button"
          className="ml-auto text-[12px] underline-offset-2 hover:underline disabled:opacity-50"
          disabled={!kanSchrijven || bezig !== null}
          onClick={() => void doe("lezen", () => laatOpnieuwLezen(b.id), "Paaltje leest hem zo opnieuw.")}
        >
          Toch klantmail? Opnieuw lezen
        </button>
      </div>
    );
  }

  const lijst = categorieen.data ?? [];
  const mijnCategorieen = b.categorie_ids
    .map((id) => lijst.findIndex((c) => c.id === id))
    .filter((i) => i >= 0)
    .map((i) => ({ c: lijst[i]!, i }));
  const o = b.voorstel.overslaan;

  return (
    <div className={cn(kader, "space-y-2.5")}>
      <div className="flex flex-wrap items-start gap-2">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-tint-paars-ink" />
        <p className="min-w-0 flex-1 text-tint-paars-ink">
          {b.samenvatting || "Paaltje las deze mail."}
          {b.zekerheid !== null && (
            <span className="ml-1.5 text-[11.5px] opacity-70">{Math.round(b.zekerheid * 100)}% zeker</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {mijnCategorieen.map(({ c, i }) => (
          <span key={c.id} className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", categorieTint(c, i))}>
            {c.naam}
          </span>
        ))}
        <CategorieKiezer
          alle={lijst}
          gekozen={b.categorie_ids}
          uit={!kanSchrijven}
          onBewaar={(ids) => doe("categorie", () => zetCategorieen(b.id, ids), "Categorie aangepast.")}
        />
      </div>

      {!b.klant_id && b.klant_gok_id && (
        <KlantGok
          klantId={b.klant_gok_id}
          email={b.van_email}
          uit={!kanSchrijven || bezig !== null}
          onKoppel={(naam) =>
            doe(
              "klant",
              async () => {
                await koppelKlant(b.id, b.klant_gok_id!);
                await qc.invalidateQueries({ queryKey: ["klant-bij-email"] });
              },
              `${b.van_email} hoort nu bij ${naam}. Paaltje leest de mail opnieuw.`,
            )
          }
        />
      )}

      {o && (
        <Regel>
          {o.doorgevoerd ? (
            <>
              <CircleCheck className="size-3.5 text-tint-groen-ink" />
              <span>
                {b.doorgevoerd_automatisch ? "Paaltje zette" : "Op overslaan gezet:"}{" "}
                {o.maanden.map((m) => toonMaand(m)).join(", ")} ({o.adressen.length}{" "}
                {o.adressen.length === 1 ? "adres" : "adressen"}).
              </span>
              <Link to="/mailing" className="text-[12px] underline-offset-2 hover:underline">
                Terugdraaien kan in Rapport
              </Link>
            </>
          ) : (
            <>
              <Wand2 className="size-3.5 text-tint-paars-ink" />
              <span>
                Overslaan: {o.maanden.map((m) => toonMaand(m)).join(", ")} voor {o.adressen.length}{" "}
                {o.adressen.length === 1 ? "adres" : "adressen"}.
              </span>
              <Button
                size="sm"
                className="h-7 rounded-full"
                disabled={!kanSchrijven || bezig !== null}
                onClick={() =>
                  void doe("overslaan", () => overslaanDoorvoeren(b.id), "In de planning gezet.")
                }
              >
                {bezig === "overslaan" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                Doorvoeren
              </Button>
            </>
          )}
        </Regel>
      )}

      {b.voorstel.bevestiging_fout && !b.afgehandeld_op && (
        <Regel>
          <AlertTriangle className="size-3.5 text-tint-amber-ink" />
          <span>Bevestiging niet zelf verstuurd: {b.voorstel.bevestiging_fout}</span>
        </Regel>
      )}
      {b.voorstel.stoppen && (
        <Regel>
          {b.voorstel.stoppen.doorgevoerd ? (
            <>
              <CircleCheck className="size-3.5 text-tint-groen-ink" />
              <span>
                Gestopt: {b.voorstel.stoppen.adressen.length}{" "}
                {b.voorstel.stoppen.adressen.length === 1 ? "adres staat" : "adressen staan"} bij Inactief.
              </span>
              <span className="text-[12px]">Terugdraaien kan in Rapport</span>
            </>
          ) : (
            <>
              <Wand2 className="size-3.5 text-tint-oranje-ink" />
              <span>
                Wil stoppen ({b.voorstel.stoppen.adressen.length}{" "}
                {b.voorstel.stoppen.adressen.length === 1 ? "adres" : "adressen"}).
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full"
                disabled={!kanSchrijven || bezig !== null}
                onClick={() => setStopOpen(true)}
              >
                {bezig === "stoppen" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                Klant laten stoppen
              </Button>
              <StopDialog
                open={stopOpen}
                onOpenChange={setStopOpen}
                titel="Klant stopt"
                omschrijving={stopNamen.data?.join(", ") ?? ""}
                telDagen={() => stoppenPlanning(b.id)}
                onBevestig={async (reden, planningWeg) => {
                  setBezig("stoppen");
                  try {
                    await stoppenDoorvoeren(b.id, reden, planningWeg);
                    toast.success("De klant staat nu bij Inactief. Terugdraaien kan in Rapport.");
                    ververs();
                    void qc.invalidateQueries({ queryKey: ["customers"] });
                    void qc.invalidateQueries({ queryKey: ["customers-inactief"] });
                    void qc.invalidateQueries({ queryKey: ["klanten"] });
                    void qc.invalidateQueries({ queryKey: ["prullenbak"] });
                  } finally {
                    setBezig(null);
                  }
                }}
              />
            </>
          )}
        </Regel>
      )}

      {b.voorstel.aanmelding_id && (
        <Regel>
          <CircleCheck className="size-3.5 text-tint-groen-ink" />
          <span>Paaltje zette een aanmelding klaar met de gegevens uit deze mail.</span>
          <Link to="/aanmeldingen" className="text-[12px] underline-offset-2 hover:underline">
            Naar aanmeldingen
          </Link>
        </Regel>
      )}

      {/* Paaltjes prijsvergelijking alleen voor wie prijzen mag zien. */}
      {b.voorstel.prijs && prijzenZien && (
        <Regel>
          <span className="text-[12px]">
            {b.voorstel.prijs.eigen?.length
              ? `Eigen prijs: ${b.voorstel.prijs.eigen.map((p) => `${p.adres} €${p.prijs}`).join(", ")}`
              : b.voorstel.prijs.richtprijzen?.length
                ? `Richtprijs per wijk: ${b.voorstel.prijs.richtprijzen.map((p) => `${p.wijk} €${p.prijs}`).join(", ")}`
                : "Geen prijzen om mee te vergelijken."}
          </span>
        </Regel>
      )}

      {b.concept && !b.beantwoord_op && (
        <div className="rounded-[12px] border border-border bg-card p-3">
          <p className="line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed">{b.concept}</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" className="rounded-full" disabled={!kanSchrijven} onClick={() => onBeantwoord(b.concept)}>
              <Pencil className="size-3.5" /> Bekijken en versturen
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[12px] text-tint-paars-ink">
        {b.beantwoord_op ? (
          <span className="flex items-center gap-1">
            <CircleCheck className="size-3.5" /> Beantwoord
          </span>
        ) : b.afgehandeld_op ? (
          <button
            type="button"
            className="underline-offset-2 hover:underline disabled:opacity-50"
            disabled={!kanSchrijven || bezig !== null}
            onClick={() => void doe("af", () => handelAf(b.id, false))}
          >
            Afgehandeld — weer openzetten
          </button>
        ) : (
          <button
            type="button"
            className="underline-offset-2 hover:underline disabled:opacity-50"
            disabled={!kanSchrijven || bezig !== null}
            onClick={() => void doe("af", () => handelAf(b.id, true), "Afgehandeld.")}
          >
            Klaar, hier hoeft niets mee
          </button>
        )}
        <button
          type="button"
          className="ml-auto underline-offset-2 hover:underline disabled:opacity-50"
          disabled={!kanSchrijven || bezig !== null}
          onClick={() => void doe("lezen", () => laatOpnieuwLezen(b.id), "Paaltje leest hem zo opnieuw.")}
        >
          Opnieuw laten lezen
        </button>
      </div>
    </div>
  );
}

function Regel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-tint-paars-ink">{children}</div>;
}

function KlantGok({
  klantId,
  email,
  uit,
  onKoppel,
}: {
  klantId: string;
  email: string;
  uit: boolean;
  onKoppel: (naam: string) => void;
}) {
  const klant = useQuery({
    queryKey: ["klant-gok", klantId],
    queryFn: () => klantenMetAdressen([klantId], vandaag()),
  });
  const k = klant.data?.[0];
  if (!k) return null;
  return (
    <Regel>
      <UserRound className="size-3.5" />
      <span>
        Paaltje denkt dat dit <strong>{k.naam}</strong> is{k.straat ? ` (${k.straat} ${k.huisnummer})` : ""}.
      </span>
      <Button size="sm" variant="outline" className="h-7 rounded-full" disabled={uit} onClick={() => onKoppel(k.naam)}>
        Ja, {email} hoort bij {k.naam.split(" ")[0]}
      </Button>
    </Regel>
  );
}

function CategorieKiezer({
  alle,
  gekozen,
  uit,
  onBewaar,
}: {
  alle: MailCategorie[];
  gekozen: string[];
  uit: boolean;
  onBewaar: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [keuze, setKeuze] = useState<string[]>(gekozen);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setKeuze(gekozen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={uit}
          className="rounded-full border border-dashed border-tint-paars-ink/30 px-2 py-0.5 text-[11.5px] text-tint-paars-ink hover:bg-card/60 disabled:opacity-50"
        >
          {gekozen.length ? "Aanpassen" : "Categorie kiezen"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex flex-col gap-0.5">
          {alle.map((c) => {
            const aan = keuze.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setKeuze(aan ? keuze.filter((x) => x !== c.id) : [...keuze, c.id])}
                className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border",
                    aan ? "border-foreground bg-foreground text-background" : "border-border",
                  )}
                >
                  {aan && <Check className="size-3" />}
                </span>
                {c.naam}
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          className="mt-2 w-full rounded-full"
          onClick={() => {
            setOpen(false);
            void onBewaar(keuze);
          }}
        >
          Bewaren
        </Button>
      </PopoverContent>
    </Popover>
  );
}
