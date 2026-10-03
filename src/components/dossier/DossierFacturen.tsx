/**
 * Tabblad "Facturen" van het klantdossier. Links hoe deze klant een factuur
 * krijgt (voor elke klant, niet alleen zakelijk), meteen bewaard; rechts de
 * facturen die hij al kreeg. Een tik op een factuur klapt hem open zoals in
 * de facturenlijst, met dezelfde knoppen.
 *
 * Rechten: de instellingen zien met klanten_bekijken, wijzigen met
 * klanten_bewerken; de lijst en een losse factuur alleen met facturen.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { FactuurDetail } from "@/components/betalingen/FacturenLijst";
import { DossierKop, kopKnop } from "@/components/dossier/DossierKop";
import {
  DossierKaart,
  DossierVeld,
  KaartLabel,
  KolomKop,
  VeldLabel,
  dossierInvoer,
} from "@/components/dossier/DossierVelden";
import { LosseFactuurDialog } from "@/components/facturen/LosseFactuurDialog";
import { Pillen } from "@/components/Pillen";
import { Button } from "@/components/ui/button";
import { fetchKlantIbans, ibanTonen, klantIbanWeghalen } from "@/lib/bank";
import { korteDatum, regelDatum } from "@/lib/dossier";
import {
  BTW_TARIEVEN,
  exclusiefVoorop,
  factuurStand,
  fetchFactuurOver,
  fetchFacturen,
  fetchFactuurStandaard,
  fetchTegoed,
  tegoedVereffenen,
  type Factuur,
  type TegoedRegel,
} from "@/lib/facturen";
import { FACTUUR_PER, formatPrice } from "@/lib/klanten";
import { useRecht } from "@/lib/rechten";
import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";

/** De kolommen van de lijst, zodra de kaart er breed genoeg voor is. */
const KOLOMMEN = "@[34rem]:grid-cols-[120px_110px_minmax(0,1fr)_110px_120px]";

/** Verborgen opschrift: de adresvelden delen één zichtbaar label. */
const stil = (tekst: string) => <span className="sr-only">{tekst}</span>;

export function DossierFacturen({ d }: { d: Dossier }) {
  const magFacturen = useRecht("facturen");
  const [losOpen, setLosOpen] = useState(false);
  const qc = useQueryClient();

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["facturen"] });
    void qc.invalidateQueries({ queryKey: ["tegoed"] });
    void qc.invalidateQueries({ queryKey: ["bank"] });
    void qc.invalidateQueries({ queryKey: ["factuur-over"] });
    void qc.invalidateQueries({ queryKey: ["factuurregels-los"] });
    void qc.invalidateQueries({ queryKey: ["herinneringen-straks"] });
  }

  return (
    <>
      <DossierKop
        d={d}
        titel="Facturen"
        acties={
          magFacturen ? (
            <button
              type="button"
              className={cn(kopKnop, "px-[18px]")}
              disabled={!d.klantId}
              title={d.klantId ? undefined : "Vul eerst de gegevens van de klant in"}
              onClick={() => setLosOpen(true)}
            >
              Losse factuur maken…
            </button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className={cn(
            "grid grid-cols-1 gap-[18px] lg:min-h-full lg:grid-cols-[420px_minmax(0,1fr)]",
            d.mobiel ? "px-4 py-4" : "px-[26px] py-[22px]",
          )}
        >
          <div className="flex flex-col gap-[14px]">
            <HoeFactureren d={d} />
            {magFacturen && d.klantId && <TegoedKaart klantId={d.klantId} onVeranderd={ververs} />}
            {magFacturen && d.klantId && <BetaaltVanaf klantId={d.klantId} />}
          </div>
          <FacturenVanKlant d={d} magFacturen={magFacturen} onVeranderd={ververs} />
        </div>
      </div>
      {magFacturen && (
        <LosseFactuurDialog
          open={losOpen}
          onOpenChange={setLosOpen}
          onKlaar={ververs}
          klantId={d.klantId}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tegoed
// ---------------------------------------------------------------------------

/** Wat een regel in het tegoed betekent, in de woorden van het scherm. */
function tegoedTekst(r: TegoedRegel): string {
  const nr = r.nummer ?? "";
  switch (r.soort) {
    case "te_veel":
      return `Te veel betaald op ${nr}`;
    case "gecrediteerd":
      return `Al betaald op ${nr}, daarna gecrediteerd`;
    case "verrekend":
      return `Verrekend op ${nr}`;
    case "vereffend":
      return "Vereffend" + (r.opmerking ? `: ${r.opmerking}` : "");
  }
}

/**
 * Het tegoed van deze klant: wat hij te veel betaalde, of al betaald had op
 * een factuur die gecrediteerd is. Het gaat vanzelf af van de volgende
 * factuur. Alleen zichtbaar als er ooit iets met tegoed gebeurd is.
 */
function TegoedKaart({ klantId, onVeranderd }: { klantId: string; onVeranderd: () => void }) {
  const tegoed = useQuery({
    queryKey: ["tegoed", klantId],
    queryFn: () => fetchTegoed(klantId),
  });
  // De opmerking bij het vereffenen; null = het vakje is dicht.
  const [opmerking, setOpmerking] = useState<string | null>(null);
  const vereffenen = useMutation({
    mutationFn: () => tegoedVereffenen(klantId, opmerking ?? ""),
    onSuccess: (bedrag) => {
      setOpmerking(null);
      onVeranderd();
      toast.success(`${formatPrice(Math.abs(bedrag))} vereffend. Het tegoed staat op nul.`);
    },
    onError: (e: Error) => toast.error("Vereffenen mislukt: " + e.message),
  });

  if (tegoed.isError) {
    return (
      <DossierKaart>
        <KolomKop>Tegoed</KolomKop>
        <p className="text-[14px] text-tint-rood-ink">Het tegoed kon niet opgehaald worden.</p>
      </DossierKaart>
    );
  }
  const t = tegoed.data;
  if (!t || t.regels.length === 0) return null;
  const saldo = t.saldo;
  const iets = Math.abs(saldo) >= 0.005;

  return (
    <DossierKaart>
      <KolomKop>Tegoed</KolomKop>
      <div className="flex flex-col">
        <div className="font-display text-[30px] font-semibold leading-tight tabular-nums">
          {formatPrice(saldo)}
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {saldo > 0.005
            ? "Gaat vanzelf af van de volgende factuur, als “reeds betaald”."
            : saldo < -0.005
              ? "Er is meer verrekend dan er nu binnen is, bijvoorbeeld door een terugboeking. Vereffen het als het geregeld is."
              : "Niets te goed."}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {t.regels.map((r, i) => (
          <div key={i} className="flex gap-3 text-[12.5px]">
            <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
              {r.datum ? regelDatum(r.datum) : ""}
            </span>
            <span className="min-w-0 flex-1">
              {tegoedTekst(r)}
              {r.door && <span className="text-muted-foreground"> · {r.door}</span>}
            </span>
            <span className="shrink-0 tabular-nums">
              {r.bedrag > 0 ? "+" : "−"}
              {formatPrice(Math.abs(r.bedrag))}
            </span>
          </div>
        ))}
      </div>
      {iets &&
        (opmerking === null ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => setOpmerking("")}
          >
            Tegoed vereffend…
          </Button>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              vereffenen.mutate();
            }}
          >
            <VeldLabel label="Hoe is het geregeld? (bijvoorbeeld: teruggestort)">
              <input
                className={dossierInvoer}
                value={opmerking}
                maxLength={300}
                autoFocus
                onChange={(e) => setOpmerking(e.target.value)}
              />
            </VeldLabel>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="secondary" disabled={vereffenen.isPending}>
                {vereffenen.isPending ? "Bezig…" : `${formatPrice(Math.abs(saldo))} vereffenen`}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpmerking(null)}>
                Annuleren
              </Button>
            </div>
          </form>
        ))}
    </DossierKaart>
  );
}

// ---------------------------------------------------------------------------
// Betaalt vanaf
// ---------------------------------------------------------------------------

/**
 * De rekeningen waarvan deze klant betaalt. De app leert ze bij het inlezen
 * van bankbestanden, zodra er een betaling op een factuur van deze klant
 * geboekt is; daarna herkent hij een overmaking van die rekening ook zonder
 * factuurnummer. Weghalen kan hier, toevoegen niet: dat gaat alleen via een
 * echte betaling. Gaat de klant in de prullenbak, dan gaan ze vanzelf mee.
 */
function BetaaltVanaf({ klantId }: { klantId: string }) {
  const qc = useQueryClient();
  const ibans = useQuery({
    queryKey: ["bank", "ibans", klantId],
    queryFn: () => fetchKlantIbans(klantId),
  });
  const weghalen = useMutation({
    mutationFn: (iban: string) => klantIbanWeghalen(klantId, iban),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bank", "ibans", klantId] });
      toast.success("Rekening vergeten.");
    },
    onError: (e: Error) => toast.error("Weghalen mislukt: " + e.message),
  });

  if (ibans.isError) {
    return (
      <DossierKaart>
        <KolomKop>Betaalt vanaf</KolomKop>
        <p className="text-[14px] text-tint-rood-ink">
          De rekeningen konden niet opgehaald worden.
        </p>
      </DossierKaart>
    );
  }
  const lijst = ibans.data ?? [];
  if (lijst.length === 0) return null;

  return (
    <DossierKaart>
      <KolomKop>Betaalt vanaf</KolomKop>
      <p className="text-[12.5px] text-muted-foreground">
        Een overmaking van deze rekening komt bij het inlezen van de bank vanzelf bij deze klant,
        als het bedrag op een openstaande factuur past.
      </p>
      <div className="flex flex-col gap-1">
        {lijst.map((r) => (
          <div key={r.iban} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 tabular-nums">{ibanTonen(r.iban)}</span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              sinds {regelDatum(r.sinds)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={weghalen.isPending}
              onClick={() => weghalen.mutate(r.iban)}
              aria-label={`${ibanTonen(r.iban)} weghalen`}
            >
              Weghalen
            </Button>
          </div>
        ))}
      </div>
    </DossierKaart>
  );
}

// ---------------------------------------------------------------------------
// Hoe deze klant een factuur krijgt
// ---------------------------------------------------------------------------

function HoeFactureren({ d }: { d: Dossier }) {
  const magZien = useRecht("klanten_bekijken", "klanten_bewerken");
  const standaard = useQuery({
    queryKey: ["factuur-standaard"],
    queryFn: fetchFactuurStandaard,
    enabled: magZien,
  });
  // Na een termijn die niet kan, begint het veld opnieuw met wat er bewaard is.
  const [termijnFout, setTermijnFout] = useState(0);
  const v = d.velden;
  const uit = d.alleenLezen;

  if (!magZien) {
    return (
      <DossierKaart>
        <KolomKop>Hoe deze klant een factuur krijgt</KolomKop>
        <p className="text-[14px] text-muted-foreground">
          Je rol mag de klantgegevens niet bekijken, dus ook niet hoe deze klant zijn factuur
          krijgt.
        </p>
      </DossierKaart>
    );
  }

  const bedrijfBtw = standaard.data?.btwProcent ?? 21;
  const bedrijfTermijn = standaard.data?.termijn ?? 14;
  // Een eigen tarief dat niet in het rijtje staat (bv. van vroeger) blijft kiesbaar.
  const tarieven: number[] = [...BTW_TARIEVEN];
  if (v.btw_procent != null && !tarieven.includes(Number(v.btw_procent))) {
    tarieven.push(Number(v.btw_procent));
  }

  return (
    <DossierKaart>
      <KolomKop>Hoe deze klant een factuur krijgt</KolomKop>
      <KaartLabel>Hoe vaak</KaartLabel>
      <Pillen
        groot
        keuzes={FACTUUR_PER}
        waarde={v.factuur_per}
        onChange={(w) => void d.zetKlant({ factuur_per: w })}
        disabled={uit}
        label="Hoe vaak"
      />
      <DossierVeld
        label="Factuur naar (leeg = het gewone e-mailadres)"
        type="email"
        inputMode="email"
        placeholder="administratie@voorbeeld.nl"
        waarde={v.factuur_email}
        disabled={uit}
        onBewaar={(t) => d.zetKlant({ factuur_email: t })}
      />
      <div className="flex flex-col gap-1">
        <KaartLabel>Factuuradres (leeg = dit adres)</KaartLabel>
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2.5">
            <DossierVeld
              label={stil("Straat")}
              placeholder="Straat"
              waarde={v.factuur_straat}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ factuur_straat: t })}
            />
            <DossierVeld
              label={stil("Huisnummer")}
              placeholder="Nr."
              waarde={v.factuur_huisnummer}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ factuur_huisnummer: t })}
            />
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5">
            <DossierVeld
              label={stil("Postcode")}
              placeholder="1234 AB"
              waarde={v.factuur_postcode}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ factuur_postcode: t })}
            />
            <DossierVeld
              label={stil("Plaats")}
              placeholder="Plaats"
              waarde={v.factuur_plaats}
              disabled={uit}
              onBewaar={(t) => d.zetKlant({ factuur_plaats: t })}
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <DossierVeld
          key={termijnFout}
          label="Betalen binnen"
          inputMode="numeric"
          placeholder={`${bedrijfTermijn} dagen`}
          waarde={v.betalingstermijn_dagen == null ? "" : `${v.betalingstermijn_dagen} dagen`}
          disabled={uit}
          onBewaar={(t) => {
            if (t.trim() === "") return d.zetKlant({ betalingstermijn_dagen: null });
            // "14", "14 dagen" of "14 d"; "2 weken" niet.
            const m = t.trim().match(/^(\d+)\s*(dagen|dag|d)?$/i);
            const n = m ? Number(m[1]) : NaN;
            if (!(n >= 1 && n <= 120)) {
              toast.error("Vul een termijn tussen 1 en 120 dagen in.");
              setTermijnFout((x) => x + 1);
              return;
            }
            return d.zetKlant({ betalingstermijn_dagen: n });
          }}
        />
        <VeldLabel label="Btw">
          <select
            className={cn(dossierInvoer, "cursor-pointer")}
            value={v.btw_procent == null ? "" : String(Number(v.btw_procent))}
            disabled={uit}
            onChange={(e) =>
              void d.zetKlant({
                btw_procent: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">{bedrijfBtw}% (zoals het bedrijf)</option>
            {tarieven.map((p) => (
              <option key={p} value={String(p)}>
                {p}%
              </option>
            ))}
          </select>
        </VeldLabel>
      </div>
      <DossierVeld
        label="Vaste regel op de factuur"
        placeholder="Glasbewassing conform overeenkomst"
        waarde={v.factuur_omschrijving}
        disabled={uit}
        onBewaar={(t) => d.zetKlant({ factuur_omschrijving: t })}
      />
    </DossierKaart>
  );
}

// ---------------------------------------------------------------------------
// Facturen van deze klant
// ---------------------------------------------------------------------------

function FacturenVanKlant({
  d,
  magFacturen,
  onVeranderd,
}: {
  d: Dossier;
  magFacturen: boolean;
  onVeranderd: () => void;
}) {
  const bevestig = useBevestig();
  const [open, setOpen] = useState<string | null>(null);
  const klantId = d.klantId;
  const aan = magFacturen && !!klantId;
  // Alleen de facturen van deze klant. De sleutel begint met "facturen", zodat
  // hij mee ververst als de facturenlijst iets verandert (en andersom).
  const facturen = useQuery({
    queryKey: ["facturen", "klant", klantId],
    queryFn: () => fetchFacturen(undefined, undefined, klantId!),
    enabled: aan,
  });
  const lijst = klantId ? (facturen.data ?? []) : [];
  // Waar elke factuur over gaat; alleen als er iets te tonen is.
  const over = useQuery({
    queryKey: ["factuur-over", klantId],
    queryFn: () => fetchFactuurOver(klantId!),
    enabled: aan && lijst.length > 0,
  });

  return (
    <div className="@container flex flex-col gap-1 self-start rounded-[18px] bg-card px-5 py-[18px] lg:self-stretch">
      <div className="pb-2.5">
        <KolomKop>Facturen van deze klant</KolomKop>
      </div>
      {!magFacturen ? (
        <p className="text-[14px] text-muted-foreground">
          Je rol mag de facturen niet zien. Wie het recht Facturen heeft, ziet hier alle facturen
          van deze klant.
        </p>
      ) : (
        <>
          {d.methode === "contant" && (
            <div className="rounded-[14px] bg-muted px-4 py-3.5 text-[14px] leading-normal">
              Deze klant betaalt contant, dus er komen geen facturen. Zet je hem bij Overzicht op
              overmaken, dan komen ze hier te staan.
            </div>
          )}
          {facturen.isError ? (
            <p className="pt-2 text-[14px] text-tint-rood-ink">
              De facturen konden niet opgehaald worden. Ververs de pagina om het opnieuw te
              proberen.
            </p>
          ) : aan && facturen.isLoading ? (
            <p className="pt-2 text-[14px] text-muted-foreground">Laden…</p>
          ) : lijst.length === 0 ? (
            d.methode !== "contant" && (
              <p className="pt-2 text-[14px] text-muted-foreground">
                Nog geen facturen voor deze klant.
              </p>
            )
          ) : (
            <div>
              <div
                className={cn(
                  "hidden gap-3 pb-1.5 pt-4 text-[12px] text-muted-foreground @[34rem]:grid",
                  KOLOMMEN,
                )}
              >
                <span>Nummer</span>
                <span>Datum</span>
                <span>Over</span>
                <span className="text-right">Bedrag</span>
                <span className="text-right">Status</span>
              </div>
              {lijst.map((f) => (
                <FactuurRij
                  key={f.id}
                  f={f}
                  over={over.data?.get(f.id) ?? ""}
                  open={open === f.id}
                  onOpen={() => setOpen(open === f.id ? null : f.id)}
                  onVeranderd={onVeranderd}
                  bevestig={bevestig}
                />
              ))}
              {over.isError && (
                <p className="pt-2 text-[12.5px] text-muted-foreground">
                  Waar de facturen over gaan kon niet opgehaald worden.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FactuurRij({
  f,
  over,
  open,
  onOpen,
  onVeranderd,
  bevestig,
}: {
  f: Factuur;
  over: string;
  open: boolean;
  onOpen: () => void;
  onVeranderd: () => void;
  bevestig: ReturnType<typeof useBevestig>;
}) {
  const nummer = f.nummer ?? "nog geen";
  const datum =
    korteDatum(f.datum) +
    (f.datum.slice(0, 4) === String(new Date().getFullYear()) ? "" : ` ${f.datum.slice(0, 4)}`);
  const bedrag = formatPrice(exclusiefVoorop(f) ? f.totalen.excl : f.totalen.incl);
  const stand = factuurStand(f).toLowerCase();
  // Wat klaar is staat grijs; wat te laat is rood.
  const klaar = f.status === "betaald" || f.status === "gecrediteerd" || f.soort === "credit";
  const standKleur = f.te_laat ? "text-tint-rood-ink" : "";

  return (
    <div className="border-t border-muted">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className={cn(
          "group block w-full py-2.5 text-left text-[14px]",
          klaar && "text-muted-foreground",
        )}
      >
        {/* Breed: de kolommen van het ontwerp. */}
        <span className={cn("hidden gap-3 @[34rem]:grid", KOLOMMEN)}>
          <span className={cn("truncate tabular-nums", !f.nummer && "text-muted-foreground")}>
            {nummer}
          </span>
          <span className="truncate">{datum}</span>
          <span className="truncate group-hover:underline" title={over}>
            {over}
          </span>
          <span className="text-right tabular-nums">{bedrag}</span>
          <span className={cn("text-right", standKleur)}>{stand}</span>
        </span>
        {/* Smal (telefoon): waar hij over gaat en het bedrag, de rest eronder. */}
        <span className="flex flex-col gap-0.5 @[34rem]:hidden">
          <span className="flex gap-3">
            <span className="min-w-0 flex-1 truncate group-hover:underline">{over || nummer}</span>
            <span className="shrink-0 tabular-nums">{bedrag}</span>
          </span>
          <span className="truncate text-[12.5px] text-muted-foreground">
            {nummer} · {datum} · <span className={standKleur}>{stand}</span>
          </span>
        </span>
      </button>
      <FactuurDetail
        f={f}
        open={open}
        onVeranderd={onVeranderd}
        bevestig={bevestig}
        className="mb-2.5 rounded-[14px] border-t-0"
      />
    </div>
  );
}
