import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconMailForward as MailForward } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PopupBlok, PopupBody, PopupKader, PopupKop, PopupVoet } from "@/components/Popup";
import { AlVerstuurdFout, telWijziging, verstuurWijziging } from "@/lib/mailing";
import { useBevestig } from "@/components/Bevestig";
import { fetchRedenen, fetchSjablonen, standaardVan, type SjabloonSoort } from "@/lib/sjablonen";

/**
 * "De planning is veranderd" — het bericht dat je stuurt als een dag
 * verschuift of als je niet aan een adres toekwam.
 *
 * Het gaat via hetzelfde kanaal als de aankondiging (mail, of WhatsApp waar
 * de klant dat wil). De tekst komt uit het sjabloon; de reden kies je snel
 * aan of typ je zelf.
 */
export function WijzigingsberichtDialog({
  open,
  onOpenChange,
  customerIds,
  soort,
  onVerstuurd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  soort: SjabloonSoort & ("wijziging" | "niet_af");
  onVerstuurd?: () => void;
}) {
  const [reden, setReden] = useState("");
  const [onderwerp, setOnderwerp] = useState("");
  const [tekst, setTekst] = useState("");
  const [sjabloonId, setSjabloonId] = useState("");
  const [bezig, setBezig] = useState(false);
  const bevestig = useBevestig();

  const sjablonen = useQuery({ queryKey: ["bericht-sjablonen"], queryFn: fetchSjablonen });
  const redenen = useQuery({ queryKey: ["snelle-redenen"], queryFn: fetchRedenen });
  const telling = useQuery({
    queryKey: ["wijziging-tellen", soort, [...customerIds].sort().join(",")],
    queryFn: () => telWijziging(customerIds, soort),
    enabled: open && customerIds.length > 0,
  });

  // Bij het opengaan de standaardtekst pakken.
  useEffect(() => {
    if (!open) return;
    const standaard = standaardVan(sjablonen.data ?? [], soort);
    if (!standaard) return;
    setSjabloonId(standaard.id);
    setOnderwerp(standaard.onderwerp);
    setTekst(standaard.tekst);
  }, [open, soort, sjablonen.data]);

  async function versturen(toch = false) {
    if (!tekst.trim()) {
      toast.error("Er is nog geen tekst.");
      return;
    }
    setBezig(true);
    try {
      const uit = await verstuurWijziging({
        customerIds,
        soort,
        reden: reden.trim(),
        onderwerp: onderwerp.trim(),
        tekst,
        ...(sjabloonId ? { sjabloonId } : {}),
        ...(toch ? { toch: true } : {}),
      });
      toast.success(
        `${uit.verstuurd + uit.verstuurdWhatsApp} ${
          uit.verstuurd + uit.verstuurdWhatsApp === 1 ? "klant" : "klanten"
        } ingelicht${uit.mislukt > 0 ? `, ${uit.mislukt} mislukt` : ""}`,
      );
      onOpenChange(false);
      onVerstuurd?.();
    } catch (e) {
      setBezig(false);
      // Kregen deze klanten het afgelopen uur al zo'n bericht, dan vragen we
      // het eerst: anders krijgt iedereen het dubbel.
      if (e instanceof AlVerstuurdFout) {
        const ja = await bevestig({
          titel: "Deze klanten kregen net al een bericht",
          tekst:
            "Het afgelopen uur ging er al zo'n bericht naar deze adressen. Toch nog een keer versturen?",
          bevestigLabel: "Toch versturen",
          gevaarlijk: true,
        });
        if (ja) await versturen(true);
        return;
      }
      toast.error("Versturen mislukt: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    setBezig(false);
  }

  const t = telling.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PopupKader className="sm:max-w-lg">
        <PopupKop
          kleur="amber"
          icoon={<MailForward className="size-[22px]" />}
          titel={soort === "wijziging" ? "Wijziging in de planning" : "Niet af gekomen"}
          subtitel={
            t
              ? `${t.aantal + t.aantalWhatsApp} ${t.aantal + t.aantalWhatsApp === 1 ? "klant" : "klanten"}${
                  t.zonderContact > 0 ? ` · ${t.zonderContact} zonder adres` : ""
                }`
              : `${customerIds.length} ${customerIds.length === 1 ? "adres" : "adressen"}`
          }
        />
        <PopupBody>
          <PopupBlok label="Reden">
            <div className="flex flex-wrap gap-1.5">
              {(redenen.data ?? []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReden(r.tekst)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    reden === r.tekst
                      ? "border-transparent bg-tint-amber text-tint-amber-ink"
                      : "border-border bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {r.tekst}
                </button>
              ))}
            </div>
            <Input
              value={reden}
              placeholder="of typ zelf een reden"
              className="mt-2"
              onChange={(e) => setReden(e.target.value)}
            />
          </PopupBlok>

          <PopupBlok label="Onderwerp">
            <Input value={onderwerp} onChange={(e) => setOnderwerp(e.target.value)} />
          </PopupBlok>

          <PopupBlok label="Bericht">
            <Textarea rows={8} value={tekst} onChange={(e) => setTekst(e.target.value)} />
            <p className="mt-1 text-[12px] text-muted-foreground">
              De app vult {"{{naam}}"}, {"{{adres}}"}, {"{{datum}}"}, {"{{nieuwe datum}}"} en{" "}
              {"{{reden}}"} per klant in.
            </p>
          </PopupBlok>

          {t && t.voorbeeld.length > 0 && (
            <PopupBlok label="Naar wie">
              <ul className="space-y-0.5 text-[12.5px] text-muted-foreground">
                {t.voorbeeld.slice(0, 5).map((v, i) => (
                  <li key={i} className="truncate">
                    {v.naam} — {v.adressen.join(", ")}: {v.oudeDatum} → {v.nieuweDatum}
                  </li>
                ))}
                {t.aantal + t.aantalWhatsApp > t.voorbeeld.length && (
                  <li>en nog {t.aantal + t.aantalWhatsApp - t.voorbeeld.length} …</li>
                )}
              </ul>
            </PopupBlok>
          )}
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bezig}>
            Annuleren
          </Button>
          <Button
            onClick={() => void versturen(false)}
            disabled={bezig || customerIds.length === 0}
          >
            {bezig ? "Bezig…" : "Versturen"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
