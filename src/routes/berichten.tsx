/**
 * Berichten: alles wat je met één klant uitwisselde, op één plek.
 *
 * Bovenaan de klant (adres, naam, hoe hij te bereiken is). Daaronder mail,
 * WhatsApp en klachten door elkaar op volgorde van tijd — als chat, of als
 * lijst zoals een zoekopdracht in je mailapp. Onderin antwoord je meteen,
 * per mail of per WhatsApp.
 *
 * Dit vervangt op de telefoon het tabblad "Berichten" in het dossier: een
 * popup is daar te klein om een gesprek in te lezen.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle as AlertTriangle,
  IconChevronDown as ChevronDown,
  IconList as List,
  IconLoader2 as Loader2,
  IconMail as Mail,
  IconBrandWhatsapp as WhatsApp,
  IconMessages as MessagesSquare,
  IconPaperclip as Paperclip,
  IconCornerUpLeft as Reply,
  IconSend as Send,
  IconUser as UserRound,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MailOpstellen, type Opzet } from "@/components/mail/MailOpstellen";
import { MailHtml, antwoordOpzet } from "@/components/mail/Postvak";
import { Bubbel } from "@/components/whatsapp/Chat";
import { SjabloonBericht } from "@/components/whatsapp/Sjablonen";
import { useIsMobile } from "@/hooks/use-mobile";
import { requireSession, useRequireAuth } from "@/lib/auth";
import { fetchBericht, fetchDossierMails, lijstDatum, type DossierMail } from "@/lib/berichten";
import { fetchKlachtenVanKlant, type Klacht } from "@/lib/klachten";
import { fetchCustomers, fetchKlanten, fetchStreets, formatNumber } from "@/lib/klanten";
import { fetchMailbox } from "@/lib/mailbox";
import { zetGelezen } from "@/lib/mailacties";
import { useRecht } from "@/lib/rechten";
import {
  fetchGesprekken,
  fetchKlantNummers,
  fetchWaBerichten,
  markeerGesprekGelezen,
  toonNummer,
  vensterOpen,
  VensterDichtFout,
  verstuurWhatsApp,
  type WaBericht,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

interface BerichtenSearch {
  klant?: string;
  /** Alleen mail of alleen WhatsApp, zoals je in de gesprekkenlijst koos. */
  filter?: "mail" | "whatsapp";
}

export const Route = createFileRoute("/berichten")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): BerichtenSearch => ({
    ...(typeof search["klant"] === "string" && search["klant"] ? { klant: search["klant"] } : {}),
    ...(search["filter"] === "mail" || search["filter"] === "whatsapp"
      ? { filter: search["filter"] }
      : {}),
  }),
  head: () => ({
    meta: [{ title: "Berichten — Wooshy" }],
  }),
  component: Berichten,
});

type Item =
  | { soort: "mail"; id: string; op: string; mail: DossierMail }
  | { soort: "whatsapp"; id: string; op: string; wa: WaBericht }
  | { soort: "klacht"; id: string; op: string; klacht: Klacht };

type Filter = "alles" | "mail" | "whatsapp";
type Kanaal = "mail" | "whatsapp";

/** "31612345678" uit een 06-nummer van de klant, of "" als het er geen is. */
function waNummer(telefoon: string | undefined): string {
  const d = String(telefoon ?? "")
    .replace(/\D/g, "")
    .replace(/^0031/, "0")
    .replace(/^31(?=6\d{8}$)/, "0");
  return /^06\d{8}$/.test(d) ? `31${d.slice(1)}` : "";
}

function dagKop(iso: string): string {
  const d = new Date(iso);
  const nu = new Date();
  const gisteren = new Date(nu);
  gisteren.setDate(nu.getDate() - 1);
  if (d.toDateString() === nu.toDateString()) return "Vandaag";
  if (d.toDateString() === gisteren.toDateString()) return "Gisteren";
  return d.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() === nu.getFullYear() ? {} : { year: "numeric" }),
  });
}

function Berichten() {
  useRequireAuth();
  const { klant: klantId, filter: beginFilter } = Route.useSearch();
  const mobiel = useIsMobile();
  const qc = useQueryClient();

  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });
  const klant = klanten.data?.find((k) => k.id === klantId) ?? null;

  const adres = useMemo(() => {
    const c = (customers.data ?? []).find((x) => x.klant_id === klantId);
    if (!c) return "";
    const s = (streets.data ?? []).find((x) => x.id === c.street_id);
    return `${s?.volledige_naam.trim() || s?.name || ""} ${formatNumber(c)}`.trim();
  }, [customers.data, streets.data, klantId]);

  const mails = useQuery({
    queryKey: ["dossier-mail", klantId],
    queryFn: () => fetchDossierMails(klantId!),
    enabled: !!klantId,
  });
  const klachten = useQuery({
    queryKey: ["klachten", klantId],
    queryFn: () => fetchKlachtenVanKlant(klantId!),
    enabled: !!klantId,
  });
  const nummers = useQuery({
    queryKey: ["dossier-whatsapp", klantId],
    queryFn: () => fetchKlantNummers(klantId!),
    enabled: !!klantId,
  });
  // Het nummer waarmee de klant appte; anders zijn 06-nummer, voor een eerste bericht.
  const telefoon =
    nummers.data?.[0] ?? (waNummer(klant?.telefoon) || waNummer(klant?.telefoon2) || "");
  // Alle nummers waarmee de klant appte: wie twee telefoons heeft, wil ook
  // de appjes van zijn andere nummer terugzien. Dezelfde sleutel als de chat,
  // dus die delen hun cache. Het eerste nummer is waar je naar antwoordt.
  const alleNummers = nummers.data?.length ? nummers.data : telefoon ? [telefoon] : [];
  const waPerNummer = useQueries({
    queries: alleNummers.map((n) => ({
      queryKey: ["wa-berichten", n],
      queryFn: () => fetchWaBerichten(n),
      refetchInterval: 15_000,
    })),
  });
  const waAntwoordnummer = waPerNummer[0]?.data ?? [];

  // Wat je hier leest is gelezen: anders blijft de klant in de gesprekkenlijst
  // "ongelezen" staan. Alleen voor nummers met iets ongelezens, en één keer.
  const waGesprekken = useQuery({ queryKey: ["wa-gesprekken"], queryFn: fetchGesprekken });
  const alGelezen = useRef(new Set<string>());
  useEffect(() => {
    for (const g of waGesprekken.data ?? []) {
      if (g.ongelezen === 0 || !alleNummers.includes(g.wa_telefoon)) continue;
      if (alGelezen.current.has(g.wa_telefoon)) continue;
      alGelezen.current.add(g.wa_telefoon);
      void markeerGesprekGelezen(g.wa_telefoon)
        .then(() => qc.invalidateQueries({ queryKey: ["wa-gesprekken"] }))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waGesprekken.data, alleNummers.join(",")]);
  const waAlles = waPerNummer.flatMap((q) => q.data ?? []);
  const waVersie = waPerNummer.map((q) => q.dataUpdatedAt).join(",");

  const [weergave, setWeergave] = useState<"chat" | "lijst">("chat");
  const [filter, setFilter] = useState<Filter>(beginFilter ?? "alles");
  const [openMail, setOpenMail] = useState<string | null>(null);
  // Of de knopjes in de tegel iets kunnen doen: dezelfde voorwaarden als de
  // antwoordbalk onderin.
  const magVersturen = useRecht("mail_versturen");
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const mailKan =
    magVersturen &&
    mailbox.data?.status === "actief" &&
    !!(klant?.email.trim() || klant?.email2.trim());
  const waKan = magVersturen && !!telefoon;
  /** Mail of WhatsApp in de balk onderin; null zolang je zelf niets koos. */
  const [gekozenKanaal, setKanaal] = useState<Kanaal | null>(null);
  /** Eén opstelscherm voor de hele pagina, niet één per mail. */
  const [opzet, setOpzet] = useState<Opzet | null>(null);

  const items = useMemo(() => {
    const lijst: Item[] = [
      ...(mails.data ?? []).map((m) => ({
        soort: "mail" as const,
        id: `m:${m.id}`,
        op: m.ontvangen_op,
        mail: m,
      })),
      // Alleen de berichten die bij deze klant horen: op een gedeeld nummer
      // (een stel) kan ook de ander appen, en dat hoort in zijn eigen dossier.
      ...waAlles
        .filter((w) => !w.klant_id || w.klant_id === klantId)
        .map((w) => ({ soort: "whatsapp" as const, id: `w:${w.id}`, op: w.ontvangen_op, wa: w })),
      ...(klachten.data ?? []).map((k) => ({
        soort: "klacht" as const,
        id: `k:${k.id}`,
        op: k.ontvangen_op,
        klacht: k,
      })),
    ];
    return lijst
      .filter((i) => filter === "alles" || i.soort === filter)
      .sort((a, b) => a.op.localeCompare(b.op));
    // waAlles is elke render een nieuwe lijst; het moment waarop elk nummer
    // opnieuw binnenkwam zegt of er iets veranderde (ook een leesvinkje).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mails.data, waVersie, klachten.data, filter, klantId]);

  const laden = mails.isLoading || nummers.isLoading || klachten.isLoading;
  // De klant zelf staat in de klantentabel; wie alleen mail mag lezen kan die
  // niet openen, en zou dan een lege pagina krijgen.
  const magKlantZien = useRecht("klanten_bekijken", "klanten_bewerken", "planning");

  // In de chat begin je onderaan, bij het nieuwste bericht. Komt er daarna
  // iets binnen, dan schuiven we alleen mee als je al onderaan stond: anders
  // spring je weg uit een oud bericht dat je aan het lezen bent.
  const bijOnderkant = useRef(true);
  useEffect(() => {
    const kijk = () => {
      const el = document.documentElement;
      bijOnderkant.current = window.innerHeight + window.scrollY >= el.scrollHeight - 160;
    };
    window.addEventListener("scroll", kijk, { passive: true });
    return () => window.removeEventListener("scroll", kijk);
  }, []);
  const naarOnder = () =>
    requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
  useEffect(() => {
    if (weergave === "chat" && !laden) naarOnder();
  }, [weergave, laden]);
  useEffect(() => {
    if (weergave === "chat" && !laden && bijOnderkant.current) naarOnder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function naarBericht(id: string) {
    setWeergave("chat");
    if (id.startsWith("m:")) setOpenMail(id.slice(2));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center" }), 50);
  }

  const antwoordBalk = klant && (
    <AntwoordBalk
      klantId={klant.id}
      klantNaam={klant.naam}
      email={klant.email.trim() || klant.email2.trim()}
      telefoon={telefoon}
      waBerichten={waAntwoordnummer}
      gekozenKanaal={gekozenKanaal}
      onKanaal={setKanaal}
      // De lijst staat nieuwste eerst: de eerste inkomende is de laatste mail van de klant.
      laatsteMailIn={(mails.data ?? []).find((m) => m.richting === "in") ?? null}
      onVerstuurd={() => {
        void qc.invalidateQueries({ queryKey: ["wa-berichten", telefoon] });
        void qc.invalidateQueries({ queryKey: ["dossier-whatsapp", klant.id] });
        void qc.invalidateQueries({ queryKey: ["wa-gesprekken"] });
      }}
    />
  );

  return (
    <AppLayout
      titel="Berichten"
      kruimel="Klanten / Berichten"
      onderbalk={mobiel ? antwoordBalk : undefined}
    >
      {!magKlantZien ? (
        <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold">Geen toegang tot klanten</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Je rol geeft geen toegang tot klantgegevens. Lees de mail in het postvak.
          </p>
          <Button className="mt-4 rounded-full" asChild>
            <Link to="/mailing">Naar het postvak</Link>
          </Button>
        </div>
      ) : !klantId || (klanten.isSuccess && !klant) ? (
        <div className="mx-auto mt-10 max-w-md rounded-[18px] border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="font-display text-lg font-semibold">Geen klant gekozen</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open de berichten van een klant vanuit de klantenlijst.
          </p>
          <Button className="mt-4 rounded-full" asChild>
            <Link to="/klanten">Naar de klanten</Link>
          </Button>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-3">
          {/* De klant, zoals in ontwerp B: de tegel met knopjes om meteen
              te schrijven, en losse chips om te filteren. */}
          <div className="rounded-[18px] bg-tint-blauw px-4 py-3 text-tint-blauw-ink">
            <p className="font-display text-[19px] font-semibold leading-tight">
              {adres || klant?.naam || "…"}
            </p>
            <p className="mt-0.5 truncate text-[13px] opacity-80">
              {[adres ? klant?.naam : "", klant?.email || klant?.email2]
                .filter(Boolean)
                .join(" · ") || "Nog geen contactgegevens"}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {mailKan && (
                <TegelKnop onClick={() => setKanaal("mail")} actief={gekozenKanaal === "mail"}>
                  <Mail className="size-4 text-tint-blauw-mid" /> Mail
                </TegelKnop>
              )}
              {waKan && (
                <TegelKnop
                  onClick={() => setKanaal("whatsapp")}
                  actief={gekozenKanaal === "whatsapp"}
                >
                  <WhatsApp className="size-4 text-tint-groen-mid" /> App
                </TegelKnop>
              )}
              <Link
                to="/klanten"
                search={{ klant: klantId }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium text-tint-blauw-ink"
              >
                <UserRound className="size-4" /> Dossier
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {(["alles", "mail", "whatsapp"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px]",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground",
                )}
              >
                {f === "alles" ? "Alles" : f === "mail" ? "Mail" : "WhatsApp"}
              </button>
            ))}
            <div className="ml-auto flex gap-1">
              {(
                [
                  ["chat", MessagesSquare, "Als chat"],
                  ["lijst", List, "Als lijst"],
                ] as const
              ).map(([w, Icoon, label]) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeergave(w)}
                  aria-pressed={weergave === w}
                  aria-label={label}
                  title={label}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full",
                    weergave === w
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  <Icoon className="size-[18px]" />
                </button>
              ))}
            </div>
          </div>

          {laden ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Even ophalen…</p>
          ) : items.length === 0 ? (
            <p className="rounded-[18px] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {filter === "alles"
                ? "Nog geen berichten met deze klant."
                : `Nog geen ${filter === "mail" ? "mail" : "WhatsApp"} met deze klant.`}
            </p>
          ) : weergave === "chat" ? (
            <ChatTijdlijn
              items={items}
              openMail={openMail}
              onOpenMail={setOpenMail}
              onBeantwoord={setOpzet}
            />
          ) : (
            <LijstTijdlijn items={items} onKies={naarBericht} />
          )}

          <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
          {!mobiel && antwoordBalk && (
            <div className="sticky bottom-0 bg-background/90 pb-4 pt-2 backdrop-blur">
              {antwoordBalk}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}

/** Alles als chat: wat de klant stuurde links, wat jij stuurde rechts. */
function ChatTijdlijn({
  items,
  openMail,
  onOpenMail,
  onBeantwoord,
}: {
  items: Item[];
  openMail: string | null;
  onOpenMail: (id: string | null) => void;
  onBeantwoord: (opzet: Opzet) => void;
}) {
  let vorigeDag = "";
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const dag = new Date(i.op).toDateString();
        const kop = dag !== vorigeDag ? dagKop(i.op) : null;
        vorigeDag = dag;
        return (
          <div key={i.id} id={i.id} className="scroll-mt-24">
            {kop && (
              <p className="py-2 text-center text-[11.5px] font-medium capitalize text-muted-foreground">
                {kop}
              </p>
            )}
            {i.soort === "whatsapp" ? (
              <Bubbel bericht={i.wa} />
            ) : i.soort === "klacht" ? (
              <div className="flex justify-center">
                <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-full bg-tint-rood px-3 py-1 text-[12px] text-tint-rood-ink">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span className="truncate">
                    Klacht: {i.klacht.omschrijving}
                    {i.klacht.status === "afgehandeld" ? " · opgelost" : ""}
                  </span>
                </span>
              </div>
            ) : (
              <MailBubbel
                mail={i.mail}
                open={openMail === i.mail.id}
                onOpen={() => onOpenMail(openMail === i.mail.id ? null : i.mail.id)}
                onBeantwoord={onBeantwoord}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Een mail als ballon; tik hem open voor de hele mail. */
function MailBubbel({
  mail: m,
  open,
  onOpen,
  onBeantwoord,
}: {
  mail: DossierMail;
  open: boolean;
  onOpen: () => void;
  onBeantwoord: (opzet: Opzet) => void;
}) {
  const uit = m.richting === "uit";
  const bericht = useQuery({
    queryKey: ["bericht", m.id, "dossier"],
    queryFn: () => fetchBericht(m.id, true),
    enabled: open,
  });
  const magVersturen = useRecht("mail_versturen");
  const qc = useQueryClient();
  // Openklappen is lezen, net als in het postvak.
  useEffect(() => {
    if (!open || m.richting !== "in" || m.gelezen) return;
    void zetGelezen(m.id, true)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["dossier-mail"] });
        void qc.invalidateQueries({ queryKey: ["mail-gesprekken"] });
      })
      .catch(() => undefined);
  }, [open, m.id, m.richting, m.gelezen, qc]);

  return (
    <div className={cn("flex", uit ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[14px] text-[13.5px] shadow-sm",
          open && "w-full max-w-full",
          uit
            ? "bg-accent text-accent-foreground"
            : "bg-card text-card-foreground ring-1 ring-inset ring-border",
        )}
      >
        <button type="button" onClick={onOpen} className="block w-full px-3 py-2 text-left">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Mail className="size-3.5 shrink-0" />
            <span className="truncate">{m.onderwerp || "(geen onderwerp)"}</span>
            {m.heeft_bijlagen && <Paperclip className="size-3 shrink-0" />}
            <ChevronDown
              className={cn(
                "ml-auto size-3.5 shrink-0 opacity-60 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
          {!open && (
            <span className="mt-0.5 line-clamp-2 break-words opacity-80">{m.fragment}</span>
          )}
          <span className="mt-0.5 block text-right text-[10.5px] opacity-70">
            {new Date(m.ontvangen_op).toLocaleString("nl-NL", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </button>
        {open && (
          <div className="border-t border-border/60 px-3 py-2">
            {bericht.isLoading ? (
              <p className="text-[13px] opacity-70">Even ophalen…</p>
            ) : !bericht.data ? (
              <p className="text-[13px] opacity-70">Deze mail is niet meer te openen.</p>
            ) : (
              <>
                {bericht.data.afgekapt && (
                  <p className="mb-2 rounded-[10px] bg-tint-geel px-3 py-1.5 text-[12px] text-tint-geel-ink">
                    Deze mail is groot; Wooshy toont alleen het begin.
                  </p>
                )}
                {bericht.data.html ? (
                  // Een vaste hoogte: de mail staat in een eigen venstertje, en
                  // dat is zonder hoogte maar een paar regels hoog.
                  <div className="flex h-[420px] overflow-hidden rounded-lg border border-border/60 bg-white">
                    <MailHtml html={bericht.data.html} />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words">
                    {bericht.data.tekst || <span className="opacity-70">(lege mail)</span>}
                  </p>
                )}
                {!uit && magVersturen && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 rounded-full"
                    onClick={() =>
                      onBeantwoord({
                        ...antwoordOpzet(bericht.data!),
                        ...(bericht.data!.klant_id ? { klantId: bericht.data!.klant_id } : {}),
                      })
                    }
                  >
                    <Reply className="size-4" /> Beantwoorden
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Alles als lijst, nieuwste bovenaan, zoals zoekresultaten in je mailapp. */
function LijstTijdlijn({ items, onKies }: { items: Item[]; onKies: (id: string) => void }) {
  const nieuwsteEerst = [...items].reverse();
  const weekGeleden = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let vorigeGroep = "";
  return (
    <div>
      {nieuwsteEerst.map((i) => {
        const groep = new Date(i.op).getTime() >= weekGeleden ? "Deze week" : "Eerder";
        const kop = groep !== vorigeGroep ? groep : null;
        vorigeGroep = groep;
        const { Icoon, kleur, titel, tekst, vet } =
          i.soort === "mail"
            ? {
                Icoon: i.mail.richting === "uit" ? Send : Mail,
                kleur: i.mail.richting === "uit" ? "text-muted-foreground" : "text-tint-blauw-mid",
                titel: i.mail.onderwerp || "(geen onderwerp)",
                tekst: i.mail.richting === "uit" ? `Jij: ${i.mail.fragment}` : i.mail.fragment,
                vet: i.mail.richting === "in" && !i.mail.gelezen,
              }
            : i.soort === "whatsapp"
              ? {
                  Icoon: WhatsApp,
                  kleur: "text-tint-groen-mid",
                  titel: i.wa.richting === "uit" ? "WhatsApp van jou" : "WhatsApp",
                  tekst: i.wa.tekst,
                  vet: false,
                }
              : {
                  Icoon: AlertTriangle,
                  kleur: "text-tint-rood-mid",
                  titel: `Klacht: ${i.klacht.omschrijving}`,
                  tekst: i.klacht.status === "afgehandeld" ? "Opgelost" : "Staat nog open",
                  vet: i.klacht.status === "open",
                };
        return (
          <div key={i.id}>
            {kop && (
              <p
                className={cn(
                  "px-1 pb-1 text-[12px] text-muted-foreground",
                  i !== nieuwsteEerst[0] && "pt-3",
                )}
              >
                {kop}
              </p>
            )}
            <button
              type="button"
              onClick={() => onKies(i.id)}
              className="flex w-full items-start gap-2.5 rounded-[12px] px-1 py-2 text-left hover:bg-card"
            >
              <Icoon className={cn("mt-0.5 size-[18px] shrink-0", kleur)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn("flex-1 truncate text-[14px]", vet && "font-semibold")}>
                    {titel}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {lijstDatum(i.op)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {tekst}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Een wit knopje in de klanttegel. */
function TegelKnop({
  actief,
  onClick,
  children,
}: {
  actief: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actief}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium",
        actief && "ring-2 ring-tint-blauw-ink/40",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Onderin: meteen antwoorden. Kies mail of WhatsApp; wat je typt gaat als
 * WhatsApp meteen weg, en als mail opent het in het opstelscherm, zodat je
 * onderwerp en aanhef nog ziet voor het vertrekt.
 */
function AntwoordBalk({
  klantId,
  klantNaam,
  email,
  telefoon,
  waBerichten,
  laatsteMailIn,
  gekozenKanaal,
  onKanaal: setKanaal,
  onVerstuurd,
}: {
  klantId: string;
  klantNaam: string;
  email: string;
  telefoon: string;
  waBerichten: WaBericht[];
  laatsteMailIn: DossierMail | null;
  gekozenKanaal: Kanaal | null;
  onKanaal: (k: Kanaal) => void;
  onVerstuurd: () => void;
}) {
  const magVersturen = useRecht("mail_versturen");
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const mailKan = magVersturen && mailbox.data?.status === "actief" && !!email;
  const waKan = magVersturen && !!telefoon;
  // Zolang je zelf niets kiest: WhatsApp als jullie al appten, anders mail.
  // Niet vastzetten bij het eerste tekenen, want dan zijn de appjes nog niet binnen.
  const kanaal: Kanaal =
    gekozenKanaal ?? (waBerichten.length > 0 && telefoon ? "whatsapp" : "mail");
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  const [opzet, setOpzet] = useState<Opzet | null>(null);
  const [sjabloonOpen, setSjabloonOpen] = useState(false);
  const venster = vensterOpen(waBerichten);

  if (!magVersturen) {
    return (
      <p className="rounded-full bg-card px-4 py-2.5 text-center text-[12.5px] text-muted-foreground shadow-card">
        Je mag geen berichten versturen.
      </p>
    );
  }

  async function stuur() {
    const inhoud = tekst.trim();
    if (bezig) return;
    if (kanaal === "mail") {
      if (!mailKan) {
        toast(email ? "De mailbox is niet gekoppeld." : "Geen e-mailadres bekend bij deze klant.");
        return;
      }
      setBezig(true);
      try {
        const vorige = laatsteMailIn ? await fetchBericht(laatsteMailIn.id, true) : null;
        setOpzet(
          vorige
            ? { ...antwoordOpzet(vorige, inhoud), klantId }
            : {
                aan: klantNaam ? `"${klantNaam.replace(/"/g, "")}" <${email}>` : email,
                onderwerp: "",
                tekst: inhoud,
                klantId,
              },
        );
        setTekst("");
      } catch (e) {
        toast.error(
          "De mail kon niet klaargezet worden: " + (e instanceof Error ? e.message : String(e)),
        );
      } finally {
        setBezig(false);
      }
      return;
    }
    if (!waKan) {
      toast("Geen 06-nummer bekend bij deze klant.");
      return;
    }
    // Buiten 24 uur na het laatste appje van de klant mag alleen een sjabloon.
    if (!venster) {
      setSjabloonOpen(true);
      return;
    }
    if (!inhoud) return;
    setBezig(true);
    try {
      const uit = await verstuurWhatsApp(telefoon, inhoud);
      setTekst("");
      if (!uit.bewaard) {
        toast.warning(
          "Verstuurd, maar Wooshy kon het niet bewaren. Het staat wel op de telefoon van de klant.",
        );
      }
      onVerstuurd();
    } catch (e) {
      if (e instanceof VensterDichtFout) onVerstuurd();
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  const sjabloonNodig = kanaal === "whatsapp" && waKan && !venster;

  return (
    <>
      <form
        className="flex items-end gap-1.5 rounded-[24px] border border-border bg-card p-1.5 shadow-[0_4px_20px_oklch(0.3_0.02_70/18%)]"
        onSubmit={(e) => {
          e.preventDefault();
          void stuur();
        }}
      >
        <button
          type="button"
          onClick={() => setKanaal(kanaal === "mail" ? "whatsapp" : "mail")}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium",
            kanaal === "mail"
              ? "bg-tint-blauw text-tint-blauw-ink"
              : "bg-tint-groen text-tint-groen-ink",
          )}
          aria-label={`Versturen via ${kanaal === "mail" ? "mail" : "WhatsApp"}, tik om te wisselen`}
        >
          {kanaal === "mail" ? <Mail className="size-4" /> : <WhatsApp className="size-4" />}
          <ChevronDown className="size-3 opacity-70" />
        </button>
        {sjabloonNodig ? (
          <button
            type="submit"
            className="h-9 flex-1 truncate rounded-full px-2 text-left text-[13px] text-muted-foreground"
          >
            Langer dan 24 uur stil: stuur een sjabloon
          </button>
        ) : (
          <textarea
            rows={1}
            value={tekst}
            maxLength={4096}
            placeholder={
              kanaal === "mail"
                ? `Mail aan ${klantNaam || "de klant"}…`
                : `WhatsApp aan ${klantNaam || "de klant"}…`
            }
            onChange={(e) => setTekst(e.target.value)}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] outline-none"
          />
        )}
        <Button
          type="submit"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={bezig || (!sjabloonNodig && kanaal === "whatsapp" && !tekst.trim())}
          aria-label={kanaal === "mail" ? "Mail opstellen" : "Versturen"}
        >
          {bezig ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>

      <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
      <Sheet open={sjabloonOpen} onOpenChange={setSjabloonOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[22px] p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetTitle className="px-4 pt-4 font-display text-lg">WhatsApp-sjabloon</SheetTitle>
          <SjabloonBericht
            telefoon={telefoon}
            onVerstuurd={() => {
              setSjabloonOpen(false);
              onVerstuurd();
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
