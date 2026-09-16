/**
 * Tabblad Klachten in het klantdossier.
 *
 * Een open klacht is rood, een afgehandelde grijs. Paaltje maakt klachten uit
 * mail; daar staat "door Paaltje" bij, met Ongedaan maken. Zelf invoeren kan
 * ook, na een telefoontje, aan de deur of een appje.
 *
 * Het adres is optioneel: zonder gekozen adres geldt de klacht voor elk adres
 * van de klant, en staat het rode stipje op de planning overal.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Mail, Plus, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PopupBlok, PopupHint } from "@/components/Popup";
import {
  BRON_LABEL,
  fetchKlachtenVanKlant,
  legKlachtWeg,
  nieuweKlacht,
  zetKlachtAdres,
  zetKlachtStatus,
  type Klacht,
  type KlachtBron,
} from "@/lib/klachten";
import { useRecht } from "@/lib/rechten";
import { cn } from "@/lib/utils";

const ALLE = "alle";

export interface AdresKeuze {
  id: string;
  label: string;
}

export function DossierKlachten({
  klantId,
  adressen,
  onToonMail,
}: {
  klantId: string;
  adressen: AdresKeuze[];
  /** Naar het tabblad Mail; alleen als je mail mag lezen. */
  onToonMail?: (() => void) | undefined;
}) {
  const qc = useQueryClient();
  const magBewerken = useRecht("klanten_bewerken");
  const klachten = useQuery({
    queryKey: ["klachten", klantId],
    queryFn: () => fetchKlachtenVanKlant(klantId),
  });
  const [nieuwOpen, setNieuwOpen] = useState(false);

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["klachten", klantId] });
    void qc.invalidateQueries({ queryKey: ["open-klachten"] });
  };

  async function doe(actie: () => Promise<void>, gelukt?: string) {
    try {
      await actie();
      ververs();
      if (gelukt) toast.success(gelukt);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function weg(k: Klacht) {
    try {
      await legKlachtWeg(k.id, true);
    } catch (e) {
      return void toast.error(e instanceof Error ? e.message : String(e));
    }
    ververs();
    toast.success(k.door_paaltje ? "Klacht van Paaltje teruggedraaid." : "Klacht weggegooid.", {
      action: {
        label: "Ongedaan maken",
        onClick: () => void doe(() => legKlachtWeg(k.id, false)),
      },
    });
  }

  const lijst = klachten.data ?? [];
  const aantalOpen = lijst.filter((k) => k.status === "open").length;

  return (
    <PopupBlok label="Klachten" terzijde={aantalOpen > 0 ? `${aantalOpen} open` : undefined}>
      {klachten.isLoading ? (
        <PopupHint>Even ophalen…</PopupHint>
      ) : klachten.isError ? (
        <p className="text-[13px] text-tint-rood-ink">De klachten konden niet geladen worden.</p>
      ) : lijst.length === 0 && !nieuwOpen ? (
        <PopupHint>
          Geen klachten. Klaagt deze klant per mail, dan zet Paaltje het hier neer. Een klacht via
          de telefoon of aan de deur voer je zelf in.
        </PopupHint>
      ) : (
        <ul className="flex flex-col gap-2">
          {lijst.map((k) => {
            const open = k.status === "open";
            return (
              <li
                key={k.id}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-[13px]",
                  open ? "bg-tint-rood text-tint-rood-ink" : "bg-muted/60 text-muted-foreground",
                )}
              >
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words leading-snug",
                    open && "font-medium",
                  )}
                >
                  {k.omschrijving}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                  <span>{datum(k.ontvangen_op)}</span>
                  <span aria-hidden>·</span>
                  <span>{BRON_LABEL[k.bron]}</span>
                  {k.door_paaltje && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-px">
                      <Sparkles className="size-3" /> door Paaltje
                    </span>
                  )}
                  {k.bericht_ids.length > 0 && onToonMail && (
                    <button
                      type="button"
                      onClick={onToonMail}
                      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                    >
                      <Mail className="size-3" />
                      {k.bericht_ids.length === 1 ? "1 mail" : `${k.bericht_ids.length} mails`}
                    </button>
                  )}
                  {!open && k.afgehandeld_op && (
                    <span>· afgehandeld {datum(k.afgehandeld_op)}</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {adressen.length > 1 || (adressen.length === 1 && k.customer_id === null) ? (
                    <Select
                      value={k.customer_id ?? ALLE}
                      disabled={!magBewerken}
                      onValueChange={(v) =>
                        void doe(() => zetKlachtAdres(k.id, v === ALLE ? null : v))
                      }
                    >
                      <SelectTrigger
                        aria-label="Over welk adres"
                        className="h-7 w-auto min-w-0 max-w-[220px] rounded-full border-current/20 bg-background/60 px-2.5 text-[12px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALLE}>Alle adressen</SelectItem>
                        {adressen.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    adressen[0] && <span className="text-[12px]">{adressen[0].label}</span>
                  )}

                  {magBewerken && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant={open ? "default" : "outline"}
                        className="ml-auto h-7 rounded-full px-3 text-[12px]"
                        onClick={() =>
                          void doe(
                            () => zetKlachtStatus(k.id, open ? "afgehandeld" : "open"),
                            open ? "Klacht afgehandeld." : "Klacht staat weer open.",
                          )
                        }
                      >
                        {open ? <Check className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                        {open ? "Afgehandeld" : "Weer open"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-full px-2.5 text-[12px] text-current hover:bg-background/60"
                        onClick={() => void weg(k)}
                        title={k.door_paaltje ? "Paaltje zag het verkeerd" : "Weggooien"}
                      >
                        {k.door_paaltje ? (
                          <Undo2 className="size-3.5" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        {k.door_paaltje ? "Ongedaan maken" : ""}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {magBewerken &&
        (nieuwOpen ? (
          <NieuweKlacht
            adressen={adressen}
            onAnnuleer={() => setNieuwOpen(false)}
            onOpslaan={async (k) => {
              try {
                await nieuweKlacht({ ...k, klant_id: klantId });
                ververs();
                setNieuwOpen(false);
                toast.success("Klacht genoteerd.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start rounded-full"
            onClick={() => setNieuwOpen(true)}
          >
            <Plus className="size-4" /> Klacht toevoegen
          </Button>
        ))}
    </PopupBlok>
  );
}

function NieuweKlacht({
  adressen,
  onAnnuleer,
  onOpslaan,
}: {
  adressen: AdresKeuze[];
  onAnnuleer: () => void;
  onOpslaan: (k: {
    omschrijving: string;
    bron: KlachtBron;
    ontvangen_op: string;
    customer_id: string | null;
  }) => Promise<void>;
}) {
  const [omschrijving, setOmschrijving] = useState("");
  const [bron, setBron] = useState<KlachtBron>("telefoon");
  const [dag, setDag] = useState(() => vandaag());
  // Eén adres: dan gaat het daarover.
  const [adres, setAdres] = useState(adressen.length === 1 ? adressen[0]!.id : ALLE);
  const [bezig, setBezig] = useState(false);

  async function opslaan() {
    const tekst = omschrijving.trim();
    if (!tekst) return void toast.error("Waar gaat de klacht over?");
    setBezig(true);
    // Vandaag: het echte tijdstip; een eerdere dag: midden op die dag.
    const tijd = dag === vandaag() ? new Date() : new Date(`${dag}T12:00:00`);
    await onOpslaan({
      omschrijving: tekst.slice(0, 500),
      bron,
      ontvangen_op: tijd.toISOString(),
      customer_id: adres === ALLE ? null : adres,
    });
    setBezig(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-input bg-background/70 p-3">
      <Textarea
        aria-label="Omschrijving van de klacht"
        placeholder="Bijvoorbeeld: strepen op de voorramen, achterkant vergeten"
        value={omschrijving}
        maxLength={500}
        rows={3}
        autoFocus
        onChange={(e) => setOmschrijving(e.target.value)}
        className="rounded-lg text-[13.5px]"
      />
      <div className="flex flex-wrap gap-2">
        <Select value={bron} onValueChange={(v) => setBron(v as KlachtBron)}>
          <SelectTrigger
            aria-label="Hoe kwam de klacht binnen"
            className="h-8 w-auto rounded-full text-[12.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["telefoon", "deur", "app", "mail", "anders"] as KlachtBron[]).map((b) => (
              <SelectItem key={b} value={b}>
                {BRON_LABEL[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label="Wanneer"
          value={dag}
          max={vandaag()}
          onChange={(e) => setDag(e.target.value || vandaag())}
          className="h-8 w-auto rounded-full text-[12.5px]"
        />
        {adressen.length > 1 && (
          <Select value={adres} onValueChange={setAdres}>
            <SelectTrigger
              aria-label="Over welk adres"
              className="h-8 w-auto max-w-[220px] rounded-full text-[12.5px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALLE}>Alle adressen</SelectItem>
              {adressen.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={onAnnuleer}
          disabled={bezig}
        >
          Annuleren
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-full"
          onClick={() => void opslaan()}
          disabled={bezig}
        >
          {bezig ? "Bezig…" : "Klacht opslaan"}
        </Button>
      </div>
    </div>
  );
}

/** "jjjj-mm-dd" in je eigen tijdzone. */
function vandaag(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function datum(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
