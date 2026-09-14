/**
 * Rollen maken en de rechten per rol aanvinken. Alleen voor de eigenaar; de
 * database weigert het voor iedereen anders.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bewaarRol, fetchRollen, RECHTEN, verwijderRol, type Recht, type Rol } from "@/lib/rechten";

export function RollenBeheer({ gebruikt, onGewijzigd }: { gebruikt: Map<string, number>; onGewijzigd: () => void }) {
  const rollen = useQuery({ queryKey: ["rollen"], queryFn: fetchRollen });
  const [nieuw, setNieuw] = useState(false);

  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">Rollen</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Een rol bepaalt wat een medewerker mag. De eigenaar mag altijd alles; een medewerker zonder rol niets.
        </p>
      </div>

      <div className="mt-3.5 grid gap-3">
        {rollen.isLoading && <p className="text-[13px] text-muted-foreground">Laden…</p>}
        {rollen.isError && <p className="text-[13px] text-tint-rood-ink">De rollen konden niet geladen worden.</p>}
        {rollen.data?.map((r) => (
          <RolKaart key={r.id} rol={r} aantal={gebruikt.get(r.id) ?? 0} onGewijzigd={onGewijzigd} />
        ))}
        {nieuw ? (
          <RolKaart
            rol={{ id: "", naam: "", rechten: ["planning", "klanten_bekijken"] }}
            aantal={0}
            onGewijzigd={onGewijzigd}
            onKlaar={() => setNieuw(false)}
          />
        ) : (
          <Button variant="outline" className="w-fit rounded-full" onClick={() => setNieuw(true)}>
            <Plus className="size-4" /> Nieuwe rol
          </Button>
        )}
      </div>
    </section>
  );
}

function RolKaart({
  rol,
  aantal,
  onGewijzigd,
  onKlaar,
}: {
  rol: Rol;
  aantal: number;
  onGewijzigd: () => void;
  onKlaar?: () => void;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [naam, setNaam] = useState(rol.naam);
  const [rechten, setRechten] = useState<Recht[]>(rol.rechten);
  const [bezig, setBezig] = useState(false);

  const gewijzigd =
    !rol.id ||
    naam.trim() !== rol.naam ||
    rechten.length !== rol.rechten.length ||
    rechten.some((r) => !rol.rechten.includes(r));

  async function bewaar() {
    setBezig(true);
    try {
      await bewaarRol({ ...(rol.id ? { id: rol.id } : {}), naam, rechten });
      toast.success(rol.id ? "Rol bijgewerkt" : "Rol gemaakt");
      await qc.invalidateQueries({ queryKey: ["rollen"] });
      onGewijzigd();
      onKlaar?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setBezig(false);
  }

  async function weg() {
    const ja = await bevestig({
      titel: `Rol "${rol.naam}" verwijderen?`,
      tekst:
        aantal > 0
          ? `${aantal} ${aantal === 1 ? "medewerker heeft" : "medewerkers hebben"} deze rol en ${aantal === 1 ? "houdt" : "houden"} dan geen rechten over.`
          : "Niemand heeft deze rol.",
      gevaarlijk: true,
    });
    if (!ja) return;
    setBezig(true);
    try {
      await verwijderRol(rol.id);
      toast.success("Rol verwijderd");
      await qc.invalidateQueries({ queryKey: ["rollen"] });
      onGewijzigd();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setBezig(false);
  }

  return (
    <div className="rounded-[14px] border border-border/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-[220px]"
          placeholder="Naam van de rol, bv. Wasser"
          value={naam}
          maxLength={60}
          onChange={(e) => setNaam(e.target.value)}
          aria-label="Naam van de rol"
        />
        {rol.id && (
          <span className="text-[12px] text-muted-foreground">
            {aantal} {aantal === 1 ? "medewerker" : "medewerkers"}
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          {rol.id ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-full text-muted-foreground hover:text-destructive"
              disabled={bezig}
              onClick={() => void weg()}
              aria-label={`Rol ${rol.naam} verwijderen`}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={onKlaar}>
              Annuleren
            </Button>
          )}
          <Button size="sm" className="h-8 rounded-full" disabled={bezig || !gewijzigd || !naam.trim()} onClick={() => void bewaar()}>
            {bezig && <Loader2 className="size-3.5 animate-spin" />}
            {rol.id ? "Bewaren" : "Rol maken"}
          </Button>
        </div>
      </div>
      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {RECHTEN.map((r) => (
          <label key={r.sleutel} className="flex cursor-pointer items-start gap-2 rounded-[10px] px-1.5 py-1 hover:bg-accent/50">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-foreground"
              checked={rechten.includes(r.sleutel)}
              onChange={(e) =>
                setRechten((was) => (e.target.checked ? [...was, r.sleutel] : was.filter((x) => x !== r.sleutel)))
              }
            />
            <span>
              <span className="block text-[13px] font-medium leading-tight">{r.label}</span>
              <span className="block text-[11.5px] text-muted-foreground">{r.uitleg}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
