/**
 * Het postvak: je mail zoals in een gewoon mailprogramma.
 *
 * Drie kolommen naast elkaar — mappen, de mails in die map, en de mail die je
 * leest met de klant ernaast. Op een telefoon is daar geen ruimte voor; dan
 * zie je er één tegelijk en ga je met een terugknop een stap terug.
 *
 * Naast de mappen van de mailserver staan de mappen van Paaltje: wat op jou
 * wacht, zijn categorieën, en de post die geen klantmail is. Die bestaan
 * alleen in Wooshy; op je telefoon staat alles gewoon in het postvak.
 *
 * Wat je hier met een mail doet (lezen, weggooien, beantwoorden) gebeurt ook
 * op de mailserver, zodat je telefoon hetzelfde laat zien.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  BellOff,
  CircleCheck,
  Clock,
  Keyboard,
  Loader2,
  Pencil,
  FileText,
  Flag,
  FlagOff,
  Forward,
  Folder,
  FolderInput,
  FolderPlus,
  Hand,
  Inbox,
  Mail,
  MailOpen,
  Megaphone,
  Newspaper,
  Paperclip,
  Reply,
  ReplyAll,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Tag,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  afzenderNaam,
  bronSleutel,
  fetchBericht,
  fetchBerichten,
  fetchGepland,
  fetchSpamRegels,
  lijstDatum,
  PER_PAGINA,
  telWachtend,
  veiligeMailHtml,
  type Bericht,
  type BerichtRegel,
  type Bron,
} from "@/lib/berichten";
import {
  altijdSpam,
  bulkActie,
  gooiWeg,
  haalBijlage,
  handelAf,
  herinner,
  hernoemMap,
  maakMap,
  spamregelWeg,
  verwijderMap,
  verplaatsNaar,
  zetGelezen,
  zetGemarkeerd,
  zetTerug,
  type BulkDoe,
} from "@/lib/mailacties";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useBevestig } from "@/components/Bevestig";
import { Gesprek } from "@/components/mail/Gesprek";
import { GeplandLijst } from "@/components/mail/GeplandLijst";
import { MomentKiezer, toonMoment } from "@/components/mail/MomentKiezer";
import { SneltoetsenHulp } from "@/components/mail/Sneltoetsen";
import { SpamAfzenders } from "@/components/mail/SpamAfzenders";
import { fetchMailbox, fetchMappen, mapNaam, type MailMap, type MapRol } from "@/lib/mailbox";
import { categorieTint, fetchCategorieen, type MailCategorie } from "@/lib/paaltje";
import { MailOpstellen, type Opzet } from "@/components/mail/MailOpstellen";
import { KlantKaart } from "@/components/mail/KlantKaart";
import { PaaltjeKaart } from "@/components/mail/PaaltjeKaart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRecht } from "@/lib/rechten";
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

/** Zoveel mails kun je tegelijk selecteren; de server doet er niet meer in één keer. */
const MAX_SELECTIE = 50;

const PANEEL = "min-h-0 flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-card";

function zelfdeBron(a: Bron | null, b: Bron | null) {
  return !!a && !!b && bronSleutel(a) === bronSleutel(b);
}

/** Zonder onAankondigen (wie geen mail mag versturen) geen aankondigknop. */
export function Postvak({ onAankondigen }: { onAankondigen?: (() => void) | undefined }) {
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox });
  const gekoppeld = !!mailbox.data && mailbox.data.status !== "uit";
  const mappen = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: gekoppeld,
    refetchInterval: VERVERS_MS,
  });
  const categorieen = useQuery({
    queryKey: ["mail-categorieen"],
    queryFn: fetchCategorieen,
    enabled: gekoppeld,
  });
  const postvak = mappen.data?.find((m) => m.rol === "postvak") ?? null;
  const wacht = useQuery({
    queryKey: ["mail-wacht", postvak?.id],
    queryFn: () => telWachtend(postvak!.id),
    enabled: !!postvak,
    refetchInterval: VERVERS_MS,
  });

  const [bron, setBron] = useState<Bron | null>(null);
  const [berichtId, setBerichtId] = useState<string | null>(null);
  const [scherm, setScherm] = useState<Scherm>("lijst");
  const [opzet, setOpzet] = useState<Opzet | null>(null);
  const [hulpOpen, setHulpOpen] = useState(false);
  // Welke mail er nú open is, voor acties die pas later klaar zijn.
  const openRef = useRef<string | null>(null);
  openRef.current = berichtId;

  // Standaard het postvak, zodra de mappen er zijn.
  useEffect(() => {
    if (bron || !mappen.data) return;
    const eerste = mappen.data.find((m) => m.rol === "postvak") ?? mappen.data[0];
    if (eerste) setBron({ soort: "map", mapId: eerste.id });
  }, [bron, mappen.data]);

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
          {onAankondigen && (
            <Button variant="outline" className="rounded-full" onClick={onAankondigen}>
              <Megaphone className="size-4" /> Wasdag aankondigen
            </Button>
          )}
        </div>
      </section>
    );
  }

  const kanSchrijven = mailbox.data?.status === "actief";
  const titel = bronTitel(bron, mappen.data ?? [], categorieen.data ?? []);

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
      <div className="grid h-[calc(100dvh-var(--plakrand)-5.5rem)] min-h-[520px] gap-3 lg:grid-cols-[210px_minmax(280px,360px)_minmax(0,1fr)]">
        <div className={cn(PANEEL, scherm === "mappen" ? "flex" : "hidden", "lg:flex")}>
          <MapKolom
            mappen={mappen.data ?? []}
            categorieen={categorieen.data ?? []}
            postvakId={postvak?.id ?? null}
            wachtAantal={wacht.data ?? 0}
            fout={mappen.isError}
            actief={bron}
            laatsteSync={mailbox.data?.laatste_sync ?? null}
            kanSchrijven={kanSchrijven}
            onKies={(nieuw) => {
              setBron(nieuw);
              setBerichtId(null);
              setScherm("lijst");
            }}
            onNieuweMail={() => setOpzet({ aan: "", onderwerp: "", tekst: "" })}
            onAankondigen={onAankondigen}
          />
        </div>

        <div className={cn(PANEEL, scherm === "lijst" ? "flex" : "hidden", "lg:flex")}>
          {bron?.soort === "gepland" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <KopMetTerug onTerug={() => setScherm("mappen")}>
                <span className="text-[13.5px] font-semibold">Gepland</span>
              </KopMetTerug>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <GeplandLijst kanSchrijven={kanSchrijven} />
              </div>
            </div>
          ) : bron ? (
            // Een eigen sleutel per lijst: dan begint het zoekveld leeg als je
            // van map wisselt, zonder dat het hele postvak dat hoeft te weten.
            <BerichtLijst
              key={bronSleutel(bron)}
              bron={bron}
              titel={titel}
              categorieen={categorieen.data ?? []}
              mappen={mappen.data ?? []}
              kanSchrijven={kanSchrijven}
              eigenAdres={mailbox.data?.adres ?? ""}
              onOpstellen={setOpzet}
              onNieuweMail={() => setOpzet({ aan: "", onderwerp: "", tekst: "" })}
              onHulp={() => setHulpOpen(true)}
              onWeg={(id) => {
                if (openRef.current !== id) return;
                setBerichtId(null);
              }}
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
            mappen={mappen.data ?? []}
            kanSchrijven={kanSchrijven}
            onTerug={() => setScherm("lijst")}
            onWeg={(id) => {
              // Intussen een andere mail geopend? Dan die laten staan.
              if (openRef.current !== id) return;
              setBerichtId(null);
              setScherm("lijst");
            }}
            onBeantwoord={(b, begin) => setOpzet(antwoordOpzet(b, begin))}
            onOpstellen={setOpzet}
            onOpen={(id) => setBerichtId(id)}
            eigenAdres={mailbox.data?.adres ?? ""}
          />
        </div>
      </div>

      <MailOpstellen open={opzet !== null} opzet={opzet} onSluit={() => setOpzet(null)} />
      <SneltoetsenHulp open={hulpOpen} onSluit={() => setHulpOpen(false)} />
    </>
  );
}

function bronTitel(bron: Bron | null, mappen: MailMap[], categorieen: MailCategorie[]): string {
  if (!bron) return "";
  switch (bron.soort) {
    case "map": {
      const m = mappen.find((x) => x.id === bron.mapId);
      return m ? mapNaam(m) : "";
    }
    case "wacht":
      return "Wacht op jou";
    case "gepland":
      return "Gepland";
    case "overige":
      return "Overige post";
    case "categorie":
      return categorieen.find((c) => c.id === bron.categorieId)?.naam ?? "";
  }
}

/** Een adres voor in het Aan-vak; tussen aanhalingstekens, want "Jansen, Piet" bevat een komma. */
function alsAdres(a: { naam: string; email: string }): string {
  return a.naam ? `"${a.naam.replace(/"/g, "")}" <${a.email}>` : a.email;
}

/**
 * Allen beantwoorden: de afzender in Aan, en wie er verder in Aan en Cc stond
 * in Cc — behalve je eigen adres en de afzender zelf.
 */
export function allenAntwoordOpzet(b: Bericht, eigenAdres: string): Opzet {
  const basis = antwoordOpzet(b);
  const naar = (b.antwoord_naar || b.van_email).toLowerCase();
  const eigen = eigenAdres.toLowerCase();
  const gezien = new Set([naar, eigen]);
  const anderen = [...b.aan, ...b.cc].filter((a) => {
    const e = a.email.toLowerCase();
    if (!e || gezien.has(e)) return false;
    gezien.add(e);
    return true;
  });
  return { ...basis, cc: anderen.map(alsAdres).join(", ") };
}

/** Doorsturen: "Fwd:", leeg Aan-vak, de oude mail met zijn kop eronder. */
export function doorstuurOpzet(b: Bericht): Opzet {
  const onderwerp = /^(fwd?|doorst):/i.test(b.onderwerp) ? b.onderwerp : `Fwd: ${b.onderwerp}`;
  const wanneer = new Date(b.ontvangen_op).toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const bron = b.tekst.length > MAX_CITAAT ? `${b.tekst.slice(0, MAX_CITAAT)}\n[…]` : b.tekst;
  const kop = [
    "---------- Doorgestuurd bericht ----------",
    `Van: ${b.van_naam ? `${b.van_naam} <${b.van_email}>` : b.van_email}`,
    `Datum: ${wanneer}`,
    `Onderwerp: ${b.onderwerp}`,
    b.aan.length ? `Aan: ${b.aan.map((a) => a.naam || a.email).join(", ")}` : "",
  ].filter(Boolean);
  return {
    aan: "",
    onderwerp,
    tekst: `\n\n\n${kop.join("\n")}\n\n${bron}`,
    ...(b.bijlagen.length > 0 ? { bijlagenVan: b.id, bijlagenNamen: b.bijlagen.map((a) => a.naam) } : {}),
  };
}

/** Een antwoord klaarzetten: "Re:", naar de afzender, de oude mail eronder. */
export function antwoordOpzet(b: Bericht, begin = ""): Opzet {
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
    tekst: `${begin}\n\n\nOp ${wanneer} schreef ${wie}:\n${geciteerd}`,
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
  categorieen,
  postvakId,
  wachtAantal,
  fout,
  actief,
  laatsteSync,
  kanSchrijven,
  onKies,
  onNieuweMail,
  onAankondigen,
}: {
  mappen: MailMap[];
  categorieen: MailCategorie[];
  postvakId: string | null;
  wachtAantal: number;
  fout: boolean;
  actief: Bron | null;
  laatsteSync: string | null;
  kanSchrijven: boolean;
  onKies: (bron: Bron) => void;
  onNieuweMail: () => void;
  onAankondigen?: (() => void) | undefined;
}) {
  const postvak = mappen.find((m) => m.id === postvakId);
  // Een map maken verandert de echte mailbox; dat vraagt hetzelfde recht als versturen.
  const magMappenMaken = useRecht("mail_versturen");
  const gepland = useQuery({ queryKey: ["gepland"], queryFn: fetchGepland, refetchInterval: 60_000 });
  const overigeMappen = mappen.filter((m) => m.id !== postvakId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <Button className="w-full justify-start rounded-full" disabled={!kanSchrijven} onClick={onNieuweMail}>
          <SquarePen className="size-4" /> Nieuwe mail
        </Button>
        {onAankondigen && (
          <Button variant="outline" className="w-full justify-start rounded-full" onClick={onAankondigen}>
            <Megaphone className="size-4" /> Wasdag aankondigen
          </Button>
        )}
      </div>

      <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {fout && <p className="px-2.5 text-[12.5px] text-tint-rood-ink">Mappen laden lukte niet.</p>}

        {postvak && (
          <MapKnop
            icoon={Inbox}
            naam={mapNaam(postvak)}
            telletje={postvak.ongelezen}
            actief={zelfdeBron(actief, { soort: "map", mapId: postvak.id })}
            onClick={() => onKies({ soort: "map", mapId: postvak.id })}
          />
        )}

        {postvakId && (
          <>
            <MapKnop
              icoon={Hand}
              naam="Wacht op jou"
              telletje={wachtAantal}
              tint="amber"
              actief={zelfdeBron(actief, { soort: "wacht", postvakId })}
              onClick={() => onKies({ soort: "wacht", postvakId })}
            />
            <p className="mt-2 flex items-center gap-1 px-2.5 pb-1 text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground/80">
              <Sparkles className="size-3" /> paaltje
            </p>
            {categorieen.map((c, i) => (
              <MapKnop
                key={c.id}
                icoon={Tag}
                naam={c.naam}
                stip={categorieTint(c, i)}
                actief={zelfdeBron(actief, { soort: "categorie", postvakId, categorieId: c.id })}
                onClick={() => onKies({ soort: "categorie", postvakId, categorieId: c.id })}
              />
            ))}
            <MapKnop
              icoon={Newspaper}
              naam="Overige post"
              actief={zelfdeBron(actief, { soort: "overige", postvakId })}
              onClick={() => onKies({ soort: "overige", postvakId })}
            />
            <p className="mt-2 px-2.5 pb-1 text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground/80">
              mappen
            </p>
          </>
        )}

        {overigeMappen.map((m) =>
          m.rol === "overig" && magMappenMaken && kanSchrijven ? (
            <EigenMapKnop
              key={m.id}
              map={m}
              actief={zelfdeBron(actief, { soort: "map", mapId: m.id })}
              onClick={() => onKies({ soort: "map", mapId: m.id })}
              onWeg={() => {
                if (zelfdeBron(actief, { soort: "map", mapId: m.id }) && postvakId) {
                  onKies({ soort: "map", mapId: postvakId });
                }
              }}
            />
          ) : (
            <MapKnop
              key={m.id}
              icoon={MAP_ICOON[m.rol]}
              naam={mapNaam(m)}
              // Ongelezen in Verzonden of de prullenbak zegt niets.
              telletje={m.rol === "overig" || m.rol === "spam" ? m.ongelezen : 0}
              actief={zelfdeBron(actief, { soort: "map", mapId: m.id })}
              onClick={() => onKies({ soort: "map", mapId: m.id })}
            />
          ),
        )}
        <MapKnop
          icoon={Clock}
          naam="Gepland"
          telletje={(gepland.data ?? []).filter((g) => g.status === "wacht" || g.status === "mislukt").length}
          tint="amber"
          actief={zelfdeBron(actief, { soort: "gepland" })}
          onClick={() => onKies({ soort: "gepland" })}
        />
        {kanSchrijven && magMappenMaken && <NieuweMap onGemaakt={(id) => onKies({ soort: "map", mapId: id })} />}
      </nav>

      <SpamAfzenders kanSchrijven={kanSchrijven} />
      <p className="px-1 text-[11.5px] leading-snug text-muted-foreground">
        {laatsteSync
          ? `Bijgewerkt ${lijstDatum(laatsteSync)}`
          : "Wooshy haalt je mail voor het eerst op…"}
      </p>
    </div>
  );
}

/** Een map erbij maken, net als in een mailprogramma. Hij komt ook op je telefoon. */
function NieuweMap({ onGemaakt }: { onGemaakt: (mapId: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [bezig, setBezig] = useState(false);

  async function maak() {
    if (!naam.trim() || bezig) return;
    setBezig(true);
    try {
      const { map_id } = await maakMap(naam);
      await qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      toast.success(`Map "${naam.trim()}" gemaakt.`);
      setNaam("");
      setOpen(false);
      onGemaakt(map_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        <FolderPlus className="size-4" /> Nieuwe map
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex items-center gap-1 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        void maak();
      }}
    >
      <Input
        autoFocus
        value={naam}
        maxLength={60}
        disabled={bezig}
        placeholder="Naam van de map"
        aria-label="Naam van de nieuwe map"
        onChange={(e) => setNaam(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setNaam("");
          }
        }}
        className="h-8 rounded-full text-[12.5px]"
      />
      <Button type="submit" size="sm" className="h-8 rounded-full px-3" disabled={bezig || !naam.trim()}>
        {bezig ? "…" : "Maak"}
      </Button>
    </form>
  );
}

/** Een eigen map: met de rechtermuisknop hernoemen of (als hij leeg is) verwijderen. */
function EigenMapKnop({
  map,
  actief,
  onClick,
  onWeg,
}: {
  map: MailMap;
  actief: boolean;
  onClick: () => void;
  onWeg: () => void;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [bewerk, setBewerk] = useState(false);
  const [naam, setNaam] = useState(mapNaam(map));
  const [bezig, setBezig] = useState(false);

  async function bewaar() {
    if (!naam.trim() || naam.trim() === mapNaam(map)) return void setBewerk(false);
    setBezig(true);
    try {
      await hernoemMap(map.id, naam);
      await qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      toast.success("Map hernoemd.");
      setBewerk(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  async function weg() {
    const ja = await bevestig({
      titel: `Map "${mapNaam(map)}" verwijderen?`,
      tekst: "Dat kan alleen als hij leeg is. Hij verdwijnt ook op je telefoon.",
      bevestigLabel: "Verwijderen",
      gevaarlijk: true,
    });
    if (!ja) return;
    try {
      await verwijderMap(map.id);
      onWeg();
      await qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      toast.success("Map verwijderd.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  if (bewerk) {
    return (
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          void bewaar();
        }}
      >
        <Input
          autoFocus
          value={naam}
          maxLength={60}
          disabled={bezig}
          aria-label="Nieuwe naam van de map"
          onChange={(e) => setNaam(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setBewerk(false)}
          className="h-8 rounded-full text-[12.5px]"
        />
        <Button type="submit" size="sm" className="h-8 rounded-full px-3" disabled={bezig}>
          OK
        </Button>
      </form>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex flex-col">
          <MapKnop
            icoon={MAP_ICOON[map.rol]}
            naam={mapNaam(map)}
            telletje={map.ongelezen}
            actief={actief}
            onClick={onClick}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onSelect={() => {
            setNaam(mapNaam(map));
            setBewerk(true);
          }}
        >
          <Pencil className="size-4" /> Hernoemen
        </ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => void weg()}>
          <Trash2 className="size-4" /> Verwijderen
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MapKnop({
  icoon: Icoon,
  naam,
  telletje = 0,
  tint = "blauw",
  stip,
  actief,
  onClick,
}: {
  icoon: LucideIcon;
  naam: string;
  telletje?: number;
  tint?: "blauw" | "amber";
  /** Tintklassen van een categorie: dan een gekleurd stipje in plaats van het icoon. */
  stip?: string;
  actief: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors",
        actief ? "bg-accent font-semibold text-foreground" : "text-foreground/80 hover:bg-muted/60",
      )}
    >
      {stip ? (
        <span className={cn("ml-1 mr-0.5 size-2.5 shrink-0 rounded-full", stip)} />
      ) : (
        <Icoon className={cn("size-4 shrink-0", actief ? "text-tint-oranje-ink" : "text-muted-foreground")} />
      )}
      <span className="truncate">{naam}</span>
      {telletje > 0 && (
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            tint === "amber" ? "bg-tint-amber text-tint-amber-ink" : "bg-tint-blauw text-tint-blauw-ink",
          )}
        >
          {telletje}
        </span>
      )}
    </button>
  );
}

// --- Lijst ---------------------------------------------------------------------

function BerichtLijst({
  bron,
  titel,
  categorieen,
  mappen,
  kanSchrijven,
  eigenAdres,
  onOpstellen,
  onNieuweMail,
  onHulp,
  onWeg,
  actief,
  onOpen,
  onTerug,
}: {
  bron: Bron;
  titel: string;
  categorieen: MailCategorie[];
  mappen: MailMap[];
  kanSchrijven: boolean;
  eigenAdres: string;
  onOpstellen: (o: Opzet) => void;
  onNieuweMail: () => void;
  onHulp: () => void;
  onWeg: (id: string) => void;
  actief: string | null;
  onOpen: (id: string) => void;
  onTerug: () => void;
}) {
  const qc = useQueryClient();
  const zoekVeld = useRef<HTMLInputElement>(null);
  /** Aangevinkte mails, om er in één keer iets mee te doen. */
  const [gekozen, setGekozen] = useState<Set<string>>(new Set());
  const [bulkBezig, setBulkBezig] = useState(false);
  // Het zoekveld woont hier en niet in het postvak: elke letter die je typt
  // tekent dan alleen de lijst opnieuw, niet ook de mappen en de open mail.
  const [zoek, setZoek] = useState("");
  const [zoekTerm, setZoekTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setZoekTerm(zoek.trim()), 300);
    return () => clearTimeout(t);
  }, [zoek]);

  const lijst = useInfiniteQuery({
    queryKey: ["berichten", bronSleutel(bron), zoekTerm],
    queryFn: ({ pageParam }) => fetchBerichten(bron, pageParam, zoekTerm),
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

  const acties = useMailActies(onWeg);
  const spamRegels = useQuery({ queryKey: ["spam-regels"], queryFn: fetchSpamRegels });

  // Wat niet meer in de lijst staat, hoort ook niet meer bij de selectie.
  useEffect(() => {
    setGekozen((oud) => {
      const ids = new Set(berichten.map((b) => b.id));
      const nieuw = new Set([...oud].filter((id) => ids.has(id)));
      return nieuw.size === oud.size ? oud : nieuw;
    });
  }, [berichten]);

  function kies(id: string) {
    setGekozen((oud) => {
      const nieuw = new Set(oud);
      if (nieuw.has(id)) nieuw.delete(id);
      else if (nieuw.size >= MAX_SELECTIE) toast.info(`Hooguit ${MAX_SELECTIE} mails tegelijk.`);
      else nieuw.add(id);
      return nieuw;
    });
  }

  async function voorAlle(doe: BulkDoe, map?: MailMap) {
    const ids = [...gekozen];
    if (ids.length === 0) return;
    setBulkBezig(true);
    try {
      const uit = await bulkActie(ids, doe, map?.id);
      if (ids.includes(actief ?? "") && (doe === "weggooien" || doe === "verplaatsen")) onWeg(actief!);
      setGekozen(new Set());
      const wat: Record<BulkDoe, string> = {
        gelezen: "gelezen",
        ongelezen: "ongelezen",
        vlag: "gemarkeerd",
        "vlag-eraf": "zonder vlag",
        afhandelen: "afgehandeld",
        weggooien: "naar de prullenbak",
        verplaatsen: map ? `verplaatst naar ${mapNaam(map)}` : "verplaatst",
      };
      if (uit.mislukt.length > 0) toast.warning(`${uit.gelukt} ${wat[doe]}; ${uit.mislukt.length} lukte niet.`);
      else toast.success(`${uit.gelukt} ${uit.gelukt === 1 ? "mail" : "mails"} ${wat[doe]}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBezig(false);
      void qc.invalidateQueries({ queryKey: ["berichten"] });
      void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
      void qc.invalidateQueries({ queryKey: ["mail-wacht"] });
    }
  }

  // Sneltoetsen, zoals in een mailprogramma. Niet als je in een tekstvak typt
  // of er een venster open is.
  const sneltoets = useRef<(e: KeyboardEvent) => void>(() => {});
  sneltoets.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const doel = e.target as HTMLElement | null;
    if (doel?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
    // Enter op een knop of link hoort bij die knop.
    if (e.key === "Enter" && doel?.closest("button, a, [role='button'], [role='checkbox']")) return;

    const plek = berichten.findIndex((b) => b.id === actief);
    const huidig = plek >= 0 ? berichten[plek] : undefined;
    const naar = (i: number) => {
      const b = berichten[Math.max(0, Math.min(berichten.length - 1, i))];
      if (b) onOpen(b.id);
    };
    const volledig = async (maak: (v: Bericht) => Opzet) => {
      if (!huidig || !kanSchrijven) return;
      const v = await qc.fetchQuery({ queryKey: ["bericht", huidig.id], queryFn: () => fetchBericht(huidig.id) });
      if (v) onOpstellen(maak(v));
    };
    const rol = mappen.find((m) => m.id === huidig?.map_id)?.rol;

    let gedaan = true;
    switch (e.key) {
      case "k":
      case "ArrowDown":
        naar(plek + 1);
        break;
      case "j":
      case "ArrowUp":
        naar(plek < 0 ? 0 : plek - 1);
        break;
      case "Enter":
      case "o":
        if (huidig) onOpen(huidig.id);
        else naar(0);
        break;
      case "e":
        if (huidig && kanSchrijven) void acties.afhandelen(huidig.id, true);
        break;
      case "r":
        void volledig((v) => antwoordOpzet(v));
        break;
      case "a":
        void volledig((v) => allenAntwoordOpzet(v, eigenAdres));
        break;
      case "f":
        void volledig(doorstuurOpzet);
        break;
      case "#":
      case "Delete":
        if (huidig && kanSchrijven && rol !== "prullenbak") {
          naar(plek + 1 < berichten.length ? plek + 1 : plek - 1);
          void acties.weggooien(huidig.id);
        }
        break;
      case "u":
        if (huidig && kanSchrijven) void acties.gelezen(huidig.id, !huidig.gelezen);
        break;
      case "s":
        if (huidig && kanSchrijven) void acties.markeer(huidig.id, !huidig.gemarkeerd);
        break;
      case "x":
        if (huidig) kies(huidig.id);
        break;
      case "c":
        if (kanSchrijven) onNieuweMail();
        break;
      case "/":
        zoekVeld.current?.focus();
        break;
      case "Escape":
        setGekozen(new Set());
        break;
      case "?":
        onHulp();
        break;
      default:
        gedaan = false;
    }
    if (gedaan) e.preventDefault();
  };
  useEffect(() => {
    const luister = (e: KeyboardEvent) => sneltoets.current(e);
    window.addEventListener("keydown", luister);
    return () => window.removeEventListener("keydown", luister);
  }, []);

  const leeg =
    bron.soort === "wacht"
      ? "Er wacht niets op je."
      : bron.soort === "overige"
        ? "Geen overige post."
        : bron.soort === "categorie"
          ? "Nog geen mail in deze categorie."
          : "Geen mail in deze map.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KopMetTerug onTerug={onTerug}>
        {gekozen.size > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <Checkbox
              checked={gekozen.size === Math.min(berichten.length, MAX_SELECTIE) ? true : "indeterminate"}
              onCheckedChange={() => {
                if (gekozen.size === Math.min(berichten.length, MAX_SELECTIE)) return void setGekozen(new Set());
                if (berichten.length > MAX_SELECTIE) {
                  toast.info(`De eerste ${MAX_SELECTIE} mails zijn geselecteerd; meer tegelijk kan niet.`);
                }
                setGekozen(new Set(berichten.slice(0, MAX_SELECTIE).map((b) => b.id)));
              }}
              aria-label="Alles selecteren"
              className="mx-1"
            />
            <span className="mr-1 text-[12.5px] font-medium tabular-nums">{gekozen.size}</span>
            <SnelKnop label="Afgehandeld" onClick={() => void voorAlle("afhandelen")} uit={bulkBezig || !kanSchrijven}>
              <CircleCheck className="size-3.5" />
            </SnelKnop>
            <SnelKnop label="Markeren als gelezen" onClick={() => void voorAlle("gelezen")} uit={bulkBezig || !kanSchrijven}>
              <MailOpen className="size-3.5" />
            </SnelKnop>
            <SnelKnop label="Markeren als ongelezen" onClick={() => void voorAlle("ongelezen")} uit={bulkBezig || !kanSchrijven}>
              <Mail className="size-3.5" />
            </SnelKnop>
            <SnelKnop label="Vlag erop" onClick={() => void voorAlle("vlag")} uit={bulkBezig || !kanSchrijven}>
              <Flag className="size-3.5" />
            </SnelKnop>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Verplaatsen naar"
                  title="Verplaatsen naar"
                  disabled={bulkBezig || !kanSchrijven}
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <FolderInput className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 w-52 overflow-y-auto">
                {mappen.map((m) => {
                  const Icoon = MAP_ICOON[m.rol];
                  return (
                    <DropdownMenuItem key={m.id} onSelect={() => void voorAlle("verplaatsen", m)}>
                      <Icoon className="size-4" /> {mapNaam(m)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <SnelKnop label="Weggooien" gevaarlijk onClick={() => void voorAlle("weggooien")} uit={bulkBezig || !kanSchrijven}>
              <Trash2 className="size-3.5" />
            </SnelKnop>
            <button
              type="button"
              onClick={() => setGekozen(new Set())}
              className="ml-auto px-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              {bulkBezig ? "Bezig…" : "Wissen"}
            </button>
          </div>
        ) : (
          <>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={zoekVeld}
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
                placeholder={titel ? `Zoeken in ${titel}` : "Zoeken"}
                className="h-9 rounded-full pl-8 text-[13px]"
              />
            </div>
            <button
              type="button"
              onClick={onHulp}
              aria-label="Sneltoetsen"
              title="Sneltoetsen (?)"
              className="hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
            >
              <Keyboard className="size-4" />
            </button>
          </>
        )}
      </KopMetTerug>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lijst.isLoading ? (
          <p className="p-4 text-[13px] text-muted-foreground">Mail ophalen…</p>
        ) : lijst.isError ? (
          <p className="p-4 text-[13px] text-tint-rood-ink">De mail kon niet geladen worden.</p>
        ) : berichten.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">{zoekTerm ? "Niets gevonden." : leeg}</p>
        ) : (
          <>
            {berichten.map((b) => (
              <BerichtRij
                key={b.id}
                b={b}
                categorieen={categorieen}
                actief={b.id === actief}
                onOpen={() => onOpen(b.id)}
                acties={acties}
                mappen={mappen}
                kanSchrijven={kanSchrijven}
                eigenAdres={eigenAdres}
                onOpstellen={onOpstellen}
                gekozen={gekozen.has(b.id)}
                kiesModus={gekozen.size > 0}
                onKies={() => kies(b.id)}
                spamAfzender={(spamRegels.data ?? []).includes(b.van_email.toLowerCase())}
              />
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

function BerichtRij({
  b,
  categorieen,
  actief,
  onOpen,
  acties,
  mappen,
  kanSchrijven,
  eigenAdres,
  onOpstellen,
  gekozen,
  kiesModus,
  onKies,
  spamAfzender,
}: {
  b: BerichtRegel;
  categorieen: MailCategorie[];
  actief: boolean;
  onOpen: () => void;
  acties: MailActies;
  mappen: MailMap[];
  kanSchrijven: boolean;
  eigenAdres: string;
  onOpstellen: (o: Opzet) => void;
  gekozen: boolean;
  /** Er is al iets aangevinkt: dan staan alle vinkjes in beeld. */
  kiesModus: boolean;
  onKies: () => void;
  /** Deze afzender gaat altijd naar spam. */
  spamAfzender: boolean;
}) {
  const rol = mappen.find((m) => m.id === b.map_id)?.rol;
  const inPrullenbak = rol === "prullenbak";
  const herinnerd = !!b.herinner_op && new Date(b.herinner_op) <= new Date();
  const qc = useQueryClient();

  /** Beantwoorden en doorsturen hebben de hele mail nodig, niet alleen de regel. */
  async function stelOp(maak: (volledig: Bericht) => Opzet) {
    try {
      const volledig = await qc.fetchQuery({ queryKey: ["bericht", b.id], queryFn: () => fetchBericht(b.id) });
      if (!volledig) return void toast.error("Deze mail is er niet meer.");
      onOpstellen(maak(volledig));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  const labels = b.categorie_ids
    .map((id) => {
      const i = categorieen.findIndex((c) => c.id === id);
      return i >= 0 ? { c: categorieen[i]!, i } : null;
    })
    .filter((x): x is { c: MailCategorie; i: number } => !!x);

  const menu = (
    <>
      <ContextMenuItem onSelect={onOpen}>
        <MailOpen className="size-4" /> Openen
      </ContextMenuItem>
      <ContextMenuItem onSelect={onKies}>
        <CircleCheck className="size-4" /> {gekozen ? "Niet meer selecteren" : "Selecteren"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {b.richting === "in" && (
        <>
          <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void stelOp((v) => antwoordOpzet(v))}>
            <Reply className="size-4" /> Beantwoorden
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!kanSchrijven}
            onSelect={() => void stelOp((v) => allenAntwoordOpzet(v, eigenAdres))}
          >
            <ReplyAll className="size-4" /> Allen beantwoorden
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void stelOp(doorstuurOpzet)}>
        <Forward className="size-4" /> Doorsturen
      </ContextMenuItem>
      <ContextMenuSeparator />
      {b.wacht && (
        <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.afhandelen(b.id)}>
          <CircleCheck className="size-4" /> Afgehandeld
        </ContextMenuItem>
      )}
      <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.gelezen(b.id, !b.gelezen)}>
        {b.gelezen ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
        {b.gelezen ? "Markeren als ongelezen" : "Markeren als gelezen"}
      </ContextMenuItem>
      <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.markeer(b.id, !b.gemarkeerd)}>
        {b.gemarkeerd ? <FlagOff className="size-4" /> : <Flag className="size-4" />}
        {b.gemarkeerd ? "Vlag eraf" : "Vlag erop"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!kanSchrijven}>
          <FolderInput className="mr-2 size-4" /> Verplaatsen naar
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-52 overflow-y-auto">
          {mappen
            .filter((m) => m.id !== b.map_id)
            .map((m) => {
              const Icoon = MAP_ICOON[m.rol];
              return (
                <ContextMenuItem key={m.id} onSelect={() => void acties.verplaats(b.id, b.map_id, m, mappen)}>
                  <Icoon className="size-4" /> {mapNaam(m)}
                </ContextMenuItem>
              );
            })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {b.richting === "in" && rol === "spam" && (
        <ContextMenuItem
          disabled={!kanSchrijven}
          onSelect={() => void acties.geenSpam(b.id, b.map_id, mappen, spamAfzender ? b.van_email : undefined)}
        >
          <ShieldCheck className="size-4" /> Geen spam
        </ContextMenuItem>
      )}
      {b.richting === "in" && rol !== "spam" && (
        <>
          <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.spam(b.id, b.map_id, mappen)}>
            <ShieldAlert className="size-4" /> Spam melden
          </ContextMenuItem>
          <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.altijdSpam(b.id, b.van_email, b.map_id)}>
            <ShieldAlert className="size-4" /> Altijd naar spam: {b.van_email}
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      {inPrullenbak ? (
        <ContextMenuItem disabled={!kanSchrijven} onSelect={() => void acties.terugzetten(b.id)}>
          <Undo2 className="size-4" /> Terugzetten
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          disabled={!kanSchrijven}
          className="text-destructive focus:text-destructive"
          onSelect={() => void acties.weggooien(b.id)}
        >
          <Trash2 className="size-4" /> Weggooien
        </ContextMenuItem>
      )}
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative border-b border-border/60">
          {/* Vinkje om te selecteren: bij de muis, of altijd als er al iets gekozen is. */}
          <div
            className={cn(
              "absolute left-1.5 top-3 z-10 items-center",
              kiesModus || gekozen ? "flex" : "hidden group-hover:flex",
            )}
          >
            <Checkbox checked={gekozen} onCheckedChange={onKies} aria-label="Selecteren" className="bg-card" />
          </div>
          <button
            type="button"
            onClick={kiesModus ? onKies : onOpen}
            className={cn(
              "block w-full py-2.5 pl-7 pr-3.5 text-left transition-colors",
              gekozen ? "bg-tint-blauw/50" : actief ? "bg-accent/70" : "group-hover:bg-muted/40",
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
            {(labels.length > 0 || b.wacht || b.herinner_op) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {herinnerd ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-tint-amber px-1.5 py-px text-[10.5px] font-medium text-tint-amber-ink">
                    <Bell className="size-2.5" /> herinnering
                  </span>
                ) : (
                  b.wacht && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-tint-paars px-1.5 py-px text-[10.5px] font-medium text-tint-paars-ink">
                      <Sparkles className="size-2.5" /> klaar voor jou
                    </span>
                  )
                )}
                {b.herinner_op && !herinnerd && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">
                    <Clock className="size-2.5" /> {toonMoment(b.herinner_op)}
                  </span>
                )}
                {labels.map(({ c, i }) => (
                  <span key={c.id} className={cn("rounded-full px-1.5 py-px text-[10.5px] font-medium", categorieTint(c, i))}>
                    {c.naam}
                  </span>
                ))}
              </div>
            )}
          </button>
          {/* Snelle knoppen als je met de muis op de mail staat, zoals in een
            mailprogramma. Ze liggen over de datum heen, op de achtergrond van de regel. */}
          {kanSchrijven && (
            <div className="absolute right-2 top-1.5 hidden items-center gap-0.5 rounded-full border border-border bg-card p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
              {b.wacht && (
                <SnelKnop label="Afgehandeld" onClick={() => void acties.afhandelen(b.id)}>
                  <CircleCheck className="size-3.5" />
                </SnelKnop>
              )}
              <SnelKnop
                label={b.gelezen ? "Markeren als ongelezen" : "Markeren als gelezen"}
                onClick={() => void acties.gelezen(b.id, !b.gelezen)}
              >
                {b.gelezen ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
              </SnelKnop>
              <SnelKnop label={b.gemarkeerd ? "Vlag eraf" : "Vlag erop"} onClick={() => void acties.markeer(b.id, !b.gemarkeerd)}>
                {b.gemarkeerd ? <FlagOff className="size-3.5" /> : <Flag className="size-3.5" />}
              </SnelKnop>
              {inPrullenbak ? (
                <SnelKnop label="Terugzetten" onClick={() => void acties.terugzetten(b.id)}>
                  <Undo2 className="size-3.5" />
                </SnelKnop>
              ) : (
                <SnelKnop label="Weggooien" gevaarlijk onClick={() => void acties.weggooien(b.id)}>
                  <Trash2 className="size-3.5" />
                </SnelKnop>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

function SnelKnop({
  label,
  gevaarlijk,
  uit,
  onClick,
  children,
}: {
  label: string;
  gevaarlijk?: boolean;
  uit?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={uit}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
        gevaarlijk && "hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

type MailActies = ReturnType<typeof useMailActies>;

/**
 * De acties op een mail die ook vanuit de lijst kunnen. Na afloop alles wat
 * de mail laat zien opnieuw laden; weggooien en afhandelen krijgen Ongedaan maken.
 */
function useMailActies(onWeg: (id: string) => void) {
  const qc = useQueryClient();
  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["berichten"] });
    void qc.invalidateQueries({ queryKey: ["bericht"] });
    void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
    void qc.invalidateQueries({ queryKey: ["mail-wacht"] });
  };
  const fout = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

  async function doe(actie: () => Promise<unknown>): Promise<boolean> {
    try {
      await actie();
      ververs();
      return true;
    } catch (e) {
      fout(e);
      return false;
    }
  }

  const acties = {
    gelezen: (id: string, gelezen: boolean) => doe(() => zetGelezen(id, gelezen)),
    markeer: (id: string, gemarkeerd: boolean) => doe(() => zetGemarkeerd(id, gemarkeerd)),
    async afhandelen(id: string, klaar = true) {
      if (!(await doe(() => handelAf(id, klaar)))) return;
      if (!klaar) return void toast.success("Staat weer open.");
      toast.success("Afgehandeld.", {
        action: { label: "Ongedaan maken", onClick: () => void doe(() => handelAf(id, false)) },
      });
    },
    async weggooien(id: string) {
      let verplaatst = false;
      if (!(await doe(async () => ({ verplaatst } = await gooiWeg(id))))) return;
      onWeg(id);
      // Gaf de server de nieuwe plek nog niet, dan kan terugzetten pas na de
      // volgende ophaalronde. Dan ook geen knop die dat belooft.
      if (!verplaatst) return void toast.success("Naar de prullenbak.");
      toast.success("Naar de prullenbak.", {
        action: { label: "Ongedaan maken", onClick: () => void doe(() => zetTerug(id)) },
      });
    },
    async terugzetten(id: string) {
      if (await doe(() => zetTerug(id))) {
        onWeg(id);
        toast.success("Teruggezet.");
      }
    },
    /** Naar een map; met Ongedaan maken terug naar waar hij stond. */
    /** `van` is de map waar hij nu staat: daarheen gaat Ongedaan maken. */
    async verplaats(id: string, van: string, naar: MailMap, mappen: MailMap[], melding?: string) {
      let verplaatst = false;
      if (!(await doe(async () => ({ verplaatst } = await verplaatsNaar(id, naar.id))))) return;
      onWeg(id);
      const tekst = melding ?? `Verplaatst naar ${mapNaam(naar)}.`;
      const terug = mappen.find((m) => m.id === van);
      if (!verplaatst || !terug) return void toast.success(tekst);
      toast.success(tekst, {
        action: { label: "Ongedaan maken", onClick: () => void doe(() => verplaatsNaar(id, terug.id)) },
      });
    },
    async spam(id: string, van: string, mappen: MailMap[]) {
      const spam = mappen.find((m) => m.rol === "spam");
      if (!spam) return void toast.error("Er is geen spammap in deze mailbox.");
      await acties.verplaats(id, van, spam, mappen, "Als spam gemeld: naar de spammap.");
    },
    /** `regelVan`: deze afzender stond op "altijd naar spam"; die regel gaat ook weg. */
    async geenSpam(id: string, van: string, mappen: MailMap[], regelVan?: string) {
      const postvak = mappen.find((m) => m.rol === "postvak");
      if (!postvak) return void toast.error("Er is geen postvak gevonden.");
      if (regelVan && !(await doe(() => spamregelWeg(regelVan)))) return;
      void qc.invalidateQueries({ queryKey: ["spam-regels"] });
      await acties.verplaats(
        id,
        van,
        postvak,
        mappen,
        regelVan ? `Geen spam: terug in je postvak, en ${regelVan} gaat niet meer vanzelf naar spam.` : "Geen spam: terug in je postvak.",
      );
    },
    /** `van`: waar de mail stond; Ongedaan maken zet hem daar terug én haalt de regel weg. */
    async altijdSpam(id: string, email: string, van: string) {
      if (!(await doe(() => altijdSpam(id)))) return;
      onWeg(id);
      void qc.invalidateQueries({ queryKey: ["spam-regels"] });
      toast.success(`Mail van ${email} gaat voortaan altijd naar spam.`, {
        action: {
          label: "Ongedaan maken",
          onClick: () =>
            void doe(async () => {
              await spamregelWeg(email);
              await verplaatsNaar(id, van);
            }).then(() => void qc.invalidateQueries({ queryKey: ["spam-regels"] })),
        },
      });
    },
    async herinner(id: string, op: Date | null) {
      if (!(await doe(() => herinner(id, op)))) return;
      toast.success(op ? `Herinnering ${toonMoment(op)}: dan staat hij in "Wacht op jou".` : "Herinnering weggehaald.");
    },
  };
  return acties;
}

// --- Lezen ---------------------------------------------------------------------

function Leesvenster({
  berichtId,
  mappen,
  kanSchrijven,
  onTerug,
  onWeg,
  onBeantwoord,
  onOpstellen,
  onOpen,
  eigenAdres,
}: {
  berichtId: string | null;
  mappen: MailMap[];
  kanSchrijven: boolean;
  onTerug: () => void;
  onWeg: (id: string) => void;
  onBeantwoord: (b: Bericht, begin?: string) => void;
  onOpstellen: (o: Opzet) => void;
  /** Een andere mail openen, bijvoorbeeld uit hetzelfde gesprek. */
  onOpen: (id: string) => void;
  /** Het eigen mailadres: dat hoort niet in Cc bij allen beantwoorden. */
  eigenAdres: string;
}) {
  const qc = useQueryClient();
  const lijstActies = useMailActies(onWeg);
  const bericht = useQuery({
    queryKey: ["bericht", berichtId],
    queryFn: () => fetchBericht(berichtId!),
    enabled: !!berichtId,
    // Paaltje leest mail op de achtergrond; zo verschijnt zijn uitkomst vanzelf.
    refetchInterval: (q) => {
      const s = q.state.data?.paaltje_status;
      return s === "wacht" || s === "bezig" ? 30_000 : false;
    },
  });
  const [bezigMet, setBezigMet] = useState<string | null>(null);

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["berichten"] });
    void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
    void qc.invalidateQueries({ queryKey: ["mail-wacht"] });
  };

  /**
   * Gelezen of niet: alleen het bolletje in de lijsten en het telletje bij de
   * map aanpassen. Alle lijsten opnieuw laden, met alle doorgebladerde
   * pagina's, voor één bolletje is zonde.
   */
  function markeerInCache(m: Bericht, gelezen: boolean) {
    qc.setQueryData<Bericht | null>(["bericht", m.id], (oud) => (oud ? { ...oud, gelezen } : oud));
    qc.setQueriesData<InfiniteData<BerichtRegel[]>>({ queryKey: ["berichten"] }, (oud) =>
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

  // De map van de mail zelf, niet van de lijst: in "Wacht op jou" staat een
  // mail die in het postvak zit.
  const inPrullenbak = mappen.find((m) => m.id === b.map_id)?.rol === "prullenbak";
  const acties = (
    <div className="flex flex-wrap items-center gap-1.5">
      {b.richting === "in" && (
        <Button
          size="sm"
          className="rounded-full"
          disabled={!kanSchrijven || bezigMet === b.id}
          onClick={() => onBeantwoord(b)}
        >
          <Reply className="size-3.5" /> Beantwoorden
        </Button>
      )}
      {b.is_klantmail && !b.beantwoord_op && (
        <Button
          size="sm"
          variant={b.afgehandeld_op ? "outline" : "secondary"}
          className="rounded-full"
          disabled={!kanSchrijven || bezigMet === b.id}
          onClick={() => void lijstActies.afhandelen(b.id, !b.afgehandeld_op)}
        >
          {b.afgehandeld_op ? <RotateCcw className="size-3.5" /> : <CircleCheck className="size-3.5" />}
          {b.afgehandeld_op ? "Weer openzetten" : "Afgehandeld"}
        </Button>
      )}
      {b.richting === "in" && allenAntwoordOpzet(b, eigenAdres).cc && (
        <IcoonKnop
          label="Allen beantwoorden"
          disabled={!kanSchrijven}
          onClick={() => onOpstellen(allenAntwoordOpzet(b, eigenAdres))}
        >
          <ReplyAll className="size-3.5" />
        </IcoonKnop>
      )}
      <IcoonKnop label="Doorsturen" disabled={!kanSchrijven} onClick={() => onOpstellen(doorstuurOpzet(b))}>
        <Forward className="size-3.5" />
      </IcoonKnop>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="size-8 rounded-full"
            aria-label="Verplaatsen naar"
            title="Verplaatsen naar"
            disabled={!kanSchrijven}
          >
            <FolderInput className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-52 overflow-y-auto">
          {mappen
            .filter((m) => m.id !== b.map_id)
            .map((m) => {
              const Icoon = MAP_ICOON[m.rol];
              return (
                <DropdownMenuItem key={m.id} onSelect={() => void lijstActies.verplaats(b.id, b.map_id, m, mappen)}>
                  <Icoon className="size-4" /> {mapNaam(m)}
                </DropdownMenuItem>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>
      {b.richting === "in" &&
        (mappen.find((m) => m.id === b.map_id)?.rol === "spam" ? (
          <IcoonKnop label="Geen spam" disabled={!kanSchrijven} onClick={() => void lijstActies.geenSpam(b.id, b.map_id, mappen)}>
            <ShieldCheck className="size-3.5" />
          </IcoonKnop>
        ) : (
          <IcoonKnop label="Spam melden" disabled={!kanSchrijven} onClick={() => void lijstActies.spam(b.id, b.map_id, mappen)}>
            <ShieldAlert className="size-3.5" />
          </IcoonKnop>
        ))}
      <MomentKiezer
        titel="Herinner me"
        onKies={(moment) => void lijstActies.herinner(b.id, moment)}
        extra={
          b.herinner_op ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void lijstActies.herinner(b.id, null)}>
                <BellOff className="size-4" /> Herinnering weghalen
              </DropdownMenuItem>
            </>
          ) : undefined
        }
        trigger={
          <Button
            size="icon"
            variant="outline"
            className={cn("size-8 rounded-full", b.herinner_op && "border-tint-amber-ink/40 text-tint-amber-ink")}
            aria-label={b.herinner_op ? `Herinnering ${toonMoment(b.herinner_op)}` : "Herinner me"}
            title={b.herinner_op ? `Herinnering ${toonMoment(b.herinner_op)}` : "Herinner me"}
            disabled={!kanSchrijven}
          >
            <Bell className="size-3.5" />
          </Button>
        }
      />
      <IcoonKnop
        label={b.gemarkeerd ? "Vlag eraf" : "Vlag erop"}
        disabled={!kanSchrijven}
        onClick={() => void lijstActies.markeer(b.id, !b.gemarkeerd)}
      >
        {b.gemarkeerd ? <FlagOff className="size-3.5 text-tint-rood-ink" /> : <Flag className="size-3.5" />}
      </IcoonKnop>
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
          onClick={() =>
            void doe(b.id, () => zetTerug(b.id), () => {
              toast.success("Teruggezet.");
              onWeg(b.id);
            })
          }
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

  return (
    <Mailweergave
      b={b}
      acties={acties}
      gesprek={<Gesprek berichtId={b.id} onOpen={onOpen} />}
      paaltje={<PaaltjeKaart b={b} kanSchrijven={kanSchrijven} onBeantwoord={(begin) => onBeantwoord(b, begin)} />}
      klant={<KlantKaart b={b} kanSchrijven={kanSchrijven} />}
      onTerug={onTerug}
    />
  );
}

function IcoonKnop({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="size-8 rounded-full"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function Mailweergave({
  b,
  acties,
  gesprek,
  paaltje,
  klant,
  onTerug,
}: {
  b: Bericht;
  acties: React.ReactNode;
  /** De andere mails uit hetzelfde gesprek. */
  gesprek: React.ReactNode;
  paaltje: React.ReactNode;
  /** Rechts naast een binnengekomen mail: wie het is. */
  klant: React.ReactNode;
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
              <BijlageKnop key={`${a.naam}-${i}`} berichtId={b.id} index={i} naam={a.naam} grootte={a.grootte} />
            ))}
          </div>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_250px] xl:grid-rows-1">
        <div className="flex min-h-0 flex-col">
          <div className="max-h-[45%] shrink-0 overflow-y-auto pb-1">
            {gesprek}
            {paaltje}
          </div>
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
            {klant}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Een bijlage: klikken haalt hem van de server en opent hem (of bewaart hem). */
function BijlageKnop({
  berichtId,
  index,
  naam,
  grootte: bytes,
}: {
  berichtId: string;
  index: number;
  naam: string;
  grootte: number;
}) {
  const [bezig, setBezig] = useState(false);
  async function open() {
    setBezig(true);
    // Het venster meteen openen (anders houdt de browser het tegen als pop-up)
    // en pas vullen als de bijlage er is.
    const venster = window.open("", "_blank");
    try {
      const b = await haalBijlage(berichtId, index);
      const url = URL.createObjectURL(b.blob);
      // Alleen typen die geen script kunnen draaien. Een SVG ("image/svg+xml")
      // of html zou in een eigen tabblad als Wooshy zelf meedoen: die downloaden.
      const bekijkbaar = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"].includes(
        b.type.toLowerCase(),
      );
      if (bekijkbaar && venster) {
        venster.location.href = url;
      } else {
        venster?.close();
        const a = document.createElement("a");
        a.href = url;
        a.download = b.naam;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      venster?.close();
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={bezig}
      title="Openen"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[12px] hover:border-ring disabled:opacity-60"
    >
      {bezig ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3 text-muted-foreground" />}
      <span className="max-w-[180px] truncate">{naam}</span>
      <span className="text-muted-foreground">{grootte(bytes)}</span>
    </button>
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
export function MailHtml({ html, className }: { html: string; className?: string }) {
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
      className={cn("min-h-0 w-full flex-1 bg-white", className)}
    />
  );
}
