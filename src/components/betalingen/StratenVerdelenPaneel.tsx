import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  aanDeBeurt,
  fetchGeldloopLijst,
  fetchStraatVerdeling,
  heeftIetsOpen,
  verdeelEerlijk,
  verdeelStraat,
  type Vrijgave,
} from "@/lib/geldlopen";
import { fetchStraatGroepen, fetchStreets, type Street } from "@/lib/klanten";

/**
 * De straten van een avond, met per straat wie hem loopt. Vink niemand aan en
 * de straat is van iedereen — zoals het ging vóór er verdeeld werd.
 *
 * De straten staan in de volgorde van de wijkkaart, onder het stuk van de
 * wijk waar ze bij horen ("Fase A"). Dat is de enige plek waar vastligt welke
 * straten bij elkaar in de buurt liggen — de app kent geen coördinaten — en
 * het is precies waar je op let als je verdeelt: geef iemand liever één stuk
 * dan losse straten door de hele wijk. Het knopje naast de kop van een stuk
 * geeft dat hele stuk in één klik aan één loper.
 *
 * Achter elke straat staat hoeveel adressen er vanavond open staan. Een
 * straat waar niets te halen is staat er grijs bij: hij hoort wel bij de
 * wijk, maar die avond komt er niemand langs — bijvoorbeeld omdat er deze
 * maand nog gewassen moet worden. Lukt het niet om die aantallen op te halen,
 * dan staat de lijst er gewoon zonder.
 *
 * "Eerlijk verdelen" loopt de wijk af in die volgorde en knipt hem in net
 * zoveel aaneengesloten stukken als er lopers zijn, elk met ongeveer evenveel
 * deuren. Je kunt er daarna gewoon overheen klikken, en de lopers mogen het
 * 's avonds zelf nog omgooien.
 */
export function StratenVerdelenPaneel({ vrijgave }: { vrijgave: Vrijgave }) {
  const qc = useQueryClient();
  const [bezig, setBezig] = useState(false);
  const lopers = vrijgave.lopers ?? [];
  const wijkIds = new Set(vrijgave.wijken.map((w) => w.id));
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, staleTime: 5 * 60_000 });
  const verdeling = useQuery({
    queryKey: ["straat-verdeling", vrijgave.id],
    queryFn: () => fetchStraatVerdeling(vrijgave.id),
  });
  const groepen = useQuery({
    queryKey: ["straat_groepen"],
    queryFn: fetchStraatGroepen,
    staleTime: 5 * 60_000,
  });
  // De avond zelf, alleen om te laten zien waar vanavond iets te halen is.
  // De database geeft deze lijst niet aan iedereen; lukt het niet, dan staat
  // de lijst er zonder aantallen — vandaar geen nieuwe poging en geen melding.
  const lijst = useQuery({
    queryKey: ["geldloop-lijst", vrijgave.id],
    queryFn: () => fetchGeldloopLijst(vrijgave.id),
    retry: false,
    staleTime: 60_000,
  });

  /** Hoeveel adressen er per straat vanavond nog open staan. */
  const openPerStraat = useMemo(() => {
    const uit = new Map<string, number>();
    for (const a of lijst.data?.adressen ?? []) {
      if (!aanDeBeurt(a) || !heeftIetsOpen(a) || a.vanavond) continue;
      uit.set(a.straat_id, (uit.get(a.straat_id) ?? 0) + 1);
    }
    return uit;
  }, [lijst.data]);
  const weetOpen = Boolean(lijst.data);

  const straten = (streets.data ?? [])
    .filter((s) => wijkIds.has(s.district_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  // Per stuk van de wijk, in de volgorde van de wijkkaart. Eerst per wijk,
  // want de nummering van de stukken begint in elke wijk opnieuw bij 1 — geef
  // je twee wijken tegelijk vrij, dan zouden ze anders door elkaar lopen. Bij
  // meer dan één wijk staat de wijknaam in de kop, zodat "Fase A" van de ene
  // niet op "Fase A" van de andere lijkt. Straten die in geen enkel stuk
  // zitten staan onder hun wijk zonder kop, net als op de wijkenpagina.
  const meerWijken = vrijgave.wijken.length > 1;
  const stukken: { id: string; kop: string; straten: Street[] }[] = [];
  for (const w of vrijgave.wijken) {
    const vanWijk = straten.filter((s) => s.district_id === w.id);
    const gebruikt = new Set<string>();
    for (const g of (groepen.data ?? [])
      .filter((g) => g.district_id === w.id)
      .sort((a, b) => a.sort_order - b.sort_order)) {
      const erin = vanWijk.filter((s) => s.groep_id === g.id);
      if (erin.length === 0) continue;
      for (const s of erin) gebruikt.add(s.id);
      stukken.push({
        id: g.id,
        kop: meerWijken ? `${w.naam} · ${g.naam}` : g.naam,
        straten: erin,
      });
    }
    const los = vanWijk.filter((s) => !gebruikt.has(s.id));
    if (los.length > 0)
      stukken.push({ id: `los-${w.id}`, kop: meerWijken ? w.naam : "", straten: los });
  }

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["straat-verdeling", vrijgave.id] });
    void qc.invalidateQueries({ queryKey: ["geldloop-lijst", vrijgave.id] });
  }

  async function wissel(straatId: string, loperId: string) {
    // Zonder de huidige verdeling zou één klik de rest van een straat stil
    // overschrijven; daarom kan dit pas als hij binnen is.
    if (!verdeling.data) return;
    const nu = verdeling.data.get(straatId) ?? [];
    const straks = nu.includes(loperId) ? nu.filter((x) => x !== loperId) : [...nu, loperId];
    setBezig(true);
    try {
      await verdeelStraat(vrijgave.id, straatId, straks);
      ververs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  /**
   * Een heel stuk van de wijk aan één loper geven. Staat het er al helemaal
   * op zijn naam, dan haalt dezelfde klik hem er weer af en is het stuk weer
   * van iedereen. De straten gaan één voor één: de database kent geen
   * opdracht voor een heel stuk, en zo staat elke straat los in het logboek.
   */
  async function wisselStuk(straten: Street[], loperId: string) {
    if (!verdeling.data) return;
    const alVanHem = straten.every((s) => {
      const bij = verdeling.data?.get(s.id) ?? [];
      return bij.length === 1 && bij[0] === loperId;
    });
    setBezig(true);
    let gedaan = 0;
    try {
      for (const s of straten) {
        await verdeelStraat(vrijgave.id, s.id, alVanHem ? [] : [loperId]);
        gedaan += 1;
      }
      ververs();
    } catch (e) {
      // Halverwege stukgelopen: zeg hoever hij kwam, anders denk je dat het
      // hele stuk nog staat zoals het stond.
      toast.error(
        gedaan === 0
          ? (e as Error).message
          : `${gedaan} van de ${straten.length} straten gezet, de rest niet: ${(e as Error).message}`,
      );
      ververs();
    } finally {
      setBezig(false);
    }
  }

  async function eerlijk() {
    setBezig(true);
    try {
      const uit = await verdeelEerlijk(vrijgave.id);
      ververs();
      toast.success(`${uit.straten} straten verdeeld over ${uit.lopers} lopers`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  if (lopers.length === 0) {
    return (
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Er is niemand aan deze avond gekoppeld.
      </p>
    );
  }

  if (verdeling.isError) {
    return (
      <p className="mt-2 text-[12.5px] text-tint-rood-ink">
        De verdeling kon niet opgehaald worden. Ververs de pagina om het opnieuw te proberen.
      </p>
    );
  }

  const uit = bezig || !verdeling.data;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={bezig || lopers.length < 2}
          title={
            lopers.length < 2
              ? "Er loopt maar één iemand: er valt niets te verdelen"
              : "Loopt de wijk af in deze volgorde en knipt hem in aaneengesloten stukken met ongeveer evenveel deuren"
          }
          onClick={() => void eerlijk()}
        >
          Eerlijk verdelen
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Niemand aangevinkt: die straat is van iedereen.
        </span>
      </div>

      {groepen.isError && (
        <p className="text-[12px] text-tint-rood-ink">
          De stukken van de wijk konden niet opgehaald worden; de straten staan hieronder op een
          rij, zonder kopjes.
        </p>
      )}

      <div className="divide-y divide-border/70 overflow-hidden rounded-[14px] border border-border">
        {stukken.map((k) => {
          const openInStuk = k.straten.reduce((t, s) => t + (openPerStraat.get(s.id) ?? 0), 0);
          return (
            <div key={k.id} className="divide-y divide-border/70">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3 py-1.5">
                <span className="min-w-[7.5rem] flex-1 text-[12px] font-medium text-muted-foreground">
                  {k.kop || "Losse straten"}
                  {weetOpen && ` · ${openInStuk} open`}
                </span>
                <Knoppen
                  lopers={lopers}
                  uit={uit}
                  klein
                  actief={(id) =>
                    k.straten.every((s) => {
                      const bij = verdeling.data?.get(s.id) ?? [];
                      return bij.length === 1 && bij[0] === id;
                    })
                  }
                  onKies={(id) => void wisselStuk(k.straten, id)}
                />
              </div>
              {k.straten.map((s) => {
                const bij = verdeling.data?.get(s.id) ?? [];
                const open = openPerStraat.get(s.id) ?? 0;
                const stil = weetOpen && open === 0;
                return (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    {/* Geen afkapping: de werknaam van een straat is juist waar
                        je hem aan herkent. Past hij niet naast de knoppen, dan
                        gaan die eronder. */}
                    <span
                      className="min-w-[7.5rem] flex-1 text-[13.5px]"
                      title={s.volledige_naam || undefined}
                    >
                      <span className={stil ? "text-muted-foreground" : ""}>{s.name}</span>
                      {weetOpen && (
                        <span className="ml-2 text-[12px] text-muted-foreground">
                          {stil ? "niet vanavond" : `${open} open`}
                        </span>
                      )}
                    </span>
                    <Knoppen
                      lopers={lopers}
                      uit={uit}
                      actief={(id) => bij.includes(id)}
                      onKies={(id) => void wissel(s.id, id)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {straten.length === 0 && (
          <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
            Deze wijk heeft nog geen straten.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Het rijtje loperknoppen, bij een straat of bij de kop van een stuk. Bij de
 * kop iets kleiner, zodat die regel een kop blijft en geen tweede rij wordt.
 */
function Knoppen({
  lopers,
  uit,
  actief,
  onKies,
  klein = false,
}: {
  lopers: { id: string; naam: string }[];
  uit: boolean;
  actief: (loperId: string) => boolean;
  onKies: (loperId: string) => void;
  klein?: boolean;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {lopers.map((l) => {
        const aan = actief(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={aan}
            disabled={uit}
            onClick={() => onKies(l.id)}
            className={`rounded-full border px-2.5 text-[12px] font-medium disabled:opacity-50 ${
              klein ? "min-h-7" : "min-h-8"
            } ${
              aan
                ? "border-transparent bg-tint-blauw text-tint-blauw-ink"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {l.naam.split(" ")[0]}
          </button>
        );
      })}
    </span>
  );
}
