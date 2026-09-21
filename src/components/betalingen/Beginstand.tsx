import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconCheck as Check,
  IconCash as Cash,
  IconCalendar as CalendarDays,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchCustomers,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  formatPrice,
  sortCustomers,
  type Customer,
  type District,
} from "@/lib/klanten";
import {
  dagKort,
  effectieveMethode,
  fetchGeldStandWijk,
  frequentieKort,
  startWijk,
  zetBeginstand,
  zetWijkKlaar,
  type GeldStand,
} from "@/lib/betalingen";
import { vandaag } from "@/lib/wasdag";
import { useAuth } from "@/lib/auth";

/** Voor hoeveel wasbeurten een bedrag staat, bij deze prijs. */
function aantalVoor(bedrag: number, prijs: number): number {
  if (prijs <= 0) return 1;
  return Math.max(1, Math.round(bedrag / prijs));
}

function leesBedrag(tekst: string): number | null {
  const schoon = tekst.replace(/[€\s]/g, "").replace(",", ".");
  if (schoon === "") return 0;
  const n = Number(schoon);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function statusVan(d: District): "nieuw" | "bezig" | "klaar" {
  if (d.geld_klaar_op) return "klaar";
  if (d.geld_peildatum) return "bezig";
  return "nieuw";
}

const STATUS_STIP: Record<ReturnType<typeof statusVan>, string> = {
  nieuw: "bg-muted-foreground/30",
  bezig: "bg-tint-amber-ink",
  klaar: "bg-tint-groen-ink",
};

/**
 * De pof van de papieren kaarten, één keer per wijk ingevuld. Tot en met de
 * gekozen dag zit alles daarin; daarna rekent Wooshy zelf.
 */
export function Beginstand({
  wijkId,
  onWijk,
}: {
  wijkId: string | undefined;
  onWijk: (id: string) => void;
}) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });

  const wijken = useMemo(() => districts.data ?? [], [districts.data]);
  const wijk = wijken.find((d) => d.id === wijkId) ?? null;

  // Eén keer opzoeken in plaats van per regel door alle lijsten te lopen.
  const inWijk = useMemo(() => {
    const straten = (streets.data ?? []).filter((s) => s.district_id === wijkId);
    const ids = new Set(straten.map((s) => s.id));
    return { straten, adressen: (customers.data ?? []).filter((c) => ids.has(c.street_id)) };
  }, [streets.data, customers.data, wijkId]);
  const namen = useMemo(
    () => new Map((klanten.data ?? []).map((k) => [k.id, k.naam])),
    [klanten.data],
  );

  // Zonder keuze: de eerste wijk die nog niet klaar is.
  useEffect(() => {
    if (wijkId || wijken.length === 0) return;
    const eerste = wijken.find((d) => d.betaalmethode === "contant" && !d.geld_klaar_op);
    onWijk((eerste ?? wijken[0]!).id);
  }, [wijkId, wijken, onWijk]);

  const stand = useQuery({
    queryKey: ["geld-stand", wijkId],
    queryFn: () => fetchGeldStandWijk(wijkId!),
    enabled: !!wijkId && !!wijk?.geld_peildatum,
  });

  const vernieuw = () => {
    void qc.invalidateQueries({ queryKey: ["districts"] });
    void qc.invalidateQueries({ queryKey: ["geld-stand", wijkId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {wijken.map((d) => {
          const aan = d.id === wijkId;
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={aan}
              onClick={() => onWijk(d.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${
                aan
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`size-1.5 rounded-full ${STATUS_STIP[statusVan(d)]}`} />
              {d.name}
              {d.betaalmethode === "overmaken" && (
                <span className="text-[11px] opacity-70">overmaken</span>
              )}
            </button>
          );
        })}
      </div>

      {!wijk ? null : !wijk.geld_peildatum ? (
        <Starten wijk={wijk} magStarten={isEigenaar} onGestart={vernieuw} />
      ) : (
        <Invullen
          wijk={wijk}
          customers={inWijk.adressen}
          straten={inWijk.straten}
          naamVan={(id) => namen.get(id) ?? ""}
          stand={stand.data ?? []}
          laden={stand.isLoading}
          magBewerken={isEigenaar}
          onVeranderd={vernieuw}
        />
      )}
    </div>
  );
}

function Starten({
  wijk,
  magStarten,
  onGestart,
}: {
  wijk: District;
  magStarten: boolean;
  onGestart: () => void;
}) {
  const [datum, setDatum] = useState(vandaag());
  const [bezig, setBezig] = useState(false);

  async function begin() {
    setBezig(true);
    try {
      await startWijk(wijk.id, datum);
      onGestart();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="max-w-xl rounded-[18px] border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex size-10 items-center justify-center rounded-[12px] bg-tint-groen text-tint-groen-ink">
        <Cash className="size-5" />
      </div>
      <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">
        Beginstand van {wijk.name}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Neem de kaarten van deze wijk erbij en vul per adres in wat er nog open staat. Alles tot en
        met de dag hieronder zit in die beginstand. Vanaf de dag erna telt Wooshy zelf: elke
        afgemelde wasbeurt en klus komt erbij, elke betaling gaat eraf.
      </p>
      {wijk.betaalmethode === "overmaken" && (
        <p className="mt-2 text-[13px] text-tint-amber-ink">
          Deze wijk maakt over. Alleen de adressen die je zelf op contant zet, komen in de
          beginstand.
        </p>
      )}
      {magStarten ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-[12.5px] text-muted-foreground">
            Stand van de kaarten op
            <Input
              type="date"
              className="mt-1 w-44 rounded-full"
              max={vandaag()}
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
          <Button className="rounded-full" disabled={bezig || !datum} onClick={() => void begin()}>
            {bezig ? "Bezig…" : "Beginnen"}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">De eigenaar vult de beginstand in.</p>
      )}
    </section>
  );
}

function Invullen({
  wijk,
  customers,
  straten,
  naamVan,
  stand,
  laden,
  magBewerken,
  onVeranderd,
}: {
  wijk: District;
  customers: Customer[];
  straten: { id: string; name: string; sort_order: number }[];
  naamVan: (klantId: string) => string;
  stand: GeldStand[];
  laden: boolean;
  magBewerken: boolean;
  onVeranderd: () => void;
}) {
  const standVan = useMemo(() => new Map(stand.map((s) => [s.id, s])), [stand]);
  const [invoer, setInvoer] = useState<Record<string, string>>({});
  const [bezigKlaar, setBezigKlaar] = useState(false);
  const [datumOpen, setDatumOpen] = useState(false);
  const [nieuweDatum, setNieuweDatum] = useState(wijk.geld_peildatum ?? vandaag());

  /** Vakjes waar je in typt en die nog niet bewaard zijn: die laat een
   *  verse stand uit de database met rust. */
  const bezigMet = useRef(new Set<string>());

  // Wat er opgeslagen is, als tekst in het vakje. Opnieuw zodra de database
  // iets anders zegt (na opslaan, of een andere wijk), behalve waar je nog
  // aan het typen bent.
  useEffect(() => {
    setInvoer((was) => {
      const uit: Record<string, string> = {};
      for (const s of stand) {
        if (s.beginstand) uit[s.id] = String(s.beginstand.bedrag).replace(".", ",");
      }
      for (const id of bezigMet.current) if (was[id] !== undefined) uit[id] = was[id];
      return uit;
    });
  }, [stand]);

  const perStraat = useMemo(
    () =>
      [...straten]
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((s) => ({
          straat: s,
          adressen: sortCustomers(customers.filter((c) => c.street_id === s.id)),
        }))
        .filter((g) => g.adressen.length > 0),
    [straten, customers],
  );

  const contant = customers.filter((c) => effectieveMethode(c, wijk) === "contant");
  const totaal = stand.reduce((t, s) => t + (s.beginstand?.bedrag ?? 0), 0);
  const metPof = stand.filter((s) => (s.beginstand?.bedrag ?? 0) > 0).length;

  async function bewaar(c: Customer) {
    const tekst = invoer[c.id] ?? "";
    const bedrag = leesBedrag(tekst);
    if (bedrag === null) {
      toast.error(`Nummer ${c.house_number}${c.addition}: dat is geen bedrag.`);
      return;
    }
    const was = standVan.get(c.id)?.beginstand?.bedrag ?? 0;
    if (Math.abs(bedrag - was) < 0.005) {
      bezigMet.current.delete(c.id);
      return;
    }
    try {
      await zetBeginstand(c.id, bedrag, aantalVoor(bedrag, c.price));
      bezigMet.current.delete(c.id);
      onVeranderd();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function volgende(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const alle = [...document.querySelectorAll<HTMLInputElement>("input[data-beginstand]")];
    const i = alle.indexOf(e.currentTarget);
    (alle[i + 1] ?? e.currentTarget).focus();
    alle[i + 1]?.select();
  }

  async function klaar(aan: boolean) {
    setBezigKlaar(true);
    try {
      await zetWijkKlaar(wijk.id, aan);
      onVeranderd();
      toast.success(
        aan
          ? `${wijk.name} is klaar: je kunt hem vrijgeven voor geldlopen.`
          : `${wijk.name} staat weer open om in te vullen.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezigKlaar(false);
    }
  }

  async function verzetDatum() {
    try {
      await startWijk(wijk.id, nieuweDatum);
      setDatumOpen(false);
      onVeranderd();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border border-border bg-card px-4 py-3 shadow-card">
        <div className="flex items-center gap-2 text-[13px]">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Stand van de kaarten:</span>
          {datumOpen ? (
            <span className="flex items-center gap-1.5">
              <Input
                type="date"
                className="h-8 w-40 rounded-full"
                max={vandaag()}
                value={nieuweDatum}
                onChange={(e) => setNieuweDatum(e.target.value)}
              />
              <Button size="sm" className="h-8 rounded-full" onClick={() => void verzetDatum()}>
                Opslaan
              </Button>
            </span>
          ) : (
            <span className="font-medium">{dagKort(wijk.geld_peildatum ?? "")}</span>
          )}
          {!datumOpen && magBewerken && !wijk.geld_klaar_op && (
            <button
              type="button"
              className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setDatumOpen(true)}
            >
              wijzigen
            </button>
          )}
        </div>
        <div className="text-[13px] text-muted-foreground">
          {metPof} {metPof === 1 ? "adres" : "adressen"} met pof ·{" "}
          <span className="font-medium text-foreground tabular-nums">{formatPrice(totaal)}</span>{" "}
          van {contant.length} contant
        </div>
        <div className="ml-auto">
          {wijk.geld_klaar_op ? (
            <span className="flex items-center gap-2 text-[13px]">
              <span className="flex items-center gap-1 rounded-full bg-tint-groen px-2.5 py-1 font-medium text-tint-groen-ink">
                <Check className="size-3.5" /> Klaar
              </span>
              {magBewerken && (
                <button
                  type="button"
                  className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                  disabled={bezigKlaar}
                  onClick={() => void klaar(false)}
                >
                  toch nog niet klaar
                </button>
              )}
            </span>
          ) : (
            magBewerken && (
              <Button
                size="sm"
                className="rounded-full"
                disabled={bezigKlaar}
                onClick={() => void klaar(true)}
              >
                Beginstand klaar
              </Button>
            )
          )}
        </div>
      </div>

      {laden && <p className="text-[13px] text-muted-foreground">Laden…</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {perStraat.map(({ straat, adressen }) => (
          <section
            key={straat.id}
            className="rounded-[18px] border border-border bg-card p-3 shadow-card"
          >
            <h3 className="px-1 pb-2 font-display text-[14px] font-semibold">{straat.name}</h3>
            <div className="divide-y divide-border/70">
              {adressen.map((c) => {
                const methode = effectieveMethode(c, wijk);
                const s = standVan.get(c.id);
                const bedrag = leesBedrag(invoer[c.id] ?? "") ?? 0;
                const naam = c.klant_id ? naamVan(c.klant_id) : "";
                // Wat Wooshy er sinds de beginstand zelf bij telde (of wat er al
                // betaald is): dan klopt "open" niet meer met het vakje.
                const nuOpen = s ? s.open : 0;
                const anders = s && Math.abs(nuOpen - (s.beginstand?.bedrag ?? 0)) > 0.005;
                return (
                  <div key={c.id} className="flex items-center gap-3 px-1 py-1.5">
                    <span className="w-12 shrink-0 font-display text-[15px] font-semibold tabular-nums">
                      {c.house_number}
                      {c.addition}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{naam || " "}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {frequentieKort(c)}
                        {c.price > 0 && ` · ${formatPrice(c.price)}`}
                        {anders && ` · nu open ${formatPrice(nuOpen)}`}
                      </p>
                    </div>
                    {methode === "overmaken" ? (
                      <span className="text-[12px] text-muted-foreground">maakt over</span>
                    ) : (
                      <div className="w-28 shrink-0 text-right">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                            €
                          </span>
                          <Input
                            data-beginstand=""
                            inputMode="decimal"
                            aria-label={`Beginstand nummer ${c.house_number}${c.addition}`}
                            className="h-8 rounded-full pl-6 text-right tabular-nums"
                            placeholder="0"
                            disabled={!magBewerken}
                            value={invoer[c.id] ?? ""}
                            onChange={(e) => {
                              bezigMet.current.add(c.id);
                              setInvoer((v) => ({ ...v, [c.id]: e.target.value }));
                            }}
                            onBlur={() => void bewaar(c)}
                            onKeyDown={volgende}
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </div>
                        {bedrag > 0 && c.price > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                            {Math.abs(bedrag - aantalVoor(bedrag, c.price) * c.price) < 0.005
                              ? "= "
                              : "≈ "}
                            {aantalVoor(bedrag, c.price)}× {formatPrice(c.price)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
