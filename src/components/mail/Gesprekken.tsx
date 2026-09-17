/**
 * Gesprekken: één regel per klant, zoals de chatlijst van WhatsApp. Mail en
 * WhatsApp door elkaar, het nieuwste gesprek bovenaan, met wat er nog
 * ongelezen is. Tik je op een klant, dan opent zijn Berichten-pagina.
 *
 * Appjes van een nummer dat nog bij geen klant hoort staan er ook in: die
 * open je als losse chat. Mail zonder klant staat alleen in het postvak.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  IconBrandWhatsapp as WhatsApp,
  IconHelp as Onbekend,
  IconMail as Mail,
  IconSearch as Search,
} from "@tabler/icons-react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatVenster } from "@/components/whatsapp/Chat";
import { fetchMailGesprekken, lijstDatum } from "@/lib/berichten";
import { fetchCustomers, fetchKlanten, fetchStreets, formatNumber } from "@/lib/klanten";
import { fetchGesprekken, toonNummer } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type Filter = "alles" | "mail" | "whatsapp";

interface Regel {
  sleutel: string;
  /** Leeg bij een WhatsApp-nummer dat nog bij geen klant hoort. */
  klantId: string | null;
  telefoon: string | null;
  titel: string;
  onder: string;
  nummer: string;
  kanaal: "mail" | "whatsapp";
  vanMij: boolean;
  op: string;
  ongelezen: number;
}

export function Gesprekken() {
  const [filter, setFilter] = useState<Filter>("alles");
  const [alleenOngelezen, setAlleenOngelezen] = useState(false);
  const [zoek, setZoek] = useState("");
  const [losNummer, setLosNummer] = useState<string | null>(null);

  const mail = useQuery({
    queryKey: ["mail-gesprekken"],
    queryFn: fetchMailGesprekken,
    refetchInterval: 60_000,
  });
  const wa = useQuery({
    queryKey: ["wa-gesprekken"],
    queryFn: fetchGesprekken,
    refetchInterval: 15_000,
  });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });
  const customers = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const streets = useQuery({ queryKey: ["streets"], queryFn: fetchStreets });

  /** Per klant zijn naam en het adres zoals het op de wijklijst staat. */
  const wie = useMemo(() => {
    const straat = new Map((streets.data ?? []).map((s) => [s.id, s]));
    const adres = new Map<string, { adres: string; nummer: string }>();
    for (const c of customers.data ?? []) {
      if (!c.klant_id || adres.has(c.klant_id)) continue;
      const s = straat.get(c.street_id);
      adres.set(c.klant_id, {
        adres: `${s?.volledige_naam.trim() || s?.name || ""} ${formatNumber(c)}`.trim(),
        nummer: formatNumber(c),
      });
    }
    const naam = new Map((klanten.data ?? []).map((k) => [k.id, k.naam.trim()]));
    return (klantId: string, reserve: string) => {
      const a = adres.get(klantId);
      const n = naam.get(klantId) || reserve;
      return {
        titel: a?.adres || n || "Onbekende klant",
        naam: a ? n : "",
        nummer: a?.nummer ?? "",
      };
    };
  }, [customers.data, streets.data, klanten.data]);

  const regels = useMemo(() => {
    const perKlant = new Map<string, Regel>();
    const los: Regel[] = [];

    if (filter !== "whatsapp") {
      // De lijst staat nieuwste eerst: de eerste mail per klant is de laatste.
      for (const m of mail.data ?? []) {
        const ongelezen = m.richting === "in" && !m.gelezen ? 1 : 0;
        const bestaand = perKlant.get(m.klant_id);
        if (bestaand) {
          bestaand.ongelezen += ongelezen;
          continue;
        }
        const w = wie(m.klant_id, m.van_naam);
        perKlant.set(m.klant_id, {
          sleutel: m.klant_id,
          klantId: m.klant_id,
          telefoon: null,
          titel: w.titel,
          onder: m.onderwerp || m.fragment,
          nummer: w.nummer,
          kanaal: "mail",
          vanMij: m.richting === "uit",
          op: m.ontvangen_op,
          ongelezen,
        });
      }
    }

    if (filter !== "mail") {
      for (const g of wa.data ?? []) {
        const nieuw: Omit<Regel, "sleutel" | "klantId" | "titel" | "nummer"> = {
          telefoon: g.wa_telefoon,
          onder: g.fragment,
          kanaal: "whatsapp",
          vanMij: g.richting === "uit",
          op: g.laatste_op,
          ongelezen: g.ongelezen,
        };
        if (!g.klant_id) {
          los.push({
            ...nieuw,
            sleutel: `tel:${g.wa_telefoon}`,
            klantId: null,
            titel: g.naam || toonNummer(g.wa_telefoon),
            nummer: "",
          });
          continue;
        }
        const bestaand = perKlant.get(g.klant_id);
        if (bestaand) {
          const samen = bestaand.ongelezen + g.ongelezen;
          // Het nieuwste van de twee bepaalt wat er in de regel staat.
          if (g.laatste_op > bestaand.op) Object.assign(bestaand, nieuw);
          bestaand.ongelezen = samen;
          continue;
        }
        const w = wie(g.klant_id, g.naam);
        perKlant.set(g.klant_id, {
          ...nieuw,
          sleutel: g.klant_id,
          klantId: g.klant_id,
          titel: w.titel,
          nummer: w.nummer,
        });
      }
    }

    const termen = zoek.trim().toLowerCase();
    return [...perKlant.values(), ...los]
      .filter((r) => !alleenOngelezen || r.ongelezen > 0)
      .filter((r) => !termen || `${r.titel} ${r.onder}`.toLowerCase().includes(termen))
      .sort((a, b) => b.op.localeCompare(a.op));
  }, [mail.data, wa.data, wie, filter, alleenOngelezen, zoek]);

  const laden = mail.isLoading || wa.isLoading;
  const fout = mail.isError && wa.isError;

  return (
    <div>
      <label className="mb-2 flex items-center gap-2 rounded-full bg-card px-3.5 py-2 shadow-card">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek klant of adres"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {(["alles", "mail", "whatsapp"] as Filter[]).map((f) => (
          <Chip key={f} aan={filter === f} onClick={() => setFilter(f)}>
            {f === "alles" ? (
              "Alles"
            ) : f === "mail" ? (
              <>
                <Mail className={cn("size-3.5", filter !== "mail" && "text-tint-blauw-mid")} /> Mail
              </>
            ) : (
              <>
                <WhatsApp
                  className={cn("size-3.5", filter !== "whatsapp" && "text-tint-groen-mid")}
                />{" "}
                WhatsApp
              </>
            )}
          </Chip>
        ))}
        <Chip aan={alleenOngelezen} onClick={() => setAlleenOngelezen((a) => !a)}>
          Ongelezen
        </Chip>
      </div>

      {!laden && !fout && (mail.isError || wa.isError) && (
        <p className="mb-2 rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
          {mail.isError ? "De mail" : "WhatsApp"} kon niet geladen worden; de lijst is niet
          compleet.
        </p>
      )}
      {laden ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Gesprekken ophalen…</p>
      ) : fout ? (
        <p className="py-8 text-center text-sm text-tint-rood-ink">
          De gesprekken konden niet geladen worden.
        </p>
      ) : regels.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {zoek || alleenOngelezen ? "Niets gevonden." : "Nog geen gesprekken met klanten."}
        </p>
      ) : (
        <div>
          {regels.map((r) => {
            const inhoud = (
              <>
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
                    r.klantId
                      ? "bg-tint-blauw text-tint-blauw-ink"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.klantId ? (
                    r.nummer || r.titel.charAt(0).toUpperCase()
                  ) : (
                    <Onbekend className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "flex-1 truncate text-[15px]",
                        r.ongelezen > 0 && "font-semibold",
                      )}
                    >
                      {r.titel}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[12px]",
                        r.ongelezen > 0
                          ? "font-medium text-tint-groen-mid"
                          : "text-muted-foreground",
                      )}
                    >
                      {lijstDatum(r.op)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {/* Altijd het kanaal, in zijn eigen kleur: zo zie je meteen of
                        het een mail of een appje was, ook als jij het stuurde. */}
                    {r.kanaal === "mail" ? (
                      <Mail className="size-3.5 shrink-0 text-tint-blauw-mid" />
                    ) : (
                      <WhatsApp className="size-3.5 shrink-0 text-tint-groen-mid" />
                    )}
                    <span
                      className={cn(
                        "flex-1 truncate text-[13px]",
                        r.ongelezen > 0 ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {r.vanMij ? `Jij: ${r.onder}` : r.onder}
                      {!r.klantId && " · nog geen klant"}
                    </span>
                    {r.ongelezen > 0 && (
                      <span className="min-w-5 shrink-0 rounded-full bg-tint-groen-mid px-1.5 text-center text-[11px] font-semibold leading-5 text-card tabular-nums">
                        {r.ongelezen}
                      </span>
                    )}
                  </span>
                </span>
              </>
            );
            const klassen =
              "flex w-full items-center gap-3 rounded-[14px] px-1 py-2 text-left hover:bg-card";
            return r.klantId ? (
              <Link
                key={r.sleutel}
                to="/berichten"
                search={{ klant: r.klantId, ...(filter !== "alles" ? { filter } : {}) }}
                className={klassen}
              >
                {inhoud}
              </Link>
            ) : (
              <button
                key={r.sleutel}
                type="button"
                onClick={() => setLosNummer(r.telefoon)}
                className={klassen}
              >
                {inhoud}
              </button>
            );
          })}
        </div>
      )}

      {/* Een nummer zonder klant: gewoon de chat, over het hele scherm. */}
      <Sheet open={losNummer !== null} onOpenChange={(open) => !open && setLosNummer(null)}>
        <SheetContent side="bottom" className="flex h-[88dvh] flex-col gap-0 rounded-t-[22px] p-0">
          <SheetTitle className="border-b border-border px-4 py-3 font-display text-[16px]">
            {losNummer ? toonNummer(losNummer) : ""}
          </SheetTitle>
          {losNummer && <ChatVenster telefoon={losNummer} className="min-h-0 flex-1" />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Chip({
  aan,
  onClick,
  children,
}: {
  aan: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aan}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[13px]",
        aan ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
