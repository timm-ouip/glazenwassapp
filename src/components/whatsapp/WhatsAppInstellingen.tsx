/**
 * Het WhatsApp-nummer van het bedrijf koppelen aan Wooshy.
 *
 * Nu nog met Meta's testnummer: drie gegevens uit de API-instellingen van je
 * Meta-app overnemen. Het echte nummer, dat ook in de WhatsApp Business-app
 * op je telefoon blijft, komt later via een knop die je bij Meta laat
 * inloggen.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWhatsAppKoppeling, ontkoppelWhatsApp, stelTestnummerIn } from "@/lib/whatsapp";

/** Het adres waar Meta de berichten heen moet sturen. */
const WEBHOOK_URL = `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1/whatsapp-webhook`;

export function WhatsAppInstellingen({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();
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
        "Wooshy ontvangt dan geen nieuwe berichten meer en vergeet het token. De berichten die al binnen zijn blijven staan.",
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
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setFormulierOpen((o) => !o)}
              >
                Gegevens wijzigen
              </Button>
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

      {isEigenaar && (!gekoppeld || formulierOpen) && (
        <form onSubmit={(e) => void koppel(e)} className="space-y-3">
          <p className="text-[12.5px] text-muted-foreground">
            Voor nu met het testnummer van Meta. Je vindt deze gegevens in de Meta-app van Wooshy
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
    </div>
  );
}
