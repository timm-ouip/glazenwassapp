/**
 * Rollen maken en de rechten per rol aanvinken. Alleen voor de eigenaar; de
 * database weigert het voor iedereen anders.
 */
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconChevronDown as ChevronDown,
  IconInfoCircle as Info,
  IconLoader2 as Loader2,
  IconPlus as Plus,
  IconTrash as Trash2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { bewaarRol, fetchRollen, RECHTEN, verwijderRol, type Recht, type Rol } from "@/lib/rechten";

export function RollenBeheer({
  gebruikt,
  onGewijzigd,
}: {
  gebruikt: Map<string, number>;
  onGewijzigd: () => void;
}) {
  const rollen = useQuery({ queryKey: ["rollen"], queryFn: fetchRollen });
  const [nieuw, setNieuw] = useState(false);

  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em]">Rollen</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Een rol bepaalt wat een medewerker mag. De eigenaar mag altijd alles; een medewerker
          zonder rol niets.
        </p>
      </div>

      <div className="mt-3.5 grid gap-3">
        {rollen.isLoading && <p className="text-[13px] text-muted-foreground">Laden…</p>}
        {rollen.isError && (
          <p className="text-[13px] text-tint-rood-ink">De rollen konden niet geladen worden.</p>
        )}
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
  // Acht vinkjes per rol maken van drie rollen een pagina schuiven. Ingeklapt
  // zie je de namen van de rechten op een regel; een nieuwe rol staat open,
  // want daar kom je juist voor.
  const [open, setOpen] = useState(!rol.id);
  // Zodat de knop kan zeggen wát hij open- en dichtklapt.
  const vinkjesId = useId();

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
          <Button
            size="sm"
            className="h-8 rounded-full"
            disabled={bezig || !gewijzigd || !naam.trim()}
            onClick={() => void bewaar()}
          >
            {bezig && <Loader2 className="size-3.5 animate-spin" />}
            {rol.id ? "Bewaren" : "Rol maken"}
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={vinkjesId}
        aria-label={`Rechten van ${naam.trim() || "deze rol"} tonen of verbergen`}
        onClick={() => setOpen((was) => !was)}
        className="mt-2 flex min-h-9 w-full items-center gap-2 rounded-[10px] px-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-accent/50"
      >
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="min-w-0 flex-1 truncate">
          {rechten.length === 0
            ? "Geen rechten"
            : RECHTEN.filter((r) => rechten.includes(r.sleutel))
                .map((r) => r.label)
                .join(" · ")}
        </span>
        <span className="shrink-0">
          {rechten.length} van {RECHTEN.length}
        </span>
      </button>
      <div id={vinkjesId} className={`mt-1 grid gap-1.5 sm:grid-cols-2 ${open ? "" : "hidden"}`}>
        {RECHTEN.map((r) => (
          <label
            key={r.sleutel}
            className="flex cursor-pointer items-start gap-2 rounded-[10px] px-1.5 py-1 hover:bg-accent/50"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-foreground"
              checked={rechten.includes(r.sleutel)}
              onChange={(e) => {
                const aan = e.target.checked;
                setRechten((was) => {
                  const nu = aan ? [...was, r.sleutel] : was.filter((x) => x !== r.sleutel);
                  return samenhang(nu, r.sleutel, aan);
                });
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[13px] font-medium leading-tight">
                {r.label}
                <RechtUitleg recht={r} />
              </span>
              <span className="block text-[11.5px] text-muted-foreground">{r.uitleg}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Rechten die op elkaar bouwen: klanten bewerken vraagt klanten bekijken,
 * afrekenen vraagt prijzen zien (zonder bedragen kun je niet afrekenen), en
 * oude avonden herstellen vraagt afrekenen. Aanzetten trekt mee aan wat
 * eronder ligt; uitzetten haalt weg wat erop bouwt.
 */
const VRAAGT: Partial<Record<Recht, Recht[]>> = {
  klanten_bewerken: ["klanten_bekijken"],
  afrekenen: ["prijzen_zien"],
  herstellen: ["afrekenen"],
};

function samenhang(rechten: Recht[], veranderd: Recht, aan: boolean): Recht[] {
  const uit = new Set(rechten);
  if (aan) {
    const rij = [veranderd];
    while (rij.length > 0) {
      for (const r of VRAAGT[rij.pop()!] ?? []) {
        if (!uit.has(r)) {
          uit.add(r);
          rij.push(r);
        }
      }
    }
  } else {
    let weg = true;
    while (weg) {
      weg = false;
      for (const r of uit) {
        if ((VRAAGT[r] ?? []).some((x) => !uit.has(x))) {
          uit.delete(r);
          weg = true;
        }
      }
    }
  }
  return [...uit];
}

/**
 * Het ⓘ-knopje naast een recht: wat je ermee kunt, wat niet, en wat er
 * vanzelf bij hoort. Een venster dat je aantikt, geen tooltip: zweven kan
 * niet op een telefoon. Een knop in een <label> zet het vinkje niet om.
 */
function RechtUitleg({ recht }: { recht: (typeof RECHTEN)[number] }) {
  const m: { kan: readonly string[]; niet: readonly string[]; nodig?: string } = recht.meer;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Uitleg bij ${recht.label}`}
          className="-m-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Info className="size-[15px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[min(320px,calc(100vw-32px))] space-y-2.5 text-[13px]"
      >
        <div className="font-medium">{recht.label}</div>
        <div>
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Hiermee kan hij
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {m.kan.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Niet
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {m.niet.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        {m.nodig && (
          <p className="rounded-[10px] bg-tint-amber px-2.5 py-1.5 text-[12.5px] text-tint-amber-ink">
            {m.nodig}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
