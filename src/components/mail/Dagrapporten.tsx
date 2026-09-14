/**
 * De dagrapporten teruglezen: wat Wooshy elke ochtend mailde.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, Hand, Inbox, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toonMaand } from "@/lib/klanten";

interface RapportInhoud {
  vanaf: string;
  tot: string;
  binnen: {
    totaal: number;
    klantmail: number;
    overige: number;
    nogNietGelezen?: number;
    perCategorie: { naam: string; aantal: number }[];
  };
  zelfGedaan: { soort: string; klant: string; adres: string; maanden: string[]; tijd: string }[];
  verstuurd: number;
  wacht: { aantal: number; voorbeelden: { van: string; onderwerp: string; samenvatting: string }[] };
  problemen: string[];
  opmerkingen?: string[];
}

interface Rapport {
  id: string;
  datum: string;
  inhoud: RapportInhoud;
  gemaild_op: string | null;
  mail_fout: string;
}

async function fetchRapporten(): Promise<Rapport[]> {
  const { data, error } = await supabase
    .from("dagrapporten")
    .select("id,datum,inhoud,gemaild_op,mail_fout")
    .order("datum", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as Rapport[];
}

function langeDatum(datum: string): string {
  return new Date(`${datum}T12:00:00`).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function Dagrapporten() {
  const rapporten = useQuery({ queryKey: ["dagrapporten"], queryFn: fetchRapporten });

  if (rapporten.isLoading) return <p className="text-[13px] text-muted-foreground">Even kijken…</p>;
  if (rapporten.isError) {
    return <p className="text-[13px] text-tint-rood-ink">De dagrapporten konden niet geladen worden.</p>;
  }
  if (!rapporten.data?.length) {
    return (
      <section className="max-w-xl rounded-[18px] border border-border bg-card p-5 shadow-card">
        <p className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <CalendarDays className="size-4 text-muted-foreground" /> Nog geen dagrapport
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Elke ochtend om half zeven stuurt Paaltje je een overzicht van wat er sinds gisteren gebeurde, en het
          komt hier te staan. Gebeurde er niets, dan komt er geen rapport.
        </p>
      </section>
    );
  }

  return (
    <div className="grid max-w-5xl gap-3">
      {rapporten.data.map((r) => (
        <RapportKaart key={r.id} r={r} />
      ))}
    </div>
  );
}

function RapportKaart({ r }: { r: Rapport }) {
  const i = r.inhoud;
  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-[16px] font-semibold capitalize">{langeDatum(r.datum)}</h2>
        <span className="text-[12px] text-muted-foreground">
          {r.gemaild_op ? "gemaild" : r.mail_fout ? `niet gemaild: ${r.mail_fout}` : "niet gemaild"}
        </span>
      </div>

      {i.problemen.length > 0 && (
        <div className="mt-3 rounded-[12px] bg-tint-amber px-3 py-2 text-[13px] text-tint-amber-ink">
          {i.problemen.map((p) => (
            <p key={p} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Tegel icoon={<Inbox className="size-4" />} tint="bg-tint-blauw text-tint-blauw-ink" getal={i.binnen.totaal} label="binnengekomen">
          {i.binnen.klantmail} van klanten · {i.binnen.overige} overige post
          {i.binnen.nogNietGelezen ? ` · ${i.binnen.nogNietGelezen} nog niet gelezen` : ""}
        </Tegel>
        <Tegel icoon={<Sparkles className="size-4" />} tint="bg-tint-paars text-tint-paars-ink" getal={i.zelfGedaan.length} label="zelf gedaan door Paaltje">
          {i.verstuurd} beantwoord
        </Tegel>
        <Tegel icoon={<Hand className="size-4" />} tint="bg-tint-amber text-tint-amber-ink" getal={i.wacht.aantal} label="wachtte op jou">
          stand van die ochtend
        </Tegel>
      </div>

      {i.binnen.perCategorie.length > 0 && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {i.binnen.perCategorie.map((c) => `${c.naam} ${c.aantal}`).join(" · ")}
        </p>
      )}

      {i.zelfGedaan.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {i.zelfGedaan.map((w, n) => (
            <li key={`${w.tijd}-${n}`} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-tint-groen-ink" />
              <span>
                {[w.klant, w.adres].filter(Boolean).join(", ")}:{" "}
                {w.soort === "overslaan"
                  ? `${w.maanden.map((m) => toonMaand(m)).join(", ")} op overslaan gezet`
                  : w.soort === "aanmelding"
                    ? "aanmelding klaargezet"
                    : w.soort === "stoppen"
                      ? "gestopt als klant"
                      : w.soort === "klant_email"
                        ? "mailadres aan de klant gekoppeld"
                        : w.soort}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(i.opmerkingen ?? []).length > 0 && (
        <div className="mt-3 space-y-0.5 text-[12px] text-muted-foreground">
          {(i.opmerkingen ?? []).map((o) => (
            <p key={o}>{o}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function Tegel({
  icoon,
  tint,
  getal,
  label,
  children,
}: {
  icoon: React.ReactNode;
  tint: string;
  getal: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[14px] p-3 ${tint}`}>
      <p className="flex items-center gap-2 text-[12.5px]">
        {icoon} {label}
      </p>
      <p className="mt-1 font-display text-[24px] font-bold tabular-nums leading-none">{getal}</p>
      <p className="mt-1 text-[11.5px] opacity-80">{children}</p>
    </div>
  );
}
