/**
 * Rechts naast een binnengekomen mail: wie het is.
 *
 * Bovenaan, in een opvallend geel vakje, wat Wooshy zelf deed met de gegevens
 * uit de mail: een klant herkend aan telefoon of adres, lege vakjes ingevuld.
 * Met één knop is dat allemaal terug te draaien. Daaronder de klant zelf, en
 * wat in de mail anders is dan bij de klant (daar kies jij).
 *
 * Hoort de mail bij niemand, dan zie je wat Paaltje in de mail vond, met
 * "Klant toevoegen" en "Koppelen aan adres".
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCalendar as CalendarDays,
  IconCheck as Check,
  IconLink as Link2,
  IconLoader2 as Loader2,
  IconMail as Mail,
  IconPhone as Phone,
  IconSparkles as Sparkles,
  IconArrowBackUp as Undo2,
  IconUserPlus as UserPlus,
  IconUser as UserRound,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { fetchKlantBijEmail, type Bericht, type KlantBijMail, type KlantVeld } from "@/lib/berichten";
import { draaiKlantgegevensTerug, koppelKlant } from "@/lib/mailacties";
import { formatPrice, klantAdres, ritmeLabel, updateKlant } from "@/lib/klanten";
import { toonDatum, vandaag } from "@/lib/wasdag";
import { useRecht } from "@/lib/rechten";
import { Button } from "@/components/ui/button";
import { DossierKnop } from "@/components/DossierKnop";
import { KlantUitMailDialog } from "@/components/mail/KlantUitMailDialog";
import { KoppelAanAdresDialog } from "@/components/mail/KoppelAanAdresDialog";

const VELD_NAAM: Record<KlantVeld, string> = {
  naam: "naam",
  email: "e-mailadres",
  email2: "tweede e-mailadres",
  telefoon: "telefoon",
  telefoon2: "tweede telefoon",
  straat: "straat",
  huisnummer: "huisnummer",
  postcode: "postcode",
  plaats: "plaats",
};

/** Hetzelfde nummer, hoe het ook geschreven is ("06-12…" of "+31 6 12…"). */
function zelfdeNummer(a: string, b: string): boolean {
  const schoon = (t: string) => {
    let d = t.replace(/\D/g, "");
    if (d.startsWith("0031")) d = `0${d.slice(4)}`;
    else if (d.startsWith("31") && d.length === 11) d = `0${d.slice(2)}`;
    return d;
  };
  const x = schoon(a);
  return x !== "" && x === schoon(b);
}

export function KlantKaart({ b, kanSchrijven }: { b: Bericht; kanSchrijven: boolean }) {
  const qc = useQueryClient();
  const dag = vandaag();
  const magBewerken = useRecht("klanten_bewerken");
  const [dialoog, setDialoog] = useState<"toevoegen" | "koppelen" | null>(null);
  const klanten = useQuery({
    queryKey: ["klant-bij-email", b.van_email.toLowerCase(), dag, b.klant_id],
    queryFn: () => fetchKlantBijEmail(b.van_email, dag, b.klant_id),
    enabled: !!b.van_email || !!b.klant_id,
  });

  const ververs = () => {
    void qc.invalidateQueries({ queryKey: ["bericht", b.id] });
    void qc.invalidateQueries({ queryKey: ["klant-bij-email"] });
    void qc.invalidateQueries({ queryKey: ["berichten"] });
    void qc.invalidateQueries({ queryKey: ["mail-wacht"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
    void qc.invalidateQueries({ queryKey: ["klanten"] });
  };

  if (klanten.isLoading) return <p className="text-[12.5px] text-muted-foreground">Klant zoeken…</p>;

  if (klanten.isError) {
    return (
      <p className="rounded-[14px] bg-tint-rood p-3 text-[12.5px] text-tint-rood-ink">
        Klant opzoeken lukte niet. Probeer het zo nog eens.
      </p>
    );
  }

  const lijst = klanten.data ?? [];
  const kg = b.klantgegevens;
  const wooshy = (
    <WooshyVakje b={b} klanten={lijst} uit={!magBewerken || !kanSchrijven} onKlaar={ververs} />
  );

  if (lijst.length === 0) {
    const g = kg.gevonden;
    const adres = g ? klantAdres(g) : "";
    const iets = !!g && (g.naam || adres || g.telefoon);
    return (
      <div className="flex flex-col gap-2">
        {wooshy}
        <div className="rounded-[14px] bg-muted/50 p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <UserRound className="size-3.5 text-muted-foreground" /> Geen klant
          </p>
          <p className="mt-1 break-words text-[12px] leading-snug text-muted-foreground">
            {b.van_email || "Dit adres"} hoort nog bij geen klant.
          </p>
          {iets && (
            <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-[12px]">
              <p className="text-muted-foreground">Uit de mail:</p>
              {g!.naam && <p className="font-medium">{g!.naam}</p>}
              {adres && <p>{adres}</p>}
              {g!.telefoon && <p>{g!.telefoon}</p>}
            </div>
          )}
          {magBewerken && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              <Button
                size="sm"
                className="h-8 w-full justify-start rounded-full"
                disabled={!kanSchrijven}
                onClick={() => setDialoog("toevoegen")}
              >
                <UserPlus className="size-3.5" /> Klant toevoegen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full justify-start rounded-full"
                disabled={!kanSchrijven}
                onClick={() => setDialoog("koppelen")}
              >
                <Link2 className="size-3.5" /> Koppelen aan adres
              </Button>
            </div>
          )}
        </div>
        <KlantUitMailDialog
          open={dialoog === "toevoegen"}
          onOpenChange={(o) => !o && setDialoog(null)}
          b={b}
          onKlaar={ververs}
        />
        <KoppelAanAdresDialog
          open={dialoog === "koppelen"}
          onOpenChange={(o) => !o && setDialoog(null)}
          b={b}
          onKlaar={ververs}
        />
      </div>
    );
  }

  // Waar "anders in de mail" over gaat: de klant die op de mail staat.
  const doel = lijst.find((k) => k.id === (b.klant_id ?? kg.toegevoegd?.klant_id)) ?? lijst[0]!;

  return (
    <div className="flex flex-col gap-2">
      {wooshy}
      {lijst.map((k) => (
        <KlantBlok key={k.id} k={k} />
      ))}
      <AndersVakje b={b} klant={doel} uit={!magBewerken} />
    </div>
  );
}

/** De groene tegel met één klant; ook naast een WhatsApp-gesprek. */
export function KlantBlok({ k }: { k: KlantBijMail }) {
  const magKlantenZien = useRecht("klanten_bekijken");
  const prijzenZien = useRecht("prijzen_zien");
  const frequenties = [...new Set(k.adressen.map((a) => ritmeLabel(a)))];
  const nummers = [k.telefoon, k.telefoon2].filter((t) => t.trim());
  const mails = [k.email, k.email2].filter((e) => e.trim());
  return (
    <div className="rounded-[14px] bg-tint-groen p-3 text-tint-groen-ink">
      <div className="flex items-start gap-1.5">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] font-semibold">
          <UserRound className="size-3.5 shrink-0" /> <span className="truncate">{k.naam || "Zonder naam"}</span>
        </p>
        {/* Het poppetje: het dossier, hier ter plekke. Bij één pand hier; bij
            meer staat er een naast elk pand, want het dossier gaat over één pand. */}
        {magKlantenZien && k.adressen.length === 1 && (
          <DossierKnop klantId={k.id} customerId={k.adressen[0]!.id} naam={k.naam} className="-mr-1 -mt-1" />
        )}
      </div>
      {klantAdres(k) && <p className="mt-1 text-[12.5px]">{klantAdres(k)}</p>}
      {nummers.map((t) => (
        <a
          key={t}
          href={`tel:${t}`}
          className="mt-1 flex items-center gap-1.5 text-[12.5px] underline-offset-2 hover:underline"
        >
          <Phone className="size-3" /> {t}
        </a>
      ))}
      {mails.map((e) => (
        <p key={e} className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <Mail className="size-3 shrink-0" /> <span className="truncate">{e}</span>
        </p>
      ))}
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
      {/* Per adres wat het kost en wat erbij staat. Bij één adres zonder
          straatnaam erboven: dat is het adres hierboven al. Geen prijs (0)
          laten we weg. */}
      {(k.adressen.length > 1 || k.adressen.some((a) => (prijzenZien && !!a.prijs) || a.notitie)) && (
        <ul className="mt-2 space-y-1.5 border-t border-tint-groen-ink/15 pt-2 text-[12px]">
          {k.adressen.map((a) => (
            <li key={a.id} className="min-w-0">
              <div className="flex items-center gap-2">
                {k.adressen.length > 1 && <span className="min-w-0 flex-1 truncate">{a.adres}</span>}
                {prijzenZien && !!a.prijs && (
                  <span className="font-medium tabular-nums">{formatPrice(a.prijs)}</span>
                )}
                {magKlantenZien && k.adressen.length > 1 && (
                  <DossierKnop klantId={k.id} customerId={a.id} naam={k.naam} className="-my-1 -mr-1 size-6" />
                )}
              </div>
              {a.notitie && <p className="break-words italic leading-snug opacity-85">{a.notitie}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Genoeg van een bericht voor de vakjes: ook een appje past hierin. */
export type VakjesBericht = Pick<Bericht, "id" | "klantgegevens" | "klant_id">;

/** Klopt en Ongedaan maken lopen bij mail en WhatsApp via een andere functie. */
export interface VakjesActies {
  klopt: (berichtId: string, klantId: string) => Promise<unknown>;
  terug: (berichtId: string) => Promise<{ bleven?: string[] }>;
  /** "mail" of "appje", voor de teksten. */
  soort: "mail" | "appje";
}

const MAIL_ACTIES: VakjesActies = { klopt: koppelKlant, terug: draaiKlantgegevensTerug, soort: "mail" };

/** Wat Wooshy zelf deed, geel zodat het opvalt, met Ongedaan maken. */
export function WooshyVakje({
  b,
  klanten,
  uit,
  onKlaar,
  acties = MAIL_ACTIES,
}: {
  b: VakjesBericht;
  klanten: KlantBijMail[];
  uit: boolean;
  onKlaar: () => void;
  acties?: VakjesActies;
}) {
  const hier = acties.soort === "mail" ? "deze mail" : "dit appje";
  const [bezig, setBezig] = useState<"terug" | "klopt" | null>(null);
  const kg = b.klantgegevens;
  const velden = (Object.entries(kg.toegevoegd?.velden ?? {}) as [KlantVeld, string | undefined][]).filter(
    (x): x is [KlantVeld, string] => !!x[1] && x[0] in VELD_NAAM,
  );

  if (!kg.herkend && velden.length === 0) {
    if (!kg.teruggedraaid) return null;
    const bleven = kg.teruggedraaid.bleven ?? [];
    return (
      <div className="rounded-[14px] border border-dashed border-tint-amber-ink/30 bg-tint-amber/40 p-3 text-[12px] text-tint-amber-ink">
        <p className="flex items-center gap-1.5 font-medium">
          <Undo2 className="size-3.5" /> Teruggedraaid
        </p>
        <p className="mt-0.5 leading-snug">
          Wooshy doet dit bij {hier} niet opnieuw.
          {bleven.length > 0 &&
            ` Bleef staan omdat het intussen aangepast was: ${bleven.map((v) => VELD_NAAM[v] ?? v).join(", ")}.`}
        </p>
      </div>
    );
  }

  const naam =
    klanten.find((k) => k.id === (kg.herkend?.klant_id ?? kg.toegevoegd?.klant_id))?.naam || "deze klant";

  async function klopt(klantId: string) {
    setBezig("klopt");
    try {
      await acties.klopt(b.id, klantId);
      toast.success(`Bevestigd. Paaltje leest ${acties.soort === "mail" ? "de mail" : "het appje"} opnieuw.`);
      onKlaar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(null);
    }
  }

  async function terug() {
    setBezig("terug");
    try {
      const r = await acties.terug(b.id);
      const bleven = (r.bleven ?? []) as KlantVeld[];
      toast.success(
        bleven.length > 0
          ? `Teruggedraaid. Bleef staan omdat het intussen aangepast was: ${bleven.map((v) => VELD_NAAM[v] ?? v).join(", ")}.`
          : "Teruggedraaid.",
      );
      onKlaar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(null);
    }
  }

  return (
    <div className="rounded-[14px] border border-tint-amber-ink/25 bg-tint-amber p-3 text-tint-amber-ink shadow-card">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles className="size-3.5" /> Wooshy heeft dit bijgewerkt
      </p>
      {kg.herkend && (
        <p className="mt-1 break-words text-[12.5px] leading-snug">
          {kg.herkend.aangemaakt ? (
            <>
              {kg.gevonden?.straat
                ? `${kg.gevonden.straat} ${kg.gevonden.huisnummer}`.trim()
                : `Het adres uit ${hier}`}{" "}
              stond er nog zonder klant; Wooshy maakte <strong>{naam}</strong> aan
            </>
          ) : (
            <>
              Herkend als <strong>{naam}</strong> aan{" "}
              {kg.herkend.via === "telefoon" ? "het telefoonnummer" : "het adres en de naam"} in {hier}
            </>
          )}
          {kg.herkend.email ? `; ${kg.herkend.email} hoort nu bij deze klant` : ""}. Tot je dit bevestigt voert
          Paaltje voor deze klant niets zelf door.
        </p>
      )}
      {velden.length > 0 && (
        <div className="mt-1.5 text-[12.5px]">
          <p>Toegevoegd uit {hier}:</p>
          <ul className="mt-0.5 space-y-0.5">
            {velden.map(([veld, waarde]) => (
              <li key={veld} className="min-w-0 break-words">
                <span className="opacity-75">{VELD_NAAM[veld]}:</span> <span className="font-medium">{waarde}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {kg.herkend && (
          <Button
            size="sm"
            className="h-7 rounded-full"
            disabled={uit || bezig !== null}
            onClick={() => void klopt(kg.herkend!.klant_id)}
          >
            {bezig === "klopt" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Klopt
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-full border-tint-amber-ink/30 bg-card/70 text-tint-amber-ink hover:bg-card"
          disabled={uit || bezig !== null}
          onClick={() => void terug()}
        >
          {bezig === "terug" ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
          Ongedaan maken
        </Button>
      </div>
    </div>
  );
}

type Vak = "telefoon" | "telefoon2" | "email" | "email2";

/** Wat in het bericht anders is dan bij de klant en niet in een leeg vak paste: jij kiest. */
export function AndersVakje({
  b,
  klant,
  uit,
  soort = "mail",
}: {
  b: VakjesBericht;
  klant: KlantBijMail;
  uit: boolean;
  soort?: "mail" | "appje";
}) {
  const qc = useQueryClient();
  const [bezig, setBezig] = useState(false);
  const anders = b.klantgegevens.anders ?? {};

  // Staat het intussen al bij de klant (iemand nam het over), dan hoeft het niet meer.
  const telefoon =
    anders.telefoon && ![klant.telefoon, klant.telefoon2].some((t) => zelfdeNummer(t, anders.telefoon!))
      ? anders.telefoon
      : "";
  const email =
    anders.email &&
    ![klant.email, klant.email2].some((e) => e.trim().toLowerCase() === anders.email!.trim().toLowerCase())
      ? anders.email
      : "";
  if (!telefoon && !email && !anders.adres) return null;

  const herlaad = () => {
    void qc.invalidateQueries({ queryKey: ["klant-bij-email"] });
    void qc.invalidateQueries({ queryKey: ["wa-klant"] });
    void qc.invalidateQueries({ queryKey: ["klanten"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };

  async function zet(vak: Vak, waarde: string) {
    const oud = klant[vak];
    setBezig(true);
    try {
      await updateKlant(klant.id, { [vak]: waarde });
      herlaad();
      toast.success(oud ? `${oud} is vervangen door ${waarde}.` : `${waarde} staat nu bij de klant.`, {
        action: {
          label: "Ongedaan maken",
          onClick: () =>
            void updateKlant(klant.id, { [vak]: oud })
              .then(herlaad)
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  }

  const knoppen = (vakken: [Vak, Vak], waarde: string, soort: string) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {vakken.map((vak, i) => (
        <Button
          key={vak}
          size="sm"
          variant="outline"
          className="h-7 max-w-full rounded-full bg-card/70 text-[12px]"
          disabled={uit || bezig}
          onClick={() => void zet(vak, waarde)}
        >
          <span className="truncate">
            {klant[vak].trim() ? `Vervang ${klant[vak]}` : `Als ${i === 0 ? "eerste" : "tweede"} ${soort}`}
          </span>
        </Button>
      ))}
    </div>
  );

  return (
    <div className="rounded-[14px] bg-tint-blauw/70 p-3 text-[12.5px] text-tint-blauw-ink">
      <p className="text-[13px] font-semibold">Anders in {soort === "mail" ? "de mail" : "het appje"}</p>
      {telefoon && (
        <div className="mt-1.5">
          <p className="break-words">
            Telefoon: <span className="font-medium">{telefoon}</span>
          </p>
          {knoppen(["telefoon", "telefoon2"], telefoon, "nummer")}
        </div>
      )}
      {email && (
        <div className="mt-2">
          <p className="break-words">
            E-mail: <span className="font-medium">{email}</span>
          </p>
          {knoppen(["email", "email2"], email, "adres")}
        </div>
      )}
      {anders.adres && (
        <p className="mt-2 break-words leading-snug">
          Adres: <span className="font-medium">{anders.adres}</span>. Is dat een ander pand of een verhuizing? Pas het
          aan bij de klant.
        </p>
      )}
    </div>
  );
}
