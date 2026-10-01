/**
 * Klachten in het klantdossier, rechts in "Mail en klachten": één klacht
 * met de afhandeling, en het formulier om er zelf een te noteren.
 *
 * Een open klacht is rood, een afgehandelde grijs. Paaltje maakt klachten uit
 * mail; daar staat "door Paaltje" bij, met Ongedaan maken. Zelf invoeren kan
 * ook, na een telefoontje, aan de deur of een appje.
 *
 * Het adres is optioneel: zonder gekozen adres geldt de klacht voor elk adres
 * van de klant, en staat het rode stipje op de planning overal.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconCheck as Check,
  IconMail as Mail,
  IconRotate as RotateCcw,
  IconSparkles as Sparkles,
  IconTrash as Trash2,
  IconArrowBackUp as Undo2,
} from "@tabler/icons-react";
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
import {
  BRON_LABEL,
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

/** Ververs alles wat klachten toont, en doe een actie met een melding. */
function useKlachtActies(klantId: string) {
  const qc = useQueryClient();
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

  return { ververs, doe, weg };
}

/**
 * Eén klacht, rechts in "Mail en klachten": wat er mis was, hoe en wanneer
 * het binnenkwam, over welk adres, en de afhandeling.
 */
export function KlachtDetail({
  klantId,
  k,
  adressen,
  onToonMail,
}: {
  klantId: string;
  k: Klacht;
  adressen: AdresKeuze[];
  /** Naar de mail die bij deze klacht hoort; alleen als je mail mag lezen. */
  onToonMail?: ((berichtId: string) => void) | undefined;
}) {
  const magBewerken = useRecht("klanten_bewerken");
  const { doe, weg } = useKlachtActies(klantId);
  const open = k.status === "open";

  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] bg-card p-[18px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
        <span>
          {datum(k.ontvangen_op)} · {BRON_LABEL[k.bron].toLowerCase()}
        </span>
        {k.door_paaltje && (
          <span className="inline-flex items-center gap-1 rounded-full bg-tint-paars px-2 py-px">
            <Sparkles className="size-3" /> door Paaltje
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 font-display text-[18px] font-semibold">Klacht</div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold",
            open ? "bg-tint-rood" : "bg-muted text-muted-foreground",
          )}
        >
          {open
            ? "staat open"
            : `afgehandeld${k.afgehandeld_op ? ` ${datum(k.afgehandeld_op)}` : ""}`}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.55]">{k.omschrijving}</p>

      {adressen.length > 1 || (adressen.length === 1 && k.customer_id === null) ? (
        <Select
          value={k.customer_id ?? ALLE}
          disabled={!magBewerken}
          onValueChange={(v) => void doe(() => zetKlachtAdres(k.id, v === ALLE ? null : v))}
        >
          <SelectTrigger
            aria-label="Over welk adres"
            className="h-9 w-auto min-w-0 max-w-full self-start rounded-full px-3 text-[13px]"
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
        adressen[0] && <div className="text-[13px] text-muted-foreground">{adressen[0].label}</div>
      )}

      {k.bericht_ids.length > 0 && onToonMail && (
        <button
          type="button"
          onClick={() => onToonMail(k.bericht_ids[0]!)}
          className="inline-flex items-center gap-1.5 self-start text-[13px] text-tint-oranje-mid underline underline-offset-2 hover:text-tint-oranje-ink"
        >
          <Mail className="size-3.5" />
          {k.bericht_ids.length === 1
            ? "De mail erbij"
            : `De mails erbij (${k.bericht_ids.length})`}
        </button>
      )}

      {magBewerken && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void doe(
                () => zetKlachtStatus(k.id, open ? "afgehandeld" : "open"),
                open ? "Klacht afgehandeld." : "Klacht staat weer open.",
              )
            }
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] transition-colors",
              open
                ? "bg-foreground font-semibold text-background hover:opacity-90"
                : "border border-border bg-card hover:bg-accent",
            )}
          >
            {open ? <Check className="size-3.5" /> : <RotateCcw className="size-3.5" />}
            {open ? "Afgehandeld" : "Weer open"}
          </button>
          <button
            type="button"
            onClick={() => void weg(k)}
            title={k.door_paaltje ? "Paaltje zag het verkeerd" : "Weggooien"}
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {k.door_paaltje ? <Undo2 className="size-3.5" /> : <Trash2 className="size-3.5" />}
            {k.door_paaltje ? "Ongedaan maken" : "Weggooien"}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Klacht noteren": het formulier, in een witte kaart. */
export function KlachtNoteren({
  klantId,
  adressen,
  onKlaar,
}: {
  klantId: string;
  adressen: AdresKeuze[];
  /** Na opslaan of annuleren. */
  onKlaar: () => void;
}) {
  const { ververs } = useKlachtActies(klantId);
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] bg-card p-[18px]">
      <div className="font-display text-[18px] font-semibold">Klacht noteren</div>
      <p className="text-[13px] text-muted-foreground">
        Na een telefoontje, aan de deur of via een appje. Klaagt de klant per mail, dan zet Paaltje
        het er zelf bij.
      </p>
      <NieuweKlacht
        adressen={adressen}
        onAnnuleer={onKlaar}
        onOpslaan={async (k) => {
          try {
            await nieuweKlacht({ ...k, klant_id: klantId });
            ververs();
            onKlaar();
            toast.success("Klacht genoteerd.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </div>
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
