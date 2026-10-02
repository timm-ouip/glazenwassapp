import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { BetaalPaneel } from "@/components/betalingen/BetaalPaneel";
import { fetchDagStand } from "@/components/betalingen/DagContant";
import { useAuth } from "@/lib/auth";
import type { GeldloopAdres } from "@/lib/geldlopen";
import type { Customer, District } from "@/lib/klanten";
import { fetchGeldAdres } from "@/lib/overzichten";
import { useMagAfrekenen } from "@/lib/rechten";

/**
 * Wat dit venster van een adres nodig heeft. Bij Afrekenen komt er meer mee
 * (naam, klachten, de tik van vandaag, of er nog een beurt wacht); wat er
 * niet bij staat, laat het venster weg.
 */
type Adres = Pick<Customer, "id" | "house_number" | "addition" | "inactief_op"> &
  Partial<Pick<Customer, "note" | "interval_maanden" | "ritme" | "betaalmethode">> &
  Partial<
    Pick<
      GeldloopAdres,
      "naam" | "straat" | "methode" | "wacht_op_wasbeurt" | "klachten" | "vanavond" | "wijk_id"
    >
  >;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Adres | null;
  /** "Kerkstraat 12", in de melding na een boeking. */
  adresTekst: string;
  /** Voor de kop, als het adres ze zelf niet meebrengt. */
  straat?: string | undefined;
  naam?: string | undefined;
  /** De wijk van het adres: is die al gestart bij Betalingen, en hoe betaalt hij? */
  wijk:
    | (Pick<District, "id" | "geld_peildatum"> & Partial<Pick<District, "betaalmethode">>)
    | undefined;
  /** Staat het adres vandaag op de route? Dan telt de beurt van vandaag mee. */
  vandaag: boolean;
  /** Niet als het venster al uit het dossier komt. */
  metDossier?: boolean;
}

/**
 * Betalen buiten de avond: bij Afrekenen, bij Betalen… op de Wijken-pagina
 * en op de dag, en in het dossier. Hetzelfde betaalvenster als op straat
 * (BetaalPaneel), zonder Niet thuis en Geen geld. Dit haalt alleen op wat
 * er openstaat en geeft dat door:
 *
 * - De eigenaar, en wie mag afrekenen, boekt op kantoor: de stand uit de
 *   database (geld_adres), met de beurt van vandaag erbij als het adres
 *   vandaag op de route staat. Is de wijk nog niet gestart bij Betalingen,
 *   dan weet de app niet wat er openstaat; dan staat hier de weg erheen.
 * - Een medewerker met Planning tikt overdag alleen in wat hij vandaag kreeg,
 *   op zijn eigen route (dag_geld_stand; leeg = hier niet).
 */
export function DagBetalen({
  open,
  onOpenChange,
  customer: c,
  adresTekst,
  straat,
  naam,
  wijk,
  vandaag,
  metDossier = true,
}: Props) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const kantoor = useMagAfrekenen();
  const gestart = !!wijk?.geld_peildatum;
  const id = c?.id;
  const geld = useQuery({
    queryKey: ["geld-adres", id],
    queryFn: () => fetchGeldAdres(id!),
    enabled: open && !!id && kantoor && gestart,
  });
  // Op de route van vandaag: de beurt van vandaag is nog niet afgemeld en
  // staat dus nog niet in de gewone stand. De stand van overdag telt hem
  // wel mee (dezelfde als die de medewerker ziet), anders zou er "niets
  // open" staan terwijl de klant voor vandaag betaalt.
  const metDag = kantoor ? vandaag && gestart : true;
  const dag = useQuery({
    queryKey: ["dag-geld", id],
    queryFn: () => fetchDagStand(id!),
    enabled: open && !!id && metDag,
  });
  const g = geld.data;
  const s = metDag ? dag.data : undefined;

  function vernieuw() {
    if (!id) return;
    void qc.invalidateQueries({ queryKey: ["geld-adres", id] });
    void qc.invalidateQueries({ queryKey: ["dag-geld", id] });
    void qc.invalidateQueries({ queryKey: ["geld-pof"] });
    void qc.invalidateQueries({ queryKey: ["geld-kaart"] });
    void qc.invalidateQueries({ queryKey: ["geld-afrekenen"] });
    void qc.invalidateQueries({ queryKey: ["geld-eerder", id] });
    void qc.invalidateQueries({ queryKey: ["laatste-ronde", id] });
  }

  /**
   * Na "Klopt niet": terugdraaien kan een geplande wissel naar overmaken laten
   * doorgaan of terugzetten, en dan verandert de betaalwijze van het adres
   * zelf. Alleen dan de (grote) adressenlijst opnieuw ophalen.
   */
  function naTerugdraaien() {
    vernieuw();
    void qc.invalidateQueries({ queryKey: ["customers"] });
  }

  // Waarom er (nog) niets te boeken valt; dan staat dat er in plaats van de knoppen.
  const fout = kantoor ? geld.error : dag.error;
  const melding =
    kantoor && !gestart ? (
      <div className="flex flex-col gap-3">
        <p className="rounded-[12px] bg-tint-amber px-3 py-2 text-[13px] text-tint-amber-ink">
          Deze wijk telt nog niet mee bij Betalingen: de app weet nog niet wat er openstaat.
        </p>
        {/* Een wijk starten doet de eigenaar. */}
        {wijk && isEigenaar && (
          <Button asChild className="self-start rounded-full">
            <Link
              to="/betalingen"
              search={{ tab: "kaart", wijk: wijk.id }}
              onClick={() => onOpenChange(false)}
            >
              Wijk starten
            </Link>
          </Button>
        )}
      </div>
    ) : fout ? (
      <p className="text-[13px] text-tint-rood-ink">
        {fout instanceof Error ? fout.message : "Het geld van dit adres kwam niet binnen."}
      </p>
    ) : (kantoor && !g) || (metDag && dag.isLoading) ? (
      <p className="text-[13px] text-muted-foreground">Laden…</p>
    ) : !kantoor && !s ? (
      <p className="text-[13px] text-muted-foreground">
        Hier kun je nu niets intikken: het adres staat vandaag niet op jouw route, of betaalt niet
        contant.
      </p>
    ) : undefined;

  // Het adres in de vorm van het loopscherm, zodat het venster hetzelfde is.
  const adres = useMemo<GeldloopAdres | null>(() => {
    if (!c) return null;
    // Wat er openstaat: met de beurt van vandaag erbij als die er is.
    const stand = s ?? g;
    return {
      id: c.id,
      wijk_id: c.wijk_id ?? wijk?.id ?? "",
      wijk: "",
      wijk_sort: 0,
      straat_id: "",
      straat: c.straat ?? straat ?? adresTekst,
      straat_sort: 0,
      sort_desc: false,
      doorlopend: false,
      house_number: c.house_number,
      addition: c.addition ?? "",
      sort_order: 0,
      hoek_kant: "",
      naam: c.naam ?? naam ?? "",
      note: c.note ?? "",
      interval_maanden: c.interval_maanden ?? 1,
      ritme: c.ritme ?? 1,
      // Betalen… staat alleen bij een contant adres; bij Afrekenen zegt de lijst het.
      methode: c.methode ?? c.betaalmethode ?? wijk?.betaalmethode ?? "contant",
      gestopt: !!c.inactief_op,
      wacht_op_wasbeurt: c.wacht_op_wasbeurt ?? false,
      straat_lopers: [],
      open: stand?.open ?? 0,
      open_wassen: stand?.open_wassen ?? 0,
      delen: stand?.delen ?? [],
      // Beurten die nog gebruikt worden; die van een vorige bewoner niet.
      vooruit_over: g ? Math.max(0, g.vooruit_over - g.vooruit_vast) : (s?.vooruit_over ?? 0),
      vooruit_waarde: g?.vooruit_waarde ?? 0,
      vooruit_vast: g?.vooruit_vast ?? 0,
      vooruit_vorige_waarde: g?.vooruit_vorige_waarde ?? 0,
      vooruit_eigen_waarde: g?.vooruit_eigen_waarde ?? 0,
      vooruit_p: g?.vooruit_p ?? null,
      vooruit_vanaf: g?.vooruit_vanaf ?? null,
      klachten: c.klachten ?? [],
      vaste_kortingen: g?.vaste_kortingen ?? [],
      kortingen_vanavond: [],
      // Wat er vandaag al gebeurde: bij Afrekenen de laatste tik van vandaag;
      // overdag wat de wasser vandaag intikte.
      vanavond:
        c.vanavond ??
        (!kantoor && s?.vandaag
          ? {
              id: s.vandaag.id,
              soort: "betaald",
              bedrag: s.vandaag.bedrag,
              op: s.vandaag.op,
              door: s.vandaag.door,
              door_naam: s.vandaag.door_naam,
            }
          : null),
    };
  }, [c, g, s, wijk, straat, naam, adresTekst, kantoor]);

  return (
    <BetaalPaneel
      adres={open ? adres : null}
      kantoor={{
        bron: kantoor ? "kantoor" : "dag",
        adresTekst,
        metDossier,
        maandenBekend: c?.wacht_op_wasbeurt !== undefined,
        melding,
        onTeruggedraaid: naTerugdraaien,
        // De database rekent korting van een niet-eigenaar zonder de beurt van vandaag.
        ...(g ? { kortingTot: Math.max(0, g.open) } : {}),
      }}
      onSluit={() => onOpenChange(false)}
      onVeranderd={vernieuw}
    />
  );
}
