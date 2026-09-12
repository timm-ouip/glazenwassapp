/**
 * Het blok waarmee je de aanmeldpagina beheert: de schakelaar, de link, de
 * QR-code en de knop om de link in te trekken.
 *
 * Apart onderdeel omdat het op twee plekken staat: op het tabblad Aanmelden
 * bij Instellingen, en in een schermpje op het postvak — daar wil je de link
 * of de QR-code kunnen pakken zonder de aanmeldingen die je aan het nakijken
 * bent te verlaten. Eén onderdeel, zodat die twee niet uit elkaar lopen.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { aanmeldLink } from "@/lib/aanmeldingen";
import { useBevestig } from "@/components/Bevestig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Twaalf tekens uit de willekeurigheidsbron van de browser — dezelfde vorm
 *  als de token die de database bij een nieuw bedrijf maakt. */
function nieuweToken(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Zet een bestand klaar om te downloaden zonder het ergens te bewaren. */
function download(naam: string, inhoud: Blob) {
  const url = URL.createObjectURL(inhoud);
  const a = document.createElement("a");
  a.href = url;
  a.download = naam;
  a.click();
  URL.revokeObjectURL(url);
}

export function AanmeldInstellingen({ isEigenaar }: { isEigenaar: boolean }) {
  const { employee } = useAuth();
  const bevestig = useBevestig();
  const qc = useQueryClient();
  const [qr, setQr] = useState("");
  const [svg, setSvg] = useState("");
  const [bezig, setBezig] = useState(false);

  const companyId = employee?.company_id;

  const { data: instelling } = useQuery({
    queryKey: ["aanmeld-instelling", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,aanmeld_token,aanmeld_aan")
        .eq("id", companyId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  const aan = instelling?.aanmeld_aan ?? false;
  const link = aanmeldLink(instelling?.aanmeld_token ?? "");

  // De QR-code pas in de browser maken: de bibliotheek tekent op een canvas,
  // en op de server bestaat dat niet. Met een gewone import zou het pakket ook
  // in de SSR-bundel belanden, waar het naar `fs` grijpt — dat heeft
  // Cloudflare Workers niet.
  useEffect(() => {
    if (!link) {
      setQr("");
      setSvg("");
      return;
    }
    let levend = true;
    void (async () => {
      const QRCode = (await import("qrcode")).default;
      // Zwart op wit, ook in het donkere thema: een QR-code met te weinig
      // verschil tussen de vlakjes wordt door geen enkele telefoon gelezen.
      const opties = { margin: 1, color: { dark: "#000000", light: "#ffffff" } } as const;
      const [png, tekening] = await Promise.all([
        QRCode.toDataURL(link, { ...opties, width: 512 }),
        QRCode.toString(link, { ...opties, type: "svg" }),
      ]);
      if (levend) {
        setQr(png);
        setSvg(tekening);
      }
    })();
    return () => {
      levend = false;
    };
  }, [link]);

  async function zetAan(nieuw: boolean) {
    if (!companyId) return;
    setBezig(true);
    const { error } = await supabase
      .from("companies")
      .update({ aanmeld_aan: nieuw })
      .eq("id", companyId);
    setBezig(false);
    if (error) {
      toast.error("Dat lukte niet: " + error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["aanmeld-instelling"] });
    toast.success(nieuw ? "De aanmeldpagina staat open." : "De aanmeldpagina staat dicht.");
  }

  async function vernieuwen() {
    if (!companyId) return;
    const ok = await bevestig({
      titel: "Nieuwe link maken?",
      tekst:
        "Alle QR-codes en links die je al hebt uitgedeeld werken daarna niet meer. " +
        "Doe dit alleen als de oude link bij de verkeerde mensen terecht is gekomen.",
      bevestigLabel: "Nieuwe link",
      gevaarlijk: true,
    });
    if (!ok) return;
    setBezig(true);
    const { error } = await supabase
      .from("companies")
      .update({ aanmeld_token: nieuweToken() })
      .eq("id", companyId);
    setBezig(false);
    if (error) {
      toast.error("Dat lukte niet: " + error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["aanmeld-instelling"] });
    toast.success("Er is een nieuwe link. Print de QR-code opnieuw.");
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start justify-between gap-4 rounded-[14px] border border-border bg-surface px-3.5 py-3">
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium">
            {aan ? "De pagina staat open" : "De pagina staat dicht"}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
            {aan
              ? "Wie de link of de QR-code heeft, kan zijn gegevens doorgeven."
              : "Niemand kan iets invullen, ook niet met de link."}
          </span>
        </span>
        <Switch
          checked={aan}
          disabled={!isEigenaar || bezig || !instelling}
          onCheckedChange={(v) => void zetAan(v)}
        />
      </label>

      {/* Pas zeggen als we het weten: zolang de medewerkersrij nog niet
          geladen is, weet niemand of dit de eigenaar is, en dan is dit
          regeltje een onwaarheid die even oplicht. */}
      {employee && !isEigenaar && (
        <p className="text-[12.5px] text-muted-foreground">
          Alleen de eigenaar kan de aanmeldpagina aan- of uitzetten.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="aanmeldlink" className="text-[12.5px]">
          De link
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="aanmeldlink"
            readOnly
            value={link}
            className="min-w-48 flex-1 font-mono text-[12.5px]"
          />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 rounded-full"
            disabled={!link}
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Link gekopieerd.");
            }}
          >
            <Copy className="size-4" /> Kopiëren
          </Button>
          {/* Een echte link en geen knop met window.open: zo kun je hem ook
              middelklikken of slepen, en werkt hij zonder JavaScript.
              noreferrer hoort bij target _blank — anders krijgt de nieuwe
              tab een handvat naar deze pagina. */}
          <Button
            asChild
            variant="outline"
            className={`shrink-0 rounded-full ${link ? "" : "pointer-events-none opacity-50"}`}
          >
            <a href={link || "#"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> Openen
            </a>
          </Button>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Zo zie je precies wat je klant ziet. Staat de pagina dicht, dan krijg je de melding die
          hij dan ook krijgt.
        </p>
      </div>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
        <div className="rounded-[14px] border border-border bg-white p-3 shadow-card">
          {qr ? (
            <img src={qr} alt="QR-code naar de aanmeldpagina" className="size-40" />
          ) : (
            <div className="size-40 animate-pulse rounded-lg bg-muted" />
          )}
        </div>
        <div className="space-y-2">
          <p className="max-w-[34ch] text-[12.5px] text-muted-foreground">
            Print de QR-code op een flyer of zet hem op de bus. Wie hem scant komt direct op jouw
            pagina.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!qr}
              onClick={() =>
                void fetch(qr)
                  .then((r) => r.blob())
                  .then((b) => download("aanmelden-qr.png", b))
              }
            >
              <Download className="size-4" /> PNG
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={!svg}
              onClick={() =>
                download("aanmelden-qr.svg", new Blob([svg], { type: "image/svg+xml" }))
              }
            >
              <Download className="size-4" /> SVG
            </Button>
          </div>
        </div>
      </div>

      {isEigenaar && (
        <div className="border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            className="rounded-full text-muted-foreground"
            disabled={bezig}
            onClick={() => void vernieuwen()}
          >
            <RefreshCw className="size-4" /> Nieuwe link maken
          </Button>
        </div>
      )}
    </div>
  );
}
