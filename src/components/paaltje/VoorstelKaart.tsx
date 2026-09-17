/**
 * Eén voorstel van Paaltje: samenvatting, de regels (adres · klant · veld ·
 * oud → nieuw), en de knoppen die passen bij de status en jouw rechten.
 *
 * Dezelfde geel-vakje-stijl als `WooshyVakje` in de mail (zie
 * `src/components/mail/KlantKaart.tsx`) voor "doorgevoerd, met Ongedaan
 * maken" — dat is overal in Wooshy hetzelfde teken.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle as AlertTriangle,
  IconCheck as Check,
  IconCalendarTime as CalendarClock,
  IconChevronDown as ChevronDown,
  IconCircleCheck as CircleCheck,
  IconCircleOff as CircleSlash,
  IconClock as Clock,
  IconLoader2 as Loader2,
  IconSend as Send,
  IconArrowBackUp as Undo2,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useRecht } from "@/lib/rechten";
import { komendeMaanden, leesRitmeWaarde, ritmeWaarde, toonMaand } from "@/lib/klanten";
import {
  aanvragen,
  afwijzen,
  annuleren,
  doorvoeren,
  GEEN_STARTMAAND,
  magRegel,
  maandMetJaar,
  regelWaarde,
  terugdraaien,
  VELD_LABEL,
  VoorstelVerouderdFout,
  type Regel,
  type RegelPatch,
  type Voorstel,
} from "@/lib/paaltje-chat";
import { FrequentieKeuze } from "@/components/FrequentieKiezer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function VoorstelKaart({
  voorstel,
  namen,
}: {
  voorstel: Voorstel;
  /** `employee_id` → naam, van `lees_voorstellen` (aangevraagd_door,
   *  afgehandeld_door, teruggedraaid_door). Ontbreekt een id erin, dan laat
   *  je die aanduiding gewoon weg. */
  namen?: Record<string, string> | undefined;
}) {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const magKlanten = useRecht("klanten_bewerken");
  const magPrijzen = useRecht("prijzen_zien");

  const aanvragerNaam = voorstel.aangevraagd_door ? namen?.[voorstel.aangevraagd_door] : undefined;
  const teruggedraaidDoorNaam = voorstel.teruggedraaid_door
    ? namen?.[voorstel.teruggedraaid_door]
    : undefined;

  const [vinkjes, setVinkjes] = useState<Record<string, boolean>>({});
  const [bewerkt, setBewerkt] = useState<Record<string, unknown>>({});
  const [bezig, setBezig] = useState<string | null>(null);
  const [verouderd, setVerouderd] = useState<{ regel_id: string; nu: unknown }[] | null>(null);
  const [redenVeld, setRedenVeld] = useState(false);
  const [reden, setReden] = useState("");

  const isVrager = !!employee && voorstel.aangevraagd_door === employee.id;
  const regels = voorstel.gevraagd;
  const bewerkbaar = voorstel.status === "te_keuren" && !isVrager;
  // Vinkjes hebben alleen nut waar ze ook echt meegaan in een actie: bij de
  // vrager die nog moet kiezen (open), en bij de keurder (te_keuren). Wacht
  // de vrager juist op iemand anders, dan is het voorstel voor hem read-only.
  const kanKiezen = voorstel.status === "open" || bewerkbaar;
  const meerdereRegels = regels.length > 1;
  const magAlle = regels.every((r) => magRegel(r.veld, magKlanten, magPrijzen));

  // Bij doorgevoerd tonen we altijd de hele gevraagde lijst, ook de regels
  // die je hebt uitgevinkt: die staan niet in `doorgevoerd`, maar moeten wel
  // te zien blijven — anders lijkt het of je ze vergeten was, in plaats van
  // dat je ze bewust hebt overgeslagen.
  const doorgevoerd = voorstel.doorgevoerd;
  const weergaveRegels: (Regel & { overgeslagen?: boolean })[] =
    voorstel.status === "doorgevoerd" && doorgevoerd
      ? regels.map((r) => doorgevoerd.find((d) => d.id === r.id) ?? { ...r, overgeslagen: true })
      : regels;

  function aanVoor(r: Regel): boolean {
    return vinkjes[r.id] ?? r.aan ?? true;
  }
  function nieuwVoor(r: Regel): unknown {
    return r.id in bewerkt ? bewerkt[r.id] : r.nieuw;
  }
  function huidigeRegels(): RegelPatch[] {
    return regels.map((r) => {
      const aan = aanVoor(r);
      const nieuw = nieuwVoor(r);
      // Een prijsregel die je niet aanraakt (of net leegmaakte) stuur je
      // zonder `nieuw` mee — de server weigert een expliciete `null`.
      if (r.veld === "prijs" && nieuw === null) return { id: r.id, aan };
      return { ...r, aan, nieuw };
    });
  }

  // Een leeg prijsvak mag nooit stilletjes € 0 worden: zolang een aangevinkte
  // prijsregel leeg staat, kan er niet goedgekeurd worden.
  const legePrijs = regels.some((r) => r.veld === "prijs" && aanVoor(r) && nieuwVoor(r) === null);

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["paaltje-voorstellen"] });
    void qc.invalidateQueries({ queryKey: ["paaltje-gesprek"] });
    void qc.invalidateQueries({ queryKey: ["paaltje-te-keuren"] });
    void qc.invalidateQueries({ queryKey: ["paaltje-te-keuren-aantal"] });
  };
  const versDataOveral = () => {
    ververs();
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["klanten"] });
  };

  async function doe(naam: string, actie: () => Promise<unknown>, gelukt?: string) {
    setBezig(naam);
    setVerouderd(null);
    try {
      await actie();
      if (gelukt) toast.success(gelukt);
    } catch (e) {
      if (e instanceof VoorstelVerouderdFout) {
        setVerouderd(e.verouderd);
        toast.error(e.message || "Dit voorstel is intussen veranderd.");
      } else {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBezig(null);
    }
  }

  // Wat er is doorgevoerd kan afwijken van wat er gevraagd was: een keurder
  // paste het met de hand aan, óf de server schoof zelf iets op (een
  // startmaand die op een overgeslagen maand viel bijvoorbeeld). In beide
  // gevallen hoort dat hier te staan — vandaar geen aparte melding voor
  // "door de keurder" en een formulering die bij allebei past.
  const aanpassingen =
    voorstel.status === "doorgevoerd" && doorgevoerd
      ? doorgevoerd
          .map((d) => {
            const gevraagd = regels.find((r) => r.id === d.id);
            if (!gevraagd) return null;
            const gevraagdTekst = regelWaarde(gevraagd.veld, gevraagd.nieuw);
            const doorgevoerdTekst = regelWaarde(d.veld, d.nieuw);
            if (gevraagdTekst === doorgevoerdTekst) return null;
            return { regel: d, gevraagdTekst, doorgevoerdTekst };
          })
          .filter(
            (x): x is { regel: Regel; gevraagdTekst: string; doorgevoerdTekst: string } => !!x,
          )
      : [];

  return (
    <div className="w-full rounded-[14px] border border-border bg-card p-3 text-[13px] shadow-card">
      {voorstel.samenvatting && (
        <p className="mb-2 font-medium leading-snug">{voorstel.samenvatting}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {weergaveRegels.map((r) => (
          <RegelRij
            key={r.id}
            r={r}
            toonVink={kanKiezen && (meerdereRegels || r.veld === "overslaan")}
            aan={aanVoor(r)}
            onToggle={(v) => setVinkjes((s) => ({ ...s, [r.id]: v }))}
            // Een prijs is alleen te bewerken als de keurder zelf ook
            // prijzen mag zien — anders krijgt hij toch geen echte waarde te
            // zien om vanaf te bewerken, en toont hij nergens een verborgen
            // prijs in een invulveld.
            bewerkbaar={bewerkbaar && r.veld !== "overslaan" && (r.veld !== "prijs" || magPrijzen)}
            waarde={nieuwVoor(r)}
            onWaardeChange={(w) => setBewerkt((s) => ({ ...s, [r.id]: w }))}
            verouderdNu={verouderd?.find((v) => v.regel_id === r.id)?.nu}
            overgeslagen={r.overgeslagen}
          />
        ))}
      </div>

      {verouderd && verouderd.length > 0 && (
        <div className="mt-2.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full"
            disabled={bezig !== null || legePrijs}
            onClick={() =>
              void doe(
                "toch",
                async () => {
                  await doorvoeren(voorstel.id, huidigeRegels(), true);
                  versDataOveral();
                },
                "Doorgevoerd.",
              )
            }
          >
            {bezig === "toch" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            Toch doorvoeren
          </Button>
        </div>
      )}

      {voorstel.status === "open" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {magAlle ? (
            <Button
              size="sm"
              className="h-7 rounded-full"
              disabled={bezig !== null}
              onClick={() =>
                void doe(
                  "doorvoeren",
                  async () => {
                    await doorvoeren(voorstel.id, huidigeRegels());
                    versDataOveral();
                  },
                  "Doorgevoerd.",
                )
              }
            >
              {bezig === "doorvoeren" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              Doorvoeren
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="h-7 rounded-full"
                disabled={bezig !== null}
                onClick={() =>
                  void doe(
                    "aanvragen",
                    async () => {
                      await aanvragen(voorstel.id, huidigeRegels());
                      ververs();
                    },
                    "Aanvraag verstuurd.",
                  )
                }
              >
                {bezig === "aanvragen" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Send className="size-3" />
                )}
                Aanvraag versturen
              </Button>
              <span className="text-[11.5px] text-muted-foreground">
                Iemand met rechten keurt dit goed.
              </span>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full"
            disabled={bezig !== null}
            onClick={() =>
              void doe("annuleren", async () => {
                await annuleren(voorstel.id);
                ververs();
              })
            }
          >
            Annuleren
          </Button>
        </div>
      )}

      {voorstel.status === "te_keuren" && isVrager && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] text-muted-foreground">
            <Clock className="size-3" /> Wacht op goedkeuring
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full"
            disabled={bezig !== null}
            onClick={() =>
              void doe("annuleren", async () => {
                await annuleren(voorstel.id);
                ververs();
              })
            }
          >
            Annuleren
          </Button>
        </div>
      )}

      {voorstel.status === "te_keuren" && !isVrager && (
        <div className="mt-2.5">
          {aanvragerNaam && (
            <p className="mb-1.5 text-[12px] text-muted-foreground">
              Gevraagd door {aanvragerNaam}
            </p>
          )}
          {!magAlle && (
            <p className="mb-1.5 text-[12px] text-tint-amber-ink">
              Je hebt niet alle rechten om dit goed te keuren
              {!magPrijzen && regels.some((r) => r.veld === "prijs")
                ? " (Prijzen zien ontbreekt)"
                : ""}
              .
            </p>
          )}
          {magAlle && legePrijs && (
            <p className="mb-1.5 text-[12px] text-tint-amber-ink">
              Vul bij elke prijs een bedrag in.
            </p>
          )}
          {!redenVeld ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-7 rounded-full"
                disabled={bezig !== null || !magAlle || legePrijs}
                onClick={() =>
                  void doe(
                    "doorvoeren",
                    async () => {
                      await doorvoeren(voorstel.id, huidigeRegels());
                      versDataOveral();
                    },
                    "Goedgekeurd en doorgevoerd.",
                  )
                }
              >
                {bezig === "doorvoeren" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                Goedkeuren
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full"
                disabled={bezig !== null}
                onClick={() => setRedenVeld(true)}
              >
                <X className="size-3" /> Afwijzen
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={reden}
                  onChange={(e) => setReden(e.target.value)}
                  placeholder="Reden (mag leeg)"
                  maxLength={500}
                  className="h-8 min-w-[9rem] flex-1 text-[12.5px]"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-full"
                  disabled={bezig !== null}
                  onClick={() =>
                    void doe(
                      "afwijzen",
                      async () => {
                        await afwijzen(voorstel.id, reden);
                        ververs();
                      },
                      "Afgewezen.",
                    )
                  }
                >
                  {bezig === "afwijzen" && <Loader2 className="size-3 animate-spin" />}
                  Afwijzen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full"
                  onClick={() => setRedenVeld(false)}
                >
                  Terug
                </Button>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                De aanvrager ziet deze reden, noem geen prijzen.
              </p>
            </div>
          )}
        </div>
      )}

      {voorstel.status === "doorgevoerd" && (
        <div className="mt-2.5 rounded-[12px] border border-tint-amber-ink/25 bg-tint-amber p-2.5 text-tint-amber-ink">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <CircleCheck className="size-3.5" /> Doorgevoerd
          </p>
          {aanpassingen.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[12px]">
              {aanpassingen.map((a) => (
                <li key={a.regel.id}>
                  {a.regel.adres} · {VELD_LABEL[a.regel.veld]}: gevraagd {a.gevraagdTekst},
                  doorgevoerd {a.doorgevoerdTekst}
                </li>
              ))}
            </ul>
          )}
          {magKlanten && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 rounded-full border-tint-amber-ink/30 bg-card/70 text-tint-amber-ink hover:bg-card"
              disabled={bezig !== null}
              onClick={() =>
                void doe("terugdraaien", async () => {
                  const r = await terugdraaien(voorstel.id);
                  versDataOveral();
                  toast.success(
                    r.overgeslagen.length > 0
                      ? `Teruggedraaid. Bleef staan omdat het intussen aangepast was: ${r.overgeslagen.length} ${r.overgeslagen.length === 1 ? "regel" : "regels"}.`
                      : "Teruggedraaid.",
                  );
                })
              }
            >
              {bezig === "terugdraaien" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Undo2 className="size-3" />
              )}
              Ongedaan maken
            </Button>
          )}
        </div>
      )}

      {(voorstel.status === "afgewezen" ||
        voorstel.status === "geannuleerd" ||
        voorstel.status === "teruggedraaid") && (
        <div className="mt-2.5 rounded-[12px] border border-dashed border-border bg-muted/40 px-2.5 py-2 text-[12px] text-muted-foreground">
          {voorstel.status === "afgewezen" && (
            <>
              <X className="mr-1 inline size-3" />
              Afgewezen{voorstel.reden ? `: ${voorstel.reden}` : "."}
            </>
          )}
          {voorstel.status === "geannuleerd" && "Geannuleerd."}
          {voorstel.status === "teruggedraaid" &&
            (teruggedraaidDoorNaam
              ? `Teruggedraaid door ${teruggedraaidDoorNaam}.`
              : "Teruggedraaid.")}
        </div>
      )}
    </div>
  );
}

function RegelRij({
  r,
  toonVink,
  aan,
  onToggle,
  bewerkbaar,
  waarde,
  onWaardeChange,
  verouderdNu,
  overgeslagen,
}: {
  r: Regel;
  toonVink: boolean;
  aan: boolean;
  onToggle: (v: boolean) => void;
  bewerkbaar: boolean;
  waarde: unknown;
  onWaardeChange: (w: unknown) => void;
  verouderdNu?: unknown;
  /** Wel gevraagd, maar bewust uitgevinkt bij het doorvoeren — niet weg dus,
   *  maar grijs en zonder oud → nieuw, want dat is er nooit geweest. */
  overgeslagen?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[10px] px-2.5 py-2",
        overgeslagen ? "bg-muted/30" : "bg-muted/50",
      )}
    >
      {toonVink && (
        <Checkbox
          checked={aan}
          onCheckedChange={(v) => onToggle(!!v)}
          className="mt-0.5"
          aria-label={`${r.adres} meenemen`}
        />
      )}
      <div className={cn("min-w-0 flex-1", overgeslagen && "text-muted-foreground")}>
        <p className="truncate text-[12px] text-muted-foreground">
          {[r.adres, r.klant].filter(Boolean).join(" · ")} · {VELD_LABEL[r.veld]}
        </p>
        {overgeslagen ? (
          <p className="mt-0.5 italic">Niet doorgevoerd</p>
        ) : !bewerkbaar ? (
          <p className="mt-0.5 break-words">
            <span className={cn(r.oud_verborgen && "italic")}>
              {r.oud_verborgen ? "verborgen" : regelWaarde(r.veld, r.oud)}
            </span>{" "}
            →{" "}
            <span className="font-medium">
              {/* De vrager ziet zijn eigen gevraagde prijs gewoon (dan komt
                  `waarde` niet leeg terug); voor iedereen zonder prijzen_zien
                  toont de server hem als null, en dan staat er "verborgen". */}
              {r.oud_verborgen && waarde === null ? "verborgen" : regelWaarde(r.veld, waarde)}
            </span>
          </p>
        ) : (
          <RegelInvoer r={r} waarde={waarde} onChange={onWaardeChange} />
        )}
        {!overgeslagen && r.let_op && (
          <p className="mt-1 flex items-start gap-1 text-[12px] text-tint-amber-ink">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {r.let_op}
          </p>
        )}
        {verouderdNu !== undefined && (
          <p className="mt-1 text-[12px] text-tint-rood-ink">
            is intussen veranderd: nu {regelWaarde(r.veld, verouderdNu)}
          </p>
        )}
      </div>
    </div>
  );
}

function RegelInvoer({
  r,
  waarde,
  onChange,
}: {
  r: Regel;
  waarde: unknown;
  onChange: (w: unknown) => void;
}) {
  if (r.veld === "prijs") {
    return (
      <Input
        type="number"
        step="0.01"
        placeholder="Prijs"
        value={typeof waarde === "number" ? waarde : ""}
        // Leeg blijft leeg (null) — geen stille € 0. De Goedkeuren-knop
        // staat uit zolang dit zo blijft, zie `legePrijs` hierboven.
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 h-8 max-w-[8rem] text-[13px]"
      />
    );
  }
  if (r.veld === "frequentie") {
    const w = waarde as { interval_maanden?: number; ritme?: number } | null;
    const huidig = w?.interval_maanden
      ? ritmeWaarde({ interval_maanden: w.interval_maanden, ritme: w.ritme ?? 1 })
      : "";
    return (
      <div className="mt-1 inline-flex h-8 items-center rounded-[8px] border border-input bg-background px-2">
        <FrequentieKeuze
          value={huidig}
          onChange={(v) => {
            const gelezen = leesRitmeWaarde(v);
            if (gelezen) onChange(gelezen);
          }}
        />
      </div>
    );
  }
  if (r.veld === "wassen_vanaf") {
    const huidig = typeof waarde === "string" ? waarde : "";
    // Standaard twaalf maanden, maar stelt Paaltje (of de server, na een
    // opschuiving) een verdere maand voor, dan loopt de lijst door tot en
    // met die maand — anders kan de keurder na een vergissing niet meer
    // terugkiezen naar wat er eigenlijk gevraagd was.
    const maanden = komendeMaanden(huidig ? maandenTotEnMet(huidig) : undefined);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mt-1 flex h-8 w-full max-w-[13rem] items-center gap-1.5 rounded-[8px] border border-input bg-background px-2 text-left text-[13px]"
          >
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("min-w-0 flex-1 truncate", !huidig && "text-muted-foreground")}>
              {huidig ? maandMetJaar(huidig) : GEEN_STARTMAAND}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-48 overflow-y-auto">
          {maanden.map((m) => (
            <DropdownMenuItem key={m} onSelect={() => onChange(m)}>
              <span className="capitalize">{toonMaand(m)}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.slice(0, 4)}</span>
              {huidig === m && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onChange("")}>
            <CircleSlash className="size-4" /> Geen startmaand (meteen)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Input
      value={typeof waarde === "string" ? waarde : ""}
      onChange={(e) => onChange(e.target.value)}
      maxLength={500}
      className="mt-1 h-8 text-[13px]"
    />
  );
}

/** Hoeveel maanden `komendeMaanden` moet leveren om `doel` ("jjjj-mm") nog
 *  mee te nemen — nooit minder dan de gewone twaalf, en de server staat toch
 *  niet meer dan vijf jaar vooruit toe. */
function maandenTotEnMet(doel: string): number {
  const [doelJaar, doelMaand] = doel.split("-").map(Number);
  if (!doelJaar || !doelMaand) return 12;
  const nu = new Date();
  const verschil = (doelJaar - nu.getFullYear()) * 12 + (doelMaand - (nu.getMonth() + 1)) + 1;
  return Math.max(12, Math.min(verschil, 60));
}
