/**
 * Eén WhatsApp-gesprek: de berichten als bubbels, foto's en spraakberichten
 * erin, en onderaan een veld om te antwoorden. Gebruikt in de WhatsApp-tab
 * en in het klantdossier.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  FileText,
  Loader2,
  Send,
  Smartphone,
  Sparkles,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRecht } from "@/lib/rechten";
import { useAuth } from "@/lib/auth";
import { SjabloonBericht } from "@/components/whatsapp/Sjablonen";
import { draaiWijzigingTerug } from "@/lib/mailing";
import { toonMaand } from "@/lib/klanten";
import {
  annuleerAntwoord,
  fetchWijzigingenVan,
  verstuurAntwoordNu,
  fetchWaBerichten,
  haalMediaAlsnogOp,
  mediaLink,
  vensterOpen,
  verstuurWhatsApp,
  VensterDichtFout,
  type WaBericht,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export function ChatVenster({ telefoon, className }: { telefoon: string; className?: string }) {
  const [tekst, setTekst] = useState("");
  const berichten = useQuery({
    queryKey: ["wa-berichten", telefoon],
    queryFn: () => fetchWaBerichten(telefoon),
    refetchInterval: 15_000,
  });
  const vak = useRef<HTMLDivElement>(null);
  const lijst = berichten.data ?? [];
  const laatste = lijst[lijst.length - 1]?.id;

  // Nieuw bericht of ander gesprek: alleen het chatvak naar beneden, niet de
  // pagina of het dossier eromheen.
  useEffect(() => {
    if (vak.current) vak.current.scrollTop = vak.current.scrollHeight;
  }, [telefoon, laatste]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={vak}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-background/60 px-3 py-3"
      >
        {berichten.isLoading && <p className="text-[13px] text-muted-foreground">Even kijken…</p>}
        {berichten.isError && (
          <p className="text-[13px] text-tint-rood-ink">De berichten konden niet geladen worden.</p>
        )}
        {(berichten.data ?? []).map((b) => (
          <Bubbel key={b.id} bericht={b} />
        ))}
      </div>
      <PaaltjeStrook berichten={lijst} telefoon={telefoon} onGebruik={setTekst} />
      <Antwoordveld telefoon={telefoon} berichten={lijst} tekst={tekst} setTekst={setTekst} />
    </div>
  );
}

function Antwoordveld({
  telefoon,
  berichten,
  tekst,
  setTekst,
}: {
  telefoon: string;
  berichten: WaBericht[];
  tekst: string;
  setTekst: (t: string) => void;
}) {
  const qc = useQueryClient();
  const magVersturen = useRecht("mail_versturen");
  const [bezig, setBezig] = useState(false);
  const open = vensterOpen(berichten);

  if (!magVersturen) {
    return (
      <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
        Je mag geen berichten versturen.
      </p>
    );
  }
  if (!open) {
    return (
      <SjabloonBericht
        telefoon={telefoon}
        onVerstuurd={() => {
          void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
          void qc.invalidateQueries({ queryKey: ["wa-gesprekken"] });
        }}
      />
    );
  }

  async function stuur() {
    const inhoud = tekst.trim();
    if (!inhoud || bezig) return;
    setBezig(true);
    try {
      const uit = await verstuurWhatsApp(telefoon, inhoud);
      setTekst("");
      if (!uit.bewaard) {
        toast.warning(
          "Verstuurd, maar Wooshy kon het niet bewaren. Het staat wel op de telefoon van de klant.",
        );
      }
      void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
      void qc.invalidateQueries({ queryKey: ["wa-gesprekken"] });
    } catch (e) {
      if (e instanceof VensterDichtFout)
        void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  return (
    <form
      className="flex items-end gap-2 border-t border-border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void stuur();
      }}
    >
      <label htmlFor={`wa-antwoord-${telefoon}`} className="sr-only">
        Bericht
      </label>
      <textarea
        id={`wa-antwoord-${telefoon}`}
        rows={1}
        value={tekst}
        maxLength={4096}
        placeholder="Typ een bericht"
        onChange={(e) => setTekst(e.target.value)}
        onKeyDown={(e) => {
          // Enter verstuurt, Shift+Enter is een nieuwe regel, zoals in WhatsApp Web.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void stuur();
          }
        }}
        className="max-h-32 min-h-9 flex-1 resize-none rounded-[12px] border border-input bg-background px-3 py-2 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button
        type="submit"
        size="icon"
        className="size-9 shrink-0 rounded-full"
        disabled={bezig || !tekst.trim()}
        aria-label="Versturen"
      >
        {bezig ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      </Button>
    </form>
  );
}

export function Bubbel({ bericht: b }: { bericht: WaBericht }) {
  const uit = b.richting === "uit";
  const media = b.media ?? [];
  // Zonder onderschrift is de tekst alleen "[foto]": die laten we weg als de foto er staat.
  const alleenOmschrijving = media.length > 0 && /^\[[^\]]+\]$/.test(b.tekst.trim());
  return (
    <div className={cn("flex", uit ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-[14px] px-3 py-1.5 text-[13.5px] shadow-sm",
          uit
            ? "bg-tint-groen text-tint-groen-ink"
            : "bg-card text-card-foreground ring-1 ring-inset ring-border",
        )}
      >
        {media.map((m) => (
          <Media key={m.media_id} berichtId={b.id} media={m} type={b.wa_type} />
        ))}
        {!(alleenOmschrijving && media.some((m) => m.pad)) && (
          <p className="whitespace-pre-wrap break-words">
            {b.tekst.replace(/^\[(foto|video|document|sticker)\] /, "")}
          </p>
        )}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] opacity-70">
          {b.bron === "paaltje" && (
            <span
              className="inline-flex items-center gap-0.5 font-medium"
              title="Verstuurd door Paaltje"
            >
              <Sparkles className="size-3" /> Paaltje
            </span>
          )}
          {b.bron === "app" && (
            <span className="inline-flex items-center gap-0.5" title="Verstuurd vanaf je telefoon">
              <Smartphone className="size-3" />
            </span>
          )}
          {new Date(b.ontvangen_op).toLocaleString("nl-NL", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {uit && b.wa_status === "gelezen" && (
            <CheckCheck className="size-3 text-tint-blauw-ink" />
          )}
          {uit && b.wa_status === "afgeleverd" && <CheckCheck className="size-3" />}
          {uit && b.wa_status === "verstuurd" && <Check className="size-3" />}
          {uit && b.wa_status === "mislukt" && (
            <span className="text-destructive">niet aangekomen</span>
          )}
        </p>
      </div>
    </div>
  );
}

function Media({
  berichtId,
  media: m,
  type,
}: {
  berichtId: string;
  media: WaBericht["media"][number];
  type: string;
}) {
  const qc = useQueryClient();
  const link = useQuery({
    queryKey: ["wa-media", m.pad],
    queryFn: () => mediaLink(m.pad),
    enabled: !!m.pad,
    staleTime: 50 * 60_000,
  });
  const [ophalen, setOphalen] = useState(false);

  if (!m.pad) {
    return (
      <p className="my-1 flex flex-wrap items-center gap-2 text-[12px] opacity-80">
        {type === "audio" ? "Spraakbericht" : "Bestand"} nog niet binnen.
        <button
          type="button"
          className="underline"
          disabled={ophalen}
          onClick={() => {
            setOphalen(true);
            void haalMediaAlsnogOp(berichtId)
              .then(() => qc.invalidateQueries({ queryKey: ["wa-berichten"] }))
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
              .finally(() => setOphalen(false));
          }}
        >
          {ophalen ? "Bezig…" : "Nu ophalen"}
        </button>
      </p>
    );
  }
  if (!link.data) return <p className="my-1 text-[12px] opacity-70">Laden…</p>;

  // Alleen types die de server als veilig bewaarde tonen we ingebed.
  const mime = m.mime.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    return (
      <a href={link.data} target="_blank" rel="noreferrer noopener" className="my-1 block">
        <img
          src={link.data}
          alt="Foto van de klant"
          className="max-h-72 rounded-[10px] object-contain"
        />
      </a>
    );
  }
  if (mime.startsWith("audio/")) {
    return <audio controls preload="none" src={link.data} className="my-1 w-64 max-w-full" />;
  }
  if (mime.startsWith("video/")) {
    return (
      <video controls preload="none" src={link.data} className="my-1 max-h-72 rounded-[10px]" />
    );
  }
  if (mime === "application/pdf") {
    return (
      <a
        href={link.data}
        target="_blank"
        rel="noreferrer noopener"
        className="my-1 inline-flex items-center gap-1.5 underline"
      >
        <FileText className="size-4" /> {m.naam || "PDF openen"}
      </a>
    );
  }
  // Onbekend type: alleen downloaden, nooit openen in de browser.
  return (
    <a
      href={`${link.data}&download=${encodeURIComponent(m.naam || "bestand")}`}
      rel="noreferrer noopener"
      className="my-1 inline-flex items-center gap-1.5 underline"
    >
      <FileText className="size-4" /> {m.naam || "Bestand downloaden"}
    </a>
  );
}

/**
 * Wat Paaltje met het laatste bericht van de klant deed of van plan is: een
 * ingepland antwoord (tegen te houden of meteen te versturen), een voorstel
 * om te gebruiken, of iets wat hij in Wooshy veranderde (geel, terug te
 * draaien).
 */
function PaaltjeStrook({
  berichten,
  telefoon,
  onGebruik,
}: {
  berichten: WaBericht[];
  telefoon: string;
  onGebruik: (tekst: string) => void;
}) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const isEigenaar = employee?.rol === "eigenaar";
  const magVersturen = useRecht("mail_versturen");
  const [bezig, setBezig] = useState(false);

  // Het laatste bericht van de klant waar Paaltje iets mee deed; de rest van
  // de beurt ("Samen gelezen…") hoort erbij.
  const laatsteIn = [...berichten]
    .reverse()
    .find(
      (b) =>
        b.richting === "in" &&
        b.bron !== "geschiedenis" &&
        b.samenvatting !== "Samen gelezen met het bericht erna.",
    );
  const wijzigingen = useQuery({
    queryKey: ["wa-wijzigingen", laatsteIn?.id],
    queryFn: () => fetchWijzigingenVan(laatsteIn!.id),
    enabled: isEigenaar && !!laatsteIn && laatsteIn.paaltje_status === "klaar",
  });

  if (!laatsteIn || !["wacht", "bezig", "klaar"].includes(laatsteIn.paaltje_status)) return null;
  const b = laatsteIn;
  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
    void qc.invalidateQueries({ queryKey: ["wa-wijzigingen", b.id] });
  };

  async function doe(actie: () => Promise<unknown>, gelukt: string) {
    setBezig(true);
    try {
      await actie();
      toast.success(gelukt);
      ververs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      ververs();
    } finally {
      setBezig(false);
    }
  }

  if (b.paaltje_status !== "klaar") {
    return (
      <p className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-[12px] text-muted-foreground">
        <Sparkles className="size-3.5" /> Paaltje leest mee…
      </p>
    );
  }

  const open = (wijzigingen.data ?? []).filter((w) => !w.teruggedraaid_op);
  const overslaan = open.find((w) => w.soort === "overslaan");
  const afgemeld = open.find((w) => w.soort === "whatsapp_afgemeld");
  const tijd = b.wa_antwoord_op
    ? new Date(b.wa_antwoord_op).toLocaleString("nl-NL", {
        weekday:
          new Date(b.wa_antwoord_op).toDateString() === new Date().toDateString()
            ? undefined
            : "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const concept = b.concept.trim();
  const onbeantwoord = !b.beantwoord_op;

  return (
    <div className="space-y-1.5 border-t border-border px-3 py-2 text-[12.5px]">
      {b.samenvatting && (
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          <span>{b.samenvatting}</span>
        </p>
      )}

      {overslaan && (
        <Geel>
          <span className="flex-1">
            Paaltje zette {overslaan.maanden.map(toonMaand).join(" en ")} op overslaan.
          </span>
          <KleineKnop
            disabled={bezig}
            onClick={() => void doe(() => draaiWijzigingTerug(overslaan.id), "Teruggedraaid.")}
          >
            <Undo2 className="size-3.5" /> Ongedaan maken
          </KleineKnop>
        </Geel>
      )}

      {afgemeld && (
        <Geel>
          <span className="flex-1">Deze klant wil geen WhatsApp meer; Paaltje zette het uit.</span>
          <KleineKnop
            disabled={bezig}
            onClick={() =>
              void doe(() => draaiWijzigingTerug(afgemeld.id), "WhatsApp staat weer aan.")
            }
          >
            <Undo2 className="size-3.5" /> Ongedaan maken
          </KleineKnop>
        </Geel>
      )}

      {b.wa_antwoord_status === "gepland" && concept && (
        <Geel>
          <span className="w-full">
            Paaltje antwoordt om {tijd}: <q className="italic">{concept}</q>
          </span>
          {magVersturen && (
            <>
              <KleineKnop
                disabled={bezig}
                onClick={() =>
                  void doe(
                    () => verstuurAntwoordNu(b.id),
                    "Wordt binnen een minuut verstuurd, ook buiten de antwoordtijden.",
                  )
                }
              >
                <Send className="size-3.5" /> Nu versturen
              </KleineKnop>
              <KleineKnop
                disabled={bezig}
                onClick={() =>
                  void doe(async () => {
                    await annuleerAntwoord(b.id);
                    onGebruik(concept);
                  }, "Het antwoord staat in het tekstvak.")
                }
              >
                Aanpassen
              </KleineKnop>
              <KleineKnop
                disabled={bezig}
                onClick={() => void doe(() => annuleerAntwoord(b.id), "Paaltje stuurt dit niet.")}
              >
                Niet versturen
              </KleineKnop>
            </>
          )}
        </Geel>
      )}

      {b.wa_antwoord_status !== "gepland" &&
        b.wa_antwoord_status !== "verstuurd" &&
        b.wa_antwoord_status !== "bezig" &&
        concept &&
        onbeantwoord &&
        magVersturen && (
          <p className="flex flex-wrap items-center gap-2 rounded-[10px] bg-muted/60 px-2.5 py-1.5">
            <span className="min-w-0 flex-1">
              {b.wa_antwoord_status === "mislukt" ? "Versturen mislukte" : "Paaltje stelt voor"}:{" "}
              <q className="italic">{concept}</q>
              {b.wa_antwoord_status && b.wa_antwoord_reden && (
                <span className="block text-[11.5px] text-muted-foreground">
                  {b.wa_antwoord_reden}
                </span>
              )}
            </span>
            <KleineKnop onClick={() => onGebruik(concept)}>Gebruiken</KleineKnop>
          </p>
        )}
    </div>
  );
}

function Geel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-tint-amber px-2.5 py-1.5 text-tint-amber-ink">
      {children}
    </div>
  );
}

function KleineKnop({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 rounded-full px-2.5 text-[12px]"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
