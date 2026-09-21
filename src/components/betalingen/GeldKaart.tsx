import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconPencil as Pencil,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { useBevestig } from "@/components/Bevestig";
import { useAuth } from "@/lib/auth";
import { effectieveMethode, frequentieKort, zetBeginstand } from "@/lib/betalingen";
import {
  fetchCustomersMetInactief,
  fetchDistricts,
  fetchKlanten,
  fetchStreets,
  formatPrice,
  maandwerkVoor,
  ritmeMaanden,
  sortCustomers,
  type Customer,
} from "@/lib/klanten";
import { fetchKaart, soortLabel, type KaartAdres } from "@/lib/overzichten";

const MAANDEN = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MAANDNAMEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

type Vak =
  | { soort: "betaald"; aantal: number; korting: boolean }
  | { soort: "open"; nogOpen: boolean }
  | { soort: "overgeslagen" }
  | { soort: "niet_aan_de_beurt" }
  | { soort: "leeg" };

function maandVan(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** De maanden die in de beginstand open stonden ("2026-07"), uit de post. */
function beginMaandenVan(data: KaartAdres | undefined): string[] {
  const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
  return (begin?.omschrijving ?? "").split(",").filter((m) => /^\d{4}-\d{2}$/.test(m));
}

/**
 * Wat er in één maandvakje staat, zoals op de papieren kaart:
 *   1, 2 …  zoveel wasbeurten zijn die maand betaald (2 = er stond er een open)
 *   0       er is gewassen (of de kaart stond open) maar niet betaald
 *   ×       overgeslagen, buiten de gewone frequentie om
 *   %       niet aan de beurt volgens de frequentie
 * Losse klussen tellen niet mee: op de kaart staan alleen wasbeurten. Een
 * wasbeurt die met eerder tegoed betaald is, telt in de maand dat hij gewassen
 * werd.
 */
function vakVoor(
  c: Customer,
  data: KaartAdres | undefined,
  maand: string,
  peilMaand: string | null,
): Vak {
  const posten = (data?.posten ?? []).filter((p) => p.soort !== "klus");
  const beginMaanden = beginMaandenVan(data);
  const betaald = posten.filter((p) => {
    if (!p.betaald_op) return false;
    const betaalMaand = maandVan(p.betaald_op);
    const postMaand = p.datum.slice(0, 7);
    return (betaalMaand > postMaand ? betaalMaand : postMaand) === maand;
  });
  if (betaald.length > 0) {
    return {
      soort: "betaald",
      aantal: betaald.reduce((t, p) => t + (p.soort === "beginstand" ? p.aantal : 1), 0),
      korting: betaald.every((p) => p.betaald_soort === "korting"),
    };
  }
  // Vóór (en in) de startmaand: wat er op de kaart nog open stond. Is de
  // beginstand als bedrag ingetypt (zonder maanden), dan staat hij als 0 in
  // de startmaand.
  if (peilMaand && maand <= peilMaand) {
    const begin = posten.find((p) => p.soort === "beginstand");
    if (
      beginMaanden.includes(maand) ||
      (begin && beginMaanden.length === 0 && maand === peilMaand)
    ) {
      return { soort: "open", nogOpen: !begin || begin.gedekt < begin.bedrag - 0.005 };
    }
  }
  // Vanaf de startmaand: gewassen maar (nog) niet betaald.
  if (!peilMaand || maand >= peilMaand) {
    const gewassen = posten.filter((p) => p.soort === "wassen" && p.datum.slice(0, 7) === maand);
    if (gewassen.length > 0) {
      return { soort: "open", nogOpen: gewassen.some((p) => p.gedekt < p.bedrag - 0.005) };
    }
  }
  if (c.overslaan.includes(maand)) return { soort: "overgeslagen" };
  const m = Number(maand.slice(5, 7));
  if (!ritmeMaanden(c).includes(m) && maandwerkVoor(c, maand).length === 0) {
    return { soort: "niet_aan_de_beurt" };
  }
  return { soort: "leeg" };
}

/**
 * De kaartweergave: per straat een jaar, zoals de papieren kaart. Tik een
 * vakje en je ziet wie wanneer wat intikte. Met "Pof van vóór de start"
 * tik je de maanden aan die op de kaart nog open stonden; Wooshy rekent de
 * beginstand dan zelf uit.
 */
export function GeldKaart({
  straatId,
  onStraat,
}: {
  straatId: string | undefined;
  onStraat: (id: string) => void;
}) {
  const qc = useQueryClient();
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const customers = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
  });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const [jaar, setJaar] = useState(() => new Date().getFullYear());
  const [invullen, setInvullen] = useState(false);
  const [gekozen, setGekozen] = useState<{ adres: string; maand: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const bevestig = useBevestig();

  const straat = (streets.data ?? []).find((s) => s.id === straatId);
  const wijkId = straat?.district_id ?? districts.data?.[0]?.id;
  const wijk = (districts.data ?? []).find((d) => d.id === wijkId);
  const stratenVanWijk = useMemo(
    () =>
      (streets.data ?? [])
        .filter((s) => s.district_id === wijkId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [streets.data, wijkId],
  );

  // Zonder keuze: de eerste straat van de eerste wijk.
  useEffect(() => {
    if (!straatId && stratenVanWijk[0]) onStraat(stratenVanWijk[0].id);
  }, [straatId, stratenVanWijk, onStraat]);

  const kaart = useQuery({
    queryKey: ["geld-kaart", straatId, jaar],
    queryFn: () => fetchKaart(straatId!, jaar),
    enabled: !!straatId,
  });
  const perAdres = useMemo(
    () => new Map((kaart.data?.adressen ?? []).map((a) => [a.id, a])),
    [kaart.data],
  );
  const namen = useMemo(
    () => new Map((klanten.data ?? []).map((k) => [k.id, k.naam])),
    [klanten.data],
  );
  const adressen = useMemo(
    () => sortCustomers((customers.data ?? []).filter((c) => c.street_id === straatId)),
    [customers.data, straatId],
  );

  const peil = kaart.data?.wijk.peildatum ?? null;
  const peilMaand = peil ? peil.slice(0, 7) : null;
  const maanden = MAANDEN.map((_, i) => `${jaar}-${String(i + 1).padStart(2, "0")}`);

  async function wisselBegin(c: Customer, maand: string) {
    if (bezig) return;
    const data = perAdres.get(c.id);
    const begin = (data?.posten ?? []).find((p) => p.soort === "beginstand");
    const nu = new Set(beginMaandenVan(data));
    // Een ingetypt bedrag (zonder maanden) wordt vervangen door maanden × prijs.
    if (begin && nu.size === 0) {
      const ja = await bevestig({
        titel: "Ingetypte beginstand vervangen?",
        tekst: `Hier staat nu ${formatPrice(begin.bedrag)} als beginstand. Met aanvinken wordt dat het aantal maanden × ${formatPrice(c.price)}.`,
        bevestigLabel: "Vervangen",
      });
      if (!ja) return;
    }
    if (nu.has(maand)) nu.delete(maand);
    else nu.add(maand);
    const lijst = [...nu].sort();
    if (c.price <= 0 && lijst.length > 0) {
      toast.error("Dit adres heeft nog geen prijs, dus Wooshy weet niet wat een maand kost.");
      return;
    }
    setBezig(true);
    try {
      await zetBeginstand(c.id, lijst.length * c.price, Math.max(1, lijst.length), lijst);
      await qc.invalidateQueries({ queryKey: ["geld-kaart", straatId] });
      void qc.invalidateQueries({ queryKey: ["geld-stand"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  const details = gekozen ? perAdres.get(gekozen.adres) : undefined;
  const detailAdres = gekozen ? adressen.find((c) => c.id === gekozen.adres) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(districts.data ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                const eerste = (streets.data ?? [])
                  .filter((s) => s.district_id === d.id)
                  .sort((a, b) => a.sort_order - b.sort_order)[0];
                if (eerste) onStraat(eerste.id);
              }}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium ${
                d.id === wijkId
                  ? "border-transparent bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-card">
          <button
            type="button"
            aria-label="Jaar ervoor"
            className="flex size-7 items-center justify-center rounded-full hover:bg-surface"
            onClick={() => setJaar((j) => j - 1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 text-[13px] font-medium tabular-nums">{jaar}</span>
          <button
            type="button"
            aria-label="Jaar erna"
            className="flex size-7 items-center justify-center rounded-full hover:bg-surface"
            onClick={() => setJaar((j) => j + 1)}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {stratenVanWijk.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onStraat(s.id)}
            className={`shrink-0 rounded-full border px-3 py-1 text-[12.5px] font-medium ${
              s.id === straatId
                ? "border-transparent bg-accent text-accent-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {isEigenaar && peil && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Button
            size="sm"
            variant={invullen ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setInvullen((v) => !v)}
          >
            <Pencil className="size-3.5" />
            {invullen ? "Klaar met aanvinken" : "Pof van vóór de start aanvinken"}
          </Button>
          {invullen && (
            <span>
              Tik de maanden tot en met {MAANDNAMEN[Number(peil.slice(5, 7)) - 1]}{" "}
              {peil.slice(0, 4)} aan die op de kaart nog open stonden (een 0). Wooshy rekent de
              beginstand uit met de prijs van nu.
            </span>
          )}
        </div>
      )}
      {!peil && wijk && (
        <p className="text-[13px] text-muted-foreground">
          {wijk.name} doet nog niet mee met Betalingen: kies eerst in het tabblad Beginstand de
          stand van de kaarten.
        </p>
      )}

      <section className="overflow-x-auto rounded-[18px] border border-border bg-card shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="text-[11.5px] text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Nr</th>
              <th className="px-2 py-2 text-left font-medium">Naam</th>
              <th className="px-2 py-2 text-right font-medium">€</th>
              {MAANDEN.map((m, i) => (
                <th
                  key={i}
                  className={`w-8 py-2 text-center font-medium ${
                    peilMaand && maanden[i]! <= peilMaand ? "bg-surface/60" : ""
                  }`}
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {adressen.map((c) => {
              const data = perAdres.get(c.id);
              const overmaken = effectieveMethode(c, wijk) === "overmaken";
              return (
                <tr key={c.id} className="border-t border-border/70">
                  <td className="whitespace-nowrap px-3 py-1.5 font-display font-semibold tabular-nums">
                    {overmaken && <span className="mr-1 text-tint-blauw-ink">$</span>}
                    {c.house_number}
                    {c.addition}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5">
                    {c.klant_id ? namen.get(c.klant_id) : ""}
                    <span className="block text-[11px] text-muted-foreground">
                      {frequentieKort(c)}
                      {c.inactief_op ? " · gestopt" : ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {c.price > 0 ? formatPrice(c.price) : ""}
                  </td>
                  {maanden.map((maand) => {
                    const vak = vakVoor(c, data, maand, peilMaand);
                    const beginZone = !!peilMaand && maand <= peilMaand;
                    const kanAanvinken = invullen && beginZone && !overmaken;
                    const aan = gekozen?.adres === c.id && gekozen.maand === maand;
                    return (
                      <td key={maand} className={`p-0.5 ${beginZone ? "bg-surface/60" : ""}`}>
                        <button
                          type="button"
                          onClick={() =>
                            kanAanvinken
                              ? void wisselBegin(c, maand)
                              : setGekozen(aan ? null : { adres: c.id, maand })
                          }
                          className={`flex h-8 w-full items-center justify-center rounded-[8px] text-[13px] font-semibold tabular-nums transition-colors ${
                            aan ? "ring-2 ring-foreground/40" : ""
                          } ${
                            vak.soort === "betaald"
                              ? vak.korting
                                ? "bg-tint-paars text-tint-paars-ink"
                                : "bg-tint-groen text-tint-groen-ink"
                              : vak.soort === "open"
                                ? vak.nogOpen
                                  ? "bg-tint-rood text-tint-rood-ink"
                                  : "text-tint-rood-ink/60"
                                : kanAanvinken
                                  ? "border border-dashed border-border text-muted-foreground hover:bg-surface"
                                  : "text-muted-foreground/70 hover:bg-surface"
                          }`}
                        >
                          {vak.soort === "betaald"
                            ? vak.aantal
                            : vak.soort === "open"
                              ? "0"
                              : vak.soort === "overgeslagen"
                                ? "×"
                                : vak.soort === "niet_aan_de_beurt"
                                  ? "%"
                                  : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {kaart.isLoading && <p className="p-3 text-[13px] text-muted-foreground">Laden…</p>}
      </section>

      <p className="text-[12px] text-muted-foreground">
        1, 2 = zoveel wasbeurten betaald die maand · 0 = niet betaald (rood zolang het nog open
        staat) · paars = met korting afgeboekt · × = overgeslagen · % = niet aan de beurt · $ =
        maakt over · grijs = vóór de start (de beginstand)
      </p>

      {gekozen && detailAdres && (
        <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
          <h3 className="font-display text-[15px] font-semibold">
            {straat?.name} {detailAdres.house_number}
            {detailAdres.addition} · {MAANDNAMEN[Number(gekozen.maand.slice(5, 7)) - 1]}{" "}
            {gekozen.maand.slice(0, 4)}
          </h3>
          <div className="mt-2 space-y-1 text-[13px]">
            {(details?.posten ?? [])
              .filter((p) => p.datum.slice(0, 7) === gekozen.maand && p.soort !== "beginstand")
              .map((p, i) => (
                <p key={`p${i}`}>
                  {p.soort === "klus" ? `Klus: ${p.omschrijving}` : "Gewassen"} op {p.datum} ·{" "}
                  {formatPrice(p.bedrag)}
                  {p.gedekt >= p.bedrag - 0.005
                    ? ` · betaald${p.betaald_door ? ` bij ${p.betaald_door}` : ""}${
                        p.betaald_op
                          ? ` op ${new Date(p.betaald_op).toLocaleDateString("nl-NL")}`
                          : ""
                      }`
                    : ` · nog ${formatPrice(p.bedrag - p.gedekt)} open`}
                </p>
              ))}
            {(details?.gebeurtenissen ?? [])
              .filter((g) => maandVan(g.op) === gekozen.maand)
              .map((g) => (
                <p key={g.id} className={g.ongedaan ? "line-through opacity-60" : ""}>
                  {soortLabel(g.soort)}
                  {g.bedrag > 0 && ` ${formatPrice(g.bedrag)}`}
                  {g.reden && ` (${g.reden})`} · {g.door_naam} ·{" "}
                  {new Date(g.op).toLocaleString("nl-NL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {g.ongedaan && ` · teruggedraaid door ${g.ongedaan.door_naam}`}
                </p>
              ))}
            {(details?.posten ?? []).every(
              (p) => p.datum.slice(0, 7) !== gekozen.maand || p.soort === "beginstand",
            ) &&
              (details?.gebeurtenissen ?? []).every((g) => maandVan(g.op) !== gekozen.maand) && (
                <p className="text-muted-foreground">Niets gebeurd in deze maand.</p>
              )}
          </div>
        </section>
      )}
    </div>
  );
}
