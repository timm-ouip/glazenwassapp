/**
 * De aankondigingsmail: "morgen komen we langs".
 *
 * Drie bladen, en ze horen in die volgorde bij elkaar: je stelt een bericht
 * op voor een ingeplande dag, je kijkt wat eruit ging, en je leest wat
 * terugkwam.
 *
 * Twee dingen staan hier met opzet zo:
 *
 *  - Het aantal ontvangers komt van de server, niet uit deze pagina. Wat er
 *    op de knop staat is precies wat de Edge Function straks gaat versturen;
 *    een telling die de browser zelf maakt kan er net naast zitten, en dan
 *    klopt de bevestiging niet met de werkelijkheid.
 *  - De assistent stelt voor, hij doet niet. Wat hij van een antwoord maakt
 *    staat als voorstel op de kaart, met één knop eronder. Doorvoeren loopt
 *    daarna langs dezelfde weg als overal elders in de app — mét undo.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Mail,
  MailCheck,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchCustomers, toonMaand, type Customer } from "@/lib/klanten";
import { slaSelectieOver } from "@/lib/overslaan-keuze";
import { datumSleutel, fetchWasdagen, toonDatum, vandaag } from "@/lib/wasdag";
import {
  aantalOpenMailAntwoorden,
  bewaarAfzender,
  categorieNamen,
  categorieTint,
  controleerVerbinding,
  fetchAfzender,
  fetchMailAntwoorden,
  fetchMailingen,
  stempelDoorgevoerd,
  telOntvangers,
  verstuurAankondiging,
  verstuurReactie,
  zetAntwoordStatus,
  type Controle,
  type MailAntwoord,
} from "@/lib/mailing";

interface MailingSearch {
  /** De dag die al gekozen is, bijvoorbeeld vanaf de planningspagina. */
  dag?: string;
}

export const Route = createFileRoute("/mailing")({
  beforeLoad: async () => {
    await requireSession();
  },
  validateSearch: (search: Record<string, unknown>): MailingSearch =>
    typeof search["dag"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search["dag"])
      ? { dag: search["dag"] }
      : {},
  head: () => ({
    meta: [
      { title: "Mailing — Klantenlijst glazenwasser" },
      {
        name: "description",
        content: "Een aankondiging sturen naar alle klanten van een ingeplande dag.",
      },
    ],
  }),
  component: Mailing,
});

/** Waar een nieuw bericht mee begint. Je past het aan, maar niet vanaf nul. */
const VOORBEELDTEKST = `Beste {{naam}},

Morgen komen wij langs om de ramen van {{adres}} te wassen.

Komt het niet uit? Antwoord dan gewoon even op deze mail, dan slaan we deze keer over.

Met vriendelijke groet,
De Ramensopperij`;

function Mailing() {
  useRequireAuth();
  const { dag } = Route.useSearch();
  const [blad, setBlad] = useState<"opstellen" | "antwoorden" | "verstuurd">("opstellen");

  return (
    <AppLayout
      titel="Mailing"
      kruimel="Overzicht / Mailing"
      onderschrift="Een aankondiging naar de klanten van een ingeplande dag, en wat er terugkomt."
    >
      <Tabs value={blad} onValueChange={(v) => setBlad(v as typeof blad)}>
        <TabsList className="mb-4">
          <TabsTrigger value="opstellen">Opstellen</TabsTrigger>
          <TabsTrigger value="antwoorden">
            Antwoorden
            <OpenTelletje />
          </TabsTrigger>
          <TabsTrigger value="verstuurd">Verstuurd</TabsTrigger>
        </TabsList>

        <TabsContent value="opstellen">
          <Opstellen beginDag={dag} />
        </TabsContent>
        <TabsContent value="antwoorden">
          <Antwoorden />
        </TabsContent>
        <TabsContent value="verstuurd">
          <Verstuurd />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

/** Het getalletje op het tabblad: hoeveel berichten wachten er nog. */
function OpenTelletje() {
  const { data } = useQuery({
    queryKey: ["mail-antwoorden-open"],
    queryFn: aantalOpenMailAntwoorden,
  });
  if (!data) return null;
  return (
    <span className="ml-1.5 rounded-full bg-tint-amber px-1.5 text-[11px] font-semibold tabular-nums text-tint-amber-ink">
      {data}
    </span>
  );
}

// ---------------------------------------------------------------------
// Opstellen
// ---------------------------------------------------------------------

function Opstellen({ beginDag }: { beginDag?: string | undefined }) {
  const bevestig = useBevestig();
  const [datum, setDatum] = useState(beginDag ?? vandaag());
  const [onderwerp, setOnderwerp] = useState("Morgen wassen wij uw ramen");
  const [tekst, setTekst] = useState(VOORBEELDTEKST);
  const [bezig, setBezig] = useState(false);

  // De ingeplande dagen van de komende weken, om uit te kiezen. Achteruit
  // kijken heeft hier geen zin: een aankondiging voor gisteren bestaat niet.
  const tot = useMemo(() => {
    const d = new Date(`${vandaag()}T12:00:00`);
    d.setDate(d.getDate() + 45);
    return datumSleutel(d);
  }, []);
  const dagen = useQuery({
    queryKey: ["wasdagen-vooruit", tot],
    queryFn: () => fetchWasdagen(vandaag(), tot),
  });

  const perDag = useMemo(() => {
    const telling = new Map<string, number>();
    for (const r of dagen.data ?? []) {
      telling.set(r.datum, (telling.get(r.datum) ?? 0) + 1);
    }
    return [...telling.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [dagen.data]);

  // De telling komt van de server, want die bouwt straks ook de echte lijst.
  const telling = useQuery({
    queryKey: ["mail-telling", datum],
    queryFn: () => telOntvangers(datum),
    enabled: !!datum,
  });

  const aantal = telling.data?.aantal ?? 0;
  const klaar = onderwerp.trim().length > 0 && tekst.trim().length > 0;

  async function verstuur(test: boolean) {
    if (!klaar) {
      toast.error("Vul een onderwerp en een tekst in.");
      return;
    }
    if (!test) {
      const ja = await bevestig({
        titel: `Versturen naar ${aantal} ${aantal === 1 ? "ontvanger" : "ontvangers"}?`,
        tekst:
          `De aankondiging voor ${toonDatum(datum)} gaat naar ${aantal} ` +
          `${aantal === 1 ? "klant" : "klanten"}. Dit kun je niet terugnemen.`,
        bevestigLabel: "Versturen",
      });
      if (!ja) return;
    }
    setBezig(true);
    try {
      const uit = await verstuurAankondiging({ datum, onderwerp, tekst, test });
      if (test) {
        toast.success("Proefmail verstuurd naar jezelf.");
      } else if (uit.mislukt > 0) {
        toast.warning(
          `${uit.verstuurd} verstuurd, ${uit.mislukt} mislukt. ${uit.eersteFout}`.trim(),
        );
      } else {
        toast.success(`${uit.verstuurd} mails onderweg.`);
      }
    } catch (e) {
      toast.error("Versturen mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Kaart titel="Welke dag">
          {perDag.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Er staat de komende weken nog niets ingepland.{" "}
              <Link to="/planning" className="underline">
                Naar de planning
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {perDag.map(([d, n]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDatum(d)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                    d === datum
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card hover:bg-card/70"
                  }`}
                >
                  {toonDatum(d)}
                  <span className="ml-1.5 opacity-60 tabular-nums">{n}</span>
                </button>
              ))}
            </div>
          )}
        </Kaart>

        <Kaart titel="Het bericht">
          <label className="block text-[12px] font-medium text-muted-foreground">Onderwerp</label>
          <Input
            value={onderwerp}
            onChange={(e) => setOnderwerp(e.target.value)}
            maxLength={200}
            className="mt-1"
          />
          <label className="mt-3 block text-[12px] font-medium text-muted-foreground">Tekst</label>
          <Textarea
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
            rows={14}
            className="mt-1 font-[inherit] text-[13.5px] leading-relaxed"
          />
          <p className="mt-2 text-[12px] text-muted-foreground">
            <code className="rounded bg-muted px-1">{"{{naam}}"}</code> wordt de naam van de klant,{" "}
            <code className="rounded bg-muted px-1">{"{{adres}}"}</code> zijn adres — of zijn
            adressen, als hij er die dag meer heeft.
          </p>
        </Kaart>
      </div>

      <div className="space-y-4">
        <Afzenderkaart />

        <Kaart titel="Naar wie">
          {telling.isLoading ? (
            <p className="text-[13px] text-muted-foreground">Bezig met tellen…</p>
          ) : telling.isError ? (
            <p className="text-[13px] text-tint-oranje-ink">
              Tellen lukte niet. Staat de Edge Function er al op?
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-[28px] font-bold tabular-nums">{aantal}</span>
                <span className="text-[13px] text-muted-foreground">
                  {aantal === 1 ? "ontvanger" : "ontvangers"}
                </span>
              </p>
              {(telling.data?.zonderEmail ?? 0) > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tint-amber-ink" />
                  {telling.data?.zonderEmail} adressen op deze dag hebben geen e-mailadres.
                </p>
              )}
              {(telling.data?.voorbeeld.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
                  {telling.data?.voorbeeld.map((v) => (
                    <li key={v.email} className="truncate">
                      {v.naam || v.email} · {v.adressen.join(", ")}
                    </li>
                  ))}
                  {aantal > (telling.data?.voorbeeld.length ?? 0) && (
                    <li className="opacity-70">
                      en nog {aantal - (telling.data?.voorbeeld.length ?? 0)}…
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </Kaart>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full rounded-full"
            disabled={bezig || !klaar}
            onClick={() => void verstuur(true)}
          >
            <MailCheck className="size-4" /> Proef naar mezelf
          </Button>
          <Button
            className="w-full rounded-full"
            disabled={bezig || !klaar || aantal === 0}
            onClick={() => void verstuur(false)}
          >
            <Send className="size-4" />
            {aantal === 0 ? "Niemand om te mailen" : `Versturen naar ${aantal}`}
          </Button>
          <p className="text-center text-[11.5px] text-muted-foreground">
            Stuur eerst een proef. Die gaat alleen naar jou.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Van wie de mail komt. Staat op deze pagina en niet bij Instellingen: je ziet
 * het hier op het moment dat het ertoe doet, vlak voor je op versturen klikt.
 */
function Afzenderkaart() {
  const { company } = useAuth();
  const qc = useQueryClient();
  const afzender = useQuery({ queryKey: ["mail-afzender"], queryFn: fetchAfzender });
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!afzender.data) return;
    setNaam(afzender.data.naam);
    setEmail(afzender.data.email);
  }, [afzender.data]);

  async function bewaar() {
    if (!company?.id) return;
    try {
      await bewaarAfzender(company.id, { naam, email });
      await qc.invalidateQueries({ queryKey: ["mail-afzender"] });
      setOpen(false);
      toast.success("Afzender opgeslagen.");
    } catch (e) {
      toast.error("Opslaan mislukte: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const ingesteld = (afzender.data?.email ?? "").trim();

  return (
    <Kaart titel="Afzender">
      {open ? (
        <div className="space-y-2">
          <Input
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="De Ramensopperij"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="info@deramensopperij.nl"
            inputMode="email"
          />
          <div className="flex gap-2">
            <Button size="sm" className="rounded-full" onClick={() => void bewaar()}>
              Opslaan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Annuleren
            </Button>
          </div>
        </div>
      ) : ingesteld ? (
        <p className="text-[13px]">
          {afzender.data?.naam}
          <br />
          <span className="text-muted-foreground">{ingesteld}</span>
          <button
            type="button"
            className="ml-2 text-[12px] underline"
            onClick={() => setOpen(true)}
          >
            wijzigen
          </button>
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Nog geen afzender.{" "}
          <button type="button" className="underline" onClick={() => setOpen(true)}>
            Instellen
          </button>
        </p>
      )}
      <Verbindingscontrole />
    </Kaart>
  );
}

/**
 * "Kan ik versturen?" — in gewone taal, en gevraagd aan Brevo zelf.
 *
 * Staat hier en niet in een handleiding, want dit is precies de plek waar je
 * het je afvraagt. Elke regel is een ding dat kapot kan zijn, met erbij wat
 * je eraan doet; een enkel groen vinkje zou niet zeggen wélk deel klopt.
 */
function Verbindingscontrole() {
  const [uitslag, setUitslag] = useState<Controle | null>(null);
  const [bezig, setBezig] = useState(false);

  async function kijk() {
    setBezig(true);
    try {
      setUitslag(await controleerVerbinding());
    } catch (e) {
      toast.error("Controleren lukte niet: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <Button
        size="sm"
        variant="outline"
        className="w-full rounded-full"
        disabled={bezig}
        onClick={() => void kijk()}
      >
        <ShieldCheck className="size-4" /> {bezig ? "Bezig…" : "Controleer verbinding"}
      </Button>

      {uitslag && (
        <ul className="mt-3 space-y-1.5 text-[12.5px]">
          <Regel
            goed={uitslag.sleutel}
            goedTekst={`Brevo werkt${uitslag.account ? ` (${uitslag.account})` : ""}`}
            foutTekst={uitslag.melding || "Brevo herkent de sleutel niet"}
          />
          <Regel
            goed={uitslag.afzenderBekend && uitslag.afzenderActief}
            goedTekst={`${uitslag.afzenderIngevuld} mag versturen`}
            foutTekst={
              !uitslag.sleutel
                ? "Afzender nog niet te controleren"
                : uitslag.afzenderBekend
                  ? `${uitslag.afzenderIngevuld} is bij Brevo nog niet goedgekeurd`
                  : `${uitslag.afzenderIngevuld} staat niet bij Brevo als afzender`
            }
          />
          <Regel
            goed={!!uitslag.antwoordadres}
            goedTekst="Antwoorden komen binnen in het postvak"
            foutTekst="Antwoorden komen nog niet binnen (dat is optioneel)"
            zacht
          />
          {uitslag.sleutel &&
            !uitslag.afzenderBekend &&
            (uitslag.bekendeAfzenders?.length ?? 0) > 0 && (
              <li className="pt-1 text-[12px] text-muted-foreground">
                Brevo kent wel: {uitslag.bekendeAfzenders?.join(", ")}
              </li>
            )}
        </ul>
      )}
    </div>
  );
}

/** Eén regel van de controle. `zacht` is voor wat niet per se hoeft. */
function Regel({
  goed,
  goedTekst,
  foutTekst,
  zacht,
}: {
  goed: boolean;
  goedTekst: string;
  foutTekst: string;
  zacht?: boolean;
}) {
  return (
    <li className="flex items-start gap-1.5">
      {goed ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-tint-groen-ink" />
      ) : (
        <X
          className={`mt-0.5 size-3.5 shrink-0 ${zacht ? "text-muted-foreground" : "text-tint-oranje-ink"}`}
        />
      )}
      <span className={goed ? "" : "text-muted-foreground"}>{goed ? goedTekst : foutTekst}</span>
    </li>
  );
}

// ---------------------------------------------------------------------
// Antwoorden
// ---------------------------------------------------------------------

function Antwoorden() {
  const qc = useQueryClient();
  const berichten = useQuery({ queryKey: ["mail-antwoorden"], queryFn: fetchMailAntwoorden });
  const klanten = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });

  const lijst = berichten.data ?? [];
  const open = lijst.filter((a) => a.status === "nieuw");
  const rest = lijst.filter((a) => a.status !== "nieuw");

  async function opnieuw() {
    await berichten.refetch();
    await qc.invalidateQueries({ queryKey: ["mail-antwoorden-open"] });
  }

  if (berichten.isLoading) return <Leeg tekst="Bezig met ophalen…" />;
  if (lijst.length === 0) {
    return (
      <Leeg
        tekst={
          "Nog geen antwoorden. Zodra een klant op een aankondiging reageert, " +
          "leest de assistent het bericht en zet hier klaar wat hij ervan maakt."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {open.map((a) => (
        <AntwoordKaart key={a.id} bericht={a} adressen={klanten.data ?? []} onVeranderd={opnieuw} />
      ))}
      {rest.length > 0 && (
        <>
          <p className="pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Afgehandeld
          </p>
          {rest.map((a) => (
            <AntwoordKaart
              key={a.id}
              bericht={a}
              adressen={klanten.data ?? []}
              onVeranderd={opnieuw}
            />
          ))}
        </>
      )}
    </div>
  );
}

function AntwoordKaart({
  bericht,
  adressen,
  onVeranderd,
}: {
  bericht: MailAntwoord;
  adressen: Customer[];
  onVeranderd: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const [concept, setConcept] = useState(bericht.concept);
  const [bezig, setBezig] = useState(false);
  const afgehandeld = bericht.status !== "nieuw";

  const voorstel =
    bericht.voorstel_maanden.length > 0 &&
    bericht.voorstel_adressen.length > 0 &&
    !bericht.doorgevoerd_op;

  async function voerDoor() {
    const gekozen = adressen.filter((c) => bericht.voorstel_adressen.includes(c.id));
    if (gekozen.length === 0) {
      toast.error("De adressen van dit voorstel bestaan niet meer.");
      return;
    }
    const maanden = bericht.voorstel_maanden;
    const ja = await bevestig({
      titel: "Overslaan doorvoeren?",
      tekst:
        `${gekozen.length} ${gekozen.length === 1 ? "adres" : "adressen"} van ` +
        `${bericht.van_naam || bericht.van_email} slaan ` +
        `${maanden.map(toonMaand).join(" en ")} over.`,
      bevestigLabel: "Doorvoeren",
    });
    if (!ja) return;
    setBezig(true);
    try {
      // Langs dezelfde weg als de wijkenpagina en de dagpagina: zelfde
      // melding, zelfde undo. Een voorstel van de assistent hoort niet stiekem
      // een ander soort wijziging te zijn dan wat je zelf doet.
      await slaSelectieOver(gekozen, maanden, qc);
      await stempelDoorgevoerd(bericht.id);
      await onVeranderd();
    } finally {
      setBezig(false);
    }
  }

  async function stuurAntwoord() {
    if (!concept.trim()) return;
    const ja = await bevestig({
      titel: `Antwoord sturen naar ${bericht.van_email}?`,
      tekst: "Het bericht gaat meteen de deur uit.",
      bevestigLabel: "Versturen",
    });
    if (!ja) return;
    setBezig(true);
    try {
      await verstuurReactie({
        antwoord_id: bericht.id,
        onderwerp: `Re: ${bericht.onderwerp}`,
        tekst: concept,
      });
      toast.success("Antwoord verstuurd.");
      await onVeranderd();
    } catch (e) {
      toast.error("Versturen mislukte: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBezig(false);
    }
  }

  async function leggenWeg() {
    await zetAntwoordStatus(bericht.id, "genegeerd");
    await onVeranderd();
  }

  return (
    <article
      className={`rounded-[18px] border border-border bg-card p-4 shadow-card ${
        afgehandeld ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${categorieTint[bericht.categorie]}`}
        >
          {categorieNamen[bericht.categorie]}
        </span>
        <span className="text-[13.5px] font-semibold">{bericht.van_naam || bericht.van_email}</span>
        <span className="text-[12px] text-muted-foreground">
          {new Date(bericht.ontvangen_op).toLocaleDateString("nl-NL", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {bericht.doorgevoerd_op && (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-tint-groen-ink">
            <Check className="size-3.5" /> doorgevoerd
          </span>
        )}
      </div>

      {bericht.samenvatting && (
        <p className="mt-2 flex items-start gap-1.5 text-[13.5px]">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {bericht.samenvatting}
        </p>
      )}
      {bericht.ai_fout && (
        <p className="mt-2 text-[12.5px] text-tint-oranje-ink">
          De assistent kon dit bericht niet lezen ({bericht.ai_fout}). Lees het zelf even.
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-muted-foreground">Wat er stond</summary>
        <p className="mt-1 whitespace-pre-wrap rounded-[12px] bg-surface p-3 text-[13px] leading-relaxed">
          {bericht.tekst || "(geen tekst)"}
        </p>
      </details>

      {voorstel && (
        <div className="mt-3 rounded-[14px] border border-border bg-surface p-3">
          <p className="text-[13px]">
            Voorstel: {bericht.voorstel_adressen.length}{" "}
            {bericht.voorstel_adressen.length === 1 ? "adres" : "adressen"} overslaan in{" "}
            <strong>{bericht.voorstel_maanden.map(toonMaand).join(" en ")}</strong>.
          </p>
          <Button
            size="sm"
            className="mt-2 rounded-full"
            disabled={bezig}
            onClick={() => void voerDoor()}
          >
            <Check className="size-4" /> Doorvoeren
          </Button>
        </div>
      )}

      {!afgehandeld && (
        <div className="mt-3">
          <label className="block text-[12px] font-medium text-muted-foreground">
            {bericht.concept ? "Klaargezet antwoord" : "Antwoord"}
          </label>
          <Textarea
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            rows={4}
            className="mt-1 text-[13.5px]"
            placeholder="Schrijf een antwoord…"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-full"
              disabled={bezig || !concept.trim()}
              onClick={() => void stuurAntwoord()}
            >
              <Send className="size-4" /> Antwoord versturen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              disabled={bezig}
              onClick={() => void leggenWeg()}
            >
              <CircleSlash className="size-4" /> Wegleggen
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------
// Verstuurd
// ---------------------------------------------------------------------

function Verstuurd() {
  const mailingen = useQuery({ queryKey: ["mailingen"], queryFn: fetchMailingen });
  const lijst = mailingen.data ?? [];

  if (mailingen.isLoading) return <Leeg tekst="Bezig met ophalen…" />;
  if (lijst.length === 0) return <Leeg tekst="Er is nog niets verstuurd." />;

  return (
    <div className="space-y-2">
      {lijst.map((m) => (
        <article
          key={m.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[16px] border border-border bg-card px-4 py-3 shadow-card"
        >
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-[13.5px] font-semibold">{m.onderwerp}</span>
          {m.test && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              proef
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <Users className="size-3.5" />
            <span className="tabular-nums">{m.aantal}</span>
            {m.mislukt > 0 && <span className="text-tint-oranje-ink">({m.mislukt} mislukt)</span>}
          </span>
          <span className="w-full text-[12px] text-muted-foreground">
            {m.datum ? `voor ${toonDatum(m.datum)} · ` : ""}
            verstuurd op{" "}
            {new Date(m.created_at).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </article>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------

function Kaart({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {titel}
      </h2>
      {children}
    </section>
  );
}

function Leeg({ tekst }: { tekst: string }) {
  return (
    <p className="rounded-[18px] border border-dashed border-border px-4 py-10 text-center text-[13.5px] text-muted-foreground">
      {tekst}
    </p>
  );
}
