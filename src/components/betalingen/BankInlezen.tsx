/**
 * Bankbestanden inlezen: overmakingen vanzelf bij de goede factuur.
 *
 * Je downloadt bij de bank de afschriften (CAMT.053, MT940 of CSV) en kiest
 * dat bestand hier. De browser leest het (bankbestand.ts), de database kijkt
 * per bijschrijving of hij bij een factuur hoort (migratie bank_inlezen):
 *
 *   * factuurnummer in de omschrijving → daar geboekt;
 *   * rekening die al eens bij een klant hoorde, bedrag past precies → daar;
 *   * uitbetaling van Mollie → overgeslagen, die staan al bij de facturen;
 *   * de rest komt hier op een lijstje, met een voorstel als er een is.
 *
 * Alles wat vanzelf ging staat onder "Laatst verwerkt", met een knop om het
 * ongedaan te maken. Te veel betaald wordt vanzelf tegoed bij de klant.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBuildingBank as Bank, IconUpload as Upload } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  bankInlezen,
  bankKoppelen,
  bankNegeren,
  bankTerugzetten,
  fetchBankOpen,
  fetchBankVerwerkt,
  type BankTransactie,
  type BankUitkomst,
} from "@/lib/bank";
import { BankbestandFout, bestandTekst, leesBankbestand, MAX_BESTAND } from "@/lib/bankbestand";
import { openBedrag, type Factuur } from "@/lib/facturen";
import { formatPrice } from "@/lib/klanten";
import { toonDatum } from "@/lib/wasdag";

/** Het gele vakje boven de facturen: er wacht iets van de bank. */
export function BankVak({ aantal, onBekijk }: { aantal: number; onBekijk: () => void }) {
  if (aantal === 0) return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-tint-amber px-4 py-3 text-[13px] text-tint-amber-ink">
      <Bank className="size-[18px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {aantal === 1 ? "1 bijschrijving van de bank" : `${aantal} bijschrijvingen van de bank`} kon
        de app niet zeker bij een factuur zetten. Kijk even mee.
      </span>
      <Button size="sm" variant="secondary" className="rounded-full" onClick={onBekijk}>
        Bekijken
      </Button>
    </section>
  );
}

/** Eén zin over hoe het inlezen ging. */
function uitkomstTekst(u: BankUitkomst, afschrijvingen: number, onleesbaar: number): string {
  const delen: string[] = [];
  if (u.nieuw === 0) delen.push("Niets nieuws: alles stond er al in.");
  else {
    delen.push(u.nieuw === 1 ? "1 nieuwe bijschrijving." : `${u.nieuw} nieuwe bijschrijvingen.`);
    if (u.gekoppeld > 0) delen.push(`${u.gekoppeld} vanzelf bij een factuur gezet.`);
    if (u.te_controleren > 0) delen.push(`${u.te_controleren} om na te kijken.`);
    if (u.genegeerd > 0)
      delen.push(
        `${u.genegeerd} overgeslagen (uitbetaling van Mollie: die betalingen staan al bij de facturen).`,
      );
  }
  if (u.nieuw > 0 && u.al_bekend > 0) delen.push(`${u.al_bekend} stonden er al in.`);
  if (afschrijvingen > 0)
    delen.push(
      `${afschrijvingen} ${afschrijvingen === 1 ? "afschrijving" : "afschrijvingen"} overgeslagen.`,
    );
  if (onleesbaar > 0)
    delen.push(
      `Let op: ${onleesbaar} ${onleesbaar === 1 ? "regel was" : "regels waren"} niet te lezen en ${onleesbaar === 1 ? "is" : "zijn"} overgeslagen. Kijk die na in je bankieren.`,
    );
  return delen.join(" ");
}

export function BankInlezen({
  facturen,
  onTerug,
  onVeranderd,
}: {
  facturen: Factuur[];
  onTerug: () => void;
  onVeranderd: () => void;
}) {
  const qc = useQueryClient();
  const kiezer = useRef<HTMLInputElement>(null);
  const [uitkomst, setUitkomst] = useState<string | null>(null);

  const open = useQuery({ queryKey: ["bank", "open"], queryFn: fetchBankOpen });
  const verwerkt = useQuery({ queryKey: ["bank", "verwerkt"], queryFn: fetchBankVerwerkt });

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["bank"] });
    onVeranderd();
  }

  const inlezen = useMutation({
    mutationFn: async (bestand: File) => {
      if (bestand.size > MAX_BESTAND) {
        throw new BankbestandFout("Dit bestand is te groot. Kies een kortere periode.");
      }
      const gelezen = leesBankbestand(bestandTekst(await bestand.arrayBuffer()));
      if (gelezen.regels.length > 20000) {
        throw new BankbestandFout("Meer dan 20.000 bijschrijvingen. Kies een kortere periode.");
      }
      const u = await bankInlezen(gelezen, bestand.name);
      return { u, afschrijvingen: gelezen.afschrijvingen, onleesbaar: gelezen.onleesbaar };
    },
    onSuccess: ({ u, afschrijvingen, onleesbaar }) => {
      setUitkomst(uitkomstTekst(u, afschrijvingen, onleesbaar));
      ververs();
    },
    onError: (e: Error) =>
      toast.error(e instanceof BankbestandFout ? e.message : "Inlezen mislukt: " + e.message),
  });

  /** Factuur-id → factuur, om nummers en namen te tonen. */
  const perId = useMemo(() => new Map(facturen.map((f) => [f.id, f])), [facturen]);
  /** Wat je met de hand kunt kiezen: echte facturen die verstuurd zijn. */
  const kiesbaar = useMemo(
    () =>
      facturen
        .filter((f) => f.soort === "factuur" && f.nummer && f.status !== "concept")
        .sort((a, b) => {
          // Wat nog openstaat eerst, dan het nieuwste nummer.
          const oa = a.status === "verstuurd" ? 0 : 1;
          const ob = b.status === "verstuurd" ? 0 : 1;
          return oa - ob || (b.nummer ?? "").localeCompare(a.nummer ?? "");
        }),
    [facturen],
  );

  return (
    <div className="flex flex-col gap-3 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={onTerug}>
          Terug naar de facturen
        </Button>
        <input
          ref={kiezer}
          type="file"
          accept=".xml,.sta,.940,.mt940,.txt,.csv"
          className="hidden"
          onChange={(e) => {
            const bestand = e.target.files?.[0];
            e.target.value = "";
            if (bestand) inlezen.mutate(bestand);
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto gap-1.5 rounded-full"
          disabled={inlezen.isPending}
          onClick={() => kiezer.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {inlezen.isPending ? "Bezig met inlezen…" : "Bankbestand kiezen…"}
        </Button>
      </div>

      <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em]">
        Betalingen van de bank
      </h2>
      <p className="max-w-[62ch] text-[13px] text-muted-foreground">
        Download bij je bank de afschriften als CAMT.053, MT940 of CSV en kies dat bestand hier. Een
        overmaking met het factuurnummer erin, of van een rekening die de app al kent, komt vanzelf
        bij de goede factuur. Te veel betaald wordt tegoed bij de klant. Hetzelfde bestand twee keer
        inlezen kan geen kwaad.
      </p>

      {uitkomst && (
        <p className="rounded-[14px] bg-tint-groen px-3 py-2 text-[13px] text-tint-groen-ink">
          {uitkomst}
        </p>
      )}

      <section className="rounded-[20px] bg-card px-4 py-3">
        <h3 className="pb-2 text-[14px] font-semibold">
          Om na te kijken{open.data && open.data.length > 0 ? ` (${open.data.length})` : ""}
        </h3>
        {open.isError ? (
          <p className="text-[13px] text-tint-rood-ink">Kon niet opgehaald worden.</p>
        ) : open.isLoading ? (
          <p className="text-[13px] text-muted-foreground">Laden…</p>
        ) : (open.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Niets: alles staat bij een factuur.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {(open.data ?? []).map((t) => (
              <OpenRij key={t.id} t={t} perId={perId} kiesbaar={kiesbaar} onVeranderd={ververs} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[20px] bg-card px-4 py-3">
        <h3 className="pb-2 text-[14px] font-semibold">Laatst verwerkt</h3>
        {verwerkt.isError ? (
          <p className="text-[13px] text-tint-rood-ink">Kon niet opgehaald worden.</p>
        ) : (verwerkt.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {verwerkt.isLoading ? "Laden…" : "Nog niets ingelezen."}
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {(verwerkt.data ?? []).map((t) => (
              <VerwerktRij key={t.id} t={t} perId={perId} onVeranderd={ververs} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Datum, wie, rekening en omschrijving: wat de bank erover zei. */
function Kop({ t }: { t: BankTransactie }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{toonDatum(t.datum)}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t.tegen_naam || "Onbekend"}</span>
        {t.tegen_iban && (
          <span className="text-muted-foreground tabular-nums"> · {t.tegen_iban}</span>
        )}
        {(t.omschrijving || t.kenmerk) && (
          <span className="block truncate text-muted-foreground" title={t.omschrijving}>
            {[t.omschrijving, t.kenmerk].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <span className="shrink-0 font-medium tabular-nums">{formatPrice(t.bedrag)}</span>
    </div>
  );
}

function factuurLabel(f: Factuur): string {
  const stand =
    f.status === "verstuurd"
      ? `${formatPrice(openBedrag(f))} open`
      : f.status === "betaald"
        ? "al betaald"
        : "gecrediteerd";
  return `${f.nummer} · ${f.klant} · ${stand}`;
}

function OpenRij({
  t,
  perId,
  kiesbaar,
  onVeranderd,
}: {
  t: BankTransactie;
  perId: Map<string, Factuur>;
  kiesbaar: Factuur[];
  onVeranderd: () => void;
}) {
  // Het voorstel van de app vooraan; meer dan één = "alle samen".
  const voorgesteld = t.voorstel.filter((id) => perId.has(id));
  const SAMEN = "samen";
  const [keuze, setKeuze] = useState<string>(
    voorgesteld.length > 1 ? SAMEN : (voorgesteld[0] ?? ""),
  );
  const ids = keuze === SAMEN ? voorgesteld : keuze ? [keuze] : [];

  const koppelen = useMutation({
    mutationFn: () => bankKoppelen(t.id, ids),
    onSuccess: () => {
      onVeranderd();
      toast.success("Geboekt.");
    },
    onError: (e: Error) => toast.error("Boeken mislukt: " + e.message),
  });
  const negeren = useMutation({
    mutationFn: () => bankNegeren(t.id),
    onSuccess: onVeranderd,
    onError: (e: Error) => toast.error("Niet gelukt: " + e.message),
  });
  const bezig = koppelen.isPending || negeren.isPending;

  // Wat er nog openstaat op wat je koos: zegt of er tegoed van komt.
  const openSamen = ids.reduce((s, id) => {
    const f = perId.get(id);
    return s + (f && f.status === "verstuurd" ? openBedrag(f) : 0);
  }, 0);
  const tegoed = ids.length > 0 ? Math.round((t.bedrag - openSamen) * 100) / 100 : 0;

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <Kop t={t} />
      {t.reden && <p className="text-[12.5px] text-muted-foreground">{t.reden}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={keuze}
          onChange={(e) => setKeuze(e.target.value)}
          aria-label="Bij welke factuur hoort deze betaling?"
          className="h-9 min-w-0 max-w-full flex-1 rounded-lg border border-input bg-background/70 px-2 text-[13px]"
        >
          <option value="">Kies een factuur…</option>
          {voorgesteld.length > 1 && (
            <option value={SAMEN}>
              Alle voorgestelde samen ({voorgesteld.map((id) => perId.get(id)?.nummer).join(", ")})
            </option>
          )}
          {voorgesteld.length > 0 && (
            <optgroup label="Voorstel">
              {voorgesteld.map((id) => (
                <option key={id} value={id}>
                  {factuurLabel(perId.get(id)!)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Alle facturen">
            {kiesbaar
              .filter((f) => !voorgesteld.includes(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {factuurLabel(f)}
                </option>
              ))}
          </optgroup>
        </select>
        <Button
          size="sm"
          variant="secondary"
          disabled={ids.length === 0 || bezig}
          onClick={() => koppelen.mutate()}
        >
          Boeken
        </Button>
        <Button size="sm" variant="ghost" disabled={bezig} onClick={() => negeren.mutate()}>
          Geen factuur
        </Button>
      </div>
      {tegoed > 0.005 && (
        <p className="text-[12.5px] text-muted-foreground">
          {formatPrice(tegoed)} daarvan wordt tegoed voor de klant.
        </p>
      )}
    </div>
  );
}

function VerwerktRij({
  t,
  perId,
  onVeranderd,
}: {
  t: BankTransactie;
  perId: Map<string, Factuur>;
  onVeranderd: () => void;
}) {
  const terug = useMutation({
    mutationFn: () => bankTerugzetten(t.id),
    onSuccess: () => {
      onVeranderd();
      toast.success("Ongedaan gemaakt. Hij staat weer bij “Om na te kijken”.");
    },
    onError: (e: Error) => toast.error("Niet gelukt: " + e.message),
  });

  const waar =
    t.status === "genegeerd"
      ? t.reden || "Geen factuur"
      : t.koppelingen
          .map((k) => {
            const nr = perId.get(k.factuur_id)?.nummer ?? "factuur";
            return t.koppelingen.length > 1 ? `${nr} (${formatPrice(k.bedrag)})` : nr;
          })
          .join(", ");

  return (
    <div className="flex flex-col gap-1 py-2.5">
      <Kop t={t} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[92px] text-[12.5px] text-muted-foreground max-sm:pl-0">
        <span className="min-w-0 flex-1">
          {t.status === "gekoppeld" ? "Geboekt op " : ""}
          {waar}
          {t.door_app ? " · vanzelf" : " · met de hand"}
        </span>
        <Button size="sm" variant="ghost" disabled={terug.isPending} onClick={() => terug.mutate()}>
          Ongedaan maken
        </Button>
      </div>
    </div>
  );
}
