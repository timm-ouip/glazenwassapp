import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Printer, Upload, Pencil, Trash2, MapPin, Search } from "lucide-react";
import { KlantDialog } from "@/components/KlantDialog";
import { StraatDialog } from "@/components/StraatDialog";
import {
  fetchCustomers,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  splitEvenOdd,
  type Customer,
  type Street,
} from "@/lib/klanten";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Klantenlijst glazenwasser — straten, prijzen en maandplanning" },
      {
        name: "description",
        content:
          "Beheer je glazenwasklanten per straat, met prijzen, notities en een filter voor even of oneven maanden.",
      },
      { property: "og:title", content: "Klantenlijst glazenwasser" },
      {
        property: "og:description",
        content: "Klanten per straat, prijzen, notities en printlijsten voor even of oneven maanden.",
      },
    ],
  }),
  component: Index,
});

type MaandFilter = "alles" | "even" | "oneven";

function Index() {
  const [filter, setFilter] = useState<MaandFilter>("alles");
  const [zoek, setZoek] = useState("");
  const [prijzenTonen, setPrijzenTonen] = useState(true);
  const [klantDialog, setKlantDialog] = useState<{ open: boolean; customer: Customer | null; streetId?: string }>({
    open: false,
    customer: null,
  });
  const [straatDialog, setStraatDialog] = useState<{ open: boolean; street: Street | null }>({
    open: false,
    street: null,
  });

  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const streets = streetsQuery.data ?? [];
  const customers = customersQuery.data ?? [];

  function herlaad() {
    streetsQuery.refetch();
    customersQuery.refetch();
  }

  const groepen = useMemo(() => {
    const term = zoek.trim().toLowerCase();
    return streets
      .filter((s) => !term || s.name.toLowerCase().includes(term))
      .map((s) => {
        const klanten = customers.filter((c) => c.street_id === s.id && matchesMaand(c.frequency, filter));
        return { street: s, ...splitEvenOdd(klanten), aantal: klanten.length };
      })
      .filter((g) => g.aantal > 0 || !term);
  }, [streets, customers, filter, zoek]);

  const totaal = groepen.reduce((sum, g) => sum + g.aantal, 0);
  const omzet = groepen.reduce(
    (sum, g) => sum + [...g.even, ...g.oneven].reduce((s, c) => s + c.price, 0),
    0,
  );

  async function verwijderKlant(c: Customer) {
    if (!confirm(`Klant ${formatNumber(c)} verwijderen?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) {
      toast.error("Verwijderen mislukt: " + error.message);
      return;
    }
    toast.success("Klant verwijderd");
    herlaad();
  }

  async function verwijderStraat(s: Street) {
    if (!confirm(`Straat "${s.name}" en alle klanten daarin verwijderen?`)) return;
    const { error } = await supabase.from("streets").delete().eq("id", s.id);
    if (error) {
      toast.error("Verwijderen mislukt: " + error.message);
      return;
    }
    toast.success("Straat verwijderd");
    herlaad();
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-4xl px-4 py-5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Klantenlijst</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totaal} {totaal === 1 ? "klant" : "klanten"} in beeld
            {prijzenTonen && omzet > 0 ? ` · ${formatPrice(omzet)}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setKlantDialog({ open: true, customer: null })}>
              <Plus className="size-4" /> Klant
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStraatDialog({ open: true, street: null })}>
              <MapPin className="size-4" /> Straat
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/importeren">
                <Upload className="size-4" /> Importeren
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/printen" search={{ maand: filter === "alles" ? "even" : filter, prijzen: false }}>
                <Printer className="size-4" /> Printlijst
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["alles", "even", "oneven"] as MaandFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "alles" ? "Alles" : f === "even" ? "Even maand" : "Oneven maand"}
            </Button>
          ))}
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Zoek straat"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="prijzen" checked={prijzenTonen} onCheckedChange={setPrijzenTonen} />
          <Label htmlFor="prijzen" className="text-sm text-muted-foreground">
            Prijzen tonen
          </Label>
        </div>

        {(streetsQuery.isLoading || customersQuery.isLoading) && (
          <p className="text-sm text-muted-foreground">Laden…</p>
        )}

        {!streetsQuery.isLoading && streets.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen straten. Voeg er een toe of importeer je Excel-bestand.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" onClick={() => setStraatDialog({ open: true, street: null })}>
                Straat toevoegen
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/importeren">Excel importeren</Link>
              </Button>
            </div>
          </div>
        )}

        {groepen.map((g) => (
          <section key={g.street.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 bg-secondary px-4 py-2.5">
              <h2 className="flex-1 font-semibold text-secondary-foreground">{g.street.name}</h2>
              <span className="text-xs text-muted-foreground">{g.aantal}</span>
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                onClick={() => setKlantDialog({ open: true, customer: null, streetId: g.street.id })}
                aria-label="Klant toevoegen"
              >
                <Plus className="size-4" />
              </button>
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                onClick={() => setStraatDialog({ open: true, street: g.street })}
                aria-label="Straat bewerken"
              >
                <Pencil className="size-4" />
              </button>
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                onClick={() => verwijderStraat(g.street)}
                aria-label="Straat verwijderen"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-2">
              {(["even", "oneven"] as const).map((kant) => (
                <div key={kant} className="bg-card">
                  <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {kant === "even" ? "Even nummers" : "Oneven nummers"}
                  </p>
                  <ul className="divide-y divide-border">
                    {g[kant].length === 0 && (
                      <li className="px-4 py-3 text-sm text-muted-foreground">—</li>
                    )}
                    {g[kant].map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="w-12 font-medium tabular-nums">{formatNumber(c)}</span>
                        <span className="flex-1 truncate text-sm text-muted-foreground">{c.note}</span>
                        {c.frequency !== "elke" && (
                          <Badge variant="outline" className="text-[10px]">
                            {c.frequency}
                          </Badge>
                        )}
                        {prijzenTonen && (
                          <span className="tabular-nums text-sm">{formatPrice(c.price)}</span>
                        )}
                        <button
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                          onClick={() => setKlantDialog({ open: true, customer: c })}
                          aria-label="Klant bewerken"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                          onClick={() => verwijderKlant(c)}
                          aria-label="Klant verwijderen"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <KlantDialog
        open={klantDialog.open}
        onOpenChange={(open) => setKlantDialog((s) => ({ ...s, open }))}
        streets={streets}
        customer={klantDialog.customer}
        defaultStreetId={klantDialog.streetId}
        onSaved={herlaad}
      />
      <StraatDialog
        open={straatDialog.open}
        onOpenChange={(open) => setStraatDialog((s) => ({ ...s, open }))}
        street={straatDialog.street}
        onSaved={herlaad}
      />
    </div>
  );
}
