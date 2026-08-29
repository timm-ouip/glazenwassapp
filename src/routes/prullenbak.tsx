import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { requireSession, useRequireAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { formatNumber, gooiEchtWeg, haalTerug, type Customer } from "@/lib/klanten";

export const Route = createFileRoute("/prullenbak")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({ meta: [{ title: "Prullenbak — Klantenlijst glazenwasser" }] }),
  component: Prullenbak,
});

type Soort = "districts" | "streets" | "customers";

type Weggelegd = {
  soort: Soort;
  id: string;
  omschrijving: string;
  extra: string;
  deleted_at: string;
};

async function haalPrullenbak(): Promise<Weggelegd[]> {
  const [wijken, straten, klanten] = await Promise.all([
    supabase.from("districts").select("id,name,deleted_at").not("deleted_at", "is", null),
    supabase.from("streets").select("id,name,deleted_at").not("deleted_at", "is", null),
    supabase
      .from("customers")
      .select("id,house_number,addition,street_id,deleted_at")
      .not("deleted_at", "is", null),
  ]);
  for (const r of [wijken, straten, klanten]) if (r.error) throw r.error;

  // Straatnamen erbij zoeken zodat een weggelegde klant niet als kaal
  // huisnummer in de lijst staat. Ook weggelegde straten tellen mee, want
  // een klant kan samen met zijn straat zijn verdwenen.
  const alleStraten = await supabase.from("streets").select("id,name");
  const straatNaam = new Map((alleStraten.data ?? []).map((s) => [s.id, s.name]));

  const uit: Weggelegd[] = [
    ...(wijken.data ?? []).map((w) => ({
      soort: "districts" as const,
      id: w.id,
      omschrijving: w.name,
      extra: "Wijk — straten en klanten komen mee terug",
      deleted_at: w.deleted_at as string,
    })),
    ...(straten.data ?? []).map((s) => ({
      soort: "streets" as const,
      id: s.id,
      omschrijving: s.name,
      extra: "Straat — klanten komen mee terug",
      deleted_at: s.deleted_at as string,
    })),
    ...(klanten.data ?? []).map((c) => ({
      soort: "customers" as const,
      id: c.id,
      omschrijving: formatNumber(c as unknown as Customer),
      extra: straatNaam.get(c.street_id) ?? "Onbekende straat",
      deleted_at: c.deleted_at as string,
    })),
  ];

  return uit.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

const SOORT_LABEL: Record<Soort, string> = {
  districts: "Wijk",
  streets: "Straat",
  customers: "Klant",
};

function datum(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Prullenbak() {
  useRequireAuth();
  const qc = useQueryClient();
  const bevestig = useBevestig();

  const vraag = useQuery({ queryKey: ["prullenbak"], queryFn: haalPrullenbak });
  const rijen = vraag.data ?? [];

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["prullenbak"] });
    qc.invalidateQueries({ queryKey: ["districts"] });
    qc.invalidateQueries({ queryKey: ["streets"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function terug(r: Weggelegd) {
    try {
      await haalTerug(r.soort, [r.id]);
      herlaad();
      toast.success(`${r.omschrijving} teruggezet`);
    } catch (e) {
      toast.error("Terugzetten mislukt: " + (e as Error).message);
    }
  }

  async function echtWeg(r: Weggelegd) {
    const ja = await bevestig({
      titel: `${r.omschrijving} definitief verwijderen?`,
      tekst:
        r.soort === "customers"
          ? "Deze klant is hierna echt weg en niet meer terug te halen."
          : "Alles wat hieronder valt gaat mee en is hierna echt weg. Dit kan niet ongedaan gemaakt worden.",
      bevestigLabel: "Definitief verwijderen",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await gooiEchtWeg(r.soort, [r.id]);
      herlaad();
      toast.success(`${r.omschrijving} definitief verwijderd`);
    } catch (e) {
      toast.error("Verwijderen mislukt: " + (e as Error).message);
    }
  }

  return (
    <AppLayout
      titel="Prullenbak"
      kruimel="Overzicht / Prullenbak"
      onderschrift="Verwijderde wijken, straten en klanten staan hier tot je ze definitief weggooit"
    >
      {vraag.isLoading ? (
        <p className="text-sm text-muted-foreground">Laden…</p>
      ) : rijen.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold">De prullenbak is leeg</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Wat je verwijdert komt hier terecht, zodat je het kunt terughalen.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border bg-card-header px-4 py-2.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
            <span className="w-16 shrink-0">SOORT</span>
            <span className="min-w-0 flex-1">WAT</span>
            <span className="hidden w-44 shrink-0 lg:block">VERWIJDERD OP</span>
            <span className="w-[150px] shrink-0" />
          </div>
          {rijen.map((r) => (
            <div
              key={`${r.soort}:${r.id}`}
              className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {SOORT_LABEL[r.soort]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{r.omschrijving}</span>
                <span className="truncate text-xs text-muted-foreground">{r.extra}</span>
                <span className="truncate text-xs text-muted-foreground lg:hidden">
                  {datum(r.deleted_at)}
                </span>
              </span>
              <span className="hidden w-44 shrink-0 text-xs text-muted-foreground lg:block">
                {datum(r.deleted_at)}
              </span>
              <span className="flex w-[150px] shrink-0 justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void terug(r)}
                >
                  <RotateCcw className="size-3.5" /> Terugzetten
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-full text-muted-foreground hover:text-destructive"
                  onClick={() => void echtWeg(r)}
                  aria-label={`${r.omschrijving} definitief verwijderen`}
                  title="Definitief verwijderen"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
