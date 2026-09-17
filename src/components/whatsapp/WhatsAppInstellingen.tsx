/**
 * Het WhatsApp-nummer van het bedrijf koppelen aan Wooshy.
 *
 * Het echte nummer, dat ook in de WhatsApp Business-app op je telefoon
 * blijft, koppel je via Kapso: een knop opent Kapso, daar log je in bij Meta
 * en kies je je nummer, en daarna kom je hier terug. Voor het bouwen kan ook
 * nog Meta's testnummer, met drie gegevens uit de Meta-app.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchAntwoordTijden,
  fetchWhatsAppKoppeling,
  maakKapsoLink,
  ontkoppelWhatsApp,
  rondKapsoAf,
  stelTestnummerIn,
  zetAntwoordTijden,
} from "@/lib/whatsapp";
import { useAuth } from "@/lib/auth";
import { SjablonenBeheer, ToestemmingBestaandeKlanten } from "@/components/whatsapp/Sjablonen";

/** Het adres waar Meta de berichten heen moet sturen. */
const WEBHOOK_URL = `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1/whatsapp-webhook`;

/** Waarom het koppelen bij Kapso misging, in gewone taal. */
const KAPSO_FOUT: Record<string, string> = {
  facebook_auth_failed: "Inloggen bij Facebook lukte niet.",
  phone_verification_failed: "Het nummer kon niet worden bevestigd.",
  waba_limit_reached: "Je Facebook-bedrijf heeft al het maximale aantal WhatsApp-accounts.",
  token_exchange_failed: "Meta gaf geen toegang terug. Probeer het nog eens.",
  link_expired: "De koppellink was verlopen. Begin opnieuw.",
  already_used: "Deze koppellink was al gebruikt. Begin opnieuw.",
};

export interface KapsoTerug {
  status: "klaar" | "mislukt";
  phoneNumberId?: string;
  foutcode?: string;
}

export function WhatsAppInstellingen({ isEigenaar, kapsoTerug }: { isEigenaar: boolean; kapsoTerug?: KapsoTerug }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
  const navigate = useNavigate();
  const koppeling = useQuery({
    queryKey: ["whatsapp-koppeling"],
    queryFn: fetchWhatsAppKoppeling,
    refetchInterval: 30_000,
  });
  const [nummerId, setNummerId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [formulierOpen, setFormulierOpen] = useState(false);
  const [bezig, setBezig] = useState(false);

  const k = koppeling.data;
  const gekoppeld = !!k && k.status !== "uit";

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["whatsapp-koppeling"] });
  }

  // Terug van Kapso: de koppeling afronden (één keer), en het adres opschonen.
  const afgehandeld = useRef(false);
  useEffect(() => {
    if (!kapsoTerug || !isEigenaar || afgehandeld.current) return;
    afgehandeld.current = true;
    void navigate({ to: "/instellingen", search: { tab: "mail" }, replace: true });
    if (kapsoTerug.status === "mislukt") {
      toast.error(
        `Koppelen via Kapso is niet gelukt. ${KAPSO_FOUT[kapsoTerug.foutcode ?? ""] ?? "Probeer het nog eens."}`,
      );
      return;
    }
    void rondAf(kapsoTerug.phoneNumberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kapsoTerug, isEigenaar]);

  async function rondAf(phoneNumberId?: string) {
    setBezig(true);
    try {
      const uit = await rondKapsoAf(phoneNumberId);
      toast.success(
        uit.coexistence
          ? `Gekoppeld: ${uit.weergavenummer}. Je nummer werkt ook nog gewoon in de app.`
          : `Gekoppeld: ${uit.weergavenummer || "je nummer"}.`,
      );
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  async function naarKapso() {
    const ja = await bevestig({
      titel: "WhatsApp koppelen via Kapso?",
      tekst:
        "Je gaat naar Kapso. Daar log je in bij Facebook en kies je je nummer uit de WhatsApp Business-app. Let op: na het koppelen kun je je uitzendlijsten in de app alleen nog lezen, niet meer versturen.",
      bevestigLabel: "Naar Kapso",
    });
    if (!ja) return;
    setBezig(true);
    try {
      const { url } = await maakKapsoLink();
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBezig(false);
    }
  }

  async function koppel(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    try {
      const uit = await stelTestnummerIn({
        phone_number_id: nummerId.trim(),
        waba_id: accountId.trim(),
        token: token.trim(),
      });
      setToken("");
      setFormulierOpen(false);
      toast.success(`Gekoppeld: ${uit.weergavenummer}. Stuur er eens een appje naar.`);
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  async function ontkoppel() {
    const ja = await bevestig({
      titel: "WhatsApp ontkoppelen?",
      tekst:
        k?.aanbieder === "kapso"
          ? "Wooshy ontvangt dan geen nieuwe berichten meer. De berichten die al binnen zijn blijven staan. Je nummer blijft bij Kapso staan; daar haal je het weg als je wilt."
          : "Wooshy ontvangt dan geen nieuwe berichten meer en vergeet het token. De berichten die al binnen zijn blijven staan.",
      bevestigLabel: "Ontkoppelen",
      gevaarlijk: true,
    });
    if (!ja) return;
    setBezig(true);
    try {
      await ontkoppelWhatsApp();
      toast.success("WhatsApp ontkoppeld.");
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  if (koppeling.isLoading) return <p className="text-[13px] text-muted-foreground">Even kijken…</p>;

  return (
    <div className="space-y-4">
      {gekoppeld && k && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <MessageCircle className="size-4 text-muted-foreground" />
            <span className="text-[14px] font-medium">{k.weergavenummer || k.phone_number_id}</span>
            {k.soort === "test" && (
              <span className="rounded-full bg-tint-blauw px-2 py-0.5 text-[11.5px] font-medium text-tint-blauw-ink">
                Testnummer
              </span>
            )}
            {k.aanbieder === "kapso" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                Via Kapso
              </span>
            )}
            {k.status === "actief" && !k.fout ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-tint-groen px-2 py-0.5 text-[11.5px] font-medium text-tint-groen-ink">
                <CheckCircle2 className="size-3" /> Gekoppeld
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[11.5px] font-medium text-tint-amber-ink">
                <AlertTriangle className="size-3" /> Storing
              </span>
            )}
          </div>
          {k.fout && (
            <p className="rounded-[12px] bg-tint-amber px-3 py-2 text-[12.5px] text-tint-amber-ink">
              {k.fout}
            </p>
          )}
          <p className="text-[12.5px] text-muted-foreground">
            Laatste bericht:{" "}
            {k.laatste_bericht_op
              ? new Date(k.laatste_bericht_op).toLocaleString("nl-NL", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "nog geen"}
            .
          </p>
          {isEigenaar && (
            <div className="flex flex-wrap gap-2">
              {k.aanbieder === "kapso" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={bezig}
                  onClick={() => void rondAf(k.phone_number_id)}
                >
                  Koppeling controleren
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setFormulierOpen((o) => !o)}
                >
                  Gegevens wijzigen
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={bezig}
                onClick={() => void ontkoppel()}
              >
                Ontkoppelen
              </Button>
            </div>
          )}
        </div>
      )}

      {!isEigenaar && !gekoppeld && (
        <p className="text-[13px] text-muted-foreground">
          Alleen de eigenaar kan WhatsApp koppelen.
        </p>
      )}

      {isEigenaar && !gekoppeld && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Koppel het nummer van je WhatsApp Business-app. Het blijft gewoon werken op je telefoon;
            Wooshy leest mee en je kunt vanuit hier antwoorden. Na het koppelen kun je uitzendlijsten
            in de app niet meer versturen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="rounded-full" disabled={bezig} onClick={() => void naarKapso()}>
              {bezig ? "Bezig…" : "Koppelen via Kapso"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              disabled={bezig}
              onClick={() => void rondAf()}
            >
              Ik heb al gekoppeld
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              onClick={() => setFormulierOpen((o) => !o)}
            >
              Testnummer van Meta
            </Button>
          </div>
        </div>
      )}

      {isEigenaar && formulierOpen && (!gekoppeld || k?.aanbieder !== "kapso") && (
        <form onSubmit={(e) => void koppel(e)} className="space-y-3">
          <p className="text-[12.5px] text-muted-foreground">
            Voor het testnummer van Meta. Je vindt deze gegevens in de Meta-app van Wooshy
            onder WhatsApp → API-instellingen. Zet daar bij Webhook dit adres neer, met het
            controlewoord dat ik je gaf, en vink <em>messages</em> aan:
          </p>
          <code className="block break-all rounded-[10px] bg-muted px-2.5 py-1.5 text-[12px]">
            {WEBHOOK_URL}
          </code>
          <div className="space-y-1.5">
            <Label htmlFor="wa-nummer-id">Nummer-ID (Phone number ID)</Label>
            <Input
              id="wa-nummer-id"
              inputMode="numeric"
              value={nummerId}
              onChange={(e) => setNummerId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-account-id">Account-ID (WhatsApp Business Account ID)</Label>
            <Input
              id="wa-account-id"
              inputMode="numeric"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-token">Toegangstoken</Label>
            <Input
              id="wa-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <p className="text-[12px] text-muted-foreground">
              Gebruik een blijvend token van een systeemgebruiker; het tijdelijke token van Meta
              verloopt na een dag.
            </p>
          </div>
          <Button type="submit" size="sm" className="rounded-full" disabled={bezig}>
            {bezig ? "Bezig…" : "Koppelen"}
          </Button>
        </form>
      )}

      {gekoppeld && isEigenaar && <AntwoordTijdenFormulier />}
      {gekoppeld && (
        <div className="space-y-4 border-t border-border pt-4">
          <SjablonenBeheer isEigenaar={isEigenaar} />
          {isEigenaar && <ToestemmingBestaandeKlanten />}
        </div>
      )}
    </div>
  );
}

/** Hoe lang Paaltje wacht voor hij zelf antwoordt, en tussen welke tijden. */
function AntwoordTijdenFormulier() {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const companyId = employee?.company_id ?? "";
  const tijden = useQuery({
    queryKey: ["wa-antwoordtijden", companyId],
    queryFn: () => fetchAntwoordTijden(companyId),
    enabled: !!companyId,
  });
  const [wachttijd, setWachttijd] = useState<string | null>(null);
  const [van, setVan] = useState<string | null>(null);
  const [tot, setTot] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  if (!tijden.data) return null;

  const w = wachttijd ?? String(tijden.data.wachttijd);
  const v = van ?? tijden.data.van;
  const t = tot ?? tijden.data.tot;

  async function bewaar(e: React.FormEvent) {
    e.preventDefault();
    const minuten = Number(w);
    if (!Number.isInteger(minuten) || minuten < 0 || minuten > 240) {
      toast.error("De wachttijd is een aantal minuten tussen 0 en 240.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(v) || !/^\d{2}:\d{2}$/.test(t) || v >= t) {
      toast.error("Kies een begintijd die vóór de eindtijd ligt.");
      return;
    }
    setBezig(true);
    try {
      await zetAntwoordTijden(companyId, { wachttijd: minuten, van: v, tot: t });
      setWachttijd(null);
      setVan(null);
      setTot(null);
      void qc.invalidateQueries({ queryKey: ["wa-antwoordtijden", companyId] });
      toast.success("Opgeslagen.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(false);
    }
  }

  return (
    <form onSubmit={(e) => void bewaar(e)} className="space-y-3 border-t border-border pt-4">
      <div>
        <p className="text-[13.5px] font-medium">Paaltje op WhatsApp</p>
        <p className="text-[12.5px] text-muted-foreground">
          Mag Paaltje een bericht zelf beantwoorden (in te stellen per categorie bij Paaltje:
          categorieën), dan wacht hij eerst. Antwoord je intussen zelf, in de app of in Wooshy, dan
          stuurt hij niets.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="wa-wachttijd">Wachttijd (minuten)</Label>
          <Input
            id="wa-wachttijd"
            type="number"
            min={0}
            max={240}
            value={w}
            onChange={(e) => setWachttijd(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-van">Antwoorden vanaf</Label>
          <Input
            id="wa-van"
            type="time"
            value={v}
            onChange={(e) => setVan(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-tot">tot</Label>
          <Input
            id="wa-tot"
            type="time"
            value={t}
            onChange={(e) => setTot(e.target.value)}
            className="w-32"
          />
        </div>
        <Button type="submit" size="sm" className="rounded-full" disabled={bezig}>
          {bezig ? "Bezig…" : "Opslaan"}
        </Button>
      </div>
    </form>
  );
}
