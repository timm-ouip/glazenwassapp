/**
 * De mailbox van het bedrijf koppelen aan Wooshy.
 *
 * Eén keer adres en wachtwoord invullen; daarna haalt Wooshy elke twee minuten
 * nieuwe mail op, en de eerste keer een jaar terug. Hier zie je of dat loopt
 * en hoe ver het is. De mail zelf lees je straks op de mailpagina.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  fetchMailbox,
  fetchMappen,
  koppelMailbox,
  mapNaam,
  nuOphalen,
  ontkoppelMailbox,
  telOpgehaald,
} from "@/lib/mailbox";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "zojuist", "3 min geleden", "2 uur geleden", of een datum. */
function geleden(iso: string | null): string {
  if (!iso) return "nog nooit";
  const minuten = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minuten < 1) return "zojuist";
  if (minuten < 60) return `${minuten} min geleden`;
  const uren = Math.round(minuten / 60);
  if (uren < 24) return `${uren} uur geleden`;
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

export function MailboxInstellingen({ isEigenaar }: { isEigenaar: boolean }) {
  const qc = useQueryClient();
  const bevestig = useBevestig();

  const mailbox = useQuery({
    queryKey: ["mailbox"],
    queryFn: fetchMailbox,
    enabled: isEigenaar,
    refetchInterval: 30_000,
  });
  const gekoppeld = !!mailbox.data && mailbox.data.status !== "uit";
  const mappen = useQuery({
    queryKey: ["mail-mappen"],
    queryFn: fetchMappen,
    enabled: isEigenaar && gekoppeld,
    refetchInterval: 30_000,
  });
  const opgehaald = useQuery({
    queryKey: ["mail-opgehaald"],
    queryFn: telOpgehaald,
    enabled: (mappen.data ?? []).length > 0,
    refetchInterval: 30_000,
  });

  const [adres, setAdres] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [formulierOpen, setFormulierOpen] = useState(false);
  const [bezig, setBezig] = useState<"koppelen" | "ophalen" | "ontkoppelen" | null>(null);

  if (!isEigenaar) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Alleen de eigenaar kan de mailbox koppelen en de mail lezen.
      </p>
    );
  }

  function ververs() {
    void qc.invalidateQueries({ queryKey: ["mailbox"] });
    void qc.invalidateQueries({ queryKey: ["mail-mappen"] });
    void qc.invalidateQueries({ queryKey: ["mail-opgehaald"] });
  }

  async function koppel(e: React.FormEvent) {
    e.preventDefault();
    setBezig("koppelen");
    try {
      const uit = await koppelMailbox(adres.trim(), wachtwoord);
      setWachtwoord("");
      setFormulierOpen(false);
      if (uit.smtpFout) {
        toast.warning(`Gekoppeld: mail ophalen werkt. Versturen gaf nog een fout: ${uit.smtpFout}`);
      } else {
        toast.success("Gekoppeld. Wooshy haalt je mail nu op.");
      }
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(null);
    }
  }

  async function haalNuOp() {
    setBezig("ophalen");
    try {
      const uit = await nuOphalen();
      if ("bezig" in uit && uit.bezig) toast.info("Wooshy is al aan het ophalen.");
      else toast.success(uit.nieuw === 0 ? "Geen nieuwe mail." : `${uit.nieuw} mails opgehaald.`);
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      ververs();
    } finally {
      setBezig(null);
    }
  }

  async function ontkoppel() {
    const ja = await bevestig({
      titel: "Mailbox ontkoppelen?",
      tekst:
        "Wooshy haalt dan geen nieuwe mail meer op en vergeet het wachtwoord. De mail die al binnen is blijft staan. In je gewone mailprogramma verandert niets.",
      bevestigLabel: "Ontkoppelen",
      gevaarlijk: true,
    });
    if (!ja) return;
    setBezig("ontkoppelen");
    try {
      await ontkoppelMailbox();
      toast.success("Mailbox ontkoppeld.");
      ververs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(null);
    }
  }

  if (mailbox.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Even kijken…</p>;
  }

  const box = mailbox.data;
  const toonFormulier = !gekoppeld || formulierOpen;
  const inWooshy = Object.values(opgehaald.data ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {gekoppeld && box && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-4 text-muted-foreground" />
            <span className="text-[14px] font-medium">{box.adres}</span>
            {box.status === "actief" && !box.fout && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11.5px] font-medium text-emerald-800">
                <CheckCircle2 className="size-3" /> Gekoppeld
              </span>
            )}
            {(box.status === "fout" || box.fout) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11.5px] font-medium text-amber-900">
                <AlertTriangle className="size-3" />
                {box.status === "fout" ? "Ophalen gestopt" : "Storing"}
              </span>
            )}
          </div>

          {box.fout && (
            <p className="rounded-[12px] bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
              {box.fout}
              {box.status === "fout" && " Vul het wachtwoord opnieuw in om weer op te halen."}
            </p>
          )}

          <p className="text-[12.5px] text-muted-foreground">
            Laatst opgehaald: {geleden(box.laatste_sync)}. Wooshy kijkt elke 2 minuten.
            {inWooshy > 0 && ` ${inWooshy} mails staan al in Wooshy.`}
          </p>

          {(mappen.data ?? []).length > 0 && (
            <ul className="divide-y divide-border rounded-[12px] border border-border text-[13px]">
              {(mappen.data ?? []).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{mapNaam(m)}</span>
                  <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                    {opgehaald.data?.[m.id] ?? 0} in Wooshy
                    {m.ongelezen > 0 && ` · ${m.ongelezen} ongelezen`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[12px] text-muted-foreground">
            De eerste keer haalt Wooshy de mail van de afgelopen 12 maanden op, in stapjes van
            zo'n 60 per ronde. Nieuwe mail gaat altijd voor.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={bezig !== null}
              onClick={() => void haalNuOp()}
            >
              {bezig === "ophalen" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Nu ophalen
            </Button>
            {!formulierOpen && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={bezig !== null}
                onClick={() => {
                  setAdres(box.adres);
                  setFormulierOpen(true);
                }}
              >
                Wachtwoord wijzigen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-destructive hover:text-destructive"
              disabled={bezig !== null}
              onClick={() => void ontkoppel()}
            >
              Ontkoppelen
            </Button>
          </div>
        </div>
      )}

      {toonFormulier && (
        <form onSubmit={(e) => void koppel(e)} className="space-y-3">
          {!gekoppeld && (
            <p className="text-[12.5px] text-muted-foreground">
              Vul het mailadres in waar klanten je op mailen, met het wachtwoord van die mailbox
              (hetzelfde als op je telefoon). Wooshy test het meteen en bewaart het versleuteld.
              {box?.status === "uit" &&
                " Koppel je hetzelfde adres opnieuw, dan blijft de mail die al binnen was gewoon staan."}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mailbox-adres" className="text-[12.5px]">
              Mailadres
            </Label>
            <Input
              id="mailbox-adres"
              type="email"
              autoComplete="username"
              placeholder="info@jouwbedrijf.nl"
              value={adres}
              onChange={(e) => setAdres(e.target.value)}
              required
            />
            {box && adres.trim() && adres.trim().toLowerCase() !== box.adres && (
              <p className="flex items-start gap-1.5 rounded-[10px] bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Dit is een ander adres dan {box.adres}. De mail van dat adres verdwijnt dan uit
                Wooshy (in je gewone mailprogramma blijft alles staan).
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mailbox-wachtwoord" className="text-[12.5px]">
              Wachtwoord van de mailbox
            </Label>
            <Input
              id="mailbox-wachtwoord"
              type="password"
              autoComplete="current-password"
              value={wachtwoord}
              onChange={(e) => setWachtwoord(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="rounded-full" disabled={bezig !== null}>
              {bezig === "koppelen" && <Loader2 className="size-3.5 animate-spin" />}
              {bezig === "koppelen" ? "Even testen…" : gekoppeld ? "Opslaan" : "Koppelen"}
            </Button>
            {gekoppeld && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  setFormulierOpen(false);
                  setWachtwoord("");
                }}
              >
                Annuleren
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
