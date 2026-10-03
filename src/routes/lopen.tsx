/**
 * Klanten lopen: langs de deur voor nieuwe klanten.
 *
 * Zonder `?gebied=` de gebieden met hun tellers; met een gebied de looplijst,
 * straat voor straat in de looprichting (oneven heen, even terug). Alle
 * tellers komen uit één aanroep van loop_tellingen, net als het vak op Home.
 *
 * Plan: .omc/plans/klanten-lopen.md, §8.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft as Terug,
  IconMapPin as MapPin,
  IconPlus as Plus,
  IconRefresh as Ververs,
  IconRoad as Weg,
  IconTrash as Prullenbak,
  IconWalk as Walk,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { GebiedMaken } from "@/components/lopen/GebiedMaken";
import { JaDialog } from "@/components/lopen/JaDialog";
import { LoopAdresRij } from "@/components/lopen/LoopAdresRij";
import { Button } from "@/components/ui/button";
import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { fetchStreets } from "@/lib/klanten";
import {
  LOOP_TELLINGEN,
  fetchLoopLijst,
  fetchLoopTellingen,
  foutTekst,
  gooiGebiedWeg,
  korteDatum,
  loopLijstSleutel,
  looplijstVolgorde,
  nogTeLopen,
  useLoopLive,
  vulGebied,
  wijkstraatVoor,
  zetLoopAdres,
  type LoopAdres,
  type LoopGebied,
  type LoopPatch,
} from "@/lib/lopen";
import { useRecht } from "@/lib/rechten";
import { pushUndo, undoKnop } from "@/lib/undo";

type LopenSearch = { gebied?: string };

export const Route = createFileRoute("/lopen")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): LopenSearch => {
    const uit: LopenSearch = {};
    if (typeof search["gebied"] === "string" && search["gebied"]) uit.gebied = search["gebied"];
    return uit;
  },
  head: () => ({ meta: [{ title: "Klanten lopen — Paaltje Systems" }] }),
  component: Lopen,
});

/** "38 te lopen · 4 interesse · 12 ja · 3 nee" */
function tellerTekst(g: LoopGebied): string {
  const delen = [`${g.te_lopen} te lopen`];
  if (g.niet_thuis) delen.push(`${g.niet_thuis} niet thuis`);
  delen.push(`${g.interesse} interesse`, `${g.ja} ja`, `${g.nee} nee`);
  return delen.join(" · ");
}

function Lopen() {
  useRequireAuth();
  const { gebied } = Route.useSearch();
  const { employee } = useAuth();
  const mag = useRecht("klanten_lopen");
  useLoopLive(mag ? employee?.company_id : undefined);

  const tellingen = useQuery({
    queryKey: LOOP_TELLINGEN,
    queryFn: fetchLoopTellingen,
    enabled: mag,
  });

  // Eén "bezig" voor beide schermen: zo haal je hetzelfde gebied niet twee
  // keer tegelijk op als je tijdens het ophalen de looplijst opent.
  const ophalen = useOpnieuwOphalen();

  return gebied ? (
    <Looplijst gebiedId={gebied} tellingen={tellingen.data} mag={mag} ophalen={ophalen} />
  ) : (
    <Gebieden
      tellingen={tellingen.data}
      laden={tellingen.isLoading}
      fout={tellingen.error}
      ophalen={ophalen}
    />
  );
}

// ---------------------------------------------------------------------------
// De gebieden
// ---------------------------------------------------------------------------

/** Opnieuw ophalen: de straten van het gebied, met de wijkstraat erbij. */
function useOpnieuwOphalen() {
  const qc = useQueryClient();
  const [bezig, setBezig] = useState<{ id: string; tekst: string } | null>(null);

  async function ophalen(g: LoopGebied) {
    if (bezig) return;
    if (g.straten.length === 0) {
      toast.error("Dit gebied heeft geen straten om op te halen.");
      return;
    }
    setBezig({ id: g.gebied_id, tekst: "Beginnen…" });
    try {
      const straten = g.district_id
        ? (await qc.fetchQuery({ queryKey: ["streets"], queryFn: fetchStreets })).filter(
            (s) => s.district_id === g.district_id,
          )
        : [];
      const { aantal, nietGevonden } = await vulGebied(
        g.gebied_id,
        g.straten.map((naam) => ({ naam, street_id: wijkstraatVoor(naam, straten)?.id ?? null })),
        g.plaats,
        { onVoortgang: (tekst) => setBezig({ id: g.gebied_id, tekst }) },
      );
      if (nietGevonden.length > 0) {
        toast.warning(
          `Niet gevonden: ${nietGevonden.join(", ")}. Kies de officiële naam via Straten aanpassen.`,
        );
      }
      toast.success(`${g.naam}: ${aantal} ${aantal === 1 ? "adres" : "adressen"}`);
    } catch (e) {
      toast.error(`Ophalen mislukt: ${foutTekst(e)}`);
    } finally {
      setBezig(null);
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
      void qc.invalidateQueries({ queryKey: ["loop-lijst"] });
    }
  }

  return { bezig, ophalen };
}

type Ophalen = ReturnType<typeof useOpnieuwOphalen>;

function Gebieden({
  tellingen,
  laden,
  fout,
  ophalen: { bezig, ophalen },
}: {
  tellingen: LoopGebied[] | undefined;
  laden: boolean;
  fout: unknown;
  ophalen: Ophalen;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [maken, setMaken] = useState(false);
  const [bewerken, setBewerken] = useState<LoopGebied | null>(null);

  async function weggooien(g: LoopGebied) {
    const ja = await bevestig({
      titel: `${g.naam} weggooien?`,
      tekst:
        "Het gebied verdwijnt uit de lijst. Terugzetten kan alleen met Ongedaan maken in de melding die daarna verschijnt. Wat je bij de adressen noteerde blijft bewaard, ook in andere gebieden.",
      bevestigLabel: "Weggooien",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await gooiGebiedWeg(g.gebied_id);
      pushUndo({
        label: `${g.naam} weggooien`,
        undo: async () => {
          await gooiGebiedWeg(g.gebied_id, true);
          await qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
        },
      });
      toast.success(`${g.naam} weggegooid`, { duration: 10000, action: undoKnop() });
    } catch (e) {
      toast.error(`Weggooien mislukt: ${foutTekst(e)}`);
    } finally {
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
    }
  }

  return (
    <AppLayout
      titel="Klanten lopen"
      acties={
        <Button className="rounded-full" onClick={() => setMaken(true)}>
          <Plus className="size-4" /> Nieuw gebied
        </Button>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {fout ? (
          <Leeg tekst={`De gebieden konden niet geladen worden: ${foutTekst(fout)}`} />
        ) : laden ? (
          <Leeg tekst="Bezig met ophalen…" />
        ) : !tellingen || tellingen.length === 0 ? (
          <Leeg tekst="Nog geen gebieden. Maak er een bij een wijk, of een los gebied met eigen straten." />
        ) : (
          tellingen.map((g) => {
            const haalt = bezig?.id === g.gebied_id;
            return (
              <section
                key={g.gebied_id}
                className="rounded-[18px] border border-border bg-card p-4 shadow-card"
              >
                <Link
                  to="/lopen"
                  search={{ gebied: g.gebied_id }}
                  className="block rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-0.01em]">
                      {g.naam}
                    </h2>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {g.wijk ? `wijk ${g.wijk}` : "los"}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] tabular-nums">{tellerTekst(g)}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {g.totaal} {g.totaal === 1 ? "adres" : "adressen"}
                    {g.klanten > 0 && ` · ${g.klanten} al klant`}
                    {!g.onvolledig &&
                      g.opgehaald_op &&
                      ` · opgehaald ${korteDatum(g.opgehaald_op)}`}
                  </p>
                </Link>
                {g.onvolledig && !haalt && (
                  <button
                    type="button"
                    onClick={() => void ophalen(g)}
                    disabled={!!bezig}
                    className="mt-2 min-h-11 w-full rounded-xl bg-tint-amber px-3 text-left text-[13px] font-medium text-tint-amber-ink"
                  >
                    Onvolledig — opnieuw ophalen
                  </button>
                )}
                {haalt && (
                  <p aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">
                    {bezig.tekst}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-full"
                    disabled={!!bezig}
                    onClick={() => setBewerken(g)}
                  >
                    <Weg className="size-4" /> Straten
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-full"
                    disabled={!!bezig}
                    onClick={() => void ophalen(g)}
                  >
                    <Ververs className="size-4" /> Opnieuw ophalen
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-10 rounded-full text-muted-foreground"
                    disabled={haalt}
                    onClick={() => void weggooien(g)}
                  >
                    <Prullenbak className="size-4" /> Weggooien
                  </Button>
                </div>
              </section>
            );
          })
        )}
      </div>

      <GebiedMaken open={maken} onOpenChange={setMaken} />
      <GebiedMaken
        open={bewerken !== null}
        onOpenChange={(o) => !o && setBewerken(null)}
        gebied={bewerken}
      />
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// De looplijst
// ---------------------------------------------------------------------------

function Looplijst({
  gebiedId,
  tellingen,
  mag,
  ophalen: { bezig, ophalen },
}: {
  gebiedId: string;
  tellingen: LoopGebied[] | undefined;
  mag: boolean;
  ophalen: Ophalen;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { employee } = useAuth();
  const gebied = tellingen?.find((g) => g.gebied_id === gebiedId) ?? null;
  const sleutel = loopLijstSleutel(gebiedId);
  const lijst = useQuery({
    queryKey: sleutel,
    queryFn: () => fetchLoopLijst(gebiedId),
    enabled: mag,
  });
  const [jaId, setJaId] = useState<string | null>(null);

  const straten = useMemo(() => looplijstVolgorde(lijst.data ?? []), [lijst.data]);
  const jaRij = jaId ? ((lijst.data ?? []).find((r) => r.id === jaId) ?? null) : null;

  const bewaar = useCallback(
    async (id: string, patch: LoopPatch) => {
      const k = loopLijstSleutel(gebiedId);
      await qc.cancelQueries({ queryKey: k });
      // Alvast neerzetten; mislukt het, dan blijft het staan met een foutmelding.
      qc.setQueryData<LoopAdres[]>(k, (oud) =>
        oud?.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                ...patch,
                ...(patch.uitkomst !== undefined && patch.uitkomst !== r.uitkomst
                  ? {
                      uitkomst_op: patch.uitkomst ? new Date().toISOString() : null,
                      uitkomst_door_naam: patch.uitkomst ? (employee?.naam ?? null) : null,
                    }
                  : {}),
              },
        ),
      );
      await zetLoopAdres(id, patch);
      void qc.invalidateQueries({ queryKey: LOOP_TELLINGEN });
    },
    [qc, gebiedId, employee?.naam],
  );

  const ja = useCallback(
    async (r: LoopAdres) => {
      if (r.uitkomst !== "ja") await bewaar(r.id, { uitkomst: "ja" });
      setJaId(r.id);
    },
    [bewaar],
  );

  return (
    <AppLayout
      titel={gebied?.naam ?? "Klanten lopen"}
      naastTitel={gebied ? (gebied.wijk ? `wijk ${gebied.wijk}` : "los gebied") : undefined}
      zonderPaaltje
      acties={
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => void navigate({ to: "/lopen", search: {} })}
        >
          <Terug className="size-4" /> Gebieden
        </Button>
      }
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {gebied && (
          <div className="rounded-[18px] border border-border bg-card px-4 py-3 shadow-card">
            <p className="text-[14px] font-medium tabular-nums">{tellerTekst(gebied)}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {gebied.totaal} {gebied.totaal === 1 ? "adres" : "adressen"}
              {gebied.klanten > 0 && ` · ${gebied.klanten} al klant`}
              {gebied.plaats && ` · ${gebied.plaats}`}
            </p>
            {gebied.onvolledig && (
              <button
                type="button"
                onClick={() => void ophalen(gebied)}
                disabled={!!bezig}
                className="mt-2 min-h-11 w-full rounded-xl bg-tint-amber px-3 text-left text-[13px] font-medium text-tint-amber-ink"
              >
                {bezig ? bezig.tekst : "Onvolledig — opnieuw ophalen"}
              </button>
            )}
          </div>
        )}

        {lijst.error ? (
          <Leeg tekst={foutTekst(lijst.error)} />
        ) : lijst.isLoading ? (
          <Leeg tekst="Bezig met ophalen…" />
        ) : tellingen && !gebied ? (
          <Leeg tekst="Dit gebied bestaat niet (meer)." />
        ) : straten.length === 0 ? (
          <Leeg tekst="Er staan nog geen adressen in dit gebied." />
        ) : (
          straten.map((s) => {
            const alle = [...s.heen, ...s.terug];
            const open = alle.filter(nogTeLopen).length;
            return (
              <section key={s.straat_volgorde} className="flex flex-col gap-2">
                <h2 className="sticky top-[var(--plakrand,0px)] z-[5] -mx-3 flex items-baseline gap-2 bg-background/95 px-3 pb-1 pt-3 backdrop-blur md:-mx-6 md:px-6">
                  <MapPin className="size-4 shrink-0 self-center text-muted-foreground" />
                  <span className="min-w-0 truncate font-display text-[17px] font-semibold tracking-[-0.01em]">
                    {s.straat}
                  </span>
                  <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
                    {open} te lopen · {alle.length}
                  </span>
                </h2>
                {s.heen.length > 0 && s.terug.length > 0 && <Kant tekst="Heen · oneven" />}
                {s.heen.map((r) => (
                  <LoopAdresRij key={r.id} rij={r} onBewaar={bewaar} onJa={ja} />
                ))}
                {s.terug.length > 0 && s.heen.length > 0 && <Kant tekst="Terug · even" />}
                {s.terug.map((r) => (
                  <LoopAdresRij key={r.id} rij={r} onBewaar={bewaar} onJa={ja} />
                ))}
              </section>
            );
          })
        )}
      </div>

      <JaDialog
        rij={jaRij}
        gebiedWijk={gebied?.district_id ?? null}
        onOpenChange={(o) => !o && setJaId(null)}
      />
    </AppLayout>
  );
}

function Kant({ tekst }: { tekst: string }) {
  return (
    <div className="px-1 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {tekst}
    </div>
  );
}

function Leeg({ tekst }: { tekst: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-border px-6 py-12 text-center">
      <Walk className="mx-auto mb-3 size-6 text-muted-foreground" />
      <p className="mx-auto max-w-[40ch] text-[13.5px] text-muted-foreground">{tekst}</p>
    </div>
  );
}
