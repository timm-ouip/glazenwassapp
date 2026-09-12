/**
 * Het postvak: wat er via de aanmeldpagina binnenkwam en nog een mens nodig
 * heeft.
 *
 * Het gewone geval staat hier niet lang: een adres dat op de lijst stond en
 * nog geen naam had, is meteen bijgevuld en staat hier alleen ter
 * kennisgeving. Wat overblijft zijn de twee gevallen waar niet automatisch
 * over te beslissen is:
 *
 *  - een adres dat er al gegevens had (wie mag het telefoonnummer van een
 *    bestaande klant overschrijven? niet de eerste die een postcode typt), en
 *  - een adres dat niet op de lijst staat (daar horen een wijk en een prijs
 *    bij, en die weet de klant niet).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Inbox, Link2, MapPin, Phone, Mail, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { requireSession, useAuth, useRequireAuth } from "@/lib/auth";
import { aanmeldAdres, fetchAanmeldingen, zetStatus, type Aanmelding } from "@/lib/aanmeldingen";
import {
  fetchDistricts,
  fetchKlanten,
  updateKlant,
  type Klant,
  type KlantVelden,
} from "@/lib/klanten";
import { AppLayout } from "@/components/AppLayout";
import { AanmeldingDialog } from "@/components/AanmeldingDialog";
import { AanmeldInstellingen } from "@/components/AanmeldInstellingen";
import { Dialog } from "@/components/ui/dialog";
import { PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/aanmeldingen")({
  beforeLoad: async () => {
    await requireSession();
  },
  head: () => ({ meta: [{ title: "Aanmeldingen — Klantenlijst glazenwasser" }] }),
  component: Aanmeldingen,
});

function datum(iso: string) {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Aanmeldingen() {
  useRequireAuth();
  const [blad, setBlad] = useState<"open" | "klaar">("open");
  const [toevoegen, setToevoegen] = useState<Aanmelding | null>(null);
  const qc = useQueryClient();
  const [link, setLink] = useState(false);
  const { employee } = useAuth();

  const alles = useQuery({ queryKey: ["aanmeldingen"], queryFn: fetchAanmeldingen });
  const wijken = useQuery({ queryKey: ["districts"], queryFn: fetchDistricts });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten });

  // Geen useMemo: het zijn twee filters over een handjevol regels, en een
  // memo op een lijst die elke render een nieuw array is levert niets op.
  const lijst = alles.data ?? [];
  const open = lijst.filter((a) => a.status === "open");
  const afgehandeld = lijst.filter((a) => a.status !== "open");

  const klantVan = (id: string | null) =>
    id ? ((klanten.data ?? []).find((k) => k.id === id) ?? null) : null;

  async function opnieuw() {
    await Promise.all([alles.refetch(), klanten.refetch()]);
    // Ook het telletje in de zijbalk: dat hangt aan een eigen query, want het
    // staat op elke pagina en haalt niet de hele lijst op.
    await qc.invalidateQueries({ queryKey: ["aanmeldingen-open"] });
    await qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function weigeren(a: Aanmelding) {
    try {
      await zetStatus([a.id], "geweigerd");
      await opnieuw();
      toast.success("Weggelegd.");
    } catch (err) {
      toast.error("Dat lukte niet: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <AppLayout
      titel="Aanmeldingen"
      kruimel="Overzicht / Aanmeldingen"
      onderschrift="Wat klanten zelf via de aanmeldpagina hebben doorgegeven."
      acties={
        <Button variant="outline" className="rounded-full" onClick={() => setLink(true)}>
          <Link2 className="size-4" /> Link en QR-code
        </Button>
      }
    >
      <Tabs value={blad} onValueChange={(v) => setBlad(v as "open" | "klaar")}>
        <TabsList className="mb-4">
          <TabsTrigger value="open">
            Te doen
            {open.length > 0 && (
              <span className="ml-1.5 rounded-full bg-tint-amber px-1.5 text-[11px] font-semibold tabular-nums text-tint-amber-ink">
                {open.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="klaar">Afgehandeld</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-3">
          {alles.isLoading ? (
            <Leeg tekst="Bezig met ophalen…" />
          ) : open.length === 0 ? (
            <Leeg tekst="Niets te doen. Alles wat binnenkwam paste op een adres dat je al had." />
          ) : (
            open.map((a) =>
              a.soort === "wijziging" ? (
                <WijzigingKaart
                  key={a.id}
                  aanmelding={a}
                  huidig={klantVan(a.klant_id)}
                  onKlaar={opnieuw}
                  onWeigeren={() => void weigeren(a)}
                />
              ) : (
                <OnbekendKaart
                  key={a.id}
                  aanmelding={a}
                  onToevoegen={() => setToevoegen(a)}
                  onWeigeren={() => void weigeren(a)}
                />
              ),
            )
          )}
        </TabsContent>

        <TabsContent value="klaar" className="space-y-3">
          {afgehandeld.length === 0 ? (
            <Leeg tekst="Hier komt te staan wat je hebt afgehandeld." />
          ) : (
            afgehandeld.map((a) => (
              <Kaart key={a.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{a.naam || "Zonder naam"}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{aanmeldAdres(a)}</p>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {a.status === "geweigerd"
                      ? "Weggelegd"
                      : a.soort === "gekoppeld"
                        ? "Automatisch verwerkt"
                        : "Afgehandeld"}
                  </span>
                </div>
              </Kaart>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AanmeldingDialog
        open={toevoegen !== null}
        onOpenChange={(o) => !o && setToevoegen(null)}
        aanmelding={toevoegen}
        districts={wijken.data ?? []}
        onKlaar={() => void opnieuw()}
      />

      {/* De link en de QR-code binnen handbereik: wie aanmeldingen nakijkt,
          wil ze kunnen doorsturen of ophangen zonder deze pagina te verlaten.
          Hetzelfde blok als bij Instellingen, niet een tweede kopie. */}
      <Dialog open={link} onOpenChange={setLink}>
        <PopupKader className="sm:max-w-lg">
          <PopupKop
            kleur="blauw"
            icoon={<Link2 className="size-5" />}
            titel="Aanmeldpagina"
            subtitel="Deel de link of hang de QR-code op"
          />
          <PopupBody>
            <AanmeldInstellingen isEigenaar={employee?.rol === "eigenaar"} />
          </PopupBody>
          <PopupVoet>
            <Button variant="ghost" className="rounded-full" onClick={() => setLink(false)}>
              Sluiten
            </Button>
          </PopupVoet>
        </PopupKader>
      </Dialog>
    </AppLayout>
  );
}

function Kaart({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-border bg-card p-4 shadow-card">
      {children}
    </section>
  );
}

function Leeg({ tekst }: { tekst: string }) {
  return (
    <div className="rounded-[18px] border border-dashed border-border px-6 py-12 text-center">
      <Inbox className="mx-auto mb-3 size-6 text-muted-foreground" />
      <p className="mx-auto max-w-[40ch] text-[13.5px] text-muted-foreground">{tekst}</p>
    </div>
  );
}

/** De kop van een kaart: wie het is, waar, en wanneer het binnenkwam. */
function Kop({ aanmelding, tint }: { aanmelding: Aanmelding; tint: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${tint}`}
        >
          {aanmelding.soort === "wijziging" ? (
            <MapPin className="size-4" />
          ) : (
            <UserPlus className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold leading-tight">
            {aanmelding.naam || "Zonder naam"}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{aanmeldAdres(aanmelding)}</p>
        </div>
      </div>
      <span className="shrink-0 text-[12px] text-muted-foreground">
        {datum(aanmelding.created_at)}
      </span>
    </div>
  );
}

/** Telefoon en e-mail zoals de klant ze opgaf. */
function Contact({ aanmelding }: { aanmelding: Aanmelding }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
      {aanmelding.telefoon && (
        <span className="flex items-center gap-1.5">
          <Phone className="size-3.5 text-muted-foreground" /> {aanmelding.telefoon}
        </span>
      )}
      {aanmelding.email && (
        <span className="flex items-center gap-1.5">
          <Mail className="size-3.5 text-muted-foreground" /> {aanmelding.email}
        </span>
      )}
    </div>
  );
}

/** Een adres dat niet op de lijst staat: er is nog niets aangemaakt. */
function OnbekendKaart({
  aanmelding,
  onToevoegen,
  onWeigeren,
}: {
  aanmelding: Aanmelding;
  onToevoegen: () => void;
  onWeigeren: () => void;
}) {
  return (
    <Kaart>
      <Kop aanmelding={aanmelding} tint="bg-tint-groen text-tint-groen-ink" />
      <div className="mt-3 space-y-3">
        <Contact aanmelding={aanmelding} />
        <p className="text-[12.5px] text-muted-foreground">
          Dit adres staat nog niet op je lijst. Er is niets aangemaakt — kies een wijk en een prijs,
          dan komt het erbij.
        </p>
        <div className="flex gap-2">
          <Button className="rounded-full" onClick={onToevoegen}>
            Adres toevoegen
          </Button>
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground"
            onClick={onWeigeren}
          >
            <X className="size-4" /> Wegleggen
          </Button>
        </div>
      </div>
    </Kaart>
  );
}

/** Een adres dat al gegevens had: oud links, nieuw rechts, jij kiest. */
function WijzigingKaart({
  aanmelding,
  huidig,
  onKlaar,
  onWeigeren,
}: {
  aanmelding: Aanmelding;
  huidig: Klant | null;
  onKlaar: () => Promise<void>;
  onWeigeren: () => void;
}) {
  const [bezig, setBezig] = useState(false);

  const velden: { veld: keyof KlantVelden; label: string; nieuw: string }[] = [
    { veld: "naam", label: "Naam", nieuw: aanmelding.naam },
    { veld: "telefoon", label: "Telefoon", nieuw: aanmelding.telefoon },
    { veld: "email", label: "E-mail", nieuw: aanmelding.email },
  ];
  const anders = velden.filter(
    (v) => v.nieuw.trim() && v.nieuw.trim() !== (huidig?.[v.veld] ?? ""),
  );

  async function overnemen(patch: Partial<KlantVelden>) {
    if (!huidig) return;
    setBezig(true);
    try {
      await updateKlant(huidig.id, patch);
      await zetStatus([aanmelding.id], "klaar");
      await onKlaar();
      toast.success("Overgenomen.");
    } catch (err) {
      toast.error("Dat lukte niet: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBezig(false);
    }
  }

  async function laten() {
    setBezig(true);
    try {
      await zetStatus([aanmelding.id], "klaar");
      await onKlaar();
    } catch (err) {
      toast.error("Dat lukte niet: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBezig(false);
    }
  }

  return (
    <Kaart>
      <Kop aanmelding={aanmelding} tint="bg-tint-amber text-tint-amber-ink" />
      <div className="mt-3 space-y-3">
        <p className="text-[12.5px] text-muted-foreground">
          Bij dit adres stonden al gegevens. Er is niets veranderd — dit is wat de klant doorgaf.
        </p>

        {anders.length === 0 ? (
          <p className="text-[13px]">Alles wat is ingevuld staat er al zo. Niets te doen.</p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {anders.map((v) => (
              <div
                key={v.veld}
                className="grid grid-cols-[80px_1fr_auto_1fr] items-center gap-3 px-3 py-2.5 text-[13px]"
              >
                <span className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                  {v.label}
                </span>
                <span className="min-w-0 truncate text-muted-foreground line-through">
                  {(huidig?.[v.veld] ?? "") || "—"}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{v.nieuw}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 rounded-full px-2.5 text-[12px]"
                    disabled={bezig || !huidig}
                    onClick={() => void overnemen({ [v.veld]: v.nieuw } as Partial<KlantVelden>)}
                  >
                    Neem over
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {anders.length > 0 && (
            <Button
              className="rounded-full"
              disabled={bezig || !huidig}
              onClick={() =>
                void overnemen(
                  Object.fromEntries(anders.map((v) => [v.veld, v.nieuw])) as Partial<KlantVelden>,
                )
              }
            >
              <Check className="size-4" /> Alles overnemen
            </Button>
          )}
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground"
            disabled={bezig}
            onClick={() => void laten()}
          >
            Laten zoals het was
          </Button>
          <Button
            variant="ghost"
            className="rounded-full text-muted-foreground"
            disabled={bezig}
            onClick={onWeigeren}
          >
            <X className="size-4" /> Wegleggen
          </Button>
        </div>
      </div>
    </Kaart>
  );
}
