/**
 * Het paneel van Paaltje: het gesprek, en (met het recht) de tab "Te keuren".
 *
 * Op de telefoon vult het het hele scherm; op de laptop zweeft het rechtsonder
 * boven de knop, als een crème kaart met schaduw — zie `Popup.tsx` voor
 * dezelfde vormtaal.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconLoader2 as Loader2,
  IconMessageCircle as MessageCircle,
  IconDotsVertical as MoreVertical,
  IconX as X,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { PaaltjeLui } from "@/components/paaltje/PaaltjeLui";

import { useRecht } from "@/lib/rechten";
import {
  DaglimietFout,
  stuur,
  useGesprek,
  useTeKeuren,
  useVoorstellen,
  wisGesprek,
  type ChatBericht,
  type Voorstel,
} from "@/lib/paaltje-chat";
import { useBevestig } from "@/components/Bevestig";
import { PaaltjeInvoer } from "@/components/paaltje/PaaltjeInvoer";
import { VoorstelKaart } from "@/components/paaltje/VoorstelKaart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const VOORBEELDEN = [
  "Wat is de notitie van Westmade 47?",
  "Wie in de Westmade wordt oneven gewassen?",
  "Westmade 47 wil voortaan alleen de voorkant",
];

type Tab = "gesprek" | "te_keuren";

export function PaaltjePaneel({
  open,
  onClose,
  teKeurenAantal,
}: {
  open: boolean;
  onClose: () => void;
  teKeurenAantal: number;
}) {
  const magKeuren = useRecht("klanten_bewerken");
  const [tab, setTab] = useState<Tab>("gesprek");
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const invoerRef = useRef<HTMLTextAreaElement>(null);
  // `lijstRef` is het scrollende venster; `inhoudRef` de vaste wrapper erin
  // (blijft bestaan of je nu "Laden…", de lege staat of berichten toont), zodat
  // een ResizeObserver daarop altijd iets heeft om aan te hangen.
  const lijstRef = useRef<HTMLDivElement>(null);
  const inhoudRef = useRef<HTMLDivElement>(null);
  // Of je deze keer al eens (zonder animatie) helemaal onderaan gekomen bent
  // — de eerste sprong na openen is instant, elke volgende (soepel).
  const gesprongenRef = useRef(false);
  // Moet je automatisch mee blijven scrollen naar de onderkant? Zodra je zelf
  // omhoog scrolt (verder dan het drempeltje) staat dit uit, tot je zelf weer
  // onderaan komt of een nieuw bericht verstuurt.
  const gepindRef = useRef(true);

  // Pas lezen zodra het paneel echt open is — dicht hoeft er niets te lopen.
  const gesprek = useGesprek(open);
  const teKeuren = useTeKeuren(open);
  const berichten = gesprek.data ?? [];

  const [pendingTekst, setPendingTekst] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const voorstelIds = berichten.map((b) => b.voorstel_id).filter((id): id is string => !!id);
  const voorstellen = useVoorstellen(voorstelIds, open);
  const teKeurenLijst = teKeuren.data?.voorstellen ?? [];
  const teKeurenNamen = teKeuren.data?.namen ?? {};

  // Focus in het typvak zodra het paneel opengaat.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => invoerRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  /**
   * Naar de onderkant scrollen — maar alleen dít lijstje, nooit de pagina
   * erachter. Daarom `el.scrollTop` zetten en niet `scrollIntoView`: dat
   * laatste zoekt zelf een scrollbare voorouder en kan zomaar de hele pagina
   * meenemen.
   */
  function naarOnder(instant: boolean) {
    const el = lijstRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
    gesprongenRef.current = true;
  }

  /**
   * De berichten komen uit `useGesprek`, maar een voorstelkaart erbij komt uit
   * een tweede query (`useVoorstellen`) en groeit dus pas ná de eerste sprong
   * — en een kaart kan ook zelf nog van hoogte veranderen terwijl hij laadt.
   * Eén keer scrollen bij het openen is dan niet genoeg: een ResizeObserver op
   * de inhoud houdt je bij elke hoogteverandering aan de onderkant, zolang je
   * daar zelf niet bewust bent weggescrold (`gepindRef`).
   *
   * Bij het openen (of het wisselen naar dit tabblad) weer vastpinnen en
   * instant naar onder; alles daarna soepel. Bij sluiten of tabwissel ruimt
   * de observer zichzelf op.
   */
  useLayoutEffect(() => {
    if (!open || tab !== "gesprek") {
      gesprongenRef.current = false;
      gepindRef.current = true;
      return;
    }
    gepindRef.current = true;
    naarOnder(true);

    const inhoud = inhoudRef.current;
    if (!inhoud || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (gepindRef.current) naarOnder(!gesprongenRef.current);
    });
    observer.observe(inhoud);
    return () => observer.disconnect();
  }, [open, tab]);

  // Zelf omhoog scrollen zet het vastpinnen uit; onderaan komen (of zelf weer
  // naar beneden scrollen) zet het weer aan.
  useEffect(() => {
    if (!open || tab !== "gesprek") return;
    const el = lijstRef.current;
    if (!el) return;
    function opScroll() {
      const afstandTotOnder = el!.scrollHeight - (el!.scrollTop + el!.clientHeight);
      gepindRef.current = afstandTotOnder < 60;
    }
    el.addEventListener("scroll", opScroll, { passive: true });
    return () => el.removeEventListener("scroll", opScroll);
  }, [open, tab]);

  // Escape sluit het paneel.
  useEffect(() => {
    if (!open) return;
    function opToets(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", opToets);
    return () => window.removeEventListener("keydown", opToets);
  }, [open, onClose]);

  if (!open) return null;

  /** Geeft terug of het gelukt is, zodat het typvak alleen bij succes leegt. */
  async function verstuur(tekst: string): Promise<boolean> {
    const schoon = tekst.trim();
    if (!schoon || bezig) return false;
    // Ook al had je omhooggescrold om iets terug te lezen: een nieuw bericht
    // sturen betekent dat je weer mee wilt met het gesprek.
    gepindRef.current = true;
    setPendingTekst(schoon);
    setBezig(true);
    try {
      await stuur(schoon);
      await qc.invalidateQueries({ queryKey: ["paaltje-gesprek"] });
      await qc.invalidateQueries({ queryKey: ["paaltje-te-keuren"] });
      await qc.invalidateQueries({ queryKey: ["paaltje-te-keuren-aantal"] });
      return true;
    } catch (e) {
      toast.error(
        e instanceof DaglimietFout
          ? e.message ||
              "Paaltje heeft voor vandaag genoeg berichten beantwoord. Morgen weer verder."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      return false;
    } finally {
      setBezig(false);
      setPendingTekst(null);
    }
  }

  async function gesprekWissen() {
    const ja = await bevestig({
      titel: "Gesprek wissen?",
      tekst:
        "Je eigen berichten met Paaltje verdwijnen. Voorstellen en het logboek blijven gewoon staan.",
      bevestigLabel: "Wissen",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await wisGesprek();
      await qc.invalidateQueries({ queryKey: ["paaltje-gesprek"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Paaltje"
      className={cn(
        "fixed inset-0 z-40 flex flex-col overflow-hidden bg-card sm:inset-auto",
        "sm:bottom-[calc(5.75rem+env(safe-area-inset-bottom))] sm:right-[calc(1.25rem+env(safe-area-inset-right))]",
        "sm:h-[640px] sm:w-[420px] sm:rounded-[18px] sm:shadow-[0_2px_6px_oklch(0.4_0.02_70/6%),0_24px_60px_oklch(0.35_0.02_70/14%)]",
      )}
    >
      {/* Kop */}
      <div className="flex shrink-0 items-start gap-3 bg-accent px-4 pt-4 text-accent-foreground">
        <PaaltjeLui className="size-10 shrink-0 overflow-hidden rounded-[12px]" />
        <div className="min-w-0 flex-1 pb-3">
          <p className="font-display text-[17px] font-semibold leading-tight tracking-[-0.02em]">
            Paaltje
          </p>
          <p className="text-[12px] opacity-80">Vraag naar klanten, of geef een wijziging door.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Meer"
                className="flex size-8 items-center justify-center rounded-full hover:bg-accent-foreground/10"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void gesprekWissen()}>
                Gesprek wissen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label="Paaltje sluiten"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full hover:bg-accent-foreground/10"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {magKeuren && (
        <div className="flex shrink-0 gap-1 bg-accent px-4">
          <TabKnop
            actief={tab === "gesprek"}
            onClick={() => setTab("gesprek")}
            icoon={<MessageCircle className="size-3.5" />}
          >
            Gesprek
          </TabKnop>
          <TabKnop
            actief={tab === "te_keuren"}
            onClick={() => setTab("te_keuren")}
            telletje={teKeurenAantal}
          >
            Te keuren
          </TabKnop>
        </div>
      )}

      {/* Inhoud */}
      {tab === "gesprek" ? (
        <>
          <div ref={lijstRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {/* Vaste wrapper, ook tijdens "Laden…" of de lege staat: de
                ResizeObserver hierboven hangt hieraan en moet iets hebben
                om aan te blijven hangen zodra de berichten binnenkomen. */}
            <div ref={inhoudRef}>
              {gesprek.isLoading ? (
                <p className="text-[13px] text-muted-foreground">Laden…</p>
              ) : berichten.length === 0 && !pendingTekst ? (
                <LegeStaat onKies={(v) => void verstuur(v)} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {berichten.map((b) => (
                    <Bericht
                      key={b.id}
                      bericht={b}
                      voorstel={b.voorstel_id ? voorstellen.data?.bij[b.voorstel_id] : undefined}
                      namen={voorstellen.data?.namen}
                    />
                  ))}
                  {pendingTekst && <Bubbel rol="gebruiker">{pendingTekst}</Bubbel>}
                  {bezig && (
                    <div className="flex w-fit items-center gap-1.5 self-start rounded-[14px] bg-tint-paars/60 px-3 py-2 text-[12.5px] text-tint-paars-ink">
                      <Loader2 className="size-3.5 animate-spin" /> Paaltje denkt na…
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-border p-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:pb-2.5">
            <PaaltjeInvoer ref={invoerRef} onVerstuur={verstuur} bezig={bezig} />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {teKeuren.isLoading ? (
            <p className="text-[13px] text-muted-foreground">Laden…</p>
          ) : teKeurenLijst.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Niets om te keuren.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {teKeurenLijst.map((v) => (
                <VoorstelKaart key={v.id} voorstel={v} namen={teKeurenNamen} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabKnop({
  actief,
  onClick,
  icoon,
  telletje,
  children,
}: {
  actief: boolean;
  onClick: () => void;
  icoon?: ReactNode;
  telletje?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={actief}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-t-[10px] border border-b-0 border-transparent px-3 py-2 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40",
        actief
          ? "border-border/70 bg-card text-foreground"
          : "text-accent-foreground/70 hover:text-accent-foreground",
      )}
    >
      {icoon}
      {children}
      {telletje !== undefined && telletje > 0 && (
        <span className="rounded-full bg-tint-geel px-1.5 py-px text-[11px] font-semibold text-tint-geel-ink">
          {telletje}
        </span>
      )}
    </button>
  );
}

function Bericht({
  bericht,
  voorstel,
  namen,
}: {
  bericht: ChatBericht;
  voorstel?: Voorstel | undefined;
  namen?: Record<string, string> | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Bubbel rol={bericht.rol}>{bericht.tekst}</Bubbel>
      {voorstel && <VoorstelKaart voorstel={voorstel} namen={namen} />}
    </div>
  );
}

function Bubbel({ rol, children }: { rol: "gebruiker" | "paaltje"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] px-3 py-2 text-[13px] leading-relaxed",
        rol === "gebruiker"
          ? "self-end bg-primary text-primary-foreground"
          : "self-start bg-tint-paars/70 text-tint-paars-ink",
      )}
    >
      {children}
    </div>
  );
}

function LegeStaat({ onKies }: { onKies: (tekst: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
      <PaaltjeLui className="size-14 overflow-hidden rounded-full" />
      <div>
        <p className="text-[14px] font-medium">Vraag het Paaltje</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Hij zoekt klantgegevens op, of zet een wijziging voor je klaar.
        </p>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {VOORBEELDEN.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onKies(v)}
            className="rounded-[12px] border border-dashed border-border bg-card px-3 py-2 text-left text-[12.5px] text-muted-foreground hover:border-ring hover:text-foreground"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
