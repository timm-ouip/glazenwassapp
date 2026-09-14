/**
 * Het postvak: je mail zoals in een gewoon mailprogramma.
 *
 * Drie kolommen naast elkaar — mappen, de mails in die map, en de mail die je
 * leest met de klant ernaast. Op een telefoon is daar geen ruimte voor; dan
 * zie je er één tegelijk en ga je met een terugknop een stap terug.
 *
 * Wat je hier met een mail doet (lezen, weggooien, beantwoorden) gebeurt ook
 * op de mailserver, zodat je telefoon hetzelfde laat zien.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Flag,
  Folder,
  Inbox,
  Mail,
  MailOpen,
  Megaphone,
  Paperclip,
  Phone,
  Reply,
  Search,
  Send,
  ShieldAlert,
  SquarePen,
  Trash2,
  Undo2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  afzenderNaam,
  fetchBericht,
  fetchBerichten,
  fetchKlantBijEmail,
  lijstDatum,
  PER_PAGINA,
  veiligeMailHtml,
  type Bericht,
  type BerichtRegel,
} from "@/lib/berichten";
import { gooiWeg, zetGelezen, zetTerug } from "@/lib/mailacties";
import { fetchMailbox, fetchMappen, mapNaam, type MailMap, type MapRol } from "@/lib/mailbox";
import { klantAdres, ritmeLabel } from "@/lib/klanten";
import { toonDatum, vandaag } from "@/lib/wasdag";
import { MailOpstellen, type Opzet } from "@/components/mail/MailOpstellen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAP_ICOON: Record<MapRol, LucideIcon> = {
  postvak: Inbox,
  concepten: FileText,
  verzonden: Send,
  spam: ShieldAlert,
  prullenbak: Trash2,
  overig: Folder,
};

/** Zoveel van de oude mail komt er hooguit onder een antwoord. */
const MAX_CITAAT = 20_000;

/** Eens per ophaalronde verversen is genoeg: vaker komt er toch niets bij. */
const VERVERS_MS = 120_000;

type Scherm = "mappen" | "lijst" | "lezen";

const PANEEL = "min-h-0 flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-card";

export function Postvak({ onAankondigen }: { onAankondigen: () => void }) {
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const gekoppeld = !!mailbox.data && mailbox.data.status !== "uit";
  const mappen = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: gekoppeld,
    refetchInterval: VERVERS_MS,
  });

  const [mapId, setMapId] = useState<string | null>(null);
  const [berichtId, setBerichtId] = useState<string | null>(null);
  const [scherm, setScherm] = useState<Scherm>("lijst");
  const [opzet, setOpzet] = useState<Opzet | null>(null);
  // Welke mail er nú open is, voor acties die pas later klaar zijn.
  const openRef = useRef<string | null>(null);
  openRef.current = berichtId;

  // Standaard het postvak, zodra de mappen er zijn.
  useEffect(() => {
    if (mapId || !mappen.data) return;
    const eerste = mappen.data.find((m) => m.rol === "postvak") ?? mappen.data[0];
    if (eerste) setMapId(eerste.id);
  }, [mapId, mappen.data]);

  if (mailbox.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Even kijken…</p>;
  }

  if (mailbox.isError) {
    return (
      <p className="rounded-[12px] bg-tint-rood px-3 py-2 text-[13px] text-tint-rood-ink">
        De mailbox kon niet geladen worden. Probeer het zo nog eens.
      </p>
    );
  }

  if (!gekoppeld) {
    return (
      <section className="mx-auto mt-6 max-w-md rounded-[18px] border border-border bg-card p-6 text-center shadow-card">
        <div className="mx-auto flex size-12 items-center justify-center rounded-[14px] bg-tint-blauw text-tint-blauw-ink">
          <Mail className="size-6" />
        </div>
        <h2 className="mt-3 font-display text-[18px] font-semibold">Koppel eerst je mailbox</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Dan haalt Wooshy al je mail op, niet alleen de antwoorden op aankondigingen.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild className="rounded-full">
            <Link to="/instellingen" search={{ tab: "mail" }}>
              Mailbox koppelen
            </Link>
          </Button>
          <Button variant="outline" className="rounded-full" onClick={onAankondigen}>
            <Megaphone className="size-4" /> Wasdag aankondigen
          </Button>
        </div>
      </section>
    );
  }

  const huidigeMap = mappen.data?.find((m) => m.id === mapId);
  const kanSchrijven = mailbox.data?.status === "actief";

  return (
    <>
      {mailbox.data?.status === "fout" && (
        <p className="mb-3 rounded-[12px] bg-tint-amber px-3 py-2 text-[13px] text-tint-amber-ink">
          Wooshy kan niet meer inloggen bij je mailbox.{" "}
          <Link to="/instellingen" search={{ tab: "mail" }} className="font-medium underline">
            Vul het wachtwoord opnieuw in
          </Link>
          .
        </p>
      )}
      <div className="grid h-[calc(100dvh-var(--plakrand)-5.5rem)] min-h-[520px] gap-3 lg:grid-cols-[200px_minmax(280px,360px)_minmax(0,1fr)]">
        <div className={cn(PANEEL, scherm === "mappen" ? "flex" : "hidden", "lg:flex")}>
          <MapKolom
            mappen={mappen.data ?? []}
            fout={mappen.isError}
            actief={mapId}
            laatsteSync={mailbox.data?.laatste_sync ?? null}
            kanSchrijven={kanSchrijven}
            onKies={(id) => {
              setMapId(id);
              setBerichtId(null);
              setScherm("lijst");
            }}
            onNieuweMail={() => setOpzet({ aan: "", onderwerp: "", tekst: "" })}
            onAankondigen={onAankondigen}
          />
        </div>

        <div className={cn(PANEEL, scherm === "lijst" ? "flex" : "hidden", "lg:flex")}>
          {mapId ? (
            // Een eigen sleutel per map: dan begint het zoekveld leeg als je
            // van map wisselt, zonder dat het hele postvak dat hoeft te weten.
            <BerichtLijst
              key={mapId}
              mapId={mapId}
              titel={huidigeMap ? mapNaam(huidigeMap) : ""}
              actief={berichtId}
              onOpen={(id) => {
                setBerichtId(id);
                setScherm("lezen");
              }}
              onTerug={() => setScherm("mappen")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <KopMetTerug onTerug={() => setScherm("mappen")} />
              <p className="p-6 text-center text-[13px] text-muted-foreground">
                {mappen.isError ? "De mappen konden niet geladen worden." : "Wooshy haalt je mail op…"}
              </p>
            </div>
          )}
        </div>

        <div className={cn(PANEEL, scherm === "lezen" ? "flex" : "hidden", "lg:flex")}>
          <Leesvenster
            berichtId={berichtId}
            mapRol={huidigeMap?.rol ?? null}
            kanSchrijven={kanSchrijven}
            onTerug={() => setScherm("lijst")}
            onWeg={(id) => {
              // Intussen een andere mail geopend? Dan die laten staan.
              if (openRef.current !== id) return;
              setBerichtId(null);
              setScherm("lijst");
            }}
            onBeantwoord={(b) => setOpzet(antwoordOpzet(b))}
          />
        </div>
      </div>

      <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
    </>
  );
}

/** Een antwoord klaarzetten: "Re:", naar de afzender, de oude mail eronder. */
function antwoordOpzet(b: Bericht): Opzet {
  const onderwerp = /^re:/i.test(b.onderwerp) ? b.onderwerp : `Re: ${b.onderwerp}`;
  const naar = b.antwoord_naar || b.van_email;
  const wie = b.van_naam || b.van_email;
  const wanneer = new Date(b.ontvangen_op).toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Een heel lange mail citeren maakt het antwoord te lang om te versturen.
  const bron = b.tekst.length > MAX_CITAAT ? `${b.tekst.slice(0, MAX_CITAAT)}\n[…]` : b.tekst;
  const geciteerd = bron
    .split(/\r?\n/)
    .map((regel) => `> ${regel}`)
    .join("\n");
  return {
    // Tussen aanhalingstekens: een naam als "Jansen, Piet" bevat een komma.
    aan: b.van_naam && naar === b.van_email ? `"${b.van_naam.replace(/"/g, "")}" <${naar}>` : naar,
    onderwerp,
    tekst: `\n\n\nOp ${wanneer} schreef ${wie}:\n${geciteerd}`,
    antwoordOp: b.id,
  };
}

function KopMetTerug({ onTerug, children }: { onTerug: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <button
        type="button"
        onClick={onTerug}
        aria-label="Naar de mappen"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted lg:hidden"
      >
        <ArrowLeft className="size-4" />
      </button>
      {children}
    </div>
  );
}

// --- Mappen ------------------------------------------------------------------

function MapKolom({
  mappen,
  fout,
  actief,
  laatsteSync,
  kanSchrijven,
  onKies,
  onNieuweMail,
  onAankondigen,
}: {
  mappen: MailMap[];
  fout: boolean;
  actief: string | null;
  laatsteSync: string | null;
  kanSchrijven: boolean;
  onKies: (id: string) => void;
  onNieuweMail: () => void;
  onAankondigen: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <Button className="w-full justify-start rounded-full" disabled={!kanSchrijven} onClick={onNieuweMail}>
          <SquarePen className="size-4" /> Nieuwe mail
        </Button>
        <Button variant="outline" className="w-full justify-start rounded-full" onClick={onAankondigen}>
          <Megaphone className="size-4" /> Wasdag aankondigen
        </Button>
      </div>

      <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {fout && <p className="px-2.5 text-[12.5px] text-tint-rood-ink">Mappen laden lukte niet.</p>}
        {mappen.map((m) => {
          const Icoon = MAP_ICOON[m.rol];
          const isActief = m.id === actief;
          // Ongelezen in Verzonden of de prullenbak zegt niets; alleen tellen
          // waar het iets betekent.
          const telt = m.ongelezen > 0 && (m.rol === "postvak" || m.rol === "overig" || m.rol === "spam");
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onKies(m.id)}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors",
                isActief ? "bg-accent font-semibold text-foreground" : "text-foreground/80 hover:bg-muted/60",
              )}
            >
              <Icoon className={cn("size-4 shrink-0", isActief ? "text-tint-oranje-ink" : "text-muted-foreground")} />
              <span className="truncate">{mapNaam(m)}</span>
              {telt && (
                <span className="ml-auto rounded-full bg-tint-blauw px-1.5 text-[11px] font-semibold tabular-nums text-tint-blauw-ink">
                  {m.ongelezen}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <p className="px-1 text-[11.5px] leading-snug text-muted-foreground">
        {laatsteSync
          ? `Bijgewerkt ${lijstDatum(laatsteSync)}`
          : "Wooshy haalt je mail voor het eerst op…"}
      </p>
    </div>
  );
}

// --- Lijst ---------------------------------------------------------------------

function BerichtLijst({
  mapId,
  titel,
  actief,
  onOpen,
  onTerug,
}: {
  mapId: string;
  titel: string;
  actief: string | null;
  onOpen: (id: string) => void;
  onTerug: () => void;
}) {
  // Het zoekveld woont hier en niet in het postvak: elke letter die je typt
  // tekent dan alleen de lijst opnieuw, niet ook de mappen en de open mail.
  const [zoek, setZoek] = useState("");
  const [zoekTerm, setZoekTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setZoekTerm(zoek.trim()), 300);
    return () => clearTimeout(t);
  }, [zoek]);

  const lijst = useInfiniteQuery({
    queryKey: ["berichten", mapId, zoekTerm],
    queryFn: ({ pageParam }) => fetchBerichten(mapId, pageParam, zoekTerm),
    initialPageParam: null as string | null,
    getNextPageParam: (laatste) =>
      laatste.length === PER_PAGINA ? laatste.at(-1)?.ontvangen_op : undefined,
    refetchInterval: VERVERS_MS,
  });

  // Pagina's lopen op de rand een beetje over (zie fetchBerichten): elke mail
  // maar één keer.
  const berichten = useMemo(() => {
    const gezien = new Set<string>();
    return (lijst.data?.pages.flat() ?? []).filter((b) => {
      if (gezien.has(b.id)) return false;
      gezien.add(b.id);
      return true;
    });
  }, [lijst.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KopMetTerug onTerug={onTerug}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder={titel ? `Zoeken in ${titel}` : "Zoeken"}
            className="h-9 rounded-full pl-8 text-[13px]"
          />
        </div>
      </KopMetTerug>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lijst.isLoading ? (
          <p className="p-4 text-[13px] text-muted-foreground">Mail ophalen…</p>
        ) : lijst.isError ? (
          <p className="p-4 text-[13px] text-tint-rood-ink">De mail kon niet geladen worden.</p>
        ) : berichten.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">
            {zoekTerm ? "Niets gevonden." : "Geen mail in deze map."}
          </p>
        ) : (
          <>
            {berichten.map((b) => (
              <BerichtRij key={b.id} b={b} actief={b.id === actief} onOpen={() => onOpen(b.id)} />
            ))}
            {lijst.hasNextPage && (
              <div className="p-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={lijst.isFetchingNextPage}
                  onClick={() => void lijst.fetchNextPage()}
                >
                  {lijst.isFetchingNextPage ? "Laden…" : "Oudere mail laden"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BerichtRij({ b, actief, onOpen }: { b: BerichtRegel; actief: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "block w-full border-b border-border/60 px-3.5 py-2.5 text-left transition-colors",
        actief ? "bg-accent/70" : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        {!b.gelezen && <span className="size-2 shrink-0 rounded-full bg-tint-blauw-ink" aria-label="Ongelezen" />}
        <span className={cn("truncate text-[13.5px]", !b.gelezen && "font-semibold")}>{afzenderNaam(b)}</span>
        <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
          {lijstDatum(b.ontvangen_op)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className={cn("truncate text-[13px]", b.gelezen ? "text-foreground/80" : "font-medium")}>
          {b.onderwerp || "(geen onderwerp)"}
        </span>
        {b.heeft_bijlagen && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
        {b.gemarkeerd && <Flag className="size-3 shrink-0 text-tint-rood-ink" />}
      </div>
      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{b.fragment}</p>
    </button>
  );
}

// --- Lezen ---------------------------------------------------------------------

function Leesvenster({
  berichtId,
  mapRol,
  kanSchrijven,
  onTerug,
  onWeg,
  onBeantwoord,
}: {
  berichtId: string | null;
  mapRol: MapRol | null;
  kanSchrijven: boolean;
  onTerug: () => void;
  onWeg: (id: string) => void;
  onBeantwoord: (b: Bericht) => void;
}) {
  const qc = useQueryClient();
  const bericht = useQuery({
    queryKey: ["bericht", berichtId],
    queryFn: () => fetchBericht(berichtId!),
    enabled: !!berichtId,
  });
  const [bezigMet, setBezigMet] = useState<string | null>(null);

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["berichten"] });
    void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
  };

  // Openen is lezen, net als in een mailprogramma. Eén keer per mail: ook als
  // het op de server even niet lukt, niet blijven proberen bij elke render.
  const alGemarkeerd = useRef<string | null>(null);
  useEffect(() => {
    const b = bericht.data;
    if (!b || b.gelezen || !kanSchrijven || alGemarkeerd.current === b.id) return;
    alGemarkeerd.current = b.id;
    zetGelezen(b.id, true)
      .then(() => markeerInCache(b, true))
      .catch(() => {
        // Stil: de volgende ophaalronde trekt het recht, en een melding bij
        // elke geopende mail helpt niemand.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bericht.data, kanSchrijven]);

  async function doe<T>(id: string, actie: () => Promise<T>, gelukt: (uit: T) => void, opnieuwLaden = true) {
    setBezigMet(id);
    try {
      const uit = await actie();
      gelukt(uit);
      if (opnieuwLaden) ververs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezigMet((huidig) => (huidig === id ? null : huidig));
    }
  }

  /**
   * Gelezen of niet: alleen het bolletje in de lijst en het telletje bij de
   * map aanpassen. De hele lijst opnieuw laden, met alle doorgebladerde
   * pagina's, voor één bolletje is zonde.
   */
  function markeerInCache(m: Bericht, gelezen: boolean) {
    qc.setQueryData<Bericht | null>(["bericht", m.id], (oud) => (oud ? { ...oud, gelezen } : oud));
    qc.setQueriesData<InfiniteData<BerichtRegel[]>>({ queryKey: ["berichten", m.map_id] }, (oud) =>
      oud
        ? { ...oud, pages: oud.pages.map((p) => p.map((r) => (r.id === m.id ? { ...r, gelezen } : r))) }
        : oud,
    );
    if (m.richting === "in") {
      qc.setQueryData<MailMap[]>(["mail-mappen"], (oud) =>
        oud?.map((map) =>
          map.id === m.map_id ? { ...map, ongelezen: Math.max(0, map.ongelezen + (gelezen ? -1 : 1)) } : map,
        ),
      );
    }
  }

  if (!berichtId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Mail className="size-8 opacity-40" />
        <p className="text-[13px]">Kies een mail om te lezen.</p>
      </div>
    );
  }
  if (bericht.isLoading) return <p className="p-5 text-[13px] text-muted-foreground">Even ophalen…</p>;
  if (bericht.isError) {
    return <p className="p-5 text-[13px] text-tint-rood-ink">Deze mail kon niet geladen worden.</p>;
  }
  const b = bericht.data;
  if (!b) return <p className="p-5 text-[13px] text-muted-foreground">Deze mail is er niet meer.</p>;

  const inPrullenbak = mapRol === "prullenbak";
  const acties = (
    <div className="flex flex-wrap items-center gap-1.5">
      {b.richting === "in" && (
        <Button size="sm" className="rounded-full" disabled={!kanSchrijven || bezigMet === b.id} onClick={() => onBeantwoord(b)}>
          <Reply className="size-3.5" /> Beantwoorden
        </Button>
      )}
      {b.gelezen && b.richting === "in" && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={!kanSchrijven || bezigMet === b.id}
          onClick={() =>
            void doe(
              b.id,
              () => zetGelezen(b.id, false),
              () => {
                alGemarkeerd.current = b.id;
                markeerInCache(b, false);
              },
              false,
            )
          }
        >
          <MailOpen className="size-3.5" /> Ongelezen
        </Button>
      )}
      {inPrullenbak ? (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={!kanSchrijven || bezigMet === b.id}
          onClick={() => void doe(b.id, () => zetTerug(b.id), () => {
            toast.success("Teruggezet.");
            onWeg(b.id);
          })}
        >
          <Undo2 className="size-3.5" /> Terugzetten
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-muted-foreground hover:text-destructive"
          disabled={!kanSchrijven || bezigMet === b.id}
          onClick={() =>
            void doe(b.id, () => gooiWeg(b.id), (uit) => {
              onWeg(b.id);
              // Gaf de server de nieuwe plek nog niet, dan kan terugzetten pas
              // na de volgende ophaalronde. Dan ook geen knop die dat belooft.
              if (!uit.verplaatst) {
                toast.success("Naar de prullenbak.");
                return;
              }
              toast.success("Naar de prullenbak.", {
                action: {
                  label: "Ongedaan maken",
                  onClick: () =>
                    void zetTerug(b.id)
                      .then(ververs)
                      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
                },
              });
            })
          }
        >
          <Trash2 className="size-3.5" /> Weggooien
        </Button>
      )}
    </div>
  );

  return <Mailweergave b={b} acties={acties} onTerug={onTerug} />;
}

function Mailweergave({
  b,
  acties,
  onTerug,
}: {
  b: Bericht;
  acties: React.ReactNode;
  onTerug: () => void;
}) {
  const datum = new Date(b.ontvangen_op).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const naar = [...b.aan, ...b.cc].map((a) => a.naam || a.email).join(", ");
  const initiaal = (b.van_naam || b.van_email || "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-5 py-4">
        <button
          type="button"
          onClick={onTerug}
          className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-3.5" /> Terug
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 font-display text-[20px] font-semibold leading-tight tracking-[-0.01em]">
            {b.onderwerp || "(geen onderwerp)"}
          </h2>
          {acties}
        </div>
        <div className="mt-3 flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint-paars text-[13px] font-semibold text-tint-paars-ink">
            {initiaal}
          </div>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="truncate">
              <span className="font-medium">{b.van_naam || b.van_email}</span>
              {b.van_naam && <span className="text-muted-foreground"> &lt;{b.van_email}&gt;</span>}
            </p>
            {naar && <p className="truncate text-muted-foreground">Aan: {naar}</p>}
          </div>
          <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:block">{datum}</span>
        </div>
        {b.bijlagen.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {b.bijlagen.map((a, i) => (
              <span
                key={`${a.naam}-${i}`}
                title="De bijlage staat in je mailbox"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[12px]"
              >
                <Paperclip className="size-3 text-muted-foreground" />
                <span className="max-w-[180px] truncate">{a.naam}</span>
                <span className="text-muted-foreground">{grootte(a.grootte)}</span>
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_250px] xl:grid-rows-1">
        <div className="flex min-h-0 flex-col">
          {b.afgekapt && (
            <p className="mx-5 mt-3 rounded-[10px] bg-tint-geel px-3 py-1.5 text-[12px] text-tint-geel-ink">
              Deze mail is groot; Wooshy toont alleen het begin. De hele mail staat in je mailbox.
            </p>
          )}
          {b.html ? (
            <MailHtml html={b.html} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{b.tekst}</p>
            </div>
          )}
        </div>
        {b.richting === "in" && (
          <aside className="max-h-[40%] overflow-y-auto border-t border-border p-4 xl:max-h-none xl:border-l xl:border-t-0">
            <KlantKaart email={b.van_email} />
          </aside>
        )}
      </div>
    </div>
  );
}

function grootte(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} kB`;
  return `${bytes} B`;
}

/**
 * De html van een mail, in een afgesloten kader. Mail van buiten kan van alles
 * bevatten; zonder scripts en zonder toegang tot de app kan hij niets. Plaatjes
 * van internet laden we niet: daarmee ziet een verzender wanneer je zijn mail
 * opent. Links zijn eerst nagelopen (veiligeMailHtml) en gaan open zonder
 * lijntje terug naar Wooshy en zonder te verraden waar je vandaan komt.
 */
function MailHtml({ html }: { html: string }) {
  const doc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` +
      `<meta name="referrer" content="no-referrer">` +
      `<base target="_blank">` +
      `<style>body{margin:16px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2320;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%!important}</style>` +
      `</head><body>${veiligeMailHtml(html)}</body></html>`,
    [html],
  );
  return (
    <iframe
      title="Inhoud van de mail"
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="min-h-0 w-full flex-1 bg-white"
    />
  );
}

// --- Klant ---------------------------------------------------------------------

function KlantKaart({ email }: { email: string }) {
  const dag = vandaag();
  const klanten = useQuery({
    queryKey: ["klant-bij-email", email.toLowerCase(), dag],
    queryFn: () => fetchKlantBijEmail(email, dag),
    enabled: !!email,
  });

  if (klanten.isLoading) return <p className="text-[12.5px] text-muted-foreground">Klant zoeken…</p>;

  if (klanten.isError) {
    return (
      <p className="rounded-[14px] bg-tint-rood p-3 text-[12.5px] text-tint-rood-ink">
        Klant opzoeken lukte niet. Probeer het zo nog eens.
      </p>
    );
  }

  if (!klanten.data?.length) {
    return (
      <div className="rounded-[14px] bg-muted/50 p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-medium">
          <UserRound className="size-3.5 text-muted-foreground" /> Geen klant
        </p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {email || "Dit adres"} hoort nog bij geen klant.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {klanten.data.map((k) => {
        const frequenties = [...new Set(k.adressen.map((a) => ritmeLabel(a)))];
        return (
          <div key={k.id} className="rounded-[14px] bg-tint-groen p-3 text-tint-groen-ink">
            <p className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <UserRound className="size-3.5" /> {k.naam}
            </p>
            {klantAdres(k) && <p className="mt-1 text-[12.5px]">{klantAdres(k)}</p>}
            {k.telefoon && (
              <a href={`tel:${k.telefoon}`} className="mt-1 flex items-center gap-1.5 text-[12.5px] underline-offset-2 hover:underline">
                <Phone className="size-3" /> {k.telefoon}
              </a>
            )}
            <div className="mt-2 space-y-0.5 border-t border-tint-groen-ink/15 pt-2 text-[12px]">
              <p>
                {k.adressen.length} {k.adressen.length === 1 ? "adres" : "adressen"}
                {frequenties.length > 0 && ` · frequentie ${frequenties.join(", ").toLowerCase()}`}
              </p>
              <p className="flex items-center gap-1.5">
                <CalendarDays className="size-3" />
                {k.volgendeWasdag ? `Volgende wasdag: ${toonDatum(k.volgendeWasdag)}` : "Nog niet ingepland"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
