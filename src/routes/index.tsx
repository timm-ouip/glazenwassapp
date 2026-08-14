import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Printer,
  Upload,
  Pencil,
  Trash2,
  Search,
  GripVertical,
  ArrowUpNarrowWide,
  ArrowDownNarrowWide,
  Undo2,
  Droplets,
  Users,
  Euro,
  Milestone as Route2,
} from "lucide-react";

import { KlantDialog } from "@/components/KlantDialog";
import { StraatDialog } from "@/components/StraatDialog";
import { DubbeleStraten } from "@/components/DubbeleStraten";

import { WijkKiezer } from "@/components/WijkKiezer";
import { InlineCel } from "@/components/InlineCel";
import { pushUndo, undoLaatste, useLaatsteUndoLabel } from "@/lib/undo";
import { NotitieCel } from "@/components/NotitieCel";
import {
  addQuickNote,
  fetchCustomers,
  fetchDistricts,
  fetchQuickNotes,
  fetchStreets,
  formatNumber,
  formatPrice,
  matchesMaand,
  persistCustomerOrder,
  persistStreetOrder,
  setStreetSortDesc,
  sortCustomers,
  splitEvenOdd,
  type Customer,
  type District,
  type QuickNote,
  type Street,
} from "@/lib/klanten";

interface IndexSearch {
  wijk?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): IndexSearch =>
    typeof search["wijk"] === "string" && search["wijk"] ? { wijk: search["wijk"] } : {},
  head: () => ({
    meta: [
      { title: "Klantenlijst glazenwasser — straten, prijzen en maandplanning" },
      {
        name: "description",
        content:
          "Beheer je glazenwasklanten per straat in een compacte tabel, met prijzen, notities en een filter voor even of oneven maanden.",
      },
      { property: "og:title", content: "Klantenlijst glazenwasser" },
      {
        property: "og:description",
        content: "Klanten per straat, prijzen, notities en printlijsten voor even of oneven maanden.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type MaandFilter = "alles" | "even" | "oneven";

function Index() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { wijk } = Route.useSearch();
  const [filter, setFilter] = useState<MaandFilter>("alles");
  const [zoek, setZoek] = useState("");
  const [prijzenTonen, setPrijzenTonen] = useState(true);
  const [compact, setCompact] = useState(true);
  const [selectie, setSelectie] = useState<string[]>([]);
  const [sleep, setSleep] = useState<string | null>(null);
  const [klantDialog, setKlantDialog] = useState<{ open: boolean; customer: Customer | null; streetId?: string }>({
    open: false,
    customer: null,
  });
  const [straatDialog, setStraatDialog] = useState<{ open: boolean; street: Street | null }>({
    open: false,
    street: null,
  });

  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streetsQuery = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const quickNotesQuery = useQuery({ queryKey: ["quick_notes"], queryFn: fetchQuickNotes });

  const districts: District[] = districtsQuery.data ?? [];
  const actieveWijk = districts.find((d) => d.id === wijk)?.id ?? districts[0]?.id ?? null;

  useEffect(() => {
    if (actieveWijk && wijk !== actieveWijk) {
      void navigate({ to: "/", search: { wijk: actieveWijk }, replace: true });
    }
  }, [actieveWijk, wijk, navigate]);

  const alleStraten = streetsQuery.data ?? [];
  const streets = alleStraten.filter((s) => s.district_id === actieveWijk);
  const customers = customersQuery.data ?? [];
  const quickNotes = quickNotesQuery.data ?? [];
  const undoLabel = useLaatsteUndoLabel();

  function herlaad() {
    qc.invalidateQueries({ queryKey: ["districts"] });
    qc.invalidateQueries({ queryKey: ["streets"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function doeUndo() {
    const label = await undoLaatste();
    if (label) toast.success("Teruggedraaid: " + label);
    else toast("Niets om terug te draaien");
  }

  function meldUndo(bericht: string) {
    toast(bericht, { action: { label: "Ongedaan maken", onClick: () => void doeUndo() } });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const doel = e.target as HTMLElement | null;
      const tikt = doel && (doel.tagName === "INPUT" || doel.tagName === "TEXTAREA" || doel.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !tikt) {
        e.preventDefault();
        void doeUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groepen = useMemo(() => {
    const term = zoek.trim().toLowerCase();
    return streets
      .filter((s) => !term || s.name.toLowerCase().includes(term))
      .map((s) => {
        const order: "asc" | "desc" = s.sort_desc ? "desc" : "asc";
        const klanten = customers.filter((c) => c.street_id === s.id && matchesMaand(c.frequency, filter));
        return {
          street: s,
          ...splitEvenOdd(klanten, order),
          aantal: klanten.length,
          totaal: klanten.reduce((sum, c) => sum + c.price, 0),
        };
      });
  }, [streets, customers, filter, zoek]);

  const totaal = groepen.reduce((sum, g) => sum + g.aantal, 0);
  const omzet = groepen.reduce((sum, g) => sum + g.totaal, 0);

  async function patchKlant(c: Customer, patch: Partial<Customer>) {
    const vorige: Partial<Customer> = {};
    for (const key of Object.keys(patch) as (keyof Customer)[]) {
      (vorige as Record<string, unknown>)[key] = c[key];
    }
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((x) => (x.id === c.id ? { ...x, ...patch } : x)),
    );
    const { error } = await supabase.from("customers").update(patch).eq("id", c.id);
    if (error) {
      toast.error("Opslaan mislukt: " + error.message);
      qc.invalidateQueries({ queryKey: ["customers"] });
      return;
    }
    pushUndo({
      label: `Wijziging ${formatNumber(c)}`,
      undo: async () => {
        await supabase.from("customers").update(vorige).eq("id", c.id);
        herlaad();
      },
    });
  }

  async function nieuweSnelkeuze(label: string) {
    try {
      await addQuickNote(label);
      qc.invalidateQueries({ queryKey: ["quick_notes"] });
      toast.success("Snelkeuze toegevoegd");
    } catch (e) {
      toast.error("Toevoegen mislukt: " + (e as Error).message);
    }
  }

  async function verwijderKlant(c: Customer) {
    if (!confirm(`Klant ${formatNumber(c)} verwijderen?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) {
      toast.error("Verwijderen mislukt: " + error.message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${formatNumber(c)}`,
      undo: async () => {
        await supabase.from("customers").insert(c);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`Klant ${formatNumber(c)} verwijderd`);
  }

  async function verwijderStraat(s: Street) {
    if (!confirm(`Straat "${s.name}" en alle klanten daarin verwijderen?`)) return;
    const klantenInStraat = customers.filter((c) => c.street_id === s.id);
    const { error } = await supabase.from("streets").delete().eq("id", s.id);
    if (error) {
      toast.error("Verwijderen mislukt: " + error.message);
      return;
    }
    pushUndo({
      label: `Verwijderen ${s.name}`,
      undo: async () => {
        await supabase.from("streets").insert(s);
        if (klantenInStraat.length > 0) await supabase.from("customers").insert(klantenInStraat);
        herlaad();
      },
    });
    herlaad();
    meldUndo(`Straat "${s.name}" verwijderd`);
  }

  async function nieuweRegel(streetId: string, nummer: string) {
    const huisnummer = parseInt(nummer, 10);
    if (Number.isNaN(huisnummer)) return;
    const max = Math.max(0, ...customers.filter((c) => c.street_id === streetId).map((c) => c.sort_order));
    const { data, error } = await supabase
      .from("customers")
      .insert({ street_id: streetId, house_number: huisnummer, sort_order: max + 1 })
      .select("id")
      .single();
    if (error) {
      toast.error("Toevoegen mislukt: " + error.message);
      return;
    }
    const nieuwId = (data as { id: string } | null)?.id;
    if (nieuwId) {
      pushUndo({
        label: `Toevoegen nr ${huisnummer}`,
        undo: async () => {
          await supabase.from("customers").delete().eq("id", nieuwId);
          herlaad();
        },
      });
    }
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function nieuweStraat(naam: string) {
    if (!actieveWijk) {
      toast.error("Maak eerst een wijk aan.");
      return;
    }
    const max = Math.max(0, ...streets.map((s) => s.sort_order));
    const { data, error } = await supabase
      .from("streets")
      .insert({ name: naam.trim(), sort_order: max + 1, district_id: actieveWijk })
      .select("id")
      .single();
    if (error) {
      toast.error("Toevoegen mislukt: " + error.message);
      return;
    }
    const nieuwId = (data as { id: string } | null)?.id;
    if (nieuwId) {
      pushUndo({
        label: `Toevoegen straat ${naam.trim()}`,
        undo: async () => {
          await supabase.from("streets").delete().eq("id", nieuwId);
          herlaad();
        },
      });
    }
    qc.invalidateQueries({ queryKey: ["streets"] });
  }

  async function wisselSort(s: Street) {
    const nieuw = !s.sort_desc;
    qc.setQueryData<Street[]>(["streets"], (old) =>
      (old ?? []).map((x) => (x.id === s.id ? { ...x, sort_desc: nieuw } : x)),
    );
    try {
      await setStreetSortDesc(s.id, nieuw);
      pushUndo({
        label: `Sortering ${s.name}`,
        undo: async () => {
          await setStreetSortDesc(s.id, s.sort_desc);
          herlaad();
        },
      });
    } catch (e) {
      toast.error("Opslaan mislukt: " + (e as Error).message);
      herlaad();
    }
  }

  function klikSelectie(c: Customer, shift: boolean) {
    const lijst = sortCustomers(customers.filter((x) => x.street_id === c.street_id)).map((x) => x.id);
    setSelectie((huidig) => {
      if (!shift) return huidig.includes(c.id) && huidig.length === 1 ? [] : [c.id];
      const anker = huidig.find((id) => lijst.includes(id));
      if (!anker) return [c.id];
      const a = lijst.indexOf(anker);
      const b = lijst.indexOf(c.id);
      return lijst.slice(Math.min(a, b), Math.max(a, b) + 1);
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function onDragStart(e: DragStartEvent) {
    setSleep(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setSleep(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;

    if (activeId.startsWith("s:")) {
      if (!overId.startsWith("s:")) return;
      const ids = streets.map((s) => s.id);
      const from = ids.indexOf(activeId.slice(2));
      const to = ids.indexOf(overId.slice(2));
      if (from < 0 || to < 0) return;
      const next = [...streets];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
        const vorigeVolgorde = streets.map((s) => ({ ...s }));
      qc.setQueryData<Street[]>(["streets"], next.map((s, i) => ({ ...s, sort_order: i + 1 })));
      await persistStreetOrder(next);
      pushUndo({
        label: "Straatvolgorde",
        undo: async () => {
          await persistStreetOrder(vorigeVolgorde);
          herlaad();
        },
      });
      qc.invalidateQueries({ queryKey: ["streets"] });
      return;
    }

    if (!activeId.startsWith("c:")) return;
    const dragged = customers.find((c) => c.id === activeId.slice(2));
    if (!dragged) return;

    let doelStraat: string | null = null;
    let overKlant: Customer | null = null;
    if (overId.startsWith("c:")) {
      overKlant = customers.find((c) => c.id === overId.slice(2)) ?? null;
      doelStraat = overKlant?.street_id ?? null;
    } else if (overId.startsWith("z:")) {
      doelStraat = overId.slice(2);
    }
    if (!doelStraat) return;

    const verplaatst = selectie.includes(dragged.id)
      ? sortCustomers(customers.filter((c) => selectie.includes(c.id)))
      : [dragged];
    const verplaatstIds = new Set(verplaatst.map((c) => c.id));

    const doelLijst = sortCustomers(
      customers.filter((c) => c.street_id === doelStraat && !verplaatstIds.has(c.id)),
    );
    const index = overKlant ? doelLijst.findIndex((c) => c.id === overKlant!.id) : doelLijst.length;
    const nieuw = [...doelLijst];
    nieuw.splice(index < 0 ? doelLijst.length : index, 0, ...verplaatst);

    const updates = nieuw.map((c, i) => ({ id: c.id, street_id: doelStraat!, sort_order: i + 1 }));
    qc.setQueryData<Customer[]>(["customers"], (old) =>
      (old ?? []).map((c) => {
        const u = updates.find((x) => x.id === c.id);
        return u ? { ...c, street_id: u.street_id, sort_order: u.sort_order } : c;
      }),
    );
    const vorigePlek = [...verplaatst, ...doelLijst].map((c) => ({
      id: c.id,
      street_id: c.street_id,
      sort_order: c.sort_order,
    }));
    await persistCustomerOrder(updates);
    pushUndo({
      label: "Verplaatsing",
      undo: async () => {
        await persistCustomerOrder(vorigePlek);
        herlaad();
      },
    });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  const rowText = compact ? "text-[12px]" : "text-[13px]";
  const rowPad = compact ? "py-[2px]" : "py-1";

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1600px] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-card">
              <Droplets className="size-5" />
            </div>
            <div className="mr-auto min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-foreground">Klantenlijst</h1>
              <p className="text-xs text-muted-foreground">Glazenwasser · routebeheer</p>
            </div>
            <WijkKiezer
              districts={districts}
              activeId={actieveWijk}
              onSelect={(id) => void navigate({ to: "/", search: { wijk: id } })}
              onChanged={() => qc.invalidateQueries({ queryKey: ["districts"] })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!undoLabel}
                onClick={() => void doeUndo()}
                title={undoLabel ? `Ongedaan maken: ${undoLabel}` : "Niets om terug te draaien"}
              >
                <Undo2 className="size-4" /> Ongedaan
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/importeren">
                  <Upload className="size-4" /> Importeren
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link
                  to="/printen"
                  search={{
                    wijk: actieveWijk ?? "",
                    maand: filter === "alles" ? "even" : filter,
                    prijzen: false,
                    liggend: true,
                    kolommen: 4,
                  }}
                >
                  <Printer className="size-4" /> Printlijst
                </Link>
              </Button>
              <Button
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={() => setKlantDialog({ open: true, customer: null })}
              >
                <Plus className="size-4" /> Klant
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Klanten in beeld", waarde: String(totaal), icon: Users },
              { label: "Straten", waarde: String(groepen.length), icon: Route2 },
              { label: "Omzet per ronde", waarde: formatPrice(omzet), icon: Euro, verberg: !prijzenTonen },
            ]
              .filter((s) => !s.verberg)
              .map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-card"
                >
                  <s.icon className="size-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <p className="font-display text-base font-semibold tabular-nums text-foreground">{s.waarde}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] space-y-3 px-5 py-4">
        <div className="sticky top-0 z-20 -mx-5 flex flex-wrap items-center gap-3 border-b border-border/70 bg-background/85 px-5 py-2.5 backdrop-blur">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-card">
            {(["alles", "even", "oneven"] as MaandFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-brand text-brand-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "alles" ? "Alles" : f === "even" ? "Even maand" : "Oneven maand"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="prijzen" checked={prijzenTonen} onCheckedChange={setPrijzenTonen} />
            <Label htmlFor="prijzen" className="text-sm text-muted-foreground">
              Prijzen
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="compact" checked={compact} onCheckedChange={setCompact} />
            <Label htmlFor="compact" className="text-sm text-muted-foreground">
              Extra compact
            </Label>
          </div>
          <div className="relative ml-auto w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="bg-card pl-8" placeholder="Zoek straat" value={zoek} onChange={(e) => setZoek(e.target.value)} />
          </div>
        </div>


        {selectie.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {selectie.length} regels geselecteerd — sleep er één om ze samen te verplaatsen.{" "}
            <button className="underline" onClick={() => setSelectie([])}>
              selectie wissen
            </button>
          </p>
        )}

        <DubbeleStraten streets={streets} customers={customers} onDone={herlaad} />

        {(streetsQuery.isLoading || customersQuery.isLoading) && (
          <p className="text-sm text-muted-foreground">Laden…</p>
        )}


        {!streetsQuery.isLoading && districts.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen wijken. Maak hierboven eerst een wijk aan.
            </p>
          </div>
        )}

        {!streetsQuery.isLoading && districts.length > 0 && streets.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nog geen straten in deze wijk. Typ hieronder een straatnaam of importeer je Excel-bestand.
            </p>
            <div className="mt-4 flex justify-center">
              <Button size="sm" variant="outline" asChild>
                <Link to="/importeren">Excel importeren</Link>
              </Button>
            </div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={groepen.map((g) => `s:${g.street.id}`)} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groepen.map((g) => (
                <StraatBlok
                  key={g.street.id}
                  street={g.street}
                  even={g.even}
                  oneven={g.oneven}
                  aantal={g.aantal}
                  totaal={g.totaal}
                  sort={g.street.sort_desc ? "desc" : "asc"}
                  prijzenTonen={prijzenTonen}
                  quickNotes={quickNotes}
                  rowText={rowText}
                  rowPad={rowPad}
                  selectie={selectie}
                  onSelect={klikSelectie}
                  onPatch={patchKlant}
                  onAddQuickNote={nieuweSnelkeuze}
                  onDelete={verwijderKlant}
                  onNieuweRegel={nieuweRegel}
                  onEditStreet={() => setStraatDialog({ open: true, street: g.street })}
                  onDeleteStreet={() => verwijderStraat(g.street)}
                  onAddKlant={() => setKlantDialog({ open: true, customer: null, streetId: g.street.id })}
                  onToggleSort={() => void wisselSort(g.street)}
                />
              ))}
              {districts.length > 0 && (
                <NieuweStraat onSubmit={nieuweStraat} />
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {sleep ? (
              <div className="rounded border border-primary bg-card px-2 py-1 text-xs shadow-lg">
                {sleep.startsWith("s:") ? "Straat verplaatsen" : `${selectie.length > 1 ? selectie.length : 1} regel(s)`}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <KlantDialog
        open={klantDialog.open}
        onOpenChange={(open) => setKlantDialog((s) => ({ ...s, open }))}
        streets={streets}
        customer={klantDialog.customer}
        defaultStreetId={klantDialog.streetId}
        quickNotes={quickNotes}
        onAddQuickNote={nieuweSnelkeuze}
        onSaved={herlaad}
      />
      <StraatDialog
        districtId={actieveWijk ?? undefined}
        open={straatDialog.open}
        onOpenChange={(open) => setStraatDialog((s) => ({ ...s, open }))}
        street={straatDialog.street}
        onSaved={herlaad}
      />
    </div>
  );
}

interface BlokProps {
  street: Street;
  even: Customer[];
  oneven: Customer[];
  aantal: number;
  totaal: number;
  sort: "asc" | "desc";
  prijzenTonen: boolean;
  quickNotes: QuickNote[];
  rowText: string;
  rowPad: string;
  selectie: string[];
  onSelect: (c: Customer, shift: boolean) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
  onNieuweRegel: (streetId: string, nummer: string) => void;
  onEditStreet: () => void;
  onDeleteStreet: () => void;
  onAddKlant: () => void;
  onToggleSort: () => void;
}

function StraatBlok(p: BlokProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `s:${p.street.id}`,
  });
  const { setNodeRef: setZoneRef } = useDroppable({ id: `z:${p.street.id}` });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`overflow-hidden rounded border border-border bg-card ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-1 bg-secondary px-2 py-1">
        <button
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent active:cursor-grabbing"
          aria-label="Straat verslepen"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <h2 className="flex-1 truncate text-[13px] font-semibold uppercase tracking-wide text-secondary-foreground">
          {p.street.name}
        </h2>
        <span className="text-[11px] text-muted-foreground">{p.aantal}</span>
        {p.prijzenTonen && (
          <span className="text-[11px] tabular-nums text-muted-foreground">{formatPrice(p.totaal)}</span>
        )}
        <button
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={p.onToggleSort}
          aria-label={p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"}
          title={p.sort === "asc" ? "Hoge nummers bovenaan" : "Lage nummers bovenaan"}
        >
          {p.sort === "asc" ? <ArrowUpNarrowWide className="size-3.5" /> : <ArrowDownNarrowWide className="size-3.5" />}
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={p.onAddKlant} aria-label="Klant toevoegen">
          <Plus className="size-3.5" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={p.onEditStreet} aria-label="Straat bewerken">
          <Pencil className="size-3.5" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={p.onDeleteStreet} aria-label="Straat verwijderen">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div ref={setZoneRef} className="grid grid-cols-2 gap-px bg-border">
        {(["even", "oneven"] as const).map((kant) => (
          <div key={kant} className="bg-card">
            <div className="flex items-center gap-0.5 border-b border-border/60 px-1 py-0.5 text-[10px] text-muted-foreground">
              <span className="w-4" />
              <span className="w-9">nr</span>
              <span className="min-w-0 flex-1">note</span>
              {p.prijzenTonen && <span className="w-12 text-right">prijs</span>}
              <span className="min-w-[3.25rem] max-w-[4rem] text-center">freq</span>
              <span className="w-4" />
            </div>
            <SortableContext
              items={p[kant].map((c) => `c:${c.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {p[kant].map((c) => (
                <KlantRij
                  key={c.id}
                  customer={c}
                  prijzenTonen={p.prijzenTonen}
                  quickNotes={p.quickNotes}
                  rowText={p.rowText}
                  rowPad={p.rowPad}
                  geselecteerd={p.selectie.includes(c.id)}
                  onSelect={p.onSelect}
                  onPatch={p.onPatch}
                  onAddQuickNote={p.onAddQuickNote}
                  onDelete={p.onDelete}
                />
              ))}
            </SortableContext>
            {kant === "even" && (
              <NieuweRegel onSubmit={(nr) => p.onNieuweRegel(p.street.id, nr)} rowText={p.rowText} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

interface RijProps {
  customer: Customer;
  prijzenTonen: boolean;
  quickNotes: QuickNote[];
  rowText: string;
  rowPad: string;
  geselecteerd: boolean;
  onSelect: (c: Customer, shift: boolean) => void;
  onPatch: (c: Customer, patch: Partial<Customer>) => void;
  onAddQuickNote: (label: string) => void;
  onDelete: (c: Customer) => void;
}

function KlantRij({
  customer: c,
  prijzenTonen,
  quickNotes,
  rowText,
  rowPad,
  geselecteerd,
  onSelect,
  onPatch,
  onAddQuickNote,
  onDelete,
}: RijProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `c:${c.id}` });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group flex items-center gap-0.5 border-b border-border/60 px-0.5 ${rowPad} ${rowText} ${
        isDragging ? "opacity-40" : ""
      } ${geselecteerd ? "bg-accent" : ""}`}
    >
      <button
        className="cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        aria-label="Regel verslepen"
        onClick={(e) => onSelect(c, e.shiftKey)}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <div className="w-9 shrink-0">
        <InlineCel
          value={`${c.house_number}${c.addition ?? ""}`}
          align="left"
          className="font-medium"
          onCommit={(v) => {
            const m = /^(\d+)\s*(.*)$/.exec(v.trim());
            if (!m) return;
            onPatch(c, { house_number: parseInt(m[1]!, 10), addition: (m[2] ?? "").trim() });
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <NotitieCel
          value={c.note}
          quickNotes={quickNotes}
          onChange={(v) => onPatch(c, { note: v })}
          onAddQuickNote={onAddQuickNote}
        />
      </div>
      {prijzenTonen && (
        <div className={`w-16 shrink-0 ${c.price === 0 ? "text-red-600" : ""}`}>
          <InlineCel
            value={formatPrice(c.price)}
            align="right"
            inputMode="decimal"
            placeholder={formatPrice(0)}
            onCommit={(v) => onPatch(c, { price: Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })}
          />
        </div>
      )}
      <select
        value={c.frequency}
        onChange={(e) => onPatch(c, { frequency: e.target.value as Customer["frequency"] })}
        className="min-w-[3.25rem] max-w-[4rem] shrink-0 cursor-pointer appearance-none bg-transparent text-center text-[10px] text-muted-foreground focus:outline-none"
        aria-label="Frequentie"
      >
        <option value="elke">Elke</option>
        <option value="even">Even</option>
        <option value="oneven">Oneven</option>
      </select>
      <button
        className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive"
        onClick={() => onDelete(c)}
        aria-label="Klant verwijderen"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function NieuweStraat({ onSubmit }: { onSubmit: (naam: string) => void }) {
  const [waarde, setWaarde] = useState("");
  return (
    <div className="rounded border border-dashed border-border bg-card/50">
      <input
        className="w-full bg-transparent px-2 py-2 text-[13px] uppercase tracking-wide text-muted-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70 focus:bg-accent/40 focus:outline-none"
        placeholder="+ nieuwe straat"
        value={waarde}
        onChange={(e) => setWaarde(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && waarde.trim()) {
            onSubmit(waarde.trim());
            setWaarde("");
          }
        }}
        onBlur={() => {
          if (waarde.trim()) {
            onSubmit(waarde.trim());
            setWaarde("");
          }
        }}
      />
    </div>
  );
}

function NieuweRegel({ onSubmit, rowText }: { onSubmit: (nr: string) => void; rowText: string }) {
  const [waarde, setWaarde] = useState("");
  return (
    <input
      className={`w-full bg-transparent px-1.5 py-1 ${rowText} text-muted-foreground placeholder:text-muted-foreground/50 focus:bg-accent/40 focus:outline-none`}
      placeholder="+ nummer"
      inputMode="numeric"
      value={waarde}
      onChange={(e) => setWaarde(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && waarde.trim()) {
          onSubmit(waarde.trim());
          setWaarde("");
        }
      }}
      onBlur={() => {
        if (waarde.trim()) {
          onSubmit(waarde.trim());
          setWaarde("");
        }
      }}
    />
  );
}
