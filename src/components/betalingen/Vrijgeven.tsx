import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { IconAlertTriangle as AlertTriangle, IconLockOpen as LockOpen } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StratenVerdelenPaneel } from "@/components/betalingen/StratenVerdelenPaneel";
import { useBevestig } from "@/components/Bevestig";
import { useAuth } from "@/lib/auth";
import { dagKort } from "@/lib/betalingen";
import {
  fetchEindtijd,
  fetchMogelijkeLopers,
  fetchNietAfgemeld,
  fetchVrijgaven,
  geefVrij,
  trekIn,
  wijzigEind,
  type Vrijgave,
} from "@/lib/geldlopen";
import { fetchDistricts } from "@/lib/klanten";
import { datumSleutel, toonDatum, vandaag } from "@/lib/wasdag";

function tijd(iso: string): string {
  return new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function statusVan(v: Vrijgave, nu: number): "loopt" | "komt" | "voorbij" | "ingetrokken" {
  if (v.ingetrokken_op) return "ingetrokken";
  if (nu >= Date.parse(v.eind_op)) return "voorbij";
  if (nu < Date.parse(v.begin_op)) return "komt";
  return "loopt";
}

const STATUS: Record<ReturnType<typeof statusVan>, { label: string; klasse: string }> = {
  loopt: { label: "Loopt nu", klasse: "bg-tint-groen text-tint-groen-ink" },
  komt: { label: "Komt nog", klasse: "bg-tint-blauw text-tint-blauw-ink" },
  voorbij: { label: "Voorbij", klasse: "bg-surface text-muted-foreground" },
  ingetrokken: { label: "Ingetrokken", klasse: "bg-surface text-muted-foreground line-through" },
};

/**
 * Een wijk vrijgeven voor een avond: welke wijk(en), welke dag, en wie er
 * lopen. Tot de eindtijd zien alleen die mensen de adressen en bedragen.
 */
export function Vrijgeven({ onLopen }: { onLopen: () => void }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const { company } = useAuth();
  const districts = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const lopers = useQuery({ queryKey: ["geldloop-lopers"], queryFn: fetchMogelijkeLopers });
  const vanaf = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return datumSleutel(d);
  })();
  const vrijgaven = useQuery({
    queryKey: ["geldloop-vrijgaven", vanaf],
    queryFn: () => fetchVrijgaven(vanaf),
    refetchInterval: 60_000,
  });
  const standaardEind = useQuery({
    queryKey: ["geldloop-eindtijd", company?.id],
    queryFn: () => fetchEindtijd(company!.id),
    enabled: !!company,
  });

  // Bij welke avond het verdeelpaneel openstaat.
  const [verdelen, setVerdelen] = useState<string | null>(null);
  const [datum, setDatum] = useState(vandaag());
  const [wijken, setWijken] = useState<Set<string>>(new Set());
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [eind, setEind] = useState("23:00");
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    if (standaardEind.data) setEind(standaardEind.data);
  }, [standaardEind.data]);

  const nietAfgemeld = useQuery({
    queryKey: ["wasdagen", "niet-afgemeld", [...wijken].sort().join(",")],
    queryFn: () => fetchNietAfgemeld([...wijken]),
    enabled: wijken.size > 0,
  });

  function wissel(set: Set<string>, id: string, zet: (s: Set<string>) => void) {
    const nu = new Set(set);
    if (nu.has(id)) nu.delete(id);
    else nu.add(id);
    zet(nu);
  }

  async function geefDeWijkVrij() {
    if (wijken.size === 0) return void toast.error("Kies een wijk.");
    if (gekozen.size === 0) return void toast.error("Kies wie er gaan lopen.");
    setBezig(true);
    try {
      await geefVrij(datum, [...wijken], [...gekozen], eind);
      toast.success(
        `Vrijgegeven tot ${eind}. ${gekozen.size === 1 ? "De geldloper ziet" : "De geldlopers zien"} de wijk nu in Betalingen.`,
      );
      setWijken(new Set());
      setGekozen(new Set());
      void qc.invalidateQueries({ queryKey: ["geldloop-vrijgaven"] });
      void qc.invalidateQueries({ queryKey: ["mijn-geldloop"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBezig(false);
    }
  }

  async function intrekken(v: Vrijgave) {
    const ja = await bevestig({
      titel: "Vrijgave intrekken?",
      tekst:
        "De geldlopers zien de wijk meteen niet meer. Wat ze al hebben ingetikt blijft bewaard.",
      bevestigLabel: "Intrekken",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await trekIn(v.id);
      void qc.invalidateQueries({ queryKey: ["geldloop-vrijgaven"] });
      void qc.invalidateQueries({ queryKey: ["mijn-geldloop"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function verzetEind(v: Vrijgave, nieuw: string, vakje: HTMLInputElement) {
    try {
      await wijzigEind(v.id, nieuw);
      toast.success(`De avond loopt nu tot ${nieuw}`);
      void qc.invalidateQueries({ queryKey: ["geldloop-vrijgaven"] });
    } catch (e) {
      // Terug naar wat echt geldt, anders lijkt de avond langer te lopen.
      vakje.value = tijd(v.eind_op);
      toast.error((e as Error).message);
    }
  }

  const nu = Date.now();
  const lijst = vrijgaven.data ?? [];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="space-y-4 rounded-[18px] border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-tint-groen text-tint-groen-ink">
            <LockOpen className="size-5" />
          </span>
          <div>
            <h2 className="font-display text-[16px] font-semibold">Wijk vrijgeven</h2>
            <p className="text-[12.5px] text-muted-foreground">
              Alleen dan zien de geldlopers adressen en bedragen.
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Wijk</p>
          <div className="flex flex-wrap gap-1.5">
            {(districts.data ?? []).map((d) => {
              const klaar = !!d.geld_klaar_op;
              const aan = wijken.has(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={!klaar}
                  title={klaar ? undefined : "De beginstand van deze wijk is nog niet klaar"}
                  onClick={() => wissel(wijken, d.id, setWijken)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                    aan
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>
          {(districts.data ?? []).some((d) => !d.geld_klaar_op) && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Grijs: de beginstand is nog niet klaar.{" "}
              <Link
                to="/betalingen"
                search={{ tab: "kaart" }}
                className="underline-offset-2 hover:underline"
              >
                Invullen
              </Link>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-medium text-muted-foreground">
            Dag
            <Input
              type="date"
              className="mt-1 rounded-full"
              min={vandaag()}
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
            />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            Tot
            <Input
              type="time"
              className="mt-1 rounded-full"
              value={eind}
              onChange={(e) => setEind(e.target.value)}
            />
          </label>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Wie lopen er?</p>
          <div className="divide-y divide-border/70 rounded-[14px] border border-border">
            {(lopers.data ?? []).map((l) => (
              <label key={l.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <Checkbox
                  checked={gekozen.has(l.id)}
                  onCheckedChange={() => wissel(gekozen, l.id, setGekozen)}
                />
                <span className="text-[14px]">{l.naam}</span>
                {l.eigenaar && <span className="text-[12px] text-muted-foreground">(jij)</span>}
              </label>
            ))}
          </div>
          {(lopers.data ?? []).every((l) => l.eigenaar) && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Nog niemand anders mag geldlopen. Maak in Instellingen → Team een rol met het vinkje
              "Geld lopen" en geef die aan je geldlopers.
            </p>
          )}
        </div>

        {(nietAfgemeld.data ?? []).length > 0 && (
          <div className="space-y-1 rounded-[14px] bg-tint-amber px-3 py-2.5 text-[12.5px] text-tint-amber-ink">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-4" /> Nog niet afgemeld met Dag klaar
            </p>
            <p>Dat werk staat nog niet open bij de klant:</p>
            <ul className="space-y-0.5">
              {nietAfgemeld.data!.map((n) => (
                <li key={`${n.datum}-${n.wijk}`}>
                  <Link
                    to="/dag"
                    search={{ datum: n.datum }}
                    className="underline-offset-2 hover:underline"
                  >
                    {toonDatum(n.datum)}
                  </Link>{" "}
                  · {n.wijk} · {n.aantal} {n.aantal === 1 ? "adres" : "adressen"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          className="h-11 w-full rounded-full"
          disabled={bezig}
          onClick={() => void geefDeWijkVrij()}
        >
          Vrijgeven
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-display text-[15px] font-semibold">Avonden</h2>
        {lijst.length === 0 && (
          <p className="px-1 text-[13px] text-muted-foreground">
            Nog niets vrijgegeven de afgelopen week.
          </p>
        )}
        {lijst.map((v) => {
          const st = statusVan(v, nu);
          const actief = st === "loopt" || st === "komt";
          return (
            <div
              key={v.id}
              className="rounded-[16px] border border-border bg-card px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium first-letter:uppercase">{toonDatum(v.datum)}</span>
                <span className="text-[13px] text-muted-foreground">
                  {v.wijken.map((w) => w.naam).join(", ")}
                </span>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS[st].klasse}`}
                >
                  {STATUS[st].label}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {(v.lopers ?? []).map((l) => l.naam).join(", ") || "Niemand"} · tot{" "}
                {tijd(v.eind_op)}
                {v.datum !== datumSleutel(new Date(v.eind_op)) &&
                  ` (${dagKort(datumSleutel(new Date(v.eind_op)))})`}
              </p>
              {actief && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {st === "loopt" && (
                    <Button size="sm" variant="outline" className="rounded-full" onClick={onLopen}>
                      Meekijken
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setVerdelen((was) => (was === v.id ? null : v.id))}
                  >
                    {verdelen === v.id ? "Verdelen sluiten" : "Straten verdelen"}
                  </Button>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    Tot
                    <Input
                      type="time"
                      className="h-8 w-28 rounded-full"
                      defaultValue={tijd(v.eind_op)}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== tijd(v.eind_op))
                          void verzetEind(v, e.target.value, e.target);
                      }}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto rounded-full text-tint-rood-ink"
                    onClick={() => void intrekken(v)}
                  >
                    Intrekken
                  </Button>
                </div>
              )}
              {actief && verdelen === v.id && <StratenVerdelenPaneel vrijgave={v} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/**
 * Hetzelfde scherm als venster: op de computer een popup, op de telefoon een
 * paneel dat omhoog schuift. Vrijgeven is geen eigen pagina meer — er staat
 * te weinig op — maar een tegel op het overzicht die dit opent.
 */
export function VrijgeefVenster({
  open,
  onSluit,
  onLopen,
}: {
  open: boolean;
  onSluit: () => void;
  onLopen: () => void;
}) {
  const mobiel = useIsMobile();
  const Titel = mobiel ? DrawerTitle : DialogTitle;
  const inhoud = (
    <>
      <Titel className="shrink-0 px-4 pt-3 font-display text-[20px] font-semibold tracking-[-0.02em] md:px-5 md:pt-4">
        Een wijk vrijgeven
      </Titel>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-5 md:pb-5">
        <Vrijgeven onLopen={onLopen} />
      </div>
    </>
  );
  return mobiel ? (
    <Drawer open={open} onOpenChange={(o) => !o && onSluit()}>
      <DrawerContent className="max-h-[94dvh] rounded-t-[24px] border-0 bg-card">
        {inhoud}
      </DrawerContent>
    </Drawer>
  ) : (
    <Dialog open={open} onOpenChange={(o) => !o && onSluit()}>
      <DialogContent className="flex max-h-[88dvh] w-[min(720px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden border-0 bg-card p-0 sm:rounded-[24px]">
        {inhoud}
      </DialogContent>
    </Dialog>
  );
}
