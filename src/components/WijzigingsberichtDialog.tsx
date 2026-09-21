import { useEffect, useMemo, useState } from "react";
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
import { fetchCustomersMetInactief, fetchKlanten, fetchStreets } from "@/lib/klanten";

/**
 * "De planning is veranderd" — het bericht dat je stuurt als een dag
 * verschuift of als je niet aan een adres toekwam.
 *
 * Het gaat via hetzelfde kanaal als de aankondiging (mail, of WhatsApp waar
 * de klant dat wil). De tekst komt uit het sjabloon; de reden kies je snel
 * aan of typ je zelf. Onder "Naar wie" vink je adressen uit die het bericht
 * toch niet moeten krijgen.
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
  /** Wat je hebt uitgevinkt: die krijgen niets. */
  const [uit, setUit] = useState<Set<string>>(new Set());
  const bevestig = useBevestig();

  // Bij een nieuwe lijst weer alles aan.
  const lijstSleutel = [...customerIds].sort().join(",");
  useEffect(() => {
    setUit(new Set());
  }, [lijstSleutel, open]);
  const gekozen = useMemo(() => customerIds.filter((id) => !uit.has(id)), [customerIds, uit]);

  // Namen voor de lijst: dezelfde gegevens die de rest van de app al heeft.
  const adressen = useQuery({
    queryKey: ["customers", "met-inactief"],
    queryFn: fetchCustomersMetInactief,
    enabled: open,
  });
  const straten = useQuery({ queryKey: ["streets"], queryFn: fetchStreets, enabled: open });
  const klanten = useQuery({ queryKey: ["klanten"], queryFn: fetchKlanten, enabled: open });
  const rijen = useMemo(() => {
    const adresVan = new Map((adressen.data ?? []).map((c) => [c.id, c]));
    const straatVan = new Map((straten.data ?? []).map((s) => [s.id, s.name]));
    const klantVan = new Map((klanten.data ?? []).map((k) => [k.id, k.naam]));
    return customerIds.map((id) => {
      const c = adresVan.get(id);
      return {
        id,
        adres: c
          ? `${straatVan.get(c.street_id) ?? ""} ${c.house_number}${c.addition ?? ""}`.trim()
          : "…",
        klant: (c?.klant_id && klantVan.get(c.klant_id)) || "",
      };
    });
  }, [customerIds, adressen.data, straten.data, klanten.data]);

  function zet(id: string, aan: boolean) {
    setUit((was) => {
      const nieuw = new Set(was);
      if (aan) nieuw.delete(id);
      else nieuw.add(id);
      return nieuw;
    });
  }

  const sjablonen = useQuery({ queryKey: ["bericht-sjablonen"], queryFn: fetchSjablonen });
  const redenen = useQuery({ queryKey: ["snelle-redenen"], queryFn: fetchRedenen });
  const waSjabloonId =
    (sjablonen.data ?? []).find((x) => x.id === sjabloonId)?.wa_sjabloon_id ?? null;

  const telling = useQuery({
    queryKey: ["wijziging-tellen", soort, waSjabloonId ?? "", [...gekozen].sort().join(",")],
    queryFn: () => telWijziging(gekozen, soort, waSjabloonId),
    enabled: open && gekozen.length > 0,
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
      const uitkomst = await verstuurWijziging({
        customerIds: gekozen,
        soort,
        reden: reden.trim(),
        onderwerp: onderwerp.trim(),
        tekst,
        // De server verwacht het WhatsApp-sjabloon dat bij deze tekst hoort,
        // niet de tekst zelf; zonder gaat het bericht alleen per mail.
        ...(waSjabloonId ? { sjabloonId: waSjabloonId } : {}),
        ...(toch ? { toch: true } : {}),
      });
      const samen = uitkomst.verstuurd + uitkomst.verstuurdWhatsApp;
      toast.success(
        `${samen} ${samen === 1 ? "klant" : "klanten"} ingelicht${
          uitkomst.mislukt > 0 ? `, ${uitkomst.mislukt} mislukt` : ""
        }`,
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

  // Zonder aangevinkte adressen is er niemand om te tellen.
  const t = gekozen.length > 0 ? telling.data : undefined;

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
              : `${gekozen.length} ${gekozen.length === 1 ? "adres" : "adressen"}`
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

          <PopupBlok label={`Naar wie (${gekozen.length} van ${customerIds.length})`}>
            {customerIds.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setUit(gekozen.length === customerIds.length ? new Set(customerIds) : new Set())
                }
                className="mb-1.5 text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {gekozen.length === customerIds.length ? "Alles uitvinken" : "Alles aanvinken"}
              </button>
            )}
            <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1 text-[12.5px]">
              {rijen.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-[8px] px-1 py-0.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-foreground"
                      checked={!uit.has(r.id)}
                      onChange={(e) => zet(r.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {r.adres}
                      {r.klant && <span className="text-muted-foreground"> — {r.klant}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {t && t.voorbeeld.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-border/60 pt-2 text-[12px] text-muted-foreground">
                {t.voorbeeld.slice(0, 3).map((v, i) => (
                  <li key={i} className="truncate">
                    {v.naam}: {v.oudeDatum} → {v.nieuweDatum}
                  </li>
                ))}
              </ul>
            )}
          </PopupBlok>
        </PopupBody>
        <PopupVoet>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bezig}>
            Annuleren
          </Button>
          <Button onClick={() => void versturen(false)} disabled={bezig || gekozen.length === 0}>
            {bezig ? "Bezig…" : "Versturen"}
          </Button>
        </PopupVoet>
      </PopupKader>
    </Dialog>
  );
}
