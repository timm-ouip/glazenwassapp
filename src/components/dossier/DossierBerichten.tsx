/**
 * Tabblad "Mail en klachten" van het klantdossier.
 *
 * Links één tijdlijn, "Alles met deze klant": mail, appjes en klachten door
 * elkaar, nieuwste bovenaan, met filters. Rechts wat je koos: de mail met het
 * voorstel van Paaltje, het WhatsApp-gesprek, of de klacht met de
 * afhandeling. Op de telefoon eerst de lijst; een tik opent het item, met
 * een terugknop.
 *
 * Wat je opent gaat op gelezen, net als op de pagina Berichten. Wat
 * ongelezen was blijft deze keer vet, zodat je ziet wat er nieuw was.
 */
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronLeft as ChevronLeft } from "@tabler/icons-react";

import { KlachtDetail, KlachtNoteren } from "@/components/dossier/DossierKlachten";
import { DossierKop, kopKnop, kopKnopPrimair } from "@/components/dossier/DossierKop";
import { KolomKop } from "@/components/dossier/DossierVelden";
import { fetchDossierMails, lijstDatum, type DossierMail } from "@/lib/berichten";
import { BRON_LABEL, fetchKlachtenVanKlant, type Klacht } from "@/lib/klachten";
import { fetchMailbox } from "@/lib/mailbox";
import { zetGelezen } from "@/lib/mailacties";
import type { Dossier } from "@/lib/useDossier";
import { cn } from "@/lib/utils";
import {
  fetchGesprekken,
  fetchKlantNummers,
  fetchWaBerichten,
  markeerGesprekGelezen,
  type WaBericht,
} from "@/lib/whatsapp";

// Pas laden als er een mail of appje open staat: dit trekt het hele
// mailprogramma mee, en het dossier zit op de wijkenpagina, die daardoor
// trager opende.
const MailDetail = lazy(() =>
  import("@/components/dossier/DossierMail").then((m) => ({ default: m.MailDetail })),
);
const WhatsAppDetail = lazy(() =>
  import("@/components/dossier/DossierWhatsApp").then((m) => ({ default: m.WhatsAppDetail })),
);

/** Kon het mailgedeelte niet laden (slecht bereik, of er ging intussen een
 *  nieuwe versie live), dan alleen hier een melding — niet de hele pagina kwijt. */
class MailLaadFout extends Component<{ children: ReactNode }, { fout: boolean }> {
  override state = { fout: false };
  static getDerivedStateFromError() {
    return { fout: true };
  }
  override render() {
    if (!this.state.fout) return this.props.children;
    return (
      <p className="rounded-[18px] bg-card p-[18px] text-[13px] text-muted-foreground">
        Mail kon niet laden.{" "}
        <button type="button" className="underline" onClick={() => window.location.reload()}>
          Herlaad de pagina
        </button>
      </p>
    );
  }
}

type Item =
  | { soort: "mail"; id: string; op: string; mail: DossierMail }
  | {
      soort: "app";
      id: string;
      op: string;
      nummer: string;
      /** De appjes van één dag op één nummer, oudste eerst. */
      appjes: WaBericht[];
      ongelezen: boolean;
    }
  | { soort: "klacht"; id: string; op: string; klacht: Klacht };

type Filter = "alles" | "mail" | "app" | "klachten";

const FILTER_NAAM: Record<Filter, string> = {
  alles: "Alles",
  mail: "Mail",
  app: "App",
  klachten: "Klachten",
};

const SOORT: Record<Exclude<Filter, "alles">, Item["soort"]> = {
  mail: "mail",
  app: "app",
  klachten: "klacht",
};

/** "Jan" uit "Jan de Vries"; "Fam. de Vries" blijft heel. */
function roepnaam(naam: string): string {
  const eerste = naam.trim().split(/\s+/)[0] ?? "";
  return eerste.length > 1 && !eerste.endsWith(".") ? eerste : naam.trim();
}

const citaat = (tekst: string) => (tekst.trim() ? ` · "${tekst.trim()}"` : "");

export function DossierBerichten({ d }: { d: Dossier }) {
  const klant = d.klant;
  const klantId = klant?.id ?? null;
  const qc = useQueryClient();
  const magMail = d.magMailLezen && !!klantId;
  const magKlachten = d.magKlachten && !!klantId;

  // --- De drie bronnen ---------------------------------------------------------
  const mails = useQuery({
    queryKey: ["dossier-mail", klantId],
    queryFn: () => fetchDossierMails(klantId!),
    enabled: magMail,
    // Leest Paaltje de laatste mail nog, dan verschijnt zijn voorstel vanzelf.
    refetchInterval: (q) => {
      const s = q.state.data?.find((m) => m.richting === "in" && m.op_server)?.paaltje_status;
      return s === "wacht" || s === "bezig" ? 30_000 : false;
    },
  });
  const nummers = useQuery({
    queryKey: ["dossier-whatsapp", klantId],
    queryFn: () => fetchKlantNummers(klantId!),
    enabled: magMail,
  });
  // Dezelfde sleutel als het gesprek rechts, dus die delen hun cache.
  const waPerNummer = useQueries({
    queries: (nummers.data ?? []).map((n) => ({
      queryKey: ["wa-berichten", n],
      queryFn: () => fetchWaBerichten(n),
    })),
  });
  const waGesprekken = useQuery({
    queryKey: ["wa-gesprekken"],
    queryFn: fetchGesprekken,
    enabled: magMail && (nummers.data?.length ?? 0) > 0,
  });
  const klachten = useQuery({
    queryKey: ["klachten", klantId],
    queryFn: () => fetchKlachtenVanKlant(klantId!),
    enabled: magKlachten,
  });
  const waVersie = waPerNummer.map((q) => q.dataUpdatedAt).join(",");

  const items = useMemo(() => {
    const lijst: Item[] = (mails.data ?? []).map((m) => ({
      soort: "mail",
      id: `m:${m.id}`,
      op: m.ontvangen_op,
      mail: m,
    }));
    // Appjes per dag en per nummer samen: anders verdringt één middag appen
    // alle mail uit beeld.
    (nummers.data ?? []).forEach((n, i) => {
      const perDag = new Map<string, WaBericht[]>();
      for (const w of waPerNummer[i]?.data ?? []) {
        // Op een gedeeld nummer (een stel) kan ook de ander appen; dat hoort
        // in zijn eigen dossier.
        if (w.klant_id && w.klant_id !== klantId) continue;
        const dag = new Date(w.ontvangen_op).toLocaleDateString("sv-SE");
        perDag.set(dag, [...(perDag.get(dag) ?? []), w]);
      }
      const ongelezen = (waGesprekken.data?.find((g) => g.wa_telefoon === n)?.ongelezen ?? 0) > 0;
      const dagen = [...perDag.entries()];
      dagen.forEach(([dag, appjes], j) => {
        lijst.push({
          soort: "app",
          id: `w:${n}:${dag}`,
          op: appjes[appjes.length - 1]!.ontvangen_op,
          nummer: n,
          appjes,
          // Wat ongelezen is, zit in de laatste dag dat de klant appte.
          ongelezen: ongelezen && j === dagen.length - 1 && appjes.some((a) => a.richting === "in"),
        });
      });
    });
    for (const k of klachten.data ?? []) {
      lijst.push({ soort: "klacht", id: `k:${k.id}`, op: k.ontvangen_op, klacht: k });
    }
    return lijst.sort((a, b) => b.op.localeCompare(a.op));
    // waPerNummer is elke render een nieuwe lijst; het moment waarop elk
    // nummer opnieuw binnenkwam zegt of er iets veranderde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mails.data, nummers.data, waVersie, waGesprekken.data, klachten.data, klantId]);

  // --- Kiezen --------------------------------------------------------------------
  const [filter, setFilter] = useState<Filter>("alles");
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [noteren, setNoteren] = useState(false);
  const zichtbaar = filter === "alles" ? items : items.filter((i) => i.soort === SOORT[filter]);
  // Op de computer staat er altijd iets open: wat je koos, anders het nieuwste.
  // Op de telefoon pas na een tik.
  const actief = noteren ? null : (zichtbaar.find((i) => i.id === gekozen) ?? null);
  // Wat je koos maar er niet meer is (uit het dossier gehaald, weggegooid).
  const weg = !noteren && gekozen !== null && !actief && !items.some((i) => i.id === gekozen);
  const bovenste = zichtbaar[0]?.id ?? null;
  // Pas vastleggen als alles binnen is: anders staat een klacht vast terwijl
  // er nog een nieuwere mail of een nieuwer appje onderweg was.
  const allesBinnen =
    !mails.isLoading &&
    !nummers.isLoading &&
    !klachten.isLoading &&
    !waPerNummer.some((q) => q.isLoading);
  useEffect(() => {
    // Het nieuwste vastleggen als keuze: komt er bij het verversen iets
    // nieuws bij, dan blijft open staan wat je las (of aan het beantwoorden was).
    if (!d.mobiel && !noteren && gekozen === null && bovenste && allesBinnen) setGekozen(bovenste);
  }, [d.mobiel, noteren, gekozen, bovenste, allesBinnen]);

  function kies(id: string) {
    setNoteren(false);
    setGekozen(id);
  }

  // Openen is lezen, net als op de pagina Berichten. Eén keer per item; wat
  // ongelezen was, blijft deze keer vet.
  const [nieuw, setNieuw] = useState<Set<string>>(() => new Set());
  const alGelezen = useRef(new Set<string>());
  const mailbox = useQuery({ queryKey: ["mailbox"], queryFn: fetchMailbox, enabled: magMail });
  const mailboxActief = mailbox.data?.status === "actief";
  // Ook opnieuw kijken als de stand later binnenkomt (de appjes zijn er vaak
  // eerder dan de telling van wat ongelezen is).
  const nogOngelezen =
    actief?.soort === "mail"
      ? actief.mail.richting === "in" &&
        !actief.mail.gelezen &&
        actief.mail.op_server &&
        mailboxActief
      : actief?.soort === "app" && actief.ongelezen;
  useEffect(() => {
    if (!actief || alGelezen.current.has(actief.id)) return;
    if (actief.soort === "mail") {
      const m = actief.mail;
      // Alleen wat nog in de mailbox staat: de rest kan de server niet meer
      // op gelezen zetten (net als op de pagina Berichten).
      if (m.richting !== "in" || m.gelezen || !m.op_server || !mailboxActief) return;
      alGelezen.current.add(actief.id);
      setNieuw((oud) => new Set(oud).add(actief.id));
      void zetGelezen(m.id, true)
        .then(() => {
          qc.setQueryData<DossierMail[]>(["dossier-mail", klantId], (oud) =>
            oud?.map((x) => (x.id === m.id ? { ...x, gelezen: true } : x)),
          );
          void qc.invalidateQueries({ queryKey: ["dossier-ongelezen", klantId] });
          void qc.invalidateQueries({ queryKey: ["mail-gesprekken"] });
          void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
          void qc.invalidateQueries({ queryKey: ["berichten"] });
        })
        // Stil, net als in het postvak: de volgende ophaalronde trekt het recht.
        .catch(() => undefined);
    } else if (actief.soort === "app" && actief.ongelezen) {
      alGelezen.current.add(actief.id);
      setNieuw((oud) => new Set(oud).add(actief.id));
      void markeerGesprekGelezen(actief.nummer)
        .then(() => {
          void qc.invalidateQueries({ queryKey: ["wa-gesprekken"] });
          void qc.invalidateQueries({ queryKey: ["dossier-ongelezen", klantId] });
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief?.id, nogOngelezen]);

  const adressen = klant
    ? d.customers
        .filter((c) => c.klant_id === klant.id)
        .map((c) => ({ id: c.id, label: d.adresTekst(c) }))
    : [];

  const filters: Filter[] = [
    "alles",
    ...(magMail ? (["mail", "app"] as const) : []),
    ...(magKlachten ? (["klachten"] as const) : []),
  ];
  const laden =
    (magMail && (mails.isLoading || nummers.isLoading)) || (magKlachten && klachten.isLoading);
  const fout =
    mails.isError || nummers.isError || klachten.isError || waPerNummer.some((q) => q.isError);

  // --- Tekenen -------------------------------------------------------------------
  const acties = klant ? (
    <>
      {d.magBewerken && magKlachten && (
        <button
          type="button"
          onClick={() => {
            setGekozen(null);
            setNoteren(true);
          }}
          className={kopKnop}
        >
          Klacht noteren
        </button>
      )}
      {d.magMailLezen && (
        <button
          type="button"
          disabled={!d.kanMailen}
          title={
            d.kanMailen
              ? `Mail aan ${d.email}`
              : !d.email
                ? "Geen e-mailadres bekend"
                : "Mailen kan alleen met een gekoppelde mailbox en het recht om te versturen"
          }
          onClick={() => d.setDialoog("mail")}
          className={kopKnopPrimair}
        >
          Nieuwe mail
        </button>
      )}
    </>
  ) : undefined;

  const lijstKaart = (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-[18px] bg-card px-5 py-[18px]",
        !d.mobiel && "min-h-0 overflow-hidden",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className={cn("flex-grow", d.mobiel && "basis-full")}>
          <KolomKop>Alles met deze klant</KolomKop>
        </div>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              // Op de computer opent dan het nieuwste van dat filter.
              setGekozen(null);
            }}
            aria-pressed={filter === f}
            className={cn(
              "rounded-full px-3 py-[5px] text-[13px] transition-colors",
              filter === f
                ? "bg-foreground text-background"
                : "border border-border hover:bg-accent",
            )}
          >
            {FILTER_NAAM[f]}
          </button>
        ))}
      </div>
      <div
        className={cn("flex flex-col gap-2.5", !d.mobiel && "-mx-1 min-h-0 overflow-y-auto px-1")}
      >
        {laden ? (
          <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Even ophalen…</p>
        ) : zichtbaar.length === 0 ? (
          <p className="px-3.5 py-3 text-[13px] text-muted-foreground">
            {filter === "alles"
              ? "Nog niets met deze klant. Mail, appjes en klachten komen hier vanzelf bij."
              : filter === "mail"
                ? "Nog geen mail met deze klant."
                : filter === "app"
                  ? "Nog geen appjes met deze klant."
                  : "Geen klachten. Klaagt deze klant per mail, dan zet Paaltje het hier neer."}
          </p>
        ) : (
          zichtbaar.map((i) => (
            <Regel
              key={i.id}
              item={i}
              klantNaam={klant?.naam ?? ""}
              vet={
                i.soort === "mail"
                  ? i.mail.richting === "in" &&
                    ((!i.mail.gelezen && i.mail.op_server) || nieuw.has(i.id))
                  : i.soort === "app"
                    ? i.ongelezen || nieuw.has(i.id)
                    : // Een klacht staat altijd vet, ook afgehandeld (zoals in het ontwerp);
                      // "staat open" of "afgehandeld" staat eronder.
                      true
              }
              gekozen={actief?.id === i.id}
              onKies={() => kies(i.id)}
            />
          ))
        )}
        {fout && (
          <p className="px-3.5 text-[13px] text-tint-rood-ink">
            Niet alles kon geladen worden. Probeer het straks nog eens.
          </p>
        )}
      </div>
    </div>
  );

  const rechts = !klant ? null : weg ? (
    <div className="rounded-[18px] bg-card p-[18px] text-[13px] text-muted-foreground">
      {gekozen?.startsWith("m:")
        ? "Deze mail staat niet meer in het dossier."
        : "Dit staat niet meer in het dossier."}
    </div>
  ) : noteren ? (
    <KlachtNoteren klantId={klant.id} adressen={adressen} onKlaar={() => setNoteren(false)} />
  ) : actief?.soort === "klacht" ? (
    <KlachtDetail
      klantId={klant.id}
      k={actief.klacht}
      adressen={adressen}
      onToonMail={
        magMail
          ? (id) => {
              if (filter !== "alles" && filter !== "mail") setFilter("alles");
              kies(`m:${id}`);
            }
          : undefined
      }
    />
  ) : actief?.soort === "mail" ? (
    <MailLaadFout>
      <Suspense fallback={<Laden />}>
        <MailDetail
          key={actief.mail.id}
          id={actief.mail.id}
          klantId={klant.id}
          nietInMailbox={!actief.mail.op_server}
          onWeg={() => setGekozen(null)}
        />
      </Suspense>
    </MailLaadFout>
  ) : actief?.soort === "app" || (filter === "app" && magMail && !laden) ? (
    // Ook zonder appjes: dan kan er een eerste bericht.
    <MailLaadFout>
      <Suspense fallback={<Laden />}>
        <WhatsAppDetail
          key={actief?.soort === "app" ? actief.nummer : "leeg"}
          klant={klant}
          nummer={actief?.soort === "app" ? actief.nummer : null}
        />
      </Suspense>
    </MailLaadFout>
  ) : laden ? null : (
    <div className="rounded-[18px] bg-card p-[18px] text-[13px] text-muted-foreground">
      {zichtbaar.length === 0
        ? "Hier komt alles met deze klant: mail, appjes en klachten."
        : "Kies links een mail, appje of klacht."}
    </div>
  );

  return (
    <>
      <DossierKop d={d} titel="Mail en klachten" acties={acties} />
      {!klant ? (
        <div className={cn("min-h-0 flex-1", d.mobiel ? "px-4 py-4" : "px-[26px] py-[22px]")}>
          <p className="text-[14px] text-muted-foreground">
            Er hoort nog geen klant bij dit adres. Vul bij Overzicht een naam, telefoon of e-mail
            in; dan komen mail en klachten hier.
          </p>
        </div>
      ) : d.mobiel ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-3.5 px-4 py-4">
            {noteren || actief || weg ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setGekozen(null);
                    setNoteren(false);
                  }}
                  className="inline-flex h-10 items-center gap-1 self-start rounded-full pr-3 text-[14px] text-foreground active:bg-muted"
                >
                  <ChevronLeft className="size-5" /> Terug naar de lijst
                </button>
                {rechts}
              </>
            ) : (
              lijstKaart
            )}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-[18px] px-[26px] py-[22px] lg:grid-cols-[minmax(0,1fr)_400px]">
          {lijstKaart}
          <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto overscroll-contain">
            {rechts}
          </div>
        </div>
      )}
    </>
  );
}

function Laden() {
  return (
    <p className="rounded-[18px] bg-card p-[18px] text-[13px] text-muted-foreground">
      Even ophalen…
    </p>
  );
}

/** Eén regel in de tijdlijn: een stip in de kleur van de soort, titel, regel eronder, datum. */
function Regel({
  item: i,
  klantNaam,
  vet,
  gekozen,
  onKies,
}: {
  item: Item;
  klantNaam: string;
  vet: boolean;
  gekozen: boolean;
  onKies: () => void;
}) {
  const { stip, titel, onder } =
    i.soort === "mail"
      ? i.mail.richting === "uit"
        ? {
            stip: "bg-muted-foreground/40",
            titel: i.mail.onderwerp || "(geen onderwerp)",
            onder: `Jij${citaat(i.mail.fragment)}`,
          }
        : {
            stip: "bg-tint-blauw-mid",
            titel: i.mail.onderwerp || "(geen onderwerp)",
            onder: `Mail van ${roepnaam(i.mail.van_naam) || i.mail.van_email}${citaat(i.mail.fragment)}`,
          }
      : i.soort === "app"
        ? (() => {
            const laatste = i.appjes[i.appjes.length - 1]!;
            const wie =
              laatste.richting === "uit"
                ? "Jij"
                : roepnaam(laatste.van_naam) || roepnaam(klantNaam) || "Klant";
            return {
              stip: "bg-tint-groen-mid",
              titel: i.appjes.length === 1 ? "Appje" : `${i.appjes.length} appjes`,
              onder: `${wie}${citaat(laatste.tekst)}`,
            };
          })()
        : {
            stip: "bg-tint-rood-mid",
            titel: `Klacht: ${i.klacht.omschrijving}`,
            onder: [
              i.klacht.status === "open" ? "staat open" : "afgehandeld",
              BRON_LABEL[i.klacht.bron].toLowerCase(),
              i.klacht.door_paaltje ? "door Paaltje" : "",
            ]
              .filter(Boolean)
              .join(" · "),
          };

  return (
    <button
      type="button"
      onClick={onKies}
      aria-current={gekozen || undefined}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-[14px] px-3.5 py-3 text-left transition-colors",
        gekozen
          ? "bg-primary/[0.07] shadow-[inset_0_0_0_2px_var(--primary)]"
          : "hover:bg-accent/60",
      )}
    >
      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", stip)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", vet && "font-semibold")}>{titel}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{onder}</span>
      </span>
      <span className="shrink-0 text-[13px] text-muted-foreground">{lijstDatum(i.op)}</span>
    </button>
  );
}
