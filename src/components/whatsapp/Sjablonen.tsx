/**
 * Alles rond berichten die jij begint via WhatsApp.
 *
 * - SjablonenBeheer: sjablonen schrijven en naar Meta sturen, status volgen.
 * - ToestemmingBestaandeKlanten: in één keer vastleggen dat bestaande
 *   klanten via WhatsApp aankondigingen mogen krijgen (met Ongedaan maken).
 * - SjabloonBericht: een los bericht via een sjabloon, als het 24-uursvenster
 *   dicht is.
 * - KlantKanaal: per klant de voorkeur en de toestemming.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconLoader2 as Loader2,
  IconRefresh as RefreshCw,
  IconSend as Send,
  IconTrash as Trash2,
  IconArrowBackUp as Undo2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRecht } from "@/lib/rechten";
import { useAuth } from "@/lib/auth";
import {
  draaiToestemmingTerug,
  fetchKlantWhatsApp,
  fetchSjablonen,
  fetchToestemmingTelling,
  gooiSjabloonWeg,
  maakSjabloon,
  SJABLOON_STATUS_TEKST,
  sjabloonVoorbeeld,
  verstuurSjabloon,
  verversSjablonen,
  zetKlantWhatsApp,
  zetToestemmingBestaandeKlanten,
  type KlantWhatsApp,
  type Sjabloon,
  type SjabloonWaarden,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

function melding(e: unknown) {
  toast.error(e instanceof Error ? e.message : String(e));
}

const STATUS_KLEUR: Record<Sjabloon["status"], string> = {
  ingediend: "bg-tint-blauw text-tint-blauw-ink",
  goedgekeurd: "bg-tint-groen text-tint-groen-ink",
  afgewezen: "bg-tint-rood text-tint-rood-ink",
  gepauzeerd: "bg-tint-amber text-tint-amber-ink",
  uitgeschakeld: "bg-muted text-muted-foreground",
};

const VOORBEELDTEKST =
  "Hoi {naam}, wij komen {datum} de ramen wassen aan de {adres}. Kan het die dag niet? Laat het ons even weten.";

export function SjablonenBeheer({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const sjablonen = useQuery({ queryKey: ["wa-sjablonen"], queryFn: fetchSjablonen });
  const [titel, setTitel] = useState("");
  const [categorie, setCategorie] = useState<"utility" | "marketing">("utility");
  const [tekst, setTekst] = useState(VOORBEELDTEKST);
  const [bezig, setBezig] = useState<"maken" | "verversen" | null>(null);
  const ververs = () => void qc.invalidateQueries({ queryKey: ["wa-sjablonen"] });

  async function maak(e: React.FormEvent) {
    e.preventDefault();
    setBezig("maken");
    try {
      const uit = await maakSjabloon({ titel: titel.trim(), categorie, tekst });
      setTitel("");
      toast.success(
        uit.status === "goedgekeurd"
          ? "Meta keurde het meteen goed."
          : "Naar Meta gestuurd. Goedkeuren duurt meestal een paar minuten.",
      );
      ververs();
    } catch (err) {
      melding(err);
    } finally {
      setBezig(null);
    }
  }

  async function haalStatusOp() {
    setBezig("verversen");
    try {
      await verversSjablonen();
      ververs();
    } catch (err) {
      melding(err);
    } finally {
      setBezig(null);
    }
  }

  const lijst = sjablonen.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-medium">Templates</p>
          <p className="text-[12.5px] text-muted-foreground">
            Een bericht dat jij begint (een aankondiging, of een appje na meer dan 24 uur) moet
            eerst door Meta goedgekeurd zijn.
          </p>
        </div>
        {lijst.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={bezig !== null}
            onClick={() => void haalStatusOp()}
          >
            <RefreshCw className={cn("size-3.5", bezig === "verversen" && "animate-spin")} /> Status
            ophalen
          </Button>
        )}
      </div>

      {lijst.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-[14px] bg-card shadow-card">
          {lijst.map((s) => (
            <li key={s.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{s.titel}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    STATUS_KLEUR[s.status],
                  )}
                >
                  {SJABLOON_STATUS_TEKST[s.status]}
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {s.categorie === "marketing" ? "nieuws en acties" : "aankondiging / service"}
                </span>
                {isEigenaar && (
                  <button
                    type="button"
                    aria-label={`${s.titel} weggooien`}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      const ja = await bevestig({
                        titel: `${s.titel} weggooien?`,
                        tekst:
                          "De template gaat ook bij Meta weg. Wat ermee verstuurd is, blijft staan.",
                        bevestigLabel: "Weggooien",
                        gevaarlijk: true,
                      });
                      if (ja) void gooiSjabloonWeg(s.id).then(ververs).catch(melding);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">{s.tekst}</p>
              {s.status === "afgewezen" && s.afwijsreden && (
                <p className="text-[12px] text-tint-rood-ink">Reden van Meta: {s.afwijsreden}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {isEigenaar && (
        <form
          onSubmit={(e) => void maak(e)}
          className="space-y-2 rounded-[12px] border border-dashed border-border p-3"
        >
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label htmlFor="sj-titel">Naam</Label>
              <Input
                id="sj-titel"
                value={titel}
                maxLength={60}
                placeholder="Bijv. Aankondiging wasdag"
                onChange={(e) => setTitel(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sj-categorie">Soort</Label>
              <select
                id="sj-categorie"
                value={categorie}
                onChange={(e) => setCategorie(e.target.value as "utility" | "marketing")}
                className="h-9 rounded-[10px] border border-input bg-background px-2 text-[13px]"
              >
                <option value="utility">Aankondiging / service</option>
                <option value="marketing">Nieuws en acties</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sj-tekst">Tekst</Label>
            <Textarea
              id="sj-tekst"
              value={tekst}
              maxLength={1024}
              rows={4}
              onChange={(e) => setTekst(e.target.value)}
              required
            />
            <p className="text-[12px] text-muted-foreground">
              Gebruik <code className="rounded bg-muted px-1">{"{naam}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{datum}"}</code> en{" "}
              <code className="rounded bg-muted px-1">{"{adres}"}</code>. Niet aan het begin of het
              eind van de tekst, en niet twee direct achter elkaar. Zet geen reclame in een
              aankondiging: dan maakt Meta er "nieuws en acties" van, en dat kost meer.
            </p>
          </div>
          <Button type="submit" size="sm" className="rounded-full" disabled={bezig !== null}>
            {bezig === "maken" ? "Bezig…" : "Naar Meta sturen"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function ToestemmingBestaandeKlanten() {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const telling = useQuery({ queryKey: ["wa-toestemming"], queryFn: fetchToestemmingTelling });
  const [bezig, setBezig] = useState(false);
  const t = telling.data;
  if (!t) return null;

  async function zet() {
    const ja = await bevestig({
      titel: `${t!.zonder} klanten op akkoord zetten?`,
      tekst:
        "Klanten met een 06-nummer die nog geen toestemming hebben, krijgen 'akkoord – bestaande klant'. Ze kunnen dan aankondigingen via WhatsApp krijgen (niet: nieuws en acties). Wie 'stop' zegt, gaat er vanzelf weer uit.",
      bevestigLabel: "Akkoord zetten",
    });
    if (!ja) return;
    setBezig(true);
    try {
      const uit = await zetToestemmingBestaandeKlanten();
      void qc.invalidateQueries({ queryKey: ["wa-toestemming"] });
      toast.success(`${uit.aantal} klanten op akkoord gezet.`, {
        duration: 15000,
        action: {
          label: "Ongedaan maken",
          onClick: () =>
            void draaiToestemmingTerug(uit.op)
              .then((n) => {
                toast.success(`${n} klanten weer zonder toestemming.`);
                void qc.invalidateQueries({ queryKey: ["wa-toestemming"] });
              })
              .catch(melding),
        },
      });
    } catch (err) {
      melding(err);
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[13.5px] font-medium">Toestemming voor WhatsApp</p>
      <p className="text-[12.5px] text-muted-foreground">
        {t.met} klanten mogen aankondigingen via WhatsApp krijgen. {t.zonder} klanten met een
        06-nummer hebben nog geen toestemming
        {t.afgemeld > 0 ? `, ${t.afgemeld} wilden geen WhatsApp meer` : ""}.
      </p>
      {t.zonder > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={bezig}
          onClick={() => void zet()}
        >
          Bestaande klanten op akkoord zetten
        </Button>
      )}
    </div>
  );
}

/**
 * Een los bericht via een goedgekeurd sjabloon. Wooshy vult naam, adres en de
 * volgende wasdag zelf in; aanpassen mag.
 */
export function SjabloonBericht({
  telefoon,
  onVerstuurd,
}: {
  telefoon: string;
  onVerstuurd: () => void;
}) {
  const sjablonen = useQuery({ queryKey: ["wa-sjablonen"], queryFn: fetchSjablonen });
  const bruikbaar = (sjablonen.data ?? []).filter((s) => s.status === "goedgekeurd");
  const [sjabloonId, setSjabloonId] = useState("");
  const [waarden, setWaarden] = useState<Partial<SjabloonWaarden>>({});
  const [bezig, setBezig] = useState(false);
  const gekozen = bruikbaar.find((s) => s.id === sjabloonId) ?? null;

  const voorbeeld = useQuery({
    queryKey: ["wa-sjabloon-voorbeeld", telefoon, sjabloonId],
    queryFn: () => sjabloonVoorbeeld(telefoon, sjabloonId),
    enabled: !!gekozen,
    retry: false,
  });
  // Nieuwe keuze: de ingevulde waarden van de server als begin.
  useEffect(() => {
    if (voorbeeld.data) setWaarden(voorbeeld.data.waarden);
  }, [voorbeeld.data]);

  if (sjablonen.isLoading) return null;
  if (bruikbaar.length === 0) {
    return (
      <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        De klant appte langer dan 24 uur geleden. Dan kan het alleen met een door Meta goedgekeurde
        template, en die is er nog niet (Instellingen → mail → WhatsApp).
      </p>
    );
  }

  const variabelen = [...new Set(gekozen?.variabelen ?? [])] as (keyof SjabloonWaarden)[];
  const tekst = gekozen
    ? gekozen.tekst.replace(
        /\{(naam|datum|adres)\}/g,
        (_, n: keyof SjabloonWaarden) => waarden[n] || `{${n}}`,
      )
    : "";

  async function stuur() {
    if (!gekozen) return;
    setBezig(true);
    try {
      const uit = await verstuurSjabloon(telefoon, gekozen.id, waarden);
      toast.success(uit.bewaard ? "Verstuurd." : "Verstuurd, maar Wooshy kon het niet bewaren.");
      setSjabloonId("");
      onVerstuurd();
    } catch (err) {
      melding(err);
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border px-3 py-2 text-[12.5px]">
      <p className="text-muted-foreground">
        De klant appte langer dan 24 uur geleden: kies een goedgekeurde template.
      </p>
      <select
        aria-label="Template"
        value={sjabloonId}
        onChange={(e) => {
          setSjabloonId(e.target.value);
          setWaarden({});
        }}
        className="h-8 w-full rounded-[10px] border border-input bg-background px-2 text-[13px]"
      >
        <option value="">Kies een template…</option>
        {bruikbaar.map((s) => (
          <option key={s.id} value={s.id}>
            {s.titel}
            {s.categorie === "marketing" ? " (nieuws en acties)" : ""}
          </option>
        ))}
      </select>
      {gekozen && voorbeeld.isError && (
        <p className="text-tint-rood-ink">{(voorbeeld.error as Error).message}</p>
      )}
      {gekozen && voorbeeld.data && (
        <>
          <div className="flex flex-wrap gap-2">
            {variabelen.map((v) => (
              <Input
                key={v}
                aria-label={v}
                value={waarden[v] ?? ""}
                placeholder={v}
                onChange={(e) => setWaarden((w) => ({ ...w, [v]: e.target.value }))}
                className="h-8 min-w-[9rem] flex-1 text-[12.5px]"
              />
            ))}
          </div>
          <p className="whitespace-pre-wrap rounded-[10px] bg-muted/60 px-2.5 py-1.5">{tekst}</p>
          <Button
            size="sm"
            className="rounded-full"
            disabled={bezig || variabelen.some((v) => !(waarden[v] ?? "").trim())}
            onClick={() => void stuur()}
          >
            {bezig ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{" "}
            Versturen
          </Button>
        </>
      )}
    </div>
  );
}

/** Per klant: waarlangs aankondigingen gaan, en of WhatsApp mag. */
export function KlantKanaal({ klantId }: { klantId: string }) {
  const qc = useQueryClient();
  const magBewerken = useRecht("klanten_bewerken");
  // Een klant die zelf "stop" zei weer aanzetten: alleen de eigenaar.
  const isEigenaar = useAuth().employee?.rol === "eigenaar";
  const instelling = useQuery({
    queryKey: ["klant-whatsapp", klantId],
    queryFn: () => fetchKlantWhatsApp(klantId),
  });
  const [bezig, setBezig] = useState(false);
  const k = instelling.data;
  if (!k) return null;

  async function zet(patch: Partial<KlantWhatsApp>, gelukt: string) {
    setBezig(true);
    try {
      await zetKlantWhatsApp(klantId, patch);
      void qc.invalidateQueries({ queryKey: ["klant-whatsapp", klantId] });
      void qc.invalidateQueries({ queryKey: ["wa-toestemming"] });
      toast.success(gelukt);
    } catch (err) {
      melding(err);
    } finally {
      setBezig(false);
    }
  }

  const datum = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("nl-NL", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";
  const uit = !magBewerken || bezig;

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-surface px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`kanaal-${klantId}`} className="font-medium">
          Aankondigingen via
        </label>
        <select
          id={`kanaal-${klantId}`}
          value={k.kanaal_voorkeur}
          disabled={uit}
          onChange={(e) =>
            void zet(
              { kanaal_voorkeur: e.target.value as KlantWhatsApp["kanaal_voorkeur"] },
              "Voorkeur opgeslagen.",
            )
          }
          className="h-8 rounded-[10px] border border-input bg-background px-2"
        >
          <option value="mail">mail</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="beide">mail en WhatsApp</option>
        </select>
      </div>

      {k.wa_afgemeld_op ? (
        <p className="flex flex-wrap items-center gap-2 rounded-[10px] bg-tint-amber px-2.5 py-1.5 text-tint-amber-ink">
          <span className="flex-1">Wil sinds {datum(k.wa_afgemeld_op)} geen WhatsApp meer.</span>
          {isEigenaar && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-[12px]"
              disabled={uit}
              onClick={() => void zet({ wa_afgemeld_op: null }, "WhatsApp staat weer aan.")}
            >
              <Undo2 className="size-3.5" /> Weer aanzetten
            </Button>
          )}
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={!!k.wa_toestemming_op}
              disabled={uit}
              onChange={(e) =>
                void zet(
                  e.target.checked
                    ? {
                        wa_toestemming_op: new Date().toISOString(),
                        wa_toestemming_bron: "mondeling",
                      }
                    : { wa_toestemming_op: null, wa_toestemming_bron: "", wa_marketing_op: null },
                  e.target.checked ? "Toestemming vastgelegd." : "Toestemming weggehaald.",
                )
              }
            />
            <span>
              Aankondigingen via WhatsApp mogen
              {k.wa_toestemming_op && (
                <span className="text-muted-foreground">
                  {" "}
                  · sinds {datum(k.wa_toestemming_op)}
                  {k.wa_toestemming_bron ? ` (${k.wa_toestemming_bron})` : ""}
                </span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={!!k.wa_marketing_op}
              disabled={uit || !k.wa_toestemming_op}
              onChange={(e) =>
                void zet(
                  { wa_marketing_op: e.target.checked ? new Date().toISOString() : null },
                  e.target.checked
                    ? "Toestemming voor nieuws en acties vastgelegd."
                    : "Weggehaald.",
                )
              }
            />
            <span>Ook nieuws en acties via WhatsApp (alleen als de klant daar zelf ja op zei)</span>
          </label>
        </>
      )}
    </div>
  );
}
